/**
 * Product Type Normalization Module
 * Központi modul a termék típusok normalizálásához HU/EN felhasználói inputból és terméknevekből.
 */

// ============================================================================
// STANDARD TÍPUSOK
// ============================================================================

export const STANDARD_TYPES = [
  'Mindegy',
  'Póló',
  'Pulóver',
  'Hoodie',
  'Kabát',
  'Dzseki',
  'Nadrág',
  'Farmer',
  'Rövidnadrág',
  'Cipő',
  'Kiegészítő',
  'Táska',
  'Ékszer',
  'Fürdőruha',
  'Sapka',
] as const;

export type StandardType = (typeof STANDARD_TYPES)[number];

// ============================================================================
// TEXT NORMALIZATION
// ============================================================================

const ACCENT_MAP: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ö: 'o', ő: 'o', ú: 'u', ü: 'u', ű: 'u',
  Á: 'a', É: 'e', Í: 'i', Ó: 'o', Ö: 'o', Ő: 'o', Ú: 'u', Ü: 'u', Ű: 'u',
};

/**
 * Normalize text: lowercase, remove accents, collapse whitespace, remove hyphens
 */
export function normalizeText(input: string): string {
  if (!input) return '';
  return input
    .toLowerCase()
    .split('')
    .map(c => ACCENT_MAP[c] || c)
    .join('')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// SYNONYM / PATTERN DICTIONARIES
// ============================================================================

interface TypeDefinition {
  type: StandardType;
  /** Exact phrases (highest priority, score * 5) */
  phrases: string[];
  /** Regex patterns (medium priority, score * 3) */
  patterns: RegExp[];
  /** Keywords (lower priority, score * 1) */
  keywords: string[];
  /** Negative keywords that should NOT match this type */
  negativeKeywords?: string[];
  /** Priority boost when competing with other types */
  priority?: number;
}

const TYPE_DEFINITIONS: TypeDefinition[] = [
  // ---- HOODIE (must be before Pulóver to win priority) ----
  {
    type: 'Hoodie',
    phrases: [
      'kapucnis pulcsi', 'hooded sweatshirt', 'zip hoodie', 'cipzaras kapucnis',
      'kapucnis pulover', 'full zip hoodie', 'pullover hoodie',
    ],
    patterns: [
      /\bhoodie?\b/i,
      /\bhood(?:ed|y)?\b/i,
      /\bkapucn?i?s?\b/i,
      /\bsweatshirt\b.*\b(?:hood|kapucn)/i,
      /\b(?:hood|kapucn).*\bsweatshirt\b/i,
    ],
    keywords: [
      'hoodie', 'hoody', 'hooded', 'kapucnis', 'kapucni', 'zipup', 'zip-up',
    ],
    priority: 10, // wins over Pulóver
  },

  // ---- PULÓVER ----
  {
    type: 'Pulóver',
    phrases: [
      'kotott pulover', 'knit sweater', 'crewneck sweater', 'crew neck',
    ],
    patterns: [
      /\bpul(?:o|ó)v(?:e|é)r\b/i,
      /\bpulcsi\b/i,
      /\bsweater\b/i,
      /\bjumper\b/i,
      /\bcrewneck\b/i,
      /\bkardigan\b/i,
      /\bkardig[aá]n\b/i,
      /\bknit(?:ted)?\b/i,
      /\bk[oö]t[oö]tt\b/i,
    ],
    keywords: [
      'pulover', 'pulcsi', 'sweater', 'jumper', 'cardigan', 'kardigan',
      'crewneck', 'crew', 'knit', 'kotott', 'knitwear',
    ],
    negativeKeywords: ['kapucni', 'hood', 'hooded', 'kapucnis'],
    priority: 5,
  },

  // ---- PÓLÓ ----
  {
    type: 'Póló',
    phrases: [
      'polo shirt', 't-shirt', 'tee shirt', 'long sleeve tee',
    ],
    patterns: [
      /\bp[oó]l[oó]\b/i,
      /\bt-?shirt\b/i,
      /\b(?<!swea)tee\b/i,
      /\btricko\b/i,
      /\btriko\b/i,
    ],
    keywords: [
      'polo', 'poloshirt', 'tshirt', 't-shirt', 'tee', 'tricko', 'triko',
    ],
    priority: 3,
  },

  // ---- FARMER (must be before Nadrág) ----
  {
    type: 'Farmer',
    phrases: [
      'skinny jeans', 'mom jeans', 'dad jeans', 'boyfriend jeans',
      'denim pants', 'denim nadrag', 'farmer nadrag',
    ],
    patterns: [
      /\bfarmer\b/i,
      /\bjeans?\b/i,
      /\bdenim\b/i,
      /\blevi'?s?\b/i,
    ],
    keywords: [
      'farmer', 'jeans', 'jean', 'denim', 'levis', "levi's",
    ],
    priority: 10, // wins over Nadrág
  },

  // ---- RÖVIDNADRÁG (must be before Nadrág) ----
  {
    type: 'Rövidnadrág',
    phrases: [
      'rovid nadrag', 'board short', 'swim short', 'running short',
    ],
    patterns: [
      /\br[oö]vidn?adr[aá]g\b/i,
      /\bshorts?\b/i,
      /\bbermuda\b/i,
      /\bboardshort\b/i,
    ],
    keywords: [
      'rovidnadrag', 'short', 'shorts', 'bermuda', 'boardshort',
    ],
    priority: 10, // wins over Nadrág
  },

  // ---- NADRÁG ----
  {
    type: 'Nadrág',
    phrases: [
      'cargo pants', 'jogger pants', 'melegito nadrag', 'chino pants',
    ],
    patterns: [
      /\bn?adr[aá]g\b/i,
      /\bpants?\b/i,
      /\bchino\b/i,
      /\bcargo\b/i,
      /\bjogger\b/i,
      /\btrousers?\b/i,
      /\bmelegit[oő]\b/i,
    ],
    keywords: [
      'nadrag', 'pants', 'pant', 'chino', 'cargo', 'jogger', 'trousers',
      'melegito', 'leggings', 'legging',
    ],
    negativeKeywords: ['farmer', 'jeans', 'denim', 'short', 'rovid'],
    priority: 3,
  },

  // ---- DZSEKI ----
  {
    type: 'Dzseki',
    phrases: [
      'puffer jacket', 'bomber jacket', 'windbreaker jacket', 'softshell jacket',
    ],
    patterns: [
      /\bdzseki\b/i,
      /\bjacket\b/i,
      /\bbomber\b/i,
      /\bpuffer\b/i,
      /\bpehely\b/i,
      /\bwindbreaker\b/i,
      /\bsoftshell\b/i,
      /\banor[aá]k\b/i,
    ],
    keywords: [
      'dzseki', 'jacket', 'bomber', 'puffer', 'pehely', 'windbreaker',
      'softshell', 'anorak', 'varsity',
    ],
    priority: 8,
  },

  // ---- KABÁT ----
  {
    type: 'Kabát',
    phrases: [
      'teli kabat', 'winter coat', 'trench coat', 'szovet kabat',
    ],
    patterns: [
      /\bkab[aá]t\b/i,
      /\bcoat\b/i,
      /\bovercoat\b/i,
      /\bparka\b/i,
      /\btrench\b/i,
      /\bballon\b/i,
      /\bsz[oö]vet\s?kab[aá]t/i,
    ],
    keywords: [
      'kabat', 'coat', 'overcoat', 'parka', 'trench', 'ballonkabat',
      'szovet', 'wool coat',
    ],
    negativeKeywords: ['dzseki', 'jacket', 'bomber', 'puffer'],
    priority: 7,
  },

  // ---- CIPŐ ----
  {
    type: 'Cipő',
    phrases: [
      'running shoe', 'hiking boot', 'chelsea boot', 'leather shoe',
    ],
    patterns: [
      /\bcip[oő]\b/i,
      /\bshoes?\b/i,
      /\bsneakers?\b/i,
      /\btrainers?\b/i,
      /\bbakancs\b/i,
      /\bcsizma\b/i,
      /\bboots?\b/i,
      /\bloafers?\b/i,
      /\bszand[aá]l\b/i,
      /\bpapucs\b/i,
      /\bfootwear\b/i,
    ],
    keywords: [
      'cipo', 'shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers',
      'bakancs', 'csizma', 'boot', 'boots', 'loafer', 'sandal', 'szandal',
      'papucs', 'slipper', 'footwear',
    ],
    priority: 5,
  },

  // ---- SAPKA ----
  {
    type: 'Sapka',
    phrases: [
      'baseball cap', 'baseball sapka', 'kotott sapka', 'knit beanie',
    ],
    patterns: [
      /\bsapk[aá]\b/i,
      /\bcaps?\b/i,
      /\bbeanie\b/i,
      /\bsnapback\b/i,
      /\bkalap\b/i,
      /\bsildes\b/i,
      /\bhats?\b(?!.*(?:sweat|hood))/i,
    ],
    keywords: [
      'sapka', 'cap', 'beanie', 'snapback', 'baseball', 'trucker', 'kalap',
      'siltes', 'sildes', 'hat', 'beanies',
    ],
    priority: 8,
  },

  // ---- TÁSKA ----
  {
    type: 'Táska',
    phrases: [
      'hatizsak', 'crossbody bag', 'shoulder bag', 'ovtaska',
    ],
    patterns: [
      /\bt[aá]sk[aá]\b/i,
      /\bbags?\b/i,
      /\bbackpack\b/i,
      /\bh[aá]tizs[aá]k\b/i,
      /\bhandbag\b/i,
      /\bcrossbody\b/i,
      /\b[oö]vtask[aá]\b/i,
      /\bduffel\b/i,
      /\btote\b/i,
    ],
    keywords: [
      'taska', 'bag', 'backpack', 'hatizsak', 'handbag', 'crossbody',
      'ovtaska', 'duffel', 'tote', 'clutch', 'satchel',
    ],
    priority: 5,
  },

  // ---- ÉKSZER ----
  {
    type: 'Ékszer',
    phrases: [
      'arany gyuru', 'ezust nyaklanc', 'gold ring', 'silver necklace',
    ],
    patterns: [
      /\b[eé]kszer\b/i,
      /\bjewel(?:ry|lery)?\b/i,
      /\bgy[uű]r[uű]\b/i,
      /\bring\b/i,
      /\bnyakl[aá]nc\b/i,
      /\bnecklace\b/i,
      /\bkark[oö]t[oő]\b/i,
      /\bbracelet\b/i,
      /\bf[uü]lbeval[oó]\b/i,
      /\bearrings?\b/i,
      /\bmed[aá]l\b/i,
      /\bpendant\b/i,
    ],
    keywords: [
      'ekszer', 'jewelry', 'jewellery', 'ring', 'gyuru', 'nyaklanc',
      'necklace', 'karkoto', 'bracelet', 'fulbevalo', 'earring', 'earrings',
      'medal', 'pendant', 'charm',
    ],
    priority: 5,
  },

  // ---- FÜRDŐRUHA ----
  {
    type: 'Fürdőruha',
    phrases: [
      'bikini set', 'swim trunks', 'uszo nadrag', 'swim bra', 'swim panties', 'swim top',
    ],
    patterns: [
      /\bf[uü]rd[oő]ruh[aá]\b/i,
      /\bswim(?:suit|wear)?\b/i,
      /\bswim\s+(?:bra|panties|top|bottom)\b/i,
      /\bbikini\b/i,
      /\btrikini\b/i,
      /\b[uú]sz[oó](?:nadr[aá]g)?\b/i,
    ],
    keywords: [
      'furdoruha', 'swimsuit', 'swimwear', 'bikini', 'trikini', 'uszo',
      'uszonadrag', 'swimming', 'swim', 'bra',
    ],
    priority: 8, // Higher priority to match swim bra before other types
  },

  // ---- KIEGÉSZÍTŐ (catch-all for accessories) ----
  {
    type: 'Kiegészítő',
    phrases: [],
    patterns: [
      /\bkieg[eé]sz[ií]t[oő]\b/i,
      /\baccessor(?:y|ies)\b/i,
      /\b[oö]v\b/i,
      /\bbelt\b/i,
      /\bs[aá]l\b/i,
      /\bscarf\b/i,
      /\bkeszty[uű]\b/i,
      /\bgloves?\b/i,
      /\bzokni\b/i,
      /\bsocks?\b/i,
      /\bharisny[aá]\b/i,
      /\bnyakkend[oő]\b/i,
      /\btie\b/i,
      /\bwallet\b/i,
      /\bp[eé]nzt[aá]rc[aá]\b/i,
    ],
    keywords: [
      'kiegeszito', 'accessory', 'accessories', 'ov', 'belt', 'sal', 'scarf',
      'kesztyu', 'glove', 'gloves', 'zokni', 'sock', 'socks', 'harisnya',
      'nyakkendo', 'tie', 'wallet', 'penztarca', 'watch', 'ora',
    ],
    priority: 1, // lowest priority - catch-all
  },
];

// ============================================================================
// DETECTION LOGIC
// ============================================================================

interface DetectionResult {
  type: StandardType;
  confidence: number;
  matched: string[];
}

interface TypeScore {
  type: StandardType;
  score: number;
  matched: string[];
  priority: number;
}

/**
 * Detect standard type from any text input (user query, free_text, interests)
 */
export function detectStandardTypeFromText(input: string): DetectionResult {
  if (!input || input.trim().length === 0) {
    return { type: 'Mindegy', confidence: 0, matched: [] };
  }

  const normalized = normalizeText(input);
  const scores: TypeScore[] = [];

  for (const def of TYPE_DEFINITIONS) {
    let score = 0;
    const matched: string[] = [];

    // Check for negative keywords first - if found, reduce score significantly
    let hasNegative = false;
    if (def.negativeKeywords) {
      for (const neg of def.negativeKeywords) {
        const negNorm = normalizeText(neg);
        if (normalized.includes(negNorm)) {
          hasNegative = true;
          break;
        }
      }
    }

    // Phrase matching (highest score: 5 points each)
    for (const phrase of def.phrases) {
      const phraseNorm = normalizeText(phrase);
      if (normalized.includes(phraseNorm)) {
        score += 5;
        matched.push(`phrase:${phrase}`);
      }
    }

    // Pattern matching (medium score: 3 points each)
    for (const pattern of def.patterns) {
      // Apply pattern to both original and normalized
      if (pattern.test(input) || pattern.test(normalized)) {
        score += 3;
        matched.push(`pattern:${pattern.source}`);
      }
    }

    // Keyword matching (lower score: 1 point each)
    for (const kw of def.keywords) {
      const kwNorm = normalizeText(kw);
      // Word boundary check
      const regex = new RegExp(`\\b${escapeRegex(kwNorm)}\\b`, 'i');
      if (regex.test(normalized)) {
        score += 1;
        matched.push(`keyword:${kw}`);
      }
    }

    // Apply negative penalty
    if (hasNegative && score > 0) {
      score = Math.max(0, score - 3);
    }

    if (score > 0) {
      scores.push({
        type: def.type,
        score,
        matched,
        priority: def.priority || 0,
      });
    }
  }

  if (scores.length === 0) {
    return { type: 'Mindegy', confidence: 0, matched: [] };
  }

  // Sort by score (descending), then by priority (descending)
  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.priority - a.priority;
  });

  const best = scores[0];

  // Special case: Hoodie vs Pulóver conflict resolution
  const puloverScore = scores.find(s => s.type === 'Pulóver');
  const hoodieScore = scores.find(s => s.type === 'Hoodie');
  if (puloverScore && hoodieScore) {
    // If "kapucni" or "hood" appears, Hoodie wins
    const hasHoodKeyword = /\b(kapucn|hood)/i.test(normalized) || /\b(kapucn|hood)/i.test(input);
    if (hasHoodKeyword) {
      const hoodie = scores.find(s => s.type === 'Hoodie')!;
      return {
        type: 'Hoodie',
        confidence: calculateConfidence(hoodie.score, normalized.length),
        matched: hoodie.matched,
      };
    }
  }

  // Calculate confidence
  const confidence = calculateConfidence(best.score, normalized.length);

  // If confidence too low, return Mindegy
  if (confidence < 0.35) {
    return { type: 'Mindegy', confidence, matched: best.matched };
  }

  return {
    type: best.type,
    confidence,
    matched: best.matched,
  };
}

/**
 * Detect standard type from product name/title
 */
export function detectStandardTypeFromProductName(name: string): DetectionResult {
  // Same logic as text detection, but might have different weighting in future
  return detectStandardTypeFromText(name);
}

/**
 * Resolve requested type from filters object or free text
 */
export function resolveRequestedType(
  filtersOrText: string | { type?: string; free_text?: string; interests?: string }
): StandardType {
  let textToAnalyze = '';

  if (typeof filtersOrText === 'string') {
    textToAnalyze = filtersOrText;
  } else {
    // Combine all relevant fields
    const parts: string[] = [];
    if (filtersOrText.type) parts.push(filtersOrText.type);
    if (filtersOrText.free_text) parts.push(filtersOrText.free_text);
    if (filtersOrText.interests) parts.push(filtersOrText.interests);
    textToAnalyze = parts.join(' ');
  }

  const result = detectStandardTypeFromText(textToAnalyze);
  return result.type;
}

/**
 * Calculate confidence score based on match score and input length
 */
function calculateConfidence(score: number, inputLength: number): number {
  // Base confidence from score (max around 15-20 for a good match)
  const baseConfidence = Math.min(score / 10, 1);
  
  // Adjust slightly based on input length (longer inputs with good scores = higher confidence)
  const lengthFactor = Math.min(inputLength / 20, 1);
  
  // Combine with weighted average (score matters more)
  const confidence = baseConfidence * 0.85 + lengthFactor * 0.15;
  
  return Math.round(confidence * 100) / 100;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// UTILITY: Get all matching types with scores (for debugging)
// ============================================================================

export function getAllMatchingTypes(input: string): TypeScore[] {
  const normalized = normalizeText(input);
  const scores: TypeScore[] = [];

  for (const def of TYPE_DEFINITIONS) {
    let score = 0;
    const matched: string[] = [];

    for (const phrase of def.phrases) {
      const phraseNorm = normalizeText(phrase);
      if (normalized.includes(phraseNorm)) {
        score += 5;
        matched.push(`phrase:${phrase}`);
      }
    }

    for (const pattern of def.patterns) {
      if (pattern.test(input) || pattern.test(normalized)) {
        score += 3;
        matched.push(`pattern:${pattern.source}`);
      }
    }

    for (const kw of def.keywords) {
      const kwNorm = normalizeText(kw);
      const regex = new RegExp(`\\b${escapeRegex(kwNorm)}\\b`, 'i');
      if (regex.test(normalized)) {
        score += 1;
        matched.push(`keyword:${kw}`);
      }
    }

    if (score > 0) {
      scores.push({
        type: def.type,
        score,
        matched,
        priority: def.priority || 0,
      });
    }
  }

  return scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.priority - a.priority;
  });
}

// ============================================================================
// PRODUCT STANDARD TYPE ASSIGNMENT
// ============================================================================

export interface ProductWithStandardType {
  standard_type?: StandardType;
  standard_type_confidence?: number;
  [key: string]: unknown;
}

/**
 * Assign standard_type to a product based on its name and category
 */
export function assignStandardType<T extends { name?: string; title?: string; category?: string }>(
  product: T
): T & ProductWithStandardType {
  const name = product.name || product.title || '';
  const category = product.category || '';
  
  // Try name first, then category
  let result = detectStandardTypeFromProductName(name);
  
  // If name detection is weak, try category
  if (result.confidence < 0.5 && category) {
    const categoryResult = detectStandardTypeFromText(category);
    if (categoryResult.confidence > result.confidence) {
      result = categoryResult;
    }
  }

  return {
    ...product,
    standard_type: result.type,
    standard_type_confidence: result.confidence,
  };
}

// ============================================================================
// TYPE MAPPING FOR EXTERNAL INTEGRATION
// ============================================================================

/**
 * Map from various external type strings to StandardType
 */
export function mapExternalTypeToStandard(externalType: string): StandardType {
  const result = detectStandardTypeFromText(externalType);
  return result.type;
}
