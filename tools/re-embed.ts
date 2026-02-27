// tools/re-embed.ts
//
// Meglévő termék JSON-ök újra-embeddelése text-embedding-3-large modellel.
//
// Használat:
//   npx ts-node tools/re-embed.ts                    # összes katalógus
//   npx ts-node tools/re-embed.ts --site_key shop    # csak egy katalógus
//   npx ts-node tools/re-embed.ts --dry-run           # csak kiírja mit csinálna
//

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const EMBED_MODEL = "text-embedding-3-large";
const BATCH_SIZE = 64;
const DATA_DIR = path.join(__dirname, "..", "data");

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY hiányzik a .env fájlból!");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getArg(flag: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return "";
  return process.argv[idx + 1];
}

const isDryRun = process.argv.includes("--dry-run");
const targetSiteKey = getArg("--site_key");

function clampText(s: string, maxLen = 600): string {
  if (!s) return "";
  const t = String(s).trim();
  return t.length <= maxLen ? t : t.slice(0, maxLen) + "…";
}

function buildProductText(p: any): string {
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  if (p.category) parts.push(`kategória: ${p.category}`);
  if (p.description) parts.push(p.description);
  if (p.tags) parts.push(`tags: ${p.tags}`);
  if (p.product_type) parts.push(`típus: ${p.product_type}`);
  if (p.vendor) parts.push(`márka: ${p.vendor}`);
  return clampText(parts.join(". "), 600);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: texts,
  });
  return response.data.map((d) => d.embedding);
}

async function reEmbedFile(filePath: string, siteKey: string) {
  const raw = fs.readFileSync(filePath, "utf8");
  const products: any[] = JSON.parse(raw);

  if (!Array.isArray(products) || products.length === 0) {
    console.log(`  ⏭️  ${siteKey}: üres katalógus, kihagyjuk.`);
    return;
  }

  // Ellenőrizzük a jelenlegi dimenziót
  const currentDim = products[0]?.embedding?.length || 0;
  if (currentDim === 3072) {
    console.log(`  ✅ ${siteKey}: már 3-large (${currentDim} dim, ${products.length} termék) — kihagyjuk.`);
    return;
  }

  console.log(`  🔄 ${siteKey}: ${products.length} termék, jelenlegi dim=${currentDim || "nincs"} → ${EMBED_MODEL} (3072 dim)`);

  if (isDryRun) {
    console.log(`  🏃 DRY RUN — nem változtatunk.`);
    return;
  }

  let processed = 0;
  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const texts = batch.map(buildProductText);

    const embeddings = await embedBatch(texts);

    for (let j = 0; j < batch.length; j++) {
      batch[j].embedding = embeddings[j];
    }

    processed += batch.length;
    console.log(`    📦 ${processed}/${products.length} kész`);
  }

  // Mentés
  fs.writeFileSync(filePath, JSON.stringify(products, null, 2), "utf8");
  console.log(`  💾 ${siteKey}: elmentve (${products.length} termék, 3072 dim)`);
}

async function main() {
  console.log(`\n🚀 Re-embed script (model: ${EMBED_MODEL})`);
  console.log(`📂 Data dir: ${DATA_DIR}\n`);

  const files = fs.readdirSync(DATA_DIR).filter(
    (f) => f.startsWith("products") && f.endsWith(".json")
  );

  if (files.length === 0) {
    console.log("Nem találtam termékfájlokat.");
    return;
  }

  for (const file of files) {
    let siteKey = "default";
    if (file !== "products.json") {
      siteKey = file.slice("products-".length, -".json".length);
    }

    // Ha megadtuk a --site_key-t, csak azt dolgozzuk fel
    if (targetSiteKey && siteKey !== targetSiteKey) continue;

    const filePath = path.join(DATA_DIR, file);
    await reEmbedFile(filePath, siteKey);
  }

  console.log("\n✅ Kész! Indítsd újra a szervert, hogy az új embeddingek betöltődjenek.\n");
}

main().catch((err) => {
  console.error("❌ Hiba:", err);
  process.exit(1);
});
