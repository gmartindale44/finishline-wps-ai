// public/js/paygate-helper.js - PayGate helper for localStorage and URL param handling
// Fail-open design: all errors default to unlocked state

(function () {
  'use strict';

  const STORAGE_KEY = 'fl:paygate:access';
  const BYPASS_KEYS = ['FLTEST2025']; // Array for easy rotation

  const DAY_PASS_URL = "https://buy.stripe.com/9B600c09y5GU0HS3kn9k405";
  const CORE_MONTHLY_URL = "https://buy.stripe.com/14A7sEaOc8T6aisbQT9k407";

  // Check if unlocked (with expiry validation)
  function isUnlocked() {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return true; // Fail-open: SSR or no localStorage = unlocked
      }
      
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return false;
      }
      
      const data = JSON.parse(stored);
      const now = Date.now();
      
      // Check expiry
      if (data.expiry && data.expiry < now) {
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      
      return true;
    } catch (err) {
      // Fail-open: any error = unlocked
      console.warn('[PayGate] isUnlocked() error, defaulting to unlocked:', err?.message || err);
      return true;
    }
  }

  // Unlock for specified duration
  function unlock(durationMs) {
    try {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return false; // Can't unlock without localStorage
      }
      
      const expiry = Date.now() + durationMs;
      const data = {
        expiry,
        unlockedAt: Date.now(),
        durationMs
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
      
      // Handle family unlock (environment variable token)
      if (family === '1' && token) {
        try {
          const expectedToken = (typeof window !== 'undefined' && window.__FL_FAMILY_UNLOCK_TOKEN__) || null;
          // Debug log (temporary, guarded - does not print token value)
          if (typeof console !== 'undefined' && console.log) {
            console.log('[PayGate] Family unlock check:', {
              hasExpectedToken: expectedToken !== null && expectedToken !== undefined,
              tokenLength: expectedToken ? String(expectedToken).length : 0,
              providedTokenLength: token ? String(token).length : 0
            });
          }
          if (expectedToken && token === expectedToken) {
            // Unlock for 365 days (1 year) for family access
            const duration = 365 * 24 * 60 * 60 * 1000;
            if (unlock(duration)) {
              // Store plan as "family" for tracking
              try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                  const data = JSON.parse(stored);
                  data.plan = 'family';
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                }
              } catch {
                // Ignore errors storing plan
              }
              unlocked = true;
            }
            
            // Clean URL
            url.searchParams.delete('family');
            url.searchParams.delete('token');
            window.history.replaceState({}, '', url);
          }
        } catch (err) {
          // Fail-open: ignore family unlock errors
          console.warn('[PayGate] Family unlock error (ignored):', err?.message || err);
        }
      }
      
      // Handle bypass key
      if (!unlocked && bypass === '1' && key) {
      // Handle bypass key
      if (bypass === '1' && key) {
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
      
      // Handle Stripe return
      if (!unlocked && (success === '1' || paid === '1')) {
        let duration;
        if (plan === 'day') {
          duration = 24 * 60 * 60 * 1000; // 24 hours
        } else {
          duration = 30 * 24 * 60 * 60 * 1000; // 30 days (default to Core)
        }
        
        unlock(duration);
        unlocked = true;
        
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

