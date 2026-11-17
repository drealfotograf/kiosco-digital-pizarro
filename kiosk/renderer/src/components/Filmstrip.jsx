import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const LONG_PRESS_MS = 450;
// Tamaño de la tira de miniaturas: oculta, pequeña, mediana o grande (se recuerda en el kiosco).
const SIZES = { s: 64, m: 92, l: 150 };
const ORDER = ['s', 'm', 'l'];
const readSize = () => { try { return localStorage.getItem('filmstrip-size') || 'm'; } catch { return 'm'; } };

/**
 * Tira inferior con todas las fotos cargadas (vista previa de baja calidad).
 * Toque corto: ver la foto. Pulsación larga (como en Android): empezar a seleccionar varias.
 * En modo selección, cada toque marca o desmarca.
 * badges: mapa key → {count, warn, busy}
 */
export default function Filmstrip({ roll, focusKey, badges = {}, onPick, onLongPress, selecting = false, selected, onSelectAll, selectAllLabel = 'Seleccionar todas', extra }) {
  const ref = useRef(null);
  const press = useRef(null);
  const [size, setSizeState] = useState(readSize);
  const setSize = (v) => { setSizeState(v); try { localStorage.setItem('filmstrip-size', v); } catch { /* sin almacenamiento */ } };
  const step = (d) => setSize(ORDER[Math.min(2, Math.max(0, ORDER.indexOf(size) + d))] || 'm');
  const inOrder = roll.filter((e) => badges[e.key]?.count).length;
  useEffect(() => {
    const el = ref.current?.querySelector('.fs-item.focus');
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [focusKey]);

  const down = (e, entry) => {
    const p = { x: e.clientX, y: e.clientY, entry, long: false };
    p.timer = onLongPress && setTimeout(() => { p.long = true; onLongPress(entry); navigator.vibrate?.(30); }, LONG_PRESS_MS);
    press.current = p;
  };
  const move = (e) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) { clearTimeout(p.timer); press.current = null; } // es un desplazamiento
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (!p.long) onPick(p.entry);
  };

  if (size === 'hidden') {
    return (
      <div className="filmstrip collapsed">
        <button className="btn sm" onClick={() => setSize('m')}><Icon name="gallery" size={18} /> Mostrar miniaturas</button>
        <span className="muted small">{roll.length} foto{roll.length === 1 ? '' : 's'} · {inOrder} en el pedido</span>
        {selecting && <span className="small" style={{ color: 'var(--navy)' }}><b>{selected?.size || 0}</b> seleccionadas</span>}
      </div>
    );
  }

  return (
    <div className={`filmstrip ${selecting ? 'selecting' : ''}`} style={{ '--fs': `${SIZES[size] || 92}px` }}>
      <div className="fs-head">
        <span><b>{roll.length}</b> <span className="muted small">foto{roll.length === 1 ? '' : 's'}</span></span>
        {onSelectAll && roll.length > 1 && <button className="btn sm" onClick={onSelectAll}><Icon name="checks" size={18} /> {selectAllLabel}</button>}
        <div className="fs-tools">
          <button className="btn sm icon" onClick={() => step(-1)} disabled={size === 's'} aria-label="Miniaturas más pequeñas">−</button>
          <button className="btn sm icon" onClick={() => step(1)} disabled={size === 'l'} aria-label="Miniaturas más grandes">+</button>
          <button className="btn sm icon" onClick={() => setSize('hidden')} aria-label="Ocultar miniaturas"><Icon name="chevron" size={18} /></button>
        </div>
        {extra}
      </div>
      <div className="fs-scroll" ref={ref} onPointerMove={move} onPointerLeave={() => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } }}>
        {roll.map((e) => {
          const b = badges[e.key] || {};
          const sel = selecting && selected?.has(e.key);
          return (
            <button key={e.key} className={`fs-item ${e.key === focusKey && !selecting ? 'focus' : ''} ${b.count ? 'in' : ''} ${sel ? 'sel' : ''}`}
              onPointerDown={(ev) => down(ev, e)} onPointerUp={up} onContextMenu={(ev) => ev.preventDefault()}>
              <img src={e.thumb} alt="" loading="lazy" draggable={false} />
              {selecting && <span className="fs-check">{sel && <Icon name="check" size={16} />}</span>}
              {b.count > 0 && <span className="fs-count">{b.count}</span>}
              {b.warn && <span className="fs-warn" title="Calidad baja">!</span>}
              {b.busy && <span className="fs-busy"><span className="spinner" style={{ width: 26, height: 26, borderWidth: 3 }} /></span>}
            </button>
          );
        })}
        {!roll.length && <div className="muted" style={{ padding: 20 }}>Aún no hay fotos. Pulsa «Añadir más fotos».</div>}
      </div>
    </div>
  );
}
