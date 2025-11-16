export default async function handler(req, res) {
  try {
    // Fire-and-forget stub – later we can hook this into background reconciliation/backfill.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[verify_backfill] error', err);
    return res.status(200).json({
      ok: false,
      error: err?.message || String(err) || 'Unknown error',
    });
  }
}

