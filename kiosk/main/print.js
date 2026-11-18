import { BrowserWindow } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { getSettings } from './config.js';
import { ds620Supports } from '../shared/presets.js';
import { preparePrintFile, consumePrint } from './printers.js';
export { ds620Supports };

// ---------- Impresora simulada DNP DS620 (para probar sin impresora ni papel) ----------
export const SIM_PRINTER = 'SIMULADA · DNP DS620';
const simOn = () => !!getSettings().simPrinter?.enabled;
export const simFolder = () => getSettings().simPrinter?.folder || path.join(app.getPath('documents'), 'KioscoPizarro', 'Impresora simulada DNP DS620');

async function simPrint(file, { wMm, hMm, copies }) {
  if (!ds620Supports(wMm, hMm)) throw new Error(`La DNP DS620 no admite el papel de ${wMm}x${hMm} mm`);
  const n = Math.max(1, copies | 0);
  // La DS620 tarda unos 9 s por copia 10x15; aquí se simula más rápido (0,6 s por copia, máximo 6 s).
  await new Promise((r) => setTimeout(r, Math.min(6000, 600 * n)));
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(simFolder(), day);
  await fsp.mkdir(dir, { recursive: true });
  const stamp = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const name = `${stamp}_${Math.round(wMm)}x${Math.round(hMm)}_x${n}_${path.basename(file)}`;
  await fsp.copyFile(file, path.join(dir, name));
  await fsp.appendFile(path.join(simFolder(), 'registro.txt'), `${now.toLocaleString('es-ES')}	${Math.round(wMm)}x${Math.round(hMm)} mm	${n} copia(s)	${day}/${name}
`);
}

// Impresión silenciosa en impresoras de Windows. Cada impresora tiene su propia cola
// y los trabajos de un mismo tamaño se reparten entre todas las impresoras asignadas.
const queues = new Map();
const rr = new Map();
let helperWin = null;

// ---------- Cola de impresión visible ----------
const printQueue = [];
let queueSeq = 0;
function queueNotify() {
  const summary = printQueue.map((j) => ({ id: j.id, file: j.file, printer: j.printer, status: j.status, attempt: j.attempt, error: j.error }));
  notify('print:queue', summary);
}
function queueAdd(file, printer) {
  const id = ++queueSeq;
  const j = { id, file: path.basename(file), printer, status: 'pending', attempt: 0, error: null };
  printQueue.push(j);
  if (printQueue.length > 40) printQueue.splice(0, printQueue.length - 40);
  queueNotify();
  return j;
}
function queueUpdate(j, status, extra = {}) { Object.assign(j, { status, ...extra }); queueNotify(); }
export function getPrintQueue() { return printQueue.map((j) => ({ id: j.id, file: j.file, printer: j.printer, status: j.status, attempt: j.attempt, error: j.error })); }

function helper() {
  if (!helperWin || helperWin.isDestroyed()) helperWin = new BrowserWindow({ show: false });
  return helperWin;
}

export async function listPrinters() {
  let list = [];
  try { list = (await helper().webContents.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: p.isDefault, status: p.status })); } catch { /* sin impresoras */ }
  if (simOn()) list.push({ name: SIM_PRINTER, displayName: 'DNP DS620 (simulada)', isDefault: false, status: 0, simulated: true });
  return list;
}

/** Impresoras de un tamaño. Con la simulación activa, los tamaños sin impresora que admite la DS620 usan la simulada. */
export function printersFor(size) {
  const list = (size.printers || []).filter(Boolean).filter((p) => p !== SIM_PRINTER || simOn());
  if (!list.length && simOn() && ds620Supports(size.w, size.h)) return [SIM_PRINTER];
  return list;
}

export function pickPrinter(size) {
  const list = printersFor(size);
  if (!list.length) return null;
  const i = (rr.get(size.id) || 0) % list.length;
  rr.set(size.id, i + 1);
  return list[i];
}

// ---------- Reimpresión automática ----------
// Si una impresora falla (sin papel, sin tinta, error mecánico), se reintenta la foto que se
// estaba imprimiendo para evitar que se pierda. Hasta 3 reintentos con pausa creciente;
// tras cada fallo se avisa a la interfaz para que el personal sepa que debe reponer papel/tinta.
const MAX_RETRIES = 3;
const RETRY_DELAYS = [8_000, 20_000, 40_000]; // ms entre reintentos
const notify = (channel, payload) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
};

/** Imprime con la gestión de color de la impresora y descuenta el papel de su rollo.
 *  Si falla, reintenta automáticamente hasta MAX_RETRIES veces para no perder fotos. */
async function printOne(file0, opts) {
  const job = queueAdd(file0, opts.printer);
  const file = await preparePrintFile(file0, opts.printer);
  try {
    let lastErr;
    queueUpdate(job, 'printing', { attempt: 1 });
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await (opts.printer === SIM_PRINTER ? simPrint(file, opts) : printRaw(file, opts));
        if (attempt > 0) {
          notify('print:retry-ok', { printer: opts.printer, attempt, file: path.basename(file0) });
        }
        await consumePrint(opts.printer, opts).catch(() => {});
        queueUpdate(job, 'done');
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS[attempt] || 40_000;
          queueUpdate(job, 'retrying', { attempt: attempt + 1, error: e.message });
          notify('print:retry', {
            printer: opts.printer, attempt: attempt + 1, maxRetries: MAX_RETRIES,
            file: path.basename(file0), error: e.message,
            nextRetryIn: Math.round(delay / 1000)
          });
          await new Promise((r) => setTimeout(r, delay));
          queueUpdate(job, 'printing', { attempt: attempt + 2 });
        }
      }
    }
    queueUpdate(job, 'error', { error: lastErr.message });
    notify('print:failed', { printer: opts.printer, file: path.basename(file0), error: lastErr.message });
    throw lastErr;
  } finally {
    if (file !== file0) fsp.rm(file, { force: true }).catch(() => {});
  }
}

function printRaw(file, { printer, wMm, hMm, copies, useDriverPaper }) {
  return new Promise(async (resolve, reject) => {
    const html = file.replace(/\.jpg$/i, '') + '.print.html';
    const pageCss = useDriverPaper
      ? `@page{margin:0}img{width:100vw;height:100vh;object-fit:cover}`
      : `@page{size:${wMm}mm ${hMm}mm;margin:0}img{width:${wMm}mm;height:${hMm}mm}`;
    await fsp.writeFile(html, `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}img{display:block}${pageCss}</style></head><body><img src="${pathToFileURL(file)}"></body></html>`);
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await win.loadFile(html);
      await win.webContents.executeJavaScript('document.images[0].decode().then(()=>true)');
      const opts = {
        silent: true, deviceName: printer, printBackground: true, copies: Math.max(1, copies | 0),
        margins: { marginType: 'none' }, color: true
      };
      if (!useDriverPaper) opts.pageSize = { width: Math.round(wMm * 1000), height: Math.round(hMm * 1000) };
      win.webContents.print(opts, (ok, reason) => {
        win.destroy();
        fsp.rm(html, { force: true }).catch(() => {});
        ok ? resolve() : reject(new Error(reason || 'Error de impresión'));
      });
    } catch (e) { win.destroy(); reject(e); }
  });
}

/** Encola un trabajo en la impresora indicada. wMm/hMm en vertical. */
export function enqueuePrint(file, opts) {
  const prev = queues.get(opts.printer) || Promise.resolve();
  const job = prev.catch(() => {}).then(() => printOne(file, opts));
  queues.set(opts.printer, job);
  return job;
}

export async function testPrint(printer, size, outFile) {
  return enqueuePrint(outFile, { printer, wMm: size.w, hMm: size.h, copies: 1, useDriverPaper: size.useDriverPaper });
}

export const printFileName = (dir, name) => path.join(dir, name.replace(/[^\w.\-]/g, '_'));
