export function SidebarEmpty() {
  return (
    <>
      <div className="empty-title">No region selected</div>
      <div className="empty-hint">Click a region on the timeline to configure or generate.</div>

      <div className="label" style={{ marginBottom: 8 }}>Keyboard</div>
      <div className="kbd-list">
        <div className="row">
          <span>Play / pause</span>
          <span className="kbd">Space</span>
        </div>
        <div className="row">
          <span>Split at playhead</span>
          <span className="kbd">S</span>
        </div>
        <div className="row">
          <span>Merge with right</span>
          <span className="kbd">M</span>
        </div>
        <div className="row">
          <span>Rewind</span>
          <span className="kbd">Home</span>
        </div>
        <div className="row">
          <span>Deselect</span>
          <span className="kbd">Esc</span>
        </div>
        <div className="row">
          <span>Zoom in</span>
          <span className="kbd">=</span>
        </div>
        <div className="row">
          <span>Zoom out</span>
          <span className="kbd">-</span>
        </div>
        <div className="row">
          <span>Fit zoom</span>
          <span className="kbd">0</span>
        </div>
      </div>
    </>
  );
}
