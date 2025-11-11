import Head from "next/head";
import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

function readCtx() {
  if (typeof window === "undefined") return { track: "", raceNo: "" };
  const u = new URL(window.location.href);
  const track = u.searchParams.get("track") || "";
  const raceNo = u.searchParams.get("raceNo") || "";
  if (track) return { track, raceNo };
  try {
    const s = sessionStorage.getItem("fl:verify:ctx");
    if (s) return JSON.parse(s);
  } catch {}
  return { track: "", raceNo: "" };
}

export default function VerifyPage() {
  const [track, setTrack] = useState("");
  const [raceNo, setRaceNo] = useState("");
  const [status, setStatus] = useState("");
  const [raw, setRaw] = useState<any>(null);
  const [summary, setSummary] = useState("");

  useEffect(() => {
    const ctx = readCtx();
    if (ctx.track) setTrack(ctx.track);
    if (ctx.raceNo) setRaceNo(ctx.raceNo);
  }, []);

  const canRun = useMemo(() => track.trim().length > 0, [track]);

  async function runVerify() {
    if (!canRun) {
      setStatus("Track required");
      return;
    }
    setStatus("Running…");
    setRaw(null);
    setSummary("");

    const body: { track: string; raceNo?: string } = { track: track.trim() };
    if (raceNo.trim()) body.raceNo = raceNo.trim();
    try {
      const resp = await fetch("/api/verify_race", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json().catch(() => ({}));
      setStatus(resp.ok ? "OK" : `Error ${resp.status}`);
      setRaw(data);
      const parts: string[] = [];
      if ((data as any)?.query) parts.push(`<div><b>Query:</b> ${(data as any).query}</div>`);
      if ((data as any)?.top?.title) parts.push(`<div><b>Top Result:</b> ${(data as any).top.title}</div>`);
      if ((data as any)?.summary) parts.push(`<div>${(data as any).summary}</div>`);
      setSummary(parts.join("") || "<em>No summary returned.</em>");
    } catch (e: any) {
      setStatus("Error");
      setRaw({ error: String(e?.message || e) });
    }
  }

  return (
    <>
      <Head>
        <title>Verify • FinishLine WPS AI</title>
      </Head>

      <Script id="fl-verify-loader" src="/js/verify-loader.js?v=v2025-11-10-12" strategy="afterInteractive" />

      <main className="min-h-screen p-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold">Verify Race</h1>
            <a href="/" className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15">← Back</a>
          </div>

          <div className="rounded-2xl p-4 border border-white/10 bg-white/5">
            <div className="mb-2 text-sm opacity-80">
              <span>Status: </span>
              <span>{status || "Idle"}</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr,140px]">
              <div>
                <label className="block mb-1 opacity-90">Track <span className="text-yellow-300">*</span></label>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-white/10 bg-transparent"
                  value={track}
                  onChange={(e) => setTrack(e.target.value)}
                  placeholder="Track (pre-filled)"
                />
                {!track && <div className="text-yellow-300 text-sm mt-1">Enter/select a Track before verifying.</div>}
              </div>
              <div>
                <label className="block mb-1 opacity-90">Race # (optional)</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-white/10 bg-transparent"
                  value={raceNo}
                  onChange={(e) => setRaceNo(e.target.value)}
                  placeholder="e.g. 6"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={runVerify}
                className="px-4 py-2 rounded-lg font-semibold bg-[#6b46c1] text-white disabled:opacity-50"
                disabled={!canRun}
              >
                Verify Now
              </button>
              <div className="text-sm opacity-70">Track is required; Race # helps context.</div>
            </div>
          </div>

          <details className="mt-6 rounded-2xl p-4 border border-white/10 bg-white/5" open>
            <summary className="cursor-pointer opacity-90">Summary</summary>
            <div className="mt-2 prose prose-invert" dangerouslySetInnerHTML={{ __html: summary }} />
          </details>

          <details className="mt-4 rounded-2xl p-4 border border-white/10 bg-white/5">
            <summary className="cursor-pointer opacity-90">Raw</summary>
            <pre className="mt-2 max-h-[320px] overflow-auto text-xs">
              {raw ? JSON.stringify(raw, null, 2) : "—"}
            </pre>
          </details>
        </div>
      </main>
    </>
  );
}
