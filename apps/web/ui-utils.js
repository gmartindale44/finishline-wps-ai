/**
 * UI utilities for FinishLine - Progress bars, button states, and visual feedback
 */

/**
 * Set button to busy state with optional progress bar
 * @param {HTMLElement} btn - Button element
 * @param {string} label - Loading label (e.g., "Extracting...")
 */
function setBusy(btn, label) {
  if (!btn) return;
  
  // Store original state
  btn.dataset.originalLabel = btn.textContent;
  btn.dataset.originalDisabled = btn.disabled;
  
  // Update button
  btn.disabled = true;
  btn.classList.add("is-busy");
  btn.textContent = label;
  
  // Reset progress
  btn.style.setProperty("--progress", "0%");
}

/**
 * Update button progress (0-100)
 * @param {HTMLElement} btn - Button element
 * @param {number} percent - Progress percentage (0-100)
 */
function setProgress(btn, percent) {
  if (!btn) return;
  
  const pct = Math.max(0, Math.min(100, percent));
  btn.style.setProperty("--progress", `${pct}%`);
  
  // Update text with percentage
  const originalLabel = btn.dataset.originalLabel || btn.textContent.split(" ")[0];
  btn.textContent = `${originalLabel} ${pct}%`;
}

/**
 * Mark button as done (success state)
 * @param {HTMLElement} btn - Button element
 * @param {string} successLabel - Optional success label
 */
function setDone(btn, successLabel = null) {
  if (!btn) return;
  
  btn.disabled = false;
  btn.classList.remove("is-busy");
  btn.classList.add("is-done");
  
  const label = successLabel || btn.dataset.originalLabel || "Done";
  btn.innerHTML = `${label} <span class="ok-check">✓</span>`;
  
  // Reset progress
  btn.style.setProperty("--progress", "100%");
}

/**
 * Reset button to original state
 * @param {HTMLElement} btn - Button element
 */
function resetButton(btn) {
  if (!btn) return;
  
  const originalLabel = btn.dataset.originalLabel;
  const originalDisabled = btn.dataset.originalDisabled === "true";
  
  btn.disabled = originalDisabled;
  btn.classList.remove("is-busy", "is-done");
  
  if (originalLabel) {
    btn.textContent = originalLabel;
  }
  
  // Reset progress
  btn.style.setProperty("--progress", "0%");
  
  // Clear data attributes
  delete btn.dataset.originalLabel;
  delete btn.dataset.originalDisabled;
}

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type: "info", "success", "error", "warning"
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
function toast(message, type = "info", duration = 3000) {
  const colors = {
    info: "#3b82f6",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b"
  };
  
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  el.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    z-index: 9999;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(el);
  
  setTimeout(() => {
    el.style.animation = "slideOut 0.3s ease-out";
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/**
 * Create animated progress bar for long operations
 * @param {number} durationSeconds - Expected duration
 * @param {HTMLElement} container - Container element
 * @returns {Object} Progress controller with update() and complete() methods
 */
function createProgressBar(durationSeconds, container) {
  const bar = document.createElement("div");
  bar.className = "progress-bar";
  bar.style.cssText = `
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 8px;
  `;
  
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  fill.style.cssText = `
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6);
    width: 0%;
    transition: width 0.3s ease;
  `;
  
  bar.appendChild(fill);
  container.appendChild(bar);
  
  let currentProgress = 0;
  let interval = null;
  
  // Auto-increment to simulate progress
  const increment = 100 / (durationSeconds * 10); // Update every 100ms
  interval = setInterval(() => {
    currentProgress = Math.min(95, currentProgress + increment);
    fill.style.width = `${currentProgress}%`;
  }, 100);
  
  return {
    update(percent) {
      currentProgress = Math.max(0, Math.min(100, percent));
      fill.style.width = `${currentProgress}%`;
    },
    
    complete() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      currentProgress = 100;
      fill.style.width = "100%";
      setTimeout(() => {
        bar.remove();
      }, 500);
    },
    
    error() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      fill.style.background = "#ef4444";
      setTimeout(() => {
        bar.remove();
      }, 1000);
    }
  };
}

/**
 * Simulate progress for operations without real progress data
 * @param {HTMLElement} btn - Button to update
 * @param {number} estimatedSeconds - Estimated duration
 * @returns {function} Stop function to call when operation completes
 */
function simulateProgress(btn, estimatedSeconds = 10) {
  let progress = 0;
  const increment = 100 / (estimatedSeconds * 4); // Update every 250ms
  
  const interval = setInterval(() => {
    progress = Math.min(95, progress + increment);
    setProgress(btn, progress);
  }, 250);
  
  return function stop() {
    clearInterval(interval);
  };
}

/**
 * Add CSS for progress bars and animations
 */
function injectStyles() {
  if (document.getElementById("finishline-ui-styles")) return;
  
  const style = document.createElement("style");
  style.id = "finishline-ui-styles";
  style.textContent = `
    .is-busy {
      opacity: 0.7;
      cursor: wait;
      position: relative;
    }
    
    .is-busy::after {
      content: "";
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      width: var(--progress, 0%);
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      transition: width 0.3s ease;
    }
    
    .is-done {
      background: #22c55e !important;
    }
    
    .ok-check {
      display: inline-block;
      margin-left: 6px;
      font-weight: bold;
      color: white;
      animation: checkPop 0.3s ease-out;
    }
    
    @keyframes checkPop {
      0% { transform: scale(0); }
      50% { transform: scale(1.2); }
      100% { transform: scale(1); }
    }
    
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `;
  
  document.head.appendChild(style);
}

// Inject styles on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", injectStyles);
} else {
  injectStyles();
}

// Export for use in app.js
window.UI = {
  setBusy,
  setProgress,
  setDone,
  resetButton,
  toast,
  createProgressBar,
  simulateProgress
};

