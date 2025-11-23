// scripts/fetch-hrn-aqueduct-r1.js
// Fetch actual HRN HTML for Aqueduct R1 to inspect structure

const url = "https://entries.horseracingnation.com/entries-results/aqueduct/2025-11-21";

async function fetchAndInspect() {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      console.error(`Failed to fetch: ${res.status} ${res.statusText}`);
      return;
    }

    const html = await res.text();
    
    // Find Race 1 section
    const race1Match = html.match(/Race\s*1[^]*?(?=Race\s*2|$)/i);
    if (race1Match) {
      const race1Html = race1Match[0];
      
      // Find tables with Runner and Win/Place/Show
      const tableMatches = race1Html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/gi);
      
      console.log("Found tables in Race 1 section:\n");
      let tableNum = 0;
      for (const match of tableMatches) {
        tableNum++;
        const table = match[0];
        
        // Extract header row
        const headerMatch = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/i);
        if (headerMatch) {
          const headers = Array.from(
            headerMatch[0].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)
          ).map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
          
          if (headers.some(h => h.toLowerCase().includes("runner")) && 
              headers.some(h => h.toLowerCase() === "win")) {
            console.log(`\n=== Table ${tableNum} (Runner + Win/Place/Show) ===`);
            console.log("Headers:", headers);
            
            // Extract first few data rows
            const rowMatches = Array.from(table.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)).slice(1, 4);
            rowMatches.forEach((rowMatch, idx) => {
              const cells = Array.from(
                rowMatch[0].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)
              ).map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
              console.log(`Row ${idx + 1}:`, cells.slice(0, 6)); // First 6 cells
            });
          }
        }
      }
      
      // Save full HTML for inspection
      const fs = await import("fs");
      fs.writeFileSync("temp-aqueduct-r1.html", race1Html);
      console.log("\n\nFull Race 1 HTML saved to temp-aqueduct-r1.html");
    } else {
      console.log("Race 1 section not found in HTML");
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

fetchAndInspect();

