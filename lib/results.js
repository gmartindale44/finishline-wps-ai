// lib/results.js

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
 * @returns {Promise<ParsedOutcome>}
 */
export async function fetchAndParseResults(url) {
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

    const trySetFromList = (names) => {
      const filtered = names.map(cleanName).filter(Boolean);
      if (filtered.length >= 3) {
        outcome.win = outcome.win || filtered[0];
        outcome.place = outcome.place || filtered[1];
        outcome.show = outcome.show || filtered[2];
      }
    };

    // 1) Try “Finish Order” table
    const finishMatch = html.match(/Finish\s+Order[\s\S]{0,2000}?<\/table>/i);
    if (finishMatch) {
      const block = finishMatch[0];
      const names = Array.from(
        block.matchAll(/>([A-Za-z0-9' .\-]+)</g)
      ).map((m) => m[1]);
      trySetFromList(names);
    }

    // 2) Try explicit Win / Place / Show labels
    if (!outcome.win) {
      const hrn = html.match(
        /Win[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Place[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)[\s\S]{0,400}?Show[^A-Za-z0-9]{1,10}([A-Za-z0-9' .\-]+)/i
      );
      if (hrn) {
        trySetFromList([hrn[1], hrn[2], hrn[3]]);
      }
    }

    // 3) Fallback: 1st / 2nd / 3rd labels
    if (!outcome.win) {
      const fallback = html.match(
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


