// Estadísticas del kiosco (Ajustes → Estadísticas).
// Registro anónimo, independiente de los pedidos (que se borran a los 30 días): un archivo por mes,
//   estadisticas/AAAA-MM.jsonl, con un evento por línea. No guarda nombres, teléfonos ni fotos (RGPD).
// Eventos:
//   session  { start, end, durMs, photos, sources[], flow, ordered, reason }
//   order    { orderNo, kind, total, copies, sizes{nombre: copias}, status }  (status: awaiting|printed|sent|error|cancelled)
//   print    { printer, sizeId, sizeName, wMm, hMm, copies }
//   paid     { orderNo, total }  (venta confirmada en caja / Gestión)
//   pinfail  { gate }           (PIN erróneo; lock: true si provocó un bloqueo)
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { dataDir, getSettings } from './config.js';

const dir = () => dataDir('estadisticas');
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Añade un evento al registro del mes (nunca hace fallar al que lo llama). */
export async function logEvent(type, data = {}) {
  try {
    const now = new Date();
    await fsp.mkdir(dir(), { recursive: true });
    await fsp.appendFile(path.join(dir(), `${monthKey(now)}.jsonl`), JSON.stringify({ type, at: now.toISOString(), ...data }) + '\n');
  } catch { /* sin disco: se pierde solo este evento */ }
}

async function readRange(from, to) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), 1);
  while (d <= to) {
    const f = path.join(dir(), `${monthKey(d)}.jsonl`);
    if (fs.existsSync(f)) {
      for (const line of (await fsp.readFile(f, 'utf8')).split('\n')) {
        if (!line.trim()) continue;
        try { const e = JSON.parse(line); const t = new Date(e.at); if (t >= from && t <= to) out.push(e); } catch { /* línea dañada */ }
      }
    }
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

// Consumo estimado de una DNP DS620 (rollo de papel y cinta por formato). Formatos sin dato: solo copias y m².
const DS620_ROLLS = [
  { a: 102, b: 152, media: '6x4"', perRoll: 400 },
  { a: 89, b: 127, media: '5x7" (corte 3,5x5")', perRoll: 460 },
  { a: 127, b: 178, media: '5x7"', perRoll: 230 },
  { a: 152, b: 203, media: '6x8"', perRoll: 200 },
  { a: 152, b: 229, media: '6x9"', perRoll: 180 },
  { a: 51, b: 152, media: '6x4" (tiras 2x6")', perRoll: 800 }
];
const rollFor = (w, h) => { const a = Math.min(w, h), b = Math.max(w, h); return DS620_ROLLS.find((r) => Math.abs(r.a - a) <= 3 && Math.abs(r.b - b) <= 3); };

const r2 = (n) => Math.round(n * 100) / 100;
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; return o; };

/**
 * Resumen de un periodo. range = { from, to } (ISO). groupBy: 'hour' para un día, 'day' para un mes.
 */
export async function statsSummary({ from, to, groupBy }) {
  const F = new Date(from), T = new Date(to);
  const ev = await readRange(F, T);
  const sessions = ev.filter((e) => e.type === 'session');
  const orders = ev.filter((e) => e.type === 'order');
  const prints = ev.filter((e) => e.type === 'print');
  const paid = ev.filter((e) => e.type === 'paid');
  const done = orders.filter((o) => o.status === 'printed' || o.status === 'sent');
  const durs = sessions.map((s) => s.durMs || 0).filter((x) => x > 0).sort((a, b) => a - b);

  // Serie temporal (por hora del día o por día del mes)
  const keyOf = (iso) => { const d = new Date(iso); return groupBy === 'hour' ? d.getHours() : d.getDate(); };
  const n = groupBy === 'hour' ? 24 : new Date(F.getFullYear(), F.getMonth() + 1, 0).getDate();
  const series = Array.from({ length: n }, (_, i) => ({ k: groupBy === 'hour' ? i : i + 1, sessions: 0, orders: 0, copies: 0, total: 0 }));
  const slot = (iso) => series[groupBy === 'hour' ? keyOf(iso) : keyOf(iso) - 1];
  for (const s of sessions) { const x = slot(s.start || s.at); if (x) x.sessions++; }
  for (const o of done) { const x = slot(o.at); if (x) { x.orders++; x.copies += o.copies || 0; x.total = r2(x.total + (o.total || 0)); } }

  // Afluencia: día de la semana × hora (inicio de sesión)
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const s of sessions) { const d = new Date(s.start || s.at); heat[(d.getDay() + 6) % 7][d.getHours()]++; }
  const byHour = Array(24).fill(0);
  heat.forEach((row) => row.forEach((v, h) => { byHour[h] += v; }));
  const peak = byHour.map((v, h) => ({ h, v })).filter((x) => x.v).sort((a, b) => b.v - a.v).slice(0, 3);

  // Impresoras: copias por impresora y formato, m² de papel y rollos estimados
  const printers = {};
  for (const p of prints) {
    const pr = (printers[p.printer] ||= { printer: p.printer, copies: 0, m2: 0, jobs: 0, sizes: {} });
    const c = p.copies || 1;
    pr.copies += c; pr.jobs++; pr.m2 += (p.wMm * p.hMm * c) / 1e6;
    const roll = rollFor(p.wMm, p.hMm);
    const sz = (pr.sizes[p.sizeName || p.sizeId] ||= { name: p.sizeName || p.sizeId, copies: 0, media: roll?.media || '', perRoll: roll?.perRoll || 0 });
    sz.copies += c;
  }
  const printerList = Object.values(printers).map((p) => ({
    ...p, m2: r2(p.m2),
    sizes: Object.values(p.sizes).map((z) => ({ ...z, rolls: z.perRoll ? r2(z.copies / z.perRoll) : null })).sort((a, b) => b.copies - a.copies),
    rolls: r2(Object.values(p.sizes).reduce((a, z) => a + (z.perRoll ? z.copies / z.perRoll : 0), 0))
  })).sort((a, b) => b.copies - a.copies);

  const sizes = {};
  for (const o of done) for (const [k, v] of Object.entries(o.sizes || {})) inc(sizes, k, v);
  // Detalle por tamaño: pedidos, copias, importe, enviadas al servidor y copias impresas en cada impresora.
  const detail = {};
  const row = (name) => (detail[name] ||= { name, orders: 0, copies: 0, amount: 0, server: 0, printed: 0, byPrinter: {} });
  for (const o of done) {
    for (const [k, v] of Object.entries(o.sizes || {})) { const r = row(k); r.orders++; r.copies += v; r.amount = r2(r.amount + (o.amounts?.[k] || 0)); }
    for (const [k, v] of Object.entries(o.server || {})) row(k).server += v;
  }
  const printerNames = [...new Set(prints.map((p) => p.printer))];
  for (const p of prints) { const r = row(p.sizeName || p.sizeId); r.printed += p.copies || 1; inc(r.byPrinter, p.printer, p.copies || 1); }
  const allCopies = Object.values(detail).reduce((a, r) => a + r.copies, 0);
  const sizeDetail = Object.values(detail).map((r) => ({ ...r, share: allCopies ? Math.round((r.copies / allCopies) * 1000) / 10 : 0 })).sort((a, b) => b.copies - a.copies);
  const kindAmount = {};
  for (const o of done) inc(kindAmount, o.kind === 'idlots' || o.kind === 'id' ? 'Carnet' : 'Copias', o.total || 0);
  // Día de la semana con más sesiones
  const byDay = Array(7).fill(0);
  heat.forEach((row2, d) => { byDay[d] = row2.reduce((a, b) => a + b, 0); });
  const busiestDay = byDay.some((v) => v) ? byDay.indexOf(Math.max(...byDay)) : -1;
  const sources = {};
  for (const s of sessions) for (const k of s.sources || []) inc(sources, k);
  const kinds = {};
  for (const o of done) inc(kinds, o.kind === 'idlots' || o.kind === 'id' ? 'Carnet' : 'Copias');
  const reasons = {};
  for (const s of sessions) if (!s.ordered) inc(reasons, s.reason === 'idle' ? 'Por inactividad' : 'Salió sin pedir');

  const ordered = sessions.filter((s) => s.ordered).length;
  const totalDone = r2(done.reduce((a, o) => a + (o.total || 0), 0));
  return {
    range: { from, to, groupBy },
    currency: getSettings().currency,
    kpi: {
      sessions: sessions.length,
      avgSessionMin: durs.length ? r2(durs.reduce((a, b) => a + b, 0) / durs.length / 60000) : 0,
      medianSessionMin: durs.length ? r2(durs[Math.floor(durs.length / 2)] / 60000) : 0,
      photosPerSession: sessions.length ? r2(sessions.reduce((a, s) => a + (s.photos || 0), 0) / sessions.length) : 0,
      conversion: sessions.length ? Math.round((ordered / sessions.length) * 100) : 0,
      orders: done.length,
      copies: done.reduce((a, o) => a + (o.copies || 0), 0),
      total: totalDone,
      avgTicket: done.length ? r2(totalDone / done.length) : 0,
      paid: r2(paid.reduce((a, p) => a + (p.total || 0), 0)),
      paidCount: paid.length,
      // Pidieron PIN y aún no se han impreso, enviado ni anulado.
      awaiting: orders.filter((o) => o.status === 'awaiting' && !orders.some((x) => x.orderNo === o.orderNo && x.status !== 'awaiting')).length,
      cancelled: orders.filter((o) => o.status === 'cancelled').length,
      errors: orders.filter((o) => o.status === 'error').length,
      pinFails: ev.filter((e) => e.type === 'pinfail').length,
      pinLocks: ev.filter((e) => e.type === 'pinfail' && e.lock).length,
      printed: prints.reduce((a, p) => a + (p.copies || 1), 0),
      serverCopies: done.reduce((a, o) => a + Object.values(o.server || {}).reduce((x, y) => x + y, 0), 0),
      copiesPerOrder: done.length ? r2(done.reduce((a, o) => a + (o.copies || 0), 0) / done.length) : 0,
      m2: r2(prints.reduce((a, p) => a + (p.wMm * p.hMm * (p.copies || 1)) / 1e6, 0))
    },
    series, heat, peak,
    printers: printerList,
    printerNames, sizeDetail, busiestDay, byDay,
    kindAmount: Object.entries(kindAmount).map(([name, n]) => ({ name, n: r2(n) })),
    sizes: Object.entries(sizes).map(([name, copies]) => ({ name, copies })).sort((a, b) => b.copies - a.copies),
    sources: Object.entries(sources).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    kinds: Object.entries(kinds).map(([name, n]) => ({ name, n })),
    abandoned: Object.entries(reasons).map(([name, n]) => ({ name, n })),
    recentSessions: sessions.slice(-12).reverse().map((s) => ({ start: s.start || s.at, durMs: s.durMs, photos: s.photos, sources: s.sources, ordered: s.ordered, reason: s.reason }))
  };
}

/** CSV de los eventos del periodo (para Excel). */
export async function statsCsv({ from, to }) {
  const ev = await readRange(new Date(from), new Date(to));
  const cols = ['fecha', 'tipo', 'pedido', 'tipo_pedido', 'importe', 'copias', 'impresora', 'tamaño', 'duracion_min', 'fotos', 'fuentes', 'pidio', 'estado'];
  const q = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = (n) => (n == null || n === '' ? '' : String(n).replace('.', ','));
  const rows = ev.map((e) => [
    new Date(e.at).toLocaleString('es-ES'), e.type, e.orderNo, e.kind, num(e.total), e.copies, e.printer, e.sizeName,
    e.durMs ? num(r2(e.durMs / 60000)) : '', e.photos, (e.sources || []).join(' / '), e.type === 'session' ? (e.ordered ? 'sí' : 'no') : '', e.status || e.reason || ''
  ].map(q).join(';'));
  return '﻿' + [cols.join(';'), ...rows].join('\r\n');
}
