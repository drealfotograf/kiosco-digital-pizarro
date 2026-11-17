import React, { useRef, useState } from 'react';
import { OVERLAY_FONTS } from '../../../shared/presets.js';

/**
 * Capa de texto y escritura a mano sobre la copia (coordenadas normalizadas 0..1).
 * tool: 'text' → tocar un hueco crea un texto (onNewText) y arrastrar un texto lo mueve; tocarlo lo selecciona.
 *       'draw' → escribir o dibujar con el dedo.
 *       null   → solo se muestra (sin tocar).
 */
export default function OverlayLayer({ W, H, overlay, onChange, tool, pen, selected, onSelect, onNewText }) {
  const ov = { texts: [], strokes: [], ...(overlay || {}) };
  const [live, setLive] = useState(null);
  const drag = useRef(null);
  const pos = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const fontOf = (id) => (OVERLAY_FONTS.find((f) => f.id === id) || OVERLAY_FONTS[0]).family;

  const down = (e) => {
    if (!tool) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === 'draw') { setLive({ color: pen.color, width: pen.width, points: [p] }); return; }
    const hit = e.target.closest?.('[data-tid]')?.getAttribute('data-tid');
    if (hit) { onSelect(hit); const t = ov.texts.find((x) => x.id === hit); drag.current = { id: hit, from: p, x: t.x, y: t.y }; }
    else { onSelect(null); onNewText(p); }
  };
  const move = (e) => {
    if (!tool) return;
    const p = pos(e);
    if (live) setLive((l) => ({ ...l, points: [...l.points, p] }));
    else if (drag.current) {
      const d = drag.current;
      onChange({ ...ov, texts: ov.texts.map((t) => (t.id === d.id ? { ...t, x: Math.min(1, Math.max(0, d.x + p[0] - d.from[0])), y: Math.min(1, Math.max(0, d.y + p[1] - d.from[1])) } : t)) });
    }
  };
  const up = () => {
    if (live) {
      // Se simplifican los puntos (cada ~0,4 % del lado) para que el pedido no pese demasiado.
      const pts = live.points.filter((p, i, a) => i === 0 || i === a.length - 1 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.004);
      onChange({ ...ov, strokes: [...ov.strokes, { ...live, points: pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) }] });
      setLive(null);
    }
    drag.current = null;
  };

  const strokes = live ? [...ov.strokes, live] : ov.strokes;
  return (
    <svg className={`overlay-layer ${tool ? 'active' : ''} ${tool === 'draw' ? 'draw' : ''}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {strokes.map((s, i) => (
        <polyline key={i} points={s.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')} fill="none" stroke={s.color} strokeWidth={Math.max(1, s.width * H)} strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {ov.texts.map((t) => (
        <g key={t.id} data-tid={t.id}>
          <text x={t.x * W} y={t.y * H} fill={t.color} fontSize={t.size * H} fontFamily={`"${fontOf(t.font)}"`} textAnchor="middle" dominantBaseline="middle" style={{ cursor: tool === 'text' ? 'move' : 'default' }}>{t.text}</text>
          {tool === 'text' && selected === t.id && (
            <rect x={t.x * W - (t.text.length * t.size * H) * 0.32} y={t.y * H - t.size * H * 0.7} width={t.text.length * t.size * H * 0.64} height={t.size * H * 1.4} fill="none" stroke="#C9B29A" strokeDasharray="6 4" strokeWidth="1.5" />
          )}
        </g>
      ))}
    </svg>
  );
}
