/**
 * Modern Extract handler using new API and UI utilities
 * Replaces the legacy extractFromPhotos function
 */

// Guard against multiple simultaneous extracts
let extractInProgress = false;

/**
 * Handle Extract from Photos button click
 * Uses: ImageCompress, API, and UI utilities for reliability
 */
async function handleExtractPhotos() {
  // Prevent duplicate requests
  if (extractInProgress) {
    console.warn("[Extract] Already in progress, ignoring");
    window.UI.toast("Extraction already in progress", "warning");
    return;
  }
  
  // Get button and input
  const btn = document.getElementById("btnExtract") || document.getElementById("btn-extract");
  const input = document.getElementById("photoFiles") || document.getElementById("photo-input");
  
  if (!input || !input.files || input.files.length === 0) {
    window.UI.toast("Please select images first", "warning");
    return;
  }
  
  const files = Array.from(input.files);
  
  // Quick validation
  const validation = window.ImageCompress.quickValidate(files);
  if (!validation.valid) {
    window.API.showError("Invalid Images", { error: validation.error });
    return;
  }
  
  // Show warnings if any
  if (validation.warnings && validation.warnings.length > 0) {
    console.warn("[Extract] Warnings:", validation.warnings);
    validation.warnings.forEach(w => window.UI.toast(w, "warning", 4000));
  }
  
  extractInProgress = true;
  
  try {
    // Set button to busy state
    window.UI.setBusy(btn, "Compressing...");
    
    // Compress images (with progress simulation)
    const stopProgress = window.UI.simulateProgress(btn, 3);
    
    let processedImages;
    try {
      processedImages = await window.ImageCompress.processFiles(files, ({ fileIndex, totalFiles, filename }) => {
        console.log(`[Extract] Processing ${fileIndex + 1}/${totalFiles}: ${filename}`);
        const progress = ((fileIndex + 1) / totalFiles) * 30;
        window.UI.setProgress(btn, progress);
      });
    } catch (e) {
      stopProgress();
      window.API.showError("Image Compression Failed", {
        error: e.message,
        hint: "Try reducing image size or using fewer images"
      });
      return;
    }
    
    stopProgress();
    window.UI.setProgress(btn, 40);
    window.UI.setBusy(btn, "Extracting...");
    
    // Build payload
    const images_b64 = processedImages.map(img => img.dataURL);
    
    // Call OCR API with timeout
    const response = await window.API.postJSON(
      "/api/finishline/photo_extract_openai_b64",
      { images_b64 },
      { timeoutSeconds: 60 }  // Allow 60s for multi-image OCR
    );
    
    window.UI.setProgress(btn, 90);
    
    // Handle response
    if (!response.ok) {
      window.API.showError("OCR Failed", response);
      window.UI.resetButton(btn);
      return;
    }
    
    // Extract horses from response
    const horses = response.data?.horses || response.horses || [];
    
    if (horses.length === 0) {
      window.UI.toast("No horses found in images", "warning");
      console.warn("[Extract] Server response:", response);
      window.UI.resetButton(btn);
      return;
    }
    
    // Populate form
    console.log(`[Extract] Populating ${horses.length} horses`);
    
    // Use existing populateFormFromParsed function (keep compatibility)
    if (typeof window.populateFormFromParsed === "function") {
      await window.populateFormFromParsed(horses);
    } else {
      console.error("[Extract] populateFormFromParsed not found");
    }
    
    // Mark as done
    window.UI.setDone(btn, "Extracted");
    window.UI.toast(`✅ Extracted ${horses.length} horses`, "success");
    
    console.log("[Extract] Success:", {
      images: images_b64.length,
      horses: horses.length,
      request_id: response.request_id
    });
    
  } catch (e) {
    console.error("[Extract] Unexpected error:", e);
    window.API.showError("Extraction Failed", {
      error: e.message,
      hint: "Please try again or use fewer/smaller images"
    });
    window.UI.resetButton(btn);
  } finally {
    extractInProgress = false;
  }
}

/**
 * Handle Analyze button click
 */
async function handleAnalyze() {
  const btn = document.getElementById("btnAnalyze") || document.getElementById("btn-analyze");
  
  // Get horses from form (use existing function)
  const horses = typeof window.gatherFormHorses === "function" 
    ? window.gatherFormHorses() 
    : [];
  
  if (horses.length === 0) {
    window.UI.toast("Please add horses first", "warning");
    return;
  }
  
  // Get race context
  const raceContext = {
    raceDate: document.getElementById("raceDate")?.value || "",
    track: document.getElementById("raceTrack")?.value || document.getElementById("track")?.value || "",
    surface: document.getElementById("raceSurface")?.value || document.getElementById("surface")?.value || "dirt",
    distance: document.getElementById("raceDistance")?.value || document.getElementById("distance")?.value || ""
  };
  
  window.UI.setBusy(btn, "Analyzing...");
  const stopProgress = window.UI.simulateProgress(btn, 45);
  
  try {
    const response = await window.API.postJSON(
      "/api/finishline/research_predict",
      {
        horses,
        race_context: raceContext,
        useResearch: true,
        provider: "stub",  // Use stub for reliability (can be changed to websearch when ready)
        timeout_ms: 45000
      },
      { timeoutSeconds: 50 }
    );
    
    stopProgress();
    
    if (!response.ok) {
      window.API.showError("Analysis Failed", response);
      window.UI.resetButton(btn);
      return;
    }
    
    // Store analysis results for Predict
    window.ANALYSIS_RESULTS = response;
    
    // Mark as done
    window.UI.setDone(btn, "Analyzed");
    window.UI.toast("✅ Analysis complete", "success");
    
    // Enable Predict button if present
    const predictBtn = document.getElementById("btnPredict") || document.getElementById("btn-predict");
    if (predictBtn) {
      predictBtn.disabled = false;
    }
    
    console.log("[Analyze] Success:", response);
    
  } catch (e) {
    stopProgress();
    console.error("[Analyze] Error:", e);
    window.API.showError("Analysis Failed", {
      error: e.message
    });
    window.UI.resetButton(btn);
  }
}

/**
 * Handle Predict button click
 */
async function handlePredict() {
  const btn = document.getElementById("btnPredict") || document.getElementById("btn-predict");
  
  // Get horses from form
  const horses = typeof window.gatherFormHorses === "function"
    ? window.gatherFormHorses()
    : [];
  
  if (horses.length === 0) {
    window.UI.toast("Please add horses first", "warning");
    return;
  }
  
  // Get race context
  const raceContext = {
    raceDate: document.getElementById("raceDate")?.value || "",
    track: document.getElementById("raceTrack")?.value || document.getElementById("track")?.value || "",
    surface: document.getElementById("raceSurface")?.value || document.getElementById("surface")?.value || "dirt",
    distance: document.getElementById("raceDistance")?.value || document.getElementById("distance")?.value || ""
  };
  
  window.UI.setBusy(btn, "Predicting...");
  const stopProgress = window.UI.simulateProgress(btn, 5);
  
  try {
    const response = await window.API.postJSON(
      "/api/finishline/predict",
      {
        horses,
        race_context: raceContext,
        prior_analysis: window.ANALYSIS_RESULTS  // Use cached analysis if available
      },
      { timeoutSeconds: 30 }
    );
    
    stopProgress();
    
    if (!response.ok) {
      window.API.showError("Prediction Failed", response);
      window.UI.resetButton(btn);
      return;
    }
    
    // Mark as done
    window.UI.setDone(btn, "Predicted");
    window.UI.toast("✅ Predictions ready", "success");
    
    // Call existing render function if present
    if (typeof window.renderPredictions === "function") {
      window.renderPredictions(response.predictions || response);
    } else {
      console.warn("[Predict] renderPredictions function not found");
      console.log("[Predict] Results:", response.predictions || response);
    }
    
  } catch (e) {
    stopProgress();
    console.error("[Predict] Error:", e);
    window.API.showError("Prediction Failed", {
      error: e.message
    });
    window.UI.resetButton(btn);
  }
}

// Wire up buttons on load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireUpButtons);
} else {
  wireUpButtons();
}

function wireUpButtons() {
  const btnExtract = document.getElementById("btnExtract") || document.getElementById("btn-extract");
  const btnAnalyze = document.getElementById("btnAnalyze") || document.getElementById("btn-analyze");
  const btnPredict = document.getElementById("btnPredict") || document.getElementById("btn-predict");
  
  if (btnExtract && !btnExtract.__wired) {
    btnExtract.__wired = true;
    btnExtract.addEventListener("click", handleExtractPhotos);
    console.log("[Extract] Wired up Extract button");
  }
  
  if (btnAnalyze && !btnAnalyze.__wired) {
    btnAnalyze.__wired = true;
    btnAnalyze.addEventListener("click", handleAnalyze);
    console.log("[Analyze] Wired up Analyze button");
  }
  
  if (btnPredict && !btnPredict.__wired) {
    btnPredict.__wired = true;
    btnPredict.addEventListener("click", handlePredict);
    console.log("[Predict] Wired up Predict button");
  }
}

// Export for testing
window.FinishLineHandlers = {
  handleExtractPhotos,
  handleAnalyze,
  handlePredict
};

