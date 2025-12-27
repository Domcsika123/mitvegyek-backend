// src/services/statsService.ts

import { UserContext } from "../models/UserContext";

export type DailyCount = {
  date: string; // 'YYYY-MM-DD'
  count: number;
};

export type PriceBucketKey = "0-5000" | "5001-10000" | "10001-20000" | "20001+";

export type SiteStats = {
  siteKey: string;
  totalRequests: number;
  lastRequestAt?: string; // ISO string

  // bővített statok
  dailyCounts: DailyCount[]; // utolsó ~30 nap
  interestsCount: { [interest: string]: number }; // érdeklődési körök
  priceBuckets: { [bucket in PriceBucketKey]: number }; // budget eloszlás

  // ÚJ: mire kerestek + demó statok
  freeTextCount: { [query: string]: number }; // free_text top
  genderCount: { [gender: string]: number };
  relationshipCount: { [rel: string]: number };
};

const statsMap: { [siteKey: string]: SiteStats } = {};

const MAX_DAYS = 30;

function createEmptyBuckets(): { [bucket in PriceBucketKey]: number } {
  return {
    "0-5000": 0,
    "5001-10000": 0,
    "10001-20000": 0,
    "20001+": 0,
  };
}

function ensureStats(siteKey: string): SiteStats {
  const key = (siteKey || "unknown").trim() || "unknown";
  if (!statsMap[key]) {
    statsMap[key] = {
      siteKey: key,
      totalRequests: 0,
      lastRequestAt: undefined,
      dailyCounts: [],
      interestsCount: {},
      priceBuckets: createEmptyBuckets(),

      freeTextCount: {},
      genderCount: {},
      relationshipCount: {},
    };
  }
  return statsMap[key];
}

function getPriceBucket(min?: number, max?: number): PriceBucketKey {
  const value = (max ?? min ?? 0);
  if (value <= 5000) return "0-5000";
  if (value <= 10000) return "5001-10000";
  if (value <= 20000) return "10001-20000";
  return "20001+";
}

function isoDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function inc(map: { [k: string]: number }, rawKey: any): void {
  const key = String(rawKey ?? "").trim().toLowerCase();
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function normalizeQuery(q: any): string {
  let s = String(q ?? "").trim();
  if (!s) return "";
  // túl hosszú bejegyzések vágása, hogy ne csessze szét a UI-t
  if (s.length > 120) s = s.slice(0, 120) + "…";
  return s;
}

/**
 * Ezt hívjuk meg minden sikeres /api/recommend hívásnál.
 * Itt gyűjtünk minél több, a statisztikához hasznos adatot.
 */
export function recordRecommendation(siteKey: string, user?: UserContext): void {
  const stats = ensureStats(siteKey);

  // Összes darabszám + utolsó időpont
  stats.totalRequests += 1;
  stats.lastRequestAt = new Date().toISOString();

  // Napi bontás (utolsó 30 nap)
  const today = isoDateToday();
  let daily = stats.dailyCounts.find((d) => d.date === today);
  if (!daily) {
    daily = { date: today, count: 0 };
    stats.dailyCounts.push(daily);
  }
  daily.count += 1;

  // Régiek kiszórása (csak utolsó MAX_DAYS)
  const cutoff = isoDateNDaysAgo(MAX_DAYS);
  stats.dailyCounts = stats.dailyCounts
    .filter((d) => d.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Ha nincs extra user adatom, itt megállhatunk
  if (!user) return;

  // Budget kategóriák (budget_max / budget_min alapján)
  const bucket = getPriceBucket(user.budget_min, user.budget_max);
  stats.priceBuckets[bucket] = (stats.priceBuckets[bucket] || 0) + 1;

  // Érdeklődési körök
  if (Array.isArray(user.interests)) {
    for (const raw of user.interests) {
      inc(stats.interestsCount, raw);
    }
  }

  // ÚJ: free_text (mire kerestek)
  const q = normalizeQuery(user.free_text);
  if (q) {
    stats.freeTextCount[q] = (stats.freeTextCount[q] || 0) + 1;
  }

  // ÚJ: demó megoszlások
  inc(stats.genderCount, user.gender || "unknown");
  inc(stats.relationshipCount, user.relationship || "unknown");
}

/**
 * Admin felülethez: az összes stat lekérdezése.
 */
export function getAllStats(): SiteStats[] {
  return Object.values(statsMap).sort((a, b) => a.siteKey.localeCompare(b.siteKey));
}

/**
 * Egy konkrét siteKey stats-a.
 */
export function getStatsForSite(siteKey: string): SiteStats | undefined {
  const key = (siteKey || "").trim();
  return statsMap[key];
}
