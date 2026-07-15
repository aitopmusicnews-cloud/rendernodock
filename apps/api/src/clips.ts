import { z } from "zod";
import { join } from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { generateProceduralAsset } from "./openrouter.js";

// Validation Schema matching our workspace shared parameters
export const ClipSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  videoUrl: z.string().url().optional().nullable(),
  source: z.string(),
  prompt: z.string().nullable().optional(),
  duration: z.number().positive(),
  sectionLabel: z.string().nullable().optional(),
  folderId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  generationTaskId: z.string().nullable().optional(),
});

export type ClipRecord = z.infer<typeof ClipSchema>;

const getClipsFilePath = () => join(config.STORAGE_DIR, "clips_library.json");

// Persistent local JSON file database initialization for metadata assets
async function readLibrary(): Promise<ClipRecord[]> {
  const filePath = getClipsFilePath();
  if (!existsSync(filePath)) return [];
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as ClipRecord[];
  } catch (err) {
    console.error("[Clips DB Error] Failed to read clips library file:", err);
    return [];
  }
}

async function writeLibrary(clips: ClipRecord[]): Promise<void> {
  const filePath = getClipsFilePath();
  await writeFile(filePath, JSON.stringify(clips, null, 2), "utf8");
}

export async function listClips(): Promise<ClipRecord[]> {
  return await readLibrary();
}

export async function saveClip(clip: ClipRecord): Promise<ClipRecord> {
  const library = await readLibrary();
  const existingIdx = library.findIndex((c) => c.id === clip.id);

  if (existingIdx !== -1) {
    library[existingIdx] = clip;
  } else {
    library.push(clip);
  }

  await writeLibrary(library);
  return clip;
}

export async function deleteClip(id: string): Promise<boolean> {
  const library = await readLibrary();
  const filtered = library.filter((c) => c.id !== id);
  
  if (filtered.length === library.length) return false;
  
  await writeLibrary(filtered);
  return true;
}

/**
 * High-Motion LTX-Video Native Generator Pipeline with Pre-flight Check & Fallbacks
 */
export async function generateLTXVideo(prompt: string, duration: number): Promise<string> {
  const MODAL_PING_URL = "https://cdtfullsail--mvs-ltx-video-generate.modal.run/health";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000); // Strict 4-second warm ping limit

  console.log(`[GPU Pre-flight] Checking serverless cluster health status...`);

  let isClusterWarm = false;
  try {
    const pingResponse = await fetch(MODAL_PING_URL, {
      method: "GET",
      signal: controller.signal,
    });
    if (pingResponse.ok) {
      isClusterWarm = true;
      console.log("[GPU Warm] Serverless cluster is active and accepting incoming jobs.");
    }
  } catch (err: any) {
    console.warn(`[GPU Warning] Cluster warm check timed out or failed. Code: ${err.name}`);
  } finally {
    clearTimeout(timeoutId);
  }

  // Fallback Branch: If Modal is unresponsive or undergoing cold start, fall back immediately
  if (!isClusterWarm) {
    console.warn(
      `[Pipeline Fallback] Modal cluster is cold or scaling up. Triggering immediate high-fidelity procedural generation...`
    );
    try {
      const fallbackUrl = await generateProceduralAsset(
        `[LTX Fallback Engine] Generating visual storyboard concept: ${prompt}`,
        "video"
      );
      return fallbackUrl;
    } catch (fallbackErr: any) {
      console.error("[Pipeline Error] Double fault occurred during procedural generation:", fallbackErr);
      throw new Error("Unable to complete pipeline rendering because both Modal and Procedural fallbacks errored.");
    }
  }

  // Active Branch: Issue render call to ready Modal GPU
  console.log("[Pipeline Success] Triggering native A100 GPU video run.");
  const renderResponse = await fetch("https://cdtfullsail--mvs-ltx-video-generate.modal.run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      duration,
    }),
  });

  if (!renderResponse.ok) {
    const errorText = await renderResponse.text().catch(() => "");
    throw new Error(`Modal rendering cluster returned execution code: ${renderResponse.status} - ${errorText}`);
  }

  const result = await renderResponse.json() as any;
  if (!result.video_url) {
    throw new Error("Modal execution returned a success code but did not present a retrieval address.");
  }

  return result.video_url;
}