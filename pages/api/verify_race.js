// pages/api/verify_race.js
// FinishLine WPS AI - Verify Race API
// Stable baseline: uses fetchAndParseResults() and always returns JSON (no FUNCTION_INVOCATION_FAILED)

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Normalize a horse name for comparison.
 * Lowercase, collapse whitespace.
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value = "") {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a simple "slug" for track names used in URLs.
 * e.g. "Aqueduct" -> "aqueduct"
 */
function slugTrack(track = "") {
  return (track || "").trim().toLowerCase().replace(/\s+/g, "-");
}

export default async function handler(req, res) {
  const debugNotes = [];

  try {
    // --- Method guard: always respond with JSON (no 405 that bubbles) ---
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(200).json({
        ok: false,
        step: "verify_race_method_validation",
        error: "Method Not Allowed",
        details: "Only POST requests are accepted",
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        debugNotes,
      });
    }

    // --- Body parsing (tolerate string / JSON) ---
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    const {
      track,
      date,
      raceNo,
      race_no,
      predicted = {},
    } = body || {};

    const safe = {
      track: track || "",
      date: date || "",
      raceNo: raceNo || race_no || "",
      predicted: predicted || {},
    };

    const usingDate = safe.date;
    const normalizedTrack = slugTrack(safe.track);

    // Optional: minimal ping stage (for debugging wiring)
    if (req.query?.stage === "stage1") {
      return res.status(200).json({
        ok: true,
        step: "stage1",
        received: safe,
        normalizedTrack,
        targetUrl: `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`,
      });
    }

    // Basic validation
    if (!safe.track || !usingDate) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required fields",
        details: "Track and date are required to verify a race.",
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        debugNotes,
      });
    }

    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    // --- Core outcome resolution using existing library ---
    let outcome = { win: "", place: "", show: "" };
    let ok = true;
    let error = null;

    try {
      const parsed = await fetchAndParseResults(targetUrl, {
        raceNo: safe.raceNo,
      });

      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        outcome = {
          win: parsed.win ?? "",
          place: parsed.place ?? "",
          show: parsed.show ?? "",
        };
        debugNotes.push({ where: "parsed_outcome", parsed });
      } else {
        debugNotes.push({
          where: "parsed_outcome",
          note: "no-wps-found",
        });
      }
    } catch (err) {
      ok = false;
      error = err?.message || String(err);
      debugNotes.push({
        where: "parsed_outcome",
        error,
      });
      console.error("[verify_race] fetchAndParseResults failed", err);
    }

    // --- Hit calculation (Win / Place / Show / Top3) ---
    const predictedSafe = {
      win: safe.predicted && safe.predicted.win ? String(safe.predicted.win) : "",
      place:
        safe.predicted && safe.predicted.place
          ? String(safe.predicted.place)
          : "",
      show:
        safe.predicted && safe.predicted.show ? String(safe.predicted.show) : "",
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

    // --- Optional Redis logging via lib/redis.js (best-effort) ---
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
      debugNotes.push({
        where: "redis_logging",
        error: String(redisErr?.message || redisErr),
      });
      console.error("[verify_race] Redis logging failed (non-fatal)", redisErr);
    }

    // --- Success JSON (even if outcome is empty, no 500s) ---
    return res.status(200).json({
      ok,
      step: "verify_race",
      usingDate,
      normalizedTrack,
      targetUrl,
      outcome,
      hits,
      error,
      debugNotes,
    });
  } catch (err) {
    // Absolute safety net: never throw out of the handler
    console.error("[verify_race] outer handler error", err);

    return res.status(200).json({
      ok: false,
      step: "verify_race",
      usingDate: null,
      normalizedTrack: null,
      targetUrl: null,
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      error: err?.message || String(err) || "Unknown error",
      debugNotes: [
        {
          where: "outer_handler",
          error: err?.message || String(err) || "Unknown error",
        },
      ],
    });
  }
}
