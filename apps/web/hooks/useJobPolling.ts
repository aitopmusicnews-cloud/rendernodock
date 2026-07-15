import { useState, useEffect, useRef } from "react";

export type JobStatus = "idle" | "pending" | "completed" | "failed";

export interface PollingState {
  status: JobStatus;
  videoUrl: string | null;
  error: string | null;
  isPolling: boolean;
}

interface UseJobPollingProps {
  jobId: string | null | undefined;
  intervalMs?: number; // Defaults to 3000ms (3 seconds)
  onSuccess?: (videoUrl: string) => void;
  onFailure?: (error: string) => void;
}

export function useJobPolling({
  jobId,
  intervalMs = 3000,
  onSuccess,
  onFailure,
}: UseJobPollingProps): PollingState {
  const [status, setStatus] = useState<JobStatus>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState<boolean>(false);

  // Keep references to prevent calling stale callbacks if props change mid-stream
  const successRef = useRef(onSuccess);
  const failureRef = useRef(onFailure);

  useEffect(() => {
    successRef.current = onSuccess;
    failureRef.current = onFailure;
  }, [onSuccess, onFailure]);

  useEffect(() => {
    // If no jobId is provided, reset state and do not poll
    if (!jobId) {
      setStatus("idle");
      setVideoUrl(null);
      setError(null);
      setIsPolling(false);
      return;
    }

    setStatus("pending");
    setError(null);
    setIsPolling(true);

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let isMounted = true;

    async function checkStatus() {
      try {
        // Query our Express polling status endpoint
        const response = await fetch(`/api/openrouter/status/${jobId}`);
        
        if (!response.ok) {
          throw new Error(`Server responded with status ${response.status}`);
        }

        const data = await response.json();

        // Ensure state updates are only committed if the component remains mounted
        if (!isMounted) return;

        if (data.status === "completed" && data.video_url) {
          setStatus("completed");
          setVideoUrl(data.video_url);
          setIsPolling(false);
          if (successRef.current) successRef.current(data.video_url);
        } else if (data.status === "failed") {
          const errMsg = data.error || "Inference failed on the GPU cluster.";
          setStatus("failed");
          setError(errMsg);
          setIsPolling(false);
          if (failureRef.current) failureRef.current(errMsg);
        } else {
          // Still pending/processing, schedule next poll check
          timerId = setTimeout(checkStatus, intervalMs);
        }
      } catch (err: any) {
        if (!isMounted) return;
        console.error("[Polling Hook Error]:", err);
        
        // We do not immediately fail on network errors (gives resiliency on spotty connections)
        // Instead, continue polling unless explicitly cancelled
        timerId = setTimeout(checkStatus, intervalMs);
      }
    }

    // Begin polling instantly
    checkStatus();

    // Clean up timers and unregister hooks on component unmount or jobId change
    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [jobId, intervalMs]);

  return { status, videoUrl, error, isPolling };
}