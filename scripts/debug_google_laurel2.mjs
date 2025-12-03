#!/usr/bin/env node
/**
 * More thorough search for HRN URLs in Google HTML
 */

const track = "Laurel Park";
const date = "2025-11-30";
const raceNo = "1";

const query = `${track} Race ${raceNo} ${date} results Win Place Show`;
const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

console.log("Fetching Google HTML...\n");

const res = await fetch(googleUrl, {
  method: "GET",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; FinishLineBot/1.0; +https://finishline-wps-ai.vercel.app)",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const html = await res.text();

// Look for any URL patterns that might contain HRN
console.log("=== Searching for URL patterns ===\n");

// Pattern 1: Look for /url?q= patterns (Google redirects)
const urlQPattern = /\/url\?q=([^&"'>]+)/gi;
const urlQMatches = [];
let match;
while ((match = urlQPattern.exec(html)) !== null) {
  try {
    const decoded = decodeURIComponent(match[1]);
    if (decoded.includes("horseracingnation") || decoded.includes("entries-results")) {
      urlQMatches.push(decoded);
    }
  } catch (e) {
    // Ignore decode errors
  }
}

if (urlQMatches.length > 0) {
  console.log("Found HRN URLs in /url?q= patterns:");
  urlQMatches.slice(0, 5).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
} else {
  console.log("No HRN URLs in /url?q= patterns");
}

// Pattern 2: Look for href="..." patterns
const hrefPattern = /href=["']([^"']+)["']/gi;
const hrefMatches = [];
while ((match = hrefPattern.exec(html)) !== null) {
  const url = match[1];
  if (url.includes("horseracingnation") || url.includes("entries-results")) {
    hrefMatches.push(url);
  }
}

if (hrefMatches.length > 0) {
  console.log("\nFound HRN URLs in href attributes:");
  hrefMatches.slice(0, 5).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
} else {
  console.log("\nNo HRN URLs in href attributes");
}

// Pattern 3: Look for data-ved or other Google-specific attributes
const dataPattern = /data-ved[^>]*href=["']([^"']+)["']/gi;
const dataMatches = [];
while ((match = dataPattern.exec(html)) !== null) {
  const url = match[1];
  if (url.includes("horseracingnation") || url.includes("entries-results")) {
    dataMatches.push(url);
  }
}

if (dataMatches.length > 0) {
  console.log("\nFound HRN URLs in data-ved href:");
  dataMatches.slice(0, 5).forEach((url, i) => {
    console.log(`  ${i + 1}. ${url}`);
  });
} else {
  console.log("\nNo HRN URLs in data-ved href");
}

// Pattern 4: Look for any text that mentions "entries-results" or "horseracingnation"
const textPattern = /[^"'>\s]*horseracingnation[^"'>\s]*/gi;
const textMatches = html.match(textPattern);
if (textMatches) {
  const unique = [...new Set(textMatches)].slice(0, 10);
  console.log("\nAll 'horseracingnation' text references:");
  unique.forEach((ref, i) => {
    console.log(`  ${i + 1}. ${ref.substring(0, 150)}`);
  });
}

// Try to find the actual HRN URL by constructing it
const trackSlug = track.toLowerCase().replace(/\s+/g, "-");
const expectedHrnUrl = `https://entries.horseracingnation.com/entries-results/${trackSlug}/${date}`;
console.log(`\nExpected HRN URL: ${expectedHrnUrl}`);
console.log(`Does HTML contain this URL? ${html.includes(expectedHrnUrl) ? "YES" : "NO"}`);
console.log(`Does HTML contain track slug '${trackSlug}'? ${html.includes(trackSlug) ? "YES" : "NO"}`);

