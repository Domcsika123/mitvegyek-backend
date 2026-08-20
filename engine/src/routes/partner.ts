// src/routes/partner.ts
import { Router } from "express";
import { authenticatePartner } from "../services/partnerService";
import { getStatsForSite } from "../services/statsService";
import { createFeedback, listFeedbackForSite } from "../services/feedbackService";
import { createPartnerToken, partnerAuth } from "../middleware/partnerAuth";
import { getProductsForSite } from "../services/productService";
import { getAllCustomTags, setProductTags } from "../services/productTagsService";

const router = Router();

/**
 * POST /api/partner/login
 * body: { site_key, api_key }
 * resp: { ok, token, expires_in, site_key, name }
 */
router.post("/login", (req, res) => {
  try {
    const { site_key, api_key } = req.body || {};
    if (!site_key || !api_key) {
      return res.status(400).json({ error: "site_key és api_key kötelező." });
    }

    const partner = authenticatePartner(String(site_key), String(api_key));
    if (!partner) return res.status(401).json({ error: "Hibás site_key / api_key vagy blokkolva." });

    const { token, expires_in } = createPartnerToken(partner.site_key);
    return res.json({ ok: true, token, expires_in, site_key: partner.site_key, name: partner.name });
  } catch (err) {
    console.error("Hiba a /api/partner/login hívásban:", err);
    return res.status(500).json({ error: "Szerver hiba partner login közben." });
  }
});

// --- védett végpontok ---
router.get("/stats", partnerAuth, (req, res) => {
  try {
    const siteKey = String((req as any).partnerSiteKey || "").trim();
    const stats = getStatsForSite(siteKey);

    // ha nincs még stat, adjunk vissza üreset
    return res.json({
      ok: true,
      siteKey,
      stats: stats || {
        siteKey,
        totalRequests: 0,
        lastRequestAt: undefined,
        dailyCounts: [],
        interestsCount: {},
        priceBuckets: { "0-5000": 0, "5001-10000": 0, "10001-20000": 0, "20001+": 0 },
        freeTextCount: {},
        genderCount: {},
        relationshipCount: {},
      },
    });
  } catch (err) {
    console.error("Hiba a /api/partner/stats hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a statisztikát." });
  }
});

router.post("/feedback", partnerAuth, (req, res) => {
  try {
    const siteKey = String((req as any).partnerSiteKey || "").trim();
    const item = createFeedback(siteKey, req.body || {});
    return res.json({ ok: true, item });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("kötelező")) return res.status(400).json({ error: msg });
    console.error("Hiba a /api/partner/feedback hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült elmenteni a bejelentést." });
  }
});

router.get("/feedback", partnerAuth, (req, res) => {
  try {
    const siteKey = String((req as any).partnerSiteKey || "").trim();
    const items = listFeedbackForSite(siteKey).slice(0, 30);
    return res.json({ ok: true, siteKey, items });
  } catch (err) {
    console.error("Hiba a /api/partner/feedback (GET) hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a bejelentéseket." });
  }
});

// ──────────────────────────────────────────────────────────────────────
// TERMÉK TAG KEZELÉS
// ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/partner/products?search=&page=1&pageSize=20
 * Visszaadja a webshop termékeit lapozva, a custom tagekkel együtt.
 */
router.get("/products", partnerAuth, (req, res) => {
  try {
    const siteKey = String((req as any).partnerSiteKey || "").trim();
    const search = String(req.query.search || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || "20"), 10) || 20));

    const allProducts = getProductsForSite(siteKey);
    const customTags = getAllCustomTags(siteKey);

    let filtered = allProducts;
    if (search) {
      filtered = allProducts.filter((p) => {
        const text = `${p.name || ""} ${(p as any).tags || ""} ${p.category || ""}`.toLowerCase();
        return text.includes(search);
      });
    }

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const paged = filtered.slice(offset, offset + pageSize);

    const items = paged.map((p) => ({
      product_id: (p as any).product_id,
      name: p.name,
      category: p.category,
      price: (p as any).price,
      price_currency: (p as any).price_currency,
      image_url: (p as any).image_url,
      tags: (p as any).tags || "",
      custom_tags: customTags[(p as any).product_id] || [],
    }));

    return res.json({ ok: true, total, page, pageSize, items });
  } catch (err) {
    console.error("Hiba a /api/partner/products hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a termékeket." });
  }
});

/**
 * POST /api/partner/products/:product_id/tags
 * body: { tags: string[] }   OR   { tags: "tag1, tag2, tag3" }
 * Beállítja egy termék custom AI tagjeit.
 */
router.post("/products/:product_id/tags", partnerAuth, (req, res) => {
  try {
    const siteKey = String((req as any).partnerSiteKey || "").trim();
    const productId = String(req.params.product_id || "");
    const rawTags = (req.body || {}).tags;

    let tags: string[];
    if (Array.isArray(rawTags)) {
      tags = rawTags.map(String);
    } else if (typeof rawTags === "string") {
      tags = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
    } else {
      tags = [];
    }

    setProductTags(siteKey, productId, tags);
    return res.json({ ok: true, product_id: productId, custom_tags: tags });
  } catch (err) {
    console.error("Hiba a /api/partner/products/:id/tags hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült menteni a tageket." });
  }
});

export default router;
