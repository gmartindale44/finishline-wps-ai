// lib/distance.js - Distance parsing and normalization

/**
 * Parse distance input and normalize to furlongs and meters
 * @param {string} raw - Raw distance input (e.g., "350y", "6f", "1m", "1 1/16 mi", "1200m")
 * @returns {{pretty: string, distance_furlongs: number, distance_meters: number}|null}
 */
export function parseDistance(raw) {
  if (!raw || typeof raw !== 'string') return null;
  
  const trimmed = raw.trim();
  if (!trimmed) return null;
  
  const original = trimmed;
  const lower = trimmed.toLowerCase();
  
  // Constants
  const YARDS_PER_FURLONG = 220;
  const METERS_PER_YARD = 0.9144;
  const METERS_PER_FURLONG = 201.168; // 220 * 0.9144
  const FURLONGS_PER_MILE = 8;
  
  let furlongs = 0;
  let meters = 0;
  
  // Pattern 1: Yards (e.g., "350y", "350 y")
  const yardsMatch = lower.match(/(\d+(?:\.\d+)?)\s*y(?:ard[s]?)?\b/);
  if (yardsMatch) {
    const y = parseFloat(yardsMatch[1]);
    furlongs = y / YARDS_PER_FURLONG;
    meters = Math.round(y * METERS_PER_YARD);
    return {
      pretty: original,
      distance_furlongs: furlongs,
      distance_meters: meters
    };
  }
  
  // Pattern 2: Meters (e.g., "1200m", "1200 m") - avoid matching "mi"
  const metersMatch = lower.match(/(\d+(?:\.\d+)?)\s*m(?!i)(?!ile[s]?)\b/);
  if (metersMatch) {
    const m = parseFloat(metersMatch[1]);
    meters = Math.round(m);
    furlongs = m / METERS_PER_FURLONG;
    return {
      pretty: original,
      distance_furlongs: furlongs,
      distance_meters: meters
    };
  }
  
  // Pattern 3: Furlongs (e.g., "6f", "6 f", "7.5 furlongs")
  const furlongsMatch = lower.match(/(\d+(?:\.\d+)?)\s*f(?:urlong[s]?)?\b/);
  if (furlongsMatch) {
    const f = parseFloat(furlongsMatch[1]);
    furlongs = f;
    meters = Math.round(f * METERS_PER_FURLONG);
    return {
      pretty: original,
      distance_furlongs: furlongs,
      distance_meters: meters
    };
  }
  
  // Pattern 4: Miles with fractions (e.g., "1 1/16 mi", "1 1/8 mile", "1 1/16 miles")
  const milesFractionMatch = lower.match(/(\d+)\s+(\d+)\s*\/\s*(\d+)\s*m(?:i|ile|iles)?\b/);
  if (milesFractionMatch) {
    const whole = parseInt(milesFractionMatch[1], 10);
    const num = parseInt(milesFractionMatch[2], 10);
    const den = parseInt(milesFractionMatch[3], 10);
    const miles = whole + (num / den);
    furlongs = miles * FURLONGS_PER_MILE;
    meters = Math.round(furlongs * METERS_PER_FURLONG);
    return {
      pretty: original,
      distance_furlongs: furlongs,
      distance_meters: meters
    };
  }
  
  // Pattern 5: Simple miles (e.g., "1m", "1 mi", "1 mile", "1 miles")
  const milesMatch = lower.match(/(\d+(?:\.\d+)?)\s*m(?:i|ile|iles)?\b/);
  if (milesMatch) {
    const miles = parseFloat(milesMatch[1]);
    furlongs = miles * FURLONGS_PER_MILE;
    meters = Math.round(furlongs * METERS_PER_FURLONG);
    return {
      pretty: original,
      distance_furlongs: furlongs,
      distance_meters: meters
    };
  }
  
  // Pattern 6: Combo formats (e.g., "1m70y", "1m 40y", "1m 1/16")
  // Try miles + yards
  const comboMilesYards = lower.match(/(\d+)\s*m(?:i|ile|iles)?\s*(\d+)\s*y(?:ard[s]?)?\b/);
  if (comboMilesYards) {
    const miles = parseInt(comboMilesYards[1], 10);
    const yards = parseInt(comboMilesYards[2], 10);
    furlongs = (miles * FURLONGS_PER_MILE) + (yards / YARDS_PER_FURLONG);
    meters = Math.round(furlongs * METERS_PER_FURLONG);
    return {
      pretty: original,
      distance_furlongs: furlongs,
      distance_meters: meters
    };
  }
  
  // Pattern 7: Decimal miles (fallback, e.g., "1.125", "0.875")
  const decimalMatch = lower.match(/^(\d+(?:\.\d+)?)\s*$/);
  if (decimalMatch) {
    const miles = parseFloat(decimalMatch[1]);
    if (miles > 0 && miles < 100) { // Sanity check
      furlongs = miles * FURLONGS_PER_MILE;
      meters = Math.round(furlongs * METERS_PER_FURLONG);
      return {
        pretty: original,
        distance_furlongs: furlongs,
        distance_meters: meters
      };
    }
  }
  
  // Cannot parse
  return null;
}

