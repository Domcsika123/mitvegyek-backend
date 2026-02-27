// src/config/widgetConfig.ts
//
// Általános, schema-driven widget konfiguráció típusok, validáció és default értékek.
// Bármilyen webshop / partner esetére: elektronika, kozmetika, könyv, ruházat, ajándék, stb.

/* ===================================================================
 * 1) TÍPUS DEFINÍCIÓK
 * =================================================================== */

export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "number"
  | "range"
  | "slider"
  | "toggle"
  | "chips"
  | "date";

export type MappingTarget =
  | "user.free_text"
  | "user.interests"
  | "user.gender"
  | "user.relationship"
  | "user.budget_min"
  | "user.budget_max"
  | "user.age"
  | "user.category";

export type MappingFormat = "raw" | "label" | "value" | "kv" | "sentence";
export type ConstraintPriority = "must_have" | "preference";
export type ConstraintType = "exact" | "range" | "contains" | "in";
export type VisibilityOp = "eq" | "neq" | "in" | "contains" | "gt" | "lt";
export type ValidationMode = "onSubmit" | "live";
export type PanelPosition = "left" | "right" | "bottom";
export type CurrencyCode = "HUF" | "EUR" | "USD";

/* --- Visibility rule --- */
export interface VisibilityCondition {
  fieldId: string;
  op: VisibilityOp;
  value: any;
}

export interface VisibilityRule {
  when: VisibilityCondition[];
  mode: "all" | "any";
}

/* --- Field mapping --- */
export interface FieldMapping {
  target: MappingTarget;
  format?: MappingFormat;
  weight?: number;
  appendToFreeText?: boolean;
  /** Constraint priority: must_have = hard filter, preference = soft boost */
  priority?: ConstraintPriority;
  /** How the constraint value is matched against product data */
  constraintType?: ConstraintType;
}

/* --- Field option (select/radio/multiselect/chips) --- */
export interface FieldOption {
  value: string;
  label: string;
}

/* --- Field layout --- */
export interface FieldLayout {
  row?: number;
  colSpan?: number;
}

/* --- Single form field --- */
export interface WidgetFormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder?: string;
  helperText?: string;
  enabled: boolean;
  required: boolean;
  defaultValue?: any;
  options?: FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  order: number;
  layout?: FieldLayout;
  visibility?: VisibilityRule;
  mapping?: FieldMapping;
}

/* --- Submit settings --- */
export interface FormSubmitConfig {
  allowEmpty: boolean;
  validationMode: ValidationMode;
}

/* --- Theme --- */
export interface WidgetThemeConfig {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  buttonRadius: number;
  fontFamily: string;
  panelPosition: PanelPosition;
  widthPx: number;
  zIndex: number;

  // Bubble position (corner)
  bubblePosition?: string;
  /** Custom offset from edge in px (optional) */
  bubbleOffsetX?: number;
  bubbleOffsetY?: number;

  // Currency for price display
  currency?: CurrencyCode;

  // Legacy compat for bubble/header
  bubbleBg?: string;
  bubbleText?: string;
  headerGradStart?: string;
  headerGradEnd?: string;
  buttonBg?: string;
  buttonText?: string;
}

/* --- Copy (all UI texts) --- */
export interface WidgetCopyConfig {
  panelTitle: string;
  panelSubtitle: string;
  helpText: string;
  submitText: string;
  resetText: string;
  loadingText: string;
  emptyStateText: string;
  errorText: string;
  consentText: string;
  footerText: string;
}

/* --- UI block --- */
export interface WidgetUIConfig {
  theme: WidgetThemeConfig;
  copy: WidgetCopyConfig;
}

/* --- Form block --- */
export interface WidgetFormConfig {
  fields: WidgetFormField[];
  submit: FormSubmitConfig;
}

/* --- Bubble texts (legacy, kept for backward compat) --- */
export interface BubbleConfig {
  texts: string[];
}

/* === TOP-LEVEL WIDGET CONFIG === */
export interface FullWidgetConfig {
  version: number;
  ui: WidgetUIConfig;
  form: WidgetFormConfig;
  bubble?: BubbleConfig;
}

/* ===================================================================
 * 2) DEFAULT CONFIG (általános webshop)
 * =================================================================== */

export function getDefaultWidgetConfig(): FullWidgetConfig {
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
        {
          id: "relationship",
          type: "text",
          label: "👤 Kinek keresel?",
          placeholder: "pl. barátomnak, anyukámnak",
          enabled: true,
          required: false,
          order: 10,
          mapping: { target: "user.relationship", format: "raw" },
        },
        {
          id: "age",
          type: "number",
          label: "🎂 Kor",
          placeholder: "pl. 25",
          enabled: true,
          required: false,
          min: 0,
          max: 120,
          order: 20,
          mapping: { target: "user.age", format: "raw" },
        },
        {
          id: "gender",
          type: "select",
          label: "⚧ Nem",
          enabled: true,
          required: false,
          defaultValue: "unknown",
          options: [
            { value: "unknown", label: "Mindegy" },
            { value: "male", label: "Férfi" },
            { value: "female", label: "Nő" },
          ],
          order: 21,
          mapping: { target: "user.gender", format: "value" },
        },
        {
          id: "budget_min",
          type: "number",
          label: "💰 Minimum (Ft)",
          placeholder: "pl. 3000",
          enabled: true,
          required: false,
          min: 0,
          order: 30,
          mapping: { target: "user.budget_min", format: "raw" },
        },
        {
          id: "budget_max",
          type: "number",
          label: "💰 Maximum (Ft)",
          placeholder: "pl. 15000",
          enabled: true,
          required: false,
          min: 0,
          order: 31,
          mapping: { target: "user.budget_max", format: "raw" },
        },
        {
          id: "interests",
          type: "text",
          label: "❤️ Érdeklődés",
          placeholder: "pl. futás, tech, kávé, fotózás",
          enabled: true,
          required: false,
          order: 40,
          mapping: { target: "user.interests", format: "raw" },
        },
        {
          id: "free_text",
          type: "textarea",
          label: "📝 További részletek",
          placeholder: "pl. szereti a praktikus dolgokat, kütyüket, sportot...",
          enabled: true,
          required: false,
          order: 50,
          mapping: { target: "user.free_text", format: "raw" },
        },
      ],
      submit: {
        allowEmpty: false,
        validationMode: "onSubmit",
      },
    },
    bubble: {
      texts: [
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
    },
  };
}

/* ===================================================================
 * 3) PRESET TEMPLATES
 * =================================================================== */

export function getFashionPreset(): FullWidgetConfig {
  const cfg = getDefaultWidgetConfig();
  cfg.ui.copy.panelTitle = "Stílusajánló";
  cfg.ui.copy.panelSubtitle = "Válassz színt, típust, méretet – megtaláljuk a tökéletes darabot!";
  cfg.ui.copy.submitText = "✨ Mutasd az ajánlatokat";

  // Remove relationship, age – keep gender, budget
  const removeIds = ["relationship", "age"];
  cfg.form.fields = cfg.form.fields.filter(f => !removeIds.includes(f.id));

  // Update interests
  const interests = cfg.form.fields.find(f => f.id === "interests");
  if (interests) {
    interests.label = "❤️ Stílus / szín / fazon";
    interests.placeholder = "pl. sportos, elegáns, sötétkék";
  }

  // Add fashion-specific fields
  cfg.form.fields.push(
    {
      id: "color",
      type: "select",
      label: "🎨 Szín",
      enabled: true,
      required: false,
      order: 42,
      options: [
        { value: "", label: "Mindegy" },
        { value: "Fekete", label: "Fekete" },
        { value: "Fehér", label: "Fehér" },
        { value: "Kék", label: "Kék" },
        { value: "Sötétkék", label: "Sötétkék" },
        { value: "Piros", label: "Piros" },
        { value: "Rózsaszín", label: "Rózsaszín" },
        { value: "Zöld", label: "Zöld" },
        { value: "Sárga", label: "Sárga" },
        { value: "Narancs", label: "Narancs" },
        { value: "Lila", label: "Lila" },
        { value: "Barna", label: "Barna" },
        { value: "Szürke", label: "Szürke" },
        { value: "Bézs", label: "Bézs" },
        { value: "Bordó", label: "Bordó" },
        { value: "Türkiz", label: "Türkiz" },
      ],
      mapping: { target: "user.interests", format: "value", appendToFreeText: true, priority: "must_have", constraintType: "exact" },
    },
    {
      id: "clothing_type",
      type: "select",
      label: "👕 Típus",
      enabled: true,
      required: false,
      order: 43,
      options: [
        { value: "", label: "Mindegy" },
        { value: "Póló", label: "Póló" },
        { value: "Pulóver", label: "Pulóver" },
        { value: "Hoodie", label: "Hoodie" },
        { value: "Ing", label: "Ing" },
        { value: "Kabát", label: "Kabát" },
        { value: "Dzseki", label: "Dzseki" },
        { value: "Nadrág", label: "Nadrág" },
        { value: "Farmer", label: "Farmer" },
        { value: "Rövidnadrág", label: "Rövidnadrág" },
        { value: "Szoknya", label: "Szoknya" },
        { value: "Ruha", label: "Ruha" },
        { value: "Cipő", label: "Cipő" },
        { value: "Sapka", label: "Sapka" },
        { value: "Táska", label: "Táska" },
        { value: "Ékszer", label: "Ékszer" },
        { value: "Fürdőruha", label: "Fürdőruha" },
        { value: "Kiegészítő", label: "Kiegészítő" },
        { value: "Sportruha", label: "Sportruha" },
      ],
      mapping: { target: "user.interests", format: "value", appendToFreeText: true, priority: "must_have", constraintType: "contains" },
    },
    {
      id: "size",
      type: "select",
      label: "📏 Méret",
      enabled: true,
      required: false,
      order: 44,
      options: [
        { value: "", label: "Mindegy" },
        { value: "XS", label: "XS" },
        { value: "S", label: "S" },
        { value: "M", label: "M" },
        { value: "L", label: "L" },
        { value: "XL", label: "XL" },
        { value: "XXL", label: "XXL" },
      ],
      mapping: { target: "user.interests", format: "value", appendToFreeText: true, priority: "preference", constraintType: "exact" },
    }
  );

  return cfg;
}

export function getElectronicsPreset(): FullWidgetConfig {
  const cfg = getDefaultWidgetConfig();
  cfg.ui.copy.panelTitle = "Techajánló";
  cfg.ui.copy.panelSubtitle = "Mondd el, mit keresel – megtaláljuk a legjobb kütyüt!";
  cfg.ui.copy.submitText = "🔍 Mutasd az ajánlatokat";

  const interests = cfg.form.fields.find(f => f.id === "interests");
  if (interests) {
    interests.label = "🔌 Mire használnád?";
    interests.placeholder = "pl. gaming, irodai munka, fotózás, sport";
  }

  cfg.form.fields.push(
    {
      id: "brand",
      type: "text",
      label: "🏷️ Márka preferencia",
      placeholder: "pl. Samsung, Apple, Sony",
      enabled: true,
      required: false,
      order: 42,
      mapping: { target: "user.interests", format: "value", appendToFreeText: true, priority: "must_have", constraintType: "contains" },
    },
    {
      id: "category",
      type: "select",
      label: "📦 Kategória",
      enabled: true,
      required: false,
      order: 43,
      options: [
        { value: "", label: "Mindegy" },
        { value: "Telefon", label: "Telefon" },
        { value: "Laptop", label: "Laptop" },
        { value: "Tablet", label: "Tablet" },
        { value: "TV", label: "TV" },
        { value: "Fülhallgató", label: "Fülhallgató" },
        { value: "Kamera", label: "Kamera" },
        { value: "Okosóra", label: "Okosóra" },
        { value: "Gaming", label: "Gaming" },
        { value: "Kiegészítő", label: "Kiegészítő" },
      ],
      mapping: { target: "user.interests", format: "value", appendToFreeText: true, priority: "must_have", constraintType: "contains" },
    }
  );

  return cfg;
}

export function getGiftPreset(): FullWidgetConfig {
  const cfg = getDefaultWidgetConfig();
  cfg.ui.copy.panelTitle = "Ajándékötlet-kereső";
  cfg.ui.copy.panelSubtitle = "Segítek megtalálni a tökéletes ajándékot!";
  cfg.ui.copy.submitText = "🎁 Mutasd az ötleteket";

  const interests = cfg.form.fields.find(f => f.id === "interests");
  if (interests) {
    interests.label = "🎯 Hobbik, érdeklődés";
    interests.placeholder = "pl. főzés, kertészkedés, olvasás, sport";
  }

  cfg.form.fields.push(
    {
      id: "occasion",
      type: "select",
      label: "🎉 Alkalom",
      enabled: true,
      required: false,
      order: 5,
      options: [
        { value: "", label: "Mindegy" },
        { value: "Születésnap", label: "Születésnap" },
        { value: "Karácsony", label: "Karácsony" },
        { value: "Névnap", label: "Névnap" },
        { value: "Évforduló", label: "Évforduló" },
        { value: "Ballagás", label: "Ballagás" },
        { value: "Valentin-nap", label: "Valentin-nap" },
        { value: "Egyéb", label: "Egyéb" },
      ],
      mapping: { target: "user.interests", format: "label", appendToFreeText: true },
    }
  );

  return cfg;
}

/** Összes elérhető preset  */
export type PresetName = "generic" | "fashion" | "electronics" | "gift";

export function getPresetConfig(name: PresetName): FullWidgetConfig {
  switch (name) {
    case "fashion":
      return getFashionPreset();
    case "electronics":
      return getElectronicsPreset();
    case "gift":
      return getGiftPreset();
    case "generic":
    default:
      return getDefaultWidgetConfig();
  }
}

export const PRESET_NAMES: { id: PresetName; label: string }[] = [
  { id: "generic", label: "Általános webshop" },
  { id: "fashion", label: "Ruházat / Divat" },
  { id: "electronics", label: "Elektronika / Tech" },
  { id: "gift", label: "Ajándék" },
];

/* ===================================================================
 * 4) VALIDÁCIÓ / SANITIZE
 * =================================================================== */

function isHexColor(s: any): boolean {
  return typeof s === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

function sanitizeHex(v: any, fallback: string): string {
  return isHexColor(v) ? String(v).trim() : fallback;
}

function sanitizeStr(v: any, fallback: string, maxLen: number = 500): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s.length > 0 ? s.slice(0, maxLen) : fallback;
}

function sanitizeNum(v: any, fallback: number, min?: number, max?: number): number {
  const n = Number(v);
  if (isNaN(n)) return fallback;
  let r = n;
  if (min !== undefined) r = Math.max(min, r);
  if (max !== undefined) r = Math.min(max, r);
  return r;
}

export function sanitizeWidgetConfig(raw: any): FullWidgetConfig {
  const def = getDefaultWidgetConfig();
  if (!raw || typeof raw !== "object") return def;

  // Version
  const version = sanitizeNum(raw.version, 1, 1, 100);

  // UI > Theme
  const rt = raw.ui?.theme || {};
  const dt = def.ui.theme;
  const theme: WidgetThemeConfig = {
    primaryColor: sanitizeHex(rt.primaryColor, dt.primaryColor),
    accentColor: sanitizeHex(rt.accentColor, dt.accentColor),
    backgroundColor: sanitizeHex(rt.backgroundColor, dt.backgroundColor),
    textColor: sanitizeHex(rt.textColor, dt.textColor),
    buttonRadius: sanitizeNum(rt.buttonRadius, dt.buttonRadius, 0, 50),
    fontFamily: sanitizeStr(rt.fontFamily, dt.fontFamily),
    panelPosition: ["left", "right", "bottom"].includes(rt.panelPosition) ? rt.panelPosition : dt.panelPosition,
    widthPx: sanitizeNum(rt.widthPx, dt.widthPx, 280, 800),
    zIndex: sanitizeNum(rt.zIndex, dt.zIndex, 1, 9999999),
    bubblePosition: ["bottom-right", "bottom-left", "top-right", "top-left"].includes(rt.bubblePosition) ? rt.bubblePosition : (dt.bubblePosition || "bottom-right"),
    bubbleOffsetX: sanitizeNum(rt.bubbleOffsetX, dt.bubbleOffsetX ?? 8, 0, 200),
    bubbleOffsetY: sanitizeNum(rt.bubbleOffsetY, dt.bubbleOffsetY ?? 8, 0, 200),
    currency: (["HUF", "EUR", "USD"].includes(rt.currency) ? rt.currency : (dt.currency || "HUF")) as CurrencyCode,
    bubbleBg: sanitizeHex(rt.bubbleBg, dt.bubbleBg || "#3b82f6"),
    bubbleText: sanitizeHex(rt.bubbleText, dt.bubbleText || "#ffffff"),
    headerGradStart: sanitizeHex(rt.headerGradStart, dt.headerGradStart || "#6366F1"),
    headerGradEnd: sanitizeHex(rt.headerGradEnd, dt.headerGradEnd || "#3B82F6"),
    buttonBg: sanitizeHex(rt.buttonBg, dt.buttonBg || "#6366F1"),
    buttonText: sanitizeHex(rt.buttonText, dt.buttonText || "#ffffff"),
  };

  // UI > Copy
  const rc = raw.ui?.copy || {};
  const dc = def.ui.copy;
  const copy: WidgetCopyConfig = {
    panelTitle: sanitizeStr(rc.panelTitle, dc.panelTitle),
    panelSubtitle: sanitizeStr(rc.panelSubtitle, dc.panelSubtitle),
    helpText: sanitizeStr(rc.helpText, dc.helpText),
    submitText: sanitizeStr(rc.submitText, dc.submitText),
    resetText: sanitizeStr(rc.resetText, dc.resetText),
    loadingText: sanitizeStr(rc.loadingText, dc.loadingText),
    emptyStateText: sanitizeStr(rc.emptyStateText, dc.emptyStateText),
    errorText: sanitizeStr(rc.errorText, dc.errorText),
    consentText: sanitizeStr(rc.consentText, dc.consentText, 2000),
    footerText: sanitizeStr(rc.footerText, dc.footerText, 1000),
  };

  // Form > Fields
  const rawFields = Array.isArray(raw.form?.fields) ? raw.form.fields : def.form.fields;
  const validTypes: FieldType[] = [
    "text", "textarea", "select", "multiselect", "radio", "checkbox",
    "number", "range", "slider", "toggle", "chips", "date",
  ];
  const fields: WidgetFormField[] = rawFields
    .filter((f: any) => f && typeof f.id === "string" && f.id.trim().length > 0)
    .map((f: any, idx: number) => {
      const field: WidgetFormField = {
        id: String(f.id).trim().slice(0, 64),
        type: validTypes.includes(f.type) ? f.type : "text",
        label: sanitizeStr(f.label, f.id, 200),
        placeholder: f.placeholder ? sanitizeStr(f.placeholder, "", 300) : undefined,
        helperText: f.helperText ? sanitizeStr(f.helperText, "", 500) : undefined,
        enabled: f.enabled !== false,
        required: f.required === true,
        defaultValue: f.defaultValue ?? undefined,
        order: sanitizeNum(f.order, (idx + 1) * 10, 0, 99999),
        layout: f.layout || undefined,
      };

      // Options
      if (Array.isArray(f.options)) {
        field.options = f.options
          .filter((o: any) => o && (typeof o.value === "string" || typeof o.value === "number"))
          .map((o: any) => ({
            value: String(o.value),
            label: sanitizeStr(o.label, String(o.value), 200),
          }));
      }

      // Number/range/slider params
      if (f.min !== undefined) field.min = Number(f.min) || undefined;
      if (f.max !== undefined) field.max = Number(f.max) || undefined;
      if (f.step !== undefined) field.step = Number(f.step) || undefined;

      // Visibility
      if (f.visibility && Array.isArray(f.visibility.when)) {
        field.visibility = {
          when: f.visibility.when
            .filter((c: any) => c && typeof c.fieldId === "string")
            .map((c: any) => ({
              fieldId: String(c.fieldId),
              op: (["eq", "neq", "in", "contains", "gt", "lt"].includes(c.op) ? c.op : "eq") as VisibilityOp,
              value: c.value,
            })),
          mode: f.visibility.mode === "any" ? "any" : "all",
        };
      }

      // Mapping
      if (f.mapping && typeof f.mapping.target === "string") {
        const validTargets: MappingTarget[] = [
          "user.free_text", "user.interests", "user.gender",
          "user.relationship", "user.budget_min", "user.budget_max",
          "user.age", "user.category",
        ];
        const target = f.mapping.target as MappingTarget;
        if (validTargets.includes(target)) {
          field.mapping = {
            target,
            format: (["raw", "label", "value", "kv", "sentence"].includes(f.mapping.format) ? f.mapping.format : "raw") as MappingFormat,
            weight: f.mapping.weight !== undefined ? sanitizeNum(f.mapping.weight, 1, 0, 10) : undefined,
            appendToFreeText: f.mapping.appendToFreeText === true,
            priority: (["must_have", "preference"].includes(f.mapping.priority) ? f.mapping.priority : undefined) as ConstraintPriority | undefined,
            constraintType: (["exact", "range", "contains", "in"].includes(f.mapping.constraintType) ? f.mapping.constraintType : undefined) as ConstraintType | undefined,
          };
        }
      }

      return field;
    });

  // Form > Submit
  const rs = raw.form?.submit || {};
  const submit: FormSubmitConfig = {
    allowEmpty: rs.allowEmpty === true,
    validationMode: rs.validationMode === "live" ? "live" : "onSubmit",
  };

  // Bubble
  let bubble = def.bubble;
  if (raw.bubble && Array.isArray(raw.bubble.texts)) {
    const texts = raw.bubble.texts
      .map((t: any) => String(t || "").trim())
      .filter(Boolean);
    if (texts.length > 0) {
      bubble = { texts };
    }
  }

  return {
    version,
    ui: { theme, copy },
    form: { fields, submit },
    bubble,
  };
}

/* ===================================================================
 * 5) LEGACY MIGRATION: régi Partner adatokból FullWidgetConfig építés
 * ===================================================================
 * Ha egy partnernek nincs full_widget_config-ja, de van widget_copy/widget_fields/stb,
 * azokból összeállítunk egy default-alapú configot, ami backward-compatible.
 * =================================================================== */

export interface LegacyPartnerSettings {
  widget_config?: any;
  widget_copy?: any;
  widget_fields?: any;
  widget_schema?: any;
  relevance?: any;
}

export function buildConfigFromLegacy(legacy: LegacyPartnerSettings): FullWidgetConfig {
  const cfg = getDefaultWidgetConfig();

  // Legacy widget_config -> theme + bubble
  const wc = legacy.widget_config;
  if (wc) {
    if (wc.theme) {
      cfg.ui.theme.bubbleBg = sanitizeHex(wc.theme.bubble_bg, cfg.ui.theme.bubbleBg!);
      cfg.ui.theme.bubbleText = sanitizeHex(wc.theme.bubble_text, cfg.ui.theme.bubbleText!);
      cfg.ui.theme.backgroundColor = sanitizeHex(wc.theme.panel_bg, cfg.ui.theme.backgroundColor);
      cfg.ui.theme.textColor = sanitizeHex(wc.theme.panel_text, cfg.ui.theme.textColor);
      cfg.ui.theme.primaryColor = sanitizeHex(wc.theme.button_bg, cfg.ui.theme.primaryColor);
      cfg.ui.theme.accentColor = sanitizeHex(wc.theme.accent, cfg.ui.theme.accentColor);
      cfg.ui.theme.buttonBg = sanitizeHex(wc.theme.button_bg, cfg.ui.theme.buttonBg!);
      cfg.ui.theme.buttonText = sanitizeHex(wc.theme.button_text, cfg.ui.theme.buttonText!);
      cfg.ui.theme.headerGradStart = sanitizeHex(wc.theme.header_grad_start, cfg.ui.theme.headerGradStart!);
      cfg.ui.theme.headerGradEnd = sanitizeHex(wc.theme.header_grad_end, cfg.ui.theme.headerGradEnd!);
    }
    if (wc.panel_title) cfg.ui.copy.panelTitle = wc.panel_title;
    if (wc.panel_subtitle) cfg.ui.copy.panelSubtitle = wc.panel_subtitle;
    if (Array.isArray(wc.bubble_texts) && wc.bubble_texts.length > 0) {
      cfg.bubble = { texts: wc.bubble_texts };
    }
  }

  // Legacy widget_copy -> override copy texts
  const copy = legacy.widget_copy;
  if (copy) {
    if (copy.panelTitle) cfg.ui.copy.panelTitle = copy.panelTitle;
    if (copy.panelSubtitle) cfg.ui.copy.panelSubtitle = copy.panelSubtitle;
    if (copy.submitText) cfg.ui.copy.submitText = copy.submitText;
    if (copy.resetText) cfg.ui.copy.resetText = copy.resetText;
    if (copy.helpText) cfg.ui.copy.helpText = copy.helpText;
    // interest / details placeholders -> update field placeholders
    const interestField = cfg.form.fields.find(f => f.id === "interests");
    if (interestField && copy.interestPlaceholder) {
      interestField.placeholder = copy.interestPlaceholder;
    }
    const freeTextField = cfg.form.fields.find(f => f.id === "free_text");
    if (freeTextField && copy.detailsPlaceholder) {
      freeTextField.placeholder = copy.detailsPlaceholder;
    }
    // Section labels -> update field labels
    if (copy.budgetLabel) {
      const bmin = cfg.form.fields.find(f => f.id === "budget_min");
      if (bmin) bmin.label = "💰 " + copy.budgetLabel + " (Min)";
      const bmax = cfg.form.fields.find(f => f.id === "budget_max");
      if (bmax) bmax.label = "💰 " + copy.budgetLabel + " (Max)";
    }
    if (copy.interestLabel) {
      if (interestField) interestField.label = "❤️ " + copy.interestLabel;
    }
    if (copy.detailsLabel) {
      const dtl = cfg.form.fields.find(f => f.id === "free_text");
      if (dtl) dtl.label = "📝 " + copy.detailsLabel;
    }
  }

  // Legacy widget_fields -> enable/disable fields
  const wf = legacy.widget_fields;
  if (wf) {
    const toggleMap: Record<string, string[]> = {
      showBudget: ["budget_min", "budget_max"],
      showInterests: ["interests"],
      showGender: ["gender"],
      showRelationship: ["relationship"],
      showFreeText: ["free_text"],
      showAge: ["age"],
    };
    for (const [key, fieldIds] of Object.entries(toggleMap)) {
      if (typeof (wf as any)[key] === "boolean") {
        for (const fid of fieldIds) {
          const field = cfg.form.fields.find(f => f.id === fid);
          if (field) field.enabled = (wf as any)[key];
        }
      }
    }
  }

  // Legacy widget_schema (fashion preset) -> add fashion fields
  const ws = legacy.widget_schema;
  if (ws && ws.preset === "fashion" && ws.fashionFields) {
    const ff = ws.fashionFields;
    if (ff.showColorPicker !== false && Array.isArray(ff.colorOptions)) {
      cfg.form.fields.push({
        id: "color",
        type: "select",
        label: "🎨 Szín",
        enabled: true,
        required: false,
        order: 42,
        options: [{ value: "", label: "Mindegy" }, ...ff.colorOptions.map((c: string) => ({ value: c, label: c }))],
        mapping: { target: "user.interests", format: "value", appendToFreeText: true },
      });
    }
    if (ff.showTypePicker !== false && Array.isArray(ff.typeOptions)) {
      cfg.form.fields.push({
        id: "clothing_type",
        type: "select",
        label: "👕 Típus",
        enabled: true,
        required: false,
        order: 43,
        options: [{ value: "", label: "Mindegy" }, ...ff.typeOptions.map((t: string) => ({ value: t, label: t }))],
        mapping: { target: "user.interests", format: "value", appendToFreeText: true },
      });
    }
    if (ff.showSizePicker !== false && Array.isArray(ff.sizeOptions)) {
      cfg.form.fields.push({
        id: "size",
        type: "select",
        label: "📏 Méret",
        enabled: true,
        required: false,
        order: 44,
        options: [{ value: "", label: "Mindegy" }, ...ff.sizeOptions.map((s: string) => ({ value: s, label: s }))],
        mapping: { target: "user.interests", format: "value", appendToFreeText: true },
      });
    }
  }

  return cfg;
}
