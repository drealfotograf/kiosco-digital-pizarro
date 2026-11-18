// Ticket para pagar en caja.
// - Se imprime en la impresora de tickets (80 mm). Sin impresora configurada, se guarda en PDF en la carpeta de la
//   impresora simulada, para las pruebas.
// - Se envía al servidor de la tienda, que lo deja «pendiente» hasta que el programa de Gestión Pizarro (o el personal
//   desde la web del servidor) confirma si la venta se realiza o se anula. Mientras está pendiente no cuenta en contabilidad.
// - Si el servidor no responde, el ticket se guarda en local y se reenvía solo.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { getSettings, dataDir } from './config.js';
import { priceFor } from '../shared/presets.js';
import { simFolder } from './print.js';

const pendingDir = () => dataDir('tickets-pendientes');
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Datos del ticket a partir del pedido. Las líneas llevan el código de artículo de cada tamaño o lote
 * (campo «Código» en Administración), para casarlas con las tarifas de Gestión Pizarro.
 */
export function makeTicket(order, s = getSettings()) {
  // El PIN de caja va impreso en grande en el ticket (lo pide la tienda).
  const lines = [];
  if (order.spec.kind === 'idlots') {
    for (const l of order.spec.lots) {
      const t = s.idLotTypes.find((x) => x.id === l.lotId) || {};
      const qty = Math.max(1, l.copies | 0);
      const unit = Number(t.price) || 0;
      lines.push({ codigo: t.code || `CARNET-${l.lotId}`, descripcion: `Carnet ${t.name || l.lotId}`, cantidad: qty, precio: r2(unit), importe: r2(unit * qty) });
    }
  } else if (order.spec.kind === 'id') {
    lines.push({ codigo: 'CARNET', descripcion: 'Fotos carnet', cantidad: 1, precio: r2(order.total), importe: r2(order.total) });
  } else {
    const bySize = {};
    for (const it of order.spec.items) bySize[it.sizeId] = (bySize[it.sizeId] || 0) + Math.max(1, it.qty | 0);
    for (const [id, qty] of Object.entries(bySize)) {
      const z = s.printSizes.find((x) => x.id === id) || { id, name: id, price: 0 };
      const unit = priceFor(z, qty);
      lines.push({ codigo: z.code || `FOTO-${id}`, descripcion: z.name, cantidad: qty, precio: r2(unit), importe: r2(unit * qty) });
    }
  }
  const total = r2(lines.reduce((a, l) => a + l.importe, 0));
  const pct = Number(s.ticket?.ivaPct ?? 21);
  const base = r2(total / (1 + pct / 100));
  return {
    numero: order.orderNo,
    corto: String(order.orderNo).split('-').pop(),
    fecha: order.createdAt || new Date().toISOString(),
    tienda: s.storeName,
    kiosco: s.kioskName || 'Kiosco',
    cliente: order.customer || {},
    lineas: lines,
    total,
    moneda: /^[A-Z]{3}$/.test(s.currency || '') ? s.currency : 'EUR',
    iva: { porcentaje: pct, base, cuota: r2(total - base) },
    requierePin: order.status === 'awaiting',
    pin: order.status === 'awaiting' ? order.pin : undefined,
    recogerMasTarde: order.destination === 'lab',
    estado: 'pendiente'
  };
}

// ---------- Código de barras Code 128 (juego B) con el número de pedido ----------
const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
export function code128Svg(text, h = 40) {
  const codes = [104, ...[...String(text)].map((c) => Math.max(0, Math.min(94, c.charCodeAt(0) - 32)))];
  const check = codes.reduce((a, c, i) => a + c * (i || 1), 0) % 103;
  const pattern = [...codes, check, 106].map((c) => C128[c]).join('');
  let x = 10, bars = '';
  [...pattern].forEach((w, i) => { const n = Number(w); if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${n}" height="${h}"/>`; x += n; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 10} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px">${bars}</svg>`;
}

const money = (n, cur) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur || 'EUR' }).format(n);

/** HTML del ticket de 80 mm (72 mm de zona imprimible). */
export function ticketHtml(t, s = getSettings()) {
  const tk = s.ticket || {};
  const head = (tk.header || '').split('\n').filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('');
  const foot = (tk.footer || '').split('\n').filter(Boolean).map((l) => `<div>${esc(l)}</div>`).join('');
  const f = new Date(t.fecha);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:80mm auto;margin:0} html,body{margin:0;padding:0;background:#fff}
    body{width:72mm;padding:3mm 4mm;font:12px/1.35 'Segoe UI',Arial,sans-serif;color:#000}
    .c{text-align:center} .b{font-weight:700} .big{font-size:26px;font-weight:800;letter-spacing:2px}
    hr{border:0;border-top:1px dashed #000;margin:6px 0} table{width:100%;border-collapse:collapse}
    td{vertical-align:top;padding:1px 0} td.n{text-align:right;white-space:nowrap} .s{font-size:10.5px}
    .box{border:2px solid #000;padding:5px;margin:6px 0;text-align:center;font-weight:700}
    .pinbox{border:3px solid #000;border-radius:6px;padding:4px 6px 6px;margin:6px 0;text-align:center}
    .pin{font-size:54px;font-weight:900;letter-spacing:14px;line-height:1.05;font-family:'Consolas','Courier New',monospace;padding-left:14px}
  </style></head><body>
    <div class="c b" style="font-size:16px">${esc(t.tienda)}</div>
    <div class="c s">${head}</div>
    <hr>
    <div class="c">TICKET DE PEDIDO · PAGO EN CAJA</div>
    <div class="c big">Nº ${esc(t.corto)}</div>
    <div class="c s">${esc(t.numero)} · ${f.toLocaleDateString('es-ES')} ${f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
    ${t.cliente?.name ? `<div class="c s">Cliente: ${esc(t.cliente.name)}${t.cliente.phone ? ` · ${esc(t.cliente.phone)}` : ''}</div>` : ''}
    <hr>
    <table>${t.lineas.map((l) => `<tr><td>${esc(l.cantidad)} × ${esc(l.descripcion)}<div class="s">${esc(l.codigo)} · ${money(l.precio, t.moneda)}/ud</div></td><td class="n">${money(l.importe, t.moneda)}</td></tr>`).join('')}</table>
    <hr>
    <table><tr><td class="b" style="font-size:16px">TOTAL</td><td class="n b" style="font-size:16px">${money(t.total, t.moneda)}</td></tr>
      <tr><td class="s">Base imponible</td><td class="n s">${money(t.iva.base, t.moneda)}</td></tr>
      <tr><td class="s">IVA ${esc(t.iva.porcentaje)} %</td><td class="n s">${money(t.iva.cuota, t.moneda)}</td></tr></table>
    <div class="box">PENDIENTE DE PAGO EN CAJA${t.recogerMasTarde ? '<br><span class="s">Pedido para recoger más tarde</span>' : ''}</div>
    ${t.requierePin && t.pin ? `<div class="pinbox"><div class="s">PIN PARA IMPRIMIR</div><div class="pin">${esc(t.pin)}</div><div class="s">Escríbelo en el kiosco después de pagar</div></div>` : ''}
    ${code128Svg(t.numero)}
    <div class="c s">${esc(t.numero)}</div>
    <div class="c s" style="margin-top:6px">${foot}</div>
    <div class="c s">Documento no válido como factura. Pide tu factura en caja.</div>
  </body></html>`;
}

/** Imprime el ticket en la impresora de tickets; sin impresora, lo guarda en PDF (pruebas). Devuelve dónde quedó. */
export async function printTicket(t) {
  const s = getSettings();
  const html = ticketHtml(t, s);
  const tmp = dataDir('ticket-tmp.html');
  await fsp.writeFile(tmp, html);
  const win = new BrowserWindow({ show: false, width: 302, height: 800, webPreferences: { sandbox: true } });
  try {
    await win.loadFile(tmp);
    const hPx = await win.webContents.executeJavaScript('document.body.scrollHeight');
    const hMm = Math.ceil((hPx * 25.4) / 96) + 6;
    const printer = s.ticket?.printer;
    if (printer) {
      await new Promise((resolve, reject) => win.webContents.print(
        { silent: true, deviceName: printer, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: 80000, height: hMm * 1000 } },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason || 'No se pudo imprimir el ticket')))
      ));
      return { printed: printer };
    }
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: { width: 80 / 25.4, height: hMm / 25.4 }, margins: { marginType: 'none' } });
    const dir = path.join(simFolder(), 'tickets');
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `ticket_${String(t.numero).replace(/[^\w-]/g, '_')}.pdf`);
    await fsp.writeFile(file, pdf);
    return { pdf: file };
  } finally {
    win.destroy();
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

function serverOf() {
  const lab = getSettings().lab || {};
  return lab.serverUrl ? { url: lab.serverUrl.replace(/\/+$/, ''), key: lab.kioskKey || '' } : null;
}

/** Envía el ticket al servidor; si no responde, queda en local para reenviarlo. */
export async function sendTicket(t, pin) {
  const srv = serverOf();
  const body = { ...t, pin: pin || undefined };
  try {
    if (!srv) throw new Error('Sin servidor configurado');
    const res = await fetch(`${srv.url}/api/tickets`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kiosk-key': srv.key }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
    return { sent: true };
  } catch (e) {
    await fsp.mkdir(pendingDir(), { recursive: true });
    await fsp.writeFile(path.join(pendingDir(), `${String(t.numero).replace(/[^\w-]/g, '_')}.json`), JSON.stringify(body, null, 2));
    return { sent: false, reason: e.message };
  }
}

/** Reenvía los tickets que no llegaron al servidor. */
export async function retryTickets() {
  if (!fs.existsSync(pendingDir()) || !serverOf()) return 0;
  let n = 0;
  for (const f of await fsp.readdir(pendingDir())) {
    const file = path.join(pendingDir(), f);
    try {
      const t = JSON.parse(await fsp.readFile(file, 'utf8'));
      const srv = serverOf();
      const res = await fetch(`${srv.url}/api/tickets`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kiosk-key': srv.key }, body: JSON.stringify(t), signal: AbortSignal.timeout(8000) });
      if (res.ok) { await fsp.rm(file, { force: true }); n++; }
    } catch { /* se probará más tarde */ }
  }
  return n;
}

/** Estado del ticket en el servidor: 'pendiente', 'pagado' o 'anulado' (null si no se puede saber). */
export async function ticketStatus(numero) {
  const srv = serverOf();
  if (!srv) return null;
  try {
    const res = await fetch(`${srv.url}/api/tickets/${encodeURIComponent(numero)}`, { headers: { 'x-kiosk-key': srv.key }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()).estado || null;
  } catch { return null; }
}
