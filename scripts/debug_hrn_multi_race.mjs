#!/usr/bin/env node
/**
 * Debug script to inspect HRN HTML structure for multiple races
 */

const hrnUrl = "https://entries.horseracingnation.com/entries-results/zia-park/2025-12-02";

console.log(`Fetching HRN page: ${hrnUrl}\n`);

const res = await fetch(hrnUrl, {
  method: "GET",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${res.statusText}`);
  process.exit(1);
}

const html = await res.text();
console.log(`Fetched ${html.length} bytes of HTML\n`);

// Save full HTML
const fs = await import("fs");
const debugDir = "data/debug";
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}
fs.writeFileSync(`${debugDir}/hrn_zia_2025-12-02.html`, html);
console.log(`Saved full HTML to ${debugDir}/hrn_zia_2025-12-02.html\n`);

// Look for race headings/separators
console.log("=== Searching for race patterns ===\n");

// Pattern 1: Look for headings with "Race 1", "Race 2", etc.
const raceHeadingPattern = /<h[1-6][^>]*>[\s\S]*?Race\s+(\d+)[\s\S]*?<\/h[1-6]>/gi;
const raceHeadings = [];
let match;
while ((match = raceHeadingPattern.exec(html)) !== null) {
  raceHeadings.push({ raceNo: match[1], fullMatch: match[0].substring(0, 200) });
}
console.log(`Found ${raceHeadings.length} race headings:`);
raceHeadings.forEach((h, i) => {
  console.log(`  ${i + 1}. Race ${h.raceNo}: ${h.fullMatch}`);
});

// Pattern 2: Look for sections with race numbers
const raceSectionPattern = /(?:Race\s+(\d+)|<[^>]*data-race=["'](\d+)["'][^>]*>)/gi;
const raceSections = [];
let match2;
while ((match2 = raceSectionPattern.exec(html)) !== null) {
  const raceNo = match2[1] || match2[2];
  if (raceNo) {
    raceSections.push({ raceNo, context: html.substring(Math.max(0, match2.index - 50), Math.min(html.length, match2.index + 200)) });
  }
}
console.log(`\nFound ${raceSections.length} race number references`);

// Pattern 3: Count table-payouts tables
const payoutTables = html.match(/<table[^>]*table-payouts[^>]*>/gi);
console.log(`\nFound ${payoutTables ? payoutTables.length : 0} table-payouts tables`);

// Pattern 4: Look for structure around each payout table
console.log("\n=== Analyzing payout table context ===\n");
const tablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]{0,5000}?<\/table>/gi;
let tableIndex = 0;
while ((match = tablePattern.exec(html)) !== null) {
  tableIndex++;
  const tableHtml = match[0];
  
  // Look backwards for race number
  const beforeTable = html.substring(Math.max(0, match.index - 1000), match.index);
  const raceMatch = beforeTable.match(/Race\s+(\d+)/i);
  const raceNo = raceMatch ? raceMatch[1] : "unknown";
  
  // Extract first horse name from this table
  const firstHorseMatch = tableHtml.match(/<td[^>]*>([^<]+(?:\([^)]+\))?)[\s\S]*?<td[^>]*>[\s\S]*?<td[^>]*>([^<]+)/i);
  const firstHorse = firstHorseMatch ? firstHorseMatch[1].trim() : "unknown";
  
  console.log(`Table ${tableIndex}:`);
  console.log(`  Race: ${raceNo}`);
  console.log(`  First horse: ${firstHorse.substring(0, 50)}`);
  console.log(`  Table size: ${tableHtml.length} bytes\n`);
}

// Pattern 5: Look for div/section wrappers that might contain race blocks
const raceBlockPattern = /<div[^>]*>[\s\S]{0,200}?Race\s+(\d+)[\s\S]{0,5000}?<table[^>]*table-payouts/gi;
const raceBlocks = [];
while ((match = raceBlockPattern.exec(html)) !== null) {
  raceBlocks.push({ raceNo: match[1], startIndex: match.index });
}
console.log(`\nFound ${raceBlocks.length} potential race blocks with payout tables`);

