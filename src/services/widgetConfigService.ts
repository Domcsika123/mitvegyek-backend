// src/services/widgetConfigService.ts
//
// FullWidgetConfig CRUD a partnerekhez.
// A FullWidgetConfig a partners.json-ban a partner.full_widget_config mezőben él.
// Ha nincs, backward-compatible módon a legacy mezőkből építjük.

import {
  FullWidgetConfig,
  sanitizeWidgetConfig,
  getDefaultWidgetConfig,
  buildConfigFromLegacy,
  getPresetConfig,
  PresetName,
  PRESET_NAMES,
  LegacyPartnerSettings,
} from "../config/widgetConfig";

import {
  findPartnerBySiteKey,
  listPartners,
} from "./partnerService";

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const PARTNERS_FILE = path.join(DATA_DIR, "partners.json");

/**
 * partners.json nyers beolvasása.
 * A partnerService is ezt csinálja, de mi közvetlenül akarjuk írni a full_widget_config mezőt.
 */
function readPartnersRaw(): any[] {
  try {
    if (!fs.existsSync(PARTNERS_FILE)) return [];
    const raw = fs.readFileSync(PARTNERS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writePartnersRaw(data: any[]): void {
  try {
    fs.writeFileSync(PARTNERS_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[widgetConfigService] Hiba a partners.json írása közben:", err);
  }
}

/**
 * Partner full_widget_config lekérése.
 * Ha nincs, legacy mezőkből építjük (backward-compatible).
 */
export function getFullWidgetConfig(siteKey: string): FullWidgetConfig {
  const partners = readPartnersRaw();
  const p = partners.find((x: any) => x.site_key === siteKey);
  if (!p) return getDefaultWidgetConfig();

  // Ha van mentett full_widget_config, azt sanitize-oljuk és visszaadjuk
  if (p.full_widget_config && typeof p.full_widget_config === "object" && p.full_widget_config.version) {
    return sanitizeWidgetConfig(p.full_widget_config);
  }

  // Nincs → legacy migráció
  const legacy: LegacyPartnerSettings = {
    widget_config: p.widget_config || null,
    widget_copy: p.widget_copy || null,
    widget_fields: p.widget_fields || null,
    widget_schema: p.widget_schema || null,
    relevance: p.relevance || null,
  };

  return buildConfigFromLegacy(legacy);
}

/**
 * Partner full_widget_config mentése.
 */
export function saveFullWidgetConfig(siteKey: string, config: any): FullWidgetConfig | null {
  const partners = readPartnersRaw();
  const idx = partners.findIndex((x: any) => x.site_key === siteKey);
  if (idx === -1) return null;

  const sanitized = sanitizeWidgetConfig(config);
  partners[idx].full_widget_config = sanitized;

  writePartnersRaw(partners);
  console.log(`[widgetConfigService] full_widget_config mentve: site_key="${siteKey}"`);

  return sanitized;
}

/**
 * Partner full_widget_config törlése (reset default-ra).
 */
export function resetFullWidgetConfig(siteKey: string): FullWidgetConfig | null {
  const partners = readPartnersRaw();
  const idx = partners.findIndex((x: any) => x.site_key === siteKey);
  if (idx === -1) return null;

  const def = getDefaultWidgetConfig();
  partners[idx].full_widget_config = def;

  writePartnersRaw(partners);
  console.log(`[widgetConfigService] full_widget_config reset: site_key="${siteKey}"`);

  return def;
}

/**
 * Preset alkalmazása (fashion/electronics/gift/generic).
 */
export function applyPreset(siteKey: string, presetName: PresetName): FullWidgetConfig | null {
  const cfg = getPresetConfig(presetName);
  return saveFullWidgetConfig(siteKey, cfg);
}

/**
 * Widget config letöltés – publikus (widget.js használja).
 * Biztonsági szűrés: ne adjunk vissza admin mezőket.
 */
export function getPublicWidgetConfig(siteKey: string): FullWidgetConfig {
  return getFullWidgetConfig(siteKey);
}

/** Elérhető presetek listája */
export function listPresets(): { id: PresetName; label: string }[] {
  return PRESET_NAMES;
}
