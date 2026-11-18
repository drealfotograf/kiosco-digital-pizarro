import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon, Modal } from '../components/ui.jsx';
import { money, priceFor, sizeColor, sizeOutput, SIZE_OUTPUTS, ds620Supports } from '../../../shared/presets.js';

const OUT_LABEL = { print: 'Imprimir', server: 'Enviar al servidor', both: 'Imprimir y enviar', none: 'Nada' };
const fmt = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');

/**
 * Tarifas: lista de tamaños con su precio. «Editar» abre un panel donde se elige el tamaño, el precio por unidad,
 * los precios por cantidad, la impresora que lo imprime, qué se hace al confirmar (imprimir y/o servidor)
 * y la carpeta del servidor (la de por defecto mientras el administrador no la cambie).
 */
export default function AdminTariffs({ s, set, printers, pin, toast, dirty, setS }) {
  const [editId, setEditId] = useState(null);
  const cur = s.currency;
  const sizes = s.printSizes;
  const defFolder = s.delivery?.serverFolder || 'Laboratorio';
  const patchSize = (id, patch) => set('printSizes', sizes.map((z) => (z.id === id ? { ...z, ...patch } : z)));
  const printerName = (n) => printers.find((p) => p.name === n)?.displayName || n;

  return (
    <>
      <h2>Tarifas</h2>
      <div className="row">
        <button className="btn" disabled={dirty} onClick={async () => { const f = await api('tariffs:export', pin); if (f) toast({ type: 'ok', text: `Tarifas exportadas a ${f}` }); }}><Icon name="download" /> Exportar (CSV / Excel)</button>
        <button className="btn" disabled={dirty} onClick={async () => {
          try { const r = await api('tariffs:import', pin); if (r) { setS(r.settings); toast({ type: 'ok', text: `Importado: ${r.summary.updated} actualizadas, ${r.summary.added} nuevas, ${r.summary.skipped} omitidas` }); } } catch (e) { toast({ type: 'error', text: e.message }); }
        }}><Icon name="plus" /> Importar</button>
        {dirty && <span className="muted small">Guarda los cambios antes de importar o exportar</span>}
      </div>

      <h3 style={{ margin: 0 }}>Copias</h3>
      <table className="t tar-list">
        <thead><tr><th>Tamaño</th><th className="n">Precio/ud</th><th>Precio por cantidad</th><th>Impresora</th><th>Al confirmar</th><th /></tr></thead>
        <tbody>{sizes.map((z) => {
          const out = sizeOutput(z, s);
          const tiers = [...(z.tiers || [])].sort((a, b) => a.from - b.from);
          const prs = (z.printers || []).filter(Boolean);
          const auto = !prs.length && s.simPrinter?.enabled && ds620Supports(z.w, z.h);
          return (
            <tr key={z.id}>
              <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><i className="tar-dot" style={{ background: sizeColor(sizes, z.id) }} /><b>{z.name}</b></span></td>
              <td className="n">{money(z.price, cur)}</td>
              <td className="small">{tiers.length ? tiers.map((t) => `desde ${t.from}: ${fmt(t.price)} €`).join(' · ') : <span className="muted">—</span>}</td>
              <td className="small">{prs.length ? prs.map(printerName).join(', ') : auto ? <span className="muted">DS620 simulada (automática)</span> : <span style={{ color: out === 'server' ? 'var(--taupe)' : 'var(--err)' }}>{out === 'server' ? 'No necesita' : 'Sin impresora'}</span>}</td>
              <td className="small">{OUT_LABEL[out]}{z.out === 'auto' || !z.out ? <span className="muted"> (general)</span> : ''}{['server', 'both'].includes(out) && <div className="muted">Carpeta: {z.serverFolder || `${defFolder} (por defecto)`}</div>}</td>
              <td><button className="btn sm" onClick={() => setEditId(z.id)}><Icon name="crop" size={16} /> Editar</button></td>
            </tr>
          );
        })}</tbody>
      </table>

      <h3 style={{ margin: 0 }}>Lotes de carnet (precio por lote)</h3>
      <table className="t">
        <thead><tr><th>Lote</th><th style={{ width: 140 }}>Precio</th><th>Ofrecido</th></tr></thead>
        <tbody>{(s.idLotTypes || []).map((l, i) => (
          <tr key={l.id}><td>{l.name}</td>
            <td><input className="inp" type="number" step="0.5" value={l.price} onChange={(e) => set('idLotTypes', s.idLotTypes.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} /></td>
            <td className="small">{l.enabled === false ? 'No' : 'Sí'}</td></tr>
        ))}</tbody>
      </table>

      {editId && <TariffEditor s={s} sizes={sizes} id={editId} setId={setEditId} patch={patchSize} printers={printers} pin={pin} defFolder={defFolder} onClose={() => setEditId(null)} />}
    </>
  );
}

function TariffEditor({ s, sizes, id, setId, patch, printers, pin, defFolder, onClose }) {
  const z = sizes.find((x) => x.id === id) || sizes[0];
  const cur = s.currency;
  const [folders, setFolders] = useState(null);
  const tiers = [...(z.tiers || [])].sort((a, b) => a.from - b.from);
  const setTiers = (t) => patch(z.id, { tiers: t.filter((x) => x.from > 0) });
  const out = z.out || 'auto';
  const effective = sizeOutput(z, s);
  const toServer = ['server', 'both'].includes(effective);
  useEffect(() => { if (toServer && !folders) api('admin:serverFolders', pin).then((r) => setFolders(r.folders || [])).catch(() => setFolders([])); }, [toServer]); // eslint-disable-line react-hooks/exhaustive-deps
  const examples = [1, 10, 50, 100].map((q) => ({ q, unit: priceFor(z, q) }));

  return (
    <Modal onClose={onClose}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontWeight: 400 }}>Editar tarifa</h2>
        <button className="btn sm" onClick={onClose}><Icon name="close" size={16} /> Cerrar</button>
      </div>
      <div className="tar-form">
        <label>Tamaño de impresión</label>
        <select className="inp" value={z.id} onChange={(e) => setId(e.target.value)}>
          {sizes.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.w} x {x.h} mm)</option>)}
        </select>

        <label>Precio por unidad</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}><input className="inp" type="number" min="0" step="0.01" style={{ width: 140 }} value={z.price} onChange={(e) => patch(z.id, { price: Math.max(0, Number(e.target.value)) })} /><span className="muted">{cur}</span></div>

        <label>Precio por cantidad</label>
        <div className="col" style={{ gap: 6 }}>
          {tiers.map((t, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <span className="small">Desde</span>
              <input className="inp" type="number" min="2" style={{ width: 100 }} value={t.from} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, from: Math.max(1, Math.round(Number(e.target.value))) } : x)))} />
              <span className="small">copias:</span>
              <input className="inp" type="number" min="0" step="0.01" style={{ width: 110 }} value={t.price} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: Math.max(0, Number(e.target.value)) } : x)))} />
              <span className="small">{cur}/ud</span>
              <button className="btn sm icon danger" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} aria-label="Quitar tramo"><Icon name="trash" size={16} /></button>
            </div>
          ))}
          <div className="row"><button className="btn sm" onClick={() => setTiers([...tiers, { from: (tiers.at(-1)?.from || 0) + 50, price: tiers.at(-1)?.price ?? z.price }])}><Icon name="plus" size={16} /> Añadir tramo</button></div>
          <span className="muted small">Ejemplo: {examples.map((e) => `${e.q} → ${fmt(e.unit)} €/ud`).join(' · ')}</span>
        </div>

        <label>Impresora</label>
        <div className="col" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 6 }}>
            {printers.map((p) => {
              const on = (z.printers || []).includes(p.name);
              return <span key={p.name} className={`pchip ${on ? 'on' : ''}`} onClick={() => patch(z.id, { printers: on ? z.printers.filter((x) => x !== p.name) : [...(z.printers || []), p.name] })}>{p.displayName}</span>;
            })}
            {!printers.length && <span className="muted small">No se encontraron impresoras</span>}
          </div>
          <span className="muted small">Con varias, los trabajos se reparten entre ellas.{!(z.printers || []).length && s.simPrinter?.enabled && ds620Supports(z.w, z.h) ? ' Sin ninguna marcada, usa la DS620 simulada.' : ''}</span>
        </div>

        <label>Al confirmar el pedido</label>
        <select className="inp" value={out} onChange={(e) => patch(z.id, { out: e.target.value })}>
          {SIZE_OUTPUTS.map(([k, l]) => <option key={k} value={k}>{k === 'auto' ? `${l} (${OUT_LABEL[sizeOutput({}, s)].toLowerCase()})` : l}</option>)}
        </select>

        {toServer && <>
          <label>Carpeta del servidor</label>
          <div className="col" style={{ gap: 6 }}>
            <label className="row small" style={{ gap: 8 }}>
              <input type="checkbox" checked={!z.serverFolder} onChange={(e) => patch(z.id, { serverFolder: e.target.checked ? '' : defFolder })} style={{ width: 22, height: 22 }} />
              Usar la carpeta por defecto: <b>{defFolder}</b>
            </label>
            {z.serverFolder !== undefined && z.serverFolder !== '' && (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input className="inp" list="tar-folders" value={z.serverFolder} onChange={(e) => patch(z.id, { serverFolder: e.target.value })} />
                <datalist id="tar-folders">{(folders || []).map((f) => <option key={f} value={f} />)}</datalist>
              </div>
            )}
            {folders?.length > 0 && z.serverFolder && <div className="row" style={{ gap: 6 }}>{folders.map((f) => <button key={f} className={`chip sm ${z.serverFolder === f ? 'on' : ''}`} onClick={() => patch(z.id, { serverFolder: f })}>{f}</button>)}</div>}
          </div>
        </>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>Los cambios se aplican al pulsar «Guardar» arriba.</p>
    </Modal>
  );
}
