// Client helper for distance conversion
export function toMiles(distanceInput) {
  if (!distanceInput) return null;
  const raw = String(distanceInput).trim().toLowerCase();

  // e.g., "6f", "6 f", "7.5 furlongs"
  const f = raw.match(/(\d+(?:\.\d+)?)(\s*)f(?:urlong[s]?)?/);
  if (f) return parseFloat(f[1]) * 0.125;

  // mixed miles: "1 1/8", "1 1/16"
  const mix = raw.match(/(\d+)\s+(\d+)\/(\d+)/);
  if (mix) return parseInt(mix[1], 10) + (parseInt(mix[2], 10) / parseInt(mix[3], 10));

  // decimal miles: "1.125", "0.875"
  const dec = raw.match(/-?\d+(\.\d+)?/);
  return dec ? parseFloat(dec[0]) : null;
}

