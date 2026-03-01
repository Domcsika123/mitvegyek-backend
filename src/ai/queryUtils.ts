// src/ai/queryUtils.ts
//
// Magyar lekérdezés normalizálás (szín-összetételek, szinonimák)
// és variáns-duplikáció szűrés (Shopify handle-alapú dedupe).

import { Product } from "../models/Product";

/* =====================================================================
 * 1) MAGYAR QUERY NORMALIZÁLÁS
 * =====================================================================
 * Cél: "sötét kék pulcsi" → "sötétkék pulcsi pulóver sweatshirt hoodie"
 * Csak a keresési query-t normalizáljuk, az adatbázist NEM írjuk át.
 * ================================================================== */

/**
 * Összetett magyar színkifejezések: a "sötét kék" → "sötétkék" típusú
 * szóközt tartalmazó szín-összetételek összevonása.
 * A sorrend számít: hosszabb mintákat előbb illesztünk.
 */
const COLOR_COMPOUNDS: [RegExp, string][] = [
  [/\bsötét\s+kék\b/gi, "sötétkék"],
  [/\bvilágos\s+kék\b/gi, "világoskék"],
  [/\bsötét\s+zöld\b/gi, "sötétzöld"],
  [/\bvilágos\s+zöld\b/gi, "világoszöld"],
  [/\bsötét\s+piros\b/gi, "sötétpiros"],
  [/\bvilágos\s+piros\b/gi, "világospiros"],
  [/\bsötét\s+szürke\b/gi, "sötétszürke"],
  [/\bvilágos\s+szürke\b/gi, "világosszürke"],
  [/\bsötét\s+barna\b/gi, "sötétbarna"],
  [/\bvilágos\s+barna\b/gi, "világosbarna"],
  [/\bsötét\s+rózsaszín\b/gi, "sötétrózsaszín"],
  [/\bvilágos\s+rózsaszín\b/gi, "világosrózsaszín"],
  [/\bsötét\s+lila\b/gi, "sötétlila"],
  [/\bvilágos\s+lila\b/gi, "világoslila"],
];

/**
 * Szín-szinonimák: ha a query-ben az egyik forma szerepel,
 * hozzáfűzzük a másikat is, így mindkét verzióra talál.
 */
const COLOR_SYNONYMS: [RegExp, string][] = [
  [/\bnavy\b/gi, "sötétkék"],
  [/\bsötétkék\b/gi, "navy"],
  [/\bbordeaux\b/gi, "bordó"],
  [/\bbordó\b/gi, "bordeaux"],
  [/\bbeige\b/gi, "bézs"],
  [/\bbézs\b/gi, "beige"],
  // Hungarian → English color synonyms (embedding cross-language support)
  [/\bszürke\b/gi, "grey gray"],
  [/\bszurke\b/gi, "grey gray szürke"],
  [/\bfehér\b/gi, "white"],
  [/\bfeher\b/gi, "white fehér"],
  [/\bfekete\b/gi, "black"],
  [/\bpiros\b/gi, "red"],
  [/\bkék\b/gi, "blue"],
  [/\bkek\b/gi, "blue kék"],
  [/\bzöld\b/gi, "green"],
  [/\bzold\b/gi, "green zöld"],
  [/\bsárga\b/gi, "yellow"],
  [/\bsarga\b/gi, "yellow sárga"],
  [/\bnarancs(sárga)?\b/gi, "orange"],
  [/\blila\b/gi, "purple violet"],
  [/\brózsaszín\b/gi, "pink"],
  [/\brozsaszin\b/gi, "pink rózsaszín"],
  [/\bbarna\b/gi, "brown"],
  [/\bbordó\b/gi, "burgundy maroon"],
  [/\btürkiz\b/gi, "turquoise teal"],
  [/\bturkiz\b/gi, "turquoise teal türkiz"],
];

/**
 * Ruházati szinonimák: ha a query tartalmazza a kulcsszót,
 * kiegészítjük rokon kifejezésekkel a jobb találat érdekében.
 */
const CLOTHING_SYNONYMS: Record<string, string[]> = {
  pulcsi: ["pulóver", "sweatshirt", "hoodie", "kötött felső", "crewneck"],
  pulóver: ["sweater", "sweatshirt", "knitwear", "hoodie", "crewneck"],
  pulover: ["pulóver", "sweater", "sweatshirt", "knitwear", "hoodie", "crewneck"],
  kapucnis: ["hoodie", "kapucnis pulóver"],
  hoodie: ["kapucnis", "pulcsi", "kapucnis felső", "crewneck"],
  póló: ["tshirt", "t-shirt", "top", "felső"],
  polo: ["póló", "tshirt", "t-shirt", "top", "felső"],
  nadrág: ["pants", "trousers", "chino"],
  nadrag: ["nadrág", "pants", "trousers", "chino"],
  farmer: ["jeans", "denim", "farmernadrág"],
  cipő: ["sneaker", "shoes", "lábbeli"],
  cipo: ["cipő", "sneaker", "shoes", "lábbeli"],
  kabát: ["jacket", "coat", "dzseki", "blézer"],
  kabat: ["kabát", "jacket", "coat", "dzseki", "blézer"],
  dzseki: ["jacket", "kabát", "bomber"],
  szoknya: ["skirt", "miniszoknya"],
  ruha: ["dress", "alkalmi ruha"],
  melegítő: ["tracksuit", "jogging", "szabadidő", "sweatpants", "tréningruha", "melegítőnadrág"],
  melegito: ["melegítő", "tracksuit", "jogging", "szabadidő", "sweatpants", "tréningruha", "melegítőnadrág"],
  táska: ["bag", "backpack", "hátizsák", "válltáska"],
  taska: ["táska", "bag", "backpack", "hátizsák", "válltáska"],
  sapka: ["hat", "cap", "beanie", "fejfedő"],
  sál: ["scarf", "nyaksál", "kendő"],
  sal: ["sál", "scarf", "nyaksál", "kendő"],
  zokni: ["socks", "bokazokni", "kompressziós zokni", "sportzokni"],
  óra: ["watch", "karóra"],
  ora: ["óra", "watch", "karóra"],
  ékszer: ["jewelry", "nyaklánc", "karkötő", "gyűrű", "fülbevaló"],
  ekszer: ["ékszer", "jewelry", "nyaklánc", "karkötő", "gyűrű", "fülbevaló"],
  parfüm: ["perfume", "illat", "eau de toilette", "kölni"],
  parfum: ["parfüm", "perfume", "illat", "eau de toilette", "kölni"],
  könyv: ["book", "regény", "olvasmány"],
  konyv: ["könyv", "book", "regény", "olvasmány"],
  játék: ["toy", "társasjáték", "game"],
  jatek: ["játék", "toy", "társasjáték", "game"],
  fürdőruha: ["swimsuit", "swimwear", "bikini", "swim", "fürdő"],
  furdoruha: ["fürdőruha", "swimsuit", "swimwear", "bikini", "swim", "fürdő"],
  sportruha: ["tracksuit", "melegítő", "tréningruha", "szabadidőruha"],
};

/**
 * normalizeHuQuery – magyar nyelvű keresési szöveg normalizálása.
 *
 * Lépések:
 *  1. Összetett színkifejezések összevonása ("sötét kék" → "sötétkék")
 *  2. Szín-szinonimák hozzáfűzése ("sötétkék" mellé "navy")
 *  3. Ruházati szinonimák bővítése ("pulcsi" mellé "pulóver sweatshirt hoodie")
 *
 * @param text - eredeti user query szöveg
 * @returns normalizált query szöveg
 */
export function normalizeHuQuery(text: string): string {
  if (!text || typeof text !== "string") return text || "";

  let result = text.trim();

  // 1. lépés: összetett színkifejezések összevonása
  for (const [pattern, replacement] of COLOR_COMPOUNDS) {
    result = result.replace(pattern, replacement);
  }

  // 2. lépés: szín-szinonimák hozzáfűzése
  // Pl. ha "navy" van benne → hozzáadjuk "sötétkék"-et a végére
  const synonymsToAppend: string[] = [];
  for (const [pattern, synonym] of COLOR_SYNONYMS) {
    if (pattern.test(result)) {
      // Reseteljük a regex lastIndex-ét (global flag miatt)
      pattern.lastIndex = 0;
      // Csak akkor adjuk hozzá, ha még nincs benne
      if (!result.toLowerCase().includes(synonym.toLowerCase())) {
        synonymsToAppend.push(synonym);
      }
    }
  }

  // 3. lépés: ruházati szinonimák bővítése
  const lowerResult = result.toLowerCase();
  for (const [keyword, expansions] of Object.entries(CLOTHING_SYNONYMS)) {
    // Unicode-aware szóhatár: \b nem kezeli az ékezetes karaktereket (ő, á, é, stb.)
    // mint betűt, ezért \p{L} lookbehind/lookahead-et használunk.
    const kwRegex = new RegExp(`(?<![\\p{L}])${escapeRegex(keyword)}(?![\\p{L}])`, "iu");
    if (kwRegex.test(lowerResult)) {
      for (const exp of expansions) {
        if (!lowerResult.includes(exp.toLowerCase())) {
          synonymsToAppend.push(exp);
        }
      }
    }
  }

  // Szinonimák hozzáfűzése a query végéhez
  if (synonymsToAppend.length > 0) {
    result = result + " " + synonymsToAppend.join(" ");
  }

  return result.trim();
}

/** Regex special karakter escape */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* =====================================================================
 * 2) VARIÁNS DUPLIKÁCIÓ SZŰRÉS (BASE PRODUCT DEDUPE)
 * =====================================================================
 * Shopify CSV importnál sok variáns keletkezik (méret, szín), ezek
 * azonos Handle-lel rendelkeznek. Cél: egy alaptermék csak egyszer
 * jelenjen meg az ajánlásokban, hacsak a user nem kér méret-specifikusat.
 * ================================================================== */

/**
 * baseId – kinyeri a termék "alap-azonosítóját" a variáns-dedupe-hoz.
 *
 * Logika:
 *  1. Ha a product_id tartalmaz "__" mintát (pl. "handle__M"),
 *     akkor base = product_id.split("__")[0]
 *  2. Ha nincs "__", de van product_url, megpróbáljuk a Handle-t
 *     kinyerni az URL path-ből (Shopify: /products/<handle>)
 *  3. Fallback: a teljes product_id (ilyenkor nem csoportosul)
 *
 * @param product - termék objektum
 * @returns base azonosító string
 */
export function baseId(product: Product): string {
  const pid = String(product.product_id || "").trim();

  // 1. "__" minta: pl. "my-shirt__M" → "my-shirt"
  if (pid.includes("__")) {
    return pid.split("__")[0];
  }

  // 1b. Trailing size suffix in product_id: "handle-XS", "handle-XXL", "handle-EU_40"
  //     Common in Shopify imports without "__" separator
  //     Also handles compound sizes: S-M, L-XL, XS_(rare), etc.
  const sizeStripped = pid.replace(/-(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|EU_?\d{2,3}|copy-EU_?\d{2,3}|[SML]-[SML]|[SMLX]{1,3}-[SMLX]{1,3}|[SMLX]{1,4}_?\([^)]*\))$/i, "");
  if (sizeStripped !== pid && sizeStripped.length > 0) {
    return sizeStripped;
  }

  // 1c. Random hex-like ID (e.g. "637fae2992d63") — group by name stripped of size suffix
  if (/^[0-9a-f]{8,}$/i.test(pid)) {
    let name = String(product.name || "").trim().toLowerCase();
    // Strip trailing size in parentheses, handles nested: "(XS (XXS Fit))", "(M)", "(EU 42)"
    name = name.replace(/\s*\((?:[^()]*|\([^()]*\))*\)\s*$/, "").trim();
    // Strip trailing size after separator: "- M", "/ L", etc.
    name = name.replace(/\s*[-–\/|]\s*(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|\d{2,3})\s*$/i, "").trim();
    if (name) return `name:${name}`;
  }

  // 2. product_url-ből Handle kinyerés (Shopify /products/<handle> minta)
  const url = String((product as any).product_url || "").trim();
  if (url) {
    try {
      const pathname = new URL(url).pathname;
      const productsMatch = pathname.match(/\/products\/([^/?#]+)/i);
      if (productsMatch && productsMatch[1]) {
        return productsMatch[1].toLowerCase();
      }
    } catch {
      // nem valid URL, skip
    }
  }

  // 3. Név-alapú heurisztika: ha a név végén méret-jelölés van
  //    pl. "Cool Shirt - M", "Cool Shirt / L"
  const name = String(product.name || "").trim();
  if (name) {
    const nameBase = name
      .replace(/\s*[-–\/|]\s*(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{2,3})\s*$/i, "")
      .trim();
    if (nameBase.length > 0 && nameBase !== name) {
      return nameBase.toLowerCase();
    }
  }

  // 4. Fallback: a product_id (nem csoportosul)
  return pid || `unnamed_${Math.random()}`;
}

/**
 * dedupeByBaseProduct – eltávolítja a variáns-duplikációkat egy terméklistából.
 *
 * Minden "alaptermék" (azonos baseId) csak maxPerBase-szor jelenhet meg.
 * Az első (legmagasabb rangú) variánst tartjuk meg.
 *
 * @param products - rangsorolt terméklista
 * @param maxPerBase - max hány variáns jelenjen meg egy alaptermékből (default: 1)
 * @returns deduplikált lista
 */
export function dedupeByBaseProduct<T extends Product>(
  products: T[],
  maxPerBase: number = 1
): T[] {
  if (!products || products.length === 0) return [];

  const counts = new Map<string, number>();
  const result: T[] = [];

  for (const product of products) {
    const base = baseId(product);
    const current = counts.get(base) || 0;

    if (current < maxPerBase) {
      counts.set(base, current + 1);
      result.push(product);
    }
  }

  // Second pass: dedupe by STRIPPED name (catches cross-format duplicates where baseId differs
  // but product is the same — e.g. "__xs-xxs-fit" variant vs hex-ID variants of same product)
  const nameCounts = new Map<string, number>();
  const finalResult: T[] = [];
  for (const product of result) {
    let name = String(product.name || "").trim().toLowerCase();
    // Strip trailing size in parentheses, handles nested: "(XS (XXS Fit))", "(M)", "(EU 42)"
    name = name.replace(/\s*\((?:[^()]*|\([^()]*\))*\)\s*$/, "").trim();
    // Strip trailing size after separator: "- M", "/ L", etc.
    name = name.replace(/\s*[-–\/|]\s*(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|\d{2,3})\s*$/i, "").trim();
    if (!name) { finalResult.push(product); continue; }
    const current = nameCounts.get(name) || 0;
    if (current < maxPerBase) {
      nameCounts.set(name, current + 1);
      finalResult.push(product);
    }
  }

  return finalResult;
}

/**
 * Ellenőrzi, hogy a user query tartalmaz-e méret-specifikus kifejezést.
 * Ha igen, a dedupe-t lazábban (vagy egyáltalán nem) alkalmazzuk.
 *
 * @param userText - user összes input (interests + free_text)
 * @returns true ha méret-specifikus kérés
 */
export function isSizeSpecificQuery(userText: string): boolean {
  if (!userText) return false;
  const lower = userText.toLowerCase();

  // Tipikus méret-minták
  const sizePatterns = [
    /\b(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl)\b/i,
    /\b\d{2,3}\s*-?\s*(es|as|os|ös|ás|és)\b/i, // pl. "42-es", "38-as"
    /\bméret\b/i,
    /\bsize\b/i,
  ];

  return sizePatterns.some((p) => p.test(lower));
}
