/**
 * lib/calibration/track_normalize.js
 * 
 * Track name normalization for calibration pipeline.
 * Collapses variants like "Aqueduct" and "Aqueduct Racetrack" into canonical names.
 */

/**
 * Normalize track name to canonical form
 * - Trims whitespace
 * - Case-insensitive comparison
 * - Removes "Race Course", "Racetrack", "Racing" suffixes where appropriate
 * - Collapses known variants
 * 
 * @param {string} track - Raw track name
 * @returns {string} - Canonical track name
 */
export function normalizeTrackName(track) {
  if (!track || typeof track !== "string") {
    return "";
  }

  // Trim and normalize case
  let normalized = track.trim();
  if (!normalized) return "";

  // Convert to lowercase for comparison (but preserve original case for output)
  const lower = normalized.toLowerCase();

  // Known track name variants mapping
  // Format: [canonical name, ...variants]
  const trackVariants = [
    ["Aqueduct", "aqueduct", "aqueduct racetrack", "aqueduct race course"],
    ["Gulfstream Park", "gulfstream park", "gulfstream"],
    ["Santa Anita", "santa anita", "santa anita park"],
    ["Churchill Downs", "churchill downs", "churchill"],
    ["Belmont Park", "belmont park", "belmont"],
    ["Pimlico", "pimlico", "pimlico race course"],
    ["Del Mar", "del mar", "del mar thoroughbred club"],
    ["Keeneland", "keeneland", "keeneland race course"],
    ["Saratoga", "saratoga", "saratoga race course", "saratoga springs"],
    ["Parx Racing", "parx racing", "parx", "philadelphia park"],
    ["Oaklawn Park", "oaklawn park", "oaklawn"],
    ["Fair Grounds", "fair grounds", "fairgrounds"],
    ["Tampa Bay Downs", "tampa bay downs", "tampa downs"],
    ["Laurel Park", "laurel park", "laurel"],
    ["Charles Town", "charles town", "charles town races"],
    ["Mahoning Valley", "mahoning valley", "mahoning valley race course"],
  ];

  // Check against known variants
  for (const [canonical, ...variants] of trackVariants) {
    if (lower === canonical.toLowerCase() || variants.some(v => lower === v)) {
      return canonical;
    }
  }

  // Generic normalization: remove common suffixes
  // Remove "Racetrack", "Race Course", "Racing" if they appear at the end
  const genericNormalized = normalized
    .replace(/\s+racetrack$/i, "")
    .replace(/\s+race\s+course$/i, "")
    .replace(/\s+racing$/i, "")
    .trim();

  // If generic normalization changed something, return it
  if (genericNormalized !== normalized && genericNormalized.length > 0) {
    return genericNormalized;
  }

  // Otherwise return original (trimmed)
  return normalized;
}

/**
 * Get canonical track name for grouping/aggregation
 * This is used for computing per-track metrics
 * 
 * @param {string} track - Raw track name
 * @returns {string} - Canonical track name for grouping
 */
export function getCanonicalTrackName(track) {
  return normalizeTrackName(track);
}
