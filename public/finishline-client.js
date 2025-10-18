/* ======================================================================
   File: /public/finishline-client.js
   Enhanced client-side integration for Analyze & Predict functionality
   ---------------------------------------------------------------------- */
(function () {
  const $ = (sel) => document.querySelector(sel);

  const btnAnalyze = $("#analyzeBtn");
  const btnPredict = $("#predictBtn");
  const badge = $("#ocrStateBadge"); // Updated to match our badge ID

  // Enhanced entry collection that works with our dynamic horse rows
  const getEntries = () => {
    const rows = document.querySelectorAll(".horse-row");
    const out = [];
    rows.forEach((r) => {
      const inputs = r.querySelectorAll("input");
      if (inputs.length >= 4) {
        const name = inputs[0].value?.trim();
        const odds = inputs[1].value?.trim();
        const jockey = inputs[2].value?.trim();
        const trainer = inputs[3].value?.trim();

        if (name) {
          out.push({ 
            name, 
            mlOdds: odds || null, 
            jockey: jockey || null, 
            trainer: trainer || null 
          });
        }
      }
    });
    return out;
  };

  // Enhanced badge management with proper CSS classes
  function setBusy(label) {
    if (badge) {
      badge.textContent = label;
      badge.className = "badge badge-working";
    }
  }

  function setReady(label) {
    if (badge) {
      badge.textContent = label;
      badge.className = "badge badge-ok";
    }
  }

  function setError(label) {
    if (badge) {
      badge.textContent = label;
      badge.className = "badge badge-bad";
    }
  }

  function setIdle(label = "Idle") {
    if (badge) {
      badge.textContent = label;
      badge.className = "badge";
    }
  }

  // Enhanced analyze function with better error handling
  async function analyze() {
    const entries = getEntries();
    if (!entries.length) {
      alert("No horses found on the form.");
      return;
    }

    if (btnAnalyze) {
      btnAnalyze.disabled = true;
      btnAnalyze.textContent = "Analyzing… ⏳";
    }
    setBusy("Analyzing…");

    try {
      const meta = {
        date: $("#raceDate")?.value?.trim() || null,
        track: $("#raceTrack")?.value?.trim() || null,
        surface: $("#raceSurface")?.value || null,
        distance: $("#raceDistance")?.value?.trim() || null,
      };

      const resp = await fetch("/api/research_predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, entries }),
      });
      
      const json = await resp.json();
      
      if (!resp.ok || !json?.ok) {
        console.error("Analyze failed:", json);
        setError("Analyze failed");
        const errorMsg = json?.error?.message || resp.statusText || "Unknown error";
        alert(`Analyze error: ${errorMsg}`);
        return;
      }
      
      // Store analyzed data for predict step
      window.__FL_ANALYZED__ = json.data.analyzed;
      console.log("Analysis complete:", json.data);
      setReady("Ready to predict");
      
    } catch (e) {
      console.error("Analyze error:", e);
      setError("Analyze failed");
      alert("Analyze error — see console for details.");
    } finally {
      if (btnAnalyze) {
        btnAnalyze.disabled = false;
        btnAnalyze.textContent = "Analyze Photos with AI";
      }
    }
  }

  // Enhanced predict function with comprehensive results display
  async function predict() {
    const entries = getEntries();
    const analyzed = window.__FL_ANALYZED__;
    
    if (!entries.length) {
      alert("No horses found on the form.");
      return;
    }
    if (!Array.isArray(analyzed) || !analyzed.length) {
      alert("Please analyze first.");
      return;
    }

    if (btnPredict) {
      btnPredict.disabled = true;
      btnPredict.textContent = "Predicting… ⏳";
    }
    setBusy("Predicting…");

    try {
      const resp = await fetch("/api/predict_wps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, analyzed }),
      });
      
      const json = await resp.json();
      
      if (!resp.ok || !json?.ok) {
        console.error("Predict failed:", json);
        setError("Predict failed");
        const errorMsg = json?.error?.message || resp.statusText || "Unknown error";
        alert(`Predict error: ${errorMsg}`);
        return;
      }

      setReady("Prediction ready");
      console.log("PREDICTION:", json.data);
      
      // Enhanced results display
      const data = json.data;
      const picks = data.picks;
      const ranking = data.ranking;
      
      let resultText = `🏆 WIN: ${picks.win.name}`;
      if (picks.win.odds) resultText += ` (${picks.win.odds})`;
      
      resultText += `\n🥈 PLACE: ${picks.place.name}`;
      if (picks.place.odds) resultText += ` (${picks.place.odds})`;
      
      resultText += `\n🥉 SHOW: ${picks.show.name}`;
      if (picks.show.odds) resultText += ` (${picks.show.odds})`;
      
      if (data.rationale) {
        resultText += `\n\n📊 Analysis:\n${data.rationale}`;
      }
      
      // Show detailed ranking in console
      console.log("Full ranking:", ranking);
      
      alert(resultText);
      
    } catch (e) {
      console.error("Predict error:", e);
      setError("Predict failed");
      alert("Predict error — see console for details.");
    } finally {
      if (btnPredict) {
        btnPredict.disabled = false;
        btnPredict.textContent = "Predict W/P/S";
      }
    }
  }

  // Initialize when DOM is ready
  function initialize() {
    if (btnAnalyze) {
      btnAnalyze.addEventListener("click", analyze);
    }
    if (btnPredict) {
      btnPredict.addEventListener("click", predict);
    }
    
    // Set initial state
    setIdle();
  }

  // Wait for DOM to be ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }

  // Expose functions globally for debugging
  window.FL_analyze = analyze;
  window.FL_predict = predict;
  window.FL_getEntries = getEntries;

})();
