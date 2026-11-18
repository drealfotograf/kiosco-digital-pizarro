// Impresoras: papel que queda (contador por rollo), avisos y gestión de color (perfiles ICC).
//
// Papel: Windows no informa de las copias que quedan; el kiosco las cuenta. Al cambiar el rollo se indica cuál es
// (en la DNP DS620: 6x4", 5x7", 6x8" o 6x9") y cada impresión descuenta las unidades que gasta (en un rollo 6x8",
// una 10x15 gasta media hoja). Al quedar poco se avisa en el inicio (punto discreto) y por correo, una sola vez por rollo.
//
// Color: por impresora, «sRGB» (se envía sRGB y gestiona el driver) o «perfil» (el kiosco convierte a su perfil ICC
// y en el driver hay que desactivar la gestión de color). Con correcciones de brillo, contraste y saturación.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { getSettings, saveSettings, dataDir } from './config.js';
import { sendAlertMail } from './security.js';

const profilesDir = () => dataDir('perfiles');
const WIN_COLOR = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'spool', 'drivers', 'color');

// Consumibles: capacidad del rollo y unidades que gasta cada formato (por medidas de la copia, en mm).
export const MEDIA = {
  'ds620-6x4': { label: 'DNP DS620 · 6x4" (400 copias)', capacity: 400, uses: [[102, 152, 1], [51, 152, 0.5]] },
  'ds620-5x7': { label: 'DNP DS620 · 5x7" (230 copias)', capacity: 230, uses: [[127, 178, 1], [89, 127, 0.5]] },
  'ds620-6x8': { label: 'DNP DS620 · 6x8" (200 hojas, 400 de 10x15)', capacity: 200, uses: [[152, 203, 1], [102, 152, 0.5], [51, 152, 0.25]] },
  'ds620-6x9': { label: 'DNP DS620 · 6x9" (180 copias)', capacity: 180, uses: [[152, 229, 1], [102, 152, 0.5]] },
  custom: { label: 'Otro (hojas o copias)', capacity: 100, uses: [] }
};
const usesFor = (mediaId, wMm, hMm) => {
  const m = MEDIA[mediaId];
  const a = Math.min(wMm, hMm), b = Math.max(wMm, hMm);
  const u = m?.uses.find(([w, h]) => Math.abs(w - a) <= 3 && Math.abs(h - b) <= 3);
  return u ? u[2] : 1;
};
/** Copias que quedan de un formato con el rollo actual. */
const copiesLeft = (cfg, wMm, hMm) => Math.max(0, Math.floor((cfg.media.capacity - cfg.media.used) / usesFor(cfg.media.type, wMm, hMm)));

const defCfg = () => ({ color: 'srgb', profile: '', adjust: { brightness: 0, contrast: 0, saturation: 0 }, media: null });
export const printerCfg = (name) => ({ ...defCfg(), ...(getSettings().printerCfg?.[name] || {}) });
function setCfg(name, patch) {
  const s = getSettings();
  const all = { ...(s.printerCfg || {}) };
  all[name] = { ...defCfg(), ...(all[name] || {}), ...patch };
  saveSettings({ ...s, printerCfg: all });
  return all[name];
}

// ---------- Papel ----------
/** Rollo nuevo: tipo, capacidad (si es «otro») y aviso al quedar N copias. */
export function changeRoll(name, { type, capacity, warnAt }) {
  const m = MEDIA[type] || MEDIA.custom;
  return setCfg(name, { media: { type: MEDIA[type] ? type : 'custom', capacity: Math.max(1, Number(capacity) || m.capacity), used: 0, warnAt: Math.max(0, Number(warnAt ?? 40)), loadedAt: new Date().toISOString(), alerted: false } });
}

/** Descuenta una impresión del rollo; avisa por correo una vez al bajar del umbral. */
export async function consumePrint(name, { wMm, hMm, copies }) {
  const cfg = printerCfg(name);
  if (!cfg.media) return;
  const used = Math.round((cfg.media.used + usesFor(cfg.media.type, wMm, hMm) * Math.max(1, copies | 0)) * 100) / 100;
  const left = Math.max(0, cfg.media.capacity - used);
  const media = { ...cfg.media, used };
  if (left <= cfg.media.warnAt && !cfg.media.alerted) {
    media.alerted = true;
    sendAlertMail(`Kiosco: queda poco papel en ${name}`,
      `A la impresora «${name}» le quedan unas ${Math.floor(left)} copias (${MEDIA[cfg.media.type]?.label || 'rollo'}).\r\nCambia el rollo y anótalo en Ajustes → Impresoras → «Rollo nuevo».`).catch(() => {});
  }
  setCfg(name, { media });
}

/** Estado de todas las impresoras con contador: lo que queda y si hay que avisar. */
export function mediaStatus() {
  const out = [];
  for (const [name, c] of Object.entries(getSettings().printerCfg || {})) {
    if (!c.media) continue;
    const cfg = { ...defCfg(), ...c };
    const left = Math.max(0, cfg.media.capacity - cfg.media.used);
    const level = left <= 0 ? 'empty' : left <= cfg.media.warnAt ? 'low' : 'ok';
    const formats = (MEDIA[cfg.media.type]?.uses || []).map(([w, h]) => ({ wMm: w, hMm: h, left: copiesLeft(cfg, w, h) }));
    out.push({ printer: name, media: cfg.media, mediaLabel: MEDIA[cfg.media.type]?.label || 'Otro', left: Math.floor(left), pct: Math.round((left / cfg.media.capacity) * 100), level, formats });
  }
  return out;
}

// ---------- Perfiles ICC ----------
/** Descripción de un perfil ICC (etiqueta «desc», v2 o v4). */
export function iccInfo(buf) {
  if (buf.length < 132 || buf.toString('ascii', 36, 40) !== 'acsp') return null;
  const cls = buf.toString('ascii', 12, 16), space = buf.toString('ascii', 16, 20).trim();
  const n = buf.readUInt32BE(128);
  let desc = '';
  for (let i = 0; i < n && 132 + i * 12 + 12 <= buf.length; i++) {
    const o = 132 + i * 12;
    if (buf.toString('ascii', o, o + 4) !== 'desc') continue;
    const off = buf.readUInt32BE(o + 4);
    const type = buf.toString('ascii', off, off + 4);
    if (type === 'desc') { const len = buf.readUInt32BE(off + 8); desc = buf.toString('latin1', off + 12, off + 12 + len).replace(/\0+$/, ''); }
    else if (type === 'mluc') { const sz = buf.readUInt32BE(off + 20), ro = buf.readUInt32BE(off + 24); desc = Buffer.from(buf.subarray(off + ro, off + ro + (sz & ~1))).swap16().toString('utf16le').replace(/\0+$/, ''); }
  }
  return { cls, space, desc };
}

async function scan(dir, source) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of await fsp.readdir(dir)) {
    if (!/\.(icc|icm)$/i.test(f)) continue;
    try {
      const fd = await fsp.open(path.join(dir, f));
      const { buffer } = await fd.read(Buffer.alloc(4096), 0, 4096, 0); await fd.close();
      const full = buffer.readUInt32BE(0) > 4096 ? await fsp.readFile(path.join(dir, f)) : buffer;
      const info = iccInfo(full);
      // Solo perfiles RGB de salida (impresoras): se descartan los de pantalla y los CMYK.
      if (info && info.space === 'RGB' && info.cls === 'prtr') out.push({ id: `${source}:${f}`, file: f, source, desc: info.desc || f });
    } catch { /* perfil dañado */ }
  }
  return out;
}
/** Perfiles disponibles: los cargados en el kiosco y los instalados en Windows (impresoras RGB). */
export async function listProfiles() {
  return [...(await scan(profilesDir(), 'kiosco')), ...(await scan(WIN_COLOR, 'windows'))];
}
/** Carga (copia) perfiles .icc/.icm en el kiosco tras comprobar que son válidos. */
export async function importProfiles(files) {
  await fsp.mkdir(profilesDir(), { recursive: true });
  const res = { added: [], skipped: [] };
  for (const f of files) {
    const buf = await fsp.readFile(f);
    const info = iccInfo(buf);
    if (!info) { res.skipped.push(`${path.basename(f)}: no es un perfil ICC`); continue; }
    if (info.space !== 'RGB') { res.skipped.push(`${path.basename(f)}: es ${info.space}, las impresoras de foto usan RGB`); continue; }
    await fsp.copyFile(f, path.join(profilesDir(), path.basename(f)));
    res.added.push(info.desc || path.basename(f));
  }
  return res;
}
const profilePath = (id) => {
  const [src, ...rest] = String(id).split(':');
  const f = path.basename(rest.join(':'));
  return src === 'windows' ? path.join(WIN_COLOR, f) : path.join(profilesDir(), f);
};

/**
 * Prepara el archivo para una impresora: correcciones y conversión a su perfil ICC.
 * Devuelve la ruta a imprimir (la original si la impresora está en sRGB y sin correcciones).
 */
export async function preparePrintFile(file, printer) {
  const cfg = printerCfg(printer);
  const a = cfg.adjust || {};
  const hasAdj = a.brightness || a.contrast || a.saturation;
  const useProfile = cfg.color === 'profile' && cfg.profile && fs.existsSync(profilePath(cfg.profile));
  if (!hasAdj && !useProfile) return file;
  let img = sharp(file);
  if (a.brightness || a.saturation) img = img.modulate({ brightness: 1 + (a.brightness || 0) / 100, saturation: 1 + (a.saturation || 0) / 100 });
  if (a.contrast) { const k = 1 + a.contrast / 100; img = img.linear(k, 128 * (1 - k)); }
  // La conversión parte del perfil sRGB incrustado en la copia y se hace al perfil de la impresora.
  const meta = await sharp(file).metadata();
  // La densidad va primero: withMetadata después de withIccProfile volvería a poner el perfil de entrada.
  img = img.withMetadata({ density: meta.density || 300 });
  img = useProfile ? img.withIccProfile(profilePath(cfg.profile)) : img.withIccProfile('srgb');
  const out = file.replace(/\.jpe?g$/i, '') + `.${String(printer).replace(/[^\w-]+/g, '_').slice(0, 30)}.jpg`;
  await img.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(out);
  return out;
}

export function setPrinterColor(name, { color, profile, adjust }) {
  return setCfg(name, { color: color === 'profile' ? 'profile' : 'srgb', profile: String(profile || ''), adjust: { brightness: Number(adjust?.brightness) || 0, contrast: Number(adjust?.contrast) || 0, saturation: Number(adjust?.saturation) || 0 } });
}
