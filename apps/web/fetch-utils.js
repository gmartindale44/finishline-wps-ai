/**
 * Enhanced fetch utilities with retry logic and exponential backoff
 * For resilient API calls with automatic fallback
 */

/**
 * Sleep utility for backoff delays
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Provider fallback chain
 */
const PROVIDER_ORDER = ['websearch', 'stub'];

/**
 * Get next provider in fallback chain
 * @param {string} current - Current provider
 * @returns {string|null} Next provider or null if exhausted
 */
function getNextProvider(current) {
  const index = PROVIDER_ORDER.indexOf(current);
  return PROVIDER_ORDER[index + 1] || null;
}

/**
 * Fetch with automatic retries and exponential backoff
 * @param {string} url - API endpoint
 * @param {Object} options - Fetch options
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @param {number} options.maxRetries - Maximum retry attempts
 * @param {number} options.retryBackoffMs - Initial backoff delay
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}) {
  const {
    timeoutMs = 30000,
    maxRetries = 2,
    retryBackoffMs = 800,
    ...fetchOptions
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Return response even if not ok - let caller handle status codes
      return response;

    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;

      // Don't retry on abort (user cancelled)
      if (error.name === 'AbortError' && attempt === maxRetries) {
        break;
      }

      // Exponential backoff: 800ms, 1600ms, 3200ms, etc.
      if (attempt < maxRetries) {
        const delay = retryBackoffMs * Math.pow(2, attempt);
        console.log(`⏱️ Retry ${attempt + 1}/${maxRetries} after ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Fetch with provider fallback chain
 * Automatically tries next provider if current fails
 * @param {string} url - API endpoint
 * @param {Object} payload - Request payload
 * @param {Object} options - Fetch options
 * @returns {Promise<{data: any, provider: string, requestId: string}>}
 */
async function fetchWithProviderFallback(url, payload, options = {}) {
  const {
    initialProvider = 'websearch',
    stageName = 'operation',
    ...fetchOptions
  } = options;

  let currentProvider = initialProvider;
  let lastError;

  while (currentProvider) {
    try {
      console.log(`🔄 Trying ${stageName} with provider: ${currentProvider}`);

      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          provider: currentProvider
        }),
        ...fetchOptions
      });

      // Extract request ID from headers
      const requestId = response.headers.get('x-request-id') || 
                       response.headers.get('x-vercel-id') || 
                       'unknown';

      // Parse response
      const text = await response.text();
      let data;
      
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        // Try to salvage JSON from text
        data = coerceJSON(text);
      }

      // Check if response indicates success
      if (response.ok && data?.ok !== false) {
        console.log(`✅ ${stageName} succeeded with ${currentProvider}`);
        return {
          data,
          provider: currentProvider,
          requestId,
          status: response.status
        };
      }

      // Server returned error - try next provider
      const errorMsg = data?.error || `HTTP ${response.status}`;
      console.warn(`⚠️ ${currentProvider} failed: ${errorMsg}`);
      lastError = new Error(errorMsg);
      lastError.data = data;
      lastError.requestId = requestId;
      lastError.status = response.status;

      // Move to next provider
      currentProvider = getNextProvider(currentProvider);
      if (currentProvider) {
        console.log(`🔁 Falling back to ${currentProvider}...`);
      }

    } catch (error) {
      console.error(`❌ ${currentProvider} error:`, error.message);
      lastError = error;
      
      // Move to next provider
      currentProvider = getNextProvider(currentProvider);
      if (currentProvider) {
        console.log(`🔁 Falling back to ${currentProvider}...`);
      }
    }
  }

  // All providers exhausted
  throw lastError;
}

/**
 * Attempt to coerce non-JSON text into valid JSON
 * @param {string} text - Raw text response
 * @returns {Object} Parsed JSON or fallback object
 */
function coerceJSON(text) {
  // Try standard parse
  try {
    return JSON.parse(text);
  } catch {}

  // Try to extract JSON object/array
  const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }

  // Try to fix common JSON errors (unquoted keys)
  const cleaned = text
    .replace(/(\w+):/g, '"$1":')
    .replace(/,(\s*[}\]])/g, '$1');
  
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Give up, return wrapper
  return {
    ok: false,
    error: 'Failed to parse server response',
    code: 'parse_error',
    raw: text.substring(0, 500)
  };
}

/**
 * Format error for user display
 * @param {Error} error - Error object
 * @param {string} stageName - Name of operation
 * @returns {string} Formatted error message
 */
function formatError(error, stageName = 'Operation') {
  let message = `${stageName} failed: ${error.message || 'Unknown error'}`;
  
  if (error.requestId) {
    message += `\n\nRequest ID: ${error.requestId}`;
  }
  
  if (error.data?.hint) {
    message += `\n\nHint: ${error.data.hint}`;
  }
  
  if (error.data?.how_to_fix) {
    message += `\n\nHow to fix: ${error.data.how_to_fix}`;
  }
  
  return message;
}

// Export for use in main app
window.FetchUtils = {
  fetchWithRetry,
  fetchWithProviderFallback,
  coerceJSON,
  formatError,
  getNextProvider,
  PROVIDER_ORDER
};

