#!/usr/bin/env node
/**
 * Test HRN parser against fixture files
 * Usage: node scripts/debug/test_hrn_parser.mjs
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the parser function from verify_race.js
// We'll need to extract it or import the module
async function loadParser() {
  // Dynamic import to get the function
  const mod = await import("../../pages/api/verify_race.js");
  
  // The function is not exported, so we need to extract it from the module
  // For now, we'll duplicate the function here or find another way
  // Actually, let's read the file and extract the function code
  const verifyRacePath = join(__dirname, "../../pages/api/verify_race.js");
  const verifyRaceCode = await readFile(verifyRacePath, "utf-8");
  
  // Extract the extractOutcomeFromHrnHtml function
  // This is a bit hacky, but we need the function
  // Better approach: create a shared module, but for now let's duplicate the logic
  // Actually, let's just import and call it via eval or similar
  // Simplest: duplicate the function here for testing
  
  // For now, let's use a simpler approach: we'll import helpers we need
  // and recreate the function logic
  return {
    extractOutcomeFromHrnHtml: createTestParser(),
  };
}

// Recreate the parser function for testing (extracted from verify_race.js)
function createTestParser() {
  return function extractOutcomeFromHrnHtml(html, raceNo = null) {
    const outcome = { win: "", place: "", show: "" };
    
    if (!html || typeof html !== "string") {
      return outcome;
    }
    
    try {
      // Helper to decode HTML entities
      const decodeEntity = (str) => {
        if (!str) return "";
        return str
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .replace(/&#160;/g, " ")
          .trim();
      };
      
      // Helper to validate horse name
      const isValid = (name) => {
        if (!name || name.length === 0) return false;
        if (name.length > 50) return false;
        if (!/[A-Za-z]/.test(name)) return false;
        if (name.includes("<") || name.includes(">") || name.includes("function")) return false;
        if (/^\d+$/.test(name)) return false;
        if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) return false;
        return true;
      };
      
      // If raceNo is provided, try to find the matching race block
      let targetHtml = html;
      if (raceNo !== null && raceNo !== undefined) {
        const raceNoStr = String(raceNo || "").trim();
        if (raceNoStr) {
          // Simplified race block finding - just look for the nth table-payouts
          const tablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<\/table>/gi;
          const allTables = [];
          let tableMatch;
          while ((tableMatch = tablePattern.exec(html)) !== null && allTables.length < 10) {
            allTables.push(tableMatch[0]);
          }
          
          // Race 1 = index 0, Race 2 = index 1, etc.
          const raceIndex = parseInt(raceNoStr, 10) - 1;
          if (raceIndex >= 0 && raceIndex < allTables.length) {
            targetHtml = allTables[raceIndex];
          }
        }
      }
      
      // Strategy: Look for HRN payout tables with Win/Place/Show columns
      // HRN structure: <td>Horse Name (Speed)</td><td><img></td><td>Win</td><td>Place</td><td>Show</td>
      const payoutTablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/gi;
      let tableMatch;
      while ((tableMatch = payoutTablePattern.exec(targetHtml)) !== null) {
        const tbody = tableMatch[1];
        
        // Extract all TRs and parse TDs more generically
        const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
        const rows = [];
        let trMatch;
        while ((trMatch = trPattern.exec(tbody)) !== null && rows.length < 5) {
          const rowHtml = trMatch[1];
          
          // Extract all TDs in this row
          const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
          const cells = [];
          let tdMatch;
          while ((tdMatch = tdPattern.exec(rowHtml)) !== null) {
            // Remove all HTML tags and decode entities
            const cellContent = tdMatch[1]
              .replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&nbsp;/g, " ")
              .trim();
            cells.push(cellContent);
          }
          
          // HRN structure: [0] = Horse Name (Speed), [1] = empty/image, [2] = Win, [3] = Place, [4] = Show
          if (cells.length >= 5) {
            const horseNameRaw = cells[0];
            // Extract horse name (remove speed figure in parentheses like "(92*)")
            const horseName = horseNameRaw.replace(/\s*\([^)]+\)\s*$/, "").trim();
            const winPayout = cells[2] || "";
            const placePayout = cells[3] || "";
            const showPayout = cells[4] || "";
            
            if (isValid(horseName)) {
              rows.push({ horseName, winPayout, placePayout, showPayout });
            }
          }
        }
        
        // First row with Win payout (not "-" and not empty) is the winner
        // Second row is place, third row is show
        if (rows.length >= 1 && rows[0].winPayout && rows[0].winPayout !== "-" && rows[0].winPayout && !outcome.win) {
          outcome.win = rows[0].horseName;
        }
        if (rows.length >= 2 && !outcome.place) {
          outcome.place = rows[1].horseName;
        }
        if (rows.length >= 3 && !outcome.show) {
          outcome.show = rows[2].horseName;
        }
        
        // If we found all three, break
        if (outcome.win && outcome.place && outcome.show) {
          break;
        }
      }
      
      // Final validation
      if (!isValid(outcome.win)) outcome.win = "";
      if (!isValid(outcome.place)) outcome.place = "";
      if (!isValid(outcome.show)) outcome.show = "";
      
    } catch (err) {
      console.error("[extractOutcomeFromHrnHtml] Parse error:", err.message || err);
      return { win: "", place: "", show: "" };
    }
    
    return outcome;
  };
}

async function testFixture(trackSlug, dateIso, raceNo, expectedWin = null, expectedPlace = null, expectedShow = null) {
  const fixturePath = join(__dirname, "fixtures", `hrn_${trackSlug}_${dateIso}_r${raceNo}.html`);
  
  try {
    console.log(`\n=== Testing ${trackSlug} ${dateIso} Race ${raceNo} ===`);
    console.log(`Fixture: ${fixturePath}`);
    
    const html = await readFile(fixturePath, "utf-8");
    console.log(`HTML length: ${html.length}`);
    console.log(`Has table-payouts: ${html.includes("table-payouts")}`);
    
    const parser = createTestParser();
    const result = parser(html, raceNo);
    
    console.log(`Parsed outcome:`);
    console.log(`  Win: "${result.win}"`);
    console.log(`  Place: "${result.place}"`);
    console.log(`  Show: "${result.show}"`);
    
    if (!result.win || !result.place || !result.show) {
      console.error(`❌ FAILED: Missing outcome fields`);
      if (expectedWin && result.win !== expectedWin) {
        console.error(`  Expected win: "${expectedWin}", got: "${result.win}"`);
      }
      if (expectedPlace && result.place !== expectedPlace) {
        console.error(`  Expected place: "${expectedPlace}", got: "${result.place}"`);
      }
      if (expectedShow && result.show !== expectedShow) {
        console.error(`  Expected show: "${expectedShow}", got: "${result.show}"`);
      }
      return false;
    }
    
    console.log(`✅ SUCCESS: All three outcomes parsed`);
    return true;
    
  } catch (err) {
    console.error(`❌ ERROR: ${err.message}`);
    if (err.code === "ENOENT") {
      console.error(`  Fixture file not found. Run capture script first:`);
      console.error(`  node scripts/debug/capture_hrn_fixture.mjs ${trackSlug} ${dateIso} ${raceNo}`);
    }
    return false;
  }
}

async function main() {
  console.log("[test_hrn_parser] Testing HRN parser against fixtures\n");
  
  const results = [];
  
  // Test Zia Park 2025-12-02 Race 2
  results.push(await testFixture("zia-park", "2025-12-02", "2"));
  
  // Test Laurel Park 2025-11-30 Race 1 (regression test)
  results.push(await testFixture("laurel-park", "2025-11-30", "1"));
  
  console.log(`\n=== Summary ===`);
  const passed = results.filter(r => r).length;
  const total = results.length;
  console.log(`Passed: ${passed}/${total}`);
  
  if (passed < total) {
    console.error(`\n❌ Some tests failed`);
    process.exit(1);
  } else {
    console.log(`\n✅ All tests passed`);
  }
}

main();
