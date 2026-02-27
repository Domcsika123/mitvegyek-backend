// src/tests/keywordSearch.test.ts
// Unit tests for keyword search and merge functions

import assert from "node:assert/strict";
import { tokenize, calculateKeywordScore, keywordSearch, mergeSearchResults } from "../ai/keywordSearch";
import { Product } from "../models/Product";

// Helper to run tests
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e: any) {
    console.error(`❌ ${name}`);
    console.error(e.message);
    process.exitCode = 1;
  }
}

console.log("\n=== tokenize tests ===\n");

test("tokenizes simple text", () => {
  const tokens = tokenize("fekete pulóver");
  assert.ok(tokens.includes("fekete"));
  assert.ok(tokens.includes("pulover"));
});

test("removes accents", () => {
  const tokens = tokenize("Kék nadrág örök");
  assert.ok(tokens.includes("kek"));
  assert.ok(tokens.includes("nadrag"));
  assert.ok(tokens.includes("orok"));
});

test("removes stopwords", () => {
  const tokens = tokenize("egy fekete és kék pulóver");
  assert.ok(!tokens.includes("egy"));
  assert.ok(!tokens.includes("es"));
  assert.ok(tokens.includes("fekete"));
  assert.ok(tokens.includes("kek"));
  assert.ok(tokens.includes("pulover"));
});

test("removes short tokens", () => {
  const tokens = tokenize("a b ab abc");
  assert.ok(!tokens.includes("a"));
  assert.ok(!tokens.includes("b"));
  assert.ok(tokens.includes("ab"));
  assert.ok(tokens.includes("abc"));
});

test("handles empty input", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null as any), []);
});

test("deduplicates tokens", () => {
  const tokens = tokenize("fekete fekete fekete");
  assert.equal(tokens.filter(t => t === "fekete").length, 1);
});

console.log("\n=== calculateKeywordScore tests ===\n");

const mockProduct: Product = {
  product_id: "test-1",
  name: "Fekete pulóver oversized",
  price: 10000,
  category: "clothing",
};

test("returns score for matching tokens", () => {
  const queryTokens = tokenize("fekete pulóver");
  const score = calculateKeywordScore(queryTokens, mockProduct);
  assert.ok(score > 0);
  assert.ok(score <= 1);
});

test("returns 0 for no matching tokens", () => {
  const queryTokens = tokenize("cipő táska");
  const score = calculateKeywordScore(queryTokens, mockProduct);
  assert.equal(score, 0);
});

test("returns 0 for empty query", () => {
  const score = calculateKeywordScore([], mockProduct);
  assert.equal(score, 0);
});

test("partial matches give partial score", () => {
  const queryTokens = tokenize("fekete cipő"); // only "fekete" matches
  const score = calculateKeywordScore(queryTokens, mockProduct);
  assert.ok(score > 0);
  assert.ok(score < 1);
});

test("full matches give score of 1", () => {
  const queryTokens = tokenize("fekete pulover oversized");
  const score = calculateKeywordScore(queryTokens, mockProduct);
  assert.equal(score, 1);
});

console.log("\n=== keywordSearch tests ===\n");

const mockProducts: Product[] = [
  { product_id: "1", name: "Fekete pulóver", price: 10000, category: "clothing" },
  { product_id: "2", name: "Kék nadrág", price: 12000, category: "clothing" },
  { product_id: "3", name: "Fehér cipő", price: 15000, category: "shoes" },
  { product_id: "4", name: "Fekete táska", price: 8000, category: "bags" },
];

test("returns matching products sorted by score", () => {
  const results = keywordSearch("fekete", mockProducts);
  assert.ok(results.length > 0);
  assert.ok(results[0].product.name.includes("Fekete"));
});

test("returns empty for no matches", () => {
  const results = keywordSearch("xyz nemletezik", mockProducts);
  assert.equal(results.length, 0);
});

test("respects topK limit", () => {
  const results = keywordSearch("fekete", mockProducts, 1);
  assert.equal(results.length, 1);
});

test("returns multiple matches", () => {
  const results = keywordSearch("fekete", mockProducts);
  assert.equal(results.length, 2); // "Fekete pulóver" and "Fekete táska"
});

console.log("\n=== mergeSearchResults tests ===\n");

const mergeProducts: Product[] = [
  { product_id: "1", name: "A", price: 100, category: "cat1" },
  { product_id: "2", name: "B", price: 200, category: "cat2" },
  { product_id: "3", name: "C", price: 300, category: "cat3" },
];

test("merges embedding and keyword results", () => {
  const embeddingResults = [
    { product: mergeProducts[0], score: 0.9 },
    { product: mergeProducts[1], score: 0.7 },
  ];
  const keywordResults = [
    { product: mergeProducts[1], score: 0.8 },
    { product: mergeProducts[2], score: 0.6 },
  ];

  const merged = mergeSearchResults(embeddingResults, keywordResults);
  
  assert.equal(merged.length, 3);
  // Product 2 appears in both, should have combined score
  const product2 = merged.find(r => r.product.product_id === "2");
  assert.equal(product2?.source, "both");
});

test("deduplicates by product_id", () => {
  const embeddingResults = [
    { product: mergeProducts[0], score: 0.9 },
  ];
  const keywordResults = [
    { product: mergeProducts[0], score: 0.8 },
  ];

  const merged = mergeSearchResults(embeddingResults, keywordResults);
  assert.equal(merged.length, 1);
});

test("respects topK limit", () => {
  const embeddingResults = mergeProducts.map(p => ({ product: p, score: 0.5 }));
  const keywordResults = mergeProducts.map(p => ({ product: p, score: 0.5 }));

  const merged = mergeSearchResults(embeddingResults, keywordResults, { topK: 2 });
  assert.equal(merged.length, 2);
});

test("applies weights correctly", () => {
  const embeddingResults = [{ product: mergeProducts[0], score: 1.0 }];
  const keywordResults = [{ product: mergeProducts[1], score: 1.0 }];

  const merged = mergeSearchResults(embeddingResults, keywordResults, {
    embeddingWeight: 0.7,
    keywordWeight: 0.3,
  });

  // Product 1 (embedding only): 1.0 * 0.7 = 0.7
  // Product 2 (keyword only): 1.0 * 0.3 = 0.3
  assert.equal(merged[0].product.product_id, "1");
  assert.ok(Math.abs(merged[0].score - 0.7) < 0.001);
  assert.equal(merged[1].product.product_id, "2");
  assert.ok(Math.abs(merged[1].score - 0.3) < 0.001);
});

test("marks source correctly", () => {
  const embeddingResults = [{ product: mergeProducts[0], score: 0.9 }];
  const keywordResults = [{ product: mergeProducts[1], score: 0.8 }];

  const merged = mergeSearchResults(embeddingResults, keywordResults);

  const emb = merged.find(r => r.product.product_id === "1");
  const kw = merged.find(r => r.product.product_id === "2");
  
  assert.equal(emb?.source, "embedding");
  assert.equal(kw?.source, "keyword");
});

console.log("\n=== All keyword search tests completed ===\n");
