import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { dataDir } from './config.js';
import { clampCrop, defaultCrop, clampCropRot, defaultCropRot, followCrop, rotatedCenter, mmToPx, sheetLayout, cutGuides, fitRect, DEFAULT_FIT, printLayout, lotSlots, slotGuides } from '../shared/layout.js';
import { renderOverlay } from './overlay.js';
import { buildMatrix, isIdentity } from '../shared/color.js';

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const parseColor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return WHITE;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 };
};

/** Aplica filtro y corrección de color (misma matriz que la vista previa). */
function applyAdjust(img, adjust) {
  if (!adjust) return img;
  const t = buildMatrix(adjust);
  if (isIdentity(t)) return img;
  return img.recomb(t.m).linear([1, 1, 1], t.o.map((v) => v * 255));
}

/**
 * Renderiza una foto a su tamaño final (px). Devuelve PNG en memoria.
 * mode 'fill' = recorte que llena el papel; 'fit' = ampliar con márgenes del color bg.
 */
export async function renderPhotoBuffer(photo, { crop, fit, mode = 'fill', bg = '#ffffff', adjust, angle = 0, wMm, hMm, dpi, mask }) {
  const W = mmToPx(wMm, dpi);
  const H = mmToPx(hMm, dpi);
  const ang = Math.abs(angle) < 0.05 ? 0 : Number(angle) || 0;
  let buf;
  if (mode === 'fit') {
    // Ampliar con márgenes: la foto (girada si se ha enderezado) se coloca libremente: escala y posición elegidas por el cliente.
    // Lo que queda sin foto se rellena con el color elegido. El filtro se aplica antes de girar, así los márgenes no se tiñen.
    const r = fitRect(photo.w, photo.h, W, H, ang, fit || DEFAULT_FIT);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let inner = await applyAdjust(sharp(photo.src, { failOn: 'none' }).rotate().resize(Math.max(1, Math.round(r.w)), Math.max(1, Math.round(r.h)), { fit: 'fill' }).flatten({ background: WHITE }), adjust)
      .png({ compressionLevel: 1 }).toBuffer();
    if (ang) inner = await sharp(inner).ensureAlpha().rotate(ang, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 1 }).toBuffer();
    const meta = await sharp(inner).metadata();
    const left = Math.round(cx - meta.width / 2), top = Math.round(cy - meta.height / 2);
    // Recorte de la parte que se sale del marco (sharp no admite superposiciones fuera del lienzo).
    const sx = Math.max(0, -left), sy = Math.max(0, -top);
    const ex = Math.min(meta.width, W - left), ey = Math.min(meta.height, H - top);
    const comps = [];
    if (ex - sx > 0 && ey - sy > 0) {
      const part = (sx || sy || ex < meta.width || ey < meta.height)
        ? await sharp(inner).extract({ left: sx, top: sy, width: ex - sx, height: ey - sy }).png({ compressionLevel: 1 }).toBuffer()
        : inner;
      comps.push({ input: part, left: left + sx, top: top + sy });
    }
    buf = await sharp({ create: { width: W, height: H, channels: 3, background: parseColor(bg) } })
      .composite(comps).png({ compressionLevel: 1 }).toBuffer();
  } else if (ang) {
    // Enderezar: se gira la imagen entera y se recorta el marco (que nunca sale de la foto).
    const base = await sharp(photo.src, { failOn: 'none' }).rotate().flatten({ background: WHITE }).raw().toBuffer({ resolveWithObject: true });
    const pw = base.info.width, ph = base.info.height;
    const c = clampCropRot(crop || defaultCrop(pw, ph, W / H), pw, ph, ang);
    const rot = await sharp(base.data, { raw: base.info }).rotate(ang, { background: WHITE }).raw().toBuffer({ resolveWithObject: true });
    const ctr = rotatedCenter(c, pw, ph, ang, rot.info.width, rot.info.height);
    const cw = c.w * pw, ch = c.h * ph;
    const left = Math.max(0, Math.round(ctr.x - cw / 2));
    const top = Math.max(0, Math.round(ctr.y - ch / 2));
    const width = Math.max(1, Math.min(rot.info.width - left, Math.round(cw)));
    const height = Math.max(1, Math.min(rot.info.height - top, Math.round(ch)));
    const img = sharp(rot.data, { raw: rot.info }).extract({ left, top, width, height }).resize(W, H, { fit: 'fill' });
    buf = await applyAdjust(img, adjust).toColorspace('srgb').png({ compressionLevel: 1 }).toBuffer();
  } else {
    const c = clampCrop(crop || defaultCrop(photo.w, photo.h, W / H));
    const left = Math.max(0, Math.round(c.x * photo.w));
    const top = Math.max(0, Math.round(c.y * photo.h));
    const width = Math.max(1, Math.min(photo.w - left, Math.round(c.w * photo.w)));
    const height = Math.max(1, Math.min(photo.h - top, Math.round(c.h * photo.h)));
    const img = sharp(photo.src, { failOn: 'none' }).rotate().extract({ left, top, width, height }).resize(W, H, { fit: 'fill' }).flatten({ background: WHITE });
    buf = await applyAdjust(img, adjust).toColorspace('srgb').png({ compressionLevel: 1 }).toBuffer();
  }
  if (mask) {
    const maskFile = path.join(dataDir('masks'), path.basename(mask));
    if (fs.existsSync(maskFile)) {
      const mm = await sharp(maskFile).metadata();
      let m = sharp(maskFile);
      // Si la máscara es vertical y la foto horizontal (o al revés), se gira.
      if ((mm.width > mm.height) !== (W > H) && mm.width !== mm.height) m = m.rotate(90);
      const overlay = await m.resize(W, H, { fit: 'fill' }).png().toBuffer();
      buf = await sharp(buf).composite([{ input: overlay }]).png({ compressionLevel: 1 }).toBuffer();
    }
  }
  return { buf, W, H };
}

/**
 * Guarda el JPEG final. Para impresoras se entrega siempre en vertical.
 * Perfil de color: las fotos con perfil propio (Adobe RGB, Display P3…) se convierten a sRGB y
 * a todas se les incrusta el perfil sRGB, incluidas las que no traían ninguno.
 */
export async function saveJpeg(buf, out, dpi, portrait = true) {
  let img = sharp(buf);
  const m = await img.metadata();
  if (portrait && m.width > m.height) img = img.rotate(90);
  await img.toColorspace('srgb').withIccProfile('srgb').withMetadata({ density: dpi })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toFile(out);
  return out;
}

function guidesSvg(layout, photo, type, dpi) {
  const lines = cutGuides(layout, photo, type);
  const W = mmToPx(layout.sheetW, dpi);
  const H = mmToPx(layout.sheetH, dpi);
  const s = dpi / 25.4;
  const stroke = Math.max(1, Math.round(0.15 * s));
  const body = lines.map((l) => `<line x1="${(l.x1 * s).toFixed(1)}" y1="${(l.y1 * s).toFixed(1)}" x2="${(l.x2 * s).toFixed(1)}" y2="${(l.y2 * s).toFixed(1)}"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g stroke="#6b6b6b" stroke-width="${stroke}" fill="none">${body}</g></svg>`);
}

/**
 * Hojas de fotos carnet. people: [{photo, crop, copies}], sheets: [[índicePersona,...], ...]
 * Devuelve las rutas de los JPEG generados (una por hoja).
 */
export async function renderIdSheets({ people, sheets, preset, sheet, gapMm, marginMm, guides, dpi, outDir }) {
  const layout = sheetLayout(sheet, preset, gapMm, marginMm);
  const W = mmToPx(layout.sheetW, dpi);
  const H = mmToPx(layout.sheetH, dpi);
  const cache = new Map();
  const cellImage = async (idx) => {
    if (!cache.has(idx)) {
      const p = people[idx];
      const { buf } = await renderPhotoBuffer(p.photo, { crop: p.crop, mode: 'fill', adjust: p.adjust, angle: p.angle, wMm: preset.w, hMm: preset.h, dpi });
      cache.set(idx, buf);
    }
    return cache.get(idx);
  };
  const outputs = [];
  for (let i = 0; i < sheets.length; i++) {
    const comps = [];
    for (let j = 0; j < sheets[i].length; j++) {
      const cell = layout.cells[j];
      comps.push({ input: await cellImage(sheets[i][j]), left: Math.round(cell.x * dpi / 25.4), top: Math.round(cell.y * dpi / 25.4) });
    }
    if (guides !== 'none') comps.push({ input: guidesSvg({ ...layout, cells: layout.cells.slice(0, sheets[i].length) }, preset, guides, dpi), left: 0, top: 0 });
    const buf = await sharp({ create: { width: W, height: H, channels: 3, background: WHITE } }).composite(comps).png({ compressionLevel: 1 }).toBuffer();
    const out = path.join(outDir, `carnet-${preset.id}-${i + 1}.jpg`);
    await saveJpeg(buf, out, dpi, true);
    outputs.push(out);
  }
  return { outputs, layout };
}

/** Crea máscaras de ejemplo la primera vez. */
export async function ensureSampleMasks() {
  const dir = dataDir('masks');
  await fsp.mkdir(dir, { recursive: true });
  if ((await fsp.readdir(dir)).length) return;
  const W = 1200, H = 1800;
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <path fill="#ffffff" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M60 60V${H - 60}H${W - 60}V60Z"/></svg>`;
  const event = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <path fill="#ffffff" fill-rule="evenodd" d="M0 0H${W}V${H}H0Z M50 50V${H - 300}H${W - 50}V50Z"/>
    <text x="${W / 2}" y="${H - 175}" font-family="Georgia, serif" font-size="96" fill="#7a5c3e" text-anchor="middle">Nuestro gran día</text>
    <text x="${W / 2}" y="${H - 85}" font-family="Arial, sans-serif" font-size="46" letter-spacing="8" fill="#a08566" text-anchor="middle">17 · 11 · 2026</text></svg>`;
  await sharp(Buffer.from(frame)).png().toFile(path.join(dir, 'Marco blanco.png'));
  await sharp(Buffer.from(event)).png().toFile(path.join(dir, 'Evento - Nuestro gran dia.png'));
}

/**
 * Copia completa: papel con la foto en su ventana (borde o Polaroid), línea de corte y texto/escritura.
 * item: { crop, fit, mode, bg, adjust, angle, mask, landscape, border, borderMm, borderColor, overlay }
 * Devuelve { buf, W, H } del papel entero.
 */
export async function renderPrint(photo, item, size, dpi) {
  const L = printLayout(size, !!item.landscape, item.border ? (item.borderMm ?? 5) : 0);
  const { buf: photoBuf } = await renderPhotoBuffer(photo, {
    crop: item.crop, fit: item.fit, mode: item.mode, bg: item.bg, adjust: item.adjust, angle: item.angle, mask: item.mask,
    wMm: L.win.w, hMm: L.win.h, dpi
  });
  const PW = mmToPx(L.paper.w, dpi), PH = mmToPx(L.paper.h, dpi);
  const overlay = await renderOverlay(item.overlay, mmToPx(L.card.w, dpi), mmToPx(L.card.h, dpi));
  if (!L.polaroid && !item.border && !overlay) return { buf: photoBuf, W: PW, H: PH };
  const comps = [{ input: photoBuf, left: mmToPx(L.win.x, dpi), top: mmToPx(L.win.y, dpi) }];
  if (L.polaroid && L.card.h < L.paper.h) {
    // Línea de corte discontinua al final de la Polaroid (el resto del papel 10x15 se recorta).
    const y = mmToPx(L.card.h, dpi);
    const sw = Math.max(1, Math.round(dpi / 150));
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}"><line x1="0" y1="${y}" x2="${PW}" y2="${y}" stroke="#b9b2a6" stroke-width="${sw}" stroke-dasharray="${sw * 8} ${sw * 6}"/></svg>`), left: 0, top: 0 });
  }
  if (overlay) comps.push({ input: overlay, left: mmToPx(L.card.x, dpi), top: mmToPx(L.card.y, dpi) });
  const buf = await sharp({ create: { width: PW, height: PH, channels: 3, background: parseColor(L.polaroid ? '#ffffff' : (item.borderColor || '#ffffff')) } })
    .composite(comps).png({ compressionLevel: 1 }).toBuffer();
  return { buf, W: PW, H: PH };
}

/**
 * Hoja de un lote de carné: misma foto en todos los huecos (el hueco grande usa su propio encuadre),
 * con marcas de corte y/o marco fino alrededor de cada foto si se han activado.
 */
export async function renderLotSheet(photo, entry, lot, dpi) {
  const L = lotSlots(lot);
  const W = mmToPx(L.sheetW, dpi), H = mmToPx(L.sheetH, dpi);
  const cache = new Map();
  const comps = [];
  for (const s of L.slots) {
    const key = s.big ? 'big' : 'main';
    if (!cache.has(key)) {
      const main = entry.crop || defaultCropRot(photo.w, photo.h, (lot.pw || 35) / (lot.ph || 45), entry.angle || 0);
      const crop = !s.big ? main : lot.bigFollows ? followCrop(main, photo.w, photo.h, s.w / s.h, entry.angle || 0) : entry.cropBig;
      const { buf } = await renderPhotoBuffer(photo, { crop, mode: 'fill', adjust: entry.adjust, angle: entry.angle, wMm: s.w, hMm: s.h, dpi });
      cache.set(key, buf);
    }
    comps.push({ input: cache.get(key), left: mmToPx(s.x, dpi), top: mmToPx(s.y, dpi) });
  }
  const k = dpi / 25.4;
  const sw = Math.max(1, Math.round(0.15 * k));
  let svg = '';
  if (entry.guides) svg += `<g stroke="#6b6b6b" stroke-width="${sw}">${slotGuides(L.slots).map((l) => `<line x1="${(l.x1 * k).toFixed(1)}" y1="${(l.y1 * k).toFixed(1)}" x2="${(l.x2 * k).toFixed(1)}" y2="${(l.y2 * k).toFixed(1)}"/>`).join('')}</g>`;
  if (entry.border) svg += `<g fill="none" stroke="#333333" stroke-width="${Math.max(1, Math.round(0.2 * k))}">${L.slots.map((s) => `<rect x="${(s.x * k).toFixed(1)}" y="${(s.y * k).toFixed(1)}" width="${(s.w * k).toFixed(1)}" height="${(s.h * k).toFixed(1)}"/>`).join('')}</g>`;
  if (svg) comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg}</svg>`), left: 0, top: 0 });
  const buf = await sharp({ create: { width: W, height: H, channels: 3, background: WHITE } }).composite(comps).png({ compressionLevel: 1 }).toBuffer();
  return { buf, W, H, sheet: { w: L.sheetW, h: L.sheetH } };
}
