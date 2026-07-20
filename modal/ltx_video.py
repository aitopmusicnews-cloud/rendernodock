import io
import uuid
from pathlib import Path
import modal

app = modal.App("mvs-ltx-video")

MODEL_DIR = "/models"
OUTPUT_DIR = "/outputs"
model_volume = modal.Volume.from_name("mvs-ltx-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx-outputs", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("python3-opencv", "ffmpeg", "git")
    .pip_install(
        "diffusers==0.32.2",
        "av",
        "accelerate>=1.4.0",
        "fastapi[standard]>=0.115.8",
        "huggingface-hub>=0.27.0",
        "imageio>=2.37.0",
        "imageio-ffmpeg>=0.6.0",
        "opencv-python>=4.11.0.86",
        "pillow>=11.1.0",
        "torch>=2.6.0",
        "transformers>=4.49.0",
        "sentencepiece>=0.2.0",
        "protobuf>=5.29.3",
        "httpx>=0.27.2",
    )
    .env({"HF_HUB_CACHE": MODEL_DIR})
)

with image.imports():
    import torch  # type: ignore[import-untyped]
    import httpx  # type: ignore[import-untyped]
    from PIL import Image  # type: ignore[import-untyped]
    from diffusers import LTXVideoPipeline, LTXImageToVideoPipeline  # type: ignore[import-untyped]
    from diffusers.utils import export_to_video  # type: ignore[import-untyped]

@app.cls(
    image=image,
    gpu="A100-80GB",
    timeout=600,
    volumes={MODEL_DIR: model_volume, OUTPUT_DIR: output_volume},
)
class LTXGenerator:
    @modal.enter()
    def load_model(self):
        print("[LTX] Loading LTX-Video weights...")
        self.t2v_pipe = LTXVideoPipeline.from_pretrained(
            "Lightricks/LTX-Video",
            torch_dtype=torch.bfloat16,
        ).to("cuda")
        self.i2v_pipe = LTXImageToVideoPipeline.from_pretrained(
            "Lightricks/LTX-Video",
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    @modal.method()
    def generate_clip(self, prompt: str, duration_sec: float, init_image_url: str = None) -> str:
        fps = 24
        num_frames = int(duration_sec * fps)
        # LTX-Video requires (num_frames - 1) divisible by 8, min 9
        num_frames = ((num_frames - 1) // 8) * 8 + 1
        num_frames = max(9, min(num_frames, 257))

        negative_prompt = "worst quality, inconsistent motion, blurry, jittery, distorted"

        filename = f"ltx-{uuid.uuid4()}.mp4"
        filepath = Path(OUTPUT_DIR) / filename

        if init_image_url:
            print(f"[LTX] Image-to-video from: {init_image_url}")
            try:
                with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                    response = client.get(init_image_url)
                    response.raise_for_status()
                    init_image = Image.open(io.BytesIO(response.content)).convert("RGB")
                    init_image = init_image.resize((768, 512), Image.Resampling.LANCZOS)
                result = self.i2v_pipe(
                    image=init_image,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=768,
                    height=512,
                    num_frames=num_frames,
                    num_inference_steps=30,
                    guidance_scale=3.0,
                ).frames[0]
            except Exception as e:
                print(f"[LTX Warning] Image conditioning failed ({e}), falling back to t2v")
                result = self.t2v_pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=768,
                    height=512,
                    num_frames=num_frames,
                    num_inference_steps=30,
                    guidance_scale=3.0,
                ).frames[0]
        else:
            print(f"[LTX] Text-to-video for: '{prompt}'")
            result = self.t2v_pipe(
                prompt=prompt,
                negative_prompt=negative_prompt,
                width=768,
                height=512,
                num_frames=num_frames,
                num_inference_steps=30,
                guidance_scale=3.0,
            ).frames[0]

        export_to_video(result, str(filepath), fps=fps)
        print(f"[LTX] Saved: {filename}")
        output_volume.commit()
        return filename

# The API Endpoint updated for Webhooks
@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def generate(payload: dict):
    prompt = payload.get("prompt", "")
    duration = float(payload.get("duration", 4.0))
    init_image_url = payload.get("init_image_url", None)
    webhook_url = payload.get("webhook_url", None)
    job_id = payload.get("job_id", None)
    
    gen = LTXGenerator()
    
    try:
        # Run the computation
        filename = gen.generate_clip.remote(prompt, duration, init_image_url)
        video_url = f"https://cdtfullsail--mvs-ltx-video-get-file.modal.run?filename={filename}"
        
        # Trigger the webhook callback back to Node.js if provided
        if webhook_url:
            print(f"[Webhook] Dispatching success callback to: {webhook_url}")
            httpx.post(webhook_url, json={
                "status": "completed",
                "job_id": job_id,
                "video_url": video_url
            }, timeout=10.0)
            
        return {"status": "processing_triggered", "video_url": video_url}
        
    except Exception as e:
        print(f"[Modal Error] Generation failed: {str(e)}")
        if webhook_url:
            try:
                httpx.post(webhook_url, json={
                    "status": "failed",
                    "job_id": job_id,
                    "error": str(e)
                }, timeout=10.0)
            except Exception as cb_err:
                print(f"[Webhook Error] Failed to dispatch failure callback: {str(cb_err)}")
        raise e

@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse, JSONResponse  # type: ignore[import-untyped]
    output_volume.reload()
    base = Path(OUTPUT_DIR).resolve()
    filepath = (base / filename).resolve()
    if not filepath.is_relative_to(base):
        return JSONResponse({"error": "Invalid filename"}, status_code=400)
    if filepath.exists():
        return FileResponse(filepath, media_type="video/mp4")
    return JSONResponse({"error": "Clip not found"}, status_code=404)