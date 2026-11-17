import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, DEFAULT_PRINT_SIZES, SETTINGS_SCHEMA } from '../shared/presets.js';

let settings = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

function merge(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    if (val && typeof val === 'object') for (const k of Object.keys(val)) out[k] = k in def ? merge(def[k], val[k]) : val[k];
    return out;
  }
  return val === undefined ? def : val;
}

export function getSettings() {
  if (!settings) {
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* primera ejecución */ }
    settings = merge(DEFAULT_SETTINGS, saved);
    // Migración: las listas guardadas sustituyen a las de serie, así que lo nuevo se añade aquí una sola vez.
    if ((saved.schema || 1) < SETTINGS_SCHEMA && Object.keys(saved).length) {
      for (const z of DEFAULT_PRINT_SIZES.filter((d) => d.card)) {
        if (!settings.printSizes.some((s) => s.id === z.id)) {
          const base = settings.printSizes.find((s) => s.id === '10x15');
          settings.printSizes.splice(settings.printSizes.indexOf(base) + 1, 0, { ...z, printers: base ? [...(base.printers || [])] : [] });
        }
      }
      // v4: la Polaroid cuadrada tiene imagen de 8,5x8,5 cm (antes 10x10) con 2 cm de margen inferior.
      const pq = settings.printSizes.find((s) => s.id === 'pola10');
      const def = DEFAULT_PRINT_SIZES.find((s) => s.id === 'pola10');
      if (pq?.card?.win?.w === 100) Object.assign(pq, { name: def.name, card: structuredClone(def.card) });
      settings.schema = SETTINGS_SCHEMA;
      try { saveSettings(settings); } catch { /* se reintentará al guardar */ }
    }
  }
  return settings;
}

export function saveSettings(next) {
  settings = merge(DEFAULT_SETTINGS, next);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
  fs.renameSync(tmp, file());
  return settings;
}

/** Ajustes sin secretos, para enviarlos a la interfaz del cliente. */
export function publicSettings() {
  const s = getSettings();
  return { ...s, adminPin: undefined, email: { ...s.email, pass: s.email.pass ? '••••••' : '' } };
}

export const dataDir = (...p) => path.join(app.getPath('userData'), ...p);
