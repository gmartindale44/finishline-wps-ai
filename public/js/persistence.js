const API_URL = '/api/persistence';
const STORAGE_RECENT_TRACKS = 'fl_recent_tracks';
const STORAGE_MEASUREMENTS = 'fl_measurements';
const RETRY_DELAY_MS = 150;
const RETRY_ATTEMPTS = 2;

const state = {
  hydrated: false,
  pendingTrack: null,
  pendingMeasurements: null,
};

function debounce(fn, ms = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const pushTrackDebounced = debounce((track) => {
  if (!track) return;
  postJSON({ kind: 'track', track }).catch((err) => {
    console.debug('[FLPersistence] track save failed:', err?.message || err);
  });
}, 500);

const pushMeasurementsDebounced = debounce((payload) => {
  if (!payload || typeof payload !== 'object') return;
  postJSON({ kind: 'measurements', measurements: payload }).catch((err) => {
    console.debug('[FLPersistence] measurements save failed:', err?.message || err);
  });
}, 500);

async function fetchWithRetry(url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }
  throw lastError;
}

async function getJSON() {
  try {
    const res = await fetchWithRetry(API_URL, { method: 'GET' });
    return await res.json();
  } catch (err) {
    console.debug('[FLPersistence] hydrate failed:', err?.message || err);
    return { ok: false };
  }
}

async function postJSON(body) {
  return fetchWithRetry(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function loadLocalMeasurements() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_MEASUREMENTS) || '{}');
  } catch {
    return {};
  }
}

function saveLocalMeasurements(measurements) {
  try {
    localStorage.setItem(STORAGE_MEASUREMENTS, JSON.stringify(measurements || {}));
  } catch {
    /* ignore */
  }
}

function mergeRecentTracks(serverTracks) {
  if (!Array.isArray(serverTracks) || !serverTracks.length) return;
  let local = [];
  try {
    local = JSON.parse(localStorage.getItem(STORAGE_RECENT_TRACKS) || '[]');
  } catch {
    local = [];
  }
  const combined = [...serverTracks, ...local]
    .map((track) => (track || '').trim())
    .filter(Boolean);
  const unique = Array.from(new Set(combined)).slice(0, 10);
  try {
    localStorage.setItem(STORAGE_RECENT_TRACKS, JSON.stringify(unique));
  } catch {
    /* ignore */
  }
}

function applyMeasurements(measurements) {
  const trackInput = document.getElementById('race-track');
  const distanceInput = document.getElementById('race-distance');
  const surfaceSelect = document.getElementById('race-surface');

  if (!trackInput && !distanceInput && !surfaceSelect) return;

  const existing = {
    track: trackInput?.value?.trim() || '',
    distance: distanceInput?.value?.trim() || '',
    surface: surfaceSelect?.value?.trim() || '',
  };

  if (trackInput && measurements.track && !existing.track) {
    trackInput.value = measurements.track;
  }

  if (distanceInput && measurements.distance && !existing.distance) {
    distanceInput.value = measurements.distance;
  }

  if (surfaceSelect && measurements.surface && !existing.surface) {
    surfaceSelect.value = measurements.surface;
  }
}

async function hydrate() {
  const payload = await getJSON();
  const measurements = loadLocalMeasurements();

  if (payload?.ok) {
    if (Array.isArray(payload.tracks)) {
      mergeRecentTracks(payload.tracks);
    }
    Object.assign(measurements, payload.measurements || {});
  }

  saveLocalMeasurements(measurements);
  applyMeasurements(measurements);
  state.hydrated = true;
}

function currentMeasurements() {
  const trackInput = document.getElementById('race-track');
  const distanceInput = document.getElementById('race-distance');
  const surfaceSelect = document.getElementById('race-surface');
  return {
    track: trackInput ? trackInput.value.trim() : '',
    distance: distanceInput ? distanceInput.value.trim() : '',
    surface: surfaceSelect ? surfaceSelect.value.trim() : '',
  };
}

function notifyMeasurements() {
  const snapshot = currentMeasurements();
  saveLocalMeasurements(snapshot);
  pushMeasurementsDebounced(snapshot);
}

function notifyTrackCommit(value) {
  const name = (value || '').trim();
  if (!name) return;
  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem(STORAGE_RECENT_TRACKS) || '[]');
  } catch {
    recent = [];
  }
  const next = [name, ...recent.filter((t) => t !== name)].slice(0, 10);
  try {
    localStorage.setItem(STORAGE_RECENT_TRACKS, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  pushTrackDebounced(name);
  notifyMeasurements();
}

function bindListeners() {
  const trackInput = document.getElementById('race-track');
  const distanceInput = document.getElementById('race-distance');
  const surfaceSelect = document.getElementById('race-surface');

  if (trackInput) {
    trackInput.addEventListener('input', notifyMeasurements);
    trackInput.addEventListener('blur', () => notifyTrackCommit(trackInput.value));
  }
  if (distanceInput) {
    distanceInput.addEventListener('input', notifyMeasurements);
  }
  if (surfaceSelect) {
    surfaceSelect.addEventListener('change', notifyMeasurements);
  }
}

function init() {
  hydrate().finally(() => {
    bindListeners();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

window.FLPersistence = {
  notifyTrackCommit,
  notifyMeasurements,
};

