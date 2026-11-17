import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { dataDir } from './config.js';
import { checkFileName, extOf, RAW_EXT } from '../shared/presets.js';
import { renderPdfPage } from './pdf.js';

sharp.cache(false);

export const isImage = (name) => checkFileName(name).ok;
const isHeic = (p) => ['.heic', '.heif'].includes(extOf(p));

/**
 * Segunda comprobación: el contenido real del archivo (firma de bytes).
 * Devuelve null si es válido o el motivo del rechazo.
 */
export async function checkContent(file) {
  let fh;
  try {
    const st = await fsp.stat(file);
    if (!st.size) return 'El archivo está vacío.';
    fh = await fsp.open(file, 'r');
    const b = Buffer.alloc(16);
    await fh.read(b, 0, 16, 0);
    const ext = extOf(file);
    const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const png = b.readUInt32BE(0) === 0x89504e47;
    const webp = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    const brand = b.toString('ascii', 4, 8) === 'ftyp' ? b.toString('ascii', 8, 12) : '';
    const heif = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avif', 'avis'].includes(brand);
    const gif = b.toString('ascii', 0, 4) === 'GIF8';
    const pdf = b.toString('ascii', 0, 5) === '%PDF-';
    const head4 = b.toString('latin1', 0, 4);
    // TIFF y la mayoría de RAW (DNG, CR2, NEF, ARW, PEF…) son TIFF por dentro; ORF, RW2, RAF y CR3 tienen firma propia.
    const tiff = head4 === 'II*\0' || head4 === 'MM\0*';
    const raw = RAW_EXT.includes(ext) && (tiff || ['IIRO', 'IIRS', 'IIU\0', 'MMOR'].includes(head4) || b.toString('ascii', 0, 8) === 'FUJIFILM' || brand === 'crx ' || b.toString('ascii', 0, 4) === 'FOVb');
    const kind = raw ? 'raw' : jpeg ? 'jpeg' : png ? 'png' : webp ? 'webp' : heif ? 'heif' : gif ? 'gif' : pdf ? 'pdf' : tiff ? 'tiff' : brand ? 'video' : '';
    if (kind === 'video') return `Aunque se llama ${ext}, el archivo es un vídeo o un formato no compatible.`;
    if (!kind) return 'El archivo está dañado o no es una imagen válida.';
    return null; // La extensión puede no coincidir (p. ej. .jpg que es PNG): se acepta porque la imagen es válida.
  } catch (e) {
    return 'No se ha podido leer el archivo.';
  } finally { await fh?.close(); }
}

/** Devuelve una ruta legible por sharp: convierte HEIC a JPEG y la página indicada de un PDF a PNG (300 ppp). */
export async function readable(src, outDir, page = 1) {
  if (RAW_EXT.includes(extOf(src))) {
    await fsp.mkdir(outDir, { recursive: true });
    const st = await fsp.stat(src);
    const out = path.join(outDir, crypto.createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12) + `-${path.basename(src, path.extname(src))}.jpg`);
    if (!fs.existsSync(out)) await extractRawPreview(src, out);
    return out;
  }
  if (extOf(src) === '.pdf') {
    await fsp.mkdir(outDir, { recursive: true });
    const st = await fsp.stat(src);
    const out = path.join(outDir, crypto.createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12) + `-${path.basename(src, path.extname(src))}-p${page}.png`);
    if (!fs.existsSync(out)) await fsp.writeFile(out, await renderPdfPage(src, page, 300));
    return out;
  }
  if (!isHeic(src)) return src;
  await fsp.mkdir(outDir, { recursive: true });
  const out = path.join(outDir, crypto.createHash('sha1').update(src).digest('hex').slice(0, 12) + '-' + path.basename(src).replace(/\.(heic|heif)$/i, '') + '.jpg');
  if (fs.existsSync(out)) return out;
  const jpg = await heicConvert({ buffer: await fsp.readFile(src), format: 'JPEG', quality: 0.95 });
  await fsp.writeFile(out, Buffer.from(jpg));
  return out;
}

/**
 * RAW de cámara: busca dentro del archivo todas las imágenes JPEG incrustadas y se queda con la mayor
 * (normalmente la vista previa a tamaño completo). Aplica la orientación guardada por la cámara.
 */
export async function extractRawPreview(src, out) {
  const buf = await fsp.readFile(src);
  let best = null;
  let tries = 0;
  for (let i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff])); i >= 0 && tries < 60; i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), i + 3)) {
    tries++;
    try {
      const m = await sharp(buf.subarray(i), { failOn: 'none' }).metadata();
      if (m.format === 'jpeg' && m.width && m.height && (!best || m.width * m.height > best.area)) best = { start: i, area: m.width * m.height };
    } catch { /* no es un JPEG válido: siguiente */ }
  }
  if (!best || best.area < 640 * 480) throw new Error('Este RAW no incluye una vista previa con resolución suficiente para imprimir.');
  // Orientación del RAW (etiqueta EXIF del contenedor TIFF), si se puede leer.
  let orientation = 1;
  try { orientation = (await sharp(src, { failOn: 'none' }).metadata()).orientation || 1; } catch { /* formato no TIFF (CR3, RAF…) */ }
  let img = sharp(buf.subarray(best.start), { failOn: 'none' });
  const own = (await img.metadata()).orientation;
  img = sharp(await img.rotate().jpeg({ quality: 97, chromaSubsampling: '4:4:4' }).toBuffer());
  if (!own && orientation > 1) img = img.withMetadata({ orientation });
  await img.jpeg({ quality: 97, chromaSubsampling: '4:4:4' }).toFile(out);
  return out;
}

/** Vista previa de baja calidad bajo demanda (con caché) para explorar sin importar. */
export async function cachedThumb(src, size = 360, page = 1) {
  const st = await fsp.stat(src);
  const key = crypto.createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}|${size}|${page}`).digest('hex');
  const dir = dataDir('cache', 'thumbs');
  await fsp.mkdir(dir, { recursive: true });
  const out = path.join(dir, key + '.jpg');
  if (fs.existsSync(out)) return out;
  const readableSrc = await readable(src, dataDir('cache', 'convertidas'), page);
  await sharp(readableSrc, { failOn: 'none' }).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: size > 800 ? 80 : 70 }).toFile(out);
  return out;
}

/** Medidas de la imagen ya orientada según EXIF. */
export async function orientedSize(src) {
  const m = await sharp(src, { failOn: 'none' }).metadata();
  const swap = (m.orientation || 1) >= 5;
  return swap ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
}

/** Crea vista previa (1600 px) y miniatura (400 px). */
export async function makeDerivatives(src, dir, id) {
  const preview = path.join(dir, `${id}.preview.jpg`);
  const thumb = path.join(dir, `${id}.thumb.jpg`);
  const info = await sharp(src, { failOn: 'none' }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(preview);
  await sharp(preview).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 75 }).toFile(thumb);
  return { preview, thumb, previewW: info.width, previewH: info.height };
}

const SKIP_DIR = /^(\$recycle\.bin|system volume information|\.trash.*|\.thumbnails|\.cache|windows|program files.*|programdata|appdata)$/i;
const hiddenName = (n) => n.startsWith('.') || n.startsWith('$') || n.startsWith('._') || /^(thumbs\.db|desktop\.ini)$/i.test(n);

/** Todos los archivos de una carpeta y subcarpetas (también los no compatibles, para poder avisar). */
export async function walkFiles(root, { maxDepth = 8, max = 5000 } = {}) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > maxDepth || out.length >= max) return;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max || hiddenName(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) await walk(p, depth + 1); }
      else if (e.isFile()) {
        try { const st = await fsp.stat(p); out.push({ path: p, name: e.name, size: st.size, mtime: st.mtimeMs }); } catch { /* ignorar */ }
      }
    }
  }
  await walk(root, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

/** Lista una carpeta: subcarpetas y número de archivos. */
export async function listFolder(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const folders = [];
  let files = 0;
  let images = 0;
  for (const e of entries) {
    if (hiddenName(e.name)) continue;
    if (e.isDirectory() && !SKIP_DIR.test(e.name)) folders.push({ path: path.join(dir, e.name), name: e.name });
    else if (e.isFile()) { files++; if (isImage(e.name)) images++; }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { dir, folders, files, images };
}
