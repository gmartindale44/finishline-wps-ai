/**
 * Client-side caching utilities for analysis results
 * Prevents redundant research calls for the same race context
 */

/**
 * Generate stable hash from race context
 * @param {Object} context - Race context object
 * @returns {string} SHA-256 hash
 */
async function stableHash(context) {
  const str = JSON.stringify(context, Object.keys(context).sort());
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get cached analysis result
 * @param {string} key - Cache key (context hash)
 * @param {number} ttlMs - Time to live in milliseconds (default: 3 hours)
 * @returns {Object|null} Cached result or null if expired/missing
 */
function getAnalyzeCache(key, ttlMs = 3 * 60 * 60 * 1000) {
  try {
    const cached = localStorage.getItem(`analyze:${key}`);
    if (!cached) return null;
    
    const parsed = JSON.parse(cached);
    const age = Date.now() - (parsed.cachedAt || 0);
    
    if (age > ttlMs) {
      // Expired - remove
      localStorage.removeItem(`analyze:${key}`);
      return null;
    }
    
    console.log(`📦 Cache hit: analyze:${key} (age: ${(age / 1000 / 60).toFixed(1)}min)`);
    return parsed.data;
  } catch (e) {
    console.warn('Cache read error:', e);
    return null;
  }
}

/**
 * Set cached analysis result
 * @param {string} key - Cache key (context hash)
 * @param {Object} result - Analysis result to cache
 */
function setAnalyzeCache(key, result) {
  try {
    const entry = {
      cachedAt: Date.now(),
      data: result
    };
    localStorage.setItem(`analyze:${key}`, JSON.stringify(entry));
    console.log(`💾 Cached: analyze:${key}`);
  } catch (e) {
    console.warn('Cache write error:', e);
  }
}

/**
 * Clear all analyze caches
 */
function clearAnalyzeCaches() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('analyze:')) {
        keys.push(key);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
    console.log(`🗑️ Cleared ${keys.length} analyze caches`);
  } catch (e) {
    console.warn('Cache clear error:', e);
  }
}

/**
 * Build race context from form inputs
 * @returns {Object} Race context object
 */
function buildRaceContext() {
  // Read race metadata
  const date = document.getElementById('raceDate')?.value || '';
  const track = document.getElementById('raceTrack')?.value || '';
  const surface = document.getElementById('raceSurface')?.value || '';
  const distance = document.getElementById('raceDistance')?.value || '';
  
  // Read horses (reuse existing readHorses if available)
  const horses = typeof window.readHorses === 'function' 
    ? window.readHorses() 
    : [];
  
  return {
    date,
    track,
    surface,
    distance,
    horses: horses.map(h => ({
      name: h.name || '',
      mlOdds: h.odds || '',
      jockey: h.jockey || '',
      trainer: h.trainer || ''
    }))
  };
}

/**
 * Check if context has changed (for cache invalidation)
 * @param {string} oldHash - Previous context hash
 * @returns {Promise<boolean>} True if context changed
 */
async function hasContextChanged(oldHash) {
  const currentContext = buildRaceContext();
  const currentHash = await stableHash(currentContext);
  return oldHash !== currentHash;
}

// Export utilities
window.CacheUtils = {
  stableHash,
  getAnalyzeCache,
  setAnalyzeCache,
  clearAnalyzeCaches,
  buildRaceContext,
  hasContextChanged
};

// Global state for current context
window.FL = window.FL || {};
window.FL.currentContextHash = null;

