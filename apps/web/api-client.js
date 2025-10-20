/**
 * Safe API client for FinishLine - ALWAYS parses JSON safely, never crashes
 * Handles timeouts, non-JSON responses, and structured errors
 */

const API_BASE = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  ? "http://localhost:8000"
  : "";

/**
 * Safe JSON parser - handles non-JSON responses gracefully
 * @param {Response} res - Fetch response object
 * @returns {Promise<Object>} Parsed JSON or error object
 */
async function safeParseJSON(res) {
  const contentType = res.headers.get("content-type") || "";
  
  // Try to read body as text first
  let text;
  try {
    text = await res.text();
  } catch (e) {
    return {
      ok: false,
      error: "Failed to read response body",
      code: "body_read_error",
      status: res.status
    };
  }
  
  // If empty response, return appropriate error
  if (!text || text.trim() === "") {
    return {
      ok: false,
      error: "Empty response from server",
      code: "empty_response",
      status: res.status
    };
  }
  
  // Try to parse as JSON
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("[API] JSON parse error:", e, "\nRaw:", text.substring(0, 500));
      return {
        ok: false,
        error: "Server returned invalid JSON",
        code: "json_parse_error",
        status: res.status,
        raw: text.substring(0, 200)
      };
    }
  }
  
  // Non-JSON response (likely HTML error page)
  return {
    ok: false,
    error: "Server returned non-JSON response",
    code: "non_json_response",
    status: res.status,
    raw: text.substring(0, 200),
    hint: "Server may have crashed or returned HTML error page"
  };
}

/**
 * POST JSON data to API endpoint with timeout
 * @param {string} url - API endpoint path
 * @param {Object} body - Request body
 * @param {Object} options - Additional options
 * @param {number} options.timeoutSeconds - Request timeout in seconds (default: 30)
 * @param {AbortSignal} options.signal - Optional abort signal
 * @returns {Promise<Object>} API response (always an object with 'ok' field)
 */
async function postJSON(url, body, { timeoutSeconds = 30, signal = null } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  
  // Combine timeout signal with optional external signal
  const combinedSignal = signal || controller.signal;
  
  try {
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    
    const res = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body),
      signal: combinedSignal
    });
    
    clearTimeout(timeoutId);
    
    // Parse response safely
    const data = await safeParseJSON(res);
    
    // Check for error responses
    if (!res.ok) {
      // Server returned error status
      return {
        ok: false,
        error: data.error || data.message || `HTTP ${res.status}`,
        code: data.code || "http_error",
        status: res.status,
        request_id: data.request_id || data.reqId,
        detail: data.detail,
        hint: data.hint,
        ...data
      };
    }
    
    // Server returned 200 but check for ok:false in body
    if (data.ok === false) {
      return {
        ok: false,
        error: data.error || data.message || "Request failed",
        code: data.code || "api_error",
        status: res.status,
        request_id: data.request_id || data.reqId,
        detail: data.detail,
        hint: data.hint,
        ...data
      };
    }
    
    // Success!
    return {
      ok: true,
      ...data
    };
    
  } catch (e) {
    clearTimeout(timeoutId);
    
    if (e.name === "AbortError") {
      return {
        ok: false,
        error: `Request timed out after ${timeoutSeconds}s`,
        code: "timeout",
        hint: "Try again with a smaller image or check your connection"
      };
    }
    
    return {
      ok: false,
      error: `Network error: ${e.message}`,
      code: "network_error",
      hint: "Check your internet connection"
    };
  }
}

/**
 * GET request to API endpoint
 * @param {string} url - API endpoint path
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} API response
 */
async function getJSON(url, { timeoutSeconds = 10 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  
  try {
    const fullUrl = url.startsWith("http") ? url : `${API_BASE}${url}`;
    
    const res = await fetch(fullUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const data = await safeParseJSON(res);
    
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `HTTP ${res.status}`,
        code: data.code || "http_error",
        ...data
      };
    }
    
    return {
      ok: true,
      ...data
    };
    
  } catch (e) {
    clearTimeout(timeoutId);
    
    if (e.name === "AbortError") {
      return {
        ok: false,
        error: `Request timed out after ${timeoutSeconds}s`,
        code: "timeout"
      };
    }
    
    return {
      ok: false,
      error: `Network error: ${e.message}`,
      code: "network_error"
    };
  }
}

/**
 * Show error toast to user
 * @param {string} title - Error title
 * @param {Object} error - Error object from API
 */
function showError(title, error) {
  console.error(`[API Error] ${title}:`, error);
  
  let message = error.error || error.message || "Unknown error";
  
  if (error.hint) {
    message += `\n\n💡 ${error.hint}`;
  }
  
  if (error.request_id || error.reqId) {
    message += `\n\n🔍 Request ID: ${error.request_id || error.reqId}`;
  }
  
  // Show alert (in production, replace with nicer toast)
  alert(`${title}\n\n${message}`);
}

/**
 * Show success toast to user
 * @param {string} message - Success message
 */
function showSuccess(message) {
  console.log(`[API Success] ${message}`);
  
  // Create toast element
  const toast = document.createElement("div");
  toast.className = "toast toast-success";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #22c55e;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 9999;
    font-size: 14px;
    font-weight: 500;
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Export for use in app.js
window.API = {
  postJSON,
  getJSON,
  showError,
  showSuccess
};

