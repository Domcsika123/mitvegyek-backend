// src/reco/buildCardDescription.ts
// Build concise Hungarian card descriptions from catalog data

import { Product } from "../models/Product";

/**
 * Maximum character length for card descriptions.
 */
const MAX_DESCRIPTION_LENGTH = 120;
const MIN_DESCRIPTION_LENGTH = 15;

/**
 * Hungarian color translations
 */
const COLOR_TO_HU: Record<string, string> = {
  black: "fekete", white: "fehér", red: "piros", blue: "kék",
  green: "zöld", yellow: "sárga", orange: "narancssárga", pink: "rózsaszín",
  purple: "lila", grey: "szürke", gray: "szürke", brown: "barna",
  beige: "bézs", navy: "sötétkék", cream: "krémszínű", gold: "arany",
  silver: "ezüst", sand: "homokszínű", olive: "olívazöld", burgundy: "bordó",
  coral: "korall", mint: "mentazöld", turquoise: "türkiz", khaki: "khaki",
};

/**
 * Hungarian type translations
 */
const TYPE_TO_HU: Record<string, string> = {
  tee: "póló", "t-shirt": "póló", shirt: "ing", polo: "galléros póló",
  hoodie: "kapucnis pulóver", sweatshirt: "pulóver", jacket: "dzseki",
  pants: "nadrág", jeans: "farmer", shorts: "rövidnadrág", skirt: "szoknya",
  dress: "ruha", coat: "kabát", sweater: "pulóver", cardigan: "kardigán",
  sneakers: "sneaker cipő", sneaker: "sneaker cipő", shoes: "cipő", boots: "csizma", 
  bag: "táska", crossbody: "oldaltáska", duffle: "utazótáska",
  backpack: "hátizsák", cap: "sapka", hat: "kalap", beanie: "téli sapka",
  scarf: "sál", gloves: "kesztyű", belt: "öv", watch: "óra",
  socks: "zokni", underwear: "fehérnemű", swimwear: "fürdőruha",
};

/**
 * Hungarian material translations
 */
const MATERIAL_TO_HU: Record<string, string> = {
  cotton: "pamut", organic: "organikus", polyester: "poliészter",
  leather: "bőr", denim: "farmer", wool: "gyapjú", silk: "selyem",
  linen: "len", nylon: "nejlon", fleece: "polár", velvet: "bársony",
  canvas: "vászon", recycled: "újrahasznosított",
};


/**
 * Strip HTML tags from text.
 */
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ") // remove tags
    .replace(/&nbsp;/gi, " ") // replace nbsp
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
}

/**
 * Remove marketing fluff phrases.
 */
function removeFluff(text: string): string {
  const fluffPatterns = [
    /klassz darab/gi,
    /klassz cucc/gi,
    /must have/gi,
    /must-have/gi,
    /tökéletes választás/gi,
    /imádni fogod/gi,
    /nem hiányozhat/gi,
    /ruhatáradból/gi,
    /ruhatárból/gi,
    /szuper darab/gi,
    /menő darab/gi,
    /trendi darab/gi,
    /divatos darab/gi,
    /stílusos darab/gi,
    /alapdarab/gi,
    /alap darab/gi,
    /ez a darab/gi,
    /ez egy/gi,
    /nagyon.*menő/gi,
    /nagyon.*klassz/gi,
    /nagyon.*szuper/gi,
    /tökéletesen.*passzol/gi,
    /combine.*with/gi,
    /pair.*with/gi,
    /perfect.*for/gi,
    /ideal.*for/gi,
    /great.*for/gi,
    /^\s*[-–—•]\s*/gm, // bullet points
    /\d+%\s*(le)?árengedmény/gi,
    /akció/gi,
    /sale/gi,
    /kedvezmény/gi,
    /csak\s+\d+/gi, // "Csak 9990"
    /most\s+csak/gi,
    /ingyenes.*szállítás/gi,
    /free.*shipping/gi,
  ];

  let result = text;
  for (const pattern of fluffPatterns) {
    result = result.replace(pattern, "");
  }

  return result.replace(/\s+/g, " ").trim();
}

/**
 * Extract the first meaningful sentence.
 */
function extractFirstSentence(text: string): string {
  if (!text) return "";

  // Clean up the text
  const cleaned = removeFluff(stripHtml(text));
  if (!cleaned) return "";

  // Split by sentence endings
  const sentences = cleaned.split(/[.!?]+/).filter((s) => s.trim().length > 10);

  if (sentences.length === 0) {
    // No clear sentences, just truncate
    return cleaned.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  // Return first sentence, trimmed
  let first = sentences[0].trim();

  // If too short, add second sentence
  if (first.length < MIN_DESCRIPTION_LENGTH && sentences.length > 1) {
    first = `${first}. ${sentences[1].trim()}`;
  }

  return first;
}

/**
 * Build attribute summary from product data.
 */
function buildAttributeSummary(product: Product): string {
  const parts: string[] = [];
  const productAny = product as any;

  // Brand
  if (productAny.brand) {
    parts.push(productAny.brand);
  }

  // Color
  const color = detectColorHu(product);
  if (color) {
    parts.push(color);
  }

  // Material
  const material = detectMaterialHu(product);
  if (material) {
    parts.push(material);
  }

  // Type
  if (productAny.type || productAny.itemType) {
    const type = productAny.type || productAny.itemType;
    if (!product.name.toLowerCase().includes(type.toLowerCase())) {
      parts.push(type);
    }
  }

  return parts.join(" • ");
}

/**
 * Detect color from product data and translate to Hungarian.
 * Only checks the product name — descriptions often mention multiple colors
 * ("also available in red, blue...") causing false positives.
 */
function detectColorHu(product: Product): string | null {
  const searchText = (product.name || "").toLowerCase();
  for (const [eng, hu] of Object.entries(COLOR_TO_HU)) {
    if (searchText.includes(eng)) {
      return hu;
    }
  }
  return null;
}

/**
 * Detect product type and translate to Hungarian.
 * Uses last category segment + word boundaries to avoid substring false positives
 * (e.g. "shirt" matching inside "sweatshirt" or "t-shirt").
 * More specific types are checked before generic ones.
 */
function detectTypeHu(product: Product): string | null {
  const name = (product.name || "").toLowerCase();
  const fullCat = (product.category || "").toLowerCase();
  // Use last category segment to avoid false matches from parent path
  const lastCat = fullCat.includes(">") ? fullCat.split(">").pop()!.trim() : fullCat;
  const searchText = `${name} ${lastCat}`;

  // Ordered: specific before generic (hoodie/sweatshirt before shirt, t-shirt before shirt)
  const orderedTypes: [string, string][] = [
    ["hoodie", "kapucnis pulóver"],
    ["sweatshirt", "pulóver"],
    ["crewneck", "pulóver"],
    ["t-shirt", "póló"],
    ["tee", "póló"],
    ["polo", "galléros póló"],
    ["tank top", "top"],
    ["shirt", "ing"],
    ["shorts", "rövidnadrág"],
    ["jogger", "nadrág"],
    ["sweatpant", "nadrág"],
    ["pants", "nadrág"],
    ["trousers", "nadrág"],
    ["jeans", "farmer"],
    ["dress", "ruha"],
    ["skirt", "szoknya"],
    ["coat", "kabát"],
    ["parka", "kabát"],
    ["jacket", "dzseki"],
    ["bomber", "dzseki"],
    ["sweater", "pulóver"],
    ["cardigan", "kardigán"],
    ["sneakers", "sneaker cipő"],
    ["sneaker", "sneaker cipő"],
    ["boots", "csizma"],
    ["shoes", "cipő"],
    ["backpack", "hátizsák"],
    ["bag", "táska"],
    ["beanie", "téli sapka"],
    ["cap", "sapka"],
    ["hat", "kalap"],
    ["socks", "zokni"],
    ["scarf", "sál"],
    ["gloves", "kesztyű"],
    ["belt", "öv"],
    ["watch", "óra"],
    ["underwear", "fehérnemű"],
    ["swimwear", "fürdőruha"],
  ];

  for (const [eng, hu] of orderedTypes) {
    if (new RegExp(`\\b${eng.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(searchText)) {
      return hu;
    }
  }

  // Fallback category patterns
  if (/footwear/.test(searchText)) return "cipő";
  if (/luggage|duffel/.test(searchText)) return "táska";
  if (/accessor/.test(searchText)) return "kiegészítő";

  return null;
}

/**
 * Detect material and translate to Hungarian
 */
function detectMaterialHu(product: Product): string | null {
  const searchText = [
    product.description,
    (product as any).composition,
    Array.isArray((product as any).tags) ? (product as any).tags.join(" ") : ""
  ].join(" ").toLowerCase();
  
  for (const [eng, hu] of Object.entries(MATERIAL_TO_HU)) {
    if (searchText.includes(eng)) {
      return hu;
    }
  }
  return null;
}

/**
 * Extract key features from English description for Hungarian summary.
 */
function extractKeyFeatures(description: string): string[] {
  if (!description) return [];
  const features: string[] = [];
  const text = description.toLowerCase();
  
  // Fit patterns
  if (text.includes("oversized") || text.includes("loose fit")) features.push("bő szabású");
  if (text.includes("slim fit") || text.includes("fitted")) features.push("szűk szabású");
  if (text.includes("relaxed fit")) features.push("laza szabású");
  
  // Quality patterns
  if (text.includes("premium") || text.includes("luxury")) features.push("prémium minőség");
  if (text.includes("heavy")) features.push("vastag anyag");
  if (text.includes("limited") || text.includes("rare")) features.push("limitált kiadás");
  if (text.includes("collab") || text.includes("collaboration")) features.push("együttműködés");
  
  // Comfort patterns
  if (text.includes("comfort") || text.includes("soft")) features.push("kényelmes viselet");
  if (text.includes("water resistant") || text.includes("waterproof")) features.push("vízálló");
  
  // Style patterns
  if (text.includes("streetwear") || text.includes("urban")) features.push("utcai stílus");
  if (text.includes("classic") || text.includes("timeless")) features.push("időtlen dizájn");
  if (text.includes("vintage")) features.push("vintage hatás");
  if (text.includes("minimalist") || text.includes("clean")) features.push("letisztult dizájn");
  
  return features.slice(0, 2); // Max 2 features
}

/**
 * Build a factual Hungarian card description from product attributes.
 * Format: "[Szín] [anyag] [típus][, jellemzők]"
 * No generic adjectives — only real product data.
 * Examples:
 *   "Lila kapucnis pulóver, 100% poliészter, bő szabású"
 *   "Fekete póló, organikus pamut"
 *   "Rövidnadrág, relaxed szabás"
 */
export function buildCardDescription(product: Product): string {
  const color = detectColorHu(product);
  const type = detectTypeHu(product);
  const material = detectMaterialHu(product);
  const features = extractKeyFeatures(product.description || "");

  const parts: string[] = [];

  // Start with color (capitalized) + type as the core
  const core: string[] = [];
  if (color) core.push(color.charAt(0).toUpperCase() + color.slice(1));
  if (material) core.push(material);
  if (type) {
    core.push(type);
  } else {
    // Fallback: use last category segment as type
    const cat = (product.category || "");
    const lastCat = cat.includes(">") ? cat.split(">").pop()!.trim() : cat;
    if (lastCat && lastCat.length < 40) core.push(lastCat);
  }

  if (core.length === 0) return product.name || "";

  parts.push(core.join(" "));

  // Append features after comma
  if (features.length > 0) {
    parts.push(features.join(", "));
  }

  return truncateWithEllipsis(parts.join(", "), MAX_DESCRIPTION_LENGTH);
}

/**
 * Truncate text with ellipsis at word boundary.
 */
function truncateWithEllipsis(text: string, maxLength: number): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;

  // Find last space before maxLength
  const truncated = text.slice(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.6) {
    return truncated.slice(0, lastSpace) + "...";
  }

  return truncated + "...";
}

/**
 * Build a short reason text for why this product was recommended.
 */
export function buildRecommendationReason(
  product: Product,
  matchReasons: string[]
): string {
  const parts: string[] = [];
  const productAny = product as any;

  // Prioritize match reasons
  for (const reason of matchReasons) {
    if (reason.startsWith("type:")) {
      const type = reason.replace("type:", "");
      parts.push(`${type} típus`);
    } else if (reason.startsWith("color:")) {
      const color = reason.replace("color:", "");
      parts.push(`${color} színű`);
    } else if (reason.startsWith("material:")) {
      const material = reason.replace("material:", "");
      parts.push(`${material} anyag`);
    }
  }

  // Add brand if not already mentioned
  if (productAny.brand && parts.length < 2) {
    parts.push(productAny.brand);
  }

  if (parts.length === 0) {
    const color = detectColorHu(product);
    if (color) {
      parts.push(`${color} színű`);
    }
    if (productAny.brand) {
      parts.push(productAny.brand);
    }
  }

  return parts.slice(0, 2).join(", ");
}

/**
 * Get display-ready product info for cards.
 */
export interface CardInfo {
  title: string;
  description: string;
  price: string | null;
  brand: string | null;
  color: string | null;
  imageUrl: string | null;
}

export function getCardInfo(product: Product): CardInfo {
  const productAny = product as any;

  return {
    title: product.name || "Termék",
    description: buildCardDescription(product),
    price: productAny.price || null,
    brand: productAny.brand || null,
    color: detectColorHu(product),
    imageUrl: productAny.imageUrl || productAny.image || null,
  };
}
