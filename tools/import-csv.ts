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

  for (const row of records) {
    const product_id = (row[idCol] || "").toString().trim();
    const name = (row[nameCol] || "").toString().trim();
    const priceRaw = row[priceCol];

    if (!product_id || !name) {
      skipped++;
      continue;
    }

    const price = parsePrice(priceRaw as string);

    const category = categoryCol
      ? (row[categoryCol] || "").toString().trim()
      : "";

    const description = descriptionCol
      ? (row[descriptionCol] || "").toString().trim()
      : "";

    const product_url = urlCol ? (row[urlCol] || "").toString().trim() : "";

    const image_url = imageCol ? (row[imageCol] || "").toString().trim() : "";

    items.push({
      product_id,
      name,
      price,
      category,
      description,
      product_url: product_url || undefined,
      image_url: image_url || undefined,
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
