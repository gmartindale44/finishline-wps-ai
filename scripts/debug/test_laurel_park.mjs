#!/usr/bin/env node
/**
 * Test HRN parser for Laurel Park 2025-11-30 Race 1 to ensure no regression
 */

// Copy the parser functions (same as test_hrn_parser.mjs)
function splitHrnHtmlIntoRaceBlocks(html) {
  const blocks = [];
  if (!html || typeof html !== "string") return blocks;
  try {
    const tablePattern = /<table[^>]*table-payouts[^>]*>/gi;
    const tableMatches = [];
    let match;
    while ((match = tablePattern.exec(html)) !== null) {
      tableMatches.push({ index: match.index, fullMatch: match[0] });
    }
    for (let i = 0; i < tableMatches.length; i++) {
      const tableStart = tableMatches[i].index;
      const beforeTable = html.substring(Math.max(0, tableStart - 15000), tableStart);
      const racePattern = /Race\s+(\d+)/gi;
      const raceMatches = [];
      let raceMatch;
      while ((raceMatch = racePattern.exec(beforeTable)) !== null) {
        raceMatches.push({
          raceNo: raceMatch[1],
          index: raceMatch.index,
          distance: beforeTable.length - raceMatch.index
        });
      }
      if (raceMatches.length > 0) {
        const closestRace = raceMatches[raceMatches.length - 1];
        blocks.push({
          raceNo: closestRace.raceNo,
          tableIndex: i,
          tableStart: tableStart
        });
      } else {
        if (tableMatches.length > 1) {
          blocks.push({
            raceNo: String(i + 1),
            tableIndex: i,
            tableStart: tableStart
          });
        }
      }
    }
  } catch (err) {
    return [];
  }
  return blocks;
}

function extractOutcomeFromHrnHtml(html, raceNo = null) {
  const outcome = { win: "", place: "", show: "" };
  if (!html || typeof html !== "string") return outcome;
  try {
    let targetHtml = html;
    if (raceNo !== null && raceNo !== undefined) {
      const raceNoStr = String(raceNo || "").trim();
      if (raceNoStr) {
        const blocks = splitHrnHtmlIntoRaceBlocks(html);
        const matchingBlock = blocks.find(b => String(b.raceNo) === raceNoStr);
        if (matchingBlock) {
          const tablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<\/table>/gi;
          const allTables = [];
          let tableMatch;
          while ((tableMatch = tablePattern.exec(html)) !== null) {
            allTables.push({ index: tableMatch.index, html: tableMatch[0] });
          }
          if (allTables[matchingBlock.tableIndex]) {
            targetHtml = allTables[matchingBlock.tableIndex].html;
          }
        }
      }
    }
    const decodeEntity = (str) => {
      if (!str) return "";
      return str.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
    };
    const isValid = (name) => {
      if (!name || name.length === 0) return false;
      if (name.length > 50) return false;
      if (!/[A-Za-z]/.test(name)) return false;
      if (name.includes("<") || name.includes(">") || name.includes("function")) return false;
      if (/^\d+$/.test(name)) return false;
      if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) return false;
      return true;
    };
    const payoutTablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/gi;
    let tableMatch;
    while ((tableMatch = payoutTablePattern.exec(targetHtml)) !== null) {
      const tbody = tableMatch[1];
      const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = [];
      let trMatch;
      while ((trMatch = trPattern.exec(tbody)) !== null && rows.length < 5) {
        const rowHtml = trMatch[1];
        const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let tdMatch;
        while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
          const cellContent = tdMatch[1]
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .trim();
          cells.push(cellContent);
        }
        if (cells.length >= 5) {
          const horseNameRaw = cells[0];
          const horseName = horseNameRaw.replace(/\s*\([^)]+\)\s*$/, "").trim();
          const winPayout = cells[2] || "";
          const placePayout = cells[3] || "";
          const showPayout = cells[4] || "";
          if (isValid(horseName)) {
            rows.push({ horseName, winPayout, placePayout, showPayout });
          }
        }
      }
      if (rows.length >= 1 && rows[0].winPayout && rows[0].winPayout !== "-" && rows[0].winPayout && !outcome.win) {
        outcome.win = rows[0].horseName;
      }
      if (rows.length >= 2 && !outcome.place) {
        outcome.place = rows[1].horseName;
      }
      if (rows.length >= 3 && !outcome.show) {
        outcome.show = rows[2].horseName;
      }
      if (outcome.win && outcome.place && outcome.show) {
        break;
      }
    }
    if (!isValid(outcome.win)) outcome.win = "";
    if (!isValid(outcome.place)) outcome.place = "";
    if (!isValid(outcome.show)) outcome.show = "";
  } catch (err) {
    return { win: "", place: "", show: "" };
  }
  return outcome;
}

const hrnUrl = "https://entries.horseracingnation.com/entries-results/laurel-park/2025-11-30";
console.log(`Testing HRN parser for Laurel Park 2025-11-30 Race 1\n`);

const res = await fetch(hrnUrl, {
  method: "GET",
  headers: {
    "User-Agent": "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const html = await res.text();
const outcome = extractOutcomeFromHrnHtml(html, "1");
console.log("Result:", JSON.stringify(outcome, null, 2));
console.log(`Expected: win="Oleg", place="World On Fire", show="D Hopper"\n`);

