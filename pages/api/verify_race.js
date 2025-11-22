// pages/api/verify_race.js

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

export default async function handler(req, res) {
  // We NEVER throw from this handler. All errors are reported in the JSON body.
  try {
    if (req.method !== "POST") {
      return res.status(200).json({
        ok: false,
        step: "verify_race_stub",
        error: "METHOD_NOT_ALLOWED",
        message: `Expected POST, received ${req.method}`,
        outcome: { win: "", place: "", show: "" },
        hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
        summary: `Verify Race stub: method ${req.method} is not supported.`,
        debug: {
          googleUrl: null,
        },
      });
    }

    const body = await safeParseBody(req);
    const track = (body.track || body.trackName || "").trim();
    const date = (body.date || body.raceDate || "").trim();
    const raceNo = (body.raceNo || body.race || "").toString().trim() || "";

    const { query, url: googleUrl } = buildGoogleSearchUrl({ track, date, raceNo });

    const now = new Date();
    const usingDate = date || now.toISOString().slice(0, 10);

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

    return res.status(200).json({
      ok: true,
      step: "verify_race_google_only_stub",
      date: usingDate,
      track,
      raceNo,
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
        win: body.win || "",
        place: body.place || "",
        show: body.show || "",
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
    });
  } catch (err) {
    // Absolute last-resort catch; still return 200.
    console.error("[verify_race_stub] UNEXPECTED ERROR", err);
    return res.status(200).json({
      ok: false,
      step: "verify_race_stub_unexpected_error",
      error: String(err && err.message ? err.message : err),
      outcome: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary: "Verify Race stub encountered an unexpected error, but the handler still returned 200.",
      debug: {
        googleUrl: null,
      },
    });
  }
}
