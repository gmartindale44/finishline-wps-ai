(function () {
  const $ = (s) => document.querySelector(s);
  const btnUpload = $("#photo-upload-btn") || $("#choose-photo-btn") || $("button:has-text('Choose Photos')");
  const btnAnalyze = $("#btn-analyze") || $("button:has-text('Analyze Photos')");
  const btnPredict = $("#btn-predict") || $("button:has-text('Predict')");
  const badge = $("#status-badge") || document.createElement("span");

  let uploadedBase64 = null;

  async function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function uploadPhoto() {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*,.pdf";
      input.click();
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        badge.textContent = "Extracting…";
        const base64 = await toBase64(file);
        uploadedBase64 = base64;

        console.log("[FinishLine] Uploading OCR image…");
        const resp = await fetch("/api/photo_extract_openai_b64", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
        });
        const json = await resp.json();

        if (!resp.ok || !json?.ok) {
          console.error("[FinishLine OCR] Error:", json);
          alert(`OCR failed: ${json?.error || resp.statusText}`);
          badge.textContent = "OCR failed";
          return;
        }

        console.log("[FinishLine] OCR Extracted:", json.data.entries);
        badge.textContent = `Parsed ${json.data.entries.length} horses`;

        // Auto-populate table
        const tableBody = document.querySelector("#horse-list") || document.querySelector("[data-horse-list]");
        if (tableBody && Array.isArray(json.data.entries)) {
          tableBody.innerHTML = "";
          json.data.entries.forEach((e, i) => {
            const row = document.createElement("tr");
            row.dataset.horseRow = i;
            row.innerHTML = `
              <td>${e.name || ""}</td>
              <td>${e.odds || ""}</td>
              <td>${e.jockey || ""}</td>
              <td>${e.trainer || ""}</td>
            `;
            tableBody.appendChild(row);
          });
        }
      };
    } catch (err) {
      console.error("[FinishLine Upload] Failed:", err);
      alert("Upload failed. Check console for details.");
    }
  }

  async function analyzePhotos() {
    badge.textContent = "Analyzing…";
    const entries = Array.from(document.querySelectorAll("[data-horse-row]")).map((r) => {
      const tds = r.querySelectorAll("td");
      return {
        name: tds[0]?.textContent?.trim(),
        odds: tds[1]?.textContent?.trim(),
        jockey: tds[2]?.textContent?.trim(),
        trainer: tds[3]?.textContent?.trim(),
      };
    });
    if (!entries.length) return alert("No entries to analyze.");
    const resp = await fetch("/api/research_predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    const json = await resp.json();
    if (!resp.ok || !json?.ok) {
      console.error("[FinishLine Analyze] Failed:", json);
      alert(`Analyze error: ${json?.error?.message || resp.statusText}`);
      badge.textContent = "Analyze failed";
      return;
    }
    window.__FL_ANALYZED__ = json.data.analyzed;
    badge.textContent = "Ready to predict";
  }

  async function predictWPS() {
    badge.textContent = "Predicting…";
    const entries = Array.from(document.querySelectorAll("[data-horse-row]")).map((r) => {
      const tds = r.querySelectorAll("td");
      return {
        name: tds[0]?.textContent?.trim(),
        odds: tds[1]?.textContent?.trim(),
        jockey: tds[2]?.textContent?.trim(),
        trainer: tds[3]?.textContent?.trim(),
      };
    });
    const analyzed = window.__FL_ANALYZED__;
    if (!analyzed) return alert("Run Analyze first.");
    const resp = await fetch("/api/predict_wps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries, analyzed }),
    });
    const json = await resp.json();
    if (!resp.ok || !json?.ok) {
      console.error("[FinishLine Predict] Failed:", json);
      alert(`Predict error: ${json?.error?.message || resp.statusText}`);
      badge.textContent = "Predict failed";
      return;
    }
    badge.textContent = "Prediction ready!";
    const { win, place, show } = json.data.picks;
    alert(`🏆 WIN: ${win.name}\n🥈 PLACE: ${place.name}\n🥉 SHOW: ${show.name}`);
  }

  btnUpload?.addEventListener("click", uploadPhoto);
  btnAnalyze?.addEventListener("click", analyzePhotos);
  btnPredict?.addEventListener("click", predictWPS);
})();