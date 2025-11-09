// Client helper for distance conversion
// Comprehensive parser for distance inputs to miles

// Conversion factors
const YARDS_PER_MILE = 1760;
const METERS_PER_MILE = 1609.344;
const FURLONGS_PER_MILE = 8;

export function parseDistanceToMiles(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  
  // Normalize unicode fractions like ¼, ½, ¾
  const fracMap = { '¼': '1/4', '½': '1/2', '¾': '3/4' };
  let n = s.replace(/[¼½¾]/g, m => fracMap[m]);
  
  // Helper
  const toNum = (x) => (x == null ? NaN : Number(x));
  
  // 1) Miles explicit: "1.25 mi", "1 mile(s)"
  let m = n.match(/^(\d+(?:\.\d+)?)\s*(mi|mile|miles)$/);
  if (m) return toNum(m[1]);
  
  // 2) Furlongs: "7f", "7 fur", "7 furlongs"
  m = n.match(/^(\d+(?:\.\d+)?)\s*(f|fur|furlong|furlongs)$/);
  if (m) return toNum(m[1]) / FURLONGS_PER_MILE;
  
  // 3) Yards: "350 yd(s)", "350y", "350 yards", "350yd"
  m = n.match(/^(\d+(?:\.\d+)?)\s*(y|yd|yds|yard|yards)$/);
  if (m) return toNum(m[1]) / YARDS_PER_MILE;
  
  // 4) Meters: "350 m", "350 meter(s)", "350m"
  m = n.match(/^(\d+(?:\.\d+)?)\s*(m|meter|meters|metre|metres)$/);
  if (m) return toNum(m[1]) / METERS_PER_MILE;
  
  // 5) Mixed miles + yards: "1 mi 70 yd", "1m 70y"
  m = n.match(/^(\d+(?:\.\d+)?)\s*m(?:i|ile|iles)?\s+(\d+(?:\.\d+)?)\s*y(?:d|ds|ard|ards)?$/);
  if (m) return toNum(m[1]) + (toNum(m[2]) / YARDS_PER_MILE);
  
  // 6) Fractional miles (whole + fraction): "1 1/16", "1 1/8", "1 3/4"
  m = n.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return toNum(m[1]) + (toNum(m[2]) / toNum(m[3]));
  
  // 7) Bare fraction: "1/2", "1/4"
  m = n.match(/^(\d+)\/(\d+)$/);
  if (m) return toNum(m[1]) / toNum(m[2]);
  
  // Unrecognized
  return null;
}

// Backward compatibility alias
export function toMiles(distanceInput) {
  return parseDistanceToMiles(distanceInput);
}
