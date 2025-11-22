// pages/api/verify_race.js
// Baseline implementation: CSE search + basic parsing only
// NO Redis, NO Equibase, NO HRN parsing - simple search + generic parsing

import * as cheerio from "cheerio";

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

/**
 * Normalize horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Safely parse request body (supports JSON string)
 */
function safeParseBody(req) {
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  if (!body || typeof body !== "object") {
    body = {};
  }

  return body;
}

/**
 * Parse outcome from HTML using cheerio (generic parser only)
 * @param {string} html
 * @param {string} url
 * @returns {{ win?: string; place?: string; show?: string }}
 */
function parseOutcomeFromHtml(html, url) {
  const outcome = {};
  try {
    const $ = cheerio.load(html);

    // Generic parsing: Try to find a results table with finishing positions
    const rows = [];
    $("table tr").each((_, el) => {
      const cells = $(el).find("td, th");
      if (cells.length < 2) return;

      const firstCell = $(cells[0]).text().trim();
      // Match position: "1", "1st", "2", "2nd", etc.
      const posMatch =
        firstCell.match(/^(\d+)[a-z]{0,2}$/i) || firstCell.match(/^(\d+)$/);
      if (!posMatch) return;

      const pos = parseInt(posMatch[1], 10);
      // Only care about positions 1, 2, 3
      if (pos < 1 || pos > 3) return;

      let name = $(cells[1]).text();
      name = normalizeHorseName(name);
      if (!name) return;

      rows.push({ pos, name });
    });

    // Build outcome from rows
    const byPos = new Map();
    rows.forEach(({ pos, name }) => {
      if (!byPos.has(pos)) {
        byPos.set(pos, name);
      }
    });

    if (byPos.get(1)) outcome.win = byPos.get(1);
    if (byPos.get(2)) outcome.place = byPos.get(2);
    if (byPos.get(3)) outcome.show = byPos.get(3);

    // If we didn't find anything in tables, try text-based heuristics
    if (!outcome.win && !outcome.place && !outcome.show) {
      // Look for "Win: HorseName" patterns
      const winMatch = html.match(/Win[:\s]+([A-Za-z0-9' .\-]+)/i);
      const placeMatch = html.match(/Place[:\s]+([A-Za-z0-9' .\-]+)/i);
      const showMatch = html.match(/Show[:\s]+([A-Za-z0-9' .\-]+)/i);

      if (winMatch) outcome.win = normalizeHorseName(winMatch[1]);
      if (placeMatch) outcome.place = normalizeHorseName(placeMatch[1]);
      if (showMatch) outcome.show = normalizeHorseName(showMatch[1]);
    }
  } catch (error) {
    console.error("[verify_race] parseOutcomeFromHtml failed", error);
  }

  return outcome;
}

/**
 * Extract outcome from result page
 * @param {string} url
 * @param {{ track: string; date: string; raceNo?: string | null }} ctx
 * @returns {Promise<{ win?: string; place?: string; show?: string }>}
 */
async function extractOutcomeFromResultPage(url, ctx) {
  try {
    if (!url || typeof url !== "string") {
      return {};
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    }).catch((err) => {
      console.error("[verify_race] fetch failed", {
        url,
        error: err?.message || String(err),
      });
      return null;
    });

    if (!res || !res.ok) {
      return {};
    }

    const html = await res.text().catch(() => "");

    if (!html) {
      return {};
    }

    // Verify page contains the correct race number before parsing
    if (ctx && ctx.raceNo) {
      const raceNoStr = String(ctx.raceNo).trim();
      const trackLower = (ctx.track || "").toLowerCase();

      const hasRaceNo = new RegExp(
        `Race\\s*#?\\s*${raceNoStr}\\b`,
        "i"
      ).test(html);

      const hasTrack = trackLower
        ? new RegExp(
            trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i"
          ).test(html)
        : true;

      if (!hasRaceNo || !hasTrack) {
        console.warn("[verify_race] Page validation failed", {
          url,
          raceNo: ctx.raceNo,
          track: ctx.track,
          hasRaceNo,
          hasTrack,
        });
        return {};
      }
    }

    const outcome = parseOutcomeFromHtml(html, url);
    return outcome || {};
  } catch (error) {
    console.error("[verify_race] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

async function cseDirect(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    throw new Error("Google CSE credentials missing");
  }
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", GOOGLE_API_KEY);
  u.searchParams.set("cx", GOOGLE_CSE_ID);
  u.searchParams.set("q", query);
  const r = await fetch(u.toString());
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Google CSE ${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  const items = Array.isArray(j.items) ? j.items : [];
  return items.map((i) => ({
    title: i?.title || "",
    link: i?.link || "",
    snippet: i?.snippet || "",
  }));
}

async function cseViaBridge(req, query) {
  const proto = req?.headers?.["x-forwarded-proto"] || "https";
  const host = req?.headers?.host || "localhost:3000";
  const basePath = (
    process.env.NEXT_PUBLIC_BASE_PATH || process.env.NEXT_BASE_PATH || ""
  ).replace(/\/+$/, "");
  const pathPrefix = basePath
    ? basePath.startsWith("/")
      ? basePath
      : `/${basePath}`
    : "";
  const url = `${proto}://${host}${pathPrefix}/api/cse_resolver?q=${encodeURIComponent(
    query
  )}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(j?.error || `CSE bridge ${r.status}`);
  }
  const arr = Array.isArray(j.results) ? j.results : [];
  return arr.map((i) => ({
    title: i?.title || "",
    link: i?.link || "",
    snippet: i?.snippet || "",
  }));
}

function pickBestResult(results) {
  if (!Array.isArray(results) || results.length === 0) return null;

  // 1) Prefer HorseracingNation entries/results pages
  const hrnPreferred = results.find((r) => {
    const url = (r?.link || "").toLowerCase();
    return (
      url.includes("horseracingnation.com") &&
      (url.includes("/entries-results/") ||
        url.includes("/entries/") ||
        url.includes("/entries-results-"))
    );
  });
  if (hrnPreferred) return hrnPreferred;

  // 2) Fall back to Equibase chart pages
  const equibaseChart = results.find((r) => {
    const url = (r?.link || "").toLowerCase();
    return url.includes("equibase.com") && url.includes("chart");
  });
  if (equibaseChart) return equibaseChart;

  // 3) Finally, just use the first result
  return results[0];
}

async function runSearch(req, query) {
  return GOOGLE_API_KEY && GOOGLE_CSE_ID
    ? await cseDirect(query)
    : await cseViaBridge(req, query);
}

export default async function handler(req, res) {
  // Initialize safe defaults *outside* try so they exist in the catch
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: false,
        step: "verify_race_method",
        error: "Method Not Allowed",
        details: "Only POST is allowed",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        summary: "Invalid method",
      });
    }

    const body = safeParseBody(req);

    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      predicted = {},
    } = body;

    const raceNumber = raceNo ?? race_no ?? null;

    safeDate = (inputDate && String(inputDate).trim()) || "";
    safeTrack = track || null;
    safeRaceNo = raceNumber;

    // Validation: track is required
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
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        summary: "Track is required",
      });
    }

    // Build search queries
    const racePart = raceNumber ? ` Race ${raceNumber}` : "";
    const datePart = safeDate ? ` ${safeDate}` : "";
    const baseQuery = `${track}${racePart}${datePart} results Win Place Show order`;
    const altQuery = `${track}${racePart}${datePart} result chart official`;
    const siteBias =
      "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";

    const queries = [
      `${baseQuery} ${siteBias}`.trim(),
      `${altQuery} ${siteBias}`.trim(),
      baseQuery,
      altQuery,
    ];

    let results = [];
    let queryUsed = queries[0] || "";
    let lastError = null;

    // Try each query until we get results
    for (const q of queries) {
      if (!q) continue;
      try {
        const items = await runSearch(req, q);
        queryUsed = q;
        results = items || [];
        if (items && items.length) break;
      } catch (err) {
        lastError = err;
        console.error("[verify_race] Search query failed", {
          query: q,
          error: err?.message || String(err),
        });
      }
    }

    if (!results || !results.length) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_search",
        error: "Search failed",
        details:
          lastError?.message ||
          "No search results from Google CSE / CSE resolver",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        query: queryUsed,
        summary: "No search results",
      });
    }

    const top = pickBestResult(results); // must NOT throw; return null or a safe object

    let outcome = { win: "", place: "", show: "" };

    if (top && top.link) {
      // Use generic parser only (no HRN/Equibase specific parsing)
      const parsed = await extractOutcomeFromResultPage(top.link, {
        track: safeTrack || "",
        date: safeDate || "",
        raceNo: raceNumber,
      });

      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        outcome = {
          win: parsed.win || "",
          place: parsed.place || "",
          show: parsed.show || "",
        };
      }
    }

    // Normalize predictions and compute hits (Win / Place / Show / Top3)
    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const normalizeName = (value = "") =>
      (value || "").toLowerCase().replace(/\s+/g, " ").trim();

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
        (!!pWin && [oWin, oPlace, oShow].includes(pWin)) ||
        (!!pPlace && [oWin, oPlace, oShow].includes(pPlace)) ||
        (!!pShow && [oWin, oPlace, oShow].includes(pShow)),
    };

    // Build human-readable summary for the UI
    const lines = [];
    if (queryUsed) lines.push(`Query: ${queryUsed}`);
    if (top?.title) lines.push(`Top: ${top.title} -> ${top.link}`);
    if (top?.link) {
      try {
        const hostname = new URL(top.link).hostname;
        lines.push(`Host: ${hostname}`);
      } catch {
        // ignore URL parse error
      }
    }
    const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(
      Boolean,
    );
    if (outcomeParts.length) {
      lines.push(`Outcome: ${outcomeParts.join(" / ")}`);
    }
    const hitParts = [
      hits.winHit ? "Win" : null,
      hits.placeHit ? "Place" : null,
      hits.showHit ? "Show" : null,
      hits.top3Hit ? "Top3" : null,
    ].filter(Boolean);
    if (hitParts.length) {
      lines.push(`Hits: ${hitParts.join(", ")}`);
    }

    const summary = lines.join("\n") || "No outcome parsed";

    return res.status(200).json({
      ok: true,
      step: "verify_race",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      query: queryUsed,
      top: top
        ? { title: top.title || null, link: top.link || null }
        : null,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
    });
  } catch (err) {
    // Final safety net: NEVER let this throw a 500
    console.error("[verify_race] outer handler error", err);

    return res.status(200).json({
      ok: false,
      step: "verify_race_outer",
      error: String(err?.message || err || "Unknown error"),
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary: "verify_race outer handler error",
    });
  }
}
