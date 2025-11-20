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
 * Parse HRN outcome from HTML using cheerio
 * Simple stable implementation: scan tables for Runner/Win/Place/Show columns
 * Based on the working approach from lib/results.js
 * @param {cheerio.CheerioAPI} $
 * @param {string} raceNo - optional race number for context
 * @returns {{ win?: string; place?: string; show?: string }}
 */
function parseHRNRaceOutcome($, raceNo) {
  const outcome = {};
  
  try {
    let hrnWin = "";
    let hrnPlace = "";
    let hrnShow = "";

    // Scan all tables to find one with Runner + Win + Place + Show headers
    $("table").each((_, table) => {
      // If we already found all three, stop scanning
      if (hrnWin && hrnPlace && hrnShow) return;

      const $table = $(table);
      const headerRow = $table.find("tr").first();
      const headerCells = headerRow.find("th, td").toArray();
      if (!headerCells.length) return;

      const headerTexts = headerCells.map((cell) =>
        $(cell).text().toLowerCase().trim()
      );

      // Identify Runner/Horse and Win/Place/Show column indexes
      const runnerIdx = headerTexts.findIndex(
        (h) => h.includes("runner") || h.includes("horse")
      );
      const winIdx = headerTexts.findIndex((h) => h.includes("win"));
      const placeIdx = headerTexts.findIndex((h) => h.includes("place"));
      const showIdx = headerTexts.findIndex((h) => h.includes("show"));

      // Must have Runner/Horse and all three WPS columns
      if (
        runnerIdx === -1 ||
        winIdx === -1 ||
        placeIdx === -1 ||
        showIdx === -1
      ) {
        return; // Skip this table
      }

      // Scan data rows (skip header)
      $table.find("tr").slice(1).each((_, tr) => {
        const $cells = $(tr).find("td");
        if (!$cells.length) return;

        const runnerText = ($cells.eq(runnerIdx).text() || "").trim();
        if (!runnerText) return;

        // Skip header-like rows
        if (/runner\s*\(speed\)/i.test(runnerText)) return;

        // Normalize runner name: strip footnote markers like (*) or (114*)
        let runnerName = runnerText.replace(/\s*\([^)]*\)\s*$/, "").trim();
        runnerName = normalizeHorseName(runnerName);
        if (!runnerName) return;

        // Hard filters to avoid junk rows
        const lowerRunner = runnerName.toLowerCase();
        if (
          lowerRunner.startsWith("*") ||
          lowerRunner.includes("preliminary speed figures") ||
          lowerRunner.includes("also rans") ||
          lowerRunner.includes("pool") ||
          lowerRunner.includes("daily double") ||
          lowerRunner.includes("trifecta") ||
          lowerRunner.includes("superfecta") ||
          lowerRunner.includes("pick 3") ||
          lowerRunner.includes("pick 4")
        ) {
          return; // Skip this row
        }

        // Get Win/Place/Show cell values
        const winVal = ($cells.eq(winIdx).text() || "").trim();
        const placeVal = ($cells.eq(placeIdx).text() || "").trim();
        const showVal = ($cells.eq(showIdx).text() || "").trim();

        // First non-empty Win cell becomes results.win
        if (!hrnWin && winVal && runnerName) {
          hrnWin = runnerName;
        }

        // First non-empty Place cell becomes results.place
        if (!hrnPlace && placeVal && runnerName) {
          hrnPlace = runnerName;
        }

        // First non-empty Show cell becomes results.show
        if (!hrnShow && showVal && runnerName) {
          hrnShow = runnerName;
        }
      });
    });

    // Only assign non-empty values
    if (hrnWin) outcome.win = hrnWin;
    if (hrnPlace) outcome.place = hrnPlace;
    if (hrnShow) outcome.show = hrnShow;

    // Debug log for HRN parse success
    if (hrnWin || hrnPlace || hrnShow) {
      console.log("[verify_race][hrn] HRN outcome extracted", {
        raceNo: raceNo || "(any)",
        outcome,
      });
    }
  } catch (error) {
    console.error("[verify_race][hrn] parseHRNRaceOutcome failed", error);
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

    // For HRN pages, use simplified HRN parsing (works with or without raceNo)
    if (isHRN) {
      const hrnOutcome = parseHRNRaceOutcome($, raceNo ? String(raceNo) : null);
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

    // Only overwrite if we have non-empty values (defensive)
    if (byPos.get(1)) outcome.win = byPos.get(1);
    if (byPos.get(2)) outcome.place = byPos.get(2);
    if (byPos.get(3)) outcome.show = byPos.get(3);
  } catch (error) {
    console.error("[verify_race] parseOutcomeFromHtml failed", error);
  }

  return outcome;
}

/**
 * Extract outcome from result page using cheerio
 * @param {string} url
 * @param {{ track: string; date: string; raceNo?: string | number | null }} ctx
 * @returns {Promise<{ win?: string; place?: show?: string }>}
 */
async function extractOutcomeFromResultPage(url, ctx) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot)",
      },
    });

    if (!res.ok) {
      console.error("[verify_race][hrn] fetch failed", {
        url,
        status: res.status,
        statusText: res.statusText,
      });
      return {};
    }

    const html = await res.text();

    // Verify page contains the correct race number before parsing
    if (ctx.raceNo) {
      const raceNoStr = String(ctx.raceNo).trim();
      const trackLower = (ctx.track || "").toLowerCase();
      
      // Check for race number in page text
      const hasRaceNo = new RegExp(
        `Race\\s*#?\\s*${raceNoStr}\\b`,
        "i"
      ).test(html);
      
      // Check for track name in page text
      const hasTrack = trackLower
        ? new RegExp(trackLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(html)
        : true;

      if (!hasRaceNo || !hasTrack) {
        console.warn("[verify_race][hrn] Page validation failed", {
          url,
          raceNo: ctx.raceNo,
          track: ctx.track,
          hasRaceNo,
          hasTrack,
        });
        return {}; // Return empty outcome if validation fails
      }
    }

    const outcome = parseOutcomeFromHtml(html, url, ctx.raceNo);
    return outcome;
  } catch (error) {
    // Best-effort only; swallow errors and return empty so UI still works
    console.error("[verify_race][hrn] extractOutcomeFromResultPage failed", {
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
        results: { win: "", place: "", show: "" },
        outcome: { win: "", place: "", show: "" },
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
        results: { win: "", place: "", show: "" },
        outcome: { win: "", place: "", show: "" },
      });
    }

    const topPreferred = pickBest(results);
    const top = topPreferred || results[0] || null;

    let parsedOutcome = { win: "", place: "", show: "" };
    if (top?.link) {
      try {
        const link = (top.link || "").toLowerCase();
        if (link.includes("horseracingnation.com")) {
          // Use dedicated HRN parser from commit 3d0dc61
          const hrnOutcome = await extractOutcomeFromResultPage(top.link, {
            track: safeTrack || "",
            date: safeDate || "",
            raceNo: raceNumber,
          });
          if (hrnOutcome && (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show)) {
            parsedOutcome = {
              win: hrnOutcome.win || "",
              place: hrnOutcome.place || "",
              show: hrnOutcome.show || "",
            };
          }
        } else {
          // Fall back to generic parser for non-HRN URLs
          parsedOutcome = await fetchAndParseResults(top.link, {
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

    // Build clean outcome: only use parsed data
    const outcome = parsedOutcome;

    const normalizeName = (value = "") =>
      value.toLowerCase().replace(/\s+/g, " ").trim();

    const predictedSafe = {
      win: predicted && predicted.win ? String(predicted.win) : "",
      place: predicted && predicted.place ? String(predicted.place) : "",
      show: predicted && predicted.show ? String(predicted.show) : "",
    };

    const hits = {
      winHit:
        predictedSafe.win &&
        outcome.win &&
        normalizeName(predictedSafe.win) === normalizeName(outcome.win),
      placeHit:
        predictedSafe.place &&
        outcome.place &&
        normalizeName(predictedSafe.place) === normalizeName(outcome.place),
      showHit:
        predictedSafe.show &&
        outcome.show &&
        normalizeName(predictedSafe.show) === normalizeName(outcome.show),
      top3Hit: [predictedSafe.win, predictedSafe.place, predictedSafe.show]
        .filter(Boolean)
        .map(normalizeName)
        .some((name) =>
          [outcome.win, outcome.place, outcome.show]
            .map(normalizeName)
            .includes(name),
        ),
    };

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
        safeOutcome.win,
        safeOutcome.place,
        safeOutcome.show,
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

    // Build results object from parsed chart data
    // results holds the chart outcome { win, place, show }
    const resultsObj = {
      win: outcome.win || "",
      place: outcome.place || "",
      show: outcome.show || "",
    };

    return res.status(200).json({
      date,
      track,
      raceNo: raceNumber ?? null,
      query: queryUsed,
      count: results.length,
      top,
      results: resultsObj, // Chart outcome { win, place, show }
      outcome, // Backward compatibility (same as results)
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
      results: { win: "", place: "", show: "" },
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false },
    });
  }
}

