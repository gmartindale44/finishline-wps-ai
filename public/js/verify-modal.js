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

  // Use UTC methods to match server-side behavior and avoid timezone shifts
  const todayISO = () => {
    const d = new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  function readUIPredictions() {
    try {
      const picks = { win: "", place: "", show: "" };
      
      // Try multiple strategies to find predictions from the UI
      
      // Strategy 1: Look for badge elements (results-panel.js format)
      const badgeWin = document.querySelector('.fl-badge--win .fl-badge__name, [data-badge="win"] .fl-badge__name');
      const badgePlace = document.querySelector('.fl-badge--place .fl-badge__name, [data-badge="place"] .fl-badge__name');
      const badgeShow = document.querySelector('.fl-badge--show .fl-badge__name, [data-badge="show"] .fl-badge__name');
      
      if (badgeWin) picks.win = (badgeWin.textContent || "").trim();
      if (badgePlace) picks.place = (badgePlace.textContent || "").trim();
      if (badgeShow) picks.show = (badgeShow.textContent || "").trim();
      
      // If we found all three, return early
      if (picks.win && picks.place && picks.show) {
        return picks;
      }
      
      // Strategy 2: Look for prediction cards
      const scope =
        document.querySelector(
          '[data-panel="predictions"], .predictions-panel'
        ) || document;
      
      const cards = Array.from(
        scope.querySelectorAll(".prediction-card, [data-pick]")
      );
      if (cards.length >= 3) {
        const names = cards.slice(0, 3).map((card) => {
          const el = card.querySelector(
            "[data-name], .title, .name, b, strong, .fl-badge__name"
          );
          return ((el && el.textContent) || "").trim();
        });
        if (names[0]) picks.win = names[0];
        if (names[1]) picks.place = names[1];
        if (names[2]) picks.show = names[2];
        
        // If we found all three, return
        if (picks.win && picks.place && picks.show) {
          return picks;
        }
      }

      // Strategy 3: Look for data-pick attributes
      const fetchText = (selector) =>
        (scope.querySelector(selector)?.textContent || "").trim();
      
      if (!picks.win) picks.win = fetchText("[data-pick='win'], .pick-win b, .emoji-win~b, .fl-badge--win .fl-badge__name");
      if (!picks.place) picks.place = fetchText("[data-pick='place'], .pick-place b, .emoji-place~b, .fl-badge--place .fl-badge__name");
      if (!picks.show) picks.show = fetchText("[data-pick='show'], .pick-show b, .emoji-show~b, .fl-badge--show .fl-badge__name");
      
      // Strategy 4: Look for ID-based elements (legacy format)
      const winEl = document.getElementById('winName');
      const placeEl = document.getElementById('placeName');
      const showEl = document.getElementById('showName');
      
      if (!picks.win && winEl) picks.win = (winEl.textContent || "").trim();
      if (!picks.place && placeEl) picks.place = (placeEl.textContent || "").trim();
      if (!picks.show && showEl) picks.show = (showEl.textContent || "").trim();
      
      return picks;
    } catch (err) {
      if (window.__flVerifyDebug) {
        console.warn("[verify-modal] readUIPredictions error:", err);
      }
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

    // Always show date if present
    if (data.date) {
      lines.push(`Using date: ${data.date}`);
    }

    // Show error info first if present
    if (data.error) {
      lines.push(`Error: ${data.error}`);
    }
    if (data.details && data.details !== data.error) {
      lines.push(`Details: ${data.details}`);
    }
    if (data.step) {
      lines.push(`Step: ${data.step}`);
    }

    // Show query if present
    if (data.query) {
      lines.push(`Query: ${data.query}`);
    }

    // Show top result if present (with safe checks) - BEFORE outcome
    if (data.top && typeof data.top === "object" && data.top.title) {
      lines.push(
        `Top Result: ${data.top.title}${
          data.top.link ? `\n${data.top.link}` : ""
        }`
      );
    } else if (data.link) {
      lines.push(`Link: ${data.link}`);
    }

    // Outcome: use results from chart data (win, place, show)
    // results holds the chart outcome, predicted holds the model's picks
    const results = data.results || data.outcome || {}; // Fallback to outcome for backward compatibility
    const win = results.win || "";
    const place = results.place || "";
    const show = results.show || "";

    let outcomeText = "(none)";
    const parts = [];
    if (win) parts.push(`Win ${win}`);
    if (place) parts.push(`Place ${place}`);
    if (show) parts.push(`Show ${show}`);

    if (parts.length) {
      lines.push(`Outcome: ${parts.join(" • ")}`);
    } else {
      lines.push("Outcome: (none)");
    }

    // Show hits if present (with safe checks) - always show
    if (data.hits && typeof data.hits === "object") {
      const hitParts = [];
      if (data.hits.winHit) hitParts.push("Win");
      if (data.hits.placeHit) hitParts.push("Place");
      if (data.hits.showHit) hitParts.push("Show");
      lines.push(
        hitParts.length ? `Hits: ${hitParts.join(", ")}` : "Hits: (none)"
      );
    }

    // Show summary text if present
    if (data.summary && typeof data.summary === "string") {
      lines.push(data.summary);
    }

    // Fallback if absolutely nothing meaningful
    if (!lines.length) {
      lines.push("No summary returned.");
    }

    summaryEl.textContent = lines.join("\n");
  }

  function renderGreenZone(host, payload) {
    const el = state.gxMessageEl || qs("#flv-gz-message", host || document);
    if (!el) return;
  
    const debugMode = !!window.__flVerifyDebug;
  
    // ---- Safety default: no payload at all ----
    if (!payload) {
      let msg =
        "GreenZone service error.\n\n" +
        "Debug JSON:\n" +
        JSON.stringify({ status: 0, error: "No payload" }, null, 2);
  
      el.textContent = msg;
      return;
    }
  
    const status =
      typeof payload.status === "number" ? payload.status : 0;
    const suggestions = Array.isArray(payload.suggestions)
      ? payload.suggestions
      : [];
    const error = payload.error || null;
    const stats = payload.stats || null;
  
    // ---- HTTP / API-level error ----
    if (status !== 200 || error) {
      let msg =
        "GreenZone service error.\n\n" +
        "Reason: " +
        (error || "Unknown error");
  
      if (debugMode) {
        msg +=
          "\n\nDebug JSON:\n" +
          JSON.stringify(payload, null, 2);
      }
  
      el.textContent = msg;
      return;
    }
  
    // ---- No stats yet -> early "not enough data" ----
    if (!stats) {
      let msg =
        "Not enough data yet to identify GreenZone races. " +
        "Capture more verified races to unlock suggestions.";
  
      if (debugMode) {
        msg +=
          "\n\nDebug JSON (latest suggestions):\n" +
          JSON.stringify(payload, null, 2);
      }
  
      el.textContent = msg;
      return;
    }
  
    const strategyName = stats.strategyName || "v1_shadow_only";
    const version =
      stats.version != null ? stats.version : 1;
    const generatedAt =
      stats.generatedAt || stats.generated_at || null;
    const legs = stats.legs || {};
    const rowsTotal =
      stats.rows && typeof stats.rows.total === "number"
        ? stats.rows.total
        : null;
  
    // For progress bar messaging – matches our 120-race target
    const targetRows = 120;
    const progressPct =
      rowsTotal != null && targetRows > 0
        ? Math.min(100, (rowsTotal / targetRows) * 100)
        : null;
    const remaining =
      rowsTotal != null ? Math.max(0, targetRows - rowsTotal) : null;
  
    const lines = [];
  
    // ---- Header / calibration summary ----
    lines.push("Shadow Calibration (v" + version + ")");
    lines.push("--------------------------------");
    lines.push("Strategy: " + strategyName);
    if (generatedAt) {
      lines.push("Generated at: " + generatedAt);
    }
    if (rowsTotal != null) {
      lines.push("Samples analysed: " + rowsTotal + " races");
      if (remaining > 0 && progressPct != null) {
        lines.push(
          "Progress: " +
            rowsTotal +
            " / " +
            targetRows +
            " races (" +
            progressPct.toFixed(1) +
            "% toward full GreenZone unlock)"
        );
      }
    }
    lines.push("");
  
    function pct(v) {
      if (typeof v !== "number") return "n/a";
      return (v * 100).toFixed(1) + "%";
    }
  
    function addLeg(label, leg) {
      if (!leg) return;
      lines.push(label.toUpperCase() + " leg:");
      if (typeof leg.totalRows === "number") {
        lines.push("  Total rows: " + leg.totalRows);
      }
      if (typeof leg.shadowYes === "number") {
        lines.push(
          "  Hit rate (shadow YES): " + pct(leg.shadowYes)
        );
      }
      if (typeof leg.hit_rate_overall === "number") {
        lines.push(
          "  Hit rate (overall): " + pct(leg.hit_rate_overall)
        );
      }
      lines.push("");
    }
  
    addLeg("win", legs.win);
    addLeg("place", legs.place);
    addLeg("show", legs.show);
  
    // ---- Suggestions (per-race) ----
    if (!suggestions.length) {
      lines.push(
        "No specific GreenZone races yet — the model is still warming up."
      );
      lines.push(
        "As you verify more races, any that match strong historical patterns will appear here."
      );
    } else {
      lines.push("GreenZone suggestions:");
      suggestions.forEach(function (s, idx) {
        const raceTrack =
          (s.track || s.trackName || "?") + "";
        const raceNo = s.race || s.raceNo || "?";
        const horseName = s.horse || s.horseName || "?";
        const leg = s.leg || s.legName || "?";
        const score =
          typeof s.score === "number" ? s.score.toFixed(3) : "?";
  
        lines.push(
          "# " +
            (idx + 1) +
            ": Track " +
            raceTrack +
            ", Race " +
            raceNo +
            ", Horse " +
            horseName +
            ", Leg " +
            leg +
            ", Score " +
            score
        );
      });
    }
  
    // ---- Optional debug JSON ----
    if (debugMode) {
      lines.push("");
      lines.push("Debug JSON (latest suggestions):");
      lines.push(JSON.stringify(payload, null, 2));
    }
  
    el.textContent = lines.join("\n");
  }
  

 // GreenZone fetch (same UI, but POSTs track/race/date to backend)
async function refreshGreenZone(host, ctx) {
  // Keep the message element behavior you already had
  const msgEl = document.querySelector("#flv-gz-message") || host;
  if (msgEl) msgEl.textContent = "Loading...";

  // Build a body from context if provided (so we don't mess with the rest of the modal)
  const safeCtx = ctx || window.__FL_LAST_VERIFY_CTX__ || {};
  const raceCtx = safeCtx.race || {};

  const body = {
    race: {
      track:
        raceCtx.track ||
        safeCtx.track ||
        null,
      raceNo:
        raceCtx.raceNo ||
        raceCtx.race ||
        safeCtx.raceNo ||
        safeCtx.race ||
        null,
      date:
        raceCtx.date ||
        safeCtx.date ||
        null,
    },
    shadowDecision: safeCtx.shadowDecision || null,
  };

  let payload;

  try {
    const res = await fetch("/api/greenzone_today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const status = res.status;

    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      // If JSON parsing fails, we'll still surface status below
    }

    if (!res.ok) {
      payload = {
        status,
        error: (json && json.error) || `HTTP ${status}`,
        suggestions: (json && json.suggestions) || [],
      };
    } else {
      // Preserve whatever shape the old UI expects, but add status/json
      payload = Object.assign({ status }, json || {});
    }
  } catch (error) {
    if (window.__flVerifyDebug) {
      console.error("[Verify Modal] GreenZone fetch failed", error);
    }
    payload = {
      status: 0,
      error: error && (error.message || "Network error"),
      suggestions: [],
    };
  }

  // IMPORTANT: Call your existing renderer so the UI format stays identical
  renderGreenZone(host, payload);
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
      
      // Pure string helper for date normalization (no Date objects, no timezone math)
      function formatUiDateForApi(uiDate) {
        if (!uiDate) return null;
        const s = String(uiDate).trim();

        // Already ISO (YYYY-MM-DD)
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          return s;
        }

        // MM/DD/YYYY -> YYYY-MM-DD
        const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) {
          const mm = m[1].padStart(2, "0");
          const dd = m[2].padStart(2, "0");
          const yyyy = m[3];
          return `${yyyy}-${mm}-${dd}`;
        }

        // As a last resort, just return the trimmed string (no Date math)
        return s;
      }
      
      runBtnEl.addEventListener("click", async (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        
        try {
          const track = (trackInputEl?.value || "").trim();
          const raceNo =
            (raceInputEl && raceInputEl.value
              ? raceInputEl.value.trim()
              : "") || null;
          
          // Validate track is required
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
          
          // 1) Grab the Race Date input element from the main page
          // This is the date the user selected on the Race Information page
          const mainPageDateInput = document.querySelector('#fl-race-date, input[name="race_date"], input[data-role="race-date"]');
          
          // Read date from the main page input - use the raw value directly
          // HTML5 date inputs return YYYY-MM-DD format, which is exactly what we need
          let uiDateRaw = null;
          if (mainPageDateInput) {
            uiDateRaw = (mainPageDateInput.value || "").trim();
          }
          
          // If there is no date at all, show error and block the request
          if (!uiDateRaw) {
            if (summaryEl) {
              summaryEl.textContent = "Error: Please enter a Race Date before verifying.";
            }
            if (statusNode) {
              statusNode.textContent = "Error";
              statusNode.style.color = "#f87171";
            }
            // Optional: show alert for better UX
            try {
              alert("Please enter a Race Date before verifying.");
            } catch {
              /* ignore if alert blocked */
            }
            return;
          }
          
          // IMPORTANT: No todayISO(), no new Date(), no timezone logic.
          // Just validate/normalize formats.
          const canonicalDate = formatUiDateForApi(uiDateRaw);
          
          // Validate date format is acceptable
          if (!canonicalDate) {
            if (summaryEl) {
              summaryEl.textContent = "Error: Invalid race date format";
            }
            if (statusNode) {
              statusNode.textContent = "Error";
              statusNode.style.color = "#f87171";
            }
            return;
          }
          
          // Build payload - use the canonical date exactly as formatted (no Date objects, no timezone conversion)
          const predicted = readUIPredictions();
          
          const payload = {
            track,
            raceNo: raceNo || undefined,
            date: canonicalDate,
            dateIso: canonicalDate,  // Include dateIso as alias for API compatibility
            dateRaw: uiDateRaw,  // extra debug so we can see exactly what UI sent
            predicted: predicted,
          };
          
          console.log("[VERIFY_UI] outgoing payload", payload);
          
          // Update UI state
          if (statusNode) {
            statusNode.textContent = "Running…";
            statusNode.style.color = "#cbd5f5";
          }
          if (summaryEl) summaryEl.textContent = "Working…";
          runBtnEl.disabled = true;
          runBtnEl.textContent = "Running…";
          host.__flvLast = { top: null, query: "" };
          
          pushSnapshot(track, raceNo, readUIPredictions());
          
          // Always send the fetch request
          const resp = await fetch("/api/verify_race", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          
          const data = await resp.json().catch(() => ({}));
          
          // Build summary payload with date and error info
          const baseSummary = {};
          if (canonicalDate) {
            baseSummary.date = canonicalDate;
            baseSummary.dateRaw = uiDateRaw;
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
              arr.unshift({ request: { track, raceNo, date: canonicalDate, dateRaw: uiDateRaw }, response: data });
              debugEl.textContent = JSON.stringify(arr.slice(0, 5), null, 2);
            } catch {
              debugEl.textContent = JSON.stringify(
                [{ request: { track, raceNo, date: canonicalDate, dateRaw: uiDateRaw }, response: data }],
                null,
                2
              );
            }
          }
        } catch (error) {
          console.error("[VERIFY_UI] error during verify", error);
          if (statusNode) {
            statusNode.textContent = "Error";
            statusNode.style.color = "#f87171";
          }
          // Always show error in summary
          const errorMessage = error && (error.message || String(error));
          renderSummary(summaryEl, {
            error: "Verify failed in UI",
            details: errorMessage,
            step: "verify_race_fetch",
          });
          // Ensure summary is never empty
          if (summaryEl && !summaryEl.textContent) {
            summaryEl.textContent = "Error: Verify failed in UI. See console for details.";
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
  
    // ⭐️ STORE LAST CONTEXT HERE
    window.__FL_LAST_VERIFY_CTX__ = ctx || {};
  
    host.style.display = "flex";
  
    try {
      qs("#flv-track", host)?.focus();
    } catch {
      /* ignore */
    }
  
    // Kick GreenZone refresh if loader injected it
    if (typeof host.__flvRefreshGreenZone === "function") {
      host.__flvRefreshGreenZone();
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
