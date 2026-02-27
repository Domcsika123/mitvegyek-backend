// src/search/materials.ts
// Central material normalization with HU/EN synonyms

export type StandardMaterial =
  | "pamut"
  | "poliészter"
  | "viszkóz"
  | "len"
  | "selyem"
  | "gyapjú"
  | "kasmír"
  | "bőr"
  | "műbőr"
  | "denim"
  | "nylon"
  | "elasztán"
  | "akril"
  | "fleece"
  | "szatén"
  | "csipke"
  | "velúr"
  | "tweed"
  | "kord"
  | "jersey"
  | "szövet"
  | "vászon";

// Map of all material synonyms to standard material
const MATERIAL_SYNONYMS: Record<string, StandardMaterial> = {
  // Pamut / Cotton
  pamut: "pamut",
  cotton: "pamut",
  baumwolle: "pamut",
  coton: "pamut",
  "100% cotton": "pamut",
  "organic cotton": "pamut",
  "bio pamut": "pamut",
  pique: "pamut",
  "piké": "pamut",

  // Poliészter / Polyester
  "poliészter": "poliészter",
  polieszter: "poliészter",
  polyester: "poliészter",
  poly: "poliészter",
  microfiber: "poliészter",

  // Viszkóz / Viscose
  "viszkóz": "viszkóz",
  viszkoz: "viszkóz",
  viscose: "viszkóz",
  rayon: "viszkóz",
  modal: "viszkóz",
  tencel: "viszkóz",
  lyocell: "viszkóz",
  cupro: "viszkóz",

  // Len / Linen
  len: "len",
  linen: "len",
  flax: "len",
  lin: "len",
  leinen: "len",

  // Selyem / Silk
  selyem: "selyem",
  silk: "selyem",
  soie: "selyem",
  satin: "szatén",
  "szatén": "szatén",
  szaten: "szatén",

  // Gyapjú / Wool
  "gyapjú": "gyapjú",
  gyapju: "gyapjú",
  wool: "gyapjú",
  wolle: "gyapjú",
  laine: "gyapjú",
  merino: "gyapjú",

  // Kasmír / Cashmere
  "kasmír": "kasmír",
  kasmir: "kasmír",
  cashmere: "kasmír",
  cachemire: "kasmír",

  // Bőr / Leather
  "bőr": "bőr",
  bor: "bőr",
  leather: "bőr",
  leder: "bőr",
  cuir: "bőr",
  nappa: "bőr",
  suede: "bőr",
  nubuk: "bőr",
  nubuck: "bőr",
  "valódi bőr": "bőr",
  "genuine leather": "bőr",

  // Műbőr / Faux leather
  "műbőr": "műbőr",
  mubor: "műbőr",
  "faux leather": "műbőr",
  pleather: "műbőr",
  "pu leather": "műbőr",
  pu: "műbőr",
  vegan: "műbőr",
  "vegan leather": "műbőr",
  leatherette: "műbőr",
  "eco leather": "műbőr",
  "öko bőr": "műbőr",

  // Denim
  denim: "denim",
  farmer: "denim",
  jeans: "denim",

  // Nylon
  nylon: "nylon",
  nájlon: "nylon",
  najlon: "nylon",

  // Elasztán / Elastane
  "elasztán": "elasztán",
  elasztan: "elasztán",
  elastane: "elasztán",
  spandex: "elasztán",
  lycra: "elasztán",
  stretch: "elasztán",

  // Akril / Acrylic
  akril: "akril",
  acrylic: "akril",
  acryl: "akril",

  // Fleece
  fleece: "fleece",
  polar: "fleece",
  "polár": "fleece",
  sherpa: "fleece",


  // Csipke / Lace
  csipke: "csipke",
  lace: "csipke",
  "spitze": "csipke",

  // Velúr / Velour/Velvet
  "velúr": "velúr",
  velur: "velúr",
  velour: "velúr",
  velvet: "velúr",
  bársony: "velúr",
  barsony: "velúr",

  // Tweed
  tweed: "tweed",

  // Kord / Corduroy
  kord: "kord",
  corduroy: "kord",
  cord: "kord",

  // Jersey
  jersey: "jersey",
  dzserzi: "jersey",

  // Szövet / Fabric/Woven
  "szövet": "szövet",
  szovet: "szövet",
  woven: "szövet",
  fabric: "szövet",
  canvas: "vászon",
  "vászon": "vászon",
  vaszon: "vászon",
};

// Material category for grouping
export type MaterialCategory =
  | "natural"
  | "synthetic"
  | "leather"
  | "blended";

const MATERIAL_CATEGORIES: Record<StandardMaterial, MaterialCategory> = {
  pamut: "natural",
  "poliészter": "synthetic",
  "viszkóz": "synthetic",
  len: "natural",
  selyem: "natural",
  "gyapjú": "natural",
  "kasmír": "natural",
  "bőr": "leather",
  "műbőr": "leather",
  denim: "blended",
  nylon: "synthetic",
  "elasztán": "synthetic",
  akril: "synthetic",
  fleece: "synthetic",
  "szatén": "blended",
  csipke: "blended",
  "velúr": "blended",
  tweed: "blended",
  kord: "blended",
  jersey: "blended",
  "szövet": "blended",
  "vászon": "natural",
};

// Normalize text for material matching
function normalizeText(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9\s%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize for multi-word material detection
function tokenize(s: string): string[] {
  return normalizeText(s).split(/\s+/).filter(Boolean);
}

/**
 * Detect materials from text (title, description, composition).
 * Returns a Set of StandardMaterial values.
 */
export function detectMaterials(
  text?: string,
  composition?: string,
  tags?: string
): Set<StandardMaterial> {
  const found = new Set<StandardMaterial>();

  // Combine all sources
  const combined = [text || "", composition || "", tags || ""].join(" ");
  const normalized = normalizeText(combined);

  // Check each material synonym
  for (const [synonym, standardMaterial] of Object.entries(MATERIAL_SYNONYMS)) {
    const normalizedSynonym = normalizeText(synonym);
    // Word boundary match
    const regex = new RegExp(`\\b${normalizedSynonym}\\b`, "i");
    if (regex.test(normalized)) {
      found.add(standardMaterial);
    }
  }

  // Also check tokens for single-word materials
  const tokens = tokenize(combined);
  for (const token of tokens) {
    const material = MATERIAL_SYNONYMS[token];
    if (material) {
      found.add(material);
    }
  }

  return found;
}

/**
 * Check if a product matches any of the requested materials.
 */
export function hasMaterialMatch(
  requestedMaterials: Set<StandardMaterial>,
  productText: string,
  composition?: string,
  tags?: string
): boolean {
  if (requestedMaterials.size === 0) return true; // no filter
  const productMaterials = detectMaterials(productText, composition, tags);
  for (const rm of requestedMaterials) {
    if (productMaterials.has(rm)) return true;
  }
  return false;
}

/**
 * Get Hungarian display name for a standard material.
 */
export function getMaterialDisplayName(material: StandardMaterial): string {
  const names: Record<StandardMaterial, string> = {
    pamut: "pamut",
    "poliészter": "poliészter",
    "viszkóz": "viszkóz",
    len: "len",
    selyem: "selyem",
    "gyapjú": "gyapjú",
    "kasmír": "kasmír",
    "bőr": "bőr",
    "műbőr": "műbőr",
    denim: "farmer",
    nylon: "nylon",
    "elasztán": "elasztán",
    akril: "akril",
    fleece: "fleece",
    "szatén": "szatén",
    csipke: "csipke",
    "velúr": "velúr",
    tweed: "tweed",
    kord: "kordbársony",
    jersey: "jersey",
    "szövet": "szövet",
    "vászon": "vászon",
  };
  return names[material] || material;
}

/**
 * Get the first detected material as display string, or null.
 */
export function getPrimaryMaterial(
  text?: string,
  composition?: string,
  tags?: string
): string | null {
  const materials = detectMaterials(text, composition, tags);
  if (materials.size === 0) return null;
  return getMaterialDisplayName([...materials][0]);
}

/**
 * Get the material category.
 */
export function getMaterialCategory(
  material: StandardMaterial
): MaterialCategory {
  return MATERIAL_CATEGORIES[material] || "blended";
}

/**
 * Check if product is made from natural materials.
 */
export function isNaturalMaterial(
  text?: string,
  composition?: string,
  tags?: string
): boolean {
  const materials = detectMaterials(text, composition, tags);
  for (const m of materials) {
    if (getMaterialCategory(m) === "natural") return true;
  }
  return false;
}
