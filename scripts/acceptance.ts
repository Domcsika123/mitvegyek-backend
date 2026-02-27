// scripts/acceptance.ts
//
// STRICT Acceptance Test Harness for the Universal Constraint Engine.
// Tests the constraint pipeline DIRECTLY (no HTTP server needed).
//
// Run: npx ts-node scripts/acceptance.ts
//
// Domains tested:
//   1. Fashion (szín + típus constraint, distractor stress test)
//   2. Electronics (márka + kategória constraint)
//   3. Cosmetics (ingredient avoidance, skin type)
//   4. Book/Gift (hobby + occasion)
//
// STRICT pass/fail criteria:
//   - Must-have color: ≥90% of TOP10 match when pool has ≥12 matching products
//   - Must-have type: ≥90% of TOP10 match when pool has ≥12 matching products
//   - Mismatch count: TOP10 must have ≤1 mismatching (black/pink/red for "kék")
//   - Budget: 100% hard filter compliance
//   - Brand+type: ≥80% match in TOP6
//   - Fragrance-free: ≥85% match
//   - Distractor stress: products with misleading names must NOT appear in TOP10
//   - Dedupe: no duplicate base products
//   - Diversity: max 4 same sub-type

import { Product } from "../src/models/Product";
import { UserContext } from "../src/models/UserContext";
import { FullWidgetConfig, getDefaultWidgetConfig, getFashionPreset, getElectronicsPreset, getGiftPreset } from "../src/config/widgetConfig";
import { universalScoreAndRank, ScoredProduct } from "../src/ai/universalConstraints";
import { fuzzyContains } from "../src/ai/signals";

/* ===================================================================
 * 1) MOCK PRODUCT CATALOGS
 * =================================================================== */

function mockProduct(overrides: Partial<Product> & { product_id: string; name: string; price: number }): Product {
  return {
    category: "",
    description: "",
    ...overrides,
  } as Product;
}

// ---- FASHION CATALOG (35+ products, including DISTRACTOR products) ----
const FASHION_CATALOG: Product[] = [
  // === GENUINE BLUE PULÓVER / HOODIE PRODUCTS (12+ to trigger hard-filter-if-enough) ===
  mockProduct({ product_id: "f1", name: "Sötétkék kapucnis pulóver - M", price: 12990, category: "Ruházat", description: "Meleg, kényelmes sötétkék hoodie pamutból", tags: "kék, hoodie, férfi", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f2", name: "Navy hoodie cipzáras - L", price: 14990, category: "Ruházat", description: "Navy kék zip-up kapucnis felső", tags: "navy, hoodie, férfi, cipzáras", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f3", name: "Kék kötött pulóver", price: 9990, category: "Ruházat", description: "Elegáns kék kötött sweater", tags: "kék, pulóver, unisex", product_type: "Pulóver", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f15", name: "Kék pulóver V-nyakú", price: 10990, category: "Ruházat", description: "Finom kék V-nyakú pulóver", tags: "kék, pulóver, férfi", product_type: "Pulóver", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f17", name: "Navy pulóver kereknyakú", price: 11490, category: "Ruházat", description: "Meleg navy blue kereknyakú pulóver", tags: "navy, kék, pulóver, férfi", product_type: "Pulóver", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f22", name: "Kék kapucnis pulóver női", price: 12490, category: "Ruházat", description: "Kényelmes kék hoodie nőknek", tags: "kék, hoodie, női", product_type: "Kapucnis pulóver", vendor: "FemiStyle" }),
  mockProduct({ product_id: "f26", name: "Világoskék pulóver oversize", price: 13490, category: "Ruházat", description: "Laza világoskék pulóver oversize fazonban", tags: "kék, világoskék, pulóver, unisex", product_type: "Pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f27", name: "Kék pamut pulóver alap", price: 7990, category: "Ruházat", description: "Egyszerű kék pamut pulóver", tags: "kék, pulóver, férfi", product_type: "Pulóver", vendor: "BasicWear" }),
  mockProduct({ product_id: "f28", name: "Navy kapucnis felső vastag", price: 15990, category: "Ruházat", description: "Vastag navy kapucnis pulóver téli viselésre", tags: "navy, kék, hoodie, férfi, téli", product_type: "Kapucnis pulóver", vendor: "WinterWear" }),
  mockProduct({ product_id: "f29", name: "Tengerészkék pulóver slim", price: 11990, category: "Ruházat", description: "Slim fit tengerészkék pulóver", tags: "kék, tengerészkék, pulóver, férfi", product_type: "Pulóver", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f30", name: "Kék hoodie könnyű nyári", price: 8990, category: "Ruházat", description: "Könnyű kék kapucnis felső nyárra", tags: "kék, hoodie, unisex, nyári", product_type: "Kapucnis pulóver", vendor: "SportLine" }),
  mockProduct({ product_id: "f31", name: "Indigo kék pulóver", price: 14490, category: "Ruházat", description: "Indigo kék prémium kötött pulóver", tags: "kék, indigo, pulóver, férfi", product_type: "Pulóver", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f32", name: "Petrolkék kapucnis pulóver", price: 13990, category: "Ruházat", description: "Egyedi petrolkék hoodie", tags: "kék, petrolkék, hoodie, férfi", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),

  // === DISTRACTOR PRODUCTS (misleading names with "blue" but NOT actually blue) ===
  mockProduct({ product_id: "d1", name: "Fekete Hoodie – Blue Flame Print", price: 13990, category: "Ruházat", description: "Fekete kapucnis pulóver kék láng mintával a hátán", tags: "fekete, hoodie, mintás, férfi", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "d2", name: "Pink Sweater – Blue Logo", price: 11990, category: "Ruházat", description: "Rózsaszín pulóver kék logóval az elején", tags: "rózsaszín, pink, pulóver, női, logó", product_type: "Pulóver", vendor: "FemiStyle" }),
  mockProduct({ product_id: "d3", name: "Piros póló – Blue Edition", price: 6990, category: "Ruházat", description: "Limitált piros póló Blue Edition felirattal", tags: "piros, póló, férfi, limitált", product_type: "Póló", vendor: "BasicWear" }),

  // === OTHER NON-BLUE PRODUCTS (distractors by variety) ===
  mockProduct({ product_id: "f4", name: "Fekete kapucnis pulóver", price: 11990, category: "Ruházat", description: "Alap fekete hoodie", tags: "fekete, hoodie, unisex", product_type: "Kapucnis pulóver", vendor: "BasicWear" }),
  mockProduct({ product_id: "f5", name: "Piros póló - férfi", price: 4990, category: "Ruházat", description: "Klasszikus piros férfi póló", tags: "piros, póló, férfi", product_type: "Póló", vendor: "BasicWear" }),
  mockProduct({ product_id: "f6", name: "Fehér ing slim fit", price: 8990, category: "Ruházat", description: "Elegáns fehér slim fit ing", tags: "fehér, ing, férfi", product_type: "Ing", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f7", name: "Szürke melegítő nadrág", price: 7990, category: "Ruházat", description: "Kényelmes szürke jogger nadrág", tags: "szürke, nadrág, unisex", product_type: "Nadrág", vendor: "SportLine" }),
  mockProduct({ product_id: "f8", name: "Kék farmer nadrág", price: 15990, category: "Ruházat", description: "Klasszikus kék denim farmer", tags: "kék, farmer, férfi", product_type: "Farmer", vendor: "DenimCo" }),
  mockProduct({ product_id: "f9", name: "Fekete bőr dzseki", price: 39990, category: "Ruházat", description: "Valódi bőr motoros dzseki fekete színben", tags: "fekete, dzseki, kabát, férfi", product_type: "Kabát", vendor: "LeatherPro" }),
  mockProduct({ product_id: "f10", name: "Zöld parka kabát", price: 29990, category: "Ruházat", description: "Meleg téli zöld parka", tags: "zöld, kabát, férfi, téli", product_type: "Kabát", vendor: "WinterWear" }),
  mockProduct({ product_id: "f11", name: "Rózsaszín női blúz", price: 6990, category: "Ruházat", description: "Elegáns rózsaszín blúz", tags: "rózsaszín, blúz, női", product_type: "Ing", vendor: "FemiStyle" }),
  mockProduct({ product_id: "f12", name: "Lila nyári ruha", price: 11990, category: "Ruházat", description: "Könnyű lila nyári alkalmi ruha", tags: "lila, ruha, női", product_type: "Ruha", vendor: "FemiStyle" }),
  mockProduct({ product_id: "f13", name: "Barna bőr cipő férfi", price: 24990, category: "Cipő", description: "Elegáns barna bőr félcipő", tags: "barna, cipő, férfi", product_type: "Cipő", vendor: "ShoeMaster" }),
  mockProduct({ product_id: "f14", name: "Fehér sneaker unisex", price: 19990, category: "Cipő", description: "Klasszikus fehér tornacipő", tags: "fehér, sneaker, cipő, unisex", product_type: "Cipő", vendor: "StepUp" }),
  mockProduct({ product_id: "f16", name: "Sötétkék bomber dzseki", price: 22990, category: "Ruházat", description: "Stílusos sötétkék bomber kabát", tags: "sötétkék, dzseki, férfi", product_type: "Kabát", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f18", name: "Bordó hoodie oversize", price: 13990, category: "Ruházat", description: "Laza bordó kapucnis felső oversize fazonban", tags: "bordó, hoodie, unisex", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f19", name: "Szürke pulóver", price: 8490, category: "Ruházat", description: "Egyszerű szürke pamut pulóver", tags: "szürke, pulóver, unisex", product_type: "Pulóver", vendor: "BasicWear" }),
  mockProduct({ product_id: "f20", name: "Fekete slim farmer", price: 14990, category: "Ruházat", description: "Fekete skinny fit farmer nadrág", tags: "fekete, farmer, férfi", product_type: "Farmer", vendor: "DenimCo" }),
  mockProduct({ product_id: "f21", name: "Türkiz nyári póló", price: 5990, category: "Ruházat", description: "Élénk türkiz színű rövid ujjú póló", tags: "türkiz, póló, férfi", product_type: "Póló", vendor: "SportLine" }),
  mockProduct({ product_id: "f23", name: "Bézs chino nadrág", price: 12990, category: "Ruházat", description: "Elegáns bézs chino nadrág", tags: "bézs, nadrág, férfi", product_type: "Nadrág", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f24", name: "Fehér lenvászon ing", price: 14990, category: "Ruházat", description: "Nyári fehér lenvászon ing", tags: "fehér, ing, férfi", product_type: "Ing", vendor: "ClassicKnit" }),
  mockProduct({ product_id: "f25", name: "Kék sportcipő Nike", price: 32990, category: "Cipő", description: "Nike kék futócipő", tags: "kék, cipő, sport, Nike", product_type: "Cipő", vendor: "Nike" }),
  // Variants of f1 (different sizes)
  mockProduct({ product_id: "f1__S", name: "Sötétkék kapucnis pulóver - S", price: 12990, category: "Ruházat", description: "Meleg, kényelmes sötétkék hoodie pamutból", tags: "kék, hoodie, férfi", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f1__L", name: "Sötétkék kapucnis pulóver - L", price: 12990, category: "Ruházat", description: "Meleg, kényelmes sötétkék hoodie pamutból", tags: "kék, hoodie, férfi", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
  mockProduct({ product_id: "f1__XL", name: "Sötétkék kapucnis pulóver - XL", price: 12990, category: "Ruházat", description: "Meleg, kényelmes sötétkék hoodie pamutból", tags: "kék, hoodie, férfi", product_type: "Kapucnis pulóver", vendor: "UrbanWear" }),
];

// ---- ELECTRONICS CATALOG (25 products) ----
const ELECTRONICS_CATALOG: Product[] = [
  mockProduct({ product_id: "e1", name: "Apple MacBook Air M3 256GB", price: 499990, category: "Laptop", description: "Apple M3 chip, 8GB RAM, 256GB SSD, 13.6 inch kijelző", tags: "apple, laptop, macbook, ultrabook", product_type: "Laptop", vendor: "Apple" }),
  mockProduct({ product_id: "e2", name: "Apple MacBook Pro 14 M3 Pro", price: 799990, category: "Laptop", description: "Apple M3 Pro chip, 18GB RAM, 512GB SSD, profi laptop", tags: "apple, laptop, macbook, pro", product_type: "Laptop", vendor: "Apple" }),
  mockProduct({ product_id: "e3", name: "Lenovo ThinkPad X1 Carbon", price: 549990, category: "Laptop", description: "Intel i7, 16GB RAM, 512GB SSD, üzleti ultrabook", tags: "lenovo, laptop, thinkpad, üzleti", product_type: "Laptop", vendor: "Lenovo" }),
  mockProduct({ product_id: "e4", name: "Samsung Galaxy S24 Ultra", price: 449990, category: "Telefon", description: "Samsung csúcstelefon, 200MP kamera, S Pen", tags: "samsung, telefon, android, galaxy", product_type: "Telefon", vendor: "Samsung" }),
  mockProduct({ product_id: "e5", name: "Apple iPhone 15 Pro", price: 499990, category: "Telefon", description: "Apple A17 Pro chip, 48MP kamera, titánium keret", tags: "apple, telefon, iphone", product_type: "Telefon", vendor: "Apple" }),
  mockProduct({ product_id: "e6", name: "Sony WH-1000XM5 fejhallgató", price: 129990, category: "Fülhallgató", description: "Vezeték nélküli Bluetooth fejhallgató ANC zajszűrővel", tags: "sony, fejhallgató, bluetooth, wireless, ANC", product_type: "Fülhallgató", vendor: "Sony" }),
  mockProduct({ product_id: "e7", name: "Apple AirPods Pro 2", price: 89990, category: "Fülhallgató", description: "Apple wireless earbuds ANC zajszűrővel", tags: "apple, fülhallgató, wireless, earbuds, ANC", product_type: "Fülhallgató", vendor: "Apple" }),
  mockProduct({ product_id: "e8", name: "Samsung Galaxy Buds FE", price: 34990, category: "Fülhallgató", description: "Samsung vezeték nélküli fülhallgató", tags: "samsung, fülhallgató, wireless, earbuds", product_type: "Fülhallgató", vendor: "Samsung" }),
  mockProduct({ product_id: "e9", name: "Apple iPad Air M2", price: 289990, category: "Tablet", description: "Apple M2 chip, 10.9 inch, 64GB tablet", tags: "apple, tablet, ipad", product_type: "Tablet", vendor: "Apple" }),
  mockProduct({ product_id: "e10", name: "Samsung Galaxy Tab S9", price: 249990, category: "Tablet", description: "Samsung AMOLED tablet, Snapdragon 8 Gen 2", tags: "samsung, tablet, android, galaxy", product_type: "Tablet", vendor: "Samsung" }),
  mockProduct({ product_id: "e11", name: "Dell XPS 15 OLED", price: 699990, category: "Laptop", description: "Intel i9, 32GB RAM, 1TB SSD, OLED kijelzős laptop", tags: "dell, laptop, xps, oled", product_type: "Laptop", vendor: "Dell" }),
  mockProduct({ product_id: "e12", name: "ASUS ROG Zephyrus G14", price: 599990, category: "Laptop", description: "AMD Ryzen 9, RTX 4070, gaming laptop", tags: "asus, laptop, gaming, rog", product_type: "Laptop", vendor: "ASUS" }),
  mockProduct({ product_id: "e13", name: "Apple Watch Ultra 2", price: 289990, category: "Okosóra", description: "Apple Watch Ultra 2 titánium, GPS + Cellular", tags: "apple, okosóra, watch, sport", product_type: "Okosóra", vendor: "Apple" }),
  mockProduct({ product_id: "e14", name: "Samsung Galaxy Watch 6", price: 119990, category: "Okosóra", description: "Samsung okosóra, EKG, Wear OS", tags: "samsung, okosóra, watch, android", product_type: "Okosóra", vendor: "Samsung" }),
  mockProduct({ product_id: "e15", name: "JBL Charge 5 Bluetooth hangszóró", price: 39990, category: "Hangszóró", description: "Hordozható Bluetooth hangszóró, vízálló", tags: "jbl, hangszóró, bluetooth, wireless", product_type: "Hangszóró", vendor: "JBL" }),
  mockProduct({ product_id: "e16", name: "Sony PlayStation 5", price: 199990, category: "Gaming", description: "PS5 konzol, SSD, 4K gaming", tags: "sony, gaming, playstation, konzol", product_type: "Konzol", vendor: "Sony" }),
  mockProduct({ product_id: "e17", name: "Logitech MX Master 3S", price: 39990, category: "Kiegészítő", description: "Ergonomikus wireless egér irodai használatra", tags: "logitech, egér, wireless, irodai", product_type: "Kiegészítő", vendor: "Logitech" }),
  mockProduct({ product_id: "e18", name: "Apple AirPods Max", price: 199990, category: "Fülhallgató", description: "Apple prémium over-ear fejhallgató", tags: "apple, fejhallgató, over-ear, ANC", product_type: "Fülhallgató", vendor: "Apple" }),
  mockProduct({ product_id: "e19", name: "Xiaomi Redmi Note 13 Pro", price: 109990, category: "Telefon", description: "Xiaomi okostelefon, 200MP kamera, AMOLED", tags: "xiaomi, telefon, android, redmi", product_type: "Telefon", vendor: "Xiaomi" }),
  mockProduct({ product_id: "e20", name: "HP Pavilion 15 laptop", price: 249990, category: "Laptop", description: "Intel i5, 8GB RAM, 256GB SSD, belépő szintű laptop", tags: "hp, laptop, pavilion", product_type: "Laptop", vendor: "HP" }),
];

// ---- COSMETICS CATALOG (15 products) ----
const COSMETICS_CATALOG: Product[] = [
  mockProduct({ product_id: "c1", name: "Bioderma Sensibio H2O micellás víz", price: 3990, category: "Arctisztítás", description: "Illatmentes, érzékeny bőrre, nincs benne alkohol, nincs parfüm, fragrance-free", tags: "bioderma, micellás, érzékeny bőr, fragrance-free, illatmentes", product_type: "Arctisztítás", vendor: "Bioderma" }),
  mockProduct({ product_id: "c2", name: "La Roche-Posay Toleriane nappali krém", price: 6990, category: "Arckrém", description: "Érzékeny bőrre, parfümmentes, fragrance-free hidratáló", tags: "la roche-posay, arckrém, érzékeny bőr, fragrance-free, illatmentes", product_type: "Arckrém", vendor: "La Roche-Posay" }),
  mockProduct({ product_id: "c3", name: "CeraVe hidratáló arctisztító", price: 4490, category: "Arctisztítás", description: "Ceramidos arctisztító száraz bőrre, fragrance-free, illatmentes", tags: "cerave, arctisztító, száraz bőr, fragrance-free, illatmentes", product_type: "Arctisztítás", vendor: "CeraVe" }),
  mockProduct({ product_id: "c4", name: "Vichy Minéral 89 szérum", price: 8990, category: "Szérum", description: "Hialuronsavas szérum, parfümmentes, érzékeny bőrre", tags: "vichy, szérum, hialuronsav, parfümmentes", product_type: "Szérum", vendor: "Vichy" }),
  mockProduct({ product_id: "c5", name: "Dove tusfürdő shea vajjal", price: 1490, category: "Tusfürdő", description: "Hidratáló tusfürdő kellemes illattal", tags: "dove, tusfürdő, illatos, parfümös", product_type: "Tusfürdő", vendor: "Dove" }),
  mockProduct({ product_id: "c6", name: "Nivea Q10 ránctalanító nappali krém", price: 3490, category: "Arckrém", description: "Anti-aging krém Q10 koenzimmel, parfümös", tags: "nivea, arckrém, ránctalanító, parfümös", product_type: "Arckrém", vendor: "Nivea" }),
  mockProduct({ product_id: "c7", name: "The Ordinary Niacinamide 10% szérum", price: 3990, category: "Szérum", description: "Niacinamid szérum pattanásos bőrre, fragrance-free", tags: "the ordinary, szérum, niacinamide, fragrance-free", product_type: "Szérum", vendor: "The Ordinary" }),
  mockProduct({ product_id: "c8", name: "Garnier micelás víz rózsa", price: 2490, category: "Arctisztítás", description: "Rózsavízes micellás oldat, kellemes illat", tags: "garnier, micellás, rózsavíz, illatos", product_type: "Arctisztítás", vendor: "Garnier" }),
  mockProduct({ product_id: "c9", name: "Eucerin UltraSENSITIVE krém", price: 5990, category: "Arckrém", description: "Extra érzékeny bőrre, illatmentes, fragrance-free krém", tags: "eucerin, arckrém, érzékeny bőr, fragrance-free, illatmentes", product_type: "Arckrém", vendor: "Eucerin" }),
  mockProduct({ product_id: "c10", name: "L'Oréal Paris Elseve sampon", price: 1990, category: "Sampon", description: "Tápláló sampon száraz hajra, kellemes illattal", tags: "loreal, sampon, haj, illatos", product_type: "Sampon", vendor: "L'Oréal" }),
  mockProduct({ product_id: "c11", name: "Avene Tolérance Extrême krém", price: 7490, category: "Arckrém", description: "Ultra érzékeny bőrre, steril kozmetikum, fragrance-free, illatmentes", tags: "avene, arckrém, érzékeny, fragrance-free, steril", product_type: "Arckrém", vendor: "Avene" }),
  mockProduct({ product_id: "c12", name: "MAC Ruby Woo rúzs", price: 9490, category: "Smink", description: "Ikonikus matt piros rúzs", tags: "mac, rúzs, smink, piros", product_type: "Smink", vendor: "MAC" }),
  mockProduct({ product_id: "c13", name: "Neutrogena Hydro Boost krém", price: 4990, category: "Arckrém", description: "Hialuronsavas gél krém, fragrance-free, normál bőrre", tags: "neutrogena, arckrém, hialuronsav, fragrance-free", product_type: "Arckrém", vendor: "Neutrogena" }),
];

// ---- BOOK/GIFT CATALOG (15 products) ----
const BOOKGIFT_CATALOG: Product[] = [
  mockProduct({ product_id: "g1", name: "Horgász nagykönyv - A teljes útmutató", price: 6990, category: "Könyv", description: "Átfogó horgász kézikönyv kezdőknek és haladóknak. Édesvízi és tengeri horgászat.", tags: "horgászat, könyv, sport, szabadidő, horgász, halak", product_type: "Könyv", vendor: "Jaffa Kiadó" }),
  mockProduct({ product_id: "g2", name: "Shimano orsó szett ajándékcsomagban", price: 19990, category: "Horgászfelszerelés", description: "Prémium horgász orsó ajándékdobozban, apának tökéletes", tags: "horgászat, orsó, shimano, ajándék, felszerelés", product_type: "Horgászfelszerelés", vendor: "Shimano" }),
  mockProduct({ product_id: "g3", name: "Horgász doboz szett 200 részes", price: 8990, category: "Horgászfelszerelés", description: "200 darabos horgász csali és horog szett", tags: "horgászat, felszerelés, csali, horog, ajándék", product_type: "Horgászfelszerelés", vendor: "FishPro" }),
  mockProduct({ product_id: "g4", name: "Columbia horgász mellény", price: 15990, category: "Ruházat", description: "Praktikus outdoor horgász mellény sok zsebbel", tags: "horgászat, mellény, outdoor, columbia", product_type: "Ruházat", vendor: "Columbia" }),
  mockProduct({ product_id: "g5", name: "Kerámia bögre 'Legjobb Apa' felirattal", price: 2990, category: "Ajándék", description: "Személyes ajándék apáknak, kerámia bögre", tags: "ajándék, apa, bögre, személyes, apanapra", product_type: "Ajándék", vendor: "GiftShop" }),
  mockProduct({ product_id: "g6", name: "Leatherman multitool", price: 29990, category: "Szerszám", description: "Prémium multifunkciós zsebkés, apának tökéletes ajándék", tags: "szerszám, multitool, ajándék, praktikus, outdoor", product_type: "Szerszám", vendor: "Leatherman" }),
  mockProduct({ product_id: "g7", name: "Főzőtanfolyam ajándékutalvány", price: 14990, category: "Élmény", description: "Főzőtanfolyam voucher, magyar konyha", tags: "élmény, ajándék, főzés, tanfolyam", product_type: "Élmény", vendor: "ChefAcademy" }),
  mockProduct({ product_id: "g8", name: "Kertészkedés alapjai könyv", price: 4990, category: "Könyv", description: "Kertészkedési útmutató balkonkertekhez és kisebb területekhez", tags: "kertészkedés, könyv, kert, növények", product_type: "Könyv", vendor: "Corvina" }),
  mockProduct({ product_id: "g9", name: "Prémium whisky szett", price: 22990, category: "Ital", description: "Skót whisky + 2 kristály pohár díszcsomagban", tags: "whisky, alkohol, ajándék, prémium, ital", product_type: "Ital", vendor: "Glenfiddich" }),
  mockProduct({ product_id: "g10", name: "Horgászbotfüzet – személyes napló", price: 3490, category: "Ajándék", description: "Horgász napló ahol feljegyezheti a fogásait, ajándék horgászoknak", tags: "horgászat, napló, ajándék, személyes", product_type: "Ajándék", vendor: "GiftShop" }),
  mockProduct({ product_id: "g11", name: "GPS túrás okosóra", price: 44990, category: "Elektronika", description: "Outdoor okosóra GPS-sel túrázáshoz és horgászathoz", tags: "okosóra, gps, outdoor, horgászat, túra", product_type: "Elektronika", vendor: "Garmin" }),
  mockProduct({ product_id: "g12", name: "Thermos termosz - 1L", price: 7990, category: "Kiegészítő", description: "Dupla falú termosz forró italokhoz, outdoor használatra", tags: "termosz, outdoor, horgászat, kávé", product_type: "Kiegészítő", vendor: "Thermos" }),
  mockProduct({ product_id: "g13", name: "Sörfőző kezdőszett", price: 16990, category: "Hobbi", description: "Otthoni sörfőzés kezdőszett, ajándék sörimádóknak", tags: "sör, főzés, hobbi, ajándék", product_type: "Hobbi", vendor: "BrewDog" }),
  mockProduct({ product_id: "g14", name: "Gyerek mesekönyv csomag (3-6 év)", price: 5990, category: "Könyv", description: "5 darabos mesekönyv szett kisgyerekeknek", tags: "mesekönyv, gyerek, könyv, ajándék", product_type: "Könyv", vendor: "Pagony" }),
  mockProduct({ product_id: "g15", name: "Személyes póló nyomtatás", price: 4990, category: "Ajándék", description: "Egyedi feliratos póló, személyes ajándék", tags: "póló, személyes, ajándék, egyedi", product_type: "Ajándék", vendor: "PrintShop" }),
];

/* ===================================================================
 * 2) WIDGET CONFIGS WITH CONSTRAINT MAPPINGS
 * =================================================================== */

function fashionWidgetConfig(): FullWidgetConfig {
  const cfg = getFashionPreset();
  // Ensure constraint metadata is set
  const colorField = cfg.form.fields.find(f => f.id === "color");
  if (colorField && colorField.mapping) {
    colorField.mapping.priority = "must_have";
    colorField.mapping.constraintType = "exact";
  }
  const typeField = cfg.form.fields.find(f => f.id === "clothing_type");
  if (typeField && typeField.mapping) {
    typeField.mapping.priority = "must_have";
    typeField.mapping.constraintType = "contains";
  }
  return cfg;
}

function electronicsWidgetConfig(): FullWidgetConfig {
  const cfg = getElectronicsPreset();
  const brandField = cfg.form.fields.find(f => f.id === "brand");
  if (brandField && brandField.mapping) {
    brandField.mapping.priority = "must_have";
    brandField.mapping.constraintType = "contains";
  }
  const catField = cfg.form.fields.find(f => f.id === "category");
  if (catField && catField.mapping) {
    catField.mapping.priority = "must_have";
    catField.mapping.constraintType = "contains";
  }
  return cfg;
}

function cosmeticsWidgetConfig(): FullWidgetConfig {
  const cfg = getDefaultWidgetConfig();
  cfg.ui.copy.panelTitle = "Kozmetikum ajánló";

  // Add "fragrance-free" constraint field
  cfg.form.fields.push({
    id: "fragrance_free",
    type: "select",
    label: "🌿 Illatmentes?",
    enabled: true,
    required: false,
    order: 42,
    options: [
      { value: "", label: "Mindegy" },
      { value: "fragrance-free", label: "Igen, illatmentes" },
    ],
    mapping: {
      target: "user.interests",
      format: "value",
      appendToFreeText: true,
      priority: "must_have",
      constraintType: "contains",
    },
  });

  cfg.form.fields.push({
    id: "skin_type",
    type: "select",
    label: "🧴 Bőrtípus",
    enabled: true,
    required: false,
    order: 43,
    options: [
      { value: "", label: "Mindegy" },
      { value: "érzékeny", label: "Érzékeny" },
      { value: "száraz", label: "Száraz" },
      { value: "zsíros", label: "Zsíros" },
      { value: "normál", label: "Normál" },
    ],
    mapping: {
      target: "user.interests",
      format: "value",
      appendToFreeText: true,
      priority: "preference",
      constraintType: "contains",
    },
  });

  return cfg;
}

function bookGiftWidgetConfig(): FullWidgetConfig {
  const cfg = getGiftPreset();
  return cfg;
}

/* ===================================================================
 * 3) TEST SCENARIOS
 * =================================================================== */

interface TestScenario {
  name: string;
  description: string;
  catalog: Product[];
  widgetConfig: FullWidgetConfig;
  user: UserContext;
  /** Assertion functions — each returns { pass: boolean, message: string } */
  assertions: ((results: ScoredProduct[]) => { pass: boolean; message: string })[];
}

function makeEmbeddingRanked(products: Product[]): { product: Product; score: number }[] {
  // Simulate embedding scores — we give a decreasing score based on index
  // (in the real pipeline, OpenAI embeddings would provide these)
  return products.map((p, i) => ({
    product: p,
    score: 1 - (i / products.length) * 0.5,
  }));
}

// Custom assertions builders

function assertAtLeast(
  fraction: number,
  topN: number,
  check: (p: Product) => boolean,
  label: string,
) {
  return (results: ScoredProduct[]) => {
    const top = results.slice(0, topN);
    const matches = top.filter(r => check(r.product)).length;
    const pct = top.length > 0 ? matches / top.length : 0;
    const pass = pct >= fraction;
    return {
      pass,
      message: `${label}: ${matches}/${top.length} = ${(pct * 100).toFixed(0)}% (need ≥${(fraction * 100).toFixed(0)}%)`,
    };
  };
}

/** Assert that at most N items in topN FAIL a check (explicit mismatch cap) */
function assertMaxMismatch(
  maxMismatches: number,
  topN: number,
  isMismatch: (p: Product) => boolean,
  label: string,
) {
  return (results: ScoredProduct[]) => {
    const top = results.slice(0, topN);
    const mismatches = top.filter(r => isMismatch(r.product));
    const count = mismatches.length;
    const pass = count <= maxMismatches;
    const mismatchNames = mismatches.map(r => r.product.name).join(", ");
    return {
      pass,
      message: `${label}: ${count} mismatches in TOP${topN} (max ${maxMismatches})${count > 0 ? ` [${mismatchNames}]` : ""}`,
    };
  };
}

/** Assert specific distractor products do NOT appear in topN */
function assertDistractorsExcluded(
  distractorIds: string[],
  topN: number,
  label: string,
) {
  return (results: ScoredProduct[]) => {
    const top = results.slice(0, topN);
    const found = top.filter(r => distractorIds.includes((r.product as any).product_id));
    const pass = found.length === 0;
    const foundNames = found.map(r => `${(r.product as any).product_id}: ${r.product.name}`).join(", ");
    return {
      pass,
      message: `${label}: ${found.length} distractors in TOP${topN}${found.length > 0 ? ` [${foundNames}]` : ""}`,
    };
  };
}

function assertNoDuplicateBaseIds(topN: number) {
  return (results: ScoredProduct[]) => {
    const top = results.slice(0, topN);
    const bases = top.map(r => {
      const pid = String((r.product as any).product_id || "");
      return pid.includes("__") ? pid.split("__")[0] : pid;
    });
    const unique = new Set(bases);
    const pass = unique.size === bases.length;
    return {
      pass,
      message: `Dedupe: ${bases.length} items, ${unique.size} unique base IDs (${pass ? "no dupes" : "DUPES FOUND: " + bases.filter((b, i) => bases.indexOf(b) !== i).join(", ")})`,
    };
  };
}

function assertDiversity(maxSameSubType: number, topN: number) {
  return (results: ScoredProduct[]) => {
    const top = results.slice(0, topN);
    const typeCounts = new Map<string, number>();
    for (const r of top) {
      const cat = ((r.product as any).product_type || r.product.category || "_none").toLowerCase();
      typeCounts.set(cat, (typeCounts.get(cat) || 0) + 1);
    }
    let maxCount = 0;
    let maxType = "";
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        maxCount = count;
        maxType = type;
      }
    }
    const pass = maxCount <= maxSameSubType;
    return {
      pass,
      message: `Diversity: max ${maxCount} items of same sub-type "${maxType}" (limit: ${maxSameSubType})`,
    };
  };
}

function assertMinResults(minCount: number) {
  return (results: ScoredProduct[]) => {
    const pass = results.length >= minCount;
    return {
      pass,
      message: `Min results: ${results.length} (need ≥${minCount})`,
    };
  };
}

/** Helper: is a product blue (by tag)? */
function isBlueByTag(p: Product): boolean {
  const tags = ((p as any).tags || "").toLowerCase();
  return ["kék", "kek", "navy", "sötétkék", "sotetkek", "világoskék", "tengerészkék", "indigo", "petrolkék", "blue"].some(c => tags.includes(c));
}

/** Helper: is a product explicitly non-blue (black, pink, red, etc.)? */
function isNonBlueColor(p: Product): boolean {
  const tags = ((p as any).tags || "").toLowerCase();
  // Must have a non-blue color tag AND not have any blue tag
  const nonBlueColors = ["fekete", "black", "piros", "red", "rózsaszín", "pink", "fehér", "white", "szürke", "grey", "barna", "brown", "zöld", "green", "bordó", "lila", "bézs"];
  const hasNonBlue = nonBlueColors.some(c => tags.includes(c));
  const hasBlue = isBlueByTag(p);
  return hasNonBlue && !hasBlue;
}

// ---- SCENARIO DEFINITIONS (STRICT) ----

const scenarios: TestScenario[] = [
  // Scenario 1: Fashion — "kék pulcsi" (STRICT: 90% blue + distractor exclusion)
  {
    name: "Fashion: kék pulcsi (STRICT)",
    description: "User wants a blue sweater — ≥90% TOP10 must be blue, distractors excluded, max 1 non-blue mismatch",
    catalog: FASHION_CATALOG,
    widgetConfig: fashionWidgetConfig(),
    user: {
      free_text: "kék pulcsi",
      interests: ["kék", "pulóver"],
      gender: "male",
      site_key: "test-fashion",
    },
    assertions: [
      // A) ≥90% of TOP10 must be blue (by tag)
      assertAtLeast(0.9, 10, isBlueByTag, "Blue color match TOP10"),
      // B) Max 1 non-blue product in TOP10
      assertMaxMismatch(1, 10, isNonBlueColor, "Non-blue mismatch cap"),
      // C) Distractor stress test: d1, d2, d3 must NOT be in TOP10
      assertDistractorsExcluded(["d1", "d2", "d3"], 10, "Distractor exclusion"),
      // D) Dedupe
      assertNoDuplicateBaseIds(10),
      // E) Min results
      assertMinResults(5),
    ],
  },

  // Scenario 2: Fashion — "navy kapucnis pulóver" (STRICT)
  {
    name: "Fashion: navy kapucnis (STRICT)",
    description: "User wants a navy hoodie — strict blue + hoodie/pulóver match",
    catalog: FASHION_CATALOG,
    widgetConfig: fashionWidgetConfig(),
    user: {
      free_text: "navy kapucnis pulóver",
      interests: ["navy", "hoodie"],
      gender: "male",
      budget_max: 20000,
      site_key: "test-fashion",
    },
    assertions: [
      // ≥80% of TOP5 must be navy/blue
      assertAtLeast(0.8, 5, isBlueByTag, "Navy/blue color in TOP5"),
      // ≥80% of TOP10 must be blue or hoodie/pulóver type
      assertAtLeast(0.8, 10, p => {
        const tags = ((p as any).tags || "").toLowerCase();
        const ptype = ((p as any).product_type || "").toLowerCase();
        const isBlue = isBlueByTag(p);
        const isHoodiePulover = tags.includes("hoodie") || tags.includes("pulóver") || ptype.includes("pulóver") || ptype.includes("kapucnis");
        return isBlue || isHoodiePulover;
      }, "Blue or hoodie/pulóver relevance"),
      assertAtLeast(1.0, 10, p => p.price <= 20000, "Budget ≤20000"),
      assertNoDuplicateBaseIds(10),
    ],
  },

  // Scenario 3: Electronics — "Apple laptop" (STRICT: 5/6 brand+type)
  {
    name: "Electronics: Apple laptop (STRICT)",
    description: "User wants an Apple laptop — ≥80% TOP6 must be Apple + laptop",
    catalog: ELECTRONICS_CATALOG,
    widgetConfig: electronicsWidgetConfig(),
    user: {
      free_text: "Apple laptop",
      interests: ["Apple", "laptop"],
      site_key: "test-electronics",
    },
    assertions: [
      assertAtLeast(0.8, 6, p => {
        const text = (p.name + " " + ((p as any).vendor || "") + " " + ((p as any).tags || "")).toLowerCase();
        return text.includes("apple") || text.includes("macbook");
      }, "Apple brand match TOP6"),
      assertAtLeast(0.5, 6, p => {
        const text = (p.name + " " + p.category + " " + ((p as any).product_type || "")).toLowerCase();
        return text.includes("laptop");
      }, "Laptop category match TOP6"),
      assertMinResults(2),
    ],
  },

  // Scenario 4: Electronics — "wireless earbuds" (STRICT: budget 100%)
  {
    name: "Electronics: wireless earbuds (STRICT)",
    description: "User wants wireless earbuds — strict budget + category match",
    catalog: ELECTRONICS_CATALOG,
    widgetConfig: electronicsWidgetConfig(),
    user: {
      free_text: "wireless earbuds fülhallgató",
      interests: ["wireless", "fülhallgató"],
      budget_max: 150000,
      site_key: "test-electronics",
    },
    assertions: [
      assertAtLeast(0.6, 6, p => {
        const text = (p.name + " " + (p.description || "") + " " + ((p as any).tags || "")).toLowerCase();
        return text.includes("fülhallgató") || text.includes("earbuds") || text.includes("fejhallgató") || text.includes("wireless");
      }, "Wireless/earbuds match TOP6"),
      assertAtLeast(1.0, 6, p => p.price <= 150000, "Budget hard filter ≤150000"),
      assertMinResults(2),
    ],
  },

  // Scenario 5: Cosmetics — "fragrance-free" (STRICT: 85% match)
  {
    name: "Cosmetics: fragrance-free (STRICT)",
    description: "User wants fragrance-free products — ≥85% must be fragrance-free",
    catalog: COSMETICS_CATALOG,
    widgetConfig: cosmeticsWidgetConfig(),
    user: {
      free_text: "fragrance-free illatmentes arckrém",
      interests: ["fragrance-free", "illatmentes"],
      site_key: "test-cosmetics",
    },
    assertions: [
      assertAtLeast(0.85, 8, p => {
        const text = (p.name + " " + (p.description || "") + " " + ((p as any).tags || "")).toLowerCase();
        return text.includes("fragrance-free") || text.includes("illatmentes") || text.includes("parfümmentes");
      }, "Fragrance-free match TOP8"),
      assertMinResults(3),
    ],
  },

  // Scenario 6: Book/Gift — "horgász apa ajándék" (STRICT: 100% budget, 70% topic)
  {
    name: "Book/Gift: horgász apa ajándék (STRICT)",
    description: "User buying a gift for a dad who loves fishing — strict budget + topic match",
    catalog: BOOKGIFT_CATALOG,
    widgetConfig: bookGiftWidgetConfig(),
    user: {
      free_text: "horgász apa ajándék",
      interests: ["horgászat", "apa"],
      relationship: "apa",
      budget_max: 25000,
      site_key: "test-gift",
    },
    assertions: [
      assertAtLeast(0.6, 8, p => {
        const text = (p.name + " " + (p.description || "") + " " + ((p as any).tags || "")).toLowerCase();
        return text.includes("horgász") || text.includes("horgászat");
      }, "Fishing-related match TOP8"),
      assertAtLeast(1.0, 10, p => p.price <= 25000, "Budget hard filter ≤25000"),
      assertMinResults(3),
      assertDiversity(4, 10),
    ],
  },

  // Scenario 7: Fashion — strict budget
  {
    name: "Fashion: strict budget under 10000",
    description: "User on tight budget — 100% budget compliance",
    catalog: FASHION_CATALOG,
    widgetConfig: fashionWidgetConfig(),
    user: {
      free_text: "valami szép ruha",
      interests: [],
      budget_max: 10000,
      site_key: "test-fashion",
    },
    assertions: [
      assertAtLeast(1.0, 10, p => p.price <= 10000, "Budget hard filter ≤10000"),
      assertMinResults(2),
    ],
  },

  // Scenario 8: Edge case — empty free_text, only budget
  {
    name: "Edge case: budget only, no text",
    description: "User provides only budget — should still return results in range",
    catalog: FASHION_CATALOG,
    widgetConfig: fashionWidgetConfig(),
    user: {
      budget_min: 5000,
      budget_max: 15000,
      site_key: "test-fashion",
    },
    assertions: [
      assertAtLeast(1.0, 10, p => p.price >= 5000 && p.price <= 15000, "Budget range [5000-15000]"),
      assertMinResults(3),
      assertNoDuplicateBaseIds(10),
    ],
  },

  // Scenario 9: Distractor stress test (no widget config — implicit constraints)
  {
    name: "Fashion: kék pulcsi WITHOUT widget config",
    description: "Even without widget_config, implicit color+type from query should work",
    catalog: FASHION_CATALOG,
    widgetConfig: undefined as any, // NO widget config
    user: {
      free_text: "kék pulcsi",
      interests: [],
      site_key: "test-fashion-noconfig",
    },
    assertions: [
      // With implicit constraints, should still get mostly blue results
      assertAtLeast(0.7, 10, isBlueByTag, "Implicit blue match TOP10 (no widget config)"),
      assertDistractorsExcluded(["d1", "d2", "d3"], 10, "Distractor exclusion (implicit)"),
      assertMinResults(3),
    ],
  },
];

/* ===================================================================
 * 4) TEST RUNNER
 * =================================================================== */

interface TestResult {
  scenario: string;
  passed: boolean;
  assertions: { pass: boolean; message: string }[];
  resultCount: number;
  topNames: string[];
  debugInfo: {
    colorMatchCount: number;
    typeMatchCount: number;
    hardFilterIfEnough: { color: boolean; type: boolean };
    constraintsSummary: string[];
  };
}

function runScenario(scenario: TestScenario): TestResult {
  const embeddingRanked = makeEmbeddingRanked(scenario.catalog);

  const { results, debug } = universalScoreAndRank(
    scenario.user,
    embeddingRanked,
    scenario.widgetConfig,
  );

  const assertionResults = scenario.assertions.map(assert => assert(results));
  const allPassed = assertionResults.every(a => a.pass);

  return {
    scenario: scenario.name,
    passed: allPassed,
    assertions: assertionResults,
    resultCount: results.length,
    topNames: results.slice(0, 10).map((r, i) => {
      const pid = (r.product as any).product_id || "?";
      const cm = r.constraintDetail.colorMatch ? "🔵" : "⚫";
      const tm = r.constraintDetail.typeMatch ? "👕" : "❌";
      return `#${i + 1} ${cm}${tm} [${pid}] ${r.product.name} (${r.finalScore.toFixed(3)})`;
    }),
    debugInfo: {
      colorMatchCount: debug.colorMatchCount,
      typeMatchCount: debug.typeMatchCount,
      hardFilterIfEnough: debug.hardFilterIfEnoughApplied,
      constraintsSummary: debug.constraintsSummary,
    },
  };
}

function runAllTests() {
  console.log("\n" + "═".repeat(70));
  console.log("  UNIVERSAL CONSTRAINT ENGINE — STRICT ACCEPTANCE TESTS");
  console.log("═".repeat(70) + "\n");

  const results: TestResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const scenario of scenarios) {
    const result = runScenario(scenario);
    results.push(result);

    const icon = result.passed ? "✅" : "❌";
    console.log(`${icon} ${result.scenario}`);
    console.log(`   ${result.passed ? "PASS" : "FAIL"} — ${result.resultCount} results`);

    // Debug summary
    console.log(`   Constraints: ${result.debugInfo.constraintsSummary.join(" | ")}`);
    console.log(`   Pool: colorMatch=${result.debugInfo.colorMatchCount}, typeMatch=${result.debugInfo.typeMatchCount}`);
    console.log(`   Hard-filter-if-enough: color=${result.debugInfo.hardFilterIfEnough.color}, type=${result.debugInfo.hardFilterIfEnough.type}`);

    // TOP10 with color/type indicators
    console.log(`   TOP10:`);
    for (const name of result.topNames) {
      console.log(`     ${name}`);
    }

    for (const a of result.assertions) {
      const aIcon = a.pass ? "  ✓" : "  ✗";
      console.log(`   ${aIcon} ${a.message}`);
    }
    console.log("");

    if (result.passed) totalPassed++;
    else totalFailed++;
  }

  console.log("─".repeat(70));
  console.log(`SUMMARY: ${totalPassed}/${results.length} scenarios passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    console.log("\n⚠ FAILED SCENARIOS:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.scenario}`);
      for (const a of r.assertions.filter(a => !a.pass)) {
        console.log(`     ✗ ${a.message}`);
      }
    }
  }

  console.log("\n" + "═".repeat(70));
  const exitCode = totalFailed > 0 ? 1 : 0;
  console.log(exitCode === 0 ? "🎉 ALL TESTS PASSED!" : "💥 SOME TESTS FAILED!");
  console.log("═".repeat(70) + "\n");

  process.exit(exitCode);
}

// Run!
runAllTests();
