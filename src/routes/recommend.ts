// src/routes/recommend.ts
import { Router } from "express";
import { getProductsForSite } from "../services/productService";
import { rankProductsWithEmbeddings } from "../ai/embeddings";
import { UserContext } from "../models/UserContext";
import { recordProductOpenClick, recordRecommendation } from "../services/statsService";
import {
  findPartnerByApiKey,
  findPartnerBySiteKey,
} from "../services/partnerService";
import { getPublicWidgetConfig } from "../services/widgetConfigService";
import {
  buildNoExactMessage,
  buildQueryFromUserInput,
  rankProducts,
} from "../reco/ranker";
import { filterProductsByBudgetOnly, filterProductsMinimal } from "../ai/rules";
import { keywordSearch, mergeSearchResults } from "../ai/keywordSearch";
import { hybridSearch, ScoredProduct } from "../search/hybridSearch";
import { buildCardDescription } from "../reco/buildCardDescription";
import { parseQuery, signalsSummary } from "../search/signals";

const router = Router();

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

// Elfogadjuk mindkét header nevet (régi + widget)
function getApiKeyFromReq(req: any): string {
  const h1 = req.headers["x-api-key"];
  const h2 = req.headers["x-mv-api-key"];
  const raw = (typeof h1 === "string" && h1) || (typeof h2 === "string" && h2) || "";
  return raw.trim();
}

// ----- CORS (partner allowed_domains alapján) -----

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

  // ha nincs lista: backward-compatible
  if (list.length === 0) return true;

  return list.some((d: string) => domainMatches(host, String(d)));
}

function applyCors(res: any, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-mv-api-key, x-api-key");
}

// ----- Rate limit (site_key alapján) -----

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

// ----- site_key / partner resolve -----

function resolveSiteKeyOrBlock(
  req: any
): { siteKey: string; blocked: boolean; partner: any | null; reason?: string } {
  const apiKey = getApiKeyFromReq(req);
  const body = req.body || {};

  const requestedSiteKey =
    typeof body.site_key === "string" && body.site_key.trim() !== "" ? body.site_key.trim() : "default";

  // Demo/default: engedjük apiKey nélkül
  if (requestedSiteKey === "default" && !apiKey) {
    return { siteKey: "default", blocked: false, partner: null };
  }

  // Nem defaulthoz KÖTELEZŐ apiKey
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
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== "" ? req.query.site_key.trim() : "default";

  if (!apiKey) {
    return { siteKey: requestedSiteKey, partner: null };
  }

  const partner = findPartnerByApiKey(apiKey);
  if (!partner) return { siteKey: requestedSiteKey, partner: null };

  return { siteKey: partner.site_key, partner };
}

// ----- OPTIONS (preflight) -----

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
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== "" ? req.query.site_key.trim() : "default";

  if (!apiKey) {
    if (requestedSiteKey === "default") {
      return res.json({ allowed: true, mode: "demo" });
    }
    return res.json({ allowed: false, reason: "API_KEY_REQUIRED" });
  }

  const p = findPartnerByApiKey(apiKey);
  if (!p) return res.json({ allowed: false, reason: "INVALID_API_KEY" });
  if (p.blocked) return res.json({ allowed: false, reason: "PARTNER_BLOCKED" });

  // ✅ widget_copy + widget_fields + relevance + widget_schema visszaadása
  const partnerFull = findPartnerBySiteKey(p.site_key);
  const widgetConfig = (partnerFull as any)?.widget_config || null;
  const widgetCopy = (partnerFull as any)?.widget_copy || null;
  const widgetFields = (partnerFull as any)?.widget_fields || null;
  const relevance = (partnerFull as any)?.relevance || null;
  const widgetSchema = (partnerFull as any)?.widget_schema || null;

  // ✅ ÚJ: full_widget_config (v2 schema-driven) – ha van, a widget ezt használja
  const fullWidgetConfig = getPublicWidgetConfig(p.site_key);

  return res.json({
    allowed: true,
    site_key: p.site_key,
    settings: {
      theme_color: widgetConfig?.theme?.accent || null,
      widget_copy: widgetCopy,
      widget_fields: widgetFields,
      widget_config: widgetConfig,
      // ✅ ÚJ: relevancia és widget séma
      relevance: relevance,
      widget_schema: widgetSchema,
    },
    // ✅ ÚJ: full widget config (v2)
    full_widget_config: fullWidgetConfig,
  });
});

// ----- partner-config -----

router.get("/partner-config", (req, res) => {
  const origin = req.headers.origin as string | undefined;
  const apiKey = getApiKeyFromReq(req);

  const requestedSiteKey =
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== "" ? req.query.site_key.trim() : "default";

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

// ----- recommend -----

// Store userQuery for reason generation
let _currentUserQuery = "";
let _currentMatchReasons: Map<string, string[]> = new Map();

function mapProductResponse(product: any) {
  // Use buildCardDescription for catalog-based description - ALWAYS use this for reason
  const cardDescription = buildCardDescription(product);
  
  // ✅ FIX: Always use catalog description as reason, never "polo típus" style
  const smartReason = cardDescription || product.name || "Ajánlott termék";
  
  return {
    product_id: product.product_id,
    name: product.name,
    price: product.price,
    category: product.category,
    description: cardDescription, // Use concise catalog-based description
    full_description: product.description, // Keep original for detail view
    image_url: product.image_url,
    product_url: product.product_url,
    reason: smartReason,
  };
}

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


    // Support both flat body AND nested {user: {...}} format
    const u = body.user && typeof body.user === "object" ? { ...body, ...body.user } : body;

    const budgetMin = toNumberOrNull(u.budget_min);
    const budgetMax = toNumberOrNull(u.budget_max);
    const age = toNumberOrNull(u.age);

    // Extract all relevant fields for filtering
    const queryString = (body.query as string) || (u.query as string) || (u.free_text as string) || "";
    const directClothingType = (u.clothing_type as string) || "";
    const color = (u.color as string) || (u.szin as string) || "";
    const style = (u.style as string) || (u.stilus as string) || "";
    const material = (u.material as string) || (u.anyag as string) || "";
    const type = (u.type as string) || (u.tipus as string) || directClothingType || "";

    const rawInterests: string[] = Array.isArray(u.interests)
      ? u.interests
      : typeof u.interests === "string" && u.interests.length > 0
        ? u.interests.split(",").map((x: string) => x.trim())
        : [];

    let rawFreeText = queryString;

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

    const allProducts = getProductsForSite(siteKey || "default");
    if (!allProducts || allProducts.length === 0) {
      return res.json({ items: [], also_items: [], notice: "Ebben a webshopban még nincs feltöltött termék." });
    }

    // ✅ HIGH-RECALL: Use new hybridSearch with signal boosting
    const TOP_CANDIDATES = Math.min(400, allProducts.length);
    const queryText = [rawFreeText, ...rawInterests].filter(Boolean).join(" ");
    
    // Parse query signals for debugging
    const signals = parseQuery(queryText);
    console.log(`[recommend] Query signals: ${signalsSummary(signals)}`);
    
    // Store query for reason generation
    _currentUserQuery = queryText;
    _currentMatchReasons.clear();
    
    // Try high-recall hybrid search first
    let shortlist = allProducts;
    let hybridResults: ScoredProduct[] = [];
    
    try {
      hybridResults = await hybridSearch(queryText, allProducts, {
        topK: TOP_CANDIDATES,
        minResults: 20,
        maxResults: 100, // Return ALL matching products, not just 30
      });
      
      if (hybridResults.length > 0) {
        shortlist = hybridResults.map((r) => r.product);
        
        // Store match reasons for each product
        for (const r of hybridResults) {
          const pAny = r.product as any;
          const id = pAny.product_id || pAny.id || r.product.name;
          _currentMatchReasons.set(id, r.matchReasons);
        }
        
        console.log(`[recommend] HybridSearch: ${hybridResults.length} results, top score: ${hybridResults[0]?.finalScore.toFixed(3)}`);
        // Log first 5 products in shortlist
        console.log(`[recommend] HybridSearch shortlist first 5: ${shortlist.slice(0,5).map((p:any) => p.name).join(", ")}`);
      }
    } catch (e) {
      console.error("[recommend] HybridSearch error, falling back:", e);
    }
    
    // Fallback to embedding search if hybrid failed
    let rankedByEmbedding: { product: any; score: number }[] = [];
    let bestEmbeddingScore = 0;
    
    if (hybridResults.length === 0) {
      try {
        rankedByEmbedding = await rankProductsWithEmbeddings(user, allProducts);
        if (Array.isArray(rankedByEmbedding) && rankedByEmbedding.length > 0) {
          bestEmbeddingScore = rankedByEmbedding[0]?.score || 0;
          shortlist = rankedByEmbedding.slice(0, TOP_CANDIDATES).map((r) => r.product);
        }
      } catch (e) {
        console.error("Embedding rangsorolás hiba:", e);
        shortlist = allProducts;
      }

      // Hybrid fallback: If embedding too weak, add keyword search
      const MIN_EMBEDDING_SCORE = 0.2;
      if (bestEmbeddingScore < MIN_EMBEDDING_SCORE || shortlist.length < 20) {
        try {
          const keywordResults = keywordSearch(queryText, allProducts, TOP_CANDIDATES);
          if (keywordResults.length > 0) {
            const merged = mergeSearchResults(rankedByEmbedding.slice(0, TOP_CANDIDATES), keywordResults, {
              embeddingWeight: 0.6,
              keywordWeight: 0.4,
              topK: TOP_CANDIDATES,
            });
            shortlist = merged.map((r) => r.product);
            console.log(`[recommend] Legacy hybrid: ${merged.length} candidates (best emb: ${bestEmbeddingScore.toFixed(3)})`);
          }
        } catch (e) {
          console.error("Keyword search hiba:", e);
        }
      }
    }

    const query = buildQueryFromUserInput({ ...u, ...user });
    console.log(`[recommend] Query built: type=${query.tipus}, color=${query.szin}, full query:`, JSON.stringify(query));
    
    // ✅ FIX: Apply budget filtering BEFORE ranking so max_ar works
    const budgetFilteredShortlist = filterProductsByBudgetOnly(user, shortlist);
    const catalogForRanking = filterProductsByBudgetOnly(user, allProducts);
    console.log(`[recommend] Budget filter: shortlist ${shortlist.length} -> ${budgetFilteredShortlist.length}, catalog ${allProducts.length} -> ${catalogForRanking.length}`);
    
    let ranked = rankProducts(query, budgetFilteredShortlist, {
      fullCatalog: catalogForRanking,
      includeDebug: false,
    });

    // ✅ FALLBACK: Ha rules után 0, lazítsunk
    if (ranked.items.length === 0) {
      // Először csak budget-re szűrés
      const budgetFiltered = filterProductsByBudgetOnly(user, shortlist);
      if (budgetFiltered.length > 0) {
        ranked = rankProducts(query, budgetFiltered, {
          fullCatalog: allProducts,
          includeDebug: false,
        });
      }
    }

    // Ha még mindig 0: minimális szűrés
    if (ranked.items.length === 0) {
      const minimalFiltered = filterProductsMinimal(shortlist);
      if (minimalFiltered.length > 0) {
        ranked = rankProducts(query, minimalFiltered, {
          fullCatalog: allProducts,
          includeDebug: false,
        });
      }
    }

    // ✅ LOGGING: detailed debug info
    const searchMode = hybridResults.length > 0 ? 'hybrid' : (bestEmbeddingScore > 0 ? 'embedding' : 'fallback');
    console.log(`[recommend] site=${siteKey} mode=${searchMode} all=${allProducts.length} shortlist=${shortlist.length} final=${ranked.items.length}`);

    // ✅ SMART SPLITTING: When hasExactMatch=true, main list contains ONLY exact matches
    // Partial matches (A/B/C groups) go to "also_items" automatically
    const MAX_ITEMS = 12;
    const MAX_ALSO_ITEMS = 100; // Increased to show more also_items
    
    let mainProducts, alsoProducts;
    
    if (ranked.meta.hasExactMatch) {
      const fullCount = ranked.meta.groupsCount.FULL || 0;
      
      // SMART LOGIC: 
      // - If fullCount <= MAX_ITEMS: show ALL FULL in main, A/B/C in also_items
      // - If fullCount > MAX_ITEMS: show first MAX_ITEMS FULL in main, rest in also_items
      // This ensures "cipő" query with 50 shoes shows 12 main + 38 also_items
      if (fullCount <= MAX_ITEMS) {
        // Few FULL matches: show all in main
        mainProducts = ranked.items.slice(0, fullCount);
        alsoProducts = ranked.items.slice(fullCount, fullCount + MAX_ALSO_ITEMS);
        console.log(`[recommend] Exact match split: ${fullCount} FULL → main, rest → also_items`);
      } else {
        // Many FULL matches: cap main at MAX_ITEMS, rest go to also_items
        mainProducts = ranked.items.slice(0, MAX_ITEMS);
        alsoProducts = ranked.items.slice(MAX_ITEMS, MAX_ITEMS + MAX_ALSO_ITEMS);
        console.log(`[recommend] Many FULL matches (${fullCount}): ${MAX_ITEMS} → main, ${Math.min(fullCount - MAX_ITEMS + (ranked.meta.groupsCount.A || 0), MAX_ALSO_ITEMS)} → also_items`);
      }
    } else {
      // No exact matches: use standard split
      mainProducts = ranked.items.slice(0, MAX_ITEMS);
      alsoProducts = ranked.items.slice(MAX_ITEMS, MAX_ITEMS + MAX_ALSO_ITEMS);
    }

    const items = mainProducts.map(mapProductResponse);
    const alsoItems = alsoProducts.map(mapProductResponse);

    // CRITICAL: Only show message when hasExactMatch=false
    const message = ranked.meta.hasExactMatch
      ? null
      : buildNoExactMessage(query, { locale: "hu" });

    // ✅ stat: sikeres ajánlásnál mérünk időt
    try {
      if (items.length > 0 || alsoItems.length > 0) {
        const durationMs = Date.now() - t0;
        recordRecommendation(siteKey, user as any, durationMs);
      }
    } catch (e) {
      console.error("Statisztika rögzítési hiba:", e);
    }

    return res.json({
      items,
      also_items: alsoItems,
      message,
      // Backward compatibility: legacy notice key (but now correctly null when exact match)
      notice: message,
      meta: ranked.meta,
    });
  } catch (err: any) {
    console.error("Hiba a recommend endpointban:", err);
    // ✅ JAVÍTOTT: Ne 500, hanem próbáljunk fallback választ adni
    try {
      const allProducts = getProductsForSite("default");
      if (allProducts && allProducts.length > 0) {
        const fallbackItems = allProducts.slice(0, 6).map(mapProductResponse);
        return res.json({
          items: fallbackItems,
          also_items: [],
          message: "Hiba történt, de íme néhány ajánlat.",
          notice: "Hiba történt, de íme néhány ajánlat.",
          meta: { hasExactMatch: false, fallback: true },
        });
      }
    } catch {}
    return res.status(500).json({ error: "Hiba történt az ajánlás során." });
  }
});

export default router;
