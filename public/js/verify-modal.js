/* public/js/verify-modal.js — GreenZone Lab v2 (verify wiring fixed) */

(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  // ---- Global opener stub (registered immediately) ----
  function openVerifyModal(ctx) {
    if (typeof window.__FL_VERIFY_MODAL_OPEN_IMPL__ === "function") {
      return window.__FL_VERIFY_MODAL_OPEN_IMPL__(ctx);
    }
    console.warn(
      "[verify-modal] openVerifyModal called before implementation ready",
      ctx
    );
  }

  // Register stub BEFORE any early returns so the global always exists
  window.__FL_OPEN_VERIFY_MODAL__ = openVerifyModal;

  // Guard to prevent double DOM initialization
  if (window.__FL_VERIFY_MODAL_INIT__) {
    // DOM already initialized; global is already registered above
    return;
  }
  window.__FL_VERIFY_MODAL_INIT__ = true;
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
        document.querySelector(
          '[data-panel="predictions"], .predictions-panel'
        ) || document;
      const picks = { win: "", place: "", show: "" };

      const cards = Array.from(
        scope.querySelectorAll(".prediction-card, [data-pick]")
      );
      if (cards.length >= 3) {
        const names = cards.slice(0, 3).map((card) => {
          const el = card.querySelector(
            "[data-name], .title, .name, b, strong"
          );
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
      picks.place = fetchText(
        "[data-pick='place'], .pick-place b, .emoji-place~b"
      );
      picks.show = fetchText(
        "[data-pick='show'], .pick-show b, .emoji-show~b"
      );
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

    // Always show the date first if available
    if (data.date) {
      lines.push(`Using date: ${data.date}`);
    }

    // Outcome: use results from chart data (win, place, show)
    // results holds the chart outcome, predicted holds the model's picks
    // Safely handle both new results object and legacy outcome object
    const results = data.results && typeof data.results === "object" && !Array.isArray(data.results)
      ? data.results
      : (data.outcome && typeof data.outcome === "object" && !Array.isArray(data.outcome)
          ? data.outcome
          : {});
    
    const win = (results.win || "").trim();
    const place = (results.place || "").trim();
    const show = (results.show || "").trim();

    const parts = [];
    if (win) {
      parts.push(`Win ${win}`);
    }
    if (place) {
      parts.push(`Place ${place}`);
    }
    if (show) {
      parts.push(`Show ${show}`);
    }

    if (parts.length) {
      lines.push(`Outcome: ${parts.join(" • ")}`);
    } else if (data.outcome && typeof data.outcome === "string") {
      // Backward-compat fallback for string outcome
      lines.push(`Outcome: ${data.outcome}`);
    } else {
      lines.push("Outcome: (none)");
    }

    // Safety fallback: if somehow no lines were added
    if (!lines.length) {
      lines.push("No summary returned.");
    }

    summaryEl.textContent = lines.join("\n");
  }

  function renderGreenZone(host, payload) {
    const tableWrap = qs("#flv-gz-table", host);
    const msgEl = qs("#flv-gz-message", host);
    const debugEl = qs("#flv-gz-json", host);

    if (!tableWrap || !msgEl || !debugEl) return;

    const suggestions = Array.isArray(payload?.suggestions)
      ? payload.suggestions
      : [];
    const hasError = payload && payload.error;

    try {
      debugEl.textContent = JSON.stringify(payload ?? {}, null, 2);
    } catch {
      debugEl.textContent = String(payload ?? "");
    }

    if (hasError) {
      msgEl.innerHTML = "GreenZone service error. See debug JSON below.";
      tableWrap.innerHTML = "";
      return;
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
      if (!res.ok) {
        const status = res.status;
        throw Object.assign(new Error(`HTTP ${status}`), { status });
      }
      const json = await res.json().catch(() => ({}));
      renderGreenZone(host, json);
    } catch (error) {
      if (window.__flVerifyDebug) {
        console.error("[Verify Modal] GreenZone fetch failed", error);
      }
      const errPayload = {
        suggestions: [],
        error: error?.message || "Request failed",
      };
      if (typeof error?.status !== "undefined") {
        errPayload.status = error.status;
      }
      renderGreenZone(host, errPayload);
    }
  }

  function buildModal() {
    let host = qs("#fl-verify-modal-host");
    if (host) return host;

    host = document.createElement("div");
    host.id = "fl-verify-modal-host";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.55);";

    const card = document.createElement("div");
    card.className = "flv-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("data-build", "datefix-final3");
    card.style.cssText =
      "width:min(880px,96vw);max-height:90vh;overflow:auto;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.96);backdrop-filter:blur(6px);padding:18px;";

    host.appendChild(card);

    // Header row
    const headerRow = document.createElement("div");
    headerRow.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;";

    const title = document.createElement("h3");
    title.style.margin = "0";
    title.style.font = "600 20px/1.2 system-ui";
    title.textContent = "Verify Race ";

    const buildTag = document.createElement("span");
    buildTag.style.cssText = "font-size:11px;opacity:.5;margin-left:8px;";
    buildTag.textContent = "Build: datefix-final3";
    title.appendChild(buildTag);

    const closeBtn = document.createElement("button");
    closeBtn.id = "flv-close";
    closeBtn.textContent = "✕";
    closeBtn.style.cssText =
      "border:none;background:transparent;color:inherit;font:600 16px;opacity:.8;cursor:pointer";

    headerRow.appendChild(title);
    headerRow.appendChild(closeBtn);
    card.appendChild(headerRow);

    // === Track + Race row ===
    const row1 = document.createElement("div");
    row1.className = "flv-row";
    row1.style.cssText = "margin-bottom:14px;";

    const grid1 = document.createElement("div");
    grid1.style.cssText =
      "display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,0.7fr);gap:10px;";

    // Track
    const trackWrap = document.createElement("div");
    const trackLabel = document.createElement("label");
    trackLabel.style.display = "block";

    const trackTitle = document.createElement("div");
    trackTitle.style.cssText = "margin-bottom:6px;opacity:.9;";
    trackTitle.innerHTML = 'Track <span style="color:#ffcc00">*</span>';

    const trackInput = document.createElement("input");
    trackInput.id = "flv-track";
    trackInput.type = "text";
    trackInput.placeholder = "Track";
    trackInput.style.cssText =
      "width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.28);background:rgba(17,17,23,1);color:inherit";

    trackLabel.appendChild(trackTitle);
    trackLabel.appendChild(trackInput);
    trackWrap.appendChild(trackLabel);

    const trackWarn = document.createElement("small");
    trackWarn.id = "flv-track-warn";
    trackWarn.style.cssText = "display:none;color:#ffcc00;";
    trackWarn.textContent = "Track is required.";
    trackWrap.appendChild(trackWarn);

    grid1.appendChild(trackWrap);

    // Race #
    const raceWrap = document.createElement("div");
    const raceLabel = document.createElement("label");
    raceLabel.style.display = "block";

    const raceTitle = document.createElement("div");
    raceTitle.style.cssText = "margin-bottom:6px;opacity:.9;";
    raceTitle.textContent = "Race #";

    const raceInput = document.createElement("input");
    raceInput.id = "flv-race";
    raceInput.type = "text";
    raceInput.placeholder = "e.g. 6";
    raceInput.style.cssText =
      "width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.28);background:rgba(17,17,23,1);color:inherit";

    raceLabel.appendChild(raceTitle);
    raceLabel.appendChild(raceInput);
    raceWrap.appendChild(raceLabel);

    const raceWarn = document.createElement("small");
    raceWarn.id = "flv-race-warn";
    raceWarn.style.cssText = "display:none;color:#ffcc00;";
    raceWarn.textContent =
      "Server asked for a Race # — please add one.";
    raceWrap.appendChild(raceWarn);

    grid1.appendChild(raceWrap);
    row1.appendChild(grid1);
    card.appendChild(row1);

    // === Date row (full width) ===
    const row2 = document.createElement("div");
    row2.className = "flv-row";
    row2.style.cssText = "margin-bottom:16px;";

    const dateWrap = document.createElement("div");
    const dateLabel = document.createElement("label");
    dateLabel.style.display = "block";

    const dateTitle = document.createElement("div");
    dateTitle.style.cssText = "margin-bottom:6px;opacity:.9;";
    dateTitle.textContent = "Date";

    const dateInput = document.createElement("input");
    dateInput.id = "flv-date";
    dateInput.type = "date";
    dateInput.style.cssText =
      "width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.28);background:rgba(17,17,23,1);color:inherit";

    dateLabel.appendChild(dateTitle);
    dateLabel.appendChild(dateInput);
    dateWrap.appendChild(dateLabel);
    row2.appendChild(dateWrap);
    card.appendChild(row2);

    // Status
    const statusEl = document.createElement("div");
    statusEl.id = "flv-status";
    statusEl.style.cssText =
      "font:600 12px/1.2 system-ui;opacity:.85;margin-bottom:10px;";
    statusEl.textContent = "Idle";
    card.appendChild(statusEl);

    // Buttons row
    const buttonsRow = document.createElement("div");
    buttonsRow.style.cssText =
      "display:flex;gap:10px;align-items:center;margin:14px 0;flex-wrap:wrap;";

    const runBtn = document.createElement("button");
    runBtn.id = "flv-run";
    runBtn.textContent = "Verify Now";
    runBtn.style.cssText =
      "padding:10px 18px;border-radius:12px;border:none;background:#6b46c1;color:#fff;font-weight:700;cursor:pointer";

    const openTopBtn = document.createElement("button");
    openTopBtn.id = "flv-open-top";
    openTopBtn.textContent = "Open Top Result";
    openTopBtn.style.cssText =
      "padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;cursor:pointer";

    const openGoogleBtn = document.createElement("button");
    openGoogleBtn.id = "flv-open-google";
    openGoogleBtn.textContent = "Open Google (debug)";
    openGoogleBtn.style.cssText =
      "padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:transparent;color:inherit;cursor:pointer";

    const helpText = document.createElement("small");
    helpText.style.opacity = ".75";
    helpText.textContent = "Race # helps context.";

    buttonsRow.appendChild(runBtn);
    buttonsRow.appendChild(openTopBtn);
    buttonsRow.appendChild(openGoogleBtn);
    buttonsRow.appendChild(helpText);
    card.appendChild(buttonsRow);

    // Summary details
    const summaryDetails = document.createElement("details");
    summaryDetails.id = "flv-sum";
    summaryDetails.open = true;

    const summarySummary = document.createElement("summary");
    summarySummary.style.cssText = "cursor:pointer;opacity:.9;";
    summarySummary.textContent = "Summary";

    const summaryBody = document.createElement("pre");
    summaryBody.id = "flv-sum-body";
    summaryBody.style.cssText =
      "white-space:pre-wrap;margin-top:8px;max-height:240px;overflow:auto;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);font:12px/1.5 ui-monospace, Menlo, Consolas;";
    summaryBody.textContent = "No summary returned.";

    summaryDetails.appendChild(summarySummary);
    summaryDetails.appendChild(summaryBody);
    card.appendChild(summaryDetails);

    // GreenZone details
    const gzDetails = document.createElement("details");
    gzDetails.id = "flv-gz-details";
    gzDetails.style.cssText = "margin-top:14px;";

    const gzSummary = document.createElement("summary");
    gzSummary.style.cssText = "cursor:pointer;opacity:.9;";
    gzSummary.textContent = "GreenZone Data";

    const gzWrap = document.createElement("div");
    gzWrap.id = "flv-gz-wrap";
    gzWrap.style.cssText = "margin-top:10px;";

    const gzMessage = document.createElement("div");
    gzMessage.id = "flv-gz-message";
    gzMessage.style.cssText = "font:12px/1.4 system-ui;opacity:.8;";
    gzMessage.textContent = "Loading…";

    const gzTable = document.createElement("div");
    gzTable.id = "flv-gz-table";
    gzTable.style.cssText = "margin-top:10px;";

    const gzDebugLabel = document.createElement("div");
    gzDebugLabel.style.cssText = "margin-top:10px;opacity:.55;font-size:11px;";
    gzDebugLabel.textContent = "Debug JSON (latest suggestions)";

    const gzJson = document.createElement("pre");
    gzJson.id = "flv-gz-json";
    gzJson.style.cssText =
      "white-space:pre-wrap;margin-top:6px;max-height:220px;overflow:auto;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.4);font:11px/1.5 ui-monospace, Menlo, Consolas;";
    gzJson.textContent = "[]";

    gzWrap.appendChild(gzMessage);
    gzWrap.appendChild(gzTable);
    gzWrap.appendChild(gzDebugLabel);
    gzWrap.appendChild(gzJson);
    gzDetails.appendChild(gzSummary);
    gzDetails.appendChild(gzWrap);
    card.appendChild(gzDetails);

    document.body.appendChild(host);
    host.__flvLast = { top: null, query: "" };

    // Wire up controls
    qs("#flv-close", host)?.addEventListener("click", () => {
      host.style.display = "none";
    });

    const runBtnEl = qs("#flv-run", host);
    const statusNode = qs("#flv-status", host);
    const summaryEl = qs("#flv-sum-body", host);
    const warnTrackEl = qs("#flv-track-warn", host);
    const warnRaceEl = qs("#flv-race-warn", host);
    const trackInputEl = qs("#flv-track", host);
    const raceInputEl = qs("#flv-race", host);
    const dateInputEl = qs("#flv-date", host);

    if (dateInputEl && !dateInputEl.value) {
      dateInputEl.value = todayISO();
    }

    try {
      console.info(
        "[verify-modal] mounted build=datefix-final3 dateInput=",
        dateInputEl && dateInputEl.type
      );
    } catch {
      /* ignore logging failures */
    }

    if (runBtnEl) {
      const defaultLabel = runBtnEl.textContent || "Verify Now";
      runBtnEl.addEventListener("click", async () => {
        const track = (trackInputEl?.value || "").trim();
        const raceNo =
          (raceInputEl && raceInputEl.value
            ? raceInputEl.value.trim()
            : "") || null;
        const rawDate =
          dateInputEl && dateInputEl.value ? dateInputEl.value : null;
        const date = rawDate || todayISO();

        if (warnTrackEl) warnTrackEl.style.display = track ? "none" : "";
        if (!track) {
          try {
            trackInputEl?.focus();
          } catch {
            /* ignore */
          }
          return;
        }
        if (warnRaceEl) warnRaceEl.style.display = "none";

        const requestInfo = { track, raceNo: raceNo || null, date };

        if (statusNode) {
          statusNode.textContent = "Running…";
          statusNode.style.color = "#cbd5f5";
        }
        if (summaryEl) summaryEl.textContent = "Working…";
        runBtnEl.disabled = true;
        runBtnEl.textContent = "Running…";
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
                error:
                  data && data.error
                    ? data.error
                    : `Request failed (${resp.status})`,
                details:
                  data && (data.details || data.message)
                    ? data.details || data.message
                    : null,
                step: data && data.step ? data.step : "verify_race",
              };

          if (statusNode) {
            statusNode.textContent = resp.ok
              ? "OK"
              : `Error ${resp.status}`;
            statusNode.style.color = resp.ok ? "#cbd5f5" : "#f87171";
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
          if (statusNode) {
            statusNode.textContent = "Error";
            statusNode.style.color = "#f87171";
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
          runBtnEl.disabled = false;
          runBtnEl.textContent = defaultLabel;
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
          const url = `https://www.google.com/search?q=${encodeURIComponent(
            query
          )}`;
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
    const dateVal = ctx?.date || saved.date || todayISO();

    const trackInput = qs("#flv-track", host);
    const raceInput = qs("#flv-race", host);
    const dateInput = qs("#flv-date", host);
    const statusEl = qs("#flv-status", host);
    const summaryEl = qs("#flv-sum-body", host);
    const warnTrack = qs("#flv-track-warn", host);
    const warnRace = qs("#flv-race-warn", host);

    if (trackInput) {
      trackInput.value = trackVal || "";
    }
    if (raceInput) {
      raceInput.value = raceVal || "";
    }
    if (dateInput && !dateInput.value) {
      dateInput.value = dateVal || todayISO();
    }
    if (statusEl) {
      statusEl.textContent = "Idle";
      statusEl.style.color = "#cbd5f5";
    }
    if (summaryEl) summaryEl.textContent = "No summary returned.";
    if (warnTrack) warnTrack.style.display = trackVal ? "none" : "";
    if (warnRace) warnRace.style.display = "none";

    pushSnapshot(
      trackVal || currentTrack(),
      raceVal || currentRaceNo(),
      readUIPredictions()
    );

    if (typeof host.__flvRefreshGreenZone === "function") {
      host.__flvRefreshGreenZone();
    }
  }

  // Implementation function (stored separately so the wrapper can call it)
  function openVerifyModalImpl(ctx) {
    const host = buildModal();
    prefill(host, ctx || {});
    host.style.display = "flex";
    try {
      qs("#flv-track", host)?.focus();
    } catch {
      /* ignore */
    }
  }

  // Store the implementation so the wrapper function can use it
  window.__FL_VERIFY_MODAL_OPEN_IMPL__ = openVerifyModalImpl;

  // Update the global to point directly to the implementation now that it's ready
  window.__FL_OPEN_VERIFY_MODAL__ = openVerifyModalImpl;

  // Debug log to confirm registration
  if (window.__flVerifyDebug) {
    try {
      console.log("[verify-modal] registered window.__FL_OPEN_VERIFY_MODAL__");
    } catch (_) {}
  }
})();
