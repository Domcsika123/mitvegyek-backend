// src/ai/embeddings.ts

import OpenAI from "openai";
import { UserContext } from "../models/UserContext";
import { Product } from "../models/Product";
import { normalizeHuQuery } from "./queryUtils";

type Embedding = number[];

// --- OpenAI kliens csak valódi API kulccsal ---
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY hiányzik. Állítsd be a .env fájlban.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Segédfüggvények szövegépítéshez ---

function clampText(s: string, maxLen = 600): string {
  if (!s) return "";
  const t = String(s).trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "…";
}

function buildUserProfileText(user: UserContext): string {
  const parts: string[] = [];

  // Szabad szöveges kérés elsőbbséget kap — a legrelevánsabb információ
  if (user.free_text) {
    parts.push(normalizeHuQuery(user.free_text));
  }

  // Érdeklődési körök: normalizálva és súlyozottan
  if (user.interests && user.interests.length > 0) {
    const normalizedInterests = user.interests.map((i) => normalizeHuQuery(i));
    parts.push(`érdeklődés: ${normalizedInterests.join(", ")}`);
  }

  // Kapcsolat kontextus — ajándék-célzott kereséshez kritikus
  if (user.relationship) {
    const relMap: Record<string, string> = {
      partner: "romantikus partner, szerelmes ajándék",
      barát: "barátnak szóló ajándék, baráti gesztus",
      szülő: "szülőnek szóló ajándék, családi",
      testvér: "testvérnek szóló ajándék",
      kolléga: "munkatársnak szóló ajándék, professzionális",
      gyerek: "gyereknek szóló ajándék, játékos",
      nagyszülő: "nagyszülőnek szóló ajándék, praktikus",
    };
    const enriched = relMap[user.relationship.toLowerCase()] || user.relationship;
    parts.push(`ajándék: ${enriched}`);
  }

  // Demográfia: kor és nem finomítja a szemantikus keresést
  if (user.age) {
    if (user.age < 18) parts.push("fiatal, tinédzser");
    else if (user.age < 30) parts.push("fiatal felnőtt");
    else if (user.age < 50) parts.push("középkorú felnőtt");
    else parts.push("idősebb korosztály");
  }
  if (user.gender && user.gender !== "unknown") {
    parts.push(`nem: ${user.gender === "male" ? "férfi" : user.gender === "female" ? "női" : user.gender}`);
  }

  // Budget kontextus — segíti az árszegmens megtalálását
  if (user.budget_max && user.budget_max < 5000) {
    parts.push("olcsó, alacsony árkategória");
  } else if (user.budget_max && user.budget_max < 15000) {
    parts.push("közepes árkategória");
  } else if (user.budget_min && user.budget_min > 20000) {
    parts.push("prémium, magas árkategória");
  }

  return clampText(parts.join(". "), 1000);
}

function buildProductProfileText(product: Product): string {
  const parts: string[] = [];

  if (product.name) parts.push(product.name);
  if (product.category) parts.push(`kategória: ${product.category}`);
  if (product.description) parts.push(product.description);
  // ✅ Shopify extra mezők az embeddingbe (jobb fashion matching)
  if ((product as any).tags) parts.push(`tags: ${(product as any).tags}`);
  if ((product as any).product_type) parts.push(`típus: ${(product as any).product_type}`);
  if ((product as any).vendor) parts.push(`márka: ${(product as any).vendor}`);

  // termék szövege legyen rövidebb (token/költség miatt importkor is)
  return clampText(parts.join(". "), 600);
}

// --- Koszinusz hasonlóság ---

function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (!a || !b || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- belső embedding helper ---

/** LRU cache for user query embeddings (avoids repeated OpenAI API calls) */
const embedCache = new Map<string, Embedding>();

/** Az embedding modellt a termékek dimenziója alapján választjuk ki automatikusan. */
function detectEmbedModel(products: Product[]): string {
  for (const p of products) {
    if (Array.isArray(p.embedding) && p.embedding.length > 0) {
      return p.embedding.length >= 3072 ? "text-embedding-3-large" : "text-embedding-3-small";
    }
  }
  return "text-embedding-3-large";
}

async function embedSingle(text: string, model = "text-embedding-3-large"): Promise<Embedding> {
  // Simple LRU cache for user query embeddings (avoids repeated API calls)
  const cacheKey = `${model}::${text}`;
  const cached = embedCache.get(cacheKey);
  if (cached) return cached;

  const response = await openai.embeddings.create({
    model,
    input: text,
  });
  const emb = response.data[0].embedding as Embedding;

  // Cache with max 200 entries
  if (embedCache.size >= 200) {
    const firstKey = embedCache.keys().next().value;
    if (firstKey !== undefined) embedCache.delete(firstKey);
  }
  embedCache.set(cacheKey, emb);

  return emb;
}

/**
 * ✅ IMPORTKOR: termék embeddingek legyártása batch-ben (text-embedding-3-large)
 * - products: termékek listája
 * - batchSize: hány terméket küldünk egy API hívásban (default 64)
 */
export async function embedProductsInBatches(
  products: Product[],
  batchSize = 64
): Promise<Product[]> {
  if (!products || products.length === 0) return [];

  const out: Product[] = [];

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const inputs = batch.map((p) => buildProductProfileText(p));

    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: inputs,
    });

    for (let j = 0; j < batch.length; j++) {
      const emb = response.data[j]?.embedding as Embedding | undefined;
      out.push({
        ...batch[j],
        embedding: emb,
      });
    }
  }

  return out;
}

// --- Publikus: embedding alapú rangsorolás (KERESÉSKOR) ---
// ✅ Itt már NEM embedeljük újra a termékeket!
// Csak a user kap 1 embeddinget, a termékeknél a tárolt product.embedding-et használjuk.
// ✅ Automatikusan detektáljuk a modellt a termékek dimenziója alapján.
export async function rankProductsWithEmbeddings(
  user: UserContext,
  products: Product[]
): Promise<{ product: Product; score: number }[]> {
  if (!products || products.length === 0) {
    return [];
  }

  const model = detectEmbedModel(products);
  const userText = buildUserProfileText(user);
  const userEmbedding = await embedSingle(userText, model);

  const scored = products.map((product) => {
    const emb = Array.isArray(product.embedding) ? (product.embedding as Embedding) : null;
    const score = emb ? cosineSimilarity(userEmbedding, emb) : 0;
    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
