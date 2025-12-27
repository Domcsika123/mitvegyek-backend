// src/routes/recommend.ts
import { Router } from "express";
import { getProductsForSite } from "../services/productService";
import { rankProductsWithEmbeddings } from "../ai/embeddings";
import { rerankWithLLM } from "../ai/rerank";
import { filterProductsByRules } from "../ai/rules";
import { UserContext } from "../models/UserContext";
import { recordRecommendation } from "../services/statsService";
import { findPartnerByApiKey } from "../services/partnerService";

const router = Router();

function toNumberOrNull(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

// Elfogadjuk mindkét header nevet (régi + widget)
function getApiKeyFromReq(req: any): string {
  const h1 = req.headers["x-api-key"];
  const h2 = req.headers["x-mv-api-key"];
  const raw = (typeof h1 === "string" && h1) || (typeof h2 === "string" && h2) || "";
  return raw.trim();
}

/**
 * SZABÁLY:
 * - default katalógus mehet apiKey nélkül (demo)
 * - nem-default katalógus CSAK érvényes apiKey-vel
 * - ha partner blokkolva => tiltás
 * - ha apiKey-hez nincs partner (törölt) => tiltás
 */
function resolveSiteKeyOrBlock(req: any): { siteKey: string; blocked: boolean } {
  const apiKey = getApiKeyFromReq(req);
  const body = req.body || {};

  const requestedSiteKey =
    typeof body.site_key === "string" && body.site_key.trim() !== ""
      ? body.site_key.trim()
      : "default";

  // Demo/default: engedjük apiKey nélkül
  if (requestedSiteKey === "default" && !apiKey) {
    return { siteKey: "default", blocked: false };
  }

  // Nem defaulthoz KÖTELEZŐ apiKey
  if (!apiKey) {
    return { siteKey: "default", blocked: true };
  }

  const partner = findPartnerByApiKey(apiKey);
  if (!partner) {
    return { siteKey: "default", blocked: true };
  }

  if (partner.blocked) {
    return { siteKey: partner.site_key, blocked: true };
  }

  // apiKey dönti el a site_key-t (nem a body!)
  return { siteKey: partner.site_key, blocked: false };
}

/**
 * Widgetnek: megkérdezi, hogy megjelenhet-e
 * GET /api/partner-status
 * Header: x-mv-api-key (vagy x-api-key)
 */
router.get("/partner-status", (req, res) => {
  const apiKey = getApiKeyFromReq(req);

  // fontos: a widget most már küldi query-ben
  const requestedSiteKey =
    typeof req.query.site_key === "string" && req.query.site_key.trim() !== ""
      ? req.query.site_key.trim()
      : "default";

  // ✅ DEMO csak akkor oké, ha default (különben ne jelenjen meg a widget)
  if (!apiKey) {
    if (requestedSiteKey === "default") {
      return res.json({ allowed: true, mode: "demo" });
    }
    return res.json({ allowed: false, reason: "API_KEY_REQUIRED" });
  }

  const partner = findPartnerByApiKey(apiKey);
  if (!partner) return res.json({ allowed: false, reason: "INVALID_API_KEY" });
  if (partner.blocked) return res.json({ allowed: false, reason: "PARTNER_BLOCKED" });

  return res.json({ allowed: true, site_key: partner.site_key });
});


router.post("/recommend", async (req, res) => {
  try {
    const body = req.body || {};

    const { siteKey, blocked } = resolveSiteKeyOrBlock(req);
    if (blocked) {
      return res.status(403).json({ error: "PARTNER_BLOCKED" });
    }

    const budgetMin = toNumberOrNull(body.budget_min);
    const budgetMax = toNumberOrNull(body.budget_max);
    const age = toNumberOrNull(body.age);

    const user: UserContext = {
      age: age ?? undefined,
      gender: (body.gender as string) || "unknown",
      budget_min: budgetMin ?? undefined,
      budget_max: budgetMax ?? undefined,
      relationship: (body.relationship as string) || undefined,
      interests: Array.isArray(body.interests)
        ? body.interests
        : typeof body.interests === "string" && body.interests.length > 0
        ? body.interests.split(",").map((x: string) => x.trim())
        : [],
      free_text: (body.free_text as string) || "",
      site_key: siteKey,
    };

    const allProducts = getProductsForSite(siteKey || "default");
    if (!allProducts || allProducts.length === 0) {
      return res.json({ items: [] });
    }

    const rankedByEmbedding = await rankProductsWithEmbeddings(user, allProducts);
    const topCandidates = rankedByEmbedding.slice(0, 20).map((r) => r.product);

    let afterRules = filterProductsByRules(user, topCandidates);
    if (afterRules.length === 0) {
      afterRules = topCandidates.slice(0, 10);
    }

    const finalRanked = await rerankWithLLM(user, afterRules);

    const items = finalRanked.map((r) => ({
      product_id: r.product.product_id,
      name: r.product.name,
      price: r.product.price,
      category: r.product.category,
      description: r.product.description,
      image_url: r.product.image_url,
      product_url: r.product.product_url,
      reason: r.reason,
    }));

    try {
      if (items.length > 0) {
        // nálad így van: recordRecommendation(siteKey, user)
        recordRecommendation(siteKey, user as any);
      }
    } catch (e) {
      console.error("Statisztika rögzítési hiba:", e);
    }

    return res.json({ items });
  } catch (err: any) {
    console.error("Hiba a recommend endpointban:", err);
    return res.status(500).json({ error: "Hiba történt az ajánlás során." });
  }
});

export default router;
