// lib/results.js
// Focused HRN / generic WPS parser used by verify_race

import * as cheerio from "cheerio";

/**
 * @typedef {{ win?: string; place?: string; show?: string }} Outcome
 */

const norm = (s = "") =>
  s
    .toString()
    .replace(/\s+/g, " ")
    .trim();

function normalizeHorseName(name = "") {
  return norm(name);
}

/**
 * Extract Win/Place/Show from a "Runner (Speed) / Win / Place / Show" table.
 * This is tailored to HorseRacingNation's entries-results pages.
 *
 * @param {cheerio.CheerioAPI} $
 * @param {cheerio.Cheerio<cheerio.Element>} $table
 * @param {{ runnerIdx: number; winIdx: number; placeIdx: number; showIdx: number }} idx
 * @returns {Outcome}
 */
function extractOutcomeFromRunnerTable($, $table, idx) {
  const { runnerIdx, winIdx, placeIdx, showIdx } = idx;
  const $rows = $table.find("tr");

  const runners = [];

  $rows.each((i, tr) => {
    const $cells = $(tr).find("td");
    if (!$cells.length) return;

    const runnerText = runnerIdx > -1 ? norm($cells.eq(runnerIdx).text()) : "";
    if (!runnerText) return;

    // Skip header-ish junk rows
    if (/runner\s*\(speed\)/i.test(runnerText)) return;

    const winText = winIdx > -1 ? norm($cells.eq(winIdx).text()) : "";
    const placeText = placeIdx > -1 ? norm($cells.eq(placeIdx).text()) : "";
    const showText = showIdx > -1 ? norm($cells.eq(showIdx).text()) : "";

    // If no payouts at all, ignore the row
    if (!winText && !placeText && !showText) return;

    // Strip footnote markers like "(103*)" from runner name
    let runnerName = runnerText.replace(/\s*\([^)]*\)\s*$/, "");
    runnerName = normalizeHorseName(runnerName);
    if (!runnerName) return;

    const lower = runnerName.toLowerCase();
    const junkPatterns = [
      "preliminary speed figures",
      "also rans",
      "pool",
      "daily double",
      "trifecta",
      "superfecta",
      "pick 3",
      "pick 4"
    ];
    if (lower.startsWith("*") || junkPatterns.some((p) => lower.includes(p))) {
      return;
    }

    runners.push({
      name: runnerName,
      hasWin: !!winText && winText !== "-",
      hasPlace: !!placeText && placeText !== "-",
      hasShow: !!showText && showText !== "-"
    });
  });

  if (!runners.length) {
    return { win: "", place: "", show: "" };
  }

  // 1) WIN = first horse with a Win payout
  const winHorse = runners.find((r) => r.hasWin)?.name || "";

  // 2) PLACE = Prefer a place-only horse that's not the winner
  const placeHorse =
    runners.find(
      (r) =>
        r.hasPlace &&
        r.name !== winHorse &&
        !r.hasWin
    )?.name ||
    runners.find((r) => r.hasPlace && r.name !== winHorse)?.name ||
    "";

  // 3) SHOW = Prefer a show-only horse that's not win or place
  const showHorse =
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse &&
        !r.hasWin &&
        !r.hasPlace
    )?.name ||
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse &&
        !r.hasWin
    )?.name ||
    runners.find(
      (r) =>
        r.hasShow &&
        r.name !== winHorse &&
        r.name !== placeHorse
    )?.name ||
    "";

  return {
    win: winHorse,
    place: placeHorse,
    show: showHorse
  };
}

/**
 * Parse HRN WPS outcome from HTML for a given race.
 * For now we pick the first matching Runner/Win/Place/Show table, which
 * corresponds to Race 1 on the page. (We can extend this later to use raceNo.)
 *
 * @param {cheerio.CheerioAPI} $
 * @param {{ raceNo?: string|number|null }} opts
 * @returns {Outcome}
 */
function parseHrnWps($, opts = {}) {
  const tables = [];
  $("table").each((_, table) => {
    const $table = $(table);
    const headerRow = $table.find("tr").first();
    const headerCells = headerRow.find("th, td");
    if (!headerCells.length) return;

    const headers = headerCells
      .map((i, cell) => norm($(cell).text()).toLowerCase())
      .get();

    const runnerIdx = headers.findIndex(
      (h) => h.includes("runner") || h.includes("horse")
    );
    const winIdx = headers.findIndex((h) => h.includes("win"));
    const placeIdx = headers.findIndex((h) => h.includes("place"));
    const showIdx = headers.findIndex((h) => h.includes("show"));

    if (runnerIdx === -1 || winIdx === -1 || placeIdx === -1) return;

    tables.push({ $table, runnerIdx, winIdx, placeIdx, showIdx });
  });

  if (!tables.length) {
    return { win: "", place: "", show: "" };
  }

  // TODO: if we need per-race mapping later, use opts.raceNo + nearby "Race X" headings.
  const { $table, runnerIdx, winIdx, placeIdx, showIdx } = tables[0];
  return extractOutcomeFromRunnerTable($, $table, {
    runnerIdx,
    winIdx,
    placeIdx,
    showIdx
  });
}

/**
 * Generic fallback parser: look for tables where first column is 1/2/3
 * and second column is the horse name.
 *
 * @param {cheerio.CheerioAPI} $
 * @returns {Outcome}
 */
function parseGenericOutcome($) {
  const rows = [];

  $("table tr").each((_, el) => {
    const $cells = $(el).find("td, th");
    if ($cells.length < 2) return;

    const firstCell = norm($cells.eq(0).text());
    const posMatch =
      firstCell.match(/^(\d+)[a-z]{0,2}$/i) || firstCell.match(/^(\d+)$/);
    if (!posMatch) return;

    const pos = parseInt(posMatch[1], 10);
    if (pos < 1 || pos > 3) return;

    const name = normalizeHorseName($cells.eq(1).text());
    if (!name) return;

    rows.push({ pos, name });
  });

  const byPos = new Map();
  rows.forEach(({ pos, name }) => {
    if (!byPos.has(pos)) byPos.set(pos, name);
  });

  return {
    win: byPos.get(1) || "",
    place: byPos.get(2) || "",
    show: byPos.get(3) || ""
  };
}

/**
 * Main entry used by verify_race:
 * fetch the targetUrl and parse Win/Place/Show.
 *
 * @param {string} targetUrl
 * @param {{ raceNo?: string|number|null }} [options]
 * @returns {Promise<Outcome>}
 */
export async function fetchAndParseResults(targetUrl, options = {}) {
  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (FinishLineVerifyBot/1.0)"
    }
  });

  if (!res.ok) {
    throw new Error(
      `fetchAndParseResults: ${res.status} ${res.statusText} for ${targetUrl}`
    );
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const isHrn =
    /horseracingnation\.com/i.test(targetUrl) ||
    /entries-results/i.test(targetUrl);

  if (isHrn) {
    const hrnOutcome = parseHrnWps($, options);
    if (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show) {
      return hrnOutcome;
    }
  }

  // Fallback for non-HRN pages
  return parseGenericOutcome($);
}
