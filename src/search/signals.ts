// src/search/signals.ts
// Query parsing: extract type, colors, materials, and tokens

import { detectColors, StandardColor } from "./colors";
import { detectMaterials, StandardMaterial } from "./materials";

/**
 * Extracted signals from a user query.
 */
export interface QuerySignals {
  type: string | null; // detected product type (e.g., "pulóver", "nadrág")
  colors: Set<StandardColor>; // detected colors
  materials: Set<StandardMaterial>; // detected materials
  tokens: string[]; // remaining search tokens
  genders: Set<"férfi" | "női" | "unisex">; // detected gender
  size: string | null; // detected size
  budget: { min?: number; max?: number } | null; // extracted price range
  intent: "gift" | "self" | "occasion" | null; // detected intent
  rawQuery: string; // original query
}

// Product type synonyms (HU/EN) → canonical type
const TYPE_SYNONYMS: Record<string, string> = {
  // Tops
  "póló": "póló",
  polo: "póló",
  tshirt: "póló",
  "t-shirt": "póló",
  tee: "póló",
  shirt: "ing",
  ing: "ing",
  blúz: "blúz",
  bluz: "blúz",
  blouse: "blúz",
  top: "top",
  felső: "felső",
  felso: "felső",
  
  // Sweaters
  "pulóver": "pulóver",
  pulover: "pulóver",
  pulcsi: "pulóver",
  sweater: "pulóver",
  jumper: "pulóver",
  knit: "pulóver",
  kötött: "pulóver",
  
  // Hoodies
  kapucnis: "kapucnis pulóver",
  hoodie: "kapucnis pulóver",
  kapucnispulóver: "kapucnis pulóver",
  kapucnispulcsi: "kapucnis pulóver",
  "kapucnis pulóver": "kapucnis pulóver",
  "kapucnis pulcsi": "kapucnis pulóver",
  
  // Sweatshirts
  "melegítő felső": "melegítő felső",
  melegitofelsö: "melegítő felső",
  sweatshirt: "melegítő felső",
  
  // Jackets
  dzseki: "dzseki",
  jacket: "dzseki",
  kabát: "kabát",
  kabat: "kabát",
  coat: "kabát",
  blazer: "blézer",
  "blézer": "blézer",
  blezer: "blézer",
  kardigán: "kardigán",
  kardigan: "kardigán",
  cardigan: "kardigán",
  
  // Pants
  "nadrág": "nadrág",
  nadrag: "nadrág",
  pants: "nadrág",
  trousers: "nadrág",
  jeans: "farmer nadrág",
  farmer: "farmer nadrág",
  "farmer nadrág": "farmer nadrág",
  farmernadrág: "farmer nadrág",
  chino: "chino nadrág",
  "chino nadrág": "chino nadrág",
  szövetnadrág: "szövetnadrág",
  "szövet nadrág": "szövetnadrág",
  leggings: "leggings",
  
  // Shorts
  "rövidnadrág": "rövidnadrág",
  rovidnadrag: "rövidnadrág",
  "rövid nadrág": "rövidnadrág",
  shorts: "rövidnadrág",
  bermuda: "rövidnadrág",
  
  // Skirts/Dresses
  szoknya: "szoknya",
  skirt: "szoknya",
  ruha: "ruha",
  dress: "ruha",
  
  // Suits
  "öltöny": "öltöny",
  oltony: "öltöny",
  suit: "öltöny",
  
  // Underwear
  "fehérnemű": "fehérnemű",
  fehernemu: "fehérnemű",
  alsónemű: "fehérnemű",
  underwear: "fehérnemű",
  
  // Swimwear
  "fürdőruha": "fürdőruha",
  furdoruha: "fürdőruha",
  "fürdő": "fürdőruha",
  swimwear: "fürdőruha",
  bikini: "fürdőruha",
  
  // Accessories
  "sapka": "sapka",
  hat: "sapka",
  cap: "sapka",
  beanie: "sapka",
  "sál": "sál",
  sal: "sál",
  scarf: "sál",
  "kesztyű": "kesztyű",
  kesztyu: "kesztyű",
  gloves: "kesztyű",
  "öv": "öv",
  ov: "öv",
  belt: "öv",
  "nyakkendő": "nyakkendő",
  nyakkendo: "nyakkendő",
  tie: "nyakkendő",
  
  // Bags
  "táska": "táska",
  taska: "táska",
  bag: "táska",
  "hátizsák": "hátizsák",
  hatizsak: "hátizsák",
  backpack: "hátizsák",
  
  // Shoes
  "cipő": "cipő",
  cipo: "cipő",
  shoes: "cipő",
  sneaker: "sneaker",
  sneakers: "sneaker",
  "tornacipő": "sneaker",
  tornacipo: "sneaker",
  boots: "bakancs",
  bakancs: "bakancs",
  "csizma": "csizma",
  sandal: "szandál",
  "szandál": "szandál",
  szandal: "szandál",
  papucs: "papucs",
  
  // Watch/Jewelry
  "óra": "óra",
  ora: "óra",
  watch: "óra",
  "ékszer": "ékszer",
  ekszer: "ékszer",
  jewelry: "ékszer",
};

// Gender indicators
const GENDER_INDICATORS: Record<string, "férfi" | "női" | "unisex"> = {
  "férfi": "férfi",
  ferfi: "férfi",
  men: "férfi",
  mens: "férfi",
  "men's": "férfi",
  male: "férfi",
  masculine: "férfi",
  fiu: "férfi",
  fiú: "férfi",
  "női": "női",
  noi: "női",
  women: "női",
  womens: "női",
  "women's": "női",
  female: "női",
  feminine: "női",
  lany: "női",
  lány: "női",
  unisex: "unisex",
};

// Intent indicators
const INTENT_INDICATORS: Record<string, "gift" | "self" | "occasion"> = {
  ajándék: "gift",
  ajandek: "gift",
  gift: "gift",
  meglepetés: "gift",
  meglepi: "gift",
  magamnak: "self",
  nekem: "self",
  magam: "self",
  myself: "self",
  esküvő: "occasion",
  eskuvo: "occasion",
  wedding: "occasion",
  party: "occasion",
  buli: "occasion",
  ünnep: "occasion",
  unnep: "occasion",
  karácsony: "occasion",
  karacsony: "occasion",
  szülinap: "occasion",
  szulinap: "occasion",
  birthday: "occasion",
  valentines: "occasion",
  anyák: "occasion",
  "anyák napja": "occasion",
  apák: "occasion",
  "apák napja": "occasion",
};

// Size patterns
const SIZE_PATTERNS = [
  /\b(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)\b/i,
  /\b(\d{2,3})\s*(cm)?\b/, // numeric size like 38, 44, 170
];

// Price patterns
const PRICE_PATTERNS = [
  /(\d[\d\s]*)\s*(ft|huf|forint|€|eur|euro|\$|usd)?(\s*-\s*|\s*alatt|\s*felett|\s*körül)?(\d[\d\s]*)?\s*(ft|huf|forint|€|eur|euro|\$|usd)?/gi,
  /(\d+[\d\s]*)(ft|huf|forint)\s*(alatt|felett|körül)?/gi,
  /alatt\s*(\d[\d\s]*)\s*(ft|huf|forint)?/gi,
  /felett\s*(\d[\d\s]*)\s*(ft|huf|forint)?/gi,
];

// Normalize text
function normalizeText(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Tokenize query
function tokenize(s: string): string[] {
  return normalizeText(s)
    .replace(/[^a-z0-9áéíóöőúüű\s-]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// Extract price range from query
function extractBudget(query: string): { min?: number; max?: number } | null {
  const lower = normalizeText(query);

  // Pattern: X alatt (under X)
  const underMatch = lower.match(/(\d[\d\s]*)\s*(ft|huf|forint)?\s*(alatt|under)/);
  if (underMatch) {
    const max = parseInt(underMatch[1].replace(/\s/g, ""), 10);
    if (!isNaN(max)) return { max };
  }

  // Pattern: X felett (over X)
  const overMatch = lower.match(/(\d[\d\s]*)\s*(ft|huf|forint)?\s*(felett|over)/);
  if (overMatch) {
    const min = parseInt(overMatch[1].replace(/\s/g, ""), 10);
    if (!isNaN(min)) return { min };
  }

  // Pattern: X - Y (range)
  const rangeMatch = lower.match(/(\d[\d\s]*)\s*-\s*(\d[\d\s]*)\s*(ft|huf|forint)?/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1].replace(/\s/g, ""), 10);
    const max = parseInt(rangeMatch[2].replace(/\s/g, ""), 10);
    if (!isNaN(min) && !isNaN(max)) return { min, max };
  }

  // Pattern: körül/around
  const aroundMatch = lower.match(/(\d[\d\s]*)\s*(ft|huf|forint)?\s*(korul|around|kornyeken)/);
  if (aroundMatch) {
    const target = parseInt(aroundMatch[1].replace(/\s/g, ""), 10);
    if (!isNaN(target)) {
      return { min: Math.floor(target * 0.8), max: Math.ceil(target * 1.2) };
    }
  }

  return null;
}

// Extract size from query
function extractSize(query: string): string | null {
  const lower = normalizeText(query);
  for (const pattern of SIZE_PATTERNS) {
    const match = lower.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

/**
 * Parse a user query into structured signals.
 */
export function parseQuery(query: string): QuerySignals {
  const rawQuery = query;
  const normalized = normalizeText(query);
  const tokens = tokenize(query);

  let foundType: string | null = null;
  const genders = new Set<"férfi" | "női" | "unisex">();
  let intent: "gift" | "self" | "occasion" | null = null;
  const remainingTokens: string[] = [];

  // Extract type, gender, intent from tokens
  for (const token of tokens) {
    const normalizedToken = normalizeText(token);

    // Check type
    if (!foundType && TYPE_SYNONYMS[normalizedToken]) {
      foundType = TYPE_SYNONYMS[normalizedToken];
      continue;
    }

    // Check gender
    if (GENDER_INDICATORS[normalizedToken]) {
      genders.add(GENDER_INDICATORS[normalizedToken]);
      continue;
    }

    // Check intent
    if (!intent && INTENT_INDICATORS[normalizedToken]) {
      intent = INTENT_INDICATORS[normalizedToken];
      continue;
    }

    // Keep token if not consumed
    remainingTokens.push(token);
  }

  // Also check multi-word types (e.g., "kapucnis pulóver")
  if (!foundType) {
    for (const [synonym, canonicalType] of Object.entries(TYPE_SYNONYMS)) {
      if (normalized.includes(normalizeText(synonym))) {
        foundType = canonicalType;
        break;
      }
    }
  }

  // Extract colors and materials from full query
  const colors = detectColors(query);
  const materials = detectMaterials(query);

  // Extract budget
  const budget = extractBudget(query);

  // Extract size
  const size = extractSize(query);

  // Filter remaining tokens: remove colors and materials we detected
  const finalTokens = remainingTokens.filter((t) => {
    const nt = normalizeText(t);
    // Skip if it's part of a detected color or material
    for (const c of colors) {
      if (nt.includes(normalizeText(c))) return false;
    }
    for (const m of materials) {
      if (nt.includes(normalizeText(m))) return false;
    }
    // Skip size tokens
    if (size && nt === normalizeText(size)) return false;
    return true;
  });

  return {
    type: foundType,
    colors,
    materials,
    tokens: finalTokens,
    genders,
    size,
    budget,
    intent,
    rawQuery,
  };
}

/**
 * Get a human-readable summary of parsed signals.
 */
export function signalsSummary(signals: QuerySignals): string {
  const parts: string[] = [];

  if (signals.type) parts.push(`type=${signals.type}`);
  if (signals.colors.size) parts.push(`colors=[${[...signals.colors].join(", ")}]`);
  if (signals.materials.size) parts.push(`materials=[${[...signals.materials].join(", ")}]`);
  if (signals.genders.size) parts.push(`genders=[${[...signals.genders].join(", ")}]`);
  if (signals.size) parts.push(`size=${signals.size}`);
  if (signals.budget) {
    const b = signals.budget;
    if (b.min && b.max) parts.push(`budget=${b.min}-${b.max}`);
    else if (b.max) parts.push(`budget=<${b.max}`);
    else if (b.min) parts.push(`budget=>${b.min}`);
  }
  if (signals.intent) parts.push(`intent=${signals.intent}`);
  if (signals.tokens.length) parts.push(`tokens=[${signals.tokens.join(", ")}]`);

  return parts.length ? parts.join(", ") : "(empty)";
}

/**
 * Check if signals indicate a specific product search vs. browsing.
 */
export function isSpecificSearch(signals: QuerySignals): boolean {
  return !!(
    signals.type ||
    signals.colors.size > 0 ||
    signals.materials.size > 0 ||
    signals.tokens.length > 0
  );
}
