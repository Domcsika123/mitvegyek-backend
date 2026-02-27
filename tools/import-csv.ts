// tools/import-csv.ts
//
// Használat (példa):
// npx ts-node tools/import-csv.ts \
//   --file feed.csv \
//   --site_key default \
//   --id id \
//   --name name \
//   --price price \
//   --category category \
//   --description description \
//   --url product_url \
//   --image image_url \
//   --admin_token "IDE_A_TOKEN"

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import axios from "axios";

// Segédfüggvény CLI argumentumok olvasásához
function getArgValue(flag: string, required = false): string {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    if (required) {
      console.error(`Hiányzó argumentum: ${flag}`);
      process.exit(1);
    }
    return "";
  }
  return process.argv[index + 1];
}

// Ár feldolgozása: "11 990 Ft" -> 11990
function parsePrice(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw
    .toString()
    .replace(/\s+/g, "")
    .replace(/[^0-9.,]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.replace(",", ".");
  const num = Number(normalized);
  if (Number.isNaN(num)) return 0;
  // Ha tizedesjegy van, kerekítsük egész forintra
  return Math.round(num);
}

// Fő futás
async function main() {
  const filePathArg = getArgValue("--file", true);
  const siteKey = getArgValue("--site_key", true);

  const idCol = getArgValue("--id", true);
  const nameCol = getArgValue("--name", true);
  const priceCol = getArgValue("--price", true);

  const categoryCol = getArgValue("--category", false);
  const descriptionCol = getArgValue("--description", false);
  const urlCol = getArgValue("--url", false);
  const imageCol = getArgValue("--image", false);
  // ✅ Shopify extra mezők (fashion attribute matching-hez)
  const tagsCol = getArgValue("--tags", false);
  const productTypeCol = getArgValue("--product_type", false);
  const vendorCol = getArgValue("--vendor", false);

  const host = getArgValue("--host", false) || "http://localhost:3001";

  // ✅ Admin token (kötelező az /api/admin/* endpointokhoz)
  const adminToken =
    getArgValue("--admin_token", false) || process.env.MV_ADMIN_TOKEN || "";

  if (!adminToken) {
    console.error(
      'Hiányzik az admin token. Add meg: --admin_token "TOKEN" (vagy állítsd be az MV_ADMIN_TOKEN env változót).'
    );
    process.exit(1);
  }

  const fullPath = path.isAbsolute(filePathArg)
    ? filePathArg
    : path.join(process.cwd(), filePathArg);

  if (!fs.existsSync(fullPath)) {
    console.error("A megadott CSV fájl nem létezik:", fullPath);
    process.exit(1);
  }

  console.log("CSV import indul.");
  console.log("Fájl:", fullPath);
  console.log("site_key:", siteKey);
  console.log("API host:", host);

  const csvContent = fs.readFileSync(fullPath, "utf-8");

  // CSV parse – első sor fejléc
  const records: Record<string, string>[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log("Beolvasott sorok száma a CSV-ben:", records.length);


  const items: any[] = [];
  let skipped = 0;
  const seenNames = new Set<string>();

  function extractColor(name: string, tags: string): string | undefined {
    // Egyszerű szín detektálás név vagy tag alapján
    const COLORS = [
      "black", "white", "red", "blue", "green", "yellow", "pink", "purple", "grey", "gray", "sand", "mocha", "beige", "brown", "orange", "gold", "silver", "washed", "nature", "dollar green"
    ];
    const lower = (name + " " + tags).toLowerCase();
    return COLORS.find(c => lower.includes(c));
  }

  function extractStyle(name: string, tags: string): string | undefined {
    // Egyszerű stílus detektálás
    const STYLES = ["oversized", "loose", "fit", "vintage", "modern", "classic", "premium", "street", "unisex"];
    const lower = (name + " " + tags).toLowerCase();
    return STYLES.find(s => lower.includes(s));
  }

  function extractType(name: string, tags: string, product_type: string): string | undefined {
    // Egyszerű fazon/típus detektálás
    const TYPES = ["tee", "t-shirt", "hoodie", "pants", "canvas", "bag", "cap", "jacket", "sneaker", "shirt", "pullover", "shorts"];
    const lower = (name + " " + tags + " " + product_type).toLowerCase();
    return TYPES.find(t => lower.includes(t));
  }

  for (const row of records) {
    const product_id = (row[idCol] || "").toString().trim();
    let name = (row[nameCol] || "").toString().trim();
    const priceRaw = row[priceCol];

    if (!product_id || !name) {
      skipped++;
      continue;
    }

    // Deduplication: remove size/variant info from name for uniqueness
    let dedupName = name.replace(/\b(XS|S|M|L|XL|XXL|XXXL|[0-9]+ ?cm|\d+ ?x ?\d+ ?cm|\d+ ?-? ?pack|\[[^\]]+\]|\([^)]+\))\b/gi, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (seenNames.has(dedupName)) {
      continue;
    }
    seenNames.add(dedupName);

    const price = parsePrice(priceRaw as string);

    const category = categoryCol
      ? (row[categoryCol] || "").toString().trim()
      : "";

    const description = descriptionCol
      ? (row[descriptionCol] || "").toString().trim()
      : "";

    const product_url = urlCol ? (row[urlCol] || "").toString().trim() : "";

    const image_url = imageCol ? (row[imageCol] || "").toString().trim() : "";

    // Extra mezők Shopify importhoz (fashion attribute matching)
    const tags = tagsCol ? (row[tagsCol] || "").toString().trim() : "";
    const product_type = productTypeCol ? (row[productTypeCol] || "").toString().trim() : "";
    const vendor = vendorCol ? (row[vendorCol] || "").toString().trim() : "";

    items.push({
      product_id,
      name,
      price,
      category,
      description,
      product_url: product_url || undefined,
      image_url: image_url || undefined,
      tags: tags || undefined,
      product_type: product_type || undefined,
      vendor: vendor || undefined,
    });
  }

  console.log("Felhasználható termékek:", items.length);
  console.log("Kihagyott sorok (hiányzó id / name):", skipped);

  if (items.length === 0) {
    console.error("Nincs importálható termék, leállok.");
    process.exit(1);
  }

  // Hívjuk meg a saját API-t
  const url = `${host.replace(/\/+$/, "")}/api/admin/import-products`;

  console.log("Import API hívása:", url);

  try {
    const response = await axios.post(
      url,
      {
        site_key: siteKey,
        items,
      },
      {
        headers: {
          "x-admin-token": adminToken,
        },
      }
    );

    console.log("Import sikeres.");
    console.log("Válasz:", response.data);
  } catch (err: any) {
    console.error("Hiba az import API hívásakor:");
    console.error(err?.response?.status, err?.response?.data || err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Váratlan hiba az import-csv futása közben:", err);
  process.exit(1);
});
