import fs from "node:fs";
import path from "node:path";
import { getProductsForSite } from "../src/services/productService";
import { Product } from "../src/models/Product";
import { rankProducts } from "../src/reco/ranker";

const API = "http://localhost:3001/api/recommend";
const API_KEY = "6b6d4c22939ffcaf507ef23570a44959adb67fea3f95ecc5";
const SITE_KEY = "unreal";
const OUTPUT_FILE = path.join(process.cwd(), "e2e-hardrule-log.json");

type Query = { tipus: string; szin: string; marka?: string; ar?: number };

function toTokens(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((v) => toTokens(v));
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[\s,;/|]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function getProductId(product: Product): string {
  return String((product as any).id || product.product_id || product.name);
}

function extractTypes(products: Product[]): string[] {
  const out = new Set<string>();
  for (const product of products) {
    const pType = String((product as any).product_type || (product as any).type || (product as any).tipus || "").trim();
    if (pType) out.add(pType);

    const category = String((product as any).category || "").trim();
    if (category) {
      out.add(category);
      const lastSegment = category.includes(">")
        ? category
            .split(">")
            .map((x) => x.trim())
            .filter(Boolean)
            .pop()
        : "";
      if (lastSegment) out.add(lastSegment);
    }
  }
  return [...out];
}

function extractColors(products: Product[]): string[] {
  const stop = new Set([
    "ferfi",
    "noi",
    "unisex",
    "polo",
    "hoodie",
    "pulover",
    "pulcsi",
    "tshirt",
    "taska",
    "cipo",
    "sport",
    "premium",
    "streetwear",
    "tee",
    "shirt",
  ]);
  const out = new Set<string>();
  for (const product of products) {
    const raw = [
      ...(toTokens((product as any).color)),
      ...(toTokens((product as any).szin)),
      ...(toTokens((product as any).tags)),
      ...(toTokens(product.name)),
    ];
    for (const token of raw) {
      if (stop.has(token)) continue;
      if (token.length < 3) continue;
      out.add(token);
    }
  }
  return [...out];
}

function extractBrands(products: Product[]): string[] {
  const out = new Set<string>();
  for (const product of products) {
    const brand = String((product as any).vendor || (product as any).brand || (product as any).marka || "").trim();
    if (brand) out.add(brand);
  }
  return [...out];
}

function findExactQuery(products: Product[]): Query {
  const types = extractTypes(products);
  const colors = extractColors(products);

  for (const tipus of types) {
    for (const szin of colors) {
      const res = rankProducts({ tipus, szin }, products, { fullCatalog: products });
      if (res.meta.hasExactMatch && res.items.length > 0) {
        return { tipus, szin };
      }
    }
  }

  // Fallback #1: brand-only exact match is still a valid full match scenario.
  const brands = extractBrands(products);
  for (const marka of brands) {
    const res = rankProducts({ marka }, products, { fullCatalog: products });
    if (res.meta.hasExactMatch && res.items.length > 0 && res.items.length < products.length) {
      return { tipus: "", szin: "", marka };
    }
  }

  // Fallback #2: type-only exact match.
  for (const tipus of types) {
    const res = rankProducts({ tipus }, products, { fullCatalog: products });
    if (res.meta.hasExactMatch && res.items.length > 0 && res.items.length < products.length) {
      return { tipus, szin: "" };
    }
  }

  throw new Error("Nem találtam biztos EXACT query-t a katalógusban.");
}

function findNoExactQuery(products: Product[]): Query {
  const types = extractTypes(products);
  const colors = extractColors(products);
  const prices = [...new Set(products.map((p) => Number((p as any).price)).filter((n) => Number.isFinite(n)))].slice(0, 120);

  for (const tipus of types) {
    for (const szin of colors) {
      for (const ar of prices) {
        const query = { tipus, szin, ar };
        const res = rankProducts(query, products, { fullCatalog: products });
        const g = res.meta.groupsCount;
        if (!res.meta.hasExactMatch && g.A > 0 && g.B > 0 && g.C > 0 && g.D > 0) {
          return query;
        }
      }
    }
  }

  throw new Error("Nem találtam olyan NO-EXACT query-t, ami A>B>C>D csoportot is demonstrál.");
}

async function postRecommend(payload: any): Promise<any> {
  const response = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mv-api-key": API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  return { status: response.status, json };
}

function assertBlurbs(items: any[], label: string) {
  for (const item of items) {
    const blurb = String(item.reason || "");
    if (!blurb.trim()) {
      throw new Error(`${label}: üres blurb a terméknél: ${item.name}`);
    }
    if (blurb.length > 160) {
      throw new Error(`${label}: túl hosszú blurb (${blurb.length}) a terméknél: ${item.name}`);
    }
  }
}

function isEmptyMessage(value: any): boolean {
  return value === undefined || value === null || String(value).trim() === "";
}

async function main() {
  const products = getProductsForSite(SITE_KEY);
  if (!products.length) {
    throw new Error(`Üres katalógus a(z) ${SITE_KEY} site_key alatt.`);
  }

  const exactQuery = findExactQuery(products);
  const noExactQuery = findNoExactQuery(products);

  const exactPayload = {
    site_key: SITE_KEY,
    type: exactQuery.tipus || undefined,
    color: exactQuery.szin || undefined,
    brand: exactQuery.marka || undefined,
    user: {
      interests: [
        `${exactQuery.szin || ""} ${exactQuery.tipus || ""}`.trim(),
        String(exactQuery.marka || "").trim(),
      ].filter(Boolean),
      free_text: `${exactQuery.szin || ""} ${exactQuery.tipus || ""} ${exactQuery.marka || ""}`.trim(),
      type: exactQuery.tipus || undefined,
      color: exactQuery.szin || undefined,
      brand: exactQuery.marka || undefined,
    },
  };

  const noExactPayload = {
    site_key: SITE_KEY,
    type: noExactQuery.tipus,
    color: noExactQuery.szin,
    price: noExactQuery.ar,
    user: {
      interests: [`${noExactQuery.szin} ${noExactQuery.tipus}`, String(noExactQuery.ar || "")],
      free_text: `${noExactQuery.szin} ${noExactQuery.tipus} ${noExactQuery.ar || ""}`,
      type: noExactQuery.tipus,
      color: noExactQuery.szin,
      price: noExactQuery.ar,
    },
  };

  const exactExpected = rankProducts(exactQuery, products, { fullCatalog: products });
  const noExactExpected = rankProducts(noExactQuery, products, { fullCatalog: products });

  const exactApi = await postRecommend(exactPayload);
  const noExactApi = await postRecommend(noExactPayload);

  if (exactApi.status !== 200) {
    throw new Error(`EXACT kérés hibás státuszkóddal tért vissza: ${exactApi.status}`);
  }
  if (noExactApi.status !== 200) {
    throw new Error(`NO-EXACT kérés hibás státuszkóddal tért vissza: ${noExactApi.status}`);
  }

  const exactItems = Array.isArray(exactApi.json.items) ? exactApi.json.items : [];
  const exactAlso = Array.isArray(exactApi.json.also_items) ? exactApi.json.also_items : [];
  const exactIds = exactItems.map((x: any) => String(x.product_id || x.name));
  const expectedExactIds = exactExpected.items.map((x) => getProductId(x));

  if (exactAlso.length !== 0) {
    throw new Error(`EXACT: also_items nem üres (${exactAlso.length}).`);
  }
  if (JSON.stringify(exactIds) !== JSON.stringify(expectedExactIds)) {
    throw new Error("EXACT: a visszaadott termékek nem egyeznek a full-match listával/rendezéssel.");
  }
  if (!isEmptyMessage(exactApi.json.message) || !isEmptyMessage(exactApi.json.notice)) {
    throw new Error("EXACT: message/notice nem üres.");
  }
  assertBlurbs(exactItems, "EXACT");

  const noExactItems = Array.isArray(noExactApi.json.items) ? noExactApi.json.items : [];
  const noExactAlso = Array.isArray(noExactApi.json.also_items) ? noExactApi.json.also_items : [];
  const noExactApiOrder = [...noExactItems, ...noExactAlso].map((x: any) => String(x.product_id || x.name));

  const expectedNoExactOrder = noExactExpected.items.map((x) => getProductId(x)).slice(0, noExactApiOrder.length);

  if (noExactExpected.meta.hasExactMatch) {
    throw new Error("NO-EXACT: a lokális ellenőrzés szerint mégis van full match.");
  }

  if (JSON.stringify(noExactApiOrder) !== JSON.stringify(expectedNoExactOrder)) {
    throw new Error("NO-EXACT: az API sorrend nem egyezik a várt A>B>C>D hard-rule sorrenddel.");
  }

  const noExactMessage = String(noExactApi.json.message || noExactApi.json.notice || "");
  if (!noExactMessage || !noExactMessage.toLowerCase().includes("pontos egyezest nem talaltam".toLowerCase())) {
    throw new Error("NO-EXACT: hiányzik az ügyfélbarát " +
      "'Pontos egyezést nem találtam' üzenet.");
  }

  assertBlurbs(noExactItems, "NO-EXACT/items");
  assertBlurbs(noExactAlso, "NO-EXACT/also_items");

  const report = {
    generatedAt: new Date().toISOString(),
    api: API,
    siteKey: SITE_KEY,
    tests: {
      exact: {
        query: exactQuery,
        payload: exactPayload,
        expected: {
          hasExactMatch: exactExpected.meta.hasExactMatch,
          totalFullMatches: exactExpected.items.length,
          expectedProductIds: expectedExactIds,
          groupsCount: exactExpected.meta.groupsCount,
        },
        response: exactApi,
      },
      noExact: {
        query: noExactQuery,
        payload: noExactPayload,
        expected: {
          hasExactMatch: noExactExpected.meta.hasExactMatch,
          groupsCount: noExactExpected.meta.groupsCount,
          expectedTopOrder: expectedNoExactOrder,
        },
        response: noExactApi,
      },
    },
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log("✅ E2E hard-rule tesztek sikeresek.");
  console.log(`Log mentve: ${OUTPUT_FILE}`);
  console.log("\n--- EXACT payload ---");
  console.log(JSON.stringify(exactPayload, null, 2));
  console.log("\n--- EXACT response (rövid) ---");
  console.log(JSON.stringify({
    status: exactApi.status,
    items: exactApi.json.items,
    also_items: exactApi.json.also_items,
    message: exactApi.json.message,
    notice: exactApi.json.notice,
  }, null, 2));

  console.log("\n--- NO-EXACT payload ---");
  console.log(JSON.stringify(noExactPayload, null, 2));
  console.log("\n--- NO-EXACT response (rövid) ---");
  console.log(JSON.stringify({
    status: noExactApi.status,
    items: noExactApi.json.items,
    also_items: noExactApi.json.also_items,
    message: noExactApi.json.message,
    notice: noExactApi.json.notice,
    meta: noExactApi.json.meta,
  }, null, 2));
}

main().catch((error) => {
  console.error("❌ E2E hard-rule teszt hiba:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
