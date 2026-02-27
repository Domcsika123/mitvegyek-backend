/**
 * Unit tests for describeRecommendation module
 */
import {
  describeRecommendation,
  formatRecommendationReason,
} from "../reco/describeRecommendation";

// ============================================================================
// TEST UTILITIES
// ============================================================================

interface TestCase {
  name: string;
  args: Parameters<typeof describeRecommendation>[0];
  shouldContain?: string[];
  shouldNotContain?: string[];
}

function runTest(test: TestCase): { passed: boolean; result: string; error?: string } {
  try {
    const result = describeRecommendation(test.args);
    
    // Check shouldContain
    for (const expected of test.shouldContain || []) {
      if (!result.toLowerCase().includes(expected.toLowerCase())) {
        return {
          passed: false,
          result,
          error: `Missing expected text: "${expected}"`,
        };
      }
    }
    
    // Check shouldNotContain
    for (const notExpected of test.shouldNotContain || []) {
      if (result.toLowerCase().includes(notExpected.toLowerCase())) {
        return {
          passed: false,
          result,
          error: `Contains unwanted text: "${notExpected}"`,
        };
      }
    }
    
    return { passed: true, result };
  } catch (e: any) {
    return { passed: false, result: "", error: e.message };
  }
}

// ============================================================================
// TEST CASES
// ============================================================================

const TEST_CASES: TestCase[] = [
  // Basic hoodie with color
  {
    name: "Fekete hoodie - basic",
    args: {
      product: {
        name: "UNREAL Manifold Hoodie Black",
        standardType: "Hoodie",
      },
      userQuery: "hoodie",
    },
    shouldContain: ["fekete", "kapucnis pulcsi"],
    shouldNotContain: ["•", "Ft", "HUF"],
  },

  // Sapka/beanie
  {
    name: "Beanie keresés",
    args: {
      product: {
        name: "UNREAL Recycled Beanie Black",
        standardType: "Sapka",
      },
      userQuery: "beanie sapka",
    },
    shouldContain: ["fekete", "sapka"],
    shouldNotContain: ["hoodie", "pulóver"],
  },

  // Farmer/jeans
  {
    name: "Farmer keresés",
    args: {
      product: {
        name: "Slim Fit Jeans Blue",
        standardType: "Farmer",
        color: "blue",
      },
      userQuery: "jeans",
    },
    shouldContain: ["kék", "farmer"],
    shouldNotContain: ["nadrág"],
  },

  // Pulóver without hood
  {
    name: "Pulcsi keresés (no hood)",
    args: {
      product: {
        name: "Cotton Crewneck Sweater Grey",
        standardType: "Pulóver",
      },
      userQuery: "pulcsi",
    },
    shouldContain: ["pulóver", "szürke"],
    shouldNotContain: ["kapucnis"],
  },

  // Material extraction
  {
    name: "Material from name - recycled",
    args: {
      product: {
        name: "UNREAL Recycled Cotton Hoodie",
        standardType: "Hoodie",
      },
    },
    shouldContain: ["kapucnis pulcsi"],
  },

  // Missing color - should still work
  {
    name: "Missing color - fallback",
    args: {
      product: {
        name: "Basic Polo Shirt",
        standardType: "Póló",
      },
      userQuery: "polo",
    },
    shouldContain: ["póló"],
  },

  // Missing everything - fallback to name
  {
    name: "Empty product - fallback",
    args: {
      product: {
        name: "Unknown Product XYZ",
      },
    },
    shouldContain: ["Unknown Product XYZ"],
  },

  // Dzseki/jacket
  {
    name: "Dzseki - puffer jacket",
    args: {
      product: {
        name: "Puffer Jacket Navy",
        standardType: "Dzseki",
      },
      userQuery: "puffer jacket",
    },
    shouldContain: ["dzseki"],
  },

  // Táska
  {
    name: "Táska - backpack",
    args: {
      product: {
        name: "Urban Backpack Black",
        standardType: "Táska",
      },
      userQuery: "taska",
    },
    shouldContain: ["táska", "fekete"],
  },

  // With explicit color field
  {
    name: "Explicit color field",
    args: {
      product: {
        name: "Basic Tee",
        standardType: "Póló",
        color: "white",
      },
    },
    shouldContain: ["fehér", "póló"],
  },
];

// ============================================================================
// RUN TESTS
// ============================================================================

async function runAllTests() {
  console.log("=".repeat(60));
  console.log("DESCRIBERECOMMENDATION UNIT TESTS");
  console.log("=".repeat(60));
  console.log("");

  let passed = 0;
  let failed = 0;

  for (const test of TEST_CASES) {
    const result = runTest(test);
    
    if (result.passed) {
      passed++;
      console.log(`✅ ${test.name}`);
      console.log(`   Output: "${result.result}"`);
    } else {
      failed++;
      console.log(`❌ ${test.name}`);
      console.log(`   Output: "${result.result}"`);
      console.log(`   Error: ${result.error}`);
    }
    console.log("");
  }

  // Test formatRecommendationReason shorthand
  console.log("📦 formatRecommendationReason shorthand test:");
  const shorthandResult = formatRecommendationReason(
    { name: "Test Hoodie Black", standardType: "Hoodie" },
    "hoodie"
  );
  if (shorthandResult.includes("kapucnis") && shorthandResult.includes("fekete")) {
    passed++;
    console.log(`✅ Shorthand works: "${shorthandResult}"`);
  } else {
    failed++;
    console.log(`❌ Shorthand failed: "${shorthandResult}"`);
  }
  console.log("");

  // Summary
  console.log("=".repeat(60));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests();
