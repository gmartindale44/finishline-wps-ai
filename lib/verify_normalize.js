/**
 * Centralized normalization helpers for verify_race and verify_backfill
 * These MUST be identical in both paths to ensure Redis key consistency
 */

/**
 * Normalize track name to slug format (matches verify_race.js buildVerifyRaceId)
 * Example: "Aqueduct " -> "aqueduct", "Gulfstream Park" -> "gulfstream-park"
 */
export function normalizeTrack(track) {
  if (!track) return "";
  return String(track)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")      // Collapse multiple spaces
    .replace(/[^a-z0-9\s-]/g, "") // Remove non-alphanumeric except space and dash
    .replace(/\s+/g, "-")       // Replace spaces with dashes
    .replace(/-+/g, "-")        // Collapse multiple dashes
    .replace(/^-|-$/g, "");     // Remove leading/trailing dashes
}

/**
 * Normalize race number to string format
 * Example: 7 -> "7", " 8 " -> "8", null/empty -> "0"
 */
export function normalizeRaceNo(raceNo) {
  const normalized = String(raceNo || "").trim();
  return normalized || "0";
}

/**
 * Normalize date to YYYY-MM-DD ISO format
 * Handles: YYYY-MM-DD, MM/DD/YYYY, Date objects, or invalid -> ""
 */
export function normalizeDateToIso(date) {
  if (!date) return "";
  
  const str = String(date).trim();
  
  // Already ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  
  // MM/DD/YYYY format
  const mdyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, mm, dd, yyyy] = mdyMatch;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  
  // Try parsing as Date (last resort)
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  } catch {}
  
  // Invalid date - return empty string (buildVerifyRaceId will handle it)
  return "";
}

/**
 * Normalize surface to slug format (or "unknown" if not available)
 * Currently verify keys use "unknown" as placeholder
 */
export function normalizeSurface(surface) {
  if (!surface) return "unknown";
  const normalized = String(surface)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "unknown";
}

/**
 * Build verify race ID (format: trackSlug-dateSlug-surfaceSlug-r{raceNo})
 * This is the EXACT format used by verify_race.js when writing to Redis
 * 
 * @param {string} track - Track name
 * @param {string} date - Date (will be normalized to YYYY-MM-DD)
 * @param {string|number} raceNo - Race number
 * @param {string} [surface] - Surface (defaults to "unknown")
 * @returns {string} - Race ID slug (e.g., "aqueduct-2026-01-09-unknown-r7")
 */
export function buildVerifyRaceId(track, date, raceNo, surface = "unknown") {
  const slugTrack = normalizeTrack(track);
  const slugDate = normalizeDateToIso(date);
  const slugRaceNo = normalizeRaceNo(raceNo);
  const slugSurface = normalizeSurface(surface);
  
  // Build: track-date-surface-r{raceNo}
  // Filter out empty/falsy parts (matches original verify_race.js behavior)
  // If date is empty, we get: track-unknown-r{raceNo} (date part is omitted)
  const parts = [slugTrack, slugDate, slugSurface, `r${slugRaceNo}`].filter(Boolean);
  
  return parts.join("-");
}
