// Calidad de impresión: píxeles reales de la foto por pulgada de papel.
import { defaultCrop, frameDims } from './layout.js';

export function effectiveDpi(photo, crop, frame, mode = 'fill') {
  const inW = frame.w / 25.4;
  const inH = frame.h / 25.4;
  // Con márgenes la foto entera se encaja dentro del marco: manda el lado que llega al borde.
  if (mode === 'fit') return Math.round(Math.max(photo.w / inW, photo.h / inH));
  const c = crop || defaultCrop(photo.w, photo.h, frame.w / frame.h);
  return Math.round(Math.min((c.w * photo.w) / inW, (c.h * photo.h) / inH));
}

export function qualityLevel(dpi) {
  if (dpi >= 250) return { level: 'excelente', label: 'Calidad excelente', ok: true };
  if (dpi >= 180) return { level: 'buena', label: 'Buena calidad', ok: true };
  if (dpi >= 120) return { level: 'justa', label: 'Calidad justa: puede verse algo suave', ok: true };
  return { level: 'baja', label: 'Calidad insuficiente para este tamaño', ok: false };
}

/** Tamaño más grande que se imprime con buena calidad (≥180 ppp) usando la foto entera. */
export function recommendSize(photo, sizes) {
  const ok = sizes
    .map((s) => ({ s, dpi: effectiveDpi(photo, null, frameDims(s, photo.w > photo.h), 'fill') }))
    .filter((x) => x.dpi >= 180)
    .sort((a, b) => b.s.w * b.s.h - a.s.w * a.s.h);
  return ok[0]?.s || null;
}
