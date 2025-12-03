#!/usr/bin/env node
/**
 * Analyze HRN HTML structure to find how races are separated
 */

const fs = await import("fs");
const html = fs.readFileSync("data/debug/hrn_zia_2025-12-02.html", "utf8");

// Find all occurrences of "Race 1", "Race 2", etc. and their context
console.log("=== Finding race markers ===\n");

const raceMarkers = [];
const racePattern = /Race\s+(\d+)/gi;
let match;
while ((match = racePattern.exec(html)) !== null) {
  const context = html.substring(
    Math.max(0, match.index - 200),
    Math.min(html.length, match.index + 500)
  );
  raceMarkers.push({
    raceNo: match[1],
    index: match.index,
    context: context.replace(/\s+/g, " ").substring(0, 400)
  });
}

console.log(`Found ${raceMarkers.length} race markers:\n`);
raceMarkers.slice(0, 10).forEach((m, i) => {
  console.log(`${i + 1}. Race ${m.raceNo} at position ${m.index}:`);
  console.log(`   ${m.context}\n`);
});

// Find all table-payouts and see what's before them
console.log("\n=== Finding payout tables and their preceding context ===\n");

const tablePattern = /<table[^>]*table-payouts[^>]*>/gi;
let tableIndex = 0;
while ((match = tablePattern.exec(html)) !== null) {
  tableIndex++;
  const tableStart = match.index;
  
  // Look back up to 2000 chars for race number
  const beforeTable = html.substring(Math.max(0, tableStart - 2000), tableStart);
  
  // Find the closest "Race N" before this table
  const raceMatches = beforeTable.match(/Race\s+(\d+)/gi);
  const lastRaceMatch = raceMatches ? raceMatches[raceMatches.length - 1] : null;
  const raceNo = lastRaceMatch ? lastRaceMatch.match(/\d+/)[0] : "unknown";
  
  // Extract a snippet showing the structure
  const snippet = beforeTable.substring(Math.max(0, beforeTable.length - 500));
  
  console.log(`Table ${tableIndex}:`);
  console.log(`  Position: ${tableStart}`);
  console.log(`  Closest race marker: ${raceNo}`);
  console.log(`  Context before table:`);
  console.log(`    ${snippet.replace(/\s+/g, " ").substring(0, 300)}...\n`);
  
  // Extract first horse from this table
  const tableEnd = html.indexOf("</table>", tableStart);
  const tableHtml = html.substring(tableStart, tableEnd + 8);
  const firstHorseMatch = tableHtml.match(/<td[^>]*>([^<]+(?:\([^)]+\))?)[\s\S]*?<td[^>]*>[\s\S]*?<td[^>]*>([^<]+)/i);
  if (firstHorseMatch) {
    const horseName = firstHorseMatch[1].trim().replace(/\s*\([^)]+\)\s*$/, "");
    console.log(`  First horse: ${horseName}\n`);
  }
}

