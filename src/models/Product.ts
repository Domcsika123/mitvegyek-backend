// src/models/Product.ts

export type Product = {
  product_id: string;
  name: string;
  price: number;
  category: string;        // pl. "sport", "tech", "alcohol", "erotic", stb.
  image_url?: string;      // opcionális
  product_url?: string;    // termékoldal linkje
  description?: string;    // rövid leírás

  // ✅ Shopify / CSV importból származó extra mezők
  tags?: string;           // vesszővel elválasztott tag-ek (pl. "kék, férfi, pamut")
  product_type?: string;   // pl. "Pulóver", "T-Shirt"
  vendor?: string;         // márka / gyártó

  // ✅ Importkor töltjük (előre legyártott termék embedding)
  embedding?: number[];
};
