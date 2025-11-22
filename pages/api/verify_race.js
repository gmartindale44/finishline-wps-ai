// pages/api/verify_race.js

// Ultra-safe fallback: no external API calls, but keeps Verify UI usable.

// - Always returns 200 OK

// - Never throws

// - Provides a Google search URL as top.link so "Open Top Result" works

/**
 * Safely parse the request body (supports already-parsed objects or JSON strings).
 */
function safeParseBody(req) {
  try {
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    // In some environments, body may not be populated; treat that as empty.
    if (!body || typeof body !== "object") {
      return {};
    }
    return body;
  } catch {
    return {};
  }
}

export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  // Safe defaults that we can still return even if something goes wrong
  let safeTrack = null;
  let safeDate = null;
  let safeRaceNo = null;

  try {
    // Method guard: always respond with 200 + structured error
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: false,
        step: "verify_race_method_validation",
        error: "Method Not Allowed",
        details: "Only POST requests are accepted.",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        summary: "verify_race only accepts POST requests from the FinishLine UI.",
      });
    }

    const body = safeParseBody(req);
    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      predicted = {},
    } = body || {};

    const raceNumber = raceNo ?? race_no ?? null;
    safeTrack = track || null;
    safeDate = (inputDate && String(inputDate).trim()) || null;
    safeRaceNo = raceNumber;

    // Basic validation: we at least need a track
    if (!safeTrack) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required field: track",
        details: "Track is required to verify a race.",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        summary: "Track was not provided, so no verification or search could be performed.",
      });
    }

    // --- Build a Google search URL instead of calling CSE or Equibase ---
    const datePart = safeDate ? ` ${safeDate}` : "";
    const racePart = safeRaceNo ? ` Race ${safeRaceNo}` : "";
    const query = `${safeTrack}${racePart}${datePart} results Win Place Show`;

    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
      query,
    )}`;

    const top = {
      title: `Google search: ${query}`,
      link: googleUrl,
    };

    // We are not parsing outcome yet in this ultra-safe fallback.
    const outcome = {
      win: "",
      place: "",
      show: "",
    };

    const normalize = (value = "") =>
      String(value || "").toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const pWin = normalize(predictedSafe.win);
    const pPlace = normalize(predictedSafe.place);
    const pShow = normalize(predictedSafe.show);
    const oWin = normalize(outcome.win);
    const oPlace = normalize(outcome.place);
    const oShow = normalize(outcome.show);

    const hits = {
      winHit: !!pWin && !!oWin && pWin === oWin,
      placeHit: !!pPlace && !!oPlace && pPlace === oPlace,
      showHit: !!pShow && !!oShow && pShow === oShow,
      top3Hit: false, // no real outcome yet
    };

    const summaryLines = [
      "Ultra-safe verify_race fallback (no external APIs).",
      "",
      `Track: ${safeTrack || "(none)"}`,
      `Date: ${safeDate || "(none)"}`,
      `Race #: ${safeRaceNo ?? "(none)"}`,
      "",
      `Query: ${query}`,
      `Top Result: ${top.link}`,
      "",
      "Note: This fallback does NOT auto-parse Win/Place/Show from charts.",
      "Use the 'Open Top Result' button to view search results and official charts.",
    ];

    const summary = summaryLines.join("\n");

    return res.status(200).json({
      ok: true,
      step: "verify_race_google_fallback",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      query,
      top,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
    });
  } catch (err) {
    // Absolute last-resort safety net: still respond with 200 and no throw
    return res.status(200).json({
      ok: false,
      step: "verify_race_outer_catch",
      error: String(err?.message || err || "Unknown error"),
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: { win: "", place: "", show: "" },
      hits: {
        winHit: false,
        placeHit: false,
        showHit: false,
        top3Hit: false,
      },
      summary:
        "verify_race encountered an unexpected error, but the handler caught it and returned a safe response. No external APIs were called.",
    });
  }
}
