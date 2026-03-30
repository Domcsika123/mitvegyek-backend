// src/routes/recommend.ts
// ✅ PIPELINE: hybridSearch → hard type/color filter → LLM rerank
import { Router } from "express";
import { getProductsForSite } from "../services/productService";
import { UserContext } from "../models/UserContext";
import { recordProductOpenClick, recordRecommendation } from "../services/statsService";
import {
  findPartnerByApiKey,
  findPartnerBySiteKey,
} from "../services/partnerService";
import { getPublicWidgetConfig } from "../services/widgetConfigService";
import { hybridSearch } from "../search/hybridSearch";
import { enrichWithCachedEmbeddings } from "../ai/embeddingIndex";
import { parsePrice } from "../ai/price";
import { rerankWithLLM, detectNegativeConstraints } from "../ai/rerank";
import { buildCardDescription } from "../reco/buildCardDescription";
import { parseQuery, QuerySignals } from "../search/signals";
import { dedupeByBaseProduct } from "../ai/queryUtils";
import { Product, FashionTags } from "../models/Product";
import { detectColors } from "../search/colors";
import { detectAttributes, applyPositiveAttributeFilter, getAttributeDisplayNames, AttributeDef } from "../search/attributes";

/* ============================================================
   FASHION TAGS SCORING
   Scores a product's structured fashion_tags against user query.
   Returns 0..1 — higher = better match to what user described.
   ============================================================ */
interface FashionQuery {
  fit?: string[];       // desired fits: ["oversized", "relaxed"]
  logo?: string[];      // desired logo: ["none"] or ["small", "large"]
  graphic?: string[];   // desired graphic: ["none"] or ["text", "all_over"]
  pattern?: string[];   // desired pattern: ["solid"] or ["striped"]
  style?: string[];     // desired styles: ["streetwear", "casual"]
  weight?: string[];    // desired weight: ["heavy"] or ["light"]
  material?: string[];  // desired material: ["cotton"]
}

// Maps user query words (HU/EN, ékezet-insensitive) → FashionQuery fields
const FASHION_QUERY_MAP: Array<{ pattern: RegExp; field: keyof FashionQuery; values: string[] }> = [
  // Fit
  { pattern: /\boversized?\b|\bb[oő]\s*szab[aá]s\b|\bbaggy\b/i, field: "fit", values: ["oversized", "relaxed"] },
  { pattern: /\bslim\s*fit\b|\bsz[uű]k\b|\btesthez[aá]ll[oó]\b/i, field: "fit", values: ["slim"] },
  { pattern: /\bboxy\b/i, field: "fit", values: ["boxy"] },
  { pattern: /\bcropped?\b|\br[oö]vid[ií]tett\b/i, field: "fit", values: ["cropped"] },
  // Logo
  { pattern: /\blog[oó]\s*n[eé]lk[uü]l/i, field: "logo", values: ["none"] },
  { pattern: /\blog[oó]s\b|\blog[oó]val\b/i, field: "logo", values: ["small", "large", "embroidered", "printed"] },
  // Graphic
  { pattern: /\bgrafika\s*n[eé]lk[uü]l|\bplain\b/i, field: "graphic", values: ["none"] },
  { pattern: /\bgrafik[aá]s\b|\bnyomott\b|\bprinted\b|\ball[- ]?over\b|\bteli\s*nyomott/i, field: "graphic", values: ["small_print", "all_over", "abstract", "photo"] },
  { pattern: /\bfelirat(os|tal)?\b|\bsz[oö]veg(es)?\b/i, field: "graphic", values: ["text"] },
  // Pattern
  { pattern: /\begysz[ií]n[uű]\b|\bsima\b|\bsolid\b/i, field: "pattern", values: ["solid"] },
  { pattern: /\bcs[ií]k(os|[aá]s)?\b|\bstriped?\b/i, field: "pattern", values: ["striped"] },
  { pattern: /\bkock[aá]s\b|\bcheck(ered)?\b|\bplaid\b/i, field: "pattern", values: ["checkered"] },
  { pattern: /\bmint[aá]s\b|\bpatterned\b/i, field: "pattern", values: ["striped", "checkered", "dotted", "floral", "camo", "tie_dye", "leopard", "abstract", "colorblock"] },
  { pattern: /\bterepmint[aá]s?\b|\bcamo\b/i, field: "pattern", values: ["camo"] },
  { pattern: /\btie[- ]?dye\b|\bbatikolt\b/i, field: "pattern", values: ["tie_dye"] },
  { pattern: /\bvir[aá]g(os|mint[aá]s)?\b|\bfloral\b/i, field: "pattern", values: ["floral"] },
  // Style
  { pattern: /\bsport(os|y)?\b|\batl[eé]tik(us)?\b|\bfitness\b/i, field: "style", values: ["sporty"] },
  { pattern: /\beleg[aá]ns\b|\bformal\b|\bclassy\b|\b[uü]nnepi\b/i, field: "style", values: ["elegant"] },
  { pattern: /\blaza\b|\bcasual\b|\bk[eé]nyelmes\b|\brelaxed\b/i, field: "style", values: ["casual"] },
  { pattern: /\bstreetwear\b|\burban\b|\butcai\b/i, field: "style", values: ["streetwear"] },
  { pattern: /\bvintage\b|\bretro\b|\bold[- ]?school\b/i, field: "style", values: ["vintage", "retro"] },
  { pattern: /\bminimal(ista)?\b|\begyszer[uű]\b|\bbasic\b|\bletiszt[uú]lt\b/i, field: "style", values: ["minimalist"] },
  { pattern: /\bfelt[uű]n[oő]\b|\bvag[aá]ny\b|\bbold\b|\bstatement\b/i, field: "style", values: ["bold"] },
  { pattern: /\bsk8\b|\bskater?\b|\bsk[eé]ter?\b/i, field: "style", values: ["skater", "streetwear"] },
  { pattern: /\bgrunge\b|\bpunk\b/i, field: "style", values: ["grunge"] },
  { pattern: /\bworkwear\b|\bmunk[aá]s\b/i, field: "style", values: ["workwear"] },
  // Weight
  { pattern: /\bneh[eé]z\b|\bvastag\b|\bheavy\b|\bt[eé]li(es)?\b/i, field: "weight", values: ["heavy"] },
  { pattern: /\bk[oö]nny[uű]\b|\bv[eé]kony\b|\blight\b|\bny[aá]ri(as)?\b|\bl[eé]gies\b/i, field: "weight", values: ["light"] },
  // Material
  { pattern: /\bpamut\b|\bcotton\b/i, field: "material", values: ["cotton"] },
  { pattern: /\bpoli[eé]szter\b|\bpolyester\b/i, field: "material", values: ["polyester"] },
  { pattern: /\bfleece\b|\bpolár\b|\bpolar\b/i, field: "material", values: ["fleece"] },
  { pattern: /\bdenim\b|\bfarmer\b/i, field: "material", values: ["denim"] },
  { pattern: /\bb[oő]r\b|\bleather\b/i, field: "material", values: ["leather"] },
  { pattern: /\bmesh\b|\bháló(s)?\b/i, field: "material", values: ["mesh"] },
];

function parseFashionQuery(freeText: string): FashionQuery {
  const q: FashionQuery = {};
  if (!freeText) return q;
  for (const rule of FASHION_QUERY_MAP) {
    if (rule.pattern.test(freeText)) {
      const existing = q[rule.field] || [];
      q[rule.field] = [...new Set([...existing, ...rule.values])];
    }
  }
  return q;
}

function scoreFashionTags(tags: FashionTags | undefined, query: FashionQuery): number {
  if (!tags || Object.keys(query).length === 0) return 0;

  let matches = 0;
  let total = 0;

  if (query.fit && query.fit.length > 0) {
    total++;
    if (tags.fit && query.fit.includes(tags.fit)) matches++;
  }
  if (query.logo && query.logo.length > 0) {
    total++;
    if (tags.logo && query.logo.includes(tags.logo)) matches++;
  }
  if (query.graphic && query.graphic.length > 0) {
    total++;
    if (tags.graphic && query.graphic.includes(tags.graphic)) matches++;
  }
  if (query.pattern && query.pattern.length > 0) {
    total++;
    if (tags.pattern && query.pattern.includes(tags.pattern)) matches++;
  }
  if (query.style && query.style.length > 0) {
    total++;
    if (tags.style && tags.style.some((s) => query.style!.includes(s))) {
      matches++;
    } else if (query.style.includes("minimalist") || query.style.includes("elegant")) {
      // Visually clean products count as minimalist/elegant even without explicit style tag
      const quietLogo = tags.logo === "none" || tags.logo === "small" || tags.logo === "embroidered";
      const noLoudGraphic = tags.graphic === "none" || tags.graphic === undefined;
      const solidPattern = tags.pattern === "solid" || tags.pattern === undefined;
      if (quietLogo && noLoudGraphic && solidPattern) matches++;
    }
  }
  if (query.weight && query.weight.length > 0) {
    total++;
    if (tags.weight && query.weight.includes(tags.weight)) matches++;
  }
  if (query.material && query.material.length > 0) {
    total++;
    if (tags.material && query.material.includes(tags.material)) matches++;
  }

  return total > 0 ? matches / total : 0;
}

const router = Router();

/* ============================================================
   NEGATIVE ATTRIBUTE HARD FILTER
   Ha a user kizárást kér (pl. "logo nélküli"), az ai_description
   alapján determinisztikusan szűrünk.
   ============================================================ */

// "nélkül" variant that also matches unaccented "nelkul"
const _NLK_D = `n[eé]lk[uü]l`;
const NEGATIVE_ATTR_RULES: Array<{
  keywords: string[];            // milyen constraint labeleknél aktiválódik
  hasIt: RegExp;                 // ai_description-ben: termékNEK VAN ilyen attribútuma
  lacksIt: RegExp;               // ai_description-ben: termékNEK NINCS ilyen attribútuma (check runs first!)
}> = [
  {
    // "logo/felirat/grafika/minta nélküli" = user wants PLAIN product
    // Any of these constraints means: no logo, no graphic, no text, no print
    keywords: ["logo", "felirat", "text", "szöveg", "writing", "grafika", "graphic", "print", "nyomat", "minta", "pattern"],
    hasIt: /log[oó]val|log[oó]s|kis log[oó]|nagy log[oó]|hímzett log[oó]|nyomott|grafik|felirat(?!\s*n[eé]lk)|mintás|mintával|teli nyomott/i,
    lacksIt: new RegExp(`${_NLK_D}|egyszínű|sima|letisztult|minimalista`, "i"),
  },
  {
    keywords: ["csík", "stripe"],
    hasIt: /csíkos|stripe/i,
    lacksIt: new RegExp(`cs[ií]k.{0,8}${_NLK_D}`, "i"),
  },
  {
    keywords: ["plain", "díszítés"],
    hasIt: /log[oó]val|log[oó]s|grafik|nyomott|felirattal|mintás|teli nyomott/i,
    lacksIt: new RegExp(`${_NLK_D}|egyszínű|sima|letisztult|minimalista`, "i"),
  },
];

function applyNegativeHardFilter(products: Product[], constraints: string[]): Product[] {
  if (constraints.length === 0) return products;

  // Gyűjtsük össze az aktív szabályokat a constraint labelek alapján
  const activeRules = NEGATIVE_ATTR_RULES.filter((rule) =>
    constraints.some((c) => {
      const cl = c.toLowerCase();
      return rule.keywords.some((kw) => cl.includes(kw));
    })
  );

  if (activeRules.length === 0) return products;

  return products.filter((p) => {
    const desc = ((p as any).ai_description || "").toLowerCase();
    if (!desc) return true; // nincs ai_description → nem tudunk szűrni, marad

    for (const rule of activeRules) {
      const has = rule.hasIt.test(desc);
      // Ha megvan az attribútum → kiszűrjük (akkor is ha "minimalista" stb. is van mellette)
      if (has) return false;
      // Ha nincs az attribútum → nincs említve vagy explicit hiányzik → OK
    }
    return true;
  });
}

/* ============================================================
   HARD TYPE / COLOR PRE-FILTER
   Determinisztikus szűrés az LLM elé – 100% garancia
   ============================================================ */

// Canonical Hungarian type → English keywords (match against product name + category)
const TYPE_FILTER_MAP: Record<string, string[]> = {
  "sapka": ["hat", "cap", "beanie", "snapback", "trucker", "bucket", "headwear"],
  "kapucnis pulóver": ["hoodie"],
  "zip up": ["zip", "zipup", "zip-up", "zip hoodie", "full zip"],
  "pulóver": ["sweater", "crewneck", "jumper", "knit"],
  "melegítő felső": ["sweatshirt"],
  "blúz": ["blouse"],
  "póló": ["t-shirt", "tee"],
  "ing": ["shirt"],
  "top": ["tank top", "tank", "crop top"],
  "felső": ["top", "tank", "tee", "shirt"],
  "rövidnadrág": ["shorts", "short"],  // Note: "boxer shorts" excluded below
  "nadrág": ["pants", "trousers", "jogger", "sweatpants"],
  "leggings": ["leggings", "tights"],
  "farmer nadrág": ["jeans", "denim"],
  "dzseki": ["jacket", "bomber", "puffer", "windbreaker"],
  "kabát": ["coat", "parka", "overcoat"],
  "blézer": ["blazer"],
  "kardigán": ["cardigan"],
  "cipő": ["shoes", "sneaker", "boot", "sandal"],
  "sneaker": ["sneaker"],
  "bakancs": ["boot"],
  "táska": ["bag", "backpack", "tote", "pouch"],
  "zokni": ["socks", "sock"],
  "sál": ["scarf"],
  "öv": ["belt"],
  "ruha": ["dress"],
  "szoknya": ["skirt"],
  "fehérnemű": ["underwear", "lingerie", "undergarment"],
  "férfi fehérnemű": ["underwear", "undergarment"],
  "női fehérnemű": ["lingerie"],
  "fürdőruha": ["swimwear", "swim", "bikini"],
  "telefontok": ["phone case", "iphone case", "mobile phone case", "mobile phone cases"],
  "kiegészítő": ["keychain", "necklace", "chain", "scarf", "shawl", "sock", "belt", "jewelry", "bracelet", "ring", "earring"],
  "ékszer": ["jewelry", "ring", "bracelet", "earring"],
};

// Canonical Hungarian color → English synonyms in product text
const COLOR_FILTER_MAP: Record<string, string[]> = {
  "fekete": ["black"],
  "fehér": ["white", "off-white"],
  "szürke": ["grey", "gray", "charcoal", "heather", "ash", "marl"],
  "kék": ["blue", "cobalt", "azure", "indigo", "sky", "denim", "royal blue"],
  "sötétkék": ["navy", "dark blue", "navy blue"],
  "piros": ["red", "crimson", "scarlet"],
  "bordó": ["burgundy", "maroon", "wine", "bordeaux"],
  "zöld": ["green", "sage", "forest", "mint", "khaki", "olive"],
  "olíva": ["olive", "khaki"],
  "sárga": ["yellow", "mustard", "golden"],
  "narancs": ["orange", "rust", "amber"],
  "lila": ["purple", "violet", "lavender", "plum"],
  "rózsaszín": ["pink", "rose", "coral", "blush"],
  "barna": ["brown", "tan", "camel", "chocolate", "mocha"],
  "bézs": ["beige", "sand", "stone", "cream", "natural", "oatmeal"],
  "türkiz": ["turquoise", "teal", "aqua", "cyan"],
  "krém": ["cream", "ivory", "off-white"],
  "arany": ["gold", "golden"],
  "ezüst": ["silver"],
};

// For swimwear: check name only — Shopify can miscategorize underwear as Swimwear
// (e.g. "UNREAL Panties 2 pack" has category "Swimwear" but is not swimwear)
const TYPE_FILTER_NAME_ONLY = new Set(["fürdőruha"]);

// For underwear: check full category path — distinguishes "Lingerie > Bodysuits" from
// "Clothing Tops > Bodysuits" (jumpsuits) which share the same last segment
const TYPE_FILTER_FULL_CATEGORY = new Set(["fehérnemű", "férfi fehérnemű", "női fehérnemű"]);

// Exclude underwear from shorts/nadrág type matches
const UNDERWEAR_EXCLUDE_RE = /\boxer\b|underwear|undergarment|lingerie|panties/i;

function productMatchesType(product: Product, canonicalType: string): boolean {
  const keywords = TYPE_FILTER_MAP[canonicalType];
  if (!keywords || keywords.length === 0) return true; // unknown type → don't filter

  const name = (product.name || "").toLowerCase();
  const fullCategory = (product.category || "").toLowerCase();
  // Use last category segment to avoid parent-path false positives
  // e.g., "Handbag & Wallet Accessories > Keychains" → last segment = "Keychains" (not "bag")
  const lastCatSegment = fullCategory.includes(">")
    ? fullCategory.split(">").pop()!.trim()
    : fullCategory;
  // Name-only for types where category can be misleading (swimwear miscategorization)
  // Full category for underwear — distinguishes lingerie bodysuits from clothing-top bodysuits
  // Bodysuits have their own category — exclude from underwear filter
  if (TYPE_FILTER_FULL_CATEGORY.has(canonicalType) && lastCatSegment.includes("bodysuit")) {
    return false;
  }

  // Exclude underwear from shorts/pants type matches ("Boxer Shorts" is not "rövidnadrág")
  if ((canonicalType === "rövidnadrág" || canonicalType === "nadrág") && UNDERWEAR_EXCLUDE_RE.test(name + " " + fullCategory)) {
    return false;
  }

  const searchText = TYPE_FILTER_NAME_ONLY.has(canonicalType)
    ? name
    : TYPE_FILTER_FULL_CATEGORY.has(canonicalType)
      ? `${name} ${fullCategory}`
      : `${name} ${lastCatSegment}`;

  return keywords.some((kw) => {
    // Word-boundary at start prevents "bag" matching inside "handbag"
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}`, "i").test(searchText);
  });
}

function productMatchesColor(product: Product, canonicalColor: string): boolean {
  const synonyms = COLOR_FILTER_MAP[canonicalColor];
  if (!synonyms || synonyms.length === 0) return true;

  // Primary: check product name with English synonyms — word-boundary regex
  // (simple includes() causes false positives: "ash" inside "washed", etc.)
  const name = (product.name || "").toLowerCase();
  if (synonyms.some((syn) => new RegExp(`\\b${syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(name))) return true;

  // Secondary: check ai_description using color detector
  // ai_description is in Hungarian and generated from name+desc → reliable color source
  const aiDesc = (product as any).ai_description;
  if (aiDesc) {
    const aiColors = detectColors(aiDesc);
    if (aiColors.has(canonicalColor as any)) return true;
  }

  return false;
}

function productMatchesGender(
  product: Product,
  genders: Set<"férfi" | "női" | "unisex">
): boolean {
  if (genders.size === 0) return true;
  const text = `${product.name || ""} ${product.category || ""}`.toLowerCase();
  const isWomens = /\bwmn\b|\bwomen\b|\bwomens\b|\bladies\b|\bfemale\b|\blingerie\b|\bbodysuit\b|\bbralette\b/.test(text);
  const isMens = /\bmen'?s\b|\bmale\b|\bmen's undergarment\b/.test(text) && !isWomens;

  if (genders.has("női")) return isWomens;
  if (genders.has("férfi")) return !isWomens; // non-women = men's or unisex
  if (genders.has("unisex")) return !isWomens && !isMens;
  return true;
}

interface FilterResult {
  primary: Product[];          // matches type + color
  secondary: Product[];        // doesn't match → goes to also_items
  colorFilterSkipped: boolean; // true when color requested but 0 matches in catalog
}

function applyHardFilters(
  candidates: Product[],
  allProducts: Product[],
  signals: QuerySignals
): FilterResult {
  const hasType = signals.types.length > 0;
  const hasColor = signals.colors.size > 0;
  const hasGender = signals.genders.size > 0;

  // If no explicit filter, return candidates as primary
  if (!hasType && !hasColor && !hasGender) {
    return { primary: candidates, secondary: [], colorFilterSkipped: false };
  }

  // Helper: product matches ANY of the requested types
  const matchesAnyType = (p: Product) =>
    signals.types.some((t) => productMatchesType(p, t));

  // Build candidate order map for relevance sorting
  const candidateOrder = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const id = String((candidates[i] as any).product_id || candidates[i].name || i);
    candidateOrder.set(id, i);
  }

  // Stage 1: Type filter
  // For explicit type: search the FULL catalog (not just hybridSearch top-N)
  // Sort: products from candidates first (by rank), rest appended at the end
  let base: Product[];
  if (hasType) {
    base = allProducts.filter(matchesAnyType);
    base.sort((a, b) => {
      const aId = String((a as any).product_id || a.name || "");
      const bId = String((b as any).product_id || b.name || "");
      const aRank = candidateOrder.get(aId) ?? 999999;
      const bRank = candidateOrder.get(bId) ?? 999999;
      return aRank - bRank;
    });
  } else {
    base = [...candidates];
  }

  console.log(
    `[hardFilter] type="${signals.type || "-"}" colors=[${[...signals.colors].join(",")}] ` +
    `genders=[${[...signals.genders].join(",")}] → after type filter: ${base.length} (types=[${signals.types.join(",")}])`
  );

  // Stage 2: Color filter (threshold = 1 — apply if ANY match found)
  let colorFilterSkipped = false;
  if (hasColor) {
    const colorMatched = base.filter((p) =>
      [...signals.colors].some((c) => productMatchesColor(p, c))
    );
    if (colorMatched.length >= 1) {
      base = colorMatched;
      console.log(`[hardFilter] Color filter applied: ${base.length} products`);
    } else {
      // No matching color in catalog → mark as skipped, move all to secondary
      colorFilterSkipped = true;
      console.log(`[hardFilter] Color filter: 0 matches → colorFilterSkipped, all become secondary`);
    }
  }

  // Stage 3: Gender filter (threshold = 1 — apply if ANY match found)
  if (hasGender) {
    const genderMatched = base.filter((p) => productMatchesGender(p, signals.genders));
    if (genderMatched.length >= 1) {
      base = genderMatched;
      console.log(`[hardFilter] Gender filter applied: ${base.length} products`);
    } else {
      console.log(`[hardFilter] Gender filter: 0 matches, skipping`);
    }
  }

  // If color filter was skipped (0 matches), treat type-filtered products as secondary
  // so they appear as "also_items" with a notice instead of items without explanation.
  // Only include type-matched products (base) — not unrelated hybridSearch candidates.
  if (colorFilterSkipped) {
    console.log(`[hardFilter] colorFilterSkipped: primary=0, secondary=${base.length} (type-filtered only)`);
    return { primary: [], secondary: base, colorFilterSkipped: true };
  }

  // Secondary: candidates not in primary (for also_items)
  const primaryIds = new Set(
    base.map((p) => String((p as any).product_id || p.name || ""))
  );
  const secondary = candidates.filter(
    (p) => !primaryIds.has(String((p as any).product_id || p.name || ""))
  );

  console.log(`[hardFilter] Final: primary=${base.length}, secondary=${secondary.length}`);

  return { primary: base, secondary, colorFilterSkipped: false };
}

/* ============================================================
   HELPERS
   ============================================================ */

function toNumberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function normalizeGender(g: any): "male" | "female" | "other" | "unknown" {
  const v = typeof g === "string" ? g.trim().toLowerCase() : "";
  if (v === "male" || v === "female" || v === "other" || v === "unknown") return v;
  return "unknown";
}

function getApiKeyFromReq(req: any): string {
  const h1 = req.headers["x-api-key"];
  const h2 = req.headers["x-mv-api-key"];
  const raw = (typeof h1 === "string" && h1) || (typeof h2 === "string" && h2) || "";
  return raw.trim();
}

// ----- CORS -----

function getOriginHost(origin: string): string {
  try {
    const u = new URL(origin);
    return (u.hostname || "").toLowerCase();
  } catch {
    return "";
  }
}

function domainMatches(host: string, allowed: string): boolean {
  const a = (allowed || "").trim().toLowerCase();
  if (!a) return false;
  if (host === a) return true;
  return host.endsWith("." + a);
}

function isOriginAllowedForPartner(origin: string, partner: any): boolean {
  const host = getOriginHost(origin);
  if (!host) return false;
  const list = Array.isArray(partner?.allowed_domains) ? partner.allowed_domains : [];
  if (list.length === 0) return true;
  return list.some((d: string) => domainMatches(host, String(d)));
}

function applyCors(res: any, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-mv-api-key, x-api-key");
}

// ----- Rate limit -----

type Bucket = { timestamps: number[] };
const buckets: Record<string, Bucket> = {};

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000) || 60_000;
const RECOMMEND_MAX = Number(process.env.RATE_LIMIT_RECOMMEND_MAX || 60) || 60;
const STATUS_MAX = Number(process.env.RATE_LIMIT_STATUS_MAX || 120) || 120;
const CLICK_MAX = Number(process.env.RATE_LIMIT_CLICK_MAX || 300) || 300;

function hitRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const k = key || "unknown";
  if (!buckets[k]) buckets[k] = { timestamps: [] };
  buckets[k].timestamps = buckets[k].timestamps.filter((t) => t >= cutoff);
  if (buckets[k].timestamps.length >= limit) return true;
  buckets[k].timestamps.push(now);
  return false;
}

// ----- Site/partner resolution -----

function resolveSiteKeyOrBlock(
  req: any
): { siteKey: string; blocked: boolean; partner: any | null; reason?: string } {
  const apiKey = getApiKeyFromReq(req);
  const body = req.body || {};
  const requestedSiteKey =
    typeof body.site_key === "string" && body.site_key.trim() !== ""
      ? body.site_key.trim()
      : "default";

  if (requestedSiteKey === "default" && !apiKey) {
    return { siteKey: "default", blocked: false, partner: null };
  }
  if (!apiKey) {
    return { siteKey: "default", blocked: true, partner: null, reason: "API_KEY_REQUIRED" };
  }
  const partner = findPartnerByApiKey(apiKey);
  if (!partner) {
    return { siteKey: "default", blocked: true, partner: null, reason: "INVALID_API_KEY" };
  }
  if (partner.blocked) {
    return { siteKey: partner.site_key, blocked: true, partner, reason: "PARTNER_BLOCKED" };
  }
  return { siteKey: partner.site_key, blocked: false, partner };
}

function resolveSiteKeyForStatus(req: any): { siteKey: string; partner: any | null } {
  const apiKey = getApiKeyFromReq(req);
  const requestedSiteKey =
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== ""
      ? req.query.site_key.trim()
      : "default";
  if (!apiKey) return { siteKey: requestedSiteKey, partner: null };
  const partner = findPartnerByApiKey(apiKey);
  if (!partner) return { siteKey: requestedSiteKey, partner: null };
  return { siteKey: partner.site_key, partner };
}

// ----- Preflight -----

function handlePreflight(req: any, res: any) {
  const origin = req.headers.origin as string | undefined;
  const apiKey = getApiKeyFromReq(req);
  const partner = apiKey ? findPartnerByApiKey(apiKey) : null;
  if (origin) {
    if (partner && !isOriginAllowedForPartner(origin, partner)) {
      return res.status(403).end();
    }
    applyCors(res, origin);
  }
  return res.status(204).end();
}

router.options("/partner-status", handlePreflight);
router.options("/recommend", handlePreflight);
router.options("/partner-config", handlePreflight);
router.options("/track/product-open", handlePreflight);

// ----- partner-status -----

router.get("/partner-status", (req, res) => {
  const origin = req.headers.origin as string | undefined;
  const apiKey = getApiKeyFromReq(req);
  const { siteKey, partner } = resolveSiteKeyForStatus(req);

  if (origin && partner) {
    if (!isOriginAllowedForPartner(origin, partner)) {
      return res.status(403).json({ allowed: false, reason: "CORS_BLOCKED" });
    }
    applyCors(res, origin);
  } else if (origin && !partner) {
    applyCors(res, origin);
  }

  if (hitRateLimit(`status:${siteKey}`, STATUS_MAX)) {
    return res.status(429).json({ allowed: false, reason: "RATE_LIMIT" });
  }

  const requestedSiteKey =
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== ""
      ? req.query.site_key.trim()
      : "default";

  if (!apiKey) {
    if (requestedSiteKey === "default") {
      return res.json({ allowed: true, site_key: "default", settings: {}, full_widget_config: null });
    }
    return res.json({ allowed: false, reason: "API_KEY_REQUIRED" });
  }

  const p = findPartnerByApiKey(apiKey);
  if (!p) return res.json({ allowed: false, reason: "INVALID_API_KEY" });
  if (p.blocked) return res.json({ allowed: false, reason: "PARTNER_BLOCKED" });

  const partnerFull = findPartnerBySiteKey(p.site_key);
  const widgetConfig = (partnerFull as any)?.widget_config || null;
  const widgetCopy = (partnerFull as any)?.widget_copy || null;
  const widgetFields = (partnerFull as any)?.widget_fields || null;
  const relevance = (partnerFull as any)?.relevance || null;
  const widgetSchema = (partnerFull as any)?.widget_schema || null;
  const fullWidgetConfig = getPublicWidgetConfig(p.site_key);

  return res.json({
    allowed: true,
    site_key: p.site_key,
    settings: {
      theme_color: widgetConfig?.theme?.accent || null,
      widget_copy: widgetCopy,
      widget_fields: widgetFields,
      widget_config: widgetConfig,
      relevance,
      widget_schema: widgetSchema,
    },
    full_widget_config: fullWidgetConfig,
  });
});

// ----- partner-config -----

router.get("/partner-config", (req, res) => {
  const origin = req.headers.origin as string | undefined;
  const apiKey = getApiKeyFromReq(req);
  const requestedSiteKey =
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== ""
      ? req.query.site_key.trim()
      : "default";

  if (hitRateLimit(`config:${requestedSiteKey}`, STATUS_MAX)) {
    if (origin) applyCors(res, origin);
    return res.status(429).json({ ok: false, error: "RATE_LIMIT" });
  }

  if (!apiKey) {
    if (origin) applyCors(res, origin);
    if (requestedSiteKey === "default") {
      return res.json({ ok: true, site_key: "default", widget_config: null, mode: "demo" });
    }
    return res.status(403).json({ ok: false, error: "API_KEY_REQUIRED" });
  }

  const partner = findPartnerByApiKey(apiKey);
  if (!partner) {
    if (origin) applyCors(res, origin);
    return res.status(403).json({ ok: false, error: "INVALID_API_KEY" });
  }
  if (partner.blocked) {
    if (origin) applyCors(res, origin);
    return res.status(403).json({ ok: false, error: "PARTNER_BLOCKED" });
  }

  if (origin) {
    if (!isOriginAllowedForPartner(origin, partner)) {
      return res.status(403).json({ ok: false, error: "CORS_BLOCKED" });
    }
    applyCors(res, origin);
  }

  const p = findPartnerBySiteKey(partner.site_key);
  return res.json({
    ok: true,
    site_key: partner.site_key,
    widget_config: p && (p as any).widget_config ? (p as any).widget_config : null,
  });
});

// ----- track/product-open -----

router.post("/track/product-open", (req, res) => {
  const origin = req.headers.origin as string | undefined;
  try {
    const body = req.body || {};
    const { siteKey, blocked, partner, reason } = resolveSiteKeyOrBlock(req);

    if (origin && partner) {
      if (!isOriginAllowedForPartner(origin, partner)) return res.status(403).json({ ok: false, error: "CORS_BLOCKED" });
      applyCors(res, origin);
    } else if (origin && !partner) {
      applyCors(res, origin);
    }

    if (hitRateLimit(`click:${siteKey}`, CLICK_MAX)) {
      return res.status(429).json({ ok: false, error: "RATE_LIMIT" });
    }
    if (blocked) return res.status(403).json({ ok: false, error: reason || "PARTNER_BLOCKED" });

    const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
    recordProductOpenClick(siteKey, productId || undefined);
    return res.json({ ok: true });
  } catch (e) {
    console.error("track/product-open hiba:", e);
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
});

// ----- Product response mapper -----

function stripSizeSuffix(name: string): string {
  if (!name) return name;
  // Strip trailing size in parentheses: "(S)", "(M)", "(XS (XXS Fit))", "(EU 42)", etc.
  let n = name.replace(/\s*\((?:[^()]*|\([^()]*\))*\)\s*$/, "").trim();
  // Strip trailing size after separator: "- M", "/ L", etc.
  n = n.replace(/\s*[-–\/|]\s*(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{2,3})\s*$/i, "").trim();
  return n || name;
}

const REASON_FLUFF = [
  /a kényelmes viseletért/i,
  /viseletért[.!]?$/i,
  /kényelmes viseletet biztosít/i,
  /kiváló minőség[ű]?[.!]?$/i,
  /remek választás/i,
  /pont illik/i,
  /tökéletes választás/i,
  /must[- ]have/i,
];

/**
 * Post-process LLM reason: ha túl hosszú (>110 kar) vagy marketing flufft tartalmaz,
 * visszaesik a buildCardDescription factual formátumra.
 */
function sanitizeLLMReason(reason: string, product: any): string {
  if (!reason) return buildCardDescription(product) || product.name || "Ajánlott termék";
  if (reason.length > 200) return buildCardDescription(product) || product.name || "Ajánlott termék";
  if (reason.length < 50) return buildCardDescription(product) || product.name || "Ajánlott termék";
  if (REASON_FLUFF.some((p) => p.test(reason))) return buildCardDescription(product) || product.name || "Ajánlott termék";
  return reason;
}

function mapProductResponse(item: { product: any; reason: string }) {
  const product = item.product;
  const cardDescription = buildCardDescription(product);
  const reason = sanitizeLLMReason(item.reason || "", product) || cardDescription || product.name || "Ajánlott termék";
  return {
    product_id: product.product_id,
    name: stripSizeSuffix(product.name),
    price: product.price,
    price_currency: product.price_currency || null,
    category: product.category,
    description: cardDescription,
    full_description: product.description,
    image_url: product.image_url,
    product_url: product.product_url,
    reason,
  };
}

function makeAlsoItem(product: Product) {
  const desc = buildCardDescription(product);
  return { product_id: (product as any).product_id, name: stripSizeSuffix(product.name || ""), price: (product as any).price, price_currency: (product as any).price_currency || null, category: product.category, description: desc, full_description: (product as any).description, image_url: (product as any).image_url, product_url: (product as any).product_url, reason: desc || product.name || "Ajánlott termék" };
}

// ----- recommend -----

router.post("/recommend", async (req, res) => {
  const origin = req.headers.origin as string | undefined;
  const t0 = Date.now();

  try {
    const body = req.body || {};
    const { siteKey, blocked, partner, reason } = resolveSiteKeyOrBlock(req);

    if (origin && partner) {
      if (!isOriginAllowedForPartner(origin, partner)) {
        return res.status(403).json({ error: "CORS_BLOCKED" });
      }
      applyCors(res, origin);
    } else if (origin && !partner) {
      applyCors(res, origin);
    }

    if (hitRateLimit(`recommend:${siteKey}`, RECOMMEND_MAX)) {
      return res.status(429).json({ error: "RATE_LIMIT" });
    }
    if (blocked) {
      return res.status(403).json({ error: reason || "PARTNER_BLOCKED" });
    }

    const u = body.user && typeof body.user === "object" ? { ...body, ...body.user } : body;

    const budgetMin = toNumberOrNull(u.budget_min);
    const budgetMax = toNumberOrNull(u.budget_max);
    const age = toNumberOrNull(u.age);

    const rawInterests: string[] = Array.isArray(u.interests)
      ? u.interests
      : typeof u.interests === "string" && u.interests.length > 0
        ? u.interests.split(",").map((x: string) => x.trim())
        : [];

    const rawFreeText = String(
      (u.query as string) || (u.free_text as string) || ""
    ).trim();

    const user: UserContext = {
      age: age ?? undefined,
      gender: normalizeGender(u.gender),
      budget_min: budgetMin ?? undefined,
      budget_max: budgetMax ?? undefined,
      relationship: (u.relationship as string) || undefined,
      interests: rawInterests,
      free_text: rawFreeText,
      site_key: siteKey,
    };

    // ================================================================
    // Load catalog
    // ================================================================
    const allProducts = getProductsForSite(siteKey || "default");
    if (!allProducts || allProducts.length === 0) {
      return res.json({
        items: [],
        also_items: [],
        notice: "Ebben a webshopban még nincs feltöltött termék.",
      });
    }

    // Filter out products with no price (e.g. "Mystery gift" with price=0)
    const allProductsFiltered = allProducts.filter((p) => {
      const price = (p as any).price;
      return typeof price === "number" && price > 0;
    });

    // ================================================================
    // Stage 1: Semantic + lexical retrieval
    // ================================================================
    const queryText = [rawFreeText, ...rawInterests].filter(Boolean).join(" ");
    let candidates = allProductsFiltered;
    const hybridScoreMap = new Map<string, number>(); // product_id → hybridScore

    if (queryText.trim()) {
      try {
        // Embeddingeket visszarakjuk a termékekre a kereséshez (katalógusban már nincs bennük)
        const productsForSearch = enrichWithCachedEmbeddings(siteKey || "default", allProductsFiltered);
        const hybridResults = await hybridSearch(queryText, productsForSearch, {
          topK: 400,
          minResults: 30,
          maxResults: 150,
        });
        if (hybridResults.length > 0) {
          candidates = hybridResults.map((r) => r.product);
          for (const r of hybridResults) {
            hybridScoreMap.set(String((r.product as any).product_id || r.product.name), r.finalScore);
          }
          console.log(
            `[recommend] HybridSearch: ${hybridResults.length} candidates, top score: ${hybridResults[0]?.finalScore.toFixed(3)}`
          );
        }
      } catch (e) {
        console.error("[recommend] HybridSearch failed, using full catalog:", e);
      }
    }

    // ================================================================
    // Stage 2: HARD TYPE + COLOR + GENDER PRE-FILTER (deterministic)
    // Az LLM ELŐTT szűrünk – csak a megfelelő típusú/színű termékek
    // kerülnek az items jelöltek közé.
    // ================================================================
    const querySignals = parseQuery(queryText);

    // Incorporate widget gender field into hard filter (user.gender = "male"/"female")
    if (user.gender === "male" && !querySignals.genders.has("férfi")) {
      querySignals.genders.add("férfi");
    } else if (user.gender === "female" && !querySignals.genders.has("női")) {
      querySignals.genders.add("női");
    }

    let { primary, secondary, colorFilterSkipped } = applyHardFilters(candidates, allProductsFiltered, querySignals);

    // ================================================================
    // Stage 3: Budget hard filter
    // Ha vannak termékek az ár-tartományon belül → csak azok kerülnek items-be.
    // Ha nincs egy sem → primary→secondary (also_items), notice jelzi.
    // ================================================================
    const hasBudgetMax = typeof user.budget_max === "number" && Number.isFinite(user.budget_max) && user.budget_max > 0;
    const hasBudgetMin = typeof user.budget_min === "number" && Number.isFinite(user.budget_min) && user.budget_min > 0;
    let budgetFilterSkipped = false;

    if ((hasBudgetMin || hasBudgetMax) && !colorFilterSkipped && primary.length > 0) {
      const withinBudget = primary.filter((p) => {
        const price = parsePrice((p as any).price);
        if (price === null) return true; // áratlan termék: beengedjük
        if (hasBudgetMin && price < user.budget_min!) return false;
        if (hasBudgetMax && price > user.budget_max!) return false;
        return true;
      });

      if (withinBudget.length >= 1) {
        const withinIds = new Set(withinBudget.map((p) => String((p as any).product_id || p.name || "")));
        const outOfBudget = primary.filter((p) => !withinIds.has(String((p as any).product_id || p.name || "")));
        secondary = [...outOfBudget, ...secondary];
        primary = withinBudget;
        console.log(`[recommend] Budget filter: ${withinBudget.length} within budget, ${outOfBudget.length} moved to secondary`);
      } else {
        budgetFilterSkipped = true;
        secondary = primary; // csak a típusszűrt, de túl drága termékek kerülnek secondary-be
        primary = [];
        console.log(`[recommend] Budget filter: 0 within budget → budgetFilterSkipped, ${secondary.length} moved to secondary`);
      }
    }

    // Deduplicate size variants before LLM (same product in multiple sizes → 1 entry)
    const primaryDeduped = dedupeByBaseProduct(primary);
    const secondaryRaw = dedupeByBaseProduct(secondary);
    // Sort also_items: type-matching products first (e.g. other swimwear before unrelated items)
    const secondaryDeduped = querySignals.types.length > 0
      ? [
          ...secondaryRaw.filter((p) => querySignals.types.some((t) => productMatchesType(p, t))),
          ...secondaryRaw.filter((p) => !querySignals.types.some((t) => productMatchesType(p, t))),
        ]
      : secondaryRaw;

    // ================================================================
    // Stage 4: LLM rerank (top 28 primary → items + also_items)
    // ================================================================
    const MAX_FOR_LLM = 28;
    const top50Primary = primaryDeduped.slice(0, MAX_FOR_LLM);

    // Strict mode: active when explicit type/color/gender/budget filter was applied.
    const hasHardFilter = !!(querySignals.types.length > 0 || querySignals.colors.size > 0 || querySignals.genders.size > 0 || hasBudgetMax || hasBudgetMin);

    // ----------------------------------------------------------------
    // INSTANT PATH: ha az importált katalógusnak van előre generált
    // AI leirása (ai_description), teljesen kihagyjuk az LLM-et.
    // Embedding-rangsor + tárolt leirás → <200ms válaszidő.
    // ----------------------------------------------------------------
    const catalogHasDescriptions = allProducts.length > 0 && !!(allProducts[0] as any).ai_description;

    // Negatív constraint hard filter ("logo nélküli", "without logo", stb.)
    // Az ai_description alapján szűr — determinisztikus, nem kell LLM.
    // A TELJES deduped listán fut (nem csak top28), mert az embedding search
    // a negatív keresés miatt rossz sorrendet ad (a "logo" szó matcheli a logósakat is).
    const negativeConstraints = detectNegativeConstraints(rawFreeText || "");
    let primaryFiltered = primaryDeduped;
    let secondaryFiltered = secondaryDeduped;
    if (negativeConstraints.length > 0 && catalogHasDescriptions) {
      primaryFiltered = applyNegativeHardFilter(primaryDeduped, negativeConstraints);
      secondaryFiltered = applyNegativeHardFilter(secondaryDeduped, negativeConstraints);
      console.log(`[recommend] Negative hard filter (${negativeConstraints.join(", ")}): ${primaryDeduped.length}→${primaryFiltered.length} primary, ${secondaryDeduped.length}→${secondaryFiltered.length} secondary`);

      if (primaryFiltered.length === 0 && secondaryFiltered.length === 0) {
        console.log(`[recommend] Negative filter: 0 results → returning empty`);
        return res.json({
          items: [],
          also_items: [],
          notice: "Sajnos a katalógusban nem találtunk ilyen terméket. Próbálj más keresést!",
        });
      }
    }

    // POSITIVE ATTRIBUTE HARD FILTER
    // Ha a user pozitív attribútumot kér (pl. "csíkos", "oversized", "slim fit"),
    // és VAN hard filter (type/color/gender) → csak a már szűrt listán belül szűrünk.
    // Ha NINCS hard filter → a TELJES katalógusból szűrünk (hogy ne csak hybridSearch top-N-ből).
    const detectedAttrs: AttributeDef[] = catalogHasDescriptions ? detectAttributes(rawFreeText || "") : [];
    let positiveAttrUnmatched: Product[] = [];
    if (detectedAttrs.length > 0) {
      // If hard filter is active → search within filtered results (respect type/color)
      // If no hard filter → search full catalog (find ALL matching products)
      const searchBase = hasHardFilter
        ? primaryFiltered
        : dedupeByBaseProduct(allProductsFiltered);

      const { matched, unmatched } = applyPositiveAttributeFilter(searchBase, detectedAttrs);

      if (matched.length > 0) {
        // Sort: products from hybridSearch candidates first (by relevance), rest appended
        // When no type filter: deprioritize accessories (socks, belts, keychains etc.)
        const ACCESSORY_CAT_RE = /\bsocks?\b|\bzokni\b|\bbelt\b|\böv\b|\bkeychain\b|\bphone case\b|\bscarf\b|\bsál\b|\bbalaclavas?\b|\bhat\b|\bcap\b|\bbeanie\b/i;
        const noTypeFilter = querySignals.types.length === 0;
        const candidateOrder = new Map<string, number>();
        for (let i = 0; i < primaryFiltered.length; i++) {
          candidateOrder.set(String((primaryFiltered[i] as any).product_id), i);
        }
        matched.sort((a, b) => {
          // Accessories go to the end when no explicit type filter
          if (noTypeFilter) {
            const aCat = (a.category || "").split(">").pop()?.trim() || "";
            const bCat = (b.category || "").split(">").pop()?.trim() || "";
            const aAcc = ACCESSORY_CAT_RE.test(aCat);
            const bAcc = ACCESSORY_CAT_RE.test(bCat);
            if (aAcc !== bAcc) return aAcc ? 1 : -1;
          }
          const aRank = candidateOrder.get(String((a as any).product_id)) ?? 999999;
          const bRank = candidateOrder.get(String((b as any).product_id)) ?? 999999;
          return aRank - bRank;
        });

        positiveAttrUnmatched = hasHardFilter
          ? unmatched
          : primaryFiltered.filter((p) => !new Set(matched.map((m) => String((m as any).product_id))).has(String((p as any).product_id)));

        primaryFiltered = matched;
        secondaryFiltered = positiveAttrUnmatched;

        console.log(`[recommend] Positive attr filter (${getAttributeDisplayNames(detectedAttrs)}): ${hasHardFilter ? "within hard-filtered" : "full catalog"} → ${primaryFiltered.length} matched, ${positiveAttrUnmatched.length} unmatched`);
      } else {
        const attrNames = getAttributeDisplayNames(detectedAttrs);
        const alsoFallback = (hasHardFilter ? unmatched : primaryFiltered).slice(0, 6);
        console.log(`[recommend] Positive attr filter: 0 exact matches → notice + ${alsoFallback.length} also_items`);
        return res.json({
          items: [],
          also_items: alsoFallback.map((p) => makeAlsoItem(p)),
          notice: `Sajnos nem találtunk ${attrNames} terméket a katalógusban. Íme néhány hasonló ajánlat:`,
        });
      }
    }

    const top50Filtered = primaryFiltered.slice(0, MAX_FOR_LLM);

    // FAST PATH fallback: ha nincs előre generált leirás de van explicit szűrő
    const FAST_PATH = !catalogHasDescriptions && hasHardFilter && top50Filtered.length >= 4;

    let rerankResult: { items: { product: any; reason: string }[]; also_items: { product: any; reason: string }[]; notice?: string | null };

    function getAiReason(p: any): string {
      return (p as any).ai_description || buildCardDescription(p) || (p as any).name || "Ajánlott termék";
    }

    if (catalogHasDescriptions) {
      // INSTANT PATH: nincs LLM, embedding-rangsor + tárolt leirás
      // Ha attr filter futott, primaryFiltered már a teljes katalógusból szűrt.
      // Fashion scoring-gal rendezzük a találatokat relevancia szerint.
      const MAX_ITEMS = 8;
      let primaryItems: Product[];
      let instantAlso: Product[] = [];

      // ── Fashion tags scoring: parse free_text for structured fashion concepts ──
      const fashionQuery = parseFashionQuery(rawFreeText || "");
      const hasFashionQuery = Object.keys(fashionQuery).length > 0;

      // Accessory categories — deprioritize when no explicit type filter
      const ACCESSORY_CATS = /\bsocks?\b|\bzokni\b|\bbelt\b|\böv\b|\bkeychain\b|\bphone case\b|\bscarf\b|\bsál\b|\bbalaclavas?\b|\bhat\b|\bcap\b|\bbeanie\b/i;
      const isAccessory = (p: Product): boolean => {
        const cat = (p.category || "").split(">").pop()?.trim() || "";
        return ACCESSORY_CATS.test(cat);
      };

      if (hasFashionQuery && primaryFiltered.length > MAX_ITEMS) {
        // Score ALL filtered products by fashion_tags match, pick best 8
        // When no explicit type filter: deprioritize accessories (socks, belts, etc.)
        const noTypeFilter = querySignals.types.length === 0;
        const fashionScored = primaryFiltered.map((p) => ({
          product: p,
          fashionScore: scoreFashionTags((p as any).fashion_tags, fashionQuery),
          isAccessory: noTypeFilter && isAccessory(p),
        }));

        // Sort: main clothing first (by fashion score), then accessories
        fashionScored.sort((a, b) => {
          if (a.isAccessory !== b.isAccessory) return a.isAccessory ? 1 : -1;
          return b.fashionScore - a.fashionScore;
        });

        primaryItems = fashionScored.slice(0, MAX_ITEMS).map((s) => s.product);
        instantAlso = fashionScored.slice(MAX_ITEMS, MAX_ITEMS + 6).map((s) => s.product);
        console.log(`[recommend] INSTANT fashion_tags: top ${primaryItems.length} from ${primaryFiltered.length} (query: ${JSON.stringify(fashionQuery)})`);
      } else {
        primaryItems = primaryFiltered.slice(0, MAX_ITEMS);
      }

      // ── Smart free_text matching ──
      const HU_STOP_WORDS = new Set([
        "szereti", "szeretne", "keresek", "keres", "valami", "valamit", "legyen",
        "olyan", "mint", "nagyon", "inkabb", "inkább", "nekem", "neki", "számára",
        "szamara", "ajándék", "ajandek", "kéne", "kene", "kellene", "lenne",
        "szepen", "szépen", "mutat", "mutatna", "passzol", "passzolna", "illik",
        "illeszt", "hozzá", "hozza", "ehhez", "ahhoz", "olyat", "olyant",
        "amit", "amelyik", "amiben", "amivel", "amin", "amihez",
        "egy", "azt", "ezt", "meg", "még", "mar", "már", "igen", "nem",
        "van", "volt", "lesz", "fog", "kell", "lehet", "tud", "akar",
        "jól", "jol", "nagyon", "eleg", "elég", "tök", "tok", "túl", "tul",
        "looking", "want", "need", "like", "something", "find", "good", "nice",
        "really", "very", "that", "this", "with", "would", "could", "should",
      ]);

      const normalizeForMatch = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

      const consumedByAttr = detectedAttrs.length > 0
        ? (tok: string) => detectedAttrs.some((a) => a.synonyms.test(tok))
        : () => false;

      const freeTextTokens = rawFreeText
        ? rawFreeText.toLowerCase().split(/\s+/).filter((t) =>
            t.length > 2
            && !HU_STOP_WORDS.has(normalizeForMatch(t))
            && !querySignals.colors.has(t as any)
            && !querySignals.types.includes(t)
            && !consumedByAttr(t)
          )
        : [];

      // ── Free text token matching (for brand/collection/specific name searches) ──
      if (freeTextTokens.length > 0 && !hasFashionQuery) {
        const searchableText = (p: Product) =>
          normalizeForMatch(`${p.name || ""} ${(p as any).tags || ""} ${(p as any).ai_description || ""} ${p.description || ""}`);

        const scored = primaryItems.map((p) => {
          const text = searchableText(p);
          const matchCount = freeTextTokens.filter((tok) => text.includes(normalizeForMatch(tok))).length;
          return { product: p, matchCount, matchRatio: matchCount / freeTextTokens.length };
        });

        const strongMatches = scored.filter((s) => s.matchRatio >= 0.5);
        if (strongMatches.length >= 1 && strongMatches.length < primaryItems.length) {
          strongMatches.sort((a, b) => b.matchCount - a.matchCount);
          const nonMatched = scored.filter((s) => s.matchRatio < 0.5).map((s) => s.product);
          primaryItems = strongMatches.map((s) => s.product);
          if (instantAlso.length === 0) {
            instantAlso = [...nonMatched, ...secondaryFiltered].slice(0, 6);
          }
          console.log(`[recommend] INSTANT free_text filter: ${strongMatches.length} matched (tokens: ${freeTextTokens.join(",")})`);
        }
      }

      if (instantAlso.length === 0) {
        if (primaryItems.length < 5 && detectedAttrs.length > 0 && positiveAttrUnmatched.length > 0) {
          instantAlso = positiveAttrUnmatched.slice(0, 6);
        } else if (primaryItems.length < 5 && negativeConstraints.length > 0) {
          const unfilteredTop = primaryDeduped.slice(0, 8).filter(
            (p) => !primaryFiltered.includes(p)
          );
          instantAlso = unfilteredTop.slice(0, 6);
        } else {
          instantAlso = primaryItems.length < 5 ? secondaryFiltered.slice(0, 6) : [];
        }
      }

      console.log(`[recommend] INSTANT PATH: site=${siteKey} query="${queryText.slice(0, 60)}" primary=${primaryItems.length} also=${instantAlso.length}`);
      rerankResult = {
        items: primaryItems.map((p) => ({ product: p, reason: getAiReason(p) })),
        also_items: instantAlso.map((p) => ({ product: p, reason: getAiReason(p) })),
        notice: null,
      };
    } else if (FAST_PATH) {
      // FAST PATH: LLM csak 8 termékre reason-t ír (leirás generálás nélkül importált katalógus)
      const fastPrimary = top50Filtered.slice(0, 8);
      console.log(`[recommend] FAST PATH: site=${siteKey} query="${queryText.slice(0, 60)}" primary=${fastPrimary.length}`);
      const llmResult = await rerankWithLLM(user, fastPrimary, {
        strictMode: true,
        secondaryProducts: [],
      });
      rerankResult = {
        items: (llmResult.items.length > 0 ? llmResult.items : fastPrimary.map((p) => ({
          product: p,
          reason: buildCardDescription(p as any) || (p as any).name || "Ajánlott termék",
        }))).slice(0, 8),
        also_items: secondaryFiltered.slice(0, 6).map((p) => ({
          product: p,
          reason: buildCardDescription(p as any) || (p as any).name || "Ajánlott termék",
        })),
        notice: null,
      };
    } else {
      // LLM PATH: általános/kétértelmű lekérdezés, embedding-rangsor nem elég
      console.log(
        `[recommend] LLM rerank: site=${siteKey} query="${queryText.slice(0, 60)}" primary=${top50Filtered.length} secondary=${secondaryFiltered.length}`
      );

      const MAX_SECONDARY_FOR_LLM = 8;
      const secondaryForLLM = secondaryFiltered.slice(0, MAX_SECONDARY_FOR_LLM);

      // When primary is empty (colorFilterSkipped), pass secondary to LLM as input
      const noLLMPrimary = top50Filtered.length === 0 && secondaryForLLM.length > 0;
      const productsForLLM = noLLMPrimary ? secondaryForLLM : top50Filtered;
      const secondaryInput = noLLMPrimary ? [] : secondaryForLLM;

      rerankResult = await rerankWithLLM(user, productsForLLM, {
        strictMode: hasHardFilter && !noLLMPrimary,
        secondaryProducts: secondaryInput,
      });

      // When colorFilterSkipped: all LLM results go to also_items
      if (noLLMPrimary) {
        rerankResult.also_items = [...rerankResult.items, ...rerankResult.also_items];
        rerankResult.items = [];
      }
    }

    // ================================================================
    // Stage 5: Merge results (csak LLM PATH-ban fut)
    // ================================================================

    if (!catalogHasDescriptions && !FAST_PATH) {
      const noLLMPrimaryMerge = top50Primary.length === 0;
      if (hasHardFilter && !noLLMPrimaryMerge) {
        // Strict mode: guarantee ALL primary products appear in items.
        const seen = new Set<number>();
        const merged: typeof rerankResult.items = [];
        for (const it of [...rerankResult.items, ...rerankResult.also_items]) {
          const idx = top50Primary.indexOf(it.product);
          if (idx === -1 || seen.has(idx)) continue;
          seen.add(idx);
          merged.push(it);
        }
        for (let i = 0; i < top50Primary.length; i++) {
          if (!seen.has(i)) {
            const p = top50Primary[i] as any;
            merged.push({ product: top50Primary[i], reason: buildCardDescription(top50Primary[i] as any) || p.name || "Ajánlott termék" });
          }
        }
        rerankResult.items = merged.slice(0, 8);
        rerankResult.also_items = [];
      } else if (!noLLMPrimaryMerge) {
        // Non-strict: safety net if LLM put too few in items
        const MIN_ITEMS = Math.min(4, top50Primary.length);
        while (rerankResult.items.length < MIN_ITEMS && rerankResult.also_items.length > 0) {
          rerankResult.items.push(rerankResult.also_items.shift()!);
        }
      }
    }

    // No full match case: hard filter active but 0 primary products
    const noExactMatch = hasHardFilter && rerankResult.items.length === 0;
    // Few matches: 1-4 exact results — show supplementary also_items with a note
    const fewMatches = hasHardFilter && rerankResult.items.length > 0 && rerankResult.items.length < 5 && rerankResult.also_items.length > 0;

    const items = rerankResult.items.map(mapProductResponse);
    const alsoItems = rerankResult.also_items.map(mapProductResponse);

    // Notice: shown when no exact match or few matches
    let notice: string | null = null;
    if (colorFilterSkipped) {
      const colorList = [...querySignals.colors].join("/");
      notice = `${colorList ? colorList.charAt(0).toUpperCase() + colorList.slice(1) + " " : ""}${querySignals.type || "termék"} nem szerepel a kínálatban. Íme a legközelebb eső alternatívák:`;
    } else if (budgetFilterSkipped) {
      const wCfg = getPublicWidgetConfig(siteKey || "default");
      const currency = wCfg?.ui?.theme?.currency || "HUF";
      const currencySymbol = currency === "EUR" ? "€" : currency === "USD" ? "$" : "Ft";
      const fmt = (n: number) => currency === "HUF" ? n.toLocaleString("hu-HU") : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
      const fmtPrice = (n: number) => currency === "USD" ? `$${fmt(n)}` : currency === "EUR" ? `${fmt(n)} €` : `${fmt(n)} Ft`;
      const priceStr = hasBudgetMax && hasBudgetMin
        ? `${fmtPrice(user.budget_min!)}–${fmtPrice(user.budget_max!)} közötti`
        : hasBudgetMax
          ? `${fmtPrice(user.budget_max!)} alatti`
          : `${fmtPrice(user.budget_min!)} feletti`;
      notice = `${priceStr} ${querySignals.type || "termék"} nem szerepel a kínálatban. Íme a legközelebb eső alternatívák:`;
    } else if (noExactMatch) {
      notice = "A keresett termék nem szerepel a kínálatban. Íme a legközelebb eső alternatívák:";
    } else {
      notice = rerankResult.notice || null;
    }

    const durationMs = Date.now() - t0;
    console.log(
      `[recommend] Done: ${items.length} items, ${alsoItems.length} also_items, noExactMatch=${noExactMatch}, ${durationMs}ms`
    );

    try {
      if (items.length > 0 || alsoItems.length > 0) {
        recordRecommendation(siteKey, user as any, durationMs);
      }
    } catch (e) {
      console.error("Statisztika rögzítési hiba:", e);
    }

    return res.json({
      items,
      also_items: alsoItems,
      notice,
      message: notice,
      meta: {
        hasExactMatch: items.length > 0,
        candidates: top50Primary.length,
        durationMs,
      },
    });
  } catch (err: any) {
    console.error("Hiba a recommend endpointban:", err);
    try {
      const allProducts = getProductsForSite("default");
      if (allProducts && allProducts.length > 0) {
        const fallbackItems = allProducts.slice(0, 6).map((p) =>
          makeAlsoItem(p)
        );
        return res.json({
          items: fallbackItems,
          also_items: [],
          notice: "Technikai hiba, de íme néhány ajánlat.",
          meta: { hasExactMatch: false, fallback: true },
        });
      }
    } catch {}
    return res.status(500).json({ error: "Hiba történt az ajánlás során." });
  }
});

export default router;
