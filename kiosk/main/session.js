import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir } from './config.js';
import { readable, makeDerivatives, orientedSize, checkContent } from './images.js';
import { checkFileName, RAW_EXT } from '../shared/presets.js';

// Una sesión = un cliente. Al terminar se borran sus fotos del kiosco
// (los pedidos guardan aparte su propia copia de los originales, ver store.js).
let session = null;
let notify = () => {};
let queue = Promise.resolve();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = (n = 5) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

export function setNotifier(fn) { notify = fn; }
export const emit = (ch, payload) => notify(ch, payload);
export const getSession = () => session;
export const sessionView = () => session && { id: session.id, code: session.code, startedAt: session.startedAt, photos: session.photos, importing: session.importing };

export async function newSession() {
  await clearSession();
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const dir = dataDir('sessions', id);
  for (const d of ['orig', 'inbox', 'work']) await fsp.mkdir(path.join(dir, d), { recursive: true });
  session = { id, code: makeCode(5), dir, photos: [], keys: new Map(), startedAt: Date.now(), importing: 0 };
  notify('session', sessionView());
  return sessionView();
}

export async function clearSession() {
  const old = session;
  session = null;
  if (old) {
    await queue.catch(() => {});
    await fsp.rm(old.dir, { recursive: true, force: true }).catch(() => {});
  }
  notify('session', null);
}

/** Limpia sesiones antiguas que hayan quedado tras un cierre inesperado. */
export async function purgeStaleSessions() {
  const root = dataDir('sessions');
  if (!fs.existsSync(root)) return;
  for (const d of await fsp.readdir(root)) {
    if (!session || d !== session.id) await fsp.rm(path.join(root, d), { recursive: true, force: true }).catch(() => {});
  }
}

export const inboxDir = (sub = '') => {
  if (!session) throw new Error('No hay sesión activa');
  const d = path.join(session.dir, 'inbox', sub);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
export const workDir = () => path.join(session.dir, 'work');

const issue = (name, reason) => { notify('import-issue', { name, reason }); return { issue: { name, reason } }; };

/**
 * Importa archivos a la sesión: comprueba extensión y contenido, copia el original, convierte HEIC
 * y crea las vistas previas. Devuelve un resultado por archivo, en el mismo orden: {photo} o {issue}.
 * Los duplicados devuelven la foto ya importada.
 */
export function importFiles(paths, origin, names = []) {
  if (!session) return Promise.reject(new Error('No hay sesión activa'));
  const s = session;
  s.importing += paths.length;
  notify('session', sessionView());
  const job = queue.then(async () => {
    const results = [];
    for (const [i, src] of paths.entries()) {
      try {
        if (session !== s) { results.push({ issue: { name: path.basename(src), reason: 'Sesión terminada' } }); continue; }
        const name = names[i] || path.basename(src);
        const byName = checkFileName(path.basename(src));
        if (!byName.ok) { results.push(issue(name, byName.reason)); continue; }
        const bad = await checkContent(src);
        if (bad) { results.push(issue(name, bad)); continue; }
        const st = await fsp.stat(src);
        const key = `${name.toLowerCase()}|${st.size}`;
        if (s.keys.has(key)) { results.push({ photo: s.keys.get(key) }); continue; }
        const id = crypto.randomBytes(6).toString('hex');
        const photo = await importOne(s, src, id, name, origin);
        s.keys.set(key, photo);
        results.push({ photo });
      } catch (err) {
        console.error('No se pudo importar', src, err.message);
        // Los motivos conocidos (p. ej. RAW sin vista previa) se muestran tal cual; el resto, como archivo dañado.
        results.push(issue(names[paths.indexOf(src)] || path.basename(src), /RAW|PDF/.test(err.message) ? err.message : 'El archivo está dañado o no es una imagen válida.'));
      } finally {
        s.importing = Math.max(0, s.importing - 1);
        if (session === s) notify('session', sessionView());
      }
    }
    return results;
  });
  queue = job.catch(() => {});
  return job;
}

async function importOne(s, src, id, name, origin) {
  const ext = path.extname(src).toLowerCase() || '.jpg';
  let orig = path.join(s.dir, 'orig', `${id}${ext}`);
  await fsp.copyFile(src, orig);
  if (ext === '.heic' || ext === '.heif' || RAW_EXT.includes(ext)) {
    const jpg = await readable(orig, path.join(s.dir, 'orig'));
    await fsp.rm(orig, { force: true });
    const final = path.join(s.dir, 'orig', `${id}.jpg`);
    await fsp.rename(jpg, final);
    orig = final;
  }
  const size = await orientedSize(orig);
  const der = await makeDerivatives(orig, path.join(s.dir, 'orig'), id);
  const photo = { id, name, origin, src: orig, ...der, w: size.w, h: size.h };
  s.photos.push(photo);
  return photo;
}

/** Restaura en la sesión las fotos de un pedido guardado conservando sus identificadores. */
export async function restorePhotos(list) {
  if (!session) throw new Error('No hay sesión activa');
  const s = session;
  const out = [];
  for (const p of list) {
    const existing = s.photos.find((x) => x.id === p.id);
    if (existing) { out.push(existing); continue; }
    out.push(await importOne(s, p.src, p.id, p.name, p.origin || 'Pedido guardado'));
  }
  notify('session', sessionView());
  return out;
}

export function removePhoto(id) {
  if (!session) return;
  session.photos = session.photos.filter((p) => p.id !== id);
  for (const [k, v] of session.keys) if (v.id === id) session.keys.delete(k);
  notify('session', sessionView());
}

export const findPhoto = (id) => session?.photos.find((p) => p.id === id);

/** Rutas a las que la interfaz puede acceder por el protocolo kimg:// */
export function isAllowedPath(p, extraRoots) {
  const strip = (x) => path.resolve(x).toLowerCase().replace(/[\\/]+$/, '');
  const norm = strip(p);
  const roots = [dataDir('cache'), dataDir('masks'), dataDir('pedidos'), ...(session ? [session.dir] : []), ...extraRoots];
  return roots.some((r) => { const root = strip(r); return norm === root || norm.startsWith(root + path.sep); });
}
