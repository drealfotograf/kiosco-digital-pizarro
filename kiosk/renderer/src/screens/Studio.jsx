import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Icon, Stepper, Modal, TouchField } from '../components/ui.jsx';
import CropEditor, { useBox } from '../components/CropEditor.jsx';
import ThumbGrid from '../components/ThumbGrid.jsx';
import OverlayLayer from '../components/OverlayLayer.jsx';
import { FilterGrid, ColorSliders } from '../components/ColorTools.jsx';
import { frameDims, printLayout, DEFAULT_FIT } from '../../../shared/layout.js';
import { money, priceFor, sizeColor, OVERLAY_FONTS, OVERLAY_COLORS } from '../../../shared/presets.js';
import { DEFAULT_ADJUST } from '../../../shared/color.js';
import { effectiveDpi, qualityLevel, recommendSize } from '../../../shared/quality.js';

let seq = 0;
const newKey = () => `i${Date.now().toString(36)}${++seq}`;
const SWATCHES = ['#ffffff', '#000000', '#F6F2EA', '#C9B29A', '#0F2740', '#333333'];
export const DEFAULT_EDIT = {
  adjust: { ...DEFAULT_ADJUST }, angle: 0, mask: '', mode: 'fill', bg: '#ffffff',
  crops: {}, fits: {}, land: {}, border: false, borderMm: 5, borderColor: '#ffffff', overlay: { texts: [], strokes: [] }
};

/** Total con tarifas por tramos (la cantidad total de cada tamaño decide el precio unitario). */
export function itemsTotal(items, sizes) {
  const qty = {};
  for (const it of items) qty[it.sizeId] = (qty[it.sizeId] || 0) + it.qty;
  return Object.entries(qty).reduce((a, [id, q]) => a + priceFor(sizes.find((s) => s.id === id), q) * q, 0);
}

/** Ajustes de una foto ya combinados con los valores por defecto. */
export const editOf = (edits, key) => ({ ...DEFAULT_EDIT, ...(edits[key] || {}) });
export const landOf = (ed, size, photo) => (size?.card ? false : ed.land[size?.id] ?? (photo ? photo.w > photo.h : false));
export const layoutOf = (ed, size, photo) => printLayout(size, landOf(ed, size, photo), ed.border ? ed.borderMm : 0);

export function itemQuality(sizeId, ed, photo, sizes) {
  const size = sizes.find((s) => s.id === sizeId);
  if (!size || !photo) return null;
  const L = layoutOf(ed, size, photo);
  let dpi = effectiveDpi(photo, ed.crops[sizeId], { w: L.win.w, h: L.win.h }, ed.mode);
  if (ed.mode === 'fit') dpi = Math.round(dpi / ((ed.fits[sizeId] || DEFAULT_FIT).s || 1));
  return { dpi, ...qualityLevel(dpi) };
}

/**
 * Zona de selección y edición.
 * Centro: la foto (con lo que no se imprime en transparencia). Derecha: miniaturas en cuadrícula.
 * Abajo: todas las opciones y la leyenda de colores por tamaño.
 */
export default function Studio({ settings, roll, items, setItems, edits, setEdits, ensurePhoto, onAddMore, onHold, onNext, onCancel, toast, onVirtualCopy, onRemoveVirtual }) {
  const sizes = settings.printSizes;
  const sizeById = (id) => sizes.find((s) => s.id === id);
  const [visible, setVisible] = useState(() => {
    const q = (settings.quickSizes || []).filter((id) => sizeById(id));
    const base = q.length ? q : sizes.slice(0, 6).map((s) => s.id);
    // Las Polaroid aparecen junto a 10x15 si existen y no están ya en la lista.
    return [...base, ...sizes.filter((s) => s.card && !base.includes(s.id)).map((s) => s.id)].slice(0, 9);
  });
  const [masks, setMasks] = useState([]);
  const [focusKey, setFocusKey] = useState(() => items[0]?.rollKey || roll[0]?.key);
  const [activeSize, setActiveSize] = useState(null);
  const [busy, setBusy] = useState({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [selSize, setSelSize] = useState('');
  const [selQty, setSelQty] = useState(1);
  const [tool, setTool] = useState(null); // null | 'text' | 'draw'
  const [pen, setPen] = useState({ color: '#333333', width: 0.006 });
  const [textStyle, setTextStyle] = useState({ font: 'mano', color: '#333333', size: 0.07 });
  const [selText, setSelText] = useState(null);
  const [textDraft, setTextDraft] = useState(null); // { pos, value, editId }
  const [stageRef, stage] = useBox();

  useEffect(() => { api('masks:list').then(setMasks); }, []);
  useEffect(() => { if (!roll.find((e) => e.key === focusKey)) setFocusKey(roll[0]?.key); }, [roll, focusKey]);

  const entry = roll.find((e) => e.key === focusKey);
  const photo = entry?.photo;
  const ed = editOf(edits, focusKey);
  const qtyOf = (rk, sizeId) => items.find((i) => i.rollKey === rk && i.sizeId === sizeId)?.qty || 0;
  const photoItems = items.filter((i) => i.rollKey === focusKey);
  const curSize = sizeById(activeSize) || sizeById(photoItems[0]?.sizeId) || sizeById(visible[0]) || sizes[0];
  const L = photo ? layoutOf(ed, curSize, photo) : null;
  const frame = L ? { w: L.win.w, h: L.win.h } : null;
  const showSheet = L && (L.polaroid || ed.border);
  const sheet = showSheet ? { w: L.card.w, h: L.card.h, win: L.win, color: L.polaroid ? '#ffffff' : ed.borderColor, cardH: L.card.h } : null;
  const maskPath = (name) => masks.find((m) => m.name === name)?.path;
  const q = photo ? itemQuality(curSize.id, ed, photo, sizes) : null;
  const rec = photo ? recommendSize(photo, sizes.filter((s) => !s.card)) : null;
  const total = itemsTotal(items, sizes);
  const count = items.reduce((a, i) => a + i.qty, 0);
  const color = (id) => sizeColor(sizes, id);

  useEffect(() => { if (entry && !entry.photo && !busy[entry.key]) load(entry); }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setActiveSize(photoItems[0]?.sizeId || null); setTool(null); setSelText(null); }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const setOverlay = (ov) => setEdit(focusKey, { overlay: ov });

  // Elegir un tamaño solo lo muestra en el encuadre; la copia se añade cuando el cliente la marca.
  const tapSize = (sizeId) => setActiveSize(sizeId);
  /** «Más tamaños»: ocupa el hueco de un tamaño sin copias de esta foto; si todos tienen, se añade al final. */
  const pickOther = (sizeId) => {
    setMoreOpen(false);
    const free = selecting ? undefined : [...visible].reverse().find((id) => !qtyOf(focusKey, id));
    setVisible((v) => {
      if (v.includes(sizeId)) return v;
      const i = free ? v.indexOf(free) : -1;
      return i >= 0 ? v.map((x, j) => (j === i ? sizeId : x)) : [...v, sizeId];
    });
    api('quicksizes:promote', sizeId, free || '').catch(() => {});
    if (selecting) setSelSize(sizeId); else tapSize(sizeId);
  };

  // ---------- Selección múltiple ----------
  const startSelect = (e) => { setSelecting(true); setSel(new Set([e.key])); setSelSize(''); setSelQty(1); setTool(null); };
  const toggleSel = (e) => setSel((s) => { const n = new Set(s); n.has(e.key) ? n.delete(e.key) : n.add(e.key); return n; });
  const selectAll = () => { setSelecting(true); setSel(new Set(roll.map((e) => e.key))); };
  const endSelect = () => { setSelecting(false); setSel(new Set()); };
  const applySelection = async () => {
    let n = 0;
    for (const e of roll.filter((x) => sel.has(x.key))) {
      const p = await load(e);
      if (!p) continue;
      if (selSize) { setQty(e.key, p.id, selSize, selQty); n++; }
      else {
        const own = items.filter((i) => i.rollKey === e.key);
        own.forEach((i) => setQty(e.key, p.id, i.sizeId, selQty));
        if (own.length) n++;
      }
    }
    // 0 copias quita ese tamaño (o todos sus tamaños) de las fotos seleccionadas.
    toast({ type: 'ok', text: selQty === 0
      ? (selSize ? `${n} foto(s): quitado ${sizeById(selSize).name}` : `${n} foto(s) quitadas del pedido`)
      : selSize ? `${n} foto(s): ${selQty} copia(s) de ${sizeById(selSize).name}` : `${n} foto(s) con ${selQty} copia(s) en sus tamaños` });
    endSelect();
  };
  const removeSelection = () => { setItems((l) => l.filter((i) => !sel.has(i.rollKey))); toast({ type: 'ok', text: 'Fotos quitadas del pedido' }); endSelect(); };

  const badges = useMemo(() => {
    const b = {};
    for (const it of items) {
      const x = (b[it.rollKey] ||= { sizes: [], warn: false });
      x.sizes.push({ id: it.sizeId, qty: it.qty, color: sizeColor(sizes, it.sizeId), name: sizes.find((s) => s.id === it.sizeId)?.name });
      const ph = roll.find((e) => e.key === it.rollKey)?.photo;
      const qq = itemQuality(it.sizeId, editOf(edits, it.rollKey), ph, sizes);
      if (qq && !qq.ok) x.warn = true;
    }
    for (const e of roll) if (e.virtualOf) (b[e.key] ||= { sizes: [] }).virtual = true;
    for (const k of Object.keys(busy)) (b[k] ||= { sizes: [] }).busy = true;
    return b;
  }, [items, busy, roll, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leyenda: tamaños con copias en el pedido, con su color.
  const legend = useMemo(() => {
    const m = new Map();
    for (const it of items) m.set(it.sizeId, (m.get(it.sizeId) || 0) + it.qty);
    return [...m.entries()].map(([id, qty]) => ({ id, qty, name: sizeById(id)?.name?.replace(/\s*\(.*\)/, '') || id, color: color(id) }));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const others = sizes.filter((s) => !visible.includes(s.id));
  const short = (s) => s.name.replace(/\s*\(.*\)/, '');
  const sizeGrid = (value, onTap, showQty) => (
    <>
      <div className="ob-sizes">
        {visible.map((id) => {
          const s = sizeById(id);
          if (!s) return null;
          const n = showQty ? qtyOf(focusKey, id) : 0;
          const low = showQty && photo && !s.card && !itemQuality(id, { ...ed, crops: {}, fits: {} }, photo, sizes)?.ok;
          return (
            <button key={id} className={`ob-size ${value === id ? 'on' : ''} ${n ? 'has' : ''}`} onClick={() => onTap(id)} style={{ '--c': color(id) }}>
              <i className="sw" />
              <span className="nm">{short(s)}</span>
              <span className="pr">{money(priceFor(s, 1), settings.currency)}</span>
              {n > 0 && <span className="q">{n}</span>}
              {low && <i className="dot" title="Calidad baja a este tamaño" />}
            </button>
          );
        })}
        {others.length > 0 && (
          <div className="more-sizes up">
            <button className="ob-size more" onClick={() => setMoreOpen(!moreOpen)}>Más tamaños <Icon name="chevron" size={16} /></button>
            {moreOpen && (
              <div className="more-list">
                {others.map((s) => <button key={s.id} onClick={() => pickOther(s.id)}><span><i className="sw-inline" style={{ background: color(s.id) }} /> {s.name}</span><span className="muted">{money(s.price, settings.currency)}</span></button>)}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  const saveText = () => {
    const v = textDraft.value.trim();
    if (textDraft.editId) {
      setOverlay({ ...ed.overlay, texts: (ed.overlay.texts || []).map((t) => (t.id === textDraft.editId ? { ...t, text: v, ...textStyle } : t)).filter((t) => t.text) });
    } else if (v) {
      const id = `t${Date.now().toString(36)}`;
      setOverlay({ ...ed.overlay, texts: [...(ed.overlay.texts || []), { id, text: v, x: textDraft.pos[0], y: textDraft.pos[1], ...textStyle }] });
      setSelText(id);
    }
    setTextDraft(null);
  };
  const selTextObj = (ed.overlay.texts || []).find((t) => t.id === selText);
  // Por defecto, en Polaroid el texto se coloca en el margen inferior.
  const defaultTextPos = L?.polaroid ? [0.5, (L.win.y + L.win.h + (L.card.h - L.win.y - L.win.h) / 2) / L.card.h] : [0.5, 0.85];

  return (
    <div className="screen">
      <div className="topbar slim">
        <button className="btn" onClick={onCancel}><Icon name="back" /> Salir</button>
        <h1>Elige y edita tus fotos</h1>
        <button className="btn" onClick={onAddMore}><Icon name="plus" /> Añadir más fotos</button>
        <button className="btn" disabled={!items.length} onClick={onHold}><Icon name="lock" /> Guardar para después</button>
      </div>

      <div className="studio2-body">
        <div className="stage" ref={stageRef}>
          {entry && photo && frame && (
            <CropEditor
              key={focusKey + curSize.id + (ed.border ? 'b' : '')}
              photo={photo} frame={frame} sheet={sheet}
              crop={ed.crops[curSize.id]} onChange={(c) => setEdit(focusKey, { crops: { ...ed.crops, [curSize.id]: c } })}
              fit={ed.fits[curSize.id]} onFit={(v) => setEdit(focusKey, { fits: { ...ed.fits, [curSize.id]: v } })}
              angle={ed.angle} onAngle={(a) => setEdit(focusKey, { angle: a })}
              mode={ed.mode} bg={ed.bg} adjust={ed.adjust} mask={maskPath(ed.mask)}
              maxW={Math.max(200, stage.w - 150)} maxH={Math.max(200, stage.h - 40)}
              lockGestures={!!tool}
              onModeChange={(m, p) => setEdit(focusKey, {
                mode: m,
                ...(p.fit ? { fits: { ...ed.fits, [curSize.id]: p.fit } } : {}),
                ...(p.crop ? { crops: { ...ed.crops, [curSize.id]: p.crop } } : {})
              })}
              overlay={(w, h) => (
                <OverlayLayer W={w} H={h} overlay={ed.overlay} onChange={setOverlay} tool={tool} pen={pen}
                  selected={selText} onSelect={setSelText}
                  onNewText={(pos) => setTextDraft({ pos, value: '' })} />
              )}
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
          {entry && <div className="stage-name">{entry.name}{photo ? ` · ${curSize.name}` : ''}{tool === 'draw' ? ' · Escribe con el dedo' : tool === 'text' ? ' · Toca donde quieras poner el texto' : ''}</div>}
        </div>

        <ThumbGrid roll={roll} focusKey={focusKey} badges={badges} selecting={selecting} selected={sel}
          onPick={(e) => (selecting ? toggleSel(e) : setFocusKey(e.key))}
          onLongPress={(e) => (selecting ? toggleSel(e) : startSelect(e))}
          onSelectAll={selectAll} />
      </div>

      <div className="optbar">
        {selecting ? (
          <>
            <section className="ob-sec">
              <h4>Selección</h4>
              <div className="sel-count"><b>{sel.size}</b> foto{sel.size === 1 ? '' : 's'}</div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={selectAll}>Todas</button>
                <button className="btn sm" onClick={() => setSel(new Set())}>Ninguna</button>
                <button className="btn sm" onClick={endSelect}><Icon name="close" size={16} /> Terminar</button>
              </div>
            </section>
            <section className="ob-sec grow">
              <h4>Tamaño para las seleccionadas</h4>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <button className={`ob-size keep ${!selSize ? 'on' : ''}`} onClick={() => setSelSize('')}><span className="nm">Mantener sus tamaños</span><span className="pr">solo cambia copias</span></button>
                <div style={{ flex: 1 }}>{sizeGrid(selSize, (id) => setSelSize(id), false)}</div>
              </div>
            </section>
            <section className="ob-sec">
              <h4>Copias</h4>
              <Stepper value={selQty} min={0} onChange={setSelQty} />
            </section>
            <section className="ob-sec ob-end">
              <button className="btn primary lg" disabled={!sel.size} onClick={applySelection}><Icon name="check" /> Aplicar a {sel.size}</button>
              <button className="btn danger sm" disabled={!sel.size} onClick={removeSelection}><Icon name="trash" size={18} /> Quitar del pedido</button>
            </section>
          </>
        ) : photo ? (
          <>
            <section className="ob-sec ob-size-sec">
              <h4>Tamaño {q && <span className={`q-inline ${q.level}`}>{q.label.split(':')[0]} · {q.dpi} ppp{!q.ok && rec && rec.id !== curSize.id && <button className="link" onClick={() => tapSize(rec.id)}>Mejor {short(rec)}</button>}</span>}</h4>
              {sizeGrid(curSize.id, tapSize, true)}
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                {qtyOf(focusKey, curSize.id) === 0
                  ? <button className="btn primary sm grow" onClick={() => setQty(focusKey, photo.id, curSize.id, 1)}><Icon name="plus" size={16} /> Añadir {short(curSize)}</button>
                  : <><span className="small grow">Copias <b>{short(curSize)}</b></span><Stepper value={qtyOf(focusKey, curSize.id)} min={0} onChange={(v) => setQty(focusKey, photo.id, curSize.id, v)} /></>}
              </div>
            </section>

            <section className="ob-sec" style={{ width: 270 }}>
              <h4>Encuadre</h4>
              <div className="seg mini">
                <button className={ed.mode === 'fill' ? 'on' : ''} onClick={() => setEdit(focusKey, { mode: 'fill' })}>Recortar</button>
                <button className={ed.mode === 'fit' ? 'on' : ''} onClick={() => setEdit(focusKey, { mode: 'fit' })}>Foto entera</button>
              </div>
              <div className="row" style={{ gap: 5, flexWrap: 'nowrap', opacity: ed.mode === 'fit' ? 1 : 0.55 }} title="Color de los márgenes al reducir la foto">
                {SWATCHES.map((c) => <button key={c} className={`swatch tiny ${ed.bg === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setEdit(focusKey, { bg: c })} aria-label={c} />)}
                <label className="swatch tiny custom" title="Otro color"><input type="color" value={ed.bg} onChange={(e) => setEdit(focusKey, { bg: e.target.value })} />+</label>
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                {!curSize.card && (
                  <label className="row small" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <input type="checkbox" checked={ed.border} onChange={(e) => setEdit(focusKey, { border: e.target.checked, borderMm: ed.borderMm || settings.defaultBorderMm || 5 })} style={{ width: 20, height: 20 }} />
                    Borde {ed.borderMm || 5} mm
                  </label>
                )}
                {!curSize.card && ed.border && <><button className="btn sm icon" onClick={() => setEdit(focusKey, { borderMm: Math.max(1, (ed.borderMm || 5) - 1) })}>−</button><button className="btn sm icon" onClick={() => setEdit(focusKey, { borderMm: Math.min(20, (ed.borderMm || 5) + 1) })}>+</button></>}
              </div>
              <div className="row tight-btns" style={{ gap: 4, flexWrap: 'nowrap' }}>
                {!curSize.card && <button className="btn sm" onClick={() => setEdit(focusKey, { land: { ...ed.land, [curSize.id]: !landOf(ed, curSize, photo) }, crops: { ...ed.crops, [curSize.id]: null } })}>Girar</button>}
                <button className="btn sm" onClick={() => setEdit(focusKey, { crops: { ...ed.crops, [curSize.id]: null }, fits: { ...ed.fits, [curSize.id]: null } })}>Centrar</button>
                <button className="btn sm" onClick={() => { setEdits((all) => { const n = { ...all }; delete n[focusKey]; return n; }); toast({ type: 'ok', text: 'Foto restaurada a su estado original' }); }}><Icon name="rotate" size={14} /> Restaurar</button>
              </div>
            </section>

            <section className="ob-sec ob-filters" style={{ width: 330 }}>
              <h4>Filtro</h4>
              <FilterGrid src={entry.thumb} adjust={ed.adjust} onChange={(a) => setEdit(focusKey, { adjust: a })} compact />
            </section>

            <section className="ob-sec" style={{ width: 230 }}>
              <h4>Color <button className="link" onClick={() => setEdit(focusKey, { adjust: { ...ed.adjust, brightness: 0, contrast: 0, saturation: 0, warmth: 0 } })}>Restablecer</button></h4>
              <ColorSliders adjust={ed.adjust} onChange={(a) => setEdit(focusKey, { adjust: a })} compact />
            </section>

            <section className="ob-sec" style={{ width: 200 }}>
              <h4>Más {!tool && (ed.overlay.texts?.length || ed.overlay.strokes?.length) ? <button className="link" onClick={() => setOverlay({ texts: [], strokes: [] })}>Quitar texto</button> : null}</h4>
              <div className="row tight-btns" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <button className={`btn sm ${tool === 'text' ? 'primary' : ''}`} onClick={() => { setTool(tool === 'text' ? null : 'text'); setSelText(null); }}>Aa Texto</button>
                <button className={`btn sm ${tool === 'draw' ? 'primary' : ''}`} onClick={() => setTool(tool === 'draw' ? null : 'draw')}>✎ A mano</button>
              </div>
              {tool === 'draw' && (
                <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  {OVERLAY_COLORS.slice(0, 4).map((c) => <button key={c} className={`swatch tiny ${pen.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setPen({ ...pen, color: c })} />)}
                  <button className="btn sm" disabled={!ed.overlay.strokes?.length} onClick={() => setOverlay({ ...ed.overlay, strokes: ed.overlay.strokes.slice(0, -1) })}>Deshacer</button>
                </div>
              )}
              {tool === 'text' && (
                <div className="row tight-btns" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setTextDraft({ pos: defaultTextPos, value: '' })}>+ Añadir</button>
                  {selTextObj && <button className="btn sm" onClick={() => { setTextStyle({ font: selTextObj.font, color: selTextObj.color, size: selTextObj.size }); setTextDraft({ pos: [selTextObj.x, selTextObj.y], value: selTextObj.text, editId: selTextObj.id }); }}>Editar</button>}
                  {selTextObj && <button className="btn sm danger" onClick={() => { setOverlay({ ...ed.overlay, texts: ed.overlay.texts.filter((t) => t.id !== selText) }); setSelText(null); }}>Borrar</button>}
                </div>
              )}
              {!tool && masks.length > 0 && (
                <select className="sel mini" value={ed.mask} onChange={(e) => setEdit(focusKey, { mask: e.target.value })}>
                  <option value="">Sin marco</option>
                  {masks.map((m) => <option key={m.name} value={m.name}>{m.name.replace(/\.png$/i, '')}</option>)}
                </select>
              )}
              {!tool && (
                <div className="row tight-btns" style={{ gap: 4, flexWrap: 'nowrap' }}>
                  <button className="btn sm" onClick={() => onVirtualCopy(entry)}><Icon name="copy" size={14} /> Copia virtual</button>
                  {entry.virtualOf && <button className="btn sm icon danger" onClick={() => onRemoveVirtual(entry)} aria-label="Quitar copia virtual"><Icon name="trash" size={14} /></button>}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="ob-sec grow"><p className="muted" style={{ margin: 0 }}>Toca una miniatura para verla en grande. Para elegir varias a la vez, mantén pulsada una.</p></section>
        )}

        <section className="ob-sec ob-end">
          {legend.length > 0 && (
            <div className="legend" title="Cada color indica un tamaño">
              {legend.map((l) => <span key={l.id}><i style={{ background: l.color }} />{l.name} <b>{l.qty}</b></span>)}
            </div>
          )}
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
            <div className="col" style={{ gap: 0 }}><span className="muted small">{count} copia{count === 1 ? '' : 's'}</span><span className="total">{money(total, settings.currency)}</span></div>
            <button className="btn primary lg" disabled={!items.length || Object.keys(busy).length > 0} onClick={onNext}>Continuar <Icon name="next" /></button>
          </div>
        </section>
      </div>

      {textDraft && (
        <Modal onClose={() => setTextDraft(null)}>
          <h2 style={{ margin: 0, fontWeight: 400 }}>{textDraft.editId ? 'Editar texto' : 'Añadir texto'}</h2>
          <div className="text-preview" style={{ fontFamily: `"${OVERLAY_FONTS.find((f) => f.id === textStyle.font)?.family}"`, color: textStyle.color, background: textStyle.color === '#ffffff' ? '#0F2740' : '#fff' }}>{textDraft.value || 'Escribe tu texto'}</div>
          <TouchField value={textDraft.value} onChange={(v) => setTextDraft({ ...textDraft, value: v })} placeholder="Texto" autoFocus maxLength={40} />
          <div className="row" style={{ gap: 6 }}>
            {OVERLAY_FONTS.map((f) => <button key={f.id} className={`chip sm ${textStyle.font === f.id ? 'on' : ''}`} style={{ fontFamily: `"${f.family}"` }} onClick={() => setTextStyle({ ...textStyle, font: f.id })}>{f.name}</button>)}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {OVERLAY_COLORS.map((c) => <button key={c} className={`swatch ${textStyle.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setTextStyle({ ...textStyle, color: c })} />)}
            <span className="small muted" style={{ marginLeft: 12 }}>Tamaño</span>
            <input type="range" min="0.03" max="0.16" step="0.005" value={textStyle.size} onChange={(e) => setTextStyle({ ...textStyle, size: Number(e.target.value) })} style={{ width: 220 }} />
          </div>
          <div className="row"><div className="spacer" /><button className="btn" onClick={() => setTextDraft(null)}>Cancelar</button><button className="btn primary" onClick={saveText}>Aceptar</button></div>
        </Modal>
      )}
    </div>
  );
}
