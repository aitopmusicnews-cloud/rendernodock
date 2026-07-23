import type {
  AudioAnalysis,
  ImageToVideoRequest,
  LipSyncRequest,
  TextToImageRequest,
  ProjectMeta,
  SavedProject,
  RenderEntry,
  SavedClip,
  SavedImage,
  LibraryFolder,
  Task,
} from "@mvs/shared";
export type { ProjectMeta, SavedProject, RenderEntry, SavedClip, SavedImage, LibraryFolder };

export class ApiError extends Error {
  status: number;
  rateLimited: boolean;
  constructor(status: number, message: string, rateLimited = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let parsed: { error?: string; rateLimited?: boolean } | null = null;
    try { parsed = JSON.parse(text); } catch {}
    const msg = parsed?.error ?? text;
    throw new ApiError(res.status, msg, parsed?.rateLimited === true);
  }
  try {
    return JSON.parse(text) as T;
  } catch (err: any) {
    if (text.trim().startsWith("<!doctype") || text.trim().startsWith("<html") || text.trim().startsWith("<!DOCTYPE")) {
      const sample = text.substring(0, 150).replace(/\s+/g, " ");
      throw new Error(`API returned an HTML page instead of JSON (Status ${res.status}): "${sample}..."`);
    }
    throw new Error(`Invalid JSON response from server (Status ${res.status}): ${err.message}. Response: "${text.substring(0, 150)}..."`);
  }
}

export async function uploadSong(file: File): Promise<{ id: string; audioUrl: string; filename: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/songs/upload", { method: "POST", body: fd }));
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/images/upload", { method: "POST", body: fd }));
}

export async function uploadVideo(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return jsonOrThrow(await fetch("/api/videos/upload", { method: "POST", body: fd }));
}

export async function extractLastFrame(videoUrl: string, time?: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/videos/extract-last-frame", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoUrl, time }),
    })
  );
}

export async function sliceAudio(audioUrl: string, start: number, end: number): Promise<{ url: string }> {
  return jsonOrThrow(
    await fetch("/api/audio/slice", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioUrl, start, end }),
    })
  );
}

export async function getAnalysis(songId: string): Promise<{ status: "pending" | "ready" | "failed"; analysis?: AudioAnalysis; error?: string }> {
  return jsonOrThrow(await fetch(`/api/songs/${songId}/analysis`));
}

export async function pollAnalysis(songId: string, intervalMs = 2000, timeoutMs = 120_000): Promise<AudioAnalysis> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await getAnalysis(songId);
    if (res.status === "ready" && res.analysis) return res.analysis;
    if (res.status === "failed") throw new Error(res.error ?? "analysis failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("analysis timed out");
}

export async function startImageToVideo(req: ImageToVideoRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/image-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startLipSync(req: LipSyncRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/lip-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startTextToImage(req: TextToImageRequest): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function getTask(id: string): Promise<Task> {
  return jsonOrThrow(await fetch(`/api/tasks/${id}`));
}

export async function pollTask(id: string, intervalMs = 2500, timeoutMs = 600_000): Promise<Task> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getTask(id);
    if (t.status === "SUCCEEDED" || t.status === "FAILED" || t.status === "CANCELLED") return t;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("task timed out");
}

export type RenderRequest = {
  projectId: string;
  audioUrl: string;
  duration: number;
  clips: Array<{
    start: number;
    end: number;
    videoUrl: string;
    source?: string;
  }>;
  fades?: boolean;
};

export type RenderJobState = "queued" | "running" | "succeeded" | "failed";

export interface RenderJob {
  id: string;
  state: RenderJobState;
  enqueuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  url: string | null;
  error: string | null;
  queuePosition: number | null;
}

export interface RenderSubmitResponse {
  renderId: string;
  state: RenderJobState;
  queuePosition: number | null;
}

// Avatar API
export interface AvatarSummary {
  id: string;
  name: string;
  status: "PROCESSING" | "READY" | "FAILED";
  failureReason?: string;
  imageUri?: string;
  createdAt: number;
}

export async function createAvatar(imageUrl: string, name: string): Promise<{ avatarId: string; status: "PROCESSING" | "READY" | "FAILED"; failureReason?: string }> {
  return jsonOrThrow(await fetch("/api/avatars/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageUrl, name }),
  }));
}

export async function pollAvatar(avatarId: string, intervalMs = 2000, timeoutMs = 600_000): Promise<AvatarSummary> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await jsonOrThrow<AvatarSummary>(await fetch(`/api/avatars/${avatarId}`));
    if (res.status === "READY" || res.status === "FAILED") return res;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("avatar creation timed out");
}

export async function listAvatars(): Promise<AvatarSummary[]> {
  return jsonOrThrow(await fetch("/api/avatars"));
}

// Video-to-Video and Text-to-Video
export async function startVideoToVideo(req: any): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/video-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

export async function startTextToVideo(req: any): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/generate/text-to-video", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));
}

// Audio processing
export async function ensureVocalStem(audioUrl: string): Promise<{ url: string }> {
  return jsonOrThrow(await fetch("/api/audio/vocal-stem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioUrl }),
  }));
}

// Project API
export async function listProjects(): Promise<ProjectMeta[]> {
  return jsonOrThrow(await fetch("/api/projects"));
}

export async function loadProjectFromServer(id: string): Promise<{ name: string; state: any }> {
  return jsonOrThrow(await fetch(`/api/projects/${id}`));
}

export async function deleteProjectOnServer(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const msg = await res.text();
    throw new ApiError(res.status, msg);
  }
}

export async function saveProject(id: string, name: string, state: any, thumbnailUrl?: string): Promise<{ id: string }> {
  return jsonOrThrow(await fetch("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name, state, thumbnailUrl }),
  }));
}

export async function saveProjectToServer(id: string, name: string, state: any, thumbnailUrl?: string): Promise<{ id: string }> {
  return saveProject(id, name, state, thumbnailUrl);
}

// Clip API
export async function listSavedClips(): Promise<SavedClip[]> {
  return jsonOrThrow(await fetch("/api/clips"));
}

export async function saveClipToServer(clip: Partial<SavedClip>): Promise<SavedClip> {
  const now = new Date().toISOString();
  const body = {
    ...clip,
    savedAt: clip.savedAt || now,
  };
  return jsonOrThrow(await fetch("/api/clips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteClipOnServer(id: string): Promise<void> {
  const res = await fetch(`/api/clips/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const msg = await res.text();
    throw new ApiError(res.status, msg);
  }
}

// Image/Library API
export async function listSavedImages(): Promise<SavedImage[]> {
  return jsonOrThrow(await fetch("/api/images/library"));
}

export async function saveImageToLibrary(image: Partial<SavedImage>): Promise<SavedImage> {
  const now = new Date().toISOString();
  const body = {
    ...image,
    savedAt: image.savedAt || now,
  };
  return jsonOrThrow(await fetch("/api/images/library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteImageFromLibrary(id: string): Promise<void> {
  const res = await fetch(`/api/images/library/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const msg = await res.text();
    throw new ApiError(res.status, msg);
  }
}

// Library Folders API
export async function listLibraryFolders(): Promise<LibraryFolder[]> {
  return jsonOrThrow(await fetch("/api/library/folders"));
}

export async function saveLibraryFolder(folder: Partial<LibraryFolder>): Promise<LibraryFolder> {
  const now = new Date().toISOString();
  const body = {
    ...folder,
    createdAt: folder.createdAt || now,
  };
  return jsonOrThrow(await fetch("/api/library/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

export async function deleteLibraryFolder(id: string): Promise<void> {
  const res = await fetch(`/api/library/folders/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const msg = await res.text();
    throw new ApiError(res.status, msg);
  }
}

// Renders API
export async function listRenders(): Promise<RenderEntry[]> {
  return jsonOrThrow(await fetch("/api/renders"));
}

export async function renderTimeline(
  req: RenderRequest,
  options?: { onUpdate?: (job: RenderJob) => void }
): Promise<{ url: string }> {
  // Submit the render job
  const submitRes = await jsonOrThrow<RenderSubmitResponse>(await fetch("/api/renders/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  }));

  const renderId = submitRes.renderId;
  const pollInterval = 2000;
  const maxWait = 3600_000; // 1 hour
  const start = Date.now();

  // Poll until complete
  while (Date.now() - start < maxWait) {
    const jobRes = await jsonOrThrow<RenderJob>(await fetch(`/api/renders/${renderId}`));
    
    if (options?.onUpdate) {
      options.onUpdate(jobRes);
    }

    if (jobRes.state === "succeeded" && jobRes.url) {
      return { url: jobRes.url };
    }
    if (jobRes.state === "failed") {
      throw new Error(jobRes.error ?? "render failed");
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("render timed out");
}
