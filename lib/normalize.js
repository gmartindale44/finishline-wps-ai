// lib/normalize.js - Utility functions for race ID and ROI parsing

/**
 * Create a slug-based race ID from race metadata
 * @param {Object} params - Race metadata
 * @param {string} params.track - Track name
 * @param {string} params.date - Date (YYYY-MM-DD) or today if missing
 * @param {string} params.postTime - Post time (e.g., "12:25 PM")
 * @param {string|number} params.raceNo - Race number
 * @returns {string} - Slugified race ID (e.g., "saratoga-2024-11-04-1225pm-r5")
 */
export function slugRaceId({ track, date, postTime, raceNo }) {
  // Normalize track: lowercase, collapse spaces, replace non-alphanum with '-', remove dup '-'
  const slugTrack = (track || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Normalize date: use YYYY-MM-DD format or today
  let slugDate = date || '';
  if (!slugDate || !/^\d{4}-\d{2}-\d{2}$/.test(slugDate)) {
    const d = new Date();
    slugDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Normalize postTime: "12:25 PM" => "1225pm" (strip ':' and space, lowercase)
  const slugPostTime = (postTime || '')
    .toLowerCase()
    .replace(/[:\s]/g, '')
    .replace(/[^a-z0-9]/g, '')
    || 'unknown';

  // Normalize race number
  const slugRaceNo = String(raceNo || '').trim() || '0';

  // Build: track-date-postTime-r{raceNo}
  const parts = [slugTrack, slugDate, slugPostTime, `r${slugRaceNo}`].filter(Boolean);
  return parts.join('-');
}

/**
 * Parse ROI percentage string to number
 * @param {string|number} input - ROI input (e.g., "+42", "42", "-100", "")
 * @returns {number|null} - Parsed integer or null if empty/invalid
 */
export function parseROI(input) {
  if (input === null || input === undefined || input === '') return null;
  
  const str = String(input).trim();
  if (!str) return null;

  // Remove '+' if present, then parse
  const cleaned = str.replace(/^\+/, '');
  const num = Number(cleaned);
  
  if (Number.isNaN(num) || !Number.isFinite(num)) return null;
  
  return Math.round(num);
}

