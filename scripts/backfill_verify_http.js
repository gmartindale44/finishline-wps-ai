// scripts/backfill_verify_http.js
//
// FinishLine WPS AI — Verify Backfill Script
//
// Goal:
//   For every prediction in Redis (fl:pred:*), ensure there is a matching
//   verify log in Redis (fl:verify:*). If missing, call the HTTP
//   /api/verify_race endpoint to generate it, exactly like the UI button.
//
// Usage (PowerShell):
//   node scripts/backfill_verify_http.js
//
// Required env vars:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//   FINISHLINE_VERIFY_BASE_URL (optional, defaults to Vercel-style)
//     e.g. https://finishline-wps-ai.vercel.app
//
// Notes:
//   - This script is intentionally conservative about overwriting: it will
//     NEVER overwrite existing verify logs — it only fills gaps.
//   - It’s permissive about input: if fields are missing on the hash, it
//     re-derives them from raceId when possible.
//   - Node 18+ is assumed (for global fetch).
//

import { Redis } from "@upstash/redis";

// ---------- Config ----------

// Prefixes used everywhere else in your tooling
const PRED_PREFIX = "fl:pred:";
const VERIFY_PREFIX = "fl:verify:";

// Default API base (can be overridden via env)
const DEFAULT_VERIFY_BASE =
  process.env.FINISHLINE_VERIFY_BASE_URL ||
  "https://finishline-wps-ai.vercel.app";

const VERIFY_ENDPOINT = `${DEFAULT_VERIFY_BASE}/api/verify_race`;

// Safety: max races to backfill in one run.
// For debugging we keep this small. Once you're happy, set this to 0 for "no limit".
const MAX_BACKFILL = 0; // backfill all missing races

// Artificial delay between HTTP calls (ms)
const REQUEST_DELAY_MS = 750;

// ---------- Helpers ----------

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(
      `[Backfill] Missing required env var ${name}. Aborting backfill.`
    );
    process.exit(1);
  }
  return value;
}

async function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// Robust SCAN iterator for Upstash
async function* scanKeys(redis, match, count = 100) {
  let cursor = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match, count });
    cursor = Number(nextCursor);
    for (const k of keys) {
      yield k;
    }
  } while (cursor !== 0);
}

// Derive raceId from a prediction hash.
// We prefer the "race_id" field if present, otherwise we fallback to the key.
function extractRaceId(predKey, hash) {
  if (hash && typeof hash.race_id === "string" && hash.race_id.length > 0) {
    return hash.race_id;
  }
  // Key looks like: fl:pred:aqueduct-2025-11-24-unknown-r0
  const raw = predKey.replace(PRED_PREFIX, "");
  return raw;
}

// Build the HTTP POST body for /api/verify_race.
//
// This keeps the *permissive* spirit of your original script but now:
//
//   - First tries to read track/date/raceNo from the prediction hash.
//   - If missing, falls back to parsing them from raceId.
//   - Always sends raceId so the handler can still derive context.
//
// Final payload shape (when data is available):
//
//   {
//     raceId,
//     source: "verify_backfill",
//     track,         // string, e.g. "Aqueduct Racetrack"
//     raceNo,        // string, e.g. "6"
//     date,          // "YYYY-MM-DD"
//     dateRaw,       // same as date
//     dateIso        // same as date (backwards compat)
//   }
//
// If some fields can't be derived, we simply omit them and still send raceId.
/**
 * Extract track, date, raceNo from a raceId slug such as:
 *   "aqueduct-2025-11-24-unknown-r0"
 *   "aqueduct-racetrack-2025-11-30-unknown-r0"
 *   "aus-armidale-2025-11-09-unknown-r0"
 *
 * Pattern produced by buildVerifyRaceId:
 *   [slugTrack]-[YYYY-MM-DD]-unknown-r{raceNo}
 */
function parseFromRaceId(raceId) {
  if (!raceId || typeof raceId !== "string") {
    return { track: null, date: null, raceNo: null };
  }

  const parts = raceId.split("-");
  if (parts.length < 4) {
    return { track: null, date: null, raceNo: null };
  }

  // Find the date segment (YYYY-MM-DD) - it's split across 3 parts: YYYY, MM, DD
  // Look for a 4-digit year followed by 2-digit month and 2-digit day
  let dateStartIndex = -1;
  for (let i = 0; i < parts.length - 2; i++) {
    if (
      /^\d{4}$/.test(parts[i]) &&
      /^\d{2}$/.test(parts[i + 1]) &&
      /^\d{2}$/.test(parts[i + 2])
    ) {
      dateStartIndex = i;
      break;
    }
  }

  if (dateStartIndex === -1) {
    return { track: null, date: null, raceNo: null };
  }

  // Reconstruct the date: YYYY-MM-DD
  const date = `${parts[dateStartIndex]}-${parts[dateStartIndex + 1]}-${parts[dateStartIndex + 2]}`;

  // Track slug is everything before the date; convert dashes back to spaces
  const trackSlug = parts.slice(0, dateStartIndex).join("-");
  const track = trackSlug.replace(/-/g, " ").trim() || null;

  // RaceNo is usually last part: "r0", "r1", ...
  const last = parts[parts.length - 1];
  let raceNo = null;
  const m = last.match(/^r(\d+)$/i);
  if (m) {
    raceNo = m[1]; // "0", "1", etc.
  } else {
    raceNo = last || null;
  }

  return { track, date, raceNo };
}


function buildVerifyRequestBody(raceId, hash) {
  // Base payload: always send raceId + source
  const body = {
    raceId,
    source: "verify_backfill",
  };

  let track = null;
  let date = null;
  let raceNo = null;

  // --- 1) Try to get fields from the hash, if present ---
  if (hash && typeof hash === "object") {
    if (hash.track) {
      track = String(hash.track).trim() || null;
    }

    const raceNoRaw =
      hash.raceNo !== undefined && hash.raceNo !== null
        ? hash.raceNo
        : hash.race_no !== undefined && hash.race_no !== null
        ? hash.race_no
        : hash.race !== undefined && hash.race !== null
        ? hash.race
        : null;

    if (raceNoRaw !== null && raceNoRaw !== undefined) {
      const raceNoStr = String(raceNoRaw).trim();
      if (raceNoStr) {
        raceNo = raceNoStr;
      }
    }

    const dateCandidate =
      hash.dateIso ||
      hash.date_iso ||
      hash.date ||
      null;

    if (dateCandidate) {
      const d = String(dateCandidate).trim();
      if (d) {
        date = d;
      }
    }
  }

  // --- 2) Fallback: parse from raceId if anything is still missing ---
  if (!track || !date || !raceNo) {
    const fromId = parseFromRaceId(raceId);
    if (!track && fromId.track) track = fromId.track;
    if (!date && fromId.date) date = fromId.date;
    if (!raceNo && fromId.raceNo) raceNo = fromId.raceNo;
  }

  // --- 3) Populate the body with whatever we have ---

  if (track) {
    body.track = track;
  }
  if (raceNo) {
    body.raceNo = raceNo; // keep as string, like UI
  }
  if (date) {
    body.date = date;
    body.dateRaw = date;
    body.dateIso = date; // extra alias if handler still looks for it
  }

  return body;
}

// ---------- Main ----------

async function main() {
  console.log("[Backfill] Starting verify backfill…");
  console.log(
    `[Backfill] Using Upstash URL: ${process.env.UPSTASH_REDIS_REST_URL}`
  );
  console.log(`[Backfill] Using verify endpoint: ${VERIFY_ENDPOINT}`);

  const url = requireEnv("UPSTASH_REDIS_REST_URL");
  const token = requireEnv("UPSTASH_REDIS_REST_TOKEN");

  const redis = new Redis({
    url,
    token,
  });

  let scanned = 0;
  let skippedAlreadyVerified = 0;
  let scheduled = 0;
  let success = 0;
  let failures = 0;

  // Scan all prediction hashes
  for await (const predKey of scanKeys(redis, `${PRED_PREFIX}*`, 200)) {
    scanned++;

    // Check if this is actually a hash; skip non-hash keys (safety).
    const type = await redis.type(predKey);
    if (type !== "hash") {
      // This is the WRONGTYPE spam you saw earlier — we just skip them.
      continue;
    }

    const hash = await redis.hgetall(predKey);
    const raceId = extractRaceId(predKey, hash);

    // Verify keys are conventionally fl:verify:<raceId-without-r0-or-as-is>
    const verifyKey = `${VERIFY_PREFIX}${raceId}`;

    const exists = await redis.exists(verifyKey);
    if (exists) {
      skippedAlreadyVerified++;
      continue;
    }

    // Respect MAX_BACKFILL limit if set
    if (MAX_BACKFILL > 0 && scheduled >= MAX_BACKFILL) {
      break;
    }

    const body = buildVerifyRequestBody(raceId, hash);
    scheduled++;

    console.log(
      `[Backfill] → Backfilling raceId=${raceId} (predKey=${predKey})…`
    );
    console.log(`[Backfill]   Payload: ${JSON.stringify(body)}`);

    try {
      const res = await fetch(VERIFY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(
          `[Backfill]   ❌ HTTP ${res.status} for raceId=${raceId} – ${text}`
        );
        failures++;
      } else {
        const json = await res.json().catch(() => null);
        if (json && (json.ok || json.success !== false)) {
          console.log(`[Backfill]   ✅ Verified + logged raceId=${raceId}`);
        } else {
          console.warn(
            `[Backfill]   ⚠️  Verify API did not return ok flag for raceId=${raceId}`
          );
        }
        success++;
      }
    } catch (err) {
      console.error(
        `[Backfill]   💥 Error calling verify API for raceId=${raceId}:`,
        err.message || err
      );
      failures++;
    }

    // Small delay to avoid hammering HRN/Equibase or Upstash
    if (REQUEST_DELAY_MS > 0) {
      await delay(REQUEST_DELAY_MS);
    }
  }

  console.log("────────────────────────────────────────────");
  console.log("[Backfill] Finished.");
  console.log(
    `[Backfill] Prediction hashes scanned      : ${scanned}`
  );
  console.log(
    `[Backfill] Skipped (already verified)    : ${skippedAlreadyVerified}`
  );
  console.log(
    `[Backfill] New verify calls attempted    : ${scheduled}`
  );
  console.log(`[Backfill] Verify successes              : ${success}`);
  console.log(`[Backfill] Verify failures               : ${failures}`);
  console.log("────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});
