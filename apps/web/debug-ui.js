/**
 * Debug UI for FinishLine - Shows last request details for support/debugging.
 * Only visible in development or when ?debug=1 is in URL.
 */

function createDebugUI() {
  // Check if debug mode is enabled
  const urlParams = new URLSearchParams(window.location.search);
  const isDebug = urlParams.get("debug") === "1" || window.location.hostname === "localhost";
  
  if (!isDebug) {
    return;
  }
  
  // Create debug accordion
  const debugContainer = document.createElement("div");
  debugContainer.id = "debug-accordion";
  debugContainer.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 10px;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.9);
    color: #00ff00;
    font-family: 'Courier New', monospace;
    font-size: 12px;
    border: 1px solid #00ff00;
    border-radius: 4px;
    max-width: 400px;
  `;
  
  debugContainer.innerHTML = `
    <details>
      <summary style="padding: 8px; cursor: pointer; user-select: none; font-weight: bold;">
        🐛 Debug Info
      </summary>
      <div id="debug-content" style="padding: 8px; border-top: 1px solid #00ff00;">
        <div style="margin-bottom: 8px;">
          <strong>Last Request ID:</strong>
          <code id="debug-request-id" style="display: block; background: rgba(255,255,255,0.1); padding: 4px; margin-top: 4px;">-</code>
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Last Endpoint:</strong>
          <code id="debug-endpoint" style="display: block; background: rgba(255,255,255,0.1); padding: 4px; margin-top: 4px;">-</code>
        </div>
        <div style="margin-bottom: 8px;">
          <strong>Last Status:</strong>
          <code id="debug-status" style="display: block; background: rgba(255,255,255,0.1); padding: 4px; margin-top: 4px;">-</code>
        </div>
        <button id="copy-debug-btn" style="
          background: #00ff00;
          color: black;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: bold;
          width: 100%;
        ">Copy for Support</button>
      </div>
    </details>
  `;
  
  document.body.appendChild(debugContainer);
  
  // Wire up copy button
  const copyBtn = document.getElementById("copy-debug-btn");
  copyBtn.addEventListener("click", () => {
    const debugData = {
      requestId: window.LAST_REQUEST?.id || "",
      endpoint: window.LAST_REQUEST?.endpoint || "",
      status: window.LAST_REQUEST?.status || "",
      code: window.LAST_REQUEST?.code || null,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      payload: window.LAST_REQUEST?.payload || null
    };
    
    const jsonStr = JSON.stringify(debugData, null, 2);
    
    // Copy to clipboard
    navigator.clipboard.writeText(jsonStr).then(() => {
      copyBtn.textContent = "✓ Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy for Support";
      }, 2000);
    }).catch(err => {
      console.error("Copy failed:", err);
      // Fallback: show in alert
      alert("Copy this for support:\n\n" + jsonStr);
    });
  });
  
  // Update debug UI whenever LAST_REQUEST changes
  const updateDebugUI = () => {
    const req = window.LAST_REQUEST || {};
    
    document.getElementById("debug-request-id").textContent = req.id || "-";
    document.getElementById("debug-endpoint").textContent = req.endpoint || "-";
    
    const statusEl = document.getElementById("debug-status");
    if (req.status === "ok") {
      statusEl.textContent = "✓ OK";
      statusEl.style.color = "#00ff00";
    } else if (req.status === "error") {
      statusEl.textContent = `✗ ERROR (${req.code || "unknown"})`;
      statusEl.style.color = "#ff0000";
    } else {
      statusEl.textContent = "-";
      statusEl.style.color = "#00ff00";
    }
  };
  
  // Poll for changes (simple approach)
  setInterval(updateDebugUI, 500);
  
  console.log("[Debug UI] Enabled. Last request details available in debug panel.");
}

// Initialize on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createDebugUI);
} else {
  createDebugUI();
}

