// src/routes/admin.ts

import { Router } from "express";
import { listCatalogs, replaceCatalog, deleteCatalog } from "../services/productService";
import { getAllStats } from "../services/statsService";
import { Product } from "../models/Product";
import {
  createPartner,
  listPartners,
  deletePartner,
  findPartnerBySiteKey,
  setPartnerBlocked,
} from "../services/partnerService";

const router = Router();

/* ---------- KATALÓGUSOK ---------- */

// GET /api/admin/catalogs
router.get("/catalogs", (req, res) => {
  try {
    const catalogs = listCatalogs();
    return res.json({ catalogs });
  } catch (err) {
    console.error("Hiba a /api/admin/catalogs hívásban:", err);
    return res
      .status(500)
      .json({ error: "Nem sikerült lekérni a katalógusokat." });
  }
});

// POST /api/admin/import-products
router.post("/import-products", (req, res) => {
  try {
    const { site_key, items } = req.body || {};

    if (!site_key || typeof site_key !== "string") {
      return res
        .status(400)
        .json({ error: "site_key kötelező és string legyen." });
    }

    // ⬇⬇⬇ ÚJ: ellenőrizzük, hogy létezik-e ilyen partner / site_key
    const partner = findPartnerBySiteKey(site_key);
    if (!partner) {
      return res.status(400).json({
        error: `Nincs ilyen partner vagy site_key: ${site_key}`,
      });
    }
    // ⬆⬆⬆

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
      };

      if (!p.product_id || !p.name) {
        return res.status(400).json({
          error: "Minden terméknek kell product_id és name mező.",
        });
      }

      if (Number.isNaN(p.price)) {
        return res.status(400).json({
          error: `Érvénytelen price érték a terméknél: ${p.product_id}`,
        });
      }

      products.push(p);
    }

    replaceCatalog(site_key, products, true);

    return res.json({
      ok: true,
      site_key,
      count: products.length,
    });
  } catch (err) {
    console.error("Hiba a /api/admin/import-products hívásban:", err);
    return res
      .status(500)
      .json({ error: "Hiba történt az import során a szerveren." });
  }
});

// DELETE /api/admin/catalogs/:site_key
router.delete("/catalogs/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) {
      return res.status(400).json({ error: "site_key kötelező." });
    }

    deleteCatalog(site_key);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Hiba a /api/admin/catalogs/:site_key (DELETE) hívásban:", err);
    return res
      .status(500)
      .json({ error: "Hiba történt a katalógus törlése során." });
  }
});

/* ---------- STATISZTIKA ---------- */

// GET /api/admin/stats
router.get("/stats", (req, res) => {
  try {
    const stats = getAllStats();
    return res.json({ stats });
  } catch (err) {
    console.error("Hiba a /api/admin/stats hívásban:", err);
    return res
      .status(500)
      .json({ error: "Nem sikerült lekérni a statisztikákat." });
  }
});

/* ---------- PARTNEREK ---------- */

// GET /api/admin/partners
router.get("/partners", (req, res) => {
  try {
    const partners = listPartners();
    return res.json({ partners });
  } catch (err) {
    console.error("Hiba a /api/admin/partners (GET) hívásban:", err);
    return res
      .status(500)
      .json({ error: "Nem sikerült lekérni a partnereket." });
  }
});

// POST /api/admin/partners
router.post("/partners", (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || typeof name !== "string") {
      return res
        .status(400)
        .json({ error: "A partner neve (name) kötelező." });
    }

    const partner = createPartner(name);
    return res.json({ partner });
  } catch (err) {
    console.error("Hiba a /api/admin/partners (POST) hívásban:", err);
    return res
      .status(500)
      .json({ error: "Hiba történt a partner létrehozásakor." });
  }
});

// POST /api/admin/partners/:site_key/block
router.post("/partners/:site_key/block", (req, res) => {
  try {
    const { site_key } = req.params;
    const { blocked } = req.body || {};

    if (!site_key) {
      return res
        .status(400)
        .json({ error: "Hiányzik a site_key paraméter." });
    }

    if (typeof blocked !== "boolean") {
      return res
        .status(400)
        .json({ error: "blocked mező kötelező és boolean legyen." });
    }

    const partner = setPartnerBlocked(site_key, blocked);
    if (!partner) {
      return res.status(404).json({ error: "Nincs ilyen partner." });
    }

    return res.json({ ok: true, partner });
  } catch (err) {
    console.error(
      "Hiba a /api/admin/partners/:site_key/block hívásban:",
      err
    );
    return res
      .status(500)
      .json({ error: "Hiba történt a blokkolás során." });
  }
});

// DELETE /api/admin/partners/:site_key
router.delete("/partners/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    if (!site_key) {
      return res
        .status(400)
        .json({ error: "Hiányzik a site_key paraméter." });
    }

    const ok = deletePartner(site_key);
    if (!ok) {
      return res.status(404).json({ error: "Nincs ilyen partner." });
    }

    // partnerhez tartozó katalógus törlése is
    deleteCatalog(site_key);

    return res.json({ ok: true });
  } catch (err) {
    console.error(
      "Hiba a /api/admin/partners/:site_key (DELETE) hívásban:",
      err
    );
    return res.status(500).json({ error: "Hiba történt a törlés során." });
  }
});

// GET /api/admin/partners/:site_key (részletes adat partner.html-hez)
router.get("/partners/:site_key", (req, res) => {
  try {
    const { site_key } = req.params;
    const partner = findPartnerBySiteKey(site_key);

    if (!partner) {
      return res.status(404).json({ error: "Nincs ilyen partner." });
    }

    return res.json({ partner });
  } catch (err) {
    console.error(
      "Hiba a /api/admin/partners/:site_key (GET, detail) hívásban:",
      err
    );
    return res
      .status(500)
      .json({ error: "Hiba történt a partner lekérdezésekor." });
  }
});

export default router;
