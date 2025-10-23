// ===== utilities =====
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

function setBadge(text) {
  const b = $('#statusBadge');
  if (b) b.textContent = text;
}

function hideLegacyDump() {
  const junk = $('#legacyDump') || document.querySelector('#analysisOutput, #output, #result, textarea, pre');
  if (junk) junk.style.display = 'none';
}

function ensureHorseRowsContainer() {
  let rows = $('#horseRows');
  if (!rows) {
    rows = document.createElement('div');
    rows.id = 'horseRows';
    rows.className = 'space-y-1 mt-2';
    // Insert above action buttons, fallback to end of horse-data block
    const host = $('#predictBtn')?.parentElement || document.querySelector('.horse-data') || document.body;
    host.insertBefore(rows, $('#chooseBtn') || host.firstChild);
  }
  return rows;
}

// ===== fallback parsing for plain OCR text =====
function parseRaceFromText(text) {
  const date     = (text.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i) || [,''])[1];
  const track    = (text.match(/\b(Churchill Downs|Saratoga|Belmont|Keeneland|Santa Anita|Del Mar)\b/i) || [,''])[1];
  const surface  = (text.match(/\b(Dirt|Turf|Synthetic)\b/i) || [,''])[1];
  const distance = (text.match(/\b(\d+\s*\/\s*\d+\s*miles|\d+\s*miles|\d+\s*\/\s*\d+\s*mi|\d+\s*mi)\b/i) || [,''])[1];
  return { date, track, surface, distance };
}

function parseHorsesFromText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const horses = [];
  let cur = null;
  const pushCur = () => { if (cur && cur.name) horses.push(cur); cur = null; };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = ln.match(/^(\d+)\.\s*(.+)$/);  // "1. Clarita"
    if (m) { pushCur(); cur = { name: m[2], odds: '', jockey: '', trainer: '' }; continue; }
    if (!cur) continue;
    if (!cur.odds && /(\d+\/\d+)(\s*-\s*\d+\/\d+)?/.test(ln)) { cur.odds = ln; continue; }
    if (!cur.jockey && /(jockey|^luis|^irad|^jose|saez|prat|rosario|smith)/i.test(ln)) { cur.jockey = ln.replace(/^jockey[:\s-]*/i, ''); continue; }
    if (!cur.trainer && /(trainer|pletcher|baffert|brown|asmussen|mott|cox)/i.test(ln)) { cur.trainer = ln.replace(/^trainer[:\s-]*/i, ''); continue; }
  }
  pushCur();
        return horses;
      }
      
// ===== rendering =====
function renderHorses(horses) {
  const rows = ensureHorseRowsContainer();
  rows.innerHTML = '';
  if (!horses || !horses.length) return;
  horses.forEach((h, i) => {
    const el = document.createElement('div');
    el.className = 'horse-row flex items-center justify-between py-1 border-b border-white/10';
    el.innerHTML = `
      <div class="flex-1 truncate">${i + 1}. <strong>${h.name || ''}</strong></div>
      <div class="w-24 text-right opacity-80">${h.odds || ''}</div>
      <div class="w-48 text-right opacity-80 truncate">${h.jockey || ''}</div>
      <div class="w-48 text-right opacity-80 truncate">${h.trainer || ''}</div>
    `;
    rows.appendChild(el);
  });
}

function fillRace(race) {
  const date     = $('#raceDate');
  const track    = $('#raceTrack');
  const surface  = $('#raceSurface');
  const distance = $('#raceDistance');
  if (date)     date.value     = race.date     || date.value     || '';
  if (track)    track.value    = race.track    || track.value    || '';
  if (surface)  surface.value  = race.surface  || surface.value  || '';
  if (distance) distance.value = race.distance || distance.value || '';
}

// ===== orchestrator: process API payload -> UI =====
function fillFormFromExtraction(payload) {
  console.log('[analyze] raw payload:', payload);
  hideLegacyDump();

  // structured first
  let race   = payload?.race || {};
  let horses = Array.isArray(payload?.horses) ? payload.horses : [];

  // allow different shapes {ok, data:{race, horses}}, etc.
  if (!horses.length && payload?.data?.horses) horses = payload.data.horses;
  if (!race?.date && payload?.data?.race) race = payload.data.race;

  // fallback to raw text blob
  const blob = payload?.text || payload?.raw || payload?.content || payload?.ocr || payload?.message || '';
  if ((!race?.date && !race?.track && !race?.surface && !race?.distance) && blob) {
    race = parseRaceFromText(blob);
  }
  if ((!horses?.length) && blob) {
    horses = parseHorsesFromText(blob);
  }

  fillRace(race);
  renderHorses(horses);
  setBadge('Ready to predict');
}

// ===== collect horses for predict =====
function collectHorsesFromUI() {
  const rows = $$('#horseRows .horse-row');
  if (!rows.length) return [];
  return rows.map((row) => {
    const cols = row.querySelectorAll('div');
    const name    = cols[0]?.textContent.replace(/^\d+\.\s*/, '').trim() || '';
    const odds    = cols[1]?.textContent.trim() || '';
    const jockey  = cols[2]?.textContent.trim() || '';
    const trainer = cols[3]?.textContent.trim() || '';
    return { name, odds, jockey, trainer };
  });
}

// ===== API calls =====
async function postPhotos(files) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f, f.name);
  console.log('[analyze] sending files:', files.length);
  const res = await fetch('/api/photo_extract_openai_b64', { method: 'POST', body: fd });
  const ct = res.headers.get('content-type') || '';
            let data;
  if (ct.includes('application/json')) data = await res.json();
  else data = { text: await res.text() };
  console.log('[analyze] response:', data);
  if (!res.ok) throw new Error('analyze failed');
  return data;
}

async function predict(horses, race) {
  const payload = { horses, race };
  console.log('[predict] payload:', payload);
  const res = await fetch('/api/predict_wps', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(async () => ({ message: await res.text() }));
  console.log('[predict] response:', data);
  return data;
}

// ===== wire UI =====
(function initUI() {
  const chooseBtn  = $('#chooseBtn');
  const analyzeBtn = $('#analyzeBtn');
  const predictBtn = $('#predictBtn');
  const fileInput  = $('#fileInput');

  // Choose -> open file dialog
  if (chooseBtn && fileInput) {
    chooseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      if (!e.target.files?.length) return;
      setBadge('Extracting…');
      try {
        const data = await postPhotos([...e.target.files]);
        fillFormFromExtraction(data);
      } catch (err) {
        console.error(err);
        alert('Extract failed');
        setBadge('Idle');
      } finally {
        fileInput.value = '';
            }
        });
    }

  // Analyze -> reuse last chosen or ask again
  if (analyzeBtn && fileInput) {
    analyzeBtn.addEventListener('click', () => chooseBtn?.click());
  }

  // Predict
  if (predictBtn) {
    predictBtn.addEventListener('click', async () => {
      setBadge('Predicting…');
      const race = {
        date:     $('#raceDate')?.value || '',
        track:    $('#raceTrack')?.value || '',
        surface:  $('#raceSurface')?.value || '',
        distance: $('#raceDistance')?.value || '',
      };
      const horses = collectHorsesFromUI();
        if (!horses.length) {
        alert('No horses found in the form.');
        setBadge('Ready to predict');
            return;
        }
      try {
        const data = await predict(horses, race);
        alert(data?.msg || data?.message || 'predict done');
      } catch (err) {
        console.error(err);
        alert('predict failed');
    } finally {
        setBadge('Ready to predict');
      }
    });
  }

  console.log('[init] UI wired');
  hideLegacyDump();
  ensureHorseRowsContainer();
  setBadge('Idle');
})();