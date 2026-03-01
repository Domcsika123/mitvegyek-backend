// src/services/productService.ts

import fs from "fs";
import path from "path";
import { Product } from "../models/Product";
import { cacheEmbeddings } from "../ai/embeddingIndex";

type CatalogMap = Record<string, Product[]>;

const catalogs: CatalogMap = {};

// ✅ CSAK EZ VÁLTOZIK: DATA_DIR env támogatás (Render persistent diskhez)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");

/**
 * Gondoskodunk róla, hogy a data/ mappa létezzen.
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ✅ Katalógus darabszám cache – elkerüli a ~96MB JSON fájlok teljes beolvasását
// a getCatalogSummaries() hívásakor. A "catalog-counts.json" nem illeszkedik a
// "products*.json" szűrőre, tehát nem keveredik a termékfájlokkal.
const CATALOG_COUNTS_FILE = path.join(DATA_DIR, "catalog-counts.json");

function readCatalogCounts(): Record<string, number> {
  try {
    if (fs.existsSync(CATALOG_COUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(CATALOG_COUNTS_FILE, "utf8"));
    }
  } catch (_) {}
  return {};
}

function writeCatalogCount(siteKey: string, count: number) {
  try {
    ensureDataDir();
    const counts = readCatalogCounts();
    counts[siteKey] = count;
    fs.writeFileSync(CATALOG_COUNTS_FILE, JSON.stringify(counts, null, 2), "utf8");
  } catch (_) {}
}

function removeCatalogCount(siteKey: string) {
  try {
    if (fs.existsSync(CATALOG_COUNTS_FILE)) {
      const counts = readCatalogCounts();
      delete counts[siteKey];
      fs.writeFileSync(CATALOG_COUNTS_FILE, JSON.stringify(counts, null, 2), "utf8");
    }
  } catch (_) {}
}

/**
 * Egy adott site_key katalógusának betöltése fájlrendszerből.
 * - default → products.json
 * - másik → products-<site_key>.json
 */
function loadCatalogFromDisk(siteKey: string): Product[] {
  ensureDataDir();

  let fileName = "products.json";
  if (siteKey !== "default") {
    fileName = `products-${siteKey}.json`;
  }

  const filePath = path.join(DATA_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    console.warn(
      `Termékfájl nem található [${siteKey}] alatt: ${filePath} – üres katalógus.`
    );
    return [];
  }

  try {
    console.log(`Termékek betöltése [${siteKey}] innen: ${filePath}`);
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      console.warn(
        `A termékfájl nem tömböt tartalmaz [${siteKey}]: ${filePath}`
      );
      return [];
    }

    const products: Product[] = data.map((p: any, idx: number) => ({
      product_id: p.product_id ?? `p_${siteKey}_${idx}`,
      name: p.name ?? "Ismeretlen termék",
      price: Number(p.price) || 0,
      price_currency: p.price_currency ?? undefined,
      category: p.category ?? "",
      description: p.description ?? "",
      image_url: p.image_url ?? "",
      product_url: p.product_url ?? "",

      // Shopify / CSV extra mezők
      tags: p.tags ?? undefined,
      product_type: p.product_type ?? undefined,
      vendor: p.vendor ?? undefined,

      // Embedding megtartása, ha van
      embedding: Array.isArray(p.embedding) ? p.embedding : undefined,
    }));

    // ✅ Embeddingeket külön cache-be tesszük, majd kivonjuk a termék objektumokból.
    // Ez ~80MB memóriát spórol nagy katalógusoknál (pl. 1649 termék × 3072 float).
    cacheEmbeddings(siteKey, products);
    const productsWithoutEmb = products.map(({ embedding, ...rest }: any) => rest as Product);

    console.log(`Betöltött termékek száma [${siteKey}]: ${productsWithoutEmb.length}`);
    // Sidecar count fájl írása, hogy getCatalogSummaries() ne olvassa be a teljes JSON-t
    writeCatalogCount(siteKey, productsWithoutEmb.length);
    return productsWithoutEmb;
  } catch (err) {
    console.error(
      `Hiba történt a termékfájl betöltése közben [${siteKey}]:`,
      err
    );
    return [];
  }
}

/**
 * Visszaadja az adott site_key-hez tartozó termékeket.
 * Ha nincs ilyen katalógus vagy üres, a "default"-ot használja fallback-ként.
 */
export function getProductsForSite(siteKey: string): Product[] {
  const key = siteKey || "default";

  if (!catalogs[key]) {
    catalogs[key] = loadCatalogFromDisk(key);
  }

  if (catalogs[key] && catalogs[key].length > 0) {
    return catalogs[key];
  }

  // fallback: default katalógus
  if (!catalogs["default"]) {
    catalogs["default"] = loadCatalogFromDisk("default");
  }

  return catalogs["default"] || [];
}

/**
 * Admin import: teljes katalógus csere + opcionális fájlba írás.
 * A products*.json fájlokat írja.
 */
export function replaceCatalog(
  siteKey: string,
  products: Product[],
  persistToDisk = true
) {
  const key = siteKey || "default";

  // ✅ Embeddingeket külön cache-be, a catalogs Map-ben csak metaadat
  cacheEmbeddings(key, products);
  const productsWithoutEmb = products.map(({ embedding, ...rest }: any) => rest as Product);
  catalogs[key] = productsWithoutEmb;

  console.log(
    `Katalógus frissítve [${key}], termékek száma: ${products.length}`
  );

  if (!persistToDisk) return;

  ensureDataDir();
  const fileName = key === "default" ? "products.json" : `products-${key}.json`;
  const filePath = path.join(DATA_DIR, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(products, null, 2), "utf8");
    console.log(`Katalógus fájlba írva [${key}]: ${filePath}`);
    writeCatalogCount(key, productsWithoutEmb.length);
  } catch (err) {
    console.error(
      `Nem sikerült fájlba írni a katalógust [${key}] – ${filePath}`,
      err
    );
  }
}

/**
 * Katalógus összefoglalók az admin HTML-nek.
 * ✅ Memória-optimalizált: NEM olvassa be a teljes termékfájlt a számláláshoz.
 * Prioritás: 1. in-memory katalógus → 2. catalog-counts.json sidecar → 3. teljes JSON parse (csak egyszer, legacy)
 */
export function getCatalogSummaries(): { site_key: string; count: number }[] {
  ensureDataDir();

  const summaries: { site_key: string; count: number }[] = [];
  const precomputedCounts = readCatalogCounts();

  try {
    const files = fs.readdirSync(DATA_DIR);
    const productFiles = files.filter(
      (f) => f.startsWith("products") && f.endsWith(".json")
    );

    productFiles.forEach((fileName) => {
      let siteKey = "default";
      if (fileName !== "products.json") {
        // "products-<site_key>.json" → <site_key>
        siteKey = fileName.slice("products-".length, -".json".length);
      }

      // 1. In-memory katalógus – legjobb eset, nincs I/O
      if (catalogs[siteKey] !== undefined) {
        summaries.push({ site_key: siteKey, count: catalogs[siteKey].length });
        return;
      }

      // 2. Sidecar count fájlból – kis JSON, gyors
      if (precomputedCounts[siteKey] !== undefined) {
        summaries.push({ site_key: siteKey, count: precomputedCounts[siteKey] });
        return;
      }

      // 3. Fallback: teljes JSON parse (csak egyszer, legacy adatoknál)
      // Menti a sidecar-t, hogy legközelebb ne kelljen újra.
      const filePath = path.join(DATA_DIR, fileName);
      try {
        console.log(`[productService] Első count [${siteKey}] – teljes fájl olvasás (csak egyszer)`);
        const raw = fs.readFileSync(filePath, "utf8");
        const data = JSON.parse(raw);
        const count = Array.isArray(data) ? data.length : 0;
        writeCatalogCount(siteKey, count);
        summaries.push({ site_key: siteKey, count });
      } catch (err) {
        console.error(
          `[productService] Nem sikerült beolvasni a katalógust [${siteKey}] (${filePath}):`,
          err
        );
        summaries.push({ site_key: siteKey, count: 0 });
      }
    });
  } catch (err) {
    console.error(
      "[productService] Hiba a katalógus összefoglalók olvasása közben:",
      err
    );
  }

  return summaries;
}

/**
 * Admin felület által használt katalógus-lista.
 * Ugyanaz, mint getCatalogSummaries, csak név szerint külön exportálva.
 */
export function listCatalogs(): { site_key: string; count: number }[] {
  return getCatalogSummaries();
}

/**
 * Régi kód kompatibilitás: default katalógus.
 */
export function getAllProducts(): Product[] {
  return getProductsForSite("default");
}

/**
 * Katalógus törlése (ha valaha használod partner törlésnél).
 * - memóriából törli
 * - a products-<site_key>.json fájlt is törli (defaultot nem)
 */
export function deleteCatalog(siteKey: string) {
  const key = siteKey || "default";

  // memóriából
  if (catalogs[key]) {
    delete catalogs[key];
  }

  // default katalógust nem töröljük fájlból
  if (key === "default") {
    return;
  }

  ensureDataDir();
  const fileName = `products-${key}.json`;
  const filePath = path.join(DATA_DIR, fileName);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Katalógus fájl törölve [${key}]: ${filePath}`);
    }
    removeCatalogCount(key);
  } catch (err) {
    console.error(
      `Nem sikerült törölni a katalógus fájlt [${key}] – ${filePath}`,
      err
    );
  }
}
