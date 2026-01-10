// Diagnostic endpoint to test Redis connectivity (non-sensitive info only)
// GET /api/redis_diag?prefix=fl:predsnap: (optional - scan keys with prefix)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { prefix } = req.query || {};
  
  const result = {
    ok: true,
    redisConfigured: false,
    urlHost: 'missing',
    canWrite: false,
    canRead: false,
    wroteKey: null,
    readBack: false,
    error: null,
    // Prefix scan results (if prefix provided)
    prefixScan: null
  };

  try {
    // Check if Redis env vars are configured
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    result.redisConfigured = Boolean(redisUrl && redisToken);

    if (redisUrl) {
      // Extract hostname only (no secrets)
      try {
        const urlObj = new URL(redisUrl);
        result.urlHost = urlObj.hostname || 'invalid';
      } catch {
        result.urlHost = 'invalid-url';
      }
    }

    if (!result.redisConfigured) {
      return res.status(200).json(result);
    }

    // Test write and read
    const { setex, get, keys } = await import('../../lib/redis.js');
    
    const testKey = `fl:diag:${Date.now()}`;
    const testValue = JSON.stringify({ 
      test: true, 
      timestamp: new Date().toISOString() 
    });

    // Test write (60 second TTL)
    try {
      await setex(testKey, 60, testValue);
      result.canWrite = true;
      result.wroteKey = testKey;
    } catch (writeErr) {
      result.error = `write failed: ${writeErr?.message || String(writeErr)}`;
      return res.status(200).json(result);
    }

    // Test read back
    try {
      const readValue = await get(testKey);
      result.canRead = true;
      result.readBack = readValue === testValue;
    } catch (readErr) {
      result.error = `read failed: ${readErr?.message || String(readErr)}`;
      return res.status(200).json(result);
    }

    // If prefix provided, scan for keys with that prefix
    if (prefix && typeof prefix === 'string' && prefix.trim()) {
      try {
        const pattern = prefix.trim();
        // Ensure pattern ends with * for KEYS command
        const searchPattern = pattern.endsWith('*') ? pattern : `${pattern}*`;
        const matchedKeys = await keys(searchPattern);
        
        // Sort keys (most recent first if timestamps, otherwise alphabetically)
        const sortedKeys = matchedKeys.sort().reverse();
        
        result.prefixScan = {
          prefix: pattern,
          pattern: searchPattern,
          count: matchedKeys.length,
          keys: sortedKeys.slice(0, 20), // First 20 keys (names only, no values)
          truncated: matchedKeys.length > 20
        };
      } catch (scanErr) {
        result.prefixScan = {
          prefix: prefix,
          error: scanErr?.message || String(scanErr)
        };
      }
    }

    return res.status(200).json(result);

  } catch (err) {
    result.ok = false;
    result.error = err?.message || String(err);
    return res.status(500).json(result);
  }
}

