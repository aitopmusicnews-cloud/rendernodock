import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "../lib/store.js";
import type { Clip } from "@mvs/shared";

/**
 * Double-buffered video preview. Two <video> elements alternate so the next
 * clip can preload while the current one plays — no black flash at boundaries.
 *
 * Visibility is driven by React state (`frontSlot`) rather than imperative
 * `style.display` mutations: the latter conflicts with React's style prop and
 * leaves the DOM in a state React can stomp on a later render.
 */
export function VideoPreview() {
  const aRef = useRef<HTMLVideoElement>(null);
  const bRef = useRef<HTMLVideoElement>(null);
  const [frontSlot, setFrontSlot] = useState<"a" | "b">("a");
  /** Composite key (id + url) loaded in each slot. Tracks both so a rehosted
   *  URL triggers a reload even though the clip ID stays the same. */
  const loadedRef = useRef<{ a: string | null; b: string | null }>({ a: null, b: null });

  const clips = useStore((s) => s.clips);
  const playhead = useStore((s) => s.playhead);
  const isPlaying = useStore((s) => s.isPlaying);

  const readyClips = clips.filter((c): c is Clip & { videoUrl: string } =>
    c.status === "ready" && !!c.videoUrl
  );

  const active = readyClips.find((c) => playhead >= c.start && playhead < c.end) ?? null;
  const activeIdx = active ? readyClips.indexOf(active) : -1;
  const next = activeIdx >= 0 ? readyClips[activeIdx + 1] ?? null : null;

  const slotEl = useCallback((slot: "a" | "b") => slot === "a" ? aRef.current : bRef.current, []);

  const slotKey = (clip: { id: string; videoUrl: string }) => `${clip.id}\0${clip.videoUrl}`;

  const loadInto = useCallback((slot: "a" | "b", clip: { id: string; videoUrl: string }) => {
    const key = slotKey(clip);
    if (loadedRef.current[slot] === key) return;
    const el = slotEl(slot);
    if (!el) return;
    loadedRef.current[slot] = key;
    let safeUrl = clip.videoUrl;
    if (typeof window !== "undefined" && window.location.protocol === "https:") {
      safeUrl = safeUrl.replace(/^http:\/\//, "https://");
    }
    el.src = safeUrl;
    el.load();
  }, [slotEl]);

  // Load/swap clips when the active clip changes. Preload next.
  // Cleanup removes any pending loadedmetadata listeners — without it, a
  // stale listener fires with old props when active/playhead changes before
  // metadata loads (e.g. fast clicks during cold-load).
  useEffect(() => {
    if (!active) return;
    const back: "a" | "b" = frontSlot === "a" ? "b" : "a";
    const cleanups: Array<() => void> = [];

    const activeKey = slotKey(active);
    const slotDur = active.end - active.start;
    if (loadedRef.current[frontSlot] === activeKey) {
      // Already loaded on front — but may be ended from a previous play, and
      // the rate may have been set when the slot duration was different
      // (e.g. user dragged a boundary). Re-apply + repaint.
      const front = slotEl(frontSlot);
      if (front) {
        applyPlaybackRate(front, slotDur, active.source);
        seekTo(front, active, playhead);
        repaintIfStale(front, isPlaying);
      }
    } else if (loadedRef.current[back] === activeKey) {
      // The back slot is preloaded with the new active clip — promote it.
      const oldFront = slotEl(frontSlot);
      const newFront = slotEl(back);
      oldFront?.pause();
      if (newFront) {
        applyPlaybackRate(newFront, slotDur, active.source);
        seekTo(newFront, active, playhead);
        repaintIfStale(newFront, isPlaying);
      }
      setFrontSlot(back);
    } else {
      // Cold load into the current front slot. Apply rate once metadata
      // arrives — pure addEventListener (no `{ once: true }`) so the
      // cleanup below can remove it if the effect re-runs first.
      loadInto(frontSlot, active);
      const front = slotEl(frontSlot);
      if (front) {
        const onMeta = () => applyPlaybackRate(front, slotDur, active.source);
        if (front.readyState >= 1) onMeta();
        else {
          front.addEventListener("loadedmetadata", onMeta);
          cleanups.push(() => front.removeEventListener("loadedmetadata", onMeta));
        }
      }
    }

    if (next && loadedRef.current[back] !== slotKey(next)) {
      loadInto(back, next);
    }
    return () => { for (const c of cleanups) c(); };
    // playhead intentionally omitted — only used for the inline seek above,
    // which we want bound to the active-change moment, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, next, frontSlot, slotEl, loadInto, isPlaying]);

  // Sync the front video to the playhead on every change. During natural
  // playback the playbackRate adjustment keeps the video tracking the slot,
  // so `seekTo`'s drift threshold (~0.15s) means we no-op on every tick.
  // When the user clicks the timeline (or the playhead jumps from any other
  // source), drift exceeds the threshold and we seek. Repaint nudge only
  // when paused; during play the act of seeking already triggers a frame.
  useEffect(() => {
    if (!active) return;
    const front = slotEl(frontSlot);
    if (!front) return;
    const doSeek = () => {
      seekTo(front, active, playhead);
      if (!isPlaying) repaintIfStale(front, false);
    };
    if (front.readyState >= 1) {
      doSeek();
      return;
    }
    front.addEventListener("loadedmetadata", doSeek);
    return () => front.removeEventListener("loadedmetadata", doSeek);
  }, [playhead, active, frontSlot, slotEl, isPlaying]);

  // Play/pause the front element.
  useEffect(() => {
    const front = slotEl(frontSlot);
    if (!front || !active) return;
    if (isPlaying) {
      if (front.ended) front.currentTime = 0;
      front.play().catch(() => {});
    } else {
      front.pause();
    }
  }, [isPlaying, active, frontSlot, slotEl]);

  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Slot visibility — opacity (not visibility/display) so the back element
  // keeps decoding. When `active` is null we hide BOTH so the (possibly
  // black fade-out) last frame doesn't show under the empty overlay.
  const slotStyle = (slot: "a" | "b"): React.CSSProperties => ({
    width: "100%",
    height: "100%",
    position: "absolute",
    inset: 0,
    opacity: active && frontSlot === slot ? 1 : 0,
    pointerEvents: active && frontSlot === slot ? "auto" : "none",
  });

  // Important: the video elements stay mounted regardless of `active`. If we
  // unmounted them on `active === null`, scrubbing back would create new
  // <video> elements while loadedRef still claimed the old clip was loaded
  // — the "already on front" branch would no-op against an empty element
  // and the user would see black until something else triggered a cold load.
  return (
    <div ref={containerRef} className="preview-container">
      <video ref={aRef} muted playsInline style={slotStyle("a")} />
      <video ref={bRef} muted playsInline style={slotStyle("b")} />
      {!active && (
        <div className="preview-empty preview-empty-overlay">
          <div className="label-big">preview</div>
          <div>no clip at playhead</div>
        </div>
      )}
      <button
        type="button"
        className="preview-fullscreen"
        onClick={toggleFullscreen}
        title="Toggle fullscreen"
        aria-label="toggle fullscreen"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    </div>
  );
}

function seekTo(el: HTMLVideoElement, clip: { start: number; end: number }, playhead: number) {
  const clipDur = clip.end - clip.start;
  const vidDur = el.duration;
  if (!vidDur || !clipDur) return;
  const frac = Math.max(0, Math.min(1, (playhead - clip.start) / clipDur));
  const target = Math.min(frac * vidDur, vidDur - 0.01);
  if (Math.abs(el.currentTime - target) > 0.15) {
    el.currentTime = target;
  }
}

/**
 * Make sure the seeked frame actually paints. Setting `currentTime` on a
 * paused video doesn't always force a repaint — particularly when the
 * element was previously in `ended` state, which is exactly the case after
 * a clip plays through and the user scrubs back into it. A brief
 * play()→pause() roundtrip wakes the decoder and the seeked frame lands.
 *
 * If we're meant to be playing, we just call play(). If the element isn't
 * stale (not ended, has frames), we no-op to avoid a flash on every scrub.
 */
function repaintIfStale(el: HTMLVideoElement, isPlaying: boolean): void {
  if (isPlaying) {
    el.play().catch(() => {});
    return;
  }
  // readyState < HAVE_CURRENT_DATA (2) means no decoded frame is available
  // for the current position; ended means we just played past the end. In
  // either case a play+pause forces a fresh decode at the seeked time.
  if (el.ended || el.readyState < 2) {
    el.play().then(() => el.pause()).catch(() => {});
  }
}

/**
 * Time-stretch a video element so its intrinsic duration spans the timeline
 * slot. Mirrors the setpts=(PTS-STARTPTS)*K stretch the renderer applies, so
 * preview ↔ exported MP4 stay in sync.
 *
 *   K = vidDur / slotDur
 *
 *   - K < 1 (source longer than slot): video plays slower so it fills the slot.
 *   - K > 1 (source shorter than slot): video plays faster so it fits the slot.
 *
 * Clamped to [0.25, 4] so a degenerate slotDur (e.g. mid-drag transient zero)
 * can't break the element. We're muted so audio artifacts of off-rate
 * playback are irrelevant.
 *
 * lipSync is the exception: the renderer hard-trims those clips (no
 * time-stretch, to keep mouth movement in sync with the audio), so preview
 * must also play them at 1x.
 */
function applyPlaybackRate(el: HTMLVideoElement, slotDur: number, source?: string): void {
  if (source === "lipSync") {
    if (el.playbackRate !== 1) el.playbackRate = 1;
    return;
  }
  const vidDur = el.duration;
  if (!Number.isFinite(vidDur) || vidDur <= 0 || slotDur <= 0) return;
  const rate = Math.max(0.25, Math.min(4, vidDur / slotDur));
  if (Math.abs(el.playbackRate - rate) > 0.01) {
    el.playbackRate = rate;
  }
}
