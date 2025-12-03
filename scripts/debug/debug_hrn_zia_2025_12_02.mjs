#!/usr/bin/env node
/**
 * Debug script to analyze HRN HTML structure for Zia Park 2025-12-02
 * Specifically for Race 2 parsing
 */

// Fetch the HRN page
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

// Find all table-payouts tables
const tablePattern = /<table[^>]*table-payouts[^>]*>/gi;
const tableMatches = [];
let match;
while ((match = tablePattern.exec(html)) !== null) {
  tableMatches.push({ index: match.index });
}

console.log(`Found ${tableMatches.length} table-payouts tables\n`);

// For each table, look backwards for "Race N" markers
for (let i = 0; i < tableMatches.length; i++) {
  const tableStart = tableMatches[i].index;
  const beforeTable = html.substring(Math.max(0, tableStart - 10000), tableStart);
  
  console.log(`=== Table ${i + 1} (at position ${tableStart}) ===\n`);
  
  // Look for "Race N" patterns
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
  
  console.log(`Found ${raceMatches.length} "Race N" markers before this table:`);
  raceMatches.forEach((rm, idx) => {
    const excerpt = beforeTable.substring(Math.max(0, rm.index - 150), Math.min(beforeTable.length, rm.index + 200));
    console.log(`  ${idx + 1}. Race ${rm.raceNo} at distance ${rm.distance} chars`);
    console.log(`     Excerpt: ${excerpt.replace(/\s+/g, " ").substring(0, 300)}\n`);
  });
  
  // Also look for any headings or other markers
  const headingPattern = /<h[1-6][^>]*>[\s\S]*?Race\s+(\d+)[\s\S]*?<\/h[1-6]>/gi;
  const headings = [];
  let headingMatch;
  while ((headingMatch = headingPattern.exec(beforeTable)) !== null) {
    headings.push({
      raceNo: headingMatch[1],
      fullMatch: headingMatch[0].substring(0, 200)
    });
  }
  
  if (headings.length > 0) {
    console.log(`Found ${headings.length} heading matches:`);
    headings.forEach((h, idx) => {
      console.log(`  ${idx + 1}. Race ${h.raceNo}: ${h.fullMatch}\n`);
    });
  }
  
  // Extract the actual table HTML
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableEnd > tableStart) {
    const tableHtml = html.substring(tableStart, tableEnd + 8);
    const tbodyMatch = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
    if (tbodyMatch) {
      const tbody = tbodyMatch[1];
      console.log(`Table ${i + 1} tbody (first 1000 chars):\n${tbody.substring(0, 1000)}\n`);
      
      // Try to extract first few rows
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const rows = [];
      let rowMatch;
      while ((rowMatch = rowPattern.exec(tbody)) !== null && rows.length < 3) {
        const rowHtml = rowMatch[1];
        // Extract all TDs
        const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let tdMatch;
        while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
          const cellContent = tdMatch[1].replace(/<[^>]+>/g, "").trim();
          cells.push(cellContent);
        }
        rows.push({ cells });
      }
      
      console.log(`First ${rows.length} rows:`);
      rows.forEach((row, idx) => {
        console.log(`  Row ${idx + 1}: ${JSON.stringify(row.cells)}\n`);
      });
    }
  }
  
  console.log("\n");
}
