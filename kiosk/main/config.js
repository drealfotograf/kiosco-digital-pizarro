import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../shared/presets.js';

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
