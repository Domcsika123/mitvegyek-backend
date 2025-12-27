// src/models/Partner.ts

export interface Partner {
  site_key: string;        // egyedi azonosító pl. "shop123"
  name: string;            // webshop neve
  api_key: string;         // partner API kulcs pl. "pk_xxxxxx"
  products_file: string;   // a partner terméklistájának JSON fájlja (data/... )
  settings?: {
    theme_color?: string;
    widget_text?: string;
  };
  created_at: string;
}
