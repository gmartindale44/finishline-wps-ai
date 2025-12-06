// lib/greenzone/greenzone_v1.js
// GreenZone v1: Similarity-based matching against historical good outcomes
//
// This module:
// 1. Loads merged dataset from Redis (predictions + verify outcomes)
// 2. Computes similarity scores in Conf-T3M space
// 3. Identifies GreenZone matches for current race and card candidates
//
// All functions are safe and will return disabled states on any error.

import { keys, hgetall } from "../redis.js";
import { slugRaceId } from "../normalize.js";

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

export const GREENZONE_CONFIG = {
  MIN_HISTORICAL_RACES: 20,        // Minimum historical races needed to enable GreenZone
  MIN_GOOD_SIMILARITY: 0.8,        // Minimum similarity for "Strong Match"
  MEDIUM_SIMILARITY: 0.6,          // Minimum similarity for "Medium Match"
  MIN_MATCH_COUNT_STRONG: 10,      // Minimum matches for "strong" level
  MIN_MATCH_COUNT_MEDIUM: 5,       // Minimum matches for "medium" level
  MIN_CARD_SIMILARITY: 0.8,        // Minimum similarity for card candidates
  MIN_CARD_MATCH_COUNT: 5,         // Minimum matches for card candidates
  MAX_CARD_CANDIDATES: 5,          // Maximum candidates to return
  SIMILARITY_ALPHA: 6,             // Gaussian similarity exponent (higher = stricter)
};

// Cache for loaded dataset
let cachedDataset = null;
let cacheLoadTime = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// DATASET LOADING
// ============================================================================

/**
 * Normalize a race key to extract track, date, raceNo for matching
 * Handles both fl:pred:* and fl:verify:* key formats
 */
function extractRaceKey(key) {
  try {
    // Remove prefix: fl:pred: or fl:verify:
    const withoutPrefix = key.replace(/^fl:(pred|verify):/, "");
    
    // Parse format: track-date-postTime-r{raceNo} or track-date-unknown-r{raceNo}
    const parts = withoutPrefix.split("-");
    if (parts.length < 4) return null;
    
    // Find the "r{N}" part (last segment that starts with "r")
    let raceNo = null;
    let date = null;
    let trackParts = [];
    
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].match(/^r\d+$/)) {
        raceNo = parts[i].substring(1);
        // Date should be the segment before this
        if (i >= 1 && parts[i - 1].match(/^\d{4}-\d{2}-\d{2}$/)) {
          date = parts[i - 1];
          trackParts = parts.slice(0, i - 1);
        }
        break;
      }
    }
    
    if (!raceNo || !date || trackParts.length === 0) return null;
    
    const track = trackParts.join("-").toLowerCase();
    
    return { track, date, raceNo };
  } catch (error) {
    return null;
  }
}

/**
 * Build a match key for joining predictions and verify logs
 */
function buildMatchKey(track, date, raceNo) {
  const normalizedTrack = (track || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const normalizedDate = String(date || "").trim();
  const normalizedRaceNo = String(raceNo || "").trim();
  return `${normalizedTrack}|${normalizedDate}|${normalizedRaceNo}`;
}

/**
 * Load prediction log from Redis and extract confidence/top3Mass
 */
async function loadPredictionLog(key) {
  try {
    const hash = await hgetall(key);
    if (!hash || Object.keys(hash).length === 0) return null;
    
    // Parse confidence (0-1 range or 0-100 range)
    const confRaw = parseFloat(hash.confidence || "0") || 0;
    const confidence = confRaw <= 1 ? confRaw * 100 : confRaw;
    
    // Parse top3_mass (0-1 range or 0-100 range)
    const t3Raw = parseFloat(hash.top3_mass || "0") || 0;
    const top3Mass = t3Raw <= 1 ? t3Raw * 100 : t3Raw;
    
    // Only include if we have valid values
    if (!Number.isFinite(confidence) || !Number.isFinite(top3Mass) || confidence <= 0 || top3Mass <= 0) {
      return null;
    }
    
    const raceKey = extractRaceKey(key);
    if (!raceKey) return null;
    
    return {
      key,
      ...raceKey,
      confidence: Math.max(0, Math.min(100, confidence)),
      top3Mass: Math.max(0, Math.min(100, top3Mass)),
      track: hash.track || raceKey.track,
      date: hash.date || raceKey.date,
      raceNo: hash.raceNo || raceKey.raceNo,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Load verify log from Redis and extract outcomes
 */
async function loadVerifyLog(key) {
  try {
    const hash = await hgetall(key);
    if (!hash || Object.keys(hash).length === 0) return null;
    
    const raceKey = extractRaceKey(key);
    if (!raceKey) return null;
    
    // Parse outcome
    let outcome = {};
    try {
      outcome = typeof hash.outcome === "string" ? JSON.parse(hash.outcome) : (hash.outcome || {});
    } catch {
      // outcome might be stored as individual fields
      outcome = {
        win: hash.outWin || hash.win || "",
        place: hash.outPlace || hash.place || "",
        show: hash.outShow || hash.show || "",
      };
    }
    
    // Parse hits
    const winHit = hash.winHit === "true" || hash.winHit === true || hash.winHit === "1";
    const top3Hit = hash.top3Hit === "true" || hash.top3Hit === true || hash.top3Hit === "1";
    
    // Good outcome: win OR top3
    const goodOutcome = winHit || top3Hit;
    
    return {
      key,
      ...raceKey,
      track: hash.track || raceKey.track,
      date: hash.date || hash.dateIso || raceKey.date,
      raceNo: hash.raceNo || raceKey.raceNo,
      outcome,
      winHit,
      top3Hit,
      goodOutcome,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Load and merge dataset from Redis
 * Returns merged rows with both prediction metrics (Conf, T3M) and outcomes (winHit, top3Hit)
 */
async function loadMergedDataset() {
  try {
    // Check cache
    if (cachedDataset && cacheLoadTime && (Date.now() - cacheLoadTime) < CACHE_TTL_MS) {
      return cachedDataset;
    }
    
    // Load prediction logs (fl:pred:*)
    let predKeys = [];
    try {
      predKeys = await keys("fl:pred:*");
    } catch (error) {
      console.warn("[greenzone_v1] Failed to load prediction keys:", error?.message || error);
      return { rows: [], stats: { count: 0, goodCount: 0, lastLoadedAt: null } };
    }
    
    // Load verify logs (fl:verify:*)
    let verifyKeys = [];
    try {
      verifyKeys = await keys("fl:verify:*");
    } catch (error) {
      console.warn("[greenzone_v1] Failed to load verify keys:", error?.message || error);
      return { rows: [], stats: { count: 0, goodCount: 0, lastLoadedAt: null } };
    }
    
    // Load all prediction logs
    const predictions = new Map(); // key: matchKey -> prediction data
    for (const key of predKeys.slice(0, 10000)) { // Limit to 10k for performance
      const pred = await loadPredictionLog(key);
      if (pred) {
        const matchKey = buildMatchKey(pred.track, pred.date, pred.raceNo);
        if (!predictions.has(matchKey)) {
          predictions.set(matchKey, pred);
        }
      }
    }
    
    // Load all verify logs and merge with predictions
    const mergedRows = [];
    for (const key of verifyKeys.slice(0, 10000)) { // Limit to 10k for performance
      const verify = await loadVerifyLog(key);
      if (!verify || !verify.goodOutcome) continue; // Only keep "good" outcomes
      
      const matchKey = buildMatchKey(verify.track, verify.date, verify.raceNo);
      const pred = predictions.get(matchKey);
      
      if (pred) {
        // Merge prediction metrics with verify outcomes
        mergedRows.push({
          track: verify.track,
          date: verify.date,
          raceNo: verify.raceNo,
          confidence: pred.confidence,
          top3Mass: pred.top3Mass,
          winHit: verify.winHit,
          top3Hit: verify.top3Hit,
          outcome: verify.outcome,
        });
      }
    }
    
    const stats = {
      count: mergedRows.length,
      goodCount: mergedRows.filter(r => r.winHit || r.top3Hit).length,
      lastLoadedAt: new Date().toISOString(),
    };
    
    // Update cache
    cachedDataset = { rows: mergedRows, stats };
    cacheLoadTime = Date.now();
    
    return cachedDataset;
  } catch (error) {
    console.warn("[greenzone_v1] Failed to load merged dataset:", error?.message || error);
    return { rows: [], stats: { count: 0, goodCount: 0, lastLoadedAt: null } };
  }
}

/**
 * Public function to load GreenZone dataset
 * Returns empty dataset on any error (safe)
 */
export async function loadGreenZoneDataset() {
  try {
    return await loadMergedDataset();
  } catch (error) {
    console.warn("[greenzone_v1] loadGreenZoneDataset failed:", error?.message || error);
    return { rows: [], stats: { count: 0, goodCount: 0, lastLoadedAt: null } };
  }
}

// ============================================================================
// SIMILARITY COMPUTATION
// ============================================================================

/**
 * Normalize confidence to [0, 1] range
 */
function normalizeConfidence(conf) {
  if (!Number.isFinite(conf)) return 0;
  return Math.max(0, Math.min(1, conf / 100));
}

/**
 * Normalize top3Mass to [0, 1] range
 * Handles both percentage (72) and decimal (0.72) formats
 */
function normalizeTop3Mass(t3m) {
  if (!Number.isFinite(t3m)) return 0;
  // If > 1, assume it's a percentage; if <= 1, assume it's already decimal
  const normalized = t3m > 1 ? t3m / 100 : t3m;
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Compute Euclidean distance in normalized Conf-T3M space
 */
function computeDistance(conf1, t3m1, conf2, t3m2) {
  const c1 = normalizeConfidence(conf1);
  const t1 = normalizeTop3Mass(t3m1);
  const c2 = normalizeConfidence(conf2);
  const t2 = normalizeTop3Mass(t3m2);
  
  const dx = c2 - c1;
  const dy = t2 - t1;
  
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute similarity score using Gaussian-like function
 * Returns value in [0, 1] range where 1 = identical, 0 = very different
 */
function computeSimilarity(conf1, t3m1, conf2, t3m2) {
  const distance = computeDistance(conf1, t3m1, conf2, t3m2);
  // Gaussian-like: exp(-alpha * distance^2)
  return Math.exp(-GREENZONE_CONFIG.SIMILARITY_ALPHA * distance * distance);
}

// ============================================================================
// CURRENT RACE GREENZONE
// ============================================================================

/**
 * Fetch prediction log for a specific race
 */
async function fetchRacePrediction(track, dateIso, raceNo) {
  try {
    // Try multiple possible key patterns
    const patterns = [
      slugRaceId({ track, date: dateIso, postTime: "unknown", raceNo }),
      slugRaceId({ track, date: dateIso, postTime: "", raceNo }),
    ];
    
    for (const raceId of patterns) {
      const key = `fl:pred:${raceId}`;
      const hash = await hgetall(key);
      if (hash && Object.keys(hash).length > 0) {
        const confRaw = parseFloat(hash.confidence || "0") || 0;
        const confidence = confRaw <= 1 ? confRaw * 100 : confRaw;
        const t3Raw = parseFloat(hash.top3_mass || "0") || 0;
        const top3Mass = t3Raw <= 1 ? t3Raw * 100 : t3Raw;
        
        if (Number.isFinite(confidence) && Number.isFinite(top3Mass) && confidence > 0 && top3Mass > 0) {
          return {
            confidence: Math.max(0, Math.min(100, confidence)),
            top3Mass: Math.max(0, Math.min(100, top3Mass)),
          };
        }
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Fetch all prediction logs for a track + date
 */
async function fetchCardPredictions(track, dateIso) {
  try {
    const normalizedTrack = (track || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const allKeys = await keys("fl:pred:*");
    
    const cardEntries = [];
    for (const key of allKeys) {
      const pred = await loadPredictionLog(key);
      if (pred) {
        const predTrack = (pred.track || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const predDate = String(pred.date || "").trim();
        
        if (predTrack === normalizedTrack && predDate === dateIso) {
          cardEntries.push({
            track: pred.track,
            dateIso: pred.date,
            raceNo: pred.raceNo,
            confidence: pred.confidence,
            top3Mass: pred.top3Mass,
          });
        }
      }
    }
    
    return cardEntries;
  } catch (error) {
    console.warn("[greenzone_v1] Failed to fetch card predictions:", error?.message || error);
    return [];
  }
}

/**
 * Compute GreenZone for a single race
 * @param {Object} raceCtx - Race context { track, raceNo, dateIso, predicted?, outcome? }
 * @param {Object} opts - Options
 * @returns {Object} - GreenZone result
 */
export async function computeGreenZoneForRace(raceCtx, opts = {}) {
  try {
    const { track, raceNo, dateIso, predicted, outcome } = raceCtx || {};
    
    if (!track || !dateIso || !raceNo) {
      return { enabled: false, reason: "missing_race_context" };
    }
    
    // Load merged historical dataset
    const dataset = await loadMergedDataset();
    if (!dataset || !dataset.rows || dataset.rows.length < GREENZONE_CONFIG.MIN_HISTORICAL_RACES) {
      return {
        enabled: false,
        reason: "insufficient_historical_data",
        debug: { historicalCount: dataset?.rows?.length || 0 },
      };
    }
    
    // Fetch prediction for current race
    const currentPred = await fetchRacePrediction(track, dateIso, raceNo);
    if (!currentPred) {
      return { enabled: false, reason: "no_prediction_for_race" };
    }
    
    const { confidence, top3Mass } = currentPred;
    
    // Compute similarities for all historical good races
    const matchedRaces = [];
    for (const row of dataset.rows) {
      const similarity = computeSimilarity(confidence, top3Mass, row.confidence, row.top3Mass);
      
      if (similarity >= GREENZONE_CONFIG.MEDIUM_SIMILARITY) {
        matchedRaces.push({
          track: row.track,
          dateIso: row.date,
          raceNo: row.raceNo,
          confidence: row.confidence,
          top3Mass: row.top3Mass,
          winHit: row.winHit,
          top3Hit: row.top3Hit,
          similarityScore: Math.round(similarity * 1000) / 1000,
          outcome: row.outcome || {},
        });
      }
    }
    
    // Sort by similarity (highest first)
    matchedRaces.sort((a, b) => b.similarityScore - a.similarityScore);
    
    // Determine max similarity
    const maxSimilarity = matchedRaces.length > 0 ? matchedRaces[0].similarityScore : 0;
    
    // Fetch card predictions
    const cardPredictions = await fetchCardPredictions(track, dateIso);
    
    // Compute card candidates
    const cardCandidates = [];
    const currentRaceNoStr = String(raceNo).trim();
    
    for (const cardPred of cardPredictions) {
      const cardRaceNoStr = String(cardPred.raceNo || "").trim();
      if (cardRaceNoStr === currentRaceNoStr) continue; // Skip current race
      
      // Compute similarity against historical races
      const cardMatches = [];
      for (const row of dataset.rows) {
        const similarity = computeSimilarity(
          cardPred.confidence,
          cardPred.top3Mass,
          row.confidence,
          row.top3Mass
        );
        
        if (similarity >= GREENZONE_CONFIG.MIN_CARD_SIMILARITY) {
          cardMatches.push({
            similarity,
            row,
          });
        }
      }
      
      const matchedCount = cardMatches.length;
      if (matchedCount >= GREENZONE_CONFIG.MIN_CARD_MATCH_COUNT) {
        // Sort matches and get closest
        cardMatches.sort((a, b) => b.similarity - a.similarity);
        const closestMatch = cardMatches[0];
        
        cardCandidates.push({
          track: cardPred.track || track,
          dateIso: cardPred.dateIso || dateIso,
          raceNo: cardPred.raceNo,
          confidence: Math.round(cardPred.confidence),
          top3Mass: Math.round(cardPred.top3Mass),
          similarityScore: Math.round(closestMatch.similarity * 1000) / 1000,
          matchedCount,
          closestMatch: closestMatch.row
            ? {
                track: closestMatch.row.track,
                dateIso: closestMatch.row.date,
                raceNo: closestMatch.row.raceNo,
                confidence: Math.round(closestMatch.row.confidence),
                top3Mass: Math.round(closestMatch.row.top3Mass),
                outcome: closestMatch.row.outcome || {},
              }
            : undefined,
        });
      }
    }
    
    // Sort card candidates by similarity, limit to top N
    cardCandidates.sort((a, b) => b.similarityScore - a.similarityScore);
    const topCardCandidates = cardCandidates.slice(0, GREENZONE_CONFIG.MAX_CARD_CANDIDATES);
    
    // Build result
    return {
      enabled: true,
      current: {
        track,
        raceNo,
        dateIso,
        confidence,
        top3Mass,
        similarityScore: maxSimilarity,
        matchedRaces: matchedRaces.slice(0, 20), // Limit to top 20 for response size
      },
      cardCandidates: topCardCandidates,
      debug: {
        historicalCount: dataset.rows.length,
        matchedCount: matchedRaces.length,
        cardPredictionsFound: cardPredictions.length,
      },
    };
  } catch (error) {
    console.warn("[greenzone_v1] computeGreenZoneForRace failed:", error?.message || error);
    return {
      enabled: false,
      reason: "internal_error",
    };
  }
}

// ============================================================================
// SUMMARY TEXT HELPER
// ============================================================================

/**
 * Build human-friendly summary text for GreenZone
 * @param {Object} current - Current race GreenZone data
 * @param {Object} opts - Options
 * @returns {string} - Human-readable summary
 */
export function buildGreenZoneSummaryText(current, opts = {}) {
  try {
    if (!current || !current.similarityScore || !current.matchedRaces || current.matchedRaces.length === 0) {
      return "GreenZone: No matches found for this race.";
    }
    
    const similarity = current.similarityScore;
    const matchCount = current.matchedRaces.length;
    const conf = Math.round(current.confidence || 0);
    const t3m = Math.round(current.top3Mass || 0);
    
    // Determine level
    let level = "Weak Match";
    if (similarity >= GREENZONE_CONFIG.MIN_GOOD_SIMILARITY && matchCount >= GREENZONE_CONFIG.MIN_MATCH_COUNT_STRONG) {
      level = "Strong Match";
    } else if (similarity >= GREENZONE_CONFIG.MEDIUM_SIMILARITY && matchCount >= GREENZONE_CONFIG.MIN_MATCH_COUNT_MEDIUM) {
      level = "Medium Match";
    }
    
    // Get closest match
    const closest = current.matchedRaces[0];
    const closestConf = Math.round(closest?.confidence || 0);
    const closestT3m = Math.round(closest?.top3Mass || 0);
    const closestWin = closest?.outcome?.win || "";
    const closestTrack = closest?.track || "";
    const closestRaceNo = closest?.raceNo || "";
    
    const lines = [];
    lines.push(`GreenZone Summary`);
    lines.push(`${level} (Similarity Score: ${similarity.toFixed(2)})`);
    lines.push(
      `This race's confidence (${conf}) and T3M (${t3m}%) match ${matchCount} past races where the app predicted the winner correctly.`
    );
    
    if (closest) {
      lines.push(
        `Closest Match: ${closestTrack} Race ${closestRaceNo} — Confidence ${closestConf}, T3M ${closestT3m}% — WIN was correct${closestWin ? ` (${closestWin})` : ""}.`
      );
    }
    
    return lines.join("\n");
  } catch (error) {
    console.warn("[greenzone_v1] buildGreenZoneSummaryText failed:", error?.message || error);
    return "GreenZone: Unable to generate summary.";
  }
}
