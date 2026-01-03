// public/js/paygate-modal-helper.js
// Shared helper to detect paygate_locked errors and show PayGate modal

(function () {
  'use strict';

  /**
   * Check if an error response indicates PayGate is locked
   * @param {Response|Error|object} errOrResponse - Fetch Response, Error, or parsed JSON
   * @returns {boolean} True if PayGate is locked
   */
  function isPaygateLocked(errOrResponse) {
    // Handle Response object
    if (errOrResponse && typeof errOrResponse.json === 'function') {
      // It's a Response - we need to check status and potentially parse JSON
      // But we can't await here, so we'll check status only
      return errOrResponse.status === 403;
    }

    // Handle Error object with response property
    if (errOrResponse && errOrResponse.response) {
      return errOrResponse.response.status === 403;
    }

    // Handle parsed JSON object
    if (errOrResponse && typeof errOrResponse === 'object') {
      return errOrResponse.code === 'paygate_locked' || 
             (errOrResponse.status === 403 && errOrResponse.error === 'PayGate locked');
    }

    return false;
  }

  /**
   * Show PayGate modal with unlock options
   * Creates a standalone modal similar to the one in results-panel.js
   */
  function showPaygateModal() {
    // Get PayGate helper - use same URLs as paygate-helper.js
    const paygate = (typeof window !== 'undefined' && window.__FL_PAYGATE__) || {};
    
    // Fallback to hardcoded URLs if helper not available (same as paygate-helper.js)
    const DAY_PASS_URL = paygate.DAY_PASS_URL || "https://buy.stripe.com/9B600c09y5GU0HS3kn9k405";
    const CORE_MONTHLY_URL = paygate.CORE_MONTHLY_URL || "https://buy.stripe.com/14A7sEaOc8T6aisbQT9k407";

    // Check if already unlocked (might have unlocked via URL params)
    if (paygate.isUnlocked && paygate.isUnlocked()) {
      console.log('[PayGateModal] Already unlocked, closing modal');
      return;
    }

    // Check if modal already exists
    let modalRoot = document.getElementById('fl-paygate-modal-root');
    if (modalRoot) {
      // Modal already exists, just show it
      modalRoot.style.display = 'block';
      return;
    }

    // Create modal root
    modalRoot = document.createElement('div');
    modalRoot.id = 'fl-paygate-modal-root';
    modalRoot.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.75);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    `;

    // Use URLs from above (already set from paygate helper or fallback)

    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
      background: #1a1a2e;
      border-radius: 12px;
      padding: 32px;
      max-width: 500px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      border: 2px solid rgba(139, 92, 246, 0.3);
    `;

    modalContent.innerHTML = `
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="margin: 0 0 12px 0; font-size: 24px; font-weight: 600; color: #dfe3ff;">
          Unlock FinishLine Premium
        </h2>
        <p style="margin: 0; font-size: 14px; color: #b8bdd4; line-height: 1.5;">
          Get full access to AI-powered predictions, OCR extraction, and premium features.
        </p>
      </div>
      <ul style="margin: 0 0 24px 0; padding-left: 24px; text-align: left; color: #b8bdd4; font-size: 14px;">
        <li style="margin-bottom: 8px;">AI-powered OCR extraction from race photos</li>
        <li style="margin-bottom: 8px;">Win/Place/Show predictions with confidence scores</li>
        <li style="margin-bottom: 8px;">Strategy insights and betting recommendations</li>
        <li style="margin-bottom: 8px;">Exotic ticket ideas (Trifecta, Superfecta, etc.)</li>
      </ul>
      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 16px;">
        <a href="${DAY_PASS_URL}" 
           target="_blank" 
           rel="noopener noreferrer"
           style="padding: 12px 24px; background: #8b5cf6; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; transition: background 0.2s;"
           onmouseover="this.style.background='#7c3aed'" 
           onmouseout="this.style.background='#8b5cf6'">
          Unlock Day Pass $7.99
        </a>
        <a href="${CORE_MONTHLY_URL}" 
           target="_blank" 
           rel="noopener noreferrer"
           style="padding: 12px 24px; background: #6b46c1; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block; transition: background 0.2s;"
           onmouseover="this.style.background='#5b21b6'" 
           onmouseout="this.style.background='#6b46c1'">
          Unlock Core $24.99/mo
        </a>
      </div>
      <div style="text-align: center;">
        <button id="fl-paygate-modal-already-paid" 
                style="padding: 10px 20px; background: transparent; border: 1px solid rgba(139, 92, 246, 0.5); color: #dfe3ff; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: background 0.2s;"
                onmouseover="this.style.background='rgba(139, 92, 246, 0.1)'" 
                onmouseout="this.style.background='transparent'">
          I already paid
        </button>
      </div>
      <div style="text-align: center; margin-top: 16px;">
        <button id="fl-paygate-modal-close" 
                style="padding: 8px 16px; background: transparent; border: 1px solid rgba(255, 255, 255, 0.2); color: #b8bdd4; border-radius: 6px; cursor: pointer; font-size: 13px; transition: background 0.2s;"
                onmouseover="this.style.background='rgba(255, 255, 255, 0.1)'" 
                onmouseout="this.style.background='transparent'">
          Close
        </button>
      </div>
    `;

    modalRoot.appendChild(modalContent);
    document.body.appendChild(modalRoot);

    // Wire "I already paid" button
    const alreadyPaidBtn = modalContent.querySelector('#fl-paygate-modal-already-paid');
    if (alreadyPaidBtn) {
      alreadyPaidBtn.addEventListener('click', () => {
        try {
          // Re-check URL params and localStorage
          const result = paygate.checkUrlParams();
          if (result.unlocked || (paygate.isUnlocked && paygate.isUnlocked())) {
            // Close modal and trigger page refresh or callback
            hidePaygateModal();
            // Optionally trigger a custom event for other code to react
            if (typeof window !== 'undefined' && window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('paygate:unlocked'));
            }
            // Show success message
            if (typeof window !== 'undefined' && window.showToast) {
              window.showToast('Access unlocked! You can now use premium features.', 'success');
            } else {
              alert('Access unlocked! You can now use premium features.');
            }
          } else {
            alert('No active subscription found. If you just paid, please wait a moment and try again, or contact support.');
          }
        } catch (err) {
          console.warn('[PayGateModal] "I already paid" error:', err);
          alert('Error checking subscription status. Please try refreshing the page.');
        }
      });
    }

    // Wire close button
    const closeBtn = modalContent.querySelector('#fl-paygate-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        hidePaygateModal();
      });
    }

    // Close on backdrop click
    modalRoot.addEventListener('click', (e) => {
      if (e.target === modalRoot) {
        hidePaygateModal();
      }
    });

    // Close on Escape key
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        hidePaygateModal();
        document.removeEventListener('keydown', escapeHandler);
      }
    };
    document.addEventListener('keydown', escapeHandler);
  }

  /**
   * Hide PayGate modal
   */
  function hidePaygateModal() {
    const modalRoot = document.getElementById('fl-paygate-modal-root');
    if (modalRoot) {
      modalRoot.style.display = 'none';
    }
  }

  /**
   * Handle PayGate locked error from API response
   * Checks if error is paygate_locked and shows modal if needed
   * @param {Response|Error|object} errOrResponse - Fetch Response, Error, or parsed JSON
   * @param {Function} [toastFn] - Optional toast function for error messages
   * @returns {Promise<boolean>} True if PayGate was locked (modal shown), false otherwise
   */
  async function handlePaygateLocked(errOrResponse, toastFn) {
    let isLocked = false;
    let errorData = null;

    // Handle Response object - need to parse JSON
    if (errOrResponse && typeof errOrResponse.json === 'function') {
      try {
        errorData = await errOrResponse.json();
        isLocked = isPaygateLocked(errorData);
      } catch (e) {
        // If JSON parse fails, check status code
        isLocked = errOrResponse.status === 403;
      }
    } else {
      // Handle Error or parsed object
      isLocked = isPaygateLocked(errOrResponse);
      if (errOrResponse && typeof errOrResponse === 'object') {
        errorData = errOrResponse;
      }
    }

    if (isLocked) {
      console.log('[PayGateModal] PayGate locked detected, showing modal');
      showPaygateModal();
      
      // Optional: Show toast message
      if (toastFn && typeof toastFn === 'function') {
        const message = errorData?.message || 'Premium access required to use this feature.';
        toastFn(message, 'warn');
      }
      
      return true;
    }

    return false;
  }

  // Export to window for global access
  if (typeof window !== 'undefined') {
    window.handlePaygateLocked = handlePaygateLocked;
    window.showPaygateModal = showPaygateModal;
    window.hidePaygateModal = hidePaygateModal;
    window.isPaygateLocked = isPaygateLocked;
  }
})();

