#!/usr/bin/env node
/**
 * Find the finish order/results section in HRN HTML
 */

const fs = await import("fs");
const html = fs.readFileSync("tmp_hrn_full.html", "utf8");

// Look for sections that might contain finish results
console.log("=== Searching for finish/results sections ===\n");

// Pattern 1: Look for "Finish" headers or columns
const finishHeaders = html.match(/<th[^>]*>.*finish.*<\/th>/gi);
if (finishHeaders) {
  console.log("Found finish headers:");
  finishHeaders.forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.substring(0, 200)}`);
  });
}

// Pattern 2: Look for tables with "Finish" in them
const finishTables = html.match(/<table[^>]*>[\s\S]{0,5000}?finish[\s\S]{0,5000}?<\/table>/gi);
if (finishTables) {
  console.log(`\nFound ${finishTables.length} tables containing 'finish'`);
  finishTables.forEach((table, i) => {
    console.log(`\nTable ${i + 1} (first 1000 chars):`);
    console.log(table.substring(0, 1000));
    
    // Check if it contains our horses
    if (table.includes("Oleg") || table.includes("World On Fire") || table.includes("D Hopper")) {
      console.log("\n*** This table contains our horses! ***");
      // Save it
      fs.writeFileSync(`tmp_finish_table_${i}.html`, table);
      console.log(`Saved to tmp_finish_table_${i}.html`);
    }
  });
}

// Pattern 3: Look for "Win", "Place", "Show" text
const winPlaceShow = html.match(/(?:win|place|show)[\s\S]{0,500}?/gi);
if (winPlaceShow) {
  console.log(`\nFound ${winPlaceShow.length} 'win/place/show' references`);
  winPlaceShow.slice(0, 10).forEach((ref, i) => {
    console.log(`  ${i + 1}. ${ref.substring(0, 150)}`);
  });
}

// Pattern 4: Look for the actual finish positions (1, 2, 3) near horse names
console.log("\n=== Looking for finish positions near horse names ===\n");
const olegContext = html.substring(html.indexOf("Oleg") - 500, html.indexOf("Oleg") + 500);
console.log("Context around 'Oleg':");
console.log(olegContext);

// Look for a results section that shows finish order
const resultsSection = html.match(/results?[\s\S]{0,10000}?/i);
if (resultsSection) {
  console.log("\n=== Results section (first 2000 chars) ===");
  console.log(resultsSection[0].substring(0, 2000));
}

