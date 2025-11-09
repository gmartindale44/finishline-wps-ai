/**
 * INTEGRATION EXAMPLE: How to use the new apiPost helper
 * 
 * This file shows how to wire up Extract/Analyze/Predict buttons
 * using the new net.js helper for consistent error handling.
 */

// ======================================================================
// EXTRACT from Photos
// ======================================================================
async function handleExtract() {
  const endpoint = "/api/finishline/photo_extract_openai_b64";
  
  // Get images (your existing code to collect base64 images)
  const images = await getImagesFromForm();  // Your implementation
  
  if (!images || images.length === 0) {
    alert("Please select images first");
    return;
  }
  
  // Show progress (your existing UI code)
  showProgress("Extracting...");
  
  // Call API using safe helper
  const response = await window.apiPost(endpoint, {
    images: images  // Note: new schema uses "images", not "images_b64"
  });
  
  // Store debug info
  window.storeRequestDebug(endpoint, response);
  
  // Handle response
  if (response.ok) {
    // Success! response.data contains { spans, raw, count }
    const { spans, count } = response.data;
    console.log(`✅ Extracted ${count} items`);
    
    // Populate form (your existing code)
    populateFormWithSpans(spans);
    
    // Show success
    hideProgress();
    showSuccessCheck();
  } else {
    // Error - show toast with request ID
    window.showErrorToast(response.error, response.requestId);
    hideProgress();
  }
}

// ======================================================================
// ANALYZE
// ======================================================================
async function handleAnalyze() {
  const endpoint = "/api/finishline/research_predict?action=analyze";
  
  // Get horses from form
  const horses = await getHorsesFromForm();  // Your implementation
  
  if (!horses || horses.length === 0) {
    alert("Please add horses first");
    return;
  }
  
  showProgress("Analyzing...");
  
  const response = await window.apiPost(endpoint, {
    horses: horses,
    race_context: {
      track: document.getElementById("track")?.value,
      date: document.getElementById("date")?.value,
      // ... other fields
    },
    timeout_ms: 30000  // 30s budget for analyze
  });
  
  window.storeRequestDebug(endpoint, response);
  
  if (response.ok) {
    console.log("✅ Analysis complete");
    
    // Store results for predict
    window.ANALYSIS_RESULTS = response.data;
    
    // Enable predict button
    document.getElementById("btn-predict").disabled = false;
    
    hideProgress();
    showSuccessCheck();
  } else {
    window.showErrorToast(response.error, response.requestId);
    hideProgress();
    
    // Optionally show retry button for transient errors
    if (response.error.code === "timeout" || response.error.code === "ocr_provider_error") {
      showRetryButton(handleAnalyze);
    }
  }
}

// ======================================================================
// PREDICT
// ======================================================================
async function handlePredict() {
  const endpoint = "/api/finishline/research_predict?action=predict";
  
  const horses = await getHorsesFromForm();
  
  if (!horses || horses.length === 0) {
    alert("Please add horses first");
    return;
  }
  
  showProgress("Predicting...");
  
  const response = await window.apiPost(endpoint, {
    horses: horses,
    race_context: {
      /* ... */
    },
    prior_analysis: window.ANALYSIS_RESULTS,  // Optional: use cached analysis
    timeout_ms: 50000  // 50s budget for predict
  });
  
  window.storeRequestDebug(endpoint, response);
  
  if (response.ok) {
    console.log("✅ Predictions ready");
    
    // Display predictions (your existing code)
    displayPredictions(response.data);
    
    hideProgress();
    showSuccessCheck();
  } else {
    window.showErrorToast(response.error, response.requestId);
    hideProgress();
  }
}

// ======================================================================
// HELPER: Show error with consistent UI
// ======================================================================
function showErrorWithRequestId(error, requestId) {
  // This is now handled by window.showErrorToast, but you can customize:
  const message = `${error.message}\n\nCode: ${error.code}\nRequest ID: ${requestId}`;
  
  // Option 1: Alert (simple)
  alert(message);
  
  // Option 2: Toast (better UX) - already provided by net.js
  window.showErrorToast(error, requestId);
  
  // Option 3: In-page error div
  const errorDiv = document.getElementById("error-message");
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
  }
}

// ======================================================================
// NOTES
// ======================================================================
/*
  Key changes from before:
  
  1. Use `window.apiPost(url, body)` instead of raw fetch()
     - Always returns { ok, data, error, requestId }
     - Never throws on non-JSON responses
     - Validates envelope structure
  
  2. Check `response.ok` instead of `res.ok`
     - response.ok === true → success, use response.data
     - response.ok === false → error, use response.error
  
  3. Always store debug info:
     window.storeRequestDebug(endpoint, response)
  
  4. Show errors with request ID:
     window.showErrorToast(response.error, response.requestId)
  
  5. No more:
     - try/catch for JSON.parse()
     - Manual alert with "OCR returned non-JSON"
     - Checking res.status manually
  
  The helper does all of that for you!
*/

