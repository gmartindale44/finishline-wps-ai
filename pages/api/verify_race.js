// pages/api/verify_race.js
// Simple, safe HRN-based Verify Race handler with best-effort Redis logging.

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Resolve outcome from the HRN entries/results URL.
 * Uses the shared fetchAndParseResults helper.
 *
 * @param {Object} params
 * @param {string} params.normalizedTrack
 * @param {string} params.usingDate
 * @param {string|number|null} params.raceNo
 * @param {Object} params.predicted
 * @param {string} params.targetUrl
 * @param {Function} params.addDebug
 * @returns {Promise<{ win: string; place: string; show: string }>}
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
  }

  return outcome;
}

const normalizeName = (value = "") =>
  (value || "").toLowerCase().replace(/\s+/g, " ").trim();

export default async function handler(req, res) {
  const debugNotes = [];
  const addDebug = (note) => {
    if (note && typeof note === "object") debugNotes.push(note);
  };

  try {
    // --- Stage 1: minimal ping to confirm URL wiring ---
    if (req.method === "POST" && req.query?.stage === "stage1") {
      const { track, date, raceNo, race_no, predicted } = req.body || {};
      const safe = {
        track: track || "",
        date: date || "",
        raceNo: raceNo || race_no || "",
        predicted: predicted || {},
      };
      const normTrack = (x) =>
        (x || "").trim().toLowerCase().replace(/\s+/g, "-");
      const normalizedTrack = normTrack(safe.track);
      const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${safe.date}`;

      return res.status(200).json({
        ok: true,
        step: "stage1",
        received: safe,
        normalizedTrack,
        targetUrl,
      });
    }

    // --- Method guard (always return 200 with structured error) ---
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(200).json({
        ok: false,
        step: "verify_race",
        error: "Method Not Allowed",
        details: "Only POST requests are accepted",
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        debugNotes,
      });
    }

    // --- Body & safe values ---
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
      predicted,
    };

    const normTrack = (x) =>
      (x || "").trim().toLowerCase().replace(/\s+/g, "-");
    const normalizedTrack = normTrack(safe.track);
    const usingDate = safe.date || "";
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    // --- Core: resolve official outcome from HRN ---
    const outcome = await resolveOutcomeFromTargetUrl({
      normalizedTrack,
      usingDate,
      raceNo: safe.raceNo,
      predicted: safe.predicted,
      targetUrl,
      addDebug,
    });

    // --- Predicted + hit logic ---
    const predictedSafe = {
      win: predicted?.win ? String(predicted.win) : "",
      place: predicted?.place ? String(predicted.place) : "",
      show: predicted?.show ? String(predicted.show) : "",
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
        (pWin && (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
        (pPlace && (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
        (pShow && (pShow === oWin || pShow === oPlace || pShow === oShow)),
    };

    // --- Human-friendly summary for the UI ---
    const outcomeParts = [];
    if (outcome.win) outcomeParts.push(`Win ${outcome.win}`);
    if (outcome.place) outcomeParts.push(`Place ${outcome.place}`);
    if (outcome.show) outcomeParts.push(`Show ${outcome.show}`);
    const summary =
      outcomeParts.length > 0
        ? outcomeParts.join(" • ")
        : "(no official W/P/S results found yet)";

    // --- Optional Redis logging (best effort, non-fatal) ---
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
          verify_source: "verify_race_api_hrn",
        });
      }
    } catch (redisErr) {
      addDebug({
        where: "redis_logging",
        error: String(redisErr?.message || redisErr),
      });
      // Do NOT throw – Redis is optional
    }

    // --- Normal success response ---
    return res.status(200).json({
      ok: true,
      step: "verify_race",
      usingDate,
      track: safe.track,
      raceNo: safe.raceNo,
      outcome,
      hits,
      summary,
      normalizedTrack,
      targetUrl,
      debugNotes,
    });
  } catch (err) {
    // --- Last-resort catch: never leak a 500 to the UI ---
    addDebug({
      where: "outer_handler",
      error: String(err?.message || err),
    });
    console.error("[verify_race] fatal error", err);

    return res.status(200).json({
      ok: false,
      step: "verify_race",
      usingDate: null,
      track: null,
      raceNo: null,
      error: "verify_race failed",
      details: String(err?.message || err),
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      debugNotes,
    });
  }
}
