import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const LONG_PRESS_MS = 450;
const readCols = () => { try { return Math.min(4, Math.max(1, Number(localStorage.getItem('thumb-cols')) || 3)); } catch { return 3; } };

/** Icono de foto pequeña / grande para los extremos del deslizador. */
const PhotoIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M3 18l6-6 4 4 3-3 5 5" />
  </svg>
);

/**
 * Cuadrícula de miniaturas (derecha) de 1 a 4 columnas. El deslizador de arriba cambia el tamaño.
 * Toque corto: ver la foto. Pulsación larga: selección múltiple. En modo selección, cada toque marca o desmarca.
 * badges: key → { sizes:[{id,qty,color}], warn, busy, virtual }
 */
export default function ThumbGrid({ roll, focusKey, badges = {}, onPick, onLongPress, selecting = false, selected, onSelectAll }) {
  const [cols, setColsState] = useState(readCols);
  const setCols = (v) => { setColsState(v); try { localStorage.setItem('thumb-cols', String(v)); } catch { /* sin almacenamiento */ } };
  const ref = useRef(null);
  const press = useRef(null);
  useEffect(() => { ref.current?.querySelector('.tg-item.focus')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [focusKey]);

  const down = (e, entry) => {
    const p = { x: e.clientX, y: e.clientY, entry, long: false };
    p.timer = onLongPress && setTimeout(() => { p.long = true; onLongPress(entry); navigator.vibrate?.(30); }, LONG_PRESS_MS);
    press.current = p;
  };
  const move = (e) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) { clearTimeout(p.timer); press.current = null; } };
  const up = () => { const p = press.current; press.current = null; if (!p) return; clearTimeout(p.timer); if (!p.long) onPick(p.entry); };
  const inOrder = roll.filter((e) => badges[e.key]?.sizes?.length).length;

  return (
    <aside className={`thumbs-panel ${selecting ? 'selecting' : ''}`}>
      <div className="tg-head">
        <div className="tg-size" title="Tamaño de las miniaturas">
          <PhotoIcon size={16} />
          {/* Izquierda: miniaturas pequeñas (4 columnas). Derecha: grandes (1 columna). */}
          <input type="range" min="1" max="4" step="1" value={5 - cols} onChange={(e) => setCols(5 - Number(e.target.value))} aria-label="Tamaño de las miniaturas" />
          <PhotoIcon size={28} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small"><b>{roll.length}</b> foto{roll.length === 1 ? '' : 's'} · <b>{inOrder}</b> en el pedido</span>
          {onSelectAll && roll.length > 1 && <button className="btn sm" onClick={onSelectAll}><Icon name="checks" size={16} /> Seleccionar todas</button>}
        </div>
      </div>
      <div className="tg-grid" ref={ref} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} onPointerMove={move}
        onPointerLeave={() => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } }}>
        {roll.map((e) => {
          const b = badges[e.key] || {};
          const sel = selecting && selected?.has(e.key);
          return (
            <button key={e.key} className={`tg-item ${e.key === focusKey && !selecting ? 'focus' : ''} ${b.sizes?.length ? 'in' : ''} ${sel ? 'sel' : ''}`}
              onPointerDown={(ev) => down(ev, e)} onPointerUp={up} onContextMenu={(ev) => ev.preventDefault()}>
              <span className="tg-img">
                <img src={e.thumb} alt="" loading="lazy" draggable={false} />
                {selecting && <span className="fs-check">{sel && <Icon name="check" size={16} />}</span>}
                {b.virtual && <span className="tg-virtual" title="Copia virtual">CV</span>}
                {b.warn && <span className="fs-warn" title="Calidad baja">!</span>}
                {b.busy && <span className="fs-busy"><span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} /></span>}
              </span>
              {/* Debajo: nombre y un punto de color por cada tamaño con copias */}
              <span className="tg-cap">
                <span className="tg-name">{e.name}</span>
                {b.sizes?.length > 0 && (
                  <span className="tg-dots">
                    {b.sizes.map((x) => <span key={x.id} className="tg-dot" style={{ background: x.color }} title={`${x.qty} × ${x.name}`}>{cols <= 3 ? x.qty : ''}</span>)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {!roll.length && <div className="muted small" style={{ padding: 16 }}>Aún no hay fotos. Pulsa «Añadir más fotos».</div>}
      </div>
    </aside>
  );
}
