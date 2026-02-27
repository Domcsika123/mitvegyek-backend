// src/ai/rerank.ts
import OpenAI from "openai";
import { UserContext } from "../models/UserContext";
import { Product } from "../models/Product";
import { baseId } from "./queryUtils";

type RankedProduct = {
  product: Product;
  reason: string;
};

type RerankResult = {
  items: RankedProduct[];
  also_items: RankedProduct[];
  notice?: string | null;
};

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY hiányzik. Állítsd be a .env fájlban.");
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ===================== STABILITÁS SEGÉD ===================== */

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toStatus(err: any): number | null {
  const s = err?.status ?? err?.response?.status ?? err?.cause?.status;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function isRetryable(err: any): boolean {
  const status = toStatus(err);
  if (status === 429) return true;
  if (status !== null && status >= 500 && status <= 599) return true;

  const code = String(err?.code || "");
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENOTFOUND") return true;

  const msg = String(err?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("rate limit") || msg.includes("temporarily")) return true;

  return false;
}

function cut(v: any, n: number): string {
  const s = String(v || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function extractJsonObject(text: string): string | null {
  const s = String(text || "").trim();
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i === -1 || j === -1 || j <= i) return null;
  return s.slice(i, j + 1);
}

/* ===================== TOKEN / HEURISZTIKA ===================== */

const STOP = new Set([
  "a",
  "az",
  "és",
  "meg",
  "de",
  "hogy",
  "nem",
  "is",
  "van",
  "volt",
  "vagy",
  "mert",
  "mint",
  "egy",
  "egyik",
  "másik",
  "valami",
  "nagyon",
  "csak",
  "szeret",
  "szereti",
  "termék",
  "termek",
  "cucc",
  "dolog",
  "pl",
  "például",
  "pl.",
  "kb",
]);

function tokenizeHu(s: string): string[] {
  const t = String(s || "").toLowerCase();
  return t
    .replace(/[^a-z0-9áéíóöőúüű]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w.length >= 2)
    .filter((w) => !STOP.has(w));
}

function getUserTokens(user: UserContext): string[] {
  const out: string[] = [];
  if (Array.isArray(user.interests)) {
    for (const it of user.interests) out.push(...tokenizeHu(String(it)));
  }
  out.push(...tokenizeHu(user.free_text || ""));
  out.push(...tokenizeHu(user.relationship || ""));
  return [...new Set(out)].slice(0, 80);
}

function getProductTokens(p: Product): Set<string> {
  const hay = `${p.name || ""} ${p.category || ""} ${p.description || ""}`;
  return new Set(tokenizeHu(hay));
}

function findOverlapToken(userTokens: string[], productTokens: Set<string>): string | null {
  for (const t of userTokens) {
    if (productTokens.has(t)) return t;
  }
  return null;
}

/** Shopify-stílusú hierarchikus kategóriát a legspecifikusabb (utolsó) szegmensre egyszerűsíti. */
function simplifyCategory(cat: string): string {
  if (!cat) return cat;
  // "Apparel & Accessories > Clothing > Dresses" → "Dresses"
  const segments = cat.split(">").map(s => s.trim()).filter(Boolean);
  return segments[segments.length - 1] || cat;
}

function summarizeCatalog(products: Product[]): { cats: string[]; words: string[]; hint: string } {
  const catCount = new Map<string, number>();
  const wordCount = new Map<string, number>();

  for (const p of products) {
    const cat = simplifyCategory(String(p.category || "").trim().toLowerCase());
    if (cat) catCount.set(cat, (catCount.get(cat) || 0) + 1);

    const hay = `${p.name || ""} ${p.category || ""} ${p.description || ""}`;
    for (const w of tokenizeHu(hay)) {
      wordCount.set(w, (wordCount.get(w) || 0) + 1);
    }
  }

  const cats = [...catCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([c]) => c);
  const words = [...wordCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  const bits: string[] = [];
  if (cats.length) bits.push(`kategóriák: ${cats.join(", ")}`);
  if (words.length) bits.push(`kulcsszavak: ${words.join(", ")}`);

  return { cats, words, hint: bits.length ? bits.join(" | ") : "nincs elég adat a katalógus jellegére" };
}

/* ===================== EXPLICIT SZŰRŐK FELISMERÉS ===================== */

const COLOR_WORDS: Record<string, string> = {
  "kék": "KÉK", "kek": "KÉK", "blue": "KÉK", "navy": "KÉK", "sötétkék": "KÉK",
  "piros": "PIROS", "red": "PIROS", "vörös": "PIROS",
  "sárga": "SÁRGA", "sarga": "SÁRGA", "yellow": "SÁRGA",
  "zöld": "ZÖLD", "zold": "ZÖLD", "green": "ZÖLD",
  "fekete": "FEKETE", "black": "FEKETE",
  "fehér": "FEHÉR", "feher": "FEHÉR", "white": "FEHÉR",
  "szürke": "SZÜRKE", "szurke": "SZÜRKE", "grey": "SZÜRKE", "gray": "SZÜRKE",
  "barna": "BARNA", "brown": "BARNA",
  "narancs": "NARANCS", "orange": "NARANCS",
  "lila": "LILA", "purple": "LILA",
  "rózsaszín": "RÓZSASZÍN", "rozsaszin": "RÓZSASZÍN", "pink": "RÓZSASZÍN",
  "bordó": "BORDÓ", "bordo": "BORDÓ", "burgundy": "BORDÓ",
  "bézs": "BÉZS", "bezs": "BÉZS", "beige": "BÉZS",
  "türkiz": "TÜRKIZ", "turkiz": "TÜRKIZ",
};

const TYPE_WORDS: Record<string, string> = {
  "zokni": "ZOKNI", "socks": "ZOKNI",
  "pulcsi": "PULÓVER", "pulóver": "PULÓVER", "sweater": "PULÓVER",
  "hoodie": "HOODIE", "kapucnis": "HOODIE",
  "póló": "PÓLÓ", "tshirt": "PÓLÓ",
  "nadrág": "NADRÁG", "nadrag": "NADRÁG", "pants": "NADRÁG",
  "farmer": "FARMER", "jeans": "FARMER",
  "cipő": "CIPŐ", "cipo": "CIPŐ", "sneaker": "CIPŐ",
  "kabát": "KABÁT", "kabat": "KABÁT", "jacket": "KABÁT",
  "szoknya": "SZOKNYA", "skirt": "SZOKNYA",
  "ruha": "RUHA", "dress": "RUHA",
  "ing": "ING", "shirt": "ING",
  "táska": "TÁSKA", "taska": "TÁSKA", "bag": "TÁSKA",
  "melegítő": "MELEGÍTŐ", "melegito": "MELEGÍTŐ",
  "sapka": "SAPKA", "hat": "SAPKA",
  "sál": "SÁL", "sal": "SÁL",
};

/**
 * Felismeri a user szövegéből a kért szín(eke)t és típus(oka)t,
 * és explicit utasítást generál az LLM-nek.
 */
function detectExplicitFilters(freeText: string, interests: string[]): string {
  const combined = [freeText || "", ...(interests || [])].join(" ").toLowerCase();
  const tokens = combined.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);

  const foundColors = new Set<string>();
  const foundTypes = new Set<string>();

  for (const token of tokens) {
    if (COLOR_WORDS[token]) foundColors.add(COLOR_WORDS[token]);
    if (TYPE_WORDS[token]) foundTypes.add(TYPE_WORDS[token]);
  }

  const lines: string[] = [];
  if (foundColors.size > 0) {
    lines.push(`- SZÍN: ${[...foundColors].join(", ")} → items-be CSAK ezzel a színnel illenek! Ha a termék nevében/leírásában nincs szín-adat, becsüld meg a termék nevéből, hogy milyen színű lehet.`);
  }
  if (foundTypes.size > 0) {
    lines.push(`- TÍPUS: ${[...foundTypes].join(", ")} → items-be CSAK ez a terméktípus kerüljön!`);
  }
  if (lines.length === 0) {
    lines.push("(Nincs explicit szín/típus szűrő — válaszd a legrelevánsabb termékeket.)");
  }

  return lines.join("\n");
}

/**
 * Régi mismatch túl "harapós" volt (1 db token sem egyezett => mismatch).
 * Itt enyhítünk: csak akkor mismatch, ha a usernek van érdemi tokenje,
 * és a teljes listában összesen is kb 0 egyezés van.
 */
function estimateMismatch(user: UserContext, products: Product[]): boolean {
  const q = getUserTokens(user);
  if (q.length === 0) return false;

  let hit = 0;
  for (const p of products) {
    const pt = getProductTokens(p);
    for (const t of q) {
      if (pt.has(t)) {
        hit++;
        break;
      }
    }
    if (hit >= 2) return false; // már 2 terméknél volt valami egyezés → nem mismatch
  }
  return true;
}

/* ===================== FALLBACK REASON — tényszerű, termékleíró, VÁLTOZATOS ===================== */

// 8 sablon a determinisztikus rotációhoz
const REASON_TEMPLATES = [
  (attrs: string[]) => attrs.length > 0 ? `${attrs.join(", ")}.` : "Népszerű termék.",
  (attrs: string[]) => attrs.length > 0 ? `Ajánljuk: ${attrs.join(", ")}.` : "Kedvelt darab.",
  (attrs: string[]) => attrs.length > 0 ? `${attrs[0]}${attrs.length > 1 ? ` – ${attrs.slice(1).join(", ")}` : ""}.` : "Kiváló választás.",
  (attrs: string[]) => attrs.length > 0 ? `Jellemzői: ${attrs.join(", ")}.` : "Megbízható minőség.",
  (attrs: string[]) => attrs.length > 0 ? `Ez a termék: ${attrs.join(", ")}.` : "Praktikus darab.",
  (attrs: string[]) => attrs.length > 1 ? `${attrs[0]}, ${attrs.slice(1).join(" és ")}.` : (attrs[0] || "Hasznos termék."),
  (attrs: string[]) => attrs.length > 0 ? `Tulajdonságok: ${attrs.join(", ")}.` : "Sokoldalú választás.",
  (attrs: string[]) => attrs.length > 0 ? `${attrs.join(" | ")}.` : "Elérhető termék.",
];

// Hash product_id to get deterministic template index
function hashProductId(productId: string): number {
  let hash = 0;
  const str = String(productId || "");
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// Extract color from product
function extractColor(product: Product): string | null {
  const text = `${product.name || ""} ${(product as any).description || ""}`.toLowerCase();
  const colorMap: Record<string, string> = {
    "fekete": "fekete", "black": "fekete",
    "fehér": "fehér", "feher": "fehér", "white": "fehér",
    "kék": "kék", "kek": "kék", "blue": "kék", "navy": "sötétkék",
    "piros": "piros", "red": "piros",
    "zöld": "zöld", "zold": "zöld", "green": "zöld",
    "sárga": "sárga", "sarga": "sárga", "yellow": "sárga",
    "szürke": "szürke", "szurke": "szürke", "grey": "szürke", "gray": "szürke",
    "barna": "barna", "brown": "barna",
    "rózsaszín": "rózsaszín", "rozsaszin": "rózsaszín", "pink": "rózsaszín",
    "lila": "lila", "purple": "lila",
    "narancs": "narancs", "orange": "narancs",
  };
  for (const [key, hun] of Object.entries(colorMap)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(text)) {
      return hun;
    }
  }
  return null;
}

// Extract material from description
function extractMaterial(desc: string): string | null {
  if (!desc) return null;
  const matchers = [
    /(\d+\s*GSM)/i,
    /(organic\s+cotton|100%\s+pamut|100%\s+cotton)/i,
    /(pamut|polyester|bőr|leather|denim|fleece|gyapjú|wool|selyem|silk)/i,
  ];
  for (const re of matchers) {
    const m = desc.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

// Extract type/style from product
function extractType(product: Product): string | null {
  const cat = String(product.category || "");
  const type = (product as any).product_type || "";
  
  // Shopify breadcrumb → last segment
  if (cat.includes(">")) {
    return cat.split(">").pop()!.trim();
  }
  if (type && type.length < 30) return type;
  if (cat && cat.length < 30) return cat;
  return null;
}

function buildFallbackReason(
  user: UserContext,
  product: Product,
  mismatch: boolean,
  catalogHintShort: string
): string {
  const productId = (product as any).product_id || product.name || "";
  const templateIdx = hashProductId(productId) % REASON_TEMPLATES.length;
  
  const desc = String((product as any).description || "").trim();
  
  // Collect attributes
  const attrs: string[] = [];
  
  // Color
  const color = extractColor(product);
  if (color) attrs.push(color);
  
  // Type/category
  const type = extractType(product);
  if (type && type.length < 40) attrs.push(type);
  
  // Material
  const material = extractMaterial(desc);
  if (material) attrs.push(material);
  
  // Fit/style
  const fitMatch = desc.match(/(oversized|slim|relaxed|boxy|regular)\s*(fit|szabás)?/i);
  if (fitMatch) attrs.push(fitMatch[0].trim());
  
  // Dedupe attrs
  const uniqueAttrs = [...new Set(attrs)].slice(0, 3);
  
  // Apply template
  const template = REASON_TEMPLATES[templateIdx];
  return template(uniqueAttrs);
}


/* ===================== DEDUPE ===================== */

function productKey(p: Product): string {
  return baseId(p);
}

function uniqueByProduct(items: RankedProduct[]): RankedProduct[] {
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const out: RankedProduct[] = [];
  for (const it of items) {
    const k = productKey(it.product);
    const name = String(it.product.name || "").trim().toLowerCase();
    if (seen.has(k)) continue;
    if (name && seenNames.has(name)) continue;
    seen.add(k);
    if (name) seenNames.add(name);
    out.push(it);
  }
  return out;
}

/* ===================== LLM RERANK (2 lista + notice) ===================== */

export async function rerankWithLLM(user: UserContext, products: Product[]): Promise<RerankResult> {
  if (!products || products.length === 0) {
    return { items: [], also_items: [], notice: "Nincs termék a listában." };
  }

  const catalog = summarizeCatalog(products);
  const mismatch = estimateMismatch(user, products);

  const catalogHintShort =
    catalog.cats && catalog.cats.length
      ? catalog.cats.join(", ")
      : catalog.words && catalog.words.length
        ? catalog.words.slice(0, 4).join(", ")
        : "a webshop saját kínálata";

  // prompt méret csökkentés a stabilitásért
  const userForLLM = {
    age: user.age ?? null,
    gender: user.gender ?? "unknown",
    relationship: user.relationship ?? "",
    budget_min: user.budget_min ?? null,
    budget_max: user.budget_max ?? null,
    interests: Array.isArray(user.interests) ? user.interests.slice(0, 30) : [],
    free_text: cut(user.free_text || "", 600),
  };

  const productList = products.map((p, idx) => {
    const parts: string[] = [];
    if ((p as any).description) parts.push(cut((p as any).description, 200));
    if ((p as any).tags) parts.push(`[${cut((p as any).tags, 120)}]`);
    if ((p as any).product_type) parts.push(`(${(p as any).product_type})`);
    if ((p as any).vendor) parts.push(`by ${(p as any).vendor}`);

    return {
      index: idx,
      product_id: (p as any).product_id,
      name: p.name,
      price: (p as any).price,
      category: (p as any).category,
      info: parts.join(" ") || "",
    };
  });

  // ✅ JAVÍTOTT: több item visszaadása (12-20)
  const maxTotal = Math.min(30, products.length);
  const maxMain = Math.min(15, products.length);
  const maxAlso = Math.min(15, products.length);

  const minMainTarget = Math.min(8, maxMain);
  const minAlsoTarget = Math.min(12, maxAlso);

  const systemPrompt = `
Te egy magyar nyelvű termékajánló rendszer vagy. Egy webshop ajánló widgetjéhez rendezed a termékeket.

FELADATOD:
Két rendezett listát adj vissza JSON-ban:
1) "items" — A felhasználó kéréséhez LEGJOBBAN illő termékek
2) "also_items" — Kiegészítő ajánlatok, amik még relevánsak lehetnek

RANGSOROLÁSI ELVEK (fontossági sorrendben):
1. RELEVANCIA: A felhasználó szavainak pontos megértése. Csak az számít, amit a user TÉNYLEGESEN írt/kért.
2. TERMÉKTÍPUS EGYEZÉS: Ha konkrét típust kér (pl. nadrág, cipő), items-ben KIZÁRÓLAG az adott típus.
3. SZÍN EGYEZÉS: Ha konkrét színt kér, items-ben CSAK az adott színű termékek.
4. ÁRTARTOMÁNY: A budget_min–budget_max közötti termékeket preferáld.
5. VÁLTOZATOSSÁG: Ne adj 5 nagyon hasonló terméket.

INDOKLÁS SZABÁLYOK (KRITIKUS):
- Minden "reason" legyen MAX 1-2 MONDAT, MAX 180 KARAKTER!
- TÉNYSZERŰ, a TERMÉK valódi tulajdonságairól szóljon
- NE találj ki tulajdonságokat! Csak a termék nevéből, leírásából, kategóriájából, tagjeiből vett tényeket írd.
- NE hivatkozz a user kérésére (ne írd: "a keresésedhez illik", "remek választás")
- NE ismételd ugyanazt a reason-t több terméknél! Mindegyik legyen egyedi.
  
Példák:
✓ "Kapucnis pulóver, 450GSM organikus pamut."
✓ "Kék tank top, laza szabás, organikus pamut."
✓ "Oversized crewneck, sötét szín."
✗ "Remek választás!" — üres
✗ "A keresésedhez illik" — tiltott

NOTICE SZABÁLY:
- A "notice" mező legyen null. A notice-ot a rendszer generálja, NEM te.

VÁLASZFORMÁTUM (kizárólag JSON):
{
  "notice": null,
  "items": [ { "index": 0, "reason": "Max 180 karakter, tényszerű" } ],
  "also_items": [ { "index": 1, "reason": "Max 180 karakter, tényszerű" } ]
}

KORLÁTOK:
- items: 1-${maxMain} db
- also_items: 4-${maxAlso} db
- Egy index NE legyen mindkét listában
- CSAK a kapott adatokból (name/category/description/price/tags) indokolj!
`.trim();

  const userPrompt = `
FELHASZNÁLÓ:
- Szabad szöveg: "${userForLLM.free_text || "(nincs)"}"
- Érdeklődés: ${userForLLM.interests.length > 0 ? userForLLM.interests.join(", ") : "(nincs)"}
- Kapcsolat (kinek): ${userForLLM.relationship || "(nincs megadva)"}
- Nem: ${userForLLM.gender || "ismeretlen"}
- Kor: ${userForLLM.age ?? "ismeretlen"}
- Budget: ${userForLLM.budget_min ?? "?"} – ${userForLLM.budget_max ?? "?"} Ft

⚠️ EXPLICIT SZŰRŐK (az items listában KÖTELEZŐ betartani):
${detectExplicitFilters(userForLLM.free_text, userForLLM.interests)}

BOLT JELLEMZÉSE: ${catalog.hint}
${mismatch ? "⚠ A keresés és a bolt kínálata nem fedi egymást teljesen. Válaszd a legközelebbi releváns termékeket." : ""}

TERMÉKLISTA (${productList.length} db):
${JSON.stringify(productList, null, 2)}
`.trim();

  function mapFromIdxArr(arr: any[], forbidIdx: Set<number>): RankedProduct[] {
    const out: RankedProduct[] = [];
    for (const it of Array.isArray(arr) ? arr : []) {
      const idx = Number(it?.index);
      if (!Number.isFinite(idx)) continue;
      if (idx < 0 || idx >= products.length) continue;
      if (forbidIdx.has(idx)) continue;

      const r0 = String(it?.reason || "").trim();
      const fallback = buildFallbackReason(user, products[idx], mismatch, catalogHintShort);

      out.push({
        product: products[idx],
        reason: r0.length ? r0 : fallback,
      });

      forbidIdx.add(idx);
    }
    return uniqueByProduct(out);
  }

  function fillFromRemaining(
    base: RankedProduct[],
    used: Set<number>,
    targetCount: number,
    allowMismatchText: boolean
  ): RankedProduct[] {
    const out = [...base];
    for (let i = 0; i < products.length && out.length < targetCount; i++) {
      if (used.has(i)) continue;
      used.add(i);
      out.push({
        product: products[i],
        reason: buildFallbackReason(user, products[i], allowMismatchText, catalogHintShort),
      });
    }
    return uniqueByProduct(out);
  }

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // ✅ kreatívabb, de nem elszállós
        temperature: 0.65,
      });

      const raw = response.choices[0]?.message?.content || "";
      if (!raw) throw new Error("EMPTY_GPT_RESPONSE");

      const jsonStr = extractJsonObject(raw);
      if (!jsonStr) throw new Error("NO_JSON_OBJECT_IN_RESPONSE");

      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new Error("JSON_PARSE_FAILED");
      }

      const used = new Set<number>();

      let items = mapFromIdxArr(parsed?.items || [], used).slice(0, maxMain);
      let also_items = mapFromIdxArr(parsed?.also_items || [], used).slice(0, maxAlso);

      // ✅ ha LLM túl „szűk”, feltöltjük mindkettőt
      items = fillFromRemaining(items, used, minMainTarget, mismatch).slice(0, maxMain);
      also_items = fillFromRemaining(also_items, used, minAlsoTarget, mismatch).slice(0, maxAlso);

      // notice: csak ha TÉNYLEG nincs releváns találat (mismatch=true ÉS items üres)
      // Ha vannak items, ne zavarjuk üzenettel — a recommend.ts úgyis felülírja ha kell
      let notice = "";
      if (mismatch && items.length === 0) {
        notice = `A bolt kínálatából válogattam neked néhány ajánlatot.`;
      }

      // total limit (items elsőbbség)
      const total = [...items, ...also_items].slice(0, maxTotal);
      const finalItems = total.slice(0, Math.min(items.length, maxMain));
      const finalAlso = total.slice(finalItems.length);

      return { items: finalItems, also_items: finalAlso, notice: notice || null };
    } catch (err: any) {
      const status = toStatus(err);
      const msg = String(err?.message || err);

      const retry = isRetryable(err) && attempt < MAX_ATTEMPTS;
      if (retry) {
        const wait = 450 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
        console.warn(
          `[rerank] GPT hiba (attempt ${attempt}/${MAX_ATTEMPTS}) status=${status ?? "-"} msg=${msg}. Retry ${wait}ms...`
        );
        await sleep(wait);
        continue;
      }

      console.error(
        `[rerank] GPT végleges hiba (attempt ${attempt}/${MAX_ATTEMPTS}) status=${status ?? "-"} msg=${msg}. Fallback.`
      );

      // végső fallback: legyen normális UX → items is kapjon párat
      const used = new Set<number>();
      const items: RankedProduct[] = [];
      const also: RankedProduct[] = [];

      // items: első 3
      for (let i = 0; i < Math.min(minMainTarget, products.length); i++) {
        used.add(i);
        items.push({
          product: products[i],
          reason: buildFallbackReason(user, products[i], mismatch, catalogHintShort),
        });
      }
      // also: következő 5-10
      for (let i = 0; i < products.length && also.length < minAlsoTarget; i++) {
        if (used.has(i)) continue;
        used.add(i);
        also.push({
          product: products[i],
          reason: buildFallbackReason(user, products[i], mismatch, catalogHintShort),
        });
      }

      const notice = mismatch
        ? `A bolt kínálatából válogattam neked néhány ajánlatot.`
        : "";

      return { items, also_items: also, notice };
    }
  }

  // elvileg nem fut ide
  const items: RankedProduct[] = products.slice(0, Math.min(3, products.length)).map((p) => ({
    product: p,
    reason: buildFallbackReason(user, p, false, "a webshop saját kínálata"),
  }));
  const also: RankedProduct[] = products.slice(items.length, Math.min(items.length + 7, products.length)).map((p) => ({
    product: p,
    reason: buildFallbackReason(user, p, false, "a webshop saját kínálata"),
  }));

  return { items, also_items: also, notice: "Mutatok néhány alternatívát." };
}
