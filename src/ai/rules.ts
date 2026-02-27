// src/ai/rules.ts
import { Product } from "../models/Product";
import { UserContext } from "../models/UserContext";
import { parsePrice, isInBudget } from "./price";

/**
 * Intelligens termékszűrés: budget, korcsoport, elérhetetlenség, minőség.
 * A szűrés ELŐTT fut, így a rerank és scoring csak releváns termékeket kap.
 * 
 * ✅ JAVÍTVA: Ha nincs ár vagy nem parse-olható, NEM dobjuk ki automatikusan!
 * Csak akkor szűrünk árra, ha a user ténylegesen adott budget-et.
 */
export function filterProductsByRules(
  user: UserContext,
  products: Product[]
): Product[] {
  // Check if user actually specified budget
  const hasBudgetMin = typeof user.budget_min === "number" && Number.isFinite(user.budget_min) && user.budget_min > 0;
  const hasBudgetMax = typeof user.budget_max === "number" && Number.isFinite(user.budget_max) && user.budget_max > 0;
  const hasBudget = hasBudgetMin || hasBudgetMax;

  return products.filter((p) => {
    // 1. Ár validáció - csak ha user adott budget-et
    if (hasBudget) {
      const price = parsePrice(p.price);
      
      // Ha van budget ÉS az ár parse-olható: budget szűrés (15% toleranciával)
      if (price !== null) {
        if (!isInBudget(price, user.budget_min, user.budget_max, 0.15)) {
          return false;
        }
      }
      // Ha nincs ár de van budget: NE dobjuk ki, mert lehet érdekes termék
      // (soft penalty majd a scoring-ban)
    }

    // 2. 18 év alatti tiltások
    if (user.age && user.age < 18) {
      const cat = (p.category || "").toLowerCase();
      const tags = ((p as any).tags || "").toLowerCase();
      const name = (p.name || "").toLowerCase();
      const combined = `${cat} ${tags} ${name}`;

      const restricted = ["alcohol", "erotic", "18+", "adult", "alkohol", "erotik", "felnőtt"].some(
        (keyword) => combined.includes(keyword)
      );
      if (restricted) return false;
    }

    // 3. Elérhetetlen / üres termékek kizárása
    const name = (p.name || "").trim();
    if (!name || name.length < 2) return false;

    return true;
  });
}

/**
 * Lazább szűrés: csak budget szűrést alkalmaz.
 * Fallback ha a teljes filterProductsByRules 0 eredményt ad.
 */
export function filterProductsByBudgetOnly(
  user: UserContext,
  products: Product[]
): Product[] {
  const hasBudgetMin = typeof user.budget_min === "number" && Number.isFinite(user.budget_min) && user.budget_min > 0;
  const hasBudgetMax = typeof user.budget_max === "number" && Number.isFinite(user.budget_max) && user.budget_max > 0;
  
  if (!hasBudgetMin && !hasBudgetMax) {
    // No budget constraint: return all
    return products;
  }

  return products.filter((p) => {
    const price = parsePrice(p.price);
    // Ha nincs ár: beengedjük
    if (price === null) return true;
    // Budget check with 25% tolerance (more lenient)
    return isInBudget(price, user.budget_min, user.budget_max, 0.25);
  });
}

/**
 * Legkevésbé szigorú: csak a nyilvánvalóan rossz termékeket szűri ki.
 */
export function filterProductsMinimal(products: Product[]): Product[] {
  return products.filter((p) => {
    const name = (p.name || "").trim();
    return name.length >= 2;
  });
}

/**
 * Nem-specifikus szűrés: ha a user kért nemet, a nyilvánvalóan
 * ellentétes nemű termékeket hátra rangsorolja (de nem zárja ki teljesen).
 * Ez nem hard-filter, hanem soft penalty a scoring-hoz.
 */
export function genderPenalty(user: UserContext, product: Product): number {
  if (!user.gender || user.gender === "unknown" || user.gender === "other") return 0;

  const productText = [
    product.name || "",
    product.category || "",
    (product as any).tags || "",
    (product as any).product_type || "",
  ].join(" ").toLowerCase();

  const isFemaleProduct = /\b(női|noi|women|woman|hölgy|lány)\b/i.test(productText);
  const isMaleProduct = /\b(férfi|ferfi|men(?!u)\b|man\b|fiú|fiu)\b/i.test(productText)
    && !/women/i.test(productText);

  if (user.gender === "male" && isFemaleProduct) return -0.15;
  if (user.gender === "female" && isMaleProduct) return -0.15;

  // Ha match: enyhe pozitív
  if (user.gender === "male" && isMaleProduct) return 0.05;
  if (user.gender === "female" && isFemaleProduct) return 0.05;

  return 0;
}
