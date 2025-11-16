// lib/results.js
// JS mirror of results.ts so Vercel can load it (Node cannot import .ts files in this environment)

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

    // Narrow HTML to the requested race, if we have a raceNo
    let scopeHtml = html;
    const raceNo = options.raceNo;
    if (raceNo != null && raceNo !== "") {
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
          return lower !== "win" && lower !== "place" && lower !== "show";
        });

      if (filtered.length >= 3) {
        outcome.win = outcome.win || filtered[0];
        outcome.place = outcome.place || filtered[1];
        outcome.show = outcome.show || filtered[2];
      }
    };

    // 1) Try “Finish Order” table (scoped to race)
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
