// src/reco/ranker.ts
// HARD RULE DETERMINISTIC PRODUCT RANKER
// Fully rewritten for precise, stable, and transparent ranking.

import { Product } from "../models/Product";
import {
  detectStandardTypeFromText,
  StandardType,
} from "../ai/normalizeProductType";

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

export type CanonicalField =
  | "tipus"
  | "szin"
  | "marka"
  | "meret"
  | "anyag"
  | "nem"
  | "stilus"
  | "ar"
  | "mintazat"
  | "hossz"
  | string;

export type RankQuery = Record<string, unknown>;

type GroupKey = "FULL" | "A" | "B" | "C" | "D";

type ProductDebug = {
  productId: string;
  group: GroupKey;
  matchedFields: string[];
  score: number;
  originalIndex: number;
};

export type RankMeta = {
  hasExactMatch: boolean;
  groupsCount: Record<GroupKey, number>;
  debug?: ProductDebug[];
};

export type RankResult = {
  items: Product[];
  meta: RankMeta;
};

type RankedRow = {
  product: Product;
  originalIndex: number;
  group: GroupKey;
  matchedFields: string[];
  totalMatchCount: number;
  cMatchCount: number;
  cScore: number;
  priceForSort: number;
};

export type RankProductsOptions = {
  fullCatalog?: Product[];
  orderedFields?: string[];
  primaryFields?: ["tipus", "szin"] | string[];
  includeDebug?: boolean;
};

const PRIMARY_FIELDS: ["tipus", "szin"] = ["tipus", "szin"];

const ORDERED_FIELDS = [
  "marka",
  "meret",
  "anyag",
  "nem",
  "stilus",
  "ar",
  "mintazat",
  "hossz",
];

const CANONICAL_FIELD_ORDER = [
  "tipus",
  "szin",
  "marka",
  "meret",
  "anyag",
  "nem",
  "stilus",
  "ar",
  "mintazat",
  "hossz",
];

const FIELD_ALIASES: Record<string, string[]> = {
  tipus: ["tipus", "type", "product_type", "clothing_type", "category"],
  szin: ["szin", "color", "colour"],
  meret: ["meret", "size"],
  marka: ["marka", "brand", "vendor"],
  anyag: ["anyag", "material"],
  ar: ["ar", "price"],
  nem: ["nem", "gender"],
  stilus: ["stilus", "style"],
  mintazat: ["mintazat", "pattern"],
  hossz: ["hossz", "length"],
};

const VALUE_SYNONYM_MAP: Record<string, string> = {
  polo: "polo",
  poloing: "polo",
  "polo shirt": "polo",
  "polo-shirt": "polo",
  tshirt: "polo",
  "t-shirt": "polo",
  hoodie: "hoodie",
  "kapucnis pulover": "hoodie",
  "kapucnis pulcsi": "hoodie",
  "kapucnis felso": "hoodie",
  pulover: "pulover",
  pulcsi: "pulover",
  sweater: "pulover",
  cipo: "cipo",
  cipő: "cipo",
  sneaker: "cipo",
  sneakers: "cipo",
  shoes: "cipo",
  taska: "taska",
  táska: "taska",
  bag: "taska",
  bags: "taska",
  backpack: "taska",
  hatizsak: "taska",
  hátizsák: "taska",
  navy: "sotetkek",
  "sotet kek": "sotetkek",
  sotetkek: "sotetkek",
};

// Helper: Extract all known colors from a text string by scanning for color keywords
function extractColorsFromText(text: string): string[] {
  if (!text) return [];
  const normalized = normalizeText(text);
  const found: string[] = [];

  // Check for multi-word colors first (e.g., "jet black", "hot pink")
  for (const colorKey of Object.keys(COLOR_CANONICAL_MAP)) {
    if (colorKey.includes(" ") && normalized.includes(colorKey)) {
      const canonical = COLOR_CANONICAL_MAP[colorKey];
      if (canonical && !found.includes(canonical)) {
        found.push(canonical);
      }
    }
  }

  // Then check single-word colors (split by non-letters)
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const word of words) {
    const canonical = COLOR_CANONICAL_MAP[word];
    if (canonical && !found.includes(canonical)) {
      found.push(canonical);
    }
  }

  return found;
}

const COLOR_CANONICAL_MAP: Record<string, string> = {
  // Blue variants
  kek: "kek",
  blue: "kek",
  sotetkek: "sotetkek",
  navy: "sotetkek",
  "dark blue": "sotetkek",
  "navy blue": "sotetkek",
  "sky blue": "kek",
  "royal blue": "kek",
  
  // Red variants
  piros: "piros",
  red: "piros",
  "cherry red": "piros",
  
  // Black variants
  fekete: "fekete",
  black: "fekete",
  "jet black": "fekete",
  "deep black": "fekete",
  "washed black": "fekete",
  
  // White variants
  feher: "feher",
  white: "feher",
  "off white": "feher",
  "offwhite": "feher",
  
  // Grey variants  
  szurke: "szurke",
  grey: "szurke",
  gray: "szurke",
  "light grey": "szurke",
  "dark grey": "szurke",
  charcoal: "szurke",
  "london grey": "szurke",
  "washed grey": "szurke",
  
  // Green variants
  zold: "zold",
  green: "zold",
  olive: "zold",
  "forest green": "zold",
  "dollar green": "zold",
  
  // Brown/tan variants
  barna: "barna",
  brown: "barna",
  tan: "barna",
  khaki: "barna",
  sand: "barna",
  mocha: "barna",
  
  // Yellow
  sarga: "sarga",
  yellow: "sarga",
  gold: "sarga",
  
  // Orange
  narancs: "narancs",
  orange: "narancs",
  
  // Purple
  lila: "lila",
  purple: "lila",
  violet: "lila",
  
  // Pink variants
  rozsaszin: "rozsaszin",
  pink: "rozsaszin",
  "hot pink": "rozsaszin",
  
  // Wine/burgundy
  bordo: "bordo",
  burgundy: "bordo",
  maroon: "bordo",
  wine: "bordo",
  
  // Beige/cream
  bezs: "bezs",
  beige: "bezs",
  cream: "bezs",
  
  // Turquoise/teal
  turkiz: "turkiz",
  turquoise: "turkiz",
  teal: "turkiz",
  cyan: "turkiz",
  aqua: "turkiz",
};

const TYPE_CANONICAL_MAP: Record<string, string> = {
  // T-shirts / Polos
  polo: "polo",
  "polo shirt": "polo",
  tshirt: "polo",
  "t-shirt": "polo",
  tee: "polo",
  "tee shirt": "polo",
  
  // Hoodies / Pullovers / Sweaters - all map to "hoodie" for catalog compatibility
  hoodie: "hoodie",
  "kapucnis pulover": "hoodie",
  "kapucnis pulcsi": "hoodie",
  pulover: "hoodie",
  pulcsi: "hoodie",
  sweater: "hoodie",
  crewneck: "hoodie",
  sweatshirt: "hoodie",
  zipup: "hoodie",
  "zip up": "hoodie",
  // Shoes - including plural forms and accented variants
  cipo: "cipo",
  cipő: "cipo",
  sneaker: "cipo",
  sneakers: "cipo",
  shoes: "cipo",
  shoe: "cipo",
  // Bags - including plural forms and accented/Hungarian variants
  taska: "taska",
  táska: "taska",
  bag: "taska",
  bags: "taska",
  backpack: "taska",
  hatizsak: "taska",
  hátizsák: "taska",
  nadrag: "nadrag",
  pants: "nadrag",
  farmer: "farmer",
  jeans: "farmer",
  kabat: "kabat",
  jacket: "kabat",
  dzseki: "kabat",
  szoknya: "szoknya",
  skirt: "szoknya",
  ruha: "ruha",
  dress: "ruha",
  ing: "ing",
  shirt: "ing",
  zokni: "zokni",
  socks: "zokni",
  melegito: "melegito",
  tracksuit: "melegito",
  sapka: "sapka",
  hat: "sapka",
  cap: "sapka",
  beanie: "sapka",
  beanies: "sapka",
  "hats": "sapka",
  // Fürdőruha/swimwear
  furdoruha: "furdoruha",
  "swim": "furdoruha",
  "swim bra": "furdoruha",
  "swim panties": "furdoruha",
  bikini: "furdoruha",
  swimsuit: "furdoruha",
  swimwear: "furdoruha",
  trikini: "furdoruha",
};

// Mapping from StandardType (normalizeProductType) to catalog types
const STANDARD_TYPE_TO_CATALOG: Record<StandardType, string | null> = {
  "Mindegy": null,
  "Póló": "polo",
  "Pulóver": "hoodie", // catalog groups sweaters with hoodies
  "Hoodie": "hoodie",
  "Kabát": "kabat",
  "Dzseki": "kabat", // catalog uses kabat for both
  "Nadrág": "nadrag",
  "Farmer": "farmer",
  "Rövidnadrág": "nadrag", // catalog has no separate shorts
  "Cipő": "cipo",
  "Kiegészítő": null, // too broad, don't filter
  "Táska": "taska",
  "Ékszer": null, // not in typical catalog
  "Fürdőruha": "furdoruha",
  "Sapka": "sapka",
};

// ============================================================================
// NORMALIZATION & TOKENIZATION
// ============================================================================

/**
 * Normalizes text: trim, lowercase, remove accents, collapse whitespace.
 * This ensures consistent comparison across all fields.
 */
function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = typeof value === 'string' ? value : String(value);
  return str
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * Tokenizes multi-value fields: splits by /, , ; &gt; and normalizes each part.
 * Also handles arrays. The &gt; is for Shopify-style categories like "Apparel > Hats > Beanies"
 */
function tokenizeListValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => tokenizeListValue(entry));
  }

  const normalized = normalizeText(value);
  if (!normalized) return [];

  return normalized
    .split(/[/,;>]+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

/**
 * Maps field name to canonical form using aliases.
 */
function canonicalizeField(fieldName: string): CanonicalField {
  const key = normalizeText(fieldName);
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    if (canonical === key) return canonical;
    if (aliases.includes(key)) return canonical;
  }
  return key;
}

/**
 * Applies synonym mapping and field-specific canonicalization.
 */
function canonicalizeValue(rawValue: string, field: CanonicalField): string {
  const v = normalizeText(rawValue);
  if (!v) return "";

  // Apply generic synonyms first
  const withSynonym = VALUE_SYNONYM_MAP[v] || v;

  // Then apply field-specific canonicalization
  if (field === "szin") {
    return COLOR_CANONICAL_MAP[withSynonym] || withSynonym;
  }

  if (field === "tipus") {
    return TYPE_CANONICAL_MAP[withSynonym] || withSynonym;
  }

  return withSynonym;
}

function toNumberSafe(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getProductId(product: Product): string {
  const id = (product as any)?.id ?? product.product_id;
  return String(id || "").trim() || String(product.name || "").trim();
}

// ============================================================================
// DEDUPLICATION
// ============================================================================

/**
 * Extracts a size-agnostic key for deduplication.
 * Removes size suffixes (XS, S, M, L, XL, XXL, etc.) from product name.
 */
function getDedupeKey(product: Product): string {
  const name = String(product.name || "").trim();
  // Remove size patterns at the end of name (case-insensitive)
  const sizePattern = /\s+(X{0,2}S|X{0,3}L|XXL|XXXL|[0-9]+)$/i;
  const baseName = name.replace(sizePattern, "").trim();
  return baseName.toLowerCase() || getProductId(product).toLowerCase();
}

/**
 * Removes duplicate products by base name (size-agnostic), keeping the first occurrence.
 */
function dedupeProductsById(products: Product[]): Product[] {
  const out: Product[] = [];
  const seen = new Set<string>();
  for (const product of products) {
    const key = getDedupeKey(product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(product);
  }
  return out;
}

// ============================================================================
// QUERY NORMALIZATION
// ============================================================================

/**
 * Normalizes the query: canonicalizes field names and values,
 * handles multi-value fields, applies synonyms.
 */
function normalizeQuery(query: RankQuery): Map<CanonicalField, string[]> {
  const normalized = new Map<CanonicalField, string[]>();

  for (const [fieldName, rawValue] of Object.entries(query || {})) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;

    const canonicalField = canonicalizeField(fieldName);
    const pieces = tokenizeListValue(rawValue)
      .map((v) => canonicalizeValue(v, canonicalField))
      .filter(Boolean);

    if (pieces.length === 0) continue;

    if (!normalized.has(canonicalField)) normalized.set(canonicalField, []);
    const current = normalized.get(canonicalField)!;
    for (const piece of pieces) {
      if (!current.includes(piece)) current.push(piece);
    }
  }

  return normalized;
}

// ============================================================================
// PRODUCT FIELD EXTRACTION
// ============================================================================

/**
 * Extracts and normalizes all values for a given canonical field from a product.
 * Handles field aliases, multi-value fields, and field-specific extraction logic.
 */
function getFieldValuesFromProduct(product: Product, canonicalField: CanonicalField): string[] {
  const aliasFields = FIELD_ALIASES[canonicalField] || [canonicalField];
  const collected: string[] = [];

  // Extract from aliased fields
  for (const sourceField of aliasFields) {
    const raw = (product as any)[sourceField];
    const parts = tokenizeListValue(raw).map((v) => canonicalizeValue(v, canonicalField));
    collected.push(...parts);
  }

  // Special logic for "szin" (color): extract from tags, name, and CW codes
  // NOTE: We deliberately do NOT extract color from full description as it's too noisy
  // (e.g., "black stitching" in a red product's description)
  if (canonicalField === "szin") {
    const fromTags = tokenizeListValue((product as any).tags).map((v) => canonicalizeValue(v, "szin"));
    collected.push(...fromTags);

    // Extract color from product name (handles multi-word colors like "Jet Black")
    const fromName = extractColorsFromText((product as any).name);
    collected.push(...fromName);

    // Extract "CW: color name" patterns from description (explicit color designation)
    const cwRegex = /cw\s*[:\-]\s*([^.;\n]{2,50})/i;
    const cwMatch = cwRegex.exec(String((product as any).description || ""));
    if (cwMatch?.[1]) {
      const fromCw = extractColorsFromText(cwMatch[1]);
      collected.push(...fromCw);
    }
  }

  // Special logic for "tipus" (type): extract from name FIRST, then category as fallback
  // Name-based type takes priority because catalog categories are often wrong for small brands
  if (canonicalField === "tipus") {
    // STEP 1: Extract type from product name (most reliable for products like "Beanie Grey", "Baseball Cap")
    const nameWords = normalizeText((product as any).name).split(/\s+/);
    const nameBasedTypes: string[] = [];
    for (const word of nameWords) {
      const canonical = TYPE_CANONICAL_MAP[word];
      if (canonical && !nameBasedTypes.includes(canonical)) {
        nameBasedTypes.push(canonical);
      }
    }
    
    // STEP 2: Check if name gives us a SPECIFIC type (not generic like "shirt")
    // If name clearly says "Beanie", "Cap", "Hoodie", trust that over category
    const specificNameTypes = nameBasedTypes.filter(t => 
      t === "sapka" || // beanie, cap, hat
      t === "cipo" ||  // shoes, sneaker
      t === "taska" || // bag
      t === "nadrag" || // pants
      t === "kabat" || // jacket
      t === "hoodie" || // hoodie, crewneck, sweatshirt
      t === "melegito"  // tracksuit
    );
    
    // If we have a specific type from name, use ONLY that (CLEAR collected first!)
    if (specificNameTypes.length > 0) {
      collected.length = 0; // Clear category-based types
      collected.push(...specificNameTypes);
    } else {
      // Fallback: collected already has category types, add any name-based types
      collected.push(...nameBasedTypes);
    }

    const fromTags = tokenizeListValue((product as any).tags).map((v) => canonicalizeValue(v, "tipus"));
    collected.push(...fromTags);
  }

  return [...new Set(collected.filter(Boolean))];
}

/**
 * Checks if a product matches the query for a specific field.
 * For numeric fields (ar), exact equality is required.
 * For other fields, any overlap between query values and product values counts as a match.
 */
function isFieldMatched(product: Product, field: CanonicalField, queryValues: string[]): boolean {
  if (queryValues.length === 0) return false;

  // Special logic for price (ar): exact numeric match
  if (field === "ar") {
    const productPrice = toNumberSafe((product as any).price ?? (product as any).ar);
    if (productPrice === null) return false;
    return queryValues.some((qv) => {
      const qn = toNumberSafe(qv);
      return qn !== null && qn === productPrice;
    });
  }

  const productValues = getFieldValuesFromProduct(product, field);
  if (productValues.length === 0) return false;

  // Any overlap counts as a match
  return queryValues.some((qv) => productValues.includes(qv));
}

// ============================================================================
// DETERMINISTIC FIELD ORDERING
// ============================================================================

/**
 * Returns non-primary fields in deterministic order:
 * 1. Fields in ORDERED_FIELDS order
 * 2. Remaining fields alphabetically
 */
function getDeterministicOtherFields(queryFields: CanonicalField[], orderedFields: string[]): CanonicalField[] {
  const primary = new Set<string>(PRIMARY_FIELDS);
  const orderedCanonical = orderedFields.map((f) => canonicalizeField(f));
  const queryOther = queryFields.filter((f) => !primary.has(f));
  const inOrder = orderedCanonical.filter((f) => queryOther.includes(f));
  const leftover = queryOther.filter((f) => !inOrder.includes(f)).sort((a, b) => a.localeCompare(b));
  return [...inOrder, ...leftover];
}

// ============================================================================
// SCORING & GROUPING
// ============================================================================

/**
 * Returns group weight for sorting (higher = better).
 */
function rankGroupWeight(group: GroupKey): number {
  if (group === "FULL") return 5;
  if (group === "A") return 4;
  if (group === "B") return 3;
  if (group === "C") return 2;
  if (group === "D") return 1;
  return 0;
}

/**
 * Returns price for sorting (missing/invalid prices sort to end).
 */
function getPriceForSort(product: Product): number {
  const n = toNumberSafe((product as any).price ?? (product as any).ar);
  return n ?? Number.POSITIVE_INFINITY;
}

/**
 * Scores C-group matches: count + small boost for field priority.
 */
function scoreOtherFieldMatches(matchedOtherFields: CanonicalField[], orderedOtherFields: CanonicalField[]): number {
  if (matchedOtherFields.length === 0) return 0;
  let score = matchedOtherFields.length;
  for (const field of matchedOtherFields) {
    const index = orderedOtherFields.indexOf(field);
    if (index >= 0) {
      const boost = (orderedOtherFields.length - index) / Math.max(orderedOtherFields.length, 1);
      score += boost * 0.01;
    }
  }
  return score;
}

/**
 * Computes ranking rows for all products.
 * Each row contains group, matched fields, scores, and original index for stable sorting.
 */
function computeRows(
  products: Product[],
  normalizedQuery: Map<CanonicalField, string[]>,
  orderedFields: string[]
): RankedRow[] {
  const queryFields = [...normalizedQuery.keys()];
  const otherFields = getDeterministicOtherFields(queryFields, orderedFields);

  return products.map((product, idx) => {
    const matchedFields: CanonicalField[] = [];

    // Check each query field
    for (const field of queryFields) {
      const queryValues = normalizedQuery.get(field) || [];
      if (isFieldMatched(product, field, queryValues)) {
        matchedFields.push(field);
      }
    }

    const uniqueMatched = [...new Set(matchedFields)];
    const fullMatch = queryFields.length > 0 && queryFields.every((field) => uniqueMatched.includes(field));

    const typeMatch = uniqueMatched.includes("tipus");
    const colorMatch = uniqueMatched.includes("szin");

    const matchedOtherFields = uniqueMatched.filter((f) => f !== "tipus" && f !== "szin");
    const cMatchCount = matchedOtherFields.length;
    const cScore = scoreOtherFieldMatches(matchedOtherFields, otherFields);

    // Determine group according to hard rules
    let group: GroupKey = "D";
    if (fullMatch) {
      group = "FULL";
    } else if (typeMatch) {
      group = "A";
    } else if (colorMatch) {
      group = "B";
    } else if (cMatchCount > 0) {
      group = "C";
    }

    return {
      product,
      originalIndex: idx,
      group,
      matchedFields: uniqueMatched,
      totalMatchCount: uniqueMatched.length,
      cMatchCount,
      cScore,
      priceForSort: getPriceForSort(product),
    };
  });
}

/**
 * Compares two ranked rows for stable, deterministic sorting.
 * Group > MatchCount > CScore > OriginalIndex
 */
function compareRows(a: RankedRow, b: RankedRow): number {
  // Primary: group
  const gdiff = rankGroupWeight(b.group) - rankGroupWeight(a.group);
  if (gdiff !== 0) return gdiff;

  // Group D: stable by original index only
  if (a.group === "D" && b.group === "D") {
    return a.originalIndex - b.originalIndex;
  }

  // Secondary: total match count
  const totalDiff = b.totalMatchCount - a.totalMatchCount;
  if (totalDiff !== 0) return totalDiff;

  // Tertiary: C-group score
  const cDiff = b.cScore - a.cScore;
  if (Math.abs(cDiff) > 1e-9) return cDiff;

  // Final: stable by original index
  return a.originalIndex - b.originalIndex;
}

// ============================================================================
// MAIN RANKING FUNCTION
// ============================================================================

/**
 * Main ranking function implementing the hard rule logic:
 * 1. Full match takes precedence: if any products match ALL query fields,
 *    ONLY return those, sorted by price (stable).
 * 2. If no full match, return all products grouped by:
 *    A) Type match
 *    B) Color match (but not type)
 *    C) Other field matches
 *    D) No matches
 * 3. Within each group, sort by match count, then score, then original index.
 * 4. If fullCatalog is provided, scan it for full matches even if not in the input list.
 */
export function rankProducts(
  query: RankQuery,
  products: Product[],
  options?: RankProductsOptions
): RankResult {
  const primaryFields = (options?.primaryFields || PRIMARY_FIELDS).map((f) => canonicalizeField(f));
  const orderedFields = options?.orderedFields || ORDERED_FIELDS;

  const normalizedQuery = normalizeQuery(query);

  // If query is empty, return all products in original order with no filtering
  if (normalizedQuery.size === 0) {
    const dedupedInput = dedupeProductsById(products || []);
    return {
      items: dedupedInput,
      meta: {
        hasExactMatch: false,
        groupsCount: { FULL: 0, A: 0, B: 0, C: 0, D: dedupedInput.length },
      },
    };
  }

  const dedupedInput = dedupeProductsById(products || []);
  const rows = computeRows(dedupedInput, normalizedQuery, orderedFields);
  let fullRows = rows.filter((r) => r.group === "FULL");

  console.log(`[ranker:rankProducts] Initial fullRows from shortlist: ${fullRows.length}, shortlist size: ${dedupedInput.length}, catalogLen: ${options?.fullCatalog?.length || 0}`);

  // CRITICAL: ALWAYS scan full catalog to ensure ALL matching products are found
  // This fixes issues where not all shoes/shirts/etc appear in results
  if (options?.fullCatalog && options.fullCatalog.length > 0) {
    console.log(`[ranker:rankProducts] Scanning full catalog for ALL matches...`);
    const dedupedCatalog = dedupeProductsById(options.fullCatalog);
    const catalogRows = computeRows(dedupedCatalog, normalizedQuery, orderedFields);
    
    // Get all FULL matches from catalog, deduplicate with existing (size-agnostic)
    const existingKeys = new Set(fullRows.map((r) => getDedupeKey(r.product)));
    const catalogFullRows = catalogRows.filter((r) => r.group === "FULL");
    console.log(`[ranker:rankProducts] catalogFullRows: ${catalogFullRows.length}`);
    for (const row of catalogFullRows) {
      const key = getDedupeKey(row.product);
      if (!existingKeys.has(key)) {
        fullRows.push(row);
        existingKeys.add(key);
      }
    }
    console.log(`[ranker:rankProducts] After catalog scan, fullRows: ${fullRows.length}`);
  }

  const hasExactMatch = fullRows.length > 0;

  // Count groups from shortlist (for meta - but report catalog full count if we scanned)
  const groupsCount: Record<GroupKey, number> = {
    FULL: fullRows.length,
    A: rows.filter((r) => r.group === "A").length,
    B: rows.filter((r) => r.group === "B").length,
    C: rows.filter((r) => r.group === "C").length,
    D: rows.filter((r) => r.group === "D").length,
  };

  // If full match exists, return FULL matches first, then A/B/C for "also_items"
  // This ensures main results contain ONLY exact matches, while partial matches
  // automatically go to "also_items" section via recommend.ts slice
  if (hasExactMatch) {
    const fullSorted = [...fullRows]
      .sort((a, b) => {
        const pdiff = a.priceForSort - b.priceForSort;
        if (pdiff !== 0) return pdiff;
        return a.originalIndex - b.originalIndex;
      });

    // Get A/B/C groups - ALWAYS scan full catalog to ensure complete also_items
    let aRows = rows.filter((r) => r.group === "A");
    let bRows = rows.filter((r) => r.group === "B");
    let cRows = rows.filter((r) => r.group === "C");
    
    // ALWAYS scan catalog for A/B/C matches to populate also_items completely
    // This fixes issues like "táska" having no also_items
    if (options?.fullCatalog && options.fullCatalog.length > 0) {
      console.log(`[ranker] Scanning catalog for more A/B/C matches (current: A=${aRows.length}, B=${bRows.length}, C=${cRows.length})`);
      const dedupedCatalog = dedupeProductsById(options.fullCatalog);
      const catalogRows = computeRows(dedupedCatalog, normalizedQuery, orderedFields);
      
      // Merge catalog A/B/C with shortlist A/B/C (deduplicate)
      const existingKeys = new Set([
        ...fullRows.map((r) => getDedupeKey(r.product)),
        ...aRows.map((r) => getDedupeKey(r.product)),
        ...bRows.map((r) => getDedupeKey(r.product)),
        ...cRows.map((r) => getDedupeKey(r.product)),
      ]);
      
      for (const row of catalogRows) {
        const key = getDedupeKey(row.product);
        if (!existingKeys.has(key)) {
          if (row.group === "A") aRows.push(row);
          else if (row.group === "B") bRows.push(row);
          else if (row.group === "C") cRows.push(row);
          existingKeys.add(key);
        }
      }
      console.log(`[ranker] After catalog scan: A=${aRows.length}, B=${bRows.length}, C=${cRows.length}`);
    }
    
    // Sort each group by price
    const aSorted = aRows.sort((a, b) => {
      const pdiff = a.priceForSort - b.priceForSort;
      if (pdiff !== 0) return pdiff;
      return a.originalIndex - b.originalIndex;
    });
    const bSorted = bRows.sort((a, b) => {
      const pdiff = a.priceForSort - b.priceForSort;
      if (pdiff !== 0) return pdiff;
      return a.originalIndex - b.originalIndex;
    });
    const cSorted = cRows.sort((a, b) => {
      const pdiff = a.priceForSort - b.priceForSort;
      if (pdiff !== 0) return pdiff;
      return a.originalIndex - b.originalIndex;
    });

    // Combine: FULL first, then A, B, C (this way slice(0,12) = FULL only)
    const allItems = [
      ...fullSorted.map((r) => r.product),
      ...aSorted.map((r) => r.product),
      ...bSorted.map((r) => r.product),
      ...cSorted.map((r) => r.product),
    ];
    
    console.log(`[ranker] Returning: ${fullSorted.length} FULL, ${aSorted.length} A, ${bSorted.length} B, ${cSorted.length} C`);

    return {
      items: allItems,
      meta: {
        hasExactMatch: true,
        groupsCount: {
          FULL: fullRows.length,
          A: groupsCount.A,
          B: groupsCount.B,
          C: 0,
          D: 0,
        },
        debug: options?.includeDebug
          ? fullSorted.map((r) => ({
              productId: getProductId(r.product),
              group: r.group,
              matchedFields: r.matchedFields,
              score: r.cScore,
              originalIndex: r.originalIndex,
            }))
          : undefined,
      },
    };
  }

  // No full match: return all products sorted by group/score
  const sortedRows = [...rows].sort(compareRows);

  return {
    items: sortedRows.map((row) => row.product),
    meta: {
      hasExactMatch: false,
      groupsCount,
      debug: options?.includeDebug
        ? sortedRows.map((r) => ({
            productId: getProductId(r.product),
            group: r.group,
            matchedFields: r.matchedFields,
            score: r.cScore,
            originalIndex: r.originalIndex,
          }))
        : undefined,
    },
  };
}

// ============================================================================
// PRODUCT BLURB (DESCRIPTION) FORMATTING
// ============================================================================

/**
 * Truncates human-readable text intelligently.
 */
function truncateHumanText(input: string, maxLen: number): string {
  const clean = normalizeText(input).replaceAll(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxLen * 0.6)) {
    return cut.slice(0, lastSpace).trim() + "…";
  }
  return cut.trim() + "…";
}

/**
 * Converts normalized text to Title Case.
 */
function toTitleCase(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Formats a clean, customer-friendly product description.
 * RULES:
 * - Short Hungarian description
 * - NO price
 * - Color + type info
 */
export function formatProductBlurb(product: Product): string {
  const name = String((product as any).name || "").trim();
  
  // Extract color from name or color field
  let color = "";
  const colorField = String((product as any).color || (product as any).szin || "").trim();
  if (colorField && colorField.toLowerCase() !== "unknown") {
    color = toTitleCase(colorField);
  } else {
    // Try to extract color from name
    const nameNorm = normalizeText(name);
    for (const [colorKey, canonical] of Object.entries(COLOR_CANONICAL_MAP)) {
      if (nameNorm.includes(colorKey)) {
        color = toTitleCase(canonical);
        break;
      }
    }
  }

  // Get type from category/product_type
  const typeRaw = String(
    (product as any).product_type || (product as any).type || (product as any).tipus || ""
  ).trim();
  
  // Map type to Hungarian
  const TYPE_HU: Record<string, string> = {
    hoodie: "Kapucnis pulóver",
    polo: "Póló",
    tee: "Póló",
    "t-shirt": "Póló",
    beanie: "Sapka",
    cap: "Sapka",
    hat: "Sapka",
    pants: "Nadrág",
    jeans: "Farmer",
    jacket: "Dzseki",
    coat: "Kabát",
    shorts: "Rövidnadrág",
    sweater: "Pulóver",
    crewneck: "Pulóver",
    bag: "Táska",
    backpack: "Hátizsák",
  };
  
  const typeNorm = normalizeText(typeRaw);
  let typeHu = TYPE_HU[typeNorm] || "";
  
  // If no type from field, try to detect from name
  if (!typeHu) {
    const nameNorm = normalizeText(name);
    if (nameNorm.includes("hoodie")) typeHu = "Kapucnis pulóver";
    else if (nameNorm.includes("beanie")) typeHu = "Sapka";
    else if (nameNorm.includes("cap") || nameNorm.includes("hat")) typeHu = "Sapka";
    else if (nameNorm.includes("tee") || nameNorm.includes("polo") || nameNorm.includes("shirt")) typeHu = "Póló";
    else if (nameNorm.includes("crewneck") || nameNorm.includes("sweater")) typeHu = "Pulóver";
    else if (nameNorm.includes("pants") || nameNorm.includes("jeans")) typeHu = "Nadrág";
    else if (nameNorm.includes("jacket")) typeHu = "Dzseki";
    else if (nameNorm.includes("bag") || nameNorm.includes("backpack")) typeHu = "Táska";
  }

  // Build description
  const parts: string[] = [];
  
  if (color) parts.push(color.toLowerCase());
  if (typeHu) parts.push(typeHu.toLowerCase());

  if (parts.length > 0) {
    // Capitalize first letter
    const desc = parts.join(" ");
    return desc.charAt(0).toUpperCase() + desc.slice(1);
  }

  // Fallback: use simplified name
  return name.length > 50 ? name.slice(0, 47) + "..." : name;
}

// ============================================================================
// MESSAGE GENERATION
// ============================================================================

type MessageOptions = {
  locale?: "hu" | "en";
};

/**
 * Builds a user-friendly "no exact match" message.
 * IMPORTANT: This should ONLY be shown when hasExactMatch=false.
 */
export function buildNoExactMessage(query: RankQuery, options?: MessageOptions): string {
  const locale = options?.locale || "hu";
  const normalized = normalizeQuery(query);
  const fields = [...normalized.keys()];
  const sortedFields = [...fields].sort((a, b) => {
    const ai = CANONICAL_FIELD_ORDER.indexOf(a);
    const bi = CANONICAL_FIELD_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  const by = sortedFields
    .slice(0, 3)
    .join("/");

  if (locale === "en") {
    const suffix = by ? ` based on ${by}` : "";
    return `I couldn't find an exact match, but here are the closest results${suffix}.`;
  }

  const suffix = by ? ` a(z) ${by} alapján` : ".";
  if (!by) {
    return "Pontos egyezést nem találtam, de ezek a legközelebbi találatok.";
  }
  return `Pontos egyezést nem találtam, de ezek a legközelebbi találatok${suffix}.`;
}

// ============================================================================
// QUERY BUILDING FROM USER INPUT
// ============================================================================

/**
 * Builds a structured query from user input.
 * Infers type and color from free text if not explicitly provided.
 */
export function buildQueryFromUserInput(input: Record<string, any>): RankQuery {
  const source = input || {};
  const query: RankQuery = {};

  // Values that should be ignored as non-meaningful
  const IGNORABLE_VALUES = new Set(["unknown", "other", "none", "null", "undefined", ""]);

  // Map canonical fields
  for (const [key, value] of Object.entries(source)) {
    const canonical = canonicalizeField(key);
    if (!canonical) continue;
    if (value === undefined || value === null || value === "") continue;
    
    // Skip non-meaningful values (e.g., gender: "unknown")
    const strValue = typeof value === "string" ? normalizeText(value) : "";
    if (IGNORABLE_VALUES.has(strValue)) continue;

    if (FIELD_ALIASES[canonical] || CANONICAL_FIELD_ORDER.includes(canonical)) {
      query[canonical] = value;
    }
  }

  // Infer type and color from free text and interests
  const freeText = [source.free_text || "", ...(Array.isArray(source.interests) ? source.interests : [])]
    .map((v) => normalizeText(v))
    .join(" ")
    .trim();

  if (freeText) {
    const tokens = freeText.split(/\s+/).filter(Boolean);
    
    // Use robust type detection from normalizeProductType module
    if (!query.tipus) {
      const typeResult = detectStandardTypeFromText(freeText);
      if (typeResult.type !== "Mindegy" && typeResult.confidence >= 0.35) {
        const catalogType = STANDARD_TYPE_TO_CATALOG[typeResult.type];
        if (catalogType) {
          query.tipus = catalogType;
        }
      } else {
        // Fallback to legacy token-based detection
        const inferredType = tokens.find((t) => TYPE_CANONICAL_MAP[t] || VALUE_SYNONYM_MAP[t]);
        if (inferredType) {
          query.tipus = TYPE_CANONICAL_MAP[inferredType] || VALUE_SYNONYM_MAP[inferredType] || inferredType;
        }
      }
    }
    
    // Color detection remains token-based (works well)
    const inferredColor = tokens.find((t) => COLOR_CANONICAL_MAP[t]);
    if (!query.szin && inferredColor) {
      query.szin = COLOR_CANONICAL_MAP[inferredColor] || inferredColor;
    }
  }

  // Backward compatibility: clothing_type fallback
  if (!query.tipus && source.clothing_type) {
    query.tipus = source.clothing_type;
  }

  return query;
}
