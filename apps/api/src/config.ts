import { z } from "zod";

const optionalUrl = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().url().optional());

const optionalNonEmpty = z
  .string()
  .transform((v) => (v.trim() === "" ? undefined : v))
  .pipe(z.string().min(1).optional());

const Env = z.object({
  FAL_API_SECRET: optionalNonEmpty.optional(),
  OPENROUTER_API_KEY: optionalNonEmpty.optional(),
  OPENROUTER_MODEL: optionalNonEmpty.optional(),
  LOCAL_INFERENCE_URL: optionalUrl.optional(),
  MODAL_AUDIO_URL: optionalUrl.optional(),
  MODAL_LTX_URL: optionalUrl.optional(), // ADDED: Registers LTX-Video variable
  PORT: z.coerce.number().default(3001),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3001"),
  // Comma-separated list of allowed CORS origins (or a single URL).
  WEB_ORIGIN: z
    .string()
    .default("http://localhost:5173")
    .refine(
      (v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .every((s) => /^https?:\/\/[^,\s]+$/.test(s)),
      "WEB_ORIGIN must be a URL or comma-separated list of URLs"
    ),
  STORAGE_DIR: z.string().default("./storage"),
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: optionalNonEmpty.optional(),
  S3_REGION: optionalNonEmpty.optional(),
  /** Override the public URL base for S3 objects (e.g. a CloudFront domain).
   * When unset, virtual-hosted-style S3 URLs are used. */
  S3_PUBLIC_URL_BASE: optionalUrl.optional(),
  /** Directory holding the built SPA (apps/web/dist) to serve from `/`.
   * In the production Docker image this is set to /app/web; locally it can
   * stay unset and Vite handles the SPA in dev. */
  WEB_DIST_DIR: optionalNonEmpty.optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("invalid env:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\ncopy .env.example to .env at the repo root and fill in values.");
  process.exit(1);
}

export const config = parsed.data;

if (!config.FAL_API_SECRET) {
  console.log(
    "INFO: FAL_API_SECRET is not set. /api/generate/* calls will 401. " +
      "Other endpoints (audio, render) still work."
  );
}

if (!config.OPENROUTER_API_KEY) {
  console.log(
    "INFO: OPENROUTER_API_KEY is not set. OpenRouter prompt enhancement will be disabled."
  );
}

// ADDED: Logs a warning if your LTX Video variable is missing
if (!config.MODAL_LTX_URL) {
  console.log(
    "INFO: MODAL_LTX_URL is not set. Timeline requests for LTX Video will fall back."
  );
}

if (!config.MODAL_AUDIO_URL) {
  console.log(
    "INFO: MODAL_AUDIO_URL is not set. Song uploads will analyze nothing. " +
      "Deploy modal/audio_analysis.py and put the URL in .env."
  );
}
if (config.STORAGE_BACKEND === "s3") {
  if (!config.S3_BUCKET || !config.S3_REGION) {
    console.error("STORAGE_BACKEND=s3 requires S3_BUCKET and S3_REGION");
    process.exit(1);
  }
} else {
  console.log("STORAGE_BACKEND=local — uploads stored on container disk only (ephemeral).");
}

export type Config = z.infer<typeof Env>;