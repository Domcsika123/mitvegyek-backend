/**
 * Unit tests for normalizeProductType module
 */
import {
  normalizeText,
  detectStandardTypeFromText,
  detectStandardTypeFromProductName,
  resolveRequestedType,
  getAllMatchingTypes,
  assignStandardType,
} from '../ai/normalizeProductType';

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestCase {
  input: string;
  expected: string;
  minConfidence?: number;
}

function runTests(name: string, tests: TestCase[]): { passed: number; failed: number; details: string[] } {
  let passed = 0;
  let failed = 0;
  const details: string[] = [];

  for (const test of tests) {
    const result = detectStandardTypeFromText(test.input);
    const success = result.type === test.expected;
    const confidenceOk = test.minConfidence ? result.confidence >= test.minConfidence : true;
    
    if (success && confidenceOk) {
      passed++;
      details.push(`✅ "${test.input}" => ${result.type} (${result.confidence})`);
    } else {
      failed++;
      details.push(`❌ "${test.input}" => GOT ${result.type} (${result.confidence}), EXPECTED ${test.expected}`);
      // Show all matches for debugging
      const allMatches = getAllMatchingTypes(test.input);
      details.push(`   All matches: ${JSON.stringify(allMatches.slice(0, 3))}`);
    }
  }

  return { passed, failed, details };
}

// ============================================================================
// TEST CASES
// ============================================================================

const POLO_TESTS: TestCase[] = [
  { input: 'fekete polo', expected: 'Póló' },
  { input: 'tee', expected: 'Póló' },
  { input: 't-shirt', expected: 'Póló' },
  { input: 'polo shirt', expected: 'Póló' },
  { input: 'UNREAL Soccer Team Polo Shirt Black', expected: 'Póló' },
];

const PULOVER_TESTS: TestCase[] = [
  { input: 'pulcsi', expected: 'Pulóver' },
  { input: 'pulóver', expected: 'Pulóver' },
  { input: 'sweater', expected: 'Pulóver' },
  { input: 'jumper', expected: 'Pulóver' },
  { input: 'crewneck', expected: 'Pulóver' },
  { input: 'knit sweater', expected: 'Pulóver' },
  { input: 'kardigán', expected: 'Pulóver' },
];

const HOODIE_TESTS: TestCase[] = [
  { input: 'hoodie', expected: 'Hoodie' },
  { input: 'kapucnis pulcsi', expected: 'Hoodie' },
  { input: 'hooded sweatshirt', expected: 'Hoodie' },
  { input: 'zip hoodie', expected: 'Hoodie' },
  { input: 'fekete hoodie', expected: 'Hoodie' },
  { input: 'UNREAL Manifold Hoodie Black', expected: 'Hoodie' },
  { input: 'kapucnis pulover', expected: 'Hoodie' },
];

const SAPKA_TESTS: TestCase[] = [
  { input: 'sapka', expected: 'Sapka' },
  { input: 'beanie', expected: 'Sapka' },
  { input: 'beanie sapka', expected: 'Sapka' },
  { input: 'baseball cap', expected: 'Sapka' },
  { input: 'snapback', expected: 'Sapka' },
  { input: 'fekete sapka', expected: 'Sapka' },
  { input: 'UNREAL Cosy Label Beanie Black', expected: 'Sapka' },
];

const FARMER_TESTS: TestCase[] = [
  { input: 'jeans', expected: 'Farmer' },
  { input: 'farmer', expected: 'Farmer' },
  { input: 'denim nadrág', expected: 'Farmer' },
  { input: 'skinny jeans', expected: 'Farmer' },
  { input: 'mom jeans', expected: 'Farmer' },
];

const ROVIDNADRAG_TESTS: TestCase[] = [
  { input: 'shorts', expected: 'Rövidnadrág' },
  { input: 'rövidnadrág', expected: 'Rövidnadrág' },
  { input: 'bermuda', expected: 'Rövidnadrág' },
  { input: 'board shorts', expected: 'Rövidnadrág' },
];

const NADRAG_TESTS: TestCase[] = [
  { input: 'nadrág', expected: 'Nadrág' },
  { input: 'pants', expected: 'Nadrág' },
  { input: 'chino', expected: 'Nadrág' },
  { input: 'jogger', expected: 'Nadrág' },
  { input: 'cargo pants', expected: 'Nadrág' },
];

const KABAT_TESTS: TestCase[] = [
  { input: 'kabát', expected: 'Kabát' },
  { input: 'téli kabát', expected: 'Kabát' },
  { input: 'winter coat', expected: 'Kabát' },
  { input: 'parka', expected: 'Kabát' },
  { input: 'trench coat', expected: 'Kabát' },
];

const DZSEKI_TESTS: TestCase[] = [
  { input: 'dzseki', expected: 'Dzseki' },
  { input: 'jacket', expected: 'Dzseki' },
  { input: 'bomber', expected: 'Dzseki' },
  { input: 'puffer jacket', expected: 'Dzseki' },
  { input: 'windbreaker', expected: 'Dzseki' },
];

const CIPO_TESTS: TestCase[] = [
  { input: 'cipő', expected: 'Cipő' },
  { input: 'sneaker', expected: 'Cipő' },
  { input: 'shoes', expected: 'Cipő' },
  { input: 'bakancs', expected: 'Cipő' },
  { input: 'csizma', expected: 'Cipő' },
];

const TASKA_TESTS: TestCase[] = [
  { input: 'táska', expected: 'Táska' },
  { input: 'backpack', expected: 'Táska' },
  { input: 'hátizsák', expected: 'Táska' },
  { input: 'crossbody bag', expected: 'Táska' },
];

const EKSZER_TESTS: TestCase[] = [
  { input: 'ékszer', expected: 'Ékszer' },
  { input: 'gyűrű', expected: 'Ékszer' },
  { input: 'nyaklánc', expected: 'Ékszer' },
  { input: 'bracelet', expected: 'Ékszer' },
  { input: 'earring', expected: 'Ékszer' },
];

const FURDORUHA_TESTS: TestCase[] = [
  { input: 'fürdőruha', expected: 'Fürdőruha' },
  { input: 'bikini', expected: 'Fürdőruha' },
  { input: 'swimsuit', expected: 'Fürdőruha' },
  { input: 'swimwear', expected: 'Fürdőruha' },
];

const KIEGESZITO_TESTS: TestCase[] = [
  { input: 'öv', expected: 'Kiegészítő' },
  { input: 'belt', expected: 'Kiegészítő' },
  { input: 'sál', expected: 'Kiegészítő' },
  { input: 'zokni', expected: 'Kiegészítő' },
  { input: 'nyakkendő', expected: 'Kiegészítő' },
];

const NORMALIZATION_TESTS = [
  { input: 'Pólót keresek', normalized: 'polot keresek' },
  { input: 'KAPUCNIS PULCSI', normalized: 'kapucnis pulcsi' },
  { input: 'fekete  sapka', normalized: 'fekete sapka' },
  { input: 'farmer-nadrág', normalized: 'farmer nadrag' },
];

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
  console.log('='.repeat(60));
  console.log('NORMALIZEPRODUCTTYPE UNIT TESTS');
  console.log('='.repeat(60));
  console.log('');

  let totalPassed = 0;
  let totalFailed = 0;

  // Test normalizeText
  console.log('📝 normalizeText tests:');
  for (const test of NORMALIZATION_TESTS) {
    const result = normalizeText(test.input);
    if (result === test.normalized) {
      console.log(`  ✅ "${test.input}" => "${result}"`);
      totalPassed++;
    } else {
      console.log(`  ❌ "${test.input}" => "${result}" (expected "${test.normalized}")`);
      totalFailed++;
    }
  }
  console.log('');

  // Test type detection
  const testSets = [
    { name: 'Póló', tests: POLO_TESTS },
    { name: 'Pulóver', tests: PULOVER_TESTS },
    { name: 'Hoodie', tests: HOODIE_TESTS },
    { name: 'Sapka', tests: SAPKA_TESTS },
    { name: 'Farmer', tests: FARMER_TESTS },
    { name: 'Rövidnadrág', tests: ROVIDNADRAG_TESTS },
    { name: 'Nadrág', tests: NADRAG_TESTS },
    { name: 'Kabát', tests: KABAT_TESTS },
    { name: 'Dzseki', tests: DZSEKI_TESTS },
    { name: 'Cipő', tests: CIPO_TESTS },
    { name: 'Táska', tests: TASKA_TESTS },
    { name: 'Ékszer', tests: EKSZER_TESTS },
    { name: 'Fürdőruha', tests: FURDORUHA_TESTS },
    { name: 'Kiegészítő', tests: KIEGESZITO_TESTS },
  ];

  for (const { name, tests } of testSets) {
    console.log(`📦 ${name} tests:`);
    const result = runTests(name, tests);
    totalPassed += result.passed;
    totalFailed += result.failed;
    for (const d of result.details) {
      console.log(`  ${d}`);
    }
    console.log('');
  }

  // Test resolveRequestedType
  console.log('🔧 resolveRequestedType tests:');
  const resolveTests = [
    { input: 'fekete hoodie', expected: 'Hoodie' },
    { input: { free_text: 'pulcsi', type: '' }, expected: 'Pulóver' },
    { input: { interests: 'sneaker', type: 'cipő' }, expected: 'Cipő' },
  ];
  for (const test of resolveTests) {
    const result = resolveRequestedType(test.input as any);
    if (result === test.expected) {
      console.log(`  ✅ ${JSON.stringify(test.input)} => ${result}`);
      totalPassed++;
    } else {
      console.log(`  ❌ ${JSON.stringify(test.input)} => ${result} (expected ${test.expected})`);
      totalFailed++;
    }
  }
  console.log('');

  // Test assignStandardType
  console.log('🏷️ assignStandardType tests:');
  const products = [
    { name: 'UNREAL Manifold Hoodie Black', expected: 'Hoodie' },
    { name: 'UNREAL Cosy Label Beanie Black', expected: 'Sapka' },
    { name: 'Skinny Jeans Blue', expected: 'Farmer' },
  ];
  for (const p of products) {
    const result = assignStandardType(p);
    if (result.standard_type === p.expected) {
      console.log(`  ✅ "${p.name}" => ${result.standard_type}`);
      totalPassed++;
    } else {
      console.log(`  ❌ "${p.name}" => ${result.standard_type} (expected ${p.expected})`);
      totalFailed++;
    }
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log(`SUMMARY: ${totalPassed} passed, ${totalFailed} failed`);
  console.log('='.repeat(60));

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAllTests();
