#!/usr/bin/env node
/**
 * Inspect HRN HTML structure to understand how results are displayed
 */

const hrnUrl = "https://entries.horseracingnation.com/entries-results/laurel-park/2025-11-30";

const res = await fetch(hrnUrl, {
  method: "GET",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const html = await res.text();

// Save full HTML
const fs = await import("fs");
fs.writeFileSync("tmp_hrn_full.html", html);
console.log(`Saved full HTML (${html.length} bytes) to tmp_hrn_full.html\n`);

// Look for "Oleg", "World On Fire", "D Hopper" in the HTML
console.log("=== Searching for expected horse names ===\n");
const horses = ["Oleg", "World On Fire", "D Hopper"];
for (const horse of horses) {
  const index = html.indexOf(horse);
  if (index !== -1) {
    const context = html.substring(Math.max(0, index - 200), Math.min(html.length, index + 200));
    console.log(`Found "${horse}" at position ${index}:`);
    console.log(context.replace(/\s+/g, " ").substring(0, 300));
    console.log("\n");
  } else {
    console.log(`"${horse}" NOT FOUND in HTML\n`);
  }
}

// Look for finish positions
console.log("=== Searching for finish patterns ===\n");
const finish1 = html.indexOf("Finish");
if (finish1 !== -1) {
  const context = html.substring(finish1, finish1 + 2000);
  console.log("Context around 'Finish':");
  console.log(context.substring(0, 1000));
}

// Look for table structures
console.log("\n=== Looking for results tables ===\n");
const tableMatches = html.match(/<table[^>]*>[\s\S]{0,3000}?<\/table>/gi);
if (tableMatches) {
  console.log(`Found ${tableMatches.length} tables`);
  // Look for tables that might contain results
  for (let i = 0; i < Math.min(5, tableMatches.length); i++) {
    const table = tableMatches[i];
    if (table.includes("Oleg") || table.includes("World") || table.includes("D Hopper")) {
      console.log(`\nTable ${i + 1} contains horse names:`);
      console.log(table.substring(0, 2000));
      break;
    }
  }
}

