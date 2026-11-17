import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Icon, Stepper } from '../components/ui.jsx';
import CropEditor, { useBox } from '../components/CropEditor.jsx';
import Filmstrip from '../components/Filmstrip.jsx';
import { FilterGrid, ColorSliders } from '../components/ColorTools.jsx';
import { frameDims } from '../../../shared/layout.js';
import { money, priceFor } from '../../../shared/presets.js';
import { DEFAULT_ADJUST } from '../../../shared/color.js';
import { effectiveDpi, qualityLevel, recommendSize } from '../../../shared/quality.js';

let seq = 0;
const newKey = () => `i${Date.now().toString(36)}${++seq}`;
const SWATCHES = ['#ffffff', '#F6F2EA', '#C9B29A', '#0F2740', '#333333', '#000000'];
export const DEFAULT_EDIT = { adjust: { ...DEFAULT_ADJUST }, angle: 0, mask: '', mode: 'fill', bg: '#ffffff', crops: {}, land: {} };

/** Total con tarifas por tramos (la cantidad total de cada tamaño decide el precio unitario). */
export function itemsTotal(items, sizes) {
  const qty = {};
  for (const it of items) qty[it.sizeId] = (qty[it.sizeId] || 0) + it.qty;
  return Object.entries(qty).reduce((a, [id, q]) => a + priceFor(sizes.find((s) => s.id === id), q) * q, 0);
}

/** Ajustes de una foto ya combinados con los valores por defecto. */
export const editOf = (edits, key) => ({ ...DEFAULT_EDIT, ...(edits[key] || {}) });
const landOf = (ed, sizeId, photo) => ed.land[sizeId] ?? (photo ? photo.w > photo.h : false);

export function itemQuality(sizeId, ed, photo, sizes) {
  const size = sizes.find((s) => s.id === sizeId);
  if (!size || !photo) return null;
  const dpi = effectiveDpi(photo, ed.crops[sizeId], frameDims(size, landOf(ed, sizeId, photo)), ed.mode);
  return { dpi, ...qualityLevel(dpi) };
}

/**
 * Zona de selección y edición.
 * - Toque en una miniatura: se ve en grande (no se añade sola al pedido).
 * - Cada tamaño tiene su contador: al ponerle una copia queda pedido.
 * - Pulsación larga: selección múltiple para poner tamaño y/o copias a varias fotos a la vez.
 */
export default function Studio({ settings, roll, items, setItems, edits, setEdits, ensurePhoto, onAddMore, onHold, onNext, onCancel, toast }) {
  const sizes = settings.printSizes;
  const sizeById = (id) => sizes.find((s) => s.id === id);
  const [visible, setVisible] = useState(() => {
    const q = (settings.quickSizes || []).filter((id) => sizeById(id));
    return q.length ? q : sizes.slice(0, 6).map((s) => s.id);
  });
  const [masks, setMasks] = useState([]);
  const [focusKey, setFocusKey] = useState(() => items[0]?.rollKey || roll[0]?.key);
  const [activeSize, setActiveSize] = useState(null);
  const [tab, setTab] = useState('size');
  const [busy, setBusy] = useState({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [selSize, setSelSize] = useState('');
  const [selQty, setSelQty] = useState(1);
  const [stageRef, stage] = useBox();

  useEffect(() => { api('masks:list').then(setMasks); }, []);
  useEffect(() => { if (!roll.find((e) => e.key === focusKey)) setFocusKey(roll[0]?.key); }, [roll, focusKey]);

  const entry = roll.find((e) => e.key === focusKey);
  const photo = entry?.photo;
  const ed = editOf(edits, focusKey);
  const qtyOf = (rk, sizeId) => items.find((i) => i.rollKey === rk && i.sizeId === sizeId)?.qty || 0;
  const photoItems = items.filter((i) => i.rollKey === focusKey);
  const curSize = sizeById(activeSize) || sizeById(photoItems[0]?.sizeId) || sizeById(visible[0]) || sizes[0];
  const frame = photo ? frameDims(curSize, landOf(ed, curSize.id, photo)) : null;
  const maskPath = (name) => masks.find((m) => m.name === name)?.path;
  const q = photo ? itemQuality(curSize.id, ed, photo, sizes) : null;
  const rec = photo ? recommendSize(photo, sizes) : null;
  const total = itemsTotal(items, sizes);
  const count = items.reduce((a, i) => a + i.qty, 0);

  // Al ver una foto se importa en segundo plano para poder editarla (no se añade al pedido).
  useEffect(() => { if (entry && !entry.photo && !busy[entry.key]) load(entry); }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActiveSize(photoItems[0]?.sizeId || null); }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function load(e) {
    if (e.photo) return e.photo;
    setBusy((b) => ({ ...b, [e.key]: true }));
    const p = await ensurePhoto(e);
    setBusy((b) => { const n = { ...b }; delete n[e.key]; return n; });
    return p;
  }
  const setEdit = (rk, patch) => setEdits((all) => ({ ...all, [rk]: { ...editOf(all, rk), ...patch } }));
  const setQty = (rk, photoId, sizeId, qty) => setItems((l) => {
    const i = l.findIndex((x) => x.rollKey === rk && x.sizeId === sizeId);
    if (qty <= 0) return i >= 0 ? l.filter((_, j) => j !== i) : l;
    if (i >= 0) return l.map((x, j) => (j === i ? { ...x, qty } : x));
    return [...l, { key: newKey(), rollKey: rk, photoId, sizeId, qty }];
  });

  // ---------- Una foto ----------
  // Elegir un tamaño solo lo muestra en el encuadre; la copia se añade cuando el cliente la marca.
  const tapSize = (sizeId) => setActiveSize(sizeId);
  /** «Más tamaños»: ocupa el hueco de un tamaño sin copias de esta foto; si todos tienen, se añade al final. */
  const pickOther = (sizeId) => {
    setMoreOpen(false);
    const pool = selecting ? [] : visible;
    const free = [...pool].reverse().find((id) => !qtyOf(focusKey, id));
    setVisible((v) => {
      if (v.includes(sizeId)) return v;
      const i = free ? v.indexOf(free) : -1;
      return i >= 0 ? v.map((x, j) => (j === i ? sizeId : x)) : [...v, sizeId];
    });
    api('quicksizes:promote', sizeId, free || '').catch(() => {});
    if (selecting) setSelSize(sizeId); else tapSize(sizeId);
  };

  // ---------- Selección múltiple ----------
  const startSelect = (e) => { setSelecting(true); setSel(new Set([e.key])); setSelSize(''); setSelQty(1); setTab('size'); };
  const toggleSel = (e) => setSel((s) => { const n = new Set(s); n.has(e.key) ? n.delete(e.key) : n.add(e.key); return n; });
  const selectAll = () => { setSelecting(true); setSel(new Set(roll.map((e) => e.key))); };
  const endSelect = () => { setSelecting(false); setSel(new Set()); };
  const applySelection = async () => {
    const keys = roll.filter((e) => sel.has(e.key));
    let n = 0;
    for (const e of keys) {
      const p = await load(e);
      if (!p) continue;
      if (selSize) { setQty(e.key, p.id, selSize, selQty); n++; }
      else { // Solo cantidad: se cambia en los tamaños que ya tenía
        const own = items.filter((i) => i.rollKey === e.key);
        own.forEach((i) => setQty(e.key, p.id, i.sizeId, selQty));
        if (own.length) n++;
      }
    }
    toast({ type: 'ok', text: selSize ? `${n} foto(s): ${selQty} copia(s) de ${sizeById(selSize).name}` : `${n} foto(s) con ${selQty} copia(s) en sus tamaños` });
    endSelect();
  };
  const removeSelection = () => { setItems((l) => l.filter((i) => !sel.has(i.rollKey))); toast({ type: 'ok', text: 'Fotos quitadas del pedido' }); endSelect(); };

  const badges = useMemo(() => {
    const b = {};
    for (const it of items) {
      const x = (b[it.rollKey] ||= { count: 0, warn: false });
      x.count += it.qty;
      const ph = roll.find((e) => e.key === it.rollKey)?.photo;
      const qq = itemQuality(it.sizeId, editOf(edits, it.rollKey), ph, sizes);
      if (qq && !qq.ok) x.warn = true;
    }
    for (const k of Object.keys(busy)) (b[k] ||= {}).busy = true;
    return b;
  }, [items, busy, roll, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = sizes.filter((s) => !visible.includes(s.id));
  const sizeGrid = (value, onTap, showQty) => (
    <>
      <div className="size-grid">
        {visible.map((id) => {
          const s = sizeById(id);
          if (!s) return null;
          const n = showQty ? qtyOf(focusKey, id) : 0;
          const low = showQty && photo && !itemQuality(id, { ...ed, crops: {} }, photo, sizes)?.ok;
          return (
            <button key={id} className={`size-btn ${value === id ? 'on' : ''} ${n ? 'has' : ''}`} onClick={() => onTap(id)}>
              <b>{s.name.replace(/\s*\(.*\)/, '')}</b>
              <span>{money(priceFor(s, 1), settings.currency)}{s.tiers?.length ? ' *' : ''}</span>
              {n > 0 && <span className="q">{n}</span>}
              {low && <i className="dot" title="Calidad baja a este tamaño" />}
            </button>
          );
        })}
      </div>
      {others.length > 0 && (
        <div className="more-sizes">
          <button className="btn sm" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setMoreOpen(!moreOpen)}>
            Más tamaños ({others.length}) <Icon name="chevron" size={20} />
          </button>
          {moreOpen && (
            <div className="more-list">
              {others.map((s) => <button key={s.id} onClick={() => pickOther(s.id)}><span>{s.name}</span><span className="muted">{money(s.price, settings.currency)}</span></button>)}
            </div>
          )}
        </div>
      )}
    </>
  );

  return (
    <div className="screen">
      <div className="topbar slim">
        <button className="btn" onClick={onCancel}><Icon name="back" /> Salir</button>
        <h1>Elige y edita tus fotos</h1>
        <button className="btn" onClick={onAddMore}><Icon name="plus" /> Añadir más fotos</button>
        <button className="btn" disabled={!items.length} onClick={onHold}><Icon name="lock" /> Guardar para después</button>
      </div>

      <div className="studio-body">
        <div className="stage" ref={stageRef}>
          {entry && photo && frame && (
            <CropEditor
              key={focusKey + curSize.id}
              photo={photo} frame={frame} crop={ed.crops[curSize.id]}
              onChange={(c) => setEdit(focusKey, { crops: { ...ed.crops, [curSize.id]: c } })}
              angle={ed.angle} onAngle={(a) => setEdit(focusKey, { angle: a })}
              mode={ed.mode} bg={ed.bg} adjust={ed.adjust} mask={maskPath(ed.mask)}
              maxW={Math.max(200, stage.w - 160)} maxH={Math.max(200, stage.h - 70)}
            />
          )}
          {entry && !photo && (
            <div className="stage-preview">
              <img src={entry.preview} alt="" style={{ maxWidth: stage.w - 130, maxHeight: stage.h - 90 }} />
              <div className="row" style={{ color: 'var(--cream)' }}><span className="spinner" style={{ width: 26, height: 26, borderWidth: 3 }} /> Preparando la foto…</div>
            </div>
          )}
          {!entry && <div className="empty" style={{ color: 'var(--sand)' }}>No hay fotos. Pulsa «Añadir más fotos».</div>}
          {roll.length > 1 && <>
            <button className="stage-nav left" onClick={() => { const i = roll.findIndex((e) => e.key === focusKey); setFocusKey(roll[(i - 1 + roll.length) % roll.length].key); }} aria-label="Anterior"><Icon name="back" size={34} /></button>
            <button className="stage-nav right" onClick={() => { const i = roll.findIndex((e) => e.key === focusKey); setFocusKey(roll[(i + 1) % roll.length].key); }} aria-label="Siguiente"><Icon name="next" size={34} /></button>
          </>}
          {entry && <div className="stage-name">{entry.name}{curSize && photo ? ` · ${curSize.name}` : ''}</div>}
        </div>

        <aside className="side">
          {selecting ? (
            <div className="select-bar">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span><span className="count-big">{sel.size}</span> <span className="muted">seleccionada{sel.size === 1 ? '' : 's'}</span></span>
                <button className="btn sm" onClick={endSelect}><Icon name="close" size={18} /> Terminar</button>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn sm" onClick={selectAll}>Todas</button>
                <button className="btn sm" onClick={() => setSel(new Set())}>Ninguna</button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>Toca las miniaturas para marcar o desmarcar. Después elige tamaño y copias.</p>
              <b>Tamaño</b>
              <button className={`size-btn ${!selSize ? 'on' : ''}`} style={{ minHeight: 52 }} onClick={() => setSelSize('')}><b>Mantener sus tamaños</b><span>solo cambia las copias</span></button>
              {sizeGrid(selSize, (id) => setSelSize(id), false)}
              <div className="row" style={{ justifyContent: 'space-between' }}><b>Copias</b><Stepper value={selQty} onChange={setSelQty} /></div>
              <div className="sticky-actions">
                <button className="btn primary lg" disabled={!sel.size} onClick={applySelection}><Icon name="check" /> Aplicar a {sel.size} foto{sel.size === 1 ? '' : 's'}</button>
                <button className="btn danger" disabled={!sel.size} onClick={removeSelection}><Icon name="trash" size={20} /> Quitar del pedido</button>
              </div>
            </div>
          ) : photo ? (
            // Todas las opciones a la vista, en formato compacto (referencia: monitor 22" 1920x1080).
            <div className="opts">
              <section>
                <h4>Tamaño</h4>
                {sizeGrid(curSize.id, tapSize, true)}
                <div className="opt-row">
                  {qtyOf(focusKey, curSize.id) === 0
                    ? <button className="btn primary sm grow" onClick={() => setQty(focusKey, photo.id, curSize.id, 1)}><Icon name="plus" size={18} /> Añadir {curSize.name.replace(/\s*\(.*\)/, '')} al pedido</button>
                    : <><span className="small">Copias de <b>{curSize.name.replace(/\s*\(.*\)/, '')}</b></span>
                      <Stepper value={qtyOf(focusKey, curSize.id)} min={0} onChange={(v) => setQty(focusKey, photo.id, curSize.id, v)} /></>}
                </div>
                {q && (
                  <div className={`quality mini ${q.level}`}>
                    <span><b>{q.label.split(':')[0]}</b> · {q.dpi} ppp · {photo.w}x{photo.h}</span>
                    {!q.ok && rec && rec.id !== curSize.id && <button className="btn sm" onClick={() => tapSize(rec.id)}>Mejor: {rec.name.replace(/\s*\(.*\)/, '')}</button>}
                  </div>
                )}
              </section>

              <section>
                <h4>Encuadre</h4>
                <div className="seg mini">
                  <button className={ed.mode === 'fill' ? 'on' : ''} onClick={() => setEdit(focusKey, { mode: 'fill' })}>Recortar y llenar</button>
                  <button className={ed.mode === 'fit' ? 'on' : ''} onClick={() => setEdit(focusKey, { mode: 'fit' })}>Con márgenes</button>
                </div>
                {ed.mode === 'fit' && (
                  <div className="opt-row" style={{ gap: 6, justifyContent: 'flex-start' }}>
                    {SWATCHES.map((c) => <button key={c} className={`swatch mini ${ed.bg === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setEdit(focusKey, { bg: c })} aria-label={c} />)}
                    <label className="swatch mini custom" title="Otro color"><input type="color" value={ed.bg} onChange={(e) => setEdit(focusKey, { bg: e.target.value })} />+</label>
                  </div>
                )}
                <div className="opt-row" style={{ gap: 6, justifyContent: 'flex-start' }}>
                  <button className="btn sm" onClick={() => setEdit(focusKey, { land: { ...ed.land, [curSize.id]: !landOf(ed, curSize.id, photo) }, crops: { ...ed.crops, [curSize.id]: null } })}><Icon name="rotate" size={18} /> Girar</button>
                  {ed.mode === 'fill' && <button className="btn sm" onClick={() => setEdit(focusKey, { crops: { ...ed.crops, [curSize.id]: null } })}>Centrar</button>}
                  {ed.angle !== 0 && <button className="btn sm" onClick={() => setEdit(focusKey, { angle: 0 })}><Icon name="straighten" size={18} /> Sin giro</button>}
                </div>
              </section>

              <section>
                <h4>Filtro</h4>
                <FilterGrid src={entry.thumb} adjust={ed.adjust} onChange={(a) => setEdit(focusKey, { adjust: a })} compact />
              </section>

              <section>
                <h4>Color <button className="link" onClick={() => setEdit(focusKey, { adjust: { ...ed.adjust, brightness: 0, contrast: 0, saturation: 0, warmth: 0 } })}>Restablecer</button></h4>
                <ColorSliders adjust={ed.adjust} onChange={(a) => setEdit(focusKey, { adjust: a })} compact />
              </section>

              {masks.length > 0 && (
                <section>
                  <h4>Marco</h4>
                  <div className="mask-row">
                    <button className={`mask-tile ${!ed.mask ? 'on' : ''}`} onClick={() => setEdit(focusKey, { mask: '' })}><span>Ninguno</span></button>
                    {masks.map((m) => (
                      <button key={m.name} className={`mask-tile ${ed.mask === m.name ? 'on' : ''}`} onClick={() => setEdit(focusKey, { mask: m.name })} title={m.name.replace(/\.png$/i, '')}>
                        <img src={`kimg://f/file?p=${encodeURIComponent(m.path)}`} alt="" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="empty small">Toca una miniatura para verla en grande. Para elegir varias a la vez, mantén pulsada una.</div>
          )}
        </aside>
      </div>

      <div className="studio-foot">
        <Filmstrip roll={roll} focusKey={focusKey} badges={badges} selecting={selecting} selected={sel}
          onPick={(e) => (selecting ? toggleSel(e) : setFocusKey(e.key))}
          onLongPress={(e) => (selecting ? toggleSel(e) : startSelect(e))}
          onSelectAll={selectAll} selectAllLabel="Seleccionar todas" />
        <div className="checkout-box">
          <span className="muted small">{count} copia{count === 1 ? '' : 's'}</span>
          <span className="total">{money(total, settings.currency)}</span>
          <button className="btn primary lg" disabled={!items.length || Object.keys(busy).length > 0} onClick={onNext}>Continuar <Icon name="next" /></button>
        </div>
      </div>
    </div>
  );
}
