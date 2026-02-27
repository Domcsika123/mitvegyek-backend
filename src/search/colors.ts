// src/search/colors.ts
// Central color normalization with HU/EN synonyms

export type StandardColor =
  | "fekete"
  | "fehér"
  | "szürke"
  | "kék"
  | "sötétkék"
  | "piros"
  | "bordó"
  | "zöld"
  | "olíva"
  | "bézs"
  | "barna"
  | "rózsaszín"
  | "lila"
  | "sárga"
  | "narancs"
  | "arany"
  | "ezüst"
  | "türkiz"
  | "korall"
  | "menta"
  | "tarka";

// Map of all color synonyms to standard color
const COLOR_SYNONYMS: Record<string, StandardColor> = {
  // Fekete / Black
  fekete: "fekete",
  black: "fekete",
  noir: "fekete",
  schwarz: "fekete",
  onyx: "fekete",
  jet: "fekete",
  ebony: "fekete",
  coal: "fekete",

  // Fehér / White
  fehér: "fehér",
  feher: "fehér",
  white: "fehér",
  blanc: "fehér",
  weiss: "fehér",
  ivory: "fehér",
  cream: "fehér",
  krém: "fehér",
  krem: "fehér",
  offwhite: "fehér",
  "off-white": "fehér",
  ecru: "fehér",

  // Szürke / Grey
  szürke: "szürke",
  szurke: "szürke",
  grey: "szürke",
  gray: "szürke",
  charcoal: "szürke",
  anthracite: "szürke",
  slate: "szürke",
  heather: "szürke",
  ash: "szürke",
  silver: "szürke",
  pewter: "szürke",
  graphite: "szürke",
  smoke: "szürke",
  steel: "szürke",
  marl: "szürke",

  // Kék / Blue
  kék: "kék",
  kek: "kék",
  blue: "kék",
  blau: "kék",
  azure: "kék",
  sky: "kék",
  cobalt: "kék",
  denim: "kék",
  indigo: "kék",
  sapphire: "kék",
  royal: "kék",
  cyan: "kék",
  aqua: "kék",
  "light blue": "kék",
  világoskék: "kék",

  // Sötétkék / Navy
  sötétkék: "sötétkék",
  sotetkek: "sötétkék",
  navy: "sötétkék",
  "navy blue": "sötétkék",
  midnight: "sötétkék",
  "dark blue": "sötétkék",

  // Piros / Red
  piros: "piros",
  red: "piros",
  rot: "piros",
  rouge: "piros",
  scarlet: "piros",
  crimson: "piros",
  cherry: "piros",
  ruby: "piros",
  cardinal: "piros",

  // Bordó / Burgundy
  bordó: "bordó",
  bordo: "bordó",
  burgundy: "bordó",
  maroon: "bordó",
  wine: "bordó",
  oxblood: "bordó",
  claret: "bordó",
  merlot: "bordó",
  plum: "bordó",

  // Zöld / Green
  zöld: "zöld",
  zold: "zöld",
  green: "zöld",
  grün: "zöld",
  vert: "zöld",
  lime: "zöld",
  emerald: "zöld",
  forest: "zöld",
  sage: "zöld",
  moss: "zöld",
  mint: "menta",
  teal: "türkiz",

  // Olíva / Olive
  olíva: "olíva",
  oliva: "olíva",
  olive: "olíva",
  khaki: "olíva",
  army: "olíva",
  military: "olíva",

  // Bézs / Beige
  bézs: "bézs",
  bezs: "bézs",
  beige: "bézs",
  tan: "bézs",
  sand: "bézs",
  camel: "bézs",
  nude: "bézs",
  taupe: "bézs",
  champagne: "bézs",
  oat: "bézs",
  wheat: "bézs",
  bone: "bézs",
  natural: "bézs",

  // Barna / Brown
  barna: "barna",
  brown: "barna",
  braun: "barna",
  chocolate: "barna",
  coffee: "barna",
  espresso: "barna",
  chestnut: "barna",
  mahogany: "barna",
  walnut: "barna",
  cocoa: "barna",
  mocha: "barna",
  rust: "barna",
  copper: "barna",
  bronze: "barna",
  cognac: "barna",

  // Rózsaszín / Pink
  rózsaszín: "rózsaszín",
  rozsaszin: "rózsaszín",
  pink: "rózsaszín",
  rose: "rózsaszín",
  blush: "rózsaszín",
  fuschia: "rózsaszín",
  fuchsia: "rózsaszín",
  magenta: "rózsaszín",
  salmon: "rózsaszín",
  coral: "korall",
  peach: "rózsaszín",
  "hot pink": "rózsaszín",

  // Lila / Purple
  lila: "lila",
  purple: "lila",
  violet: "lila",
  lavender: "lila",
  mauve: "lila",
  lilac: "lila",
  grape: "lila",
  amethyst: "lila",
  orchid: "lila",

  // Sárga / Yellow
  sárga: "sárga",
  sarga: "sárga",
  yellow: "sárga",
  gelb: "sárga",
  gold: "arany",
  golden: "arany",
  mustard: "sárga",
  lemon: "sárga",
  canary: "sárga",
  butter: "sárga",
  honey: "sárga",
  amber: "sárga",

  // Narancs / Orange
  narancs: "narancs",
  narancssárga: "narancs",
  orange: "narancs",
  tangerine: "narancs",
  apricot: "narancs",
  terracotta: "narancs",
  "burnt orange": "narancs",
  pumpkin: "narancs",
  carrot: "narancs",

  // Arany / Gold
  arany: "arany",
  ezüst: "ezüst",
  // silver already mapped to szürke above

  // Türkiz / Turquoise
  türkiz: "türkiz",
  turkiz: "türkiz",
  turquoise: "türkiz",

  // Menta / Mint
  menta: "menta",

  // Korall / Coral
  korall: "korall",

  // Multi / Tarka
  tarka: "tarka",
  multi: "tarka",
  multicolor: "tarka",
  "multi-color": "tarka",
  print: "tarka",
  pattern: "tarka",
  printed: "tarka",
  mintás: "tarka",
  mintas: "tarka",
  csíkos: "tarka",
  csikos: "tarka",
  striped: "tarka",
  leopard: "tarka",
  camo: "tarka",
  camouflage: "tarka",
  floral: "tarka",
  tropical: "tarka",
  abstract: "tarka",
  geometric: "tarka",
  "tie dye": "tarka",
  "tie-dye": "tarka",
  batikolt: "tarka",
  washed: "szürke", // often stonewashed → grey tones
};

// Normalize text for color matching
function normalizeText(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize for multi-word color detection
function tokenize(s: string): string[] {
  return normalizeText(s).split(/\s+/).filter(Boolean);
}

/**
 * Detect colors from text, product.color field, and tags.
 * Returns a Set of StandardColor values.
 */
export function detectColors(
  text?: string,
  productColor?: string,
  tags?: string
): Set<StandardColor> {
  const found = new Set<StandardColor>();

  // Combine all sources
  const combined = [text || "", productColor || "", tags || ""].join(" ");
  const normalized = normalizeText(combined);

  // Check each color synonym
  for (const [synonym, standardColor] of Object.entries(COLOR_SYNONYMS)) {
    const normalizedSynonym = normalizeText(synonym);
    // Word boundary match
    const regex = new RegExp(`\\b${normalizedSynonym}\\b`, "i");
    if (regex.test(normalized)) {
      found.add(standardColor);
    }
  }

  // Also check tokens for single-word colors
  const tokens = tokenize(combined);
  for (const token of tokens) {
    const color = COLOR_SYNONYMS[token];
    if (color) {
      found.add(color);
    }
  }

  return found;
}

/**
 * Check if a product matches any of the requested colors.
 */
export function hasColorMatch(
  requestedColors: Set<StandardColor>,
  productText: string,
  productColor?: string,
  tags?: string
): boolean {
  if (requestedColors.size === 0) return true; // no filter
  const productColors = detectColors(productText, productColor, tags);
  for (const rc of requestedColors) {
    if (productColors.has(rc)) return true;
  }
  return false;
}

/**
 * Get Hungarian display name for a standard color.
 */
export function getColorDisplayName(color: StandardColor): string {
  const names: Record<StandardColor, string> = {
    fekete: "fekete",
    "fehér": "fehér",
    "szürke": "szürke",
    "kék": "kék",
    "sötétkék": "sötétkék",
    piros: "piros",
    "bordó": "bordó",
    "zöld": "zöld",
    "olíva": "olíva",
    "bézs": "bézs",
    barna: "barna",
    "rózsaszín": "rózsaszín",
    lila: "lila",
    "sárga": "sárga",
    narancs: "narancs",
    arany: "arany",
    "ezüst": "ezüst",
    "türkiz": "türkiz",
    korall: "korall",
    menta: "menta",
    tarka: "tarka",
  };
  return names[color] || color;
}

/**
 * Get the first detected color as display string, or null.
 */
export function getPrimaryColor(
  text?: string,
  productColor?: string,
  tags?: string
): string | null {
  const colors = detectColors(text, productColor, tags);
  if (colors.size === 0) return null;
  return getColorDisplayName([...colors][0]);
}
