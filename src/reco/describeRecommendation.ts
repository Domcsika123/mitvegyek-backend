/**
 * Recommendation Description Generator
 * Generates natural Hungarian sentences for product recommendations.
 */

import { StandardType } from "../ai/normalizeProductType";

// ============================================================================
// TYPES
// ============================================================================

export interface ProductForDescription {
  title?: string;
  name?: string;
  brand?: string;
  vendor?: string;
  color?: string;
  szin?: string;
  material?: string;
  anyag?: string;
  gender?: string;
  nem?: string;
  tags?: string[];
  standardType?: StandardType;
  product_type?: string;
  category?: string;
}

export interface DescribeRecommendationArgs {
  product: ProductForDescription;
  userQuery?: string;
  matchedSignals?: string[];
}

// ============================================================================
// STANDARD TYPE TO HUNGARIAN MAPPING
// ============================================================================

const STANDARD_TYPE_HU: Record<StandardType, string> = {
  "Mindegy": "",
  "Póló": "póló",
  "Pulóver": "pulóver",
  "Hoodie": "kapucnis pulcsi",
  "Kabát": "kabát",
  "Dzseki": "dzseki",
  "Nadrág": "nadrág",
  "Farmer": "farmer",
  "Rövidnadrág": "rövidnadrág",
  "Cipő": "cipő",
  "Kiegészítő": "kiegészítő",
  "Táska": "táska",
  "Ékszer": "ékszer",
  "Fürdőruha": "fürdőruha",
  "Sapka": "sapka",
};

// ============================================================================
// COLOR MAPPING TO HUNGARIAN
// ============================================================================

const COLOR_HU: Record<string, string> = {
  black: "fekete",
  white: "fehér",
  red: "piros",
  blue: "kék",
  green: "zöld",
  yellow: "sárga",
  orange: "narancssárga",
  pink: "rózsaszín",
  purple: "lila",
  grey: "szürke",
  gray: "szürke",
  brown: "barna",
  beige: "bézs",
  navy: "sötétkék",
  cream: "krémszínű",
  gold: "arany",
  silver: "ezüst",
  // Already Hungarian
  fekete: "fekete",
  feher: "fehér",
  piros: "piros",
  kek: "kék",
  zold: "zöld",
  sarga: "sárga",
  szurke: "szürke",
  barna: "barna",
  lila: "lila",
  rozsaszin: "rózsaszín",
};

// ============================================================================
// MATERIAL MAPPING TO HUNGARIAN
// ============================================================================

const MATERIAL_HU: Record<string, string> = {
  cotton: "pamut",
  wool: "gyapjú",
  polyester: "poliészter",
  silk: "selyem",
  leather: "bőr",
  denim: "farmer",
  linen: "len",
  cashmere: "kasmír",
  fleece: "polár",
  nylon: "nejlon",
  acrylic: "akril",
  organic: "organikus",
  recycled: "újrahasznosított",
  // Already Hungarian
  pamut: "pamut",
  gyapju: "gyapjú",
  bor: "bőr",
  selyem: "selyem",
};

// ============================================================================
// QUERY TYPE DETECTION
// ============================================================================

const QUERY_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string; hu: string }> = [
  { pattern: /\b(hoodie|hoody|kapucnis|kapucni)\b/i, type: "hoodie", hu: "kapucnis pulcsi" },
  { pattern: /\b(pulcsi|pulover|sweater|crewneck)\b/i, type: "pulover", hu: "pulóver" },
  { pattern: /\b(polo|tee|t-?shirt|tricko)\b/i, type: "polo", hu: "póló" },
  { pattern: /\b(sapka|beanie|cap|hat)\b/i, type: "sapka", hu: "sapka" },
  { pattern: /\b(farmer|jeans|denim)\b/i, type: "farmer", hu: "farmer" },
  { pattern: /\b(nadrag|pants|chino|jogger)\b/i, type: "nadrag", hu: "nadrág" },
  { pattern: /\b(shorts|rovidnadrag|bermuda)\b/i, type: "shorts", hu: "rövidnadrág" },
  { pattern: /\b(kabat|coat|parka|trench)\b/i, type: "kabat", hu: "kabát" },
  { pattern: /\b(dzseki|jacket|bomber|puffer)\b/i, type: "dzseki", hu: "dzseki" },
  { pattern: /\b(cipo|shoe|sneaker|boot)\b/i, type: "cipo", hu: "cipő" },
  { pattern: /\b(taska|bag|backpack)\b/i, type: "taska", hu: "táska" },
];

function detectQueryType(query: string): { type: string; hu: string } | null {
  if (!query) return null;
  const normalized = query.toLowerCase();
  for (const { pattern, type, hu } of QUERY_TYPE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { type, hu };
    }
  }
  return null;
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizeText(input: string): string {
  if (!input) return "";
  const ACCENT_MAP: Record<string, string> = {
    á: "a", é: "e", í: "i", ó: "o", ö: "o", ő: "o", ú: "u", ü: "u", ű: "u",
  };
  return input
    .toLowerCase()
    .split("")
    .map(c => ACCENT_MAP[c] || c)
    .join("")
    .trim();
}

function extractColorFromName(name: string): string | null {
  if (!name) return null;
  const normalized = normalizeText(name);
  
  // Check common color words in name
  const colorPatterns = [
    { pattern: /\bblack\b/, hu: "fekete" },
    { pattern: /\bwhite\b/, hu: "fehér" },
    { pattern: /\bred\b/, hu: "piros" },
    { pattern: /\bblue\b/, hu: "kék" },
    { pattern: /\bgreen\b/, hu: "zöld" },
    { pattern: /\bgrey\b|\bgray\b/, hu: "szürke" },
    { pattern: /\bpink\b/, hu: "rózsaszín" },
    { pattern: /\bnavy\b/, hu: "sötétkék" },
    { pattern: /\bbrown\b/, hu: "barna" },
    { pattern: /\byellow\b/, hu: "sárga" },
    { pattern: /\borange\b/, hu: "narancssárga" },
    { pattern: /\bpurple\b/, hu: "lila" },
    { pattern: /\bbeige\b/, hu: "bézs" },
    { pattern: /\bfekete\b/, hu: "fekete" },
    { pattern: /\bfeher\b/, hu: "fehér" },
    { pattern: /\bszurke\b/, hu: "szürke" },
    { pattern: /\bkek\b/, hu: "kék" },
    { pattern: /\bpiros\b/, hu: "piros" },
  ];
  
  for (const { pattern, hu } of colorPatterns) {
    if (pattern.test(normalized)) {
      return hu;
    }
  }
  return null;
}

function extractMaterialFromName(name: string): string | null {
  if (!name) return null;
  const normalized = normalizeText(name);
  
  const materialPatterns = [
    { pattern: /\bcotton\b|\bpamut\b/, hu: "pamut" },
    { pattern: /\bwool\b|\bgyapju\b/, hu: "gyapjú" },
    { pattern: /\bleather\b|\bbor\b/, hu: "bőr" },
    { pattern: /\bknit(?:ted)?\b|\bkotott\b/, hu: "kötött" },
    { pattern: /\bfleece\b|\bpolar\b/, hu: "polár" },
    { pattern: /\brecycled\b|\bujrahaszn/, hu: "újrahasznosított" },
    { pattern: /\borganic\b|\borganikus\b/, hu: "organikus" },
  ];
  
  for (const { pattern, hu } of materialPatterns) {
    if (pattern.test(normalized)) {
      return hu;
    }
  }
  return null;
}

function detectStandardTypeFromName(name: string): StandardType | null {
  if (!name) return null;
  const normalized = normalizeText(name);
  
  // Fürdőruha first (swim bra, bikini, etc.)
  if (/\bswim\b|\bbikini\b|\bswimsuit\b|\bswimwear\b|\bbra\b|\btrikini\b/.test(normalized)) return "Fürdőruha";
  if (/\bhoodie\b|\bhoody\b/.test(normalized)) return "Hoodie";
  if (/\bbeanie\b|\bcap\b|\bhat\b/.test(normalized)) return "Sapka";
  if (/\bcrewneck\b|\bsweater\b|\bjumper\b/.test(normalized)) return "Pulóver";
  if (/\btee\b|\bt-?shirt\b|\bpolo\b|\bshirt\b/.test(normalized)) return "Póló";
  if (/\bjeans\b|\bdenim\b/.test(normalized)) return "Farmer";
  if (/\bjacket\b|\bbomber\b|\bpuffer\b/.test(normalized)) return "Dzseki";
  if (/\bcoat\b|\bparka\b/.test(normalized)) return "Kabát";
  if (/\bshorts\b|\bbermuda\b/.test(normalized)) return "Rövidnadrág";
  if (/\bpants\b|\btrousers\b|\bchino\b/.test(normalized)) return "Nadrág";
  if (/\bsneaker\b|\bshoe\b|\bboot\b|\bsandal\b/.test(normalized)) return "Cipő";
  if (/\bbag\b|\bbackpack\b|\btote\b/.test(normalized)) return "Táska";
  if (/\bring\b|\bnecklace\b|\bearring\b|\bbracelet\b/.test(normalized)) return "Ékszer";
  if (/\bbelt\b|\bscarf\b|\bglove\b|\bsock\b|\bwallet\b/.test(normalized)) return "Kiegészítő";
  
  return null;
}

// ============================================================================
// SENTENCE TEMPLATES
// ============================================================================

const SENTENCE_TEMPLATES = {
  // With color and type
  colorType: [
    "{Color} {type}, {reason}.",
    "{Color} {type} a keresésedhez.",
    "Ez a {color} {type} {reason}.",
  ],
  // With color, material and type
  colorMaterialType: [
    "{Color} {type} {material} anyaggal, {reason}.",
    "{Material} {color} {type}, {reason}.",
    "Ez a {color} {material} {type} {reason}.",
  ],
  // With material and type
  materialType: [
    "{Material} {type}, {reason}.",
    "{Type} {material} anyagból, {reason}.",
  ],
  // Type only
  typeOnly: [
    "Klassz {type} a keresésedhez.",
    "Ez a {type} {reason}.",
    "{Type}, ami {reason}.",
  ],
  // Fallback
  fallback: [
    "Ez a termék jól illik a keresésedhez.",
    "Remek választás a stílusodhoz.",
  ],
};

// ============================================================================
// REASON PHRASES
// ============================================================================

const REASON_PHRASES_WITH_QUERY = [
  "pont illik a keresésedhez",
  "a keresésedhez passzol",
  "tökéletes választás",
  "pont olyan, amilyet kerestél",
];

const REASON_PHRASES_GENERIC = [
  "remek választás",
  "jó választás a stílusodhoz",
  "klassz darab",
  "szuper opció",
];

function getReasonPhrase(queryType: { type: string; hu: string } | null): string {
  if (queryType) {
    const idx = Math.floor(Math.random() * REASON_PHRASES_WITH_QUERY.length);
    return REASON_PHRASES_WITH_QUERY[idx];
  }
  const idx = Math.floor(Math.random() * REASON_PHRASES_GENERIC.length);
  return REASON_PHRASES_GENERIC[idx];
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generate a natural Hungarian recommendation description.
 */
export function describeRecommendation(args: DescribeRecommendationArgs): string {
  const { product, userQuery, matchedSignals } = args;
  
  // Get product name
  const name = product.title || product.name || "";
  
  // Determine standard type
  let standardType = product.standardType;
  if (!standardType || standardType === "Mindegy") {
    standardType = detectStandardTypeFromName(name) || "Mindegy";
  }
  
  const typeHu = STANDARD_TYPE_HU[standardType];
  if (!typeHu) {
    // Fallback if no type detected
    return name.length > 50 ? name.slice(0, 47) + "..." : (name || "Remek termék a stílusodhoz.");
  }
  
  // Get color
  let color: string | null = null;
  if (product.color) {
    const colorNorm = normalizeText(product.color);
    color = COLOR_HU[colorNorm] || product.color;
  } else if (product.szin) {
    const colorNorm = normalizeText(product.szin);
    color = COLOR_HU[colorNorm] || product.szin;
  } else {
    color = extractColorFromName(name);
  }
  
  // Get material
  let material: string | null = null;
  if (product.material) {
    const matNorm = normalizeText(product.material);
    material = MATERIAL_HU[matNorm] || product.material;
  } else if (product.anyag) {
    const matNorm = normalizeText(product.anyag);
    material = MATERIAL_HU[matNorm] || product.anyag;
  } else {
    material = extractMaterialFromName(name);
  }
  
  // Detect query type for personalized reason
  const queryType = detectQueryType(userQuery || "");
  const reason = getReasonPhrase(queryType);
  
  // Build sentence
  let sentence = "";
  
  if (color && material) {
    // Color + material + type
    sentence = `${capitalize(color)} ${typeHu} ${material} anyaggal, ${reason}.`;
  } else if (color) {
    // Color + type
    sentence = `${capitalize(color)} ${typeHu}, ${reason}.`;
  } else if (material) {
    // Material + type
    sentence = `${capitalize(material)} ${typeHu}, ${reason}.`;
  } else {
    // Type only
    sentence = `Ez a ${typeHu} ${reason}.`;
  }
  
  // Ensure first letter is capitalized
  return capitalizeFirst(sentence);
}

function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function capitalizeFirst(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================================================
// SIMPLIFIED VERSION FOR DIRECT USE
// ============================================================================

/**
 * Simple version that takes just a product and returns a description.
 */
export function formatRecommendationReason(
  product: ProductForDescription,
  userQuery?: string
): string {
  return describeRecommendation({ product, userQuery });
}
