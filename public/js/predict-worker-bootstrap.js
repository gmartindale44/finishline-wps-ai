/* global self */

const WORKER_CONTEXT = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;

function serializeError(err, context = {}) {
  return {
    message: err?.message || String(err),
    stack: err?.stack || null,
    code: err?.code || context.code || null,
    context,
  };
}

async function loadCalibration(urls = ['/public/data/calibration_v1.json', '/data/calibration_v1.json']) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const calibration = await res.json();
      return { calibration, source: url };
    } catch (err) {
      postError(err, { step: 'loadCalibration', url });
    }
  }
  const error = new Error('Calibration not found in any served path');
  error.code = 'CALIBRATION_NOT_FOUND';
  throw error;
}

function postError(err, context = {}) {
  try {
    self.postMessage({
      type: 'predict:error',
      error: serializeError(err, context),
    });
  } catch (postErr) {
    // Last resort: log to console
    console.error('[predict-worker] failed to post error', postErr);
  }
}

if (WORKER_CONTEXT) {
  self.addEventListener('message', async (event) => {
    const data = event?.data || {};
    if (!data || !data.type) return;

    try {
      switch (data.type) {
        case 'predict:load-calibration': {
          const urls = Array.isArray(data.urls) && data.urls.length ? data.urls : undefined;
          const result = await loadCalibration(urls);
          self.postMessage({
            type: 'predict:calibration',
            ok: true,
            calibration: result.calibration,
            source: result.source,
          });
          break;
        }
        default:
          self.postMessage({ type: 'predict:noop', ok: true });
          break;
      }
    } catch (err) {
      postError(err, { step: data.type || 'unknown', urls: data.urls });
    }
  });

  self.addEventListener('error', (event) => {
    postError(event?.error || event, { step: 'worker-error' });
  });

  self.addEventListener('unhandledrejection', (event) => {
    postError(event?.reason || event, { step: 'worker-unhandled-rejection' });
  });
}


