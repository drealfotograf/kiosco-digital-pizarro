import React, { useId } from 'react';
import { fileUrl } from '../api.js';
import { lotSlots, slotGuides, clampCropRot, defaultCropRot, followCrop } from '../../../shared/layout.js';
import { svgMatrixValues } from '../../../shared/color.js';

/**
 * Vista previa de una hoja de lote de carné (10x15) tal como se imprimirá.
 * Sin foto: solo los huecos. Con foto: la misma foto en cada hueco (el hueco grande con su propio encuadre),
 * más marcas de corte y/o marco fino si están activados.
 */
export default function LotPreview({ lot, photo, entry = {}, width: maxW = 260, maxH, src }) {
  const fid = 'lp' + useId().replace(/[^a-z0-9]/gi, '');
  const L = lotSlots(lot);
  // Con maxH, las hojas en vertical se reducen para no ocupar demasiado alto.
  const width = maxH ? Math.min(maxW, (maxH * L.sheetW) / L.sheetH) : maxW;
  const lines = entry.guides ? slotGuides(L.slots) : [];
  const url = photo && (src || fileUrl(photo.thumb));
  const ang = entry.angle || 0;
  const cropFor = (s) => {
    const main = clampCropRot(entry.crop || defaultCropRot(photo.w, photo.h, (lot.pw || 35) / (lot.ph || 45), ang), photo.w, photo.h, ang);
    if (!s.big) return main;
    if (lot.bigFollows) return followCrop(main, photo.w, photo.h, s.w / s.h, ang);
    return clampCropRot(entry.cropBig || defaultCropRot(photo.w, photo.h, s.w / s.h, ang), photo.w, photo.h, ang);
  };
  return (
    <svg className="lot-preview" viewBox={`0 0 ${L.sheetW} ${L.sheetH}`} width={width} height={(width * L.sheetH) / L.sheetW} aria-label={lot.name}>
      {photo && entry.adjust && (
        <defs><filter id={fid} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={svgMatrixValues(entry.adjust)} /></filter></defs>
      )}
      <rect width={L.sheetW} height={L.sheetH} fill="#fff" />
      {L.slots.map((s, i) => {
        if (!photo) return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.big ? '#D9CBB9' : '#E8DFD2'} stroke="#C9B29A" strokeWidth="0.4" />;
        const c = cropFor(s);
        const cx = (c.x + c.w / 2) * photo.w, cy = (c.y + c.h / 2) * photo.h;
        return (
          <svg key={i} x={s.x} y={s.y} width={s.w} height={s.h} viewBox={`${c.x * photo.w} ${c.y * photo.h} ${c.w * photo.w} ${c.h * photo.h}`} preserveAspectRatio="none">
            <image href={url} width={photo.w} height={photo.h} preserveAspectRatio="none" filter={entry.adjust ? `url(#${fid})` : undefined} transform={ang ? `rotate(${ang} ${cx} ${cy})` : undefined} />
          </svg>
        );
      })}
      {entry.border && L.slots.map((s, i) => <rect key={`b${i}`} x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke="#333" strokeWidth="0.25" />)}
      <g stroke="#555" strokeWidth="0.25">{lines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}</g>
    </svg>
  );
}
