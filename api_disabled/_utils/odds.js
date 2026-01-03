export const FRACT_SEP = /[\/-]/;

export function parseMlOdds(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase().replace(/\s+/g, '');
  // accept "9/2", "9-2", "9to2", "20/1"
  const m = s.match(/^(\d+)\s*(?:\/|-|to)\s*(\d+)$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (!a || !b) return null;
  // decimal price (stake+profit), consistent with 20/1 => 21
  return a / b + 1;
}

export function extractSpeedFig(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\((\d{2,3})\*?\)/);
  return m ? Number(m[1]) : null;
}

export function clamp01(x) {
  return Math.max(0, Math.min(1, +x || 0));
}