import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fileUrl } from '../api.js';
import { clampCropRot, defaultCropRot, zoomCrop } from '../../../shared/layout.js';
import { MaskOverlay } from './Framed.jsx';
import { FilterDefs } from './ColorTools.jsx';

/** Mide el espacio disponible de un contenedor. */
export function useBox() {
  const ref = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

const RAD = Math.PI / 180;
const MAX_ANGLE = 45;

/**
 * Editor táctil de encuadre que ocupa todo el espacio disponible.
 * - Un dedo: mover la foto. Dos dedos: acercar/alejar y girar (enderezar). Rueda: zoom.
 * - mode 'fill': la foto llena el marco y nunca sale de él (el recorte se ajusta al girar).
 * - mode 'fit' : ampliar con márgenes; la foto entera (girada si hace falta) dentro del marco con fondo bg.
 * frame: {w,h} mm. crop normalizado. angle en grados (sentido horario).
 */
export default function CropEditor({ photo, src, frame, crop, onChange, angle = 0, onAngle, mode = 'fill', bg = '#ffffff', adjust, faceGuide, mask, maxW, maxH, showSlider = true, dark = true }) {
  const [boxRef, box] = useBox();
  const fid = 'c' + useId().replace(/[^a-z0-9]/gi, '');
  const aspect = frame.w / frame.h;
  const sliders = showSlider ? (mode === 'fill' ? 2 : 1) * 36 : 0;
  const availW = maxW || Math.max(120, box.w);
  const availH = (maxH || Math.max(120, box.h)) - sliders;
  const scale = Math.min(availW / frame.w, availH / frame.h);
  const W = frame.w * scale;
  const H = frame.h * scale;
  const pw = photo.w, ph = photo.h;
  const c = clampCropRot(crop || defaultCropRot(pw, ph, aspect, angle), pw, ph, angle);
  const pointers = useRef(new Map());
  const start = useRef(null);
  const zoomBase = defaultCropRot(pw, ph, aspect, angle).w;
  const url = src || fileUrl(photo.preview);
  const setAngle = (a) => onAngle?.(Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.round(a * 10) / 10)));
  const commit = (next, ang = angle) => onChange(clampCropRot(next, pw, ph, ang));

  // Si cambia la proporción del marco (girar, otro tamaño), se recalcula el recorte.
  useEffect(() => {
    if (mode !== 'fill' || !crop) return;
    const ca = (crop.w * pw) / (crop.h * ph);
    if (Math.abs(ca - aspect) > 0.01) onChange(defaultCropRot(pw, ph, aspect, angle));
  }, [aspect, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al girar, el recorte se reduce lo necesario para no salir de la foto.
  useEffect(() => { if (mode === 'fill' && crop) commit(crop, angle); }, [angle]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escala de pantalla: px de pantalla por px de imagen.
  const k = W / (c.w * pw);
  const cx = (c.x + c.w / 2) * pw;
  const cy = (c.y + c.h / 2) * ph;
  const t = angle * RAD;

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { crop: c, angle, pts: new Map(pointers.current) };
  };
  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const s0 = start.current;
    const p0 = [...s0.pts.values()];
    if (pts.length >= 2 && p0.length >= 2) {
      // Dos dedos: zoom por distancia y giro por el ángulo entre ellos.
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / RAD;
      let delta = ang(pts[0], pts[1]) - ang(p0[0], p0[1]);
      if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
      const nextAngle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, s0.angle + delta));
      if (onAngle) setAngle(nextAngle);
      if (mode === 'fill') commit(zoomCrop(s0.crop, d(pts[0], pts[1]) / Math.max(1, d(p0[0], p0[1]))), onAngle ? nextAngle : angle);
    } else if (pts.length === 1 && p0.length === 1 && mode === 'fill') {
      // Un dedo: mover. El desplazamiento de pantalla se lleva al sistema de la foto (girada).
      const dx = pts[0].x - p0[0].x, dy = pts[0].y - p0[0].y;
      const k0 = W / (s0.crop.w * pw);
      const ux = (dx * Math.cos(t) + dy * Math.sin(t)) / k0;
      const uy = (-dx * Math.sin(t) + dy * Math.cos(t)) / k0;
      commit({ ...s0.crop, x: s0.crop.x - ux / pw, y: s0.crop.y - uy / ph });
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    start.current = pointers.current.size ? { crop: c, angle, pts: new Map(pointers.current) } : null;
  };
  const onWheel = (e) => { if (mode === 'fill') commit(zoomCrop(c, e.deltaY < 0 ? 1.08 : 1 / 1.08)); };
  const zoom = zoomBase / c.w;
  const setZoom = (z) => commit(zoomCrop(c, z / zoom));
  const filterStyle = adjust ? { filter: `url(#${fid})` } : {};

  // Modo márgenes: la foto girada debe caber entera.
  let fitStyle = null;
  if (mode === 'fit') {
    const a = Math.abs(t);
    const bw = pw * Math.cos(a) + ph * Math.sin(a);
    const bh = pw * Math.sin(a) + ph * Math.cos(a);
    const s = Math.min(W / bw, H / bh);
    fitStyle = { width: pw * s, height: ph * s, left: (W - pw * s) / 2, top: (H - ph * s) / 2, transform: `rotate(${angle}deg)` };
  }

  return (
    <div ref={boxRef} className="crop-box">
      {adjust && <FilterDefs id={fid} adjust={adjust} />}
      <div className="crop-area" style={{ width: W, height: H, cursor: mode === 'fill' ? 'grab' : 'default' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
      {/* La parte de la foto que queda fuera del encuadre (no se imprime) se ve en transparencia alrededor del marco. */}
      {mode === 'fill' && (
        <div className="crop-ghost" aria-hidden="true">
          <img src={url} alt="" style={{
            width: pw * k, height: ph * k, left: W / 2 - cx * k, top: H / 2 - cy * k,
            transformOrigin: `${cx * k}px ${cy * k}px`, transform: `rotate(${angle}deg)`, ...filterStyle
          }} />
        </div>
      )}
      <div className="cropper" style={{ width: W, height: H, background: mode === 'fit' ? bg : '#0b1d30' }}>
        {mode === 'fit'
          ? <img src={url} alt="" style={{ ...fitStyle, ...filterStyle }} />
          : <img src={url} alt="" style={{
            width: pw * k, height: ph * k, left: W / 2 - cx * k, top: H / 2 - cy * k,
            transformOrigin: `${cx * k}px ${cy * k}px`, transform: `rotate(${angle}deg)`, ...filterStyle
          }} />}
        {mask && <MaskOverlay src={mask} frame={frame} />}
        <svg className="guides" viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="none">
          {!faceGuide && (mode === 'fill' || angle !== 0) && (
            <g stroke="rgba(246,242,234,.45)" strokeWidth={frame.w / 500}>
              {[1, 2].map((i) => <line key={'v' + i} x1={(frame.w * i) / 3} y1="0" x2={(frame.w * i) / 3} y2={frame.h} />)}
              {[1, 2].map((i) => <line key={'h' + i} x1="0" y1={(frame.h * i) / 3} x2={frame.w} y2={(frame.h * i) / 3} />)}
            </g>
          )}
          {faceGuide && <FaceGuide frame={frame} g={faceGuide} />}
        </svg>
      </div>
      </div>
      {showSlider && (
        <div className="col" style={{ width: Math.max(300, W), gap: 4 }}>
          {mode === 'fill' && (
            <div className="angle-row" style={dark ? null : { color: 'var(--taupe)' }}>
              <span>Alejar</span>
              <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              <span>Acercar</span>
            </div>
          )}
          {onAngle && (
            <div className="angle-row" style={dark ? null : { color: 'var(--taupe)' }}>
              <span>Enderezar</span>
              <input type="range" min={-MAX_ANGLE} max={MAX_ANGLE} step="0.1" value={angle} onChange={(e) => setAngle(Number(e.target.value))} onDoubleClick={() => setAngle(0)} />
              <button className="btn sm ghost" style={{ minHeight: 36, color: 'inherit' }} onClick={() => setAngle(0)}>{angle ? `${angle > 0 ? '+' : ''}${angle.toFixed(1)}° ✕` : '0°'}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FaceGuide({ frame, g }) {
  const head = (g.headMin + g.headMax) / 2;
  const top = g.crownMm;
  const cx = frame.w / 2;
  const sw = frame.w / 220;
  return (
    <g fill="none" strokeWidth={sw}>
      <rect x="0" y={top + g.headMin} width={frame.w} height={g.headMax - g.headMin} fill="rgba(107,112,85,.25)" stroke="none" />
      {[top, top + g.headMin, top + g.headMax].map((y) => <line key={y} x1="0" y1={y} x2={frame.w} y2={y} stroke="#C9B29A" strokeDasharray={`${sw * 4} ${sw * 3}`} />)}
      <ellipse cx={cx} cy={top + head / 2} rx={head * 0.36} ry={head / 2} stroke="#F6F2EA" strokeOpacity=".9" />
      <line x1={cx} y1="0" x2={cx} y2={frame.h} stroke="rgba(246,242,234,.5)" />
      <line x1={cx - head * 0.3} y1={top + head * 0.5} x2={cx + head * 0.3} y2={top + head * 0.5} stroke="rgba(246,242,234,.7)" />
    </g>
  );
}
