import Head from "next/head";
import { useEffect, useState } from "react";

type CalibrationStatus = {
  ok: boolean;
  csv_rows: number;
  params_exists: boolean;
  params_mtime: string | null;
  tau: number | null;
  bands: number | null;
  redis_pending: number;
  redis_resolved: number;
};

type CalibrationBinMetric = {
  bin: string;
  count: number;
  win_rate: number;
  top3_rate: number;
  avg_roi_atb2: number | null;
};

type GreenzonePattern = {
  track: string;
  raceId: string;
  raceNo?: string;
  score: number;
  matchTier: "Green" | "Amber" | "Red";
  suggested: string;
  note: string;
  confidence: number;
  top3Mass: number;
  gap12: number;
  gap23: number;
  profitLoss: number;
};

export default function CalibrationLabPage() {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [binMetrics, setBinMetrics] = useState<CalibrationBinMetric[] | null>(null);
  const [patterns, setPatterns] = useState<GreenzonePattern[] | null>(null);
  const [patternReason, setPatternReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/calibration_status");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as CalibrationStatus;
        if (!cancelled) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCalibrationSummary() {
      try {
        const res = await fetch("/data/calibration_v1.json", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled && Array.isArray(json?.bin_metrics)) {
          setBinMetrics(json.bin_metrics as CalibrationBinMetric[]);
        }
      } catch {
        if (!cancelled) {
          setBinMetrics([]);
        }
      }
    }

    async function loadGreenzonePatterns() {
      try {
        const res = await fetch("/api/greenzone_today", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        setPatterns(Array.isArray(json?.suggestions) ? json.suggestions : []);
        if (json?.reason) {
          setPatternReason(String(json.reason));
        } else {
          setPatternReason(null);
        }
      } catch (err) {
        if (!cancelled) {
          setPatterns([]);
          setPatternReason((err as Error)?.message || "not_enough_data_yet");
        }
      }
    }

    loadCalibrationSummary();
    loadGreenzonePatterns();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasData = Boolean(status && status.ok && (status.csv_rows || status.redis_pending || status.redis_resolved));

  return (
    <>
      <Head>
        <title>Calibration Lab • FinishLine WPS AI</title>
      </Head>
      <main className="min-h-screen p-6 bg-slate-950 text-slate-100">
        <div className="max-w-4xl mx-auto space-y-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold">Calibration Lab (Preview)</h1>
            <p className="text-sm text-slate-300">
              Quick snapshot of calibration datasets and Redis reconciliation status. Advanced analytics are coming soon.
            </p>
          </header>

          {!hasData && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <h2 className="text-lg font-medium mb-2">Status</h2>
              <p className="text-sm text-slate-300">
                {error
                  ? `No calibration data yet (${error}).`
                  : "No calibration data yet. Run more Verify sessions or backfill historical races to populate this dashboard."}
              </p>
            </section>
          )}

          {hasData && status && (
            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-lg font-medium mb-2">Dataset</h2>
                <ul className="text-sm text-slate-200 space-y-1">
                  <li>CSV rows: <strong>{status.csv_rows}</strong></li>
                  <li>
                    Model params:{" "}
                    {status.params_exists ? (
                      <span>
                        present
                        {status.params_mtime ? ` (updated ${new Date(status.params_mtime).toLocaleString()})` : ""}
                      </span>
                    ) : (
                      "missing"
                    )}
                  </li>
                  <li>Tau: {status.tau ?? "—"}</li>
                  <li>Confidence bands: {status.bands ?? "—"}</li>
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h2 className="text-lg font-medium mb-2">Redis Reconciliation</h2>
                <ul className="text-sm text-slate-200 space-y-1">
                  <li>Pending predictions: <strong>{status.redis_pending}</strong></li>
                  <li>Resolved predictions: <strong>{status.redis_resolved}</strong></li>
                </ul>
              </div>
            </section>
          )}

          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="text-lg font-medium mb-2">GreenZone Intelligence</h2>
            <p className="text-xs text-slate-300 mb-4">
              GreenZone scoring blends model confidence, Top-3 mass, historical ROI per confidence band, and learned signal/strategy weights.
            </p>

            {binMetrics && binMetrics.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-left">
                  <thead className="text-slate-300">
                    <tr>
                      <th className="px-3 py-2 font-medium">Bin</th>
                      <th className="px-3 py-2 font-medium">Count</th>
                      <th className="px-3 py-2 font-medium">Win%</th>
                      <th className="px-3 py-2 font-medium">Top3%</th>
                      <th className="px-3 py-2 font-medium">Avg ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {binMetrics.map((metric) => {
                      const roi = metric.avg_roi_atb2;
                      const positive = typeof roi === "number" && roi > 0;
                      const negative = typeof roi === "number" && roi < 0;
                      const roiClass = positive
                        ? "text-emerald-300"
                        : negative
                        ? "text-rose-300"
                        : "text-slate-200";
                      return (
                        <tr key={metric.bin} className="border-t border-white/5">
                          <td className="px-3 py-2 font-medium text-slate-100">{metric.bin}</td>
                          <td className="px-3 py-2">{metric.count}</td>
                          <td className="px-3 py-2">{metric.win_rate.toFixed(3)}</td>
                          <td className="px-3 py-2">{metric.top3_rate.toFixed(3)}</td>
                          <td className={`px-3 py-2 ${roiClass}`}>
                            {roi === null ? "—" : roi.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-300">
                No calibration summary yet — run the verification pipeline or backfill historical data to populate these metrics.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Sample GreenZone Patterns</h2>
              {patternReason && (
                <span className="text-xs text-slate-400">{patternReason.replace(/_/g, " ")}</span>
              )}
            </div>
            {patterns && patterns.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {patterns.slice(0, 10).map((pattern) => (
                  <article
                    key={pattern.raceId}
                    className="rounded-xl border border-white/10 bg-slate-900/70 p-4 space-y-2"
                  >
                    <header className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">
                          {pattern.track} {pattern.raceNo ? `R${pattern.raceNo}` : ""}
                        </p>
                        <p className="text-xs text-slate-400">{pattern.raceId}</p>
                      </div>
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          pattern.matchTier === "Green"
                            ? "bg-emerald-500/20 text-emerald-200"
                            : pattern.matchTier === "Amber"
                            ? "bg-amber-500/20 text-amber-200"
                            : "bg-rose-500/20 text-rose-200"
                        }`}
                      >
                        {pattern.matchTier}
                      </span>
                    </header>
                    <dl className="grid grid-cols-2 gap-y-2 text-xs text-slate-300">
                      <div>
                        <dt className="text-slate-400">Confidence</dt>
                        <dd>{pattern.confidence.toFixed(1)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Top-3 Mass</dt>
                        <dd>{pattern.top3Mass.toFixed(1)}</dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Gaps</dt>
                        <dd>
                          {pattern.gap12.toFixed(2)} / {pattern.gap23.toFixed(2)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400">Profit</dt>
                        <dd className={pattern.profitLoss > 0 ? "text-emerald-300" : "text-slate-200"}>
                          {pattern.profitLoss.toFixed(2)}
                        </dd>
                      </div>
                    </dl>
                    <footer className="text-xs text-slate-200">
                      <p>
                        Suggested: <strong>{pattern.suggested}</strong> • Score {pattern.score}
                      </p>
                      <p className="text-slate-400">{pattern.note}</p>
                    </footer>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-300">
                No strong GreenZone exemplars yet. Populate the dataset via Verify or historical backfill to unlock pattern insights.
              </p>
            )}
          </section>

          <footer className="text-xs text-slate-400">
            Calibration Lab v0.1 — Metrics update automatically when Verify logs are ingested.
          </footer>
        </div>
      </main>
    </>
  );
}


