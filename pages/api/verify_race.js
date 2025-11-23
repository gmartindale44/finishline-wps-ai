// pages/api/verify_race.js
// Feature-flagged verify_race handler with ultra-safe stub fallback
// - Default: stub mode (parses Google HTML for Win/Place/Show, always returns 200)
// - Full mode: CSE + HRN + Equibase parsing (enabled via VERIFY_RACE_MODE=full)
// - Always falls back to stub on any error

export const config = {
  runtime: "nodejs",
};

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
  // Import canonical date helper
  const { getCanonicalRaceDate } = await import("../../lib/verify_race_full.js");
  
  // Use canonical date (normalized from user input, no timezone shifts)
  const usingDate = getCanonicalRaceDate(date);
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
    
    // Extract and normalize race date from request body
    // Single source of truth: request date if provided, otherwise today
    const { getCanonicalRaceDate } = await import("../../lib/verify_race_full.js");
    
    // Extract raw date from request
    const rawDate = typeof body.date === "string" && body.date.trim()
      ? body.date.trim()
      : (typeof body.raceDate === "string" && body.raceDate.trim()
          ? body.raceDate.trim()
          : null);
    
    // DEBUG: Log date values at handler entry
    console.log('[VERIFY_API] rawDate from body:', rawDate);
    console.log('[VERIFY_API] body.date:', body.date);
    console.log('[VERIFY_API] body.raceDate:', body.raceDate);
    
    // Normalize to canonical ISO format (YYYY-MM-DD)
    // Only falls back to today if rawDate is null/undefined/empty
    const effectiveDateIso = getCanonicalRaceDate(rawDate);
    
    // DEBUG: Log normalized date
    console.log('[VERIFY_API] effectiveDateIso after canonicalization:', effectiveDateIso);
    
    const raceNo = (body.raceNo || body.race || "").toString().trim() || "";
    const predicted = body.predicted || {};

    // Build context with canonical date - this is the single source of truth
    const context = { track, date: effectiveDateIso, raceNo, predicted };

    // Read feature flag INSIDE the handler (not at top level)
    const mode = (process.env.VERIFY_RACE_MODE || "stub").toLowerCase().trim();

    // If not in full mode, immediately return stub
    if (mode !== "full") {
      const stub = await buildStubResponse(context);
      return res.status(200).json(stub);
    }

    // Full mode: attempt to use the full parser
    try {
      // Dynamic import to avoid loading the module if not needed
      // However, since we're already in full mode, we can use static import
      // But to be extra safe, we'll wrap it in try/catch
      const { runFullVerifyRace } = await import("../../lib/verify_race_full.js");

      const fullResult = await runFullVerifyRace({
        ...context,
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
          date: fullResult.date || effectiveDateIso, // Use canonical date
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
              buildGoogleSearchUrl({ track, date: effectiveDateIso, raceNo }).url,
          },
        };

        return res.status(200).json(validatedResult);
      }

      // If step is "verify_race_full_fallback", use full result but ensure date is canonical
      if (fullResult.step === "verify_race_full_fallback") {
        console.warn("[verify_race] Full parser returned fallback", {
          step: fullResult.step,
          query: fullResult.query,
        });
        // Use full result but ensure date field is canonical
        return res.status(200).json({
          ...fullResult,
          date: fullResult.date || effectiveDateIso, // Ensure canonical date
        });
      }

      // Any other step (error cases) - fall back to stub with canonical date
      console.warn("[verify_race] Full parser returned unexpected step, falling back to stub", {
        step: fullResult.step,
      });
      const stub = await buildStubResponse(context);
      return res.status(200).json({
        ...stub,
        step: "verify_race_full_fallback",
        date: effectiveDateIso, // Ensure canonical date
        summary: `Full parser attempted but failed: step=${fullResult.step}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...stub.debug,
          fullError: `Full parser step: ${fullResult.step}`,
        },
      });
    } catch (fullError) {
      // Log error and fall back to stub
      console.error("[verify_race] Full parser failed, falling back to stub", {
        error: fullError?.message || String(fullError),
        stack: fullError?.stack,
        track,
        date: effectiveDateIso,
        raceNo,
      });

      const stub = await buildStubResponse(context);
      const errorMsg = fullError?.message || String(fullError);
      return res.status(200).json({
        ...stub,
        step: "verify_race_full_fallback",
        date: effectiveDateIso, // Ensure canonical date
        summary: `Full parser attempted but failed: ${errorMsg}. Using stub fallback (Google search only).\n${stub.summary}`,
        debug: {
          ...stub.debug,
          fullError: errorMsg,
          fullErrorStack: fullError?.stack || undefined,
        },
      });
    }
  } catch (err) {
    // Absolute last-resort catch; still return 200.
    console.error("[verify_race] UNEXPECTED ERROR", err);
    // Use canonical date even in error case if available
    const { getCanonicalRaceDate } = await import("../../lib/verify_race_full.js");
    const errorDateIso = getCanonicalRaceDate(null); // Falls back to today
    const stub = await buildStubResponse({
      track: null,
      date: errorDateIso,
      raceNo: null,
    });
    return res.status(200).json({
      ...stub,
      ok: false,
      step: "verify_race_stub_unexpected_error",
      error: String(err && err.message ? err.message : err),
      summary: "Verify Race stub encountered an unexpected error, but the handler still returned 200.",
    });
  }
}
