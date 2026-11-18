import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, DEFAULT_PRINT_SIZES, DEFAULT_ID_LOT_TYPES, SETTINGS_SCHEMA } from '../shared/presets.js';
import { lotProblem } from '../shared/layout.js';

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
      // v5: lotes nuevos de carnet (5,1x5,1) que aún no tenga la instalación.
      for (const l of DEFAULT_ID_LOT_TYPES) if (!settings.idLotTypes.some((x) => x.id === l.id)) settings.idLotTypes.push(structuredClone(l));
      // v6: cada lote indica su papel y sus guías de cara (antes estaban en «Formatos carnet»).
      settings.idLotTypes = settings.idLotTypes.map((l) => {
        const d = DEFAULT_ID_LOT_TYPES.find((x) => x.id === l.id);
        const next = { ...l, paper: l.paper || d?.paper || '10x15', face: l.face || d?.face, uso: l.uso ?? d?.uso };
        // Un lote que no cabe en su hoja (p. ej. el antiguo 12 fotos 26x32) recibe la distribución de serie.
        return lotProblem(next) && d ? { ...next, cols: d.cols, rows: d.rows, landscape: d.landscape } : next;
      });
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
  const sec = s.security || {};
  return {
    ...s, adminPin: undefined, email: { ...s.email, pass: s.email.pass ? '••••••' : '' },
    // La interfaz del cliente solo necesita saber qué verificaciones hay, nunca los secretos.
    security: { totpEnabled: !!(sec.totpEnabled && sec.totpSecret), emailEnabled: !!(sec.email && sec.smtp?.host) }
  };
}

export const dataDir = (...p) => path.join(app.getPath('userData'), ...p);
