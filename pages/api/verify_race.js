// pages/api/verify_race.js

import crypto from "node:crypto";
import { Redis } from "@upstash/redis";
import * as cheerio from "cheerio";
import { fetchAndParseResults } from "../../lib/results.js";

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY ?? "").trim();
const GOOGLE_CSE_ID = (process.env.GOOGLE_CSE_ID ?? "").trim();

const TTL_SECONDS = 60 * 60 * 24; // 24h
const isVercel = !!process.env.VERCEL;
const RECON_LIST = "reconciliations:v1";
const RECON_DAY_PREFIX = "reconciliations:v1:";

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error("[verify_race] Failed to init Redis client", error);
      redisClient = null;
    }
  }
  return redisClient;
}

const slug = (s = "") =>
  s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/**
 * Normalize horse name for comparison
 * @param {string} name
 * @returns {string}
 */
function normalizeHorseName(name) {
  return (name || "").replace(/\s+/g, " ").trim();
}

/**
 * Parse HRN "Entries & Results" page to get Win / Place / Show outcome
 * Strategy:
 *   1. Build map: program number -> horse name from the Runner (Speed) table
 *   2. Prefer Trifecta finish order (e.g. "2-5-3")
 *   3. Map those finish numbers through the program map to names
 *   4. If anything fails, return nulls instead of duplicating horses
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio} $scope - The race section scope (e.g., race block containing tables)
 * @param {{ track?: string; raceNo?: string | number }} context - Optional context for logging
 * @returns {{ win: string | null; place: string | null; show: string | null }}
 */
function parseHRNRaceOutcome($, $scope, context = {}) {
  const outcome = {
    win: null,
    place: null,
    show: null,
  };

  // ---------------------------------------------------------------------------
  // 1) Build program-number -> horse-name map from the Runner (Speed) table
  // ---------------------------------------------------------------------------
  const programHorse = new Map();

  // Find the Runner (Speed) table: it has columns like Runner/Horse + Win/Place/Show
  let $runnerTable = null;

  $scope.find("table").each((_, tableEl) => {
    const $table = $(tableEl);
    const headerRow = $table.find("tr").first();
    const headerCells = headerRow.find("th,td");

    if (!headerCells.length) return;

    const headers = headerCells
      .map((__, cell) => $(cell).text().trim().toLowerCase())
      .get();

    const hasRunner = headers.some((h) => h.includes("runner") || h.includes("horse"));
    const hasWin = headers.some((h) => h.includes("win"));
    const hasPlace = headers.some((h) => h.includes("place"));
    const hasShow = headers.some((h) => h.includes("show"));

    // Skip the "Today's racing results and speed figures" summary table, which
    // does not have individual W/P/S by horse.
    const looksLikeSummary =
      headers.some((h) => h.includes("today")) &&
      headers.some((h) => h.includes("speed"));

    if (hasRunner && hasWin && hasPlace && hasShow && !looksLikeSummary) {
      $runnerTable = $table;
      return false; // break .each()
    }
  });

  if ($runnerTable) {
    const headerRow = $runnerTable.find("tr").first();
    const headerCells = headerRow.find("th,td");
    const headers = headerCells
      .map((_, cell) => $(cell).text().trim().toLowerCase())
      .get();

    const runnerIdx =
      headers.findIndex((h) => h.includes("runner") || h.includes("horse"));
    const numberIdx = headers.findIndex(
      (h) => h.includes("no") || h.includes("#") || h.includes("pp")
    );

    if (runnerIdx !== -1 && numberIdx !== -1) {
      $runnerTable
        .find("tr")
        .slice(1)
        .each((_, rowEl) => {
          const $cells = $(rowEl).find("td,th");
          if (!$cells.length) return;

          const rawNo = $($cells.get(numberIdx)).text().trim();
          const rawName = $($cells.get(runnerIdx)).text().trim();
          const programNo = rawNo.replace(/[^\d]/g, "");
          const name = rawName.replace(/\s+/g, " ").trim();

          if (programNo && name) {
            programHorse.set(programNo, name);
          }
        });
    }
  }

  // ---------------------------------------------------------------------------
  // 2) Prefer Trifecta finish order from the Pool table (e.g. "2-5-3")
  // ---------------------------------------------------------------------------
  let finishNums = null;

  $scope.find("table").each((_, tableEl) => {
    const $table = $(tableEl);
    const headerRow = $table.find("tr").first();
    const headerCells = headerRow.find("th,td");

    if (!headerCells.length) return;

    const headers = headerCells
      .map((__, cell) => $(cell).text().trim().toLowerCase())
      .get();

    const hasPool = headers.some((h) => h.includes("pool"));
    const hasFinish = headers.some((h) => h.includes("finish"));
    const hasPayout = headers.some((h) => h.includes("payout"));

    if (!hasPool || !hasFinish || !hasPayout) return;

    const poolIdx = headers.findIndex((h) => h.includes("pool"));
    const finishIdx = headers.findIndex((h) => h.includes("finish"));

    if (poolIdx === -1 || finishIdx === -1) return;

    $table
      .find("tr")
      .slice(1)
      .each((__, rowEl) => {
        const $cells = $(rowEl).find("td,th");
        if (!$cells.length) return;

        const poolName = $($cells.get(poolIdx)).text().toLowerCase();
        if (!poolName.includes("trifecta")) return;

        const finishText = $($cells.get(finishIdx)).text().trim();
        // Expect formats like "2-5-3" or "2 / 5 / 3"
        const match = finishText.match(/(\d+)\s*[-/]\s*(\d+)\s*[-/]\s*(\d+)/);
        if (match) {
          finishNums = [match[1], match[2], match[3]];
          return false; // break out of this table
        }
      });

    if (finishNums) return false; // break outer table loop
  });

  // If we couldn't find a Trifecta finish, bail with nulls (no guessing)
  if (!finishNums || finishNums.length !== 3) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[verify_race] HRN: no trifecta finish found", {
        track: context.track,
        raceNo: context.raceNo,
      });
    }
    return outcome;
  }

  const [winNo, placeNo, showNo] = finishNums;

  // ---------------------------------------------------------------------------
  // 3) Map program numbers -> horse names via Runner (Speed) table
  // ---------------------------------------------------------------------------
  const winName = winNo ? programHorse.get(winNo) || null : null;
  const placeName = placeNo ? programHorse.get(placeNo) || null : null;
  const showName = showNo ? programHorse.get(showNo) || null : null;

  outcome.win = winName;
  outcome.place = placeName;
  outcome.show = showName;

  // ---------------------------------------------------------------------------
  // 4) Safety checks: never duplicate one horse into all positions
  // ---------------------------------------------------------------------------
  const distinct = new Set(
    [outcome.win, outcome.place, outcome.show].filter(Boolean)
  );
  if (distinct.size === 1) {
    // We only confidently know the winner; clear the rest to avoid misleading output
    outcome.place = null;
    outcome.show = null;
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[verify_race] HRN parser only found a single distinct horse; clearing P/S",
        { outcome, finishNums }
      );
    }
  }

  return outcome;
}

/**
 * Parse outcome from HTML using cheerio
 * @param {string} html
 * @param {string} url
 * @param {string | number | null} raceNo
 * @returns {{ win?: string; place?: string; show?: string }}
 */
function parseOutcomeFromHtml(html, url, raceNo = null) {
  const outcome = {};
  try {
    const $ = cheerio.load(html);
    const isHRN = /horseracingnation\.com/i.test(url);

    // For HRN pages, use race-specific parsing
    if (isHRN && raceNo) {
      // Find the race section scope
      const raceStr = String(raceNo).trim();
      let $scope = null;

      // Look for a heading containing "Race # {raceNo}"
      $("*").each((_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
        if (!text) return;

        if (raceStr && text.includes(`race # ${raceStr}`)) {
          $scope = $(el).closest("table, section, div");
          return false; // break
        }
        return;
      });

      // Fallback: if we didn't find a specific race section, use body as scope
      if (!$scope || !$scope.length) {
        $scope = $("body");
      }

      // Parse HRN outcome with scope and context
      const hrnOutcome = parseHRNRaceOutcome($, $scope, {
        track: ctx?.track,
        raceNo: raceNo,
      });

      if (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show) {
        return hrnOutcome;
      }
      // If HRN parsing failed, fall through to generic parsing
    }

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
 * Extract outcome from result page using cheerio
 * @param {string} url
 * @param {{ track: string; date: string; raceNo?: string | null }} ctx
 * @returns {Promise<{ win?: string; place?: string; show?: string }>}
 */
async function extractOutcomeFromResultPage(url, ctx) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    });

    if (!res.ok) {
      return {};
    }

    const html = await res.text();
    const outcome = parseOutcomeFromHtml(html, url, ctx.raceNo);
    return outcome;
  } catch (error) {
    // Best-effort only; swallow errors and return empty so UI still works
    console.error("[verify_race] extractOutcomeFromResultPage failed", {
      url,
      error: error?.message || String(error),
    });
    return {};
  }
}

async function cseDirect(query) {
  if (!GOOGLE_API_KEY || !GOOGLE_CSE_ID) {
    const err = new Error("Google CSE credentials missing");
    err.step = "cse_credentials";
    throw err;
  }
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", GOOGLE_API_KEY);
  u.searchParams.set("cx", GOOGLE_CSE_ID);
  u.searchParams.set("q", query);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error(`Google CSE ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const items = Array.isArray(j.items) ? j.items : [];
  return items.map((i) => ({
    title: i.title,
    link: i.link,
    snippet: i.snippet,
  }));
}

async function cseViaBridge(req, query) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers.host;
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
  if (!r.ok) throw new Error(j?.error || `CSE bridge ${r.status}`);
  const arr = Array.isArray(j.results) ? j.results : [];
  return arr.map((i) => ({
    title: i.title,
    link: i.link,
    snippet: i.snippet,
  }));
}

const preferHosts = [
  "horseracingnation.com",
  "entries.horseracingnation.com",
  "equibase.com",
];

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

async function runSearch(req, query) {
  return GOOGLE_API_KEY && GOOGLE_CSE_ID
    ? await cseDirect(query)
    : await cseViaBridge(req, query);
}

export default async function handler(req, res) {
  // Extract safe values early for error responses
  let safeDate = null;
  let safeTrack = null;
  let safeRaceNo = null;

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res
        .status(405)
        .json({ ok: false, error: "Method Not Allowed" });
    }

    // Be tolerant of either req.body object or JSON string
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
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const {
      track,
      date: inputDate,
      raceNo,
      race_no,
      distance = "",
      surface = "",
      strategy = "",
      ai_picks = "",
      predicted = {},
    } = body || {};

    const raceNumber = raceNo ?? race_no;
    safeDate =
      (inputDate && String(inputDate).trim()) ||
      new Date().toISOString().slice(0, 10);
    safeTrack = track || null;
    safeRaceNo = raceNumber ?? null;

    console.info("[verify_race] request", {
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    if (!track) {
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: "Missing required field: track",
        details: "Track is required to verify a race",
        step: "verify_race_validation",
      });
    }

    const date = safeDate;

    const dWords = date.replace(/-/g, " ");
    const racePart = raceNumber ? ` Race ${raceNumber}` : "";
    const baseQuery = `${track}${racePart} ${date} results Win Place Show order`;
    const altQuery = `${track}${racePart} ${dWords} result chart official`;
    const siteBias =
      "(site:equibase.com OR site:horseracingnation.com OR site:entries.horseracingnation.com)";

    const queries = [
      `${baseQuery} ${siteBias}`.trim(),
      `${altQuery} ${siteBias}`.trim(),
      baseQuery,
      altQuery,
    ];

    let results = [];
    let queryUsed = queries[0];
    let lastError = null;
    const searchStep = "verify_race_search";

    try {
      for (const q of queries) {
        try {
          const items = await runSearch(req, q);
          queryUsed = q;
          results = items;
          if (items.length) break;
        } catch (error) {
          lastError = error;
          console.error("[verify_race] Search query failed", {
            query: q,
            error: error?.message || String(error),
          });
        }
      }

      if (!results.length && lastError) {
        throw lastError;
      }
    } catch (error) {
      console.error("[verify_race] Search failed", {
        error: error?.message || String(error),
        stack: error?.stack,
      });
      return res.status(200).json({
        date: safeDate,
        track: safeTrack,
        raceNo: safeRaceNo,
        error: "Search failed",
        details:
          lastError?.message ||
          error?.message ||
          "Unable to fetch race results from search providers",
        step: searchStep,
        query: queryUsed || queries[0] || null,
      });
    }

    const topPreferred = pickBest(results);
    const top = topPreferred || results[0] || null;

    let outcome = { win: "", place: "", show: "" };
    if (top?.link) {
      try {
        // Try cheerio-based parser first
        const cheerioOutcome = await extractOutcomeFromResultPage(top.link, {
          track: safeTrack || "",
          date: safeDate || "",
          raceNo: raceNumber,
        });

        // If cheerio found results, use them; otherwise fall back to regex parser
        if (cheerioOutcome.win || cheerioOutcome.place || cheerioOutcome.show) {
          outcome = {
            win: cheerioOutcome.win || "",
            place: cheerioOutcome.place || "",
            show: cheerioOutcome.show || "",
          };
        } else {
          // Fallback to existing regex-based parser
          outcome = await fetchAndParseResults(top.link, {
            raceNo: raceNumber,
          });
        }
      } catch (error) {
        console.error("[verify_race] Parse results failed", {
          url: top.link,
          error: error?.message || String(error),
        });
        // Continue with empty outcome - not a fatal error
      }
    }

    const normalizeName = (value = "") =>
      (value || "").toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const hits = (() => {
      if (!predictedSafe || !outcome) {
        return { winHit: false, placeHit: false, showHit: false };
      }

      const pWin = normalizeName(predictedSafe.win);
      const pPlace = normalizeName(predictedSafe.place);
      const pShow = normalizeName(predictedSafe.show);
      const oWin = normalizeName(outcome.win);
      const oPlace = normalizeName(outcome.place);
      const oShow = normalizeName(outcome.show);

      return {
        winHit: pWin && oWin && pWin === oWin,
        placeHit: pPlace && oPlace && pPlace === oPlace,
        showHit: pShow && oShow && pShow === oShow,
      };
    })();

    const summary = (() => {
      const lines = [];
      lines.push(`Query: ${queryUsed || baseQuery}`);
      if (top) {
        if (top.title) lines.push(`Top Result: ${top.title}`);
        if (top.link) lines.push(`Link: ${top.link}`);
      } else {
        lines.push("No top result returned.");
      }
      const outcomeParts = [
        outcome.win,
        outcome.place,
        outcome.show,
      ].filter(Boolean);
      if (outcomeParts.length)
        lines.push(`Outcome: ${outcomeParts.join(" / ")}`);
      const hitList = [
        hits.winHit ? "Win" : null,
        hits.placeHit ? "Place" : null,
        hits.showHit ? "Show" : null,
      ].filter(Boolean);
      if (hitList.length) lines.push(`Hits: ${hitList.join(", ")}`);
      return lines.filter(Boolean).join("\n");
    })();

    const summarySafe =
      summary ||
      (top?.title
        ? `Top Result: ${top.title}${top.link ? `\n${top.link}` : ""}`
        : "No summary returned.");

    // Log outcome for debugging (minimal logging)
    const isHRN = top?.link && /horseracingnation\.com/i.test(top.link);
    if (isHRN) {
      console.info("[verify_race] Parsed HRN outcome", {
        track: safeTrack,
        date: safeDate,
        raceNo: safeRaceNo,
        outcome,
      });
    } else {
      console.info("[verify_race] outcome", {
        track: safeTrack,
        date: safeDate,
        raceNo: safeRaceNo,
        outcome,
        hits,
      });
    }

    const tsIso = new Date().toISOString();
    const redis = getRedis();

    // Redis event log (namespaced) – best-effort
    if (redis) {
      const raceLabel = raceNumber ? `R${raceNumber}` : "R?";
      const ns = `fl:cse:reconcile:${slug(track)}:${date}:${raceLabel}`;
      const eventKey = `${ns}:${Date.now()}:${crypto
        .randomBytes(4)
        .toString("hex")}`;
      try {
        await redis.set(
          eventKey,
          JSON.stringify({
            ts: tsIso,
            track,
            date,
            raceNo: raceNumber ?? null,
            distance,
            surface,
            strategy,
            ai_picks,
            query: queryUsed,
            count: results.length,
            results: results.slice(0, 10),
            predicted: predictedSafe,
            outcome,
            hits,
            summary: summarySafe,
          }),
        );
        await redis.expire(eventKey, TTL_SECONDS);
        await redis.lpush(`${ns}:log`, eventKey);
        await redis.ltrim(`${ns}:log`, 0, 99);
        await redis.expire(`${ns}:log`, TTL_SECONDS);
      } catch (error) {
        console.error("[verify_race] Redis event log failed", error);
      }
    }

    if (redis) {
      try {
        const row = {
          ts: Date.now(),
          date,
          track,
          raceNo: raceNumber ?? null,
          query: queryUsed || null,
          top: top ? { title: top.title, link: top.link } : null,
          outcome,
          predicted: predictedSafe,
          hits,
          summary: summarySafe,
        };
        await redis.rpush(RECON_LIST, JSON.stringify(row));
        const dayKey = `${RECON_DAY_PREFIX}${date}`;
        await redis.rpush(dayKey, JSON.stringify(row));
        await redis.expire(dayKey, 60 * 60 * 24 * 90);
        await redis.hincrby("cal:v1", "total", 1);
        if (hits.winHit) await redis.hincrby("cal:v1", "correctWin", 1);
        if (hits.placeHit) await redis.hincrby("cal:v1", "correctPlace", 1);
        if (hits.showHit) await redis.hincrby("cal:v1", "correctShow", 1);
        if (hits.top3Hit) await redis.hincrby("cal:v1", "top3Hit", 1);
      } catch (error) {
        console.error("Redis logging failed", error);
      }
    }

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
            date,
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
          "Local CSV append failed (dev only):",
          error?.message || error,
        );
      }
    }

    return res.status(200).json({
      date,
      track,
      raceNo: raceNumber ?? null,
      query: queryUsed,
      count: results.length,
      top,
      results: results.slice(0, 5),
      outcome,
      predicted: predictedSafe,
      hits,
      summary: summarySafe,
    });
  } catch (err) {
    console.error("[verify_race] error", {
      error: err?.message || String(err),
      stack: err?.stack,
      track: safeTrack,
      date: safeDate,
      raceNo: safeRaceNo,
    });

    // Always return 200 with structured error response
    return res.status(200).json({
      date: safeDate,
      track: safeTrack,
      raceNo: safeRaceNo,
      error: "verify_race failed",
      details: err?.message || String(err) || "Unknown error occurred",
      step: "verify_race",
    });
  }
}
