import type {
  ImageToVideoRequest,
  VideoToVideoRequest,
  LipSyncRequest,
  VoiceIsolationRequest,
  TextToImageRequest,
  TextToVideoRequest,
} from "@mvs/shared";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { extname, basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import sharp from "sharp";
import { config } from "./config.js";
import { resolveLocalPath, mimeType } from "./paths.js";
import { runFfmpeg } from "./ffmpeg.js";
import { storage } from "./storage.js";

export interface JobRecord {
  status: 'pending' | 'completed' | 'failed';
  video_url?: string;
  error?: string;
  prompt: string;
  createdAt: number;
}

const MODAL_ENDPOINT_URL = config.MODAL_LTX_URL || 'https://cdtfullsail--mvs-ltx-video-generate.modal.run';
const PUBLIC_API_URL = config.PUBLIC_BASE_URL || 'http://localhost:3001';

/**
 * File-backed Persistent Database Helpers
 */
const getJobsDir = () => join(config.STORAGE_DIR, "jobs");

async function ensureJobsDir() {
  await mkdir(getJobsDir(), { recursive: true }).catch(() => {});
}

export async function writeJobToDisk(jobId: string, record: JobRecord): Promise<void> {
  await ensureJobsDir();
  const filePath = join(getJobsDir(), `${jobId}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");
}

export async function readJobFromDisk(jobId: string): Promise<JobRecord | null> {
  const filePath = join(getJobsDir(), `${jobId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as JobRecord;
  } catch (err) {
    console.error(`[DB Error] Failed to read job ${jobId} from file:`, err);
    return null;
  }
}

// OpenRouter LLM Helper
export async function callOpenRouter(prompt: string, systemInstruction?: string, maxTokens: number = 3000): Promise<string> {
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "missing-OPENROUTER_API_KEY") {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  let model = config.OPENROUTER_MODEL || "google/gemini-2.5-flash";
  if (model === "openrouter/free") model = "google/gemini-2.5-flash";
  if (model.endsWith(":free")) model = model.replace(":free", "");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": config.PUBLIC_BASE_URL || "http://localhost:3001",
      "X-Title": "Music Video Studio",
    },
    body: JSON.stringify({
      model: model,
      messages: [
        ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenRouter API failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Invalid or empty response from OpenRouter`);
  }

  return content.trim();
}

/**
 * Clean up SVG namespaces so sharp/librsvg rasterization never crashes.
 */
function fixSvgXmlns(svg: string): string {
  let out = svg;
  out = out.replace(
    /(xmlns(:[a-zA-Z0-9_-]+)?\s*=\s*")\[([^\]]+)\]\(([^)]+)\)(")/g,
    (_m, open, _ns, _label, uri, close) => `${open}${uri}${close}`
  );
  if (!/xmlns\s*=/.test(out)) {
    out = out.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  return out;
}

export async function generateSvgWithOpenRouter(prompt: string): Promise<string | null> {
  if (!config.OPENROUTER_API_KEY || config.OPENROUTER_API_KEY === "missing-OPENROUTER_API_KEY") {
    return null;
  }
  try {
    const systemPrompt = `You are an elite professional generative SVG visual artist.
Output ONLY valid, raw, standard SVG code starting with <svg and ending with </svg>. No markdown wraps.`;

    const rawResponse = await callOpenRouter(prompt, systemPrompt, 3000);
    let cleaned = rawResponse.trim();
    
    const svgStartIdx = cleaned.indexOf("<svg");
    const svgEndIdx = cleaned.lastIndexOf("</svg>");
    if (svgStartIdx !== -1 && svgEndIdx !== -1 && svgEndIdx > svgStartIdx) {
      cleaned = cleaned.substring(svgStartIdx, svgEndIdx + 6);
      return cleaned;
    }
    return null;
  } catch (err) {
    return null;
  }
}

// Procedural Fallback Asset Generator
export async function generateProceduralAsset(prompt: string, type: "image" | "video"): Promise<string> {
  const customSvg = await generateSvgWithOpenRouter(prompt);
  let pngBuffer: Buffer | null = null;

  if (customSvg) {
    try {
      pngBuffer = await sharp(Buffer.from(fixSvgXmlns(customSvg))).png().toBuffer();
    } catch (err) {
      console.log("[Procedural SVG] Fallback to standard layout.");
    }
  }

  if (!pngBuffer) {
    const cleanPrompt = prompt.replace(/[<>&"]/g, "").substring(0, 75).toUpperCase();
    const svg = `
      <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg">
        <rect width="1280" height="720" fill="#090a0f" />
        <rect x="30" y="30" width="1220" height="660" fill="none" stroke="#10b981" stroke-width="1" opacity="0.15"/>
        <text x="60" y="650" font-family="monospace" font-size="13" fill="#10b981">STORYBOARD FALLBACK DIRECTIVE</text>
        <text x="60" y="670" font-family="monospace" font-size="11" fill="#94a3b8">PROMPT: ${cleanPrompt}</text>
      </svg>
    `;
    pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  }

  const filename = `procedural_${Date.now()}.png`;
  const { publicUrl, id } = await storage.saveUpload(pngBuffer, filename, "image/png");

  if (type === "image") return publicUrl;

  const localUploadsDir = join(config.STORAGE_DIR, "uploads");
  await mkdir(localUploadsDir, { recursive: true }).catch(() => {});

  const localImgPath = join(localUploadsDir, `${id}.png`);
  await writeFile(localImgPath, pngBuffer);

  const videoName = `procedural_${id}.mp4`;
  const localVideoPath = join(localUploadsDir, videoName);

  await runFfmpeg([
    "-y", "-loop", "1", "-i", localImgPath,
    "-vf", "zoompan=z='zoom+0.0004':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1280x720",
    "-c:v", "libx264", "-t", "5", "-pix_fmt", "yuv420p", localVideoPath
  ]);

  let finalVideoUrl: string;
  if (config.STORAGE_BACKEND === "s3") {
    const videoBuf = await readFile(localVideoPath);
    const uploaded = await storage.saveUpload(videoBuf, videoName, "video/mp4");
    finalVideoUrl = uploaded.publicUrl;
    await unlink(localImgPath).catch(() => {});
    await unlink(localVideoPath).catch(() => {});
  } else {
    finalVideoUrl = `/storage/uploads/${videoName}`;
  }
  return finalVideoUrl;
}

export type OpenRouterTask = { id: string };

interface TaskIdPayload {
  source: "openrouter" | "procedural" | "fal";
  id: string;
}

function encodeTaskId(payload: TaskIdPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeTaskId(encoded: string): TaskIdPayload {
  try {
    const str = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(str);
    if (parsed && parsed.id) return parsed;
  } catch (e) {}
  return { source: "procedural", id: encoded };
}

// Asynchronous Image-to-Video Entrypoint
export async function imageToVideo(req: ImageToVideoRequest): Promise<OpenRouterTask> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  let promptToUse = req.promptText ?? "";
  const enableAudio = (req as any).enableAudio !== false;

  if (!enableAudio) {
    promptToUse = `${promptToUse} (completely silent, no background sound, quiet, mute)`;
  }

  // PERSISTED: Write pending record to file system storage
  await writeJobToDisk(jobId, { status: 'pending', prompt: promptToUse, createdAt: Date.now() });

  const webhookUrl = `${PUBLIC_API_URL}/api/openrouter/webhook`;
  const modalPayload = {
    prompt: promptToUse,
    duration: req.duration ?? 4,
    init_image_url: req.promptImage,
    webhook_url: webhookUrl,
    job_id: jobId
  };

  console.log(`[API Async] Dispatching Image-to-Video Job ID: ${jobId} to Modal`);

  fetch(MODAL_ENDPOINT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(modalPayload)
  }).catch(async (err) => {
    console.error(`[API Trigger Error] Falling back to procedural output:`, err.message);
    const videoUrl = await generateProceduralAsset(promptToUse, "video");
    await writeJobToDisk(jobId, { status: 'completed', video_url: videoUrl, prompt: promptToUse, createdAt: Date.now() });
  });

  return { id: encodeTaskId({ source: "procedural", id: jobId }) };
}

// Asynchronous Text-to-Video Entrypoint
export async function textToVideo(req: TextToVideoRequest): Promise<OpenRouterTask> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  let promptToUse = req.promptText ?? "";
  const enableAudio = (req as any).enableAudio !== false;

  if (!enableAudio) {
    promptToUse = `${promptToUse} (completely silent, no background sound, quiet, mute)`;
  }

  // PERSISTED: Write pending record to file system storage
  await writeJobToDisk(jobId, { status: 'pending', prompt: promptToUse, createdAt: Date.now() });

  const webhookUrl = `${PUBLIC_API_URL}/api/openrouter/webhook`;
  const modalPayload = {
    prompt: promptToUse,
    duration: req.duration ?? 4,
    webhook_url: webhookUrl,
    job_id: jobId
  };

  console.log(`[API Async] Dispatching Text-to-Video Job ID: ${jobId} to Modal`);

  fetch(MODAL_ENDPOINT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(modalPayload)
  }).catch(async (err) => {
    console.error(`[API Trigger Error] Falling back to procedural output:`, err.message);
    const videoUrl = await generateProceduralAsset(promptToUse, "video");
    await writeJobToDisk(jobId, { status: 'completed', video_url: videoUrl, prompt: promptToUse, createdAt: Date.now() });
  });

  return { id: encodeTaskId({ source: "procedural", id: jobId }) };
}

export async function videoToVideo(req: VideoToVideoRequest): Promise<OpenRouterTask> {
  const videoUrl = await generateProceduralAsset(req.promptText ?? "", "video");
  return { id: encodeTaskId({ source: "openrouter", id: videoUrl }) };
}

export async function textToImage(req: TextToImageRequest): Promise<OpenRouterTask> {
  const imageUrl = await generateProceduralAsset(req.promptText, "image");
  return { id: encodeTaskId({ source: "openrouter", id: imageUrl }) };
}

import type { AvatarSummary } from "@mvs/shared";
export type { AvatarSummary };

export async function listAvatars(): Promise<AvatarSummary[]> {
  return [
    {
      id: "victoria",
      name: "Victoria (Chrome Neo-Noir)",
      status: "READY",
      imageUri: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80",
      createdAt: new Date().toISOString(),
    },
    {
      id: "obsidian",
      name: "Obsidian (Cyber-Organic)",
      status: "READY",
      imageUri: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80",
      createdAt: new Date().toISOString(),
    },
    {
      id: "silver",
      name: "Silver (Minimalist)",
      status: "READY",
      imageUri: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80",
      createdAt: new Date().toISOString(),
    },
  ];
}

export type AvatarSubmitResult = {
  avatarId: string;
  status: "PROCESSING" | "READY" | "FAILED";
  failureReason?: string | null;
};

export async function createAvatar(imageUrl: string, name: string): Promise<AvatarSubmitResult> {
  return { avatarId: `custom-${Date.now()}`, status: "READY" };
}

export async function getAvatar(id: string): Promise<AvatarSubmitResult> {
  return { avatarId: id, status: "READY" };
}

export async function lipSync(req: LipSyncRequest): Promise<OpenRouterTask> {
  const videoUrl = await generateProceduralAsset(`Lip Sync: ${req.avatarId}`, "video");
  return { id: encodeTaskId({ source: "procedural", id: videoUrl }) };
}

export async function voiceIsolation(req: VoiceIsolationRequest): Promise<OpenRouterTask> {
  return { id: encodeTaskId({ source: "procedural", id: req.audioUri }) };
}

export interface TaskResult {
  id: string;
  status: string;
  createdAt: string;
  output?: string[];
  failure?: string | null;
  failureCode?: string | null;
}

// Intercept Task Polling Checks
export async function getTask(encodedId: string): Promise<TaskResult> {
  const { source, id } = decodeTaskId(encodedId);

  if (id.startsWith("job_")) {
    // PERSISTED: Read directly from local JSON disk layer rather than volatile RAM
    const activeJob = await readJobFromDisk(id);
    if (activeJob) {
      if (activeJob.status === 'completed' && activeJob.video_url) {
        return {
          id: encodedId,
          status: "SUCCEEDED",
          createdAt: new Date(activeJob.createdAt).toISOString(),
          output: [activeJob.video_url],
        };
      }
      if (activeJob.status === 'failed') {
        return {
          id: encodedId,
          status: "FAILED",
          createdAt: new Date(activeJob.createdAt).toISOString(),
          failure: activeJob.error || "Inference failed on serverless GPU node."
        };
      }
      return {
        id: encodedId,
        status: "PROCESSING",
        createdAt: new Date(activeJob.createdAt).toISOString()
      };
    }
  }

  return {
    id: encodedId,
    status: "SUCCEEDED",
    createdAt: new Date().toISOString(),
    output: [id],
  };
}

export async function deleteTask(encodedId: string) {
  const { id } = decodeTaskId(encodedId);
  if (id.startsWith("job_")) {
    const filePath = join(getJobsDir(), `${id}.json`);
    await unlink(filePath).catch(() => {});
  }
}