// Texto y escritura a mano sobre la copia, dibujados a resolución de impresión con @napi-rs/canvas.
// Coordenadas normalizadas (0..1) respecto a la tarjeta visible (Polaroid) o al papel.
import fs from 'node:fs';
import path from 'node:path';
import { OVERLAY_FONTS, hasOverlay } from '../shared/presets.js';

let lib = null;
async function canvasLib() {
  if (lib) return lib;
  lib = await import('@napi-rs/canvas');
  const dir = path.join(process.env.WINDIR || 'C:\Windows', 'Fonts');
  for (const f of OVERLAY_FONTS) {
    const file = path.join(dir, f.file);
    if (fs.existsSync(file)) { try { lib.GlobalFonts.registerFromPath(file, f.family); } catch { /* fuente no disponible */ } }
  }
  return lib;
}

/** overlay = { texts:[{text,x,y,size,color,font}], strokes:[{color,width,points:[[x,y],…]}] }. size y width: fracción de la altura. */
export async function renderOverlay(overlay, W, H) {
  if (!hasOverlay(overlay)) return null;
  const { createCanvas } = await canvasLib();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (const s of overlay.strokes || []) {
    if (!s.points?.length) continue;
    ctx.strokeStyle = s.color || '#333333';
    ctx.lineWidth = Math.max(1, (s.width || 0.006) * H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    if (s.points.length === 1) ctx.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H);
    ctx.stroke();
  }
  for (const t of overlay.texts || []) {
    if (!t.text) continue;
    const font = OVERLAY_FONTS.find((f) => f.id === t.font) || OVERLAY_FONTS[0];
    ctx.font = `${Math.round((t.size || 0.06) * H)}px "${font.family}"`;
    ctx.fillStyle = t.color || '#333333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.text, t.x * W, t.y * H);
  }
  return canvas.toBuffer('image/png');
}
