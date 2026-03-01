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
import { rerankWithLLM } from "../ai/rerank";
import { buildCardDescription } from "../reco/buildCardDescription";
import { parseQuery, QuerySignals } from "../search/signals";
import { dedupeByBaseProduct } from "../ai/queryUtils";
import { Product } from "../models/Product";

const router = Router();

/* ============================================================
   HARD TYPE / COLOR PRE-FILTER
   Determinisztikus szűrés az LLM elé – 100% garancia
   ============================================================ */

// Canonical Hungarian type → English keywords (match against product name + category)
const TYPE_FILTER_MAP: Record<string, string[]> = {
  "sapka": ["hat", "cap", "beanie", "snapback", "trucker", "bucket", "headwear"],
  "kapucnis pulóver": ["hoodie"],
  "pulóver": ["sweater", "crewneck", "jumper", "knit"],
  "melegítő felső": ["sweatshirt"],
  "blúz": ["blouse"],
  "póló": ["t-shirt", "tee"],
  "ing": ["shirt"],
  "top": ["tank top", "tank", "crop top"],
  "felső": ["top", "tank", "tee", "shirt"],
  "rövidnadrág": ["shorts", "short"],
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
  "hátizsák": ["backpack"],
  "zokni": ["socks", "sock"],
  "sál": ["scarf"],
  "öv": ["belt"],
  "ruha": ["dress"],
  "szoknya": ["skirt"],
  "fehérnemű": ["underwear", "boxer", "brief"],
  "fürdőruha": ["swimwear", "swim", "bikini"],
  "ékszer": ["jewelry", "necklace", "ring", "bracelet", "earring"],
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
  const searchText = `${name} ${lastCatSegment}`;

  return keywords.some((kw) => {
    // Word-boundary at start prevents "bag" matching inside "handbag"
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}`, "i").test(searchText);
  });
}

function productMatchesColor(product: Product, canonicalColor: string): boolean {
  const synonyms = COLOR_FILTER_MAP[canonicalColor];
  if (!synonyms || synonyms.length === 0) return true;

  // Check ONLY the product name — descriptions often list multiple available colors
  // and would cause false positives (e.g. "also available in black" matches everything)
  const searchText = (product.name || "").toLowerCase();
  return synonyms.some((syn) => searchText.includes(syn));
}

function productMatchesGender(
  product: Product,
  genders: Set<"férfi" | "női" | "unisex">
): boolean {
  if (genders.size === 0) return true;
  const text = `${product.name || ""} ${product.category || ""}`.toLowerCase();
  const isWomens = /\bwmn\b|\bwomen\b|\bwomens\b|\bladies\b|\bfemale\b/.test(text);
  const isMens = /\bmen\b|\bmens\b|\bmen'?s\b|\bmale\b/.test(text) && !isWomens;

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
  const hasType = !!signals.type;
  const hasColor = signals.colors.size > 0;
  const hasGender = signals.genders.size > 0;

  // If no explicit filter, return candidates as primary
  if (!hasType && !hasColor && !hasGender) {
    return { primary: candidates, secondary: [], colorFilterSkipped: false };
  }

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
  if (hasType && signals.type) {
    base = allProducts.filter((p) => productMatchesType(p, signals.type!));
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
    `genders=[${[...signals.genders].join(",")}] → after type filter: ${base.length}`
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
  if (reason.length > 160) return buildCardDescription(product) || product.name || "Ajánlott termék";
  if (reason.length < 30) return buildCardDescription(product) || product.name || "Ajánlott termék";
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

    // ================================================================
    // Stage 1: Semantic + lexical retrieval
    // ================================================================
    const queryText = [rawFreeText, ...rawInterests].filter(Boolean).join(" ");
    let candidates = allProducts;

    if (queryText.trim()) {
      try {
        // Embeddingeket visszarakjuk a termékekre a kereséshez (katalógusban már nincs bennük)
        const productsForSearch = enrichWithCachedEmbeddings(siteKey || "default", allProducts);
        const hybridResults = await hybridSearch(queryText, productsForSearch, {
          topK: 400,
          minResults: 30,
          maxResults: 150,
        });
        if (hybridResults.length > 0) {
          candidates = hybridResults.map((r) => r.product);
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
    let { primary, secondary, colorFilterSkipped } = applyHardFilters(candidates, allProducts, querySignals);

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
        if (hasBudgetMin && price < user.budget_min! * 0.9) return false;
        if (hasBudgetMax && price > user.budget_max! * 1.1) return false;
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
    const secondaryDeduped = dedupeByBaseProduct(secondary);

    // ================================================================
    // Stage 4: LLM rerank (top 50 primary → items + also_items)
    // ================================================================
    const MAX_FOR_LLM = 50;
    const top50Primary = primaryDeduped.slice(0, MAX_FOR_LLM);

    console.log(
      `[recommend] LLM rerank: site=${siteKey} query="${queryText.slice(0, 60)}" primary=${top50Primary.length} secondary=${secondaryDeduped.length}`
    );

    // Strict mode: active when explicit type/color/gender/budget filter was applied.
    // In strict mode, LLM only ranks + reasons; all primary products go to items.
    const hasHardFilter = !!(querySignals.type || querySignals.colors.size > 0 || querySignals.genders.size > 0 || hasBudgetMax || hasBudgetMin);

    // Include secondary candidates in the LLM call so they get Hungarian descriptions too
    const MAX_SECONDARY_FOR_LLM = 15;
    const secondaryForLLM = secondaryDeduped.slice(0, MAX_SECONDARY_FOR_LLM);

    // When primary is empty (colorFilterSkipped), pass secondary to LLM as input
    // but track that all results should appear in also_items (not items)
    const noLLMPrimary = top50Primary.length === 0 && secondaryForLLM.length > 0;
    const productsForLLM = noLLMPrimary ? secondaryForLLM : top50Primary;
    const secondaryInput = noLLMPrimary ? [] : secondaryForLLM;

    const rerankResult = await rerankWithLLM(user, productsForLLM, {
      strictMode: hasHardFilter && !noLLMPrimary,
      secondaryProducts: secondaryInput,
    });

    // When colorFilterSkipped: all LLM results go to also_items (not items)
    if (noLLMPrimary) {
      rerankResult.also_items = [...rerankResult.items, ...rerankResult.also_items];
      rerankResult.items = [];
    }

    // ================================================================
    // Stage 5: Merge results
    // items = full matches (all primary in strict mode, LLM picks otherwise)
    // also_items = LLM also_items (non-strict) + secondary candidates
    // ================================================================

    if (hasHardFilter && !noLLMPrimary) {
      // Strict mode: guarantee ALL primary products appear in items.
      // Merge LLM's items+also_items (LLM-ordered items first), then fill from top50Primary.
      const seen = new Set<number>();
      const merged: typeof rerankResult.items = [];
      for (const it of [...rerankResult.items, ...rerankResult.also_items]) {
        const idx = top50Primary.indexOf(it.product);
        if (idx === -1 || seen.has(idx)) continue;
        seen.add(idx);
        merged.push(it);
      }
      // Add any primary products the LLM missed
      for (let i = 0; i < top50Primary.length; i++) {
        if (!seen.has(i)) {
          const p = top50Primary[i] as any;
          merged.push({ product: top50Primary[i], reason: buildCardDescription(top50Primary[i] as any) || p.name || "Ajánlott termék" });
        }
      }
      rerankResult.items = merged.slice(0, 8);
      rerankResult.also_items = [];
    } else if (!noLLMPrimary) {
      // Non-strict: safety net if LLM put too few in items
      const MIN_ITEMS = Math.min(4, top50Primary.length);
      while (rerankResult.items.length < MIN_ITEMS && rerankResult.also_items.length > 0) {
        rerankResult.items.push(rerankResult.also_items.shift()!);
      }
    }
    // When noLLMPrimary: items=[], also_items=LLM results (already set above)

    // No full match case: hard filter active but 0 primary products
    const noExactMatch = hasHardFilter && rerankResult.items.length === 0;

    const items = rerankResult.items.map(mapProductResponse);
    const alsoItems = rerankResult.also_items.map(mapProductResponse);

    // Notice: shown when no exact match found
    let notice: string | null = null;
    if (colorFilterSkipped) {
      const colorList = [...querySignals.colors].join("/");
      notice = `${colorList ? colorList.charAt(0).toUpperCase() + colorList.slice(1) + " " : ""}${querySignals.type || "termék"} nem szerepel a kínálatban. Íme a legközelebb eső alternatívák:`;
    } else if (budgetFilterSkipped) {
      const fmt = (n: number) => n.toLocaleString("hu-HU");
      const priceStr = hasBudgetMax && hasBudgetMin
        ? `${fmt(user.budget_min!)}–${fmt(user.budget_max!)} Ft közötti`
        : hasBudgetMax
          ? `${fmt(user.budget_max!)} Ft alatti`
          : `${fmt(user.budget_min!)} Ft feletti`;
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
