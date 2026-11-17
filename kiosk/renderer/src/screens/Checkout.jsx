import React, { useEffect, useState } from 'react';
import { api, on } from '../api.js';
import { Icon, TouchField, Busy, Modal } from '../components/ui.jsx';
import { money, priceFor } from '../../../shared/presets.js';

/** Resumen, datos del cliente y destino: impresión inmediata o laboratorio. */
export default function Checkout({ settings, spec, orderOpts = {}, onBack, onDone }) {
  const [quote, setQuote] = useState(null);
  const [printable, setPrintable] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null); // destino pendiente de confirmar
  const d = settings.delivery || { print: true, server: false };

  useEffect(() => { api('order:quote', spec).then(setQuote).catch((e) => setErr(e.message)); api('order:printable').then(setPrintable); }, [spec]);
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
      acc[it.sizeId] = acc[it.sizeId] || { label: s?.name || it.sizeId, qty: 0, size: s };
      acc[it.sizeId].qty += it.qty;
      return acc;
    }, {})).map((l) => ({ ...l, unit: priceFor(l.size, l.qty) }));

  // Se puede imprimir aquí si todos los tamaños tienen impresora asignada.
  const sheet = settings.sheets.find((s) => s.id === spec.sheetId);
  const sheet10 = sizes.find((x) => x.id === '10x15') || sizes.find((x) => !x.card && Math.abs(x.w - 102) < 2 && Math.abs(x.h - 152) < 2);
  const neededSizes = spec.kind === 'idlots' ? [sheet10?.id] : spec.kind === 'id'
    ? [sizes.find((x) => sheet && Math.abs(x.w - sheet.w) < 2 && Math.abs(x.h - sheet.h) < 2)?.id]
    : [...new Set(spec.items.map((i) => i.sizeId))];
  const canPrintHere = neededSizes.every((id) => id && printable.includes(id));

  // Acciones según los ajustes de impresión: imprimir aquí y/o enviar al servidor.
  const printHere = d.print !== false && canPrintHere;
  const mainDest = printHere ? 'auto' : d.server ? 'lab' : null;
  const mainLabel = printHere ? (d.server ? 'Imprimir y enviar al laboratorio' : 'Imprimir ahora') : 'Enviar al laboratorio';
  const ask = (destination) => {
    const needName = destination === 'lab' || (destination === 'auto' && d.server && !printHere);
    if (needName && !name.trim()) { setErr('Escribe tu nombre para poder entregarte el pedido.'); return; }
    setErr(''); setConfirm(destination);
  };
  const submit = async (destination) => {
    setConfirm(null);
    setErr(''); setBusy('Preparando tus fotos…');
    try {
      const r = await api('order:submit', { ...spec, destination, customer: { name: name.trim(), phone: phone.trim() } }, orderOpts);
      onDone({ ...r, destination });
    } catch (e) { setErr(e.message); }
    setBusy('');
  };

  return (
    <div className="screen">
      <div className="topbar"><button className="btn" onClick={onBack}><Icon name="back" /> Volver</button><h1>Resumen del pedido</h1>
        {orderOpts.reprocessOf && <span className="chip on">Reprocesando {orderOpts.reprocessOf}</span>}</div>
      <div className="content">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 1300, margin: '0 auto' }}>
          <div className="card col">
            <h2 style={{ margin: 0 }}>Tu pedido</h2>
            {lines.map((l) => (
              <div key={l.label} className="row" style={{ justifyContent: 'space-between', fontSize: 20 }}>
                <span>{l.qty} × {l.label}{l.unit !== undefined && <span className="muted small"> · {money(l.unit, settings.currency)}/ud</span>}</span>
                {l.unit !== undefined && <span>{money(l.qty * l.unit, settings.currency)}</span>}
              </div>
            ))}
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%' }} />
            <div className="row" style={{ justifyContent: 'space-between' }}><b className="big">Total</b><span className="total">{quote ? money(quote.total, settings.currency) : '…'}</span></div>
            <p className="muted small" style={{ margin: 0 }}>El pago se realiza en caja.</p>
          </div>
          <div className="card col">
            <h2 style={{ margin: 0 }}>Tus datos</h2>
            <TouchField value={name} onChange={setName} placeholder="Nombre" />
            <TouchField value={phone} onChange={setPhone} placeholder="Teléfono (opcional)" layout="num" maxLength={15} />
          </div>
        </div>
        {err && <div className="card" style={{ maxWidth: 1300, margin: '20px auto 0', color: 'var(--err)' }}>{err}</div>}
      </div>
      <div className="footerbar">
        <div className="spacer" />
        {d.print !== false && !canPrintHere && <span className="muted small" style={{ maxWidth: 420 }}>Algún tamaño no tiene impresora en este kiosco{d.server ? ': el pedido se envía al laboratorio.' : '. Pide ayuda en el mostrador.'}</span>}
        {printHere && d.server === false && (settings.lab?.serverUrl || settings.lab?.folder) && <button className="btn lg" onClick={() => ask('lab')}>Recoger más tarde (laboratorio)</button>}
        <button className="btn primary lg" disabled={!mainDest || !quote} onClick={() => ask(mainDest)}><Icon name={printHere ? 'print' : 'next'} /> {mainLabel}</button>
      </div>
      {confirm && (
        <Modal onClose={() => setConfirm(null)}>
          <h2 style={{ margin: 0, fontWeight: 400 }}>{confirm === 'lab' ? '¿Confirmas el envío del pedido?' : '¿Confirmas la impresión?'}</h2>
          <div className="col" style={{ gap: 4, fontSize: 18 }}>
            {lines.map((l) => <div key={l.label} className="row" style={{ justifyContent: 'space-between' }}><span>{l.qty} × {l.label}</span>{l.unit !== undefined && <span>{money(l.qty * l.unit, settings.currency)}</span>}</div>)}
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}><b>Total</b><span className="total">{money(quote?.total || 0, settings.currency)}</span></div>
          </div>
          <p className="muted" style={{ margin: 0 }}>Al confirmar se {confirm === 'lab' ? 'envía' : 'imprime'} el pedido y recibirás tu número de pedido.</p>
          <div className="row"><div className="spacer" /><button className="btn lg" onClick={() => setConfirm(null)}>Revisar</button><button className="btn primary lg" onClick={() => submit(confirm)}><Icon name="check" /> Sí, confirmar</button></div>
        </Modal>
      )}
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
        <p style={{ fontSize: 20, margin: 0 }}>{printed ? 'Recoge tus copias y paga en caja con este número.' : 'Te avisaremos cuando esté listo. Indica este número en caja.'}</p>
        {srv && (srv.server
          ? <div className="quality mini excelente" style={{ fontSize: 15 }}>Copia confirmada en el servidor: {srv.saved} archivo(s){srv.where ? ` en ${srv.where}` : ''}</div>
          : srv.local
            ? <div className="quality mini justa" style={{ fontSize: 15, textAlign: 'left' }}>El servidor no responde. Copia guardada en {srv.local}; se volverá a enviar automáticamente.</div>
            : <div className="quality mini baja" style={{ fontSize: 15 }}>No se ha podido enviar ni guardar la copia: avisa en el mostrador.</div>)}
        <button className="btn primary lg" onClick={onFinish}>Terminar ({left})</button>
      </div>
    </div>
  );
}
