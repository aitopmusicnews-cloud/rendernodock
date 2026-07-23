import { createHash } from "node:crypto";
import { encodeTaskId } from "./modalAI.js";
import { readVocalStemUrl, writeVocalStemUrl } from "./storage.js";
import { pollUntil } from "./poll.js";

// Process-local dedup — concurrent requests for the same audio share one
// Runway task. Does not deduplicate across processes/containers.
const inflight = new Map<string, Promise<{ url: string; cached: boolean }>>();

/**
 * Cache key for the vocal stem. Derived from the audio URL itself so:
 *   - the full-song case (audioUrl = stable song URL) caches per song;
 *   - the per-region case (audioUrl = content-addressed slice URL) caches
 *     per region content. Boundary drags re-slice → new URL → new key,
 *     so we don't reuse a stale stem from a previous region.
 */
function cacheKeyFor(audioUrl: string): string {
  return createHash("sha256").update(audioUrl).digest("hex").slice(0, 16);
}

export async function ensureVocalStem(
  audioUrl: string
): Promise<{ url: string; cached: boolean }> {
  const key = cacheKeyFor(audioUrl);
  const cached = await readVocalStemUrl(key);
  if (cached) return { url: cached, cached: true };

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const task = await voiceIsolation({ audioUri: audioUrl });
    const result = await awaitTask(task.id);
    if (result.status !== "SUCCEEDED" || !result.output?.[0]) {
      const failure = "failure" in result ? String(result.failure) : "no output URL";
      throw new Error(`voice isolation ${result.status}: ${failure}`);
    }
    const url = result.output[0];
    await writeVocalStemUrl(key, url);
    return { url, cached: false };
  })();

  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

async function awaitTask(id: string, timeoutMs = 5 * 60 * 1000) {
  return pollUntil(
    () => getTask(id),
    (t) => t.status === "SUCCEEDED" || t.status === "FAILED" || t.status === "CANCELLED",
    { timeoutMs, label: "voice-isolation task" }
  );
}
