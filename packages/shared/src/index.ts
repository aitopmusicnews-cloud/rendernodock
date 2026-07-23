import { z } from "zod";

export const AudioSection = z.object({
  start: z.number(),
  end: z.number(),
  label: z.string(),
});
export type AudioSection = z.infer<typeof AudioSection>;

export const AudioAnalysis = z.object({
  duration: z.number(),
  bpm: z.number(),
  key: z.string(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  onsets: z.array(z.number()),
  rmsCurve: z.array(z.number()),
  sections: z.array(AudioSection),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysis>;

export const Clip = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  source: z.enum(["continue", "archetype", "generated", "textToVideo", "library", "lipSync", "upload"]),
  status: z.enum(["empty", "queued", "generating", "ready", "failed"]),
  prompt: z.string().optional(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  generationTaskId: z.string().optional(),
  model: z.string().optional(),
  referenceImage: z.string().optional(),
  sectionLabel: z.string().optional(),
  archetypeUrl: z.string().optional(),
  bridge: z.boolean().optional(),
  lastError: z.string().optional(),
  imagePrompt: z.string().optional(),
});
export type Clip = z.infer<typeof Clip>;

export const ProjectSnapshot = z.object({
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  songId: z.string().optional(),
  songFilename: z.string().optional(),
  audioUrl: z.string().optional(),
  analysis: AudioAnalysis.optional(),
  clips: z.array(Clip).optional(),
  characterImageUrl: z.string().optional(),
  avatarId: z.string().optional(),
  avatarName: z.string().optional(),
  lookbook: z.array(z.any()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshot>;

export const ImageToVideoRequest = z.object({
  model: z.string(),
  promptImage: z.string(),
  promptImageEnd: z.string().optional(),
  promptText: z.string().optional(),
  ratio: z.string(),
  duration: z.number(),
});
export type ImageToVideoRequest = z.infer<typeof ImageToVideoRequest>;

export const TextToVideoRequest = z.object({
  model: z.string(),
  promptText: z.string(),
  ratio: z.string(),
  duration: z.number(),
});
export type TextToVideoRequest = z.infer<typeof TextToVideoRequest>;

export const TextToImageRequest = z.object({
  model: z.string(),
  promptText: z.string(),
  ratio: z.string(),
});
export type TextToImageRequest = z.infer<typeof TextToImageRequest>;

export const LipSyncRequest = z.object({
  model: z.string().optional(),
  audioUri: z.string(),
  avatarId: z.string(),
  videoUrl: z.string().optional(),
});
export type LipSyncRequest = z.infer<typeof LipSyncRequest>;

export interface AvatarSummary {
  id: string;
  name: string;
  status: "PROCESSING" | "READY" | "FAILED" | "PAUSED" | "UNKNOWN" | string;
  imageUri: string;
  createdAt: string;
}

export interface SavedClip {
  id: string;
  name: string;
  videoUrl: string;
  source: string;
  prompt: string | null;
  duration: number;
  sectionLabel: string | null;
  savedAt: string;
  folderId?: string | null;
  model?: string | null;
  generationTaskId?: string | null;
}

export interface SavedImage {
  id: string;
  name: string;
  url: string;
  source: string;
  prompt: string | null;
  model: string | null;
  savedAt: string;
  folderId?: string | null;
}

export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  type: "clips" | "images";
  createdAt: string;
}

export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: string;
  thumbnailUrl: string | null;
}

export interface SavedProject {
  id: string;
  name: string;
  savedAt: string;
  thumbnailUrl: string | null;
  state: Record<string, unknown>;
  files: string[];
}

export interface RenderEntry {
  name: string;
  url: string;
  size: number;
  modifiedAt: string;
}

export interface Task {
  id: string;
  status: string;
  createdAt: string;
  progress?: number;
  output?: string[] | string | null;
  error?: string;
  errorCode?: string;
}

export type GenerationModel = "ltx-video" | string;
export type TextToImageModel = "sdxl-modal" | string;
export type TextToImageRatio = string;

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export function modelSupportsBridge(model: string): boolean {
  return false;
}

export function formatModelName(model?: string | null): string {
  if (!model) return "";
  const mapping: Record<string, string> = {
    "ltx-video": "⚡ LTX Video (Modal Cloud)",
    "sdxl-modal": "⚡ Stable Diffusion XL (Modal Cloud)",
  };
  return mapping[model] ?? model;
}

export function getProviderFromTaskId(taskId?: string | null): string {
  if (!taskId) return "";
  try {
    const base64 = taskId.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = typeof atob === "function" 
      ? atob(base64) 
      : (globalThis as any).Buffer.from(base64, "base64").toString("utf8");
    const parsed = JSON.parse(jsonStr);
    if (parsed && parsed.source) {
      if (parsed.source === "modal") return "Modal GPU Compute Cluster";
      return String(parsed.source);
    }
  } catch (e) {}
  return "Modal Cloud Workflow";
}
