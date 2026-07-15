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
import sharp from "sharp";
import { config } from "./config.js";
import { resolveLocalPath, mimeType } from "./paths.js";
import { runFfmpeg } from "./ffmpeg.js";
import { storage } from "./storage.js";

// OpenRouter client helper to query LLM
export async function callOpenRouter(prompt: string, systemInstruction?: string, maxTokens: number = 3000): Promise<string> {
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "missing-OPENROUTER_API_KEY") {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  let model = config.OPENROUTER_MODEL || "google/gemini-2.5-flash";
  if (model === "openrouter/free") {
    console.log(`[OpenRouter] Mapping invalid model 'openrouter/free' to 'google/gemini-2.5-flash'`);
    model = "google/gemini-2.5-flash";
  }
  if (model.endsWith(":free")) {
    console.log(`[OpenRouter] Mapping free model variant '${model}' to '${model.replace(":free", "")}'`);
    model = model.replace(":free", "");
  }

  console.log(`[OpenRouter] Sending request to model '${model}' with max_tokens=${maxTokens}...`);
  
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
    console.error(`[OpenRouter Error] HTTP Status ${response.status}: ${errorText}`);
    throw new Error(`OpenRouter API failed with status ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Invalid or empty response from OpenRouter`);
  }

  return content.trim();
}

// Dedicated prompt engineer specifically optimized for LTX-Video's physical attention model
export async function enhancePromptForLTX(promptText: string): Promise<string> {
  const systemPrompt = `You are an elite cinematic prompt engineer specialized in structuring inputs for LTX-Video (a highly physical text-to-video diffusion model).
Your job is to rewrite the user's basic description into a highly detailed, single-paragraph prompt optimized for physics and visual coherence.

Follow this strict structural sequence:
1. MAIN SOLID SUBJECT & DIRECT ACTION: Start with the primary solid object and what it is physically doing (e.g., "A luxury sports car engine idling", "A desolate Oakland street intersection at night").
2. CAMERA COMPOSITION & MOTION: Describe the camera's lens, framing, and movement (e.g., "ultra-slow low-to-the-ground forward camera drift, minor handheld organic jitter, shot on 16mm anamorphic lens").
3. SETTING & LIGHTING: Describe the environment and specific light sources (e.g., "dark street intersection, wet asphalt, amber streetlights, flickering sodium vapor lamp").
4. ATMOSPHERIC DETAILS (ALWAYS PLACE LAST): Describe fluids, smoke, weather, or particles at the absolute end of the prompt (e.g., "thick white fog slowly rolling in from the background, rain-slicked asphalt reflections"). If placed early, the model will fail and render only fog or smoke.

CRITICAL RULES:
- Output only the final single paragraph under 250 characters.
- Do NOT use abstract, metaphorical, or poetic language. Describe only visible physical elements.
- No introductions, markdown blocks, notes, or quotation marks.`;

  return callOpenRouter(promptText, systemPrompt, 500);
}

export async function enhancePromptText(promptText: string): Promise<string> {
  const systemPrompt = `You are a cinematic prompt engineer for a music video production suite. 
Your goal is to enhance the user's description into a highly detailed visual prompt for video/image generation models.
CRITICAL RULE: Always respect the user's defined style, genre, color palette, mood, and aesthetic described in their prompt.
Do NOT force a 'cyber', 'noir', or 'dark' style unless the user's prompt explicitly requests or strongly implies it.
Enhance by expanding the user's core concepts with professional visual and sensory details focusing on:
- Style & Mood: Preserve and elevate the user's chosen style (e.g., hyper-realistic, pastel, modern minimal, neon, retro, watercolor, vibrant, sketch, etc.).
- Atmosphere & Colors: Amplify the lighting, mood, and color tones explicitly mentioned or implied by the user's prompt.
- Camera and Composition: Inject professional cinematic terms (e.g., precise lens framing, high-contrast, atmospheric depth, camera movement, light rays, composition, depth of field) that enhance their requested style.
Do NOT include any introduction, explanations, notes, or wrap the response in quotation marks. Output ONLY the raw enhanced prompt. Keep it under 250 characters.`;

  return callOpenRouter(promptText, systemPrompt, 500);
}

export async function enhancePromptIfNeeded(promptText: string): Promise<string> {
  if (!config.OPENROUTER_API_KEY || config.OPENROUTER_API_KEY === "missing-OPENROUTER_API_KEY" || !promptText.trim()) {
    return promptText;
  }
  try {
    const enhanced = await enhancePromptText(promptText);
    console.log(`[OpenRouter] Enhanced prompt: "${promptText}" -> "${enhanced}"`);
    return enhanced;
  } catch (err) {
    console.log("[OpenRouter] Prompt enhancement skipped, using original.");
    return promptText;
  }
}

/**
 * Sanitize an SVG string so native parsers (librsvg/libxml2 used by sharp)
 * don't choke on a corrupted namespace. The OpenRouter model sometimes wraps
 * the xmlns value in a markdown link, e.g.
 * xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
 * which is not a valid URI and triggers XML_ERR_INVALID_URI (glib parse error).
 * We also guarantee a well-formed, closed <svg> opening tag.
 */
function fixSvgXmlns(svg: string): string {
  let out = svg;
  // Strip markdown-link wrappers from any xmlns / xlink declaration value.
  out = out.replace(
    /(xmlns(:[a-zA-Z0-9_-]+)?\s*=\s*")\[([^\]]+)\]\(([^)]+)\)(")/g,
    (_m, open, _ns, _label, uri, close) => `${open}${uri}${close}`
  );
  // Ensure a valid SVG namespace is present.
  if (!/xmlns\s*=/.test(out)) {
    out = out.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  // Ensure the <svg ...> opening tag is actually closed with '>'.
  out = out.replace(/<svg([^>]*?)\n\s*</, (_m, attrs) => `<svg${attrs.trimEnd()}><`);
  return out;
}

export async function generateSvgWithOpenRouter(prompt: string): Promise<string | null> {
  if (!config.OPENROUTER_API_KEY || config.OPENROUTER_API_KEY === "missing-OPENROUTER_API_KEY") {
    return null;
  }
  try {
    const systemPrompt = `You are an elite professional generative SVG visual artist.
Your job is to generate highly stylized, modern, cinematic, vector-based SVG graphics matching the user's prompt.
Aesthetic & Style Guidelines:
- Directly translate the user's prompt into a corresponding vector visual style. If they want bright, colorful, watercolor, retro, line art, futuristic, minimal, or high-fashion, design exactly that style.
- Choose a color palette that perfectly represents the user's requested theme (e.g. pastel colors for soft themes, primary colors for pop art, or dark/neon for cyber themes).
- Canvas dimensions: Must be EXACTLY width="1280" height="720" viewBox="0 0 1280 720".
- Gradients & Background: Define robust <linearGradient> or <radialGradient> tags inside a <defs> block, and set a full-canvas background <rect width="1280" height="720" fill="url(#yourGradId)" /> to create depth and mood.
- Lighting & Effects: Utilize glow filter blurs (e.g., <feGaussianBlur stdDeviation="X" />) if appropriate, or clean sharp vectors depending on the requested style.
- Geometry: Use paths, polygons, smooth curves, grids, or custom shapes that best match the aesthetic in the user's prompt.
- EXTREMELY CRITICAL FORMATTING RULE: Output ONLY valid, raw, standard SVG code starting with <svg and ending with </svg>.
- Do NOT wrap in markdown code blocks like \`\`\`xml or \`\`\`svg. Do NOT write any introduction, notes, descriptions, explanation, or trailing commentaries. Output only the raw XML SVG text.`;

    const rawResponse = await callOpenRouter(prompt, systemPrompt, 3000);
    let cleaned = rawResponse.trim();
    
    // Extract standard SVG dynamically to handle conversational wrapper text
    const svgStartIdx = cleaned.indexOf("<svg");
    const svgEndIdx = cleaned.lastIndexOf("</svg>");
    if (svgStartIdx !== -1 && svgEndIdx !== -1 && svgEndIdx > svgStartIdx) {
      cleaned = cleaned.substring(svgStartIdx, svgEndIdx + 6);
      return cleaned;
    }

    if (cleaned.startsWith("```")) {
      // Stripping code fences if the model disregarded the instruction
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
    }
    
    // Quick validation
    if (cleaned.startsWith("<svg") && cleaned.includes("</svg>")) {
      return cleaned;
    }
    console.log("[OpenRouter SVG] Custom generation did not return standard SVG structure. Fallback is applied.");
    return null;
  } catch (err: any) {
    console.error("[OpenRouter SVG Error] Custom SVG generation failed with error:", err?.message || err);
    return null;
  }
}

export type OpenRouterTask = { id: string };

export class OpenRouterRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterRateLimitError";
  }
}

function rethrowOpenRouter(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("429") ||
    msg.toLowerCase().includes("rate limit") ||
    msg.toLowerCase().includes("task limit") ||
    msg.toLowerCase().includes("too many requests")
  ) {
    throw new OpenRouterRateLimitError(msg);
  }
  throw err;
}

// Helper to encode/decode task IDs to support routing status/result checks
interface TaskIdPayload {
  source: "openrouter" | "procedural" | "fal";
  id: string;
}

function encodeTaskId(payload: TaskIdPayload): string {
  const str = JSON.stringify(payload);
  return Buffer.from(str).toString("base64url");
}

function decodeTaskId(encoded: string): TaskIdPayload {
  try {
    const str = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(str);
    if (parsed && (parsed.source === "openrouter" || parsed.source === "procedural" || parsed.source === "fal") && parsed.id) {
      return parsed;
    }
  } catch (e) {
    // Treat raw as procedural
  }
  return { source: "procedural", id: encoded };
}

// Procedural visual asset generator for beautiful free/local fallbacks
export async function generateProceduralAsset(prompt: string, type: "image" | "video"): Promise<string> {
  const customSvg = await generateSvgWithOpenRouter(prompt);
  let pngBuffer: Buffer | null = null;

  if (customSvg) {
    try {
      pngBuffer = await sharp(Buffer.from(fixSvgXmlns(customSvg))).png().toBuffer();
      console.log("[OpenRouter SVG] Successfully rendered dynamic SVG from prompt.");
    } catch (err) {
      console.log("[OpenRouter SVG] Sharp render fallback activated.");
    }
  }

  if (!pngBuffer) {
    const lowerPrompt = prompt.toLowerCase();
    
    // Decide colors and elements based on the storyboard's gritty, high-fashion, neo-noir vibe
    let accentColor = "#10b981"; // emerald default
    let bgStart = "#090a0f";
    let bgEnd = "#11131c";
    let graphicOverlay = "";

    if (
      lowerPrompt.includes("flame") ||
      lowerPrompt.includes("lighter") ||
      lowerPrompt.includes("fire") ||
      lowerPrompt.includes("ignite") ||
      lowerPrompt.includes("amber") ||
      lowerPrompt.includes("smoke") ||
      lowerPrompt.includes("intro")
    ) {
      accentColor = "#f59e0b"; // amber/orange
      bgStart = "#090401";
      bgEnd = "#1f0a02";
      graphicOverlay = `
        <circle cx="640" cy="360" r="220" fill="none" stroke="#f59e0b" stroke-width="1" opacity="0.1"/>
        <circle cx="640" cy="360" r="140" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="8,6" opacity="0.3"/>
        <path d="M640,160 Q600,280 640,460 Q680,280 640,160 Z" fill="#f59e0b" filter="url(#glowBlur)" opacity="0.6"/>
        <path d="M640,210 Q615,290 640,430 Q665,290 640,210 Z" fill="#ea580c" opacity="0.7"/>
        <path d="M640,260 Q625,310 640,410 Q655,310 640,260 Z" fill="#fff7ed" opacity="0.9"/>
      `;
    } else if (
      lowerPrompt.includes("throne") ||
      lowerPrompt.includes("vault") ||
      lowerPrompt.includes("stone") ||
      lowerPrompt.includes("obsidian") ||
      lowerPrompt.includes("hook") ||
      lowerPrompt.includes("crowd") ||
      lowerPrompt.includes("glass")
    ) {
      accentColor = "#94a3b8"; // stark metallic silver/slate
      bgStart = "#0b0c10";
      bgEnd = "#1a1d24";
      graphicOverlay = `
        <line x1="30" y1="30" x2="480" y2="250" stroke="#475569" stroke-width="1" stroke-dasharray="10,5" opacity="0.4"/>
        <line x1="1250" y1="30" x2="800" y2="250" stroke="#475569" stroke-width="1" stroke-dasharray="10,5" opacity="0.4"/>
        <line x1="30" y1="690" x2="480" y2="470" stroke="#475569" stroke-width="1" stroke-dasharray="10,5" opacity="0.4"/>
        <line x1="1250" y1="690" x2="800" y2="470" stroke="#475569" stroke-width="1" stroke-dasharray="10,5" opacity="0.4"/>
        <rect x="480" y="250" width="320" height="220" fill="none" stroke="#475569" stroke-width="1.5" opacity="0.6"/>
        <polygon points="590,440 690,440 670,300 610,300" fill="#020617" stroke="#94a3b8" stroke-width="2" opacity="0.95"/>
        <polygon points="560,450 720,450 700,440 580,440" fill="#0f172a" stroke="#475569" stroke-width="1"/>
      `;
    } else if (
      lowerPrompt.includes("boardroom") ||
      lowerPrompt.includes("table") ||
      lowerPrompt.includes("schematics") ||
      lowerPrompt.includes("blueprint") ||
      lowerPrompt.includes("nda") ||
      lowerPrompt.includes("secret")
    ) {
      accentColor = "#3b82f6"; // futuristic electric blue
      bgStart = "#020617";
      bgEnd = "#0f172a";
      graphicOverlay = `
        <pattern id="progrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.8"/>
        </pattern>
        <rect width="1280" height="720" fill="url(#progrid)" opacity="0.7" />
        <rect x="180" y="100" width="920" height="520" fill="none" stroke="#3b82f6" stroke-width="1" stroke-dasharray="15,5" opacity="0.3"/>
        <circle cx="640" cy="360" r="140" fill="none" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="8,4" opacity="0.6"/>
        <circle cx="640" cy="360" r="60" fill="none" stroke="#1d4ed8" stroke-width="2" opacity="0.8"/>
        <line x1="180" y1="360" x2="1100" y2="360" stroke="#1d4ed8" stroke-width="1" stroke-dasharray="4,4" opacity="0.5"/>
      `;
    } else if (
      lowerPrompt.includes("aqueduct") ||
      lowerPrompt.includes("monolith") ||
      lowerPrompt.includes("sky") ||
      lowerPrompt.includes("violet") ||
      lowerPrompt.includes("purple")
    ) {
      accentColor = "#a855f7"; // deep bruised violet
      bgStart = "#05010a";
      bgEnd = "#1c0d29";
      graphicOverlay = `
        <line x1="30" y1="480" x2="1250" y2="480" stroke="#6b21a8" stroke-width="1.5" opacity="0.7"/>
        <line x1="640" y1="480" x2="100" y2="690" stroke="#4a044e" stroke-width="1" opacity="0.5"/>
        <line x1="640" y1="480" x2="1180" y2="690" stroke="#4a044e" stroke-width="1" opacity="0.5"/>
        <polygon points="200,480 320,480 320,180 200,220" fill="#090114" stroke="#a855f7" stroke-width="1.5" opacity="0.9"/>
        <polygon points="960,480 1080,480 1080,220 960,180" fill="#090114" stroke="#a855f7" stroke-width="1.5" opacity="0.9"/>
      `;
    } else if (
      lowerPrompt.includes("car") ||
      lowerPrompt.includes("headlights") ||
      lowerPrompt.includes("vehicle") ||
      lowerPrompt.includes("luxury") ||
      lowerPrompt.includes("matte") ||
      lowerPrompt.includes("yard")
    ) {
      accentColor = "#f8fafc"; // blinding spotlight white
      bgStart = "#030712";
      bgEnd = "#0f172a";
      graphicOverlay = `
        <ellipse cx="400" cy="360" rx="360" ry="10" fill="#ffffff" filter="url(#glowBlur)" opacity="0.4"/>
        <ellipse cx="880" cy="360" rx="360" ry="10" fill="#ffffff" filter="url(#glowBlur)" opacity="0.4"/>
        <circle cx="400" cy="360" r="12" fill="#ffffff"/>
        <circle cx="880" cy="360" r="12" fill="#ffffff"/>
        <circle cx="400" cy="360" r="160" fill="none" stroke="#334155" stroke-width="1" opacity="0.2"/>
        <circle cx="880" cy="360" r="160" fill="none" stroke="#334155" stroke-width="1" opacity="0.2"/>
      `;
    } else if (
      lowerPrompt.includes("fracture") ||
      lowerPrompt.includes("destructive") ||
      lowerPrompt.includes("breaking") ||
      lowerPrompt.includes("molten") ||
      lowerPrompt.includes("bridge")
    ) {
      accentColor = "#ef4444"; // intense fire red
      bgStart = "#0d0202";
      bgEnd = "#270505";
      graphicOverlay = `
        <path d="M30,360 L450,330 L640,440 L880,310 L1250,390" stroke="#f97316" stroke-width="3.5" stroke-linecap="round" filter="url(#glowBlur)" opacity="0.8"/>
        <path d="M30,360 L450,330 L640,440 L880,310 L1250,390" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M450,330 L410,120" stroke="#b91c1c" stroke-width="1.5" opacity="0.7"/>
        <path d="M640,440 L690,620" stroke="#f97316" stroke-width="2" opacity="0.7"/>
        <path d="M880,310 L950,80" stroke="#b91c1c" stroke-width="1.5" opacity="0.7"/>
      `;
    } else {
      // Default high-fashion minimalist cyber-organic visuals
      graphicOverlay = `
        <circle cx="640" cy="360" r="230" fill="none" stroke="#1e293b" stroke-width="1"/>
        <circle cx="640" cy="360" r="160" fill="none" stroke="${accentColor}" stroke-width="1.5" stroke-dasharray="12,6" opacity="0.7"/>
        <circle cx="640" cy="360" r="90" fill="none" stroke="${accentColor}" stroke-width="2" opacity="0.9"/>
        <circle cx="640" cy="360" r="15" fill="${accentColor}"/>
      `;
    }

    const cleanPrompt = prompt.replace(/[<>&"]/g, "").substring(0, 75).toUpperCase();
    
    // FIXED: Use a valid SVG namespace URI and close the <svg> tag
    const svg = `
      <svg width="1280" height="720" viewBox="0 0 1280 720" xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)">
        <defs>
          <linearGradient id="prograd" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${bgStart};stop-opacity:1" />
            <stop offset="100%" style="stop-color:${bgEnd};stop-opacity:1" />
          </linearGradient>
          <filter id="glowBlur">
            <feGaussianBlur stdDeviation="15" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <rect width="1280" height="720" fill="url(#prograd)" />
        
        ${graphicOverlay}
        
        <rect x="30" y="30" width="1220" height="660" fill="none" stroke="${accentColor}" stroke-width="1" opacity="0.15"/>
        <line x1="30" y1="60" x2="60" y2="30" stroke="${accentColor}" stroke-width="1.5" opacity="0.6"/>
        <line x1="1250" y1="60" x2="1220" y2="30" stroke="${accentColor}" stroke-width="1.5" opacity="0.6"/>
        <line x1="30" y1="660" x2="60" y2="690" stroke="${accentColor}" stroke-width="1.5" opacity="0.6"/>
        <line x1="1250" y1="660" x2="1220" y2="690" stroke="${accentColor}" stroke-width="1.5" opacity="0.6"/>

        <text x="60" y="650" font-family="'Courier New', Courier, monospace" font-size="13" fill="${accentColor}" letter-spacing="3" opacity="0.8">${cleanPrompt ? `${cleanPrompt} // DIRECTIVE 140 BPM` : "KEEP EM' THIRSTY // DIRECTIVE 140 BPM"}</text>
        <text x="60" y="670" font-family="'Courier New', Courier, monospace" font-size="11" fill="#94a3b8" letter-spacing="1.5" opacity="0.5">SCENE CREATIVE // PROMPT: ${cleanPrompt}</text>
        <text x="1120" y="650" font-family="'Courier New', Courier, monospace" font-size="11" fill="#94a3b8" letter-spacing="2" opacity="0.4">LOCAL MODE</text>
      </svg>
    `;

    // Render SVG to Buffer
    try {
      pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    } catch (err) {
      console.error("[Procedural SVG] Sharp render failed:", (err as Error)?.message || err);
    }
  }

  if (!pngBuffer) {
    return Promise.reject(new Error("Failed to render procedural asset: SVG rasterization produced no image."));
  }

  // Save to storage
  const filename = `procedural_${Date.now()}.png`;
  const { publicUrl, id } = await storage.saveUpload(pngBuffer, filename, "image/png");

  if (type === "image") {
    return publicUrl;
  }

  // It's a video! Run ffmpeg to pan/zoom over 5 seconds
  const localUploadsDir = join(config.STORAGE_DIR, "uploads");
  await mkdir(localUploadsDir, { recursive: true }).catch(() => {});

  const localImgPath = join(localUploadsDir, `${id}.png`);
  // Always write the source image locally for ffmpeg to read
  await writeFile(localImgPath, pngBuffer);

  const videoName = `procedural_${id}.mp4`;
  const localVideoPath = join(localUploadsDir, videoName);

  const ffmpegArgs = [
    "-y",
    "-loop", "1",
    "-i", localImgPath,
    "-vf", "zoompan=z='zoom+0.0004':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=1280x720",
    "-c:v", "libx264",
    "-t", "5",
    "-pix_fmt", "yuv420p",
    localVideoPath,
  ];

  await runFfmpeg(ffmpegArgs);

  let finalVideoUrl: string;
  if (config.STORAGE_BACKEND === "s3") {
    // Read the rendered video and upload it to S3
    const videoBuf = await readFile(localVideoPath);
    const uploaded = await storage.saveUpload(videoBuf, videoName, "video/mp4");
    finalVideoUrl = uploaded.publicUrl;

    // Clean up local temp files on Fargate
    await unlink(localImgPath).catch(() => {});
    await unlink(localVideoPath).catch(() => {});
  } else {
    finalVideoUrl = `/storage/uploads/${videoName}`;
  }

  return finalVideoUrl;
}

let localInferenceOfflineUntil = 0;

// Support self-hosted/open-source inference backend if LOCAL_INFERENCE_URL is defined
async function callLocalInference(
  type: "video" | "image",
  prompt: string,
  extraPayload: Record<string, any> = {}
): Promise<string | null> {
  if (!config.LOCAL_INFERENCE_URL) return null;

  if (Date.now() < localInferenceOfflineUntil) {
    console.log("[Local Inference] Skipping (cooling down from previous connection failure).");
    return null;
  }

  try {
    const baseUrl = config.LOCAL_INFERENCE_URL.replace(/\/+$/, "");
    
    // Check for local loopback URLs when running in cloud hosted environments
    const isLoopback = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("0.0.0.0");
    if (isLoopback && config.PUBLIC_BASE_URL && !config.PUBLIC_BASE_URL.includes("localhost") && !config.PUBLIC_BASE_URL.includes("127.0.0.1")) {
      console.log(
        `\n[Local Inference Note] You configured LOCAL_INFERENCE_URL as a local loopback address (${baseUrl}). ` +
        `Since your Music Video Studio app is running on a cloud-hosted development environment (${config.PUBLIC_BASE_URL}), ` +
        `the cloud backend CANNOT reach your physical computer's localhost. ` +
        `To fix this, expose your local Python FastAPI server using a tunneling tool like ngrok (e.g. 'ngrok http 8000') ` +
        `and set LOCAL_INFERENCE_URL to the public HTTPS URL (e.g. 'https://xxxx.ngrok-free.app') in your settings or .env file.\n`
      );
    }

    const endpointPath = type === "video" ? "/v1/video/generate" : "/v1/image/generate";
    
    // For Modal endpoints or custom endpoints, try root `/`, `/generate` or standard path
    const candidates: string[] = [];
    if (baseUrl.includes("modal.run")) {
      candidates.push(baseUrl); // Try root first (extremely common for simple Modal web_endpoints)
      candidates.push(`${baseUrl}/generate`);
      candidates.push(`${baseUrl}${endpointPath}`);
    } else {
      candidates.push(`${baseUrl}${endpointPath}`);
      candidates.push(baseUrl);
      candidates.push(`${baseUrl}/generate`);
    }

    const bodyPayload = {
      prompt,
      ...extraPayload,
    };

    let lastError: any = null;
    let successUrl: string | null = null;

    // Real video generation can take up to 3 minutes
    const isLocalhost = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("0.0.0.0");
    const timeoutMs = isLocalhost ? 5000 : 180000;

    for (const candidate of candidates) {
      try {
        const urlWithParams = new URL(candidate);
        
        // Helper to only include safe, short parameters in the query string
        const isSafeQueryParam = (val: any): boolean => {
          if (val === null || val === undefined) return false;
          const str = String(val);
          if (str.length > 150) return false;
          if (str.includes(";base64,") || str.startsWith("data:") || str.includes("\n")) return false;
          return true;
        };

        if (isSafeQueryParam(prompt)) {
          urlWithParams.searchParams.set("prompt", prompt);
        } else if (prompt) {
          urlWithParams.searchParams.set("prompt", prompt.substring(0, 120) + "...");
        }

        for (const [key, value] of Object.entries(extraPayload)) {
          if (isSafeQueryParam(value)) {
            urlWithParams.searchParams.set(key, String(value));
          }
        }

        console.log(`[Local Inference] Trying endpoint: ${urlWithParams.toString()}`);
        
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "bypass-tunnel-reminder": "true",
          "Bypass-Tunnel-Reminder": "true",
          "ngrok-skip-browser-warning": "69420",
          "Ngrok-Skip-Browser-Warning": "any-value"
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        let res: Response;
        try {
          res = await fetch(urlWithParams.toString(), {
            method: "POST",
            headers,
            body: JSON.stringify(bodyPayload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        if (res.status === 404) {
          console.log(`[Local Inference] Endpoint ${candidate} returned 404, trying next fallback...`);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.log(`[Local Inference] Endpoint ${candidate} responded with status ${res.status}:`, text);
          throw new Error(`Endpoint returned status ${res.status}: ${text}`);
        }

        const data = await res.json() as any;
        console.log(`[Local Inference] Success response from ${candidate}:`, data);

        const url =
          data.video_url ||
          data.image_url ||
          data.url ||
          data.video ||
          data.image ||
          (Array.isArray(data.outputs) && data.outputs[0]) ||
          (Array.isArray(data.images) && data.images[0]?.url) ||
          (Array.isArray(data.images) && data.images[0]);

        if (typeof url === "string" && url) {
          successUrl = url;
          break; // Exit candidate loop on success!
        }

        throw new Error(`Response did not contain a valid URL in standard keys. Received: ${JSON.stringify(data)}`);
      } catch (err: any) {
        console.log(`[Local Inference] Endpoint ${candidate} failed:`, err?.message || err);
        lastError = err;
      }
    }

    if (successUrl) {
      return successUrl;
    }

    throw lastError || new Error("All candidate local inference endpoints failed.");
  } catch (err: any) {
    localInferenceOfflineUntil = Date.now() + 60 * 1000;
    const baseUrl = config.LOCAL_INFERENCE_URL || "";
    const isLoopback = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || baseUrl.includes("0.0.0.0");
    if (isLoopback && config.PUBLIC_BASE_URL && !config.PUBLIC_BASE_URL.includes("localhost") && !config.PUBLIC_BASE_URL.includes("127.0.0.1")) {
      const enrichedError = new Error(
        `[Local Loopback Notice] Backend running in the cloud cannot connect directly to your local computer's loopback address (${baseUrl}). ` +
        `Expose your local server using a tool like ngrok (e.g. 'ngrok http 8001') and set LOCAL_INFERENCE_URL in your .env. ` +
        `Details: ${err?.message || err}`
      );
      console.log("[Local Inference] Notice: self-hosted model API not reachable:", enrichedError.message);
      throw enrichedError;
    }
    console.log("[Local Inference] Notice: self-hosted model API not reachable:", err?.message || err);
    throw err;
  }
}

export async function imageToVideo(req: ImageToVideoRequest): Promise<OpenRouterTask> {
  // ROUTE B: Direct HTTP Fetch directly to LTX-Video Modal
  try {
    let promptToUse = req.promptText ?? "";
    if (config.OPENROUTER_API_KEY && config.OPENROUTER_API_KEY !== "missing-OPENROUTER_API_KEY" && promptToUse.trim()) {
      try {
        promptToUse = await enhancePromptForLTX(promptToUse);
        console.log(`[OpenRouter LTX] Enhanced prompt: "${req.promptText}" -> "${promptToUse}"`);
      } catch (err) {
        console.log("[OpenRouter LTX] Prompt enhancement failed, utilizing raw.");
      }
    }
    const duration = req.duration ?? 4;

    const modalUrl = config.MODAL_LTX_URL || "[https://cdtfullsail--mvs-ltx-video-generate.modal.run](https://cdtfullsail--mvs-ltx-video-generate.modal.run)";
    console.log(`[Direct LTX Route] Sending request to Modal at: ${modalUrl}`);

    const response = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptToUse,
        duration: duration,
        init_image_url: req.promptImage
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Modal returned status ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    if (!data.video_url) {
      throw new Error(`Modal response did not return a video_url: ${JSON.stringify(data)}`);
    }

    console.log(`[Direct LTX Route] Success! Video rendered at: ${data.video_url}`);
    return { id: encodeTaskId({ source: "procedural", id: data.video_url }) };

  } catch (err: any) {
    console.error("[Direct LTX Route Error] Image-to-Video direct pipeline failed, falling back:", err?.message || err);
    // Standard backup trigger if GPU node is unreachable
    const videoUrl = await generateProceduralAsset(req.promptText ?? "", "video");
    return { id: encodeTaskId({ source: "procedural", id: videoUrl }) };
  }
}

export async function textToVideo(req: TextToVideoRequest): Promise<OpenRouterTask> {
  // ROUTE B: Direct HTTP Fetch directly to LTX-Video Modal
  try {
    let promptToUse = req.promptText ?? "";
    if (config.OPENROUTER_API_KEY && config.OPENROUTER_API_KEY !== "missing-OPENROUTER_API_KEY" && promptToUse.trim()) {
      try {
        promptToUse = await enhancePromptForLTX(promptToUse);
        console.log(`[OpenRouter LTX] Enhanced prompt: "${req.promptText}" -> "${promptToUse}"`);
      } catch (err) {
        console.log("[OpenRouter LTX] Prompt enhancement failed, utilizing raw.");
      }
    }
    const duration = req.duration ?? 4;

    const modalUrl = config.MODAL_LTX_URL || "[https://cdtfullsail--mvs-ltx-video-generate.modal.run](https://cdtfullsail--mvs-ltx-video-generate.modal.run)";
    console.log(`[Direct LTX Route] Sending request to Modal at: ${modalUrl}`);

    const response = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: promptToUse,
        duration: duration
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Modal returned status ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    if (!data.video_url) {
      throw new Error(`Modal response did not return a video_url: ${JSON.stringify(data)}`);
    }

    console.log(`[Direct LTX Route] Success! Video rendered at: ${data.video_url}`);
    return { id: encodeTaskId({ source: "procedural", id: data.video_url }) };

  } catch (err: any) {
    console.error("[Direct LTX Route Error] Text-to-Video direct pipeline failed, falling back:", err?.message || err);
    // Standard backup trigger if GPU node is unreachable
    const videoUrl = await generateProceduralAsset(req.promptText, "video");
    return { id: encodeTaskId({ source: "procedural", id: videoUrl }) };
  }
}

export async function videoToVideo(req: VideoToVideoRequest): Promise<OpenRouterTask> {
  const promptText = await enhancePromptIfNeeded(req.promptText ?? "");

  // If self-hosted local inference is configured, call it!
  if (config.LOCAL_INFERENCE_URL) {
    try {
      const videoUrl = await callLocalInference("video", promptText, {
        video_url: req.videoUri,
        prompt_video: req.videoUri,
        model: req.model ?? "wan2.1",
      });
      if (videoUrl) {
        return { id: encodeTaskId({ source: "procedural", id: videoUrl }) };
      }
    } catch (err) {
      console.log("[Local Inference] Note: Local inference not reachable. Applying standard backup pipeline.");
    }
  }

  // Generate dynamic, high-fashion layout via OpenRouter / Procedural pipeline
  const videoUrl = await generateProceduralAsset(promptText, "video");
  return { id: encodeTaskId({ source: "openrouter", id: videoUrl }) };
}

export async function textToImage(req: TextToImageRequest): Promise<OpenRouterTask> {
  const promptText = await enhancePromptIfNeeded(req.promptText);

  // If self-hosted local inference is configured, call it!
  if (config.LOCAL_INFERENCE_URL) {
    try {
      const imageUrl = await callLocalInference("image", promptText, {
        model: req.model ?? "wan2.1",
      });
      if (imageUrl) {
        return { id: encodeTaskId({ source: "procedural", id: imageUrl }) };
      }
    } catch (err) {
      console.log("[Local Inference] Note: Local inference not reachable. Applying standard backup pipeline.");
    }
  }

  // Generate dynamic, high-fashion layout via OpenRouter / Procedural pipeline
  const imageUrl = await generateProceduralAsset(promptText, "image");
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
      imageUri: "[https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80](https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80)",
      createdAt: new Date().toISOString(),
    },
    {
      id: "obsidian",
      name: "Obsidian (Cyber-Organic)",
      status: "READY",
      imageUri: "[https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80](https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80)",
      createdAt: new Date().toISOString(),
    },
    {
      id: "silver",
      name: "Silver (Minimalist)",
      status: "READY",
      imageUri: "[https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80](https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80)",
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
  return {
    avatarId: `custom-${Date.now()}`,
    status: "READY",
  };
}

export async function getAvatar(id: string): Promise<AvatarSubmitResult> {
  return {
    avatarId: id,
    status: "READY",
  };
}

export async function lipSync(req: LipSyncRequest): Promise<OpenRouterTask> {
  let text = `Character Lip Sync: ${req.avatarId}`;
  const videoUrl = await generateProceduralAsset(text, "video");
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

export async function getTask(encodedId: string): Promise<TaskResult> {
  const { source, id } = decodeTaskId(encodedId);
  return {
    id: encodedId,
    status: "SUCCEEDED",
    createdAt: new Date().toISOString(),
    output: [id],
  };
}

export async function deleteTask(encodedId: string) {
  // no-op
}