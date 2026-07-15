import React, { useState } from "react";
import { useStore } from "../lib/store.js";
import { QueueStatus } from "./QueueStatus.js";

export function Sidebar() {
  const clips = useStore((s) => s.clips);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const updateClip = useStore((s) => s.updateClip);
  
  // Local UI status configuration states
  const [modelType, setModelType] = useState<string>("ltx-video");
  const [enableAudio, setEnableAudio] = useState<boolean>(true);
  const [motionBucket, setMotionBucket] = useState<number>(5);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  // Triggers the asynchronous cloud GPU rendering handoff
  const handleGenerateClip = async () => {
    if (!selectedClip) return;

    // Shift segment into a standard loading state
    updateClip(selectedClip.id, {
      status: "queued",
      prompt: selectedClip.prompt || "Cinematic music video scene",
      lastError: undefined
    });

    try {
      const response = await fetch("/api/generate/image-to-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptText: selectedClip.prompt || "Cinematic music video scene",
          duration: selectedClip.end - selectedClip.start,
          enableAudio: enableAudio,
          model: modelType,
          motionBucket: motionBucket
        }),
      });

      if (!response.ok) {
        throw new Error(`API returned execution error status: ${response.status}`);
      }

      const data = await response.json();
      
      // Map the base64 encoded tracking token to the clip timeline object
      if (data.id) {
        updateClip(selectedClip.id, {
          generationTaskId: data.id,
          status: "generating"
        });
      }
    } catch (err: any) {
      console.error("[Generation Trigger Failure]:", err);
      updateClip(selectedClip.id, {
        status: "failed",
        lastError: err.message || "Failed to submit render to cloud pipeline."
      });
    }
  };

  // Safe reset to escape stuck statuses manual clear option
  const handleClearClip = () => {
    if (!selectedClip) return;
    updateClip(selectedClip.id, {
      status: "empty",
      videoUrl: undefined,
      generationTaskId: undefined,
      lastError: undefined
    });
  };

  return (
    <div 
      className="sidebar-container" 
      style={{ 
        width: "340px", 
        height: "100%", 
        display: "flex", 
        flexDirection: "column", 
        background: "#090a0f", 
        borderRight: "1px solid #27272a" 
      }}
    >
      {/* Primary Settings Workspace Header */}
      <div className="sidebar-header" style={{ padding: "20px", borderBottom: "1px solid #27272a" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#fff" }}>Control Panel</h2>
        <p style={{ margin: "4px 0 0 0", fontSize: "0.8rem", color: "#71717a" }}>
          Configure generative properties for timeline segments
        </p>
      </div>

      {/* Main Settings Panel Body */}
      <div className="sidebar-body" style={{ padding: "20px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px" }}>
        {selectedClip ? (
          <>
            {/* Clip Context Breakdown Card */}
            <div style={{ background: "#14151f", padding: "14px", borderRadius: "8px", border: "1px solid #27272a" }}>
              <div style={{ fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#a1a1aa", fontWeight: 600 }}>
                Selected Segment
              </div>
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "#fff", marginTop: "4px" }}>
                {selectedClip.sectionLabel || `Clip Area: ${selectedClip.id}`}
              </div>
              <div style={{ display: "flex", gap: "12px", marginTop: "8px", fontSize: "0.8rem", color: "#71717a" }}>
                <div>Start: <strong>{selectedClip.start.toFixed(2)}s</strong></div>
                <div>End: <strong>{selectedClip.end.toFixed(2)}s</strong></div>
                <div>Span: <strong>{(selectedClip.end - selectedClip.start).toFixed(1)}s</strong></div>
              </div>
            </div>

            {/* Prompt Composition Editor */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#e4e4e7" }}>Visual Prompt</label>
              <textarea
                style={{
                  width: "100%",
                  height: "80px",
                  background: "#14151f",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                  padding: "10px",
                  color: "#fff",
                  fontSize: "0.85rem",
                  resize: "none"
                }}
                placeholder="Describe the aesthetic, camera motions, lighting conditions..."
                value={selectedClip.prompt || ""}
                onChange={(e) => updateClip(selectedClip.id, { prompt: e.target.value })}
              />
            </div>

            {/* Model Architecture Selector */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 500, color: "#e4e4e7" }}>Render Engine Model</label>
              <select
                style={{
                  width: "100%",
                  background: "#14151f",
                  border: "1px solid #27272a",
                  borderRadius: "6px",
                  padding: "8px",
                  color: "#fff",
                  fontSize: "0.85rem"
                }}
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
              >
                <option value="ltx-video">LTX-Video (High-Motion Native)</option>
                <option value="stable-video">Stable Video Diffusion</option>
                <option value="procedural">Fallback Procedural Layout</option>
              </select>
            </div>

            {/* Pipeline Feature Controls */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "#14151f", padding: "14px", borderRadius: "8px", border: "1px solid #27272a" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontSize: "0.8rem", color: "#e4e4e7", cursor: "pointer" }} htmlFor="audioToggle">
                  Environmental Foley Audio
                </label>
                <input
                  id="audioToggle"
                  type="checkbox"
                  checked={enableAudio}
                  onChange={(e) => setEnableAudio(e.target.checked)}
                  style={{ width: "16px", height: "16px", accentColor: "#4f46e5" }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#e4e4e7" }}>
                  <span>Motion Intensity</span>
                  <strong>{motionBucket}</strong>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={motionBucket}
                  onChange={(e) => setMotionBucket(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#4f46e5" }}
                />
              </div>
            </div>

            {/* Action Buttons Footer Block */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "auto" }}>
              <button
                type="button"
                onClick={handleGenerateClip}
                disabled={selectedClip.status === "generating" || selectedClip.status === "queued"}
                style={{
                  width: "100%",
                  background: "#4f46e5",
                  border: "none",
                  color: "#fff",
                  padding: "12px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: (selectedClip.status === "generating" || selectedClip.status === "queued") ? "not-allowed" : "pointer",
                  opacity: (selectedClip.status === "generating" || selectedClip.status === "queued") ? 0.6 : 1
                }}
              >
                {selectedClip.status === "generating" ? "Generating..." : "Generate Clip"}
              </button>

              <button
                type="button"
                onClick={handleClearClip}
                style={{
                  width: "100%",
                  background: "#27272a",
                  border: "none",
                  color: "#e4e4e7",
                  padding: "10px",
                  borderRadius: "6px",
                  fontSize: "0.85rem",
                  cursor: "pointer"
                }}
              >
                Clear Clip Context
              </button>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#71717a", fontSize: "0.85rem", textAlign: "center", padding: "20px" }}>
            Select a segment on the track timeline to configure generation parameters.
          </div>
        )}
      </div>

      {/* Persistent Live Monitoring Feed Panel at Base */}
      <QueueStatus />
    </div>
  );
}