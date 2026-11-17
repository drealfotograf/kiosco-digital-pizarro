import React, { useState } from 'react';
import { fileUrl } from '../api.js';
import { defaultCrop } from '../../../shared/layout.js';

/**
 * Vista previa de una foto dentro de su marco final.
 * frame: {w,h} en mm (ya orientado). maxW/maxH: tamaño máximo en px.
 */
export function Framed({ photo, frame, crop, mode = 'fill', mask, maxW = 220, maxH = 200, onClick }) {
  const scale = Math.min(maxW / frame.w, maxH / frame.h);
  const W = frame.w * scale;
  const H = frame.h * scale;
  const c = crop || defaultCrop(photo.w, photo.h, frame.w / frame.h);
  return (
    <div className="frame" style={{ width: W, height: H }} onClick={onClick}>
      {mode === 'fit'
        ? <img className="fit" src={fileUrl(photo.thumb)} alt="" />
        : <img className="photo" src={fileUrl(photo.preview)} alt="" loading="lazy" style={{ width: `${100 / c.w}%`, height: `${100 / c.h}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` }} />}
      {mask && <MaskOverlay src={mask} frame={frame} />}
    </div>
  );
}

/** Superpone la máscara; si su orientación no coincide con el marco, la gira 90° (igual que el render final). */
export function MaskOverlay({ src, frame }) {
  const [land, setLand] = useState(null);
  const frameLandscape = frame.w > frame.h;
  const rotate = land !== null && land !== frameLandscape && frame.w !== frame.h;
  // Girada 90°, la imagen debe medir (alto del marco) x (ancho del marco).
  const wPct = (frame.h / frame.w) * 100;
  const hPct = (frame.w / frame.h) * 100;
  return (
    <img
      className="mask" src={fileUrl(src)} alt=""
      onLoad={(e) => setLand(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight)}
      style={rotate
        ? { width: `${wPct}%`, height: `${hPct}%`, left: `${(100 - wPct) / 2}%`, top: `${(100 - hPct) / 2}%`, transform: 'rotate(90deg)', objectFit: 'fill' }
        : { left: 0, top: 0, width: '100%', height: '100%', objectFit: 'fill' }}
    />
  );
}
