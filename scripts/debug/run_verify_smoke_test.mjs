// Use global fetch (Node 18+)
const BASE = process.env.FINISHLINE_VERIFY_BASE_URL || "https://finishline-wps-ai.vercel.app";

const tests = [
  { track: "Laurel Park", race: 1, date: "2025-11-30" },
  { track: "Parx Racing", race: 3, date: "2025-12-01" },
  { track: "Turf Paradise", race: 2, date: "2025-12-02" },
  { track: "Zia Park", race: 2, date: "2025-12-02" },
  // Today's date auto-test
  {
    track: "Turf Paradise",
    race: 4,
    date: new Date().toISOString().slice(0, 10)
  }
];

async function runOne(t) {
  const url = `${BASE}/api/verify_race`;
  const dateRaw = t.date.replace(/-/g, "/");
  const payload = {
    track: t.track,
    raceNo: String(t.race),
    date: t.date,
    dateIso: t.date,
    dateRaw,
  };

  console.log("\n==============================");
  console.log(`Test: ${t.track} — Race ${t.race} — ${t.date}`);
  console.log("URL:", url);
  console.log("Payload:", JSON.stringify(payload));

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const txt = await res.text();

    console.log("HTTP:", res.status);
    console.log("Raw:", txt);

    let json;
    try { json = JSON.parse(txt); }
    catch (e) {
      console.log("Not JSON:", e.message);
      return;
    }

    console.log("ok:", json.ok);
    console.log("step:", json.step);
    console.log("outcome:", json.outcome);
    console.log("debug:", json.debug);

  } catch (err) {
    console.log("ERROR:", err.message);
  }
}

async function main() {
  for (const t of tests) {
    await runOne(t);
  }
  console.log("\n🎉 Smoke test finished\n");
}

main();

