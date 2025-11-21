// scripts/test-hrn-parser-aqueduct-r1.js
// Test script for HRN WPS parser using Aqueduct R1 example

import { parseHrnWpsOutcome } from "../lib/results.js";

// Minimal HTML snippet based on Aqueduct 2025-11-21 Race 1
// This approximates the Runner (Speed) table structure
// Structure: First column has program number (5, 2, 6, 3), Runner column has name, then Win/Place/Show
const testHtml = `
<table>
  <tr>
    <th></th>
    <th>Runner (Speed)</th>
    <th>Win</th>
    <th>Place</th>
    <th>Show</th>
  </tr>
  <tr>
    <td>5</td>
    <td>Atarah 103*</td>
    <td>$2.42</td>
    <td>$2.10</td>
    <td>$2.10</td>
  </tr>
  <tr>
    <td>2</td>
    <td>Sailaway 101*</td>
    <td>-</td>
    <td>$3.32</td>
    <td>$2.20</td>
  </tr>
  <tr>
    <td>6</td>
    <td>Helen's Revenge 100*</td>
    <td>-</td>
    <td>-</td>
    <td>$2.24</td>
  </tr>
  <tr>
    <td>3</td>
    <td>Looks First 91*</td>
    <td>-</td>
    <td>-</td>
    <td>-</td>
  </tr>
</table>
`;

console.log("Testing parseHrnWpsOutcome with Aqueduct R1 HTML snippet...\n");

const result = parseHrnWpsOutcome(testHtml);

console.log("Result:", JSON.stringify(result, null, 2));

const expected = { win: "5", place: "2", show: "6" };
const actual = result.outcome;

console.log("\nExpected:", JSON.stringify(expected));
console.log("Actual:", JSON.stringify(actual));

if (
  actual.win === expected.win &&
  actual.place === expected.place &&
  actual.show === expected.show
) {
  console.log("\n✅ Test PASSED: Outcome matches expected values");
  process.exit(0);
} else {
  console.log("\n❌ Test FAILED: Outcome does not match expected values");
  process.exit(1);
}

