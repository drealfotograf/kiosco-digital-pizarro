// Copia de seguridad del kiosco (Ajustes → Copia de seguridad).
// - Programada: los días y la franja horaria elegidos (por defecto, todos los días de 14:00 a 16:00), una vez al día.
// - Partes: ajustes, pedidos (con sus fotos y tickets pendientes), estadísticas y máscaras.
// - Completa o incremental: la incremental solo copia lo que ha cambiado desde la anterior; su manifest.json
//   apunta, para cada archivo, a la copia que lo contiene. Cada 7 días se hace una completa.
// - Destino: una carpeta del servidor (por ejemplo \\SERVIDOR\Copias), elegida por el administrador.
// - Se conservan 15 días; después se borra la más antigua, salvo que una copia posterior aún dependa de ella.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings, saveSettings, dataDir } from './config.js';

export const PARTS = {
  settings: { label: 'Ajustes', items: ['settings.json', 'order-counter.txt'] },
  orders: { label: 'Pedidos y fotos', items: ['pedidos', 'tickets-pendientes', 'orders.log.jsonl'] },
  stats: { label: 'Estadísticas', items: ['estadisticas'] },
  masks: { label: 'Máscaras', items: ['masks'] }
};
const statusFile = () => dataDir('copia-seguridad.json');
const cfg = () => ({ enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '14:00', to: '16:00', parts: { settings: true, orders: true, stats: true, masks: true }, mode: 'incremental', folder: '', keepDays: 15, fullEvery: 7, ...(getSettings().backup || {}) });
const safe = (t) => String(t || 'Kiosco').replace(/[^\w-]+/g, '_').slice(0, 40);
const rootDir = (c = cfg()) => path.join(c.folder, `KioscoPizarro_${safe(getSettings().kioskName || getSettings().storeName)}`);

export function backupStatus() {
  try { return JSON.parse(fs.readFileSync(statusFile(), 'utf8')); } catch { return {}; }
}
function setStatus(patch) {
  const st = { ...backupStatus(), ...patch };
  try { fs.writeFileSync(statusFile(), JSON.stringify(st, null, 2)); } catch { /* sin disco */ }
  return st;
}

/** Archivos del kiosco de las partes elegidas: ruta relativa → { abs, size, mtime }. */
async function collect(parts) {
  const out = {};
  const walk = async (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    const st = await fsp.stat(abs);
    if (st.isDirectory()) { for (const e of await fsp.readdir(abs)) await walk(path.join(abs, e), `${rel}/${e}`); }
    else out[rel] = { abs, size: st.size, mtime: Math.floor(st.mtimeMs) };
  };
  for (const [p, on] of Object.entries(parts)) if (on && PARTS[p]) for (const item of PARTS[p].items) await walk(dataDir(item), `${p}/${item}`);
  return out;
}

export async function listBackups(c = cfg()) {
  const root = rootDir(c);
  if (!c.folder || !fs.existsSync(root)) return [];
  const out = [];
  for (const name of (await fsp.readdir(root)).sort()) {
    const mf = path.join(root, name, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    try {
      const m = JSON.parse(await fsp.readFile(mf, 'utf8'));
      out.push({ name, at: m.at, mode: m.mode, parts: m.parts, files: Object.keys(m.files).length, copied: m.copied, bytes: m.bytes, base: m.base || null });
    } catch { /* copia dañada: se ignora */ }
  }
  return out;
}

const readManifest = async (root, name) => JSON.parse(await fsp.readFile(path.join(root, name, 'manifest.json'), 'utf8'));

/** Hace una copia ahora. forceMode: 'full' | 'incremental' (si no, la del ajuste). */
export async function runBackup({ forceMode, reason = 'manual' } = {}) {
  const c = cfg();
  if (!c.folder) throw new Error('Elige primero la carpeta del servidor donde guardar las copias.');
  const root = rootDir(c);
  await fsp.mkdir(root, { recursive: true });
  const prevList = await listBackups(c);
  const prev = prevList.at(-1);
  const lastFull = [...prevList].reverse().find((b) => b.mode === 'completa');
  const samePart = prev && JSON.stringify(prev.parts) === JSON.stringify(c.parts);
  const fullDue = !lastFull || Date.now() - new Date(lastFull.at).getTime() > (c.fullEvery || 7) * 86400_000;
  const mode = forceMode === 'full' || c.mode === 'full' || !prev || !samePart || fullDue ? 'completa' : 'incremental';
  const now = new Date();
  const name = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}_${mode}`;
  const dest = path.join(root, name);
  const prevIndex = mode === 'incremental' ? (await readManifest(root, prev.name)).files : {};
  setStatus({ running: true, started: now.toISOString() });
  try {
    const files = await collect(c.parts);
    const index = {};
    let copied = 0, bytes = 0;
    for (const [rel, f] of Object.entries(files)) {
      const old = prevIndex[rel];
      if (old && old.size === f.size && old.mtime === f.mtime && fs.existsSync(path.join(root, old.in, ...rel.split('/')))) { index[rel] = old; continue; }
      const to = path.join(dest, ...rel.split('/'));
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.copyFile(f.abs, to);
      index[rel] = { size: f.size, mtime: f.mtime, in: name };
      copied++; bytes += f.size;
    }
    await fsp.mkdir(dest, { recursive: true });
    await fsp.writeFile(path.join(dest, 'manifest.json'), JSON.stringify({ at: now.toISOString(), mode, reason, parts: c.parts, base: mode === 'incremental' ? prev.name : null, copied, bytes, files: index }, null, 2));
    const pruned = await pruneBackups(c);
    return setStatus({ running: false, lastRun: now.toISOString(), lastDay: now.toDateString(), lastOk: true, lastError: null, lastName: name, lastMode: mode, lastCopied: copied, lastFiles: Object.keys(index).length, lastBytes: bytes, pruned });
  } catch (e) {
    setStatus({ running: false, lastRun: now.toISOString(), lastDay: now.toDateString(), lastOk: false, lastError: e.message });
    throw e;
  }
}

/** Borra las copias de más de keepDays días que ya no necesita ninguna copia posterior. */
export async function pruneBackups(c = cfg()) {
  const root = rootDir(c);
  const list = await listBackups(c);
  const limit = Date.now() - (c.keepDays || 15) * 86400_000;
  const keep = list.filter((b) => new Date(b.at).getTime() >= limit);
  const needed = new Set();
  for (const b of keep) for (const f of Object.values((await readManifest(root, b.name)).files)) needed.add(f.in);
  const removed = [];
  for (const b of list) {
    if (new Date(b.at).getTime() >= limit || needed.has(b.name)) continue;
    await fsp.rm(path.join(root, b.name), { recursive: true, force: true });
    removed.push(b.name);
  }
  return removed;
}

/** Restaura de una copia las partes indicadas (los archivos de esas partes se sustituyen por los de la copia). */
export async function restoreBackup(name, parts) {
  const c = cfg();
  const root = rootDir(c);
  const m = await readManifest(root, name);
  let n = 0;
  for (const [rel, f] of Object.entries(m.files)) {
    const part = rel.split('/')[0];
    if (!parts.includes(part)) continue;
    const src = path.join(root, f.in, ...rel.split('/'));
    if (!fs.existsSync(src)) throw new Error(`Falta ${rel} en la copia ${f.in}`);
    const to = dataDir(...rel.split('/').slice(1));
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(src, to);
    n++;
  }
  // Los ajustes restaurados se recargan (conservando la carpeta y la programación de copias actuales).
  if (parts.includes('settings') && fs.existsSync(dataDir('settings.json'))) {
    const restored = JSON.parse(fs.readFileSync(dataDir('settings.json'), 'utf8'));
    saveSettings({ ...restored, backup: c });
  }
  return { restored: n };
}

/** Programación: comprueba cada minuto si toca hacer la copia de hoy. */
export function startBackupScheduler(log = () => {}) {
  const tick = async () => {
    const c = cfg();
    if (!c.enabled || !c.folder) return;
    const now = new Date();
    if (!c.days.includes(now.getDay())) return;
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (hm < c.from || hm >= c.to) return;
    const st = backupStatus();
    if (st.running || (st.lastDay === now.toDateString() && st.lastOk)) return;
    // Tras un fallo se reintenta cada 15 minutos dentro de la franja.
    if (st.lastDay === now.toDateString() && !st.lastOk && Date.now() - new Date(st.lastRun).getTime() < 15 * 60_000) return;
    try { const r = await runBackup({ reason: 'programada' }); log(`Copia de seguridad ${r.lastName}: ${r.lastCopied} archivo(s) copiados`); }
    catch (e) { log(`Copia de seguridad fallida: ${e.message}`); }
  };
  setTimeout(tick, 60_000);
  return setInterval(tick, 60_000);
}
