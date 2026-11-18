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

// ---------- Maquetación de la copia: papel, tarjeta (Polaroid) y ventana de la foto ----------
/**
 * Devuelve dónde va la foto dentro del papel (todo en mm):
 *  - paper: tamaño del papel (con la orientación elegida).
 *  - card: zona visible del producto (Polaroid: el marco blanco; resto: el papel entero). Debajo se marca el corte.
 *  - win: ventana de la foto. Con borde, se reduce `border` mm por cada lado.
 * size.card = { h, win:{x,y,w,h} } define un formato Polaroid sobre papel vertical.
 */
export function printLayout(size, landscape = false, border = 0) {
  if (size.card) {
    const paper = { w: Math.min(size.w, size.h), h: Math.max(size.w, size.h) };
    return { paper, card: { x: 0, y: 0, w: paper.w, h: size.card.h }, win: { ...size.card.win }, polaroid: true };
  }
  const paper = frameDims(size, landscape);
  const b = Math.max(0, Math.min(Number(border) || 0, Math.min(paper.w, paper.h) / 4));
  return { paper, card: { x: 0, y: 0, w: paper.w, h: paper.h }, win: { x: b, y: b, w: paper.w - 2 * b, h: paper.h - 2 * b }, polaroid: false };
}

// ---------- Ampliar con márgenes: colocación libre de la foto dentro del marco ----------
/** fit = { s: escala respecto a «cabe entera» (1 = cabe justa), dx, dy: desplazamiento en fracción del marco }. */
export const DEFAULT_FIT = { s: 1, dx: 0, dy: 0 };
export function fitRect(pw, ph, W, H, angle = 0, fit = DEFAULT_FIT) {
  const a = Math.abs(angle * Math.PI / 180);
  const bw = pw * Math.cos(a) + ph * Math.sin(a);
  const bh = pw * Math.sin(a) + ph * Math.cos(a);
  const s = Math.min(W / bw, H / bh) * (fit?.s || 1);
  const w = pw * s, h = ph * s;
  return { w, h, x: (W - w) / 2 + (fit?.dx || 0) * W, y: (H - h) / 2 + (fit?.dy || 0) * H, scale: s };
}

// ---------- Lotes de fotos de carné ----------
/**
 * Plantillas de lote (todas en papel 10x15, mm):
 *  - kind 'grid': cols x rows fotos de pw x ph; separación proporcional (igual entre fotos y a los bordes).
 *  - kind 'grid+big': como 'grid' pero las últimas columnas se sustituyen por una foto grande big {w,h}.
 * Devuelve { sheetW, sheetH, slots:[{x,y,w,h,big}] }.
 */
/** Papeles de los lotes de carné (en vertical, mm). */
export const LOT_PAPERS = { '10x15': { w: 102, h: 152, label: '10 x 15' }, '15x20': { w: 152, h: 203, label: '15 x 20' } };
export const lotPaper = (lot) => LOT_PAPERS[lot?.paper] || LOT_PAPERS['10x15'];

export function lotSlots(lot) {
  const P = lotPaper(lot);
  const sheet = lot.landscape === false ? { w: P.w, h: P.h } : { w: P.h, h: P.w };
  const pw = lot.pw || 35, ph = lot.ph || 45;
  const slots = [];
  if (lot.kind === 'grid+big') {
    const cols = lot.cols || 2, rows = lot.rows || 2, big = lot.big || { w: 70, h: 100 };
    const gx = (sheet.w - cols * pw - big.w) / (cols + 2);
    const gy = (sheet.h - rows * ph) / (rows + 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: gx + c * (pw + gx), y: gy + r * (ph + gy), w: pw, h: ph, big: false });
    slots.push({ x: gx + cols * (pw + gx), y: (sheet.h - big.h) / 2, w: big.w, h: big.h, big: true });
  } else {
    const cols = lot.cols || 4, rows = lot.rows || 2;
    const gx = (sheet.w - cols * pw) / (cols + 1);
    const gy = (sheet.h - rows * ph) / (rows + 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) slots.push({ x: gx + c * (pw + gx), y: gy + r * (ph + gy), w: pw, h: ph, big: false });
  }
  return { sheetW: sheet.w, sheetH: sheet.h, slots };
}

/** Marcas de corte para huecos arbitrarios (prolongación de cada borde de foto hacia fuera, sin pisar otras fotos). */
export function slotGuides(slots, len = 3, gap = 0.6) {
  const lines = [];
  // Espacio libre hasta la foto vecina en cada dirección; la marca nunca pasa de la mitad de ese hueco.
  const room = (s, dir) => {
    let best = Infinity;
    for (const o of slots) {
      if (o === s) continue;
      const ovY = o.y < s.y + s.h && o.y + o.h > s.y;
      const ovX = o.x < s.x + s.w && o.x + o.w > s.x;
      if (dir === 'up' && ovX && o.y + o.h <= s.y) best = Math.min(best, s.y - (o.y + o.h));
      if (dir === 'down' && ovX && o.y >= s.y + s.h) best = Math.min(best, o.y - (s.y + s.h));
      if (dir === 'left' && ovY && o.x + o.w <= s.x) best = Math.min(best, s.x - (o.x + o.w));
      if (dir === 'right' && ovY && o.x >= s.x + s.w) best = Math.min(best, o.x - (s.x + s.w));
    }
    return best === Infinity ? len : Math.max(0, Math.min(len, best / 2 - gap));
  };
  for (const s of slots) {
    const up = room(s, 'up'), down = room(s, 'down'), left = room(s, 'left'), right = room(s, 'right');
    for (const x of [s.x, s.x + s.w]) {
      if (up > 0.2) lines.push({ x1: x, y1: s.y - gap - up, x2: x, y2: s.y - gap });
      if (down > 0.2) lines.push({ x1: x, y1: s.y + s.h + gap, x2: x, y2: s.y + s.h + gap + down });
    }
    for (const y of [s.y, s.y + s.h]) {
      if (left > 0.2) lines.push({ x1: s.x - gap - left, y1: y, x2: s.x - gap, y2: y });
      if (right > 0.2) lines.push({ x1: s.x + s.w + gap, y1: y, x2: s.x + s.w + gap + right, y2: y });
    }
  }
  return lines;
}

/**
 * Encuadre «que sigue» al de las fotos pequeñas para un hueco de otra proporción:
 * mismo centro horizontal, mismo ancho en la foto (la cara sale del mismo tamaño relativo) y mismo borde superior;
 * la diferencia de alto se añade por abajo. aspect = ancho / alto del hueco nuevo.
 */
export function followCrop(crop, pw, ph, aspect, angle = 0) {
  const w = crop.w * pw, h = w / aspect;
  const cx = (crop.x + crop.w / 2) * pw, top = crop.y * ph;
  return clampCropRot({ x: (cx - w / 2) / pw, y: top / ph, w: w / pw, h: h / ph }, pw, ph, angle);
}

/** Comprueba que una plantilla de lote cabe en su hoja 10x15. Devuelve un texto de error o ''. */
export function lotProblem(lot) {
  const num = (v, a, b) => Number.isFinite(Number(v)) && Number(v) >= a && Number(v) <= b;
  if (!lot || typeof lot.id !== 'string' || !lot.id.trim()) return 'falta el identificador';
  if (!['grid', 'grid+big'].includes(lot.kind)) return 'tipo desconocido';
  if (!num(lot.pw, 10, 152) || !num(lot.ph, 10, 152)) return 'medida de foto no válida';
  if (!num(lot.cols, 1, 12) || !num(lot.rows, 1, 12)) return 'filas o columnas no válidas';
  if (lot.kind === 'grid+big' && (!lot.big || !num(lot.big.w, 10, 152) || !num(lot.big.h, 10, 152))) return 'medida de la foto grande no válida';
  const L = lotSlots(lot);
  if (lot.paper != null && !LOT_PAPERS[lot.paper]) return 'papel no válido (10x15 o 15x20)';
  if (L.slots.some((q) => q.x < -0.01 || q.y < -0.01 || q.x + q.w > L.sheetW + 0.01 || q.y + q.h > L.sheetH + 0.01)) return `las fotos no caben en la hoja ${lotPaper(lot).label}`;
  return '';
}
