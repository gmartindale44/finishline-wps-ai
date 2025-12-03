#!/usr/bin/env node
/**
 * Debug script to inspect real Google HTML for Laurel Park query
 */

const track = "Laurel Park";
const date = "2025-11-30";
const raceNo = "1";

const query = `${track} Race ${raceNo} ${date} results Win Place Show`;
const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

console.log("Fetching Google HTML for:");
console.log(`  Query: ${query}`);
console.log(`  URL: ${googleUrl}\n`);

try {
  const res = await fetch(googleUrl, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${res.statusText}`);
    process.exit(1);
  }

  const html = await res.text();
  console.log(`Fetched ${html.length} bytes of HTML\n`);

  // Look for HRN URLs
  console.log("=== Searching for HRN URLs ===\n");
  
  // Pattern 1: Direct URLs
  const directPattern = /https:\/\/entries\.horseracingnation\.com\/entries-results\/[^"'>\s]+\/\d{4}-\d{2}-\d{2}/gi;
  const directMatches = html.match(directPattern);
  if (directMatches) {
    console.log("Direct HRN URLs found:");
    directMatches.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url}`);
    });
  } else {
    console.log("No direct HRN URLs found");
  }

  // Pattern 2: URL-encoded in Google redirects
  const encodedPattern = /(?:url\?q=|href=)[^"'>]*entries-results[^"'>]*/gi;
  const encodedMatches = html.match(encodedPattern);
  if (encodedMatches) {
    console.log("\nEncoded HRN references found:");
    encodedMatches.slice(0, 5).forEach((match, i) => {
      console.log(`  ${i + 1}. ${match.substring(0, 200)}`);
      
      // Try to decode
      try {
        const decoded = decodeURIComponent(match.replace(/^[^=]*=/, "").replace(/&.*$/, ""));
        if (decoded.includes("entries-results")) {
          console.log(`      Decoded: ${decoded.substring(0, 200)}`);
        }
      } catch (e) {
        // Ignore decode errors
      }
    });
  } else {
    console.log("\nNo encoded HRN references found");
  }

  // Pattern 3: Look for any horseracingnation.com references
  const hrnAnyPattern = /horseracingnation\.com[^"'>\s]*/gi;
  const hrnAnyMatches = html.match(hrnAnyPattern);
  if (hrnAnyMatches) {
    console.log("\nAll HRN references found:");
    const unique = [...new Set(hrnAnyMatches)].slice(0, 10);
    unique.forEach((ref, i) => {
      console.log(`  ${i + 1}. ${ref}`);
    });
  }

  // Save a sample to file for inspection
  const fs = await import("fs");
  const sample = html.substring(0, 10000); // First 10KB
  fs.writeFileSync("tmp_google_sample.html", sample);
  console.log("\nSaved first 10KB to tmp_google_sample.html");

  // Look for specific patterns around HRN
  console.log("\n=== Searching for entries-results patterns ===\n");
  const entriesResultsPattern = /entries-results[^"'>\s]*/gi;
  const entriesMatches = html.match(entriesResultsPattern);
  if (entriesMatches) {
    const unique = [...new Set(entriesMatches)].slice(0, 10);
    unique.forEach((match, i) => {
      console.log(`  ${i + 1}. ${match}`);
    });
  } else {
    console.log("No 'entries-results' patterns found");
  }

} catch (err) {
  console.error("Error:", err);
  process.exit(1);
}

