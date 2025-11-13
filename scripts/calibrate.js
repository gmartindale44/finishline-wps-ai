import fs from "node:fs";
import path from "node:path";
import { loadMergedDataset } from "../lib/calibration/dataset.js";
import { buildCalibrationPayload } from "../lib/calibration/calibrateCore.js";

const OUTPUT_PATH = path.join(process.cwd(), "data", "calibration_v1.json");

function main() {
  try {
    const { rows, sourceCounts, meta } = loadMergedDataset({ silent: true });
    console.log(
      `[calibrate] dataset main_rows=${sourceCounts.main_rows} historical_rows=${sourceCounts.historical_rows} merged_rows=${sourceCounts.merged_rows} deduped=${sourceCounts.deduped}`
    );
    if (meta) {
      console.log(
        `[calibrate] skipped main=${meta.main?.skipped ?? 0} historical=${meta.historical?.skipped ?? 0}`
      );
    }
    const payload = buildCalibrationPayload(rows);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log(`[calibrate] Wrote calibration file to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error("[calibrate] Fatal:", err?.message || err);
    process.exit(1);
  }
}

main();
