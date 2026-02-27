// src/tests/price.test.ts
// Unit tests for parsePrice and isInBudget

import assert from "node:assert/strict";
import { parsePrice, isInBudget } from "../ai/price";

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

console.log("\n=== parsePrice tests ===\n");

// Basic number inputs
test("returns number for valid number input", () => {
  assert.equal(parsePrice(1299), 1299);
  assert.equal(parsePrice(19.99), 19.99);
  assert.equal(parsePrice(0.5), 0.5);
});

test("returns null for zero or negative numbers", () => {
  assert.equal(parsePrice(0), null);
  assert.equal(parsePrice(-10), null);
});

test("returns null for null/undefined/empty", () => {
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(undefined), null);
  assert.equal(parsePrice(""), null);
});

// HU format: space as thousands separator
test("parses Hungarian format with space: '12 990'", () => {
  assert.equal(parsePrice("12 990"), 12990);
  assert.equal(parsePrice("1 299"), 1299);
  assert.equal(parsePrice("123 456 789"), 123456789);
});

// HU format: dot as thousands separator
test("parses Hungarian format with dot: '12.990'", () => {
  assert.equal(parsePrice("12.990"), 12990);
  assert.equal(parsePrice("1.299"), 1299);
});

// HU format: comma as thousands separator  
test("parses Hungarian format with comma: '12,990'", () => {
  assert.equal(parsePrice("12,990"), 12990);
});

// HU format with Ft suffix
test("parses Hungarian format with Ft: '12 990 Ft'", () => {
  assert.equal(parsePrice("12 990 Ft"), 12990);
  assert.equal(parsePrice("12990 Ft"), 12990);
  assert.equal(parsePrice("12 990Ft"), 12990);
});

// EUR format: comma as decimal
test("parses EUR format: '19,99' (decimal comma)", () => {
  assert.equal(parsePrice("19,99"), 19.99);
  assert.equal(parsePrice("9,99"), 9.99);
  assert.equal(parsePrice("1,5"), 1.5);
});

// EUR format with symbol
test("parses EUR format: '€19.99'", () => {
  assert.equal(parsePrice("€19.99"), 19.99);
  assert.equal(parsePrice("19.99€"), 19.99);
  assert.equal(parsePrice("EUR 19.99"), 19.99);
});

// USD format
test("parses USD format: '$19.99'", () => {
  assert.equal(parsePrice("$19.99"), 19.99);
  assert.equal(parsePrice("USD 19.99"), 19.99);
});

// Plain decimal
test("parses plain decimal: '19.99'", () => {
  assert.equal(parsePrice("19.99"), 19.99);
  assert.equal(parsePrice("9.99"), 9.99);
});

// Mixed EU format: dot as thousands, comma as decimal
test("parses EU format: '1.234,56'", () => {
  assert.equal(parsePrice("1.234,56"), 1234.56);
  assert.equal(parsePrice("12.345,67"), 12345.67);
});

// Edge cases
test("handles leading/trailing whitespace", () => {
  assert.equal(parsePrice("  12990  "), 12990);
  assert.equal(parsePrice("  19.99  "), 19.99);
});

test("returns null for non-numeric strings", () => {
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice("hello"), null);
  assert.equal(parsePrice("NaN"), null);
});

test("handles HUF text", () => {
  assert.equal(parsePrice("12990 HUF"), 12990);
  assert.equal(parsePrice("HUF 12990"), 12990);
  assert.equal(parsePrice("12 990 forint"), 12990);
});

console.log("\n=== isInBudget tests ===\n");

test("returns true when price is within budget", () => {
  assert.equal(isInBudget(5000, 0, 10000), true);
  assert.equal(isInBudget(10000, 0, 10000), true);
  assert.equal(isInBudget(100, 100, 200), true);
});

test("returns true when price is within tolerance (15%)", () => {
  // 10000 * 1.15 = 11500
  assert.equal(isInBudget(11000, 0, 10000), true);
  assert.equal(isInBudget(11500, 0, 10000), true);
  // But 12000 is over
  assert.equal(isInBudget(12000, 0, 10000), false);
});

test("returns false when price exceeds budget + tolerance", () => {
  assert.equal(isInBudget(15000, 0, 10000), false);
});

test("returns default value when price cannot be parsed", () => {
  assert.equal(isInBudget(null, 0, 10000, 0.15, true), true);
  assert.equal(isInBudget(null, 0, 10000, 0.15, false), false);
  assert.equal(isInBudget("abc", 0, 10000, 0.15, true), true);
});

test("returns true when no budget constraints", () => {
  assert.equal(isInBudget(99999, null, null), true);
  assert.equal(isInBudget(1, undefined, undefined), true);
});

test("handles string prices", () => {
  assert.equal(isInBudget("5000", 0, 10000), true);
  assert.equal(isInBudget("12 990 Ft", 0, 15000), true);
  assert.equal(isInBudget("€19.99", 0, 25), true);
});

console.log("\n=== All price tests completed ===\n");
