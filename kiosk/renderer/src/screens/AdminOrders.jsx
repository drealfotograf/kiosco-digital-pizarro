import React, { useEffect, useState } from 'react';
import { api, on, thumbUrl } from '../api.js';
import { Icon, Modal, Busy } from '../components/ui.jsx';
import { money } from '../../../shared/presets.js';
import { FILTERS } from '../../../shared/color.js';

const TABS = [
  ['awaiting', 'Pendientes de pago'], ['held', 'Sin terminar'], ['sent', 'Enviados'], ['printed', 'Impresos'], ['error', 'Con error'], ['cancelled', 'Anulados']
];
const fmtDate = (d) => new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Gestión de pedidos guardados: revisar, eliminar, repetir (todo o parte), reprocesar y reintentar. */
export default function AdminOrders({ pin, settings, toast, onReprocess }) {
  const [status, setStatus] = useState('held');
  const [list, setList] = useState(null);
  const [counts, setCounts] = useState({});
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setList(await api('orders:list', pin, status));
    setCounts(await api('orders:counts', pin));
  };
  useEffect(() => { setList(null); load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => on('order-progress', (p) => setBusy((b) => (b ? p.text : b))), []);

  const open = async (no) => setDetail(await api('orders:get', pin, no));
  const run = async (label, fn) => {
    setBusy(label);
    try { await fn(); } catch (e) { toast({ type: 'error', text: e.message }); }
    setBusy('');
    load();
  };

  return (
    <>
      <h2>Pedidos</h2>
      <p className="muted" style={{ margin: 0 }}>Se guardan los originales y un archivo <code>pedido.json</code> con todos los ajustes del cliente durante {settings.ordersRetentionDays || 30} días.</p>
      <div className="seg" style={{ maxWidth: 760 }}>
        {TABS.map(([id, l]) => <button key={id} className={status === id ? 'on' : ''} onClick={() => setStatus(id)}>{l} <span className="count">{counts[id] || 0}</span></button>)}
      </div>
      {!list && <div className="empty"><div className="spinner" /></div>}
      {list && !list.length && <div className="empty">No hay pedidos en esta lista.</div>}
      <div className="order-list">
        {(list || []).map((o) => (
          <button key={o.orderNo} className="order-row" onClick={() => open(o.orderNo)}>
            <span className="thumbs">{o.thumbs.map((t) => <img key={t} src={thumbUrl(t, 200)} alt="" />)}</span>
            <span className="col" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <b className="mono">{o.code ? `Código ${o.code}` : o.orderNo}</b>
              <span className="small muted">{fmtDate(o.updatedAt)} · {o.customer?.name || 'Sin nombre'}{o.customer?.phone ? ` · ${o.customer.phone}` : ''}</span>
              {o.error && <span className="small" style={{ color: 'var(--err)' }}>⚠ {o.error}</span>}
            </span>
            <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
              <b>{money(o.total || 0, o.currency || settings.currency)}</b>
              <span className="small muted">{o.count || 0} {o.kind === 'id' ? 'fotos carnet' : 'copias'}</span>
            </span>
            <Icon name="next" />
          </button>
        ))}
      </div>
      {detail && (
        <OrderDetail order={detail} settings={settings} onClose={() => setDetail(null)}
          onDelete={() => run('Eliminando…', async () => { await api('orders:delete', pin, detail.orderNo); setDetail(null); toast({ type: 'ok', text: 'Pedido eliminado' }); })}
          onRepeat={(idx, dest) => run('Repitiendo pedido…', async () => { const r = await api('orders:repeat', pin, detail.orderNo, idx, dest); setDetail(null); toast({ type: 'ok', text: `Nuevo pedido ${r.orderNo} ${dest === 'print' ? 'impreso' : 'enviado'}` }); })}
          onRelease={() => run('Imprimiendo…', async () => { await api('orders:release', pin, detail.orderNo); setDetail(null); toast({ type: 'ok', text: 'Pedido liberado e impreso' }); })}
          onRetry={() => run('Reintentando…', async () => { await api('orders:retry', pin, detail.orderNo); setDetail(null); toast({ type: 'ok', text: 'Pedido completado' }); })}
          onReprocess={() => run('Abriendo pedido…', async () => onReprocess(await api('orders:reprocess', pin, detail.orderNo)))} />
      )}
      {busy && <Busy text={busy} />}
    </>
  );
}

function OrderDetail({ order, settings, onClose, onDelete, onRepeat, onRetry, onReprocess, onRelease }) {
  const lines = order.kind === 'id' ? order.spec.people : order.spec.items;
  const [sel, setSel] = useState(() => new Set(lines.map((_, i) => i)));
  const [confirmDel, setConfirmDel] = useState(false);
  const toggle = (i) => { const n = new Set(sel); n.has(i) ? n.delete(i) : n.add(i); setSel(n); };
  const idx = sel.size === lines.length ? null : [...sel];
  const preset = order.kind === 'id' ? settings.idPresets.find((p) => p.id === order.spec.presetId) : null;
  const sizeName = (id) => settings.printSizes.find((s) => s.id === id)?.name || id;
  const lotName = (id) => settings.idLots.find((l) => l.id === id)?.name;
  const filterName = (a) => FILTERS.find((f) => f.id === a?.filter)?.name || 'Original';
  const held = order.status === 'held';
  return (
    <Modal onClose={onClose}>
      <div className="row">
        <h2 style={{ margin: 0, flex: 1 }}>{held ? `Pedido sin terminar · código ${order.code}` : `Pedido ${order.orderNo}`}</h2>
        <span className={`status-pill ${order.status}`}>{({ held: 'Sin terminar', awaiting: 'Pendiente de pago', sent: 'Enviado', printed: 'Impreso', error: 'Con error', processing: 'Procesando', cancelled: 'Anulado' })[order.status]}</span>
        <button className="btn sm" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <div className="small muted">
        {order.customer?.name || 'Sin nombre'}{order.customer?.phone ? ` · ${order.customer.phone}` : ''} · creado {fmtDate(order.createdAt)} · {money(order.total || 0, order.currency || settings.currency)}
        {order.repeatOf && ` · repetición de ${order.repeatOf}`}{order.reprocessOf && ` · reproceso de ${order.reprocessOf}`}
        {order.kind === 'id' && ` · ${preset?.name || order.spec.presetId}`}
      </div>
      {order.error && <div className="card" style={{ color: 'var(--err)' }}>⚠ {order.error}</div>}
      {order.status === 'awaiting' && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <span>Pendiente de pago en caja. PIN para el cliente: <b className="mono" style={{ fontSize: 26, letterSpacing: 4 }}>{order.pin}</b>{order.pinTries ? <span className="small muted"> · {order.pinTries} intento(s) fallido(s)</span> : null}</span>
          <button className="btn primary" onClick={onRelease}><Icon name="print" size={20} /> Cobrado: liberar e imprimir</button>
        </div>
      )}
      {order.photosDeleted && <div className="small muted">El cliente pidió no guardar sus fotos: se borraron al entregar el pedido. Solo queda el registro.</div>}
      <div className="detail-list">
        {lines.map((l, i) => (
          <label key={i} className={`detail-row ${sel.has(i) ? 'on' : ''}`}>
            <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} />
            <img src={thumbUrl(order.photoPaths[l.photoId], 200)} alt="" />
            <span className="col" style={{ gap: 2, flex: 1 }}>
              <b>{order.kind === 'id' ? (lotName(l.lotId) || `${l.copies} fotos`) : sizeName(l.sizeId)}</b>
              <span className="small muted">
                {order.kind === 'id' ? `${l.copies} copias` : `${l.qty} copia${l.qty === 1 ? '' : 's'} · ${l.mode === 'fit' ? `con márgenes (${l.bg})` : 'recortada'}${l.mask ? ` · marco ${l.mask.replace(/\.png$/i, '')}` : ''}`}
                {` · filtro ${filterName(l.adjust)}`}
              </span>
              <span className="small muted">{order.photos.find((p) => p.id === l.photoId)?.name}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="row">
        {!confirmDel
          ? <button className="btn danger" onClick={() => setConfirmDel(true)}><Icon name="trash" size={20} /> Eliminar</button>
          : <><span className="small" style={{ color: 'var(--err)' }}>Se borrarán las fotos y el pedido. No se puede deshacer.</span><button className="btn danger" onClick={onDelete}>Sí, eliminar</button><button className="btn" onClick={() => setConfirmDel(false)}>No</button></>}
        <div className="spacer" />
        {order.status === 'error' && <button className="btn" onClick={onRetry}>Reintentar</button>}
        <button className="btn" onClick={onReprocess}><Icon name="crop" size={20} /> {held ? 'Continuar' : 'Reprocesar'}</button>
        {!held && <>
          <button className="btn" disabled={!sel.size} onClick={() => onRepeat(idx, 'lab')}>Repetir {idx ? `${sel.size}` : 'todo'} → laboratorio</button>
          <button className="btn primary" disabled={!sel.size} onClick={() => onRepeat(idx, 'print')}><Icon name="print" size={20} /> Repetir {idx ? `${sel.size}` : 'todo'} e imprimir</button>
        </>}
      </div>
    </Modal>
  );
}
