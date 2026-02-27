// src/ai/price.ts

/**
 * Robusztus árparszoló: különböző formátumokat kezel.
 * Példák:
 *   "12 990" → 12990
 *   "12.990" → 12990 (magyar ezres szeparátor)
 *   "12,990" → 12990 (magyar ezres szeparátor)
 *   "12 990 Ft" → 12990
 *   "€19.99" → 19.99
 *   "19.99" → 19.99
 *   "19,99" → 19.99 (tizedesvessző)
 *   null/undefined/"" → null
 */
export function parsePrice(value: unknown): number | null {
  // null, undefined, empty
  if (value === null || value === undefined) return null;

  // Ha már szám
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  // Stringgé konvertálás
  let s = String(value).trim();
  if (!s) return null;

  // Töröljük a pénznem szimbólumokat és egyéb szöveget
  s = s.replace(/[€$£¥Ft HUF EUR USD forint]+/gi, "").trim();

  // Üres maradt?
  if (!s) return null;

  // Detektáljuk a formátumot:
  // - Ha van pont ÉS vessző: a pont az ezres szep, a vessző a tizedes (EU formátum: "1.234,56")
  // - Ha csak pont van:
  //   - Ha utána pontosan 3 számjegy van → ezres szep ("12.990")
  //   - Különben tizedes ("19.99")
  // - Ha csak vessző van:
  //   - Ha utána pontosan 3 számjegy van → ezres szep ("12,990")
  //   - Különben tizedes ("19,99")
  // - Ha szóköz van: ezres szep ("12 990")

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  const hasSpace = s.includes(" ");

  let normalized: string;

  if (hasDot && hasComma) {
    // EU formátum: "1.234,56" → pont az ezres, vessző a tizedes
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma && !hasDot) {
    // Csak vessző
    const parts = s.split(",");
    if (parts.length === 2 && parts[1].length === 3 && /^\d{3}$/.test(parts[1])) {
      // Ezres szeparátor: "12,990"
      normalized = s.replace(/,/g, "");
    } else {
      // Tizedes: "19,99"
      normalized = s.replace(",", ".");
    }
  } else if (hasDot && !hasComma) {
    // Csak pont
    const parts = s.split(".");
    if (parts.length === 2 && parts[1].length === 3 && /^\d{3}$/.test(parts[1])) {
      // Ezres szeparátor: "12.990"
      normalized = s.replace(/\./g, "");
    } else {
      // Tizedes: "19.99"
      normalized = s;
    }
  } else if (hasSpace) {
    // Szóköz mint ezres szeparátor: "12 990"
    normalized = s.replace(/\s+/g, "");
  } else {
    // Tiszta szám: "1299"
    normalized = s;
  }

  // Végső tisztítás: csak számjegyek és pont maradjon
  normalized = normalized.replace(/[^\d.]/g, "");

  const parsed = parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return parsed;
}

/**
 * Ellenőrzi, hogy egy termék ára beleesik-e a budget tartományba.
 * Ha nincs price vagy nem parse-olható: visszaadja a `defaultResult`-ot.
 */
export function isInBudget(
  price: unknown,
  budgetMin: number | null | undefined,
  budgetMax: number | null | undefined,
  tolerance = 0.15,
  defaultResult = true
): boolean {
  const p = parsePrice(price);
  if (p === null) return defaultResult;

  const min = typeof budgetMin === "number" && Number.isFinite(budgetMin) ? budgetMin : 0;
  const max =
    typeof budgetMax === "number" && Number.isFinite(budgetMax) && budgetMax > 0
      ? budgetMax
      : Infinity;

  const effectiveMin = Math.max(0, min * (1 - tolerance));
  const effectiveMax = max === Infinity ? Infinity : max * (1 + tolerance);

  return p >= effectiveMin && p <= effectiveMax;
}
