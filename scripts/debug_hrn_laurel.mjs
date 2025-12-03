#!/usr/bin/env node
/**
 * Test HRN parser against real Laurel Park page
 */

// Import the extract function from verify_race.js
// Since it's a module, we'll copy the logic here for testing

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
    
    // Pattern 1: Table rows with finish positions
    const tableRowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>\s*(\d+)\s*<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>/gi;
    const finishMap = {};
    
    let match;
    while ((match = tableRowPattern.exec(html)) !== null) {
      const position = parseInt(match[1], 10);
      const horseName = decodeEntity(match[2]);
      
      if (position >= 1 && position <= 3 && isValid(horseName)) {
        if (position === 1 && !finishMap[1]) finishMap[1] = horseName;
        if (position === 2 && !finishMap[2]) finishMap[2] = horseName;
        if (position === 3 && !finishMap[3]) finishMap[3] = horseName;
      }
    }
    
    if (finishMap[1]) outcome.win = finishMap[1];
    if (finishMap[2]) outcome.place = finishMap[2];
    if (finishMap[3]) outcome.show = finishMap[3];
    
    // Pattern 2: Look for Finish column in tables
    if (!outcome.win || !outcome.place || !outcome.show) {
      const tableSectionMatch = html.match(/<table[^>]*>[\s\S]{0,5000}?<\/table>/i);
      if (tableSectionMatch) {
        const tableHtml = tableSectionMatch[0];
        const finishRowPattern = /<tr[^>]*>[\s\S]*?(?:finish|pos|position)[^>]*>\s*(\d+)\s*[^<]*<[\s\S]*?<td[^>]*>([^<]+)<\/td>/gi;
        const finishMap2 = {};
        
        let match2;
        while ((match2 = finishRowPattern.exec(tableHtml)) !== null) {
          const position = parseInt(match2[1], 10);
          const horseName = decodeEntity(match2[2]);
          
          if (position >= 1 && position <= 3 && isValid(horseName)) {
            if (position === 1 && !finishMap2[1]) finishMap2[1] = horseName;
            if (position === 2 && !finishMap2[2]) finishMap2[2] = horseName;
            if (position === 3 && !finishMap2[3]) finishMap2[3] = horseName;
          }
        }
        
        if (!outcome.win && finishMap2[1]) outcome.win = finishMap2[1];
        if (!outcome.place && finishMap2[2]) outcome.place = finishMap2[2];
        if (!outcome.show && finishMap2[3]) outcome.show = finishMap2[3];
      }
    }
    
    // Pattern 3: Win/Place/Show text patterns
    if (!outcome.win || !outcome.place || !outcome.show) {
      const payoutSection = html.match(/(?:payout|results|finish)[\s\S]{0,2000}?(?:win|place|show)[\s\S]{0,2000}?/i);
      if (payoutSection) {
        const section = payoutSection[0];
        const winMatch = section.match(/win[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/)/i);
        const placeMatch = section.match(/place[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/)/i);
        const showMatch = section.match(/show[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/)/i);
        
        if (winMatch && winMatch[1] && !outcome.win && isValid(winMatch[1].trim())) {
          outcome.win = decodeEntity(winMatch[1].trim());
        }
        if (placeMatch && placeMatch[1] && !outcome.place && isValid(placeMatch[1].trim())) {
          outcome.place = decodeEntity(placeMatch[1].trim());
        }
        if (showMatch && showMatch[1] && !outcome.show && isValid(showMatch[1].trim())) {
          outcome.show = decodeEntity(showMatch[1].trim());
        }
      }
    }
    
    if (!isValid(outcome.win)) outcome.win = "";
    if (!isValid(outcome.place)) outcome.place = "";
    if (!isValid(outcome.show)) outcome.show = "";
    
  } catch (err) {
    console.error("Parse error:", err);
  }
  
  return outcome;
}

const hrnUrl = "https://entries.horseracingnation.com/entries-results/laurel-park/2025-11-30";

console.log(`Fetching HRN page: ${hrnUrl}\n`);

try {
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

  // Look for finish positions in the HTML
  console.log("=== Searching for finish positions ===\n");
  const finishMatches = html.match(/finish[^>]*>\s*[123]\s*</gi);
  if (finishMatches) {
    console.log(`Found ${finishMatches.length} finish position references`);
    finishMatches.slice(0, 5).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.substring(0, 100)}`);
    });
  }

  // Look for table rows
  const tableRowMatches = html.match(/<tr[^>]*>[\s\S]{0,500}?<\/tr>/gi);
  if (tableRowMatches) {
    console.log(`\nFound ${tableRowMatches.length} table rows`);
    // Look for rows with finish 1, 2, 3
    const finishRows = tableRowMatches.filter(row => /finish[^>]*>\s*[123]\s*</i.test(row));
    console.log(`Found ${finishRows.length} rows with finish 1, 2, or 3`);
    finishRows.slice(0, 3).forEach((row, i) => {
      console.log(`\nRow ${i + 1}:`);
      console.log(row.substring(0, 300));
    });
  }

  // Test the parser
  console.log("\n=== Testing parser ===\n");
  const result = extractOutcomeFromHrnHtml(html);
  console.log("Parser result:");
  console.log(JSON.stringify(result, null, 2));

  if (result.win && result.place && result.show) {
    console.log("\n✅ Successfully parsed all three!");
  } else {
    console.log("\n⚠️ Missing some results");
    if (!result.win) console.log("  Missing: win");
    if (!result.place) console.log("  Missing: place");
    if (!result.show) console.log("  Missing: show");
  }

} catch (err) {
  console.error("Error:", err);
  process.exit(1);
}

