// src/services/stockService.ts
// Élő készletinformáció kiolvasása a partner termékoldalról (product_url).
// Univerzális megoldás: a legtöbb webshop (platformtól függetlenül, SEO/Google Shopping
// miatt) a termékoldal HTML-jébe tesz egy schema.org JSON-LD <script> blokkot, ami
// tartalmazza az offers.availability mezőt (InStock / OutOfStock / stb.).
//
// Nem minden partner oldala ad ilyet — ha nem találunk strukturált adatot, "unknown"-t
// adunk vissza, és a hívó oldal ilyenkor NEM zárja ki a terméket (fail-open), nehogy egy
// rosszul SEO-zott partner oldal miatt eltűnjenek a valóban raktáron lévő termékek.

import axios from "axios";

type StockValue = boolean | null; // true=raktáron, false=elfogyott, null=ismeretlen

type StockEntry = { inStock: StockValue; checkedAt: number };

const CACHE_TTL_MS = 20 * 60 * 1000; // 20 perc
const FETCH_TIMEOUT_MS = 4000;

const cache = new Map<string, StockEntry>();
const inFlight = new Map<string, Promise<StockValue>>();

function isFresh(entry: StockEntry | undefined): entry is StockEntry {
  return !!entry && Date.now() - entry.checkedAt < CACHE_TTL_MS;
}

/**
 * Kiolvassa a termék raktárkészlet-státuszát a HTML-be ágyazott
 * schema.org Product JSON-LD blokkból.
 */
function extractAvailability(html: string): StockValue {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html))) {
    let json: any;
    try {
      json = JSON.parse(match[1].trim());
    } catch (_) {
      continue; // hibás JSON-LD blokk, ugorjuk
    }

    const nodes: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.["@graph"])
        ? json["@graph"]
        : [json];

    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;
      const type = node["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (!isProduct) continue;

      let offers = node.offers;
      if (!offers) continue;
      if (Array.isArray(offers)) offers = offers[0];

      const availability = String(offers?.availability || "").toLowerCase();
      if (!availability) continue;

      if (
        availability.includes("instock") ||
        availability.includes("limitedavailability") ||
        availability.includes("presale") ||
        availability.includes("preorder")
      ) {
        return true;
      }
      if (
        availability.includes("outofstock") ||
        availability.includes("soldout") ||
        availability.includes("discontinued")
      ) {
        return false;
      }
    }
  }

  return null; // nem találtunk Product JSON-LD-t / availability mezőt
}

async function fetchAvailability(url: string): Promise<StockValue> {
  try {
    const res = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MitVegyekStockCheck/1.0; +https://mitvegyek.hu)",
      },
      validateStatus: (s) => s < 500,
    });
    if (typeof res.data !== "string") return null;
    return extractAvailability(res.data);
  } catch (_) {
    return null; // timeout, hálózati hiba, blokkolás stb. → ismeretlen, nem hiba
  }
}

function refresh(url: string): Promise<StockValue> {
  const existing = inFlight.get(url);
  if (existing) return existing;

  const p = fetchAvailability(url)
    .then((inStock) => {
      cache.set(url, { inStock, checkedAt: Date.now() });
      return inStock;
    })
    .finally(() => {
      inFlight.delete(url);
    });

  inFlight.set(url, p);
  return p;
}

/**
 * Nem-blokkoló: ha a cache üres vagy lejárt egy URL-re, elindítja a háttérben a
 * frissítést. Sosem dob hibát, a hívó nem várja meg — a KÖVETKEZŐ ajánláskor lesz
 * már friss az adat.
 */
export function warmStock(url: string | undefined | null): void {
  if (!url) return;
  const entry = cache.get(url);
  if (isFresh(entry)) return;
  if (inFlight.has(url)) return;
  refresh(url).catch(() => {});
}

/** Szinkron cache-olvasás. null = nincs (friss) adatunk róla. */
export function getCachedStock(url: string | undefined | null): StockValue {
  if (!url) return null;
  const entry = cache.get(url);
  if (!isFresh(entry)) return null;
  return entry!.inStock;
}

/**
 * Csak akkor igaz, ha BIZTOSAN tudjuk, hogy elfogyott. Ismeretlen vagy raktáron lévő
 * esetén false (vagyis nem zárjuk ki) — fail-open, hogy egy sikertelen/hiányzó
 * strukturált adat miatt ne tűnjenek el valós termékek az ajánlásból.
 */
export function isKnownOutOfStock(url: string | undefined | null): boolean {
  return getCachedStock(url) === false;
}
