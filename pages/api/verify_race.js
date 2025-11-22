// pages/api/verify_race.js
// Stable verify endpoint: Google CSE + HRN/Equibase parsing with safety net

import * as cheerio from "cheerio";
import {
  fetchEquibaseChartHtml,
  parseEquibaseOutcome,
} from "../../lib/equibase.js";

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();
const isVercel = !!process.env.VERCEL;

const preferHosts = [
  "horseracingnation.com",
  "entries.horseracingnation.com",
  "equibase.com",
];

function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

function normalizeName(value = "") {
  return (value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function defaultOutcome() {
  return { win: "", place: "", show: "" };
}

function defaultHits() {
  return { winHit: false, placeHit: false, showHit: false, top3Hit: false };
}

function mapResultItem(item = {}) {
  return {
    title: item?.title || "",
    link: item?.link || "",
    snippet: item?.snippet || "",
  };
}

/**
 * Extract Win/Place/Show from a runner table using WPS payout indicators
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<cheerio.Element>} table
 * @param {{ runnerIdx: number; winIdx: number; placeIdx: number; showIdx: number }} idx
 * @returns {{ win: string; place: string; show: string }}
 */
function extractOutcomeFromRunnerTable($, table, idx) {
  const { runnerIdx, winIdx, placeIdx, showIdx } = idx;

  const $rows = $(table).find("tr");
  const norm = (s = "") => (s || "").replace(/\s+/g, " ").trim();
  const runners = [];

  $rows.each((_, tr) => {
    const $cells = $(tr).find("td");
    if (!$cells.length) return;

    const runnerText = runnerIdx > -1 ? norm($cells.eq(runnerIdx).text()) : "";
    if (!runnerText) return;

    if (/runner\s*\(speed\)/i.test(runnerText)) return;

    const winText = winIdx > -1 ? norm($cells.eq(winIdx).text()) : "";
    const placeText = placeIdx > -1 ? norm($cells.eq(placeIdx).text()) : "";
    const showText = showIdx > -1 ? norm($cells.eq(showIdx).text()) : "";

    if (!winText && !placeText && !showText) return;

    let runnerName = runnerText.replace(/\s*\([^)]*\)\s*$/, "").trim();
    runnerName = normalizeHorseName(runnerName);
    if (!runnerName) return;

    const lowerRunner = runnerName.toLowerCase();
    const junkPatterns = [
      "preliminary speed figures",
      "also rans",
      "pool",
      "daily double",
      "trifecta",
      "superfecta",
      "pick 3",
      "pick 4",
      "this script inside",
      "head tags",
    ];

    if (
      lowerRunner.startsWith("*") ||
      junkPatterns.some((pattern) => lowerRunner.includes(pattern))
    ) {
      return;
    }

    runners.push({
      name: runnerName,
      hasWin: !!winText && winText !== "-",
      hasPlace: !!placeText && placeText !== "-",
      hasShow: !!showText && showText !== "-",
    });
  });

  if (!runners.length) {
    return defaultOutcome();
  }

  const winHorse = runners.find((r) => r.hasWin)?.name || "";
  const placeHorse =
    runners.find(
      (r) => r.hasPlace && r.name !== winHorse && !r.hasWin && !r.hasPlace,
    )?.name ||
    runners.find((r) => r.hasPlace && r.name !== winHorse)?.name ||
    "";
  const showHorse =
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse &&
        !r.hasWin &&
        !r.hasPlace,
    )?.name ||
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse &&
        !r.hasWin,
    )?.name ||
    runners.find(
      (r) => r.hasShow && r.name !== winHorse && r.name !== placeHorse,
    )?.name ||
    "";

  return { win: winHorse, place: placeHorse, show: showHorse };
}

function parseHRNRaceOutcome($, raceNo) {
  const outcome = {};
  const requestedRaceNo = String(raceNo || "").trim();
  if (!requestedRaceNo) return outcome;

  try {
    const getRaceFromNode = (node) => {
      if (!node || !node.length) return null;
      const text = node.text().trim();
      if (!text) return null;
      const m = text.match(/race\s*#?\s*(\d+)/i);
      return m ? m[1] : null;
    };

    const runnerTables = [];

    $("table").each((_, table) => {
      const $table = $(table);
      const headerRow = $table.find("tr").first();
      const headerCells = headerRow.find("th, td").toArray();
      if (!headerCells.length) return;

      const headerTexts = headerCells.map((cell) =>
        $(cell).text().toLowerCase().trim(),
      );

      const runnerIdx = headerTexts.findIndex(
        (h) => h.includes("runner") || h.includes("horse"),
      );
      const winIdx = headerTexts.findIndex((h) => h.includes("win"));
      const placeIdx = headerTexts.findIndex((h) => h.includes("place"));
      const showIdx = headerTexts.findIndex((h) => h.includes("show"));

      if (
        runnerIdx === -1 ||
        winIdx === -1 ||
        placeIdx === -1 ||
        showIdx === -1
      ) {
        return;
      }

      let inferredRaceNo = null;

      let prev = $table.prev();
      while (prev.length && !inferredRaceNo) {
        inferredRaceNo = getRaceFromNode(prev);
        prev = prev.prev();
      }

      if (!inferredRaceNo) {
        let parent = $table.parent();
        let depth = 0;
        while (parent.length && depth < 6 && !inferredRaceNo) {
          let sibling = parent.prev();
          while (sibling.length && !inferredRaceNo) {
            inferredRaceNo = getRaceFromNode(sibling);
            sibling = sibling.prev();
          }
          parent = parent.parent();
          depth += 1;
        }
      }

      runnerTables.push({
        table: $table,
        runnerIdx,
        winIdx,
        placeIdx,
        showIdx,
        raceNo: inferredRaceNo,
      });
    });

    if (!runnerTables.length) {
      return outcome;
    }

    const target =
      runnerTables.find((t) => t.raceNo === requestedRaceNo) ||
      runnerTables[0];

    const { table: $runnerTable, runnerIdx, winIdx, placeIdx, showIdx } = target;
    const extracted = extractOutcomeFromRunnerTable($, $runnerTable, {
      runnerIdx,
      winIdx,
      placeIdx,
      showIdx,
    });

    if (extracted.win || extracted.place || extracted.show) {
      outcome.win = extracted.win || "";
      outcome.place = extracted.place || "";
      outcome.show = extracted.show || "";
    }
  } catch (error) {
    console.error("[verify_race] parseHRNRaceOutcome failed", error);
  }

  return outcome;
}

function parseOutcomeFromHtml(html, url, raceNo = null) {
  const outcome = {};
  try {
    const $ = cheerio.load(html);
    const isHRN = /horseracingnation\.com/i.test(url);

    if (isHRN && raceNo) {
      const hrnOutcome = parseHRNRaceOutcome($, String(raceNo));
      if (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show) {
        return hrnOutcome;
      }
    }

    const rows = [];
    $("table tr").each((_, el) => {
      const cells = $(el).find("td, th");
      if (cells.length < 2) return;

      const firstCell = $(cells[0]).text().trim();
      const posMatch =
        firstCell.match(/^(\d+)[a-z]{0,2}$/i) || firstCell.match(/^(\d+)$/);
      if (!posMatch) return;

      const pos = parseInt(posMatch[1], 10);
      if (pos < 1 || pos > 3) return;

      let name = $(cells[1]).text();
      name = normalizeHorseName(name);
      if (!name) return;

      rows.push({ pos, name });
    });

    const byPos = new Map();
    rows.forEach(({ pos, name }) => {
      if (!byPos.has(pos)) {
        byPos.set(pos, name);
      }
    });

    if (byPos.get(1)) outcome.win = byPos.get(1);
    if (byPos.get(2)) outcome.place = byPos.get(2);
    if (byPos.get(3)) outcome.show = byPos.get(3);

    if (!outcome.win && !outcome.place && !outcome.show) {
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

async function extractOutcomeFromResultPage(url, ctx) {
  try {
    if (!url || typeof url !== "string") {
      return {};
    }

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    }).catch((error) => {
      console.error("[verify_race] fetch failed", {
        url,
        error: error?.message || String(error),
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

    if (ctx?.raceNo) {
      const raceNoStr = String(ctx.raceNo).trim();
      const trackLower = (ctx.track || "").toLowerCase();

      const hasRaceNo = new RegExp(`Race\\s*#?\\s*${raceNoStr}\\b`, "i").test(
        html,
      );

      const hasTrack = trackLower
        ? new RegExp(
            trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
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

    return parseOutcomeFromHtml(html, url, ctx?.raceNo);
  } catch (error) {
    console.error("[verify_race] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

function pickBest(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const scored = items
    .map((item) => {
      try {
        const url = new URL(item.link || "");
        const host = url.hostname || "";
        const idx = preferHosts.findIndex((h) => host.includes(h));
        return { item, score: idx === -1 ? 10 : idx };
      } catch {
        return { item, score: 10 };
      }
    })
    .sort((a, b) => a.score - b.score);
  return scored.length ? scored[0].item : null;
}

async function cseDirect(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    return { items: [], error: "Google CSE credentials missing" };
  }

  try {
    const endpoint = new URL("https://www.googleapis.com/customsearch/v1");
    endpoint.searchParams.set("key", GOOGLE_API_KEY);
    endpoint.searchParams.set("cx", GOOGLE_CSE_ID);
    endpoint.searchParams.set("q", query);

    const response = await fetch(endpoint.toString());
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        items: [],
        error: `Google CSE ${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const json = await response.json().catch(() => ({}));
    const items = Array.isArray(json.items) ? json.items : [];
    return { items: items.map(mapResultItem), error: null };
  } catch (error) {
    console.error("[verify_race] cseDirect failed", error);
    return { items: [], error: error?.message || String(error) };
  }
}

async function cseViaBridge(req, query) {
  try {
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
      query,
    )}`;

    const response = await fetch(url, { cache: "no-store" });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { items: [], error: json?.error || `CSE bridge ${response.status}` };
    }

    const arr = Array.isArray(json.results) ? json.results : [];
    return { items: arr.map(mapResultItem), error: null };
  } catch (error) {
    console.error("[verify_race] cseViaBridge failed", error);
    return { items: [], error: error?.message || String(error) };
  }
}

async function runSearch(req, query) {
  if (GOOGLE_API_KEY && GOOGLE_CSE_ID) {
    const direct = await cseDirect(query);
    if (direct.items.length) {
      return { ...direct, source: "google" };
    }
    const fallback = await cseViaBridge(req, query);
    return {
      ...fallback,
      source: "bridge",
      error: fallback.error || direct.error || null,
    };
  }

  const bridgeOnly = await cseViaBridge(req, query);
  return { ...bridgeOnly, source: "bridge" };
}

async function parseRequestBody(req) {
  if (!req) return {};
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  if (!body || typeof body !== "object") {
    if (typeof req.text === "function") {
      try {
        const text = await req.text();
        if (text) {
          body = JSON.parse(text);
        }
      } catch {
        body = {};
      }
    } else if (typeof req.json === "function") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    } else {
      body = {};
    }
  }

  return body || {};
}

function computeHits(predicted = {}, outcome = defaultOutcome()) {
  const pWin = normalizeName(predicted.win);
  const pPlace = normalizeName(predicted.place);
  const pShow = normalizeName(predicted.show);
  const oWin = normalizeName(outcome.win);
  const oPlace = normalizeName(outcome.place);
  const oShow = normalizeName(outcome.show);

  const winHit = !!pWin && !!oWin && pWin === oWin;
  const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
  const showHit = !!pShow && !!oShow && pShow === oShow;
  const top3Hit =
    (!!pWin && [oWin, oPlace, oShow].includes(pWin)) ||
    (!!pPlace && [oWin, oPlace, oShow].includes(pPlace)) ||
    (!!pShow && [oWin, oPlace, oShow].includes(pShow));

  return { winHit, placeHit, showHit, top3Hit };
}

function buildSummary({ queryUsed, top, outcome, hits }) {
  const lines = [];
  if (queryUsed) lines.push(`Query: ${queryUsed}`);
  if (top?.title) lines.push(`Top: ${top.title} -> ${top.link}`);
  if (top?.link) {
    try {
      const hostname = new URL(top.link).hostname;
      lines.push(`Host: ${hostname}`);
    } catch {
      // ignore parse error
    }
  }
  const outcomeParts = [outcome.win, outcome.place, outcome.show].filter(Boolean);
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

  return (
    lines.join("\n") ||
    (top?.title
      ? `Top Result: ${top.title}${top.link ? `\n${top.link}` : ""}`
      : "No summary returned.")
  );
}

export default async function handler(req, res) {
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: false,
        step: "verify_race_method",
        error: "Method Not Allowed",
        details: "Only POST requests are accepted",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: defaultOutcome(),
        hits: defaultHits(),
        summary: "Invalid verify_race method",
      });
    }

    const body = await parseRequestBody(req);
    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      predicted = {},
    } = body || {};

    const raceNumber = raceNo ?? race_no ?? null;
    safeDate = (inputDate && String(inputDate).trim()) || "";
    safeTrack = track || null;
    safeRaceNo = raceNumber ?? null;

    if (!track) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_validation",
        error: "Missing required field: track",
        details: "Track is required to verify a race",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: defaultOutcome(),
        hits: defaultHits(),
        summary: "Track is required to verify a race.",
      });
    }

    const dateISO = safeDate;
    const racePart = raceNumber ? ` Race ${raceNumber}` : "";
    const baseQuery = `${track}${racePart} ${dateISO} results Win Place Show order`;
    const altQuery = `${track}${racePart} ${dateISO} result chart official`;
    const siteBias =
      "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";

    const queries = [
      `${baseQuery} ${siteBias}`.trim(),
      `${altQuery} ${siteBias}`.trim(),
      baseQuery,
      altQuery,
    ].filter(Boolean);

    let results = [];
    let queryUsed = queries[0] || "";
    const searchErrors = [];

    for (const q of queries) {
      const searchResponse = await runSearch(req, q);
      if (searchResponse.error) {
        searchErrors.push({
          query: q,
          error: searchResponse.error,
          source: searchResponse.source || null,
        });
      }
      if (searchResponse.items?.length) {
        results = searchResponse.items;
        queryUsed = q;
        break;
      }
    }

    if (!results.length) {
      const lastError = searchErrors[searchErrors.length - 1]?.error;
      return res.status(200).json({
        ok: false,
        step: "verify_race_search",
        error: "Search failed",
        details:
          lastError || "No search results from Google CSE / resolver queries.",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: defaultOutcome(),
        hits: defaultHits(),
        query: queryUsed,
        summary: "No search results were returned.",
      });
    }

    const top = pickBest(results);
    if (!top) {
      return res.status(200).json({
        ok: false,
        step: "verify_race_search",
        error: "No search results",
        details: "Search succeeded but produced no usable result link.",
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        outcome: defaultOutcome(),
        hits: defaultHits(),
        query: queryUsed,
        summary: "Search succeeded but produced no usable result link.",
      });
    }

    let parsedOutcome = defaultOutcome();
    const linkLower = (top.link || "").toLowerCase();

    if (linkLower.includes("horseracingnation.com")) {
      const parsed = await extractOutcomeFromResultPage(top.link, {
        track: safeTrack || "",
        date: safeDate || "",
        raceNo: raceNumber,
      });
      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        parsedOutcome = {
          win: parsed.win || "",
          place: parsed.place || "",
          show: parsed.show || "",
        };
      }
    } else if (
      linkLower.includes("equibase.com") &&
      track &&
      dateISO &&
      raceNumber
    ) {
      try {
        const html = await fetchEquibaseChartHtml({
          track,
          dateISO,
          raceNo: String(raceNumber || ""),
        });
        const equibaseOutcome = parseEquibaseOutcome(html);
        if (
          equibaseOutcome &&
          (equibaseOutcome.win ||
            equibaseOutcome.place ||
            equibaseOutcome.show)
        ) {
          parsedOutcome = {
            win: equibaseOutcome.win || "",
            place: equibaseOutcome.place || "",
            show: equibaseOutcome.show || "",
          };
        }
      } catch (error) {
        console.error("[verify_race] Equibase parse failed", {
          link: top.link,
          error: error?.message || String(error),
        });
      }
    } else {
      const parsed = await extractOutcomeFromResultPage(top.link, {
        track: safeTrack || "",
        date: safeDate || "",
        raceNo: raceNumber,
      });
      if (parsed && (parsed.win || parsed.place || parsed.show)) {
        parsedOutcome = {
          win: parsed.win || "",
          place: parsed.place || "",
          show: parsed.show || "",
        };
      }
    }

    const outcome =
      parsedOutcome &&
      (parsedOutcome.win || parsedOutcome.place || parsedOutcome.show)
        ? parsedOutcome
        : defaultOutcome();

    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const hits = computeHits(predictedSafe, outcome);
    const summary = buildSummary({ queryUsed, top, outcome, hits });

    if (!isVercel) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const csvPath = path.resolve(
          process.cwd(),
          "data/reconciliations_v1.csv",
        );
        const header =
          "ts,date,track,raceNo,query,topTitle,topUrl,winHit,placeHit,showHit,top3Hit\n";
        const exists = fs.existsSync(csvPath);
        const line =
          [
            Date.now(),
            safeDate,
            JSON.stringify(track),
            raceNumber ?? "",
            JSON.stringify(queryUsed || ""),
            JSON.stringify(top?.title || ""),
            JSON.stringify(top?.link || ""),
            hits.winHit ? 1 : 0,
            hits.placeHit ? 1 : 0,
            hits.showHit ? 1 : 0,
            hits.top3Hit ? 1 : 0,
          ].join(",") + "\n";
        if (!exists) fs.writeFileSync(csvPath, header);
        fs.appendFileSync(csvPath, line);
      } catch (error) {
        console.warn(
          "[verify_race] Local CSV append failed (dev only)",
          error?.message || error,
        );
      }
    }

    const trimmedResults = results.slice(0, 5).map(mapResultItem);

    return res.status(200).json({
      ok: true,
      step: "verify_race",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      query: queryUsed,
      top: top
        ? {
            title: top.title || null,
            link: top.link || null,
          }
        : null,
      results: trimmedResults,
      outcome,
      predicted: predictedSafe,
      hits,
      summary,
    });
  } catch (err) {
    console.error("[verify_race] fatal", err);

    return res.status(200).json({
      ok: false,
      step: "verify_race_fatal",
      error: err?.message || String(err) || "Unknown verify_race error",
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      outcome: defaultOutcome(),
      hits: defaultHits(),
      summary: "verify_race fatal handler error – see server logs.",
    });
  }
}
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
