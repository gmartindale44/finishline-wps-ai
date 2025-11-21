// pages/api/verify_race.js
// STAGE 1: Safe core parsing and normalization (no external dependencies)

export default async function handler(req, res) {
  try {
    const { track, date, raceNo, race_no, predicted } = req.body || {};

    const safe = {
      track: track || "",
      date: date || "",
      raceNo: raceNo || race_no || "",
      predicted: predicted || {},
    };

    // Basic normalization (matches original code's behavior)
    const norm = (x) => (x || "").trim().toLowerCase().replace(/\s+/g, "-");

    const normalizedTrack = norm(safe.track);

    // Construct the HRN entries/results URL we would normally scrape
    const targetUrl = `https://entries.horseracingnation.com/entries-results/${normalizedTrack}/${safe.date}`;

    return res.status(200).json({
      ok: true,
      step: "stage1",
      received: safe,
      normalizedTrack,
      targetUrl,
    });
  } catch (err) {
    console.error("[verify_race stage1 error]", err);
    return res.status(500).json({
      ok: false,
      step: "stage1",
      error: String(err?.message || err),
    });
  }
}
