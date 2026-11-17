// PDF imprimible: cada página se convierte en una imagen (PNG a 300 ppp) con pdf.js y @napi-rs/canvas.
import fsp from 'node:fs/promises';

let lib = null;
let canvasLib = null;
async function load() {
  if (!lib) lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!canvasLib) canvasLib = await import('@napi-rs/canvas');
  return lib;
}

async function withDoc(file, fn) {
  const { getDocument } = await load();
  const data = new Uint8Array(await fsp.readFile(file));
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  try { return await fn(await task.promise); } finally { await task.destroy(); }
}

export const pdfPageCount = (file) => withDoc(file, (doc) => doc.numPages);

/** Renderiza una página (1..n) a PNG. Limita el lado mayor para no agotar memoria con planos enormes. */
export function renderPdfPage(file, pageNo = 1, dpi = 300, maxPx = 7000) {
  return withDoc(file, async (doc) => {
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const base = page.getViewport({ scale: 1 }); // 1 unidad = 1/72 pulgada
    const scale = Math.min(dpi / 72, maxPx / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = canvasLib.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    return canvas.toBuffer('image/png');
  });
}
