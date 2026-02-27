// src/ai/embeddingIndex.ts
// ✅ Precomputed embedding cache + cosine search + batch builder

import OpenAI from "openai";
import { Product } from "../models/Product";
import { promises as fs } from "fs";
import * as path from "path";

type Embedding = number[];

// --- OpenAI client ---
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY hiányzik. Állítsd be a .env fájlban.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- In-memory cache per site_key ---
const embeddingCache = new Map<string, Map<string, Embedding>>();

// --- Config ---
const BATCH_SIZE = 64;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const EMBEDDING_MODEL = "text-embedding-3-large";

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function clampText(s: string, maxLen = 600): string {
  if (!s) return "";
  const t = String(s).trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "…";
}

/**
 * Build optimized text for embedding: title + category + key attributes + truncated description.
 * Max ~600-800 characters for token efficiency.
 */
export function buildProductEmbeddingText(product: Product): string {
  const parts: string[] = [];

  // Name is critical
  if (product.name) parts.push(product.name);

  // Category
  if (product.category) {
    // Shopify hierarchical category: take last segment
    const cat = product.category;
    const simplified = cat.includes(">") ? cat.split(">").pop()!.trim() : cat;
    parts.push(simplified);
  }

  // Important attributes (Shopify fields)
  const p = product as any;
  if (p.product_type) parts.push(p.product_type);
  if (p.vendor) parts.push(`márka: ${p.vendor}`);
  if (p.tags) {
    // Take first 5 tags
    const tags = String(p.tags).split(",").slice(0, 5).map((t: string) => t.trim()).filter(Boolean);
    if (tags.length) parts.push(tags.join(", "));
  }

  // Color/material extraction from name/description
  const colorMatch = (product.name || "").match(/\b(black|white|grey|gray|blue|red|green|yellow|pink|purple|orange|brown|beige|navy|fekete|fehér|kék|piros|zöld|sárga|szürke|barna|rózsaszín|lila|narancs)\b/i);
  if (colorMatch) parts.push(`szín: ${colorMatch[1]}`);

  // Truncated description (max 400 chars)
  if (p.description) {
    const desc = clampText(p.description, 400);
    parts.push(desc);
  }

  return clampText(parts.join(". "), 800);
}

/**
 * Embed a single text with retry logic.
 */
async function embedSingleWithRetry(text: string, model = EMBEDDING_MODEL): Promise<Embedding> {
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model,
        input: text,
      });
      return response.data[0].embedding as Embedding;
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;

      // Retry on rate limit or server error
      if (status === 429 || (status >= 500 && status < 600)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[embeddingIndex] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms (status=${status})`);
        await sleep(delay);
        continue;
      }

      // Non-retryable error
      throw err;
    }
  }

  throw lastError;
}

/**
 * Embed multiple texts in batch with retry logic.
 */
async function embedBatchWithRetry(texts: string[], model = EMBEDDING_MODEL): Promise<Embedding[]> {
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model,
        input: texts,
      });
      return response.data.map((d) => d.embedding as Embedding);
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;

      if (status === 429 || (status >= 500 && status < 600)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`[embeddingIndex] Batch retry ${attempt}/${MAX_RETRIES} after ${delay}ms`);
        await sleep(delay);
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

// --- Cosine similarity ---

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

// --- Main API ---

/**
 * Build embeddings for products in batches.
 * Returns products with embedding field populated.
 */
export async function buildProductEmbeddings(
  products: Product[],
  options?: { batchSize?: number; onProgress?: (done: number, total: number) => void }
): Promise<Product[]> {
  const batchSize = options?.batchSize ?? BATCH_SIZE;
  const onProgress = options?.onProgress;

  if (!products || products.length === 0) return [];

  const result: Product[] = [];
  let processed = 0;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const texts = batch.map((p) => buildProductEmbeddingText(p));

    const embeddings = await embedBatchWithRetry(texts);

    for (let j = 0; j < batch.length; j++) {
      result.push({
        ...batch[j],
        embedding: embeddings[j],
      });
    }

    processed += batch.length;
    if (onProgress) onProgress(processed, products.length);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < products.length) {
      await sleep(100);
    }
  }

  return result;
}

/**
 * Get or build embedding for a user query.
 */
export async function getUserQueryEmbedding(
  queryText: string,
  model = EMBEDDING_MODEL
): Promise<Embedding> {
  return embedSingleWithRetry(queryText, model);
}

/**
 * Search products by cosine similarity to a query embedding.
 * Returns products sorted by score descending.
 */
export function searchByEmbedding(
  queryEmbedding: Embedding,
  products: Product[],
  topK = 200
): { product: Product; score: number }[] {
  const scored = products
    .map((product) => {
      const emb = Array.isArray(product.embedding) ? (product.embedding as Embedding) : null;
      const score = emb ? cosineSimilarity(queryEmbedding, emb) : 0;
      return { product, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.min(topK, scored.length));
}

/**
 * Get the best embedding score from a set of results.
 */
export function getBestScore(results: { product: Product; score: number }[]): number {
  if (!results || results.length === 0) return 0;
  return results[0].score;
}

// --- Cache management ---

/**
 * Store embeddings in memory cache for a site.
 */
export function cacheEmbeddings(siteKey: string, products: Product[]): void {
  const cache = new Map<string, Embedding>();
  for (const p of products) {
    if (Array.isArray(p.embedding) && p.embedding.length > 0) {
      cache.set(p.product_id, p.embedding as Embedding);
    }
  }
  embeddingCache.set(siteKey, cache);
}

/**
 * Get cached embedding for a product.
 */
export function getCachedEmbedding(siteKey: string, productId: string): Embedding | null {
  const cache = embeddingCache.get(siteKey);
  if (!cache) return null;
  return cache.get(productId) || null;
}

/**
 * Enrich products with cached embeddings.
 */
export function enrichWithCachedEmbeddings(siteKey: string, products: Product[]): Product[] {
  const cache = embeddingCache.get(siteKey);
  if (!cache || cache.size === 0) return products;

  return products.map((p) => {
    if (Array.isArray(p.embedding) && p.embedding.length > 0) return p;
    const cached = cache.get(p.product_id);
    if (cached) {
      return { ...p, embedding: cached };
    }
    return p;
  });
}

// --- Persistence ---

/**
 * Save embeddings to a JSON file.
 */
export async function saveEmbeddingsToFile(
  products: Product[],
  filePath: string
): Promise<void> {
  const data = products.map((p) => ({
    product_id: p.product_id,
    embedding: p.embedding,
  }));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Load embeddings from a JSON file and merge with products.
 */
export async function loadEmbeddingsFromFile(
  filePath: string
): Promise<Map<string, Embedding>> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content) as { product_id: string; embedding: Embedding }[];
    const map = new Map<string, Embedding>();
    for (const item of data) {
      if (item.product_id && Array.isArray(item.embedding)) {
        map.set(item.product_id, item.embedding);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Merge stored embeddings into products.
 */
export function mergeEmbeddings(
  products: Product[],
  embeddingMap: Map<string, Embedding>
): Product[] {
  return products.map((p) => {
    if (Array.isArray(p.embedding) && p.embedding.length > 0) return p;
    const stored = embeddingMap.get(p.product_id);
    if (stored) {
      return { ...p, embedding: stored };
    }
    return p;
  });
}

// --- Startup function ---

/**
 * Initialize embedding index for a site.
 * Loads from file if available, otherwise builds fresh.
 */
export async function initializeEmbeddingIndex(
  siteKey: string,
  products: Product[],
  options?: { cacheDir?: string; forceRebuild?: boolean }
): Promise<Product[]> {
  const cacheDir = options?.cacheDir ?? path.join(process.cwd(), "data", "embeddings");
  const forceRebuild = options?.forceRebuild ?? false;

  const cacheFilePath = path.join(cacheDir, `${siteKey}-embeddings.json`);

  // Try to load from file
  if (!forceRebuild) {
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      const embeddingMap = await loadEmbeddingsFromFile(cacheFilePath);

      if (embeddingMap.size > 0) {
        console.log(`[embeddingIndex] Loaded ${embeddingMap.size} embeddings from cache for ${siteKey}`);
        const merged = mergeEmbeddings(products, embeddingMap);

        // Check how many products still need embeddings
        const missing = merged.filter((p) => !Array.isArray(p.embedding) || p.embedding.length === 0);
        if (missing.length === 0) {
          cacheEmbeddings(siteKey, merged);
          return merged;
        }

        console.log(`[embeddingIndex] ${missing.length} products still need embeddings, building...`);
        const newEmbedded = await buildProductEmbeddings(missing);

        // Merge new with existing
        const newMap = new Map<string, Embedding>();
        for (const p of newEmbedded) {
          if (Array.isArray(p.embedding)) {
            newMap.set(p.product_id, p.embedding as Embedding);
          }
        }

        const finalMerged = mergeEmbeddings(merged, newMap);

        // Save updated cache
        await saveEmbeddingsToFile(finalMerged, cacheFilePath);
        cacheEmbeddings(siteKey, finalMerged);

        return finalMerged;
      }
    } catch (e) {
      console.warn(`[embeddingIndex] Could not load cache for ${siteKey}:`, e);
    }
  }

  // Build fresh
  console.log(`[embeddingIndex] Building ${products.length} embeddings for ${siteKey}...`);
  const embedded = await buildProductEmbeddings(products, {
    onProgress: (done, total) => {
      if (done % 100 === 0 || done === total) {
        console.log(`[embeddingIndex] Progress: ${done}/${total}`);
      }
    },
  });

  // Save to file
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await saveEmbeddingsToFile(embedded, cacheFilePath);
    console.log(`[embeddingIndex] Saved embeddings to ${cacheFilePath}`);
  } catch (e) {
    console.warn(`[embeddingIndex] Could not save cache:`, e);
  }

  cacheEmbeddings(siteKey, embedded);
  return embedded;
}
