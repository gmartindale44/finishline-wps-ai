/* public/js/verify-modal.js — GreenZone Lab v2 (GreenZone v1 wired, hybrid C UI) */

(function () {
  "use strict";

  // Hard guard for non-browser environments
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // --------------------------------------------------
  // Helpers
  // --------------------------------------------------

  function q(selector, root) {
    return (root || document).querySelector(selector);
  }

  // --------------------------------------------------
  // Global open stub (used by verify-button.js)
  // --------------------------------------------------

  function openVerifyModal(ctx) {
    if (typeof window.__FL_VERIFY_MODAL_OPEN_IMPL__ === "function") {
      return window.__FL_VERIFY_MODAL_OPEN_IMPL__(ctx || {});
    }

    console.warn(
      "[verify-modal] openVerifyModal called before implementation ready",
      ctx
    );
  }

  // Stub used by loader / verify-button wiring
  window.__FL_OPEN_VERIFY_MODAL__ = openVerifyModal;

  // Also expose the name that verify-button.js expects
  // (support both underscore and hyphen, just in case).
  window.verify_button__on_open_VERIFY_MODAL__ = function (ctx) {
    openVerifyModal(ctx || {});
  };
  window["verify-button__on_open_VERIFY_MODAL"] =
    window.verify_button__on_open_VERIFY_MODAL__;

  // Guard against double-init
  if (window.__FL_VERIFY_MODAL_INIT__) return;
  window.__FL_VERIFY_MODAL_INIT__ = true;

  // --------------------------------------------------
  // Local state
  // --------------------------------------------------

  const state = {
    host: null,
    card: null,
    summaryEl: null,
    gzMessageEl: null,
    isOpen: false,
    lastContext: null,
  };

  // --------------------------------------------------
  // Rendering helpers
  // --------------------------------------------------

  function renderSummary(text) {
    if (!state.summaryEl) return;
    state.summaryEl.textContent = text || "";
  }

  function renderGreenZone(host, payload) {
    const el =
      state.gzMessageEl ||
      q("#flv-gz-message", host || state.host || document);
    if (!el) return;

    // Safety default – if something is weird, make it obvious but not fatal
    if (!payload) {
      el.textContent =
        "GreenZone service error.\n\nDebug JSON:\n" +
        JSON.stringify({ status: 0, error: "No payload" }, null, 2);
      return;
    }

    const status =
      typeof payload.status === "number" ? payload.status : payload.status || 0;
    const suggestions = Array.isArray(payload.suggestions)
      ? payload.suggestions
      : [];
    const stats = payload.stats || null;
    const err = payload.error || null;

    const lines = [];

    // -----------------------------
    // HTTP / API-level error
    // -----------------------------
    if (status === 0 || status >= 400 || err) {
      lines.push("GreenZone service error.\n");

      if (status && status !== 0) {
        lines.push("Status: " + status);
      }

      if (err) {
        lines.push("Reason: " + err);
      } else if (!status || status === 0) {
        lines.push("Reason: Unknown error.");
      }

      lines.push("");
      lines.push("Debug JSON (latest suggestions):");
      lines.push(JSON.stringify(payload, null, 2));

      el.textContent = lines.join("\n");
      return;
    }

    // -----------------------------
    // No stats yet – early “not enough data”
    // -----------------------------
    if (!stats) {
      lines.push(
        "Not enough data yet to identify GreenZone races. Capture more verified races to unlock suggestions.\n"
      );
      lines.push("Debug JSON (latest suggestions):");
      lines.push(JSON.stringify(payload, null, 2));
      el.textContent = lines.join("\n");
      return;
    }

    const strategyName = stats.strategyName || "v1_shadow_only";
    const version = stats.version != null ? stats.version : 1;
    const generatedAt = stats.generatedAt || stats.generated_at || null;
    const legs = stats.legs || {};

    lines.push("Shadow Calibration (v1)");
    lines.push("-------------------------------------");
    lines.push("Strategy: " + strategyName + " (v" + version + ")");
    if (generatedAt) {
      lines.push("Generated at: " + generatedAt);
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
        lines.push("  Shadow YES rows: " + leg.shadowYes);
      }
      if (typeof leg.hit_rate_shadow === "number") {
        lines.push(
          "  Hit rate (shadow YES): " + pct(leg.hit_rate_shadow)
        );
      }
      if (typeof leg.hit_rate_overall === "number") {
        lines.push(
          "  Hit rate (overall):    " + pct(leg.hit_rate_overall)
        );
      }
      if (typeof leg.roi_shadow === "number") {
        lines.push("  Avg ROI (shadow YES): " + pct(leg.roi_shadow));
      }
      if (typeof leg.roi_overall === "number") {
        lines.push("  Avg ROI (overall):    " + pct(leg.roi_overall));
      }
      lines.push("");
    }

    addLeg("win", legs.win);
    addLeg("place", legs.place);
    addLeg("show", legs.show);

    if (!suggestions.length) {
      lines.push(
        "Not enough per-race data yet to highlight specific GreenZone races."
      );
      lines.push("");
      lines.push(
        "As you verify more races, any horses that match the GREEN zone thresholds will appear here."
      );
    } else {
      lines.push("GreenZone suggestions:");
      suggestions.forEach(function (s, idx) {
        lines.push(
          "#" +
            (idx + 1) +
            "  Track: " +
            (s.track || "?") +
            "  Race #: " +
            (s.raceNo || s.race || "?")
        );
        if (s.horseName || s.horse) {
          lines.push(
            "    Horse: " + (s.horseName || s.horse || "?")
          );
        }
        if (s.leg) {
          lines.push("    Leg: " + s.leg);
        }
        if (typeof s.score === "number") {
          lines.push("    Score: " + s.score);
        }
        lines.push("");
      });
    }

    lines.push("");
    lines.push("Debug JSON (latest suggestions):");
    lines.push(JSON.stringify(payload, null, 2));

    el.textContent = lines.join("\n");
  }

  // --------------------------------------------------
  // GreenZone fetch (Hybrid C: POST with backend stats)
  // --------------------------------------------------

  async function refreshGreenZone(host, ctx) {
    const msgEl =
      state.gzMessageEl ||
      q("#flv-gz-message", host || state.host || document);
    if (msgEl) msgEl.textContent = "Loading...";

    let payload;

    try {
      const body = {
        race: {
          track:
            (ctx && ctx.track) ||
            (ctx && ctx.race && ctx.race.track) ||
            null,
          raceNo:
            (ctx && ctx.raceNo) ||
            (ctx && ctx.race && ctx.race.raceNo) ||
            null,
          date:
            (ctx && ctx.date) ||
            (ctx && ctx.race && ctx.race.date) ||
            null,
        },
        shadowDecision: (ctx && ctx.shadowDecision) || null,
      };

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
        // Ignore JSON parse failure, we'll just treat as empty
      }

      if (!res.ok) {
        payload = {
          status: status,
          error: (json && json.error) || "HTTP " + status,
          suggestions: (json && json.suggestions) || [],
        };
      } else {
        payload = Object.assign({ status: status }, json || {});
      }
    } catch (error) {
      if (window.__flVerifyDebug) {
        console.error("[Verify Modal] GreenZone fetch failed", error);
      }
      payload = {
        status: 0,
        error:
          (error && error.message && "Network error: " + error.message) ||
          "Network error",
        suggestions: [],
      };
    }

    renderGreenZone(host || state.host, payload);
  }

  // --------------------------------------------------
  // Modal construction
  // --------------------------------------------------

  function buildModal() {
    if (state.host) return state.host;

    const host = document.createElement("div");
    host.id = "fl-verify-modal-host";
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:none;" +
      "align-items:center;justify-content:center;background:rgba(0,0,0,.55);";

    const card = document.createElement("div");
    card.className = "flv-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("data-build", "datefix-final3");
    card.style.cssText =
      "width:min(880px,90vw);max-height:90vh;overflow:auto;border-radius:16px;" +
      "border:1px solid rgba(255,255,255,.12);background:rgba(23,23,28,.96);" +
      "backdrop-filter:blur(6px);padding:18px;" +
      "color:#f9fbff;font-family:system-ui,-apple-system,BlinkMacSystemFont," +
      '"Segoe UI",sans-serif;font-size:14px;';

    // Header
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;";

    const title = document.createElement("h2");
    title.textContent = "Verify Race";
    title.style.cssText = "font-size:16px;font-weight:600;margin:0;";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.style.cssText =
      "border:none;background:transparent;color:#e05e7b;font-size:18px;" +
      "cursor:pointer;padding:0 4px;";
    closeBtn.addEventListener("click", closeModal);

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Summary section
    const summarySection = document.createElement("section");
    const summaryLabel = document.createElement("div");
    summaryLabel.textContent = "Summary";
    summaryLabel.style.cssText =
      "font-weight:500;margin:8px 0 4px;letter-spacing:.02em;" +
      "text-transform:uppercase;font-size:11px;color:#9bc3af;";

    const summaryPre = document.createElement("pre");
    summaryPre.id = "flv-summary-text";
    summaryPre.style.cssText =
      "white-space:pre-wrap;font-family:ui-monospace,Menlo,Monaco,Consolas," +
      '"Liberation Mono","Courier New",monospace;' +
      "background:rgba(35,42,71,.29);padding:8px;border-radius:8px;" +
      "border:1px solid rgba(143,163,184,.4);font-size:12px;";

    summarySection.appendChild(summaryLabel);
    summarySection.appendChild(summaryPre);

    // GreenZone section
    const gzSection = document.createElement("section");
    gzSection.style.cssText = "margin-top:12px;";

    const gzLabel = document.createElement("div");
    gzLabel.textContent = "GreenZone Data";
    gzLabel.style.cssText =
      "font-weight:500;margin:8px 0 4px;letter-spacing:.02em;" +
      "text-transform:uppercase;font-size:11px;color:#9bc3af;";

    const gzPre = document.createElement("pre");
    gzPre.id = "flv-gz-message";
    gzPre.style.cssText = summaryPre.style.cssText;

    gzSection.appendChild(gzLabel);
    gzSection.appendChild(gzPre);

    card.appendChild(header);
    card.appendChild(summarySection);
    card.appendChild(gzSection);
    host.appendChild(card);
    document.body.appendChild(host);

    state.host = host;
    state.card = card;
    state.summaryEl = summaryPre;
    state.gzMessageEl = gzPre;

    // Concrete implementation is ready – wire the stub
    window.__FL_VERIFY_MODAL_OPEN_IMPL__ = openImpl;

    return host;
  }

  // --------------------------------------------------
  // Open / Close
  // --------------------------------------------------

  function openImpl(ctx) {
    const host = buildModal();
    host.style.display = "flex";
    state.isOpen = true;
    state.lastContext = ctx || {};

    if (ctx && ctx.summaryText) {
      renderSummary(ctx.summaryText);
    } else if (ctx && ctx.rawSummary) {
      renderSummary(ctx.rawSummary);
    } else {
      renderSummary("");
    }

    refreshGreenZone(host, ctx || {});
  }

  function closeModal() {
    if (!state.host) return;
    state.host.style.display = "none";
    state.isOpen = false;
  }

  // --------------------------------------------------
  // Safety wiring for legacy “Verify” button
  // (Your loader should still call __FL_OPEN_VERIFY_MODAL__)
  // --------------------------------------------------

  function wireFallbackButton() {
    const btn =
      q('[data-role="verify-button"]') ||
      q("#verify-button") ||
      q('button[data-fl-verify]');

    if (!btn) return;

    btn.addEventListener("click", function (evt) {
      // If some other script already handled this, don't interfere
      if (evt.defaultPrevented) return;
      evt.preventDefault();
      openVerifyModal({});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireFallbackButton);
  } else {
    wireFallbackButton();
  }
})();
