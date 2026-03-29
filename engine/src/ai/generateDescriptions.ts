// src/ai/generateDescriptions.ts
// Generates Hungarian product descriptions AND structured fashion tags at import time.
// - Products WITH image_url: gpt-4o-mini vision → visual attributes + structured tags
// - Products WITHOUT image_url: gpt-4.1-mini text-only batch
// Stored in products JSON and reused at recommendation time.

import OpenAI from "openai";
import { Product, FashionTags } from "../models/Product";
import { detectColors } from "../search/colors";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TEXT_BATCH_SIZE = 50;
const VISION_BATCH_SIZE = 5;
const TEXT_CONCURRENCY = 5;
const VISION_CONCURRENCY = 10;

// ─── Fashion tag schema (shared between prompts) ─────────────────────────────

const FASHION_TAGS_SCHEMA = `
You must also output structured "tags" for each product — these are used for precise search filtering.

"tags" object schema (use ONLY these exact values):
{
  "fit": "oversized" | "relaxed" | "regular" | "slim" | "boxy" | "cropped",
  "logo": "none" | "small" | "large" | "embroidered" | "printed",
  "graphic": "none" | "small_print" | "all_over" | "text" | "abstract" | "photo",
  "pattern": "solid" | "striped" | "checkered" | "dotted" | "floral" | "camo" | "tie_dye" | "leopard" | "abstract" | "colorblock",
  "style": ["casual", "sporty", "elegant", "streetwear", "vintage", "minimalist", "bold", "preppy", "grunge", "workwear", "skater", "hip_hop", "retro"],
  "weight": "light" | "medium" | "heavy",
  "material": "cotton" | "polyester" | "fleece" | "denim" | "nylon" | "wool" | "linen" | "silk" | "leather" | "mesh" | "mixed",
  "color": the primary color in English lowercase ("black", "white", "grey", "blue", "red", "green", "yellow", "orange", "purple", "pink", "brown", "beige", "navy", "burgundy", "teal", "multicolor")
}

Rules for tags:
- "fit": if not clearly visible, use "regular"
- "logo": look carefully — "none" means NO visible brand mark/logo at all
- "graphic": "none" means completely plain, "text" means lettering/words, "all_over" means fully covered
- "pattern": "solid" means one color, no pattern
- "style": MUST be an array, pick 1-3 that best describe the product's vibe
- "weight": infer from fabric — fleece/heavy cotton = "heavy", mesh/thin = "light"
- "material": best guess from text or image
- "color": the DOMINANT visible color in English
`.trim();

// ─── System prompts ───────────────────────────────────────────────────────────

const BASE_RULES = `
Rules for "desc":
- 80-160 characters per description
- Include: color, material/fabric (if mentioned), cut/fit (oversized, slim, etc.), notable features or graphics
- COLOR RULE (strict priority):
  1. If "color_hint" is provided → you MUST use exactly that color. Do NOT use any other color.
  2. If no "color_hint" → infer color from the product name, colorway name, or image. Use your knowledge.
  3. If color truly cannot be determined → omit color from the description.
- Do NOT start with or repeat the product name or brand name
- Do NOT use generic phrases: "Remek választás", "Tökéletes", "Kiváló minőség", "Must-have", "Ajánlott"
- Write "desc" ONLY in Hungarian

Good desc examples:
✓ "Szürke, laza szabású nehéz pamut póló, cold dyed technikával, Eberkoma kolláborációs grafika."
✓ "Fehér washed organikus pamut póló, enyhén oversized szabás, portugál gyártás."
✓ "Fekete zip hoodie, 100% pamut, laza szabás, kis hímzett logóval mellkason."
✓ "Sárga, lila részletekkel díszített kosárlabdás rövidnadrág, teljesen nyomott, sportos szabás."
✓ "Washed fehér tank top, 100% organikus pamut, logo nélküli, grafikás hátoldal."

Bad desc examples:
✗ "UNREAL Eberkoma Grey póló, magas minőségű pamutból." — brand/product name repeated
✗ "Szürke póló." — too short, missing details
`.trim();

const TEXT_SYSTEM_PROMPT = `
Generate concise Hungarian product descriptions AND structured fashion tags for a streetwear/fashion webshop.

${BASE_RULES}

${FASHION_TAGS_SCHEMA}

Output JSON:
{
  "descriptions": [
    { "id": "<product_id>", "desc": "<Hungarian description>", "tags": { "fit": "...", "logo": "...", "graphic": "...", "pattern": "...", "style": [...], "weight": "...", "material": "...", "color": "..." } }
  ]
}
`.trim();

const VISION_SYSTEM_PROMPT = `
Generate concise Hungarian product descriptions AND structured fashion tags for a streetwear/fashion webshop.
You will receive product images — analyze them carefully for visual details.

${BASE_RULES}

${FASHION_TAGS_SCHEMA}

VISUAL ANALYSIS (use the image to determine tags precisely):
- Look at the actual image to determine fit, logo presence, graphic elements, pattern, and color
- Image analysis overrides text inference for visual attributes
- Be precise: "logo: none" means you see NO logo/brand mark in the image

Output JSON:
{
  "descriptions": [
    { "id": "<product_id>", "desc": "<Hungarian description>", "tags": { "fit": "...", "logo": "...", "graphic": "...", "pattern": "...", "style": [...], "weight": "...", "material": "...", "color": "..." } }
  ]
}
`.trim();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function cleanName(raw: string): string {
  let name = String(raw || "");
  name = name.replace(/\s*\((?:[^()]*|\([^()]*\))*\)\s*$/, "").trim();
  name = name.replace(/\s*[-–\/|]\s*(XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|\d{2,3})\s*$/i, "").trim();
  return name;
}

function productMeta(p: Product) {
  const desc = stripHtml(String(p.description || "")).slice(0, 200);
  const catLast = (p.category || "").includes(">")
    ? (p.category || "").split(">").pop()!.trim()
    : (p.category || "");
  const name = cleanName(p.name || "");
  const detectedColors = detectColors(name + " " + desc, undefined, p.tags ? String(p.tags) : undefined);
  const colorHint = detectedColors.size > 0 ? [...detectedColors].join(", ") : undefined;
  return { id: p.product_id, name, category: catLast, desc, tags: p.tags ? String(p.tags).slice(0, 100) : undefined, ...(colorHint ? { color_hint: colorHint } : {}) };
}

// ─── Batch result type ────────────────────────────────────────────────────────

interface BatchResult {
  desc: string;
  tags?: FashionTags;
}

function validateFashionTags(raw: any): FashionTags | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const tags: FashionTags = {};

  const VALID_FIT = ["oversized", "relaxed", "regular", "slim", "boxy", "cropped"];
  const VALID_LOGO = ["none", "small", "large", "embroidered", "printed"];
  const VALID_GRAPHIC = ["none", "small_print", "all_over", "text", "abstract", "photo"];
  const VALID_PATTERN = ["solid", "striped", "checkered", "dotted", "floral", "camo", "tie_dye", "leopard", "abstract", "colorblock"];
  const VALID_STYLE = ["casual", "sporty", "elegant", "streetwear", "vintage", "minimalist", "bold", "preppy", "grunge", "workwear", "skater", "hip_hop", "retro"];
  const VALID_WEIGHT = ["light", "medium", "heavy"];
  const VALID_MATERIAL = ["cotton", "polyester", "fleece", "denim", "nylon", "wool", "linen", "silk", "leather", "mesh", "mixed"];

  if (VALID_FIT.includes(raw.fit)) tags.fit = raw.fit;
  if (VALID_LOGO.includes(raw.logo)) tags.logo = raw.logo;
  if (VALID_GRAPHIC.includes(raw.graphic)) tags.graphic = raw.graphic;
  if (VALID_PATTERN.includes(raw.pattern)) tags.pattern = raw.pattern;
  if (VALID_WEIGHT.includes(raw.weight)) tags.weight = raw.weight;
  if (VALID_MATERIAL.includes(raw.material)) tags.material = raw.material;
  if (typeof raw.color === "string" && raw.color.length > 0) tags.color = raw.color.toLowerCase();

  if (Array.isArray(raw.style)) {
    const validStyles = raw.style.filter((s: any) => typeof s === "string" && VALID_STYLE.includes(s));
    if (validStyles.length > 0) tags.style = validStyles;
  }

  return Object.keys(tags).length > 0 ? tags : undefined;
}

// ─── Text-only batch (gpt-4.1-mini) ──────────────────────────────────────────

async function generateTextBatch(batch: Product[]): Promise<Map<string, BatchResult>> {
  const productList = batch.map(productMeta);
  const userPrompt = `Generate Hungarian descriptions and fashion tags for these ${batch.length} products:\n${JSON.stringify(productList)}`;
  const result = new Map<string, BatchResult>();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: TEXT_SYSTEM_PROMPT },
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
            result.set(String(item.id), {
              desc: desc.slice(0, 200),
              tags: validateFashionTags(item.tags),
            });
          }
        }
      }
      return result;
    } catch (err: any) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1000 * attempt)); continue; }
      console.error(`[generateDescriptions] Text batch failed:`, err?.message || err);
    }
  }
  return result;
}

// ─── Vision batch (gpt-4o-mini) ──────────────────────────────────────────────

async function generateVisionBatch(batch: Product[]): Promise<Map<string, BatchResult>> {
  const result = new Map<string, BatchResult>();

  // Build multi-image content array:
  // [text intro] [text product 1] [image 1] [text product 2] [image 2] ...
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: "text",
      text: `Analyze the following ${batch.length} products from their images and generate Hungarian descriptions:\n`,
    },
  ];

  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    const meta = productMeta(p);
    content.push({
      type: "text",
      text: `Product ${i + 1}: ${JSON.stringify({ id: meta.id, name: meta.name, category: meta.category, ...(meta.color_hint ? { color_hint: meta.color_hint } : {}) })}`,
    });
    content.push({
      type: "image_url",
      image_url: { url: (p as any).image_url, detail: "low" },
    });
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: VISION_SYSTEM_PROMPT },
          { role: "user", content },
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
            result.set(String(item.id), {
              desc: desc.slice(0, 200),
              tags: validateFashionTags(item.tags),
            });
          }
        }
      }
      return result;
    } catch (err: any) {
      if (attempt < 3) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
      console.error(`[generateDescriptions] Vision batch failed:`, err?.message || err);
    }
  }
  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate AI descriptions for all products in parallel batches.
 * Products with image_url → gpt-4o-mini vision (batch 5, concurrency 10)
 * Products without image_url → gpt-4.1-mini text (batch 50, concurrency 5)
 */
export async function generateProductDescriptions(
  products: Product[],
  onProgress?: (done: number, total: number) => void
): Promise<Product[]> {
  const withImage = products.filter((p) => !!(p as any).image_url);
  const noImage = products.filter((p) => !(p as any).image_url);
  const total = products.length;

  console.log(`[generateDescriptions] ${withImage.length} vision products, ${noImage.length} text-only products`);

  const resultMap = new Map<string, BatchResult>();

  // ── Vision batches ──────────────────────────────────────────────────────
  const visionBatches: Product[][] = [];
  for (let i = 0; i < withImage.length; i += VISION_BATCH_SIZE) {
    visionBatches.push(withImage.slice(i, i + VISION_BATCH_SIZE));
  }

  let visionDone = 0;
  for (let i = 0; i < visionBatches.length; i += VISION_CONCURRENCY) {
    const window = visionBatches.slice(i, i + VISION_CONCURRENCY);
    const results = await Promise.all(window.map((b) => generateVisionBatch(b)));
    results.forEach((r) => r.forEach((v, k) => resultMap.set(k, v)));
    visionDone += window.reduce((s, b) => s + b.length, 0);
    console.log(`[generateDescriptions] Vision: ${Math.min(visionDone, withImage.length)}/${withImage.length}`);
    if (onProgress) onProgress(Math.min(visionDone, withImage.length), total);
  }

  // ── Text batches ────────────────────────────────────────────────────────
  const textBatches: Product[][] = [];
  for (let i = 0; i < noImage.length; i += TEXT_BATCH_SIZE) {
    textBatches.push(noImage.slice(i, i + TEXT_BATCH_SIZE));
  }

  let textDone = 0;
  for (let i = 0; i < textBatches.length; i += TEXT_CONCURRENCY) {
    const window = textBatches.slice(i, i + TEXT_CONCURRENCY);
    const results = await Promise.all(window.map((b) => generateTextBatch(b)));
    results.forEach((r) => r.forEach((v, k) => resultMap.set(k, v)));
    textDone += window.reduce((s, b) => s + b.length, 0);
    console.log(`[generateDescriptions] Text: ${Math.min(textDone, noImage.length)}/${noImage.length}`);
    if (onProgress) onProgress(withImage.length + Math.min(textDone, noImage.length), total);
  }

  // ── Apply to products ────────────────────────────────────────────────────
  let applied = 0;
  let withTags = 0;
  for (const p of products) {
    const entry = resultMap.get(p.product_id);
    if (entry) {
      (p as any).ai_description = entry.desc;
      if (entry.tags) {
        (p as any).fashion_tags = entry.tags;
        withTags++;
      }
      applied++;
    }
  }

  console.log(`[generateDescriptions] Complete: ${applied}/${products.length} descriptions, ${withTags} with fashion_tags`);
  return products;
}
