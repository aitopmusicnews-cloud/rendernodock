import React from "react";
import { useStore } from "../lib/store.js";

export function QueueStatus() {
  const clips = useStore((s) => s.clips);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const updateClip = useStore((s) => s.updateClip);

  // Filter clips that are currently active in the generation lifecycle
  const activeJobs = clips.filter(
    (c) => c.status === "queued" || c.status === "generating" || c.status === "failed"
  );

  if (activeJobs.length === 0) {
    return (
      <div className="queue-status-panel empty" style={{ padding: "16px", color: "#71717a", fontSize: "0.85rem", textAlign: "center", borderTop: "1px solid #27272a" }}>
        No background video renders running.
      </div>
    );
  }

  return (
    <div className="queue-status-panel" style={{ padding: "16px", borderTop: "1px solid #27272a", background: "#090a0f" }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: "0.85rem", fontWeight: 600, color: "#f4f4f5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Rendering Monitor ({activeJobs.length})
      </h3>
      
      {/* FIXED: Replaced maxH with maxHeight to resolve TS2353 type errors */}
      <div className="queue-list" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "200px", overflowY: "auto" }}>
        {activeJobs.map((job) => {
          const isSelected = job.id === selectedClipId;
          
          return (
            <div
              key={job.id}
              className={`queue-item ${job.status}`}
              style={{
                padding: "10px",
                borderRadius: "6px",
                background: isSelected ? "#1e1b4b" : "#14151f",
                border: `1px solid ${isSelected ? "#4f46e5" : "#27272a"}`,
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 500, color: "#e4e4e7" }}>
                  Segment: {job.id} ({ (job.end - job.start).toFixed(1) }s)
                </span>
                
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    padding: "2px 6px",
                    borderRadius: "4px",
                    textTransform: "uppercase",
                    background: 
                      job.status === "generating" ? "#1e3a8a" : 
                      job.status === "failed" ? "#991b1b" : "#27272a",
                    color: 
                      job.status === "generating" ? "#93c5fd" : 
                      job.status === "failed" ? "#fca5a5" : "#a1a1aa",
                  }}
                >
                  {job.status === "generating" ? "Rendering" : job.status}
                </span>
              </div>

              {job.prompt && (
                <div style={{ fontSize: "0.75rem", color: "#a1a1aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Prompt: "{job.prompt}"
                </div>
              )}

              {job.status === "failed" && job.lastError && (
                <div style={{ fontSize: "0.7rem", color: "#f87171", marginTop: "2px", lineHeight: "1.2" }}>
                  Error: {job.lastError}
                </div>
              )}

              {job.status === "failed" && (
                <button
                  type="button"
                  onClick={() => {
                    updateClip(job.id, {
                      status: "empty",
                      lastError: undefined,
                      generationTaskId: undefined
                    });
                  }}
                  style={{
                    alignSelf: "flex-end",
                    marginTop: "6px",
                    background: "#27272a",
                    border: "none",
                    color: "#e4e4e7",
                    fontSize: "0.7rem",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    cursor: "pointer"
                  }}
                >
                  Clear Status
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}