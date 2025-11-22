// pages/api/verify_race.js
// Minimal, hardened verify_race handler:
// - Directly hits HRN entries-results URL
// - Uses fetchAndParseResults for W/P/S
// - No Google CSE, no Equibase, no Redis
// - Always returns 200 with structured JSON (no FUNCTION_INVOCATION_FAILED)

import { fetchAndParseResults } from "../../lib/results.js";

function normalizeName(value = "") {
  return (value || "").toString().toLowerCase().replace(/\s+/g, " ").trim();
}

function emptyHits() {
  return {
    winHit: false,
    placeHit: false,
    showHit: false,
    top3Hit: false,
  };
}

function slugTrackForHRN(track = "") {
  return track.toString().trim().toLowerCase().replace(/\s+/g, "-");
}

export default async function handler(req, res) {
  const debugNotes = [];
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  try {
    // --- Method guard -------------------------------------------------------
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(200).json({
        ok: false,
        step: "verify_race_method_validation",
        error: "Method Not Allowed",
        details: "Only POST requests are accepted",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: emptyHits(),
        debugNotes,
      });
    }

    // --- Body parsing (be tolerant of string body) --------------------------
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
      date: inputDate,
      raceNo,
      race_no,
      predicted = {},
    } = body || {};

    safeTrack = track || "";
    safeDate = inputDate || "";
    safeRaceNo = raceNo ?? race_no ?? "";

    if (!safeTrack || !safeDate) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required fields",
        details: "Both track and date are required",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: emptyHits(),
        debugNotes,
      });
    }

    // --- Build HRN URL ------------------------------------------------------
    const normalizedTrack = slugTrackForHRN(safeTrack);
    const usingDate = safeDate; // YYYY-MM-DD from the form
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    // --- Core: fetch + parse W/P/S -----------------------------------------
    let outcome = { win: "", place: "", show: "" };

    try {
      const parsed = await fetchAndParseResults(targetUrl, {
        raceNo: safeRaceNo || null,
      });

      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        outcome = {
          win: parsed.win ?? "",
          place: parsed.place ?? "",
          show: parsed.show ?? "",
        };
      } else {
        debugNotes.push({
          where: "parsed_outcome",
          note: "no-wps-found",
          url: targetUrl,
          raceNo: safeRaceNo || null,
        });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      debugNotes.push({
        where: "resolveOutcomeFromTargetUrl",
        error: msg,
        url: targetUrl,
      });
      console.error("[verify_race] fetchAndParseResults failed", msg);
      // outcome stays empty
    }

    // --- Hit calculation ----------------------------------------------------
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

    // --- Summary string (for the UI Summary panel) -------------------------
    let outcomeLine = "Outcome: (none)";
    if (outcome.win || outcome.place || outcome.show) {
      outcomeLine = `Outcome: Win ${outcome.win || "(?)"} • Place ${
        outcome.place || "(?)"
      } • Show ${outcome.show || "(?)"}`;
    }

    const summary = [
      `Using date: ${usingDate}`,
      `Step: verify_race`,
      outcomeLine,
    ].join("\n");

    // --- Normal success response -------------------------------------------
    return res.status(200).json({
      ok: true,
      step: "verify_race",
      usingDate,
      date: usingDate,
      track: safeTrack,
      raceNo: safeRaceNo || null,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
      normalizedTrack,
      targetUrl,
      debugNotes: debugNotes.length ? debugNotes : undefined,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[verify_race] outer handler error", msg, err?.stack);

    // Even on crash, return 200 with structured payload so the UI doesn't see 500
    return res.status(200).json({
      ok: false,
      step: "verify_race",
      error: "verify_race failed",
      details: msg || "Unknown error occurred",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: { win: "", place: "", show: "" },
      hits: emptyHits(),
      debugNotes,
    });
  }
}
