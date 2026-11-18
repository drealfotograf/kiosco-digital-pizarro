import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../components/ui.jsx';
import { money } from '../../../shared/presets.js';

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MEASURES = [['sessions', 'Sesiones'], ['orders', 'Pedidos'], ['copies', 'Copias'], ['total', 'Importe']];
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${String(Math.round(m * 10) / 10).replace('.', ',')} min`);
const num = (n) => new Intl.NumberFormat('es-ES').format(n || 0);

function rangeOf(mode, d) {
  if (mode === 'day') {
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { from: from.toISOString(), to: new Date(from.getTime() + 86400_000 - 1).toISOString(), groupBy: 'hour' };
  }
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return { from: from.toISOString(), to: new Date(next.getTime() - 1).toISOString(), groupBy: 'day' };
}

/** Ajustes → Estadísticas: sesiones, diario, mensual, consumos de impresora y horas de más afluencia. */
export default function AdminStats({ pin, settings, toast }) {
  const [mode, setMode] = useState('day');
  const [date, setDate] = useState(() => new Date());
  const [measure, setMeasure] = useState('sessions');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const range = useMemo(() => rangeOf(mode, date), [mode, date]);
  const cur = settings.currency;

  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    api('admin:stats', pin, range).then((d) => alive && setData(d)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [range, pin]);

  const move = (k) => setDate((d) => (mode === 'day' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + k) : new Date(d.getFullYear(), d.getMonth() + k, 1)));
  const today = new Date();
  const isNow = mode === 'day' ? date.toDateString() === today.toDateString() : date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  const title = mode === 'day'
    ? date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : `${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
  const csv = async () => {
    try { const f = await api('admin:statsCsv', pin, range, mode === 'day' ? date.toISOString().slice(0, 10) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`); if (f) toast({ type: 'ok', text: `Exportado a ${f}` }); }
    catch (e) { toast({ type: 'error', text: e.message }); }
  };

  const k = data?.kpi;
  return (
    <>
      <h2>Estadísticas</h2>
      {/* Filtros en una sola fila encima de todo */}
      <div className="row st-filters">
        <div className="seg" style={{ width: 260 }}>
          <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>Diaria</button>
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Mensual</button>
        </div>
        <button className="btn sm" onClick={() => move(-1)} aria-label="Anterior"><Icon name="back" size={18} /></button>
        <b className="st-title">{title}</b>
        <button className="btn sm" onClick={() => move(1)} disabled={isNow} aria-label="Siguiente"><Icon name="next" size={18} /></button>
        {!isNow && <button className="btn sm" onClick={() => setDate(new Date())}>{mode === 'day' ? 'Hoy' : 'Este mes'}</button>}
        <div className="spacer" />
        <button className="btn sm" disabled={!data} onClick={csv}>Exportar CSV</button>
      </div>
      {err && <div className="card" style={{ color: 'var(--err)' }}>{err}</div>}
      {!data && !err && <div className="empty"><div className="spinner" /></div>}
      {data && (
        <>
          <div className="st-kpis">
            <Kpi label="Sesiones" value={num(k.sessions)} sub={`${k.conversion} % hicieron pedido`} />
            <Kpi label="Duración media" value={fmtMin(k.avgSessionMin)} sub={`mediana ${fmtMin(k.medianSessionMin)} · ${String(k.photosPerSession).replace('.', ',')} fotos/sesión`} />
            <Kpi label="Pedidos" value={num(k.orders)} sub={`${num(k.copies)} copias (${String(k.copiesPerOrder).replace('.', ',')}/pedido) · ticket medio ${money(k.avgTicket, cur)}`} />
            <Kpi label="Importe de pedidos" value={money(k.total, cur)} sub={`${money(k.paid, cur)} confirmado en caja (${k.paidCount})`} />
            <Kpi label="Impreso en el kiosco" value={num(k.printed)} sub={`copias y hojas · ${String(k.m2).replace('.', ',')} m² · ${num(k.serverCopies)} enviadas al servidor`} />
            <Kpi label="Pendientes de pago" value={num(k.awaiting)} sub={`${k.cancelled} anulado(s) · ${k.errors} con error`} />
            <Kpi label="PIN erróneos" value={num(k.pinFails)} sub={`${k.pinLocks} bloqueo(s)`} />
          </div>

          <section className="card col st-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <b>{MEASURES.find((m) => m[0] === measure)[1]} {mode === 'day' ? 'por hora' : 'por día'}</b>
              <div className="seg mini" style={{ width: 420 }}>
                {MEASURES.map(([id, l]) => <button key={id} className={measure === id ? 'on' : ''} onClick={() => setMeasure(id)}>{l}</button>)}
              </div>
            </div>
            <Bars series={data.series} measure={measure} mode={mode} currency={cur} />
          </section>

          <div className="st-two">
            <section className="card col st-card">
              <b>Horas de más afluencia</b>
              {data.peak.length
                ? <div className="row" style={{ gap: 8 }}>{data.peak.map((p, i) => <span key={p.h} className={`st-peak ${i === 0 ? 'top' : ''}`}>{p.h}:00–{p.h + 1}:00 · {p.v} {p.v === 1 ? 'sesión' : 'sesiones'}</span>)}</div>
                : <span className="muted small">Sin sesiones en este periodo.</span>}
              {data.busiestDay >= 0 && <span className="small">Día con más afluencia: <b>{['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][data.busiestDay]}</b> ({data.byDay[data.busiestDay]} sesiones)</span>}
              <Heat heat={data.heat} />
            </section>
            <section className="card col st-card">
              <b>Sesiones</b>
              <MiniList title="Fuentes de fotos usadas" rows={data.sources.map((x) => [x.name, x.n])} />
              <MiniList title="Tipo de pedido" rows={data.kinds.map((x) => [x.name, x.n])} unit="pedidos" />
              <MiniList title="Importe por tipo" rows={data.kindAmount.map((x) => [x.name, x.n])} money={cur} />
              <MiniList title="Sesiones sin pedido" rows={data.abandoned.map((x) => [x.name, x.n])} />
            </section>
          </div>

          <section className="card col st-card">
            <b>Copias por tamaño y por impresora</b>
            {!data.sizeDetail.length && <span className="muted small">Sin copias en este periodo.</span>}
            {data.sizeDetail.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="t st-table">
                  <thead><tr><th>Tamaño</th><th className="n">Pedidos</th><th className="n">Copias</th><th className="n">% copias</th><th className="n">Importe</th>
                    {data.printerNames.map((p) => <th key={p} className="n">{p}</th>)}<th className="n">Al servidor</th></tr></thead>
                  <tbody>
                    {data.sizeDetail.map((r) => (
                      <tr key={r.name}><td>{r.name}</td><td className="n">{num(r.orders)}</td><td className="n"><b>{num(r.copies)}</b></td><td className="n">{String(r.share).replace('.', ',')} %</td><td className="n">{money(r.amount, cur)}</td>
                        {data.printerNames.map((p) => <td key={p} className="n">{r.byPrinter[p] ? num(r.byPrinter[p]) : '—'}</td>)}<td className="n">{r.server ? num(r.server) : '—'}</td></tr>
                    ))}
                    <tr className="st-total"><td>Total</td><td className="n">{num(k.orders)}</td><td className="n">{num(data.sizeDetail.reduce((a, r) => a + r.copies, 0))}</td><td className="n">100 %</td><td className="n">{money(data.sizeDetail.reduce((a, r) => a + r.amount, 0), cur)}</td>
                      {data.printerNames.map((p) => <td key={p} className="n">{num(data.sizeDetail.reduce((a, r) => a + (r.byPrinter[p] || 0), 0))}</td>)}<td className="n">{num(k.serverCopies)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card col st-card">
            <b>Consumos de las impresoras</b>
            {!data.printers.length && <span className="muted small">No se ha impreso nada en este periodo.</span>}
            {data.printers.map((p) => (
              <div key={p.printer} className="col" style={{ gap: 6 }}>
                <div className="row" style={{ gap: 16 }}>
                  <b style={{ fontSize: 17 }}>{p.printer}</b>
                  <span className="small">{num(p.copies)} copias · {num(p.jobs)} trabajos · {String(p.m2).replace('.', ',')} m² de papel{p.rolls ? ` · ≈ ${String(p.rolls).replace('.', ',')} rollos` : ''}</span>
                </div>
                <table className="t st-table">
                  <thead><tr><th>Formato</th><th className="n">Copias</th><th>Papel / cinta (DNP DS620)</th><th className="n">Rollos estimados</th></tr></thead>
                  <tbody>{p.sizes.map((z) => (
                    <tr key={z.name}><td>{z.name}</td><td className="n">{num(z.copies)}</td><td>{z.media ? `${z.media} · ${z.perRoll} copias/rollo` : '—'}</td><td className="n">{z.rolls == null ? '—' : z.copies && z.rolls < 0.01 ? '< 0,01' : String(z.rolls).replace('.', ',')}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
            <span className="muted small">Los rollos son una estimación según el rendimiento de los consumibles de la DNP DS620.</span>
          </section>

          <div className="st-two">
            <section className="card col st-card">
              <b>Tamaños más pedidos</b>
              <MiniList rows={data.sizes.map((x) => [x.name, x.copies])} unit="copias" />
            </section>
            <section className="card col st-card">
              <b>Últimas sesiones</b>
              <table className="t st-table">
                <thead><tr><th>Inicio</th><th className="n">Duración</th><th className="n">Fotos</th><th>Fuentes</th><th>Pedido</th></tr></thead>
                <tbody>{data.recentSessions.map((s, i) => (
                  <tr key={i}>
                    <td>{new Date(s.start).toLocaleString('es-ES', mode === 'day' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="n">{fmtMin((s.durMs || 0) / 60000)}</td><td className="n">{s.photos}</td>
                    <td className="small">{(s.sources || []).join(', ') || '—'}</td>
                    <td>{s.ordered ? 'Sí' : s.reason === 'idle' ? 'No (inactividad)' : 'No'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {!data.recentSessions.length && <span className="muted small">Sin sesiones en este periodo.</span>}
            </section>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Registro anónimo (sin nombres, teléfonos ni fotos), un archivo por mes en la carpeta de datos del kiosco. No se borra con los pedidos.</p>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, sub }) {
  return <div className="st-kpi"><span className="st-kpi-l">{label}</span><span className="st-kpi-v">{value}</span>{sub && <span className="st-kpi-s">{sub}</span>}</div>;
}

/** Barras de una sola medida (un solo eje), con valor al pasar el dedo o el ratón. */
function Bars({ series, measure, mode, currency }) {
  const [hover, setHover] = useState(null);
  const W = 1000, H = 220, padL = 44, padB = 26, padT = 12;
  const vals = series.map((s) => s[measure] || 0);
  const max = Math.max(1, ...vals);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })();
  const bw = (W - padL) / series.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  const fmt = (v) => (measure === 'total' ? money(v, currency) : num(v));
  const ticks = [0, nice / 2, nice];
  return (
    <div className="st-bars">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Gráfico de barras">
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="st-grid" /><text x={padL - 6} y={y(t) + 4} className="st-axis" textAnchor="end">{measure === 'total' ? Math.round(t) : num(t)}</text></g>)}
        {series.map((s, i) => {
          const v = s[measure] || 0;
          const x = padL + i * bw + 2, w = Math.max(2, bw - 4), top = y(v), h = H - padB - top;
          return (
            <g key={s.k} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              {v > 0 && <path d={`M${x},${H - padB} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + w - 4} Q${x + w},${top} ${x + w},${top + 4} V${H - padB} Z`} className={`st-bar ${hover === i ? 'on' : ''}`} />}
              {(mode === 'day' ? s.k % 3 === 0 : s.k === 1 || s.k % 5 === 0) && <text x={padL + i * bw + bw / 2} y={H - 8} className="st-axis" textAnchor="middle">{mode === 'day' ? `${s.k}h` : s.k}</text>}
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <div className="st-tip" style={{ left: `${((padL + hover * bw + bw / 2) / W) * 100}%` }}>
          <b>{mode === 'day' ? `${series[hover].k}:00–${series[hover].k + 1}:00` : `Día ${series[hover].k}`}</b>
          <span>{series[hover].sessions} sesiones · {series[hover].orders} pedidos</span>
          <span>{series[hover].copies} copias · {money(series[hover].total, currency)}</span>
        </div>
      )}
    </div>
  );
}

/** Afluencia: día de la semana × hora, un solo color de claro a oscuro. */
function Heat({ heat }) {
  const max = Math.max(1, ...heat.flat());
  const hours = Array.from({ length: 15 }, (_, i) => i + 8); // 8:00 a 22:00
  return (
    <div className="st-heat" role="table" aria-label="Sesiones por día y hora">
      <span />
      {hours.map((h) => <span key={h} className="st-axis-h">{h % 2 === 0 ? h : ''}</span>)}
      {heat.map((row, d) => (
        <React.Fragment key={d}>
          <span className="st-axis-d">{DAYS[d]}</span>
          {hours.map((h) => {
            const v = row[h];
            return <span key={h} className="st-cell" title={`${DAYS[d]} ${h}:00 · ${v} ${v === 1 ? 'sesión' : 'sesiones'}`}
              style={{ background: v ? `color-mix(in oklab, #0F2740 ${Math.round(18 + (v / max) * 82)}%, #F6F2EA)` : 'var(--surface-2)' }} />;
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function MiniList({ title, rows, unit, money: cur }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="col" style={{ gap: 4 }}>
      {title && <span className="muted small">{title}</span>}
      {!rows.length && <span className="muted small">—</span>}
      {rows.slice(0, 8).map(([name, n]) => (
        <div key={name} className="st-mini">
          <span className="st-mini-n">{name}</span>
          <span className="st-mini-bar"><i style={{ width: `${(n / max) * 100}%` }} /></span>
          <span className="st-mini-v">{cur ? money(n, cur) : num(n)}{unit ? ` ${unit}` : ''}</span>
        </div>
      ))}
    </div>
  );
}
