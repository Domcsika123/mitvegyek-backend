// UserContext.ts
export type UserContext = {
  age?: number;

  // recommend.ts-ben előfordulhat "unknown" (ha nincs adat)
  gender?: "male" | "female" | "other" | "unknown";

  budget_min?: number;
  budget_max?: number;

  relationship?: string;
  interests?: string[];

  // widget / kérdés szöveg / prompt
  free_text?: string;

  // widget küldheti vagy a backend hozzáadhatja
  site_key?: string;
};
