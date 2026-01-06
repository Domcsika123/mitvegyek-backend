// public/widget.js
(function () {
  /* ===================== AUTH ===================== */

  function mvGetWidgetAuth() {
    var url;
    try {
      url = new URL(window.location.href);
    } catch (e) {
      url = null;
    }

    var urlSiteKey = url ? url.searchParams.get("site_key") : null;
    var urlApiKey = url ? url.searchParams.get("api_key") : null;

    // ✅ preview: "bubble" | "panel" | null
    var urlPreview = url ? url.searchParams.get("mv_preview") : null;

    var script =
      document.currentScript ||
      document.querySelector("script[data-site-key], script[data-api-key]");
    if (!script) {
      var scripts = document.getElementsByTagName("script");
      if (scripts.length > 0) script = scripts[scripts.length - 1];
    }

    var attrSiteKey = script ? script.getAttribute("data-site-key") : null;
    var attrApiKey = script ? script.getAttribute("data-api-key") : null;

    var siteKey = urlSiteKey || attrSiteKey || "default";
    var apiKey = urlApiKey || attrApiKey || "";

    return {
      siteKey: siteKey,
      apiKey: apiKey,
      preview: (urlPreview || "").trim().toLowerCase(),
    };
  }

  var MV_AUTH = mvGetWidgetAuth();
  function mvRefreshAuth() {
    MV_AUTH = mvGetWidgetAuth();
  }

  /* ===================== PREVIEW MODE (WIDGET EDITOR IFRAME) ===================== */

  function getPreviewKind() {
    try {
      if (window.MV_WIDGET_PREVIEW === true) return "panel";

      var p = (MV_AUTH && MV_AUTH.preview) ? String(MV_AUTH.preview) : "";
      p = p.trim().toLowerCase();

      if (p === "bubble" || p === "panel") return p;

      if (p === "1" || p === "true") return "panel";

      return "";
    } catch (_) {
      return "";
    }
  }

  function isPreviewMode() {
    return !!getPreviewKind();
  }

  var MV_PREVIEW_MODE = isPreviewMode();

  /* ===================== PARTNER STATUS (HIDE WIDGET IF BLOCKED/DELETED) ===================== */

  async function checkPartnerAllowed() {
    mvRefreshAuth();

    // preview módban ne blokkoljunk CORS/allowed_domains miatt
    if (isPreviewMode()) return true;

    if (!MV_AUTH.apiKey && (MV_AUTH.siteKey === "default" || !MV_AUTH.siteKey)) {
      return true;
    }

    try {
      var resp = await fetch(
        "/api/partner-status?site_key=" + encodeURIComponent(MV_AUTH.siteKey || "default"),
        {
          method: "GET",
          headers: { "x-mv-api-key": MV_AUTH.apiKey || "" },
        }
      );

      var data = {};
      try {
        data = await resp.json();
      } catch (_) {
        data = {};
      }

      return data && data.allowed === true;
    } catch (e) {
      return false;
    }
  }

  /* ===================== DEFAULT CONFIG (DESIGN MARAD) ===================== */

  var MV_DEFAULT_CONFIG = {
    bubble_texts: [
      "Ez a tuti. Nyomd meg!",
      "Dönts könnyebben.",
      "Ne vacillálj! Segítek!",
      "Ez a tuti. Nyomd meg!",
      "Egy kattintás és kész!",
      "Könnyebb így.",
      "Ne vacillálj, megoldjuk.",
      "Kattints, és kész.",
      "Kíváncsi vagy? Katt!",
      "Ez a segítség amire vártál!",
      "Itt kezdődik a jó döntés.",
    ],
    panel_title: "Termékajánló",
    panel_subtitle: "Pár adat alapján mutatok jó találatokat",
    interest_placeholder: "pl. futás, tech, kávé, fotózás",
    details_placeholder: "pl. szereti a praktikus dolgokat, kütyüket, sportot...",
    theme: {
      bubble_bg: "#3b82f6",
      bubble_text: "#ffffff",
      panel_bg: "#ffffff",
      panel_text: "#0F172A",
      button_bg: "#6366F1",
      button_text: "#ffffff",
      accent: "#6366F1",
      header_grad_start: "#6366F1",
      header_grad_end: "#3B82F6",
    },
  };

  var MV_CONFIG = JSON.parse(JSON.stringify(MV_DEFAULT_CONFIG));

  function safeStr(v, fallback) {
    if (v === null || v === undefined) return fallback;
    var s = String(v);
    return s.length ? s : fallback;
  }

  function isHexColor(s) {
    return typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
  }

  function mergeConfig(raw) {
    if (!raw || typeof raw !== "object") return;

    if (Array.isArray(raw.bubble_texts)) {
      var arr = raw.bubble_texts
        .map(function (x) { return String(x || "").trim(); })
        .filter(Boolean);
      if (arr.length) MV_CONFIG.bubble_texts = arr;
    }

    MV_CONFIG.panel_title = safeStr(raw.panel_title, MV_CONFIG.panel_title);
    MV_CONFIG.panel_subtitle = safeStr(raw.panel_subtitle, MV_CONFIG.panel_subtitle);
    MV_CONFIG.interest_placeholder = safeStr(raw.interest_placeholder, MV_CONFIG.interest_placeholder);
    MV_CONFIG.details_placeholder = safeStr(raw.details_placeholder, MV_CONFIG.details_placeholder);

    var t = raw.theme || {};
    MV_CONFIG.theme = MV_CONFIG.theme || {};

    var keys = [
      "bubble_bg",
      "bubble_text",
      "panel_bg",
      "panel_text",
      "button_bg",
      "button_text",
      "accent",
      "header_grad_start",
      "header_grad_end"
    ];

    keys.forEach(function (k) {
      if (isHexColor(t[k])) MV_CONFIG.theme[k] = t[k].trim();
    });
  }

  /* ===================== LOAD CONFIG (PUBLIC) ===================== */

  async function fetchPartnerConfig() {
    if (isPreviewMode()) return null;

    try {
      var url = "/api/partner-config?site_key=" + encodeURIComponent(MV_AUTH.siteKey || "default");
      var resp = await fetch(url, {
        method: "GET",
        headers: { "x-mv-api-key": MV_AUTH.apiKey || "" },
      });
      if (!resp.ok) return null;

      var data = null;
      try { data = await resp.json(); } catch (_) { data = null; }
      if (!data || data.ok !== true) return null;

      return data.widget_config || null;
    } catch (e) {
      return null;
    }
  }

  /* ===================== MOBILE FULLSCREEN HELPERS ===================== */

  function isMobileLike() {
    try {
      var w = Math.min(window.innerWidth || 9999, document.documentElement.clientWidth || 9999);
      if (w <= 768) return true;
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
    } catch (_) {}
    return false;
  }

  function lockBodyScroll(lock) {
    var body = document.body;
    if (!body) return;

    if (lock) {
      if (!body.getAttribute("data-mv-scroll-lock")) {
        body.setAttribute("data-mv-scroll-lock", "1");
        body.style.overflow = "hidden";
        body.style.touchAction = "none";
      }
    } else {
      if (body.getAttribute("data-mv-scroll-lock")) {
        body.removeAttribute("data-mv-scroll-lock");
        body.style.overflow = "";
        body.style.touchAction = "";
      }
    }
  }

  /* ===================== THEME APPLY ===================== */

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function hexToRgb(hex) {
    var h = String(hex || "").trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null;
    if (h.length === 4) {
      var r = parseInt(h[1] + h[1], 16);
      var g = parseInt(h[2] + h[2], 16);
      var b = parseInt(h[3] + h[3], 16);
      return { r: r, g: g, b: b };
    }
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function rgbToHex(r, g, b) {
    function toHex(x) {
      var s = clamp(Math.round(x), 0, 255).toString(16);
      return s.length === 1 ? "0" + s : s;
    }
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function lighten(hex, amount) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    var a = clamp(amount, -1, 1);
    var r = c.r + (255 - c.r) * a;
    var g = c.g + (255 - c.g) * a;
    var b = c.b + (255 - c.b) * a;
    return rgbToHex(r, g, b);
  }

  function ensureThemeVars() {
    var styleId = "mv-widget-theme-vars";
    var el = document.getElementById(styleId);
    if (el) return el;

    el = document.createElement("style");
    el.id = styleId;
    el.type = "text/css";
    document.head.appendChild(el);
    return el;
  }

  function applyTheme() {
    var t = MV_CONFIG.theme || MV_DEFAULT_CONFIG.theme;

    var bubbleBase = t.bubble_bg || "#3b82f6";
    var bubbleMid = lighten(bubbleBase, 0.22);

    var headerStart = t.header_grad_start || t.button_bg || "#6366F1";
    var headerEnd = t.header_grad_end || "#3B82F6";

    var buttonBase = t.button_bg || "#6366F1";
    var buttonEnd = lighten(buttonBase, 0.10);

    var css = `
      :root{
        --mv-bubble-bg:${bubbleBase};
        --mv-bubble-bg2:${bubbleMid};
        --mv-bubble-text:${t.bubble_text || "#ffffff"};

        --mv-panel-bg:${t.panel_bg || "#ffffff"};
        --mv-panel-text:${t.panel_text || "#0F172A"};

        --mv-header-grad-start:${headerStart};
        --mv-header-grad-end:${headerEnd};

        --mv-button-grad-start:${buttonBase};
        --mv-button-grad-end:${buttonEnd};
        --mv-button-text:${t.button_text || "#ffffff"};

        --mv-accent:${t.accent || buttonBase};
      }
    `;

    var styleEl = ensureThemeVars();
    styleEl.textContent = css;

    try {
      var root = document.getElementById("mv-widget-root");
      if (!root) return;
      var stops = root.querySelectorAll("#cloudGradient stop");
      if (stops && stops.length >= 3) {
        stops[0].setAttribute("stop-color", bubbleBase);
        stops[1].setAttribute("stop-color", bubbleMid);
        stops[2].setAttribute("stop-color", bubbleBase);
      }
      var bt = root.querySelector(".mv-widget-bubble-text");
      if (bt) bt.style.color = "var(--mv-bubble-text)";
    } catch (_) {}
  }

  function applyTextsToDom() {
    try {
      var span = document.querySelector("#mv-widget-root .mv-widget-bubble-text span");
      if (span) span.textContent = getCurrentBubbleText();
    } catch (_) {}

    var title = document.querySelector("#mv-widget-panel .mv-widget-panel-title");
    if (title) title.textContent = safeStr(MV_CONFIG.panel_title, "Termékajánló");

    var sub = document.querySelector("#mv-widget-panel .mv-widget-panel-subtitle");
    if (sub) sub.textContent = safeStr(MV_CONFIG.panel_subtitle, "");

    var interest = document.getElementById("mv-input-interests");
    if (interest) interest.setAttribute("placeholder", safeStr(MV_CONFIG.interest_placeholder, ""));

    var details = document.getElementById("mv-input-free-text");
    if (details) details.setAttribute("placeholder", safeStr(MV_CONFIG.details_placeholder, ""));
  }

  function applyConfig(raw) {
    MV_CONFIG = JSON.parse(JSON.stringify(MV_DEFAULT_CONFIG));
    mergeConfig(raw);

    if (isPreviewMode()) {
      var arr = Array.isArray(MV_CONFIG.bubble_texts) ? MV_CONFIG.bubble_texts : [];
      MV_BUBBLE_PICKED_TEXT = (arr && arr.length) ? String(arr[0]) : null;
    } else {
      MV_BUBBLE_PICKED_TEXT = null;
    }

    applyTheme();
    applyTextsToDom();
  }

  /* ===================== STATIC BUBBLE TEXT (ONLY ON PAGE LOAD) ===================== */

  var MV_BUBBLE_PICKED_TEXT = null;

  function pickBubbleTextOnce() {
    var arr = Array.isArray(MV_CONFIG.bubble_texts) ? MV_CONFIG.bubble_texts : MV_DEFAULT_CONFIG.bubble_texts;
    if (!arr || !arr.length) arr = ["Ne vacillálj! Segítek!"];

    if (MV_BUBBLE_PICKED_TEXT === null) {
      var idx = Math.floor(Math.random() * arr.length);
      MV_BUBBLE_PICKED_TEXT = arr[idx] || arr[0] || "Ne vacillálj! Segítek!";
    }
    return MV_BUBBLE_PICKED_TEXT;
  }

  function getCurrentBubbleText() {
    if (isPreviewMode() && MV_BUBBLE_PICKED_TEXT !== null) return MV_BUBBLE_PICKED_TEXT;
    return pickBubbleTextOnce();
  }

  function startBubbleRotation() {}
  function stopBubbleRotation() {}

  /* ===================== STYLES ===================== */

  function injectStyles() {
    var styleId = "mv-widget-style-v10";
    if (document.getElementById(styleId)) return;

    var css = `
      .mv-widget-root{
        position: fixed;
        width: 0;
        height: 0;

        right: calc(8px + env(safe-area-inset-right));
        bottom: calc(8px + env(safe-area-inset-bottom));

        z-index: 99999;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      @keyframes floatScaled {
        0%, 100% { transform: translateY(0px) scale(var(--mv-scale)); }
        50%      { transform: translateY(-6px) scale(var(--mv-scale)); }
      }
      @keyframes pulse-shadow {
        0%, 100% { filter: drop-shadow(0 10px 25px rgba(59, 130, 246, 0.38)); }
        50%      { filter: drop-shadow(0 15px 35px rgba(59, 130, 246, 0.55)); }
      }
      @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
      @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

      .mv-widget-bubble-btn{
        position: absolute;
        right: 0;
        bottom: 0;

        width: 520px;
        height: 205px;

        --mv-scale: 0.44;

        border: none;
        cursor: pointer;
        background: transparent;
        padding: 0;

        transform: scale(var(--mv-scale));
        transform-origin: bottom right;

        animation: floatScaled 3s ease-in-out infinite;
        transition: transform 0.25s ease;
        -webkit-tap-highlight-color: transparent;
      }
      .mv-widget-bubble-btn:hover { transform: scale(calc(var(--mv-scale) + 0.04)); }

      .mv-widget-cloud-svg{
        width: 100%;
        height: 100%;
        display: block;
        animation: pulse-shadow 2s ease-in-out infinite;
      }
      .mv-widget-cloud-path { transition: filter 0.3s ease; }
      .mv-widget-bubble-btn:hover .mv-widget-cloud-path { filter: brightness(1.12); }

      .mv-widget-bubble-text{
        position:absolute;
        inset:0;
        display:flex;
        align-items:center;
        justify-content:center;

        transform: translateY( 2px) translateX(24px);

        padding: 48px 110px;
        box-sizing: border-box;

        pointer-events:none;
        user-select:none;

        color: var(--mv-bubble-text, #fff);
        font-weight:900;
        font-size: 30px;
        line-height: 1.1;
        text-align:center;

        text-shadow: 0 2px 14px rgba(0,0,0,0.20);
      }
      .mv-widget-bubble-text span{
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;

        max-width: 520px;
        white-space: normal;
        text-overflow: clip;
        word-break: break-word;
        hyphens: auto;
      }

      .mv-widget-sparkle { position: absolute; width: 10px; height: 10px; background: white; border-radius: 50%; opacity: 0; transition: opacity 0.3s ease; }
      .mv-widget-sparkle-1 { top: 38%; left: 34%; }
      .mv-widget-sparkle-2 { top: 46%; right: 30%; }
      .mv-widget-bubble-btn:hover .mv-widget-sparkle { opacity: 1; animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
      .mv-widget-sparkle-2 { animation-delay: 0.2s; }

      /* PANEL */
      .mv-widget-panel {
        position: fixed;
        right: 20px;
        bottom: 86px;
        width: 420px;
        max-width: calc(100vw - 40px);
        background: var(--mv-panel-bg, #FFFFFF);
        border-radius: 24px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        display: none;
        flex-direction: column;
        overflow: hidden;
        animation: slideUp 0.4s ease;
        max-height: min(640px, calc(100vh - 120px));
        color: var(--mv-panel-text, #0F172A);
      }

      .mv-widget-panel-header {
        background: linear-gradient(135deg, var(--mv-header-grad-start, #6366F1) 0%, var(--mv-header-grad-end, #3B82F6) 100%);
        padding: 18px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
        overflow: hidden;
        flex: 0 0 auto;
      }
      .mv-widget-panel-header::before {
        content: '';
        position: absolute;
        top: -50%;
        right: -50%;
        width: 200%;
        height: 200%;
        background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
        animation: rotate 20s linear infinite;
      }

      .mv-widget-header-content { position: relative; z-index: 1; }
      .mv-widget-panel-title { color: white; font-size: 20px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 2px; }
      .mv-widget-panel-subtitle { color: rgba(255, 255, 255, 0.85); font-size: 12px; font-weight: 600; }

      .mv-widget-close-btn {
        position: relative;
        z-index: 1;
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 36px;
        height: 36px;
        border-radius: 12px;
        cursor: pointer;
        font-size: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        backdrop-filter: blur(10px);
        -webkit-tap-highlight-color: transparent;
      }
      .mv-widget-close-btn:hover { background: rgba(255, 255, 255, 0.3); transform: scale(1.05); }

      .mv-widget-body {
        padding: 16px 16px 16px 16px;
        background: #F8FAFC;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .mv-widget-form-section { margin-bottom: 8px; }
      .mv-widget-section-label {
        font-size: 12px;
        font-weight: 800;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mv-widget-section-label::before {
        content: '';
        width: 3px;
        height: 12px;
        background: linear-gradient(135deg, var(--mv-accent, #6366F1), var(--mv-header-grad-end, #3B82F6));
        border-radius: 2px;
      }

      .mv-widget-input-group { display: flex; gap: 10px; margin-bottom: 8px; }
      .mv-widget-form-field { flex: 1; display: flex; flex-direction: column; }
      .mv-widget-field-label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px; }

      .mv-widget-input, .mv-widget-select, .mv-widget-textarea {
        width: 100%;
        padding: 9px 10px;
        border: 2px solid #E2E8F0;
        border-radius: 12px;
        font-size: 14px;
        font-family: inherit;
        background: white;
        color: #0F172A;
        transition: all 0.2s ease;
        font-weight: 600;
        box-sizing: border-box;
      }

      .mv-widget-input:focus, .mv-widget-select:focus, .mv-widget-textarea:focus {
        outline: none;
        border-color: var(--mv-accent, #6366F1);
        box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
        transform: translateY(-1px);
      }

      .mv-widget-textarea { resize: vertical; min-height: 54px; line-height: 1.45; }

      .mv-widget-results-title {
        display: none;
        color: #166534;
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        font-weight: 900;
        letter-spacing: -0.2px;
        padding: 10px 12px;
        border-radius: 10px;
        margin-top: 8px;
        margin-bottom: 10px;
      }

      .mv-widget-results { margin-top: 0; display: flex; flex-direction: column; gap: 10px; }

      .mv-widget-result-item {
        border-radius: 14px;
        border: 2px solid #E2E8F0;
        background: #fff;
        padding: 12px;
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 12px;
        transition: all 0.2s ease;
        align-items: start;
      }
      .mv-widget-result-item:hover {
        border-color: var(--mv-accent, #6366F1);
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
        transform: translateY(-2px);
      }

      .mv-widget-result-media {
        width: 72px; height: 72px; border-radius: 12px;
        background: #eef2ff; border: 1px solid #E2E8F0;
        overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .mv-widget-result-image { width: 100%; height: 100%; object-fit: cover; display: block; }
      .mv-widget-result-placeholder { font-weight: 900; color: var(--mv-accent, #6366F1); font-size: 18px; }
      .mv-widget-result-content { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
      .mv-widget-result-topline { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .mv-widget-result-name { font-size: 14px; font-weight: 900; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .mv-widget-result-price { font-size: 13px; color: var(--mv-accent, #6366F1); font-weight: 800; flex-shrink: 0; }

      .mv-widget-result-reason {
        font-size: 11px; color: #64748b; line-height: 1.4; font-weight: 700;
        display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
      }

      .mv-widget-result-link {
        margin-top: 4px; align-self: flex-start;
        border-radius: 10px; border: none;
        background: rgba(99, 102, 241, 0.12);
        color: var(--mv-accent, #6366F1);
        font-size: 12px;
        padding: 7px 12px;
        cursor: pointer;
        text-decoration: none;
        font-weight: 900;
        transition: all 0.2s ease;
      }
      .mv-widget-result-link:hover { background: rgba(99, 102, 241, 0.2); transform: translateX(2px); }

      .mv-widget-submit-section {
        flex: 0 0 auto;
        padding: 12px 16px 16px 16px;
        background: #F8FAFC;
        border-top: 2px solid #E2E8F0;
      }

      .mv-widget-submit-btn {
        width: 100%;
        padding: 14px;
        background: linear-gradient(135deg, var(--mv-button-grad-start, #6366F1) 0%, var(--mv-button-grad-end, #3B82F6) 100%);
        border: none;
        border-radius: 14px;
        color: var(--mv-button-text, #fff);
        font-size: 15px;
        font-weight: 900;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 8px 24px rgba(99, 102, 241, 0.4);
      }

      .mv-widget-reset-btn {
        width: 100%;
        padding: 11px;
        background: white;
        border: 2px solid #E2E8F0;
        border-radius: 12px;
        color: #64748b;
        font-size: 14px;
        font-weight: 800;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: 8px;
      }

      .mv-widget-help-text { font-size: 11px; color: #94a3b8; margin-top: 10px; text-align: center; line-height: 1.35; font-weight: 700; }

      .mv-widget-status {
        font-size: 13px; line-height: 1.45;
        margin-top: 10px; padding: 10px 12px;
        border-radius: 10px; font-weight: 700;
      }
      .mv-widget-status-error { color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; }
      .mv-widget-status-ok { color: #166534; background: #f0fdf4; border: 1px solid #bbf7d0; }

      @media (max-width: 768px), (pointer: coarse) {
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-root{
          right: calc(8px + env(safe-area-inset-right)) !important;
          bottom: calc(8px + env(safe-area-inset-bottom)) !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-bubble-btn{
          --mv-scale: 0.75 !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-bubble-text{
          font-size: 40px !important;
          padding: 54px 120px !important;
          line-height: 1.08 !important;
        }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-bubble-text span{
          -webkit-line-clamp: 2 !important;
          max-width: 720px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel {
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          height: 100dvh !important;
          max-width: none !important;
          max-height: none !important;

          border-radius: 0 !important;
          box-shadow: 0 20px 60px rgba(0,0,0,0.35) !important;
          animation: none !important;

          display: flex !important;
          flex-direction: column !important;

          font-size: 36px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel-header {
          padding-top: calc(34px + env(safe-area-inset-top)) !important;
          padding-left: calc(30px + env(safe-area-inset-left)) !important;
          padding-right: calc(30px + env(safe-area-inset-right)) !important;
          padding-bottom: 30px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-close-btn{
          width: 64px !important;
          height: 64px !important;
          border-radius: 20px !important;
          font-size: 36px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-body {
          padding: 36px 30px 36px 30px !important;
          overflow-y: auto !important;
          -webkit-overflow-scrolling: touch;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          gap: 22px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-submit-section {
          padding-left: calc(30px + env(safe-area-inset-left)) !important;
          padding-right: calc(30px + env(safe-area-inset-right)) !important;
          padding-bottom: calc(30px + env(safe-area-inset-bottom)) !important;
          padding-top: 28px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-input-group {
          flex-direction: column !important;
          gap: 24px !important;
          margin-bottom: 20px !important;
        }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-form-field { width: 100% !important; flex: 0 0 auto !important; }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel-title { font-size: 56px !important; }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel-subtitle { font-size: 34px !important; }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-section-label {
          font-size: 32px !important;
          margin-bottom: 20px !important;
        }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-field-label {
          font-size: 30px !important;
          margin-bottom: 14px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-input,
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-select,
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-textarea {
          font-size: 38px !important;
          padding: 28px 24px !important;
          border-radius: 26px !important;
        }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-textarea {
          min-height: 220px !important;
          line-height: 1.6 !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-results-title {
          font-size: 38px !important;
          padding: 22px 22px !important;
          border-radius: 20px !important;
          margin-top: 22px !important;
          margin-bottom: 22px !important;
        }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-item {
          grid-template-columns: 1fr !important;
          gap: 20px !important;
          padding: 28px !important;
          border-radius: 30px !important;
        }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-media {
          width: 100% !important;
          height: 340px !important;
          border-radius: 26px !important;
        }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-name { font-size: 40px !important; white-space: normal !important; }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-price { font-size: 34px !important; }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-reason { font-size: 30px !important; -webkit-line-clamp: 10 !important; }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-link { font-size: 34px !important; padding: 22px 28px !important; border-radius: 22px !important; }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-submit-btn { font-size: 38px !important; padding: 30px !important; border-radius: 30px !important; }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-reset-btn { font-size: 34px !important; padding: 26px !important; border-radius: 26px !important; }

        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-help-text { font-size: 26px !important; }
        html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-status { font-size: 30px !important; padding: 22px 22px !important; border-radius: 20px !important; }
      }


      /* ===== PREVIEW MÓD (csak szerkesztőhöz) ===== */

      /* bubble preview: középre, ne lebegjen, ne legyen kattintható */
      .mv-preview-bubble .mv-widget-root{
        position: relative;
        left: 0; top: 0; right: auto; bottom: auto;
        width: 100vw; height: 100vh;
      }
      .mv-preview-bubble .mv-widget-panel{ display:none !important; }
      .mv-preview-bubble .mv-widget-bubble-btn{
        left: 50%;
        top: 50%;
        right: auto;
        bottom: auto;
        transform-origin: center;
        animation: none !important;
        transform: translate(-50%, -50%) scale(var(--mv-scale)) !important;

        pointer-events: none !important;
        cursor: default !important;
      }
      .mv-preview-bubble .mv-widget-bubble-btn:hover{
        transform: translate(-50%, -50%) scale(var(--mv-scale)) !important;
      }

      /* ✅ panel preview: KÖZÉPRE + NAGYOBB (csak preview-ban), felhő rejtve, close tiltva */
      .mv-preview-panel .mv-widget-bubble-btn{ display:none !important; }

      .mv-preview-panel .mv-widget-panel{
        display:flex !important;

        right: auto !important;
        bottom: auto !important;
        left: 50% !important;
        top: 50% !important;

        /* hagyjuk a normál desktop méretet */
        width: 420px !important;
        max-width: calc(100vw - 40px) !important;
        max-height: calc(100vh - 40px) !important;

        transform: translate(-50%, -50%) !important;
        transform-origin: center !important;

        animation: none !important;
      }


      .mv-preview-panel .mv-widget-close-btn{
        pointer-events: none !important;
        cursor: default !important;
        opacity: 0.85;
      }
    `;

    var style = document.createElement("style");
    style.id = styleId;
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* ===================== STATE (LAZY PANEL) ===================== */

  var MV_STATE = {
    root: null,
    bubbleBtn: null,
    panel: null,
  };

  /* ===================== DOM: BUBBLE ONLY ===================== */

  function ensureBubbleOnlyDom() {
    if (document.getElementById("mv-widget-root")) {
      MV_STATE.root = document.getElementById("mv-widget-root");
      MV_STATE.bubbleBtn = MV_STATE.root.querySelector(".mv-widget-bubble-btn");
      applyTextsToDom();
      return;
    }

    var root = document.createElement("div");
    root.id = "mv-widget-root";
    root.className = "mv-widget-root";

    var bubbleBtn = document.createElement("button");
    bubbleBtn.type = "button";
    bubbleBtn.className = "mv-widget-bubble-btn";

    bubbleBtn.innerHTML = `
      <svg class="mv-widget-cloud-svg"
           viewBox="10 2 280 128"
           preserveAspectRatio="xMaxYMax meet"
           aria-hidden="true">
        <defs>
          <linearGradient id="cloudGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${(MV_CONFIG.theme && MV_CONFIG.theme.bubble_bg) || "#3b82f6"}"/>
            <stop offset="50%" stop-color="${(MV_CONFIG.theme && lighten(MV_CONFIG.theme.bubble_bg || "#3b82f6", 0.22)) || "#60a5fa"}"/>
            <stop offset="100%" stop-color="${(MV_CONFIG.theme && MV_CONFIG.theme.bubble_bg) || "#3b82f6"}"/>
          </linearGradient>
        </defs>
        <path class="mv-widget-cloud-path" fill="url(#cloudGradient)"
          d="M 260 120
             C 278 110 290 95 290 75
             C 290 45 262 18 228 18
             C 216 18 205 21 196 26
             C 180 2 150 -6 122 12
             C 102 2 74 12 58 38
             C 32 40 10 60 10 86
             C 10 112 32 130 58 130
             L 240 130
             C 254 130 272 126 260 120
             Z" />
      </svg>

      <div class="mv-widget-bubble-text">
        <span>${getCurrentBubbleText()}</span>
      </div>

      <div class="mv-widget-sparkle mv-widget-sparkle-1"></div>
      <div class="mv-widget-sparkle mv-widget-sparkle-2"></div>
    `;

    root.appendChild(bubbleBtn);
    document.body.appendChild(root);

    MV_STATE.root = root;
    MV_STATE.bubbleBtn = bubbleBtn;

    bubbleBtn.addEventListener("click", function () {
      // preview bubble módban sose nyíljon meg
      if (getPreviewKind() === "bubble") return;
      openPanel();
    });

    applyTheme();
    applyTextsToDom();
    startBubbleRotation();
  }

  /* ===================== DOM: PANEL (LAZY) ===================== */

  function buildPanelDom() {
    if (!MV_STATE.root) ensureBubbleOnlyDom();
    if (MV_STATE.panel && document.getElementById("mv-widget-panel")) return;

    var panel = document.createElement("div");
    panel.id = "mv-widget-panel";
    panel.className = "mv-widget-panel";

    var header = document.createElement("div");
    header.className = "mv-widget-panel-header";

    var headerContent = document.createElement("div");
    headerContent.className = "mv-widget-header-content";
    headerContent.innerHTML =
      '<div class="mv-widget-panel-title">' + safeStr(MV_CONFIG.panel_title, "Termékajánló") + "</div>" +
      '<div class="mv-widget-panel-subtitle">' + safeStr(MV_CONFIG.panel_subtitle, "") + "</div>";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mv-widget-close-btn";
    closeBtn.innerHTML = "&times;";

    // ✅ preview panel módban a close ne legyen kattintható (vizuál marad)
    if (getPreviewKind() === "panel") {
      closeBtn.setAttribute("aria-disabled", "true");
      closeBtn.setAttribute("tabindex", "-1");
    }

    header.appendChild(headerContent);
    header.appendChild(closeBtn);

    var body = document.createElement("div");
    body.className = "mv-widget-body";

    var section1 = document.createElement("div");
    section1.className = "mv-widget-form-section";
    section1.innerHTML =
      '<div class="mv-widget-section-label">👤 Kinek keresel?</div>' +
      '<div class="mv-widget-form-field">' +
      '<input id="mv-input-relationship" class="mv-widget-input" type="text" placeholder="pl. barátomnak, anyukámnak" />' +
      "</div>";

    var section2 = document.createElement("div");
    section2.className = "mv-widget-form-section";
    section2.innerHTML =
      '<div class="mv-widget-section-label">📊 Alapadatok</div>' +
      '<div class="mv-widget-input-group">' +
      '<div class="mv-widget-form-field">' +
      '<label class="mv-widget-field-label">🎂 Kor</label>' +
      '<input id="mv-input-age" class="mv-widget-input" type="number" min="0" max="120" placeholder="pl. 25" />' +
      "</div>" +
      '<div class="mv-widget-form-field">' +
      '<label class="mv-widget-field-label">⚧ Nem</label>' +
      '<select id="mv-input-gender" class="mv-widget-select">' +
      '<option value="unknown">Mindegy</option>' +
      '<option value="male">Férfi</option>' +
      '<option value="female">Nő</option>' +
      "</select>" +
      "</div>" +
      "</div>";

    var section3 = document.createElement("div");
    section3.className = "mv-widget-form-section";
    section3.innerHTML =
      '<div class="mv-widget-section-label">💰 Költségkeret</div>' +
      '<div class="mv-widget-input-group">' +
      '<div class="mv-widget-form-field">' +
      '<label class="mv-widget-field-label">Minimum (Ft)</label>' +
      '<input id="mv-input-budget-min" class="mv-widget-input" type="number" min="0" placeholder="pl. 3000" />' +
      "</div>" +
      '<div class="mv-widget-form-field">' +
      '<label class="mv-widget-field-label">Maximum (Ft)</label>' +
      '<input id="mv-input-budget-max" class="mv-widget-input" type="number" min="0" placeholder="pl. 15000" />' +
      "</div>" +
      "</div>";

    var section4 = document.createElement("div");
    section4.className = "mv-widget-form-section";
    section4.innerHTML =
      '<div class="mv-widget-section-label">❤️ Érdeklődés</div>' +
      '<div class="mv-widget-form-field">' +
      '<input id="mv-input-interests" class="mv-widget-input" type="text" placeholder="' + safeStr(MV_CONFIG.interest_placeholder, "pl. futás, tech, kávé, fotózás") + '" />' +
      "</div>";

    var section5 = document.createElement("div");
    section5.className = "mv-widget-form-section";
    section5.innerHTML =
      '<div class="mv-widget-section-label">📝 További részletek</div>' +
      '<div class="mv-widget-form-field">' +
      '<textarea id="mv-input-free-text" class="mv-widget-textarea" placeholder="' + safeStr(MV_CONFIG.details_placeholder, "pl. szereti a praktikus dolgokat...") + '"></textarea>' +
      "</div>";

    var resultsTitle = document.createElement("div");
    resultsTitle.id = "mv-results-title";
    resultsTitle.className = "mv-widget-results-title";
    resultsTitle.textContent = "Ajánlatok:";

    var resultsContainer = document.createElement("div");
    resultsContainer.id = "mv-results";
    resultsContainer.className = "mv-widget-results";

    body.appendChild(section1);
    body.appendChild(section2);
    body.appendChild(section3);
    body.appendChild(section4);
    body.appendChild(section5);
    body.appendChild(resultsTitle);
    body.appendChild(resultsContainer);

    var submitSection = document.createElement("div");
    submitSection.className = "mv-widget-submit-section";

    var submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.id = "mv-submit-btn";
    submitBtn.className = "mv-widget-submit-btn";
    submitBtn.textContent = "✨ Ajánlatot kérek";

    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.id = "mv-reset-btn";
    resetBtn.className = "mv-widget-reset-btn";
    resetBtn.textContent = "🔄 Új ajánlat";

    var helpText = document.createElement("div");
    helpText.className = "mv-widget-help-text";
    helpText.textContent = "Tipp: elég 1–2 mező (pl. érdeklődés + max összeg).";

    var statusEl = document.createElement("div");
    statusEl.id = "mv-status";
    statusEl.className = "mv-widget-status";
    statusEl.style.display = "none";

    submitSection.appendChild(submitBtn);
    submitSection.appendChild(resetBtn);
    submitSection.appendChild(helpText);
    submitSection.appendChild(statusEl);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(submitSection);

    MV_STATE.root.appendChild(panel);
    MV_STATE.panel = panel;

    closeBtn.addEventListener("click", function () {
      // ✅ preview panel módban tilos bezárni
      if (getPreviewKind() === "panel") return;
      closePanel(true);
    });

    submitBtn.addEventListener("click", function () {
      handleRecommendClick();
    });

    resetBtn.addEventListener("click", function () {
      resetForm();
    });

    applyTheme();
    applyTextsToDom();
  }

  function openPanel() {
    buildPanelDom();
    var panel = document.getElementById("mv-widget-panel");
    if (!panel) return;

    panel.style.display = "flex";
    if (MV_STATE.bubbleBtn) MV_STATE.bubbleBtn.style.display = "none";
    stopBubbleRotation();
    if (isMobileLike()) lockBodyScroll(true);
  }

  function closePanel(removeFromDom) {
    var panel = document.getElementById("mv-widget-panel");

    if (panel) {
      panel.style.display = "none";
      if (removeFromDom) {
        panel.parentNode && panel.parentNode.removeChild(panel);
        MV_STATE.panel = null;
      }
    }

    if (MV_STATE.bubbleBtn) MV_STATE.bubbleBtn.style.display = "block";
    lockBodyScroll(false);
    startBubbleRotation();
  }

  /* ===================== LOGIC ===================== */

  function resetForm() {
    var ids = [
      "mv-input-relationship",
      "mv-input-age",
      "mv-input-budget-min",
      "mv-input-budget-max",
      "mv-input-interests",
      "mv-input-free-text",
    ];

    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = "";
    });

    var genderSelect = document.getElementById("mv-input-gender");
    if (genderSelect) genderSelect.value = "unknown";

    var statusEl = document.getElementById("mv-status");
    var resultsTitle = document.getElementById("mv-results-title");
    var resultsEl = document.getElementById("mv-results");

    if (statusEl) {
      statusEl.style.display = "none";
      statusEl.textContent = "";
      statusEl.className = "mv-widget-status";
    }
    if (resultsTitle) resultsTitle.style.display = "none";
    if (resultsEl) resultsEl.innerHTML = "";

    var resetBtn = document.getElementById("mv-reset-btn");
    if (resetBtn) {
      resetBtn.textContent = "✓ Törölve!";
      setTimeout(function () {
        resetBtn.textContent = "🔄 Új ajánlat";
      }, 1200);
    }

    try {
      var bodyEl = document.querySelector("#mv-widget-panel .mv-widget-body");
      if (bodyEl) bodyEl.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {}
  }

  function parseNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    var n = Number(value);
    return isNaN(n) ? null : n;
  }

  function isEmptyString(s) {
    return !s || String(s).trim().length === 0;
  }

  function scrollToResultsTitle() {
    var title = document.getElementById("mv-results-title");
    if (!title) return;
    try {
      title.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (_) {
      title.scrollIntoView(true);
    }
  }

  async function handleRecommendClick() {
    mvRefreshAuth();

    var statusEl = document.getElementById("mv-status");
    var resultsTitle = document.getElementById("mv-results-title");
    var resultsEl = document.getElementById("mv-results");
    if (!statusEl || !resultsEl) return;

    if (resultsTitle) resultsTitle.style.display = "none";
    statusEl.textContent = "";
    statusEl.className = "mv-widget-status";
    statusEl.style.display = "none";
    resultsEl.innerHTML = "";

    var ageInput = document.getElementById("mv-input-age");
    var genderInput = document.getElementById("mv-input-gender");
    var relInput = document.getElementById("mv-input-relationship");
    var minInput = document.getElementById("mv-input-budget-min");
    var maxInput = document.getElementById("mv-input-budget-max");
    var interestsInput = document.getElementById("mv-input-interests");
    var freeTextInput = document.getElementById("mv-input-free-text");

    var age = parseNumberOrNull(ageInput && ageInput.value);
    var gender = genderInput ? genderInput.value || "unknown" : "unknown";
    var relationship = relInput ? relInput.value || "" : "";
    var budgetMin = parseNumberOrNull(minInput && minInput.value);
    var budgetMax = parseNumberOrNull(maxInput && maxInput.value);
    var interestsRaw = interestsInput ? interestsInput.value || "" : "";
    var freeText = freeTextInput ? freeTextInput.value || "" : "";

    var interests = [];
    if (interestsRaw.trim().length > 0) {
      interests = interestsRaw
        .split(",")
        .map(function (x) { return x.trim(); })
        .filter(function (x) { return x.length > 0; });
    }

    var hasAnyInput =
      age !== null ||
      budgetMin !== null ||
      budgetMax !== null ||
      !isEmptyString(relationship) ||
      !isEmptyString(freeText) ||
      (Array.isArray(interests) && interests.length > 0);

    if (!hasAnyInput) {
      statusEl.textContent =
        "Adj meg legalább 1 adatot (pl. érdeklődés vagy költségkeret), hogy tudjak ajánlani.";
      statusEl.classList.add("mv-widget-status-error");
      statusEl.style.display = "block";
      return;
    }

    var payload = {
      age: age,
      gender: gender,
      budget_min: budgetMin,
      budget_max: budgetMax,
      relationship: relationship,
      interests: interests,
      free_text: freeText,
      site_key: MV_AUTH.siteKey,
    };

    statusEl.textContent = "Ajánlatok betöltése…";
    statusEl.classList.add("mv-widget-status-ok");
    statusEl.style.display = "block";

    try {
      var response = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mv-api-key": MV_AUTH.apiKey || "",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        var errJson = {};
        try { errJson = await response.json(); } catch (_) {}
        var reason = (errJson && errJson.error) ? (" (" + errJson.error + ")") : "";
        throw new Error("Ajánló API hiba: " + response.status + reason);
      }

      var data = await response.json();
      var items = (data && data.items) || [];

      if (!items || items.length === 0) {
        statusEl.textContent = "Nem találtam megfelelő terméket a megadott feltételekkel.";
        statusEl.classList.remove("mv-widget-status-ok");
        statusEl.classList.add("mv-widget-status-error");
        statusEl.style.display = "block";
        if (resultsTitle) resultsTitle.style.display = "none";
        return;
      }

      statusEl.style.display = "none";
      if (resultsTitle) resultsTitle.style.display = "block";

      renderResults(resultsEl, items);
      setTimeout(scrollToResultsTitle, 60);
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Hiba az ajánlás közben: " + (err && err.message ? err.message : "ismeretlen hiba");
      statusEl.classList.remove("mv-widget-status-ok");
      statusEl.classList.add("mv-widget-status-error");
      statusEl.style.display = "block";
      if (resultsTitle) resultsTitle.style.display = "none";
    }
  }

  function formatPriceFt(num) {
    if (num === null || num === undefined) return "";
    var n = Number(num);
    if (isNaN(n)) return "";
    return n.toLocaleString("hu-HU") + " Ft";
  }

  function renderResults(container, items) {
    container.innerHTML = "";

    items.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "mv-widget-result-item";

      var media = document.createElement("div");
      media.className = "mv-widget-result-media";

      if (item.image_url) {
        var img = document.createElement("img");
        img.className = "mv-widget-result-image";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.onerror = function () {
          media.innerHTML = "";
          var ph = document.createElement("div");
          ph.className = "mv-widget-result-placeholder";
          ph.textContent = "🛍️";
          media.appendChild(ph);
        };
        img.src = item.image_url;
        media.appendChild(img);
      } else {
        var ph2 = document.createElement("div");
        ph2.className = "mv-widget-result-placeholder";
        ph2.textContent = "🛍️";
        media.appendChild(ph2);
      }

      var content = document.createElement("div");
      content.className = "mv-widget-result-content";

      var topLine = document.createElement("div");
      topLine.className = "mv-widget-result-topline";

      var nameEl = document.createElement("div");
      nameEl.className = "mv-widget-result-name";
      nameEl.textContent = item.name || "Ismeretlen termék";

      var priceEl = document.createElement("div");
      priceEl.className = "mv-widget-result-price";
      priceEl.textContent =
        item.price !== undefined && item.price !== null ? formatPriceFt(item.price) : "";

      topLine.appendChild(nameEl);
      topLine.appendChild(priceEl);

      var reasonEl = document.createElement("div");
      reasonEl.className = "mv-widget-result-reason";
      reasonEl.textContent =
        item.reason || "Ezt a terméket a profil és a költségkeret alapján javasoljuk.";

      content.appendChild(topLine);
      content.appendChild(reasonEl);

      if (item.product_url) {
        var link = document.createElement("a");
        link.className = "mv-widget-result-link";
        link.href = item.product_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Megnézem";
        content.appendChild(link);
      }

      card.appendChild(media);
      card.appendChild(content);
      container.appendChild(card);
    });
  }

  /* ===================== PREVIEW: postMessage listener ===================== */

  function setupPreviewListener() {
    if (!isPreviewMode()) return;

    window.addEventListener("message", function (ev) {
      try {
        var data = ev && ev.data ? ev.data : null;
        if (!data || data.type !== "MV_WIDGET_PREVIEW_CONFIG") return;
        applyConfig(data.config || null);
      } catch (_) {}
    });
  }

  /* ===================== INIT ===================== */

  async function init() {
    var allowed = await checkPartnerAllowed();
    if (!allowed) return;

    injectStyles();
    setupPreviewListener();

    if (!isPreviewMode()) {
      var serverCfg = await fetchPartnerConfig();
      if (serverCfg) applyConfig(serverCfg);
      else {
        applyTheme();
        applyTextsToDom();
      }
    }

    ensureBubbleOnlyDom();

    var p = getPreviewKind();
    if (p === "bubble") {
      document.documentElement.classList.add("mv-preview-bubble");
    } else if (p === "panel") {
      document.documentElement.classList.add("mv-preview-panel");
      openPanel(); // jobbra mindig nyitva
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); });
  } else {
    init();
  }
})();
