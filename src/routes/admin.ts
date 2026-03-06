// src/routes/admin.ts
import { Router } from "express";
import { listCatalogs, replaceCatalog, deleteCatalog } from "../services/productService";
import { getAllStats } from "../services/statsService";
import { Product } from "../models/Product";
import { embedProductsInBatches } from "../ai/embeddings";
import { generateProductDescriptions } from "../ai/generateDescriptions";
import { listAllFeedback, updateFeedback } from "../services/feedbackService";
import {
  createPartner,
  listPartners,
  deletePartner,
  findPartnerBySiteKey,
  setPartnerBlocked,
  setPartnerAllowedDomains,
  rotatePartnerApiKey,
  // ✅ Widget config
  getPartnerWidgetConfig,
  setPartnerWidgetConfig,
  clearPartnerWidgetConfig,
  // ✅ Widget copy + fields (boltonként testreszabható)
  getPartnerWidgetCopy,
  setPartnerWidgetCopy,
  getPartnerWidgetFields,
  setPartnerWidgetFields,
  // ✅ Relevance + widget schema (fashion preset)
  getPartnerRelevance,
  setPartnerRelevance,
  getPartnerWidgetSchema,
  setPartnerWidgetSchema,
  applyFashionPreset,
  getDefaultFashionSchema,
} from "../services/partnerService";
import {
  getFullWidgetConfig,
  saveFullWidgetConfig,
  resetFullWidgetConfig,
  applyPreset,
  listPresets,
} from "../services/widgetConfigService";
import { PresetName } from "../config/widgetConfig";

const router = Router();

/* ---------- KATALÓGUSOK ---------- */

router.get("/catalogs", (req, res) => {
  try {
    const catalogs = listCatalogs();
    return res.json({ catalogs });
  } catch (err) {
    console.error("Hiba a /api/admin/catalogs hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a katalógusokat." });
  }
});

router.post("/import-products", async (req, res) => {
  const { site_key, items } = req.body || {};

  if (!site_key || typeof site_key !== "string") {
    return res.status(400).json({ error: "site_key kötelező és string legyen." });
  }
  const partner = findPartnerBySiteKey(site_key);
  if (!partner) {
    return res.status(400).json({ error: `Nincs ilyen partner vagy site_key: ${site_key}` });
  }
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "items tömb szükséges." });
  }

  const products: Product[] = [];
  for (const raw of items) {
    if (!raw) continue;
    const p: Product = {
      product_id: String(raw.product_id || "").trim(),
      name: String(raw.name || "").trim(),
      price: Number(raw.price ?? 0),
      category: String(raw.category || "").trim(),
      description: String(raw.description || "").trim(),
      image_url: raw.image_url ? String(raw.image_url) : undefined,
      product_url: raw.product_url ? String(raw.product_url) : undefined,
      tags: raw.tags ? String(raw.tags) : undefined,
      product_type: raw.product_type ? String(raw.product_type) : undefined,
      vendor: raw.vendor ? String(raw.vendor) : undefined,
    };
    if (!p.product_id || !p.name) {
      return res.status(400).json({ error: "Minden terméknek kell product_id és name mező." });
    }
    if (Number.isNaN(p.price)) {
      return res.status(400).json({ error: `Érvénytelen price érték a terméknél: ${p.product_id}` });
    }
    products.push(p);
  }

  try {
    const batchSize = Number(process.env.EMBED_BATCH_SIZE || 64) || 64;
    let embedded = products;
    try {
      embedded = await embedProductsInBatches(products, batchSize);
    } catch (e) {
      console.error("Embedding generálási hiba importkor:", e);
      return res.status(500).json({ error: "Embedding generálás sikertelen." });
    }

    let withDescriptions = embedded;
    try {
      console.log(`[admin] Generating AI descriptions for ${embedded.length} products...`);
      withDescriptions = await generateProductDescriptions(embedded);
    } catch (e) {
      console.error("[admin] Description generation failed (non-fatal, continuing without):", e);
    }

    replaceCatalog(site_key, withDescriptions, true);

    const count = withDescriptions.length;
    const embeddedCount = withDescriptions.filter((p: any) => Array.isArray(p.embedding)).length;
    const batchSizeUsed = batchSize;

    return res.json({ ok: true, site_key, count, embedded: embeddedCount, batchSize: batchSizeUsed });
  } catch (err) {
    console.error("Hiba a /api/admin/import-products hívásban:", err);
    return res.status(500).json({ error: "Ismeretlen szerverhiba az import során." });
  }
});

router.delete("/catalogs/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "site_key kötelező." });

    // katalógus törlés
    deleteCatalog(site_key);

    // ✅ ha van hozzá partner, reseteljük a widget szerkesztéseket is (default kék)
    const p = findPartnerBySiteKey(site_key);
    if (p) {
      clearPartnerWidgetConfig(site_key);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Hiba a /api/admin/catalogs/:site_key (DELETE) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a katalógus törlése során." });
  }
});


/* ---------- STATISZTIKA ---------- */

router.get("/stats", (req, res) => {
  try {
    const stats = getAllStats();
    return res.json({ stats });
  } catch (err) {
    console.error("Hiba a /api/admin/stats hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a statisztikákat." });
  }
});

/* ---------- PARTNEREK ---------- */

router.get("/partners", (req, res) => {
  try {
    const partners = listPartners();
    return res.json({ partners });
  } catch (err) {
    console.error("Hiba a /api/admin/partners (GET) hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a partnereket." });
  }
});

router.post("/partners", (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "A partner neve (name) kötelező." });
    }

    const partner = createPartner(name);
    return res.json({ partner });
  } catch (err) {
    console.error("Hiba a /api/admin/partners (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a partner létrehozásakor." });
  }
});

router.post("/partners/:site_key/block", (req, res) => {
  try {
    const { site_key } = req.params;
    const { blocked } = req.body || {};

    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });
    if (typeof blocked !== "boolean") {
      return res.status(400).json({ error: "blocked mező kötelező és boolean legyen." });
    }

    const partner = setPartnerBlocked(site_key, blocked);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, partner });
  } catch (err) {
    console.error("Hiba a /api/admin/partners/:site_key/block hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a blokkolás során." });
  }
});

router.post("/partners/:site_key/allowed-domains", (req, res) => {
  try {
    const { site_key } = req.params;
    const { allowed_domains } = req.body || {};

    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = setPartnerAllowedDomains(site_key, allowed_domains);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, partner });
  } catch (err) {
    console.error("Hiba a /api/admin/partners/:site_key/allowed-domains hívásban:", err);
    return res.status(500).json({ error: "Hiba történt az allowed domains mentésekor." });
  }
});

router.post("/partners/:site_key/rotate-key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = rotatePartnerApiKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, partner });
  } catch (err) {
    console.error("Hiba a /api/admin/partners/:site_key/rotate-key hívásban:", err);
    return res.status(500).json({ error: "Hiba történt az API key rotálás során." });
  }
});

router.delete("/partners/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const ok = deletePartner(site_key);
    if (!ok) return res.status(404).json({ error: "Nincs ilyen partner." });

    deleteCatalog(site_key);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Hiba a /api/admin/partners/:site_key (DELETE) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a törlés során." });
  }
});

router.get("/partners/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    const partner = findPartnerBySiteKey(site_key);

    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ partner });
  } catch (err) {
    console.error("Hiba a /api/admin/partners/:site_key (GET, detail) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a partner lekérdezésekor." });
  }
});

/* ---------- ✅ WIDGET CONFIG (ADMIN) ---------- */

// lekérés
router.get("/widget-config/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const widget_config = getPartnerWidgetConfig(site_key);
    return res.json({ ok: true, site_key, widget_config });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-config/:site_key (GET) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget config lekérésekor." });
  }
});

// mentés
router.post("/widget-config/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const { widget_config } = req.body || {};
    const updated = setPartnerWidgetConfig(site_key, widget_config);

    if (!updated) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, site_key, partner: updated });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-config/:site_key (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget config mentésekor." });
  }
});

// reset (opcionális)
router.post("/widget-config/:site_key/reset", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const updated = clearPartnerWidgetConfig(site_key);
    if (!updated) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, site_key, partner: updated });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-config/:site_key/reset (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget config reset során." });
  }
});

/* ---------- ✅ BEJELENTÉSEK / FEEDBACK (ADMIN) ---------- */

// ✅ widget_copy lekérés + mentés (boltonként testreszabható szövegek)
router.get("/widget-copy/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const widget_copy = getPartnerWidgetCopy(site_key);
    const widget_fields = getPartnerWidgetFields(site_key);
    return res.json({ ok: true, site_key, widget_copy, widget_fields });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-copy/:site_key (GET) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget copy lekérésekor." });
  }
});

router.post("/widget-copy/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const { widget_copy, widget_fields } = req.body || {};

    if (widget_copy !== undefined) {
      setPartnerWidgetCopy(site_key, widget_copy);
    }
    if (widget_fields !== undefined) {
      setPartnerWidgetFields(site_key, widget_fields);
    }

    const updatedCopy = getPartnerWidgetCopy(site_key);
    const updatedFields = getPartnerWidgetFields(site_key);

    return res.json({ ok: true, site_key, widget_copy: updatedCopy, widget_fields: updatedFields });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-copy/:site_key (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget copy mentésekor." });
  }
});

/* ---------- ✅ RELEVANCE SETTINGS (ADMIN) ---------- */

router.get("/relevance/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const relevance = getPartnerRelevance(site_key);
    return res.json({ ok: true, site_key, relevance });
  } catch (err) {
    console.error("Hiba a /api/admin/relevance/:site_key (GET) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a relevance lekérésekor." });
  }
});

router.post("/relevance/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const { relevance } = req.body || {};
    const updated = setPartnerRelevance(site_key, relevance);
    if (!updated) return res.status(404).json({ error: "Nincs ilyen partner." });

    const updatedRelevance = getPartnerRelevance(site_key);
    return res.json({ ok: true, site_key, relevance: updatedRelevance });
  } catch (err) {
    console.error("Hiba a /api/admin/relevance/:site_key (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a relevance mentésekor." });
  }
});

/* ---------- ✅ WIDGET SCHEMA / FASHION PRESET (ADMIN) ---------- */

router.get("/widget-schema/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const widget_schema = getPartnerWidgetSchema(site_key);
    const relevance = getPartnerRelevance(site_key);
    return res.json({ ok: true, site_key, widget_schema, relevance });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-schema/:site_key (GET) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget schema lekérésekor." });
  }
});

router.post("/widget-schema/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const { widget_schema } = req.body || {};
    const updated = setPartnerWidgetSchema(site_key, widget_schema);
    if (!updated) return res.status(404).json({ error: "Nincs ilyen partner." });

    const updatedSchema = getPartnerWidgetSchema(site_key);
    return res.json({ ok: true, site_key, widget_schema: updatedSchema });
  } catch (err) {
    console.error("Hiba a /api/admin/widget-schema/:site_key (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget schema mentésekor." });
  }
});

/** ✅ Fashion preset alkalmazása egyetlen kattintással */
router.post("/apply-fashion-preset/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const updated = applyFashionPreset(site_key);
    if (!updated) return res.status(500).json({ error: "Hiba a preset alkalmazásakor." });

    const widget_schema = getPartnerWidgetSchema(site_key);
    const relevance = getPartnerRelevance(site_key);
    const widget_copy = getPartnerWidgetCopy(site_key);
    const widget_fields = getPartnerWidgetFields(site_key);

    return res.json({
      ok: true,
      site_key,
      widget_schema,
      relevance,
      widget_copy,
      widget_fields,
      message: "Fashion preset sikeresen alkalmazva!",
    });
  } catch (err) {
    console.error("Hiba a /api/admin/apply-fashion-preset/:site_key hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a fashion preset alkalmazásakor." });
  }
});

/** ✅ Default fashion schema lekérése (admin UI-hoz) */
router.get("/fashion-preset-defaults", (req, res) => {
  try {
    const defaults = getDefaultFashionSchema();
    return res.json({ ok: true, defaults });
  } catch (err) {
    console.error("Hiba a /api/admin/fashion-preset-defaults hívásban:", err);
    return res.status(500).json({ error: "Hiba történt." });
  }
});

/* ---------- ✅ V2: FULL WIDGET CONFIG (SCHEMA-DRIVEN) ---------- */

/** Lekérés */
router.get("/full-widget-config/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const config = getFullWidgetConfig(site_key);
    return res.json({ ok: true, site_key, config });
  } catch (err) {
    console.error("Hiba a /api/admin/full-widget-config/:site_key (GET) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget config lekérésekor." });
  }
});

/** Mentés */
router.post("/full-widget-config/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const { config } = req.body || {};
    const saved = saveFullWidgetConfig(site_key, config);

    if (!saved) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, site_key, config: saved });
  } catch (err) {
    console.error("Hiba a /api/admin/full-widget-config/:site_key (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget config mentésekor." });
  }
});

/** Reset */
router.post("/full-widget-config/:site_key/reset", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const config = resetFullWidgetConfig(site_key);
    if (!config) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, site_key, config });
  } catch (err) {
    console.error("Hiba a /api/admin/full-widget-config/:site_key/reset (POST) hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a widget config reset során." });
  }
});

/** Preset alkalmazása */
router.post("/full-widget-config/:site_key/apply-preset", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) return res.status(400).json({ error: "Hiányzik a site_key paraméter." });

    const partner = findPartnerBySiteKey(site_key);
    if (!partner) return res.status(404).json({ error: "Nincs ilyen partner." });

    const { preset } = req.body || {};
    const validPresets: PresetName[] = ["generic", "fashion", "electronics", "gift"];
    if (!validPresets.includes(preset)) {
      return res.status(400).json({ error: "Érvénytelen preset: " + preset });
    }

    const config = applyPreset(site_key, preset);
    if (!config) return res.status(404).json({ error: "Nincs ilyen partner." });

    return res.json({ ok: true, site_key, preset, config });
  } catch (err) {
    console.error("Hiba a /api/admin/full-widget-config/:site_key/apply-preset hívásban:", err);
    return res.status(500).json({ error: "Hiba történt a preset alkalmazásakor." });
  }
});

/** Elérhető presetek listázása */
router.get("/widget-presets", (req, res) => {
  try {
    const presets = listPresets();
    return res.json({ ok: true, presets });
  } catch (err) {
    return res.status(500).json({ error: "Hiba történt." });
  }
});

/* ---------- ✅ BEJELENTÉSEK / FEEDBACK (ADMIN) ---------- */

router.get("/feedback", (req, res) => {
  try {
    const { status, site_key } = req.query || {};
    let items = listAllFeedback();

    if (status && typeof status === "string") {
      items = items.filter((x) => x.status === status);
    }
    if (site_key && typeof site_key === "string") {
      items = items.filter((x) => x.site_key === site_key);
    }

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("Hiba a /api/admin/feedback (GET) hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült lekérni a bejelentéseket." });
  }
});

router.patch("/feedback/:id", (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "Hiányzik az id." });

    const updated = updateFeedback(id, req.body || {});
    if (!updated) return res.status(404).json({ error: "Nincs ilyen bejelentés." });

    return res.json({ ok: true, item: updated });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (msg.includes("Érvénytelen")) return res.status(400).json({ error: msg });

    console.error("Hiba a /api/admin/feedback/:id (PATCH) hívásban:", err);
    return res.status(500).json({ error: "Nem sikerült menteni a módosítást." });
  }
});


export default router;
