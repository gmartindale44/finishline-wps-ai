import fs from "fs";
import path from "path";
import { normalizeSurface } from "../lib/data-normalize.js";
const csvPath = path.join(process.cwd(), "data", "finishline_tests_v1.csv");
const headerExpected = "Test_ID,Track,Race_No,Surface,Distance,Confidence,Top_3_Mass,AI_Picks,Strategy,Result,ROI_Percent,WinRate,Notes";

const raw = fs.readFileSync(csvPath,"utf8").replace(/\r/g,"");
const lines = raw.trim().split("\n");
const header = lines.shift();
if (header !== headerExpected) {
  console.error("Header mismatch; refusing to edit.");
  process.exit(1);
}

function joinAsNotes(cols){
  const fixed = cols.slice(0,12);
  const tail = cols.slice(12).join(",");
  fixed.push(tail);
  return fixed;
}

function quoteIfNeeded(s){
  if (s == null) return "";
  const needsQuote = s.includes(",") || s.includes('"');
  if (!needsQuote) return s;
  return '"' + s.replace(/"/g,'""') + '"';
}

const out = [header];
let changed = 0, warnings = 0;

for (let i=0;i<lines.length;i++){
  let line = lines[i];
  let cols = line.split(",");

  if (cols.length < 13) {
    warnings++;
    while (cols.length < 13) cols.push("");
  } else if (cols.length > 13) {
    changed++;
    cols = joinAsNotes(cols);
  }

  cols = cols.slice(0,13);

  // Normalize surface values (e.g., remove stray punctuation, map aliases)
  const normalizedSurface = normalizeSurface(cols[3]);
  if (normalizedSurface !== cols[3]) {
    cols[3] = normalizedSurface;
    changed++;
  }

  const result = (cols[9]||"").trim();
  if (!result || !["Hit","Partial","Miss"].includes(result)) {
    if (result !== "Pending") {
      cols[9] = "Pending";
      changed++;
    }
  }

  let notes = cols[12] ?? "";
  notes = notes.trim();
  const alreadyQuoted = notes.startsWith('"') && notes.endsWith('"');
  if (!alreadyQuoted) {
    const q = quoteIfNeeded(notes);
    if (q !== notes) {
      cols[12] = q;
      changed++;
    } else {
      cols[12] = notes;
    }
  }

  out.push(cols.join(","));
}

fs.writeFileSync(csvPath, out.join("\n"));
console.log(`Sanitize complete. Changed rows: ${changed}, Warnings: ${warnings}`);
