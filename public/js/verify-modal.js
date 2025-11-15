/* public/js/verify-modal.js — GreenZone Lab v2 */

;(() => {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__FL_VERIFY_MODAL__) return;
  window.__FL_VERIFY_MODAL__ = true;
  if (window.__flVerifyDebug === undefined) window.__flVerifyDebug = false;

  const qs = (selector, root = document) => root.querySelector(selector);

  const todayISO = () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  function readUIPredictions() {
    try {
      const scope =
        document.querySelector('[data-panel="predictions"], .predictions-panel') ||
        document;
      const picks = { win: "", place: "", show: "" };
      const cards = Array.from(scope.querySelectorAll(".prediction-card, [data-pick]"));
      if (cards.length >= 3) {
        const names = cards.slice(0, 3).map((card) => {
          const el = card.querySelector("[data-name], .title, .name, b, strong");
          return ((el && el.textContent) || "").trim();
        });
        picks.win = names[0] || "";
        picks.place = names[1] || "";
        picks.show = names[2] || "";
        return picks;
      }
      const fetchText = (selector) =>
        (scope.querySelector(selector)?.textContent || "").trim();
      picks.win = fetchText("[data-pick='win'], .pick-win b, .emoji-win~b");
      picks.place = fetchText("[data-pick='place'], .pick-place b, .emoji-place~b");
      picks.show = fetchText("[data-pick='show'], .pick-show b, .emoji-show~b");
      return picks;
    } catch {
      return { win: "", place: "", show: "" };
    }
  }

  function readCtx() {
    try {
      const raw = sessionStorage.getItem("fl:verify:ctx");
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return {};
  }

  const getTopTrack = () =>
    qs("input[placeholder*='track' i]") ||
    qs("input[id*='track' i]") ||
    qs("input[name*='track' i]");

  const getTopRace = () =>
    qs("input[placeholder*='race' i]") ||
    qs("input[id*='race' i]") ||
    qs("input[name*='race' i]");

  const currentTrack = () => (getTopTrack()?.value || "").trim();
  const currentRaceNo = () => (getTopRace()?.value || "").trim();

  function pushSnapshot(track, raceNo, picks) {
    try {
      if (!track) return;
      const r = raceNo || "nr";
      const dayKey = todayISO();
      const key = `fl:snap:${dayKey}:${track}:${r}`;
      const payload = {
        ts: Date.now(),
        date: dayKey,
        track,
        raceNo: raceNo || "",
        signals: {
          confidence: null,
          top3Mass: null,
          gap12: 0,
          gap23: 0,
        },
        picks,
      };
      sessionStorage.setItem(key, JSON.stringify(payload));
    } catch {
      /* ignore snapshot errors */
    }
  }

  function renderSummary(summaryEl, data) {
    if (!summaryEl) return;
    if (!data) data = {};

    const lines = [];
    if (data.date) {
      lines.push(`Using date: ${data.date}`);
    }
    if (data.query) lines.push(`Query: ${data.query}`);

    if (data.outcome) {
      const parts = [];
      if (data.outcome.win) parts.push(`Win: ${data.outcome.win}`);
      if (data.outcome.place) parts.push(`Place: ${data.outcome.place}`);
      if (data.outcome.show) parts.push(`Show: ${data.outcome.show}`);
      if (parts.length) lines.push(parts.join(" • "));
    }

    const top = data && data.top;
    if (top && top.title) {
      lines.push(`Top Result: ${top.title}${top.link ? `\n${top.link}` : ""}`);
    }

    if (data && data.hits) {
      const hitParts = [];
      if (data.hits.winHit) hitParts.push("Win");
      if (data.hits.placeHit) hitParts.push("Place");
      if (data.hits.showHit) hitParts.push("Show");
      if (hitParts.length) lines.push(`Hits: ${hitParts.join(", ")}`);
    }

    if (data.summary && typeof data.summary === "string") {
      lines.push(data.summary);
    }

    // Always show error info if present (not just when no other lines)
    if (data.error) lines.push(`Error: ${data.error}`);
    if (data.details && data.details !== data.error) {
      lines.push(`Details: ${data.details}`);
    }
    if (data.step) lines.push(`Step: ${data.step}`);

    summaryEl.textContent = lines.join("\n") || "No summary returned.";
  }

  function renderGreenZone(host, payload) {
    const tableWrap = qs("#flv-gz-table", host);
    const msgEl = qs("#flv-gz-message", host);
    const debugEl = qs("#flv-gz-json", host);

    if (!tableWrap || !msgEl || !debugEl) return;

    const suggestions = Array.isArray(payload?.suggestions)
      ? payload.suggestions
      : [];

    try {
      debugEl.textContent = JSON.stringify(payload ?? {}, null, 2);
    } catch {
      debugEl.textContent = String(payload ?? "");
    }

    if (!suggestions.length) {
      msgEl.innerHTML =
        "Not enough data yet to identify GreenZone races. Capture more verified races to unlock suggestions.";
      tableWrap.innerHTML = "";
      return;
    }

    const rows = suggestions
      .map((sug) => {
        const track = sug.track || "—";
        const race = sug.raceNo ? `#${sug.raceNo}` : "—";
        const score = Number.isFinite(Number(sug.score))
          ? String(Math.round(Number(sug.score)))
          : "—";
        const tier = sug.matchTier || "—";
        const suggested = sug.suggested || "ATB";
        return `
          <tr>
            <td style="padding:6px;border-top:1px solid rgba(255,255,255,.12)">${track}</td>
            <td style="padding:6px;border-top:1px solid rgba(255,255,255,.12)">${race}</td>
            <td style="padding:6px;border-top:1px solid rgba(255,255,255,.12)">${score}</td>
            <td style="padding:6px;border-top:1px solid rgba(255,255,255,.12)">${tier}</td>
            <td style="padding:6px;border-top:1px solid rgba(255,255,255,.12)">${suggested}</td>
          </tr>`;
      })
      .join("");

    tableWrap.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font:12px system-ui">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px;opacity:.8">Track</th>
            <th style="text-align:left;padding:6px;opacity:.8">Race</th>
            <th style="text-align:left;padding:6px;opacity:.8">Score</th>
            <th style="text-align:left;padding:6px;opacity:.8">Match Tier</th>
            <th style="text-align:left;padding:6px;opacity:.8">Suggested</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    const counts = suggestions.reduce(
      (acc, sug) => {
        const key = sug.suggested || "Other";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {}
    );

    const summaryText = Object.entries(counts)
      .map(([label, count]) => `${label} ${count}`)
      .join(" • ");

    msgEl.innerHTML = `<b>Suggested Bets (Today):</b> ${summaryText}`;
  }

  async function refreshGreenZone(host) {
    const msgEl = qs("#flv-gz-message", host);
    if (msgEl) msgEl.textContent = "Loading…";

    try {
      const res = await fetch("/api/greenzone_today", { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json().catch(() => ({}));
      renderGreenZone(host, json);
    } catch (error) {
      if (window.__flVerifyDebug) {
        console.error("[Verify Modal] GreenZone fetch failed", error);
      }
      renderGreenZone(host, { suggestions: [] });
    }
  }

  function buildModal() {
    let host = qs("#fl-verify-modal-host");
    if (host) return host;

    host = document.createElement("div");
    host.id = "fl-verify-modal-host";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.5)";

    host.innerHTML = `
      <div role="dialog" aria-modal="true" class="flv-card" style="width:min(900px,96vw);max-height:90vh;overflow:auto;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.98);backdrop-filter:blur(8px);padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <h3 style="margin:0;font:600 22px/1.2 system-ui">Verify Race</h3>
          <button id="flv-close" style="border:none;background:transparent;color:inherit;font:600 18px;opacity:.8;cursor:pointer">✕</button>
        </div>

        <div id="flv-status" style="font:600 13px/1.2 system-ui;opacity:.85;margin-bottom:12px">Idle</div>

        <div style="display:grid;gap:10px;margin-bottom:14px;grid-template-columns:1.4fr 0.6fr 0.9fr;">
          <label style="display:block">
            <div style="margin-bottom:6px;opacity:.9">Track <span style="color:#ffcc00">*</span></div>
            <input id="flv-track" type="text" placeholder="Track"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.15);color:inherit"/>
            <small id="flv-track-warn" style="display:none;color:#ffcc00">Track is required.</small>
          </label>

          <label style="display:block">
            <div style="margin-bottom:6px;opacity:.9">Race # (optional)</div>
            <input id="flv-race" type="text" placeholder="e.g. 6"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.15);color:inherit"/>
            <small id="flv-race-warn" style="display:none;color:#ffcc00">Server asked for a Race # — please add one.</small>
          </label>

          <label style="display:block">
            <div style="margin-bottom:6px;opacity:.9">Date</div>
            <input id="flv-date" type="date"
              style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.15);color:inherit"/>
          </label>
        </div>

        <div style="display:flex;gap:10px;align-items:center;margin:14px 0;flex-wrap:wrap">
          <button id="flv-run" style="padding:10px 18px;border-radius:12px;border:none;background:#6b46c1;color:#fff;font-weight:700;cursor:pointer">Verify Now</button>
          <button id="flv-open-top" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;cursor:pointer">Open Top Result</button>
          <button id="flv-open-google" style="padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;cursor:pointer">Open Google (debug)</button>
          <small style="opacity:.75">Track &amp; Date required; Race # helps context.</small>
        </div>

        <details id="flv-sum" open>
          <summary style="cursor:pointer;opacity:.9">Summary</summary>
          <pre id="flv-sum-body" style="white-space:pre-wrap;margin-top:8px;max-height:240px;overflow:auto;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);font:12px/1.5 ui-monospace, Menlo, Consolas">No summary returned.</pre>
        </details>

        <details id="flv-gz-details" style="margin-top:14px;">
          <summary style="cursor:pointer;opacity:.9">GreenZone Data</summary>
          <div id="flv-gz-wrap" style="margin-top:10px;">
            <div id="flv-gz-message" style="font:12px/1.4 system-ui;opacity:.8">Loading…</div>
            <div id="flv-gz-table" style="margin-top:10px;"></div>
            <div style="margin-top:10px;opacity:.55;font-size:11px;">Debug JSON (latest suggestions)</div>
            <pre id="flv-gz-json" style="white-space:pre-wrap;margin-top:6px;max-height:220px;overflow:auto;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.4);font:11px/1.5 ui-monospace, Menlo, Consolas">[]</pre>
          </div>
        </details>
      </div>
    `;

    document.body.appendChild(host);
    host.__flvLast = { top: null, query: "" };

    qs("#flv-close", host)?.addEventListener("click", () => {
      host.style.display = "none";
    });

    const runBtn = qs("#flv-run", host);
    const statusEl = qs("#flv-status", host);
    const summaryEl = qs("#flv-sum-body", host);
    const warnTrack = qs("#flv-track-warn", host);
    const warnRace = qs("#flv-race-warn", host);
    const trackInput = qs("#flv-track", host);
    const raceInput = qs("#flv-race", host);
    const dateInput = qs("#flv-date", host);

    if (dateInput && !dateInput.value) {
      dateInput.value = todayISO();
    }

    if (runBtn) {
      const defaultLabel = runBtn.textContent || "Verify Now";
      runBtn.addEventListener("click", async () => {
        const track = (trackInput?.value || "").trim();
        const raceNo = (raceInput?.value || "").trim();
        let date = (dateInput?.value || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          date = todayISO();
          if (dateInput) dateInput.value = date;
        }

        if (warnTrack) warnTrack.style.display = track ? "none" : "";
        if (!track) {
          try {
            trackInput?.focus();
          } catch {
            /* ignore */
          }
          return;
        }
        if (warnRace) warnRace.style.display = "none";

        const requestInfo = { track, raceNo: raceNo || null, date };
        if (statusEl) {
          statusEl.textContent = "Running…";
          statusEl.style.color = "#cbd5f5";
        }
        if (summaryEl) summaryEl.textContent = "Working…";
        runBtn.disabled = true;
        runBtn.textContent = "Running…";
        host.__flvLast = { top: null, query: "" };

        pushSnapshot(track, raceNo, readUIPredictions());

        try {
          const predicted = readUIPredictions();
          const resp = await fetch("/api/verify_race", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              track,
              date,
              raceNo: raceNo || undefined,
              predicted,
            }),
          });
          const data = await resp.json().catch(() => ({}));

          // Build summary payload with date and error info
          const baseSummary = {};
          if (date) {
            baseSummary.date = date;
          }

          const summaryPayload = resp.ok
            ? { ...baseSummary, ...data }
            : {
                ...baseSummary,
                ...data,
                error: data && data.error ? data.error : `Request failed (${resp.status})`,
                details: data && (data.details || data.message) ? (data.details || data.message) : null,
                step: data && data.step ? data.step : "verify_race",
              };

          if (statusEl) {
            statusEl.textContent = resp.ok ? "OK" : `Error ${resp.status}`;
            statusEl.style.color = resp.ok ? "#cbd5f5" : "#f87171";
          }

          host.__flvLast = {
            top: data?.top || null,
            query: data?.query || "",
          };

          renderSummary(summaryEl, summaryPayload);

          const debugEl = qs("#flv-gz-json", host);
          if (debugEl) {
            try {
              const existing = JSON.parse(debugEl.textContent || "[]");
              const arr = Array.isArray(existing) ? existing : [];
              arr.unshift({ request: requestInfo, response: data });
              debugEl.textContent = JSON.stringify(arr.slice(0, 5), null, 2);
            } catch {
              debugEl.textContent = JSON.stringify(
                [{ request: requestInfo, response: data }],
                null,
                2
              );
            }
          }
        } catch (error) {
          if (statusEl) {
            statusEl.textContent = "Error";
            statusEl.style.color = "#f87171";
          }
          renderSummary(summaryEl, {
            date,
            error: "Request failed",
            details: error && (error.message || String(error)),
            step: "verify_race_fetch",
          });
          if (window.__flVerifyDebug) {
            console.error("[Verify Modal] request failed", error);
          }
        } finally {
          runBtn.disabled = false;
          runBtn.textContent = defaultLabel;
          refreshGreenZone(host);
          try {
            fetch("/api/verify_backfill", { method: "POST" }).catch(() => {});
          } catch {
            /* ignore background errors */
          }
        }
      });
    }

    qs("#flv-open-top", host)?.addEventListener("click", () => {
      try {
        const url = host.__flvLast?.top?.link;
        if (url) window.open(url, "_blank", "noopener");
      } catch {
        /* ignore */
      }
    });

    qs("#flv-open-google", host)?.addEventListener("click", () => {
      try {
        const query = host.__flvLast?.query || "";
        if (query) {
          const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
          window.open(url, "_blank", "noopener");
        }
      } catch {
        /* ignore */
      }
    });

    host.__flvRefreshGreenZone = () => refreshGreenZone(host);

    return host;
  }

  function prefill(host, ctx) {
    const saved = readCtx();
    const trackVal = ctx?.track || currentTrack() || saved.track || "";
    const raceVal = ctx?.raceNo || currentRaceNo() || saved.raceNo || "";

    const trackInput = qs("#flv-track", host);
    const raceInput = qs("#flv-race", host);
    const dateInput = qs("#flv-date", host);
    const statusEl = qs("#flv-status", host);
    const summaryEl = qs("#flv-sum-body", host);
    const warnTrack = qs("#flv-track-warn", host);
    const warnRace = qs("#flv-race-warn", host);

    if (trackInput) trackInput.value = trackVal || "";
    if (raceInput) raceInput.value = raceVal || "";
    if (dateInput && !dateInput.value) dateInput.value = todayISO();
    if (statusEl) {
      statusEl.textContent = "Idle";
      statusEl.style.color = "#cbd5f5";
    }
    if (summaryEl) summaryEl.textContent = "No summary returned.";
    if (warnTrack) warnTrack.style.display = trackVal ? "none" : "";
    if (warnRace) warnRace.style.display = "none";

    pushSnapshot(trackVal || currentTrack(), raceVal || currentRaceNo(), readUIPredictions());

    if (typeof host.__flvRefreshGreenZone === "function") {
      host.__flvRefreshGreenZone();
    }
  }

  function openVerifyModal(ctx) {
    const host = buildModal();
    prefill(host, ctx);
    host.style.display = "flex";
    try {
      qs("#flv-track", host)?.focus();
    } catch {
      /* ignore */
    }
  }

  // Always register the global opener function
  window.__FL_OPEN_VERIFY_MODAL__ = openVerifyModal;
  
  // Debug log to confirm registration
  try {
    if (window.__flVerifyDebug) {
      console.log("[verify-modal] registered opener", typeof window.__FL_OPEN_VERIFY_MODAL__);
    }
  } catch (_) {}
})();


