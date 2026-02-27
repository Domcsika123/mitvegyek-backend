// src/search/hybridSearch.ts
// High-recall hybrid search: embedding + lexical + signal boosting

import { Product } from "../models/Product";
import { searchByEmbedding, getUserQueryEmbedding } from "../ai/embeddingIndex";
import { keywordSearch } from "../ai/keywordSearch";
import { parseQuery, QuerySignals, signalsSummary } from "./signals";
import { detectColors } from "./colors";
import { detectMaterials } from "./materials";

/**
 * Scored product with breakdown.
 */
export interface ScoredProduct {
  product: Product;
  embeddingScore: number;
  lexicalScore: number;
  signalBoost: number;
  finalScore: number;
  matchReasons: string[];
}

/**
 * Configuration for hybrid search.
 */
export interface HybridSearchConfig {
  topK?: number; // max candidates (default: 400)
  minResults?: number; // minimum results to return (default: 12)
  maxResults?: number; // maximum results to return (default: 20)
  embeddingWeight?: number; // weight for embedding score (default: 1.0)
  lexicalWeight?: number; // weight for lexical score (default: 0.2)
  typeBoost?: number; // boost for type match (default: 0.25)
  colorBoost?: number; // boost for color match (default: 0.15)
  materialBoost?: number; // boost for material match (default: 0.10)
  tokenBoostPerToken?: number; // boost per matching token (default: 0.05)
  maxTokenBoost?: number; // max total token boost (default: 0.15)
  minScoreThreshold?: number; // minimum final score (default: 0.15)
}

const DEFAULT_CONFIG: Required<HybridSearchConfig> = {
  topK: 400,
  minResults: 20,
  maxResults: 100, // Return ALL matching products
  embeddingWeight: 1,
  lexicalWeight: 0.2,
  typeBoost: 0.25,
  colorBoost: 0.15,
  materialBoost: 0.1,
  tokenBoostPerToken: 0.05,
  maxTokenBoost: 0.15,
  minScoreThreshold: 0.1, // Lower threshold to include more matches
};

// Canonical type map for matching
const TYPE_CANONICAL_MAP: Record<string, string> = {
  "póló": "póló",
  "t-shirt": "póló",
  tshirt: "póló",
  tee: "póló",
  "pulóver": "pulóver",
  pulcsi: "pulóver",
  sweater: "pulóver",
  "kapucnis pulóver": "kapucnis pulóver",
  hoodie: "kapucnis pulóver",
  kapucnis: "kapucnis pulóver",
  "melegítő felső": "melegítő felső",
  sweatshirt: "melegítő felső",
  ing: "ing",
  shirt: "ing",
  "nadrág": "nadrág",
  pants: "nadrág",
  trousers: "nadrág",
  "farmer nadrág": "farmer nadrág",
  jeans: "farmer nadrág",
  farmer: "farmer nadrág",
  dzseki: "dzseki",
  jacket: "dzseki",
  kabát: "kabát",
  coat: "kabát",
  "cipő": "cipő",
  shoes: "cipő",
  sneaker: "sneaker",
  sneakers: "sneaker",
  "tornacipő": "sneaker",
  "táska": "táska",
  bag: "táska",
  "hátizsák": "hátizsák",
  backpack: "hátizsák",
  sapka: "sapka",
  hat: "sapka",
  cap: "sapka",
  "óra": "óra",
  watch: "óra",
  "öv": "öv",
  belt: "öv",
  ruha: "ruha",
  dress: "ruha",
  szoknya: "szoknya",
  skirt: "szoknya",
};

// Normalize text for matching
function normalizeText(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Get canonical type from product
function getProductType(product: Product): string | null {
  const typeField = (product as any).type || (product as any).itemType;
  if (typeField) {
    const normalized = normalizeText(typeField);
    return TYPE_CANONICAL_MAP[normalized] || typeField.toLowerCase();
  }

  // Try to extract from name
  const name = normalizeText(product.name || "");
  for (const [key, canonical] of Object.entries(TYPE_CANONICAL_MAP)) {
    if (name.includes(normalizeText(key))) {
      return canonical;
    }
  }

  return null;
}

// Check if product matches query type
function matchesType(product: Product, queryType: string | null): boolean {
  if (!queryType) return false;

  const productType = getProductType(product);
  if (!productType) return false;

  const normalizedQuery = normalizeText(queryType);
  const normalizedProduct = normalizeText(productType);

  // Exact match
  if (normalizedProduct === normalizedQuery) return true;

  // Contains match
  if (normalizedProduct.includes(normalizedQuery)) return true;
  if (normalizedQuery.includes(normalizedProduct)) return true;

  // Check canonical forms
  const canonicalQuery = TYPE_CANONICAL_MAP[normalizedQuery] || normalizedQuery;
  const canonicalProduct = TYPE_CANONICAL_MAP[normalizedProduct] || normalizedProduct;

  return canonicalQuery === canonicalProduct;
}

// Get searchable text from product
function getProductText(product: Product): string {
  const parts = [
    product.name || "",
    product.description || "",
    (product as any).color || "",
    (product as any).brand || "",
    Array.isArray((product as any).tags) ? (product as any).tags.join(" ") : "",
  ];
  return parts.join(" ");
}

// Count token matches in product
function countTokenMatches(product: Product, tokens: string[]): number {
  if (!tokens.length) return 0;

  const productText = normalizeText(getProductText(product));
  let matches = 0;

  for (const token of tokens) {
    const normalizedToken = normalizeText(token);
    if (productText.includes(normalizedToken)) {
      matches++;
    }
  }

  return matches;
}

/**
 * Calculate signal boost for a product based on query signals.
 */
function calculateSignalBoost(
  product: Product,
  signals: QuerySignals,
  config: Required<HybridSearchConfig>
): { boost: number; reasons: string[] } {
  let boost = 0;
  const reasons: string[] = [];
  const productText = getProductText(product);

  // Type match
  if (signals.type && matchesType(product, signals.type)) {
    boost += config.typeBoost;
    reasons.push(`type:${signals.type}`);
  }

  // Color match
  if (signals.colors.size > 0) {
    const productColors = detectColors(
      productText,
      (product as any).color,
      Array.isArray((product as any).tags) ? (product as any).tags.join(" ") : ""
    );

    for (const queryColor of signals.colors) {
      if (productColors.has(queryColor)) {
        boost += config.colorBoost;
        reasons.push(`color:${queryColor}`);
        break; // only count once
      }
    }
  }

  // Material match
  if (signals.materials.size > 0) {
    const productMaterials = detectMaterials(
      productText,
      (product as any).composition,
      Array.isArray((product as any).tags) ? (product as any).tags.join(" ") : ""
    );

    for (const queryMaterial of signals.materials) {
      if (productMaterials.has(queryMaterial)) {
        boost += config.materialBoost;
        reasons.push(`material:${queryMaterial}`);
        break; // only count once
      }
    }
  }

  // Token matches
  const tokenMatches = countTokenMatches(product, signals.tokens);
  if (tokenMatches > 0) {
    const tokenBoost = Math.min(
      tokenMatches * config.tokenBoostPerToken,
      config.maxTokenBoost
    );
    boost += tokenBoost;
    if (tokenMatches >= signals.tokens.length * 0.5) {
      reasons.push(`tokens:${tokenMatches}/${signals.tokens.length}`);
    }
  }

  return { boost, reasons };
}

/**
 * Perform high-recall hybrid search.
 * Combines embedding search, lexical search, and signal-based boosting.
 */
export async function hybridSearch(
  query: string,
  products: Product[],
  config: Partial<HybridSearchConfig> = {}
): Promise<ScoredProduct[]> {
  const cfg: Required<HybridSearchConfig> = { ...DEFAULT_CONFIG, ...config };

  // Adaptive topK based on catalog size
  const adaptiveTopK = Math.min(cfg.topK, products.length);

  // Parse query signals
  const signals = parseQuery(query);
  console.log(`[hybridSearch] Query: "${query}" → ${signalsSummary(signals)}`);

  // Step 1: Embedding search
  let embeddingResults: { product: Product; score: number }[] = [];
  try {
    const queryEmbedding = await getUserQueryEmbedding(query);
    if (queryEmbedding) {
      embeddingResults = searchByEmbedding(
        queryEmbedding,
        products,
        adaptiveTopK
      );
    }
  } catch (err) {
    console.error("[hybridSearch] Embedding search failed:", err);
  }

  // Step 2: Lexical search
  const lexicalResults = keywordSearch(query, products, adaptiveTopK);

  // Step 3: Merge results
  // Create a map for scoring
  const productScores = new Map<
    string,
    {
      product: Product;
      embeddingScore: number;
      lexicalScore: number;
      signalBoost: number;
      matchReasons: string[];
    }
  >();

  // Add embedding results
  for (const { product, score } of embeddingResults) {
    const pAny = product as any;
    const id = pAny.id || pAny.product_id || product.name;
    productScores.set(id, {
      product,
      embeddingScore: score,
      lexicalScore: 0,
      signalBoost: 0,
      matchReasons: [],
    });
  }

  // Add/merge lexical results
  for (const { product, score } of lexicalResults) {
    const pAny = product as any;
    const id = pAny.id || pAny.product_id || product.name;
    const existing = productScores.get(id);
    if (existing) {
      existing.lexicalScore = score;
    } else {
      productScores.set(id, {
        product,
        embeddingScore: 0,
        lexicalScore: score,
        signalBoost: 0,
        matchReasons: [],
      });
    }
  }

  // If neither search returned results, add all products with base score
  if (productScores.size === 0) {
    console.log("[hybridSearch] No results from search, using full catalog");
    for (const product of products.slice(0, adaptiveTopK)) {
      const pAny = product as any;
      const id = pAny.id || pAny.product_id || product.name;
      productScores.set(id, {
        product,
        embeddingScore: 0.1,
        lexicalScore: 0,
        signalBoost: 0,
        matchReasons: ["fallback"],
      });
    }
  }

  // Step 4: Calculate signal boosts and final scores
  const scoredProducts: ScoredProduct[] = [];

  for (const entry of productScores.values()) {
    const { boost, reasons } = calculateSignalBoost(entry.product, signals, cfg);
    entry.signalBoost = boost;
    entry.matchReasons = [...entry.matchReasons, ...reasons];

    const finalScore =
      entry.embeddingScore * cfg.embeddingWeight +
      entry.lexicalScore * cfg.lexicalWeight +
      entry.signalBoost;

    scoredProducts.push({
      ...entry,
      finalScore,
    });
  }

  // Step 5: Sort by final score
  scoredProducts.sort((a, b) => b.finalScore - a.finalScore);

  // Step 6: Apply minimum score threshold (but keep minResults)
  let filtered = scoredProducts.filter(
    (p) => p.finalScore >= cfg.minScoreThreshold
  );

  // Ensure we have at least minResults
  if (filtered.length < cfg.minResults && scoredProducts.length >= cfg.minResults) {
    filtered = scoredProducts.slice(0, cfg.minResults);
  }

  // Cap at maxResults
  filtered = filtered.slice(0, cfg.maxResults);

  console.log(
    `[hybridSearch] Found ${productScores.size} candidates, returning ${filtered.length} (` +
    `embedding:${embeddingResults.length}, lexical:${lexicalResults.length})`
  );

  return filtered;
}

/**
 * Quick hybrid search with defaults for recommendation endpoint.
 */
export async function quickHybridSearch(
  query: string,
  products: Product[],
  maxResults: number = 20
): Promise<Product[]> {
  const results = await hybridSearch(query, products, { maxResults });
  return results.map((r) => r.product);
}

/**
 * Get match reasons for a product (for display).
 */
export function getMatchReasons(
  product: Product,
  query: string
): string[] {
  const signals = parseQuery(query);
  const { reasons } = calculateSignalBoost(product, signals, DEFAULT_CONFIG);
  return reasons;
}
