/**
 * Normalize OCR text into structured entries:
 * { horse, jockey, trainer, odds, speedFig }
 * Odds normalize to American-ish fractional (e.g., '3/1' -> 3).
 * Speed fig is number if present; else null.
 * Also capture `notes.alsoRans: string[]`.
 */
export function normalizeOcrTable(ocrText) {
  const lines = ocrText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  const alsoRans = [];
  let inAlsoRans = false;

  for (const line of lines) {
    if (/^Also\s+runs?:/i.test(line) || /^Also\s+rans?:/i.test(line)) {
      inAlsoRans = true;
      const names = line.split(':')[1]?.split(',').map(s => s.trim()).filter(Boolean) || [];
      alsoRans.push(...names);
      continue;
    }

    // Try to capture "Name (###*) ... odds"
    // Examples seen:
    // "Derek's Law (114*) ... Odds: 2/1"
    const nameMatch = line.match(/^([A-Za-z0-9' .()-]+?)(?:\s+\((\d+)\*?\))?/);
    if (!nameMatch) continue;

    const horse = nameMatch[1].trim();
    const speedFig = nameMatch[2] ? Number(nameMatch[2]) : null;

    const oddsMatch = line.match(/(\d+\s*\/\s*\d+)|(\d+\.\d+)|(\d+)/); // prefer fractional like 3/1
    let oddsRaw = oddsMatch ? oddsMatch[0].replace(/\s+/g, '') : null;

    const entry = {
      horse,
      jockey: null,
      trainer: null,
      odds: oddsRaw,     // keep raw; features.js will standardize
      speedFig,
    };
    entries.push(entry);
  }

  return { entries, notes: { alsoRans } };
}

