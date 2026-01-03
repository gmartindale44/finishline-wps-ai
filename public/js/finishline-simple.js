// FinishLine WPS AI - Simple wiring without brittle timers
(function () {
  const fileInput  = document.getElementById('photo-input-main') || document.querySelector('#photo-input-main');
  const analyzeBtn = document.getElementById('btn-analyze')      || document.getElementById('analyze-btn')      || document.querySelector('#analyze-btn');
  const predictBtn = document.getElementById('btn-predict')      || document.getElementById('predict-btn')      || document.querySelector('#predict-btn');
  const addBtn     = document.getElementById('btn-add-horse')     || document.getElementById('add-horse-btn')    || document.querySelector('#add-horse-btn');
  const rowsTbody  = document.getElementById('horse-rows')      || document.querySelector('#horse-rows');

  if (!fileInput || !analyzeBtn || !predictBtn || !addBtn || !rowsTbody) {
    console.error('[FinishLine] Missing required DOM elements', { fileInput: !!fileInput, analyzeBtn: !!analyzeBtn, predictBtn: !!predictBtn, addBtn: !!addBtn, rowsTbody: !!rowsTbody });
    return;
  }

  function createRow(h = {}) {
    const tr = document.createElement('tr');
    tr.className = 'horse-row';
    tr.innerHTML = `
      <td><input class="horse-name"    placeholder="Horse Name"          value="${(h.name || '').replace(/"/g, '&quot;')}"></td>
      <td><input class="horse-odds"    placeholder="ML Odds (e.g., 9/2)" value="${(h.odds || '').replace(/"/g, '&quot;')}"></td>
      <td><input class="horse-jockey"  placeholder="Jockey"              value="${(h.jockey || '').replace(/"/g, '&quot;')}"></td>
      <td><input class="horse-trainer" placeholder="Trainer"             value="${(h.trainer || '').replace(/"/g, '&quot;')}"></td>
    `;
    rowsTbody.appendChild(tr);
  }

  function getAllHorsesFromForm() {
    return [...document.querySelectorAll('.horse-row')].map(r => ({
      name:   r.querySelector('.horse-name')?.value?.trim() || '',
      odds:   r.querySelector('.horse-odds')?.value?.trim() || '',
      jockey: r.querySelector('.horse-jockey')?.value?.trim() || '',
      trainer: r.querySelector('.horse-trainer')?.value?.trim() || '',
    })).filter(h => h.name && h.odds);
  }

  addBtn.addEventListener('click', () => {
    createRow({});
  });

  async function fileToBase64(file) {
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('read error'));
      fr.onload = () => {
        const s = String(fr.result || '');
        resolve(s.includes(',') ? s.split(',')[1] : s);
      };
      fr.readAsDataURL(file);
    });
  }

  analyzeBtn.addEventListener('click', async () => {
    try {
      analyzeBtn.disabled = true;
      const file = fileInput.files?.[0];
      if (!file) { 
        alert('Please choose a screenshot first.'); 
        analyzeBtn.disabled = false;
        return; 
      }

      const data_b64 = await fileToBase64(file);

      console.log('[Analyze] calling OCR extract...');
      const r1 = await fetch('/api/photo_extract_openai_b64', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mime: file.type, data: data_b64 })
      });
      const j1 = await r1.json();
      console.log('[Analyze] OCR result:', j1);
      
      if (!r1.ok || !j1?.ok) {
        // Check if PayGate is locked
        if (typeof window !== 'undefined' && window.handlePaygateLocked) {
          const isPaygateLocked = await window.handlePaygateLocked(j1);
          if (isPaygateLocked) {
            // PayGate modal shown, don't throw error
            return;
          }
        }
        throw new Error(j1?.error || 'Extract failed');
      }

      console.log('[Analyze] calling analyze endpoint...');
      const r2 = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ horses: j1.horses || [] })
      });
      const j2 = await r2.json();
      console.log('[Analyze] analyze result:', j2);
      
      if (!r2.ok || !j2?.ok) {
        throw new Error(j2?.error || 'Analyze failed');
      }

      rowsTbody.innerHTML = '';
      (j2.horses || []).forEach(h => createRow(h));
      
      if (!j2.horses?.length) {
        alert('No horses found. Ensure the screenshot shows: horse name • fractional odds • jockey • trainer.');
      } else {
        console.log(`[Analyze] populated ${j2.horses.length} horses`);
      }
    } catch (e) {
      console.error('[Analyze error]', e);
      alert('Analyze failed. See console for details.');
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  predictBtn.addEventListener('click', async () => {
    try {
      predictBtn.disabled = true;
      const horses = getAllHorsesFromForm();
      
      if (!horses.length) { 
        alert('No horses to analyze.'); 
        predictBtn.disabled = false;
        return; 
      }

      console.log('[Predict] submitting', horses.length, 'horses');
      const r = await fetch('/api/predict_wps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ horses })
      });
      const j = await r.json();
      console.log('[Predict] result:', j);
      
      if (!r.ok || !j?.ok) {
        // Check if PayGate is locked
        if (typeof window !== 'undefined' && window.handlePaygateLocked) {
          const isPaygateLocked = await window.handlePaygateLocked(j);
          if (isPaygateLocked) {
            // PayGate modal shown, don't throw error
            return;
          }
        }
        throw new Error(j?.error || 'Predict failed');
      }

      const msg = [
        j.win   ? `🏆 Win:   ${j.win.name} (${j.win.odds})`   : '🏆 Win:   —',
        j.place ? `🥈 Place: ${j.place.name} (${j.place.odds})` : '🥈 Place: —',
        j.show  ? `🥉 Show:  ${j.show.name} (${j.show.odds})`  : '🥉 Show:  —',
      ].join('\n');
      alert(msg);
    } catch (e) {
      console.error('[Predict error]', e);
      alert('Prediction failed. See console for details.');
    } finally {
      predictBtn.disabled = false;
    }
  });

  console.log('[FinishLine] Simple wiring ready');
})();
