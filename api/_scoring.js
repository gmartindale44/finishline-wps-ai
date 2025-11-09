// api/_scoring.js

// Deterministic feature scoring to stabilize picks and improve accuracy without extra tokens.

const ODDS_MULT = 1.0;       // Higher weight on market odds
const JOCKEY_BONUS = 0.75;   // Light bonus if jockey appears "notable"
const TRAINER_BONUS = 0.75;  // Light bonus if trainer appears "notable"
const NAME_PENALTY = 0.15;   // Tiny penalty for suspicious/unknown tokens

// Simple notability lists (can extend later or replace with embedded vectors)
const notableJockey = [
  "saez","prat","gallardo","rosario","velazquez","smith","riso","gomez","murphy","ortiz","reyes","torres","garcia","lopez","ramos","colon","mccarthy","morelos","pincay","west"
].map(s=>s.toLowerCase());

const notableTrainer = [
  "asmussen","cox","brown","pletcher","baffert","mott","rivali","boyce","campbell","deville","hartman","amoss","maker","walden","navarro","durkin","russell","harty","robb"
].map(s=>s.toLowerCase());

function fracOddsToImpl(oddsStr) {
  if (!oddsStr) return 0;           // unknown odds => neutral
  const m = String(oddsStr).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) return 0;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2] || 1);
  if (!b) return 0;
  // Lower implied probability => worse ; we invert later
  return b / (a + b); // implied probability (0..1)
}

function hasAny(term, bag) {
  const t = String(term||"").toLowerCase();
  return bag.some(k => t.includes(k));
}

export function scoreDeterministic(horses) {
  // returns [{name, detScore, features:{...}}]
  const rows = (horses||[]).map(h => {
    const p = fracOddsToImpl(h.odds || h.ml_odds);
    const jockeyHit = hasAny(h.jockey, notableJockey);
    const trainerHit = hasAny(h.trainer, notableTrainer);
    const badName = /scr|scratch|tbd|unknown|\?{2,}|^-$/.test(String(h.name||"").toLowerCase());

    // Higher is better
    const score =
      (ODDS_MULT * (p || 0.5)) +                    // market signal (default to neutral 0.5)
      (jockeyHit ? JOCKEY_BONUS : 0) +
      (trainerHit ? TRAINER_BONUS : 0) -
      (badName ? NAME_PENALTY : 0);

    return {
      name: h.name,
      detScore: score,
      features: { p, jockeyHit, trainerHit, badName }
    };
  });

  // Normalize to 0..1
  const maxS = Math.max(...rows.map(r=>r.detScore), 1e-6);
  rows.forEach(r => r.detNorm = Math.max(0, r.detScore / maxS));

  return rows.sort((a,b)=>b.detNorm-a.detNorm);
}

