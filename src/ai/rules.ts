// src/ai/rules.ts
import { Product } from "../models/Product";
import { UserContext } from "../models/UserContext";

export function filterProductsByRules(
  user: UserContext,
  products: Product[]
): Product[] {
  const min =
    typeof user.budget_min === "number" && !Number.isNaN(user.budget_min)
      ? user.budget_min
      : 0;
  const max =
    typeof user.budget_max === "number" &&
    !Number.isNaN(user.budget_max) &&
    user.budget_max > 0
      ? user.budget_max
      : Infinity;

  return products.filter((p) => {
    // 1. ár-szűrés
    const price = typeof p.price === "number" ? p.price : Number(p.price);
    if (!price || Number.isNaN(price)) {
      return false;
    }
    if (price < min || price > max) {
      return false;
    }

    // 2. 18 év alatti tiltások
    if (user.age && user.age < 18) {
      const cat = (p.category || "").toLowerCase();
      if (cat === "alcohol" || cat === "erotic") {
        return false;
      }
    }

    return true;
  });
}
