// public/js/paygate-helper.js - PayGate helper for localStorage and URL param handling
// Fail-closed design: all errors default to locked state (premium stays locked)
//
// QUICK SELF-TEST INSTRUCTIONS:
// 1. Set FAMILY_UNLOCK_TOKEN in Vercel env vars
// 2. Visit /api/paygate-token - should return JS with token version
// 3. Visit ?family=1&token=<TOKEN> - should unlock and log version match
// 4. Change FAMILY_UNLOCK_TOKEN in Vercel, redeploy
// 5. Refresh page - should log "Family access revoked (token rotated)" and lock
// 6. Paid unlocks (?paid=1&plan=day) should NOT be affected by token rotation

(function () {
  'use strict';

  const STORAGE_KEY = 'fl:paygate:access';
  const BYPASS_KEYS = ['FLTEST2025']; // Array for easy rotation

  const DAY_PASS_URL = "https://buy.stripe.com/9B600c09y5GU0HS3kn9k405";
  const CORE_MONTHLY_URL = "https://buy.stripe.com/14A7sEaOc8T6aisbQT9k407";

  // Check if unlocked (with expiry validation)
  // FAIL CLOSED: If token script failed to load or token is missing, stay locked
  function isUnlocked() {
    try {
      // Get enforcement flag (OFF by default)
      const enforceValue = typeof window !== 'undefined' ? window.__PAYGATE_ENFORCE__ : undefined;
      const enforceEnvRaw = typeof window !== 'undefined' ? window.__PAYGATE_ENFORCE_ENV__ : undefined;
      const enforceEnabled = enforceValue === true;
      
      // TEST MODE: Bypass paygate if enabled via environment variable (OFF by default)
      // Test mode is set by /api/paygate-token.js which reads NEXT_PUBLIC_PAYGATE_TEST_MODE env var
      const testModeValue = typeof window !== 'undefined' ? window.__PAYGATE_TEST_MODE__ : undefined;
      const testModeEnvRaw = typeof window !== 'undefined' ? window.__PAYGATE_TEST_MODE_ENV__ : undefined;
      const testModeEnabled = testModeValue === true;
      
      if (typeof console !== 'undefined' && console.log) {
        console.log('[PayGate] Config check:', { 
          testModeValue: testModeValue, 
          testModeEnvRaw: testModeEnvRaw,
          testModeEnabled: testModeEnabled,
          enforceValue: enforceValue,
          enforceEnvRaw: enforceEnvRaw,
          enforceEnabled: enforceEnabled,
          testModeType: typeof testModeValue,
          enforceType: typeof enforceValue,
          windowHasTestMode: typeof window !== 'undefined' && typeof window.__PAYGATE_TEST_MODE__ !== 'undefined',
          windowHasEnforce: typeof window !== 'undefined' && typeof window.__PAYGATE_ENFORCE__ !== 'undefined'
        });
      }
      
      // If enforcement is OFF, preserve current behavior (test mode bypass works)
      if (!enforceEnabled) {
        if (testModeEnabled) {
          if (typeof console !== 'undefined' && console.log) {
            console.log('[PayGate] TEST MODE enabled (enforcement OFF) - bypassing paygate checks');
          }
          return true; // Test mode: always unlocked when enforcement is OFF
        }
      } else {
        // Enforcement is ON: require valid unlock marker even if test mode is enabled
        if (testModeEnabled) {
          if (typeof console !== 'undefined' && console.log) {
            console.log('[PayGate] Enforcement ON - test mode ignored, checking unlock marker');
          }
          // Continue to unlock marker check below
        }
      }
      
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        // SSR or no localStorage - fail closed (locked)
        if (typeof console !== 'undefined' && console.log) {
          console.log('[PayGate] isUnlocked: false (no window/localStorage)');
        }
        return false;
      }
      
      // Check if token version script loaded (token version is safe to expose)
      const tokenVersionLoaded = typeof window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ !== 'undefined';
      const hasTokenVersion = window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ !== null && window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ !== undefined;
      
      if (typeof console !== 'undefined' && console.log) {
        console.log('[PayGate] Token status:', {
          tokenVersionPresent: tokenVersionLoaded,
          hasTokenVersion
        });
      }
      
      // Fail closed: if token version script didn't load, stay locked
      if (!tokenVersionLoaded) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[PayGate] Token version script not loaded - staying locked (fail-closed)');
        }
        return false;
      }
      
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        if (typeof console !== 'undefined' && console.log) {
          console.log('[PayGate] isUnlocked: false (no stored access)');
        }
        return false;
      }
      
      const data = JSON.parse(stored);
      const now = Date.now();
      const storedPlan = data.plan || null;
      
      // Check expiry
      if (data.expiry && data.expiry < now) {
        localStorage.removeItem(STORAGE_KEY);
        if (typeof console !== 'undefined' && console.log) {
          console.log('[PayGate] isUnlocked: false (expired)');
        }
        return false;
      }
      
      // Token rotation check: If plan is "family", verify token version matches
      if (storedPlan === 'family') {
        const tokenVersionLoaded = typeof window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ !== 'undefined';
        const expectedVersion = tokenVersionLoaded ? window.__FL_FAMILY_UNLOCK_TOKEN_VERSION__ : null;
        const storedVersion = data.tokenVersion || null;
        const familyVersionMatch = expectedVersion !== null && storedVersion === expectedVersion;
        
        if (typeof console !== 'undefined' && console.log) {
          console.log('[PayGate] Family token version check:', {
            storedPlan,
            tokenVersionPresent: tokenVersionLoaded,
            familyVersionMatch,
            storedVersion: storedVersion ? storedVersion.substring(0, 4) + '...' : null,
            expectedVersion: expectedVersion ? expectedVersion.substring(0, 4) + '...' : null
          });
        }
        
        // Fail closed: If token version missing OR mismatch, revoke family access
        if (!tokenVersionLoaded || !familyVersionMatch) {
          localStorage.removeItem(STORAGE_KEY);
          if (typeof console !== 'undefined' && console.warn) {
            if (!tokenVersionLoaded) {
              console.warn('[PayGate] Family access revoked (token version missing)');
            } else {
              console.warn('[PayGate] Family access revoked (token rotated)');
            }
          }
          return false;
        }
      }
      
      if (typeof console !== 'undefined' && console.log) {
        console.log('[PayGate] isUnlocked: true (valid access)', {
          storedPlan: storedPlan || 'paid'
        });
      }
      return true;
    } catch (err) {
      // Fail closed: any error = locked
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[PayGate] isUnlocked() error, defaulting to locked (fail-closed):', err?.message || err);
      }
      return false;
    }
  }

  // Unlock for specified duration
  function unlock(durationMs, plan = null, tokenVersion = null) {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return false; // Can't unlock without localStorage
      }
      
      const expiry = Date.now() + durationMs;
      const data = {
        expiry,
        unlockedAt: Date.now(),
        durationMs,
        plan: plan || null,
        tokenVersion: tokenVersion || null
      };
      
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('[PayGate] unlock() error:', err?.message || err);
      return false; // Fail-open: return false but don't throw
    }
  }

  // Check URL params and handle unlock/cleanup
  function checkUrlParams() {
    try {
      if (typeof window === 'undefined' || !window.location) {
        return false;
      }
      
      const url = new URL(window.location.href);
      const success = url.searchParams.get('success');
      const paid = url.searchParams.get('paid');
      const plan = url.searchParams.get('plan');
      const bypass = url.searchParams.get('bypass');
      const key = url.searchParams.get('key');
      const family = url.searchParams.get('family');
      const token = url.searchParams.get('token');
      
      let unlocked = false;
      let bypassUsed = false;
      
      // Handle family unlock (server-side token validation)
      if (family === '1' && token) {
        try {
          // Validate token via server endpoint (timing-safe comparison)
          fetch('/api/family-unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          })
          .then(response => {
            // Check Content-Type before parsing JSON (prevent HTML error pages)
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              throw new Error(`Expected JSON, got ${contentType || 'unknown'}`);
            }
            if (!response.ok) {
              return response.json().then(data => {
                throw new Error(data?.error || `HTTP ${response.status}`);
              });
            }
            return response.json();
          })
          .then(data => {
            if (data.ok && data.tokenVersion) {
              // Get configurable family unlock duration (default 365 days if not set)
              const familyUnlockDays = typeof window.__FL_FAMILY_UNLOCK_DAYS__ !== 'undefined' && window.__FL_FAMILY_UNLOCK_DAYS__ !== null
                ? parseInt(window.__FL_FAMILY_UNLOCK_DAYS__, 10)
                : 365;
              const duration = familyUnlockDays * 24 * 60 * 60 * 1000;
              if (unlock(duration, 'family', data.tokenVersion)) {
                unlocked = true;
                // Clean URL
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('family');
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, '', cleanUrl);
              }
            } else {
              // Fail closed: invalid token - stay locked
              if (typeof console !== 'undefined' && console.warn) {
                console.warn('[PayGate] Family unlock failed: invalid token (fail-closed)');
              }
            }
          })
          .catch(err => {
            // Fail closed: network error - stay locked
            if (typeof console !== 'undefined' && console.warn) {
              console.warn('[PayGate] Family unlock error (ignored, staying locked):', err?.message || err);
            }
          });
        } catch (err) {
          // Fail-closed: ignore family unlock errors (stay locked)
          console.warn('[PayGate] Family unlock error (ignored, staying locked):', err?.message || err);
        }
      }
      
      // Handle bypass key
      if (!unlocked && bypass === '1' && key) {
        if (BYPASS_KEYS.includes(key)) {
          const duration = 30 * 24 * 60 * 60 * 1000; // 30 days
          if (unlock(duration)) {
            setBypassUsed(); // Mark bypass as used for badge display
            unlocked = true;
            bypassUsed = true;
          }
          
          // Clean URL
          url.searchParams.delete('bypass');
          url.searchParams.delete('key');
          window.history.replaceState({}, '', url);
        }
      }
      
      // Handle Stripe return and URL unlock params
      if (!unlocked && (success === '1' || paid === '1')) {
        let duration;
        let planName = null;
        if (plan === 'day') {
          duration = 24 * 60 * 60 * 1000; // 24 hours
          planName = 'day';
        } else if (plan === 'family') {
          duration = 180 * 24 * 60 * 60 * 1000; // 180 days
          planName = 'family';
        } else {
          duration = 30 * 24 * 60 * 60 * 1000; // 30 days (default to Core)
          planName = 'core';
        }
        
        // Paid unlocks (day/core) don't require token version (not affected by token rotation)
        // Family plan requires token validation (handled separately via ?family=1&token=...)
        // But if plan=family is used here, we still unlock (for URL-based family unlock)
        if (unlock(duration, planName, null)) {
          unlocked = true;
          if (typeof console !== 'undefined' && console.log) {
            const expiry = Date.now() + duration;
            console.log('[PayGate] Unlocked via URL params:', {
              plan: planName,
              durationDays: Math.round(duration / (24 * 60 * 60 * 1000)),
              expiry: new Date(expiry).toISOString(),
              expiryTimestamp: expiry
            });
          }
        }
        
        // Clean URL
        url.searchParams.delete('success');
        url.searchParams.delete('paid');
        url.searchParams.delete('plan');
        window.history.replaceState({}, '', url);
      }
      
      return { unlocked, bypassUsed };
    } catch (err) {
      // Fail-open: ignore errors
      console.warn('[PayGate] checkUrlParams() error:', err?.message || err);
      return { unlocked: false, bypassUsed: false };
    }
  }

  // Get bypass usage status (for badge display)
  function getBypassUsed() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return false;
      }
      
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      
      const data = JSON.parse(stored);
      return data.bypassUsed === true;
    } catch {
      return false;
    }
  }

  // Mark bypass as used (called after successful bypass unlock)
  function setBypassUsed() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return;
      }
      
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        data.bypassUsed = true;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      }
    } catch {
      // Ignore errors
    }
  }

  // Public API
  window.__FL_PAYGATE__ = {
    isUnlocked,
    unlock,
    checkUrlParams,
    getBypassUsed,
    setBypassUsed,
    DAY_PASS_URL,
    CORE_MONTHLY_URL
  };
})();

