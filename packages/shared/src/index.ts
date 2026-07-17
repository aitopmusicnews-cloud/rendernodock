import { z } from "zod";

// Audio section representation
export const AudioSectionSchema = z.object({
  start: z.number(),
  end: z.number(),
  label: z.string(),
});
export type AudioSection = z.infer<typeof AudioSectionSchema>;

// Audio analysis output representation
export const AudioAnalysisSchema = z.object({
  duration: z.number(),
  bpm: z.number(),
  key: z.string(),
  beats: z.array(z.number()),
  downbeats: z.array(z.number()),
  onsets: z.array(z.number()),
  rmsCurve: z.array(z.number()),
  sections: z.array(AudioSectionSchema),
});
export type AudioAnalysis = z.infer<typeof AudioAnalysisSchema>;
export const AudioAnalysis = AudioAnalysisSchema;

// Individual timeline clip representation
export const ClipSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  source: z.string(), // "continue" | "generated" | "lipSync" | "vocal" | "aleph" | "archetype" | "library" | "textToVideo" etc.
  status: z.enum(["empty", "queued", "generating", "ready", "failed"]),
  generationTaskId: z.string().optional(),
  videoUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  prompt: z.string().optional(),
  imagePrompt: z.string().optional(),
  vocalUrl: z.string().optional(),
  imageUrl: z.string().optional(),
  model: z.string().optional(),
  bridge: z.boolean().optional(),
  archetypeUrl: z.string().optional(),
  lastError: z.string().optional(),
  name: z.string().optional(),
});
export type Clip = z.infer<typeof ClipSchema>;

// Complete persistable project snapshot representation
export const ProjectSnapshotSchema = z.object({
  projectId: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  songId: z.string().nullable().optional(),
  songFilename: z.string().nullable().optional(),
  audioUrl: z.string().nullable().optional(),
  analysis: AudioAnalysisSchema.nullable().optional(),
  clips: z.array(ClipSchema).optional(),
  characterImageUrl: z.string().nullable().optional(),
  avatarId: z.string().nullable().optional(),
  avatarName: z.string().nullable().optional(),
  lookbook: z.array(z.string()).optional(),
  zoom: z.number().optional(),
  playhead: z.number().optional(),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export const ProjectSnapshot = ProjectSnapshotSchema;

// Request validating schemas
export const ImageToVideoRequestSchema = z.object({
  promptImage: z.string().optional(),
  promptImageEnd: z.string().optional(),
  promptText: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().optional(),
  model: z.string().optional(),
});
export type ImageToVideoRequest = z.infer<typeof ImageToVideoRequestSchema>;
export const ImageToVideoRequest = ImageToVideoRequestSchema;

export const VideoToVideoRequestSchema = z.object({
  videoUri: z.string(),
  promptText: z.string().optional(),
  ratio: z.string().optional(),
  model: z.string().optional(),
});
export type VideoToVideoRequest = z.infer<typeof VideoToVideoRequestSchema>;
export const VideoToVideoRequest = VideoToVideoRequestSchema;

export const LipSyncRequestSchema = z.object({
  avatarId: z.string(),
  audioUri: z.string(),
});
export type LipSyncRequest = z.infer<typeof LipSyncRequestSchema>;
export const LipSyncRequest = LipSyncRequestSchema;

export const VoiceIsolationRequestSchema = z.object({
  audioUri: z.string(),
});
export type VoiceIsolationRequest = z.infer<typeof VoiceIsolationRequestSchema>;
export const VoiceIsolationRequest = VoiceIsolationRequestSchema;

export const TextToImageRequestSchema = z.object({
  promptText: z.string(),
  model: z.string().optional(),
  ratio: z.string().optional(),
  referenceImages: z.array(z.object({ uri: z.string() })).optional(),
});
export type TextToImageRequest = z.infer<typeof TextToImageRequestSchema>;
export const TextToImageRequest = TextToImageRequestSchema;

export const TextToVideoRequestSchema = z.object({
  promptText: z.string(),
  model: z.string().optional(),
  ratio: z.string().optional(),
  duration: z.number().optional(),
});
export type TextToVideoRequest = z.infer<typeof TextToVideoRequestSchema>;
export const TextToVideoRequest = TextToVideoRequestSchema;

// GenerationModel string representation
export type GenerationModel = string;

// Task status interface
export interface Task {
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "PROCESSING" | "PENDING";
  error?: string;
  output?: string[];
}

// Avatar summary
export interface AvatarSummary {
  id: string;
  name: string;
  status: string;
  imageUri: string;
  createdAt: string;
}

// Saved image
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

// Library folder representation
export interface LibraryFolder {
  id: string;
  name: string;
  parentId: string | null;
  type: "clips" | "images";
  createdAt: string;
}

// Project metadata
export interface ProjectMeta {
  id: string;
  name: string;
  savedAt: string;
  thumbnailUrl: string | null;
}

// Persisted saved project
export interface SavedProject extends ProjectMeta {
  state: Record<string, unknown>;
  files: string[];
}

// Render library entry
export interface RenderEntry {
  name: string;
  url: string;
  size: number;
  modifiedAt: string;
}

// Saved clip library item
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

// Utility function to convert errors to readable messages
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as any).message);
  return String(err);
}

// Utility function to check if a model supports transition bridging
export function modelSupportsBridge(model: string): boolean {
  return ["seedance2", "gen4_aleph", "veo3.1", "veo3.1_fast", "gen4.5", "gen4_turbo"].includes(model);
}

// Text to image model and ratio types
export type TextToImageModel = string;
export type TextToImageRatio = string;

