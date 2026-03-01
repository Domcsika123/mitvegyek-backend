// src/ai/rerank.ts
// ✅ REBUILT: Multilingual LLM reranker optimized for English + Hungarian catalogs
import OpenAI from "openai";
import { UserContext } from "../models/UserContext";
import { Product } from "../models/Product";
import { baseId } from "./queryUtils";
import { buildCardDescription } from "../reco/buildCardDescription";

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

/* ===================== TOKENIZÁLÓ (HU + EN) ===================== */

const STOP = new Set([
  "a", "az", "és", "meg", "de", "hogy", "nem", "is", "van", "volt", "vagy",
  "mert", "mint", "egy", "egyik", "másik", "valami", "nagyon", "csak",
  "szeret", "szereti", "termék", "termek", "cucc", "dolog", "pl", "például",
  "pl.", "kb", "kell", "legyen",
  "the", "and", "or", "but", "for", "with", "from", "this", "that", "its",
  "are", "was", "is", "it", "be", "have", "has", "do", "does", "will",
  "would", "could", "should", "can", "an", "of", "to", "in", "on", "at",
]);

function tokenize(s: string): string[] {
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
    for (const it of user.interests) out.push(...tokenize(String(it)));
  }
  out.push(...tokenize(user.free_text || ""));
  out.push(...tokenize(user.relationship || ""));
  return [...new Set(out)].slice(0, 80);
}

function getProductTokens(p: Product): Set<string> {
  const hay = `${p.name || ""} ${p.category || ""} ${p.description || ""}`;
  return new Set(tokenize(hay));
}

function summarizeCatalog(products: Product[]): { hint: string; cats: string[] } {
  const catCount = new Map<string, number>();
  for (const p of products) {
    const cat = String(p.category || "").trim();
    const last = cat.includes(">")
      ? cat.split(">").pop()!.trim().toLowerCase()
      : cat.toLowerCase();
    if (last) catCount.set(last, (catCount.get(last) || 0) + 1);
  }
  const cats = [...catCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c]) => c);
  const hint = cats.length ? `catalog categories: ${cats.join(", ")}` : "unknown catalog";
  return { hint, cats };
}

function estimateMismatch(user: UserContext, products: Product[]): boolean {
  const q = getUserTokens(user);
  if (q.length === 0) return false;
  let hit = 0;
  for (const p of products) {
    const pt = getProductTokens(p);
    for (const t of q) {
      if (pt.has(t)) { hit++; break; }
    }
    if (hit >= 2) return false;
  }
  return true;
}

/* ===================== EXPLICIT FILTER FELISMERÉS (HU + EN) ===================== */

const COLOR_WORDS: Record<string, string> = {
  // Hungarian
  "kék": "BLUE", "kek": "BLUE", "sötétkék": "NAVY BLUE",
  "piros": "RED", "vörös": "RED",
  "sárga": "YELLOW", "sarga": "YELLOW",
  "zöld": "GREEN", "zold": "GREEN",
  "fekete": "BLACK",
  "fehér": "WHITE", "feher": "WHITE",
  "szürke": "GREY", "szurke": "GREY",
  "barna": "BROWN",
  "narancs": "ORANGE",
  "lila": "PURPLE",
  "rózsaszín": "PINK", "rozsaszin": "PINK",
  "bordó": "BURGUNDY", "bordo": "BURGUNDY",
  "bézs": "BEIGE", "bezs": "BEIGE",
  "türkiz": "TURQUOISE", "turkiz": "TURQUOISE",
  "krém": "CREAM", "krem": "CREAM",
  // English
  "blue": "BLUE", "navy": "NAVY BLUE",
  "red": "RED", "crimson": "RED",
  "yellow": "YELLOW",
  "green": "GREEN", "olive": "OLIVE GREEN",
  "black": "BLACK",
  "white": "WHITE",
  "grey": "GREY", "gray": "GREY",
  "brown": "BROWN", "tan": "BROWN",
  "orange": "ORANGE",
  "purple": "PURPLE", "violet": "PURPLE",
  "pink": "PINK",
  "burgundy": "BURGUNDY", "wine": "BURGUNDY",
  "beige": "BEIGE", "sand": "BEIGE",
  "turquoise": "TURQUOISE", "teal": "TURQUOISE",
  "cream": "CREAM",
  "court purple": "PURPLE",
};

const TYPE_WORDS: Record<string, string> = {
  // Hungarian
  "zokni": "SOCKS",
  "pulcsi": "SWEATER", "pulóver": "SWEATER", "pulover": "SWEATER",
  "hoodie": "HOODIE", "kapucnis": "HOODIE",
  "melegítő": "SWEATSHIRT", "melegito": "SWEATSHIRT",
  "póló": "T-SHIRT", "polo": "T-SHIRT",
  "nadrág": "PANTS", "nadrag": "PANTS",
  "farmer": "JEANS",
  "cipő": "SHOES", "cipo": "SHOES",
  "kabát": "JACKET", "kabat": "JACKET",
  "szoknya": "SKIRT",
  "ruha": "DRESS",
  "ing": "SHIRT",
  "táska": "BAG", "taska": "BAG",
  "sapka": "CAP",
  "sál": "SCARF", "sal": "SCARF",
  "rövidnadrág": "SHORTS", "rovidnadrag": "SHORTS",
  "trikó": "TANK TOP",
  // English
  "socks": "SOCKS",
  "sweater": "SWEATER", "crewneck": "SWEATER", "jumper": "SWEATER",
  "sweatshirt": "SWEATSHIRT",
  "t-shirt": "T-SHIRT", "tshirt": "T-SHIRT", "tee": "T-SHIRT",
  "shirt": "SHIRT",
  "pants": "PANTS", "trousers": "PANTS", "joggers": "PANTS",
  "jeans": "JEANS", "denim": "JEANS",
  "shoes": "SHOES",
  "sneakers": "SNEAKERS", "sneaker": "SNEAKERS",
  "boots": "BOOTS",
  "jacket": "JACKET",
  "coat": "JACKET",
  "skirt": "SKIRT",
  "dress": "DRESS",
  "bag": "BAG",
  "backpack": "BACKPACK",
  "cap": "CAP", "hat": "CAP", "beanie": "BEANIE",
  "scarf": "SCARF",
  "shorts": "SHORTS", "bermuda": "SHORTS",
  "tank top": "TANK TOP", "tank": "TANK TOP", "tanktop": "TANK TOP",
  "vest": "TANK TOP",
  "zip hoodie": "ZIP HOODIE", "zip-up": "ZIP HOODIE",
};

function detectExplicitFilters(freeText: string, interests: string[]): string {
  const combined = [freeText || "", ...(interests || [])].join(" ").toLowerCase();
  const tokens = combined.split(/[\s\-–—_,;:!?.()[\]{}'"\/|]+/).filter(Boolean);

  const foundColors = new Set<string>();
  const foundTypes = new Set<string>();

  for (const token of tokens) {
    if (COLOR_WORDS[token]) foundColors.add(COLOR_WORDS[token]);
    if (TYPE_WORDS[token]) foundTypes.add(TYPE_WORDS[token]);
  }

  // Two-word phrases
  for (let i = 0; i < tokens.length - 1; i++) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    if (COLOR_WORDS[phrase]) foundColors.add(COLOR_WORDS[phrase]);
    if (TYPE_WORDS[phrase]) foundTypes.add(TYPE_WORDS[phrase]);
  }

  const lines: string[] = [];
  if (foundColors.size > 0) {
    lines.push(
      `- COLOR FILTER: ${[...foundColors].join(", ")} → "items" list MUST ONLY contain products of this color. Check name + description.`
    );
  }
  if (foundTypes.size > 0) {
    lines.push(
      `- TYPE FILTER: ${[...foundTypes].join(", ")} → "items" list MUST ONLY contain this product type. No other types allowed in items.`
    );
  }
  if (lines.length === 0) {
    lines.push("(No explicit filter — select the most relevant products.)");
  }

  return lines.join("\n");
}


function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/* ===================== DEDUPE ===================== */

function uniqueByProduct(items: RankedProduct[]): RankedProduct[] {
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const out: RankedProduct[] = [];
  for (const it of items) {
    const k = baseId(it.product);
    const name = String(it.product.name || "").trim().toLowerCase();
    if (seen.has(k)) continue;
    if (name && seenNames.has(name)) continue;
    seen.add(k);
    if (name) seenNames.add(name);
    out.push(it);
  }
  return out;
}

/* ===================== LLM RERANK ===================== */

export async function rerankWithLLM(
  user: UserContext,
  products: Product[],
  options?: { strictMode?: boolean; secondaryProducts?: Product[] }
): Promise<RerankResult> {
  if (!products || products.length === 0) {
    return { items: [], also_items: [], notice: null };
  }

  const strictMode = options?.strictMode ?? false;
  const secondaryProducts = options?.secondaryProducts ?? [];
  const numPrimary = products.length;

  // All products in one list: primary first, then secondary
  const allProducts = [...products, ...secondaryProducts];

  const catalog = summarizeCatalog(allProducts);
  const mismatch = estimateMismatch(user, products);

  // Detect if catalog is English (Unreal, Shopify EN, etc.)
  const sampleText = products.slice(0, 8).map(p => `${p.name || ""} ${p.category || ""}`).join(" ").toLowerCase();
  const isEnglishCatalog = /\b(tank|hoodie|shorts|tee|shirt|sneaker|sweatshirt|crewneck|apparel)\b/.test(sampleText);

  const userForLLM = {
    age: user.age ?? null,
    gender: user.gender ?? "unknown",
    relationship: user.relationship ?? "",
    budget_min: user.budget_min ?? null,
    budget_max: user.budget_max ?? null,
    interests: Array.isArray(user.interests) ? user.interests.slice(0, 30) : [],
    free_text: cut(user.free_text || "", 600),
  };

  // Build product list — strip HTML from descriptions, remove size suffixes from names
  const productList = allProducts.map((p, idx) => {
    const rawDesc = String((p as any).description || "");
    const cleanDesc = stripHtml(rawDesc).slice(0, 280);
    const catLast = (p.category || "").includes(">")
      ? (p.category || "").split(">").pop()!.trim()
      : (p.category || "");

    // Strip size suffix from product name so LLM doesn't generate size-specific reasons
    let cleanName = String(p.name || "");
    cleanName = cleanName.replace(/\s*\((?:[^()]*|\([^()]*\))*\)\s*$/, "").trim();
    cleanName = cleanName.replace(/\s*[-–\/|]\s*(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{2,3})\s*$/i, "").trim();

    return {
      index: idx,
      product_id: (p as any).product_id,
      name: cleanName || p.name,
      price: p.price,
      category: catLast,
      description: cleanDesc,
    };
  });

  // In strict mode: primary (0..numPrimary-1) are exact matches → items
  //                 secondary (numPrimary..end) are alternatives → also_items
  // In non-strict:  LLM decides items vs also_items for primary; secondary always → also_items
  const maxMain = Math.min(8, numPrimary);
  const minMain = Math.min(4, numPrimary);
  const maxAlso = Math.min(15, allProducts.length);
  const minAlso = secondaryProducts.length > 0 ? secondaryProducts.length : Math.min(3, Math.max(0, allProducts.length - 5));

  const secondaryNote = secondaryProducts.length > 0
    ? `\nNOTE: Products with index ${numPrimary}–${allProducts.length - 1} are ALTERNATIVE suggestions (not exact matches) → put them in "also_items".`
    : "";

  const systemPrompt = strictMode ? `
You are a product recommendation AI. Generate ranked results with Hungarian reasons.

OUTPUT: JSON only.
{
  "items": [ { "index": <number>, "reason": "<Hungarian text, max 180 chars>" } ],
  "also_items": [ { "index": <number>, "reason": "<Hungarian text, max 180 chars>" } ]
}

⚠️ STRICT MODE:
- Products with index 0–${numPrimary - 1}: EXACT MATCHES → rank by quality and put ALL in "items"
- Products with index ${numPrimary}–${allProducts.length - 1}: ALTERNATIVES → put ALL in "also_items"

REASON RULES:
- Write ALL reasons in HUNGARIAN language
- MINIMUM 80 characters, maximum 160 — SHORT descriptions are NOT acceptable
- Include ALL available details: color, material (weight, composition), fit (oversized, slim, relaxed), special features (collaboration, limited edition, graphic description, special technique)
- Do NOT repeat the product name or brand — it's already in the title
- Do NOT end with "a kényelmes viseletért", "biztosít", "tökéletes", "kiváló" — BANNED
- Do NOT use: "Remek választás", "pont illik", "a keresésedhez" — BANNED
- Do NOT invent attributes not in the product data
- Do NOT mention specific sizes (S, M, L, XL, EU 42, etc.)
- Make each reason UNIQUE

LIMITS:
- items: ${minMain} to ${maxMain} entries (from indexes 0–${numPrimary - 1} only)
- also_items: up to ${maxAlso} entries (from indexes ${numPrimary}–${allProducts.length - 1})
- Each index appears EXACTLY ONCE
`.trim() : `
You are a product recommendation AI. Rank products into two lists based on the user's request.

OUTPUT: JSON only.
{
  "items": [ { "index": <number>, "reason": "<Hungarian text, max 180 chars>" } ],
  "also_items": [ { "index": <number>, "reason": "<Hungarian text, max 180 chars>" } ]
}

RANKING RULES (strict priority order):
1. EXPLICIT TYPE: If user asked for a specific product type → items MUST contain ONLY that type
2. EXPLICIT COLOR: If user asked for a specific color → items MUST contain ONLY products of that color
3. BUDGET: Prefer products within the stated price range
4. RELEVANCE: Semantic match to user intent
5. VARIETY: Avoid 5+ near-identical products
${secondaryNote}

REASON RULES:
- Write ALL reasons in HUNGARIAN language
- MAX 90 characters per reason — keep it SHORT and FACTUAL
- Format: "[Szín] [anyag] [típus], [jellemzők]." — e.g. "Fekete pamut póló, bő szabású, vastag anyag."
- Do NOT repeat the product name or brand — it's already in the title
- Do NOT end with "a kényelmes viseletért", "biztosít", "tökéletes", "kiváló" — BANNED
- Do NOT use: "Remek választás", "pont illik", "a keresésedhez" — BANNED
- Do NOT invent attributes not present in the product data
- Do NOT mention specific sizes (S, M, L, XL, EU 42, etc.) — products are shown without size selection
- Make each reason UNIQUE (no copy-paste between products)

Good examples:
✓ "Szürke, laza szabású nehéz pamut póló, cold dyed technikával, együttműködés az Eberkoma előadóval."
✓ "Fehér washed organikus pamut póló, enyhén oversized szabás, portugál gyártás."
✓ "Fekete zip hoodie, 100% pamut, laza szabás, ikonikus logóval az elején."
✓ "Court Purple rövidnadrág, mélyzsebes kialakítás, streetwear stílusban."
✓ "Washed fehér tank top, 100% organikus pamut, grafikás hátoldal."

Bad examples:
✗ "UNREAL Eberkoma Grey póló, magas minőségű pamutból." — brand/product name repeated
✗ "Szürke póló." — too short, no details
✗ "Remek választás!" — generic
✗ "Pont illik a keresésedhez." — banned phrase

LIMITS:
- items: ${minMain} to ${maxMain} entries (PREFER filling items list first — aim for 5-8)
- also_items: ${minAlso} to ${maxAlso} entries
- Each index in EXACTLY ONE list (no duplicates)
`.trim();

  const explicitFilters = detectExplicitFilters(userForLLM.free_text, userForLLM.interests);

  const userPrompt = `
USER:
- Request: "${userForLLM.free_text || "(none)"}"
- Interests: ${userForLLM.interests.length > 0 ? userForLLM.interests.join(", ") : "(none)"}
- For whom: ${userForLLM.relationship || "(not specified)"}
- Gender: ${userForLLM.gender || "unknown"}
- Age: ${userForLLM.age ?? "unknown"}
- Budget: ${userForLLM.budget_min ?? "?"} – ${userForLLM.budget_max ?? "?"}

⚠️ MANDATORY FILTERS for "items" list:
${explicitFilters}

CATALOG TYPE: ${catalog.hint}${isEnglishCatalog ? " (English/international brand)" : ""}
${mismatch ? "⚠ The query may not perfectly match this catalog. Select the closest relevant products." : ""}

PRODUCTS (${productList.length} items):
${JSON.stringify(productList, null, 2)}
`.trim();

  // Map LLM array output to RankedProduct[]. maxIdx limits which indexes are valid.
  function mapFromArr(arr: any[], forbidden: Set<number>, maxIdx: number): RankedProduct[] {
    const out: RankedProduct[] = [];
    for (const it of Array.isArray(arr) ? arr : []) {
      const idx = Number(it?.index);
      if (!Number.isFinite(idx) || idx < 0 || idx >= maxIdx) continue;
      if (forbidden.has(idx)) continue;
      const reason = String(it?.reason || "").trim();
      out.push({
        product: allProducts[idx],
        reason: reason.length > 0 ? reason : (buildCardDescription(allProducts[idx]) || allProducts[idx].name || "Ajánlott termék"),
      });
      forbidden.add(idx);
    }
    return uniqueByProduct(out);
  }

  function fillRemaining(base: RankedProduct[], used: Set<number>, target: number, fromIdx: number, toIdx: number): RankedProduct[] {
    const out = [...base];
    for (let i = fromIdx; i < toIdx && out.length < target; i++) {
      if (used.has(i)) continue;
      used.add(i);
      out.push({ product: allProducts[i], reason: buildCardDescription(allProducts[i]) || allProducts[i].name || "Ajánlott termék" });
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
        temperature: 0.3,
      });

      const raw = response.choices[0]?.message?.content || "";
      if (!raw) throw new Error("EMPTY_RESPONSE");

      const jsonStr = extractJsonObject(raw);
      if (!jsonStr) throw new Error("NO_JSON");

      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        throw new Error("JSON_PARSE_FAILED");
      }

      const used = new Set<number>();
      // items: only from primary indexes (0..numPrimary-1)
      // also_items: from any index, but enforce secondary (numPrimary+) go here
      let items = mapFromArr(parsed?.items || [], used, numPrimary).slice(0, maxMain);
      // also_items: LLM may put secondary indexes here (numPrimary+), allow full range
      let also_items = mapFromArr(parsed?.also_items || [], used, allProducts.length).slice(0, maxAlso);
      // Move any secondary indexes that LLM accidentally put in items → also_items
      // (already prevented by maxIdx=numPrimary above, so no additional check needed)

      items = fillRemaining(items, used, minMain, 0, numPrimary).slice(0, maxMain);
      // Fill also_items from secondary candidates first, then primary leftovers
      also_items = fillRemaining(also_items, used, minAlso, numPrimary, allProducts.length).slice(0, maxAlso);

      const notice = (mismatch && items.length === 0)
        ? "A legjobb elérhető termékeket mutattam meg."
        : null;

      console.log(`[rerank] LLM success: ${items.length} items, ${also_items.length} also_items`);
      return { items, also_items, notice };

    } catch (err: any) {
      const status = toStatus(err);
      const msg = String(err?.message || err);
      const shouldRetry = isRetryable(err) && attempt < MAX_ATTEMPTS;

      if (shouldRetry) {
        const wait = 500 * Math.pow(2, attempt - 1) + Math.random() * 300;
        console.warn(`[rerank] Attempt ${attempt}/${MAX_ATTEMPTS} failed (${status ?? msg}), retry in ${Math.round(wait)}ms`);
        await sleep(wait);
        continue;
      }

      console.error(`[rerank] Fatal error after ${attempt} attempt(s): ${msg}`);

      // Graceful fallback
      const used = new Set<number>();
      const items: RankedProduct[] = [];
      const also: RankedProduct[] = [];
      for (let i = 0; i < Math.min(minMain, numPrimary); i++) {
        used.add(i);
        items.push({ product: allProducts[i], reason: buildCardDescription(allProducts[i]) || allProducts[i].name || "Ajánlott termék" });
      }
      for (let i = 0; i < allProducts.length && also.length < minAlso; i++) {
        if (used.has(i)) continue;
        used.add(i);
        also.push({ product: allProducts[i], reason: buildCardDescription(allProducts[i]) || allProducts[i].name || "Ajánlott termék" });
      }
      return { items, also_items: also, notice: null };
    }
  }

  return { items: [], also_items: [], notice: null };
}
