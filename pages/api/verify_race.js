// pages/api/verify_race.js
// Core W/P/S verification endpoint with safe error handling

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Normalize horse name for comparison
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value = "") {
  return (value || "")
    .toString()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve outcome (Win/Place/Show) from an HRN entries/results URL.
 *
 * Delegates to fetchAndParseResults, which encapsulates all HTML parsing
 * (including the HRN Runner (Speed) W/P/S table logic).
 *
 * @param {Object} params
 * @param {string} params.normalizedTrack - normalized track slug
 * @param {string} params.usingDate - YYYY-MM-DD date string
 * @param {string|number|null} params.raceNo - race number
 * @param {Object} params.predicted - predicted picks { win, place, show }
 * @param {string} params.targetUrl - HRN target URL
 * @param {Function} params.addDebug - function to push debug notes
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
    const parsed = await fetchAndParseResults(targetUrl, {
      raceNo,
      predicted,
      normalizedTrack,
      usingDate,
    });

    if (parsed && (parsed.win || parsed.place || parsed.show)) {
      outcome = {
        win: parsed.win ?? "",
        place: parsed.place ?? "",
        show: parsed.show ?? "",
      };

      if (addDebug) {
        addDebug({
          where: "parsed_outcome",
          parsed,
        });
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
    // Keep outcome as the default empty object
  }

  return outcome;
}

export default async function handler(req, res) {
  const debugNotes = [];
  const addDebug = (note) => {
    if (!note || typeof note !== "object") return;
    debugNotes.push(note);
  };

  // We keep these in outer scope so we can echo them in any error response
  let usingDate = "";
  let normalizedTrack = "";
  let targetUrl = "";
  let safe = {
    track: "",
    date: "",
    raceNo: "",
    predicted: {},
  };

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(200).json({
        step: "verify_race_method_validation",
        ok: false,
        error: "Method Not Allowed",
        details: "Only POST requests are accepted",
        usingDate,
        outcome: { win: "", place: "", show: "" },
        hits: {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        debugNotes,
      });
    }

    // Be tolerant of either object body or JSON string
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

    safe = {
      track: track || "",
      date: date || "",
      raceNo: raceNo || race_no || "",
      predicted: predicted || {},
    };

    // Minimal stage 1 ping: don't hit external services, just echo what we’d use.
    if (req.query?.stage === "stage1") {
      const norm = (x) =>
        (x || "")
          .toString()
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-");

      normalizedTrack = norm(safe.track);
      usingDate = safe.date || "";
      targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

      return res.status(200).json({
        step: "verify_race",
        stage: "stage1",
        ok: true,
        received: safe,
        normalizedTrack,
        usingDate,
        targetUrl,
        debugNotes,
      });
    }

    // Main path: full verification
    if (!safe.track || !safe.date) {
      return res.status(200).json({
        step: "verify_race_validation",
        ok: false,
        error: "Missing required fields",
        details: "Both track and date are required to verify a race",
        usingDate: safe.date,
        outcome: { win: "", place: "", show: "" },
        hits: {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        debugNotes,
      });
    }

    const norm = (x) =>
      (x || "")
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");

    normalizedTrack = norm(safe.track);
    usingDate = safe.date || "";
    targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    let outcome = { win: "", place: "", show: "" };
    let ok = true;
    let error = null;

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
      outcome = { win: "", place: "", show: "" };
    }

    // Normalize predicted & outcome names and compute hit flags
    const predictedSafe = {
      win: safe.predicted && safe.predicted.win ? String(safe.predicted.win) : "",
      place:
        safe.predicted && safe.predicted.place ? String(safe.predicted.place) : "",
      show: safe.predicted && safe.predicted.show ? String(safe.predicted.show) : "",
    };

    const pWin = normalizeName(predictedSafe.win);
    const pPlace = normalizeName(predictedSafe.place);
    const pShow = normalizeName(predictedSafe.show);
    const oWin = normalizeName(outcome.win);
    const oPlace = normalizeName(outcome.place);
    const oShow = normalizeName(outcome.show);

    const hits = {
      winHit: !!(pWin && oWin && pWin === oWin),
      placeHit: !!(pPlace && oPlace && pPlace === oPlace),
      showHit: !!(pShow && oShow && pShow === oShow),
      top3Hit:
        (!!pWin &&
          (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
        (!!pPlace &&
          (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
        (!!pShow &&
          (pShow === oWin || pShow === oPlace || pShow === oShow)),
    };

    // Best-effort Redis logging – never affects the response
    try {
      const race_id = slugRaceId({
        track: safe.track,
        date: usingDate,
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

    return res.status(200).json({
      step: "verify_race",
      ok: false,
      usingDate,
      outcome: { win: "", place: "", show: "" },
      hits: {
        winHit: false,
        placeHit: false,
        showHit: false,
        top3Hit: false,
      },
      error: String(err?.message || err),
      debugNotes: [
        {
          where: "outer_handler",
          error: String(err?.message || err),
        },
        ...debugNotes,
      ],
      normalizedTrack,
      targetUrl,
    });
  }
}
