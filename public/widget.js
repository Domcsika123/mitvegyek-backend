// public/widget.js
// ✅ V2: Schema-driven, általános widget renderer
// Bármilyen webshop/partner esetére: elektronika, kozmetika, könyv, ruházat, ajándék, stb.
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

  /* ===================== PREVIEW MODE ===================== */

  function getPreviewKind() {
    try {
      if (window.MV_WIDGET_PREVIEW === true) return "panel";
      var p = MV_AUTH && MV_AUTH.preview ? String(MV_AUTH.preview) : "";
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

  /* ===================== V2 WIDGET CONFIG (SCHEMA-DRIVEN) ===================== */

  var MV_FULL_CONFIG = null;
  var MV_LEGACY_MODE = false;

  // Legacy config variables (backward compat)
  var MV_CONFIG = null;
  var MV_WIDGET_COPY = null;
  var MV_WIDGET_FIELDS = null;
  var MV_WIDGET_SCHEMA = null;

  function getDefaultFullConfig() {
    return {
      version: 1,
      ui: {
        theme: {
          primaryColor: "#6366F1",
          accentColor: "#6366F1",
          backgroundColor: "#ffffff",
          textColor: "#0F172A",
          buttonRadius: 14,
          fontFamily: "system-ui, -apple-system, sans-serif",
          panelPosition: "right",
          widthPx: 420,
          zIndex: 99999,
          bubblePosition: "bottom-right",
          bubbleOffsetX: 8,
          bubbleOffsetY: 8,
          currency: "HUF",
          bubbleBg: "#3b82f6",
          bubbleText: "#ffffff",
          headerGradStart: "#6366F1",
          headerGradEnd: "#3B82F6",
          buttonBg: "#6366F1",
          buttonText: "#ffffff",
        },
        copy: {
          panelTitle: "Termékajánló",
          panelSubtitle: "Pár adat alapján mutatok jó találatokat",
          helpText: "Tipp: elég 1–2 mező (pl. érdeklődés + max összeg).",
          submitText: "✨ Ajánlatot kérek",
          resetText: "🔄 Új ajánlat",
          loadingText: "Ajánlatok betöltése…",
          emptyStateText: "Nem találtam megfelelő terméket a megadott feltételekkel.",
          errorText: "Hiba az ajánlás közben. Kérlek próbáld újra!",
          consentText: "",
          footerText: "",
        },
      },
      form: {
        fields: [
          { id: "relationship", type: "text", label: "👤 Kinek keresel?", placeholder: "pl. barátomnak, anyukámnak", enabled: true, required: false, order: 10, mapping: { target: "user.relationship", format: "raw" } },
          { id: "age", type: "number", label: "🎂 Kor", placeholder: "pl. 25", enabled: true, required: false, min: 0, max: 120, order: 20, mapping: { target: "user.age", format: "raw" } },
          { id: "gender", type: "select", label: "⚧ Nem", enabled: true, required: false, defaultValue: "unknown", options: [{ value: "unknown", label: "Mindegy" }, { value: "male", label: "Férfi" }, { value: "female", label: "Nő" }], order: 21, mapping: { target: "user.gender", format: "value" } },
          { id: "budget_min", type: "number", label: "💰 Minimum (Ft)", placeholder: "pl. 3000", enabled: true, required: false, min: 0, order: 30, mapping: { target: "user.budget_min", format: "raw" } },
          { id: "budget_max", type: "number", label: "💰 Maximum (Ft)", placeholder: "pl. 15000", enabled: true, required: false, min: 0, order: 31, mapping: { target: "user.budget_max", format: "raw" } },
          { id: "interests", type: "text", label: "❤️ Érdeklődés", placeholder: "pl. futás, tech, kávé, fotózás", enabled: true, required: false, order: 40, mapping: { target: "user.interests", format: "raw" } },
          { id: "free_text", type: "textarea", label: "📝 További részletek", placeholder: "pl. szereti a praktikus dolgokat, kütyüket, sportot...", enabled: true, required: false, order: 50, mapping: { target: "user.free_text", format: "raw" } },
        ],
        submit: { allowEmpty: false, validationMode: "onSubmit" },
      },
      bubble: {
        texts: [
          "Dönts könnyebben.", "Ne vacillálj! Segítek!", "Ez a tuti. Nyomd meg!",
          "Egy kattintás és kész!", "Könnyebb így.", "Ne vacillálj, megoldjuk.",
          "Kattints, és kész.", "Kíváncsi vagy? Katt!",
          "Ez a segítség amire vártál!", "Itt kezdődik a jó döntés.",
        ],
      },
    };
  }

  /* ===================== PARTNER STATUS ===================== */

  async function checkPartnerAllowed() {
    mvRefreshAuth();

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

      // ✅ V2: full_widget_config (schema-driven)
      if (data && data.full_widget_config && data.full_widget_config.version) {
        MV_FULL_CONFIG = data.full_widget_config;
        MV_LEGACY_MODE = false;
      } else {
        MV_LEGACY_MODE = true;
        if (data && data.settings) {
          if (data.settings.widget_copy) MV_WIDGET_COPY = data.settings.widget_copy;
          if (data.settings.widget_fields) MV_WIDGET_FIELDS = data.settings.widget_fields;
          if (data.settings.widget_schema) MV_WIDGET_SCHEMA = data.settings.widget_schema;
        }
      }

      return data && data.allowed === true;
    } catch (e) {
      return false;
    }
  }

  /* ===================== LEGACY DEFAULTS (backward compat) ===================== */

  var MV_DEFAULT_CONFIG = {
    bubble_texts: [
      "Ez a tuti. Nyomd meg!", "Dönts könnyebben.", "Ne vacillálj! Segítek!",
      "Egy kattintás és kész!", "Könnyebb így.", "Ne vacillálj, megoldjuk.",
      "Kattints, és kész.", "Kíváncsi vagy? Katt!",
      "Ez a segítség amire vártál!", "Itt kezdődik a jó döntés.",
    ],
    panel_title: "Termékajánló",
    panel_subtitle: "Pár adat alapján mutatok jó találatokat",
    interest_placeholder: "pl. futás, tech, kávé, fotózás",
    details_placeholder: "pl. szereti a praktikus dolgokat, kütyüket, sportot...",
    theme: {
      bubble_bg: "#3b82f6", bubble_text: "#ffffff",
      panel_bg: "#ffffff", panel_text: "#0F172A",
      button_bg: "#6366F1", button_text: "#ffffff",
      accent: "#6366F1",
      header_grad_start: "#6366F1", header_grad_end: "#3B82F6",
    },
  };

  function safeStr(v, fallback) {
    if (v === null || v === undefined) return fallback;
    var s = String(v);
    return s.length ? s : fallback;
  }

  function isHexColor(s) {
    return typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
  }

  function escapeHtml(str) {
    var s = String(str || "");
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ===================== THEME / CONFIG HELPERS ===================== */

  function getEffectiveConfig() {
    if (MV_FULL_CONFIG && MV_FULL_CONFIG.version) return MV_FULL_CONFIG;
    return getDefaultFullConfig();
  }

  function getTheme() {
    var cfg = getEffectiveConfig();
    return cfg.ui.theme;
  }

  function getCopy() {
    var cfg = getEffectiveConfig();
    return cfg.ui.copy;
  }

  function getFields() {
    var cfg = getEffectiveConfig();
    var fields = cfg.form && cfg.form.fields ? cfg.form.fields : [];
    return fields.filter(function (f) { return f.enabled !== false; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }

  function getBubbleTexts() {
    var cfg = getEffectiveConfig();
    if (cfg.bubble && Array.isArray(cfg.bubble.texts) && cfg.bubble.texts.length) {
      return cfg.bubble.texts;
    }
    return MV_DEFAULT_CONFIG.bubble_texts;
  }

  /* ===================== MOBILE / SCROLL HELPERS ===================== */

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

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function hexToRgb(hex) {
    var h = String(hex || "").trim();
    if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null;
    if (h.length === 4) {
      return { r: parseInt(h[1] + h[1], 16), g: parseInt(h[2] + h[2], 16), b: parseInt(h[3] + h[3], 16) };
    }
    return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
  }

  function rgbToHex(r, g, b) {
    function toHex(x) { var s = clamp(Math.round(x), 0, 255).toString(16); return s.length === 1 ? "0" + s : s; }
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function lighten(hex, amount) {
    var c = hexToRgb(hex);
    if (!c) return hex;
    var a = clamp(amount, -1, 1);
    return rgbToHex(c.r + (255 - c.r) * a, c.g + (255 - c.g) * a, c.b + (255 - c.b) * a);
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
    var t = getTheme();
    var bubbleBg = t.bubbleBg || t.primaryColor || "#3b82f6";
    var bubbleMid = lighten(bubbleBg, 0.22);
    var headerStart = t.headerGradStart || t.buttonBg || t.primaryColor || "#6366F1";
    var headerEnd = t.headerGradEnd || "#3B82F6";
    var buttonBase = t.buttonBg || t.primaryColor || "#6366F1";
    var buttonEnd = lighten(buttonBase, 0.1);
    var accentColor = t.accentColor || t.primaryColor || "#6366F1";

    var css =
      ":root{\n" +
      "  --mv-bubble-bg:" + bubbleBg + ";\n" +
      "  --mv-bubble-bg2:" + bubbleMid + ";\n" +
      "  --mv-bubble-text:" + (t.bubbleText || "#ffffff") + ";\n" +
      "  --mv-panel-bg:" + (t.backgroundColor || "#ffffff") + ";\n" +
      "  --mv-panel-text:" + (t.textColor || "#0F172A") + ";\n" +
      "  --mv-header-grad-start:" + headerStart + ";\n" +
      "  --mv-header-grad-end:" + headerEnd + ";\n" +
      "  --mv-button-grad-start:" + buttonBase + ";\n" +
      "  --mv-button-grad-end:" + buttonEnd + ";\n" +
      "  --mv-button-text:" + (t.buttonText || "#ffffff") + ";\n" +
      "  --mv-accent:" + accentColor + ";\n" +
      "  --mv-offset-x:" + (t.bubbleOffsetX !== undefined ? t.bubbleOffsetX : 8) + "px;\n" +
      "  --mv-offset-y:" + (t.bubbleOffsetY !== undefined ? t.bubbleOffsetY : 8) + "px;\n" +
      "}\n";

    var styleEl = ensureThemeVars();
    styleEl.textContent = css;

    try {
      var root = document.getElementById("mv-widget-root");
      if (!root) return;

      // Update position class
      var pos = t.bubblePosition || "bottom-right";
      var validPos = ["bottom-right","bottom-left","top-right","top-left"];
      if (validPos.indexOf(pos) === -1) pos = "bottom-right";
      root.className = root.className.replace(/mv-pos-[a-z-]+/g, "").trim();
      root.classList.add("mv-pos-" + pos);

      var stops = root.querySelectorAll("#cloudGradient stop");
      if (stops && stops.length >= 3) {
        stops[0].setAttribute("stop-color", bubbleBg);
        stops[1].setAttribute("stop-color", bubbleMid);
        stops[2].setAttribute("stop-color", bubbleBg);
      }
      var bt = root.querySelector(".mv-widget-bubble-text");
      if (bt) bt.style.color = "var(--mv-bubble-text)";
    } catch (_) {}
  }

  /* ===================== BUBBLE TEXT ===================== */

  var MV_BUBBLE_PICKED_TEXT = null;

  function pickBubbleTextOnce() {
    var arr = getBubbleTexts();
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

  /* ===================== LOAD CONFIG ===================== */

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

  function mergeConfig(raw) {
    if (!raw || typeof raw !== "object") return;
    if (!MV_CONFIG) MV_CONFIG = JSON.parse(JSON.stringify(MV_DEFAULT_CONFIG));
    if (Array.isArray(raw.bubble_texts)) {
      var arr = raw.bubble_texts.map(function (x) { return String(x || "").trim(); }).filter(Boolean);
      if (arr.length) MV_CONFIG.bubble_texts = arr;
    }
    MV_CONFIG.panel_title = safeStr(raw.panel_title, MV_CONFIG.panel_title);
    MV_CONFIG.panel_subtitle = safeStr(raw.panel_subtitle, MV_CONFIG.panel_subtitle);
    MV_CONFIG.interest_placeholder = safeStr(raw.interest_placeholder, MV_CONFIG.interest_placeholder);
    MV_CONFIG.details_placeholder = safeStr(raw.details_placeholder, MV_CONFIG.details_placeholder);
    var t = raw.theme || {};
    MV_CONFIG.theme = MV_CONFIG.theme || {};
    ["bubble_bg", "bubble_text", "panel_bg", "panel_text", "button_bg", "button_text", "accent", "header_grad_start", "header_grad_end"].forEach(function (k) {
      if (isHexColor(t[k])) MV_CONFIG.theme[k] = t[k].trim();
    });
  }

  function applyLegacyConfig(raw) {
    MV_CONFIG = JSON.parse(JSON.stringify(MV_DEFAULT_CONFIG));
    mergeConfig(raw);
  }

  /* ===================== STYLES ===================== */

  function injectStyles() {
    var styleId = "mv-widget-style-v10";
    if (document.getElementById(styleId)) return;

    var css =
      ".mv-widget-root{" +
      "  position:fixed;width:0;height:0;" +
      "  z-index:99999;" +
      "  font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
      "}" +
      ".mv-widget-root.mv-pos-bottom-right{right:calc(var(--mv-offset-x, 8px) + env(safe-area-inset-right));bottom:calc(var(--mv-offset-y, 8px) + env(safe-area-inset-bottom));}" +
      ".mv-widget-root.mv-pos-bottom-left{left:calc(var(--mv-offset-x, 8px) + env(safe-area-inset-left));bottom:calc(var(--mv-offset-y, 8px) + env(safe-area-inset-bottom));}" +
      ".mv-widget-root.mv-pos-top-right{right:calc(var(--mv-offset-x, 8px) + env(safe-area-inset-right));top:calc(var(--mv-offset-y, 8px) + env(safe-area-inset-top));}" +
      ".mv-widget-root.mv-pos-top-left{left:calc(var(--mv-offset-x, 8px) + env(safe-area-inset-left));top:calc(var(--mv-offset-y, 8px) + env(safe-area-inset-top));}" +

      "@keyframes floatScaled{" +
      "  0%,100%{transform:translateY(0px) scale(var(--mv-scale));}" +
      "  50%{transform:translateY(-6px) scale(var(--mv-scale));}" +
      "}" +
      "@keyframes pulse-shadow{" +
      "  0%,100%{filter:drop-shadow(0 10px 25px rgba(59,130,246,0.38));}" +
      "  50%{filter:drop-shadow(0 15px 35px rgba(59,130,246,0.55));}" +
      "}" +
      "@keyframes ping{75%,100%{transform:scale(2);opacity:0;}}" +
      "@keyframes slideUp{from{opacity:0;transform:translateY(20px);}to{opacity:1;transform:translateY(0);}}" +
      "@keyframes rotate{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}" +
      "@keyframes mv-gradient-shift{" +
      "  0%{background-position:0% 50%;}" +
      "  50%{background-position:100% 50%;}" +
      "  100%{background-position:0% 50%;}" +
      "}" +

      ".mv-widget-bubble-btn{" +
      "  position:absolute;" +
      "  width:520px;height:250px;" +
      "  --mv-scale:0.44;" +
      "  border:none;cursor:pointer;background:transparent;padding:0;" +
      "  transform:scale(var(--mv-scale));" +
      "  animation:floatScaled 3s ease-in-out infinite;" +
      "  transition:transform 0.25s ease;" +
      "  -webkit-tap-highlight-color:transparent;" +
      "}" +
      ".mv-pos-bottom-right .mv-widget-bubble-btn{right:0;bottom:0;transform-origin:bottom right;}" +
      ".mv-pos-bottom-left .mv-widget-bubble-btn{left:0;bottom:0;transform-origin:bottom left;}" +
      ".mv-pos-top-right .mv-widget-bubble-btn{right:0;top:0;transform-origin:top right;}" +
      ".mv-pos-top-left .mv-widget-bubble-btn{left:0;top:0;transform-origin:top left;}" +
      ".mv-widget-bubble-btn:hover{transform:scale(calc(var(--mv-scale) + 0.04));}" +

      ".mv-widget-cloud-svg{width:100%;height:100%;display:block;animation:pulse-shadow 2s ease-in-out infinite;}" +
      ".mv-widget-cloud-path{transition:filter 0.3s ease;}" +
      ".mv-widget-bubble-btn:hover .mv-widget-cloud-path{filter:brightness(1.12);}" +

      ".mv-widget-bubble-text{" +
      "  position:absolute;inset:0;bottom:auto;height:82%;" +
      "  display:flex;align-items:center;justify-content:center;" +
      "  transform:translateX(60px);" +
      "  padding:30px 80px;box-sizing:border-box;" +
      "  pointer-events:none;user-select:none;" +
      "  color:var(--mv-bubble-text,#fff);" +
      "  font-weight:900;font-size:36px;line-height:1.1;text-align:center;" +
      "  text-shadow:0 2px 14px rgba(0,0,0,0.20);" +
      "}" +
      ".mv-widget-bubble-text span{" +
      "  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;" +
      "  max-width:520px;white-space:normal;text-overflow:clip;word-break:break-word;hyphens:auto;" +
      "}" +

      ".mv-widget-sparkle{position:absolute;width:10px;height:10px;background:white;border-radius:50%;opacity:0;transition:opacity 0.3s ease;}" +
      ".mv-widget-sparkle-1{top:30%;left:34%;}" +
      ".mv-widget-sparkle-2{top:38%;right:30%;}" +
      ".mv-widget-bubble-btn:hover .mv-widget-sparkle{opacity:1;animation:ping 1s cubic-bezier(0,0,0.2,1) infinite;}" +
      ".mv-widget-sparkle-2{animation-delay:0.2s;}" +

      /* PANEL */
      ".mv-widget-panel{" +
      "  position:fixed;" +
      "  width:420px;max-width:calc(100vw - 40px);" +
      "  background:linear-gradient(135deg,var(--mv-header-grad-start,#6366F1) 0%,var(--mv-header-grad-end,#3B82F6) 25%,#0a0a0a 50%,var(--mv-header-grad-end,#3B82F6) 75%,var(--mv-header-grad-start,#6366F1) 100%);" +
      "  background-size:400% 400%;" +
      "  animation:slideUp 0.4s ease, mv-gradient-shift 8s ease infinite;" +
      "  border-radius:24px;" +
      "  box-shadow:0 20px 60px rgba(0,0,0,0.3);" +
      "  display:none;flex-direction:column;overflow:hidden;" +
      "  max-height:min(640px,calc(100vh - 120px));" +
      "  color:var(--mv-panel-text,#0F172A);" +
      "}" +
      ".mv-pos-bottom-right .mv-widget-panel{right:20px;bottom:86px;}" +
      ".mv-pos-bottom-left .mv-widget-panel{left:20px;bottom:86px;}" +
      ".mv-pos-top-right .mv-widget-panel{right:20px;top:86px;}" +
      ".mv-pos-top-left .mv-widget-panel{left:20px;top:86px;}" +

      ".mv-widget-panel-header{" +
      "  background:transparent;" +
      "  padding:18px 20px;display:flex;align-items:center;justify-content:space-between;" +
      "  position:relative;overflow:hidden;flex:0 0 auto;" +
      "}" +
      ".mv-widget-panel-header::before{" +
      "  content:'';position:absolute;top:-50%;right:-50%;width:200%;height:200%;" +
      "  background:radial-gradient(circle,rgba(255,255,255,0.08) 0%,transparent 70%);" +
      "  animation:rotate 20s linear infinite;" +
      "}" +

      ".mv-widget-header-content{position:relative;z-index:1;}" +
      ".mv-widget-panel-title{color:white;font-size:20px;font-weight:800;letter-spacing:-0.5px;margin-bottom:2px;}" +
      ".mv-widget-panel-subtitle{color:rgba(255,255,255,0.85);font-size:12px;font-weight:600;}" +

      ".mv-widget-close-btn{" +
      "  position:relative;z-index:1;" +
      "  background:rgba(255,255,255,0.2);border:none;color:white;" +
      "  width:36px;height:36px;border-radius:12px;cursor:pointer;font-size:20px;" +
      "  display:flex;align-items:center;justify-content:center;" +
      "  transition:all 0.2s ease;backdrop-filter:blur(10px);" +
      "  -webkit-tap-highlight-color:transparent;" +
      "}" +
      ".mv-widget-close-btn:hover{background:rgba(255,255,255,0.3);transform:scale(1.05);}" +

      ".mv-widget-body{" +
      "  padding:16px 16px 16px 16px;background:rgba(0,0,0,0.10);" +
      "  overflow:auto;-webkit-overflow-scrolling:touch;" +
      "  flex:1 1 auto;min-height:0;" +
      "  display:flex;flex-direction:column;gap:8px;" +
      "  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
      "}" +

      ".mv-widget-form-section{margin-bottom:8px;}" +
      ".mv-widget-section-label{" +
      "  font-size:12px;font-weight:800;color:rgba(255,255,255,0.95);" +
      "  text-transform:uppercase;letter-spacing:0.4px;margin-bottom:8px;" +
      "  display:flex;align-items:center;gap:6px;" +
      "  text-shadow:0 1px 3px rgba(0,0,0,0.3);" +
      "}" +
      ".mv-widget-section-label::before{" +
      "  content:'';width:3px;height:12px;" +
      "  background:linear-gradient(135deg,rgba(255,255,255,0.8),rgba(255,255,255,0.4));" +
      "  border-radius:2px;" +
      "}" +

      ".mv-widget-input-group{display:flex;gap:10px;margin-bottom:8px;}" +
      ".mv-widget-form-field{flex:1;display:flex;flex-direction:column;margin-bottom:6px;}" +
      ".mv-widget-field-label{font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);margin-bottom:6px;text-shadow:0 1px 2px rgba(0,0,0,0.2);}" +
      ".mv-widget-field-helper{font-size:10px;font-weight:600;color:rgba(255,255,255,0.55);margin-top:2px;}" +
      ".mv-widget-field-error{font-size:10px;font-weight:700;color:#fca5a5;margin-top:2px;}" +

      ".mv-widget-input,.mv-widget-select,.mv-widget-textarea{" +
      "  width:100%;padding:9px 10px;" +
      "  border:2px solid rgba(255,255,255,0.2);border-radius:12px;" +
      "  font-size:14px;font-family:inherit;" +
      "  background:rgba(255,255,255,0.92);color:#0F172A;" +
      "  transition:all 0.2s ease;font-weight:600;box-sizing:border-box;" +
      "}" +
      ".mv-widget-input:focus,.mv-widget-select:focus,.mv-widget-textarea:focus{" +
      "  outline:none;border-color:var(--mv-accent,#6366F1);" +
      "  box-shadow:0 0 0 4px rgba(99,102,241,0.1);transform:translateY(-1px);" +
      "}" +
      ".mv-widget-textarea{resize:vertical;min-height:54px;line-height:1.45;}" +

      ".mv-widget-radio-group,.mv-widget-checkbox-group{display:flex;flex-wrap:wrap;gap:6px;}" +
      ".mv-widget-radio-item,.mv-widget-checkbox-item{" +
      "  display:flex;align-items:center;gap:4px;" +
      "  font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);cursor:pointer;" +
      "}" +
      ".mv-widget-radio-item input,.mv-widget-checkbox-item input{accent-color:var(--mv-accent,#6366F1);}" +

      ".mv-widget-toggle-wrap{display:flex;align-items:center;gap:8px;}" +
      ".mv-widget-toggle-switch{" +
      "  width:40px;height:22px;border-radius:11px;" +
      "  background:#cbd5e1;position:relative;cursor:pointer;" +
      "  transition:background 0.2s;" +
      "}" +
      ".mv-widget-toggle-switch.active{background:var(--mv-accent,#6366F1);}" +
      ".mv-widget-toggle-switch::after{" +
      "  content:'';position:absolute;top:2px;left:2px;" +
      "  width:18px;height:18px;border-radius:50%;" +
      "  background:white;transition:transform 0.2s;" +
      "}" +
      ".mv-widget-toggle-switch.active::after{transform:translateX(18px);}" +

      ".mv-widget-chips-wrap{display:flex;flex-wrap:wrap;gap:6px;}" +
      ".mv-widget-chip{" +
      "  padding:5px 12px;border-radius:20px;" +
      "  border:2px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.12);" +
      "  font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);" +
      "  cursor:pointer;transition:all 0.2s;" +
      "}" +
      ".mv-widget-chip.active{background:var(--mv-accent,#6366F1);color:white;border-color:var(--mv-accent,#6366F1);}" +

      ".mv-widget-range-wrap{display:flex;align-items:center;gap:8px;}" +
      ".mv-widget-range-input{flex:1;accent-color:var(--mv-accent,#6366F1);}" +
      ".mv-widget-range-value{font-size:13px;font-weight:700;color:rgba(255,255,255,0.85);min-width:40px;text-align:right;}" +

      /* RESULTS */
      ".mv-widget-results{margin-top:0;display:flex;flex-direction:column;gap:10px;}" +
      ".mv-widget-results-section-title{" +
      "  font-size:11px;font-weight:900;color:rgba(255,255,255,0.95);" +
      "  text-transform:uppercase;letter-spacing:0.35px;margin:6px 0 2px 0;" +
      "  text-shadow:0 1px 3px rgba(0,0,0,0.3);" +
      "}" +
      ".mv-widget-results-section-note{font-size:11px;font-weight:700;color:rgba(255,255,255,0.65);margin:0 0 6px 0;line-height:1.35;}" +
      ".mv-widget-results-notice{" +
      "  font-size:13px;font-weight:600;color:#92400e;background:#fffbeb;" +
      "  border:1px solid #fde68a;border-radius:8px;padding:10px 14px;" +
      "  margin:0 0 10px 0;line-height:1.4;" +
      "}" +
      ".mv-widget-results-sep{height:1px;background:rgba(255,255,255,0.15);margin:6px 0;}" +

      ".mv-widget-result-item{" +
      "  border-radius:14px;border:2px solid rgba(255,255,255,0.15);" +
      "  background:rgba(255,255,255,0.10);padding:12px;" +
      "  display:grid;grid-template-columns:72px 1fr;gap:12px;" +
      "  transition:all 0.2s ease;align-items:start;" +
      "  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
      "}" +
      ".mv-widget-result-item:hover{" +
      "  border-color:rgba(255,255,255,0.35);" +
      "  box-shadow:0 4px 16px rgba(0,0,0,0.25);transform:translateY(-2px);" +
      "}" +
      ".mv-widget-result-media{" +
      "  width:72px;height:72px;border-radius:12px;" +
      "  background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.1);" +
      "  overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;" +
      "}" +
      ".mv-widget-result-image{width:100%;height:100%;object-fit:cover;display:block;}" +
      ".mv-widget-result-placeholder{font-weight:900;color:var(--mv-accent,#6366F1);font-size:18px;}" +
      ".mv-widget-result-content{min-width:0;display:flex;flex-direction:column;gap:6px;}" +
      ".mv-widget-result-topline{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}" +
      ".mv-widget-result-name{font-size:14px;font-weight:900;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.3);}" +
      ".mv-widget-result-price{font-size:13px;color:#a5b4fc;font-weight:800;flex-shrink:0;}" +
      ".mv-widget-result-reason{" +
      "  font-size:11px;color:rgba(255,255,255,0.7);line-height:1.4;font-weight:700;" +
      "  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;" +
      "}" +
      ".mv-widget-result-link{" +
      "  margin-top:4px;align-self:flex-start;border-radius:10px;border:none;" +
      "  background:rgba(255,255,255,0.15);color:#fff;" +
      "  font-size:12px;padding:7px 12px;cursor:pointer;text-decoration:none;" +
      "  font-weight:900;transition:all 0.2s ease;" +
      "}" +
      ".mv-widget-result-link:hover{background:rgba(255,255,255,0.25);transform:translateX(2px);}" +

      /* SUBMIT */
      ".mv-widget-submit-section{" +
      "  flex:0 0 auto;padding:12px 16px 16px 16px;" +
      "  background:rgba(0,0,0,0.15);border-top:1px solid rgba(255,255,255,0.12);" +
      "  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
      "}" +
      ".mv-widget-submit-btn{" +
      "  width:100%;padding:14px;" +
      "  background:linear-gradient(135deg,var(--mv-button-grad-start,#6366F1) 0%,var(--mv-button-grad-end,#3B82F6) 100%);" +
      "  border:none;border-radius:14px;color:var(--mv-button-text,#fff);" +
      "  font-size:15px;font-weight:900;cursor:pointer;" +
      "  transition:all 0.3s ease;box-shadow:0 8px 24px rgba(99,102,241,0.4);" +
      "}" +
      ".mv-widget-reset-btn{" +
      "  width:100%;padding:11px;background:rgba(255,255,255,0.12);" +
      "  border:2px solid rgba(255,255,255,0.2);border-radius:12px;" +
      "  color:rgba(255,255,255,0.85);font-size:14px;font-weight:800;" +
      "  cursor:pointer;transition:all 0.2s ease;margin-top:8px;" +
      "}" +
      ".mv-widget-consent-text{font-size:10px;color:rgba(255,255,255,0.5);margin-top:8px;text-align:center;line-height:1.35;}" +
      ".mv-widget-help-text{font-size:11px;color:rgba(255,255,255,0.55);margin-top:10px;text-align:center;line-height:1.35;font-weight:700;}" +
      ".mv-widget-footer-text{font-size:10px;color:rgba(255,255,255,0.5);margin-top:6px;text-align:center;}" +
      ".mv-widget-status{font-size:13px;line-height:1.45;margin-top:10px;padding:0;border-radius:0;font-weight:700;}" +
      ".mv-widget-status-error{color:#b91c1c;background:transparent;border:none;}" +
      ".mv-widget-status-ok{color:#166534;background:transparent;border:none;}" +
      ".mv-widget-status-loading{display:flex !important;align-items:center;gap:8px;color:#a5b4fc;}" +
      ".mv-widget-spinner{display:inline-block;width:16px;height:16px;border:2.5px solid #c7d2fe;border-top-color:#6366F1;border-radius:50%;animation:mv-spin .7s linear infinite;flex-shrink:0;}" +
      "@keyframes mv-spin{to{transform:rotate(360deg);}}" +

      /* MOBILE */
      "@media (max-width:768px),(pointer:coarse){" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-root.mv-pos-bottom-right{right:calc(8px + env(safe-area-inset-right)) !important;bottom:calc(8px + env(safe-area-inset-bottom)) !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-root.mv-pos-bottom-left{left:calc(8px + env(safe-area-inset-left)) !important;bottom:calc(8px + env(safe-area-inset-bottom)) !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-root.mv-pos-top-right{right:calc(8px + env(safe-area-inset-right)) !important;top:calc(8px + env(safe-area-inset-top)) !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-root.mv-pos-top-left{left:calc(8px + env(safe-area-inset-left)) !important;top:calc(8px + env(safe-area-inset-top)) !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-bubble-btn{--mv-scale:0.75 !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-bubble-text{font-size:40px !important;padding:54px 120px !important;line-height:1.08 !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-bubble-text span{-webkit-line-clamp:2 !important;max-width:720px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel{" +
      "    inset:0 !important;width:100vw !important;height:100vh !important;height:100dvh !important;" +
      "    max-width:none !important;max-height:none !important;border-radius:0 !important;" +
      "    box-shadow:0 20px 60px rgba(0,0,0,0.35) !important;animation:mv-gradient-shift 8s ease infinite !important;" +
      "    display:flex !important;flex-direction:column !important;font-size:36px !important;" +
      "  }" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel-header{" +
      "    padding-top:calc(34px + env(safe-area-inset-top)) !important;" +
      "    padding-left:calc(30px + env(safe-area-inset-left)) !important;" +
      "    padding-right:calc(30px + env(safe-area-inset-right)) !important;" +
      "    padding-bottom:30px !important;" +
      "  }" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-close-btn{width:64px !important;height:64px !important;border-radius:20px !important;font-size:36px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-body{" +
      "    padding:36px 30px 36px 30px !important;overflow-y:auto !important;" +
      "    -webkit-overflow-scrolling:touch;flex:1 1 auto !important;min-height:0 !important;gap:22px !important;" +
      "  }" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-submit-section{" +
      "    padding-left:calc(30px + env(safe-area-inset-left)) !important;" +
      "    padding-right:calc(30px + env(safe-area-inset-right)) !important;" +
      "    padding-bottom:calc(30px + env(safe-area-inset-bottom)) !important;" +
      "    padding-top:28px !important;" +
      "  }" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-input-group{flex-direction:column !important;gap:24px !important;margin-bottom:20px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-form-field{width:100% !important;flex:0 0 auto !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel-title{font-size:56px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-panel-subtitle{font-size:34px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-section-label{font-size:32px !important;margin-bottom:20px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-field-label{font-size:30px !important;margin-bottom:14px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-input," +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-select," +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-textarea{font-size:38px !important;padding:28px 24px !important;border-radius:26px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-textarea{min-height:220px !important;line-height:1.6 !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-item{grid-template-columns:1fr !important;gap:20px !important;padding:28px !important;border-radius:30px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-media{width:100% !important;height:340px !important;border-radius:26px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-name{font-size:40px !important;white-space:normal !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-price{font-size:34px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-reason{font-size:30px !important;-webkit-line-clamp:10 !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-result-link{font-size:34px !important;padding:22px 28px !important;border-radius:22px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-submit-btn{font-size:38px !important;padding:30px !important;border-radius:30px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-reset-btn{font-size:34px !important;padding:26px !important;border-radius:26px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-help-text{font-size:26px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-status{font-size:30px !important;padding:22px 22px !important;border-radius:20px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-spinner{width:28px !important;height:28px !important;border-width:4px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-chip{font-size:30px !important;padding:14px 22px !important;border-radius:26px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-radio-item," +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-checkbox-item{font-size:30px !important;gap:8px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-toggle-switch{width:64px !important;height:36px !important;border-radius:18px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-toggle-switch::after{width:30px !important;height:30px !important;top:3px !important;left:3px !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-toggle-switch.active::after{transform:translateX(28px) !important;}" +
      "  html:not(.mv-preview-panel):not(.mv-preview-bubble) .mv-widget-range-value{font-size:30px !important;}" +
      "}" +

      /* PREVIEW */
      ".mv-preview-bubble .mv-widget-root{position:relative;left:0;top:0;right:auto;bottom:auto;width:100vw;height:100vh;}" +
      ".mv-preview-bubble .mv-widget-panel{display:none !important;}" +
      ".mv-preview-bubble .mv-widget-bubble-btn{" +
      "  left:50%;top:50%;right:auto;bottom:auto;transform-origin:center;" +
      "  animation:none !important;transform:translate(-50%,-50%) scale(var(--mv-scale)) !important;" +
      "  pointer-events:none !important;cursor:default !important;" +
      "}" +
      ".mv-preview-bubble .mv-widget-bubble-btn:hover{transform:translate(-50%,-50%) scale(var(--mv-scale)) !important;}" +
      ".mv-preview-panel .mv-widget-bubble-btn{display:none !important;}" +
      ".mv-preview-panel .mv-widget-panel{" +
      "  display:flex !important;right:auto !important;bottom:auto !important;" +
      "  left:50% !important;top:50% !important;" +
      "  width:420px !important;max-width:calc(100vw - 40px) !important;" +
      "  max-height:calc(100vh - 40px) !important;" +
      "  transform:translate(-50%,-50%) !important;transform-origin:center !important;" +
      "  animation:none !important;" +
      "}" +
      ".mv-preview-panel .mv-widget-close-btn{pointer-events:none !important;cursor:default !important;opacity:0.85;}" +
      "";

    var style = document.createElement("style");
    style.id = styleId;
    style.type = "text/css";
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
  }

  /* ===================== STATE ===================== */

  var MV_STATE = { root: null, bubbleBtn: null, panel: null };

  /* ===================== BUBBLE DOM ===================== */

  function ensureBubbleOnlyDom() {
    if (document.getElementById("mv-widget-root")) {
      MV_STATE.root = document.getElementById("mv-widget-root");
      MV_STATE.bubbleBtn = MV_STATE.root.querySelector(".mv-widget-bubble-btn");
      return;
    }

    var t = getTheme();
    var bubbleBg = t.bubbleBg || t.primaryColor || "#3b82f6";
    var bubbleMid = lighten(bubbleBg, 0.22);

    var root = document.createElement("div");
    root.id = "mv-widget-root";
    var posClass = "mv-pos-" + (t.bubblePosition || "bottom-right");
    root.className = "mv-widget-root " + posClass;

    var bubbleBtn = document.createElement("button");
    bubbleBtn.type = "button";
    bubbleBtn.className = "mv-widget-bubble-btn";

    bubbleBtn.innerHTML =
      '<svg class="mv-widget-cloud-svg" viewBox="10 2 280 170" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">' +
      '<defs><linearGradient id="cloudGradient" x1="0%" y1="0%" x2="100%" y2="100%">' +
      '<stop offset="0%" stop-color="' + bubbleBg + '"/>' +
      '<stop offset="50%" stop-color="' + bubbleMid + '"/>' +
      '<stop offset="100%" stop-color="' + bubbleBg + '"/>' +
      '</linearGradient></defs>' +
      '<g class="mv-widget-cloud-path" fill="url(#cloudGradient)">' +
      '<path d="M 260 120 C 278 110 290 95 290 75 C 290 45 262 18 228 18 C 216 18 205 21 196 26 C 180 2 150 -6 122 12 C 102 2 74 12 58 38 C 32 40 10 60 10 86 C 10 112 32 130 58 130 L 240 130 C 254 130 272 126 260 120 Z"/>' +
      '<circle cx="240" cy="148" r="12"/>' +
      '<circle cx="258" cy="166" r="7"/>' +
      '</g>' +
      '</svg>' +
      '<div class="mv-widget-bubble-text"><span>' + escapeHtml(getCurrentBubbleText()) + '</span></div>' +
      '<div class="mv-widget-sparkle mv-widget-sparkle-1"></div>' +
      '<div class="mv-widget-sparkle mv-widget-sparkle-2"></div>';

    root.appendChild(bubbleBtn);
    document.body.appendChild(root);

    MV_STATE.root = root;
    MV_STATE.bubbleBtn = bubbleBtn;

    bubbleBtn.addEventListener("click", function () {
      if (getPreviewKind() === "bubble") return;
      openPanel();
    });

    applyTheme();
    startBubbleRotation();
  }

  /* ===================== VISIBILITY CHECK ===================== */

  function checkFieldVisibility(field, formValues) {
    if (!field.visibility || !field.visibility.when || !field.visibility.when.length) return true;

    var conditions = field.visibility.when;
    var mode = field.visibility.mode || "all";

    var results = conditions.map(function (cond) {
      var currentVal = formValues[cond.fieldId];
      if (currentVal === undefined || currentVal === null) currentVal = "";

      switch (cond.op) {
        case "eq": return String(currentVal) === String(cond.value);
        case "neq": return String(currentVal) !== String(cond.value);
        case "in": return Array.isArray(cond.value) ? cond.value.indexOf(String(currentVal)) >= 0 : false;
        case "contains": return String(currentVal).toLowerCase().indexOf(String(cond.value).toLowerCase()) >= 0;
        case "gt": return Number(currentVal) > Number(cond.value);
        case "lt": return Number(currentVal) < Number(cond.value);
        default: return true;
      }
    });

    if (mode === "any") return results.some(function (r) { return r; });
    return results.every(function (r) { return r; });
  }

  /* ===================== DYNAMIC FIELD RENDERER ===================== */

  function buildFieldElement(field) {
    var wrapper = document.createElement("div");
    wrapper.className = "mv-widget-form-field";
    wrapper.id = "mv-field-wrap-" + field.id;

    // Label (skip for single toggle/checkbox — label is inline)
    if (field.type !== "toggle" && !(field.type === "checkbox" && (!field.options || field.options.length === 0))) {
      var labelEl = document.createElement("label");
      labelEl.className = "mv-widget-field-label";
      labelEl.textContent = field.label || field.id;
      labelEl.setAttribute("for", "mv-field-" + field.id);
      wrapper.appendChild(labelEl);
    }

    var inputEl;

    switch (field.type) {
      case "text":
        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.className = "mv-widget-input";
        inputEl.id = "mv-field-" + field.id;
        inputEl.placeholder = field.placeholder || "";
        if (field.defaultValue) inputEl.value = field.defaultValue;
        wrapper.appendChild(inputEl);
        break;

      case "textarea":
        inputEl = document.createElement("textarea");
        inputEl.className = "mv-widget-textarea";
        inputEl.id = "mv-field-" + field.id;
        inputEl.placeholder = field.placeholder || "";
        if (field.defaultValue) inputEl.value = field.defaultValue;
        wrapper.appendChild(inputEl);
        break;

      case "number":
        inputEl = document.createElement("input");
        inputEl.type = "number";
        inputEl.className = "mv-widget-input";
        inputEl.id = "mv-field-" + field.id;
        inputEl.placeholder = field.placeholder || "";
        if (field.min !== undefined && field.min !== null) inputEl.min = String(field.min);
        if (field.max !== undefined && field.max !== null) inputEl.max = String(field.max);
        if (field.step !== undefined && field.step !== null) inputEl.step = String(field.step);
        if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") inputEl.value = String(field.defaultValue);
        wrapper.appendChild(inputEl);
        break;

      case "select":
        inputEl = document.createElement("select");
        inputEl.className = "mv-widget-select";
        inputEl.id = "mv-field-" + field.id;
        var opts = field.options || [];
        for (var i = 0; i < opts.length; i++) {
          var opt = document.createElement("option");
          opt.value = opts[i].value;
          opt.textContent = opts[i].label;
          inputEl.appendChild(opt);
        }
        if (field.defaultValue) inputEl.value = field.defaultValue;
        wrapper.appendChild(inputEl);
        break;

      case "multiselect":
        inputEl = document.createElement("select");
        inputEl.className = "mv-widget-select";
        inputEl.id = "mv-field-" + field.id;
        inputEl.multiple = true;
        inputEl.style.minHeight = "60px";
        var msOpts = field.options || [];
        for (var mi = 0; mi < msOpts.length; mi++) {
          var msOpt = document.createElement("option");
          msOpt.value = msOpts[mi].value;
          msOpt.textContent = msOpts[mi].label;
          inputEl.appendChild(msOpt);
        }
        wrapper.appendChild(inputEl);
        break;

      case "radio":
        var radioGroup = document.createElement("div");
        radioGroup.className = "mv-widget-radio-group";
        radioGroup.id = "mv-field-" + field.id;
        var rOpts = field.options || [];
        for (var ri = 0; ri < rOpts.length; ri++) {
          var rItem = document.createElement("label");
          rItem.className = "mv-widget-radio-item";
          var rInput = document.createElement("input");
          rInput.type = "radio";
          rInput.name = "mv-radio-" + field.id;
          rInput.value = rOpts[ri].value;
          if (field.defaultValue === rOpts[ri].value) rInput.checked = true;
          rItem.appendChild(rInput);
          rItem.appendChild(document.createTextNode(rOpts[ri].label));
          radioGroup.appendChild(rItem);
        }
        inputEl = radioGroup;
        wrapper.appendChild(radioGroup);
        break;

      case "checkbox":
        var cbWrap = document.createElement("div");
        cbWrap.className = "mv-widget-checkbox-group";
        cbWrap.id = "mv-field-" + field.id;
        var cbOpts = field.options || [];
        if (cbOpts.length > 0) {
          for (var ci = 0; ci < cbOpts.length; ci++) {
            var cbItem = document.createElement("label");
            cbItem.className = "mv-widget-checkbox-item";
            var cbInput = document.createElement("input");
            cbInput.type = "checkbox";
            cbInput.value = cbOpts[ci].value;
            cbInput.name = "mv-cb-" + field.id;
            cbItem.appendChild(cbInput);
            cbItem.appendChild(document.createTextNode(cbOpts[ci].label));
            cbWrap.appendChild(cbItem);
          }
        } else {
          var singleCb = document.createElement("label");
          singleCb.className = "mv-widget-checkbox-item";
          var singleInput = document.createElement("input");
          singleInput.type = "checkbox";
          singleInput.id = "mv-field-inner-" + field.id;
          singleCb.appendChild(singleInput);
          singleCb.appendChild(document.createTextNode(field.label || field.id));
          cbWrap.appendChild(singleCb);
        }
        inputEl = cbWrap;
        wrapper.appendChild(cbWrap);
        break;

      case "toggle":
        var toggleWrap = document.createElement("div");
        toggleWrap.className = "mv-widget-toggle-wrap";
        var toggleLabel = document.createElement("span");
        toggleLabel.className = "mv-widget-field-label";
        toggleLabel.style.marginBottom = "0";
        toggleLabel.textContent = field.label || field.id;
        var toggleSwitch = document.createElement("div");
        toggleSwitch.className = "mv-widget-toggle-switch";
        toggleSwitch.id = "mv-field-" + field.id;
        toggleSwitch.setAttribute("data-value", "false");
        if (field.defaultValue) {
          toggleSwitch.classList.add("active");
          toggleSwitch.setAttribute("data-value", "true");
        }
        toggleSwitch.addEventListener("click", function () {
          var isActive = this.classList.contains("active");
          if (isActive) {
            this.classList.remove("active");
            this.setAttribute("data-value", "false");
          } else {
            this.classList.add("active");
            this.setAttribute("data-value", "true");
          }
          updateVisibility();
        });
        toggleWrap.appendChild(toggleLabel);
        toggleWrap.appendChild(toggleSwitch);
        inputEl = toggleSwitch;
        wrapper.appendChild(toggleWrap);
        break;

      case "chips":
        var chipsWrap = document.createElement("div");
        chipsWrap.className = "mv-widget-chips-wrap";
        chipsWrap.id = "mv-field-" + field.id;
        var chipOpts = field.options || [];
        for (var chi = 0; chi < chipOpts.length; chi++) {
          var chip = document.createElement("button");
          chip.type = "button";
          chip.className = "mv-widget-chip";
          chip.setAttribute("data-value", chipOpts[chi].value);
          chip.textContent = chipOpts[chi].label;
          chip.addEventListener("click", function () {
            this.classList.toggle("active");
            updateVisibility();
          });
          chipsWrap.appendChild(chip);
        }
        inputEl = chipsWrap;
        wrapper.appendChild(chipsWrap);
        break;

      case "range":
      case "slider":
        var rangeWrap = document.createElement("div");
        rangeWrap.className = "mv-widget-range-wrap";
        var rangeInput = document.createElement("input");
        rangeInput.type = "range";
        rangeInput.className = "mv-widget-range-input";
        rangeInput.id = "mv-field-" + field.id;
        rangeInput.min = String(field.min !== undefined ? field.min : 0);
        rangeInput.max = String(field.max !== undefined ? field.max : 100);
        rangeInput.step = String(field.step !== undefined ? field.step : 1);
        rangeInput.value = String(field.defaultValue !== undefined ? field.defaultValue : field.min || 0);
        var rangeValue = document.createElement("span");
        rangeValue.className = "mv-widget-range-value";
        rangeValue.textContent = rangeInput.value;
        rangeInput.addEventListener("input", function () {
          var display = this.parentElement.querySelector(".mv-widget-range-value");
          if (display) display.textContent = this.value;
          updateVisibility();
        });
        rangeWrap.appendChild(rangeInput);
        rangeWrap.appendChild(rangeValue);
        inputEl = rangeInput;
        wrapper.appendChild(rangeWrap);
        break;

      case "date":
        inputEl = document.createElement("input");
        inputEl.type = "date";
        inputEl.className = "mv-widget-input";
        inputEl.id = "mv-field-" + field.id;
        if (field.defaultValue) inputEl.value = field.defaultValue;
        wrapper.appendChild(inputEl);
        break;

      default:
        inputEl = document.createElement("input");
        inputEl.type = "text";
        inputEl.className = "mv-widget-input";
        inputEl.id = "mv-field-" + field.id;
        inputEl.placeholder = field.placeholder || "";
        wrapper.appendChild(inputEl);
        break;
    }

    // Change listener for visibility
    if (inputEl && inputEl.addEventListener) {
      inputEl.addEventListener("change", function () { updateVisibility(); });
      inputEl.addEventListener("input", function () { updateVisibility(); });
    }

    // Helper text
    if (field.helperText) {
      var helper = document.createElement("div");
      helper.className = "mv-widget-field-helper";
      helper.textContent = field.helperText;
      wrapper.appendChild(helper);
    }

    return wrapper;
  }

  /* ===================== GET FIELD VALUE ===================== */

  function getFieldValue(field) {
    var id = "mv-field-" + field.id;

    switch (field.type) {
      case "text":
      case "textarea":
      case "number":
      case "date":
        var el = document.getElementById(id);
        return el ? el.value : "";

      case "select":
        var selEl = document.getElementById(id);
        return selEl ? selEl.value : "";

      case "multiselect":
        var msEl = document.getElementById(id);
        if (!msEl) return [];
        var selected = [];
        for (var si = 0; si < msEl.options.length; si++) {
          if (msEl.options[si].selected) selected.push(msEl.options[si].value);
        }
        return selected;

      case "radio":
        var checked = document.querySelector('input[name="mv-radio-' + field.id + '"]:checked');
        return checked ? checked.value : "";

      case "checkbox":
        var cbGroup = document.getElementById(id);
        if (!cbGroup) return false;
        var cbInputs = cbGroup.querySelectorAll('input[type="checkbox"]');
        if (cbInputs.length === 1 && (!field.options || field.options.length === 0)) {
          return cbInputs[0].checked;
        }
        var checkedVals = [];
        for (var cvi = 0; cvi < cbInputs.length; cvi++) {
          if (cbInputs[cvi].checked) checkedVals.push(cbInputs[cvi].value);
        }
        return checkedVals;

      case "toggle":
        var toggleEl = document.getElementById(id);
        return toggleEl ? toggleEl.getAttribute("data-value") === "true" : false;

      case "chips":
        var chipsEl = document.getElementById(id);
        if (!chipsEl) return [];
        var activeChips = chipsEl.querySelectorAll(".mv-widget-chip.active");
        var chipVals = [];
        for (var chi = 0; chi < activeChips.length; chi++) {
          chipVals.push(activeChips[chi].getAttribute("data-value"));
        }
        return chipVals;

      case "range":
      case "slider":
        var rangeEl = document.getElementById(id);
        return rangeEl ? Number(rangeEl.value) : 0;

      default:
        var defEl = document.getElementById(id);
        return defEl ? defEl.value : "";
    }
  }

  function getAllFormValues() {
    var fields = getFields();
    var values = {};
    for (var i = 0; i < fields.length; i++) {
      values[fields[i].id] = getFieldValue(fields[i]);
    }
    return values;
  }

  /* ===================== VISIBILITY UPDATE ===================== */

  function updateVisibility() {
    var fields = getFields();
    var values = getAllFormValues();
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var wrap = document.getElementById("mv-field-wrap-" + field.id);
      if (!wrap) continue;
      var visible = checkFieldVisibility(field, values);
      wrap.style.display = visible ? "" : "none";
    }
  }

  /* ===================== NORMALIZER / MAPPER ===================== */

  function mapFormToRecommendPayload(formValues) {
    var fields = getFields();
    var payload = {
      age: null,
      gender: "unknown",
      budget_min: null,
      budget_max: null,
      relationship: "",
      interests: [],
      free_text: "",
      site_key: MV_AUTH.siteKey,
    };

    var freeTextAppends = [];

    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var val = formValues[field.id];
      var mapping = field.mapping;

      if (!mapping || !mapping.target) continue;

      // Skip empty
      var isEmpty =
        val === "" || val === null || val === undefined ||
        (Array.isArray(val) && val.length === 0) || val === false;
      if (isEmpty) continue;

      // Skip invisible fields
      var visible = checkFieldVisibility(field, formValues);
      if (!visible) continue;

      // Format value
      var displayVal = val;
      if (mapping.format === "label" && field.options) {
        for (var oi = 0; oi < field.options.length; oi++) {
          if (field.options[oi].value === val) { displayVal = field.options[oi].label; break; }
        }
      } else if (mapping.format === "kv") {
        displayVal = (field.label || field.id).replace(/^[^\w\s]+ /, "") + ": " + (Array.isArray(val) ? val.join(", ") : val);
      } else if (mapping.format === "sentence") {
        displayVal = String(val);
      }

      // Map to target
      switch (mapping.target) {
        case "user.age":
          payload.age = Number(val) || null;
          break;
        case "user.gender":
          payload.gender = String(val) || "unknown";
          break;
        case "user.budget_min":
          payload.budget_min = Number(val) || null;
          break;
        case "user.budget_max":
          payload.budget_max = Number(val) || null;
          break;
        case "user.relationship":
          payload.relationship = String(displayVal);
          break;
        case "user.free_text":
          payload.free_text = String(displayVal);
          break;
        case "user.interests":
          if (Array.isArray(val)) {
            for (var j = 0; j < val.length; j++) {
              if (val[j]) payload.interests.push(String(val[j]));
            }
          } else if (typeof val === "string" && val.trim().length > 0) {
            var tokens = val.split(/[\s,;]+/).filter(function (t) { return t.length >= 2; });
            for (var k = 0; k < tokens.length; k++) {
              payload.interests.push(tokens[k]);
            }
          } else {
            payload.interests.push(String(val));
          }
          break;
        case "user.category":
          if (String(val).trim()) payload.interests.push(String(val));
          break;
      }

      // Append to free_text
      if (mapping.appendToFreeText && !isEmpty) {
        var appendStr;
        if (mapping.format === "kv") {
          appendStr = (field.label || field.id).replace(/^[^\w\s]+ /, "") + ": " + (Array.isArray(val) ? val.join(", ") : val);
        } else if (mapping.format === "sentence") {
          appendStr = Array.isArray(val) ? val.join(", ") : String(val);
        } else {
          appendStr = Array.isArray(val) ? val.join(", ") : String(val);
        }
        freeTextAppends.push(appendStr);
      }
    }

    // Merge appended info to free_text
    if (freeTextAppends.length > 0) {
      var extra = freeTextAppends.join("; ");
      if (payload.free_text) {
        payload.free_text += " | " + extra;
      } else {
        payload.free_text = extra;
      }
    }

    return payload;
  }

  /* ===================== PANEL DOM (SCHEMA-DRIVEN) ===================== */

  function buildPanelDom() {
    if (!MV_STATE.root) ensureBubbleOnlyDom();
    if (MV_STATE.panel && document.getElementById("mv-widget-panel")) return;

    var copy = getCopy();
    var fields = getFields();

    var panel = document.createElement("div");
    panel.id = "mv-widget-panel";
    panel.className = "mv-widget-panel";

    // Header
    var header = document.createElement("div");
    header.className = "mv-widget-panel-header";
    var headerContent = document.createElement("div");
    headerContent.className = "mv-widget-header-content";
    headerContent.innerHTML =
      '<div class="mv-widget-panel-title">' + escapeHtml(copy.panelTitle) + '</div>' +
      '<div class="mv-widget-panel-subtitle">' + escapeHtml(copy.panelSubtitle) + '</div>';
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "mv-widget-close-btn";
    closeBtn.innerHTML = "&times;";
    if (getPreviewKind() === "panel") {
      closeBtn.setAttribute("aria-disabled", "true");
      closeBtn.setAttribute("tabindex", "-1");
    }
    header.appendChild(headerContent);
    header.appendChild(closeBtn);

    // Body with dynamic fields
    var body = document.createElement("div");
    body.className = "mv-widget-body";

    // Render each field from the schema
    for (var i = 0; i < fields.length; i++) {
      // Layout: some fields can be grouped side-by-side
      var field = fields[i];
      var layout = field.layout;

      if (layout && layout.group) {
        // Check if this is the first field in a group
        var groupId = layout.group;
        var existingGroup = body.querySelector('[data-mv-group="' + groupId + '"]');
        if (existingGroup) {
          existingGroup.appendChild(buildFieldElement(field));
        } else {
          var groupDiv = document.createElement("div");
          groupDiv.className = "mv-widget-input-group";
          groupDiv.setAttribute("data-mv-group", groupId);
          groupDiv.appendChild(buildFieldElement(field));
          body.appendChild(groupDiv);
        }
      } else {
        body.appendChild(buildFieldElement(field));
      }
    }

    // Results container
    var resultsContainer = document.createElement("div");
    resultsContainer.id = "mv-results";
    resultsContainer.className = "mv-widget-results";
    body.appendChild(resultsContainer);

    // Submit section
    var submitSection = document.createElement("div");
    submitSection.className = "mv-widget-submit-section";

    var submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.id = "mv-submit-btn";
    submitBtn.className = "mv-widget-submit-btn";
    submitBtn.textContent = copy.submitText;

    var resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.id = "mv-reset-btn";
    resetBtn.className = "mv-widget-reset-btn";
    resetBtn.textContent = copy.resetText;

    var helpText = document.createElement("div");
    helpText.className = "mv-widget-help-text";
    helpText.id = "mv-help-text";
    helpText.textContent = copy.helpText;

    var statusEl = document.createElement("div");
    statusEl.id = "mv-status";
    statusEl.className = "mv-widget-status";
    statusEl.style.display = "none";

    submitSection.appendChild(submitBtn);
    submitSection.appendChild(resetBtn);

    if (copy.consentText) {
      var consentEl = document.createElement("div");
      consentEl.className = "mv-widget-consent-text";
      consentEl.textContent = copy.consentText;
      submitSection.appendChild(consentEl);
    }

    submitSection.appendChild(helpText);
    submitSection.appendChild(statusEl);

    if (copy.footerText) {
      var footerEl = document.createElement("div");
      footerEl.className = "mv-widget-footer-text";
      footerEl.textContent = copy.footerText;
      submitSection.appendChild(footerEl);
    }

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(submitSection);

    MV_STATE.root.appendChild(panel);
    MV_STATE.panel = panel;

    closeBtn.addEventListener("click", function () {
      if (getPreviewKind() === "panel") return;
      closePanel(true);
    });
    submitBtn.addEventListener("click", function () { handleRecommendClick(); });
    resetBtn.addEventListener("click", function () { resetForm(); });

    applyTheme();
    updateVisibility();
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
        if (panel.parentNode) panel.parentNode.removeChild(panel);
        MV_STATE.panel = null;
      }
    }
    if (MV_STATE.bubbleBtn) MV_STATE.bubbleBtn.style.display = "block";
    lockBodyScroll(false);
    startBubbleRotation();
  }

  /* ===================== SCROLL HELPERS ===================== */

  function getPanelBodyEl() {
    return document.querySelector("#mv-widget-panel .mv-widget-body");
  }

  function scrollPanelBodyToElement(targetEl, behavior) {
    try {
      var bodyEl = getPanelBodyEl();
      if (!bodyEl || !targetEl) return;
      var bodyRect = bodyEl.getBoundingClientRect();
      var tRect = targetEl.getBoundingClientRect();
      var delta = (tRect.top - bodyRect.top) + bodyEl.scrollTop;
      bodyEl.scrollTo({ top: Math.max(0, delta - 6), behavior: behavior || "smooth" });
    } catch (_) {
      try { if (targetEl) targetEl.scrollIntoView({ behavior: behavior || "smooth", block: "start" }); } catch (_2) {}
    }
  }

  function scrollToResultsSectionTop() {
    var container = document.getElementById("mv-results");
    if (!container) return;
    // Először a notice bannerre görgessünk (ha van), mert az a legfontosabb info
    var notice = container.querySelector(".mv-widget-results-notice");
    if (notice) {
      scrollPanelBodyToElement(notice, "smooth");
      return;
    }
    var firstTitle = container.querySelector(".mv-widget-results-section-title");
    if (!firstTitle) return;
    scrollPanelBodyToElement(firstTitle, "smooth");
  }

  /* ===================== FORM LOGIC ===================== */

  function resetForm() {
    var fields = getFields();
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      var id = "mv-field-" + field.id;

      switch (field.type) {
        case "text": case "textarea": case "number": case "date":
          var el = document.getElementById(id);
          if (el) el.value = field.defaultValue || "";
          break;
        case "select":
          var selEl = document.getElementById(id);
          if (selEl) selEl.value = field.defaultValue || (field.options && field.options[0] ? field.options[0].value : "");
          break;
        case "multiselect":
          var msEl = document.getElementById(id);
          if (msEl) { for (var j = 0; j < msEl.options.length; j++) msEl.options[j].selected = false; }
          break;
        case "radio":
          var radios = document.querySelectorAll('input[name="mv-radio-' + field.id + '"]');
          for (var r = 0; r < radios.length; r++) radios[r].checked = (radios[r].value === field.defaultValue);
          break;
        case "checkbox":
          var cbs = document.querySelectorAll('input[name="mv-cb-' + field.id + '"]');
          for (var c = 0; c < cbs.length; c++) cbs[c].checked = false;
          var singleCb2 = document.querySelector('#mv-field-inner-' + field.id);
          if (singleCb2) singleCb2.checked = false;
          break;
        case "toggle":
          var toggleEl = document.getElementById(id);
          if (toggleEl) { toggleEl.classList.remove("active"); toggleEl.setAttribute("data-value", "false"); }
          break;
        case "chips":
          var chipsEl = document.getElementById(id);
          if (chipsEl) {
            var allChips = chipsEl.querySelectorAll(".mv-widget-chip");
            for (var ch = 0; ch < allChips.length; ch++) allChips[ch].classList.remove("active");
          }
          break;
        case "range": case "slider":
          var rangeEl = document.getElementById(id);
          if (rangeEl) rangeEl.value = String(field.defaultValue !== undefined ? field.defaultValue : field.min || 0);
          var rangeVal = rangeEl ? rangeEl.parentElement.querySelector(".mv-widget-range-value") : null;
          if (rangeVal && rangeEl) rangeVal.textContent = rangeEl.value;
          break;
      }
    }

    var statusEl = document.getElementById("mv-status");
    var resultsEl = document.getElementById("mv-results");
    if (statusEl) { statusEl.style.display = "none"; statusEl.textContent = ""; statusEl.className = "mv-widget-status"; }
    if (resultsEl) resultsEl.innerHTML = "";

    var resetBtn = document.getElementById("mv-reset-btn");
    if (resetBtn) {
      var origText = getCopy().resetText;
      resetBtn.textContent = "✓ Törölve!";
      setTimeout(function () { resetBtn.textContent = origText; }, 1200);
    }

    try {
      var bodyEl = getPanelBodyEl();
      if (bodyEl) bodyEl.scrollTo({ top: 0, behavior: "smooth" });
    } catch (_) {}

    updateVisibility();
  }

  async function trackProductOpen(productId) {
    try {
      mvRefreshAuth();
      if (isPreviewMode()) return;
      var payload = { site_key: MV_AUTH.siteKey, product_id: String(productId || "").trim() };
      await fetch("/api/track/product-open", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mv-api-key": MV_AUTH.apiKey || "" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (_) {}
  }

  async function handleRecommendClick() {
    mvRefreshAuth();

    var statusEl = document.getElementById("mv-status");
    var resultsEl = document.getElementById("mv-results");
    if (!statusEl || !resultsEl) return;

    statusEl.textContent = "";
    statusEl.className = "mv-widget-status";
    statusEl.style.display = "none";
    resultsEl.innerHTML = "";

    var copy = getCopy();
    var formValues = getAllFormValues();

    // ✅ Build payload via normalizer/mapper
    var payload = mapFormToRecommendPayload(formValues);

    // Check if anything was given
    var hasAnyInput =
      payload.age !== null ||
      payload.budget_min !== null ||
      payload.budget_max !== null ||
      (payload.relationship && payload.relationship.trim().length > 0) ||
      (payload.free_text && payload.free_text.trim().length > 0) ||
      (payload.interests && payload.interests.length > 0);

    var cfg = getEffectiveConfig();
    if (cfg.form && cfg.form.submit && !cfg.form.submit.allowEmpty && !hasAnyInput) {
      statusEl.textContent = "Adj meg legalább 1 adatot (pl. érdeklődés vagy költségkeret), hogy tudjak ajánlani.";
      statusEl.classList.add("mv-widget-status-error");
      statusEl.style.display = "block";
      return;
    }

    // Loading state
    statusEl.innerHTML = '<span class="mv-widget-spinner"></span>' + escapeHtml(copy.loadingText);
    statusEl.classList.remove("mv-widget-status-error", "mv-widget-status-ok");
    statusEl.classList.add("mv-widget-status-loading");
    statusEl.style.display = "flex";

    try {
      var response = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-mv-api-key": MV_AUTH.apiKey || "" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        var errJson = {};
        try { errJson = await response.json(); } catch (_) {}
        var reason = errJson && errJson.error ? " (" + errJson.error + ")" : "";
        throw new Error("Ajánló API hiba: " + response.status + reason);
      }

      var data = await response.json();
      var items = (data && data.items) || [];
      var alsoItems = (data && data.also_items) || [];
      var notice = (data && data.notice) ? String(data.notice || "").trim() : "";

      if ((!items || items.length === 0) && (!alsoItems || alsoItems.length === 0)) {
        statusEl.textContent = copy.emptyStateText;
        statusEl.classList.remove("mv-widget-status-ok", "mv-widget-status-loading");
        statusEl.classList.add("mv-widget-status-error");
        statusEl.style.display = "block";
        return;
      }

      statusEl.classList.remove("mv-widget-status-loading");
      statusEl.style.display = "none";

      renderResultsTwoSections(resultsEl, items, alsoItems, notice);
      setTimeout(function () { scrollToResultsSectionTop(); }, 80);
    } catch (err) {
      console.error(err);
      statusEl.textContent = copy.errorText + " " + (err && err.message ? err.message : "");
      statusEl.classList.remove("mv-widget-status-ok", "mv-widget-status-loading");
      statusEl.classList.add("mv-widget-status-error");
      statusEl.style.display = "block";
    }
  }

  /* ===================== RESULTS RENDERING ===================== */

  function formatPriceFt(num, itemCurrency) {
    if (num === null || num === undefined) return "";
    // Robust number parsing: handle strings like "65.000,00" or "27999,00"
    var raw = String(num).trim();
    var n;
    // If it looks like European format (has dots as thousands + comma as decimal)
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) {
      n = Number(raw.replace(/\./g, "").replace(",", "."));
    } else if (/^\d+(,\d+)$/.test(raw)) {
      // Simple comma-decimal like "27999,00"
      n = Number(raw.replace(",", "."));
    } else {
      n = Number(num);
    }
    if (isNaN(n) || n <= 0) return "";

    var t = getTheme();
    // Per-product currency overrides the theme currency (e.g. HUF-priced items in EUR catalog)
    var cur = itemCurrency || t.currency || "HUF";

    // HUF: always whole number, space as thousands separator
    if (cur === "HUF") {
      return Math.round(n).toLocaleString("hu-HU").replace(/,/g, " ") + " Ft";
    }
    // EUR: use Hungarian-style EUR (space thousands, comma decimal)
    if (cur === "EUR") {
      // If it's a whole number, skip decimals for cleaner display
      if (n === Math.floor(n)) {
        return Math.round(n).toLocaleString("hu-HU").replace(/,/g, " ") + " €";
      }
      return n.toLocaleString("hu-HU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
    }
    // USD
    if (cur === "USD") {
      if (n === Math.floor(n)) {
        return "$" + Math.round(n).toLocaleString("en-US");
      }
      return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    // Fallback
    return Math.round(n).toLocaleString("hu-HU").replace(/,/g, " ") + " Ft";
  }

  function appendResults(container, items) {
    (items || []).forEach(function (item) {
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
          ph.textContent = "\uD83D\uDECD\uFE0F";
          media.appendChild(ph);
        };
        img.src = item.image_url;
        media.appendChild(img);
      } else {
        var ph2 = document.createElement("div");
        ph2.className = "mv-widget-result-placeholder";
        ph2.textContent = "\uD83D\uDECD\uFE0F";
        media.appendChild(ph2);
      }

      var content = document.createElement("div");
      content.className = "mv-widget-result-content";
      var topLine = document.createElement("div");
      topLine.className = "mv-widget-result-topline";
      var nameEl = document.createElement("div");
      nameEl.className = "mv-widget-result-name";
      nameEl.textContent = item.name || "Ismeretlen term\u00E9k";
      var priceEl = document.createElement("div");
      priceEl.className = "mv-widget-result-price";
      priceEl.textContent = item.price !== undefined && item.price !== null ? formatPriceFt(item.price, item.price_currency) : "";
      topLine.appendChild(nameEl);
      topLine.appendChild(priceEl);
      var reasonEl = document.createElement("div");
      reasonEl.className = "mv-widget-result-reason";
      reasonEl.textContent = item.reason || "Ezt a term\u00E9ket a profil \u00E9s a k\u00F6lts\u00E9gkeret alapj\u00E1n javasoljuk.";
      content.appendChild(topLine);
      content.appendChild(reasonEl);

      if (item.product_url) {
        var link = document.createElement("a");
        link.className = "mv-widget-result-link";
        link.href = item.product_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Megn\u00E9zem";
        link.addEventListener("click", function () { trackProductOpen(item.product_id || ""); });
        content.appendChild(link);
      }

      card.appendChild(media);
      card.appendChild(content);
      container.appendChild(card);
    });
  }

  function renderResultsTwoSections(container, items, alsoItems, notice) {
    container.innerHTML = "";

    // Ha van notice (pl. "Sajnos zokni nem található..."), FELÜL jelenik meg
    if (notice) {
      var noticeEl = document.createElement("div");
      noticeEl.className = "mv-widget-results-notice";
      noticeEl.textContent = notice;
      container.appendChild(noticeEl);
    }

    if (items && items.length > 0) {
      var t1 = document.createElement("div");
      t1.className = "mv-widget-results-section-title";
      t1.textContent = "Tal\u00E1latok:";
      container.appendChild(t1);
      appendResults(container, items);
    }
    if (alsoItems && alsoItems.length > 0) {
      if (items && items.length > 0) {
        var sep = document.createElement("div");
        sep.className = "mv-widget-results-sep";
        container.appendChild(sep);
      }
      var t2 = document.createElement("div");
      t2.className = "mv-widget-results-section-title";
      t2.textContent = "AMI M\u00C9G \u00C9RDEKELHET:";
      container.appendChild(t2);
      appendResults(container, alsoItems);
    }
  }

  /* ===================== PREVIEW: postMessage listener ===================== */

  function setupPreviewListener() {
    if (!isPreviewMode()) return;

    window.addEventListener("message", function (ev) {
      try {
        var data = ev && ev.data ? ev.data : null;
        if (!data) return;

        // ✅ V2: full config update from widget editor
        if (data.type === "MV_WIDGET_FULL_CONFIG") {
          MV_FULL_CONFIG = data.config || null;
          MV_LEGACY_MODE = false;
          rebuildPanel();
          return;
        }

        // Legacy: old preview config
        if (data.type === "MV_WIDGET_PREVIEW_CONFIG") {
          if (data.config) applyLegacyConfig(data.config);
          applyTheme();
          return;
        }
      } catch (_) {}
    });
  }

  function rebuildPanel() {
    var panel = document.getElementById("mv-widget-panel");
    if (panel) {
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      MV_STATE.panel = null;
    }
    applyTheme();

    // Update bubble
    var bubbleTexts = getBubbleTexts();
    if (bubbleTexts && bubbleTexts.length) {
      MV_BUBBLE_PICKED_TEXT = bubbleTexts[0];
      var span = document.querySelector("#mv-widget-root .mv-widget-bubble-text span");
      if (span) span.textContent = MV_BUBBLE_PICKED_TEXT;
    }

    if (getPreviewKind() === "panel") {
      openPanel();
    }
  }

  /* ===================== INIT ===================== */

  async function init() {
    var allowed = await checkPartnerAllowed();
    if (!allowed) return;

    injectStyles();
    setupPreviewListener();

    if (!isPreviewMode()) {
      if (!MV_FULL_CONFIG) {
        var serverCfg = await fetchPartnerConfig();
        if (serverCfg) applyLegacyConfig(serverCfg);
      }
    }

    applyTheme();
    ensureBubbleOnlyDom();

    var p = getPreviewKind();
    if (p === "bubble") {
      document.documentElement.classList.add("mv-preview-bubble");
    } else if (p === "panel") {
      document.documentElement.classList.add("mv-preview-panel");
      openPanel();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { init(); });
  } else {
    init();
  }
})();
