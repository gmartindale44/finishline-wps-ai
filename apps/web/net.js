/**
 * Safe network helper for FinishLine - NEVER assumes JSON blindly.
 * Always returns a consistent envelope shape for UI consumption.
 */

/**
 * Safely parse response as JSON, with fallback for non-JSON responses.
 * @param {Response} res - Fetch Response object
 * @returns {Promise<{ok: boolean, json: object|null, raw: string}>}
 */
async function safeJson(res) {
  try {
    const txt = await res.text();
    try {
      const parsed = JSON.parse(txt);
      return { ok: true, json: parsed, raw: txt };
    } catch {
      // JSON parse failed
      return { ok: false, json: null, raw: txt };
    }
  } catch (e) {
    // Failed to read response body
    return { ok: false, json: null, raw: `Failed to read response: ${e.message}` };
  }
}

/**
 * POST JSON to API endpoint with consistent error handling.
 * Returns a normalized envelope that UI can safely consume.
 * 
 * @param {string} url - API endpoint URL
 * @param {object} body - Request payload
 * @returns {Promise<{ok: boolean, data?: any, error?: {code, message, details?}, requestId: string}>}
 */
async function apiPost(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    
    // Try to parse as JSON
    const parsed = await safeJson(res);
    
    // Handle non-JSON response (HTML error page, plain text, etc.)
    if (!parsed.ok) {
      console.error("[apiPost] Non-JSON response:", {
        url,
        status: res.status,
        raw: parsed.raw.slice(0, 500)
      });
      
      // Synthesize an ApiErr-like shape for UI consistency
      return {
        ok: false,
        error: {
          code: "non_json",
          message: "Server returned non-JSON response",
          details: parsed.raw.slice(0, 500)
        },
        requestId: res.headers.get("x-request-id") || res.headers.get("X-Request-Id") || ""
      };
    }
    
    const payload = parsed.json;
    
    // Ensure envelope has 'ok' field
    if (typeof payload?.ok !== "boolean") {
      console.error("[apiPost] Malformed envelope:", payload);
      return {
        ok: false,
        error: {
          code: "bad_envelope",
          message: "Malformed server response",
          details: "Missing 'ok' field in response"
        },
        requestId: res.headers.get("x-request-id") || res.headers.get("X-Request-Id") || ""
      };
    }
    
    // Success case (ok: true)
    if (payload.ok === true) {
      return {
        ok: true,
        data: payload.data,
        requestId: payload.requestId || ""
      };
    }
    
    // Error case (ok: false)
    return {
      ok: false,
      error: payload.error || { code: "unknown", message: "Unknown error" },
      requestId: payload.requestId || ""
    };
    
  } catch (e) {
    // Network error, timeout, etc.
    console.error("[apiPost] Network error:", e);
    return {
      ok: false,
      error: {
        code: "network_error",
        message: `Network error: ${e.message}`,
        details: e.toString()
      },
      requestId: ""
    };
  }
}

/**
 * Show error toast to user with request ID for debugging.
 * @param {object} error - Error object from apiPost response
 * @param {string} requestId - Request ID for debugging
 */
function showErrorToast(error, requestId) {
  const codeStr = error.code ? ` (code: ${error.code}` : "";
  const idStr = requestId ? `, id: ${requestId}` : "";
  const closeStr = (codeStr || idStr) ? ")" : "";
  
  const message = `${error.message}${codeStr}${idStr}${closeStr}`;
  
  // Create toast element
  const toast = document.createElement("div");
  toast.className = "toast toast-error";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #ef4444;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 9999;
    font-size: 14px;
    max-width: 400px;
  `;
  
  document.body.appendChild(toast);
  
  // Auto-remove after 5 seconds
  setTimeout(() => {
    toast.remove();
  }, 5000);
  
  // Also log to console for debugging
  console.error("[Error]", message, { error, requestId });
}

/**
 * Store last request details for debug UI.
 */
window.LAST_REQUEST = {
  id: "",
  endpoint: "",
  status: "",
  payload: null
};

function storeRequestDebug(endpoint, response) {
  window.LAST_REQUEST = {
    id: response.requestId || "",
    endpoint: endpoint,
    status: response.ok ? "ok" : "error",
    code: response.ok ? null : response.error?.code,
    payload: response
  };
}

// Export for global use
window.apiPost = apiPost;
window.showErrorToast = showErrorToast;
window.storeRequestDebug = storeRequestDebug;

