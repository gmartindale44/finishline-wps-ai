// FinishLine WPS AI — Complete Photo Picker System
(function finishlinePickerBootstrap(){
  const chooseBtn = document.getElementById('photo-choose-btn');
  const input     = document.getElementById('photo-input-main');
  const note      = document.getElementById('photo-file-note');

  if (!chooseBtn || !input) {
    console.error('[Picker] Missing #photo-choose-btn or #photo-input-main.');
    return;
  }

  chooseBtn.addEventListener('click', () => {
    console.log('[Picker] Choose clicked');
    input.value = '';               // allow same-file reselect
    input.click();                  // JS path
  });

  // Enter/Space accessibility
  chooseBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.value = '';
      input.click();
    }
  });

  input.addEventListener('change', () => {
    if (!input.files || input.files.length === 0) {
      console.warn('[Picker] No file selected');
      note.textContent = 'No file selected.';
      return;
    }
    const f = input.files[0];
    note.textContent = `Selected: ${f.name} (${Math.round(f.size/1024)} KB)`;
    console.log('[Picker] onFilesSelected', { name: f.name, type: f.type, size: f.size });

    // kick off upload+OCR
    window.finishlineUploadAndExtract?.(f);
  });

  console.log('[Picker] Hardened picker ready');
})();

/**
 * Convert a File to base64 (no prefix).
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('FileReader failed'));
    fr.onload = () => {
      const result = String(fr.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result); // strip data:...;base64,
    };
    fr.readAsDataURL(file);
  });
}

/**
 * Add one empty horse row (and return the row element).
 * Assumes an #add-horse-btn that appends a new row to #horse-rows.
 */
async function addHorseRow() {
  const addBtn = document.getElementById('add-horse-btn');
  const list   = document.getElementById('horse-rows');
  if (!addBtn || !list) throw new Error('Missing #add-horse-btn or #horse-rows');

  const beforeCount = list.children.length;
  addBtn.click();

  // wait until count increments
  const started = performance.now();
  while (list.children.length <= beforeCount) {
    if (performance.now() - started > 4000) throw new Error('Timeout waiting for new horse row');
    await new Promise(r => setTimeout(r, 40));
  }
  return list.children[list.children.length - 1];
}

/**
 * Fill row inputs by CSS class.
 */
function fillRow(rowEl, { name, odds, jockey, trainer }) {
  rowEl.querySelector('.horse-name')?.value   = name   ?? '';
  rowEl.querySelector('.horse-odds')?.value   = odds   ?? '';
  rowEl.querySelector('.horse-jockey')?.value = jockey ?? '';
  rowEl.querySelector('.horse-trainer')?.value= trainer?? '';
}

/**
 * Main upload+OCR+populate flow. Exposed on window for picker bootstrap.
 */
window.finishlineUploadAndExtract = async function(file) {
  const statusBadge = document.querySelector('[data-status-badge]') || { textContent: '' };
  try {
    // 0) Basic validations
    if (!file.type || (!file.type.startsWith('image/') && file.type !== 'application/pdf')) {
      alert('Unsupported file type. Please upload an image or PDF.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) { // 15MB guard
      alert('File is too large (>15MB). Please upload a smaller image/PDF.');
      return;
    }

    statusBadge.textContent = 'Extracting…';
    console.log('[OCR] Converting file → base64');
    const base64 = await fileToBase64(file);

    console.log('[OCR] POST /api/photo_extract_openai_b64');
    const res = await fetch('/api/photo_extract_openai_b64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        mime: file.type,
        data: base64
      })
    });

    const text = await res.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { ok:false, error:'Bad JSON', raw:text }; }

    console.log('[OCR] response', res.status, payload);

    if (!res.ok || !payload?.ok) {
      const msg = payload?.error || `HTTP ${res.status}`;
      alert(`Image extraction failed: ${msg}\nSee console/network for details.`);
      statusBadge.textContent = 'Idle';
      return;
    }

    const horses = payload.data?.horses || [];
    if (!horses.length) {
      alert('No horses found in the image. Try a clearer screenshot or PDF.');
      statusBadge.textContent = 'Idle';
      return;
    }

    console.log('[Populate] Horses:', horses.length);
    for (let i = 0; i < horses.length; i++) {
      const row = await addHorseRow();
      fillRow(row, {
        name:   horses[i].name,
        odds:   horses[i].odds,
        jockey: horses[i].jockey,
        trainer:horses[i].trainer
      });
      console.log(`[Populate] Row ${i+1}/${horses.length} filled.`);
    }

    statusBadge.textContent = 'Ready';
    console.log('[Done] Population complete.');
  } catch (err) {
    console.error('[Flow Error]', err);
    alert(`Unexpected error: ${err.message}`);
    statusBadge.textContent = 'Idle';
  }
};

// Dev injector function
window.injectSampleHorses = async function() {
  try {
    console.log("[Dev] Injecting sample horses");
    const sample = [
      { name: "Clarita", odds: "10/1", jockey: "Luis Saez", trainer: "Philip A. Bauer" },
      { name: "Absolute Honor", odds: "5/2", jockey: "Tyler Gaffalione", trainer: "Saffie A. Joseph, Jr." },
      { name: "Indict", odds: "8/1", jockey: "Cristian A. Torres", trainer: "Thomas Drury, Jr." },
      { name: "Jewel Box", odds: "15/1", jockey: "Luan Machado", trainer: "Ian R. Wilkes" },
    ];

    console.log('[Populate] Sample Horses:', sample.length);
    for (let i = 0; i < sample.length; i++) {
      const row = await addHorseRow();
      fillRow(row, sample[i]);
      console.log(`[Populate] Row ${i+1}/${sample.length} filled.`);
    }
    alert('✅ Sample horses injected successfully!');
  } catch (err) {
    console.error('Dev injector error:', err);
    alert('❌ Dev injection failed: ' + err.message);
  }
};

// Show dev button in dev mode
if (window.location.hostname === 'localhost' || window.location.search.includes('dev=true')) {
  const devBtn = document.getElementById('devInjectBtn');
  if (devBtn) {
    devBtn.style.display = 'inline-block';
  }
}