// pages/api/verify_race.js
// STAGE 2: Core W/P/S parsing with safe error handling

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Core verification logic: fetch and parse W/P/S results
 * @param {Object} params
 * @param {Object} params.safe - Safe input values { track, date, raceNo, predicted }
 * @param {string} params.normalizedTrack - Normalized track name
 * @param {string} params.targetUrl - Target URL to fetch
 * @returns {Promise<{ usingDate: string, outcome: { win: string, place: string, show: string }, debugNotes: Array }>}
 */
async function coreVerifyRace({ safe, normalizedTrack, targetUrl }) {
  const debugNotes = [];
  const defaultOutcome = { win: "", place: "", show: "" };
  let usingDate = safe.date || "";
  let outcome = defaultOutcome;

  try {
    // Call fetchAndParseResults with the target URL and race number
    const raceNo = safe.raceNo ? String(safe.raceNo).trim() : null;
    const parsed = await fetchAndParseResults(targetUrl, { raceNo });

    if (parsed && (parsed.win || parsed.place || parsed.show)) {
      outcome = {
        win: parsed.win || "",
        place: parsed.place || "",
        show: parsed.show || "",
      };
    }

    // Use the date we received (already set above)
    usingDate = safe.date || "";

    // Optional: Log to Redis (best-effort, guarded)
    try {
      const race_id = slugRaceId({
        track: safe.track,
        date: safe.date,
        raceNo: safe.raceNo,
      });

      if (race_id) {
        const log_key = `fl:pred:${race_id}`;
        await hset(log_key, {
          status: "resolved",
          resolved_ts: String(Date.now()),
          outcome_win: outcome.win || "",
          outcome_place: outcome.place || "",
          outcome_show: outcome.show || "",
          verify_source: "verify_race_api",
        });
      }
    } catch (redisErr) {
      // Redis logging is optional - don't fail if it errors
      debugNotes.push({
        where: "redis_logging",
        error: String(redisErr?.message || redisErr),
      });
      console.error("[verify_race] Redis logging failed (non-fatal)", redisErr);
    }
  } catch (err) {
    // Core parsing failed - log and return empty outcome
    const errorMsg = String(err?.message || err);
    debugNotes.push({
      where: "fetchAndParseResults",
      error: errorMsg,
    });
    console.error("[verify_race] coreVerifyRace failed", err);
    // outcome already defaults to empty strings
  }

  return {
    usingDate,
    outcome,
    debugNotes,
  };
}

export default async function handler(req, res) {
  try {
    const { track, date, raceNo, race_no, predicted } = req.body || {};

    const safe = {
      track: track || "",
      date: date || "",
      raceNo: raceNo || race_no || "",
      predicted: predicted || {},
    };

    // Basic normalization (matches original code's behavior)
    const norm = (x) => (x || "").trim().toLowerCase().replace(/\s+/g, "-");

    const normalizedTrack = norm(safe.track);

    // Construct the HRN entries/results URL we would normally scrape
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${safe.date}`;

    // Initialize response values
    const defaultOutcome = { win: "", place: "", show: "" };
    let outcome = defaultOutcome;
    let usingDate = safe.date || "";
    const debugNotes = [];
    let ok = true;
    let error = null;

    // Call core verification logic (guarded)
    try {
      const core = await coreVerifyRace({ safe, normalizedTrack, targetUrl });

      if (core) {
        if (core.outcome) {
          outcome = {
            win: core.outcome.win || "",
            place: core.outcome.place || "",
            show: core.outcome.show || "",
          };
        }
        if (core.usingDate) usingDate = core.usingDate;
        if (Array.isArray(core.debugNotes)) {
          debugNotes.push(...core.debugNotes);
        }
      }
    } catch (err) {
      ok = false;
      error = String(err?.message || err);
      debugNotes.push({
        where: "coreVerifyRace wrapper",
        error,
      });
      console.error("[verify_race] coreVerifyRace wrapper failed", err);
    }

    return res.status(200).json({
      step: "verify_race",
      ok,
      usingDate,
      outcome,
      error,
      debugNotes,
      normalizedTrack,
      targetUrl,
    });
  } catch (err) {
    console.error("[verify_race] outer handler error", err);
    return res.status(500).json({
      step: "verify_race",
      ok: false,
      usingDate: "",
      outcome: { win: "", place: "", show: "" },
      error: String(err?.message || err),
      debugNotes: [
        { where: "outer handler", error: String(err?.message || err) },
      ],
    });
  }
}
