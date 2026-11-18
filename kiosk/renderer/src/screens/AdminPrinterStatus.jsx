import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon, Modal } from '../components/ui.jsx';
import { ds620Supports, sizeOutput } from '../../../shared/presets.js';

const SIZE_NAME = { '102x152': '10x15', '51x152': '5x15', '127x178': '13x18', '89x127': '9x13', '152x203': '15x20', '152x229': '15x23' };
const LEVEL = { ok: 'Bien', low: 'Queda poco', empty: 'Sin papel' };

/**
 * Ajustes → Impresoras: solo las impresoras, cada una con su icono y el papel que le queda.
 * Al pulsar una se abren sus ajustes: papel (rollo y contador), tamaños que imprime y gestión de color (perfil ICC).
 */
export default function AdminPrinterStatus({ pin, printers, setPrinters, toast, s, set, save, dirty }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null); // nombre de la impresora abierta
  const load = () => api('admin:printerStatus', pin).then(setData).catch((e) => toast({ type: 'error', text: e.message }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return <div className="empty"><div className="spinner" /></div>;
  const real = printers.filter((p) => !/fax|onenote|xps/i.test(p.name));
  const st = (name) => data.status.find((x) => x.printer === name);
  const sizesOf = (name) => s.printSizes.filter((z) => (z.printers || []).includes(name));

  return (
    <>
      <h2>Impresoras</h2>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm" onClick={() => api('printers:list').then(setPrinters)}>Actualizar impresoras</button>
        <button className="btn sm" onClick={async () => {
          try { const r = await api('admin:importProfiles', pin); if (!r) return; toast({ type: r.skipped.length ? 'error' : 'ok', text: `Perfiles cargados: ${r.added.length}${r.skipped.length ? ` · omitidos: ${r.skipped.join('; ')}` : ''}` }); load(); }
          catch (e) { toast({ type: 'error', text: e.message }); }
        }}><Icon name="plus" size={16} /> Cargar perfiles ICC…</button>
        <span className="muted small">Pulsa una impresora para ver y cambiar sus ajustes.</span>
      </div>
      <div className="pr-tiles">
        {real.map((p) => {
          const m = st(p.name);
          const n = sizesOf(p.name).length;
          const cfg = data.cfg[p.name] || {};
          return (
            <button key={p.name} className={`pr-tile ${m ? m.level : ''}`} onClick={() => setOpen(p.name)}>
              <span className="pr-ico"><Icon name="print" size={44} />{m && m.level !== 'ok' && <i className={`pr-dot ${m.level}`} />}</span>
              <b className="pr-name">{p.displayName}</b>
              {m ? <>
                <span className="pr-bar"><i style={{ width: `${m.pct}%` }} /></span>
                <span className="small"><b>{m.left}</b> copias · {LEVEL[m.level]}</span>
              </> : <span className="small muted">Sin contador de papel</span>}
              <span className="small muted">{n ? `${n} tamaño${n === 1 ? '' : 's'}` : 'Sin tamaños'} · {cfg.color === 'profile' && cfg.profile ? 'perfil ICC' : 'sRGB'}{p.simulated ? ' · pruebas' : ''}</span>
            </button>
          );
        })}
      </div>
      {open && <PrinterPanel name={open} printer={printers.find((p) => p.name === open)} data={data} reload={load} pin={pin} toast={toast} s={s} set={set} save={save} dirty={dirty} onClose={() => setOpen(null)} />}
    </>
  );
}

function PrinterPanel({ name, printer, data, reload, pin, toast, s, set, save, dirty, onClose }) {
  const m = data.status.find((x) => x.printer === name);
  const [c, setC] = useState(() => ({ color: 'srgb', profile: '', adjust: { brightness: 0, contrast: 0, saturation: 0 }, ...(data.cfg[name] || {}) }));
  const [colorDirty, setColorDirty] = useState(false);
  const [roll, setRoll] = useState(null);
  const ed = (patch) => { setC((x) => ({ ...x, ...patch })); setColorDirty(true); };
  const toggleSize = (z) => set('printSizes', s.printSizes.map((x) => (x.id !== z.id ? x : { ...x, printers: (x.printers || []).includes(name) ? x.printers.filter((y) => y !== name) : [...(x.printers || []), name] })));
  const driverPaper = (z, v) => set('printSizes', s.printSizes.map((x) => (x.id === z.id ? { ...x, useDriverPaper: v } : x)));
  const saveAll = async () => {
    try {
      if (colorDirty) { await api('admin:printerColor', pin, name, c); setColorDirty(false); }
      if (dirty) await save();
      toast({ type: 'ok', text: `Ajustes de ${printer?.displayName || name} guardados` });
      reload();
    } catch (e) { toast({ type: 'error', text: e.message }); }
  };

  return (
    <Modal onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}><span className="pr-ico sm"><Icon name="print" size={30} /></span><h2 style={{ margin: 0, fontWeight: 400 }}>{printer?.displayName || name}</h2></div>
        <button className="btn sm" onClick={onClose}><Icon name="close" size={16} /> Cerrar</button>
      </div>
      <div className="pr-panel">
        {/* Papel */}
        <section className="col pr-sec">
          <h4>Papel</h4>
          {m ? <>
            <div className="pr-bar big"><i style={{ width: `${m.pct}%` }} /></div>
            <span><b style={{ fontSize: 22 }}>{m.left}</b> de {m.media.capacity} · {m.mediaLabel} · <span className={`pr-badge ${m.level}`}>{LEVEL[m.level]}</span></span>
            {m.formats.length > 0 && <span className="small muted">Quedan: {m.formats.map((f) => `${f.left} de ${SIZE_NAME[`${f.wMm}x${f.hMm}`] || `${f.wMm}x${f.hMm} mm`}`).join(' · ')}</span>}
            <span className="small muted">Rollo puesto el {new Date(m.media.loadedAt).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · aviso al quedar {m.media.warnAt}</span>
          </> : <span className="small muted">Windows no informa del papel que queda. Anota el rollo que tiene puesto y el kiosco irá descontando cada copia.</span>}
          {!roll
            ? <div className="row"><button className="btn sm" onClick={() => setRoll({ type: m?.media.type || (printer?.simulated || /ds620|dnp/i.test(name) ? 'ds620-6x8' : 'custom'), capacity: m?.media.capacity || 100, warnAt: m?.media.warnAt ?? 40 })}>Rollo nuevo…</button></div>
            : (
              <div className="col" style={{ gap: 8 }}>
                <select className="inp" value={roll.type} onChange={(e) => setRoll({ ...roll, type: e.target.value, capacity: data.media[e.target.value]?.capacity || roll.capacity })}>
                  {Object.entries(data.media).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  {roll.type === 'custom' && <><span className="small">Copias del rollo</span><input className="inp" type="number" min="1" style={{ width: 100 }} value={roll.capacity} onChange={(e) => setRoll({ ...roll, capacity: Number(e.target.value) })} /></>}
                  <span className="small">Avisar al quedar</span><input className="inp" type="number" min="0" style={{ width: 90 }} value={roll.warnAt} onChange={(e) => setRoll({ ...roll, warnAt: Number(e.target.value) })} />
                </div>
                <div className="row"><button className="btn sm" onClick={() => setRoll(null)}>Cancelar</button>
                  <button className="btn sm primary" onClick={async () => { try { await api('admin:changeRoll', pin, name, roll); setRoll(null); toast({ type: 'ok', text: 'Rollo nuevo anotado' }); reload(); } catch (e) { toast({ type: 'error', text: e.message }); } }}>Anotar rollo nuevo</button></div>
              </div>
            )}
        </section>

        {/* Tamaños */}
        <section className="col pr-sec">
          <h4>Tamaños que imprime</h4>
          <span className="small muted">Si un tamaño tiene varias impresoras, los trabajos se reparten. «Papel del driver» usa el tamaño de papel configurado en la impresora.</span>
          <div className="pr-sizes">
            {s.printSizes.map((z) => {
              const on = (z.printers || []).includes(name);
              const serverOnly = sizeOutput(z, s) === 'server';
              const unsupported = printer?.simulated && !ds620Supports(z.w, z.h);
              return (
                <div key={z.id} className={`pr-size ${on ? 'on' : ''}`}>
                  <label className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                    <input type="checkbox" checked={on} disabled={unsupported} onChange={() => toggleSize(z)} style={{ width: 22, height: 22 }} />
                    <span><b>{z.name}</b>{serverOnly && <span className="muted small"> · solo servidor</span>}{unsupported && <span className="muted small"> · no lo admite</span>}</span>
                  </label>
                  {on && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!z.useDriverPaper} onChange={(e) => driverPaper(z, e.target.checked)} /> Papel del driver
                    <button className="btn sm" disabled={dirty} title={dirty ? 'Guarda primero' : ''} onClick={async () => { try { await api('admin:testPrint', pin, name, z.id); toast({ type: 'ok', text: 'Página de prueba enviada' }); reload(); } catch (e) { toast({ type: 'error', text: e.message }); } }}>Prueba</button></label>}
                </div>
              );
            })}
          </div>
        </section>

        {/* Color */}
        <section className="col pr-sec">
          <h4>Gestión de color</h4>
          <div className="seg mini" style={{ maxWidth: 420 }}>
            <button className={c.color !== 'profile' ? 'on' : ''} onClick={() => ed({ color: 'srgb' })}>sRGB (gestiona el driver)</button>
            <button className={c.color === 'profile' ? 'on' : ''} onClick={() => ed({ color: 'profile' })}>Perfil ICC de la impresora</button>
          </div>
          {c.color === 'profile' && <>
            <select className="inp" value={c.profile} onChange={(e) => ed({ profile: e.target.value })}>
              <option value="">Elige un perfil…</option>
              {['kiosco', 'windows'].map((src) => {
                const list = data.profiles.filter((x) => x.source === src);
                return list.length ? <optgroup key={src} label={src === 'kiosco' ? 'Cargados en el kiosco' : 'Instalados en Windows'}>{list.map((x) => <option key={x.id} value={x.id}>{x.desc}</option>)}</optgroup> : null;
              })}
            </select>
            <span className="small muted">El kiosco convierte cada copia de sRGB al perfil elegido. En el driver de la impresora desactiva la gestión de color para no corregir dos veces. Los perfiles se cargan con «Cargar perfiles ICC…».</span>
          </>}
          {[['brightness', 'Brillo'], ['contrast', 'Contraste'], ['saturation', 'Saturación']].map(([k, l]) => (
            <label key={k} className="pr-adj"><span>{l}</span>
              <input type="range" min="-30" max="30" step="1" value={c.adjust?.[k] || 0} onChange={(e) => ed({ adjust: { ...c.adjust, [k]: Number(e.target.value) } })} />
              <b>{(c.adjust?.[k] || 0) > 0 ? '+' : ''}{c.adjust?.[k] || 0}</b>
            </label>
          ))}
          <div className="row"><button className="btn sm" disabled={colorDirty} title={colorDirty ? 'Guarda primero' : ''} onClick={async () => { try { await api('admin:colorTest', pin, name); toast({ type: 'ok', text: 'Carta de color enviada' }); reload(); } catch (e) { toast({ type: 'error', text: e.message }); } }}>Imprimir carta de color</button></div>
        </section>
      </div>
      <div className="row"><div className="spacer" />{(dirty || colorDirty) && <span className="muted small">Hay cambios sin guardar</span>}
        <button className="btn primary" disabled={!(dirty || colorDirty) || (c.color === 'profile' && !c.profile)} onClick={saveAll}>Guardar</button></div>
    </Modal>
  );
}
