import React, { useEffect, useMemo, useState } from 'react';
import { fileUrl } from '../api.js';
import { Icon, Stepper, TouchField } from '../components/ui.jsx';
import CropEditor, { useBox } from '../components/CropEditor.jsx';
import Filmstrip from '../components/Filmstrip.jsx';
import { ColorSliders } from '../components/ColorTools.jsx';
import { sheetLayout, packSheets, cutGuides, defaultCrop, clampCropRot } from '../../../shared/layout.js';
import { money } from '../../../shared/presets.js';
import { DEFAULT_ADJUST, svgMatrixValues } from '../../../shared/color.js';

function customPreset(c) {
  const w = Number(c.w) || 0, h = Number(c.h) || 0;
  return { id: 'custom', name: `Personalizado ${w} x ${h} mm`, w, h, headMin: h * 0.68, headMax: h * 0.8, crownMm: h * 0.08 };
}

/** Precio igual que en el proceso principal: lotes a precio cerrado y el resto por hojas. */
export function idTotal(people, lots, preset, capacity) {
  let total = 0, loose = 0;
  for (const p of people) { const lot = lots.find((l) => l.id === p.lotId); if (lot) total += Number(lot.price) || 0; else loose += p.copies; }
  if (loose && capacity) total += Math.ceil(loose / capacity) * (preset.price || 0);
  return total;
}

/** Fotos carnet: formato → encuadre con guías de cara → hoja con guías de corte. Admite lotes de varias personas. */
export default function IdPhoto({ settings, roll, ensurePhoto, state, setState, onBack, onNext, onAddMore, onHold }) {
  const { presetId, custom } = state;
  const preset = presetId === 'custom' ? { ...customPreset(custom), price: settings.idPresets[0]?.price || 0 } : settings.idPresets.find((p) => p.id === presetId);
  if (!preset) return <PresetPicker settings={settings} onBack={onBack} onPick={(id, c) => setState((s) => ({ ...s, presetId: id, custom: c || s.custom }))} custom={custom} />;
  return <IdEditor settings={settings} roll={roll} ensurePhoto={ensurePhoto} preset={preset} state={state} setState={setState} onBack={() => setState((s) => ({ ...s, presetId: null }))} onNext={onNext} onAddMore={onAddMore} onHold={onHold} />;
}

function PresetPicker({ settings, onPick, onBack, custom }) {
  const [cw, setCw] = useState(String(custom?.w || ''));
  const [ch, setCh] = useState(String(custom?.h || ''));
  const regions = [...new Set(settings.idPresets.map((p) => p.region || 'Otros'))];
  const okCustom = Number(cw) >= 10 && Number(cw) <= 200 && Number(ch) >= 10 && Number(ch) <= 200;
  return (
    <div className="screen">
      <div className="topbar"><button className="btn" onClick={onBack}><Icon name="back" /> Volver</button><h1>Elige el tipo de foto carnet</h1></div>
      <div className="content col" style={{ gap: 28 }}>
        {regions.map((r) => (
          <div key={r} className="col">
            <h2 style={{ margin: 0 }}>{r}</h2>
            <div className="preset-grid">
              {settings.idPresets.filter((p) => (p.region || 'Otros') === r).map((p) => {
                const s = 56 / Math.max(p.w, p.h);
                return (
                  <button key={p.id} className="preset" onClick={() => onPick(p.id)}>
                    <span className="shape" style={{ width: p.w * s, height: p.h * s }} />
                    <span className="col" style={{ gap: 2 }}>
                      <b style={{ fontSize: 19 }}>{p.name}</b>
                      <span className="muted small">{p.w} x {p.h} mm · {money(p.price, settings.currency)} / hoja</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="card col" style={{ maxWidth: 820 }}>
          <h2 style={{ margin: 0 }}>Medida personalizada</h2>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><TouchField value={cw} onChange={setCw} placeholder="Ancho (mm)" layout="num" maxLength={3} /></div>
            <div style={{ flex: 1 }}><TouchField value={ch} onChange={setCh} placeholder="Alto (mm)" layout="num" maxLength={3} /></div>
          </div>
          <button className="btn primary" disabled={!okCustom} onClick={() => onPick('custom', { w: Number(cw), h: Number(ch) })}>Usar {cw || '?'} x {ch || '?'} mm</button>
        </div>
      </div>
    </div>
  );
}

function IdEditor({ settings, roll, ensurePhoto, preset, state, setState, onBack, onNext, onAddMore, onHold }) {
  const sheet = settings.sheets.find((s) => s.id === state.sheetId) || settings.sheets[0];
  const layout = sheetLayout(sheet, preset, state.gapMm, state.marginMm);
  const lots = settings.idLots.filter((l) => !l.presetId || l.presetId === preset.id);
  const [active, setActive] = useState(state.people[0]?.photoId || null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState({});
  const [colorOpen, setColorOpen] = useState(false);
  const [boxRef, box] = useBox();
  const frame = { w: preset.w, h: preset.h };
  const photoById = useMemo(() => Object.fromEntries(roll.filter((e) => e.photo).map((e) => [e.photo.id, e.photo])), [roll]);
  const people = state.people.filter((p) => photoById[p.photoId]).map((p) => ({ ...p, copies: lots.find((l) => l.id === p.lotId)?.photos ?? p.copies }));
  const cur = people.find((p) => p.photoId === active) || people[0];
  const setPerson = (photoId, patch) => setState((s) => ({ ...s, people: s.people.map((p) => (p.photoId === photoId ? { ...p, ...patch } : p)) }));

  const addPerson = async (e) => {
    if (e.photo && state.people.some((p) => p.photoId === e.photo.id)) { setActive(e.photo.id); return; }
    setBusy((b) => ({ ...b, [e.key]: true }));
    const ph = await ensurePhoto(e);
    setBusy((b) => { const n = { ...b }; delete n[e.key]; return n; });
    if (!ph) return;
    setState((s) => (s.people.some((p) => p.photoId === ph.id) ? s : { ...s, people: [...s.people, { photoId: ph.id, rollKey: e.key, crop: null, copies: Math.max(1, layout.capacity), lotId: '', adjust: { ...DEFAULT_ADJUST } }] }));
    setActive(ph.id);
  };
  // Con una sola foto cargada, se añade directamente como persona.
  useEffect(() => { if (!state.people.length && roll.length) addPerson(roll[0]); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sheets = packSheets(people.map((p, i) => ({ id: i, copies: p.copies })), layout.capacity, state.separateSheets);
  const total = idTotal(people, lots, preset, layout.capacity);
  const shown = sheets[Math.min(page, Math.max(0, sheets.length - 1))] || [];
  const badges = {};
  for (const p of people) badges[p.rollKey || roll.find((e) => e.photo?.id === p.photoId)?.key] = { count: p.copies };
  for (const k of Object.keys(busy)) (badges[k] ||= {}).busy = true;

  const spec = {
    kind: 'id', presetId: preset.id, custom: preset.id === 'custom' ? { w: preset.w, h: preset.h } : undefined,
    sheetId: sheet.id, gapMm: state.gapMm, marginMm: state.marginMm, guides: state.guides, separateSheets: state.separateSheets, faceGuides: state.faceGuides,
    people: people.map((p) => ({ photoId: p.photoId, rollKey: p.rollKey, crop: p.crop || defaultCrop(photoById[p.photoId].w, photoById[p.photoId].h, preset.w / preset.h), copies: p.copies, lotId: p.lotId || '', adjust: p.adjust, angle: p.angle || 0 }))
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={onBack}><Icon name="back" /> Formato</button>
        <h1>{preset.name} <span className="muted small">{preset.w} x {preset.h} mm</span></h1>
        <button className="btn" onClick={onAddMore}><Icon name="plus" /> Añadir más fotos</button>
        <button className="btn" disabled={!people.length} onClick={() => onHold(spec)}><Icon name="lock" /> Guardar para después</button>
      </div>
      <div className="content" style={{ overflow: 'hidden', paddingBottom: 8 }}>
        <div className="id-layout">
          <div className="people">
            <b>{people.length > 1 ? `Lote: ${people.length} personas` : 'Persona'}</b>
            {people.map((p) => (
              <div key={p.photoId} className={`person ${p.photoId === cur?.photoId ? 'on' : ''}`} onClick={() => setActive(p.photoId)}>
                <img src={fileUrl(photoById[p.photoId].thumb)} alt="" />
                <div className="col" style={{ gap: 6, flex: 1 }}>
                  {lots.length > 0 && (
                    <select className="sel" style={{ minHeight: 40, fontSize: 14 }} value={p.lotId || ''} onClick={(e) => e.stopPropagation()} onChange={(e) => setPerson(p.photoId, { lotId: e.target.value })}>
                      <option value="">Por hojas</option>
                      {lots.map((l) => <option key={l.id} value={l.id}>{l.name} · {money(l.price, settings.currency)}</option>)}
                    </select>
                  )}
                  {!p.lotId ? <Stepper value={p.copies} onChange={(v) => setPerson(p.photoId, { copies: v })} max={layout.capacity * 10} /> : <span className="small muted">{p.copies} fotos</span>}
                </div>
                <button className="btn sm icon danger" style={{ width: 40, minHeight: 40 }} onClick={(e) => { e.stopPropagation(); setState((s) => ({ ...s, people: s.people.filter((x) => x.photoId !== p.photoId) })); }} aria-label="Quitar"><Icon name="trash" size={18} /></button>
              </div>
            ))}
            <p className="muted small">Para un lote (familia, clase, empresa…) toca abajo una foto por persona.</p>
          </div>

          <div className="panel" style={{ alignItems: 'stretch', padding: 18 }}>
            {cur ? (
              <>
                <div className="row">
                  <b style={{ flex: 1 }}>Centra la cara dentro del óvalo</b>
                  <button className={`chip ${state.faceGuides ? 'on' : ''}`} onClick={() => setState((s) => ({ ...s, faceGuides: !s.faceGuides }))}>Guías de cara</button>
                  <button className={`chip ${colorOpen ? 'on' : ''}`} onClick={() => setColorOpen(!colorOpen)}>Color</button>
                  <button className="btn sm" onClick={() => setPerson(cur.photoId, { crop: null })}>Centrar</button>
                </div>
                <div ref={boxRef} style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CropEditor
                      key={cur.photoId + preset.id}
                      photo={photoById[cur.photoId]} frame={frame} crop={cur.crop} adjust={cur.adjust} dark={false}
                      angle={cur.angle || 0} onAngle={(a) => setPerson(cur.photoId, { angle: a })}
                      onChange={(c) => setPerson(cur.photoId, { crop: c })}
                      maxW={Math.max(160, box.w - (colorOpen ? 260 : 0) - 20)} maxH={Math.max(180, box.h - 70)} faceGuide={state.faceGuides ? preset : null}
                    />
                  </div>
                  {colorOpen && (
                    <div style={{ width: 240 }}>
                      <ColorSliders adjust={cur.adjust} onChange={(a) => setPerson(cur.photoId, { adjust: a })} />
                      <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setPerson(cur.photoId, { adjust: { ...DEFAULT_ADJUST } })}>Restablecer</button>
                    </div>
                  )}
                </div>
                {state.faceGuides && <p className="muted small" style={{ margin: 0 }}>La coronilla en la línea superior y la barbilla dentro de la franja verde.</p>}
              </>
            ) : <div className="empty">Toca una foto de abajo para empezar.</div>}
          </div>

          <div className="panel">
            <b>Hoja de impresión</b>
            <div className="row" style={{ gap: 8 }}>
              {settings.sheets.map((s) => <button key={s.id} className={`chip ${s.id === sheet.id ? 'on' : ''}`} onClick={() => setState((st) => ({ ...st, sheetId: s.id }))}>{s.name}</button>)}
            </div>
            <b>Guías de corte</b>
            <div className="row" style={{ gap: 8 }}>
              {[['none', 'Sin guías'], ['marks', 'Marcas'], ['lines', 'Líneas']].map(([v, l]) => (
                <button key={v} className={`chip ${state.guides === v ? 'on' : ''}`} onClick={() => setState((s) => ({ ...s, guides: v }))}>{l}</button>
              ))}
            </div>
            <div className="row">
              <span className="muted small" style={{ flex: 1 }}>Separación {state.gapMm} mm</span>
              <Stepper value={state.gapMm} min={0} max={10} onChange={(v) => setState((s) => ({ ...s, gapMm: v }))} />
            </div>
            {people.length > 1 && (
              <button className={`chip ${state.separateSheets ? 'on' : ''}`} onClick={() => setState((s) => ({ ...s, separateSheets: !s.separateSheets }))}>Cada persona en su propia hoja</button>
            )}
            <SheetPreview layout={layout} preset={preset} cells={shown} people={people} photoById={photoById} guides={state.guides} />
            <div className="row">
              <span className="muted small" style={{ flex: 1 }}>{layout.capacity} por hoja · {sheets.length} hoja{sheets.length === 1 ? '' : 's'}</span>
              {sheets.length > 1 && (
                <>
                  <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
                  <span className="small">{page + 1}/{sheets.length}</span>
                  <button className="btn sm" disabled={page >= sheets.length - 1} onClick={() => setPage(page + 1)}>›</button>
                </>
              )}
            </div>
            {!layout.capacity && <div style={{ color: 'var(--err)' }}>Esta medida no cabe en la hoja elegida.</div>}
          </div>
        </div>
      </div>
      <div className="studio-foot">
        <Filmstrip roll={roll} focusKey={cur?.rollKey} badges={badges} onPick={addPerson} />
        <div className="checkout-box">
          <span className="muted small">{people.reduce((a, p) => a + p.copies, 0)} fotos</span>
          <span className="total">{money(total, settings.currency)}</span>
          <button className="btn primary lg" disabled={!people.length || !layout.capacity || Object.keys(busy).length > 0} onClick={() => onNext(spec)}>Continuar <Icon name="next" /></button>
        </div>
      </div>
    </div>
  );
}

function SheetPreview({ layout, preset, cells, people, photoById, guides }) {
  const lines = cutGuides({ ...layout, cells: layout.cells.slice(0, cells.length) }, preset, guides);
  return (
    <div className="sheet-preview">
      <svg viewBox={`0 0 ${layout.sheetW} ${layout.sheetH}`}>
        <defs>
          {people.map((p, i) => (
            <filter key={i} id={`idf${i}`} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={svgMatrixValues(p.adjust)} /></filter>
          ))}
        </defs>
        <rect width={layout.sheetW} height={layout.sheetH} fill="#fff" />
        {cells.map((pi, j) => {
          const person = people[pi];
          const ph = photoById[person.photoId];
          const ang = person.angle || 0;
          const c = clampCropRot(person.crop || defaultCrop(ph.w, ph.h, preset.w / preset.h), ph.w, ph.h, ang);
          const cell = layout.cells[j];
          const cx = (c.x + c.w / 2) * ph.w, cy = (c.y + c.h / 2) * ph.h;
          return (
            <svg key={j} x={cell.x} y={cell.y} width={preset.w} height={preset.h} viewBox={`${c.x * ph.w} ${c.y * ph.h} ${c.w * ph.w} ${c.h * ph.h}`} preserveAspectRatio="none">
              <image href={fileUrl(ph.thumb)} width={ph.w} height={ph.h} preserveAspectRatio="none" filter={`url(#idf${pi})`} transform={ang ? `rotate(${ang} ${cx} ${cy})` : undefined} />
            </svg>
          );
        })}
        <g stroke="#555" strokeWidth="0.25">{lines.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}</g>
      </svg>
    </div>
  );
}
