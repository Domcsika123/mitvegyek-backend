// src/ai/generateDescriptions.ts
// Generates Hungarian product descriptions at import time using GPT-4.1-mini.
// Stored in products JSON and reused at recommendation time — no per-request LLM call needed.

import OpenAI from "openai";
import { Product } from "../models/Product";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BATCH_SIZE = 50;
const CONCURRENCY = 5; // parallel API calls

const SYSTEM_PROMPT = `
Generate concise Hungarian product descriptions for a streetwear/fashion webshop.

Rules:
- 80-160 characters per description
- Include: color (from name/desc), material/fabric (if mentioned), cut/fit (oversized, slim, etc.), notable features or graphics
- Factual only — do NOT invent attributes not present in the product data
- Do NOT start with or repeat the product name or brand name
- Do NOT use generic phrases: "Remek választás", "Tökéletes", "Kiváló minőség", "Must-have", "Ajánlott"
- Write ONLY in Hungarian

Good examples:
✓ "Szürke, laza szabású nehéz pamut póló, cold dyed technikával, Eberkoma kolláborációs grafika."
✓ "Fehér washed organikus pamut póló, enyhén oversized szabás, portugál gyártás."
✓ "Fekete zip hoodie, 100% pamut, laza szabás, ikonikus logóval az elején."
✓ "Court Purple rövidnadrág, mélyzsebes kialakítás, streetwear stílusban."
✓ "Washed fehér tank top, 100% organikus pamut, grafikás hátoldal."

Bad examples:
✗ "UNREAL Eberkoma Grey póló, magas minőségű pamutból." — brand/product name repeated
✗ "Szürke póló." — too short, missing details
✗ "Remek választás, ha streetwear rajongó vagy." — generic banned phrase

Output JSON:
{
  "descriptions": [
    { "id": "<product_id>", "desc": "<Hungarian description>" }
  ]
}
`.trim();

function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function generateBatch(batch: Product[]): Promise<Map<string, string>> {
  const productList = batch.map((p) => {
    const desc = stripHtml(String(p.description || "")).slice(0, 200);
    const catLast = (p.category || "").includes(">")
      ? (p.category || "").split(">").pop()!.trim()
      : (p.category || "");

    // Strip size suffix from name so LLM doesn't mention it
    let name = String(p.name || "");
    name = name.replace(/\s*\((?:[^()]*|\([^()]*\))*\)\s*$/, "").trim();
    name = name.replace(/\s*[-–\/|]\s*(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{2,3})\s*$/i, "").trim();

    return {
      id: p.product_id,
      name,
      category: catLast,
      desc,
      tags: p.tags ? String(p.tags).slice(0, 100) : undefined,
    };
  });

  const userPrompt = `Generate Hungarian descriptions for these ${batch.length} products:\n${JSON.stringify(productList)}`;
  const result = new Map<string, string>();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
      });

      const raw = response.choices[0]?.message?.content || "";
      const parsed = JSON.parse(raw);
      const descriptions = Array.isArray(parsed?.descriptions) ? parsed.descriptions : [];

      for (const item of descriptions) {
        if (item?.id && item?.desc) {
          const desc = String(item.desc).trim();
          if (desc.length >= 30) {
            result.set(String(item.id), desc.slice(0, 200));
          }
        }
      }

      return result;
    } catch (err: any) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      console.error(`[generateDescriptions] Batch failed after 3 attempts:`, err?.message || err);
    }
  }

  return result;
}

/**
 * Generate AI descriptions for all products in parallel batches.
 * CONCURRENCY parallel API calls → ~5x faster than sequential.
 * Returns the products array with ai_description populated on each product.
 */
export async function generateProductDescriptions(
  products: Product[]
): Promise<Product[]> {
  // Split into batches
  const batches: Product[][] = [];
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    batches.push(products.slice(i, i + BATCH_SIZE));
  }

  let completed = 0;
  let descGenerated = 0;

  // Process in parallel windows of CONCURRENCY
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const window = batches.slice(i, i + CONCURRENCY);
    const results = await Promise.all(window.map((batch) => generateBatch(batch)));

    for (let j = 0; j < window.length; j++) {
      const batch = window[j];
      const batchResult = results[j];
      for (const p of batch) {
        const desc = batchResult.get(p.product_id);
        if (desc) {
          (p as any).ai_description = desc;
          descGenerated++;
        }
      }
    }

    completed += window.reduce((s, b) => s + b.length, 0);
    console.log(
      `[generateDescriptions] ${Math.min(completed, products.length)}/${products.length} done (${descGenerated} descriptions generated)`
    );
  }

  console.log(`[generateDescriptions] Complete: ${descGenerated}/${products.length} descriptions generated`);
  return products;
}
