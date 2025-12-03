#!/usr/bin/env node
/**
 * Rebuild missing prediction hashes from verify logs using daily prediction lists
 * 
 * This script:
 * 1. Scans all verify logs (fl:verify:*)
 * 2. Identifies ones without matching predictions (fl:pred:*)
 * 3. Attempts to reconstruct predictions from daily lists (fl:predictions:YYYY-MM-DD)
 * 4. Creates prediction hashes only when real data is found
 * 
 * Idempotent: does not overwrite existing predictions
 */

import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.error("[Rebuild] ERROR: Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  process.exit(1);
}

const redis = new Redis({ url, token });

/**
 * Build raceId from track/date/raceNo (matches buildVerifyRaceId from verify_race.js)
 */
function buildVerifyRaceId(track, date, raceNo) {
  const slugTrack = (track || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  let slugDate = date || "";
  if (!slugDate || !/^\d{4}-\d{2}-\d{2}$/.test(slugDate)) {
    slugDate = "";
  }

  const slugRaceNo = String(raceNo || "").trim() || "0";
  const parts = [slugTrack, slugDate, "unknown", `r${slugRaceNo}`].filter(Boolean);
  return parts.join("-");
}

/**
 * Normalize track name to slug for matching
 */
function normalizeTrackSlug(track) {
  return (track || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalize date to YYYY-MM-DD format
 */
function normalizeDate(date) {
  if (!date) return null;
  const str = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  // Try to parse other formats
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * Build canonical join key: trackSlug|date|raceNo
 */
function buildCanonKey(track, date, raceNo) {
  const trackSlug = normalizeTrackSlug(track);
  const normDate = normalizeDate(date);
  const normRaceNo = String(raceNo || "").trim();
  if (!trackSlug || !normDate || !normRaceNo) {
    return null;
  }
  return `${trackSlug}|${normDate}|${normRaceNo}`;
}

/**
 * Parse picks from various formats
 */
function parsePicks(item) {
  if (item.picks) {
    if (Array.isArray(item.picks)) {
      return {
        win: item.picks[0] || "",
        place: item.picks[1] || "",
        show: item.picks[2] || ""
      };
    }
    if (typeof item.picks === "string") {
      // Try splitting by common delimiters
      const parts = item.picks.split(/[-,\|]/).map(s => s.trim()).filter(s => s);
      return {
        win: parts[0] || "",
        place: parts[1] || "",
        show: parts[2] || ""
      };
    }
    if (typeof item.picks === "object" && !Array.isArray(item.picks)) {
      return {
        win: item.picks.win || "",
        place: item.picks.place || "",
        show: item.picks.show || ""
      };
    }
  }
  
  // Fallback to direct fields
  return {
    win: item.win || "",
    place: item.place || "",
    show: item.show || ""
  };
}

async function main() {
  console.log("[Rebuild] Starting missing prediction reconstruction...\n");

  // STEP 1: Scan all verify keys
  console.log("[Rebuild] Scanning verify logs...");
  const verifyKeys = await redis.keys("fl:verify:*");
  console.log(`[Rebuild] Found ${verifyKeys.length} verify keys\n`);

  const verifyEntries = [];
  const missingPredictions = [];

  for (const verifyKey of verifyKeys) {
    try {
      const raw = await redis.get(verifyKey);
      if (!raw) continue;

      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      // Extract required fields
      const track = data.track || "";
      const date = data.date || data.dateIso || (data.debug && data.debug.canonicalDateIso) || "";
      const raceNo = data.raceNo || "";

      // Skip if missing required fields
      if (!track || !date || !raceNo) {
        continue;
      }

      // Normalize
      const normDate = normalizeDate(date);
      if (!normDate) continue;

      // Normalize raceNo: remove any "r" prefix if present, then ensure it's just the number
      let normRaceNo = String(raceNo).trim();
      // Remove leading "r" or "R" if present
      normRaceNo = normRaceNo.replace(/^r+/i, "").trim();
      if (!normRaceNo) continue;
      const raceId = data.raceId || buildVerifyRaceId(track, normDate, normRaceNo);
      const canonKey = buildCanonKey(track, normDate, normRaceNo);

      if (!canonKey) continue;

      verifyEntries.push({
        verifyKey,
        track,
        date: normDate,
        raceNo: normRaceNo,
        raceId,
        canonKey
      });

      // Check if prediction exists
      const predKey = `fl:pred:${raceId}`;
      const predType = await redis.type(predKey);

      if (predType === "hash" || predType === "string") {
        // Prediction exists, skip
        continue;
      }

      // Missing prediction
      missingPredictions.push({
        verifyKey,
        track,
        date: normDate,
        raceNo: normRaceNo,
        raceId,
        canonKey
      });
    } catch (err) {
      console.warn(`[Rebuild] Error processing ${verifyKey}: ${err.message}`);
    }
  }

  console.log(`[Rebuild] Total verify entries: ${verifyEntries.length}`);
  console.log(`[Rebuild] Already have predictions: ${verifyEntries.length - missingPredictions.length}`);
  console.log(`[Rebuild] Missing predictions: ${missingPredictions.length}\n`);

  if (missingPredictions.length === 0) {
    console.log("[Rebuild] ✅ All verify logs have matching predictions. Nothing to rebuild.\n");
    return;
  }

  // STEP 2: Attempt reconstruction from daily prediction lists
  console.log("[Rebuild] Attempting to reconstruct missing predictions from daily lists...\n");

  let rebuiltCount = 0;
  let notFoundCount = 0;

  // Group by date for efficiency
  const byDate = {};
  for (const entry of missingPredictions) {
    if (!byDate[entry.date]) {
      byDate[entry.date] = [];
    }
    byDate[entry.date].push(entry);
  }

  for (const [date, entries] of Object.entries(byDate)) {
    // Try to find daily prediction list
    const listKey = `fl:predictions:${date}`;
    const listType = await redis.type(listKey);

    if (listType !== "list") {
      // Try loose pattern
      const altKeys = await redis.keys(`fl:predictions*${date}*`);
      if (altKeys.length === 0) {
        console.log(`[Rebuild] ⚠️ No daily prediction list found for ${date}`);
        notFoundCount += entries.length;
        continue;
      }
      // Use first matching key
      const actualListKey = altKeys[0];
      console.log(`[Rebuild] Using alternative list key: ${actualListKey} for date ${date}`);
      
      // Read list items
      const listItems = await redis.lrange(actualListKey, 0, -1);
      
      // Parse and index by canonKey
      const indexedItems = {};
      for (const rawItem of listItems) {
        try {
          const jsonStr = Array.isArray(rawItem) ? rawItem[0] : rawItem;
          const item = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
          
          const itemTrack = item.track || item.trackName || "";
          const itemDate = normalizeDate(item.date || item.dateIso || "");
          const itemRaceNo = String(item.race || item.raceNo || "").trim();
          
          if (!itemTrack || !itemDate || !itemRaceNo) continue;
          
          const itemCanonKey = buildCanonKey(itemTrack, itemDate, itemRaceNo);
          if (itemCanonKey && !indexedItems[itemCanonKey]) {
            indexedItems[itemCanonKey] = item;
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
      
      // Match verify entries to prediction items
      for (const entry of entries) {
        const matchedItem = indexedItems[entry.canonKey];
        
        if (!matchedItem) {
          console.log(`[Rebuild] ⚠️ No matching daily prediction found for ${entry.track} ${entry.date} R${entry.raceNo}`);
          notFoundCount++;
          continue;
        }
        
        // Re-check if prediction was created in the meantime
        const predKey = `fl:pred:${entry.raceId}`;
        const predType = await redis.type(predKey);
        if (predType === "hash" || predType === "string") {
          console.log(`[Rebuild] ⏭️ Prediction already exists for ${entry.track} ${entry.date} R${entry.raceNo}, skipping`);
          continue;
        }
        
        // Extract prediction data
        const picks = parsePicks(matchedItem);
        const confidence = matchedItem.confidence || "";
        const top3_mass = matchedItem.top3_mass || matchedItem.top3Mass || "";
        const strategy = matchedItem.strategy || matchedItem.strategyName || "shadow_rebuild";
        
        // Build prediction hash
        const hash = {
          race_id: entry.raceId,
          track: entry.track,
          date: entry.date,
          postTime: "",
          raceNo: entry.raceNo,
          picks: JSON.stringify(picks),
          confidence: String(confidence),
          top3_mass: String(top3_mass),
          strategy: strategy,
          status: "pending",
          created_ts: String(matchedItem.ts || Date.now()),
          result: "",
          roi_percent: "",
          notes: ""
        };
        
        // Create hash
        await redis.hset(predKey, hash);
        rebuiltCount++;
        console.log(`[Rebuild] ✅ Created prediction for ${entry.track} ${entry.date} R${entry.raceNo} from daily list`);
      }
    } else {
      // Read list items
      const listItems = await redis.lrange(listKey, 0, -1);
      
      // Parse and index by canonKey
      const indexedItems = {};
      for (const rawItem of listItems) {
        try {
          const jsonStr = Array.isArray(rawItem) ? rawItem[0] : rawItem;
          const item = typeof jsonStr === "string" ? JSON.parse(jsonStr) : jsonStr;
          
          const itemTrack = item.track || item.trackName || "";
          const itemDate = normalizeDate(item.date || item.dateIso || "");
          const itemRaceNo = String(item.race || item.raceNo || "").trim();
          
          if (!itemTrack || !itemDate || !itemRaceNo) continue;
          
          const itemCanonKey = buildCanonKey(itemTrack, itemDate, itemRaceNo);
          if (itemCanonKey && !indexedItems[itemCanonKey]) {
            indexedItems[itemCanonKey] = item;
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
      
      // Match verify entries to prediction items
      for (const entry of entries) {
        const matchedItem = indexedItems[entry.canonKey];
        
        if (!matchedItem) {
          console.log(`[Rebuild] ⚠️ No matching daily prediction found for ${entry.track} ${entry.date} R${entry.raceNo}`);
          notFoundCount++;
          continue;
        }
        
        // Re-check if prediction was created in the meantime
        const predKey = `fl:pred:${entry.raceId}`;
        const predType = await redis.type(predKey);
        if (predType === "hash" || predType === "string") {
          console.log(`[Rebuild] ⏭️ Prediction already exists for ${entry.track} ${entry.date} R${entry.raceNo}, skipping`);
          continue;
        }
        
        // Extract prediction data
        const picks = parsePicks(matchedItem);
        const confidence = matchedItem.confidence || "";
        const top3_mass = matchedItem.top3_mass || matchedItem.top3Mass || "";
        const strategy = matchedItem.strategy || matchedItem.strategyName || "shadow_rebuild";
        
        // Build prediction hash
        const hash = {
          race_id: entry.raceId,
          track: entry.track,
          date: entry.date,
          postTime: "",
          raceNo: entry.raceNo,
          picks: JSON.stringify(picks),
          confidence: String(confidence),
          top3_mass: String(top3_mass),
          strategy: strategy,
          status: "pending",
          created_ts: String(matchedItem.ts || Date.now()),
          result: "",
          roi_percent: "",
          notes: ""
        };
        
        // Create hash
        await redis.hset(predKey, hash);
        rebuiltCount++;
        console.log(`[Rebuild] ✅ Created prediction for ${entry.track} ${entry.date} R${entry.raceNo} from daily list`);
      }
    }
  }

  console.log(`\n[Rebuild] Summary:`);
  console.log(`  Total verify entries: ${verifyEntries.length}`);
  console.log(`  Already had predictions: ${verifyEntries.length - missingPredictions.length}`);
  console.log(`  Missing predictions: ${missingPredictions.length}`);
  console.log(`  Successfully rebuilt: ${rebuiltCount}`);
  console.log(`  Not found in daily lists: ${notFoundCount}`);
  console.log(`\n[Rebuild] ✅ Done!\n`);
}

main().catch(err => {
  console.error("[Rebuild] Fatal error:", err);
  process.exit(1);
});

