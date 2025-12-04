// pages/api/calibration_verify_v1.js
// Read-only API route to serve verify v1 calibration report

import fs from "node:fs/promises";
import path from "node:path";

const REPORT_PATH = path.join(process.cwd(), "data", "calibration", "verify_v1_report.json");

export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      message: "Only GET requests are supported",
    });
  }

  try {
    // Read the report file
    const reportContent = await fs.readFile(REPORT_PATH, "utf8");
    const report = JSON.parse(reportContent);

    // Set caching headers
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");

    return res.status(200).json({
      ok: true,
      report,
    });
  } catch (error) {
    // File not found or other error
    if (error.code === "ENOENT") {
      return res.status(404).json({
        ok: false,
        error: "verify_v1_report_not_found",
        message: "Calibration report not found. Run 'npm run calibrate:verify-v1' to generate it.",
      });
    }

    // Other errors (parse errors, etc.)
    console.error("[calibration_verify_v1] Error reading report:", error);
    return res.status(500).json({
      ok: false,
      error: "read_error",
      message: error.message || "Failed to read calibration report",
    });
  }
}

