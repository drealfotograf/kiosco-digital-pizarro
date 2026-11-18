// Exportar e importar la configuración de cada página de Ajustes por separado (un JSON por sección),
// y la configuración completa del programa (Copia de seguridad). Las contraseñas y secretos no viajan
// en las secciones; en la configuración completa, solo si el administrador lo pide.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings, saveSettings, dataDir } from './config.js';

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const pick = (s, keys) => Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, clone(s[k])]));

/** Quita contraseñas y secretos de un objeto de ajustes. */
export function stripSecrets(s) {
  const o = clone(s);
  delete o.adminPin;
  if (o.email) o.email.pass = '';
  if (o.lab) o.lab.kioskKey = '';
  if (o.security) { o.security.totpSecret = ''; o.security.totpEnabled = false; if (o.security.smtp) o.security.smtp.pass = ''; }
  if (o.upload) o.upload.wifiPassword = '';
  return o;
}
/** Al importar sin secretos se conservan los de este kiosco. */
function keepSecrets(next, cur) {
  if (!next.adminPin) next.adminPin = cur.adminPin;
  if (next.email && !next.email.pass) next.email.pass = cur.email?.pass || '';
  if (next.lab && !next.lab.kioskKey) next.lab.kioskKey = cur.lab?.kioskKey || '';
  if (next.security) {
    if (!next.security.totpSecret) { next.security.totpSecret = cur.security?.totpSecret || ''; next.security.totpEnabled = !!cur.security?.totpEnabled; }
    if (next.security.smtp && !next.security.smtp.pass) next.security.smtp.pass = cur.security?.smtp?.pass || '';
  }
  if (next.upload && !next.upload.wifiPassword) next.upload.wifiPassword = cur.upload?.wifiPassword || '';
  return next;
}

// Qué ajustes pertenecen a cada página.
export const SECTIONS = {
  general: { label: 'General', keys: ['storeName', 'kioskName', 'currency', 'idleSeconds', 'ordersRetentionDays', 'keepPhotosDefault', 'legal', 'security', 'kioskMode'] },
  fonts: { label: 'Letras', keys: ['fonts'] },
  print: { label: 'Impresión y envío', keys: ['delivery', 'ticket', 'pin', 'simPrinter'] },
  sizes: { label: 'Tamaños', keys: ['printSizes', 'quickSizes', 'otherSizeMode'] },
  tariffs: { label: 'Tarifas', keys: ['printSizes', 'idLotTypes', 'idPresets', 'currency'] },
  lots: { label: 'Lotes de carnet', keys: ['idLotTypes', 'idOptions'] },
  id: { label: 'Formatos carnet', keys: ['idPresets', 'sheets', 'idDefaults'] },
  sources: { label: 'Fuentes de fotos', keys: ['upload', 'shareFolders', 'galleryNet', 'email', 'bluetoothInbox'] },
  lab: { label: 'Laboratorio y galerías', keys: ['lab'] },
  backup: { label: 'Copia de seguridad', keys: ['backup'] }
};

/** Datos exportables de una sección (o de todo el programa con id 'all'). */
export function sectionData(id, { secrets = false } = {}) {
  const s = getSettings();
  if (id === 'all') return secrets ? clone(s) : stripSecrets(s);
  if (id === 'printers') return { sizes: s.printSizes.map((z) => ({ id: z.id, name: z.name, printers: z.printers || [], useDriverPaper: !!z.useDriverPaper })) };
  const sec = SECTIONS[id];
  if (!sec) throw new Error('Esta página no tiene ajustes que exportar');
  return stripSecrets(pick(s, sec.keys));
}

/** Aplica los datos importados de una sección. Devuelve los ajustes guardados. */
export function applySection(id, data) {
  const cur = getSettings();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('El archivo no contiene ajustes válidos');
  if (id === 'printers') {
    const list = Array.isArray(data.sizes) ? data.sizes : [];
    const printSizes = cur.printSizes.map((z) => {
      const m = list.find((x) => x.id === z.id);
      return m ? { ...z, printers: (Array.isArray(m.printers) ? m.printers : []).map(String).slice(0, 10), useDriverPaper: !!m.useDriverPaper } : z;
    });
    return saveSettings({ ...cur, printSizes });
  }
  if (id === 'all') {
    if (!Array.isArray(data.printSizes)) throw new Error('El archivo no es una configuración completa del kiosco');
    return saveSettings(keepSecrets({ ...clone(data) }, cur));
  }
  const sec = SECTIONS[id];
  if (!sec) throw new Error('Esta página no tiene ajustes que importar');
  const next = { ...cur };
  for (const k of sec.keys) if (data[k] !== undefined) next[k] = clone(data[k]);
  if (next.printSizes && !next.printSizes.every((z) => z && typeof z.id === 'string' && Number(z.w) > 0 && Number(z.h) > 0)) throw new Error('Los tamaños del archivo no son válidos');
  // Las impresoras son de cada kiosco: si el archivo no las trae, se conservan.
  if (data.printSizes) next.printSizes = next.printSizes.map((z) => ({ ...z, printers: z.printers?.length ? z.printers : cur.printSizes.find((c) => c.id === z.id)?.printers || [] }));
  return saveSettings(keepSecrets(next, cur));
}

export const fileEnvelope = (id, data) => ({ tipo: 'pizarro-ajustes', seccion: id, version: 1, exportado: new Date().toISOString(), datos: data });
export function readEnvelope(text, id) {
  let j;
  try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch { throw new Error('El archivo está dañado (JSON no válido)'); }
  if (j?.tipo !== 'pizarro-ajustes') throw new Error('El archivo no es una exportación de ajustes del kiosco');
  if (j.seccion !== id) throw new Error(`El archivo es de la página «${j.seccion === 'all' ? 'configuración completa' : SECTIONS[j.seccion]?.label || j.seccion}», no de esta`);
  return j.datos;
}

// ---------- Pedidos, estadísticas y máscaras: se exportan como carpetas ----------
async function copyDir(src, dest, filter = () => true) {
  let n = 0;
  if (!fs.existsSync(src)) return 0;
  await fsp.mkdir(dest, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dest, e.name);
    if (e.isDirectory()) n += await copyDir(a, b, filter);
    else if (filter(e.name)) { await fsp.copyFile(a, b); n++; }
  }
  return n;
}
const DIRS = { orders: 'pedidos', stats: 'estadisticas', masks: 'masks' };

export async function exportFolderSection(id, destRoot) {
  const name = { orders: 'Pedidos', stats: 'Estadisticas', masks: 'Mascaras' }[id];
  const dest = path.join(destRoot, `${name}_kiosco_${new Date().toISOString().slice(0, 10)}`);
  const n = await copyDir(dataDir(DIRS[id]), dest);
  return { dest, files: n };
}

/** Importa sin borrar nada: pedidos que no existan, líneas de estadística nuevas y máscaras PNG. */
export async function importFolderSection(id, srcRoot) {
  const target = dataDir(DIRS[id]);
  await fsp.mkdir(target, { recursive: true });
  let n = 0;
  if (id === 'orders') {
    for (const e of await fsp.readdir(srcRoot, { withFileTypes: true })) {
      if (!e.isDirectory() || !fs.existsSync(path.join(srcRoot, e.name, 'pedido.json'))) continue;
      if (fs.existsSync(path.join(target, e.name))) continue;
      await copyDir(path.join(srcRoot, e.name), path.join(target, e.name)); n++;
    }
    if (!n && fs.existsSync(path.join(srcRoot, 'pedido.json'))) throw new Error('Elige la carpeta que contiene las carpetas de los pedidos');
  } else if (id === 'stats') {
    for (const f of (await fsp.readdir(srcRoot)).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x))) {
      const mine = path.join(target, f);
      const have = new Set(fs.existsSync(mine) ? (await fsp.readFile(mine, 'utf8')).split('\n').filter(Boolean) : []);
      const add = (await fsp.readFile(path.join(srcRoot, f), 'utf8')).split('\n').filter((l) => l && !have.has(l));
      if (add.length) { await fsp.appendFile(mine, add.join('\n') + '\n'); n += add.length; }
    }
  } else if (id === 'masks') {
    for (const f of (await fsp.readdir(srcRoot)).filter((x) => /\.png$/i.test(x))) { await fsp.copyFile(path.join(srcRoot, f), path.join(target, f)); n++; }
  }
  return { imported: n };
}
