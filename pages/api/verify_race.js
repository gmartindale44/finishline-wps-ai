// FinishLine WPS AI — verify_race baseline (stable, HRN-only, no 500s)

import { fetchAndParseResults } from "../../lib/results.js";
import { hset } from "../../lib/redis.js";
import { slugRaceId } from "../../lib/normalize.js";

/**
 * Normalize a horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").toString().replace(/\s+/g, " ").trim();
}

/**
 * Normalize for slug-style track segment
 */
function normalizeTrackSlug(track = "") {
  return (track || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Safely parse request body (supports JSON string)
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

  if (!body && typeof req.json === "function") {
    try {
      body = req.json();
    } catch {
      body = {};
    }
  }

  return body && typeof body === "object" ? body : {};
}

export default async function handler(req, res) {
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  const debugNotes = [];
  const addDebug = (note) => {
    if (note && typeof note === "object") debugNotes.push(note);
  };

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

    const raceNumber = raceNo ?? race_no ?? null;

    safeTrack = track || null;
    safeDate = (date && String(date).trim()) || null;
    safeRaceNo = raceNumber;

    console.info("[verify_race] request", {
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    if (!track) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required field: track",
        details: "Track is required to verify a race",
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
        debugNotes,
      });
    }

    if (!safeDate) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required field: date",
        details: "Date (YYYY-MM-DD) is required",
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
        debugNotes,
      });
    }

    const normalizedTrack = normalizeTrackSlug(track);
    const usingDate = safeDate;
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${usingDate}`;

    let outcome = { win: "", place: "", show: "" };
    let ok = true;
    let error = null;

    try {
      const parsed = await fetchAndParseResults(targetUrl, { raceNo: raceNumber });

      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        outcome = {
          win: parsed.win ?? "",
          place: parsed.place ?? "",
          show: parsed.show ?? "",
        };
        addDebug({ where: "parsed_outcome", parsed });
      } else {
        addDebug({
          where: "parsed_outcome",
          note: "no-wps-found",
          targetUrl,
          raceNo: raceNumber,
        });
      }
    } catch (err) {
      ok = false;
      error = String(err?.message || err);
      console.error("[verify_race] fetchAndParseResults failed", err);
      addDebug({ where: "fetchAndParseResults", error, targetUrl });
    }

    const normalizeName = (v = "") =>
      normalizeHorseName(v).toLowerCase();

    const predictedSafe = {
      win: predicted.win ? String(predicted.win) : "",
      place: predicted.place ? String(predicted.place) : "",
      show: predicted.show ? String(predicted.show) : "",
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

    try {
      const race_id = slugRaceId({
        track,
        date: usingDate,
        raceNo: raceNumber,
      });

      if (race_id) {
        await hset(`fl:pred:${race_id}`, {
          status: ok ? "resolved" : "error",
          resolved_ts: String(Date.now()),
          outcome_win: outcome.win || "",
          outcome_place: outcome.place || "",
          outcome_show: outcome.show || "",
          verify_source: "verify_race_api",
        });
      }
    } catch (redisErr) {
      console.error("[verify_race] Redis logging failed", redisErr);
      addDebug({
        where: "redis_logging",
        error: String(redisErr?.message || redisErr),
      });
    }

    console.info("[verify_race] outcome", {
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
      outcome,
      hits,
    });

    return res.status(200).json({
      ok,
      step: "verify_race",
      date: usingDate,
      track,
      raceNo: raceNumber,
      outcome,
      predicted: predictedSafe,
      hits,
      error,
      debugNotes: debugNotes.length ? debugNotes : undefined,
      ctx: { usingDate, outcome, hits },
    });
  } catch (err) {
    console.error("[verify_race] outer handler error", err);

    return res.status(200).json({
      ok: false,
      step: "verify_race",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      error: String(err?.message || err) || "Unknown error",
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
}
