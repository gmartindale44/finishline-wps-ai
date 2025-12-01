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
  // Only log successful verify responses
  if (!result || result.ok !== true) {
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
      const html = await res.text();
      outcome = extractOutcomeFromGoogleHtml(html);

      // Only mark as parsed if all three positions were found
      if (outcome && outcome.win && outcome.place && outcome.show) {
        step = "verify_race_google_parsed_stub";
      }
    }
  } catch (err) {
    // Swallow errors to keep stub ultra-safe
    console.error("[verify_race stub] Google fetch/parse failed:", err);
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

  const summaryLines = [];
  summaryLines.push(`Using date: ${usingDate || "(none)"}`);
  summaryLines.push(`Step: ${step}`);
  summaryLines.push(`Query: ${query}`);
  summaryLines.push(`Top Result: Google search (see Open Top Result button).`);

  // Display outcome in format: "Outcome: <win> / <place> / <show>"
  if (outcome && outcome.win && outcome.place && outcome.show) {
    // All three extracted successfully
    summaryLines.push(`Outcome: ${outcome.win} / ${outcome.place} / ${outcome.show}`);
  } else if (outcome && (outcome.win || outcome.place || outcome.show)) {
    // Partial extraction - show what we have
    const win = outcome.win || "(none)";
    const place = outcome.place || "(none)";
    const show = outcome.show || "(none)";
    summaryLines.push(`Outcome: ${win} / ${place} / ${show}`);
  } else {
    // No extraction
    summaryLines.push("Outcome: (none)");
  }

  // Show predicted values
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

  return {
    ok: true,
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
    summary,
    debug: {
      googleUrl,
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
      // If no valid date, respond with 400 instead of guessing "today"
      return res.status(400).json({ ok: false, error: "Missing or invalid date" });
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
        throw new Error("Invalid full verify response structure");
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
              buildGoogleSearchUrl({ track, date: canonicalDateIso, raceNo }).url,
          },
        };

        await logVerifyResult(validatedResult);
        return res.status(200).json(validatedResult);
      }

      // If step is "verify_race_full_fallback", use full result but ensure date is canonical
      if (fullResult.step === "verify_race_full_fallback") {
        console.warn("[verify_race] Full parser returned fallback", {
          step: fullResult.step,
          query: fullResult.query,
        });
        // Use full result but ensure date field is canonical
        const fallbackResult = {
          ...fullResult,
          date: fullResult.date || canonicalDateIso, // Ensure canonical date
        };
        await logVerifyResult(fallbackResult);
        return res.status(200).json(fallbackResult);
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
        },
      };
      await logVerifyResult(fallbackStub);
      return res.status(200).json(fallbackStub);
    } catch (fullError) {
      // Log error and fall back to stub
      console.error("[verify_race] Full parser failed, falling back to stub", {
        error: fullError?.message || String(fullError),
        stack: fullError?.stack,
        track,
        date: canonicalDateIso,
        raceNo,
      });

      const stub = await buildStubResponse(ctx);
      const errorMsg = fullError?.message || String(fullError);
      const errorStub = {
        ...stub,
        step: "verify_race_full_fallback",
        date: canonicalDateIso, // Ensure canonical date
        summary: `Full parser attempted but failed: ${errorMsg}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...stub.debug,
          fullError: errorMsg,
          fullErrorStack: fullError?.stack || undefined,
        },
      };
      await logVerifyResult(errorStub);
      return res.status(200).json(errorStub);
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
