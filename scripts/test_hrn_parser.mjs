#!/usr/bin/env node
/**
 * Test the updated HRN parser
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

// Copy the exact parser logic from verify_race.js
function extractOutcomeFromHrnHtml(html) {
  const outcome = { win: "", place: "", show: "" };
  
  if (!html || typeof html !== "string") {
    return outcome;
  }

  try {
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
    
    const isValid = (name) => {
      if (!name || name.length === 0) return false;
      if (name.length > 50) return false;
      if (!/[A-Za-z]/.test(name)) return false;
      if (name.includes("<") || name.includes(">") || name.includes("function")) return false;
      if (/^\d+$/.test(name)) return false;
      if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) return false;
      return true;
    };
    
    // Pattern 1: Look for table-payouts tables
    const payoutTablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/gi;
    let tableMatch;
    while ((tableMatch = payoutTablePattern.exec(html)) !== null) {
      const tbody = tableMatch[1];
      
      const rowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>([^<]+(?:\([^)]+\))?)[\s\S]*?<td[^>]*>[\s\S]*?<td[^>]*>([^<]+)[\s\S]*?<td[^>]*>([^<]+)[\s\S]*?<td[^>]*>([^<]+)/gi;
      const rows = [];
      let rowMatch;
      while ((rowMatch = rowPattern.exec(tbody)) !== null && rows.length < 3) {
        const horseNameRaw = decodeEntity(rowMatch[1]);
        const horseName = horseNameRaw.replace(/\s*\([^)]+\)\s*$/, "").trim();
        const winPayout = rowMatch[2].trim();
        const placePayout = rowMatch[3].trim();
        const showPayout = rowMatch[4].trim();
        
        if (isValid(horseName)) {
          rows.push({ horseName, winPayout, placePayout, showPayout });
        }
      }
      
      if (rows.length >= 1 && rows[0].winPayout && rows[0].winPayout !== "-" && !outcome.win) {
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
    
  } catch (err) {
    console.error("Parse error:", err);
  }
  
  return outcome;
}

const result = extractOutcomeFromHrnHtml(html);
console.log("Parser result:");
console.log(JSON.stringify(result, null, 2));

if (result.win === "Oleg" && result.place === "World On Fire" && result.show === "D Hopper") {
  console.log("\n✅ SUCCESS! All three horses matched!");
} else {
  console.log("\n⚠️ Results don't match expected:");
  console.log(`  Expected: win="Oleg", place="World On Fire", show="D Hopper"`);
  console.log(`  Got: win="${result.win}", place="${result.place}", show="${result.show}"`);
}

