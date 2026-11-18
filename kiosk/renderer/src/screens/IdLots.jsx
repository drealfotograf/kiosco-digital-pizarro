import React, { useEffect, useMemo, useState } from 'react';
import { Icon, Stepper } from '../components/ui.jsx';
import CropEditor, { useBox } from '../components/CropEditor.jsx';
import ThumbGrid from '../components/ThumbGrid.jsx';
import LotPreview from '../components/LotPreview.jsx';
import { ColorSliders } from '../components/ColorTools.jsx';
import { defaultCropRot, followCrop, lotPaper } from '../../../shared/layout.js';
import { money, DEFAULT_ID_OPTIONS } from '../../../shared/presets.js';
import { DEFAULT_ADJUST } from '../../../shared/color.js';

let seq = 0;
const uid = () => `L${Date.now().toString(36)}${++seq}`;

/** Guías de cara para el tamaño del hueco (se toman de los formatos de carné con esa medida). */
/** Guías de cara del lote (van en el propio lote; si no, se buscan por medida en los formatos antiguos). */
function faceFor(settings, type, big = false) {
  if (!type || big) return null;
  if (type.face) return type.face;
  const w = type.pw, h = type.ph;
  const list = settings.idPresets || [];
  return list.find((p) => p.id === 'eu-pass' && p.w === w && p.h === h) || list.find((p) => p.w === w && p.h === h) || null;
}

export function newLot(settings, lotId, from = {}) {
  const o = { ...DEFAULT_ID_OPTIONS, ...(settings.idOptions || {}) };
  return {
    uid: uid(), lotId, photoId: from.photoId || null, rollKey: from.rollKey || null,
    crop: null, cropBig: null, angle: 0, adjust: { ...DEFAULT_ADJUST }, copies: 1,
    guides: o.allowGuides ? !!o.guides : false, border: o.allowBorder ? !!o.border : false
  };
}

export function lotsTotal(lots, settings) {
  return lots.reduce((a, l) => a + (Number(settings.idLotTypes.find((t) => t.id === l.lotId)?.price) || 0) * Math.max(1, l.copies | 0), 0);
}

/**
 * Lotes de fotos de carné: el cliente elige el lote (con su vista previa), encuadra la foto y decide las copias.
 * «Añadir otro lote» memoriza el actual (con su miniatura) y empieza otro sin salir de la pantalla.
 */
export default function IdLots({ settings, roll, ensurePhoto, lots, setLots, onBack, onAddMore, onHold, onNext }) {
  const types = (settings.idLotTypes || []).filter((t) => t.enabled !== false);
  const opts = { ...DEFAULT_ID_OPTIONS, ...(settings.idOptions || {}) };
  const [curId, setCurId] = useState(() => lots[lots.length - 1]?.uid);
  const [part, setPart] = useState('main'); // 'main' | 'big'
  // Papel de la hoja: los lotes se agrupan por papel (10x15 y 15x20).
  const papers = [...new Set(types.map((t) => t.paper || '10x15'))].sort();
  const [paperSel, setPaperSel] = useState(null);
  const [face, setFace] = useState(opts.faceGuides !== false);
  const [colorOpen, setColorOpen] = useState(false);
  const [busy, setBusy] = useState({});
  const [boxRef, box] = useBox();
  const photoByKey = useMemo(() => Object.fromEntries(roll.filter((e) => e.photo).map((e) => [e.key, e.photo])), [roll]);

  // Siempre hay un lote en edición.
  useEffect(() => {
    if (!lots.length && types.length) {
      const first = roll.find((e) => e.photo) || roll[0];
      const l = newLot(settings, types[0].id, first?.photo ? { photoId: first.photo.id, rollKey: first.key } : {});
      setLots([l]); setCurId(l.uid);
      if (first && !first.photo) pickPhoto(first, l.uid);
    } else if (!lots.find((l) => l.uid === curId) && lots.length) setCurId(lots[lots.length - 1].uid);
  }, [lots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = lots.find((l) => l.uid === curId);
  const type = types.find((t) => t.id === cur?.lotId) || settings.idLotTypes.find((t) => t.id === cur?.lotId);
  const photo = cur?.rollKey ? photoByKey[cur.rollKey] : null;
  const setCur = (patch) => setLots((all) => all.map((l) => (l.uid === curId ? { ...l, ...patch } : l)));
  const hasBig = type?.kind === 'grid+big' && !type.bigFollows; // con bigFollows la grande copia el encuadre de las pequeñas
  const editBig = hasBig && part === 'big';
  const frame = type ? (editBig ? { w: type.big.w, h: type.big.h } : { w: type.pw, h: type.ph }) : null;
  const faceGuide = face ? faceFor(settings, type, editBig) : null;
  const paper = paperSel || type?.paper || papers[0] || '10x15';
  const ready = lots.filter((l) => l.rollKey && photoByKey[l.rollKey]);
  const total = lotsTotal(ready, settings);

  useEffect(() => { if (!hasBig) setPart('main'); }, [hasBig]);

  async function pickPhoto(e, target = curId) {
    let p = e.photo;
    if (!p) {
      setBusy((b) => ({ ...b, [e.key]: true }));
      p = await ensurePhoto(e);
      setBusy((b) => { const n = { ...b }; delete n[e.key]; return n; });
    }
    if (!p) return;
    setLots((all) => all.map((l) => (l.uid === target ? { ...l, photoId: p.id, rollKey: e.key, crop: null, cropBig: null, angle: 0 } : l)));
  }

  const addAnother = () => {
    const l = newLot(settings, cur?.lotId || types[0]?.id, cur || {});
    setLots((all) => [...all, l]);
    setCurId(l.uid);
    setPart('main');
  };
  const removeLot = (u) => setLots((all) => all.filter((l) => l.uid !== u));

  const specOf = () => ({
    kind: 'idlots',
    lots: ready.map((l) => {
      const t = settings.idLotTypes.find((x) => x.id === l.lotId);
      const p = photoByKey[l.rollKey];
      return {
        lotId: l.lotId, photoId: p.id, rollKey: l.rollKey, copies: Math.max(1, l.copies | 0), adjust: l.adjust, angle: l.angle || 0,
        crop: l.crop || defaultCropRot(p.w, p.h, t.pw / t.ph, l.angle || 0),
        cropBig: t.kind !== 'grid+big' ? null
          : t.bigFollows ? followCrop(l.crop || defaultCropRot(p.w, p.h, t.pw / t.ph, l.angle || 0), p.w, p.h, t.big.w / t.big.h, l.angle || 0)
          : l.cropBig || defaultCropRot(p.w, p.h, t.big.w / t.big.h, l.angle || 0),
        guides: opts.allowGuides ? !!l.guides : false, border: opts.allowBorder ? !!l.border : false
      };
    })
  });

  const badges = {};
  for (const l of lots) if (l.rollKey) (badges[l.rollKey] ||= { sizes: [] }).sizes.push({ id: l.uid, qty: l.copies, color: l.uid === curId ? '#0F2740' : '#C9B29A', name: settings.idLotTypes.find((t) => t.id === l.lotId)?.name });
  for (const k of Object.keys(busy)) (badges[k] ||= { sizes: [] }).busy = true;

  if (!types.length) {
    return (
      <div className="screen"><div className="topbar"><button className="btn" onClick={onBack}><Icon name="back" /> Salir</button><h1>Fotos de carnet</h1></div>
        <div className="empty">No hay lotes de carnet activados. Pide ayuda en el mostrador.</div></div>
    );
  }

  return (
    <div className="screen">
      <div className="topbar slim">
        <button className="btn" onClick={onBack}><Icon name="back" /> Salir</button>
        <h1>Fotos de carnet</h1>
        <button className="btn" onClick={onAddMore}><Icon name="plus" /> Añadir más fotos</button>
        <button className="btn" disabled={!ready.length} onClick={() => onHold(specOf())}><Icon name="lock" /> Guardar para después</button>
      </div>

      <div className="idl-body">
        {/* 1. Tipo de lote, con su vista previa */}
        <aside className="idl-types">
          <h4>1 · Elige el papel y el lote</h4>
          {papers.length > 1 && (
            <div className="seg mini">
              {papers.map((p) => <button key={p} className={paper === p ? 'on' : ''} onClick={() => setPaperSel(p)}>Papel {lotPaper({ paper: p }).label}</button>)}
            </div>
          )}
          {types.filter((t) => (t.paper || '10x15') === paper).map((t) => (
            <button key={t.id} className={`idl-type ${cur?.lotId === t.id ? 'on' : ''}`} onClick={() => setCur({ lotId: t.id, crop: null, cropBig: null })}>
              <LotPreview lot={t} photo={cur?.lotId === t.id ? photo : null} entry={cur?.lotId === t.id ? cur : {}} width={236} />
              <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}><b>{t.name}</b><span>{money(t.price, settings.currency)}</span></span>
            </button>
          ))}
        </aside>

        {/* 2. Encuadre */}
        <section className="idl-editor">
          <div className="row" style={{ gap: 8 }}>
            <h4 style={{ flex: 1 }}>2 · Encuadra la foto</h4>
            {hasBig && (
              <div className="seg mini" style={{ width: 300 }}>
                <button className={part === 'main' ? 'on' : ''} onClick={() => setPart('main')}>Fotos {type.pw}x{type.ph}</button>
                <button className={part === 'big' ? 'on' : ''} onClick={() => setPart('big')}>Foto {type.big.w / 10}x{type.big.h / 10}</button>
              </div>
            )}
            {faceFor(settings, type, editBig) && <button className={`btn sm ${face ? 'primary' : ''}`} onClick={() => setFace(!face)}>Guías de cara</button>}
            <button className={`btn sm ${colorOpen ? 'primary' : ''}`} onClick={() => setColorOpen(!colorOpen)}>Color</button>
            <button className="btn sm" disabled={!photo} onClick={() => setCur(editBig ? { cropBig: null } : { crop: null })}>Centrar</button>
          </div>
          <div ref={boxRef} className="idl-crop">
            {photo && frame ? (
              <CropEditor key={cur.uid + part + type.id} photo={photo} frame={frame} dark={false}
                crop={editBig ? cur.cropBig : cur.crop} onChange={(c) => setCur(editBig ? { cropBig: c } : { crop: c })}
                angle={cur.angle || 0} onAngle={(a) => setCur({ angle: a })} adjust={cur.adjust} faceGuide={faceGuide}
                maxW={Math.max(160, box.w - (colorOpen ? 270 : 0) - 10)} maxH={Math.max(180, box.h - 10)} />
            ) : (
              <div className="empty">{busy[cur?.rollKey] ? <span className="spinner" /> : 'Toca una foto de la derecha.'}</div>
            )}
            {colorOpen && photo && (
              <div style={{ width: 250, flex: 'none' }}>
                <ColorSliders adjust={cur.adjust} onChange={(a) => setCur({ adjust: a })} compact />
                <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setCur({ adjust: { ...DEFAULT_ADJUST } })}>Restablecer</button>
              </div>
            )}
          </div>
          {faceGuide && <p className="muted small" style={{ margin: 0 }}>La coronilla en la línea superior y la barbilla dentro de la franja verde.</p>}
        </section>

        {/* 3. Vista previa, opciones, copias y lotes memorizados */}
        <section className="idl-side">
          <h4>3 · Así quedará tu hoja ({lotPaper(type).label})</h4>
          <div className="idl-sheet">{type && <LotPreview lot={type} photo={photo} entry={cur} width={400} />}</div>
          <div className="row" style={{ gap: 8 }}>
            {opts.allowGuides && <button className={`chip sm ${cur?.guides ? 'on' : ''}`} onClick={() => setCur({ guides: !cur.guides })}>Guías de corte</button>}
            {opts.allowBorder && <button className={`chip sm ${cur?.border ? 'on' : ''}`} onClick={() => setCur({ border: !cur.border })}>Marco de foto</button>}
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Copias de este lote</span>
            {cur && <Stepper value={cur.copies} min={1} max={50} onChange={(v) => setCur({ copies: v })} />}
          </div>
          <button className="btn" disabled={!photo} onClick={addAnother}><Icon name="plus" /> Añadir otro lote</button>

          {lots.length > 1 && (
            <div className="idl-list">
              <h4>Lotes del pedido</h4>
              {lots.map((l, i) => {
                const t = settings.idLotTypes.find((x) => x.id === l.lotId);
                const p = l.rollKey ? photoByKey[l.rollKey] : null;
                return (
                  <div key={l.uid} className={`idl-item ${l.uid === curId ? 'on' : ''}`} onClick={() => setCurId(l.uid)}>
                    {t && <LotPreview lot={t} photo={p} entry={l} width={96} />}
                    <div className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                      <b className="small">Lote {i + 1}{l.uid === curId ? ' · editando' : ''}</b>
                      <span className="small muted">{t?.name} · {l.copies} copia{l.copies === 1 ? '' : 's'}</span>
                    </div>
                    <span className="small">{money((Number(t?.price) || 0) * l.copies, settings.currency)}</span>
                    <button className="btn sm icon danger" onClick={(e) => { e.stopPropagation(); removeLot(l.uid); }} aria-label="Quitar lote"><Icon name="trash" size={16} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <ThumbGrid roll={roll} focusKey={cur?.rollKey} badges={badges} onPick={(e) => pickPhoto(e)} />
      </div>

      <div className="optbar">
        <section className="ob-sec grow"><p className="muted" style={{ margin: 0 }}>Elige el lote, toca tu foto a la derecha y encuádrala. Puedes pedir varias copias del mismo lote o añadir otro lote distinto.</p></section>
        <section className="ob-sec ob-end">
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
            <div className="col" style={{ gap: 0 }}><span className="muted small">{ready.length} lote{ready.length === 1 ? '' : 's'}</span><span className="total">{money(total, settings.currency)}</span></div>
            <button className="btn primary lg" disabled={!ready.length || Object.keys(busy).length > 0} onClick={() => onNext(specOf())}>Continuar <Icon name="next" /></button>
          </div>
        </section>
      </div>
    </div>
  );
}
