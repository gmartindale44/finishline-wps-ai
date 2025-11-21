// pages/api/verify_race.js
// STAGE 2: Core W/P/S parsing with safe error handling

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Resolve outcome from target URL using fetchAndParseResults
 * @param {Object} params
 * @param {string} params.normalizedTrack - Normalized track name
 * @param {string} params.usingDate - Date string (YYYY-MM-DD)
 * @param {string|number|null} params.raceNo - Race number
 * @param {Object} params.predicted - Predicted picks { win, place, show }
 * @param {string} params.targetUrl - Target URL to fetch
 * @param {Function} params.addDebug - Debug note adder function
 * @returns {Promise<{ win: string, place: string, show: string }>}
 */
async function resolveOutcomeFromTargetUrl({
  normalizedTrack,
  usingDate,
  raceNo,
  predicted,
  targetUrl,
  addDebug,
}) {
  let outcome = { win: "", place: "", show: "" };

  try {
    const parsed = await fetchAndParseResults(targetUrl, { raceNo });

    if (parsed && (parsed.win || parsed.place || parsed.show)) {
      outcome = {
        win: parsed.win ?? "",
        place: parsed.place ?? "",
        show: parsed.show ?? "",
      };
      if (addDebug) {
        addDebug({ where: "parsed_outcome", parsed });
      }
    } else if (addDebug) {
      addDebug({
        where: "parsed_outcome",
        note: "no-wps-found",
      });
    }
  } catch (err) {
    if (addDebug) {
      addDebug({
        where: "parsed_outcome",
        error: String(err?.message || err),
      });
    }
    // outcome remains the default empty object
  }

  return outcome;
}

export default async function handler(req, res) {
  try {
    // Handle stage=stage1 query param for minimal ping
    if (req.query?.stage === "stage1") {
      const { track, date, raceNo, race_no, predicted } = req.body || {};
      const safe = {
        track: track || "",
        date: date || "",
        raceNo: raceNo || race_no || "",
        predicted: predicted || {},
      };
      const norm = (x) => (x || "").trim().toLowerCase().replace(/\s+/g, "-");
      const normalizedTrack = norm(safe.track);
      const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${safe.date}`;

      return res.status(200).json({
        ok: true,
        step: "stage1",
        received: safe,
        normalizedTrack,
        targetUrl,
      });
    }

    // Main handler logic
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
    const usingDate = safe.date || "";

    // Construct the HRN entries/results URL we would normally scrape
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    // Initialize response values
    const debugNotes = [];
    const addDebug = (note) => {
      if (note && typeof note === "object") {
        debugNotes.push(note);
      }
    };

    let outcome = { win: "", place: "", show: "" };
    let ok = true;
    let error = null;

    // Resolve outcome from target URL
    try {
      outcome = await resolveOutcomeFromTargetUrl({
        normalizedTrack,
        usingDate,
        raceNo: safe.raceNo,
        predicted: safe.predicted,
        targetUrl,
        addDebug,
      });
    } catch (err) {
      ok = false;
      error = String(err?.message || err);
      addDebug({
        where: "resolveOutcomeFromTargetUrl",
        error,
      });
      console.error("[verify_race] resolveOutcomeFromTargetUrl failed", err);
    }

    // Calculate hits
    const normalizeName = (value = "") =>
      (value || "").toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const pWin = normalizeName(predictedSafe.win);
    const pPlace = normalizeName(predictedSafe.place);
    const pShow = normalizeName(predictedSafe.show);
    const oWin = normalizeName(outcome.win);
    const oPlace = normalizeName(outcome.place);
    const oShow = normalizeName(outcome.show);

    const hits = {
      winHit: pWin && oWin && pWin === oWin,
      placeHit: pPlace && oPlace && pPlace === oPlace,
      showHit: pShow && oShow && pShow === oShow,
      top3Hit:
        (pWin && (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
        (pPlace && (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
        (pShow && (pShow === oWin || pShow === oPlace || pShow === oShow)),
    };

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
      addDebug({
        where: "redis_logging",
        error: String(redisErr?.message || redisErr),
      });
      console.error("[verify_race] Redis logging failed (non-fatal)", redisErr);
    }

    return res.status(200).json({
      step: "verify_race",
      ok,
      usingDate,
      outcome,
      hits,
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
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      error: String(err?.message || err),
      debugNotes: [
        { where: "outer handler", error: String(err?.message || err) },
      ],
    });
  }
}
