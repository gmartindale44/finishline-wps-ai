// pages/api/verify_race.js
// FinishLine WPS AI — HRN-only verify endpoint (stable, no 500s)

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Normalize a string into a simple slug (for URLs / keys)
 */
function normSlug(x = "") {
  return (x || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/**
 * Normalize horse name for comparisons
 */
function normalizeName(value = "") {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Safely parse body (supports stringified JSON)
 */
function parseBody(req) {
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  return body && typeof body === "object" ? body : {};
}

export default async function handler(req, res) {
  const debugNotes = [];

  const addDebug = (note) => {
    if (note && typeof note === "object") {
      debugNotes.push(note);
    }
  };

  // --- Method guard: always return 200 with structured error ---
  if (req.method !== "POST") {
    return res.status(200).json({
      ok: false,
      step: "verify_race_method_validation",
      error: "Method Not Allowed",
      details: "Only POST requests are accepted",
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

  try {
    const body = parseBody(req);

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
    const normalizedTrack = normSlug(safe.track);

    // HRN entries/results URL we scrape
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    // --- Stage 1: minimal ping/debug mode ---
    if (req.query?.stage === "stage1") {
      return res.status(200).json({
        ok: true,
        step: "stage1",
        received: safe,
        normalizedTrack,
        targetUrl,
      });
    }

    // --- Main flow: fetch + parse HRN results ---
    let outcome = { win: "", place: "", show: "" };
    let ok = true;
    let error = null;

    try {
      const parsed = await fetchAndParseResults(targetUrl, {
        raceNo: safe.raceNo,
      });

      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        // Whatever your lib/results.js returns will be used directly
        outcome = {
          win: parsed.win ?? "",
          place: parsed.place ?? "",
          show: parsed.show ?? "",
        };

        addDebug({
          where: "parsed_outcome",
          parsed,
        });
      } else {
        addDebug({
          where: "parsed_outcome",
          note: "no-wps-found",
        });
      }
    } catch (err) {
      ok = false;
      error = String(err?.message || err);
      addDebug({
        where: "fetchAndParseResults",
        error,
      });
      console.error("[verify_race] fetchAndParseResults failed", err);
    }

    // --- Hit calculation: Win / Place / Show / Top3 ---
    const predictedSafe = {
      win: safe.predicted && safe.predicted.win ? String(safe.predicted.win) : "",
      place:
        safe.predicted && safe.predicted.place ? String(safe.predicted.place) : "",
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
      winHit: !!pWin && !!oWin && pWin === oWin,
      placeHit: !!pPlace && !!oPlace && pPlace === oPlace,
      showHit: !!pShow && !!oShow && pShow === oShow,
      top3Hit:
        (pWin && (pWin === oWin || pWin === oPlace || pWin === oShow)) ||
        (pPlace && (pPlace === oWin || pPlace === oPlace || pPlace === oShow)) ||
        (pShow && (pShow === oWin || pShow === oPlace || pShow === oShow)),
    };

    // --- Optional Redis logging (best-effort, never throws out) ---
    try {
      const race_id = slugRaceId({
        track: safe.track,
        date: safe.date,
        raceNo: safe.raceNo,
      });

      if (race_id) {
        const log_key = `fl:pred:${race_id}`;

        await hset(log_key, {
          status: ok ? "resolved" : "error",
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

    // --- Final response (always 200) ---
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
    // Outer catch: we STILL return 200 with structured error
    console.error("[verify_race] outer handler error", err);
    debugNotes.push({
      where: "outer_handler",
      error: String(err?.message || err),
    });

    return res.status(200).json({
      ok: false,
      step: "verify_race",
      usingDate: null,
      normalizedTrack: null,
      targetUrl: null,
      outcome: { win: "", place: "", show: "" },
      hits: {
        winHit: false,
        placeHit: false,
        showHit: false,
        top3Hit: false,
      },
      error: String(err?.message || err),
      debugNotes,
    });
  }
}
