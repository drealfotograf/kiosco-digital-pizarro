import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings, dataDir } from './config.js';
import { getSession, makeCode } from './session.js';
import { renderPhotoBuffer, saveJpeg, renderIdSheets, renderPrint, renderLotSheet } from './render.js';
import { enqueuePrint, pickPrinter, printersFor } from './print.js';
import { sendOrDefer, exportRelPaths } from './lab.js';
import crypto from 'node:crypto';
import { saveOrder, getOrder, updateOrder, storedPhotos, orderDir, findHeld, deleteOrder, photoIdsOf, listOrders, dropOriginals } from './store.js';
import { makeTicket, printTicket, sendTicket, ticketStatus } from './ticket.js';
import { checkGate } from './security.js';
import { logEvent } from './stats.js';

/** Datos anónimos de un pedido para las estadísticas. */
function orderStat(order, files, status, serverFiles = []) {
  const sizes = {}, amounts = {}, server = {}, qtyById = {};
  for (const f of files || []) if (f.size?.id && f.lotPrice == null) qtyById[f.size.id] = (qtyById[f.size.id] || 0) + (f.qty || 1);
  for (const f of files || []) {
    const q = f.qty || 1;
    sizes[f.sizeName] = (sizes[f.sizeName] || 0) + q;
    // Importe por tamaño: lotes a su precio; copias con el precio del tramo que corresponde a la cantidad total de ese tamaño.
    const unit = f.lotPrice != null ? f.lotPrice : priceFor(f.size, qtyById[f.size?.id] || q);
    amounts[f.sizeName] = Math.round(((amounts[f.sizeName] || 0) + unit * q) * 100) / 100;
  }
  for (const f of serverFiles) server[f.sizeName] = (server[f.sizeName] || 0) + (f.qty || 1);
  return { orderNo: order.orderNo, kind: order.kind, total: order.total, copies: Object.values(sizes).reduce((a, b) => a + b, 0), sizes, amounts, server, status };
}
import { frameDims, sheetLayout, packSheets } from '../shared/layout.js';
import { priceFor, sizeOutput } from '../shared/presets.js';

function nextOrderNo() {
  const f = dataDir('order-counter.txt');
  let n = 0;
  try { n = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch { /* nuevo */ }
  n += 1;
  fs.writeFileSync(f, String(n));
  const d = new Date();
  return `K${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(n).padStart(4, '0')}`;
}

function resolvePreset(spec) {
  const s = getSettings();
  if (spec.presetId === 'custom' && spec.custom) {
    const w = Number(spec.custom.w), h = Number(spec.custom.h);
    if (!(w >= 10 && w <= 200 && h >= 10 && h <= 200)) throw new Error('Medidas personalizadas no válidas');
    return { id: 'custom', name: `Personalizado ${w}x${h} mm`, w, h, price: Number(s.idPresets[0]?.price) || 0 };
  }
  const p = s.idPresets.find((x) => x.id === spec.presetId);
  if (!p) throw new Error('Formato de carnet no encontrado');
  return p;
}

const lotOf = (lotId) => getSettings().idLots.find((l) => l.id === lotId);
/** Copias efectivas de una persona: las del lote si tiene uno. */
const copiesOf = (p) => Math.max(1, (lotOf(p.lotId)?.photos ?? p.copies) | 0);

/** Presupuesto calculado en el proceso principal (los precios no se fían de la interfaz). */
export function quote(spec) {
  const s = getSettings();
  if (spec.kind === 'idlots') {
    // Lotes de carné: precio del lote × número de copias de ese lote.
    let total = 0, sheets = 0;
    for (const l of spec.lots) {
      const lot = s.idLotTypes.find((t) => t.id === l.lotId);
      if (!lot) throw new Error('Ese tipo de lote ya no está disponible');
      const n = Math.max(1, l.copies | 0);
      total += (Number(lot.price) || 0) * n;
      sheets += n;
    }
    return { total, sheets, count: sheets };
  }
  if (spec.kind === 'id') {
    const preset = resolvePreset(spec);
    const sheet = s.sheets.find((x) => x.id === spec.sheetId) || s.sheets[0];
    const layout = sheetLayout(sheet, preset, spec.gapMm ?? s.idDefaults.gapMm, spec.marginMm ?? s.idDefaults.marginMm);
    const sheets = packSheets(spec.people.map((p, i) => ({ id: i, copies: copiesOf(p) })), layout.capacity, !!spec.separateSheets);
    // Personas con lote: precio cerrado del lote. Sin lote: por hojas que ocupan.
    let total = 0;
    let loose = 0;
    for (const p of spec.people) { const lot = lotOf(p.lotId); if (lot) total += Number(lot.price) || 0; else loose += copiesOf(p); }
    if (loose && layout.capacity) total += Math.ceil(loose / layout.capacity) * (preset.price || 0);
    return { total, sheets: sheets.length, capacity: layout.capacity, count: spec.people.reduce((a, p) => a + copiesOf(p), 0) };
  }
  const qtyBySize = {};
  for (const it of spec.items) qtyBySize[it.sizeId] = (qtyBySize[it.sizeId] || 0) + Math.max(1, it.qty | 0);
  let total = 0;
  for (const [sizeId, qty] of Object.entries(qtyBySize)) {
    const size = s.printSizes.find((x) => x.id === sizeId);
    if (size) total += priceFor(size, qty) * qty;
  }
  return { total, count: Object.values(qtyBySize).reduce((a, b) => a + b, 0) };
}

/** Renderiza el pedido en outDir. photos: mapa id → foto. Devuelve la lista de archivos a imprimir/enviar. */
async function renderOrder(spec, photos, outDir, progress) {
  const s = getSettings();
  const dpi = s.dpi || 300;
  await fsp.mkdir(outDir, { recursive: true });
  const files = [];
  if (spec.kind === 'idlots') {
    const sheetSize = s.printSizes.find((x) => x.id === '10x15') || s.printSizes.find((x) => Math.abs(x.w - 102) < 2 && Math.abs(x.h - 152) < 2) || { id: '10x15', name: '10 x 15 cm', printers: [] };
    let i = 0;
    for (const l of spec.lots) {
      i++;
      const lot = s.idLotTypes.find((t) => t.id === l.lotId);
      const photo = photos[l.photoId];
      if (!lot || !photo) throw new Error('Lote o foto no encontrados');
      progress({ text: `Preparando lote ${i} de ${spec.lots.length}…` });
      const { buf } = await renderLotSheet(photo, l, lot, dpi);
      const file = path.join(outDir, `${String(i).padStart(3, '0')}_carnet_${lot.id}.jpg`);
      await saveJpeg(buf, file, dpi, true);
      files.push({ file, sizeName: `Carnet ${lot.name}`, wMm: 102, hMm: 152, qty: Math.max(1, l.copies | 0), size: sheetSize, lotPrice: Number(lot.price) || 0, original: `${path.basename(photo.name || 'foto', path.extname(photo.name || ''))} ${lot.name}` });
    }
    return files;
  }
  if (spec.kind === 'id') {
    const preset = resolvePreset(spec);
    const sheet = s.sheets.find((x) => x.id === spec.sheetId) || s.sheets[0];
    const gapMm = spec.gapMm ?? s.idDefaults.gapMm;
    const marginMm = spec.marginMm ?? s.idDefaults.marginMm;
    const people = spec.people.map((p) => {
      if (!photos[p.photoId]) throw new Error('Foto no encontrada');
      return { photo: photos[p.photoId], crop: p.crop, adjust: p.adjust, angle: p.angle, copies: copiesOf(p) };
    });
    const layout = sheetLayout(sheet, preset, gapMm, marginMm);
    if (!layout.capacity) throw new Error('El formato no cabe en la hoja elegida');
    const sheets = packSheets(people.map((p, i) => ({ id: i, copies: p.copies })), layout.capacity, !!spec.separateSheets);
    progress({ text: 'Preparando hojas de carnet…' });
    const { outputs } = await renderIdSheets({ people, sheets, preset, sheet, gapMm, marginMm, guides: spec.guides || 'marks', dpi, outDir });
    const name = `Carnet ${preset.name} en ${sheet.name}`;
    const printSize = s.printSizes.find((x) => Math.abs(x.w - sheet.w) < 2 && Math.abs(x.h - sheet.h) < 2) || { id: `sheet-${sheet.id}`, name, printers: [] };
    for (const f of outputs) files.push({ file: f, sizeName: name, wMm: sheet.w, hMm: sheet.h, qty: 1, size: printSize });
    return files;
  }
  let i = 0;
  for (const it of spec.items) {
    i++;
    const size = s.printSizes.find((x) => x.id === it.sizeId);
    const photo = photos[it.photoId];
    if (!size) throw new Error('Un tamaño del pedido ya no existe en las tarifas');
    if (!photo) throw new Error('Foto no encontrada');
    progress({ text: `Preparando foto ${i} de ${spec.items.length}…` });
    // Papel completo: foto, borde o Polaroid, línea de corte y texto/escritura a mano.
    const { buf } = await renderPrint(photo, it, size, dpi);
    const file = path.join(outDir, `${String(i).padStart(3, '0')}_${size.id}_x${it.qty}.jpg`);
    await saveJpeg(buf, file, dpi, true);
    files.push({ file, sizeName: size.name, wMm: size.w, hMm: size.h, qty: Math.max(1, it.qty | 0), size, original: photo.name });
  }
  return files;
}

/** Renderiza e imprime o envía. Actualiza el estado del pedido guardado (impreso / enviado / con error). */
async function deliver(order, photos, progress) {
  const s = getSettings();
  const outDir = path.join(orderDir(order.orderNo), 'salida');
  try {
    await updateOrder(order.orderNo, { status: 'processing', error: null });
    const files = await renderOrder(order.spec, photos, outDir, progress);
    // Qué hacer con cada copia: 'auto' sigue la salida de su tamaño (o la general); 'print' y 'lab' fuerzan una sola acción.
    const outOf = (f) => (order.destination === 'lab' ? 'server' : order.destination === 'print' ? 'print' : sizeOutput(f.size, s));
    const printFiles = files.filter((f) => ['print', 'both'].includes(outOf(f)));
    const serverFiles = files.filter((f) => ['server', 'both'].includes(outOf(f)));
    if (!printFiles.length && !serverFiles.length) throw new Error('No hay ninguna salida activada (imprimir o enviar al servidor). Revisa los ajustes.');
    const result = { printed: false, server: null };
    if (printFiles.length) {
      const jobs = [];
      for (const f of printFiles) {
        const printer = pickPrinter(f.size);
        if (!printer) throw new Error(`No hay impresora asignada para ${f.sizeName}.`);
        progress({ text: `Enviando a ${printer}…` });
        jobs.push(enqueuePrint(f.file, { printer, wMm: f.wMm, hMm: f.hMm, copies: f.qty, useDriverPaper: f.size.useDriverPaper })
          .then(() => logEvent('print', { printer, sizeId: f.size?.id, sizeName: f.sizeName, wMm: f.wMm, hMm: f.hMm, copies: f.qty })));
      }
      await Promise.all(jobs);
      result.printed = true;
    }
    if (serverFiles.length) {
      progress({ text: 'Enviando al servidor…' });
      const rels = exportRelPaths(order.orderNo, order.createdAt, serverFiles);
      const record = {
        orderNo: order.orderNo, createdAt: order.createdAt, kind: order.kind, destination: 'lab', customer: order.customer || {},
        total: order.total, currency: s.currency, store: s.storeName,
        items: serverFiles.map((f, i) => ({ file: path.basename(rels[i]), size: f.sizeName, wMm: f.wMm, hMm: f.hMm, qty: f.qty, original: f.original }))
      };
      // Si el servidor no responde, la copia queda en la ruta local alternativa y se reintenta sola.
      // Cada tamaño puede ir a su carpeta del servidor; si no tiene, a la carpeta por defecto (Impresión y envío).
      const groups = new Map();
      serverFiles.forEach((f, i) => { const d = f.size?.serverFolder || s.delivery?.serverFolder || ''; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(i); });
      const parts = [];
      for (const [dest, idx] of groups) {
        const rec = { ...record, items: idx.map((i) => record.items[i]) };
        parts.push({ dest, ...(await sendOrDefer(rec, idx.map((i) => serverFiles[i].file), idx.map((i) => rels[i]), dest)) });
      }
      result.server = parts.length === 1 ? parts[0] : {
        server: parts.every((p) => p.server), saved: parts.reduce((a, p) => a + (p.saved || 0), 0),
        where: parts.filter((p) => p.server).map((p) => p.where).join(' · '), local: parts.filter((p) => !p.server).map((p) => p.local).join(' · ') || undefined, parts
      };
    }
    await fsp.rm(outDir, { recursive: true, force: true });
    await fsp.appendFile(dataDir('orders.log.jsonl'), JSON.stringify({ orderNo: order.orderNo, at: new Date().toISOString(), destination: order.destination, total: order.total, result }) + '\n');
    const updated = await updateOrder(order.orderNo, { status: result.printed ? 'printed' : 'sent', error: null, delivery: result });
    logEvent('order', orderStat(order, files, result.printed ? 'printed' : 'sent', serverFiles));
    return { ...updated, delivery: result };
  } catch (e) {
    await updateOrder(order.orderNo, { status: 'error', error: e.message }).catch(() => {});
    logEvent('order', { orderNo: order.orderNo, kind: order.kind, total: order.total, copies: order.count, sizes: {}, status: 'error' });
    throw e;
  }
}

const sessionPhotos = () => Object.fromEntries((getSession()?.photos || []).map((p) => [p.id, p]));

/**
 * Pedido desde la sesión del cliente.
 * opts.resumeOf: código de un pedido retenido que se completa (se borra al terminar bien).
 * opts.reprocessOf: número del pedido original que se está reprocesando.
 */
export async function submitOrder(spec, progress = () => {}, opts = {}) {
  const s = getSettings();
  const { total, count } = quote(spec);
  const awaiting = needsPin(spec, s) && !opts.reprocessOf;
  const order = await saveOrder({
    orderNo: nextOrderNo(), status: awaiting ? 'awaiting' : 'processing', kind: spec.kind, destination: spec.destination || 'auto',
    customer: spec.customer || {}, spec: stripSpec(spec), total, count, currency: s.currency, reprocessOf: opts.reprocessOf || undefined,
    keepPhotos: spec.keepPhotos !== false,
    ...(awaiting ? { pin: String(crypto.randomInt(0, 1000)).padStart(3, '0'), pinTries: 0 } : {})
  }, sessionPhotos());
  if (opts.resumeOf) { const held = await findHeld(opts.resumeOf); if (held) await deleteOrder(held.orderNo); }
  // Ticket para pagar en caja (y para Gestión Pizarro).
  const ticket = s.ticket?.enabled !== false ? await issueTicket(order, progress) : null;
  if (awaiting) { logEvent('order', { orderNo: order.orderNo, kind: order.kind, total, copies: count, sizes: {}, status: 'awaiting' }); return { orderNo: order.orderNo, total, count, awaiting: true, ticket }; }
  let done;
  try {
    done = await deliver(order, storedPhotos(order), progress);
  } catch (e) {
    throw new Error(`${e.message} (el pedido ${order.orderNo} queda guardado en «Pedidos con error»)`);
  }
  await afterDelivery(order);
  return { orderNo: order.orderNo, total, count, delivery: done?.delivery, ticket };
}

const stripSpec = ({ destination, customer, keepPhotos, ...rest }) => rest;

/** ¿Este pedido necesita el PIN de caja para imprimirse? (Administración → Impresión y envío → PIN). */
export function needsPin(spec, s = getSettings()) {
  const p = s.pin || {};
  if (p.mode === 'all') return true;
  if (p.mode !== 'custom') return false;
  if (spec.kind === 'idlots' || spec.kind === 'id') return !!p.idlots;
  if (p.prints) return true;
  return (spec.items || []).some((i) => (p.sizes || []).includes(i.sizeId));
}

async function issueTicket(order, progress) {
  const t = makeTicket(order);
  progress({ text: 'Imprimiendo el ticket…' });
  let printed = null;
  try { printed = await printTicket(t); } catch (e) { printed = { error: e.message }; }
  const sent = await sendTicket(t, order.pin);
  await updateOrder(order.orderNo, { ticket: { ...t, printed, sent: sent.sent } });
  return { numero: t.numero, corto: t.corto, total: t.total, printed, sent: sent.sent };
}

/** Si el cliente no quiere que se guarden sus fotos, se borran al entregar el pedido. */
async function afterDelivery(order) {
  if (order.keepPhotos === false) await dropOriginals(order.orderNo).catch(() => {});
}

/**
 * Libera un pedido pendiente de pago: con el PIN de 3 cifras que dan en caja (máximo 5 intentos),
 * o sin PIN si lo hace el personal o si Gestión ha confirmado la venta.
 */
export async function releaseOrder(no, pin, progress = () => {}, { staff = false } = {}) {
  const o = await getOrder(no);
  if (!o) throw new Error('Pedido no encontrado');
  if (o.status !== 'awaiting') throw new Error(o.status === 'cancelled' ? 'Este pedido se ha anulado en caja' : 'Este pedido ya no está pendiente de pago');
  // PIN de caja: 5 fallos → bloqueo de 5 minutos o verificación con el móvil o el correo de la empresa.
  if (!staff) {
    try { checkGate(`order:${no}`, pin, o.pin); } catch (e) { await updateOrder(no, { pinTries: (o.pinTries || 0) + 1 }).catch(() => {}); throw e; }
  }
  const released = await updateOrder(no, { status: 'processing', releasedAt: new Date().toISOString(), releasedBy: staff ? 'personal' : 'pin' });
  const done = await deliver(released, storedPhotos(released), progress);
  await afterDelivery(released);
  return { orderNo: no, total: o.total, count: o.count, delivery: done.delivery };
}

/** Pedido pendiente por su número completo o por las últimas cifras del ticket. */
export async function findAwaiting(input) {
  const q = String(input || '').trim().toUpperCase();
  if (!q) return null;
  const list = await listOrders('awaiting');
  return list.find((o) => o.orderNo.toUpperCase() === q) || list.find((o) => o.orderNo.split('-').pop().replace(/^0+/, '') === q.replace(/^0+/, '')) || null;
}

/** Consulta al servidor los tickets pendientes: venta confirmada → se imprime; anulada → se anula el pedido. */
let polling = false;
export async function pollTickets(log = () => {}) {
  if (polling) return;
  polling = true;
  try {
    for (const o of await listOrders('awaiting')) {
      const estado = await ticketStatus(o.orderNo);
      if (estado === 'pagado') {
        logEvent('paid', { orderNo: o.orderNo, total: o.total });
        try { await releaseOrder(o.orderNo, null, () => {}, { staff: true }); log(`Pedido ${o.orderNo}: venta confirmada, se imprime`); } catch (e) { log(`Pedido ${o.orderNo}: ${e.message}`); }
      } else if (estado === 'anulado') {
        await updateOrder(o.orderNo, { status: 'cancelled' });
        logEvent('order', { orderNo: o.orderNo, kind: o.kind, total: o.total, copies: o.count, sizes: {}, status: 'cancelled' });
        log(`Pedido ${o.orderNo}: venta anulada en caja`);
      }
    }
  } finally { polling = false; }
}

/** Estado actual de un pedido (para la pantalla de espera del PIN). */
export async function orderState(no) {
  const o = await getOrder(no);
  return o ? { status: o.status, delivery: o.delivery || null, total: o.total } : null;
}

/** Retener un pedido sin terminar: guarda originales y ajustes; devuelve un código para continuarlo. */
export async function holdOrder(spec, customer = {}, existingCode) {
  const s = getSettings();
  let code = existingCode && (await findHeld(existingCode)) ? existingCode : makeCode(6);
  const prev = existingCode ? await findHeld(existingCode) : null;
  const orderNo = prev?.orderNo || `R-${code}`;
  const { total, count } = quote(spec);
  if (prev) await fsp.rm(path.join(orderDir(orderNo), 'originales'), { recursive: true, force: true });
  await saveOrder({ orderNo, status: 'held', code, kind: spec.kind, customer, spec: stripSpec(spec), total, count, currency: s.currency, createdAt: prev?.createdAt }, sessionPhotos());
  return { code, orderNo };
}

/** Repetir un pedido guardado (todo, o solo los elementos indicados) como pedido nuevo. */
export async function repeatOrder(no, indexes, destination, progress = () => {}) {
  const old = await getOrder(no);
  if (!old) throw new Error('Pedido no encontrado');
  const listKey = old.kind === 'id' ? 'people' : old.kind === 'idlots' ? 'lots' : 'items';
  const list = old.spec[listKey];
  const pick = indexes?.length ? list.filter((_, i) => indexes.includes(i)) : list;
  if (!pick.length) throw new Error('No hay nada seleccionado para repetir');
  const spec = { ...old.spec, [listKey]: pick };
  const { total, count } = quote(spec);
  const photos = storedPhotos(old);
  const order = await saveOrder({
    orderNo: nextOrderNo(), status: 'processing', kind: old.kind, destination, customer: old.customer,
    spec, total, count, currency: getSettings().currency, repeatOf: old.orderNo
  }, Object.fromEntries(photoIdsOf(spec).map((id) => [id, photos[id]])));
  const done = await deliver(order, storedPhotos(order), progress);
  return { orderNo: order.orderNo, total, count, delivery: done.delivery };
}

/** Reintentar un pedido con error tal cual. */
export async function retryOrder(no, progress = () => {}) {
  const o = await getOrder(no);
  if (!o) throw new Error('Pedido no encontrado');
  await deliver(o, storedPhotos(o), progress);
  return { orderNo: o.orderNo };
}

/** Qué tamaños se pueden imprimir en el kiosco. */
export function printableSizes() {
  return getSettings().printSizes.filter((x) => printersFor(x).length).map((x) => x.id);
}
