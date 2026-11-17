import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { dataDir } from './config.js';
import { clampCrop, defaultCrop, clampCropRot, rotatedCenter, mmToPx, sheetLayout, cutGuides } from '../shared/layout.js';
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
export async function renderPhotoBuffer(photo, { crop, mode = 'fill', bg = '#ffffff', adjust, angle = 0, wMm, hMm, dpi, mask }) {
  const W = mmToPx(wMm, dpi);
  const H = mmToPx(hMm, dpi);
  const ang = Math.abs(angle) < 0.05 ? 0 : Number(angle) || 0;
  let buf;
  if (mode === 'fit') {
    // La foto entera (girada si se ha enderezado) dentro del tamaño pedido; lo que falta se rellena con el color elegido.
    // El filtro se aplica antes de girar, así los márgenes no se tiñen.
    let inner = await applyAdjust(sharp(photo.src, { failOn: 'none' }).rotate().resize(W, H, { fit: 'inside' }).flatten({ background: WHITE }), adjust)
      .png({ compressionLevel: 1 }).toBuffer();
    if (ang) {
      inner = await sharp(inner).ensureAlpha().rotate(ang, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 1 }).toBuffer();
      inner = await sharp(inner).resize(W, H, { fit: 'inside' }).png({ compressionLevel: 1 }).toBuffer();
    }
    const meta = await sharp(inner).metadata();
    buf = await sharp({ create: { width: W, height: H, channels: 3, background: parseColor(bg) } })
      .composite([{ input: inner, left: Math.round((W - meta.width) / 2), top: Math.round((H - meta.height) / 2) }])
      .png({ compressionLevel: 1 }).toBuffer();
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
