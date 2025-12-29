// src/ai/embeddings.ts

import OpenAI from "openai";
import { UserContext } from "../models/UserContext";
import { Product } from "../models/Product";

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

  if (user.age) parts.push(`${user.age} éves`);
  if (user.gender && user.gender !== "unknown") parts.push(`nem: ${user.gender}`);
  if (user.relationship) parts.push(`kapcsolat: ${user.relationship}`);
  if (user.interests && user.interests.length > 0) {
    parts.push(`érdeklődés: ${user.interests.join(", ")}`);
  }
  if (user.free_text) parts.push(user.free_text);

  return clampText(parts.join(". "), 800);
}

function buildProductProfileText(product: Product): string {
  const parts: string[] = [];

  if (product.name) parts.push(product.name);
  if (product.category) parts.push(`kategória: ${product.category}`);
  if (product.description) parts.push(product.description);

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

async function embedSingle(text: string): Promise<Embedding> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding as Embedding;
}

/**
 * ✅ IMPORTKOR: termék embeddingek legyártása batch-ben (változó termékszámra jó)
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
      model: "text-embedding-3-small",
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
export async function rankProductsWithEmbeddings(
  user: UserContext,
  products: Product[]
): Promise<{ product: Product; score: number }[]> {
  if (!products || products.length === 0) {
    return [];
  }

  const userText = buildUserProfileText(user);
  const userEmbedding = await embedSingle(userText);

  const scored = products.map((product) => {
    const emb = Array.isArray(product.embedding) ? (product.embedding as Embedding) : null;
    const score = emb ? cosineSimilarity(userEmbedding, emb) : 0;
    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
