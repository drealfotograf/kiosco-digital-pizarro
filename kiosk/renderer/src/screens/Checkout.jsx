import React, { useEffect, useState } from 'react';
import { api, on } from '../api.js';
import { Icon, TouchField, Busy, Modal } from '../components/ui.jsx';
import Quotes from '../components/Quotes.jsx';
import PinLock, { parseLock, errorText } from '../components/PinLock.jsx';
import PrintQueue from '../components/PrintQueue.jsx';
import { money, priceFor, sizeOutput } from '../../../shared/presets.js';

/** Resumen, datos del cliente y destino: impresión inmediata o laboratorio. */
/** ¿El pedido pedirá el PIN de caja? (mismo criterio que el proceso principal) */
export function willNeedPin(spec, s) {
  const p = s.pin || {};
  if (p.mode === 'all') return true;
  if (p.mode !== 'custom') return false;
  if (spec.kind === 'idlots' || spec.kind === 'id') return !!p.idlots;
  return !!p.prints || (spec.items || []).some((i) => (p.sizes || []).includes(i.sizeId));
}

/** Miniatura de una copia del pedido (incluidas las copias virtuales). */
function entryOf(roll, it) {
  if (it.vc) return roll.find((e) => e.virtualOf && e.photo?.id === it.photoId && e.key.startsWith(`${it.vc}:`));
  return roll.find((e) => e.photo?.id === it.photoId && !e.virtualOf);
}

export default function Checkout({ settings, spec, roll = [], orderOpts = {}, onBack, onDone }) {
  const [quote, setQuote] = useState(null);
  const [printable, setPrintable] = useState([]);
  const [printableLots, setPrintableLots] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null); // destino pendiente de confirmar
  const [keepPhotos, setKeepPhotos] = useState(settings.keepPhotosDefault !== false);
  const [openSize, setOpenSize] = useState(null); // tamaño desplegado en el lateral izquierdo
  const pinNeeded = willNeedPin(spec, settings) && !orderOpts.reprocessOf;
  const d = settings.delivery || { print: true, server: false };

  useEffect(() => { api('order:quote', spec).then(setQuote).catch((e) => setErr(e.message)); api('order:printable').then(setPrintable); api('order:printableLots').then(setPrintableLots).catch(() => {}); }, [spec]);
  useEffect(() => on('order-progress', (p) => setBusy(p.text)), []);

  const sizes = settings.printSizes;
  const lines = spec.kind === 'idlots'
    ? spec.lots.map((l, i) => {
      const lot = settings.idLotTypes.find((t) => t.id === l.lotId);
      return { label: `Lote ${i + 1}: ${lot?.name || l.lotId}`, qty: Math.max(1, l.copies | 0), unit: Number(lot?.price) || 0 };
    })
    : spec.kind === 'id'
    ? [{ label: `fotos carnet en ${quote?.sheets || '?'} hoja(s)`, qty: quote?.count || 0 }]
    : Object.values(spec.items.reduce((acc, it) => {
      const s = sizes.find((x) => x.id === it.sizeId);
      acc[it.sizeId] = acc[it.sizeId] || { label: s?.name || it.sizeId, qty: 0, size: s, sizeId: it.sizeId };
      acc[it.sizeId].qty += it.qty;
      return acc;
    }, {})).map((l) => ({ ...l, unit: priceFor(l.size, l.qty) }));

  // Se puede imprimir aquí si todos los tamaños tienen impresora asignada.
  const sheet = settings.sheets.find((s) => s.id === spec.sheetId);
  const sheet10 = sizes.find((x) => x.id === '10x15') || sizes.find((x) => !x.card && Math.abs(x.w - 102) < 2 && Math.abs(x.h - 152) < 2);
  // Lotes de carné: el tamaño de copia de cada papel usado (10x15 y/o 15x20).
  const lotPaperIds = spec.kind === 'idlots' ? [...new Set(spec.lots.map((l) => settings.idLotTypes.find((t) => t.id === l.lotId)?.paper || '10x15'))]
    .map((p) => (p === '10x15' ? sheet10?.id : sizes.find((x) => !x.card && (x.id === p || (Math.abs(x.w - 152) < 2 && Math.abs(x.h - 203) < 2)))?.id)) : [];
  const neededSizes = spec.kind === 'idlots' ? lotPaperIds : spec.kind === 'id'
    ? [sizes.find((x) => sheet && Math.abs(x.w - sheet.w) < 2 && Math.abs(x.h - sheet.h) < 2)?.id]
    : [...new Set(spec.items.map((i) => i.sizeId))];
  // Salida de cada tamaño (su menú en Tamaños, o la general): imprimir aquí, enviar al servidor o las dos.
  const outs = neededSizes.map((id) => sizeOutput(sizes.find((x) => x.id === id), settings));
  const toPrint = neededSizes.filter((id, i) => ['print', 'both'].includes(outs[i]));
  const anyServer = outs.some((o) => o === 'server' || o === 'both');
  const canPrintHere = spec.kind === 'idlots'
    ? toPrint.length > 0 && spec.lots.every((l) => printableLots.includes(l.lotId))
    : toPrint.every((id) => id && printable.includes(id));
  const labOk = !!(settings.lab?.serverUrl || settings.lab?.folder);

  const printHere = toPrint.length > 0 && canPrintHere;
  const laterOnly = !printHere;
  const mainDest = printHere || (!toPrint.length && anyServer) ? 'auto' : labOk ? 'lab' : null;
  const mainLabel = printHere ? (anyServer ? 'Imprimir y enviar al laboratorio' : 'Imprimir ahora') : 'Enviar al laboratorio';
  const ask = (destination) => {
    // Para recoger más tarde hacen falta el nombre y el teléfono (para avisar y entregar el pedido).
    const later = destination === 'lab' || (destination === 'auto' && anyServer && !printHere);
    if (later && (!name.trim() || phone.replace(/\D/g, '').length < 9)) {
      setErr(!name.trim() ? 'Para recoger el pedido más tarde, escribe tu nombre y tu teléfono.' : 'Para recoger el pedido más tarde, escribe un teléfono válido (9 cifras o más).');
      return;
    }
    setErr(''); setConfirm(destination);
  };
  const submit = async (destination) => {
    setConfirm(null);
    setErr(''); setBusy('Preparando tus fotos…');
    try {
      const r = await api('order:submit', { ...spec, destination, keepPhotos, customer: { name: name.trim(), phone: phone.trim() } }, orderOpts);
      onDone({ ...r, destination });
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <div className="screen">
      <div className="topbar"><button className="btn" onClick={onBack}><Icon name="back" /> Volver</button><h1>Resumen del pedido</h1>
        {orderOpts.reprocessOf && <span className="chip on">Reprocesando {orderOpts.reprocessOf}</span>}</div>
      <div className="content">
        <div className={`co-layout ${openSize ? 'open' : ''}`}>
          {openSize && (() => {
            const its = spec.items.filter((i) => i.sizeId === openSize);
            const z = sizes.find((x) => x.id === openSize);
            return (
              <aside className="card col co-drawer">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>{z?.name || openSize}</h3>
                  <button className="btn sm" onClick={() => setOpenSize(null)}><Icon name="close" size={16} /> Cerrar</button>
                </div>
                <span className="muted small">{its.length} foto{its.length === 1 ? '' : 's'} · {its.reduce((a, i) => a + i.qty, 0)} copias</span>
                <div className="co-thumbs">
                  {its.map((it, i) => {
                    const e = entryOf(roll, it);
                    return (
                      <div key={i} className="co-thumb">
                        {e ? <img src={e.thumb} alt="" /> : <span className="co-noimg" />}
                        <span className="co-qty">× {it.qty}</span>
                        <span className="co-name">{it.name || e?.name || ''}</span>
                      </div>
                    );
                  })}
                </div>
              </aside>
            );
          })()}
          <div className="card col">
            <h2 style={{ margin: 0 }}>Tu pedido</h2>
            {spec.kind === 'prints' && <span className="muted small" style={{ marginTop: -6 }}>Toca un tamaño para ver sus fotos.</span>}
            {lines.map((l) => (
              <button key={l.label} type="button" className={`co-line ${l.sizeId ? 'tap' : ''} ${openSize && openSize === l.sizeId ? 'on' : ''}`} disabled={!l.sizeId}
                onClick={() => l.sizeId && setOpenSize(openSize === l.sizeId ? null : l.sizeId)}>
                <span>{l.qty} × {l.label}{l.unit !== undefined && <span className="muted small"> · {money(l.unit, settings.currency)}/ud</span>}</span>
                <span className="row" style={{ gap: 8 }}>{l.unit !== undefined && <span>{money(l.qty * l.unit, settings.currency)}</span>}{l.sizeId && <Icon name="next" size={18} />}</span>
              </button>
            ))}
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
            <div className="row" style={{ justifyContent: 'space-between' }}><b className="big">Total</b><span className="total">{quote ? money(quote.total, settings.currency) : '…'}</span></div>
            <p className="muted small" style={{ margin: 0 }}>{pinNeeded ? 'Se imprime un ticket: paga en caja y te darán un PIN de 3 cifras para imprimir tus fotos.' : 'El pago se realiza en caja.'}</p>
          </div>
          <div className="card col">
            <h2 style={{ margin: 0 }}>Tus datos</h2>
            <TouchField value={name} onChange={setName} placeholder="Nombre" />
            <TouchField value={phone} onChange={setPhone} placeholder={laterOnly ? 'Teléfono' : 'Teléfono (obligatorio si recoges más tarde)'} layout="num" maxLength={15} />
            <label className="row keep-photos">
              <input type="checkbox" checked={keepPhotos} onChange={(e) => setKeepPhotos(e.target.checked)} />
              <span className="col" style={{ gap: 2 }}>
                <b>Guardar mis fotos {settings.ordersRetentionDays || 30} días</b>
                <span className="muted small">Para pedir más copias o corregir el pedido. Si lo desmarcas, tus fotos se borran en cuanto se entregue el pedido.</span>
              </span>
            </label>
          </div>
        </div>
        {err && <div className="card" style={{ maxWidth: 1300, margin: '20px auto 0', color: 'var(--err)' }}>{err}</div>}
      </div>
      <div className="footerbar">
        <div className="spacer" />
        {toPrint.length > 0 && !canPrintHere && <span className="muted small" style={{ maxWidth: 420 }}>Algún tamaño no tiene impresora en este kiosco{labOk ? ': el pedido se envía al laboratorio.' : '. Pide ayuda en el mostrador.'}</span>}
        {printHere && !anyServer && labOk && <button className="btn lg" onClick={() => ask('lab')}>Recoger más tarde (laboratorio)</button>}
        <button className="btn primary lg" disabled={!mainDest || !quote} onClick={() => ask(mainDest)}><Icon name={printHere ? 'print' : 'next'} /> {mainLabel}</button>
      </div>
      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <h2 style={{ margin: 0, fontWeight: 400 }}>{confirm === 'lab' ? '¿Confirmas el envío del pedido?' : '¿Confirmas la impresión?'}</h2>
          <div className="col" style={{ gap: 4, fontSize: 18 }}>
            {lines.map((l) => <div key={l.label} className="row" style={{ justifyContent: 'space-between' }}><span>{l.qty} × {l.label}</span>{l.unit !== undefined && <span>{money(l.qty * l.unit, settings.currency)}</span>}</div>)}
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}><b>Total</b><span className="total">{money(quote?.total || 0, settings.currency)}</span></div>
          </div>
          <p className="muted" style={{ margin: 0 }}>{pinNeeded
            ? 'Al confirmar se imprime tu ticket. Paga en caja y te darán un PIN de 3 cifras: con él empieza la impresión.'
            : `Al confirmar se ${confirm === 'lab' ? 'envía' : 'imprime'} el pedido y recibirás tu número de pedido.`}</p>
          <div className="row"><div className="spacer" /><button className="btn lg" onClick={() => setConfirm(null)}>Revisar</button><button className="btn primary lg" onClick={() => submit(confirm)}><Icon name="check" /> Sí, confirmar</button></div>
        </Modal>
      )}
      {busy && <Busy text={busy} />}
    </div>
  );
}

/**
 * Pedido pendiente de pago: el cliente paga en caja con su ticket y escribe aquí el PIN de 3 cifras.
 * Si en caja confirman la venta en Gestión, la impresión empieza sola.
 */
export function AwaitPin({ result, settings, onReleased, onFinish }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [left, setLeft] = useState(300);
  const [lock, setLock] = useState(null);
  useEffect(() => on('order-progress', (p) => setBusy(p.text)), []);
  useEffect(() => {
    const t = setInterval(async () => {
      setLeft((l) => { if (l <= 1) { clearInterval(t); onFinish(); } return l - 1; });
    }, 1000);
    // Venta confirmada en caja (Gestión): el pedido se imprime solo.
    const p = setInterval(async () => {
      const st = await api('order:state', result.orderNo).catch(() => null);
      if (st && st.status !== 'awaiting' && st.status !== 'processing') { clearInterval(p); onReleased({ ...result, awaiting: false, delivery: st.delivery }); }
    }, 3000);
    return () => { clearInterval(t); clearInterval(p); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setErr(''); setBusy('Comprobando el PIN…');
    try { const r = await api('order:release', result.orderNo, pin); onReleased({ ...result, ...r, awaiting: false }); }
    catch (e) { setPin(''); setLock(parseLock(e.message)); setErr(errorText(e.message)); } // PIN erróneo: se borra lo escrito
    setBusy('');
  };
  const t = result.ticket;
  return (
    <div className="screen await-screen">
      <Quotes every={15} fonts={settings.fonts?.messages} />
      <div className="card col await-card">
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 400 }}>Recoge tu ticket y paga en caja</h1>
        <div className="muted">Ticket nº</div>
        <div className="mono" style={{ fontSize: 60, fontWeight: 800, lineHeight: 1 }}>{t?.corto || result.orderNo}</div>
        <div className="big">{money(result.total, settings.currency)}</div>
        <p style={{ fontSize: 19, margin: 0 }}>Tu <b>PIN de 3 cifras</b> va impreso en el ticket. Paga en caja y escríbelo aquí para imprimir tus fotos.</p>
        {lock
          ? <PinLock lock={lock} onUnlocked={() => { setLock(null); setErr(''); }} />
          : <div style={{ width: 360 }}><TouchField value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 3))} placeholder="PIN" layout="num" secret maxLength={3} /></div>}
        {err && !lock && <div style={{ color: 'var(--err)', fontSize: 17 }}>{err}</div>}
        <div className="row">
          <button className="btn lg" onClick={onFinish}>Lo haré más tarde ({Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')})</button>
          <button className="btn primary lg" disabled={pin.length !== 3 || !!lock} onClick={go}><Icon name="print" /> Imprimir</button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Si te vas, en la pantalla de inicio pulsa «Tengo un PIN de caja» y escribe el número del ticket y el PIN.</p>
      </div>
      {busy && <Busy text={busy} />}
    </div>
  );
}

export function Done({ result, settings, onFinish }) {
  const [left, setLeft] = useState(60);
  useEffect(() => {
    const t = setInterval(() => setLeft((l) => { if (l <= 1) { clearInterval(t); onFinish(); } return l - 1; }), 1000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const printed = result.delivery ? result.delivery.printed : result.destination === 'print';
  const srv = result.delivery?.server;
  return (
    <div className="screen" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="card col" style={{ alignItems: 'center', textAlign: 'center', padding: 48, maxWidth: 720 }}>
        <div className="logo" style={{ background: 'var(--ok)' }}><Icon name="check" size={36} /></div>
        <h1 style={{ margin: 0, fontSize: 36 }}>{printed ? '¡Imprimiendo tus fotos!' : '¡Pedido enviado al laboratorio!'}</h1>
        <div className="muted">Número de pedido</div>
        <div className="mono" style={{ fontSize: 56, fontWeight: 800 }}>{result.orderNo}</div>
        <div className="big">{money(result.total, settings.currency)}</div>
        <p style={{ fontSize: 20, margin: 0 }}>{result.paid ? (printed ? 'Recoge tus copias en el mostrador.' : 'Te avisaremos cuando esté listo.') : printed ? 'Recoge tus copias y paga en caja con tu ticket.' : 'Te avisaremos cuando esté listo. Paga en caja con tu ticket.'}</p>
        {result.ticket?.printed?.error && <div className="quality mini justa" style={{ fontSize: 15 }}>No se pudo imprimir el ticket: indica el número de pedido en caja.</div>}
        {srv && (srv.server
          ? <div className="quality mini excelente" style={{ fontSize: 15 }}>Copia confirmada en el servidor: {srv.saved} archivo(s){srv.where ? ` en ${srv.where}` : ''}</div>
          : srv.local
            ? <div className="quality mini justa" style={{ fontSize: 15, textAlign: 'left' }}>El servidor no responde. Copia guardada en {srv.local}; se volverá a enviar automáticamente.</div>
            : <div className="quality mini baja" style={{ fontSize: 15 }}>No se ha podido enviar ni guardar la copia: avisa en el mostrador.</div>)}
        {printed && <PrintQueue />}
        <button className="btn primary lg" onClick={onFinish}>Terminar ({left})</button>
      </div>
    </div>
  );
}
