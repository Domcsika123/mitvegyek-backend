// src/models/Product.ts

export type Product = {
  product_id: string;
  name: string;
  price: number;
  category: string;        // pl. "sport", "tech", "alcohol", "erotic", stb.
  image_url?: string;      // opcionális
  product_url?: string;    // termékoldal linkje
  description?: string;    // rövid leírás
};
