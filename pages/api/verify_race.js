// pages/api/verify_race.js
// Feature-flagged verify_race handler with ultra-safe stub fallback
// - Default: stub mode (no external APIs, always returns 200)
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
 * Build stub response (ultra-safe fallback)
 * This is the default behavior when VERIFY_RACE_MODE is not set to "full"
 */
function buildStubResponse({ track, date, raceNo, predicted = {} }) {
  const safeTrack = (track || "").trim();
  const safeDate = (date || "").trim();
  const safeRaceNo = raceNo ? String(raceNo).trim() : "";

  const { query, url: googleUrl } = buildGoogleSearchUrl({
    track: safeTrack,
    date: safeDate,
    raceNo: safeRaceNo,
  });

  const now = new Date();
  const usingDate = safeDate || now.toISOString().slice(0, 10);

  const summaryLines = [
    `Using date: ${usingDate}`,
    `Step: verify_race_google_only_stub`,
    `Query: ${query}`,
    `Top Result: Google search (see Open Top Result button).`,
    `Outcome: (none)`,
    `Hits: (none)`,
    "",
    "Ultra-safe stub: no external APIs. This is a placeholder implementation to keep the app stable while the full parser is being repaired.",
  ];

  return {
    ok: true,
    step: "verify_race_google_only_stub",
    date: usingDate,
    track: safeTrack,
    raceNo: safeRaceNo,
    query,
    top: {
      title: `Google search: ${query}`,
      link: googleUrl,
    },
    outcome: {
      win: "",
      place: "",
      show: "",
    },
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
    summary: summaryLines.join("\n"),
    debug: {
      googleUrl,
    },
  };
}

export default async function handler(req, res) {
  // We NEVER throw from this handler. All errors are reported in the JSON body.
  try {
    if (req.method !== "POST") {
      const stub = buildStubResponse({ track: null, date: null, raceNo: null });
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
    const date = (body.date || body.raceDate || "").trim();
    const raceNo = (body.raceNo || body.race || "").toString().trim() || "";
    const predicted = body.predicted || {};

    // Build context for full parser or stub
    const context = { track, date, raceNo, predicted };

    // Read feature flag INSIDE the handler (not at top level)
    const mode = (process.env.VERIFY_RACE_MODE || "stub").toLowerCase().trim();

    // If not in full mode, immediately return stub
    if (mode !== "full") {
      const stub = buildStubResponse(context);
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

      // Ensure all required fields are present
      const validatedResult = {
        ok: fullResult.ok !== undefined ? fullResult.ok : false,
        step: fullResult.step || "verify_race",
        date: fullResult.date || date || "",
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
          googleUrl:
            fullResult.debug?.googleUrl ||
            buildGoogleSearchUrl({ track, date, raceNo }).url,
        },
      };

      return res.status(200).json(validatedResult);
    } catch (fullError) {
      // Log error and fall back to stub
      console.error("[verify_race] Full parser failed, falling back to stub", {
        error: fullError?.message || String(fullError),
        stack: fullError?.stack,
        track,
        date,
        raceNo,
      });

      const stub = buildStubResponse(context);
      return res.status(200).json({
        ...stub,
        step: "verify_race_full_fallback",
        summary: `Full parser attempted but failed: ${fullError?.message || String(fullError)}. Falling back to stub.`,
      });
    }
  } catch (err) {
    // Absolute last-resort catch; still return 200.
    console.error("[verify_race] UNEXPECTED ERROR", err);
    const stub = buildStubResponse({
      track: null,
      date: null,
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
