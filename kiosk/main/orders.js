import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings, dataDir } from './config.js';
import { getSession, makeCode } from './session.js';
import { renderPhotoBuffer, saveJpeg, renderIdSheets } from './render.js';
import { enqueuePrint, pickPrinter } from './print.js';
import { sendToLab } from './lab.js';
import { saveOrder, getOrder, updateOrder, storedPhotos, orderDir, findHeld, deleteOrder, photoIdsOf } from './store.js';
import { frameDims, sheetLayout, packSheets } from '../shared/layout.js';
import { priceFor } from '../shared/presets.js';

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
    const dims = frameDims(size, !!it.landscape);
    const { buf } = await renderPhotoBuffer(photo, { crop: it.crop, mode: it.mode, bg: it.bg, adjust: it.adjust, angle: it.angle, wMm: dims.w, hMm: dims.h, dpi, mask: it.mask });
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
    if (order.destination === 'print') {
      const jobs = [];
      for (const f of files) {
        const printer = pickPrinter(f.size);
        if (!printer) throw new Error(`No hay impresora asignada para ${f.sizeName}. Puedes enviarlo al laboratorio.`);
        progress({ text: `Enviando a ${printer}…` });
        jobs.push(enqueuePrint(f.file, { printer, wMm: f.wMm, hMm: f.hMm, copies: f.qty, useDriverPaper: f.size.useDriverPaper }));
      }
      await Promise.all(jobs);
    } else {
      progress({ text: 'Enviando al laboratorio…' });
      const record = {
        orderNo: order.orderNo, createdAt: order.createdAt, kind: order.kind, destination: 'lab', customer: order.customer || {},
        total: order.total, currency: s.currency, store: s.storeName,
        items: files.map((f) => ({ file: path.basename(f.file), size: f.sizeName, wMm: f.wMm, hMm: f.hMm, qty: f.qty, original: f.original }))
      };
      await sendToLab(record, files.map((f) => f.file));
    }
    await fsp.rm(outDir, { recursive: true, force: true });
    await fsp.appendFile(dataDir('orders.log.jsonl'), JSON.stringify({ orderNo: order.orderNo, at: new Date().toISOString(), destination: order.destination, total: order.total }) + '\n');
    return await updateOrder(order.orderNo, { status: order.destination === 'print' ? 'printed' : 'sent', error: null });
  } catch (e) {
    await updateOrder(order.orderNo, { status: 'error', error: e.message }).catch(() => {});
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
  const order = await saveOrder({
    orderNo: nextOrderNo(), status: 'processing', kind: spec.kind, destination: spec.destination,
    customer: spec.customer || {}, spec: stripSpec(spec), total, count, currency: s.currency, reprocessOf: opts.reprocessOf || undefined
  }, sessionPhotos());
  try {
    await deliver(order, storedPhotos(order), progress);
  } catch (e) {
    throw new Error(`${e.message} (el pedido ${order.orderNo} queda guardado en «Pedidos con error»)`);
  }
  if (opts.resumeOf) { const held = await findHeld(opts.resumeOf); if (held) await deleteOrder(held.orderNo); }
  return { orderNo: order.orderNo, total, count };
}

const stripSpec = ({ destination, customer, ...rest }) => rest;

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
  const list = old.kind === 'id' ? old.spec.people : old.spec.items;
  const pick = indexes?.length ? list.filter((_, i) => indexes.includes(i)) : list;
  if (!pick.length) throw new Error('No hay nada seleccionado para repetir');
  const spec = old.kind === 'id' ? { ...old.spec, people: pick } : { ...old.spec, items: pick };
  const { total, count } = quote(spec);
  const photos = storedPhotos(old);
  const order = await saveOrder({
    orderNo: nextOrderNo(), status: 'processing', kind: old.kind, destination, customer: old.customer,
    spec, total, count, currency: getSettings().currency, repeatOf: old.orderNo
  }, Object.fromEntries(photoIdsOf(spec).map((id) => [id, photos[id]])));
  await deliver(order, storedPhotos(order), progress);
  return { orderNo: order.orderNo, total, count };
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
  return getSettings().printSizes.filter((x) => (x.printers || []).length).map((x) => x.id);
}
