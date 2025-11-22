// pages/api/verify_race.js
//
// Minimal, ultra-safe implementation.
// - No external network calls
// - No Redis / Upstash
// - No Equibase / HRN HTML parsing
// - Always returns HTTP 200 with structured JSON
// - Provides top.link for the "Open Top Result" button
// - Provides a non-empty summary box

export const config = {
  runtime: "nodejs",
};

/**
 * Safely parse the request body into a plain object.
 * Next.js usually parses JSON already, but we guard against strings/null.
 */
function safeParseBody(req) {
  const body = req.body;
  if (!body) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (typeof body === "object") {
    return body;
  }
  return {};
}

/**
 * Build a human-readable query for the race.
 * This is used only for constructing a Google search URL.
 */
function buildQuery({ track, date, raceNo }) {
  const parts = [];
  if (track) {
    parts.push(track);
  }
  if (raceNo) {
    parts.push(`Race ${raceNo}`);
  }
  if (date) {
    parts.push(date);
  }
  parts.push("results Win Place Show");
  return parts.join(" ");
}

/**
 * Build a Google search URL for the given query.
 */
function buildGoogleSearchUrl(query) {
  const base = "https://www.google.com/search";
  const qs = `q=${encodeURIComponent(query || "")}`;
  return `${base}?${qs}`;
}

/**
 * Normalize prediction object into a consistent shape.
 */
function normalizePredicted(predicted) {
  if (!predicted || typeof predicted !== "object") {
    return { win: "", place: "", show: "" };
  }
  return {
    win: String(predicted.win || "").trim(),
    place: String(predicted.place || "").trim(),
    show: String(predicted.show || "").trim(),
  };
}

/**
 * Core verify implementation (no direct try/catch here – wrapper handles it).
 */
async function verifyRace(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "POST") {
    // Always 200 – the UI expects a structured response even on errors.
    return res.status(200).json({
      ok: false,
      step: "verify_race_invalid_method",
      error: "Only POST is supported for verify_race.",
      date: null,
      track: null,
      raceNo: null,
      query: "",
      top: null,
      outcome: { win: "", place: "", show: "" },
      predicted: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary:
        "Step: verify_race_invalid_method\nError: Only POST is supported for verify_race.",
    });
  }

  const body = safeParseBody(req);
  const track = String(body.track || "").trim();
  const date = String(body.date || "").trim();
  const raceNo = String(body.raceNo || body.race || "").trim();
  const predicted = normalizePredicted(body.predicted);
  const query = buildQuery({ track, date, raceNo });
  const googleUrl = buildGoogleSearchUrl(query);

  const top = {
    title: `Google search: ${query}`,
    link: googleUrl,
  };

  // Since this minimal implementation does not scrape results,
  // outcome is intentionally empty. Hits are all false.
  const outcome = { win: "", place: "", show: "" };
  const hits = {
    winHit: false,
    placeHit: false,
    showHit: false,
    top3Hit: false,
  };

  const summaryLines = [
    `Using date: ${date || "(none)"}`,
    "Step: verify_race_google_only",
    "",
    `Query: ${query || "(none)"}`,
    `Top Result: ${top.title}`,
    `URL: ${top.link}`,
    "",
    "Outcome: (none)",
    "Hits: none",
    "",
    `Track: ${track || "(none)"}`,
    `Race #: ${raceNo || "(none)"}`,
  ];

  const summary = summaryLines.join("\n");

  return res.status(200).json({
    ok: true,
    step: "verify_race_google_only",
    date,
    track,
    raceNo,
    query,
    top,
    outcome,
    predicted,
    hits,
    summary,
  });
}

/**
 * Public API handler – bulletproof wrapper.
 * This MUST NEVER throw; all errors must be converted into a 200 response.
 */
export default async function handler(req, res) {
  try {
    await verifyRace(req, res);
  } catch (err) {
    // Last-resort safety net. This should not normally be hit,
    // but if it is, we still respond with a structured JSON object.
    console.error("[verify_race] UNHANDLED ERROR", err);
    return res.status(200).json({
      ok: false,
      step: "verify_race_unhandled_error",
      error: err ? String(err.message || err) : "Unknown error",
      date: null,
      track: null,
      raceNo: null,
      query: "",
      top: null,
      outcome: { win: "", place: "", show: "" },
      predicted: { win: "", place: "", show: "" },
      hits: { winHit: false, placeHit: false, showHit: false, top3Hit: false },
      summary:
        "[verify_race] Unhandled error in handler wrapper. See server logs for details.",
    });
  }
}
