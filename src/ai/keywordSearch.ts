// src/ai/keywordSearch.ts
// ✅ Lexical fallback search for hybrid retrieval

import { Product } from "../models/Product";

// --- Hungarian character normalization (ékezet nélküli) ---

const ACCENT_MAP: Record<string, string> = {
  á: "a", à: "a", â: "a", ä: "a", ã: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", ö: "o", õ: "o", ő: "o",
  ú: "u", ù: "u", û: "u", ü: "u", ű: "u",
  ý: "y", ÿ: "y",
  ñ: "n",
  ç: "c",
};

function removeAccents(s: string): string {
  let out = "";
  for (const c of s.toLowerCase()) {
    out += ACCENT_MAP[c] || c;
  }
  return out;
}

// --- Tokenization ---

const STOPWORDS = new Set([
  "a", "az", "és", "meg", "de", "hogy", "nem", "is", "van", "volt", "vagy",
  "mert", "mint", "egy", "ez", "azt", "ami", "aki", "ha", "csak", "még",
  "már", "most", "itt", "ott", "ki", "be", "le", "fel", "el", "hol",
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
  "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare", "ought",
  "this", "that", "these", "those", "it", "its",
]);

/**
 * Tokenize and normalize text for keyword matching.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const normalized = removeAccents(text);
  const tokens = normalized
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

/**
 * Get searchable text from a product (name, category, description).
 * Description is truncated for efficiency.
 */
function getProductSearchText(product: Product): string {
  const parts: string[] = [];
  if (product.name) parts.push(product.name);
  if (product.category) parts.push(product.category);
  const p = product as any;
  if (p.product_type) parts.push(p.product_type);
  if (p.tags) parts.push(String(p.tags).slice(0, 200));
  if (p.description) parts.push(String(p.description).slice(0, 300));
  return parts.join(" ");
}

// --- Scoring ---

/**
 * Calculate keyword overlap score between query tokens and product.
 * Returns score between 0 and 1.
 */
export function calculateKeywordScore(queryTokens: string[], product: Product): number {
  if (queryTokens.length === 0) return 0;

  const productText = getProductSearchText(product);
  const productTokens = new Set(tokenize(productText));

  let matches = 0;
  for (const qt of queryTokens) {
    // Exact match
    if (productTokens.has(qt)) {
      matches++;
      continue;
    }
    // Prefix match (for partial words)
    for (const pt of productTokens) {
      if (pt.startsWith(qt) || qt.startsWith(pt)) {
        matches += 0.5;
        break;
      }
    }
  }

  // Normalize by query length, with bonus for having any match
  const rawScore = matches / queryTokens.length;
  return Math.min(1, rawScore);
}

// --- Main API ---

export interface KeywordSearchResult {
  product: Product;
  score: number;
}

/**
 * Search products by keyword overlap.
 * @param queryText - User query text (free_text + interests)
 * @param products - Products to search
 * @param topK - Maximum results to return
 * @returns Sorted results by score descending
 */
export function keywordSearch(
  queryText: string,
  products: Product[],
  topK = 200
): KeywordSearchResult[] {
  const queryTokens = tokenize(queryText);
  if (queryTokens.length === 0) return [];

  const scored = products
    .map((product) => ({
      product,
      score: calculateKeywordScore(queryTokens, product),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.min(topK, scored.length));
}

/**
 * Merge embedding and keyword results, deduplicating by product_id.
 * Combines scores with weights.
 */
export function mergeSearchResults(
  embeddingResults: { product: Product; score: number }[],
  keywordResults: KeywordSearchResult[],
  options?: { embeddingWeight?: number; keywordWeight?: number; topK?: number }
): { product: Product; score: number; source: "embedding" | "keyword" | "both" }[] {
  const embeddingWeight = options?.embeddingWeight ?? 0.7;
  const keywordWeight = options?.keywordWeight ?? 0.3;
  const topK = options?.topK ?? 200;

  const merged = new Map<
    string,
    { product: Product; embScore: number; kwScore: number }
  >();

  // Add embedding results
  for (const r of embeddingResults) {
    const id = r.product.product_id;
    if (!merged.has(id)) {
      merged.set(id, { product: r.product, embScore: r.score, kwScore: 0 });
    } else {
      merged.get(id)!.embScore = Math.max(merged.get(id)!.embScore, r.score);
    }
  }

  // Add keyword results
  for (const r of keywordResults) {
    const id = r.product.product_id;
    if (!merged.has(id)) {
      merged.set(id, { product: r.product, embScore: 0, kwScore: r.score });
    } else {
      merged.get(id)!.kwScore = Math.max(merged.get(id)!.kwScore, r.score);
    }
  }

  // Calculate combined scores
  const results = [...merged.values()].map((m) => {
    const combinedScore = m.embScore * embeddingWeight + m.kwScore * keywordWeight;
    const source: "embedding" | "keyword" | "both" =
      m.embScore > 0 && m.kwScore > 0
        ? "both"
        : m.embScore > 0
        ? "embedding"
        : "keyword";
    return { product: m.product, score: combinedScore, source };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, Math.min(topK, results.length));
}
