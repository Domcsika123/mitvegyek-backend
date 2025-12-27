// src/ai/rerank.ts

import OpenAI from "openai";
import { UserContext } from "../models/UserContext";
import { Product } from "../models/Product";

type RankedProduct = {
  product: Product;
  reason: string;
};

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY hiányzik. Állítsd be a .env fájlban.");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Egyszerű fallback indoklás, ha valami gond van a GPT-vel ---

function buildFallbackReason(user: UserContext, product: Product): string {
  const rel = user.relationship || "az ajándékozott személy";
  const interests = user.interests && user.interests.length > 0
    ? `, érdeklődés: ${user.interests.join(", ")}`
    : "";
  return `${product.name} jó ajándék lehet ${rel} számára${interests ? interests : ""}.`;
}

// --- VALÓDI GPT RERANK ---

export async function rerankWithLLM(
  user: UserContext,
  products: Product[]
): Promise<RankedProduct[]> {
  if (!products || products.length === 0) {
    return [];
  }

  const userSummary = JSON.stringify(user, null, 2);
  const productList = products.map((p, idx) => ({
    index: idx,
    product_id: p.product_id,
    name: p.name,
    price: p.price,
    category: p.category,
    description: p.description,
  }));

  const systemPrompt = `
Te egy magyar nyelvű ajándékajánló asszisztens vagy.
A felhasználó adatai (kor, nem, kapcsolat, költségkeret, érdeklődések, leírás) alapján
válaszd ki a legrelevánsabb termékeket egy listából, és adj rövid, magyar indoklást.

Csak olyan terméket válassz ki, ami:
- illik a kapcsolat jellegéhez (pl. barátomnak, páromnak, kollégámnak)
- belefér a költségkeretbe
- kapcsolódik a megadott érdeklődésekhez vagy a szabad szöveges leíráshoz.

VÁLASZFORMÁTUM (kötelezően JSON, extra szöveg nélkül):

{
  "items": [
    {
      "index": 0,
      "reason": "rövid magyarázat..."
    },
    ...
  ]
}
`.trim();

  const userPrompt = `
Felhasználói adatok:
${userSummary}

Terméklista:
${JSON.stringify(productList, null, 2)}

Feladat:
- Válaszd ki a legrelevánsabb 5-10 terméket.
- A válaszodban a fenti JSON formátumot használd.
`.trim();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      console.warn("[rerank] Üres válasz a GPT-től, fallback indoklás.");
      return products.map((p) => ({
        product: p,
        reason: buildFallbackReason(user, p),
      }));
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn("[rerank] Nem sikerült JSON-ként értelmezni a választ, fallback indoklás.");
      return products.map((p) => ({
        product: p,
        reason: buildFallbackReason(user, p),
      }));
    }

    const items = Array.isArray(parsed.items) ? parsed.items : [];

    const ranked: RankedProduct[] = items
      .map((item: any) => {
        const index = Number(item.index);
        const reason = String(item.reason || "").trim();
        if (Number.isNaN(index) || index < 0 || index >= products.length) {
          return null;
        }
        const product = products[index];
        return { product, reason };
      })
      .filter((x) => x !== null) as RankedProduct[];

    if (ranked.length === 0) {
      console.warn("[rerank] A GPT válasz üres / érvénytelen, fallback indoklás.");
      return products.map((p) => ({
        product: p,
        reason: buildFallbackReason(user, p),
      }));
    }

    return ranked;
  } catch (err) {
    console.error("[rerank] Hiba a GPT hívás közben, fallback indoklás:", err);
    return products.map((p) => ({
      product: p,
      reason: buildFallbackReason(user, p),
    }));
  }
}
