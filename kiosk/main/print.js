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

/** Imprime con la gestión de color de la impresora y descuenta el papel de su rollo. */
async function printOne(file0, opts) {
  const file = await preparePrintFile(file0, opts.printer);
  try {
    await (opts.printer === SIM_PRINTER ? simPrint(file, opts) : printRaw(file, opts));
    await consumePrint(opts.printer, opts).catch(() => {});
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
