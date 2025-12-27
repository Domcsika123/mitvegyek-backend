// src/services/partnerService.ts

import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface Partner {
  id: string;
  name: string;
  site_key: string;
  api_key: string;
  created_at: string;
  blocked?: boolean; // partner blokkolt-e
}

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PARTNERS_FILE = path.join(DATA_DIR, "partners.json");

let partners: Partner[] = [];

/** Gondoskodunk róla, hogy a data/ mappa létezzen. */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/** partners.json beolvasása lemezről (ha létezik). */
function loadFromDisk(): Partner[] {
  ensureDataDir();

  if (!fs.existsSync(PARTNERS_FILE)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(PARTNERS_FILE, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      console.warn("[partnerService] partners.json nem tömb, üres listát használunk.");
      return [];
    }

    const now = new Date().toISOString();

    const loaded: Partner[] = data.map((p: any, idx: number) => {
      const name = String(p.name ?? `Partner ${idx + 1}`);
      const site_key = String(p.site_key ?? slugifyName(name));
      const api_key = String(p.api_key ?? generateApiKey());
      const id =
        typeof p.id === "string" && p.id.length > 0
          ? p.id
          : crypto.randomUUID
          ? crypto.randomUUID()
          : `partner_${idx}_${Date.now()}`;

      return {
        id,
        name,
        site_key,
        api_key,
        created_at: String(p.created_at ?? p.createdAt ?? now),
        blocked: Boolean(p.blocked) || false,
      };
    });

    return loaded;
  } catch (err) {
    console.error("[partnerService] Hiba a partners.json beolvasása közben:", err);
    return [];
  }
}

/** partners.json mentése lemezre. */
function saveToDisk() {
  ensureDataDir();
  try {
    fs.writeFileSync(PARTNERS_FILE, JSON.stringify(partners, null, 2), "utf8");
  } catch (err) {
    console.error("[partnerService] Hiba a partners.json írása közben:", err);
  }
}

/** Név → slug-szerű site_key (kisbetű, szóköz helyett kötőjel, speciális jelek törlése). */
function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Egyedi site_key generálása (ha foglalt, kap -2, -3 stb. végződést). */
function generateSiteKey(baseName: string): string {
  const base = slugifyName(baseName) || "partner";
  let candidate = base;
  let counter = 2;

  while (partners.some((p) => p.site_key === candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }

  return candidate;
}

/** Random api_key generálás (saját partner API kulcs). */
function generateApiKey(): string {
  return crypto.randomBytes(24).toString("hex");
}

/** Modul betöltésekor megpróbáljuk betölteni a meglévő partnereket. */
(function init() {
  partners = loadFromDisk();
  console.log(`[partnerService] Betöltött partnerek száma: ${partners.length}`);
})();

/** Partnerek listája adminnak. */
export function listPartners(): Partner[] {
  partners = loadFromDisk();
  return partners;
}

/** Új partner létrehozása. */
export function createPartner(name: string): Partner {
  partners = loadFromDisk();

  const trimmedName = name.trim();
  const site_key = generateSiteKey(trimmedName || "Partner");
  const api_key = generateApiKey();

  const partner: Partner = {
    id: crypto.randomUUID ? crypto.randomUUID() : `partner_${Date.now()}`,
    name: trimmedName || site_key,
    site_key,
    api_key,
    created_at: new Date().toISOString(),
    blocked: false,
  };

  partners.push(partner);
  saveToDisk();

  console.log(
    `[partnerService] Új partner létrehozva: name="${partner.name}", site_key="${partner.site_key}"`
  );

  return partner;
}

/** Partner lekérdezése site_key alapján. */
export function findPartnerBySiteKey(siteKey: string): Partner | null {
  partners = loadFromDisk();

  const key = (siteKey || "").trim();
  if (!key) return null;

  return partners.find((p) => p.site_key === key) || null;
}

/** ✅ ÚJ: Partner lekérdezése api_key alapján (widget / recommend guardhoz). */
export function findPartnerByApiKey(apiKey: string): Partner | null {
  partners = loadFromDisk();

  const key = (apiKey || "").trim();
  if (!key) return null;

  return partners.find((p) => p.api_key === key) || null;
}

/** Partner blokkolt státuszának beállítása. */
export function setPartnerBlocked(siteKey: string, blocked: boolean): Partner | null {
  partners = loadFromDisk();

  const key = (siteKey || "").trim();
  if (!key) return null;

  const partner = partners.find((p) => p.site_key === key);
  if (!partner) return null;

  partner.blocked = blocked;
  saveToDisk();

  console.log(
    `[partnerService] Partner blokkolt státusz módosítva: site_key="${partner.site_key}", blocked=${blocked}`
  );

  return partner;
}

/** Partner törlése site_key alapján. */
export function deletePartner(siteKey: string): boolean {
  partners = loadFromDisk();

  const key = (siteKey || "").trim();
  if (!key) return false;

  const idx = partners.findIndex((p) => p.site_key === key);
  if (idx === -1) return false;

  const removed = partners[idx];
  partners.splice(idx, 1);
  saveToDisk();

  console.log(
    `[partnerService] Partner törölve: name="${removed.name}", site_key="${removed.site_key}"`
  );

  return true;
}


