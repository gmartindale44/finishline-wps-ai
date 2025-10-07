/**
 * FinishLine AI - Frontend Application
 * Handles form submission, API calls, and result display
 */

// API Configuration
const LOCAL_API = "http://localhost:8000";
const SAME_ORIGIN = "";
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const API_BASE = isLocal ? LOCAL_API : SAME_ORIGIN;

// --- Photo picker state ---
let PICKED_FILES = []; // array of File
const MAX_FILES = 6;

function updatePhotoCount() {
  const el = document.getElementById("photo-count");
  if (el) el.textContent = `${PICKED_FILES.length} / ${MAX_FILES} selected`;
}

function renderThumbs() {
  const wrap = document.getElementById("thumbs");
  if (!wrap) return;
  wrap.innerHTML = "";
  PICKED_FILES.forEach((file, idx) => {
    const item = document.createElement("div");
    item.className = "thumb";

    if (file.type === "application/pdf") {
      item.innerHTML = `
        <div class="pdf-badge">PDF</div>
        <div class="thumb-meta">
          <span class="name" title="${file.name}">${file.name}</span>
          <button class="remove" aria-label="Remove">✕</button>
        </div>`;
    } else {
      const url = URL.createObjectURL(file);
      item.innerHTML = `
        <img src="${url}" alt="${file.name}" />
        <div class="thumb-meta">
          <span class="name" title="${file.name}">${file.name}</span>
          <button class="remove" aria-label="Remove">✕</button>
        </div>`;
      item.querySelector("img").onload = () => URL.revokeObjectURL(url);
    }
    item.querySelector(".remove").onclick = () => {
      PICKED_FILES.splice(idx, 1);
      updatePhotoCount();
      renderThumbs();
    };
    wrap.appendChild(item);
  });
  updatePhotoCount();
}

function addPickedFiles(list) {
  const incoming = Array.from(list || []);
  for (const f of incoming) {
    if (PICKED_FILES.length >= MAX_FILES) break;
    if (!/^image\/|application\/pdf$/.test(f.type)) continue;
    PICKED_FILES.push(f);
  }
  updatePhotoCount();
  renderThumbs();
}

function parseHorsesFromText(txt) {
  // Normalize and split lines
  const lines = txt
    .replace(/\r/g, "\n")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const horses = [];
  // Basic patterns: names (letters, spaces, apostrophes) and odds like 5-2, 3/1, 10-1, or 8-5
  const nameLike = /^[A-Za-z][A-Za-z''\-.\s]+$/;
  const mlLike = /^(\d{1,2}\s*[-/]\s*\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2})$/;

  // Walk lines; if line looks like a horse name and the next token looks like odds, pair them
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    // Skip obvious headers / columns
    if (/^(horse|jockey|trainer|win|place|show|race|post|purse|claiming|dirt|turf|fast|firm|good|allowance)/i.test(L)) continue;
    if (/^\d+$/.test(L)) continue; // isolated program number cells

    const isName = nameLike.test(L) && L.length >= 3 && L.length <= 40;

    // Look ahead for odds on same line or next line
    let odds = "";
    // same line token check
    const sameTokens = L.split(/\s+/);
    for (const t of sameTokens) {
      if (mlLike.test(t)) { odds = t; break; }
    }
    if (!odds && i + 1 < lines.length && mlLike.test(lines[i+1])) {
      odds = lines[i+1];
      i++; // consume next line as odds
    }

    if (isName) {
      // Avoid duplicates by name
      if (!horses.some(h => h.name.toLowerCase() === L.toLowerCase())) {
        horses.push({ checked: true, name: L, odds });
      }
    }
  }

  // Fallback: if nothing matched, try extracting proper-case words sequences as names
  if (horses.length === 0) {
    const joined = lines.join(" ");
    const m = joined.match(/[A-Z][a-zA-Z'']+(?:\s+[A-Z][a-zA-Z'']+){0,3}/g);
    if (m) {
      Array.from(new Set(m)).slice(0, 12).forEach(n => horses.push({ checked:true, name:n, odds:"" }));
    }
  }
  return horses.slice(0, 12);
}

async function ocrImagesWithTesseract(files) {
  const T = window.Tesseract;
  if (!T) throw new Error("OCR engine not loaded");
  // Only images (skip PDFs for now)
  const imgs = Array.from(files || []).filter(f => /^image\//.test(f.type));
  const results = [];
  for (const f of imgs) {
    const url = URL.createObjectURL(f);
    try {
      const { data } = await T.recognize(url, "eng", { logger: () => {} });
      if (data && data.text) results.push(data.text);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return results.join("\n");
}

function renderOcrReview(list) {
  const box = document.getElementById("ocr-review");
  const wrap = document.getElementById("ocr-items");
  if (!box || !wrap) return;
  wrap.innerHTML = "";
  list.forEach((h, idx) => {
    const row = document.createElement("div");
    row.className = "ocr-row";
    row.innerHTML = `
      <input type="checkbox" ${h.checked ? "checked" : ""} />
      <input type="text" class="name" value="${h.name}" />
      <input type="text" class="odds" placeholder="e.g., 5-2" value="${h.odds || ""}" />
    `;
    const [chk, nameEl, oddsEl] = row.querySelectorAll("input");
    chk.onchange = () => { h.checked = chk.checked; };
    nameEl.oninput = () => { h.name = nameEl.value; };
    oddsEl.oninput = () => { h.odds = oddsEl.value; };
    wrap.appendChild(row);
  });
  box.classList.remove("hidden");
}

// Inserts checked items into Horse rows (append or update blanks)
function insertIntoForm(extracted) {
  const rows = document.querySelectorAll(".horse-row"); // assuming each horse row has class set; if not, we will map by inputs
  function addRow() {
    const btn = document.querySelector("button#add-horse") || Array.from(document.querySelectorAll("button")).find(b => /add horse/i.test(b.textContent));
    if (btn) btn.click();
  }
  function setRow(row, name, odds) {
    const inputs = row.querySelectorAll("input");
    const nameInput = Array.from(inputs).find(i => /horse/i.test(i.placeholder || "") || /name/i.test(i.name || ""));
    const oddsInput = Array.from(inputs).find(i => /odds/i.test(i.placeholder || "") || /odds/i.test(i.name || ""));
    if (nameInput) nameInput.value = name;
    if (oddsInput && odds) oddsInput.value = odds;
  }

  let current = Array.from(document.querySelectorAll("[data-horse-row], .horse-row"));
  extracted.filter(h => h.checked && h.name.trim()).forEach((h, idx) => {
    if (idx >= current.length) { addRow(); current = Array.from(document.querySelectorAll("[data-horse-row], .horse-row")); }
    setRow(current[idx], h.name.trim(), (h.odds || "").trim());
  });
}

// DOM Elements
const raceForm = document.getElementById('raceForm');
const horsesContainer = document.getElementById('horsesContainer');
const addHorseBtn = document.getElementById('addHorseBtn');
const predictBtn = document.getElementById('predictBtn');
const photoPredictBtn = document.getElementById('photoPredictBtn');
const photoSection = document.getElementById('photoSection');
const photoInput = document.getElementById('photoInput');
const selectPhotosBtn = document.getElementById('selectPhotosBtn');
const photoPreview = document.getElementById('photoPreview');
const loadingSection = document.getElementById('loadingSection');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const errorText = document.getElementById('errorText');

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    console.log('FinishLine AI initialized');
    
    // Set dynamic year in footer
    const yearEl = document.getElementById("year"); 
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('raceDate').value = today;
    
    // Event listeners
    addHorseBtn.addEventListener('click', addHorseEntry);
    predictBtn.addEventListener('click', handlePredict);
    
    // Photo picker event listeners
    const chooseBtn = document.getElementById("choose-files");
    const input = document.getElementById("photo-input");
    const drop = document.getElementById("drop-zone");
    const analyzeBtn = document.getElementById("analyze-photos-btn");

    if (chooseBtn && input) {
        chooseBtn.onclick = () => input.click();
        input.onchange = () => addPickedFiles(input.files);
    }

    if (drop) {
        ["dragenter","dragover"].forEach(evt =>
            drop.addEventListener(evt, e => {
                e.preventDefault(); e.stopPropagation();
                drop.classList.add("dragging");
            })
        );
        ["dragleave","drop"].forEach(evt =>
            drop.addEventListener(evt, e => {
                e.preventDefault(); e.stopPropagation();
                drop.classList.remove("dragging");
            })
        );
        drop.addEventListener("drop", e => {
            addPickedFiles(e.dataTransfer.files);
        });
    }

    if (analyzeBtn) {
        analyzeBtn.addEventListener("click", async () => {
            // if none selected, open the chooser
            if (PICKED_FILES.length === 0) {
                const inputEl = document.getElementById("photo-input");
                if (inputEl) inputEl.click();
                return;
            }
            try {
                const form = new FormData();
                PICKED_FILES.slice(0, MAX_FILES).forEach(f => form.append("files", f, f.name));
                const res = await fetch(`${API_BASE}/api/finishline/photo_predict`, {
                    method: "POST",
                    body: form
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                // reuse existing render routine for W/P/S
                displayResults(data);
            } catch (err) {
                showError(`Photo analysis failed: ${err.message || err}`);
            }
        });
    }

    // OCR event listeners
    const ocrBtn = document.getElementById("ocr-extract-btn");
    const insertBtn = document.getElementById("ocr-insert");
    if (ocrBtn) {
        ocrBtn.addEventListener("click", async () => {
            if (PICKED_FILES.length === 0) {
                const inputEl = document.getElementById("photo-input");
                if (inputEl) inputEl.click();
                return;
            }
            try {
                showLoading();
                const text = await ocrImagesWithTesseract(PICKED_FILES);
                const horses = parseHorsesFromText(text);
                if (horses.length === 0) {
                    showError("OCR didn't find any horse names—try a clearer image or zoom.");
                    return;
                }
                renderOcrReview(horses);
                // keep last extraction in memory for insert
                window.__OCR_LAST__ = horses;
            } catch (e) {
                showError(`OCR failed: ${e.message || e}`);
            } finally {
                hideLoading();
            }
        });
    }
    if (insertBtn) {
        insertBtn.addEventListener("click", () => {
            const list = window.__OCR_LAST__ || [];
            insertIntoForm(list);
            const box = document.getElementById("ocr-review");
            if (box) box.classList.add("hidden");
        });
    }
    
    // Initial horse entry
    addHorseEntry();
});

/**
 * Add a new horse entry to the form
 */
function addHorseEntry() {
    const horseEntry = document.createElement('div');
    horseEntry.className = 'horse-entry';
    horseEntry.innerHTML = `
        <div class="form-row">
            <div class="form-group">
                <label>Horse Name</label>
                <input type="text" name="horseName" placeholder="e.g., Thunderstride" required>
            </div>
            <div class="form-group">
                <label>Odds</label>
                <input type="text" name="odds" placeholder="e.g., 5-2" required>
            </div>
            <div class="form-group">
                <label>Bankroll</label>
                <input type="number" name="bankroll" placeholder="1000" value="1000" min="1" required>
            </div>
            <div class="form-group">
                <label>Kelly Fraction</label>
                <input type="number" name="kellyFraction" placeholder="0.25" value="0.25" min="0" max="1" step="0.01" required>
            </div>
        </div>
        <button type="button" class="btn-secondary remove-horse" style="margin-top: 0.5rem;">Remove Horse</button>
    `;
    
    horsesContainer.appendChild(horseEntry);
    
    // Add remove functionality
    const removeBtn = horseEntry.querySelector('.remove-horse');
    removeBtn.addEventListener('click', () => {
        if (horsesContainer.children.length > 1) {
            horseEntry.remove();
        }
    });
}

/**
 * Handle photo selection
 */
function handlePhotoSelection(event) {
    const files = Array.from(event.target.files);
    
    if (files.length > 6) {
        showError('Maximum 6 photos allowed');
        return;
    }
    
    // Clear previous preview
    photoPreview.innerHTML = '';
    
    // Show preview for each file
    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.alt = file.name;
                photoPreview.appendChild(img);
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Show photo section
    photoSection.style.display = 'block';
}

/**
 * Handle regular prediction
 */
async function handlePredict() {
    try {
        const horses = collectHorseData();
        
        if (horses.length === 0) {
            showError('Please add at least one horse');
            return;
        }
        
        showLoading();
        hideError();
        hideResults();
        
        const response = await fetch(`${API_BASE}/api/finishline/predict`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ horses })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayResults(data);
        
    } catch (error) {
        console.error('Prediction error:', error);
        showError(`Prediction failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * Handle photo prediction
 */
async function handlePhotoPredict() {
    try {
        const files = Array.from(photoInput.files);
        
        if (files.length === 0) {
            showError('Please select at least one photo');
            return;
        }
        
        showLoading();
        hideError();
        hideResults();
        
        const formData = new FormData();
        files.forEach(file => {
            formData.append('files', file);
        });
        
        const response = await fetch(`${API_BASE}/api/finishline/photo_predict`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        displayResults(data);
        
    } catch (error) {
        console.error('Photo prediction error:', error);
        showError(`Photo analysis failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

/**
 * Collect horse data from form
 */
function collectHorseData() {
    const horses = [];
    const horseEntries = horsesContainer.querySelectorAll('.horse-entry');
    
    horseEntries.forEach(entry => {
        const name = entry.querySelector('input[name="horseName"]').value.trim();
        const odds = entry.querySelector('input[name="odds"]').value.trim();
        const bankroll = parseFloat(entry.querySelector('input[name="bankroll"]').value);
        const kellyFraction = parseFloat(entry.querySelector('input[name="kellyFraction"]').value);
        
        if (name && odds && !isNaN(bankroll) && !isNaN(kellyFraction)) {
            horses.push({
                name,
                odds,
                bankroll,
                kelly_fraction: kellyFraction
            });
        }
    });
    
    return horses;
}

/**
 * Display prediction results
 */
function displayResults(data) {
    const { win, place, show } = data;
    
    // Update WIN card
    document.getElementById('winName').textContent = win.name;
    document.getElementById('winOdds').textContent = `Odds: ${win.odds}`;
    document.getElementById('winProb').textContent = `Probability: ${(win.prob * 100).toFixed(1)}%`;
    document.getElementById('winKelly').textContent = `Kelly: ${(win.kelly * 100).toFixed(1)}%`;
    document.getElementById('winRationale').textContent = win.rationale || 'AI analysis complete';
    
    // Update PLACE card
    document.getElementById('placeName').textContent = place.name;
    document.getElementById('placeOdds').textContent = `Odds: ${place.odds}`;
    document.getElementById('placeProb').textContent = `Probability: ${(place.prob * 100).toFixed(1)}%`;
    document.getElementById('placeKelly').textContent = `Kelly: ${(place.kelly * 100).toFixed(1)}%`;
    document.getElementById('placeRationale').textContent = place.rationale || 'AI analysis complete';
    
    // Update SHOW card
    document.getElementById('showName').textContent = show.name;
    document.getElementById('showOdds').textContent = `Odds: ${show.odds}`;
    document.getElementById('showProb').textContent = `Probability: ${(show.prob * 100).toFixed(1)}%`;
    document.getElementById('showKelly').textContent = `Kelly: ${(show.kelly * 100).toFixed(1)}%`;
    document.getElementById('showRationale').textContent = show.rationale || 'AI analysis complete';
    
    // Show results with animation
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Show loading state
 */
function showLoading() {
    loadingSection.style.display = 'block';
    loadingSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide loading state
 */
function hideLoading() {
    loadingSection.style.display = 'none';
}

/**
 * Show error message
 */
function showError(message) {
    errorText.textContent = message;
    errorSection.style.display = 'block';
    errorSection.scrollIntoView({ behavior: 'smooth' });
}

/**
 * Hide error message
 */
function hideError() {
    errorSection.style.display = 'none';
}

/**
 * Hide results section
 */
function hideResults() {
    resultsSection.style.display = 'none';
}

/**
 * Test API connectivity
 */
async function testAPI() {
    try {
        const response = await fetch(`${API_BASE}/api/finishline/health`);
        const data = await response.json();
        console.log('API Health Check:', data);
        return data.status === 'ok';
    } catch (error) {
        console.error('API Health Check Failed:', error);
        return false;
    }
}

// Test API on load
testAPI();
