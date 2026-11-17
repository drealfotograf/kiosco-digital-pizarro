// Almacén de pedidos del kiosco. Cada pedido es una carpeta:
//   pedidos/<número>/originales/<idFoto>.<ext>   ← originales del cliente
//   pedidos/<número>/pedido.json                 ← todos los ajustes elegidos (tamaño, copias, encuadre, filtros…)
// Con eso el programa puede continuar, repetir (todo o parte) o reprocesar el pedido.
// Estados: 'held' (sin terminar), 'sent' (enviado al servidor), 'printed' (impreso), 'error' (con error).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dataDir, getSettings } from './config.js';

export const STATUS_LABEL = { held: 'Sin terminar', sent: 'Enviado', printed: 'Impreso', error: 'Con error', processing: 'Procesando' };
const root = () => dataDir('pedidos');
export const orderDir = (no) => path.join(root(), path.basename(String(no)));

/** Fotos usadas por la especificación del pedido. */
export function photoIdsOf(spec) {
  return [...new Set((spec.kind === 'id' ? spec.people : spec.items).map((x) => x.photoId))];
}

/**
 * Guarda (o actualiza) un pedido. photos: mapa id → {src, name, w, h, origin}.
 * Copia los originales que aún no estén en la carpeta del pedido.
 */
export async function saveOrder(record, photos) {
  const dir = orderDir(record.orderNo);
  await fsp.mkdir(path.join(dir, 'originales'), { recursive: true });
  const list = [];
  for (const id of photoIdsOf(record.spec)) {
    const p = photos[id];
    if (!p) throw new Error('Falta una foto del pedido');
    const file = `${id}${path.extname(p.src).toLowerCase() || '.jpg'}`;
    const dest = path.join(dir, 'originales', file);
    if (!fs.existsSync(dest)) await fsp.copyFile(p.src, dest);
    list.push({ id, file, name: p.name, w: p.w, h: p.h, origin: p.origin });
  }
  const now = new Date().toISOString();
  const full = { createdAt: now, ...record, photos: list, updatedAt: now };
  const tmp = path.join(dir, 'pedido.json.tmp');
  await fsp.writeFile(tmp, JSON.stringify(full, null, 2));
  await fsp.rename(tmp, path.join(dir, 'pedido.json'));
  return full;
}

export async function getOrder(no) {
  try { return JSON.parse(await fsp.readFile(path.join(orderDir(no), 'pedido.json'), 'utf8')); } catch { return null; }
}

export async function updateOrder(no, patch) {
  const o = await getOrder(no);
  if (!o) throw new Error('Pedido no encontrado');
  const next = { ...o, ...patch, updatedAt: new Date().toISOString() };
  await fsp.writeFile(path.join(orderDir(no), 'pedido.json'), JSON.stringify(next, null, 2));
  return next;
}

/** Mapa id → foto con la ruta del original guardado. */
export function storedPhotos(order) {
  const dir = path.join(orderDir(order.orderNo), 'originales');
  return Object.fromEntries(order.photos.map((p) => [p.id, { ...p, src: path.join(dir, p.file) }]));
}

export async function listOrders(status) {
  if (!fs.existsSync(root())) return [];
  const out = [];
  for (const d of await fsp.readdir(root())) {
    const o = await getOrder(d);
    if (!o || (status && o.status !== status)) continue;
    const ph = storedPhotos(o);
    out.push({
      orderNo: o.orderNo, status: o.status, statusLabel: STATUS_LABEL[o.status] || o.status, error: o.error, kind: o.kind,
      destination: o.destination, customer: o.customer, total: o.total, currency: o.currency, code: o.code,
      createdAt: o.createdAt, updatedAt: o.updatedAt, count: o.count,
      thumbs: o.photos.slice(0, 4).map((p) => ph[p.id].src)
    });
  }
  return out.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export async function deleteOrder(no) {
  await fsp.rm(orderDir(no), { recursive: true, force: true });
}

export async function findHeld(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;
  return (await listOrders('held')).find((o) => o.code === c) || null;
}

/** Borra pedidos con más antigüedad que la indicada en los ajustes (30 días por defecto). */
export async function purgeOrders() {
  const days = Math.max(1, Number(getSettings().ordersRetentionDays) || 30);
  const limit = Date.now() - days * 86400_000;
  let n = 0;
  for (const o of await listOrders()) {
    if (new Date(o.updatedAt || o.createdAt).getTime() < limit) { await deleteOrder(o.orderNo); n++; }
  }
  if (n) console.log(`Pedidos caducados borrados: ${n}`);
  return n;
}
