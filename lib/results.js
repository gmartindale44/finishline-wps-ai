// lib/results.js
// JS mirror of results.ts so Vercel can load it (Node cannot import .ts files in this environment)

import * as cheerio from "cheerio";

/**
 * @typedef {{ win: string, place: string, show: string }} ParsedOutcome
 */

/**
 * Clean up a horse name: collapse whitespace, strip weird characters.
 * @param {string} name
 * @returns {string}
 */
function cleanName(name) {
  return name
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9' .\-]/g, "")
    .trim();
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, " ");
}

/**
 * Extract horse number (program number) from text
 * @param {string} text
 * @returns {string | null}
 */
function extractHorseNumber(text) {
  if (!text) return null;
  // Strip non-digits except whitespace, then find first integer
  const cleaned = text.replace(/[^\d\s]/g, " ").trim();
  const match = cleaned.match(/\d+/);
  return match ? match[0] : null;
}

/**
 * Check if cell text indicates a payout (has $ or decimal number, not just "-")
 * @param {string} text
 * @returns {boolean}
 */
function isPayoutText(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-") return false;
  // Contains currency symbol or decimal number pattern
  return /\$/.test(trimmed) || /^\d+\.\d+/.test(trimmed) || /^\d+\.\d+/.test(trimmed.replace(/[^\d.]/g, ""));
}

/**
 * Parse HRN WPS outcome from HTML using cheerio
 * Extracts program numbers (horse numbers) based on payout presence
 * @param {string} html
 * @returns {{ outcome: ParsedOutcome, debugNotes: Array }}
 */
export function parseHrnWpsOutcome(html) {
  const outcome = { win: "", place: "", show: "" };
  const debugNotes = [];

  try {
    const $ = cheerio.load(html);

    // Find all tables
    const tables = $("table").toArray();
    let targetTable = null;
    let idxWin = -1;
    let idxPlace = -1;
    let idxShow = -1;
    let idxRunner = -1;

    // Find table with Runner + Win + Place + Show headers
    for (const table of tables) {
      const $table = $(table);
      const $headerRow = $table.find("tr").first();
      const $headerCells = $headerRow.find("th, td");

      if ($headerCells.length === 0) continue;

      const headers = [];
      $headerCells.each((_, cell) => {
        const text = $(cell).text().trim().toLowerCase().replace(/\s+/g, " ");
        headers.push(text);
      });

      // Check for required headers
      const runnerIdx = headers.findIndex((h) => h.includes("runner") || h.includes("horse"));
      const winIdx = headers.findIndex((h) => h === "win");
      const placeIdx = headers.findIndex((h) => h === "place");
      const showIdx = headers.findIndex((h) => h === "show");

      if (runnerIdx !== -1 && winIdx !== -1 && placeIdx !== -1 && showIdx !== -1) {
        targetTable = $table;
        idxRunner = runnerIdx;
        idxWin = winIdx;
        idxPlace = placeIdx;
        idxShow = showIdx;
        break;
      }
    }

    if (!targetTable) {
      debugNotes.push({ where: "parseHrnWpsOutcome", note: "no-wps-table-found" });
      return { outcome, debugNotes };
    }

    // Process rows
    let winHorse = null;
    let placeHorse = null;
    let showHorse = null;

    const $rows = targetTable.find("tr").slice(1); // Skip header
    $rows.each((_, row) => {
      const $cells = $(row).find("td, th");
      if ($cells.length === 0) return;

      // Extract horse number from first cell (program number is usually in first column)
      const firstCellText = $cells.eq(0).text().trim();
      const horseNo = extractHorseNumber(firstCellText);

      if (!horseNo) {
        // Try runner column if first cell didn't have a number
        if (idxRunner >= 0 && idxRunner < $cells.length) {
          const runnerText = $cells.eq(idxRunner).text().trim();
          const runnerHorseNo = extractHorseNumber(runnerText);
          if (runnerHorseNo) {
            // Use runner column's number
            const cells = [];
            $cells.each((_, cell) => cells.push($(cell).text().trim()));
            const winVal = cells[idxWin] || "";
            const placeVal = cells[idxPlace] || "";
            const showVal = cells[idxShow] || "";

            const hasWinPayout = isPayoutText(winVal);
            const hasPlacePayout = isPayoutText(placeVal);
            const hasShowPayout = isPayoutText(showVal);

            if (!winHorse && hasWinPayout) {
              winHorse = runnerHorseNo;
            }
            if (!placeHorse && hasPlacePayout && runnerHorseNo !== winHorse) {
              placeHorse = runnerHorseNo;
            }
            if (!showHorse && hasShowPayout && runnerHorseNo !== winHorse && runnerHorseNo !== placeHorse) {
              showHorse = runnerHorseNo;
            }
          }
        }
        return;
      }

      // Get payout cells
      const cells = [];
      $cells.each((_, cell) => cells.push($(cell).text().trim()));

      const winVal = cells[idxWin] || "";
      const placeVal = cells[idxPlace] || "";
      const showVal = cells[idxShow] || "";

      const hasWinPayout = isPayoutText(winVal);
      const hasPlacePayout = isPayoutText(placeVal);
      const hasShowPayout = isPayoutText(showVal);

      // Win: first horse with a Win payout
      if (!winHorse && hasWinPayout) {
        winHorse = horseNo;
      }

      // Place: first distinct horse with a Place payout
      if (!placeHorse && hasPlacePayout && horseNo !== winHorse) {
        placeHorse = horseNo;
      }

      // Show: first distinct horse with a Show payout
      if (!showHorse && hasShowPayout && horseNo !== winHorse && horseNo !== placeHorse) {
        showHorse = horseNo;
      }
    });

    // Build outcome
    if (winHorse) {
      outcome.win = winHorse;
      outcome.place = placeHorse || "";
      outcome.show = showHorse || "";
      debugNotes.push({ where: "parseHrnWpsOutcome", note: "parsed-from-payouts" });
    } else {
      debugNotes.push({ where: "parseHrnWpsOutcome", note: "no-wps-found" });
    }
  } catch (error) {
    debugNotes.push({
      where: "parseHrnWpsOutcome",
      error: String(error?.message || error),
    });
    console.error("[results] parseHrnWpsOutcome failed", error);
  }

  return { outcome, debugNotes };
}

/**
 * Fetch a results page and try to extract Win / Place / Show names.
 * Mirrors the logic in lib/results.ts but in plain JavaScript for runtime use.
 *
 * @param {string} url
 * @param {{ raceNo?: string | number | null }} [options]
 * @returns {Promise<ParsedOutcome>}
 */
export async function fetchAndParseResults(url, options = {}) {
  /** @type {ParsedOutcome} */
  const outcome = { win: "", place: "", show: "" };
  if (!url) return outcome;

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) return outcome;

    const html = await res.text();

    const isHRN = /horseracingnation\.com/i.test(url);

    // Narrow HTML to the requested race for non-HRN sites when raceNo is provided
    let scopeHtml = html;
    const raceNo = options.raceNo;
    if (!isHRN && raceNo != null && raceNo !== "") {
      const num = String(raceNo).trim();
      try {
        const patterns = [
          // Race 3 ... Finish Order / Win
          new RegExp(
            `Race\\s*${num}[\\s\\S]{0,4000}?(?:Finish\\s+Order|Win\\b)`,
            "i"
          ),
          // Race 3 ... <table>...</table>
          new RegExp(
            `Race\\s*${num}[\\s\\S]{0,4000}?<table[\\s\\S]{0,4000}?</table>`,
            "i"
          ),
        ];
        for (const re of patterns) {
          const m = html.match(re);
          if (m) {
            scopeHtml = m[0];
            break;
          }
        }
      } catch {
        // fall back to full html on any regex error
      }
    }

    const trySetFromList = (names) => {
      const filtered = names
        .map(cleanName)
        .filter(Boolean)
        .filter((n) => {
          const lower = n.toLowerCase();

          // avoid grabbing label text like "Win", "Place", "Show"
          if (lower === "win" || lower === "place" || lower === "show") {
            return false;
          }

          // Drop pure ordinals like "4th", "2nd", etc.
          if (/^\d+(st|nd|rd|th)$/i.test(lower)) return false;

          const alpha = lower.replace(/[^a-z]/g, "");
          // Drop very short alpha fragments (e.g. "th")
          if (alpha.length < 3) return false;

          // Require at least one word fragment of length >= 3
          if (!/\b[a-z]{3,}\b/i.test(lower)) return false;

          return true;
        });

      if (filtered.length >= 3) {
        outcome.win = outcome.win || filtered[0];
        outcome.place = outcome.place || filtered[1];
        outcome.show = outcome.show || filtered[2];
      }
    };

    // HorseRacingNation-specific parsing (Entries & Results tables)
    if (isHRN) {
      try {
        // Try new robust parser first
        const parsed = parseHrnWpsOutcome(html);
        if (parsed.outcome && parsed.outcome.win) {
          outcome.win = parsed.outcome.win;
          outcome.place = parsed.outcome.place;
          outcome.show = parsed.outcome.show;
          // If we got a result, return early
          if (outcome.win) {
            return outcome;
          }
        }

        // Fallback to old regex-based parsing
        const tableRe = /<table[\s\S]*?<\/table>/gi;
        let hrnWin = "";
        let hrnPlace = "";
        let hrnShow = "";

        let m;
        // Scan tables to find one whose header row has Runner + Win + Place + Show
        // Use full HTML for HRN (not scoped)
        while ((m = tableRe.exec(html))) {
          const table = m[0];
          const headerMatch = table.match(/<tr[\s\S]*?<\/tr>/i);
          if (!headerMatch) continue;

          const headerCells = Array.from(
            headerMatch[0].matchAll(
              /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi
            )
          ).map((cell) => cleanName(stripTags(cell[1])).toLowerCase());

          const runnerIdx = headerCells.findIndex(
            (h) => h.includes("runner") || h.includes("horse")
          );
          const winIdx = headerCells.findIndex((h) => h.includes("win"));
          const placeIdx = headerCells.findIndex((h) => h.includes("place"));
          const showIdx = headerCells.findIndex((h) => h.includes("show"));

          if (
            runnerIdx === -1 ||
            winIdx === -1 ||
            placeIdx === -1 ||
            showIdx === -1
          ) {
            continue;
          }

          const rowMatches = Array.from(
            table.matchAll(/<tr[\s\S]*?<\/tr>/gi)
          ).slice(1); // skip header

          for (const row of rowMatches) {
            const cells = Array.from(
              row[0].matchAll(
                /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi
              )
            ).map((cell) => stripTags(cell[1]).trim());

            const runner = cells[runnerIdx] || "";
            const winVal = cells[winIdx] || "";
            const placeVal = cells[placeIdx] || "";
            const showVal = cells[showIdx] || "";

            if (!hrnWin && winVal && runner) hrnWin = runner;
            if (!hrnPlace && placeVal && runner) hrnPlace = runner;
            if (!hrnShow && showVal && runner) hrnShow = runner;
          }

          if (hrnWin || hrnPlace || hrnShow) {
            trySetFromList([hrnWin, hrnPlace, hrnShow]);
            break;
          }
        }
      } catch {
        // fall back to generic parsing
      }
    }

    // 1) Try "Finish Order" table (scoped to race)
    const finishMatch = scopeHtml.match(
      /Finish\s+Order[\s\S]{0,2000}?<\/table>/i
    );
    if (finishMatch) {
      const block = finishMatch[0];
      const names = Array.from(
        block.matchAll(/>([A-Za-z0-9' .\-]+)</g)
      ).map((m) => m[1]);
      trySetFromList(names);
    }

    // 2) Try explicit Win / Place / Show labels (scoped)
    if (!outcome.win) {
      const hrn = scopeHtml.match(
        /Win[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Place[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Show[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i
      );
      if (hrn) {
        trySetFromList([hrn[1], hrn[2], hrn[3]]);
      }
    }

    // 3) Fallback: 1st / 2nd / 3rd labels (scoped)
    if (!outcome.win) {
      const fallback = scopeHtml.match(
        /1st[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?2nd[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?3rd[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i
      );
      if (fallback) {
        trySetFromList([fallback[1], fallback[2], fallback[3]]);
      }
    }
  } catch (error) {
    console.error("[results] parse failed", error);
  }

  return outcome;
}
