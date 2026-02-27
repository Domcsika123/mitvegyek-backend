// src/tests/ranker.test.ts
// Comprehensive unit tests for the deterministic hard-rule ranker

import assert from "node:assert/strict";
import { Product } from "../models/Product";
import {
  buildNoExactMessage,
  buildQueryFromUserInput,
  formatProductBlurb,
  rankProducts,
} from "../reco/ranker";

function p(overrides: Partial<Product> & Record<string, any>): Product {
  return {
    product_id: overrides.product_id || overrides.id || Math.random().toString(36).slice(2),
    name: overrides.name || "Termék",
    price: typeof overrides.price === "number" ? overrides.price : 0,
    category: overrides.category || "",
    description: overrides.description || "",
    image_url: overrides.image_url || "",
    product_url: overrides.product_url || "",
    tags: overrides.tags,
    product_type: overrides.product_type,
    vendor: overrides.vendor,
    embedding: overrides.embedding,
    ...overrides,
  } as Product;
}

function ids(items: Product[]): string[] {
  return items.map((it) => String((it as any).id || it.product_id));
}

function run() {
  console.log("Running ranker tests...\n");

  // ============================================================================
  // TEST 1: FULL MATCH - Only full matches returned, sorted by price + stable tie
  // ============================================================================
  {
    console.log("TEST 1: Full match - only full matches returned, sorted by price");
    const products = [
      p({ product_id: "f1", name: "A", tipus: "polo", szin: "kek", price: 5000 }),
      p({ product_id: "x1", name: "X", tipus: "polo", szin: "piros", price: 4000 }),
      p({ product_id: "f2", name: "B", tipus: "polo", szin: "kek", price: 3000 }),
      p({ product_id: "f3", name: "C", tipus: "polo", szin: "kek", price: 3000 }),
    ];

    const result = rankProducts({ tipus: "polo", szin: "kek" }, products);
    assert.equal(result.meta.hasExactMatch, true, "full match must be detected");
    assert.deepEqual(ids(result.items), ["f2", "f3", "f1"], "full matches must be all returned and sorted by price + stable tie");

    const message = result.meta.hasExactMatch
      ? null
      : buildNoExactMessage({ tipus: "polo", szin: "kek" }, { locale: "hu" });
    assert.equal(message, null, "message must be null for exact matches");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 2: NO FULL MATCH - A > B > C > D grouping
  // ============================================================================
  {
    console.log("TEST 2: No full match - A (type) > B (color) > C (other) > D (none)");
    const products = [
      p({ product_id: "a1", tipus: "polo", marka: "adidas" }),
      p({ product_id: "b1", szin: "kek", marka: "adidas" }),
      p({ product_id: "c1", marka: "nike", anyag: "pamut" }),
      p({ product_id: "d1", marka: "reebok" }),
    ];

    const result = rankProducts({ tipus: "polo", szin: "kek", marka: "nike" }, products);
    assert.equal(result.meta.hasExactMatch, false, "no full match should be found");
    assert.deepEqual(ids(result.items), ["a1", "b1", "c1", "d1"], "ordering must be A > B > C > D");

    const message = buildNoExactMessage({ tipus: "polo", szin: "kek", marka: "nike" }, { locale: "hu" });
    assert.ok(message.includes("Pontos egyezést nem találtam"), "message must appear when no full match");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 3: C GROUP - More matches rank higher, stable on tie
  // ============================================================================
  {
    console.log("TEST 3: C group - more matches rank higher, stable tiebreak");
    const products = [
      p({ product_id: "c1", marka: "nike", anyag: "pamut", meret: "m" }),
      p({ product_id: "c2", marka: "nike" }),
      p({ product_id: "c3", marka: "nike" }),
      p({ product_id: "d1", marka: "adidas" }),
    ];
    const result = rankProducts({ marka: "nike", anyag: "pamut", meret: "m" }, products);
    assert.equal(result.meta.hasExactMatch, true, "c1 must be full match on all queried fields");
    assert.deepEqual(ids(result.items), ["c1"], "when full exists only full products can remain");

    const noFull = rankProducts({ marka: "nike", anyag: "gyapju", meret: "m" }, products);
    assert.equal(noFull.meta.hasExactMatch, false);
    assert.deepEqual(ids(noFull.items), ["c1", "c2", "c3", "d1"], "C group must prioritize more matches and keep stable tie");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 4: NORMALIZATION - accent, case, whitespace, synonym, alias
  // ============================================================================
  {
    console.log("TEST 4: Normalization - accent, case, whitespace, synonyms, aliases");
    const products = [
      p({ product_id: "n1", tipus: "polo", szin: "sötétkék / fehér" }),
      p({ product_id: "n2", tipus: "kapucnis pulóver", szin: "fekete" }),
    ];

    const result1 = rankProducts({ type: "  PÓLÓ  ", color: "  NAVY  " }, products);
    assert.equal(result1.meta.hasExactMatch, true, "accent/case/whitespace/synonym/alias normalization must work");
    assert.deepEqual(ids(result1.items), ["n1"]);

    const result2 = rankProducts({ tipus: "hoodie" }, products);
    assert.equal(result2.meta.hasExactMatch, true, "hoodie and kapucnis pulóver must match as synonyms");
    assert.deepEqual(ids(result2.items), ["n2"]);
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 5: MULTI-VALUE FIELDS - any overlap counts as match
  // ============================================================================
  {
    console.log("TEST 5: Multi-value fields - any overlap counts as match");
    const products = [
      p({ product_id: "mv1", szin: "kek/piros/zold", tipus: "polo" }),
      p({ product_id: "mv2", szin: "sarga", tipus: "polo" }),
    ];

    const result = rankProducts({ tipus: "polo", szin: "piros" }, products);
    assert.equal(result.meta.hasExactMatch, true, "multi-value field should match when any value overlaps");
    assert.deepEqual(ids(result.items), ["mv1"]);
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 6: MISSING FIELD - no match
  // ============================================================================
  {
    console.log("TEST 6: Missing field - must not match");
    const products = [
      p({ product_id: "m1", tipus: "polo" }),
      p({ product_id: "m2", tipus: "polo", anyag: "pamut" }),
    ];

    const result = rankProducts({ tipus: "polo", anyag: "pamut" }, products);
    assert.equal(result.meta.hasExactMatch, true);
    assert.deepEqual(ids(result.items), ["m2"], "missing field must not match");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 7: DEDUP - same ID only once
  // ============================================================================
  {
    console.log("TEST 7: Deduplication - same ID only once");
    const products = [
      p({ product_id: "dup1", tipus: "polo", szin: "kek", price: 1000 }),
      p({ product_id: "dup1", tipus: "polo", szin: "kek", price: 900 }),
      p({ product_id: "dup2", tipus: "polo", szin: "kek", price: 1100 }),
    ];
    const result = rankProducts({ tipus: "polo", szin: "kek" }, products);
    assert.deepEqual(ids(result.items), ["dup1", "dup2"], "dedup must keep only one product per id");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 8: ALIASES - tipus/type and szin/color work the same
  // ============================================================================
  {
    console.log("TEST 8: Aliases - tipus/type and szin/color work the same");
    const products = [
      p({ product_id: "a", type: "polo", color: "kek" }),
    ];
    const result = rankProducts({ tipus: "polo", szin: "kek" }, products);
    assert.equal(result.meta.hasExactMatch, true, "aliases tipus/type and szin/color must behave the same");
    assert.deepEqual(ids(result.items), ["a"]);
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 9: PRODUCT BLURB - max length, only existing fields, customer-friendly
  // ============================================================================
  {
    console.log("TEST 9: formatProductBlurb - max 160 chars, only real fields, no fabrication");
    const product = p({
      product_id: "b1",
      name: "Super Polo",
      vendor: "Acme",
      product_type: "Póló",
      material: "100% pamut",
      stilus: "casual",
      size: "M",
      color: "Kék",
      price: 12990,
      description: "Nagyon kényelmes, extra hosszú és remek viselet mindennapra",
    });

    const blurb = formatProductBlurb(product);
    assert.ok(blurb.length > 0, "blurb cannot be empty");
    assert.ok(blurb.length <= 160, "blurb must be max 160 chars");
    assert.ok(blurb.toLowerCase().includes("acme") || blurb.toLowerCase().includes("polo"), "blurb must use existing fields");
    assert.ok(!blurb.toLowerCase().includes("vizallo"), "blurb must not invent specs");
    console.log(`  blurb: "${blurb}"`);
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 10: FULL CATALOG SCAN - full match found in catalog even if not in shortlist
  // ============================================================================
  {
    console.log("TEST 10: Full catalog scan - full match found in catalog");
    const shortlist = [
      p({ product_id: "s1", tipus: "polo", szin: "piros" }),
    ];
    const fullCatalog = [
      p({ product_id: "s1", tipus: "polo", szin: "piros" }),
      p({ product_id: "c1", tipus: "hoodie", szin: "kek" }),
      p({ product_id: "c2", tipus: "hoodie", szin: "kek" }),
    ];

    const result = rankProducts({ tipus: "hoodie", szin: "kek" }, shortlist, { fullCatalog });
    assert.equal(result.meta.hasExactMatch, true, "full match must be found in catalog");
    assert.deepEqual(ids(result.items), ["c1", "c2"], "full matches from catalog must be returned");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 11: STABLE SORTING - original index preserved on tie
  // ============================================================================
  {
    console.log("TEST 11: Stable sorting - original index preserved on tie");
    const products = [
      p({ product_id: "s1", tipus: "polo", szin: "kek", price: 1000 }),
      p({ product_id: "s2", tipus: "polo", szin: "kek", price: 1000 }),
      p({ product_id: "s3", tipus: "polo", szin: "kek", price: 1000 }),
    ];

    const result = rankProducts({ tipus: "polo", szin: "kek" }, products);
    assert.deepEqual(ids(result.items), ["s1", "s2", "s3"], "stable sorting must preserve original order on tie");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 12: EMPTY QUERY - return all products in original order
  // ============================================================================
  {
    console.log("TEST 12: Empty query - return all products in original order");
    const products = [
      p({ product_id: "e1", tipus: "polo" }),
      p({ product_id: "e2", tipus: "hoodie" }),
      p({ product_id: "e3", tipus: "taska" }),
    ];

    const result = rankProducts({}, products);
    assert.deepEqual(ids(result.items), ["e1", "e2", "e3"], "empty query must return all in original order");
    assert.equal(result.meta.hasExactMatch, false);
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 13: buildQueryFromUserInput - infer type and color from free text
  // ============================================================================
  {
    console.log("TEST 13: buildQueryFromUserInput - infer type and color from free text");
    const query1 = buildQueryFromUserInput({
      free_text: "kék polo",
      interests: ["sport"],
    });
    assert.equal(query1.tipus, "polo", "tipus must be inferred from free text");
    assert.equal(query1.szin, "kek", "szin must be inferred from free text");

    const query2 = buildQueryFromUserInput({
      clothing_type: "hoodie",
    });
    assert.equal(query2.tipus, "hoodie", "tipus must be set from clothing_type fallback");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 14: COLOR EXTRACTION - from tags, name, description, CW codes
  // ============================================================================
  {
    console.log("TEST 14: Color extraction - from tags, name, description, CW codes");
    const products = [
      p({ product_id: "ce1", tipus: "polo", tags: "szürke sport nyári", name: "Casual Polo" }),
      p({ product_id: "ce2", tipus: "polo", description: "CW: obsidian/white", name: "Sneaker" }),
    ];

    const result1 = rankProducts({ tipus: "polo", szin: "szurke" }, products);
    assert.equal(result1.meta.hasExactMatch, true, "color must be extracted from tags");
    assert.deepEqual(ids(result1.items), ["ce1"]);

    const result2 = rankProducts({ tipus: "polo", szin: "obsidian" }, products);
    assert.equal(result2.meta.hasExactMatch, true, "color must be extracted from CW code");
    assert.deepEqual(ids(result2.items), ["ce2"]);
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 15: MESSAGE LOCALIZATION - HU and EN
  // ============================================================================
  {
    console.log("TEST 15: Message localization - HU and EN");
    const msgHu = buildNoExactMessage({ tipus: "polo", szin: "kek" }, { locale: "hu" });
    assert.ok(msgHu.includes("Pontos egyezést"), "HU message must be in Hungarian");

    const msgEn = buildNoExactMessage({ tipus: "polo", szin: "kek" }, { locale: "en" });
    assert.ok(msgEn.includes("couldn't find"), "EN message must be in English");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // TEST 16: PRICE SORTING - full match sorted by price ascending
  // ============================================================================
  {
    console.log("TEST 16: Price sorting - full match sorted by price ascending");
    const products = [
      p({ product_id: "p1", tipus: "polo", szin: "kek", price: 5000 }),
      p({ product_id: "p2", tipus: "polo", szin: "kek", price: 2000 }),
      p({ product_id: "p3", tipus: "polo", szin: "kek", price: 8000 }),
    ];

    const result = rankProducts({ tipus: "polo", szin: "kek" }, products);
    assert.deepEqual(ids(result.items), ["p2", "p1", "p3"], "full matches must be sorted by price ascending");
    console.log("✓ PASS\n");
  }

  // ============================================================================
  // ALL TESTS PASSED
  // ============================================================================
  console.log("═══════════════════════════════════════════════════════");
  console.log("✅ ALL RANKER TESTS PASSED");
  console.log("═══════════════════════════════════════════════════════\n");
}

run();

