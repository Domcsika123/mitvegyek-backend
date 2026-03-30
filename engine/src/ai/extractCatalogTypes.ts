// src/ai/extractCatalogTypes.ts
// Import-time: kinyeri a katalógus egyedi terméktípusait és magyar feliratokkal
// visszaadja a widget típus-select mezőhöz használható options tömböt.

import OpenAI from "openai";
import { Product } from "../models/Product";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface TypeOption {
  value: string;
  label: string;
}

/**
 * Összegyűjti az egyedi nyers típusokat a katalógusból.
 * Forrás: product_type mező, vagy a category utolsó szegmense.
 */
// Name-based type overrides: detect specific types from product name
// when product_type/category is too generic (e.g. all zip-ups are "Hoodies")
const NAME_BASED_TYPES: { pattern: RegExp; syntheticType: string }[] = [
  { pattern: /\bzip\s*up\b|\bzipup\b/i, syntheticType: "Zip up" },
  { pattern: /\bphone case\b|\biphone case\b/i, syntheticType: "Phone Case" },
];

function collectRawTypes(products: Product[]): string[] {
  const seen = new Set<string>();
  for (const p of products) {
    // Check name-based overrides first
    const name = p.name || "";
    for (const { pattern, syntheticType } of NAME_BASED_TYPES) {
      if (pattern.test(name)) {
        seen.add(syntheticType);
        break; // only one override per product
      }
    }

    const pt = (p as any).product_type;
    if (pt && typeof pt === "string" && pt.trim()) {
      seen.add(pt.trim());
      continue;
    }
    if (p.category) {
      const last = p.category.includes(">")
        ? p.category.split(">").pop()!.trim()
        : p.category.trim();
      if (last) seen.add(last);
    }
  }
  return Array.from(seen).slice(0, 120); // max 120 raw type
}

/**
 * LLM-mel generál tiszta magyar feliratú dropdown opciókat.
 * Max 20 típust ad vissza, deduplikálva és fontosság szerint rendezve.
 */
export async function extractCatalogTypes(products: Product[]): Promise<TypeOption[]> {
  const rawTypes = collectRawTypes(products);
  if (rawTypes.length === 0) return [];

  const prompt = `You have a list of product types from a webshop catalog.
Generate a clean, deduplicated Hungarian dropdown list for a product search widget.

Rules:
- Translate to Hungarian where natural (T-Shirt → Póló, Hoodie → Kapucnis pulóver, Zip up/Zip hoodie/Zipup → Zip up, Sweatshirt → Melegítő felső, Pants → Nadrág, Shorts → Rövidnadrág, Hat/Cap → Sapka, Jacket → Dzseki/Kabát, Dress → Ruha, Shoes/Sneakers → Cipő, Bag → Táska, Socks → Zokni, Jeans → Farmer, Skirt → Szoknya, Swimwear → Fürdőruha, Accessories → Kiegészítő, Phone Case/iPhone Case/Mobile Phone Cases → Telefontok, Boxer Shorts/Men's Underwear/Underwear/Lingerie → Fehérnemű)
- IMPORTANT: "Phone Case", "Mobile Phone Cases", "iPhone Case" MUST become "Telefontok" — do NOT merge into Kiegészítő
- IMPORTANT: "Boxer Shorts", "Men's Underwear", "Lingerie", "Bodysuits" (when underwear context) MUST become "Fehérnemű" — do NOT keep as "Boxer rövidnadrág" or separate
- IMPORTANT: ALL bag/backpack subtypes MUST become "Táska": Backpack, Tote Bag, Tote, Crossbody Bag, Shoulder Bag, Duffel Bag, Clutch, Satchel, Fanny Pack, Bum Bag, Mini Bag, Gym Bag → all become "Táska"
- IMPORTANT: ALL accessory subtypes MUST become "Kiegészítő": Necklace, Necklaces, Chain, Scarf, Scarves, Belt, Belts, Keychain, Gloves, Wallet, Watch, Sunglasses, Hair Accessory, Lanyard, Bracelet, Earring, Jewelry, Ring → all become "Kiegészítő" (unless they clearly map to Ékszer: Ring/Gyűrű, Bracelet/Karkötő, Earring/Fülbevaló only)
- Keep well-known English fashion terms as-is if commonly used in HU (Hoodie, Bomber, Crop top, Tank top)
- Max 20 items — merge similar/duplicate types
- Sort by importance/frequency
- Only include types actually present in the input

Input types: ${JSON.stringify(rawTypes)}

Output JSON only:
{"types": [{"value": "Magyar felirat", "label": "Magyar felirat"}]}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      });

      const raw = res.choices[0]?.message?.content || "";
      const parsed = JSON.parse(raw);
      const types: TypeOption[] = Array.isArray(parsed?.types) ? parsed.types : [];

      const valid = types.filter(
        (t) => t && typeof t.value === "string" && t.value.trim() && typeof t.label === "string"
      );

      if (valid.length > 0) {
        console.log(`[extractCatalogTypes] ${valid.length} típus kinyerve (${rawTypes.length} nyers → ${valid.length} tiszta)`);
        return valid;
      }
    } catch (err: any) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      console.error("[extractCatalogTypes] Típus kinyerés sikertelen:", err?.message || err);
    }
  }

  return [];
}
