// src/ai/attributes.ts
//
// Determinisztikus attribútum-kinyerés és -scoring ruházati (fashion) boltoknál.
// „kék pulcsi" keresésre kizárólag kék pulóverek kapjanak magas pontot;
// fekete/pink termékek pedig büntetést (color-clash penalty).

import { Product } from "../models/Product";
import { UserContext } from "../models/UserContext";

/* =====================================================================
 * 1) SZÍN SZÓTÁR  –  HU + EN + slang + webshop tag-ek
 * =====================================================================
 * Minden szín-csoport (COLOR_GROUPS) egy canonical ID-t kap.
 * A synonymák bármely formája erre a csoportra map-elődik.
 * ================================================================== */

interface ColorGroup {
  id: string;
  /** Canonical HU megjelenítés (admin / debug) */
  label: string;
  /** Összes lehetséges HU/EN alakja, kisbetűvel */
  synonyms: string[];
  /** Szomszédos / rokon szín-ID-k, amelyeknél NEM alkalmazunk clash-t */
  compatible: string[];
}

const COLOR_GROUPS: ColorGroup[] = [
  {
    id: "kek",
    label: "Kék",
    synonyms: [
      "kék", "kek", "blue", "azúr", "azur", "égkék", "babakék", "babakek",
      "világoskék", "vilagoskek", "sötétkék", "sotetkek", "navy", "tengerészkék",
      "tengerkék", "royal blue", "royalkék", "kobalt", "kobalt kék", "kobalt kek",
      "indigo", "acélkék", "acelkek", "petrolkék", "petrolkek", "türkiz",
    ],
    compatible: ["turkiz", "lila"],
  },
  {
    id: "piros",
    label: "Piros",
    synonyms: [
      "piros", "red", "vörös", "voros", "skarlát", "skarlat", "bíbor", "bibor",
      "cseresznye", "meggy", "meggypiros", "meggyszínű", "crimson", "scarlet",
      "cherry", "tűzpiros", "tuzpiros",
    ],
    compatible: ["narancs", "bordo", "rozsaszin"],
  },
  {
    id: "rozsaszin",
    label: "Rózsaszín",
    synonyms: [
      "rózsaszín", "rozsaszin", "pink", "magenta", "fuchsia", "babarózsa",
      "babarozsa", "világos rózsaszín", "sötétrózsaszín", "sotétrózsaszín",
      "mályva", "malyva", "halvány rózsaszín", "rose", "blush",
    ],
    compatible: ["piros", "lila"],
  },
  {
    id: "fekete",
    label: "Fekete",
    synonyms: [
      "fekete", "black", "éjfekete", "koromfekete", "ében", "jet black", "onyx",
    ],
    compatible: ["szurke", "sotet"],
  },
  {
    id: "feher",
    label: "Fehér",
    synonyms: [
      "fehér", "feher", "white", "hófehér", "hofeher", "krém", "krem",
      "törtfehér", "tortfeher", "elefántcsont", "elefantcsont", "ivory",
      "csontszín", "off-white", "offwhite",
    ],
    compatible: ["bezs"],
  },
  {
    id: "zold",
    label: "Zöld",
    synonyms: [
      "zöld", "zold", "green", "smaragd", "smaragdzöld", "lime", "olív",
      "oliv", "olíva", "oliva", "khaki", "sötétzöld", "sötét zöld",
      "világoszöld", "vilagoszold", "menta", "mentazöld", "mentazold",
      "mohazöld", "mohazold", "erdőzöld", "erdozold", "fűzöld", "fuzold",
      "sage", "forest", "emerald", "teal",
    ],
    compatible: ["turkiz"],
  },
  {
    id: "sarga",
    label: "Sárga",
    synonyms: [
      "sárga", "sarga", "yellow", "arany", "aranysárga", "aranysarga",
      "citrom", "citromsárga", "napsárga", "napsarga", "mustár", "mustar",
      "mustard", "gold", "golden", "mézsárga", "mezsarga",
    ],
    compatible: ["narancs"],
  },
  {
    id: "narancs",
    label: "Narancs",
    synonyms: [
      "narancs", "narancssárga", "narancssarga", "orange", "mandarin",
      "korall", "coral", "terrakotta", "terracotta", "rozsda", "rozsdaszín",
    ],
    compatible: ["sarga", "piros"],
  },
  {
    id: "lila",
    label: "Lila",
    synonyms: [
      "lila", "purple", "violet", "ibolya", "levendula", "lavender",
      "orgona", "padlizsán", "padlizsan", "eggplant", "plum", "szilva",
      "ametiszt", "sötétlila", "sotetkila", "világoslila", "vilagoslila",
      "mályva", "mauve",
    ],
    compatible: ["kek", "rozsaszin"],
  },
  {
    id: "barna",
    label: "Barna",
    synonyms: [
      "barna", "brown", "sötétbarna", "sotetbarna", "világosbarna",
      "vilagosbarna", "csokoládé", "csokolade", "chocolate", "mogyoró",
      "mogyoro", "dió", "dio", "karamell", "caramel", "tölgy", "mahagóni",
      "mahagoni", "gesztenye", "chestnut", "kávé", "kave", "coffee",
      "mokka", "mocha", "tan",
    ],
    compatible: ["bezs", "narancs"],
  },
  {
    id: "szurke",
    label: "Szürke",
    synonyms: [
      "szürke", "szurke", "grey", "gray", "sötétszürke", "sotétszurke",
      "világosszürke", "vilagosszurke", "antracit", "anthracite",
      "ezüst", "ezust", "silver", "acélszürke", "acelszurke",
      "grafit", "graphite", "charcoal",
    ],
    compatible: ["fekete", "feher"],
  },
  {
    id: "bezs",
    label: "Bézs",
    synonyms: [
      "bézs", "bezs", "beige", "drapp", "homok", "homokszín", "sand",
      "teve", "teveszín", "camel", "nude", "taupe", "champagne", "pezsgő",
      "pezsgo", "wheat", "búza",
    ],
    compatible: ["feher", "barna"],
  },
  {
    id: "turkiz",
    label: "Türkiz",
    synonyms: [
      "türkiz", "turkiz", "turquoise", "cián", "cyan", "aqua",
      "vízkék", "vizkek", "tengerzöld", "tengerzold", "teal",
    ],
    compatible: ["kek", "zold"],
  },
  {
    id: "bordo",
    label: "Bordó",
    synonyms: [
      "bordó", "bordo", "bordeaux", "burgundy", "burgundia",
      "marsala", "vörösbor", "vorosbor", "maroon", "wine",
    ],
    compatible: ["piros", "barna"],
  },
  {
    id: "szines",
    label: "Színes / Mintás",
    synonyms: [
      "színes", "szines", "multicolor", "multi", "mintás", "mintas",
      "csíkos", "csikos", "kockás", "kockas", "pöttyös", "pottyos",
      "virágos", "viragos", "terepmintás", "terepminta", "camo",
      "tie-dye", "ombre", "batikolt",
    ],
    compatible: [],
  },
];

/* ---- Szín lookup map (synonym → group id) ---- */
const SYNONYM_TO_COLOR = new Map<string, string>();
const COLOR_ID_TO_GROUP = new Map<string, ColorGroup>();

for (const g of COLOR_GROUPS) {
  COLOR_ID_TO_GROUP.set(g.id, g);
  for (const syn of g.synonyms) {
    SYNONYM_TO_COLOR.set(syn.toLowerCase(), g.id);
  }
}

/* =====================================================================
 * 2) TERMÉKTÍPUS SZÓTÁR  –  HU + EN
 * ================================================================== */

interface TypeGroup {
  id: string;
  label: string;
  synonyms: string[];
}

const TYPE_GROUPS: TypeGroup[] = [
  { id: "pulover", label: "Pulóver", synonyms: ["pulóver", "pulover", "pulcsi", "sweater", "sweatshirt", "kötött pulóver", "jumper"] },
  { id: "hoodie", label: "Kapucnis pulóver", synonyms: ["hoodie", "kapucnis", "kapucnis pulóver", "kapucnis felső", "hoody", "zip hoodie", "zip-up hoodie"] },
  { id: "polo", label: "Póló", synonyms: ["póló", "polo", "tshirt", "t-shirt", "tee", "felső", "top", "tank top", "atléta"] },
  { id: "ing", label: "Ing", synonyms: ["ing", "shirt", "blúz", "bluz", "button-down", "button down", "dress shirt"] },
  { id: "nadrag", label: "Nadrág", synonyms: ["nadrág", "nadrag", "pants", "trousers", "chino", "jogger", "melegítő nadrág", "melegítő"] },
  { id: "farmer", label: "Farmer", synonyms: ["farmer", "jeans", "denim", "farmernadrág"] },
  { id: "short", label: "Rövidnadrág", synonyms: ["short", "shorts", "rövidnadrág", "rovidnadrag", "bermuda", "sort"] },
  { id: "szoknya", label: "Szoknya", synonyms: ["szoknya", "skirt", "miniszoknya", "maxiszoknya", "midi szoknya"] },
  { id: "ruha", label: "Ruha", synonyms: ["ruha", "dress", "maxiruha", "miniruha", "koktélruha", "koktelruha", "alkalmi ruha", "nyáriruha"] },
  { id: "kabat", label: "Kabát", synonyms: ["kabát", "kabat", "coat", "jacket", "dzseki", "parka", "blézer", "blezer", "blazer", "bomber", "széldzseki", "szeldzseki", "windbreaker", "puffer", "steppelt kabát"] },
  { id: "melleny", label: "Mellény", synonyms: ["mellény", "melleny", "vest", "gilet", "bodywarmer"] },
  { id: "cipo", label: "Cipő", synonyms: ["cipő", "cipo", "shoes", "sneaker", "sneakers", "tornacipő", "tornacipo", "futócipő", "futocipo", "bakancs", "boot", "boots", "csizma", "szandál", "szandal", "sandals", "papucs", "mokaszin", "loafer"] },
  { id: "kiegeszito", label: "Kiegészítő", synonyms: ["kiegészítő", "kiegeszito", "öv", "ov", "belt", "sál", "sal", "scarf", "sapka", "hat", "cap", "kesztyű", "kesztyu", "gloves", "nyakkendő", "nyakkendo", "tie", "táska", "taska", "bag", "hátizsák", "hatizsak", "backpack", "napszemüveg", "napszemuveg", "sunglasses", "óra", "ora", "watch", "ékszer", "ekszer", "jewelry"] },
  { id: "zokni", label: "Zokni", synonyms: ["zokni", "socks", "sock", "bokazokni", "térd zokni", "térdzokni", "kompressziós zokni", "sportzokni", "zokni szett", "harisnya", "harisnyanadrág", "tights"] },
  { id: "fehernemu", label: "Fehérnemű", synonyms: ["fehérnemű", "fehernemu", "underwear", "alsónemű", "alsonemu", "boxer", "alsónadrág", "bugyi", "tanga", "melltartó", "melltarto", "bra"] },
  { id: "sportruha", label: "Sportruha", synonyms: ["sportruha", "sportswear", "activewear", "edzőruha", "edzőcucc", "leggings", "sportmelltartó", "dri-fit", "fitness"] },
  { id: "furdoruha", label: "Fürdőruha", synonyms: ["fürdőruha", "furdoruha", "swimwear", "bikini", "úszónadrág", "uszonadrag", "fürdőnadrág", "furdonadrag", "boardshort"] },
];

const SYNONYM_TO_TYPE = new Map<string, string>();
const TYPE_ID_TO_GROUP = new Map<string, TypeGroup>();

for (const g of TYPE_GROUPS) {
  TYPE_ID_TO_GROUP.set(g.id, g);
  for (const syn of g.synonyms) {
    SYNONYM_TO_TYPE.set(syn.toLowerCase(), g.id);
  }
}

/* =====================================================================
 * 3) ATTRIBÚTUM KINYERÉS
 * ================================================================== */

export interface ExtractedAttributes {
  colors: string[];   // color group ID-k (pl. ["kek", "sotet"])
  types: string[];    // type group ID-k (pl. ["pulover"])
  gender: string | null; // "male" | "female" | "unisex" | null
  rawText: string;    // debug: a szöveg amiből kinyertük
}

/**
 * Szövegből szín- és típus-attribútumok kinyerése.
 * Hosszabb synonym-okat előbb illesztjük (greedy).
 */
function extractFromText(text: string): { colors: string[]; types: string[] } {
  if (!text) return { colors: [], types: [] };

  const lower = text.toLowerCase()
    .replace(/[_\-\/|,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const foundColors = new Set<string>();
  const foundTypes = new Set<string>();

  // Szín kinyerés – hosszabb synonymok előbb (greedy)
  const colorSynonyms = [...SYNONYM_TO_COLOR.entries()]
    .sort((a, b) => b[0].length - a[0].length);
  for (const [syn, groupId] of colorSynonyms) {
    if (lower.includes(syn)) {
      foundColors.add(groupId);
    }
  }

  // Típus kinyerés – hosszabb synonymok előbb
  const typeSynonyms = [...SYNONYM_TO_TYPE.entries()]
    .sort((a, b) => b[0].length - a[0].length);
  for (const [syn, groupId] of typeSynonyms) {
    if (lower.includes(syn)) {
      foundTypes.add(groupId);
    }
  }

  return {
    colors: [...foundColors],
    types: [...foundTypes],
  };
}

/** Nem kinyerés szövegből */
function extractGenderFromText(text: string): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  const femalePatterns = [
    "női", "noi", "women", "woman", "ladies", "hölgy", "lány", "lany",
    "girl", "female", "miss",
  ];
  const malePatterns = [
    "férfi", "ferfi", "men", "man", "fiú", "fiu", "boy", "male",
    "úri", "uri", "gentleman",
  ];
  const unisexPatterns = ["unisex", "uniszex", "genderless"];

  for (const p of unisexPatterns) if (lower.includes(p)) return "unisex";
  for (const p of femalePatterns) if (lower.includes(p)) return "female";

  // "men" vs "women" – figyeljünk a szóhatárra
  for (const p of malePatterns) {
    // szóhatár ellenőrzés "men" szónál, hogy ne kapjuk el a "women"-ből
    if (p === "men") {
      if (/\bmen\b/.test(lower) && !lower.includes("women")) return "male";
    } else if (lower.includes(p)) {
      return "male";
    }
  }

  return null;
}

/**
 * User context-ből attribútumok kinyerése.
 */
export function extractUserAttributes(user: UserContext): ExtractedAttributes {
  const parts: string[] = [];

  if (user.free_text) parts.push(user.free_text);
  if (user.interests && user.interests.length > 0) {
    parts.push(user.interests.join(" "));
  }
  if (user.relationship) parts.push(user.relationship);

  const fullText = parts.join(" ");
  const { colors, types } = extractFromText(fullText);

  let gender: string | null = null;
  if (user.gender && user.gender !== "unknown") {
    gender = user.gender;
  }
  if (!gender) {
    gender = extractGenderFromText(fullText);
  }

  return { colors, types, gender, rawText: fullText };
}

/**
 * Termék adataiból attribútumok kinyerése.
 * Minél több adatmező van (name, category, description, tags), annál jobb.
 */
export function extractProductAttributes(product: Product): ExtractedAttributes {
  const parts: string[] = [];

  if (product.name) parts.push(product.name);
  if (product.category) parts.push(product.category);
  if (product.description) parts.push(product.description);

  // Shopify-ból importált termékek tartalmazhatnak tags mezőt
  const tags = (product as any).tags;
  if (typeof tags === "string") parts.push(tags);
  if (Array.isArray(tags)) parts.push(tags.join(" "));

  // product_type (ha van)
  const productType = (product as any).product_type;
  if (typeof productType === "string") parts.push(productType);

  // vendor (ha van)
  const vendor = (product as any).vendor;
  if (typeof vendor === "string") parts.push(vendor);

  const fullText = parts.join(" ");
  const { colors, types } = extractFromText(fullText);
  const gender = extractGenderFromText(fullText);

  return { colors, types, gender, rawText: fullText };
}

/* =====================================================================
 * 4) ATTRIBÚTUM SCORING
 * =====================================================================
 * Pontozási logika:
 *   - Szín egyezés:  +0.40
 *   - Szín kompatibilis: +0.15
 *   - Szín clash (nincs egyezés de user kért színt): -0.35
 *   - Típus egyezés: +0.40
 *   - Típus részleges (rokon típus): +0.10
 *   - Nem egyezés:   +0.10
 *   - Nem eltérés:   -0.05
 *
 * Végeredmény: clamp [0, 1]
 * ================================================================== */

export interface AttributeScoreResult {
  score: number;          // 0..1
  colorMatch: boolean;
  colorClash: boolean;
  typeMatch: boolean;
  genderMatch: boolean;
  debug: string;          // ember-olvasható összefoglaló
}

function areColorsCompatible(userColorId: string, productColorId: string): boolean {
  const g = COLOR_ID_TO_GROUP.get(userColorId);
  if (!g) return false;
  return g.compatible.includes(productColorId);
}

export function scoreByAttributes(
  userAttrs: ExtractedAttributes,
  productAttrs: ExtractedAttributes,
): AttributeScoreResult {
  let score = 0;
  let colorMatch = false;
  let colorClash = false;
  let typeMatch = false;
  let genderMatch = false;
  const debugParts: string[] = [];

  // ── SZÍN ──
  if (userAttrs.colors.length > 0) {
    const exactColorMatch = userAttrs.colors.some(uc =>
      productAttrs.colors.includes(uc)
    );
    const compatibleColorMatch = !exactColorMatch && userAttrs.colors.some(uc =>
      productAttrs.colors.some(pc => areColorsCompatible(uc, pc))
    );

    if (exactColorMatch) {
      score += 0.40;
      colorMatch = true;
      debugParts.push("szín: EGYEZÉS +0.40");
    } else if (compatibleColorMatch) {
      score += 0.15;
      debugParts.push("szín: kompatibilis +0.15");
    } else if (productAttrs.colors.length > 0) {
      // A user kért egy adott színt, de a termék más színű → clash
      score -= 0.35;
      colorClash = true;
      debugParts.push(`szín: CLASH -0.35 (user: ${userAttrs.colors.join(",")}, prod: ${productAttrs.colors.join(",")})`);
    } else {
      // A terméknek nincs detektált színe → enyhe negatív
      score -= 0.10;
      debugParts.push("szín: termékben nem detektált -0.10");
    }
  }

  // ── TÍPUS ──
  if (userAttrs.types.length > 0) {
    const exactTypeMatch = userAttrs.types.some(ut =>
      productAttrs.types.includes(ut)
    );

    if (exactTypeMatch) {
      score += 0.40;
      typeMatch = true;
      debugParts.push("típus: EGYEZÉS +0.40");
    } else if (productAttrs.types.length > 0) {
      // Van típus de más → enyhe negatív
      score -= 0.15;
      debugParts.push(`típus: ELTÉRÉS -0.15 (user: ${userAttrs.types.join(",")}, prod: ${productAttrs.types.join(",")})`);
    } else {
      // Nincs detektált típus a termékben → semleges
      debugParts.push("típus: termékben nem detektált, semleges");
    }
  }

  // ── NEM ──
  if (userAttrs.gender) {
    if (productAttrs.gender) {
      if (
        productAttrs.gender === userAttrs.gender ||
        productAttrs.gender === "unisex"
      ) {
        score += 0.10;
        genderMatch = true;
        debugParts.push("nem: EGYEZÉS +0.10");
      } else {
        score -= 0.05;
        debugParts.push("nem: ELTÉRÉS -0.05");
      }
    }
    // Ha nincs detektált nem a termékben → semleges (nem büntetjük)
  }

  // Clamp 0..1
  const finalScore = Math.max(0, Math.min(1, (score + 1) / 2));
  // Normalizálás: a nyers score -1..+1 tartományban mozog,
  // áttranszformáljuk 0..1-re: (score + 1) / 2

  return {
    score: finalScore,
    colorMatch,
    colorClash,
    typeMatch,
    genderMatch,
    debug: debugParts.join(" | ") || "nincs attribútum adat",
  };
}

/* =====================================================================
 * 5) COMBINED SCORING  +  HARD FILTER
 * =====================================================================
 * finalScore = w_embed * embeddingScore + w_attr * attributeScore + w_pop * popularity
 * Default súlyok: 0.55 / 0.30 / 0.15
 * ================================================================== */

export interface ScoringWeights {
  embedding: number;   // default 0.55
  attribute: number;   // default 0.30
  popularity: number;  // default 0.15
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  embedding: 0.55,
  attribute: 0.30,
  popularity: 0.15,
};

export interface RelevanceSettings {
  strictColorMatch?: boolean;   // hard filter: color clash → kizár
  strictTypeMatch?: boolean;    // hard filter: type mismatch → kizár
  weights?: Partial<ScoringWeights>;
}

export interface ScoredCandidate {
  product: Product;
  embeddingScore: number;
  attributeScore: number;
  popularityScore: number;
  finalScore: number;
  attrDetail: AttributeScoreResult;
}

/**
 * Popularity heurisztika (0..1): ár-alapú + pozíció heurisztika.
 * Egyszerű: az ár alapján kapnak egy normalizált értéket (drágább = kevésbé
 * impulzusvásárlás-barát, de nem büntető). Pozíció: az embedding rangsor
 * pozíciója enyhe tényezőként benne marad.
 */
function popularityScore(product: Product, rank: number, totalCount: number): number {
  // Pozíció score: első elem = 1.0, utolsó = ~0.3
  const positionScore = totalCount > 1
    ? 1 - (rank / totalCount) * 0.7
    : 1;

  return Math.max(0, Math.min(1, positionScore));
}

/**
 * Kombinált scoring: embedding + attribute + popularity.
 * A user attribútumait egyszer kinyerjük, majd minden termékre alkalmazzuk.
 */
export function scoreAndRankCandidates(
  user: UserContext,
  embeddingRanked: { product: Product; score: number }[],
  settings?: RelevanceSettings,
): ScoredCandidate[] {
  if (!embeddingRanked || embeddingRanked.length === 0) return [];

  const userAttrs = extractUserAttributes(user);
  const hasUserAttrs = userAttrs.colors.length > 0 || userAttrs.types.length > 0;

  // Ha a user nem adott meg szín/típus attribútumot, nem használjuk az attribute scoring-ot
  // → csak embedding + popularity
  const w: ScoringWeights = {
    embedding: settings?.weights?.embedding ?? DEFAULT_WEIGHTS.embedding,
    attribute: hasUserAttrs ? (settings?.weights?.attribute ?? DEFAULT_WEIGHTS.attribute) : 0,
    popularity: settings?.weights?.popularity ?? DEFAULT_WEIGHTS.popularity,
  };

  // Ha nincs attribútum, az embedding súlyt növeljük
  if (!hasUserAttrs) {
    w.embedding = w.embedding + DEFAULT_WEIGHTS.attribute;
  }

  // Normalizáljuk a súlyokat (összeg = 1)
  const wSum = w.embedding + w.attribute + w.popularity;
  if (wSum > 0) {
    w.embedding /= wSum;
    w.attribute /= wSum;
    w.popularity /= wSum;
  }

  const total = embeddingRanked.length;

  // Embedding score normalizálás: legyen 0..1 tartományban
  const maxEmbed = embeddingRanked.length > 0
    ? Math.max(...embeddingRanked.map(r => r.score), 0.001)
    : 1;
  const minEmbed = embeddingRanked.length > 0
    ? Math.min(...embeddingRanked.map(r => r.score), 0)
    : 0;
  const embedRange = maxEmbed - minEmbed || 1;

  const results: ScoredCandidate[] = [];
  const strictColor = settings?.strictColorMatch ?? false;
  const strictType = settings?.strictTypeMatch ?? false;

  for (let i = 0; i < embeddingRanked.length; i++) {
    const { product, score: rawEmbed } = embeddingRanked[i];
    const embedNorm = (rawEmbed - minEmbed) / embedRange;

    const productAttrs = extractProductAttributes(product);
    const attrResult = scoreByAttributes(userAttrs, productAttrs);

    const popScore = popularityScore(product, i, total);

    const finalScore =
      w.embedding * embedNorm +
      w.attribute * attrResult.score +
      w.popularity * popScore;

    // Hard filter: ha strict mode be van kapcsolva
    if (strictColor && hasUserAttrs && userAttrs.colors.length > 0 && attrResult.colorClash) {
      continue; // kihagyjuk – color clash
    }
    if (strictType && hasUserAttrs && userAttrs.types.length > 0 && !attrResult.typeMatch && productAttrs.types.length > 0) {
      continue; // kihagyjuk – type mismatch
    }

    results.push({
      product,
      embeddingScore: embedNorm,
      attributeScore: attrResult.score,
      popularityScore: popScore,
      finalScore,
      attrDetail: attrResult,
    });
  }

  // Rendezés: finalScore DESC
  results.sort((a, b) => b.finalScore - a.finalScore);

  return results;
}

/**
 * Debug: logol egy rövid összefoglalót a scoring eredményéről.
 */
export function logScoringDebug(
  siteKey: string,
  userAttrs: ExtractedAttributes,
  candidates: ScoredCandidate[],
  limit: number = 10,
): void {
  if (!process.env.DEBUG_ATTRIBUTES) return;

  console.log(`\n[attributes:${siteKey}] User attribs: colors=[${userAttrs.colors}] types=[${userAttrs.types}] gender=${userAttrs.gender}`);
  console.log(`[attributes:${siteKey}] Top ${limit} scored candidates:`);

  for (let i = 0; i < Math.min(limit, candidates.length); i++) {
    const c = candidates[i];
    console.log(
      `  #${i + 1} "${c.product.name}" => final=${c.finalScore.toFixed(3)} ` +
      `(embed=${c.embeddingScore.toFixed(3)} attr=${c.attributeScore.toFixed(3)} pop=${c.popularityScore.toFixed(3)}) ` +
      `| ${c.attrDetail.debug}`
    );
  }
  console.log("");
}
