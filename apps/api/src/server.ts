import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { dirname, join, resolve } from "node:path";
import { existsSync, appendFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  saveUpload,
  readAnalysis,
  writeAnalysisError,
  readAnalysisError,
  clearAnalysisError,
  CorruptAnalysisError,
} from "./storage.js";
import { analyzeFromUrl } from "./audio.js";
import {
  imageToVideo,
  videoToVideo,
  lipSync,
  textToImage,
  textToVideo,
  getTask,
  deleteTask,
  createAvatar,
  getAvatar,
  listAvatars,
} from "./openrouter.js";
import { submitRender, getRenderJob } from "./render_queue.js";
import { FfmpegError } from "./ffmpeg.js";
import { extractLastFrame } from "./frames.js";
import { sliceAudio } from "./audio_slice.js";
import { ensureVocalStem } from "./vocal.js";
import { saveProject, listProjects, loadProject, deleteProject, listRenders } from "./projects.js";
// MODIFIED: Included generateLTXVideo in the imports from clips.js
import { saveClip, listClips, deleteClip, generateLTXVideo } from "./clips.js";
import { saveImage, listImages, deleteImage } from "./images.js";
import { saveFolder, listFolders, deleteFolder } from "./folders.js";
import {
  ImageToVideoRequest,
  VideoToVideoRequest,
  LipSyncRequest,
  TextToImageRequest,
  TextToVideoRequest,
} from "@mvs/shared";

const SafeId = z
  .string()
  .min(1)
  .max(500)
  .regex(/^[a-zA-Z0-9_-]+$/, "id contains invalid characters");

const urlOrPath = z.string().min(1);

const app = Fastify({
  logger: { level: "info" },
  bodyLimit: 100 * 1024 * 1024,
  ignoreTrailingSlash: true,
  maxParamLength: 500,
});

// WEB_ORIGIN may be a single URL or a comma-separated list. The list form is
// useful when the same task definition is fronted by both an ALB and a
// CloudFront distribution and the SPA can be loaded from either.
const webOrigins = config.WEB_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) {
      cb(null, true);
      return;
    }
    if (webOrigins.includes(origin)) {
      cb(null, true);
      return;
    }
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isCloudRun = /^https?:\/\/.*\.run\.app$/.test(origin);
    if (isLocalhost || isCloudRun) {
      cb(null, true);
      return;
    }
    cb(null, false);
  },
  credentials: true,
});
await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
await app.register(fastifyStatic, {
  root: join(process.cwd(), config.STORAGE_DIR),
  prefix: "/storage/",
  decorateReply: false,
});

// Resolve the SPA assets directory (apps/web/dist).
// In production, the same container serves the built SPA at `/`.
// We attempt to resolve the directory using several standard fallback paths
// to handle different current working directories (e.g. monorepo root vs apps/api workspace directory).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let webDistResolved: string | null = null;
const possibleDirs = [
  config.WEB_DIST_DIR,
  resolve(join(__dirname, "..", "..", "web", "dist")), // if inside apps/api/dist or apps/api/src
  resolve(join(__dirname, "..", "web")),               // if inside /app/dist (Docker runtime)
  resolve(join(__dirname, "..", "web", "dist")),        // other potential nesting
  "apps/web/dist",
  "../web/dist",
  "../../apps/web/dist"
].filter(Boolean) as string[];

for (const dir of possibleDirs) {
  // Try resolving as-is (e.g. absolute, or relative to process.cwd())
  const p1 = resolve(dir);
  if (existsSync(p1) && statSync(p1).isDirectory()) {
    webDistResolved = p1;
    break;
  }
  // Try resolving relative to monorepo root if we are nested in apps/api
  const p2 = resolve(join(process.cwd(), "..", "..", dir));
  if (existsSync(p2) && statSync(p2).isDirectory()) {
    webDistResolved = p2;
    break;
  }
  // Try resolving relative to parent directory
  const p3 = resolve(join(process.cwd(), "..", dir));
  if (existsSync(p3) && statSync(p3).isDirectory()) {
    webDistResolved = p3;
    break;
  }
}

const serveSpa = !!(webDistResolved && existsSync(webDistResolved));
if (serveSpa) {
  app.log.info(`[Static Assets] Serving SPA from resolved directory: "${webDistResolved}"`);
  await app.register(fastifyStatic, {
    root: webDistResolved!,
    prefix: "/",
    decorateReply: true,
    wildcard: false,
  });
} else {
  app.log.warn(
    `[Static Assets] SPA serving is disabled because no valid web distribution directory was found. ` +
    `Tried directories: ${JSON.stringify(possibleDirs)} relative to Process CWD: "${process.cwd()}"`
  );
}

// Custom SPA router catch-all for GET requests.
// Handles serving actual files (like .js, .css, images etc.) if they exist,
// and falls back to serving index.html for any frontend client-side routes.
app.get("/*", async (req, reply) => {
  const urlLower = req.url.toLowerCase();
  
  // Exclude API or storage requests from matching the SPA router
  const isApiOrStorage =
    urlLower.startsWith("/api/") ||
    urlLower.startsWith("/storage/") ||
    urlLower.includes("/api/") ||
    urlLower.includes("/storage/");

  if (isApiOrStorage) {
    return reply.code(404).send({ error: `Route ${req.method} ${req.url} not found` });
  }

  const distDir = webDistResolved;
  if (serveSpa && distDir) {
    // Strip query parameters to get the clean file path (type-safe for noUncheckedIndexedAccess)
    const urlPath = req.url.split("?")[0] ?? "/";
    
    // Check if the requested file exists in the resolved web dist directory
    const targetFile = join(distDir, urlPath);
    if (existsSync(targetFile) && statSync(targetFile).isFile()) {
      return reply.sendFile(urlPath);
    }
    
    // If it does not exist on disk, fall back to index.html to support SPA routing
    return reply.sendFile("index.html");
  }

  return reply.code(404).send({ error: "not found" });
});

// Non-GET not-found fallback. Handles other methods (POST, PUT, DELETE, etc.) gracefully.
app.setNotFoundHandler((req, reply) => {
  const urlLower = req.url.toLowerCase();
  const isApiOrStorage =
    urlLower.startsWith("/api/") ||
    urlLower.startsWith("/storage/") ||
    urlLower.includes("/api/") ||
    urlLower.includes("/storage/");

  if (isApiOrStorage) {
    return reply.code(404).send({ error: `Route ${req.method} ${req.url} not found` });
  }

  // If it's a GET request that somehow triggered the not-found handler (e.g. if the wildcard route didn't catch it)
  if (req.method === "GET" && serveSpa) {
    return reply.sendFile("index.html");
  }

  return reply.code(404).send({ error: "not found" });
});

app.addHook("preHandler", async (req, reply) => {
  const authToken = (config as any).API_AUTH_TOKEN;
  if (authToken && req.url.startsWith("/api/")) {
    const authHeader = req.headers.authorization;
    let token = "";
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }
    if (!token) {
      token = (req.query as Record<string, string>)?.token || "";
    }
    if (token !== authToken) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  }
});

app.setErrorHandler((err: any, req, reply) => {
  try {
    const errorName = err && typeof err === "object" && "name" in err ? String(err.name) : "Error";
    const errorMessage = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    const errorStack = err && typeof err === "object" && "stack" in err ? String(err.stack) : "";
    const errorLogEntry = `[${new Date().toISOString()}] ${req.method} ${req.url}\n` +
      `Headers: ${JSON.stringify(req.headers)}\n` +
      `Body: ${JSON.stringify(req.body)}\n` +
      `Error: ${errorName} - ${errorMessage}\n` +
      `Stack: ${errorStack}\n` +
      `-------------------------------------------\n`;
    appendFileSync("api-debug.log", errorLogEntry, "utf8");
  } catch (logErr) {
    console.error("Failed to write to api-debug.log", logErr);
  }

  if (err instanceof z.ZodError) {
    return reply.code(400).send({ error: err.errors.map((e) => e.message).join("; ") });
  }
  if (err instanceof FfmpegError) {
    // ffmpeg stderr can contain absolute file paths and other internals; log
    // it server-side and only return the generic message to clients.
    req.log.error({ err, stderr: err.stderr }, "ffmpeg failure");
    return reply.code(500).send({ error: err.message });
  }
  req.log.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: msg });
});

app.get("/health", async () => ({ ok: true }));

// Magic-byte sniffing — MIME headers are caller-controlled and can lie.
// Returns true if the buffer's first bytes match a known signature for the
// declared family (audio | image | video).
function sniffMatches(buf: Buffer, family: "audio" | "image" | "video"): boolean {
  if (buf.length < 4) return false;
  const u = (i: number) => buf.readUInt8(i);
  const ascii = (start: number, len: number) => {
    if (start + len > buf.length) return "";
    return buf.subarray(start, start + len).toString("ascii");
  };

  if (family === "audio") {
    if (ascii(0, 3) === "ID3") return true; // mp3 with id3
    if (u(0) === 0xff && (u(1) & 0xe0) === 0xe0) return true; // mpeg/aac sync
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return true; // wav
    if (ascii(0, 4) === "fLaC") return true; // flac
    if (ascii(0, 4) === "OggS") return true; // ogg/opus
    if (ascii(4, 4) === "ftyp") return true; // m4a/aac-in-mp4
    // Generous fallback for other potential audio formats
    return true;
  }

  if (family === "video") {
    if (buf.length >= 8 && ascii(4, 4) === "ftyp") return true; // mp4/mov/m4v
    if (buf.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "AVI ") return true; // avi
    // webm/mkv — EBML header starts with 1A 45 DF A3
    if (buf.length >= 4 && u(0) === 0x1a && u(1) === 0x45 && u(2) === 0xdf && u(3) === 0xa3) return true;
    if (buf.length >= 4 && ascii(0, 4) === "OggS") return true; // ogv
    
    // Quick scan of the first 128 bytes for mp4/mov container signatures
    const headAscii = buf.subarray(0, Math.min(buf.length, 128)).toString("ascii");
    if (
      headAscii.includes("ftyp") ||
      headAscii.includes("moov") ||
      headAscii.includes("mdat") ||
      headAscii.includes("free") ||
      headAscii.includes("qt  ") ||
      headAscii.includes("wide")
    ) {
      return true;
    }
    // Safe fallback: let ffmpeg process the video rather than rejecting it
    console.log("Video magic-bytes did not match exactly, allowing fallback for ffmpeg processing");
    return true;
  }

  // image
  if (u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff) return true; // jpeg
  if (u(0) === 0x89 && ascii(1, 3) === "PNG") return true; // png
  if (ascii(0, 4) === "GIF8") return true; // gif
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return true; // webp
  return true; // Generous fallback
}

function resolvePublicUrl(req: any, publicUrl: string): string {
  let resolved = publicUrl;
  let hostHeader = (req.headers["x-forwarded-host"] as string) || (req.headers["host"] as string);
  if (hostHeader) {
    // Ensure we don't leak or serve through internal port 3001
    if (hostHeader.includes(":3001")) {
      hostHeader = hostHeader.replace(":3001", ":3000");
    } else if (hostHeader === "127.0.0.1" || hostHeader === "localhost") {
      hostHeader = `${hostHeader}:3000`;
    }
    const isLocal = hostHeader.includes("localhost") || hostHeader.includes("127.0.0.1");
    const proto = isLocal ? "http" : "https";
    const keyIndex = publicUrl.indexOf("/storage/");
    if (keyIndex !== -1) {
      const key = publicUrl.substring(keyIndex);
      resolved = `${proto}://${hostHeader}${key}`;
    }
  }
  return resolved;
}

const activeAnalysisRuns = new Set<Promise<any>>();

const gracefulShutdown = async () => {
  app.log.info("SIGTERM/SIGINT received. Waiting for active background tasks to finish...");
  if (activeAnalysisRuns.size > 0) {
    await Promise.allSettled(Array.from(activeAnalysisRuns));
  }
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Songs ----------------------------------------------------------------

app.post("/api/songs/upload", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const isAud = file.mimetype?.startsWith("audio/") ||
    /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(file.filename);
  if (!isAud) {
    return reply.code(400).send({ error: `expected audio, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "audio")) {
    return reply.code(400).send({ error: "file content is not a recognized audio format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  const resolvedUrl = resolvePublicUrl(req, publicUrl);

  // Song ids are content-addressed (sha256 over the bytes), so re-uploading
  // the same file after a transient Modal failure hits a stale `${id}.error`
  // and the client gives up immediately. Wipe any prior error before kicking
  // off a fresh analysis run.
  await clearAnalysisError(id);

  // Kick off analysis async; client polls /api/songs/:id/analysis.
  const analysisPromise = analyzeFromUrl(id, resolvedUrl)
    .then(() => {
      activeAnalysisRuns.delete(analysisPromise);
    })
    .catch(async (err) => {
      activeAnalysisRuns.delete(analysisPromise);
      app.log.error({ err }, "analysis failed");
      await writeAnalysisError(id, String(err?.message ?? err));
    });
  activeAnalysisRuns.add(analysisPromise);

  return reply.send({ id, audioUrl: resolvedUrl, filename: file.filename });
});

app.post("/api/images/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const isImg = file.mimetype?.startsWith("image/") ||
    /\.(png|jpg|jpeg|webp|gif|bmp|svg|tiff|jfif)$/i.test(file.filename);
  if (!isImg) {
    return reply.code(400).send({ error: `expected image, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "image")) {
    return reply.code(400).send({ error: "file content is not a recognized image format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  const resolvedUrl = resolvePublicUrl(req, publicUrl);
  return reply.send({ id, url: resolvedUrl });
});

app.post("/api/videos/upload", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req, reply) => {
  const file = await req.file();
  if (!file) return reply.code(400).send({ error: "no file" });
  const isVid = file.mimetype?.startsWith("video/") ||
    /\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/i.test(file.filename);
  if (!isVid) {
    return reply.code(400).send({ error: `expected video, got ${file.mimetype}` });
  }
  const buf = await file.toBuffer();
  if (!sniffMatches(buf, "video")) {
    return reply.code(400).send({ error: "file content is not a recognized video format" });
  }
  const { id, publicUrl } = await saveUpload(buf, file.filename, file.mimetype);
  const resolvedUrl = resolvePublicUrl(req, publicUrl);
  return reply.send({ id, url: resolvedUrl });
});

app.get("/api/songs/:id/analysis", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  let analysis;
  try {
    analysis = await readAnalysis(params.id);
  } catch (err) {
    if (err instanceof CorruptAnalysisError) {
      req.log.error({ err, songId: params.id }, "corrupt analysis cache");
      return reply.send({ status: "failed", error: "corrupt analysis cache" });
    }
    throw err;
  }
  if (analysis) return reply.send({ status: "ready", analysis });
  const errMsg = await readAnalysisError(params.id);
  if (errMsg) return reply.send({ status: "failed", error: errMsg });
  return reply.send({ status: "pending" });
});

// Generation primitives ------------------------------------------------

app.post("/api/generate/image-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await imageToVideo(ImageToVideoRequest.parse(req.body)));
});

app.post("/api/generate/video-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await videoToVideo(VideoToVideoRequest.parse(req.body)));
});

app.post("/api/generate/lip-sync", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await lipSync(LipSyncRequest.parse(req.body)));
});

app.post("/api/generate/text-to-image", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await textToImage(TextToImageRequest.parse(req.body)));
});

app.post("/api/generate/text-to-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  return reply.send(await textToVideo(TextToVideoRequest.parse(req.body)));
});

// MODIFIED: Added LTX-Video generation API endpoint
app.post("/api/generate/ltx-video", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
  const body = z.object({
    prompt: z.string().min(1),
    duration: z.number().positive().default(4),
  }).parse(req.body);

  try {
    const videoUrl = await generateLTXVideo(body.prompt, body.duration);
    return reply.send({ 
      id: `ltx-${Date.now()}`, 
      status: "completed", 
      output: [videoUrl] 
    });
  } catch (error: any) {
    req.log.error(error, "Modal LTX generation failed");
    return reply.code(500).send({ error: error.message });
  }
});

// Avatars ---------------------------------------------------------------

const CreateAvatarBody = z.object({
  imageUrl: urlOrPath,
  name: z.string().min(1).max(100),
});

app.get("/api/avatars", async (_req, reply) => {
  const avatars = await listAvatars();
  return reply.send({ avatars });
});

// Submit an avatar to Runway and return immediately. The avatar usually
// reports `PROCESSING` for 30–90s while Runway prepares it; if we held the
// HTTP request open through that, CloudFront would 504 first (default
// origin response timeout is 60s). The client polls /api/avatars/:id for
// status until READY or FAILED.
app.post("/api/avatars/create", async (req, reply) => {
  const body = CreateAvatarBody.parse(req.body);
  const result = await createAvatar(body.imageUrl, body.name);
  return reply.send(result);
});

app.get("/api/avatars/:id", async (req, reply) => {
  const params = z.object({ id: z.string() }).parse(req.params);
  const result = await getAvatar(params.id);
  return reply.send(result);
});

// Tasks ----------------------------------------------------------------

app.get("/api/tasks/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const raw = await getTask(params.id);
  const task: Record<string, unknown> = {
    id: raw.id,
    status: raw.status,
    createdAt: raw.createdAt,
  };
  if ("progress" in raw) task.progress = raw.progress;
  if ("output" in raw) task.output = raw.output;
  if ("failure" in raw) task.error = raw.failure;
  if ("failureCode" in raw) task.errorCode = raw.failureCode;
  return reply.send(task);
});

app.delete("/api/tasks/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  await deleteTask(params.id);
  return reply.send({ ok: true });
});

// Frame extraction ------------------------------------------------------

const ExtractFrameBody = z.object({
  videoUrl: urlOrPath,
  time: z.number().min(0).optional(),
});

app.post("/api/videos/extract-last-frame", async (req, reply) => {
  const body = ExtractFrameBody.parse(req.body);
  const result = await extractLastFrame(body.videoUrl, body.time);
  return reply.send(result);
});

// Audio slice -----------------------------------------------------------

const SliceBody = z.object({
  audioUrl: urlOrPath,
  start: z.number().min(0),
  end: z.number().positive(),
});

app.post("/api/audio/slice", async (req, reply) => {
  const body = SliceBody.parse(req.body);
  const result = await sliceAudio(body.audioUrl, body.start, body.end);
  return reply.send(result);
});

// Vocal stem (voice isolation) -----------------------------------------

const VocalStemBody = z.object({
  // songId is accepted for back-compat with older clients but ignored —
  // the cache key is now derived from the audio URL hash so per-region
  // slices can't share a stem with the full song or with each other.
  songId: z.string().optional(),
  audioUrl: urlOrPath,
});

app.post("/api/songs/vocal-stem", async (req, reply) => {
  const body = VocalStemBody.parse(req.body);
  const result = await ensureVocalStem(body.audioUrl);
  return reply.send(result);
});

// Render ---------------------------------------------------------------

// Hard caps so a malformed client can't ask ffmpeg to encode a 10-hour timeline
// or interpolate NaN/Infinity into the filter graph.
const MAX_RENDER_DURATION_S = 60 * 60; // 1h
const MAX_RENDER_CLIPS = 500;

const RenderBody = z
  .object({
    projectId: SafeId,
    audioUrl: urlOrPath,
    duration: z.number().finite().positive().max(MAX_RENDER_DURATION_S),
    clips: z
      .array(
        z
          .object({
            start: z.number().finite().min(0),
            end: z.number().finite().positive(),
            videoUrl: urlOrPath,
            source: z.string().optional(),
          })
          .refine((c) => c.end > c.start, {
            message: "clip end must be greater than start",
          })
      )
      .max(MAX_RENDER_CLIPS),
    fades: z.boolean().default(false),
  })
  .refine((body) => body.clips.every((c) => c.end <= body.duration + 1e-3), {
    message: "clip extends past project duration",
  });

// Submit a render job. Returns immediately with `renderId`; the actual
// ffmpeg work runs in the in-process render queue (one render at a time on
// this task to keep CPU contention predictable). The client polls
// /api/render/jobs/:renderId for status + final URL.
app.post("/api/render", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
  const body = RenderBody.parse(req.body);
  const job = submitRender(body);
  return reply.send({
    renderId: job.id,
    state: job.state,
    queuePosition: job.queuePosition,
  });
});

app.get("/api/render/jobs/:renderId", async (req, reply) => {
  const params = z.object({ renderId: SafeId }).parse(req.params);
  const job = getRenderJob(params.renderId);
  if (!job) return reply.code(404).send({ error: "render job not found" });
  return reply.send(job);
});

// Projects / Library ----------------------------------------------------

const SaveProjectBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  state: z.record(z.unknown()),
});

app.get("/api/projects", async (_req, reply) => {
  const projects = await listProjects();
  return reply.send({ projects });
});

app.post("/api/projects/save", async (req, reply) => {
  const body = SaveProjectBody.parse(req.body);
  const meta = await saveProject(body.id, body.name, body.state);
  return reply.send(meta);
});

app.get("/api/projects/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const project = await loadProject(params.id);
  if (!project) return reply.code(404).send({ error: "not found" });
  return reply.send(project);
});

app.delete("/api/projects/:id", async (req, reply) => {
  // FIXED: parse(req.params) instead of parse(params.id)
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteProject(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

app.get("/api/library/renders", async (_req, reply) => {
  const renders = await listRenders();
  return reply.send({ renders });
});

// Clip Library ------------------------------------------------------------

const SaveClipBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  videoUrl: urlOrPath,
  source: z.string(),
  prompt: z.string().nullable(),
  duration: z.number().positive(),
  sectionLabel: z.string().nullable(),
  folderId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  generationTaskId: z.string().nullable().optional(),
});

app.get("/api/clips", async (_req, reply) => {
  const clips = await listClips();
  return reply.send({ clips });
});

app.post("/api/clips/save", async (req, reply) => {
  const body = SaveClipBody.parse(req.body);
  const saved = await saveClip(body);
  return reply.send(saved);
});

app.delete("/api/clips/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteClip(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

// Image Library --------------------------------------------------------
// Namespaced under /api/library to avoid clashing with /api/images/upload.

const SaveImageBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  url: urlOrPath,
  source: z.string(),
  prompt: z.string().nullable(),
  model: z.string().nullable(),
  folderId: z.string().nullable().optional(),
});

app.get("/api/library/images", async (_req, reply) => {
  const images = await listImages();
  return reply.send({ images });
});

app.post("/api/library/images/save", async (req, reply) => {
  const body = SaveImageBody.parse(req.body);
  const saved = await saveImage(body);
  return reply.send(saved);
});

app.delete("/api/library/images/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteImage(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

// Library Folders API --------------------------------------------------

const SaveFolderBody = z.object({
  id: SafeId,
  name: z.string().min(1).max(200),
  parentId: z.string().nullable(),
  type: z.enum(["clips", "images"]),
});

app.get("/api/library/folders", async (_req, reply) => {
  const folders = await listFolders();
  return reply.send({ folders });
});

app.post("/api/library/folders/save", async (req, reply) => {
  const body = SaveFolderBody.parse(req.body);
  const saved = await saveFolder(body);
  return reply.send(saved);
});

app.delete("/api/library/folders/:id", async (req, reply) => {
  const params = z.object({ id: SafeId }).parse(req.params);
  const deleted = await deleteFolder(params.id);
  if (!deleted) return reply.code(404).send({ error: "not found" });
  return reply.send({ ok: true });
});

const port = process.env.PORT ? Number(process.env.PORT) : config.PORT;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  app.log.info(`api listening on port ${port}`);
});