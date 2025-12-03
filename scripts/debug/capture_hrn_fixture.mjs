#!/usr/bin/env node
/**
 * Capture live HRN HTML into a fixture file for parser testing
 * Usage: node scripts/debug/capture_hrn_fixture.mjs <trackSlug> <dateIso> <raceNo>
 * Example: node scripts/debug/capture_hrn_fixture.mjs zia-park 2025-12-02 2
 */

import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get args from command line
const [, , trackSlug, dateIso, raceNo] = process.argv;

if (!trackSlug || !dateIso || !raceNo) {
  console.error("Usage: node scripts/debug/capture_hrn_fixture.mjs <trackSlug> <dateIso> <raceNo>");
  console.error("Example: node scripts/debug/capture_hrn_fixture.mjs zia-park 2025-12-02 2");
  process.exit(1);
}

// Build HRN URL (same logic as buildHrnUrl in verify_race.js)
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

async function main() {
  try {
    // Build URL (if trackSlug is already a slug, use it directly; otherwise normalize)
    const hrnUrl = buildHrnUrl(trackSlug, dateIso);
    
    if (!hrnUrl) {
      console.error(`Failed to build HRN URL from trackSlug="${trackSlug}", dateIso="${dateIso}"`);
      process.exit(1);
    }
    
    console.log(`[capture_hrn_fixture] Fetching: ${hrnUrl}`);
    
    // Fetch with same headers as handler
    const res = await fetch(hrnUrl, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    
    if (!res.ok) {
      console.error(`[capture_hrn_fixture] HTTP ${res.status}: ${res.statusText}`);
      process.exit(1);
    }
    
    const html = await res.text();
    const htmlLength = html.length;
    const hasPayoutTable = html.includes("table-payouts");
    
    console.log(`[capture_hrn_fixture] HTML length: ${htmlLength}`);
    console.log(`[capture_hrn_fixture] Has table-payouts: ${hasPayoutTable}`);
    
    // Create fixtures directory if it doesn't exist
    const fixturesDir = join(__dirname, "fixtures");
    await mkdir(fixturesDir, { recursive: true });
    
    // Save fixture
    const fixturePath = join(fixturesDir, `hrn_${trackSlug}_${dateIso}_r${raceNo}.html`);
    await writeFile(fixturePath, html, "utf-8");
    
    console.log(`[capture_hrn_fixture] ✅ Saved to: ${fixturePath}`);
    console.log(`[capture_hrn_fixture] File size: ${htmlLength} bytes`);
    
  } catch (err) {
    console.error(`[capture_hrn_fixture] Error:`, err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

