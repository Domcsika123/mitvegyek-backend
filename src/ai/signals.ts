// src/ai/signals.ts
//
// Domain-agnostic signal extraction from products and user context.
// Extracts structured signals (tokens, brand, category, price, tags)
// that the universal constraint engine can match against.

import { Product } from "../models/Product";
import { UserContext } from "../models/UserContext";

/* ===================================================================
 * 1) PRODUCT SIGNALS — structured data extracted from any product
 * =================================================================== */

export interface ProductSignals {
  /** Lowercased name tokens (split on whitespace/punctuation) */
  nameTokens: string[];
  /** Full product text for "contains" matching */
  fullText: string;
  /** Category (lowercased, trimmed) */
  category: string;
  /** Tags array (lowercased) */
  tags: string[];
  /** Brand / vendor (lowercased) */
  brand: string;
  /** product_type (lowercased) */
  productType: string;
  /** price as number */
  price: number;
  /** All searchable text combined (for broad "contains" matching) */
  searchableText: string;
}

/**
 * Extract structured signals from any product — domain-agnostic.
 * Works for fashion, electronics, cosmetics, books, pet food, etc.
 */
export function extractProductSignals(product: Product): ProductSignals {
  const name = (product.name || "").trim();
  const category = (product.category || "").trim().toLowerCase();
  const description = (product.description || "").trim();
  const vendor = ((product as any).vendor || "").trim().toLowerCase();
  const productType = ((product as any).product_type || "").trim().toLowerCase();

  // Tags: handle both string and array formats
  let tags: string[] = [];
  const rawTags = (product as any).tags;
  if (typeof rawTags === "string" && rawTags.trim()) {
    tags = rawTags.split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean);
  } else if (Array.isArray(rawTags)) {
    tags = rawTags.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean);
  }

  // Name tokens: split on common delimiters, lowercase
  const nameTokens = tokenize(name);

  // Price
  const price = typeof product.price === "number" ? product.price : Number(product.price) || 0;

  // Combined searchable text
  const searchableText = [name, category, description, vendor, productType, tags.join(" ")]
    .join(" ")
    .toLowerCase();

  return {
    nameTokens,
    fullText: searchableText,
    category,
    tags,
    brand: vendor,
    productType,
    price,
    searchableText,
  };
}

/* ===================================================================
 * 2) USER SIGNALS — structured data from UserContext + free_text
 * =================================================================== */

export interface UserSignals {
  /** All tokens from free_text and interests combined */
  queryTokens: string[];
  /** Full query text (lowercased) for "contains" matching */
  queryText: string;
  /** Gender (if provided) */
  gender: string | null;
  /** Budget range */
  budgetMin: number | null;
  budgetMax: number | null;
  /** Age */
  age: number | null;
  /** Relationship target */
  relationship: string | null;
}

/**
 * Extract structured signals from user context — domain-agnostic.
 */
export function extractUserSignals(user: UserContext): UserSignals {
  const parts: string[] = [];

  if (user.free_text) parts.push(user.free_text);
  if (user.interests && user.interests.length > 0) {
    parts.push(user.interests.join(" "));
  }
  if (user.relationship) parts.push(user.relationship);

  const queryText = parts.join(" ").toLowerCase();
  const queryTokens = tokenize(parts.join(" "));

  return {
    queryTokens,
    queryText,
    gender: user.gender && user.gender !== "unknown" ? user.gender : null,
    budgetMin: typeof user.budget_min === "number" ? user.budget_min : null,
    budgetMax: typeof user.budget_max === "number" ? user.budget_max : null,
    age: typeof user.age === "number" ? user.age : null,
    relationship: user.relationship || null,
  };
}

/* ===================================================================
 * 3) HELPERS
 * =================================================================== */

/**
 * Tokenize text: split on whitespace and common punctuation, lowercase, dedupe.
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .replace(/[_\-\/|,;:!?.()[\]{}'"]+/g, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1); // skip single chars

  return [...new Set(tokens)];
}

/**
 * Check if any of the query tokens appear in the target text.
 * Returns the fraction of query tokens that matched (0..1).
 */
export function tokenOverlap(queryTokens: string[], targetText: string): number {
  if (queryTokens.length === 0) return 0;
  const lower = targetText.toLowerCase();
  let matches = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) matches++;
  }
  return matches / queryTokens.length;
}

/**
 * Fuzzy "contains" check: does the target contain the value?
 * Handles accented Hungarian characters by trying both original and stripped forms.
 */
export function fuzzyContains(target: string, value: string): boolean {
  if (!target || !value) return false;
  const tLower = target.toLowerCase();
  const vLower = value.toLowerCase();

  // Direct match
  if (tLower.includes(vLower)) return true;

  // Try stripped accents
  const tStripped = stripAccents(tLower);
  const vStripped = stripAccents(vLower);
  if (tStripped.includes(vStripped)) return true;

  return false;
}

/** Strip Hungarian accents for fuzzy matching */
function stripAccents(s: string): string {
  return s
    .replace(/[áà]/g, "a")
    .replace(/[éè]/g, "e")
    .replace(/[íì]/g, "i")
    .replace(/[óòöő]/g, "o")
    .replace(/[úùüű]/g, "u")
    .replace(/[ýỳ]/g, "y");
}
