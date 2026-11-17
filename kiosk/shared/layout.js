// Cálculos de recorte y maquetación usados tanto para la vista previa como para el render final.

/** Recorte normalizado (0..1) centrado que cubre el marco con la relación de aspecto dada (ancho/alto). */
export function defaultCrop(imgW, imgH, aspect) {
  const imgAspect = imgW / imgH;
  if (imgAspect > aspect) {
    const w = (aspect * imgH) / imgW;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = imgW / (aspect * imgH);
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export function clampCrop(c) {
  const w = Math.min(1, Math.max(0.02, c.w));
  const h = Math.min(1, Math.max(0.02, c.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)) };
}

/** Escala el recorte manteniendo el centro; factor > 1 = acercar. */
export function zoomCrop(c, factor) {
  let w = c.w / factor;
  let h = c.h / factor;
  const maxScale = Math.max(w, h);
  if (maxScale > 1) { w /= maxScale; h /= maxScale; }
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  return clampCrop({ w, h, x: cx - w / 2, y: cy - h / 2 });
}

// ---------- Giro fino (enderezar) ----------
// El marco de salida es un rectángulo centrado en (cx,cy) de la foto, girado `angle` grados respecto a ella.
// Para que la foto nunca salga del encuadre, el rectángulo girado debe quedar entero dentro de la imagen:
// basta con que su caja envolvente quepa (la imagen es un rectángulo alineado con los ejes).
const RAD = Math.PI / 180;

/** Ajusta el recorte (normalizado) para que, girado `angle`, quede dentro de una imagen de W×H. */
export function clampCropRot(c, W, H, angle = 0) {
  let cw = c.w * W, ch = c.h * H;
  let cx = (c.x + c.w / 2) * W, cy = (c.y + c.h / 2) * H;
  const a = Math.abs(angle * RAD);
  const cos = Math.cos(a), sin = Math.sin(a);
  let ex = (cw * cos + ch * sin) / 2;
  let ey = (cw * sin + ch * cos) / 2;
  const s = Math.min(1, W / (2 * ex), H / (2 * ey));
  cw *= s; ch *= s; ex *= s; ey *= s;
  cx = Math.min(W - ex, Math.max(ex, cx));
  cy = Math.min(H - ey, Math.max(ey, cy));
  return { x: (cx - cw / 2) / W, y: (cy - ch / 2) / H, w: cw / W, h: ch / H };
}

/** Recorte inicial: el mayor que cubre el marco sin salir de la foto girada. */
export function defaultCropRot(W, H, aspect, angle = 0) {
  return clampCropRot(defaultCrop(W, H, aspect), W, H, angle);
}

/** Centro del recorte en una imagen girada `angle` (sharp gira en sentido horario y amplía el lienzo). */
export function rotatedCenter(c, W, H, angle, W2, H2) {
  const t = angle * RAD;
  const dx = (c.x + c.w / 2) * W - W / 2;
  const dy = (c.y + c.h / 2) * H - H / 2;
  return { x: dx * Math.cos(t) - dy * Math.sin(t) + W2 / 2, y: dx * Math.sin(t) + dy * Math.cos(t) + H2 / 2 };
}

/** Medidas finales del marco según orientación. size: {w,h} en vertical. */
export function frameDims(size, landscape) {
  const a = Math.min(size.w, size.h);
  const b = Math.max(size.w, size.h);
  return landscape ? { w: b, h: a } : { w: a, h: b };
}

export const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);

/**
 * Distribuye fotos de carnet en hojas.
 * Prueba la hoja vertical y horizontal y elige la que admite más fotos.
 * Devuelve { sheetW, sheetH, cells:[{x,y}], capacity } en mm.
 */
export function sheetLayout(sheet, photo, gapMm = 2, marginMm = 3) {
  const options = [
    { sw: sheet.w, sh: sheet.h },
    { sw: sheet.h, sh: sheet.w }
  ].map(({ sw, sh }) => {
    const cols = Math.max(0, Math.floor((sw - 2 * marginMm + gapMm) / (photo.w + gapMm)));
    const rows = Math.max(0, Math.floor((sh - 2 * marginMm + gapMm) / (photo.h + gapMm)));
    return { sw, sh, cols, rows, capacity: cols * rows };
  });
  const best = options[0].capacity >= options[1].capacity ? options[0] : options[1];
  const gridW = best.cols * photo.w + Math.max(0, best.cols - 1) * gapMm;
  const gridH = best.rows * photo.h + Math.max(0, best.rows - 1) * gapMm;
  const ox = (best.sw - gridW) / 2;
  const oy = (best.sh - gridH) / 2;
  const cells = [];
  for (let r = 0; r < best.rows; r++) {
    for (let c = 0; c < best.cols; c++) {
      cells.push({ x: ox + c * (photo.w + gapMm), y: oy + r * (photo.h + gapMm) });
    }
  }
  return { sheetW: best.sw, sheetH: best.sh, cells, capacity: best.capacity, cols: best.cols, rows: best.rows, ox, oy, gridW, gridH };
}

/**
 * Reparte un lote de personas (cada una con N copias) en tantas hojas como haga falta.
 * people: [{id, copies}] → [[personId, personId, ...], ...] una lista por hoja.
 * Si samePersonPerSheet es true, cada persona empieza en hoja nueva.
 */
export function packSheets(people, capacity, samePersonPerSheet = false) {
  if (capacity <= 0) return [];
  const sheets = [];
  let current = [];
  for (const p of people) {
    if (samePersonPerSheet && current.length) { sheets.push(current); current = []; }
    for (let i = 0; i < p.copies; i++) {
      current.push(p.id);
      if (current.length === capacity) { sheets.push(current); current = []; }
    }
  }
  if (current.length) sheets.push(current);
  return sheets;
}

/** Líneas de guías de corte en mm: [{x1,y1,x2,y2}] */
export function cutGuides(layout, photo, type = 'marks', markLen = 3) {
  const lines = [];
  if (type === 'none' || !layout.cells.length) return lines;
  if (type === 'lines') {
    const xs = new Set();
    const ys = new Set();
    for (const c of layout.cells) {
      xs.add(+c.x.toFixed(3)); xs.add(+(c.x + photo.w).toFixed(3));
      ys.add(+c.y.toFixed(3)); ys.add(+(c.y + photo.h).toFixed(3));
    }
    for (const x of xs) lines.push({ x1: x, y1: 0, x2: x, y2: layout.sheetH });
    for (const y of ys) lines.push({ x1: 0, y1: y, x2: layout.sheetW, y2: y });
    return lines;
  }
  // Marcas de corte en el margen exterior de la rejilla (prolongación de cada línea de corte).
  const xs = new Set();
  const ys = new Set();
  for (const c of layout.cells) {
    xs.add(+c.x.toFixed(3)); xs.add(+(c.x + photo.w).toFixed(3));
    ys.add(+c.y.toFixed(3)); ys.add(+(c.y + photo.h).toFixed(3));
  }
  const top = layout.oy, bottom = layout.oy + layout.gridH;
  const left = layout.ox, right = layout.ox + layout.gridW;
  const gap = 0.6; // separación entre la foto y la marca
  const lenV = Math.max(0, Math.min(markLen, top - gap));
  const lenH = Math.max(0, Math.min(markLen, left - gap));
  for (const x of xs) {
    if (lenV > 0) {
      lines.push({ x1: x, y1: top - gap - lenV, x2: x, y2: top - gap });
      lines.push({ x1: x, y1: bottom + gap, x2: x, y2: bottom + gap + lenV });
    }
  }
  for (const y of ys) {
    if (lenH > 0) {
      lines.push({ x1: left - gap - lenH, y1: y, x2: left - gap, y2: y });
      lines.push({ x1: right + gap, y1: y, x2: right + gap + lenH, y2: y });
    }
  }
  return lines;
}
