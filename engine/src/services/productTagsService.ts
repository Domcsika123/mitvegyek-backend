// src/services/productTagsService.ts
// Partner által manuálisan hozzáadható termék-tagek (AI ajánláshoz)
// Tárolja: data/product-custom-tags-<siteKey>.json
// Formátum: Record<product_id, string[]>

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");

function getTagsFilePath(siteKey: string): string {
  return path.join(DATA_DIR, `product-custom-tags-${siteKey}.json`);
}

// In-memory cache (siteKey → Map<product_id, tags[]>)
const tagsCache = new Map<string, Map<string, string[]>>();

function loadTags(siteKey: string): Map<string, string[]> {
  const cached = tagsCache.get(siteKey);
  if (cached) return cached;

  const filePath = getTagsFilePath(siteKey);
  let map = new Map<string, string[]>();
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string[]>;
      for (const [id, tags] of Object.entries(raw)) {
        if (Array.isArray(tags)) map.set(id, tags.map(String));
      }
    }
  } catch (_) {}

  tagsCache.set(siteKey, map);
  return map;
}

function saveTags(siteKey: string, map: Map<string, string[]>) {
  try {
    const obj: Record<string, string[]> = {};
    for (const [id, tags] of map.entries()) {
      obj[id] = tags;
    }
    fs.writeFileSync(getTagsFilePath(siteKey), JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    console.error("[productTagsService] Hiba a tagek mentésekor:", err);
  }
}

/** Visszaadja egy termék custom tagjeit */
export function getProductTags(siteKey: string, productId: string): string[] {
  return loadTags(siteKey).get(productId) || [];
}

/** Beállítja egy termék custom tagjeit */
export function setProductTags(siteKey: string, productId: string, tags: string[]): void {
  const map = loadTags(siteKey);
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length > 0) {
    map.set(productId, cleaned);
  } else {
    map.delete(productId); // ha üres → töröljük
  }
  tagsCache.set(siteKey, map);
  saveTags(siteKey, map);
}

/** Visszaadja az összes custom tag-et egy webshophoz:  Record<product_id, tags[]> */
export function getAllCustomTags(siteKey: string): Record<string, string[]> {
  const map = loadTags(siteKey);
  const result: Record<string, string[]> = {};
  for (const [id, tags] of map.entries()) {
    result[id] = tags;
  }
  return result;
}

/**
 * Bővíti a termék tags mezőjét a custom tagekkel.
 * Használható recommend pipeline-ban a szabad szöveges kereséshez.
 */
export function mergeCustomTags(siteKey: string, product: any): string {
  const existingTags = product.tags || "";
  const customTags = getProductTags(siteKey, String(product.product_id || ""));
  if (customTags.length === 0) return existingTags;
  const combined = [existingTags, ...customTags].filter(Boolean).join(", ");
  return combined;
}

/** Cache invalidálás (pl. importálás után) */
export function invalidateTagsCache(siteKey: string): void {
  tagsCache.delete(siteKey);
}
