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
 * Parse HRN race-specific outcome from HTML using cheerio
 * Finds the specific race section and parses the Runner (speed) W/P/S table
 * @param {cheerio.CheerioAPI} $
 * @param {string} raceNo
 * @returns {{ win?: string; place?: string; show?: string }}
 */
function parseHRNRaceOutcome($, raceNo) {
  const outcome = {};

  try {
    // Find the race section by looking for a heading that contains "Race # {raceNo}"
    const raceLabel = `Race # ${raceNo}`;
    const raceLabelAlt = `Race ${raceNo}`;
    let raceSection = null;

    // Search for headings that match the race number
    $("h1, h2, h3, h4, h5, h6, div, span, p").each((_, el) => {
      const text = $(el).text().trim();
      if (
        text.includes(raceLabel) ||
        text.includes(raceLabelAlt) ||
        new RegExp(`Race\\s*#?\\s*${raceNo}\\b`, "i").test(text)
      ) {
        // Found the race heading, now find its containing section
        // Climb up to find a parent container that likely contains the race tables
        let parent = $(el).parent();
        for (let i = 0; i < 5 && parent.length; i++) {
          // Check if this parent contains tables with Runner/Win/Place/Show
          const hasRunnerTable = parent
            .find("table")
            .toArray()
            .some((table) => {
              const headerText = $(table).find("tr").first().text().toLowerCase();
              return (
                headerText.includes("runner") &&
                headerText.includes("win") &&
                headerText.includes("place") &&
                headerText.includes("show")
              );
            });

          if (hasRunnerTable) {
            raceSection = parent;
            break;
          }
          parent = parent.parent();
        }
        if (raceSection) return false; // break the each loop
      }
    });

    if (!raceSection) {
      // Try a simpler approach: find all tables and check if they're in a race section
      $("table").each((_, table) => {
        const $table = $(table);
        const headerText = $table.find("tr").first().text().toLowerCase();

        // Check if this is a Runner/Win/Place/Show table
        if (
          headerText.includes("runner") &&
          headerText.includes("win") &&
          headerText.includes("place") &&
          headerText.includes("show")
        ) {
          // Check if this table is NOT in the "Today's racing results" summary
          // by looking at preceding text/headings
          let prevText = "";
          $table
            .prevAll()
            .slice(0, 10)
            .each((_, el) => {
              prevText += $(el).text() + " ";
            });

          const isSummaryTable =
            /today'?s\s+racing\s+results/i.test(prevText) ||
            /speed\s+figures/i.test(prevText);

          if (!isSummaryTable) {
            // This might be a race-specific table, check if it's near our race number
            const nearbyText = prevText + $table.text();
            if (
              new RegExp(`Race\\s*#?\\s*${raceNo}\\b`, "i").test(nearbyText)
            ) {
              raceSection = $table.closest("div, section, article, main");
              if (!raceSection.length) raceSection = $table.parent();
              return false; // break
            }
          }
        }
      });
    }

    if (!raceSection || !raceSection.length) {
      return outcome; // Could not find race section
    }

    // Now find the Runner (speed) table within the race section
    // This table has columns: Runner (speed), Win, Place, Show
    // and contains the actual finishing positions for this race
    raceSection.find("table").each((_, table) => {
      const $table = $(table);
      const headerRow = $table.find("tr").first();
      const headerCells = headerRow.find("th, td").toArray();

      // Check if this table has Runner, Win, Place, Show columns
      const headerTexts = headerCells.map((cell) =>
        $(cell).text().toLowerCase().trim()
      );

      // Verify this is the Runner (speed) W/P/S table, not the summary table
      // The summary table has columns like: Race, HRN, Horse, Sire, Age
      // The Runner table has: Runner (speed), Win, Place, Show
      const hasRunnerCol = headerTexts.some(
        (h) => h.includes("runner") || h.includes("horse")
      );
      const hasWinCol = headerTexts.some((h) => h.includes("win"));
      const hasPlaceCol = headerTexts.some((h) => h.includes("place"));
      const hasShowCol = headerTexts.some((h) => h.includes("show"));

      // Reject if this looks like the summary table (has HRN, Sire, Age columns)
      const hasSummaryCols =
        headerTexts.some((h) => h.includes("hrn") || h.includes("sire")) &&
        !hasWinCol;

      if (hasSummaryCols) {
        return; // This is the summary table, skip it
      }

      // Must have all required columns: Runner, Win, Place, Show
      const runnerIdx = headerTexts.findIndex(
        (h) => h.includes("runner") || h.includes("horse")
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
        return; // Not the right table, continue
      }

      // Parse rows to find Win/Place/Show horses
      // The Runner (speed) table encodes finishing positions:
      // - Row with payout in first payout cell (Win) = winner
      // - Row with payout in second payout cell (Place) = place horse
      // - Row with payout in third payout cell (Show) = show horse
      const rows = $table.find("tr").slice(1); // Skip header

      rows.each((_, row) => {
        const cells = $(row).find("td, th").toArray();
        if (cells.length < 2) {
          return; // Need at least runner name + some payout cells
        }

        // Extract runner name from the first cell (strip speed figure suffix like "(98*)")
        let runnerName = $(cells[0]).text().trim();
        // Remove speed figure in parentheses: "Full Time Strutin (98*)" -> "Full Time Strutin"
        runnerName = runnerName.replace(/\s*\([^)]*\)\s*$/, "").trim();
        runnerName = normalizeHorseName(runnerName);

        if (!runnerName) return;

        // Find payout cells: cells that contain "$" (dollar amounts)
        // In HRN Runner table, payout cells are the ones with dollar amounts like "$8.20"
        // Other cells may contain post position numbers, speed figures, icons, etc. - ignore those
        const payoutCells = cells
          .map((cell, idx) => ({ cell: $(cell), idx }))
          .filter(({ cell }) => {
            const text = cell.text().trim();
            return text.includes("$");
          });

        // We need at least 3 payout cells (Win, Place, Show)
        // But we'll work with what we have
        if (payoutCells.length < 1) {
          return; // No payout cells found in this row
        }

        // Extract payout text from each payout cell
        // payoutCells[0] = Win payout, [1] = Place payout, [2] = Show payout
        const winText =
          payoutCells[0]?.cell.text().trim() || "";
        const placeText =
          payoutCells[1]?.cell.text().trim() || "";
        const showText =
          payoutCells[2]?.cell.text().trim() || "";

        // Check if each payout is valid (non-empty and not "-")
        const hasWin = !!winText && winText !== "-" && winText.length > 0;
        const hasPlace = !!placeText && placeText !== "-" && placeText.length > 0;
        const hasShow = !!showText && showText !== "-" && showText.length > 0;

        // Debug logging (server-side only)
        if (process.env.VERIFY_DEBUG === "true") {
          console.log("[verify_race] HRN payout cells", {
            runnerName,
            payoutCellsCount: payoutCells.length,
            winText,
            placeText,
            showText,
            hasWin,
            hasPlace,
            hasShow,
          });
        }

        // Assign positions: only assign once per bucket (first row with valid payout)
        if (hasWin && !outcome.win) {
          outcome.win = runnerName;
        }
        if (hasPlace && !outcome.place) {
          outcome.place = runnerName;
        }
        if (hasShow && !outcome.show) {
          outcome.show = runnerName;
        }
      });

      // If we found at least one position from the Runner (speed) table, we're done with this table
      // The outcome object was populated directly in the loop above
      if (outcome.win || outcome.place || outcome.show) {
        // Debug logging for HRN parsing (server-side only)
        if (process.env.VERIFY_DEBUG === "true") {
          console.log("[verify_race] HRN Runner table result", {
            outcome: { ...outcome },
          });
        }

        // Break after processing the Runner (speed) table
        // We'll use fallback only if positions are missing
        return false; // Found Runner table, break the each loop
      }
    });

    // Fallback: If we didn't get all three positions from Runner (speed) table,
    // try the Pool / Finish / $2 Payout table
    if (!outcome.win || !outcome.place || !outcome.show) {
      // Look for Pool/Finish table with Trifecta or Exacta rows
      raceSection.find("table").each((_, table) => {
        const $table = $(table);
        const headerRow = $table.find("tr").first();
        const headerTexts = headerRow
          .find("th, td")
          .toArray()
          .map((cell) => $(cell).text().toLowerCase().trim());

        const poolIdx = headerTexts.findIndex((h) => h.includes("pool"));
        const finishIdx = headerTexts.findIndex((h) => h.includes("finish"));
        const payoutIdx = headerTexts.findIndex((h) =>
          h.includes("payout") || h.includes("$2")
        );

        if (finishIdx === -1) return; // Need Finish column

        // Find Trifecta row (preferred) or Exacta row
        const rows = $table.find("tr").slice(1);
        let finishPattern = null;

        rows.each((_, row) => {
          const cells = $(row).find("td, th").toArray();
          const poolCell =
            poolIdx >= 0 && cells[poolIdx]
              ? $(cells[poolIdx]).text().toLowerCase().trim()
              : "";
          const finishCell =
            finishIdx >= 0 && cells[finishIdx]
              ? $(cells[finishIdx]).text().trim()
              : "";

          // Prefer Trifecta (has 3 numbers), fallback to Exacta (has 2)
          if (
            (poolCell.includes("trifecta") || poolCell.includes("exacta")) &&
            finishCell
          ) {
            // Finish pattern like "2-5-3" or "2-5"
            const match = finishCell.match(/^(\d+)[\s\-]+(\d+)(?:[\s\-]+(\d+))?/);
            if (match) {
              finishPattern = {
                winProg: match[1],
                placeProg: match[2],
                showProg: match[3] || null, // Exacta only has 2 numbers
              };
              return false; // break
            }
          }
        });

        if (finishPattern) {
          // Now map program numbers to horse names using the entries table
          // Look for a table with PP (post position) or program number column
          raceSection.find("table").each((_, entriesTable) => {
            const $entriesTable = $(entriesTable);
            const entriesHeader = $entriesTable.find("tr").first();
            const entriesHeaderTexts = entriesHeader
              .find("th, td")
              .toArray()
              .map((cell) => $(cell).text().toLowerCase().trim());

            const ppIdx = entriesHeaderTexts.findIndex(
              (h) => h.includes("pp") || h.includes("post") || h === "#"
            );
            const horseIdx = entriesHeaderTexts.findIndex(
              (h) =>
                h.includes("horse") ||
                h.includes("runner") ||
                h.includes("name") ||
                h.includes("last")
            );

            if (ppIdx === -1 || horseIdx === -1) return;

            const programToHorse = new Map();
            $entriesTable
              .find("tr")
              .slice(1)
              .each((_, row) => {
                const cells = $(row).find("td, th").toArray();
                if (cells.length <= Math.max(ppIdx, horseIdx)) return;

                const ppText = $(cells[ppIdx]).text().trim();
                const ppMatch = ppText.match(/^(\d+)/);
                if (!ppMatch) return;

                const programNum = ppMatch[1];
                let horseName = $(cells[horseIdx]).text().trim();
                // Remove speed figures and normalize
                horseName = horseName.replace(/\s*\([^)]*\)\s*$/, "").trim();
                horseName = normalizeHorseName(horseName);

                if (horseName) {
                  programToHorse.set(programNum, horseName);
                }
              });

            // Map finish pattern to horse names
            if (finishPattern.winProg && programToHorse.has(finishPattern.winProg)) {
              if (!outcome.win)
                outcome.win = programToHorse.get(finishPattern.winProg);
            }
            if (
              finishPattern.placeProg &&
              programToHorse.has(finishPattern.placeProg)
            ) {
              if (!outcome.place)
                outcome.place = programToHorse.get(finishPattern.placeProg);
            }
            if (
              finishPattern.showProg &&
              programToHorse.has(finishPattern.showProg)
            ) {
              if (!outcome.show)
                outcome.show = programToHorse.get(finishPattern.showProg);
            }

            return false; // Found entries table, break
          });
        }
      });
    }
  } catch (error) {
    console.error("[verify_race] parseHRNRaceOutcome failed", error);
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
      const hrnOutcome = parseHRNRaceOutcome($, String(raceNo));
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
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false },
    });
  }
}
