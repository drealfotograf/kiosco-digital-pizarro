import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings } from './config.js';

// ---------- Nombres de exportación ----------
// Carpeta del pedido: AAAA_MM_DD_Nº  ·  una subcarpeta por tamaño  ·  archivos AAAA_MM_DD_Nº_NombreFoto.jpeg
// Si una foto lleva más de una copia, el número va entre paréntesis: AAAA_MM_DD_Nº_NombreFoto_(2).jpeg
const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'foto';

export function exportNames(orderNo, createdAt) {
  const d = new Date(createdAt || Date.now());
  const date = `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getDate()).padStart(2, '0')}`;
  const num = String(orderNo).split('-').pop();
  return { folder: `${date}_${num}`, prefix: `${date}_${num}` };
}

/** Ruta relativa de cada archivo dentro del envío: carpeta/tamaño/archivo.jpeg (sin repetir nombres). */
export function exportRelPaths(orderNo, createdAt, files) {
  const { folder, prefix } = exportNames(orderNo, createdAt);
  const used = new Set();
  return files.map((f) => {
    const base = clean(path.basename(f.original || 'foto', path.extname(f.original || '')));
    let name = `${prefix}_${base}${f.qty > 1 ? `_(${f.qty})` : ''}`;
    const dir = clean(f.sizeName);
    let n = 2;
    while (used.has(`${dir}/${name}`.toLowerCase())) name = `${prefix}_${base}-${n++}${f.qty > 1 ? `_(${f.qty})` : ''}`;
    used.add(`${dir}/${name}`.toLowerCase());
    return `${folder}/${dir}/${name}.jpeg`;
  });
}

/** Envío al servidor. Devuelve la confirmación del servidor (número de archivos guardados y ruta). */
export async function sendToLab(record, files, rels, dest) {
  const s = getSettings();
  const lab = s.lab;
  if (lab.mode === 'folder') {
    // Carpeta compartida del laboratorio (sin servidor): misma estructura de carpetas y nombres.
    if (!lab.folder) throw new Error('No se ha configurado la carpeta del laboratorio');
    for (const [i, f] of files.entries()) {
      const dest = path.join(lab.folder, ...rels[i].split('/'));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(f, dest);
    }
    const dir = path.join(lab.folder, rels[0].split('/')[0]);
    await fsp.writeFile(path.join(dir, 'pedido.txt'), summaryText(record));
    return { ok: true, saved: files.length, where: dir };
  }
  const url = lab.serverUrl.replace(/\/+$/, '') + '/api/orders';
  const form = new FormData();
  form.append('manifest', JSON.stringify(record));
  form.append('dest', dest || s.delivery?.serverFolder || '');
  form.append('paths', JSON.stringify(rels));
  for (const [i, f] of files.entries()) form.append('files', await fs.openAsBlob(f, { type: 'image/jpeg' }), path.basename(rels[i]));
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form, headers: { 'x-kiosk-key': lab.kioskKey || '' }, signal: AbortSignal.timeout(10 * 60_000) });
  } catch {
    throw new Error('No se puede conectar con el servidor.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `El servidor respondió ${res.status}`);
  // Confirmación: el servidor debe haber guardado todos los archivos.
  if ((body.exported?.saved ?? files.length) !== files.length) throw new Error(`El servidor solo confirmó ${body.exported?.saved} de ${files.length} archivos`);
  return { ok: true, saved: body.exported?.saved ?? files.length, where: body.exported?.where || '' };
}

/**
 * Envía al servidor y, si no responde, guarda el pedido en la ruta local alternativa para reintentarlo.
 * Devuelve { server: true, where, saved } o { server: false, local, reason }.
 */
export async function sendOrDefer(record, files, rels, dest) {
  try {
    const r = await sendToLab(record, files, rels, dest);
    return { server: true, where: r.where, saved: r.saved };
  } catch (e) {
    const s = getSettings();
    const root = path.join(s.delivery?.localFallback || 'C:\\KioscoPizarro\\Pendientes', clean(dest || s.delivery?.serverFolder || 'Servidor'));
    for (const [i, f] of files.entries()) {
      const dest = path.join(root, ...rels[i].split('/'));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(f, dest);
    }
    const dir = path.join(root, rels[0].split('/')[0]);
    await fsp.writeFile(path.join(dir, 'pendiente.json'), JSON.stringify({ record, rels, dest: dest || s.delivery?.serverFolder || '', reason: e.message, at: new Date().toISOString() }, null, 2));
    // Comprobación de la copia local.
    const ok = rels.every((r) => fs.existsSync(path.join(root, ...r.split('/'))));
    if (!ok) throw new Error(`No se pudo enviar al servidor (${e.message}) ni guardar la copia local en ${dir}`);
    return { server: false, local: dir, reason: e.message };
  }
}

/** Reintenta los envíos pendientes guardados en la ruta local. Los que se confirman se borran del disco local. */
let retrying = false;
export async function retryPending(log = () => {}) {
  if (retrying) return 0;
  retrying = true;
  let sent = 0;
  try {
    const base = getSettings().delivery?.localFallback;
    if (!base || !fs.existsSync(base)) return 0;
    for (const dest of await fsp.readdir(base)) {
      const destDir = path.join(base, dest);
      if (!(await fsp.stat(destDir)).isDirectory()) continue;
      for (const folder of await fsp.readdir(destDir)) {
        const dir = path.join(destDir, folder);
        const marker = path.join(dir, 'pendiente.json');
        if (!fs.existsSync(marker)) continue;
        try {
          const { record, rels, dest: saved } = JSON.parse(await fsp.readFile(marker, 'utf8'));
          const files = rels.map((r) => path.join(destDir, ...r.split('/')));
          await sendToLab(record, files, rels, saved || dest);
          await fsp.rm(dir, { recursive: true, force: true });
          sent++;
          log(`Pedido ${record.orderNo} enviado al servidor desde la copia local`);
        } catch { /* sigue sin conexión: se probará más tarde */ }
      }
    }
  } finally { retrying = false; }
  return sent;
}

export function startRetryLoop(log) {
  const minutes = Math.max(1, Number(getSettings().delivery?.retryMinutes) || 5);
  setTimeout(() => retryPending(log), 30_000);
  return setInterval(() => retryPending(log), minutes * 60_000);
}

export function summaryText(r) {
  const lines = [
    `Pedido ${r.orderNo}  ·  ${new Date(r.createdAt).toLocaleString('es-ES')}`,
    `Cliente: ${r.customer?.name || '-'}   Tel: ${r.customer?.phone || '-'}`,
    `Total: ${Number(r.total || 0).toFixed(2)} ${r.currency || '€'}`,
    '',
    ...r.items.map((i) => `${i.qty} x ${i.size}   ${i.file}`)
  ];
  return lines.join('\r\n');
}

export async function testLab() {
  const lab = getSettings().lab;
  if (lab.mode === 'folder') {
    try { await fsp.access(lab.folder, fs.constants.W_OK); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  try {
    const r = await fetch(lab.serverUrl.replace(/\/+$/, '') + '/api/ping', { headers: { 'x-kiosk-key': lab.kioskKey || '' }, signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return j.ok ? { ok: true } : { ok: false, error: j.error || 'Clave del kiosco incorrecta' };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Carpetas de destino disponibles en el servidor (para elegir en Administración). */
export async function serverFolders() {
  const lab = getSettings().lab;
  const r = await fetch(lab.serverUrl.replace(/\/+$/, '') + '/api/export/folders', { headers: { 'x-kiosk-key': lab.kioskKey || '' }, signal: AbortSignal.timeout(6000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'El servidor no responde');
  return j;
}
