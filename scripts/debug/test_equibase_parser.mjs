#!/usr/bin/env node
/**
 * Test Equibase parser with known races
 */

// Import the parser function (we'll copy it here for testing)
function extractOutcomeFromEquibaseHtml(html) {
  const outcome = { win: "", place: "", show: "" };
  
  if (!html || typeof html !== "string") {
    return outcome;
  }
  
  // Check for bot blocking
  if (html.includes("Incapsula") || html.includes("_Incapsula_Resource") || html.length < 2000) {
    console.log("⚠️  Bot-blocked or too short HTML");
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
    
    // Strategy A: Finishing order table
    const finishTablePattern = /<table[^>]*>[\s\S]*?(?:Finish|Fin|Horse|Pos)[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i;
    const tableMatch = html.match(finishTablePattern);
    
    if (tableMatch) {
      const tbody = tableMatch[1];
      const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const finishMap = {};
      
      let trMatch;
      while ((trMatch = trPattern.exec(tbody)) !== null) {
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
        
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const positionMatch = cell.match(/^(\d+)$/);
          
          if (positionMatch) {
            const position = parseInt(positionMatch[1], 10);
            if (position >= 1 && position <= 3 && !finishMap[position]) {
              for (let j = i + 1; j < Math.min(i + 4, cells.length); j++) {
                const nameCandidate = decodeEntity(cells[j])
                  .replace(/\s*\([^)]+\)\s*$/, "")
                  .trim();
                
                if (isValid(nameCandidate)) {
                  finishMap[position] = nameCandidate;
                  break;
                }
              }
            }
          }
        }
      }
      
      if (finishMap[1]) outcome.win = finishMap[1];
      if (finishMap[2]) outcome.place = finishMap[2];
      if (finishMap[3]) outcome.show = finishMap[3];
    }
    
    // Strategy B: Win/Place/Show text patterns
    if (!outcome.win || !outcome.place || !outcome.show) {
      const winPattern = /(?:Win|Winner|1st)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      const placePattern = /(?:Place|2nd)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      const showPattern = /(?:Show|3rd)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      
      const winMatch = html.match(winPattern);
      const placeMatch = html.match(placePattern);
      const showMatch = html.match(showPattern);
      
      if (winMatch && winMatch[1] && !outcome.win) {
        const name = decodeEntity(winMatch[1].trim());
        if (isValid(name)) outcome.win = name;
      }
      
      if (placeMatch && placeMatch[1] && !outcome.place) {
        const name = decodeEntity(placeMatch[1].trim());
        if (isValid(name)) outcome.place = name;
      }
      
      if (showMatch && showMatch[1] && !outcome.show) {
        const name = decodeEntity(showMatch[1].trim());
        if (isValid(name)) outcome.show = name;
      }
    }
    
    // Strategy C: Numbered list
    if (!outcome.win || !outcome.place || !outcome.show) {
      const numberedPattern = /(\d+)\.\s*([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/gi;
      const numberedMap = {};
      
      let match;
      while ((match = numberedPattern.exec(html)) !== null) {
        const position = parseInt(match[1], 10);
        if (position >= 1 && position <= 3 && !numberedMap[position]) {
          const name = decodeEntity(match[2].trim());
          if (isValid(name)) numberedMap[position] = name;
        }
      }
      
      if (!outcome.win && numberedMap[1]) outcome.win = numberedMap[1];
      if (!outcome.place && numberedMap[2]) outcome.place = numberedMap[2];
      if (!outcome.show && numberedMap[3]) outcome.show = numberedMap[3];
    }
    
    if (!isValid(outcome.win)) outcome.win = "";
    if (!isValid(outcome.place)) outcome.place = "";
    if (!isValid(outcome.show)) outcome.show = "";
    
  } catch (err) {
    console.error("Parse error:", err.message);
    return { win: "", place: "", show: "" };
  }
  
  return outcome;
}

// Test cases
const testCases = [
  { track: "Parx Racing", date: "2025-12-01", raceNo: "3" },
  { track: "Zia Park", date: "2025-12-02", raceNo: "2" },
];

function buildEquibaseUrl(track, dateIso, raceNo) {
  const trackCodes = {
    "Parx Racing": "PARX",
    "Laurel Park": "LRL",
    "Zia Park": "ZIA",
  };
  
  const trackCode = trackCodes[track];
  if (!trackCode) return null;
  
  const [yyyy, mm, dd] = dateIso.split("-");
  const equibaseDate = `${mm}/${dd}/${yyyy}`;
  const raceNoStr = String(raceNo).trim();
  
  return `https://www.equibase.com/premium/chartEmb.cfm?track=${trackCode}&raceDate=${equibaseDate}&cy=USA&rn=${raceNoStr}`;
}

console.log("Testing Equibase parser...\n");

for (const testCase of testCases) {
  console.log(`=== ${testCase.track} ${testCase.date} Race ${testCase.raceNo} ===`);
  
  const url = buildEquibaseUrl(testCase.track, testCase.date, testCase.raceNo);
  console.log(`URL: ${url}`);
  
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    
    console.log(`Status: ${res.status}`);
    
    if (res.ok) {
      const html = await res.text();
      console.log(`HTML length: ${html.length}`);
      
      const outcome = extractOutcomeFromEquibaseHtml(html);
      console.log(`Outcome:`, outcome);
      console.log(`Success: ${outcome.win && outcome.place && outcome.show ? "✅" : "❌"}\n`);
    } else {
      console.log(`Error: ${res.statusText}\n`);
    }
  } catch (err) {
    console.log(`Error: ${err.message}\n`);
  }
}

