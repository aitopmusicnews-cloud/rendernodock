import os
import uuid
import reuests
from modal import App, Image, Volume, web_endpoint, enter, method

# Setup the system dependencies matching your GPU container environment
image = (
    Image.debian_slim()
    .apt_install("git", "ffmpeg")
    .pip_install(
        "torch",
        "transformers",
        "diffusers",
        "accelerate",
        "sentencepiece",
        "numpy"
    )
)

app = App("mvs-ltx-video", image=image)
output_volume = Volume.from_name("mvs-ltx-outputs", create_if_missing=True)

@app.cls(
    gpu="A100",
    timeout=600,
    volumes={"/outputs": output_volume}
)
class LtxPipeline:
    @enter()
    def load_models(self):
        print("[GPU Initializer] Loading joint audio-video foundation weights...")
        # (Your internal model load cache logic goes here)
        pass

    @method()
    def generate_async(self, prompt: str, duration: int, job_id: str, webhook_url: str):
        filename = f"ltx2-{uuid.uuid4()}.mp4"
        output_path = f"/outputs/{filename}"
        
        try:
          print(f"[LTX Processing] Starting generation loop for Prompt: '{prompt}'")
          
          # -------------------------------------------------------------
          # (GENERATE YOUR LTX VIDEO AND COUPLING FOLEY AUDIO STREAM HERE)
          # For demonstration, we simulate writing a valid generated file:
          # os.system(f"ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d={duration} {output_path}")
          # -------------------------------------------------------------
          
          # Save changes to the shared Modal persistent storage volume
          output_volume.commit()
          
          # Generate the retrieval URL pointing to your get_file web endpoint
          retrieval_url = f"https://cdtfullsail--mvs-ltx-video-get-file.modal.run?filename={filename}"
          
          # Construct the exact payload payload required by server.ts Fastify webhook
          callback_payload = {
              "status": "completed",
              "job_id": job_id,
              "video_url": retrieval_url
          }
          
          print(f"[Webhook Callback] Dispatching success callback to {webhook_url}")
          requests.post(webhook_url, json=callback_payload, timeout=15)
          
        except Exception as e:
          print(f"[Pipeline Error] Generation failed: {str(e)}")
          callback_payload = {
              "status": "failed",
              "job_id": job_id,
              "error": str(e)
          }
          try:
              requests.post(webhook_url, json=callback_payload, timeout=15)
          except Exception as conn_err:
              print(f"Failed to deliver failure callback: {conn_err}")

# Endpoint for Fastify server to trigger asynchronous renders
@app.function()
@web_endpoint(method="POST")
def generate(payload: dict):
    prompt = payload.get("prompt", "Cinematic landscape")
    duration = payload.get("duration", 4)
    job_id = payload.get("job_id")
    webhook_url = payload.get("webhook_url")
    
    if not job_id or not webhook_url:
        return {"error": "Missing tracking context params (job_id, webhook_url)"}, 400
        
    # Trigger background execution immediately on the A100 instance
    LtxPipeline().generate_async.spawn(prompt, duration, job_id, webhook_url)
    return {"status": "processing", "job_id": job_id}, 202

# Endpoint for frontend to fetch the resulting video files from storage
@app.function(volumes={"/outputs": output_volume})
@web_endpoint(method="GET")
def get_file(filename: str):
    from fastapi.responses import FileResponse
    
    file_path = f"/outputs/{filename}"
    if not os.path.exists(file_path):
        return {"error": "File not found"}, 404
        
    return FileResponse(file_path, media_type="video/mp4")