import io
import os
from pathlib import Path
import modal

app = modal.App("mvs-ltx-video")

MODEL_DIR = "/models"
OUTPUT_DIR = "/outputs"
model_volume = modal.Volume.from_name("mvs-ltx-models", create_if_missing=True)
output_volume = modal.Volume.from_name("mvs-ltx-outputs", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("python3-opencv", "ffmpeg")
    .uv_pip_install(
        "accelerate==1.4.0",
        "diffusers==0.32.2",
        "fastapi[standard]==0.115.8",
        "huggingface-hub==0.36.0",
        "imageio==2.37.0",
        "imageio-ffmpeg==0.6.0",
        "opencv-python==4.11.0.86",
        "pillow==11.1.0",
        "torch==2.6.0",
        "transformers==4.49.0",
        "sentencepiece==0.2.0",
        "protobuf==5.29.3",
        "httpx==0.27.2",
    )
    .env({"HF_HUB_CACHE": MODEL_DIR})
)

with image.imports():
    import torch
    import httpx
    from PIL import Image
    from diffusers import LTXPipeline
    from diffusers.utils import export_to_video

@app.cls(
    image=image,
    gpu="A100-80GB", 
    timeout=600,
    volumes={MODEL_DIR: model_volume, OUTPUT_DIR: output_volume},
)
class LTXGenerator:
    @modal.enter()
    def load_model(self):
        self.pipe = LTXPipeline.from_pretrained(
            "Lightricks/LTX-Video",
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    @modal.method()
    def generate_clip(self, prompt: str, duration_sec: float, init_image_url: str = None) -> str:
        import uuid
        fps = 24
        num_frames = int(duration_sec * fps)
        num_frames = ((num_frames - 1) // 8) * 8 + 1
        num_frames = max(9, min(num_frames, 97))

        # Standard negative prompts to keep structural integrity high
        negative_prompt = "worst quality, blurry, distorted, low resolution, cartoon, abstract, static, draft"

        pipeline_kwargs = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "num_inference_steps": 30,
            "guidance_scale": 4.5,       # Strong alignment to prompt details
            "num_frames": num_frames,
            "height": 512,               # Native height
            "width": 768,                # Native width
            "max_sequence_length": 256,  # Allows longer, rich prompt descriptions
        }

        # Handle Image-to-Video if an initial seed image URL is supplied
        if init_image_url:
            print(f"[LTX-Video] Fetching initial reference frame: {init_image_url}")
            try:
                with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                    response = client.get(init_image_url)
                    response.raise_for_status()
                    # Open and resize PIL image to match the native generation aspect ratio
                    init_image = Image.open(io.BytesIO(response.content)).convert("RGB")
                    init_image = init_image.resize((768, 512), Image.Resampling.LANCZOS)
                    
                    # Inject configuration parameters for structural image-to-video conditioning
                    pipeline_kwargs["image"] = init_image
                    print("[LTX-Video] Successfully loaded image context for conditioning.")
            except Exception as e:
                print(f"[LTX-Video Warning] Failed to fetch init image, falling back to T2V: {str(e)}")

        # Run compilation
        video_frames = self.pipe(**pipeline_kwargs).frames[0]

        filename = f"ltx-{uuid.uuid4()}.mp4"
        filepath = Path(OUTPUT_DIR) / filename
        export_to_video(video_frames, str(filepath), fps=fps)
        
        output_volume.commit()
        return filename

@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="POST")
def generate(payload: dict):
    prompt = payload.get("prompt", "")
    duration = float(payload.get("duration", 4.0))
    init_image_url = payload.get("init_image_url", None)
    
    gen = LTXGenerator()
    filename = gen.generate_clip.remote(prompt, duration, init_image_url)
    
    return {"video_url": f"https://cdtfullsail--mvs-ltx-video-get-file.modal.run?filename={filename}"}

@app.function(image=image, volumes={OUTPUT_DIR: output_volume})
@modal.fastapi_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse
    output_volume.reload()
    filepath = Path(OUTPUT_DIR) / filename
    if filepath.exists():
        return FileResponse(filepath, media_type="video/mp4")
    return {"error": "Clip not found"}, 404