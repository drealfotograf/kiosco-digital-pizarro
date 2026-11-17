import { BrowserWindow } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  try { return (await helper().webContents.getPrintersAsync()).map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: p.isDefault, status: p.status })); } catch { return []; }
}

export function pickPrinter(size) {
  const list = (size.printers || []).filter(Boolean);
  if (!list.length) return null;
  const i = (rr.get(size.id) || 0) % list.length;
  rr.set(size.id, i + 1);
  return list[i];
}

function printOne(file, { printer, wMm, hMm, copies, useDriverPaper }) {
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
