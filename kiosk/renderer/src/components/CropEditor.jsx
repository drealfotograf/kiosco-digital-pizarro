import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { fileUrl } from '../api.js';
import { clampCropRot, defaultCropRot, zoomCrop, fitRect, DEFAULT_FIT } from '../../../shared/layout.js';
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
const clampFit = (f) => ({ s: Math.min(4, Math.max(0.15, f.s)), dx: Math.min(1, Math.max(-1, f.dx)), dy: Math.min(1, Math.max(-1, f.dy)) });

/**
 * Editor táctil de encuadre.
 * - Un dedo: mover. Dos dedos: acercar/alejar y girar (enderezar). Rueda: zoom.
 * - mode 'fill': la foto llena la ventana y nunca sale de ella; lo que no se imprime se ve en transparencia.
 * - mode 'fit' : colocación libre (escala y posición) con márgenes del color bg.
 * Con onModeChange, el zoom es continuo: al alejar por debajo de «llena el formato» pasa sola a márgenes
 * (fondo bg) y al acercar de nuevo vuelve a recorte, sin tener que activar nada.
 * frame: {w,h} mm de la ventana de la foto. sheet (opcional): { w, h, win:{x,y,w,h}, color } para mostrar
 * el papel completo (borde o Polaroid) con la ventana dentro. overlay: función (W,H) → capa de texto/dibujo.
 */
export default function CropEditor({ photo, src, frame, sheet, crop, onChange, fit, onFit, angle: straight = 0, rot: rot90 = 0, onAngle, mode = 'fill', bg = '#ffffff', adjust, faceGuide, round = false, mask, maxW, maxH, showSlider = true, dark = true, overlay, lockGestures = false, onModeChange }) {
  const [boxRef, box] = useBox();
  // Giro total = rotación de 90° de la imagen («Rotar») + enderezado fino (±45°, el deslizador).
  const angle = (Number(rot90) || 0) + (Number(straight) || 0);
  const fid = 'c' + useId().replace(/[^a-z0-9]/gi, '');
  const aspect = frame.w / frame.h;
  const sliders = showSlider ? 2 * 36 : 0;
  const sh = sheet || { w: frame.w, h: frame.h, win: { x: 0, y: 0, w: frame.w, h: frame.h } };
  const availW = maxW || Math.max(120, box.w);
  const availH = (maxH || Math.max(120, box.h)) - sliders;
  const sc = Math.min(availW / sh.w, availH / sh.h); // px de pantalla por mm
  const SW = sh.w * sc, SH = sh.h * sc;
  const W = sh.win.w * sc, H = sh.win.h * sc;
  const WX = sh.win.x * sc, WY = sh.win.y * sc;
  const pw = photo.w, ph = photo.h;
  const c = clampCropRot(crop || defaultCropRot(pw, ph, aspect, angle), pw, ph, angle);
  const f = clampFit(fit || DEFAULT_FIT);
  const pointers = useRef(new Map());
  const start = useRef(null);
  const zoomBase = defaultCropRot(pw, ph, aspect, angle).w;
  const url = src || fileUrl(photo.preview);
  const setAngle = (a) => onAngle?.(Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.round(a * 10) / 10)));
  const commit = (next, ang = angle) => onChange?.(clampCropRot(next, pw, ph, ang));
  const commitFit = (next) => onFit?.(clampFit(next));

  // Si cambia la proporción de la ventana (girar, otro tamaño), se recalcula el recorte.
  useEffect(() => {
    if (mode !== 'fill' || !crop) return;
    const ca = (crop.w * pw) / (crop.h * ph);
    if (Math.abs(ca - aspect) > 0.01) onChange?.(defaultCropRot(pw, ph, aspect, angle));
  }, [aspect, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'fill' && crop) commit(crop, angle); }, [angle]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = W / (c.w * pw); // px de pantalla por px de imagen (modo recorte)
  const cx = (c.x + c.w / 2) * pw;
  const cy = (c.y + c.h / 2) * ph;
  const t = angle * RAD;
  // Zoom unificado: z = 1 cuando la foto llena justo el formato; z < 1 deja márgenes.
  const kCover = W / (zoomBase * pw);
  const sContain = fitRect(pw, ph, W, H, angle, DEFAULT_FIT).scale;
  const ratio = kCover / Math.max(1e-9, sContain); // s de «márgenes» que equivale a llenar
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const zOf = (st) => (st.mode === 'fit' ? st.f.s / ratio : zoomBase / st.c.w);
  const toFit = (cc, z) => {
    const kk = kCover * z;
    const ccx = (cc.x + cc.w / 2) * pw, ccy = (cc.y + cc.h / 2) * ph;
    const [vx, vy] = rot((pw / 2 - ccx) * kk, (ph / 2 - ccy) * kk, t);
    return clampFit({ s: z * ratio, dx: vx / W, dy: vy / H });
  };
  const toFill = (ff, z) => {
    const kk = kCover * Math.max(1, z);
    const [ux, uy] = rot(ff.dx * W, ff.dy * H, -t);
    const w = W / kk / pw, h = H / kk / ph;
    return { x: (pw / 2 - ux / kk) / pw - w / 2, y: (ph / 2 - uy / kk) / ph - h / 2, w, h };
  };
  /** Aplica un zoom z partiendo del estado st, cambiando de recorte a márgenes (o al revés) si hace falta. */
  const applyZ = (st, z) => {
    z = Math.min(4, Math.max(onModeChange ? 0.3 : 1, z));
    if (!onModeChange) { commit(zoomCrop(st.c, z / (zoomBase / st.c.w))); return; }
    if (z < 0.999) {
      if (st.mode === 'fit') commitFit({ ...st.f, s: z * ratio });
      else onModeChange('fit', { fit: toFit(st.c, z) });
    } else if (st.mode === 'fit') onModeChange('fill', { crop: clampCropRot(toFill(st.f, z), pw, ph, angle) });
    else commit(zoomCrop(st.c, z / (zoomBase / st.c.w)));
  };
  const live = useRef(null);
  live.current = { mode, c, f };

  const onDown = (e) => {
    if (lockGestures) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start.current = { crop: c, fit: f, angle: straight, mode, z: zOf(live.current), pts: new Map(pointers.current) };
  };
  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !start.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const s0 = start.current;
    const p0 = [...s0.pts.values()];
    if (pts.length >= 2 && p0.length >= 2) {
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / RAD;
      let delta = ang(pts[0], pts[1]) - ang(p0[0], p0[1]);
      if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
      const nextAngle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, s0.angle + delta));
      if (onAngle) setAngle(nextAngle);
      const factor = d(pts[0], pts[1]) / Math.max(1, d(p0[0], p0[1]));
      if (onModeChange) applyZ(live.current, s0.z * factor);
      else if (mode === 'fill') commit(zoomCrop(s0.crop, factor), onAngle ? nextAngle + (Number(rot90) || 0) : angle);
      else commitFit({ ...s0.fit, s: s0.fit.s * factor });
    } else if (pts.length === 1 && p0.length === 1) {
      const dx = pts[0].x - p0[0].x, dy = pts[0].y - p0[0].y;
      if (s0.mode === 'fill') {
        const k0 = W / (s0.crop.w * pw);
        const ux = (dx * Math.cos(t) + dy * Math.sin(t)) / k0;
        const uy = (-dx * Math.sin(t) + dy * Math.cos(t)) / k0;
        commit({ ...s0.crop, x: s0.crop.x - ux / pw, y: s0.crop.y - uy / ph });
      } else {
        commitFit({ ...s0.fit, dx: s0.fit.dx + dx / W, dy: s0.fit.dy + dy / H });
      }
    }
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size) {
      start.current = { crop: c, fit: f, angle: straight, mode, z: zOf(live.current), pts: new Map(pointers.current) };
    } else {
      start.current = null;
    }
  };
  const onWheel = (e) => {
    if (lockGestures) return;
    const z = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    if (onModeChange) applyZ(live.current, zOf(live.current) * z);
    else if (mode === 'fill') commit(zoomCrop(c, z)); else commitFit({ ...f, s: f.s * z });
  };
  const zoom = zoomBase / c.w;
  const setZoom = (z) => commit(zoomCrop(c, z / zoom));
  const filterStyle = adjust ? { filter: `url(#${fid})` } : {};

  // Imagen en modo recorte (también para la parte en transparencia) y en modo márgenes.
  const fillStyle = {
    width: pw * k, height: ph * k, left: W / 2 - cx * k, top: H / 2 - cy * k,
    transformOrigin: `${cx * k}px ${cy * k}px`, transform: `rotate(${angle}deg)`, ...filterStyle
  };
  const r = mode === 'fit' ? fitRect(pw, ph, W, H, angle, f) : null;
  const fitStyle = r && { width: r.w, height: r.h, left: r.x, top: r.y, transform: `rotate(${angle}deg)`, ...filterStyle };

  return (
    <div ref={boxRef} className="crop-box">
      {adjust && <FilterDefs id={fid} adjust={adjust} />}
      <div className="crop-area" style={{ width: SW, height: SH, cursor: lockGestures ? 'default' : 'grab' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        {/* Parte de la foto que no se imprime, en transparencia */}
        {mode === 'fill' && (
          <div className="crop-ghost" aria-hidden="true" style={{ inset: 'auto', left: WX, top: WY, width: W, height: H }}>
            <img src={url} alt="" style={fillStyle} />
          </div>
        )}
        {sheet && <div className="crop-sheet" style={{ width: SW, height: SH, background: sh.color || '#ffffff' }} />}
        <div className={`cropper ${sheet?.frameLine ? 'framed' : ''}`} style={{ position: 'absolute', left: WX, top: WY, width: W, height: H, background: mode === 'fit' ? bg : '#0b1d30', borderRadius: sheet?.radius ? sheet.radius * sc : 0, overflow: 'hidden', ...(sheet?.frameLine ? { boxShadow: `0 0 0 ${Math.max(1, 0.3 * sc)}px #000` } : {}) }}>
          {mode === 'fit' ? <img src={url} alt="" style={fitStyle} /> : <img src={url} alt="" style={fillStyle} />}
          {mask && <MaskOverlay src={mask} frame={frame} />}
          <svg className="guides" viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="none">
            {!faceGuide && mode === 'fill' && !lockGestures && (
              <g stroke="rgba(246,242,234,.45)" strokeWidth={frame.w / 500}>
                {[1, 2].map((i) => <line key={'v' + i} x1={(frame.w * i) / 3} y1="0" x2={(frame.w * i) / 3} y2={frame.h} />)}
                {[1, 2].map((i) => <line key={'h' + i} x1="0" y1={(frame.h * i) / 3} x2={frame.w} y2={(frame.h * i) / 3} />)}
              </g>
            )}
            {faceGuide && <FaceGuide frame={frame} g={faceGuide} />}
            {round && !faceGuide && <RoundGuide frame={frame} />}
          </svg>
        </div>
        {overlay && <div className="overlay-host" style={{ width: SW, height: sheet?.cardH ? sheet.cardH * sc : SH }}>{overlay(SW, sheet?.cardH ? sheet.cardH * sc : SH)}</div>}
      </div>
      {showSlider && (
        <div className="col" style={{ width: Math.max(300, SW), gap: 4 }}>
          <div className="angle-row" style={dark ? null : { color: 'var(--taupe)' }}>
            <span>{onModeChange ? 'Más pequeña' : mode === 'fill' ? 'Alejar' : 'Más pequeña'}</span>
            {onModeChange
              ? <input type="range" min="0.3" max="4" step="0.01" value={zOf(live.current)} onChange={(e) => applyZ(live.current, Number(e.target.value))} />
              : mode === 'fill'
              ? <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              : <input type="range" min="0.15" max="2.5" step="0.01" value={f.s} onChange={(e) => commitFit({ ...f, s: Number(e.target.value) })} />}
            <span>{onModeChange ? 'Más grande' : mode === 'fill' ? 'Acercar' : 'Más grande'}</span>
          </div>
          {onAngle && (
            <div className="angle-row" style={dark ? null : { color: 'var(--taupe)' }}>
              <span>Enderezar</span>
              <input type="range" min={-MAX_ANGLE} max={MAX_ANGLE} step="0.1" value={straight} onChange={(e) => setAngle(Number(e.target.value))} onDoubleClick={() => setAngle(0)} />
              <button className="btn sm ghost" style={{ minHeight: 32, color: 'inherit' }} onClick={() => setAngle(0)}>{straight ? `${straight > 0 ? '+' : ''}${straight.toFixed(1)}° ✕` : '0°'}</button>
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

function RoundGuide({ frame }) {
  const r = Math.min(frame.w, frame.h) / 2;
  const cx = frame.w / 2, cy = frame.h / 2;
  const sw = frame.w / 300;
  const d = `M0 0h${frame.w}v${frame.h}H0Z M${cx} ${cy - r}A${r} ${r} 0 1 0 ${cx} ${cy + r}A${r} ${r} 0 1 0 ${cx} ${cy - r}Z`;
  return (
    <g>
      <path d={d} fill="rgba(0,0,0,.4)" fillRule="evenodd" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(246,242,234,.7)" strokeWidth={sw} strokeDasharray={`${sw * 6} ${sw * 4}`} />
    </g>
  );
}
