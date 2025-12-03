// pages/api/verify_race.js
// Feature-flagged verify_race handler with ultra-safe stub fallback
// - Default: stub mode (parses Google HTML for Win/Place/Show, always returns 200)
// - Full mode: CSE + HRN + Equibase parsing (enabled via VERIFY_RACE_MODE=full)
// - Always falls back to stub on any error

export const config = {
  runtime: "nodejs",
};

// Upstash Redis client for verify logging
import { Redis } from "@upstash/redis";

const VERIFY_PREFIX = "fl:verify:";

let redisClient = null;
function getRedis() {
  if (!redisClient) {
    try {
      redisClient = Redis.fromEnv();
    } catch (error) {
      console.error("[verify_race] Failed to init Redis client", error);
      redisClient = null;
    }
  }
  return redisClient;
}

/**
 * Build a race ID for verify logs (similar to prediction logs but without postTime)
 * This creates a key that can be used to store/retrieve verify logs
 * The calibration script joins on track|date|raceNo, so the key format doesn't matter
 * but we use a consistent slug format for readability
 */
function buildVerifyRaceId(track, date, raceNo) {
  // Normalize track: lowercase, collapse spaces, replace non-alphanum with '-', remove dup '-'
  const slugTrack = (track || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Normalize date: use YYYY-MM-DD format
  let slugDate = date || "";
  if (!slugDate || !/^\d{4}-\d{2}-\d{2}$/.test(slugDate)) {
    // If date is invalid, use empty string (calibration script will handle it)
    slugDate = "";
  }

  // Normalize race number
  const slugRaceNo = String(raceNo || "").trim() || "0";

  // Build: track-date-unknown-r{raceNo} (using "unknown" for postTime to match prediction pattern)
  const parts = [slugTrack, slugDate, "unknown", `r${slugRaceNo}`].filter(Boolean);
  return parts.join("-");
}

/**
 * Log verify result to Upstash Redis
 * This is best-effort and must not break the user flow
 */
async function logVerifyResult(result) {
  // Log ALL verify responses (including ok:false), so we can analyze coverage and failures.
  // Still keep the ok flag in the payload so calibration or analysis can filter later.
  if (!result) {
    return;
  }

  const redis = getRedis();
  if (!redis) {
    // Redis not available - silently skip (non-breaking)
    return;
  }

  try {
    const { track, date, raceNo } = result;

    // Build raceId for the key
    const raceId = buildVerifyRaceId(track, date, raceNo);

    // Build the log payload matching what calibration script expects
    // The calibration script looks for: track, date (or dateIso or debug.canonicalDateIso), raceNo, outcome
    const logPayload = {
      raceId,
      track: track || "",
      date: date || "",
      dateIso: date || "", // Alias for calibration script compatibility
      raceNo: raceNo || "",
      query: result.query || "",
      top: result.top || null,
      outcome: result.outcome || { win: "", place: "", show: "" },
      predicted: result.predicted || { win: "", place: "", show: "" },
      hits: result.hits || {
        winHit: false,
        placeHit: false,
        showHit: false,
        top3Hit: false,
      },
      summary: result.summary || "",
      ok: result.ok === true, // normalize to boolean
      step: result.step || "",
      debug: {
        ...(result.debug || {}),
        canonicalDateIso: date || "", // For calibration script fallback lookup
      },
      ts: Date.now(),
    };

    const logKey = `${VERIFY_PREFIX}${raceId}`;
    await redis.set(logKey, JSON.stringify(logPayload));
  } catch (err) {
    // IMPORTANT: logging failures must NOT break the user flow
    console.error("[verify-log] Failed to log verify result", err);
  }
}

/**
 * Safely parse the request body. Supports JSON or URL-encoded form data.
 */
function safeParseBody(req) {
  return new Promise((resolve) => {
    try {
      // If Next.js has already parsed JSON, prefer that
      if (req.body && typeof req.body === "object") {
        return resolve(req.body);
      }
    } catch {
      // ignore and fall through to manual parsing
    }
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        // very simple x-www-form-urlencoded parser as a fallback
        const out = {};
        for (const part of raw.split("&")) {
          const [k, v] = part.split("=");
          if (!k) continue;
          out[decodeURIComponent(k)] = decodeURIComponent(v || "");
        }
        resolve(out);
      }
    });
  });
}

/**
 * Build a simple Google search URL for the race.
 */
function buildGoogleSearchUrl({ track, date, raceNo }) {
  const safeTrack = track || "Unknown Track";
  const safeDate = date || "Unknown Date";
  const safeRaceNo = raceNo || "Unknown Race";
  const q = `${safeTrack} Race ${safeRaceNo} ${safeDate} results Win Place Show`;
  const params = new URLSearchParams({ q });
  return {
    query: q,
    url: `https://www.google.com/search?${params.toString()}`,
  };
}

/**
 * Normalize prediction object into a consistent shape
 */
function normalizePrediction(predicted) {
  if (!predicted || typeof predicted !== "object") {
    return { win: "", place: "", show: "" };
  }

  const win = typeof predicted.win === "string" ? predicted.win.trim() : "";
  const place = typeof predicted.place === "string" ? predicted.place.trim() : "";
  const show = typeof predicted.show === "string" ? predicted.show.trim() : "";

  return { win, place, show };
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text) {
  if (!text || typeof text !== "string") return "";

  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Build summary text from outcome, date, step, and query
 * Safe helper that never throws
 * @param {object} params - { date, uiDateRaw, outcome, step, query }
 * @returns {string} - Formatted summary text
 */
function buildSummary({ date, uiDateRaw, outcome, step, query }) {
  try {
    const lines = [];
    
    // UI date line
    if (uiDateRaw && typeof uiDateRaw === "string") {
      lines.push(`UI date: ${uiDateRaw}`);
    }
    
    // Using date line
    if (date && typeof date === "string") {
      lines.push(`Using date: ${date}`);
    }
    
    // Step line
    if (step && typeof step === "string") {
      lines.push(`Step: ${step}`);
    }
    
    // Query line
    if (query && typeof query === "string") {
      lines.push(`Query: ${query}`);
    }
    
    // Outcome section
    lines.push("");
    lines.push("Outcome:");
    
    const win = (outcome && outcome.win && typeof outcome.win === "string") ? outcome.win.trim() : "";
    const place = (outcome && outcome.place && typeof outcome.place === "string") ? outcome.place.trim() : "";
    const show = (outcome && outcome.show && typeof outcome.show === "string") ? outcome.show.trim() : "";
    
    if (win) {
      lines.push(`  Win: ${win}`);
    } else {
      lines.push(`  Win: -`);
    }
    
    if (place) {
      lines.push(`  Place: ${place}`);
    } else {
      lines.push(`  Place: -`);
    }
    
    if (show) {
      lines.push(`  Show: ${show}`);
    } else {
      lines.push(`  Show: -`);
    }
    
    return lines.join("\n");
  } catch (err) {
    console.error("[buildSummary] Error building summary:", err);
    // Return a minimal safe summary
    return `Step: ${step || "unknown"}\nOutcome:\n  Win: -\n  Place: -\n  Show: -`;
  }
}

// ACTIVE handler for /api/verify_race is: pages/api/verify_race.js
const HANDLER_FILE = "pages/api/verify_race.js";
const BACKEND_VERSION = "verify_v4_hrn_equibase";

/**
 * Try Equibase fallback - NO-OP version for stub mode
 * The full verify pipeline has its own real Equibase fallback;
 * this version is just to keep the stub path from erroring.
 * @param {string} track - Track name
 * @param {string} dateIso - ISO date (YYYY-MM-DD)
 * @param {string|number} raceNo - Race number
 * @param {object} baseDebug - Existing debug object
 * @returns {{ outcome: object|null, debugExtras: object }}
 */
async function tryEquibaseFallback(track, dateIso, raceNo, baseDebug = {}) {
  // Stub / no-op implementation for stub mode.
  // The full verify pipeline has its own real Equibase fallback;
  // this version is just to keep the stub path from erroring.
  return {
    outcome: null,
    debugExtras: {
      equibaseAttempted: false,
      equibaseUrl: null,
      equibaseParseError: "Equibase fallback disabled in stub mode",
    },
  };
}

/**
 * Try HRN fallback - attempts to fetch and parse HRN entries-results page
 * @param {string} track - Track name
 * @param {string} dateIso - ISO date (YYYY-MM-DD)
 * @param {object} baseDebug - Existing debug object (may contain googleHtml)
 * @returns {{ outcome: object|null, debugExtras: object }}
 */
async function tryHrnFallback(track, dateIso, raceNo, baseDebug = {}) {
  const debugExtras = {};
  try {
    debugExtras.hrnAttempted = true;
    debugExtras.hrnRaceNo = (raceNo !== null && raceNo !== undefined) ? String(raceNo || "").trim() : null;

    const hrnUrlFromGoogle = baseDebug.googleHtml ? extractHrnUrlFromGoogleHtml(baseDebug.googleHtml) : null;
    const hrnUrl = hrnUrlFromGoogle || buildHrnUrl(track, dateIso);
    debugExtras.hrnUrl = hrnUrl || null;

    if (!hrnUrl) {
      debugExtras.hrnParseError = "No HRN URL available";
      return { outcome: null, debugExtras };
    }

    const res = await fetch(hrnUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!res.ok) {
      debugExtras.hrnParseError = `HTTP ${res.status}`;
      return { outcome: null, debugExtras };
    }

    const html = await res.text();
    
    // TEMPORARY: Deep debug diagnostics for Zia Park 2025-12-02 Race 2
    // This helps diagnose why parsing fails in production but works locally
    const isZiaParkDebugCase = track === "Zia Park" && dateIso === "2025-12-02" && String(raceNo) === "2";
    const hasPayoutTable = typeof html === "string" && html.includes("table-payouts");
    const shouldAddDiagnostics = isZiaParkDebugCase || !hasPayoutTable;
    
    if (shouldAddDiagnostics) {
      debugExtras.hrnHtmlHasPayoutTable = hasPayoutTable;
      debugExtras.hrnHtmlLength = typeof html === "string" ? html.length : null;
      debugExtras.hrnHtmlFingerprint = typeof html === "string"
        ? html.slice(0, 200).replace(/\s+/g, " ").trim()
        : null;
    }
    
    const outcome = extractOutcomeFromHrnHtml(html, raceNo);
    
    if (!outcome || (!outcome.win && !outcome.place && !outcome.show)) {
      debugExtras.hrnParseError = "No outcome parsed from HRN HTML";
      return { outcome: null, debugExtras };
    }

    return { outcome, debugExtras };
  } catch (err) {
    debugExtras.hrnParseError = String(err && err.message ? err.message : err);
    return { outcome: null, debugExtras };
  }
}

/**
 * Extract HRN entries-results URL from Google HTML
 * Also tries to decode Google redirect URLs (/url?q=...)
 * @param {string} html - Google search results HTML
 * @returns {string|null} - First matching HRN URL or null
 */
function extractHrnUrlFromGoogleHtml(html) {
  if (!html || typeof html !== "string") {
    return null;
  }

  // Pattern 1: Direct URLs
  const directPattern = /https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/i;
  const directMatch = html.match(directPattern);
  if (directMatch && directMatch[0]) {
    return directMatch[0];
  }

  // Pattern 2: Google redirect URLs (/url?q=...)
  const urlQPattern = /\/url\?q=([^&"'>]+)/gi;
  let match;
  while ((match = urlQPattern.exec(html)) !== null) {
    try {
      const decoded = decodeURIComponent(match[1]);
      const hrnMatch = decoded.match(/https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/i);
      if (hrnMatch && hrnMatch[0]) {
        return hrnMatch[0];
      }
    } catch (e) {
      // Ignore decode errors
    }
  }

  // Pattern 3: Percent-encoded in href attributes
  const hrefPattern = /href=["']([^"']*entries-results[^"']*)["']/gi;
  while ((match = hrefPattern.exec(html)) !== null) {
    try {
      const url = match[1];
      // Try decoding if needed
      const decoded = url.includes("%") ? decodeURIComponent(url) : url;
      const hrnMatch = decoded.match(/https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/i);
      if (hrnMatch && hrnMatch[0]) {
        return hrnMatch[0];
      }
    } catch (e) {
      // Ignore decode errors
    }
  }
  
  return null;
}

/**
 * Build HRN entries-results URL from track and date
 * @param {string} track - Track name (e.g. "Laurel Park")
 * @param {string} date - ISO date (e.g. "2025-11-30")
 * @returns {string|null} - Constructed HRN URL or null
 */
function buildHrnUrl(track, date) {
  if (!track || !date) return null;
  
  // Normalize track to slug: lowercase, replace spaces with hyphens, remove special chars
  const trackSlug = track
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  
  if (!trackSlug || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  
  return `https://entries.horseracingnation.com/entries-results/${trackSlug}/${date}`;
}

/**
 * Split HRN HTML into race blocks by finding sections that contain "Race N" followed by a payout table
 * @param {string} html - Full HRN page HTML
 * @returns {Array<{ raceNo: string, html: string, tableIndex: number }>}
 */
function splitHrnHtmlIntoRaceBlocks(html) {
  const blocks = [];
  
  if (!html || typeof html !== "string") {
    return blocks;
  }
  
  try {
    // Find all table-payouts tables
    const tablePattern = /<table[^>]*table-payouts[^>]*>/gi;
    const tableMatches = [];
    let match;
    while ((match = tablePattern.exec(html)) !== null) {
      tableMatches.push({ index: match.index, fullMatch: match[0] });
    }
    
    // For each table, look backwards for the closest "Race N" marker
    // Also look at the table content itself to infer race number
    for (let i = 0; i < tableMatches.length; i++) {
      const tableStart = tableMatches[i].index;
      // Look further back (up to 15000 chars) to find race markers
      const beforeTable = html.substring(Math.max(0, tableStart - 15000), tableStart);
      
      // Find the closest "Race N" before this table (case-insensitive)
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
      
      // Use the last (closest) race match before the table
      if (raceMatches.length > 0) {
        const closestRace = raceMatches[raceMatches.length - 1];
        blocks.push({
          raceNo: closestRace.raceNo,
          tableIndex: i,
          tableStart: tableStart
        });
      } else {
        // Fallback: if no race marker found, try to infer from table order
        // Table 0 = Race 1, Table 1 = Race 2, etc. (only if we have multiple tables)
        if (tableMatches.length > 1) {
          blocks.push({
            raceNo: String(i + 1), // First table is Race 1, second is Race 2, etc.
            tableIndex: i,
            tableStart: tableStart
          });
        }
      }
    }
  } catch (err) {
    // On any error, return empty blocks (caller will fall back to parsing all tables)
    console.error("[splitHrnHtmlIntoRaceBlocks] Error:", err.message);
    return [];
  }
  
  return blocks;
}

/**
 * Extract Win/Place/Show from HRN entries-results HTML
 * Parses the finish order table to find horses in positions 1, 2, 3
 * @param {string} html - HRN page HTML
 * @param {string|number} raceNo - Race number to target (optional, defaults to first table)
 * @returns {{ win: string, place: string, show: string }}
 */
function extractOutcomeFromHrnHtml(html, raceNo = null) {
  const outcome = { win: "", place: "", show: "" };
  
  if (!html || typeof html !== "string") {
    return outcome;
  }
  
  try {
    // If raceNo is provided, try to find the matching race block
    let targetHtml = html;
    if (raceNo !== null && raceNo !== undefined) {
      const raceNoStr = String(raceNo || "").trim();
      if (raceNoStr) {
        const blocks = splitHrnHtmlIntoRaceBlocks(html);
        
        // Find the block matching the requested race
        const matchingBlock = blocks.find(b => String(b.raceNo) === raceNoStr);
        
        if (matchingBlock) {
          // Extract HTML from the matching table
          const tablePattern = /<table[^>]*table-payouts[^>]*>[\s\S]*?<\/table>/gi;
          const allTables = [];
          let tableMatch;
          while ((tableMatch = tablePattern.exec(html)) !== null) {
            allTables.push({ index: tableMatch.index, html: tableMatch[0] });
          }
          
          if (allTables[matchingBlock.tableIndex]) {
            targetHtml = allTables[matchingBlock.tableIndex].html;
          }
        }
        // If no matching block found, fall back to parsing all tables (original behavior)
      }
    }
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
      // Reject if it looks like HTML or code
      if (name.includes("<") || name.includes(">") || name.includes("function")) return false;
      // Reject common non-horse-name patterns
      if (/^\d+$/.test(name)) return false; // Just numbers
      if (name.toLowerCase().includes("finish") || name.toLowerCase().includes("position")) return false;
      return true;
    };
    
    // Strategy: Look for HRN payout tables with Win/Place/Show columns
    // HRN uses table-payouts tables where:
    // - First row with Win payout ($X.XX, not "-") = WINNER
    // - Second row = PLACE
    // - Third row = SHOW
    // Horse names are in format: "Horse Name (Speed)" in the first <td>
    
    // Pattern 1: Look for table-payouts tables and extract first 3 rows
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
          // Extract horse name (remove speed figure in parentheses like "(92*)" or "(89*)")
          const horseName = horseNameRaw.replace(/\s*\([^)]+\)\s*$/, "").trim();
          const winPayout = (cells[2] || "").trim();
          const placePayout = (cells[3] || "").trim();
          const showPayout = (cells[4] || "").trim();
          
          if (isValid(horseName)) {
            rows.push({ horseName, winPayout, placePayout, showPayout });
          }
        }
      }
      
      // First row with Win payout (not "-" or "--" and not empty) is the winner
      // Second row is place, third row is show
      // Check if first row has a valid win payout (starts with $ or is a number)
      const firstRowHasWin = rows.length >= 1 && 
        rows[0].winPayout && 
        rows[0].winPayout !== "-" && 
        rows[0].winPayout !== "--" &&
        rows[0].winPayout.trim() !== "" &&
        (rows[0].winPayout.startsWith("$") || /^\d/.test(rows[0].winPayout));
      
      if (firstRowHasWin && !outcome.win) {
        outcome.win = rows[0].horseName;
      }
      // Place is always the second row (even if win payout is "-")
      if (rows.length >= 2 && !outcome.place) {
        outcome.place = rows[1].horseName;
      }
      // Show is always the third row
      if (rows.length >= 3 && !outcome.show) {
        outcome.show = rows[2].horseName;
      }
      
      // If we found all three, break
      if (outcome.win && outcome.place && outcome.show) {
        break;
      }
    }
    
    // Pattern 2: Look for table rows with finish position in a <td> followed by horse name
    // This handles: <tr><td>1</td><td>Horse Name</td>...</tr>
    if (!outcome.win || !outcome.place || !outcome.show) {
      const tableRowPattern = /<tr[^>]*>[\s\S]*?<td[^>]*>\s*(\d+)\s*<\/td>[\s\S]*?<td[^>]*>([^<]+)<\/td>/gi;
      const finishMap = {};
      
      let match;
      while ((match = tableRowPattern.exec(html)) !== null) {
        const position = parseInt(match[1], 10);
        const horseName = decodeEntity(match[2]).replace(/\s*\([^)]+\)\s*$/, "").trim();
        
        if (position >= 1 && position <= 3 && isValid(horseName)) {
          if (position === 1 && !finishMap[1]) finishMap[1] = horseName;
          if (position === 2 && !finishMap[2]) finishMap[2] = horseName;
          if (position === 3 && !finishMap[3]) finishMap[3] = horseName;
        }
      }
      
      if (!outcome.win && finishMap[1]) outcome.win = finishMap[1];
      if (!outcome.place && finishMap[2]) outcome.place = finishMap[2];
      if (!outcome.show && finishMap[3]) outcome.show = finishMap[3];
    }
    
    // Pattern 2: Look for "Finish" or "Pos" column headers, then extract rows
    // This handles tables with explicit Finish/Position columns
    if (!outcome.win || !outcome.place || !outcome.show) {
      // Try to find a results table section
      const tableSectionMatch = targetHtml.match(/<table[^>]*>[\s\S]{0,5000}?<\/table>/i);
      if (tableSectionMatch) {
        const tableHtml = tableSectionMatch[0];
        
        // Look for rows with finish positions 1, 2, 3
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
    
    // Pattern 3: Look for "Win:", "Place:", "Show:" text patterns in payout sections
    if (!outcome.win || !outcome.place || !outcome.show) {
      // Look for payout table or results summary
      const payoutSection = targetHtml.match(/(?:payout|results|finish)[\s\S]{0,2000}?(?:win|place|show)[\s\S]{0,2000}?/i);
      if (payoutSection) {
        const section = payoutSection[0];
        
        // Try to find horse names after Win/Place/Show labels
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
    
    // Final validation
    if (!isValid(outcome.win)) outcome.win = "";
    if (!isValid(outcome.place)) outcome.place = "";
    if (!isValid(outcome.show)) outcome.show = "";
    
  } catch (err) {
    console.error("[extractOutcomeFromHrnHtml] Parse error:", err.message || err);
    // Return empty outcome on error - never throw
    return { win: "", place: "", show: "" };
  }
}

/**
 * Extract Win/Place/Show from Equibase chart HTML
 * Parses the finishing order table to find horses in positions 1, 2, 3
 * @param {string} html - Equibase page HTML
 * @returns {{ win: string, place: string, show: string }}
 */
function extractOutcomeFromEquibaseHtml(html) {
  const outcome = { win: "", place: "", show: "" };
  
  if (!html || typeof html !== "string") {
    return outcome;
  }
  
  // Check for bot blocking (common patterns)
  if (html.includes("Incapsula") || html.includes("_Incapsula_Resource") || html.length < 2000) {
    // Likely bot-blocked, return empty
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
    
    // Strategy A: Look for finishing order table
    // Equibase typically has a table with Finish/Horse columns
    const finishTablePattern = /<table[^>]*>[\s\S]*?(?:Finish|Fin|Horse|Pos)[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i;
    const tableMatch = html.match(finishTablePattern);
    
    if (tableMatch) {
      const tbody = tableMatch[1];
      
      // Extract rows and look for position 1, 2, 3
      const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const finishMap = {};
      
      let trMatch;
      while ((trMatch = trPattern.exec(tbody)) !== null) {
        const rowHtml = trMatch[1];
        
        // Extract all TDs
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
        
        // Look for position number (usually first or second cell)
        // And horse name (usually after position)
        for (let i = 0; i < cells.length; i++) {
          const cell = cells[i];
          const positionMatch = cell.match(/^(\d+)$/);
          
          if (positionMatch) {
            const position = parseInt(positionMatch[1], 10);
            if (position >= 1 && position <= 3 && !finishMap[position]) {
              // Horse name is likely in the next cell or a few cells after
              for (let j = i + 1; j < Math.min(i + 4, cells.length); j++) {
                const nameCandidate = decodeEntity(cells[j])
                  .replace(/\s*\([^)]+\)\s*$/, "") // Remove odds/comments in parentheses
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
    
    // Strategy B: Look for Win/Place/Show text patterns
    if (!outcome.win || !outcome.place || !outcome.show) {
      // Try to find text like "Win: Horse Name" or "1. Horse Name"
      const winPattern = /(?:Win|Winner|1st)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      const placePattern = /(?:Place|2nd)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      const showPattern = /(?:Show|3rd)[:\s]+([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/i;
      
      const winMatch = html.match(winPattern);
      const placeMatch = html.match(placePattern);
      const showMatch = html.match(showPattern);
      
      if (winMatch && winMatch[1] && !outcome.win) {
        const name = decodeEntity(winMatch[1].trim());
        if (isValid(name)) {
          outcome.win = name;
        }
      }
      
      if (placeMatch && placeMatch[1] && !outcome.place) {
        const name = decodeEntity(placeMatch[1].trim());
        if (isValid(name)) {
          outcome.place = name;
        }
      }
      
      if (showMatch && showMatch[1] && !outcome.show) {
        const name = decodeEntity(showMatch[1].trim());
        if (isValid(name)) {
          outcome.show = name;
        }
      }
    }
    
    // Strategy C: Look for numbered list pattern "1. Horse Name"
    if (!outcome.win || !outcome.place || !outcome.show) {
      const numberedPattern = /(\d+)\.\s*([A-Za-z0-9\s'\-\.]+?)(?:\s|$|,|;|<\/|\(|\[)/gi;
      const numberedMap = {};
      
      let match;
      while ((match = numberedPattern.exec(html)) !== null) {
        const position = parseInt(match[1], 10);
        if (position >= 1 && position <= 3 && !numberedMap[position]) {
          const name = decodeEntity(match[2].trim());
          if (isValid(name)) {
            numberedMap[position] = name;
          }
        }
      }
      
      if (!outcome.win && numberedMap[1]) outcome.win = numberedMap[1];
      if (!outcome.place && numberedMap[2]) outcome.place = numberedMap[2];
      if (!outcome.show && numberedMap[3]) outcome.show = numberedMap[3];
    }
    
    // Final validation
    if (!isValid(outcome.win)) outcome.win = "";
    if (!isValid(outcome.place)) outcome.place = "";
    if (!isValid(outcome.show)) outcome.show = "";
    
  } catch (err) {
    console.error("[extractOutcomeFromEquibaseHtml] Parse error:", err.message || err);
    return { win: "", place: "", show: "" };
  }
  
  return outcome;
}

/**
 * Extract Win/Place/Show from Google HTML using regex
 * This is a lightweight parser that matches Google AI Overview format:
 * "Win: Doc Sullivan", "Place: Dr. Kraft", "Show: Bank Frenzy"
 */
function extractOutcomeFromGoogleHtml(html) {
  if (!html || typeof html !== "string") {
    return { win: "", place: "", show: "" };
  }

  // Three separate regex patterns, one per line
  // Pattern matches "Win:", "Place:", "Show:" followed by optional whitespace and horse name
  // [A-Za-z0-9 .,'’-]+ matches letters, numbers, spaces, and common punctuation
  const winRegex = /Win:\s*([A-Za-z0-9 .,'’-]+)/i;
  const placeRegex = /Place:\s*([A-Za-z0-9 .,'’-]+)/i;
  const showRegex = /Show:\s*([A-Za-z0-9 .,'’-]+)/i;

  // Apply regex patterns
  const winMatch = html.match(winRegex);
  const placeMatch = html.match(placeRegex);
  const showMatch = html.match(showRegex);

  /**
   * Clean and validate a horse name match
   * @param {RegExpMatchArray|null} match - The regex match result
   * @returns {string} - Cleaned horse name or empty string if invalid
   */
  function cleanMatch(match) {
    if (!match?.[1]) return "";
    
    // Get the captured group and trim
    let cleaned = match[1].trim();
    
    // Decode HTML entities
    cleaned = decodeHtmlEntities(cleaned);
    
    // Strip trailing characters after common delimiters: <, ", ', {, }, ;
    cleaned = cleaned.split(/[<"'{};]/)[0].trim();
    
    // Validation rules: horse name is valid only if:
    // 1. Length ≤ 40 chars
    // 2. Contains at least 1 letter
    // 3. Does NOT contain JS code patterns
    if (
      !cleaned ||
      cleaned.length === 0 ||
      cleaned.length > 40 ||
      !/[A-Za-z]/.test(cleaned) || // Must contain at least one letter
      cleaned.includes("function") ||
      cleaned.includes("=>") ||
      cleaned.includes("prototype") ||
      cleaned.includes("call:") ||
      cleaned.includes("splice") ||
      cleaned.includes("push") ||
      cleaned.includes("pop") ||
      cleaned.includes("<script") ||
      /[{}()=>]/.test(cleaned) || // No JS code patterns
      /^\d+$/.test(cleaned) || // Pure numbers are not horse names
      /^[A-Z],/.test(cleaned) // Patterns like "P,splice" are JS code
    ) {
      return "";
    }
    
    return cleaned;
  }

  const win = cleanMatch(winMatch);
  const place = cleanMatch(placeMatch);
  const show = cleanMatch(showMatch);

  return { win, place, show };
}

/**
 * Build stub response (ultra-safe fallback with Google HTML parsing)
 * This is the default behavior when VERIFY_RACE_MODE is not set to "full"
 * Now enhanced to fetch and parse Google HTML for Win/Place/Show
 */
async function buildStubResponse({ track, date, raceNo, predicted = {} }) {
  // CRITICAL: date should already be canonical ISO from handler
  // Use it as-is - no fallback to today, no re-normalization
  // If date is missing, that's an upstream bug - log warning but use empty string
  let usingDate = "";
  if (date && typeof date === "string") {
    const trimmed = date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      usingDate = trimmed;  // Already ISO - use as-is (no modification)
    } else {
      // Try to normalize MM/DD/YYYY format (defensive check only)
      const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mdy) {
        const [, mm, dd, yyyy] = mdy;
        usingDate = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      } else {
        console.warn("[buildStubResponse] Non-ISO date format, using as-is:", trimmed);
        usingDate = trimmed;
      }
    }
  } else if (date) {
    console.warn("[buildStubResponse] Date is not a string:", typeof date, date);
    usingDate = String(date).trim();
  } else {
    console.warn("[buildStubResponse] Date is missing - this should not happen if handler validated correctly");
    usingDate = "";  // Do NOT fall back to today
  }
  const safeTrack =
    typeof track === "string" && track.trim() ? track.trim() : "";
  const raceNoStr = String(raceNo ?? "").trim() || "";

  const query = [
    safeTrack || "Unknown Track",
    raceNoStr ? `Race ${raceNoStr}` : "",
    usingDate || "",
    "results Win Place Show",
  ]
    .filter(Boolean)
    .join(" ");

  const googleUrl =
    "https://www.google.com/search?q=" + encodeURIComponent(query);

  // Default outcome = empty (original stub behavior)
  let outcome = { win: "", place: "", show: "" };
  let step = "verify_race_google_only_stub";

  // Try to fetch Google HTML and parse W/P/S with regex
  let googleHtml = null;
  let hrnUrl = null;
  let hrnOutcome = null;
  let hrnParseError = null;
  let equibaseDebug = {}; // Store Equibase debug info for later merge
  
  try {
    const res = await fetch(googleUrl, {
      method: "GET",
      headers: {
        // Keep headers minimal to avoid attracting bot detection; these are just "normal browser-ish" hints
        "User-Agent":
          "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (res && res.ok) {
      googleHtml = await res.text();
      outcome = extractOutcomeFromGoogleHtml(googleHtml);

      // Only mark as parsed if all three positions were found
      if (outcome && outcome.win && outcome.place && outcome.show) {
        step = "verify_race_google_parsed_stub";
      }
    }
  } catch (err) {
    // Swallow errors to keep stub ultra-safe
    console.error("[verify_race stub] Google fetch/parse failed:", err);
  }

  // ALWAYS try HRN fallback if we have track, date, and Google didn't find all three
  // This ensures HRN is attempted even if Google fetch fails or doesn't contain results
  if (!outcome.win || !outcome.place || !outcome.show) {
    if (safeTrack && usingDate) {
      try {
        // First try to extract HRN URL from Google HTML (if we have it)
        if (googleHtml) {
          hrnUrl = extractHrnUrlFromGoogleHtml(googleHtml);
        }
        
        // If not found in Google HTML, construct it directly from track/date
        if (!hrnUrl) {
          hrnUrl = buildHrnUrl(safeTrack, usingDate);
        }
        
        if (hrnUrl) {
          try {
            const hrnRes = await fetch(hrnUrl, {
              method: "GET",
              headers: {
                "User-Agent":
                  "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
                "Accept-Language": "en-US,en;q=0.9",
              },
            });
            
            if (hrnRes && hrnRes.ok) {
              const hrnHtml = await hrnRes.text();
              hrnOutcome = extractOutcomeFromHrnHtml(hrnHtml, raceNoStr);
              
              // If HRN parsing found at least one result, use it
              if (hrnOutcome && (hrnOutcome.win || hrnOutcome.place || hrnOutcome.show)) {
                outcome = hrnOutcome;
                // Mark as HRN fallback if we got all three, otherwise keep as partial
                if (hrnOutcome.win && hrnOutcome.place && hrnOutcome.show) {
                  step = "verify_race_fallback_hrn";
                } else {
                  step = "verify_race_fallback_hrn_partial";
                }
              } else {
                hrnParseError = "No outcome parsed from HRN HTML";
                
                // HRN failed, try Equibase fallback (no-op in stub mode, just for debug info)
                if (safeTrack && usingDate && raceNoStr) {
                  try {
                    const { outcome: eqOutcome, debugExtras } = await tryEquibaseFallback(safeTrack, usingDate, raceNoStr, {});
                    if (debugExtras) {
                      equibaseDebug = { ...equibaseDebug, ...debugExtras };
                    }
                    // DO NOT override the main outcome here in stub mode;
                    // stub is google-only, this is just extra debug.
                  } catch (err) {
                    // absolutely never throw from stub because of Equibase
                    equibaseDebug = {
                      ...equibaseDebug,
                      equibaseAttempted: false,
                      equibaseParseError: String(err && err.message ? err.message : err),
                    };
                  }
                }
              }
            } else {
              hrnParseError = `HTTP ${hrnRes ? hrnRes.status : "unknown"}`;
              
              // HRN fetch failed, try Equibase fallback (no-op in stub mode, just for debug info)
              if (safeTrack && usingDate && raceNoStr) {
                try {
                  const { outcome: eqOutcome, debugExtras } = await tryEquibaseFallback(safeTrack, usingDate, raceNoStr, {});
                  if (debugExtras) {
                    equibaseDebug = { ...equibaseDebug, ...debugExtras };
                  }
                  // DO NOT override the main outcome here in stub mode;
                  // stub is google-only, this is just extra debug.
                } catch (err) {
                  // absolutely never throw from stub because of Equibase
                  equibaseDebug = {
                    ...equibaseDebug,
                    equibaseAttempted: false,
                    equibaseParseError: String(err && err.message ? err.message : err),
                  };
                }
              }
            }
          } catch (hrnErr) {
            hrnParseError = String(hrnErr.message || hrnErr);
            console.error("[verify_race stub] HRN fetch/parse failed:", hrnErr);
          }
        } else {
          hrnParseError = "No HRN URL available";
        }
      } catch (err) {
        hrnParseError = String(err.message || err);
        console.error("[verify_race stub] HRN fallback error:", err);
      }
    }
  }

  const predictedNormalized = normalizePrediction(predicted);

  // Compute hits using normalized horse names
  const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
  const norm = normalizeHorseName;
  const pWin = norm(predictedNormalized.win);
  const pPlace = norm(predictedNormalized.place);
  const pShow = norm(predictedNormalized.show);
  const oWin = norm(outcome.win);
  const oPlace = norm(outcome.place);
  const oShow = norm(outcome.show);

  const winHit = !!pWin && !!oWin && pWin === oWin;
  const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
  const showHit = !!pShow && !!oShow && pShow === oShow;
  
  // Top3Hit: any predicted horse is in the top 3 outcome positions
  const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
  const top3Hit = [pWin, pPlace, pShow]
    .filter(Boolean)
    .some(name => top3Set.has(name));

  const hits = {
    winHit,
    placeHit,
    showHit,
    top3Hit,
  };

  // Build base summary using helper (wrapped in try/catch for safety)
  let baseSummary = "";
  try {
    baseSummary = buildSummary({
      date: usingDate,
      uiDateRaw: null, // buildStubResponse doesn't receive ctx, so uiDateRaw is not available here
      outcome,
      step,
      query,
    });
  } catch (err) {
    console.error("[buildStubResponse] Error building summary:", err);
    baseSummary = `Step: ${step || "unknown"}\nOutcome:\n  Win: ${outcome.win || "-"}\n  Place: ${outcome.place || "-"}\n  Show: ${outcome.show || "-"}`;
  }
  
  // Append predicted and hits info
  const summaryLines = baseSummary.split("\n");
  const predictedParts = [predictedNormalized.win, predictedNormalized.place, predictedNormalized.show].filter(Boolean);
  if (predictedParts.length) {
    summaryLines.push(`Predicted: ${predictedParts.join(" / ")}`);
  } else {
    summaryLines.push("Predicted: (none)");
  }

  // Show hits
  const hitParts = [];
  if (hits.winHit) hitParts.push("winHit");
  if (hits.placeHit) hitParts.push("placeHit");
  if (hits.showHit) hitParts.push("showHit");
  if (hits.top3Hit) hitParts.push("top3Hit");
  summaryLines.push(`Hits: ${hitParts.length ? hitParts.join(", ") : "(none)"}`);

  if (!outcome.win && !outcome.place && !outcome.show) {
    summaryLines.push("");
    summaryLines.push(
      "Parser note: Google page fetched but Win/Place/Show could not be reliably parsed. Read the Google tab if needed."
    );
  }

  const summary = summaryLines.join("\n");

  // Determine ok status: true if we have at least one outcome field
  const hasOutcome = !!(outcome.win || outcome.place || outcome.show);
  const ok = hasOutcome || step === "verify_race_fallback_hrn" || step === "verify_race_fallback_hrn_partial";
  
  // Build debug object - preserve all existing fields
  const debug = {
    googleUrl,
    backendVersion: BACKEND_VERSION,
    handlerFile: HANDLER_FILE,
  };
  
  // Always include HRN debug info if we attempted it
  if (hrnUrl) {
    debug.hrnUrl = hrnUrl;
  }
  
  if (hrnParseError) {
    debug.hrnParseError = hrnParseError;
  }
  
  // Merge Equibase debug info if it was collected (from no-op fallback in stub mode)
  if (equibaseDebug && Object.keys(equibaseDebug).length > 0) {
    Object.assign(debug, equibaseDebug);
  }
  
  // Store googleHtml in debug for potential future use (but don't send it in response to avoid bloat)
  // We'll just keep it for internal reference if needed
  
  return {
    ok,
    step,
    date: usingDate,
    track: safeTrack,
    raceNo: raceNoStr,
    query,
    top: {
      title: `Google search: ${query}`,
      link: googleUrl,
    },
    outcome: {
      win: outcome.win || "",
      place: outcome.place || "",
      show: outcome.show || "",
    },
    predicted: predictedNormalized,
    hits,
    summary: summary,
    debug,
    responseMeta: {
      handlerFile: HANDLER_FILE,
      backendVersion: BACKEND_VERSION,
    },
  };
}

export default async function handler(req, res) {
  // We NEVER throw from this handler. All errors are reported in the JSON body.
  try {
    if (req.method !== "POST") {
      const stub = await buildStubResponse({
        track: null,
        date: null,
        raceNo: null,
      });
      return res.status(200).json({
        ...stub,
        ok: false,
        step: "verify_race_stub",
        error: "METHOD_NOT_ALLOWED",
        message: `Expected POST, received ${req.method}`,
        summary: `Verify Race stub: method ${req.method} is not supported.`,
      });
    }

    const body = await safeParseBody(req);
    const track = (body.track || body.trackName || "").trim();
    
    // Pure string helper for date normalization (no Date objects for user dates)
    function canonicalizeDateFromClient(raw) {
      if (!raw) return null;
      const s = String(raw).trim();

      // Already ISO (YYYY-MM-DD)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
      }

      // MM/DD/YYYY -> YYYY-MM-DD
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mm = m[1].padStart(2, "0");
        const dd = m[2].padStart(2, "0");
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }

      // Fallback: just return trimmed string (NO Date parsing)
      return s;
    }
    
    // Extract the raw date from body
    const uiDateRaw =
      (body && (body.date || body.raceDate || body.canonicalDate)) ||
      null;

    const canonicalDateIso = canonicalizeDateFromClient(uiDateRaw);

    if (!canonicalDateIso) {
      // If no valid date, respond with 200 JSON (not 400) to match our "never 500" policy
      return res.status(200).json({
        ok: false,
        step: "verify_race_error",
        error: "Missing or invalid date",
        date: "",
        track: track || "",
        raceNo: raceNo || "",
        query: "",
        top: null,
        outcome: { win: "", place: "", show: "" },
        predicted: {
          win: (predicted.win || "").trim(),
          place: (predicted.place || "").trim(),
          show: (predicted.show || "").trim(),
        },
        hits: {
          winHit: false,
          placeHit: false,
          showHit: false,
          top3Hit: false,
        },
        summary: "Error: Missing or invalid date",
        debug: {
          backendVersion: BACKEND_VERSION,
          handlerFile: HANDLER_FILE,
        },
        responseMeta: {
          handlerFile: HANDLER_FILE,
          backendVersion: BACKEND_VERSION,
        },
      });
    }
    
    // Debug log (only in non-production to avoid noisy logs)
    if (process.env.NODE_ENV !== "production") {
      console.log("[VERIFY_DATES] incoming", {
        uiDateRaw,
        canonicalDateIso,
      });
    }
    
    const raceNo = (body.raceNo || body.race || "").toString().trim() || "";
    const predicted = body.predicted || {};

    // Build context - include all date fields for maximum compatibility
    const ctx = {
      track: body.track || "",
      raceNo: body.raceNo || body.race || "",
      date: canonicalDateIso,
      raceDate: canonicalDateIso,
      canonicalDateIso: canonicalDateIso,
      dateRaw: uiDateRaw,        // for debugging
      predicted: body.predicted || {},
    };

    // Read feature flag INSIDE the handler (not at top level)
    const mode = (process.env.VERIFY_RACE_MODE || "stub").toLowerCase().trim();

    // If not in full mode, immediately return stub
    if (mode !== "full") {
      const stub = await buildStubResponse(ctx);
      await logVerifyResult(stub);
      return res.status(200).json(stub);
    }

    // Full mode: attempt to use the full parser
    try {
      // Dynamic import to avoid loading the module if not needed
      // However, since we're already in full mode, we can use static import
      // But to be extra safe, we'll wrap it in try/catch
      const { runFullVerifyRace } = await import("../../lib/verify_race_full.js");

      const fullResult = await runFullVerifyRace({
        ...ctx,
        req, // Pass req for CSE bridge
      });

      // Validate the response has the required shape
      if (
        !fullResult ||
        typeof fullResult !== "object" ||
        !fullResult.step
      ) {
        // Don't throw - return a safe error response instead
        console.error("[verify_race] Invalid full verify response structure", {
          fullResult,
          track,
          date: canonicalDateIso,
          raceNo,
        });
        const errorResponse = {
          ok: false,
          step: "verify_race_full_fallback",
          date: canonicalDateIso,
          track: track || "",
          raceNo: raceNo || "",
          query: "",
          top: null,
          outcome: { win: "", place: "", show: "" },
          predicted: {
            win: (predicted.win || "").trim(),
            place: (predicted.place || "").trim(),
            show: (predicted.show || "").trim(),
          },
          hits: {
            winHit: false,
            placeHit: false,
            showHit: false,
            top3Hit: false,
          },
          summary: "Full parser returned invalid response structure. Using fallback.",
          debug: {
            backendVersion: BACKEND_VERSION,
            handlerFile: HANDLER_FILE,
            fullError: "Invalid full verify response structure",
          },
        };
        await logVerifyResult(errorResponse).catch(() => {}); // Ignore logging errors
        return res.status(200).json({
          ...errorResponse,
          responseMeta: {
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
          },
        });
      }

      // Import validation helper
      const { isValidOutcome } = await import("../../lib/verify_race_full.js");
      
      // If step is "verify_race", return success directly (Equibase or HRN succeeded)
      if (fullResult.step === "verify_race") {
        // Ensure all required fields are present - use canonical date from context
        const validatedResult = {
          ok: fullResult.ok !== undefined ? fullResult.ok : true,
          step: "verify_race",
          date: fullResult.date || canonicalDateIso, // Use canonicalDateIso from handler
          track: fullResult.track || track || "",
          raceNo: fullResult.raceNo || raceNo || "",
          query: fullResult.query || "",
          top: fullResult.top || null,
          outcome: fullResult.outcome || { win: "", place: "", show: "" },
          predicted: fullResult.predicted || {
            win: (predicted.win || "").trim(),
            place: (predicted.place || "").trim(),
            show: (predicted.show || "").trim(),
          },
          hits: fullResult.hits || {
            winHit: false,
            placeHit: false,
            showHit: false,
            top3Hit: false,
          },
          summary: fullResult.summary || "Full verify race completed.",
          debug: {
            ...fullResult.debug,
            googleUrl:
              fullResult.debug?.googleUrl ||
              (() => {
                try {
                  return buildGoogleSearchUrl({ track, date: canonicalDateIso, raceNo }).url;
                } catch (err) {
                  console.error("[verify_race] Error building Google URL:", err);
                  return "";
                }
              })(),
          },
        };

        await logVerifyResult(validatedResult);
        return res.status(200).json(validatedResult);
      }

      // If step is "verify_race_full_fallback", use full result but ensure date is canonical
      // Then try HRN fallback
      if (fullResult.step === "verify_race_full_fallback") {
        console.warn("[verify_race] Full parser returned fallback", {
          step: fullResult.step,
          query: fullResult.query,
        });
        // Use full result but ensure date field is canonical
        const fallbackResult = {
          ...fullResult,
          date: fullResult.date || canonicalDateIso, // Ensure canonical date
          debug: {
            ...(fullResult.debug || {}),
            backendVersion: BACKEND_VERSION,
            handlerFile: HANDLER_FILE,
          },
        };

        // Try HRN fallback if we have track and date
        if (track && canonicalDateIso) {
          const canonicalRaceNo = String(raceNo || "").trim();
          const { outcome: hrnOutcome, debugExtras: hrnDebug } = await tryHrnFallback(track, canonicalDateIso, canonicalRaceNo, fallbackResult.debug);
          fallbackResult.debug = { ...fallbackResult.debug, ...hrnDebug };

          if (hrnOutcome) {
            fallbackResult.outcome = hrnOutcome;
            fallbackResult.ok = true;
            fallbackResult.step = "verify_race_fallback_hrn";
            // Rebuild summary with final outcome
            try {
              fallbackResult.summary = buildSummary({
                date: fallbackResult.date || canonicalDateIso,
                uiDateRaw: fallbackResult.debug?.uiDateRaw,
                outcome: fallbackResult.outcome,
                step: fallbackResult.step,
                query: fallbackResult.query,
              });
            } catch (err) {
              console.error("[verify_race] Error rebuilding summary:", err);
              fallbackResult.summary = fallbackResult.summary || `Step: ${fallbackResult.step || "unknown"}`;
            }
          } else {
            // HRN failed, try Equibase fallback
            const { outcome: equibaseOutcome, debugExtras: equibaseDebug } = await tryEquibaseFallback(track, canonicalDateIso, canonicalRaceNo, fallbackResult.debug);
            fallbackResult.debug = { ...fallbackResult.debug, ...equibaseDebug };

            if (equibaseOutcome) {
              fallbackResult.outcome = equibaseOutcome;
              fallbackResult.ok = true;
              fallbackResult.step = "verify_race_fallback_equibase";
              
              // Recompute hits if we have predicted values
              if (fallbackResult.predicted) {
                const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
                const norm = normalizeHorseName;
                const pWin = norm(fallbackResult.predicted.win);
                const pPlace = norm(fallbackResult.predicted.place);
                const pShow = norm(fallbackResult.predicted.show);
                const oWin = norm(equibaseOutcome.win);
                const oPlace = norm(equibaseOutcome.place);
                const oShow = norm(equibaseOutcome.show);

                const winHit = !!pWin && !!oWin && pWin === oWin;
                const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
                const showHit = !!pShow && !!oShow && pShow === oShow;
                const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
                const top3Hit = [pWin, pPlace, pShow]
                  .filter(Boolean)
                  .some(name => top3Set.has(name));

                fallbackResult.hits = {
                  winHit,
                  placeHit,
                  showHit,
                  top3Hit,
                };
              }
              
              // Rebuild summary with final outcome
              try {
                fallbackResult.summary = buildSummary({
                  date: fallbackResult.date || canonicalDateIso,
                  uiDateRaw: fallbackResult.debug?.uiDateRaw,
                  outcome: fallbackResult.outcome,
                  step: fallbackResult.step,
                  query: fallbackResult.query,
                });
              } catch (err) {
                console.error("[verify_race] Error rebuilding summary:", err);
                fallbackResult.summary = fallbackResult.summary || `Step: ${fallbackResult.step || "unknown"}`;
              }
            }
          }
        }

        await logVerifyResult(fallbackResult);
        return res.status(200).json({
          ...fallbackResult,
          responseMeta: {
            handlerFile: HANDLER_FILE,
            backendVersion: BACKEND_VERSION,
          },
        });
      }

      // Any other step (error cases) - fall back to stub with canonical date
      console.warn("[verify_race] Full parser returned unexpected step, falling back to stub", {
        step: fullResult.step,
      });
      const stub = await buildStubResponse(ctx);
      const fallbackStub = {
        ...stub,
        step: "verify_race_full_fallback",
        date: canonicalDateIso, // Ensure canonical date
        summary: `Full parser attempted but failed: step=${fullResult.step}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...stub.debug,
          fullError: `Full parser step: ${fullResult.step}`,
          backendVersion: BACKEND_VERSION,
          handlerFile: HANDLER_FILE,
        },
      };

      // Try HRN fallback if we have track and date
      if (track && canonicalDateIso) {
        const canonicalRaceNo = String(raceNo || "").trim();
        const { outcome: hrnOutcome, debugExtras: hrnDebug } = await tryHrnFallback(track, canonicalDateIso, canonicalRaceNo, fallbackStub.debug);
        fallbackStub.debug = { ...fallbackStub.debug, ...hrnDebug };

        if (hrnOutcome) {
          fallbackStub.outcome = hrnOutcome;
          fallbackStub.ok = true;
          fallbackStub.step = "verify_race_fallback_hrn";
          // Rebuild summary with final outcome
          try {
            fallbackStub.summary = buildSummary({
              date: fallbackStub.date || canonicalDateIso,
              uiDateRaw: fallbackStub.debug?.uiDateRaw,
              outcome: fallbackStub.outcome,
              step: fallbackStub.step,
              query: fallbackStub.query,
            });
          } catch (err) {
            console.error("[verify_race] Error rebuilding summary:", err);
            fallbackStub.summary = fallbackStub.summary || `Step: ${fallbackStub.step || "unknown"}`;
          }
        } else {
          // HRN failed, try Equibase fallback
          const { outcome: equibaseOutcome, debugExtras: equibaseDebug } = await tryEquibaseFallback(track, canonicalDateIso, canonicalRaceNo, fallbackStub.debug);
          fallbackStub.debug = { ...fallbackStub.debug, ...equibaseDebug };

          if (equibaseOutcome) {
            fallbackStub.outcome = equibaseOutcome;
            fallbackStub.ok = true;
            fallbackStub.step = "verify_race_fallback_equibase";
            
            // Recompute hits if we have predicted values
            if (fallbackStub.predicted) {
              const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
              const norm = normalizeHorseName;
              const pWin = norm(fallbackStub.predicted.win);
              const pPlace = norm(fallbackStub.predicted.place);
              const pShow = norm(fallbackStub.predicted.show);
              const oWin = norm(equibaseOutcome.win);
              const oPlace = norm(equibaseOutcome.place);
              const oShow = norm(equibaseOutcome.show);

              const winHit = !!pWin && !!oWin && pWin === oWin;
              const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
              const showHit = !!pShow && !!oShow && pShow === oShow;
              const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
              const top3Hit = [pWin, pPlace, pShow]
                .filter(Boolean)
                .some(name => top3Set.has(name));

              fallbackStub.hits = {
                winHit,
                placeHit,
                showHit,
                top3Hit,
              };
            }
            
            // Rebuild summary with final outcome
            try {
              fallbackStub.summary = buildSummary({
                date: fallbackStub.date || canonicalDateIso,
                uiDateRaw: fallbackStub.debug?.uiDateRaw,
                outcome: fallbackStub.outcome,
                step: fallbackStub.step,
                query: fallbackStub.query,
              });
            } catch (err) {
              console.error("[verify_race] Error rebuilding summary:", err);
              fallbackStub.summary = fallbackStub.summary || `Step: ${fallbackStub.step || "unknown"}`;
            }
          }
        }
      }

      await logVerifyResult(fallbackStub);
      return res.status(200).json({
        ...fallbackStub,
        responseMeta: {
          handlerFile: HANDLER_FILE,
          backendVersion: BACKEND_VERSION,
        },
      });
    } catch (fullError) {
      // Log error and fall back to stub
      const errorMsg = fullError?.message || String(fullError);
      console.error("[verify_race] Full parser failed, falling back to stub", {
        error: errorMsg,
        stack: fullError?.stack,
        track,
        date: canonicalDateIso,
        raceNo,
      });

      const stub = await buildStubResponse(ctx);
      const errorStub = {
        ...stub,
        step: "verify_race_full_fallback",
        date: canonicalDateIso, // Ensure canonical date
        summary: `Full parser attempted but failed: ${errorMsg}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...stub.debug,
          fullError: errorMsg,
          fullErrorStack: fullError?.stack || undefined,
          backendVersion: BACKEND_VERSION,
          handlerFile: HANDLER_FILE,
        },
      };

      // Try HRN fallback if we have track and date
      if (track && canonicalDateIso) {
        const canonicalRaceNo = String(raceNo || "").trim();
        const { outcome: hrnOutcome, debugExtras: hrnDebug } = await tryHrnFallback(track, canonicalDateIso, canonicalRaceNo, errorStub.debug);
        errorStub.debug = { ...errorStub.debug, ...hrnDebug };

        if (hrnOutcome) {
          errorStub.outcome = hrnOutcome;
          errorStub.ok = true;
          errorStub.step = "verify_race_fallback_hrn";
          // Rebuild summary with final outcome
          try {
            errorStub.summary = buildSummary({
              date: errorStub.date || canonicalDateIso,
              uiDateRaw: errorStub.debug?.uiDateRaw,
              outcome: errorStub.outcome,
              step: errorStub.step,
              query: errorStub.query,
            });
          } catch (err) {
            console.error("[verify_race] Error rebuilding summary:", err);
            errorStub.summary = errorStub.summary || `Step: ${errorStub.step || "unknown"}`;
          }
        } else {
          // HRN failed, try Equibase fallback
          const { outcome: equibaseOutcome, debugExtras: equibaseDebug } = await tryEquibaseFallback(track, canonicalDateIso, canonicalRaceNo, errorStub.debug);
          errorStub.debug = { ...errorStub.debug, ...equibaseDebug };

          if (equibaseOutcome) {
            errorStub.outcome = equibaseOutcome;
            errorStub.ok = true;
            errorStub.step = "verify_race_fallback_equibase";
            
            // Recompute hits if we have predicted values
            if (errorStub.predicted) {
              const normalizeHorseName = (name) => (name || "").toLowerCase().replace(/\s+/g, " ").trim();
              const norm = normalizeHorseName;
              const pWin = norm(errorStub.predicted.win);
              const pPlace = norm(errorStub.predicted.place);
              const pShow = norm(errorStub.predicted.show);
              const oWin = norm(equibaseOutcome.win);
              const oPlace = norm(equibaseOutcome.place);
              const oShow = norm(equibaseOutcome.show);

              const winHit = !!pWin && !!oWin && pWin === oWin;
              const placeHit = !!pPlace && !!oPlace && pPlace === oPlace;
              const showHit = !!pShow && !!oShow && pShow === oShow;
              const top3Set = new Set([oWin, oPlace, oShow].filter(Boolean));
              const top3Hit = [pWin, pPlace, pShow]
                .filter(Boolean)
                .some(name => top3Set.has(name));

              errorStub.hits = {
                winHit,
                placeHit,
                showHit,
                top3Hit,
              };
            }
            
            // Rebuild summary with final outcome
            try {
              errorStub.summary = buildSummary({
                date: errorStub.date || canonicalDateIso,
                uiDateRaw: errorStub.debug?.uiDateRaw,
                outcome: errorStub.outcome,
                step: errorStub.step,
                query: errorStub.query,
              });
            } catch (err) {
              console.error("[verify_race] Error rebuilding summary:", err);
              errorStub.summary = errorStub.summary || `Step: ${errorStub.step || "unknown"}`;
            }
          }
        }
      }

      await logVerifyResult(errorStub);
      return res.status(200).json({
        ...errorStub,
        responseMeta: {
          handlerFile: HANDLER_FILE,
          backendVersion: BACKEND_VERSION,
        },
      });
    }
  } catch (err) {
    // Absolute last-resort catch; still return 200.
    console.error("[verify_race] UNEXPECTED ERROR", err);
    // Try to extract date from body if available, otherwise use empty string (no today fallback)
    const errorBody = await safeParseBody(req).catch(() => ({}));
    const rawDateFromBody = (errorBody && (errorBody.date || errorBody.raceDate || errorBody.race_date || "")) || "";
    
    // Pure string helper for date normalization (reuse the same logic)
    function canonicalizeDateFromClient(raw) {
      if (!raw) return null;
      const s = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return s;
      }
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const mm = m[1].padStart(2, "0");
        const dd = m[2].padStart(2, "0");
        const yyyy = m[3];
        return `${yyyy}-${mm}-${dd}`;
      }
      return s;
    }
    
    const errorDateIso = canonicalizeDateFromClient(rawDateFromBody) || "";  // No fallback to today
    const stub = await buildStubResponse({
      track: null,
      date: errorDateIso,
      raceNo: null,
    });
    const errorStub = {
      ...stub,
      ok: false,
      step: "verify_race_stub_unexpected_error",
      error: String(err && err.message ? err.message : err),
      summary: "Verify Race stub encountered an unexpected error, but the handler still returned 200.",
      date: errorDateIso,
    };
    // Don't log error cases (ok: false)
    return res.status(200).json(errorStub);
  }
}
