// pages/api/verify_backfill.js
// Phase 2: real backfill runner that fans out to /api/verify_race.
//
// This endpoint is intentionally conservative:
// - Accepts POST JSON payloads from the Verify UI
// - Normalizes into one or more "race" requests
// - Optionally runs in dryRun mode (no HTTP calls)
// - Calls /api/verify_race for each race and aggregates results
// - Never throws; always returns HTTP 200 with structured JSON

export const config = {
  runtime: "nodejs",
};

const DEFAULT_MAX_RACES = 10;
const HARD_MAX_RACES = 50;

function safeParseJson(maybeJson) {
  if (typeof maybeJson !== "string") return maybeJson;
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
}

function normalizeBody(req) {
  let body = req.body;

  if (!body && typeof req.body === "string") {
    body = safeParseJson(req.body);
  }

  if (typeof body === "string") {
    body = safeParseJson(body);
  }

  if (!body || typeof body !== "object") {
    body = {};
  }

  return body;
}

function coerceString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function resolveBaseUrl(req) {
  // Prefer explicit env overrides if present
  const fromEnv =
    process.env.FINISHLINE_VERIFY_BASE_URL ||
    process.env.NEXT_PUBLIC_FINISHLINE_VERIFY_BASE_URL;

  if (fromEnv && typeof fromEnv === "string") {
    return fromEnv.replace(/\/+$/, "");
  }

  // Fallback to host headers (works on Vercel + local dev)
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";

  if (!host) {
    // As a very last resort, assume localhost (dev)
    return "http://localhost:3000";
  }

  return `${proto}://${host}`;
}

function normalizeSingleRace(input, fallback = {}) {
  if (!input || typeof input !== "object") input = {};

  const track =
    coerceString(input.track) ||
    coerceString(input.trackName) ||
    coerceString(fallback.track);

  const raceNo =
    coerceString(input.raceNo) ||
    coerceString(input.race) ||
    coerceString(fallback.raceNo);

  // We try to keep both dateRaw and dateIso if the caller provides them.
  const dateRaw =
    coerceString(input.dateRaw) ||
    coerceString(input.date) ||
    coerceString(fallback.dateRaw) ||
    coerceString(fallback.date);

  const dateIso =
    coerceString(input.dateIso) ||
    coerceString(fallback.dateIso) ||
    dateRaw;

  if (!track || !raceNo || !dateIso) {
    return null;
  }

  return {
    track,
    raceNo,
    date: dateIso,
    dateIso,
    dateRaw: dateRaw || dateIso,
  };
}

/**
 * Extracts an array of race descriptors from the request body.
 * Supports several shapes to stay compatible with current / future UI:
 *
 * 1) { track, raceNo, date, dateIso, dateRaw, ... }
 * 2) { request: { ...same fields... } }
 * 3) { races: [ { track, raceNo, date... }, ... ] }
 */
function extractRacesFromBody(body, maxRaces) {
  const races = [];
  const fallback = {
    track: coerceString(body.track),
    raceNo: coerceString(body.raceNo || body.race),
    dateRaw: coerceString(body.dateRaw || body.date),
    dateIso: coerceString(body.dateIso),
  };

  if (Array.isArray(body.races)) {
    for (const r of body.races) {
      const normalized = normalizeSingleRace(r, fallback);
      if (normalized) races.push(normalized);
      if (races.length >= maxRaces) break;
    }
  } else if (body.request && typeof body.request === "object") {
    const normalized = normalizeSingleRace(body.request, fallback);
    if (normalized) races.push(normalized);
  } else {
    const normalized = normalizeSingleRace(body, fallback);
    if (normalized) races.push(normalized);
  }

  // De-duplicate by simple key
  const seen = new Set();
  const unique = [];
  for (const r of races) {
    const key = `${r.track}|${r.dateIso}|${r.raceNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(r);
    if (unique.length >= maxRaces) break;
  }

  return unique;
}

async function callVerifyRace(baseUrl, race) {
  const url = `${baseUrl}/api/verify_race`;

  const payload = {
    track: race.track,
    raceNo: race.raceNo,
    date: race.date,
    dateIso: race.dateIso,
    dateRaw: race.dateRaw,
  };

  let responseJson = null;
  let httpStatus = 0;
  let networkError = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    httpStatus = res.status;

    try {
      responseJson = await res.json();
    } catch {
      responseJson = null;
    }
  } catch (err) {
    networkError =
      err && typeof err.message === "string"
        ? err.message
        : String(err || "Unknown error");
  }

  const ok =
    !networkError &&
    httpStatus === 200 &&
    responseJson &&
    typeof responseJson === "object" &&
    responseJson.ok === true;

  return {
    race,
    ok,
    httpStatus,
    networkError,
    step: responseJson?.step || null,
    outcome: responseJson?.outcome || null,
    hits: responseJson?.hits || null,
    raw: responseJson || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // We stay nice and return 200 with a descriptive message instead of 405,
    // to keep the UI simple and avoid surprises.
    return res.status(200).json({
      ok: false,
      step: "verify_backfill",
      mode: "invalid_method",
      message: "verify_backfill expects POST with JSON body",
      method: req.method || null,
    });
  }

  const body = normalizeBody(req);

  const maxRacesRaw =
    typeof body.maxRaces === "number" ? body.maxRaces : DEFAULT_MAX_RACES;
  const maxRaces = Math.min(
    Math.max(1, maxRacesRaw || DEFAULT_MAX_RACES),
    HARD_MAX_RACES
  );

  const dryRun =
    body.dryRun === true ||
    body.mode === "dryRun" ||
    body.dry_run === true;

  const races = extractRacesFromBody(body, maxRaces);

  if (!races.length) {
    return res.status(200).json({
      ok: false,
      step: "verify_backfill",
      mode: dryRun ? "dryRun" : "live",
      message: "No valid races found in request body",
      count: 0,
      successes: 0,
      failures: 0,
      results: [],
    });
  }

  const baseUrl = resolveBaseUrl(req);
  const results = [];

  if (dryRun) {
    for (const race of races) {
      results.push({
        race,
        ok: true,
        skipped: true,
        dryRun: true,
      });
    }
  } else {
    for (const race of races) {
      const result = await callVerifyRace(baseUrl, race);
      results.push(result);
    }
  }

  const successes = results.filter((r) => r.ok && !r.skipped).length;
  const failures = results.filter(
    (r) => !r.ok && !r.skipped && !r.networkError
  ).length;
  const networkFailures = results.filter((r) => !!r.networkError).length;

  // Keep the response payload modest; include a small sample of raw results.
  const sampleSize = 10;
  const sample = results.slice(0, sampleSize).map((r) => ({
    race: r.race,
    ok: r.ok,
    skipped: !!r.skipped,
    httpStatus: r.httpStatus,
    step: r.step,
    outcome: r.outcome,
    hits: r.hits,
    networkError: r.networkError || null,
  }));

  return res.status(200).json({
    ok: failures === 0 && networkFailures === 0,
    step: "verify_backfill",
    mode: dryRun ? "dryRun" : "live",
    baseUrl,
    count: races.length,
    successes,
    failures,
    networkFailures,
    sampleLimit: sampleSize,
    results: sample,
  });
}
