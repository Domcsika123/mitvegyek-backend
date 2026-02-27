// src/models/Partner.ts

/**
 * Widget panel szövegek – boltonként testreszabható az admin widget-szerkesztőben.
 * Ha nincs beállítva (null/undefined), a widget default szöveget használ.
 */
export interface WidgetCopy {
  panelTitle?: string;          // pl. "Stílusajánló" (default: "Termékajánló")
  panelSubtitle?: string;       // pl. "Válassz stílust, színt, fazont"
  budgetLabel?: string;         // pl. "Költségkeret" (section label)
  interestLabel?: string;       // pl. "Stílus / szín / fazon" (section label)
  detailsLabel?: string;        // pl. "Részletek" (section label)
  interestPlaceholder?: string; // pl. "pl. sportos, elegáns, sötétkék"
  detailsPlaceholder?: string;  // pl. "pl. szereti a laza stílust, minimalista..."
  submitText?: string;          // pl. "✨ Mutasd az ajánlatokat"
  resetText?: string;           // pl. "🔄 Újrakezdés"
  helpText?: string;            // pl. "Tipp: elég 1–2 mező is."
}

/**
 * Widget mezők ki/be kapcsolása – boltonként testreszabható.
 * Default: minden mező látható (true).
 */
export interface WidgetFields {
  showBudget?: boolean;
  showInterests?: boolean;
  showGender?: boolean;
  showRelationship?: boolean;
  showFreeText?: boolean;
  showAge?: boolean;
}

/**
 * Relevancia beállítások – boltonként konfigurálható.
 * Elsősorban ruházati boltokhoz: szín/típus egyezés kikényszerítése.
 */
export interface RelevanceConfig {
  strictColorMatch?: boolean;    // szín-clash esetén kizárja a terméket
  strictTypeMatch?: boolean;     // típus-eltérés esetén kizárja a terméket
  boostColorWeight?: number;     // 0..1, default 0.30 (attribute weight)
  boostEmbeddingWeight?: number; // 0..1, default 0.55
  boostPopularityWeight?: number;// 0..1, default 0.15
}

/**
 * Widget séma – fashion preset support.
 * A preset mód meghatározza, hogy milyen extra mezőket kap a widget.
 */
export interface WidgetSchema {
  preset?: "generic" | "fashion"; // default: "generic"
  fashionFields?: {
    showColorPicker?: boolean;    // szín dropdown a widgetben
    showTypePicker?: boolean;     // terméktípus dropdown a widgetben
    showSizePicker?: boolean;     // méret dropdown
    colorOptions?: string[];      // pl. ["Kék", "Piros", "Fekete", ...]
    typeOptions?: string[];       // pl. ["Pulóver", "Póló", "Nadrág", ...]
    sizeOptions?: string[];       // pl. ["XS", "S", "M", "L", "XL", ...]
  };
}

export interface Partner {
  site_key: string;        // egyedi azonosító pl. "shop123"
  name: string;            // webshop neve
  api_key: string;         // partner API kulcs pl. "pk_xxxxxx"
  products_file: string;   // a partner terméklistájának JSON fájlja (data/... )
  settings?: {
    theme_color?: string;
    widget_text?: string;
  };
  created_at: string;

  // ✅ Boltonként testreszabható widget panel szövegek
  widget_copy?: WidgetCopy | null;
  // ✅ Mezők ki/be kapcsolása
  widget_fields?: WidgetFields | null;
  // ✅ Relevancia beállítások (szín/típus matching)
  relevance?: RelevanceConfig | null;
  // ✅ Widget séma (fashion preset, extra mezők)
  widget_schema?: WidgetSchema | null;
}
