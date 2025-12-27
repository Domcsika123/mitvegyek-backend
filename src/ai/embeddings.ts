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

function buildUserProfileText(user: UserContext): string {
  const parts: string[] = [];

  if (user.age) parts.push(`${user.age} éves`);
  if (user.gender && user.gender !== "unknown") parts.push(`nem: ${user.gender}`);
  if (user.relationship) parts.push(`kapcsolat: ${user.relationship}`);
  if (user.interests && user.interests.length > 0) {
    parts.push(`érdeklődés: ${user.interests.join(", ")}`);
  }
  if (user.free_text) parts.push(user.free_text);

  return parts.join(". ");
}

function buildProductProfileText(product: Product): string {
  const parts: string[] = [];

  if (product.name) parts.push(product.name);
  if (product.category) parts.push(`kategória: ${product.category}`);
  if (product.description) parts.push(product.description);

  return parts.join(". ");
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

// --- Publikus: embedding alapú rangsorolás ---

export async function rankProductsWithEmbeddings(
  user: UserContext,
  products: Product[]
): Promise<{ product: Product; score: number }[]> {
  if (!products || products.length === 0) {
    return [];
  }

  const userText = buildUserProfileText(user);
  const productTexts = products.map((p) => buildProductProfileText(p));

  const inputs = [userText, ...productTexts];

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputs,
  });

  const vectors = response.data.map((d) => d.embedding as Embedding);

  const userEmbedding = vectors[0];
  const productEmbeddings = vectors.slice(1);

  const scored = products.map((product, index) => {
    const emb = productEmbeddings[index];
    const score = cosineSimilarity(userEmbedding, emb);
    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}
