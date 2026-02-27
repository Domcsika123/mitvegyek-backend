// src/ai/universalConstraints.ts
//
// Universal Constraints Engine — domain-agnostic product filtering & scoring.
// Works for any shop domain: fashion, electronics, cosmetics, books, gifts, etc.
//
// Pipeline:
//   1. Extract constraints from UserContext + WidgetConfig field mappings
//   2. Hard-filter by must_have constraints (budget, age)
//   3. Score all candidates with constraint matching
//   4. Apply mismatch penalty for must_have color/type failures
//   5. "Hard filter if enough" — if ≥threshold products match a color/type
//      constraint, remove mismatches from results
//   6. Combined scoring: embedding * w_embed + constraint * w_constraint + popularity * w_pop
//   7. Dedupe by base product
//   8. Diversity pass: max N similar sub-type items
//   9. Debug report

import { Product } from "../models/Product";
import { UserContext } from "../models/UserContext";
import { FullWidgetConfig, FieldMapping, ConstraintPriority, ConstraintType } from "../config/widgetConfig";
import {
  extractProductSignals,
  extractUserSignals,
  ProductSignals,
  UserSignals,
  fuzzyContains,
  tokenOverlap,
} from "./signals";
import { baseId } from "./queryUtils";

/* ===================================================================
 * 0) COLOR + TYPE DICTIONARIES (for strict matching)
 * =================================================================== */

interface ColorGroup {
  id: string;
  synonyms: string[];
  compatible: string[];
}

const COLOR_GROUPS: ColorGroup[] = [
  { id: "kek", synonyms: ["kék","kek","blue","azúr","azur","égkék","babakék","babakek","világoskék","vilagoskek","sötétkék","sotetkek","navy","tengerészkék","tengerkék","royal blue","royalkék","kobalt","indigo","acélkék","acelkek","petrolkék","petrolkek"], compatible: ["turkiz","lila"] },
  { id: "turkiz", synonyms: ["türkiz","turkiz","turquoise","teal","aqua","cián","cian"], compatible: ["kek","zold"] },
  { id: "piros", synonyms: ["piros","red","vörös","voros","skarlát","skarlat","bíbor","bibor","cseresznye","meggy","meggypiros","crimson","scarlet","cherry","tűzpiros","tuzpiros"], compatible: ["narancs","bordo","rozsaszin"] },
  { id: "rozsaszin", synonyms: ["rózsaszín","rozsaszin","pink","magenta","fuchsia","babarózsa","babarozsa","mályva","malyva","rose","blush"], compatible: ["piros","lila"] },
  { id: "fekete", synonyms: ["fekete","black","éjfekete","koromfekete","ében","jet black","onyx"], compatible: ["szurke"] },
  { id: "feher", synonyms: ["fehér","feher","white","hófehér","hofeher","krém","krem","törtfehér","tortfeher","ivory","off-white","offwhite"], compatible: ["bezs"] },
  { id: "zold", synonyms: ["zöld","zold","green","smaragd","lime","olív","oliv","khaki","sötétzöld","világoszöld","menta","mentazöld","sage","forest","emerald"], compatible: ["turkiz"] },
  { id: "sarga", synonyms: ["sárga","sarga","yellow","arany","aranysárga","citrom","mustár","mustar","mustard","gold","golden"], compatible: ["narancs"] },
  { id: "narancs", synonyms: ["narancs","narancssárga","orange","mandarin","korall","coral","terrakotta","terracotta"], compatible: ["sarga","piros"] },
  { id: "lila", synonyms: ["lila","purple","violet","ibolya","levendula","lavender","orgona","padlizsán","padlizsan","plum","szilva","ametiszt","mauve"], compatible: ["kek","rozsaszin"] },
  { id: "barna", synonyms: ["barna","brown","sötétbarna","világosbarna","csokoládé","csokolade","chocolate","mogyoró","dió","karamell","caramel","mahagóni","gesztenye","chestnut","kávé","kave","coffee","mokka","mocha","tan"], compatible: ["bezs","narancs"] },
  { id: "szurke", synonyms: ["szürke","szurke","grey","gray","sötétszürke","világosszürke","antracit","anthracite","ezüst","ezust","silver","acélszürke","grafit","graphite","charcoal"], compatible: ["fekete","feher"] },
  { id: "bezs", synonyms: ["bézs","bezs","beige","drapp","homok","sand","teve","camel","nude","taupe","champagne","pezsgő"], compatible: ["feher","barna"] },
  { id: "bordo", synonyms: ["bordó","bordo","burgundy","burgundia","meggybordó","vörösbor","borvörös","maroon","wine","marsala"], compatible: ["piros"] },
];

const TYPE_GROUPS: { id: string; synonyms: string[] }[] = [
  // FONTOS: összetett típusok (fürdőruha, sportruha, melegítő) ELŐBB a simla alaptípusok előtt,
  // mert a normalizeHuQuery bővítés "ruha"/"nadrág" tokent is eredményezhet.
  // Specifikusabb match mindig nyerjen az általánosabb előtt.
  { id: "hoodie", synonyms: ["hoodie","kapucnis","kapucnis pulóver","kapucnis felső","hoody","kapucnis pulcsi","zip-up","zipup","zip hoodie"] },
  { id: "pulover", synonyms: ["pulóver","pulover","pulcsi","sweater","kötött","knitwear","jumper","v-nyakú pulóver","kereknyakú pulóver","crewneck","crew neck"] },
  { id: "polo", synonyms: ["póló","polo","t-shirt","tshirt","tee","rövid ujjú","top","crop top","tank top","tank","longsleeve","long sleeve"] },
  { id: "ing", synonyms: ["ing","shirt","blúz","bluz","blouse","button-down","button down"] },
  { id: "furdoruha", synonyms: ["fürdőruha","furdoruha","bikini","swimsuit","swimwear","fürdőnadrág","swim","fürdő","fürdo","strand","úszó","uszo"] },
  { id: "melegito", synonyms: ["melegítő","melegito","tracksuit","jogging","szabadidő","szabadido","sweatpants","melegítőnadrág","melegítő nadrág","melegítőfelső","melegítő felső","tréningruha","treningruha","jogger szett","szabadidőruha","szabadidő szett"] },
  { id: "nadrag", synonyms: ["nadrág","nadrag","pants","trousers","jogger","chino","leggings","trackpants","track pants"] },
  { id: "farmer", synonyms: ["farmer","denim","jeans","skinny","slim fit farmer"] },
  { id: "short", synonyms: ["short","shorts","rövidnadrág","rovidnadrag","bermuda"] },
  { id: "kabat", synonyms: ["kabát","kabat","jacket","dzseki","parka","bomber","coat","blézer","blazer","denim jacket"] },
  { id: "melleny", synonyms: ["mellény","melleny","vest","gilet","bodywarmer"] },
  { id: "ruha", synonyms: ["ruha","dress","miniruha","maxiruha","koktélruha","alkalmi ruha","bodysuit","jumpsuit","overall"] },
  { id: "szoknya", synonyms: ["szoknya","skirt","miniszoknya","maxiszoknya","rakott szoknya","ceruzaszoknya","harangszoknya"] },
  { id: "cipo", synonyms: ["cipő","cipo","shoe","sneaker","tornacipő","csizma","boot","szandál","sandal","futócipő","sportcipő","slides","papucs"] },
  { id: "taska", synonyms: ["táska","taska","bag","hátizsák","hatizsak","backpack","válltáska","valltaska","clutch","kézitáska","kezitaska","shopper","crossbody","öv táska","fanny pack","bum bag"] },
  { id: "zokni", synonyms: ["zokni","socks","sock","bokazokni","térd zokni","térdzokni","kompressziós zokni","sportzokni","zokni szett","harisnya","harisnyanadrág","tights"] },
  { id: "fehernemu", synonyms: ["fehérnemű","fehernemu","underwear","alsónemű","alsonemu","boxer","alsónadrág","bugyi","tanga","melltartó","melltarto","bra","sportmelltartó","briefs"] },
  { id: "sapka", synonyms: ["sapka","kalap","hat","cap","beanie","baseball cap","bucket hat","bucket","trucker","snapback"] },
  { id: "sal", synonyms: ["sál","sal","scarf","kendő","kendo","nyakkendő","nyakkendo"] },
  { id: "sportruha", synonyms: ["sportruha","activewear","sport","fitness","edzőruha","edzoruha","futóruha","futoruha","yoga","tréningruha","treningruha"] },
  { id: "ekszer", synonyms: ["ékszer","ekszer","jewelry","jewellery","nyaklánc","nyaklanc","karkötő","karkoto","gyűrű","gyuru","fülbevaló","fulbevalo","piercing","lánc","lanc","medál","medal","bross"] },
  { id: "kiegeszito", synonyms: ["kiegészítő","kiegeszito","accessory","accessories","öv","ov","belt","napszemüveg","napszemuveg","sunglasses","pénztárca","penztarca","wallet","kulcstartó","kulcstarto"] },
];

/** Resolve a text token to a color group ID. Strict word-level match only. */
function resolveColorGroup(token: string): string | null {
  const t = token.toLowerCase().trim();
  for (const g of COLOR_GROUPS) {
    if (g.synonyms.some(s => s === t)) return g.id;
  }
  return null;
}

/** Check if two color groups are the same or compatible. */
function colorsCompatible(groupA: string, groupB: string): boolean {
  if (groupA === groupB) return true;
  const ga = COLOR_GROUPS.find(g => g.id === groupA);
  if (ga && ga.compatible.includes(groupB)) return true;
  const gb = COLOR_GROUPS.find(g => g.id === groupB);
  if (gb && gb.compatible.includes(groupA)) return true;
  return false;
}

/**
 * Extract the dominant color group from a product.
 * Scans tags first (most reliable), then name tokens.
 * Uses strict word-boundary matching — "Blue Flame Print" on a black hoodie
 * will NOT count as blue if tags say "fekete".
 */
export function extractProductColorGroup(product: Product): string | null {
  // Priority 1: tags (most structured, most reliable)
  const rawTags = (product as any).tags;
  const tagStr = typeof rawTags === "string" ? rawTags : Array.isArray(rawTags) ? rawTags.join(",") : "";
  const tagTokens = tagStr.toLowerCase().split(/[,;\s]+/).map((t: string) => t.trim()).filter(Boolean);
  for (const token of tagTokens) {
    const g = resolveColorGroup(token);
    if (g) return g;
  }

  // Priority 2: name tokens (word boundaries only)
  const nameTokens = (product.name || "").toLowerCase().split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
  for (const token of nameTokens) {
    const g = resolveColorGroup(token);
    if (g) return g;
  }

  // Priority 3: CW (colorway) from description — structured color info only
  const descText = (product.description || "");
  const cwMatch = descText.match(/CW:\s*([^.\n]{3,40})/i);
  if (cwMatch) {
    const cwTokens = cwMatch[1].toLowerCase().split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
    for (const token of cwTokens) {
      const g = resolveColorGroup(token);
      if (g) return g;
    }
  }

  // Priority 4: category and product_type (NOT full description — too unreliable)
  const catText = (product.category || "").toLowerCase();
  const productType = ((product as any).product_type || "").toLowerCase();
  const fallbackText = `${catText} ${productType}`;
  const fallbackTokens = fallbackText.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
  for (const token of fallbackTokens) {
    const g = resolveColorGroup(token);
    if (g) return g;
  }

  return null;
}

/**
 * Check if a product contains a specific color group ANYWHERE
 * (not just primary color). "Black/Red Socks" → has both "black" AND "red".
 */
export function productHasColorGroup(product: Product, targetGroup: string): boolean {
  const allTokens: string[] = [];

  // Tags
  const rawTags = (product as any).tags;
  const tagStr = typeof rawTags === "string" ? rawTags : Array.isArray(rawTags) ? rawTags.join(",") : "";
  allTokens.push(...tagStr.toLowerCase().split(/[,;\s]+/).map((t: string) => t.trim()).filter(Boolean));

  // Name
  allTokens.push(...(product.name || "").toLowerCase().split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean));

  // CW from description
  const cwMatch = (product.description || "").match(/CW:\s*([^.\n]{3,40})/i);
  if (cwMatch) {
    allTokens.push(...cwMatch[1].toLowerCase().split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean));
  }

  // Category + product_type
  const catText = (product.category || "").toLowerCase();
  const productType = ((product as any).product_type || "").toLowerCase();
  allTokens.push(...`${catText} ${productType}`.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean));

  for (const token of allTokens) {
    if (resolveColorGroup(token) === targetGroup) return true;
  }
  return false;
}

/** Extract clothing type group from a product. Word-boundary aware. */
export function extractProductTypeGroup(product: Product): string | null {
  const productType = ((product as any).product_type || "").toLowerCase();
  const name = (product.name || "").toLowerCase();
  const tags = ((product as any).tags || "").toLowerCase();
  const category = (product.category || "").toLowerCase();

  // FONTOS: NÉVBEN lévő type match erősebb, mint a category-ban lévő.
  // Pl. "UNREAL Recycled Beanie Green" category="Tee" → a NÉV "beanie" matchel "sapka"-ra,
  // ne a category "Tee" matcheljen "polo"-ra.
  // 1) Először kizárólag NÉV + product_type + tags alapján keresünk
  const primaryText = productType + " " + name + " " + tags;
  const primaryTokens = primaryText.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
  for (const tg of TYPE_GROUPS) {
    for (const syn of tg.synonyms) {
      if (syn.includes(" ")) {
        if (primaryText.includes(syn)) return tg.id;
      } else {
        if (primaryTokens.includes(syn)) return tg.id;
      }
    }
  }
  // 2) Ha a névben/tags-ben nincs type match, AKKOR nézzük a category-t
  // Shopify-stílusú hierarchikus kategóriák esetén (pl. "...Pants > Shorts")
  // a legspecifikusabb (utolsó) szegmenst kell előnyben részesíteni.
  const catSegments = category.split(">").map(s => s.trim()).filter(Boolean).reverse();
  for (const segment of catSegments) {
    const catTokens = segment.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
    for (const tg of TYPE_GROUPS) {
      for (const syn of tg.synonyms) {
        if (syn.includes(" ")) {
          if (segment.includes(syn)) return tg.id;
        } else {
          if (catTokens.includes(syn)) return tg.id;
        }
      }
    }
  }
  return null;
}

/** Extract color group from user query text. */
/**
 * Basic Hungarian suffix stripping for better token matching.
 * Strips common noun suffixes: accusative (-t, -at, -ot, -et, -öt),
 * plural (-k, -ak, -ok, -ek, -ök), and common case endings.
 * Returns original token + all stripped variants.
 */
function hungarianStems(token: string): string[] {
  const results = [token];
  // Order matters: strip longer suffixes first
  const suffixes = [
    // Accusative + plural combo
    "okat", "eket", "öket", "akat",
    // Common case endings (longer first)
    "ban", "ben", "ból", "ből", "nak", "nek", "hoz", "hez", "höz",
    "val", "vel", "ról", "ről", "tól", "től", "nál", "nél",
    "ra", "re", "ba", "be",
    // Plural
    "ok", "ek", "ök", "ak",
    // Accusative
    "at", "ot", "et", "öt",
    // Simple endings
    "ét", "át",
    "t", "k", "n",
  ];
  for (const suffix of suffixes) {
    if (token.length > suffix.length + 2 && token.endsWith(suffix)) {
      const stem = token.slice(0, -suffix.length);
      results.push(stem);
      // Fix accented stems: szürké → szürke, pirosá → pirosa, kéké → kéke
      const deaccented = stem.replace(/é$/, "e").replace(/á$/, "a").replace(/ó$/, "o").replace(/ű$/, "ü").replace(/ő$/, "ö");
      if (deaccented !== stem) results.push(deaccented);
    }
  }
  return [...new Set(results)];
}

export function extractUserColorGroup(user: UserContext): string | null {
  const parts = [user.free_text || "", ...(user.interests || [])].join(" ").toLowerCase();
  const tokens = parts.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
  for (const token of tokens) {
    // Try original + Hungarian-stemmed variants
    for (const variant of hungarianStems(token)) {
      const g = resolveColorGroup(variant);
      if (g) return g;
    }
  }
  return null;
}

/** Extract type group from user query text. Word-boundary aware + Hungarian suffix stripping. */
export function extractUserTypeGroup(user: UserContext): string | null {
  const parts = [user.free_text || "", ...(user.interests || [])].join(" ").toLowerCase();
  const tokens = parts.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);
  // Expand tokens with Hungarian-stemmed variants for better matching
  const expandedTokens = tokens.flatMap(t => hungarianStems(t));
  for (const tg of TYPE_GROUPS) {
    for (const syn of tg.synonyms) {
      if (syn.includes(" ")) {
        if (parts.includes(syn)) return tg.id;
      } else {
        if (expandedTokens.includes(syn)) return tg.id;
      }
    }
  }
  return null;
}

/* ===================================================================
 * 1) CONSTRAINT TYPES
 * =================================================================== */

export interface Constraint {
  /** The field ID that generated this constraint */
  fieldId: string;
  /** must_have = hard filter, preference = soft score boost */
  priority: ConstraintPriority;
  /** How to match: exact, range, contains, in */
  constraintType: ConstraintType;
  /** The user-provided value(s) for this constraint */
  value: any;
  /** Weight multiplier for scoring (default 1.0) */
  weight: number;
  /** Which product data this constraint targets (derived from mapping.target) */
  target: string;
}

export interface ConstraintMatchResult {
  /** Overall constraint score 0..1 */
  constraintScore: number;
  /** Per-constraint match details */
  matches: { fieldId: string; matched: boolean; score: number; reason: string }[];
  /** Was hard-filtered out by a must_have constraint? */
  hardFiltered: boolean;
  /** Reason for hard filtering */
  hardFilterReason: string;
  /** Color match status for "hard filter if enough" (includes compatible) */
  colorMatch: boolean;
  /** True if color is an EXACT match (not just compatible) */
  colorExact: boolean;
  /** Type match status for "hard filter if enough" */
  typeMatch: boolean;
  /** True if no color data was found on this product (neutral, not mismatch) */
  colorUnknown: boolean;
  /** True if no type data was found on this product (neutral, not mismatch) */
  typeUnknown: boolean;
}

export interface ScoredProduct {
  product: Product;
  embeddingScore: number;
  constraintScore: number;
  popularityScore: number;
  finalScore: number;
  constraintDetail: ConstraintMatchResult;
}

export interface ConstraintEngineConfig {
  /** Weight for embedding similarity (default 0.40) */
  wEmbed: number;
  /** Weight for constraint matching (default 0.45) */
  wConstraint: number;
  /** Weight for popularity/position (default 0.15) */
  wPop: number;
  /** Max items per base product in dedupe (default 1) */
  maxPerBase: number;
  /** Max items of same sub-category in diversity pass (default 4) */
  maxSameSubType: number;
  /** Enable graceful fallback when too few results after hard filter */
  gracefulFallback: boolean;
  /** Minimum result count before triggering fallback */
  fallbackMinResults: number;
  /** "Hard filter if enough" threshold: if ≥ this many products match
   *  a must_have color/type, remove mismatches from results. Default 8. */
  hardFilterIfEnoughThreshold: number;
  /** Mismatch penalty multiplier for must_have color/type fails.
   *  finalScore *= this for mismatched products. Default 0.15. */
  mismatchPenalty: number;
}

const DEFAULT_ENGINE_CONFIG: ConstraintEngineConfig = {
  wEmbed: 0.25,
  wConstraint: 0.60,
  wPop: 0.15,
  maxPerBase: 1,
  maxSameSubType: 4,
  gracefulFallback: true,
  fallbackMinResults: 6,
  hardFilterIfEnoughThreshold: 1,
  mismatchPenalty: 0.02,
};

/* ===================================================================
 * 2) EXTRACT CONSTRAINTS FROM USER + WIDGET CONFIG
 * =================================================================== */

/**
 * Build a list of active constraints from the UserContext combined
 * with the widget config field mappings. Only fields with non-empty
 * user values that have priority + constraintType generate constraints.
 *
 * Also generates implicit constraints from standard UserContext fields
 * (budget, gender, age) even without widget config.
 *
 * NEW: Extracts implicit color/type constraints from free_text
 * even without widget config, using the color/type dictionaries.
 */
export function extractConstraints(
  user: UserContext,
  widgetConfig?: FullWidgetConfig | null,
): Constraint[] {
  const constraints: Constraint[] = [];

  // --- Implicit constraints from standard UserContext fields ---

  // Budget range (always must_have if provided)
  if (user.budget_min != null || user.budget_max != null) {
    constraints.push({
      fieldId: "_budget",
      priority: "must_have",
      constraintType: "range",
      value: { min: user.budget_min ?? 0, max: user.budget_max ?? Infinity },
      weight: 1.0,
      target: "price",
    });
  }

  // Age restriction (must_have: under-18 filtering)
  if (user.age != null && user.age < 18) {
    constraints.push({
      fieldId: "_age_restriction",
      priority: "must_have",
      constraintType: "exact",
      value: "age_restricted",
      weight: 1.0,
      target: "_age_gate",
    });
  }

  // --- Widget config-driven constraints ---
  let hasWidgetColorConstraint = false;
  let hasWidgetTypeConstraint = false;

  if (widgetConfig?.form?.fields) {
    for (const field of widgetConfig.form.fields) {
      if (!field.enabled || !field.mapping) continue;
      const mapping = field.mapping;
      if (!mapping.priority || !mapping.constraintType) continue;

      // Determine the user value for this field based on mapping target
      const userValue = getUserValueForField(user, field.id, mapping);
      if (userValue === null || userValue === undefined || userValue === "") continue;

      constraints.push({
        fieldId: field.id,
        priority: mapping.priority,
        constraintType: mapping.constraintType,
        value: userValue,
        weight: mapping.weight ?? 1.0,
        target: resolveConstraintTarget(field.id, mapping),
      });

      if (field.id === "color") hasWidgetColorConstraint = true;
      if (field.id === "clothing_type") hasWidgetTypeConstraint = true;
    }
  }

  // --- Implicit color/type constraints from free_text (DEFAULT mapping) ---
  // Even without widget config, extract color and type from query text.
  const userColorGroup = extractUserColorGroup(user);
  const userTypeGroup = extractUserTypeGroup(user);

  if (userColorGroup && !hasWidgetColorConstraint) {
    constraints.push({
      fieldId: "_implicit_color",
      priority: "must_have",
      constraintType: "exact",
      value: userColorGroup,
      weight: 1.0,
      target: "_color_group",
    });
  }

  if (userTypeGroup && !hasWidgetTypeConstraint) {
    constraints.push({
      fieldId: "_implicit_type",
      priority: "must_have",
      constraintType: "exact",
      value: userTypeGroup,
      weight: 1.0,
      target: "_type_group",
    });
  }

  // --- Free-text driven constraints (implicit preference) ---
  const userSignals = extractUserSignals(user);
  const hasExplicitConstraints = constraints.some(c =>
    c.fieldId !== "_budget" &&
    c.fieldId !== "_age_restriction" &&
    c.fieldId !== "_implicit_color" &&
    c.fieldId !== "_implicit_type"
  );
  if (userSignals.queryTokens.length > 0 && !hasExplicitConstraints) {
    constraints.push({
      fieldId: "_query_relevance",
      priority: "preference",
      constraintType: "contains",
      value: userSignals.queryText,
      weight: 0.5,
      target: "searchableText",
    });
  }

  return constraints;
}

/**
 * Resolve what product field a constraint should match against.
 */
function resolveConstraintTarget(fieldId: string, mapping: FieldMapping): string {
  const fieldTargets: Record<string, string> = {
    color: "_color_group",
    clothing_type: "_type_group",
    size: "searchableText",
    brand: "brand",
    category: "category",
    occasion: "searchableText",
  };

  if (fieldTargets[fieldId]) return fieldTargets[fieldId];

  switch (mapping.target) {
    case "user.budget_min":
    case "user.budget_max":
      return "price";
    case "user.gender":
      return "searchableText";
    case "user.category":
      return "category";
    default:
      return "searchableText";
  }
}

/**
 * Get the value the user provided for a given field.
 * For color fields: resolves to color group ID.
 * For clothing_type fields: resolves to type group ID.
 */
function getUserValueForField(
  user: UserContext,
  fieldId: string,
  mapping: FieldMapping,
): any {
  // Special handling for color: resolve to color group
  if (fieldId === "color") {
    return extractUserColorGroup(user);
  }

  // Special handling for clothing_type: resolve to type group
  if (fieldId === "clothing_type") {
    return extractUserTypeGroup(user);
  }

  switch (mapping.target) {
    case "user.gender":
      return user.gender && user.gender !== "unknown" ? user.gender : null;
    case "user.age":
      return user.age;
    case "user.budget_min":
      return user.budget_min;
    case "user.budget_max":
      return user.budget_max;
    case "user.relationship":
      return user.relationship;
    case "user.interests":
    case "user.free_text":
    case "user.category":
      if (mapping.appendToFreeText) {
        const allText = [
          user.free_text || "",
          ...(user.interests || []),
        ].join(" ").trim();
        return allText || null;
      }
      if (mapping.target === "user.interests" && user.interests && user.interests.length > 0) {
        return user.interests.join(" ");
      }
      if (mapping.target === "user.free_text" && user.free_text) {
        return user.free_text;
      }
      return null;
    default:
      return null;
  }
}

/* ===================================================================
 * 3) CONSTRAINT MATCHING
 * =================================================================== */

/**
 * Match a single product against all constraints.
 * Returns a ConstraintMatchResult with overall score and per-constraint details.
 *
 * Tracks colorMatch and typeMatch for the "hard filter if enough" system.
 * Budget/age are hard-filtered immediately; color/type are tracked for later.
 */
function matchProductConstraints(
  product: Product,
  productSignals: ProductSignals,
  constraints: Constraint[],
): ConstraintMatchResult {
  const matches: { fieldId: string; matched: boolean; score: number; reason: string }[] = [];
  let hardFiltered = false;
  let hardFilterReason = "";
  let colorMatch = true;
  let colorExact = false;
  let typeMatch = true;
  let colorUnknown = false;
  let typeUnknown = false;

  const mustHaves = constraints.filter(c => c.priority === "must_have");
  const preferences = constraints.filter(c => c.priority === "preference");

  // --- Must-have constraints ---
  let mustHaveScoreSum = 0;
  let mustHaveWeightSum = 0;

  for (const c of mustHaves) {
    const result = evaluateConstraint(c, product, productSignals);
    matches.push({ fieldId: c.fieldId, matched: result.matched, score: result.score, reason: result.reason });

    // Track color/type match (for "hard filter if enough")
    if (c.target === "_color_group" || c.fieldId === "color" || c.fieldId === "_implicit_color") {
      colorMatch = result.matched;
      colorExact = result.matched && (result.reason.startsWith("exact color") || result.reason.startsWith("secondary color"));
      if (result.reason.includes("neutral") || result.reason.includes("no color detected")) {
        colorUnknown = true;
      }
    }
    if (c.target === "_type_group" || c.fieldId === "clothing_type" || c.fieldId === "_implicit_type") {
      typeMatch = result.matched;
      if (result.reason.includes("no type detected")) {
        typeUnknown = true;
      }
    }

    // Budget and age restriction are always hard-filtered immediately
    if (!result.matched && (c.fieldId === "_budget" || c.fieldId === "_age_restriction")) {
      hardFiltered = true;
      hardFilterReason = `${c.fieldId}: ${result.reason}`;
      break;
    }
    // Color/type must_haves: NOT hard-filtered here.
    // The "hard filter if enough" system in the pipeline handles it.

    // Accumulate must-have scores for constraint scoring
    mustHaveScoreSum += result.score * c.weight;
    mustHaveWeightSum += c.weight;
  }

  // --- Preference constraints: contribute to soft score ---
  let prefScoreSum = 0;
  let prefWeightSum = 0;

  for (const c of preferences) {
    const result = evaluateConstraint(c, product, productSignals);
    matches.push({ fieldId: c.fieldId, matched: result.matched, score: result.score, reason: result.reason });
    prefScoreSum += result.score * c.weight;
    prefWeightSum += c.weight;
  }

  // Combined constraint score: must-haves weighted 2x relative to preferences
  const totalScoreSum = mustHaveScoreSum * 2 + prefScoreSum;
  const totalWeightSum = mustHaveWeightSum * 2 + prefWeightSum;
  const constraintScore = totalWeightSum > 0 ? totalScoreSum / totalWeightSum : 0.5;

  return {
    constraintScore: Math.max(0, Math.min(1, constraintScore)),
    matches,
    hardFiltered,
    hardFilterReason,
    colorMatch,
    colorExact,
    typeMatch,
    colorUnknown,
    typeUnknown,
  };
}

/**
 * Evaluate a single constraint against product signals.
 */
function evaluateConstraint(
  constraint: Constraint,
  product: Product,
  signals: ProductSignals,
): { matched: boolean; score: number; reason: string } {
  const { constraintType, value, target } = constraint;

  // Special handler for age gate
  if (target === "_age_gate") {
    const restricted = ["alcohol", "erotic", "18+", "adult"].some(
      cat => signals.category.includes(cat) || signals.tags.some(t => t.includes(cat))
    );
    return restricted
      ? { matched: false, score: 0, reason: "age restricted product" }
      : { matched: true, score: 1, reason: "age ok" };
  }

  // Color group matching (strict dictionary-based)
  if (target === "_color_group") {
    return evaluateColorGroup(value, product);
  }

  // Type group matching (strict dictionary-based)
  if (target === "_type_group") {
    return evaluateTypeGroup(value, product);
  }

  // Get the product value for this target
  const productValue = getProductValueForTarget(signals, target);

  switch (constraintType) {
    case "exact":
      return evaluateExact(value, productValue, target);
    case "range":
      return evaluateRange(value, signals);
    case "contains":
      return evaluateContains(value, productValue);
    case "in":
      return evaluateIn(value, productValue);
    default:
      return { matched: true, score: 0.5, reason: "unknown constraint type" };
  }
}

/**
 * STRICT color matching using color groups.
 * "blue" in a graphic/print text does NOT count as a color match.
 * Only matches when the product's dominant color (from tags/name) matches.
 */
function evaluateColorGroup(
  userColorGroupId: any,
  product: Product,
): { matched: boolean; score: number; reason: string; isExact?: boolean } {
  const userGroup = String(userColorGroupId).toLowerCase();
  const productGroup = extractProductColorGroup(product);

  if (!productGroup) {
    // Nincs szín-adat a terméken → NEM büntetjük, mert nem tudjuk
    // Az LLM rerank fogja eldönteni a szín-relevanciát
    return { matched: false, score: 0.4, reason: `no color detected in product — neutral` };
  }
  if (productGroup === userGroup) {
    return { matched: true, score: 1.0, reason: `exact color match: ${userGroup}`, isExact: true };
  }
  // Secondary match: product has the color but it's not primary (e.g. "Black/Red Socks" for "piros")
  if (productHasColorGroup(product, userGroup)) {
    return { matched: true, score: 0.85, reason: `secondary color match: ${userGroup} found in multi-color product`, isExact: true };
  }
  if (colorsCompatible(userGroup, productGroup)) {
    return { matched: true, score: 0.75, reason: `compatible color: ${productGroup} ≈ ${userGroup}` };
  }
  return { matched: false, score: 0, reason: `color mismatch: product=${productGroup}, wanted=${userGroup}` };
}

/**
 * STRICT type matching using type groups.
 */
function evaluateTypeGroup(
  userTypeGroupId: any,
  product: Product,
): { matched: boolean; score: number; reason: string } {
  const userGroup = String(userTypeGroupId).toLowerCase();
  const productGroup = extractProductTypeGroup(product);

  if (!productGroup) {
    return { matched: false, score: 0.1, reason: `no type detected in product` };
  }
  if (productGroup === userGroup) {
    return { matched: true, score: 1.0, reason: `exact type match: ${userGroup}` };
  }
  // Related type groups: related items get partial match, not full mismatch
  const related: Record<string, string[]> = {
    pulover: ["hoodie", "melegito"],
    hoodie: ["pulover", "melegito"],
    szoknya: ["ruha"],
    ruha: ["szoknya"],
    nadrag: ["farmer", "melegito", "short"],
    farmer: ["nadrag"],
    short: ["nadrag", "melegito"],
    melegito: ["hoodie", "pulover", "nadrag"],
    kabat: ["melleny"],
    melleny: ["kabat"],
    polo: ["ing"],
    ing: ["polo"],
    sportruha: ["melegito", "furdoruha"],
    furdoruha: ["sportruha"],
    sapka: ["sal", "kiegeszito"],
    sal: ["sapka", "kiegeszito"],
    ekszer: ["sapka", "sal", "kiegeszito"],
    kiegeszito: ["sapka", "sal", "ekszer", "taska"],
  };
  if (related[userGroup]?.includes(productGroup)) {
    return { matched: true, score: 0.7, reason: `related type: ${productGroup} ≈ ${userGroup}` };
  }
  return { matched: false, score: 0, reason: `type mismatch: product=${productGroup}, wanted=${userGroup}` };
}

function getProductValueForTarget(signals: ProductSignals, target: string): string {
  switch (target) {
    case "brand": return signals.brand;
    case "category": return signals.category;
    case "productType": return signals.productType;
    case "searchableText": return signals.searchableText;
    case "tags": return signals.tags.join(" ");
    case "name": return signals.nameTokens.join(" ");
    default: return signals.searchableText;
  }
}

function evaluateExact(
  userValue: any,
  productValue: string,
  target: string,
): { matched: boolean; score: number; reason: string } {
  const uv = String(userValue).toLowerCase().trim();
  const pv = productValue.toLowerCase();

  if (pv.includes(uv)) {
    return { matched: true, score: 1.0, reason: `exact match: "${uv}" found in ${target}` };
  }

  // Fuzzy match with accent stripping
  if (fuzzyContains(pv, uv)) {
    return { matched: true, score: 0.85, reason: `fuzzy match: "${uv}" in ${target}` };
  }

  return { matched: false, score: 0, reason: `no match: "${uv}" not in ${target}` };
}

function evaluateRange(
  value: any,
  signals: ProductSignals,
): { matched: boolean; score: number; reason: string } {
  const min = value?.min ?? 0;
  const max = value?.max ?? Infinity;
  const price = signals.price;

  if (price <= 0) {
    return { matched: true, score: 0.3, reason: "no price data, passing" };
  }

  if (price >= min && price <= max) {
    // Score higher for prices in the middle of the range
    const range = max === Infinity ? price * 2 : max - min;
    const mid = min + range / 2;
    const dist = Math.abs(price - mid) / (range / 2 || 1);
    const score = Math.max(0.5, 1 - dist * 0.3);
    return { matched: true, score, reason: `price ${price} in range [${min}, ${max === Infinity ? "∞" : max}]` };
  }

  // Slightly out of range: within 20% tolerance for soft preference
  const tolerance = (max === Infinity ? min : max) * 0.2;
  if (price >= min - tolerance && price <= (max === Infinity ? Infinity : max + tolerance)) {
    return { matched: false, score: 0.2, reason: `price ${price} near range [${min}, ${max === Infinity ? "∞" : max}]` };
  }

  return { matched: false, score: 0, reason: `price ${price} out of range [${min}, ${max === Infinity ? "∞" : max}]` };
}

function evaluateContains(
  userValue: any,
  productValue: string,
): { matched: boolean; score: number; reason: string } {
  const uv = String(userValue).toLowerCase().trim();
  if (!uv) return { matched: true, score: 0.5, reason: "empty user value" };

  // Split user value into tokens and check overlap
  const tokens = uv.split(/\s+/).filter(t => t.length > 1);
  if (tokens.length === 0) return { matched: true, score: 0.5, reason: "no tokens" };

  const pv = productValue.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (pv.includes(token) || fuzzyContains(pv, token)) {
      hits++;
    }
  }

  const overlap = hits / tokens.length;
  if (overlap >= 0.5) {
    return { matched: true, score: 0.5 + overlap * 0.5, reason: `contains ${hits}/${tokens.length} tokens` };
  }
  if (hits > 0) {
    return { matched: false, score: overlap * 0.4, reason: `partial match ${hits}/${tokens.length} tokens` };
  }

  return { matched: false, score: 0, reason: `no token overlap` };
}

function evaluateIn(
  userValue: any,
  productValue: string,
): { matched: boolean; score: number; reason: string } {
  // "in" constraint: userValue is a list of acceptable values
  const values: string[] = Array.isArray(userValue)
    ? userValue.map(v => String(v).toLowerCase().trim())
    : String(userValue).split(",").map(v => v.trim().toLowerCase());

  const pv = productValue.toLowerCase();

  for (const v of values) {
    if (v && (pv.includes(v) || fuzzyContains(pv, v))) {
      return { matched: true, score: 1.0, reason: `"${v}" found (in-list match)` };
    }
  }

  return { matched: false, score: 0, reason: `none of [${values.join(",")}] found` };
}

/* ===================================================================
 * 4) UNIVERSAL SCORING PIPELINE
 * =================================================================== */

/**
 * Run the full universal constraint pipeline:
 *   1. Extract constraints from user + widgetConfig
 *   2. Score each embedding-ranked candidate
 *   3. Hard-filter budget/age fails
 *   4. Apply mismatch penalty for color/type fails
 *   5. Sort by finalScore
 *   6. "Hard filter if enough" — remove color/type mismatches if enough matches
 *   7. Dedupe by base product
 *   8. Diversity pass
 *   9. Graceful fallback if too few results
 */
export function universalScoreAndRank(
  user: UserContext,
  embeddingRanked: { product: Product; score: number }[],
  widgetConfig?: FullWidgetConfig | null,
  configOverrides?: Partial<ConstraintEngineConfig>,
): {
  results: ScoredProduct[];
  constraints: Constraint[];
  debug: DebugReport;
  colorMatchCount: number;
  typeMatchCount: number;
  hasColorConstraint: boolean;
  hasTypeConstraint: boolean;
  userColorGroup: string | null;
  userTypeGroup: string | null;
} {
  const cfg = { ...DEFAULT_ENGINE_CONFIG, ...configOverrides };
  const constraints = extractConstraints(user, widgetConfig);
  const hasConstraints = constraints.some(c => c.fieldId !== "_query_relevance");

  // Detect if we have color/type constraints active
  const hasColorConstraint = constraints.some(c =>
    c.target === "_color_group" || c.fieldId === "color" || c.fieldId === "_implicit_color"
  );
  const hasTypeConstraint = constraints.some(c =>
    c.target === "_type_group" || c.fieldId === "clothing_type" || c.fieldId === "_implicit_type"
  );

  // Normalize weights to sum = 1
  let { wEmbed, wConstraint, wPop } = cfg;
  if (!hasConstraints) {
    wConstraint = 0;
    wEmbed += cfg.wConstraint;
  }
  const wSum = wEmbed + wConstraint + wPop;
  wEmbed /= wSum;
  wConstraint /= wSum;
  wPop /= wSum;

  // Normalize embedding scores to 0..1
  const embedScores = embeddingRanked.map(r => r.score);
  const maxEmbed = Math.max(...embedScores, 0.001);
  const minEmbed = Math.min(...embedScores, 0);
  const embedRange = maxEmbed - minEmbed || 1;
  const totalCandidates = embeddingRanked.length;

  // Score all candidates
  const scored: ScoredProduct[] = [];
  const hardFilteredProducts: { product: Product; reason: string }[] = [];

  // Counters for "hard filter if enough"
  let colorMatchCount = 0;
  let typeMatchCount = 0;

  for (let i = 0; i < embeddingRanked.length; i++) {
    const { product, score: rawEmbed } = embeddingRanked[i];
    const embedNorm = (rawEmbed - minEmbed) / embedRange;
    const popScore = 1 - (i / totalCandidates) * 0.7;

    const signals = extractProductSignals(product);
    const constraintResult = matchProductConstraints(product, signals, constraints);

    if (constraintResult.hardFiltered) {
      hardFilteredProducts.push({ product, reason: constraintResult.hardFilterReason });
      continue;
    }

    // Count color/type matches
    if (constraintResult.colorMatch) colorMatchCount++;
    if (constraintResult.typeMatch) typeMatchCount++;

    // Apply mismatch penalty for color/type fails
    // BUT: if the product has no color/type data at all, use a softer penalty
    // (let the LLM rerank handle the final decision)
    let mismatchMultiplier = 1.0;
    if (hasColorConstraint && !constraintResult.colorMatch) {
      if (constraintResult.colorUnknown) {
        // No color data → mild reduction, not a hard penalty
        mismatchMultiplier *= 0.7;
      } else {
        // Confirmed wrong color → heavy penalty
        mismatchMultiplier *= cfg.mismatchPenalty;
      }
    }
    if (hasTypeConstraint && !constraintResult.typeMatch) {
      if (constraintResult.typeUnknown) {
        mismatchMultiplier *= 0.7;
      } else {
        mismatchMultiplier *= cfg.mismatchPenalty;
      }
    }

    const baseFinalScore =
      wEmbed * embedNorm +
      wConstraint * constraintResult.constraintScore +
      wPop * popScore;

    const finalScore = baseFinalScore * mismatchMultiplier;

    scored.push({
      product,
      embeddingScore: embedNorm,
      constraintScore: constraintResult.constraintScore,
      popularityScore: popScore,
      finalScore,
      constraintDetail: constraintResult,
    });
  }

  // Sort by finalScore descending
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // === "HARD FILTER IF ENOUGH" ===
  // If enough products match the color/type constraint,
  // remove mismatches from the top results entirely.
  // BUT: keep products where color/type is unknown (no data to judge)
  let postFiltered = scored;
  if (hasColorConstraint && colorMatchCount >= cfg.hardFilterIfEnoughThreshold) {
    postFiltered = postFiltered.filter(s =>
      s.constraintDetail.colorMatch || s.constraintDetail.colorUnknown
    );
  }
  if (hasTypeConstraint && typeMatchCount >= cfg.hardFilterIfEnoughThreshold) {
    postFiltered = postFiltered.filter(s =>
      s.constraintDetail.typeMatch || s.constraintDetail.typeUnknown
    );
  }

  // If post-filtering removed too many, fall back to penalty-based ranking
  if (postFiltered.length < cfg.fallbackMinResults) {
    postFiltered = scored;
  }

  // Dedupe by base product
  let deduped = dedupeScored(postFiltered, cfg.maxPerBase);

  // Diversity pass: limit same sub-type
  // BUT: if user explicitly requested a type (e.g. "hoodie"), don't limit that type
  const userTypeGroup = hasTypeConstraint
    ? String(constraints.find(c => c.target === "_type_group")?.value ?? "").toLowerCase()
    : null;
  deduped = diversityPass(deduped, cfg.maxSameSubType, userTypeGroup);

  // Graceful fallback: if too few results after hard filtering,
  // relax must_have constraints and re-run with preferences only
  if (cfg.gracefulFallback && deduped.length < cfg.fallbackMinResults && hardFilteredProducts.length > 0) {
    const relaxedConstraints = constraints.map(c =>
      c.priority === "must_have" && c.fieldId !== "_budget" && c.fieldId !== "_age_restriction"
        ? { ...c, priority: "preference" as ConstraintPriority }
        : c
    );

    const rescored: ScoredProduct[] = [];
    for (const { product } of hardFilteredProducts) {
      const idx = embeddingRanked.findIndex(r => r.product === product);
      const rawEmbed = idx >= 0 ? embeddingRanked[idx].score : 0;
      const embedNorm = (rawEmbed - minEmbed) / embedRange;
      const popScore = idx >= 0 ? 1 - (idx / totalCandidates) * 0.7 : 0.3;

      const signals = extractProductSignals(product);
      const result = matchProductConstraints(product, signals, relaxedConstraints);

      if (result.hardFiltered) continue;

      const finalScore = wEmbed * embedNorm + wConstraint * result.constraintScore * 0.7 + wPop * popScore;

      rescored.push({
        product,
        embeddingScore: embedNorm,
        constraintScore: result.constraintScore * 0.7,
        popularityScore: popScore,
        finalScore,
        constraintDetail: result,
      });
    }

    rescored.sort((a, b) => b.finalScore - a.finalScore);
    const fallbackResults = dedupeScored(rescored, cfg.maxPerBase);

    const existingIds = new Set(deduped.map(r => String((r.product as any).product_id || r.product.name)));
    for (const fb of fallbackResults) {
      const pid = String((fb.product as any).product_id || fb.product.name);
      if (!existingIds.has(pid) && deduped.length < cfg.fallbackMinResults * 2) {
        deduped.push(fb);
        existingIds.add(pid);
      }
    }
  }

  // Build debug report
  const debug = buildDebugReport(user, constraints, deduped, hardFilteredProducts, cfg, colorMatchCount, typeMatchCount, hasColorConstraint, hasTypeConstraint);

  return {
    results: deduped,
    constraints,
    debug,
    colorMatchCount,
    typeMatchCount,
    hasColorConstraint,
    hasTypeConstraint,
    userColorGroup: hasColorConstraint ? (constraints.find(c => c.target === "_color_group")?.value ?? null) : null,
    userTypeGroup: hasTypeConstraint ? (constraints.find(c => c.target === "_type_group")?.value ?? null) : null,
  };
}

/* ===================================================================
 * 5) DEDUPE + DIVERSITY
 * =================================================================== */

function dedupeScored(scored: ScoredProduct[], maxPerBase: number): ScoredProduct[] {
  const counts = new Map<string, number>();
  const result: ScoredProduct[] = [];

  for (const item of scored) {
    const base = baseId(item.product);
    const current = counts.get(base) || 0;
    if (current < maxPerBase) {
      counts.set(base, current + 1);
      result.push(item);
    }
  }

  return result;
}

function diversityPass(scored: ScoredProduct[], maxSameSubType: number, exemptTypeGroup?: string | null): ScoredProduct[] {
  if (maxSameSubType <= 0) return scored;

  const typeCounts = new Map<string, number>();
  const result: ScoredProduct[] = [];

  for (const item of scored) {
    const signals = extractProductSignals(item.product);
    // Use category + productType as diversity key
    const diversityKey = [signals.category, signals.productType].filter(Boolean).join("|") || "_uncategorized";
    const current = typeCounts.get(diversityKey) || 0;

    // If user explicitly requested a type, exempt products that match it from diversity limits
    if (exemptTypeGroup) {
      const productType = extractProductTypeGroup(item.product);
      if (productType === exemptTypeGroup) {
        typeCounts.set(diversityKey, current + 1);
        result.push(item);
        continue;
      }
    }

    if (current < maxSameSubType) {
      typeCounts.set(diversityKey, current + 1);
      result.push(item);
    }
  }

  return result;
}

/* ===================================================================
 * 6) DEBUG / EXPLAINABILITY
 * =================================================================== */

export interface DebugReport {
  timestamp: string;
  userSummary: string;
  constraintsSummary: string[];
  totalCandidates: number;
  hardFiltered: number;
  afterConstraints: number;
  afterDedupe: number;
  colorMatchCount: number;
  typeMatchCount: number;
  hardFilterIfEnoughApplied: { color: boolean; type: boolean };
  topResults: {
    name: string;
    finalScore: number;
    embed: number;
    constraint: number;
    pop: number;
    colorMatch: boolean;
    typeMatch: boolean;
    details: string;
  }[];
  fallbackUsed: boolean;
}

function buildDebugReport(
  user: UserContext,
  constraints: Constraint[],
  results: ScoredProduct[],
  hardFilteredProducts: { product: Product; reason: string }[],
  cfg: ConstraintEngineConfig,
  colorMatchCount: number,
  typeMatchCount: number,
  hasColorConstraint: boolean,
  hasTypeConstraint: boolean,
): DebugReport {
  const userParts = [];
  if (user.free_text) userParts.push(`free_text="${user.free_text}"`);
  if (user.interests?.length) userParts.push(`interests=[${user.interests.join(", ")}]`);
  if (user.gender) userParts.push(`gender=${user.gender}`);
  if (user.budget_min) userParts.push(`budget_min=${user.budget_min}`);
  if (user.budget_max) userParts.push(`budget_max=${user.budget_max}`);
  if (user.age) userParts.push(`age=${user.age}`);

  return {
    timestamp: new Date().toISOString(),
    userSummary: userParts.join(" | ") || "no user data",
    constraintsSummary: constraints.map(c =>
      `[${c.priority}] ${c.fieldId} (${c.constraintType}): ${JSON.stringify(c.value).slice(0, 80)}`
    ),
    totalCandidates: results.length + hardFilteredProducts.length,
    hardFiltered: hardFilteredProducts.length,
    afterConstraints: results.length + hardFilteredProducts.length - hardFilteredProducts.length,
    afterDedupe: results.length,
    colorMatchCount,
    typeMatchCount,
    hardFilterIfEnoughApplied: {
      color: hasColorConstraint && colorMatchCount >= cfg.hardFilterIfEnoughThreshold,
      type: hasTypeConstraint && typeMatchCount >= cfg.hardFilterIfEnoughThreshold,
    },
    topResults: results.slice(0, 15).map(r => ({
      name: r.product.name,
      finalScore: Number(r.finalScore.toFixed(3)),
      embed: Number(r.embeddingScore.toFixed(3)),
      constraint: Number(r.constraintScore.toFixed(3)),
      pop: Number(r.popularityScore.toFixed(3)),
      colorMatch: r.constraintDetail.colorMatch,
      typeMatch: r.constraintDetail.typeMatch,
      details: r.constraintDetail.matches
        .map(m => `${m.fieldId}: ${m.matched ? "✓" : "✗"} (${m.score.toFixed(2)}) ${m.reason}`)
        .join(" | "),
    })),
    fallbackUsed: hardFilteredProducts.length > 0 && results.length < cfg.fallbackMinResults,
  };
}

/**
 * Log the debug report to server console (when DEBUG_CONSTRAINTS env is set).
 */
export function logConstraintDebug(siteKey: string, debug: DebugReport): void {
  if (!process.env.DEBUG_CONSTRAINTS && !process.env.DEBUG_ATTRIBUTES) return;

  console.log(`\n${"=".repeat(70)}`);
  console.log(`[universalConstraints:${siteKey}] ${debug.timestamp}`);
  console.log(`User: ${debug.userSummary}`);
  console.log(`Constraints (${debug.constraintsSummary.length}):`);
  for (const c of debug.constraintsSummary) {
    console.log(`  ${c}`);
  }
  console.log(`Pipeline: ${debug.totalCandidates} candidates → ${debug.hardFiltered} hard-filtered → ${debug.afterDedupe} after dedupe`);
  console.log(`Color matches: ${debug.colorMatchCount}, Type matches: ${debug.typeMatchCount}`);
  console.log(`Hard-filter-if-enough: color=${debug.hardFilterIfEnoughApplied.color}, type=${debug.hardFilterIfEnoughApplied.type}`);
  if (debug.fallbackUsed) console.log(`⚠ FALLBACK USED: too few results after hard filter`);
  console.log(`Top ${debug.topResults.length} results:`);
  for (let i = 0; i < debug.topResults.length; i++) {
    const r = debug.topResults[i];
    const colorIcon = r.colorMatch ? "🔵" : "⚫";
    const typeIcon = r.typeMatch ? "👕" : "❌";
    console.log(
      `  #${i + 1} ${colorIcon}${typeIcon} "${r.name}" final=${r.finalScore} (embed=${r.embed} constraint=${r.constraint} pop=${r.pop})`
    );
    console.log(`       ${r.details}`);
  }
  console.log("=".repeat(70) + "\n");
}
