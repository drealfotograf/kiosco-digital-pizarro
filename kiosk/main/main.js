import { app, BrowserWindow, ipcMain, protocol, net, dialog, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getSettings, saveSettings, publicSettings, dataDir } from './config.js';
import * as session from './session.js';
import { listFolder, walkFiles, cachedThumb, checkContent, readable } from './images.js';
import { pdfPageCount } from './pdf.js';
import { extOf, DEFAULT_ID_OPTIONS, sizeProblem } from '../shared/presets.js';
import { lotProblem } from '../shared/layout.js';
import { listDrives, watchDrives, stopWatchingDrives } from './sources/drives.js';
import { listPhones, copyFromPhone, cancelPhoneCopy } from './sources/mtp.js';
import { startUploadServer, uploadInfo } from './sources/upload-server.js';
import { startEmailWatch, stopEmailWatch, emailStatus, testEmail } from './sources/email.js';
import { openBluetoothReceiver, bluetoothInbox, recentBluetoothFiles } from './sources/bluetooth.js';
import { listServerShare, downloadServerFile } from './sources/srvshare.js';
import { ensureSampleMasks, renderPhotoBuffer, saveJpeg } from './render.js';
import { listPrinters, testPrint, simFolder } from './print.js';
import { submitOrder, quote, printableSizes, holdOrder, repeatOrder, retryOrder, releaseOrder, findAwaiting, pollTickets, orderState } from './orders.js';
import { retryTickets } from './ticket.js';
import { logEvent, statsSummary, statsCsv } from './stats.js';
import { sectionData, applySection, fileEnvelope, readEnvelope, exportFolderSection, importFolderSection } from './sections.js';
import { runBackup, listBackups, backupStatus, restoreBackup, startBackupScheduler, PARTS as BACKUP_PARTS } from './backup.js';
import { DEFAULT_SETTINGS } from '../shared/presets.js';
import { checkGate, assertOpen, sendMailCode, verifyCode, newTotpSecret, totpUri, verifyTotp } from './security.js';
import QRCode from 'qrcode';
import { listOrders, getOrder, deleteOrder, findHeld, storedPhotos, purgeOrders, STATUS_LABEL } from './store.js';
import { exportTariffs, importTariffs } from './tariffs.js';
import { testLab, serverFolders, retryPending, startRetryLoop } from './lab.js';
import { galleryLogin, galleryDownload } from './gallery.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv.includes('--dev');
let win = null;
let browseRoots = new Set(); // carpetas que la interfaz puede explorar (unidades, red, Bluetooth)

protocol.registerSchemesAsPrivileged([
  { scheme: 'kimg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
session.setNotifier(send);

function allowedRoots() {
  const s = getSettings();
  return [...browseRoots, ...s.shareFolders.map((f) => f.path), s.bluetoothInbox].filter(Boolean);
}
function assertBrowsable(dir) {
  if (!session.isAllowedPath(dir, allowedRoots())) throw new Error('Carpeta no permitida');
}

function createWindow() {
  const s = getSettings();
  const kiosk = s.kioskMode && !isDev;
  win = new BrowserWindow({
    width: 1366, height: 900, minWidth: 1024, minHeight: 700,
    fullscreen: kiosk, kiosk, autoHideMenuBar: true, backgroundColor: '#f4f2fb',
    title: s.storeName,
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.loadFile(path.join(here, '..', 'dist-renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function checkPin(pin) {
  assertOpen('admin');
  if (String(pin) !== String(getSettings().adminPin)) throw new Error('PIN incorrecto');
}
const okGate = (g) => g === 'admin' || /^order:[\w-]{1,40}$/.test(String(g));

const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
});

/** Carga un pedido guardado en una sesión nueva (para continuar o reprocesar). */
async function loadOrderIntoSession(order) {
  browseRoots = new Set();
  await session.newSession();
  startEmailWatch(send);
  const photos = await session.restorePhotos(Object.values(storedPhotos(order)));
  return { kind: order.kind, spec: order.spec, customer: order.customer, photos, code: order.code, orderNo: order.orderNo };
}

function registerIpc() {
  handle('settings:public', () => publicSettings());

  // ---------- Administración (todo con PIN) ----------
  // Entrada con PIN (ajustes y Mi galería): 5 fallos → bloqueo de 5 minutos o verificación.
  handle('admin:check', (pin) => checkGate('admin', pin, getSettings().adminPin));
  handle('security:sendCode', (gate) => { if (!okGate(gate)) throw new Error('No válido'); return sendMailCode(gate); });
  handle('security:verify', (gate, method, code) => { if (!okGate(gate)) throw new Error('No válido'); return verifyCode(gate, method, code); });
  // Vincular el móvil de la empresa (app de autenticación): se genera un secreto, se muestra el QR y se confirma con un código.
  handle('admin:totpSetup', async (pin) => {
    checkPin(pin);
    const secret = newTotpSecret();
    const uri = totpUri(secret, getSettings().storeName);
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 260 }) };
  });
  handle('admin:totpConfirm', (pin, secret, code) => {
    checkPin(pin);
    if (!verifyTotp(secret, code)) throw new Error('El código no coincide. Comprueba la hora del móvil y vuelve a probar.');
    const s = getSettings();
    saveSettings({ ...s, security: { ...(s.security || {}), totpSecret: secret, totpEnabled: true } });
    send('settings', publicSettings());
    return true;
  });
  handle('admin:testMail', async (pin) => { checkPin(pin); return sendMailCode('prueba'); });
  // Estadísticas: la interfaz informa de cada sesión de cliente al terminar (sin datos personales).
  handle('stats:session', (d = {}) => {
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const start = new Date(d.start); if (Number.isNaN(start.getTime())) return false;
    logEvent('session', {
      start: start.toISOString(), end: new Date().toISOString(), durMs: num(Date.now() - start.getTime(), 12 * 3600_000), photos: num(d.photos, 100000),
      sources: (Array.isArray(d.sources) ? d.sources : []).slice(0, 10).map((x) => String(x).slice(0, 40)), flow: d.flow === 'id' ? 'carnet' : 'copias',
      ordered: !!d.ordered, reason: d.reason === 'idle' ? 'idle' : 'user'
    });
    return true;
  });
  handle('admin:stats', (pin, range) => { checkPin(pin); return statsSummary(range); });
  handle('admin:statsCsv', async (pin, range, name) => {
    checkPin(pin);
    const r = await dialog.showSaveDialog(win, { defaultPath: `estadisticas-${String(name || 'periodo').replace(/[^\w-]/g, '_')}.csv`, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, await statsCsv(range));
    return r.filePath;
  });
  handle('admin:settings', (pin) => {
    checkPin(pin);
    const s = getSettings();
    const sec = s.security || {};
    return { ...s, security: { ...sec, totpSecret: undefined, totpLinked: !!sec.totpSecret, smtp: { ...(sec.smtp || {}), pass: sec.smtp?.pass ? '••••••' : '' } } };
  });
  handle('admin:save', (pin, next) => {
    checkPin(pin);
    if (next.email && next.email.pass === '••••••') next.email.pass = getSettings().email.pass;
    // El secreto del móvil solo se cambia desde «Vincular móvil»; la contraseña SMTP se conserva si viene enmascarada.
    const cur = getSettings().security || {};
    next.security = { ...(next.security || {}), totpSecret: cur.totpSecret || '' };
    if (next.security.smtp && next.security.smtp.pass === '••••••') next.security.smtp.pass = cur.smtp?.pass || '';
    const saved = saveSettings(next);
    send('settings', publicSettings());
    return saved;
  });
  handle('admin:quit', (pin) => { checkPin(pin); setTimeout(() => app.quit(), 100); return true; });
  handle('admin:testEmail', (pin, cfg) => { checkPin(pin); return testEmail(cfg.pass === '••••••' ? { ...cfg, pass: getSettings().email.pass } : cfg); });
  handle('admin:testLab', (pin) => { checkPin(pin); return testLab(); });
  handle('admin:serverFolders', (pin) => { checkPin(pin); return serverFolders(); });
  handle('admin:retryPending', async (pin) => { checkPin(pin); return retryPending(); });
  handle('admin:pickFolder', async (pin) => {
    checkPin(pin);
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('admin:testPrint', async (pin, printer, sizeId) => {
    checkPin(pin);
    const size = getSettings().printSizes.find((x) => x.id === sizeId);
    if (!size) throw new Error('Tamaño no encontrado');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800"><rect width="1200" height="1800" fill="#fff" stroke="#6d4aff" stroke-width="12"/>
      <text x="600" y="860" font-size="72" text-anchor="middle" font-family="Arial">Prueba ${size.name.replace(/[<&>]/g, '')}</text>
      <text x="600" y="960" font-size="40" text-anchor="middle" font-family="Arial">${printer.replace(/[<&>]/g, '')}</text></svg>`;
    const dir = dataDir('cache');
    await fsp.mkdir(dir, { recursive: true });
    const src = path.join(dir, 'test.png');
    await fsp.writeFile(src, Buffer.from(svg));
    const { buf } = await renderPhotoBuffer({ src, w: 1200, h: 1800 }, { mode: 'fit', wMm: size.w, hMm: size.h, dpi: getSettings().dpi });
    const out = path.join(dir, `test-${size.id}.jpg`);
    await saveJpeg(buf, out, getSettings().dpi);
    await testPrint(printer, size, out);
    return true;
  });

  // Tarifas
  handle('tariffs:export', async (pin) => {
    checkPin(pin);
    const r = await dialog.showSaveDialog(win, { defaultPath: `tarifas-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV (Excel)', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    await exportTariffs(r.filePath);
    return r.filePath;
  });
  handle('tariffs:import', async (pin) => {
    checkPin(pin);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'CSV (Excel)', extensions: ['csv', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const summary = await importTariffs(r.filePaths[0]);
    send('settings', publicSettings());
    return { summary, settings: getSettings() };
  });

  handle('admin:openSimFolder', async (pin) => { checkPin(pin); await fsp.mkdir(simFolder(), { recursive: true }); await shell.openPath(simFolder()); return simFolder(); });

  // Tamaños (con precio, tramos, color y salida) en JSON. Las impresoras no viajan: son de cada kiosco.
  handle('sizes:export', async (pin) => {
    checkPin(pin);
    const s = getSettings();
    const r = await dialog.showSaveDialog(win, { defaultPath: `tamanos-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Tamaños y tarifas', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    const printSizes = s.printSizes.map(({ printers, useDriverPaper, ...z }) => z);
    await fsp.writeFile(r.filePath, JSON.stringify({ tipo: 'pizarro-tamanos', version: 1, exportado: new Date().toISOString(), currency: s.currency, printSizes, quickSizes: s.quickSizes || [] }, null, 2));
    return r.filePath;
  });
  handle('sizes:import', async (pin) => {
    checkPin(pin);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Tamaños y tarifas', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let data;
    try { data = JSON.parse((await fsp.readFile(r.filePaths[0], 'utf8')).replace(/^﻿/, '')); } catch { throw new Error('El archivo no es válido (JSON dañado).'); }
    const list = Array.isArray(data) ? data : data?.printSizes;
    if (!Array.isArray(list) || !list.length) throw new Error('El archivo no contiene tamaños.');
    const s = getSettings();
    const sizes = structuredClone(s.printSizes);
    const summary = { added: 0, updated: 0, skipped: [] };
    for (const z of list.slice(0, 200)) {
      const problem = sizeProblem(z);
      if (problem) { summary.skipped.push(`${z?.name || z?.id || '¿?'}: ${problem}`); continue; }
      const clean = {
        id: String(z.id).slice(0, 40), name: String(z.name).slice(0, 60), w: Number(z.w), h: Number(z.h), price: Number(z.price) || 0,
        ...(Array.isArray(z.tiers) ? { tiers: z.tiers.map((t) => ({ from: Math.round(t.from), price: Number(t.price) })) } : {}),
        ...(z.color ? { color: z.color } : {}), ...(z.out ? { out: z.out } : {}), ...(typeof z.serverFolder === 'string' && z.serverFolder.trim() ? { serverFolder: z.serverFolder.trim().slice(0, 80) } : {}), ...(z.card ? { card: { h: Number(z.card.h), win: { x: Number(z.card.win.x), y: Number(z.card.win.y), w: Number(z.card.win.w), h: Number(z.card.win.h) } } } : {})
      };
      const i = sizes.findIndex((x) => x.id === clean.id);
      // Se conservan las impresoras y el «papel del driver» de este kiosco.
      if (i >= 0) { sizes[i] = { ...clean, printers: sizes[i].printers || [], useDriverPaper: !!sizes[i].useDriverPaper }; summary.updated++; }
      else { sizes.push({ ...clean, printers: [], useDriverPaper: false }); summary.added++; }
    }
    const quick = Array.isArray(data?.quickSizes) ? data.quickSizes.filter((id) => sizes.some((x) => x.id === id)) : s.quickSizes;
    const saved = saveSettings({ ...s, printSizes: sizes, quickSizes: quick });
    send('settings', publicSettings());
    return { summary, settings: saved };
  });

  // Ajustes por página: exportar / importar en JSON. Pedidos, estadísticas y máscaras: como carpetas.
  // Copia de seguridad
  handle('admin:backupStatus', async (pin) => { checkPin(pin); return { status: backupStatus(), list: await listBackups().catch(() => []), parts: Object.fromEntries(Object.entries(BACKUP_PARTS).map(([k, v]) => [k, v.label])) }; });
  handle('admin:backupRun', (pin, mode) => { checkPin(pin); return runBackup({ forceMode: mode, reason: 'manual' }); });
  handle('admin:backupRestore', async (pin, name, parts) => { checkPin(pin); const r = await restoreBackup(name, parts); send('settings', publicSettings()); return r; });
  // Vuelve a los ajustes de fábrica (conserva el PIN, las claves y la programación de copias).
  handle('admin:factoryReset', (pin) => {
    checkPin(pin);
    const cur = getSettings();
    const saved = saveSettings({ ...structuredClone(DEFAULT_SETTINGS), adminPin: cur.adminPin, lab: { ...DEFAULT_SETTINGS.lab, kioskKey: cur.lab?.kioskKey || '', serverUrl: cur.lab?.serverUrl || DEFAULT_SETTINGS.lab.serverUrl }, security: cur.security, backup: cur.backup });
    send('settings', publicSettings());
    return !!saved;
  });

  handle('admin:sectionExport', async (pin, id, opts = {}) => {
    checkPin(pin);
    if (['orders', 'stats', 'masks'].includes(id)) {
      const r = await dialog.showOpenDialog(win, { title: 'Carpeta donde guardar la exportación', properties: ['openDirectory', 'createDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      const out = await exportFolderSection(id, r.filePaths[0]);
      return { path: out.dest, files: out.files };
    }
    const name = id === 'all' ? 'configuracion-completa' : `ajustes-${id}`;
    const r = await dialog.showSaveDialog(win, { defaultPath: `${name}-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Ajustes del kiosco', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, JSON.stringify(fileEnvelope(id, sectionData(id, { secrets: id === 'all' && !!opts.secrets })), null, 2));
    return { path: r.filePath };
  });
  handle('admin:sectionImport', async (pin, id) => {
    checkPin(pin);
    if (['orders', 'stats', 'masks'].includes(id)) {
      const r = await dialog.showOpenDialog(win, { title: 'Carpeta que quieres importar', properties: ['openDirectory'] });
      if (r.canceled || !r.filePaths[0]) return null;
      return { ...(await importFolderSection(id, r.filePaths[0])), settings: getSettings() };
    }
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Ajustes del kiosco', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const saved = applySection(id, readEnvelope(await fsp.readFile(r.filePaths[0], 'utf8'), id));
    send('settings', publicSettings());
    return { settings: saved };
  });

  // Plantillas de lotes de carnet (archivo JSON para copiarlas a otro kiosco o guardarlas)
  handle('idlots:export', async (pin) => {
    checkPin(pin);
    const s = getSettings();
    const r = await dialog.showSaveDialog(win, { defaultPath: `plantillas-carnet-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Plantillas de carnet', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, JSON.stringify({ tipo: 'pizarro-plantillas-carnet', version: 1, exportado: new Date().toISOString(), lotTypes: s.idLotTypes, idOptions: s.idOptions }, null, 2));
    return r.filePath;
  });
  handle('idlots:import', async (pin) => {
    checkPin(pin);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Plantillas de carnet', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let data;
    try { data = JSON.parse((await fsp.readFile(r.filePaths[0], 'utf8')).replace(/^﻿/, '')); } catch { throw new Error('El archivo no es una plantilla válida (JSON dañado).'); }
    const list = Array.isArray(data) ? data : data?.lotTypes;
    if (!Array.isArray(list) || !list.length) throw new Error('El archivo no contiene plantillas de carnet.');
    const s = getSettings();
    const types = structuredClone(s.idLotTypes || []);
    const summary = { added: 0, updated: 0, skipped: [] };
    for (const raw of list.slice(0, 100)) {
      const problem = lotProblem(raw);
      if (problem) { summary.skipped.push(`${raw?.name || raw?.id || '¿?'}: ${problem}`); continue; }
      const lot = {
        id: String(raw.id).slice(0, 40), name: String(raw.name || raw.id).slice(0, 60), kind: raw.kind,
        pw: Number(raw.pw), ph: Number(raw.ph), cols: Math.round(raw.cols), rows: Math.round(raw.rows),
        ...(raw.kind === 'grid+big' ? { big: { w: Number(raw.big.w), h: Number(raw.big.h) }, bigFollows: !!raw.bigFollows } : {}),
        landscape: raw.landscape !== false, price: Math.max(0, Number(raw.price) || 0), enabled: raw.enabled !== false
      };
      const i = types.findIndex((t) => t.id === lot.id);
      if (i >= 0) { types[i] = lot; summary.updated++; } else { types.push(lot); summary.added++; }
    }
    const idOptions = data?.idOptions && typeof data.idOptions === 'object'
      ? Object.fromEntries(Object.keys(DEFAULT_ID_OPTIONS).map((k) => [k, data.idOptions[k] ?? s.idOptions?.[k] ?? DEFAULT_ID_OPTIONS[k]].map((v, j) => (j ? !!v : v))))
      : s.idOptions;
    const saved = saveSettings({ ...s, idLotTypes: types, idOptions });
    send('settings', publicSettings());
    return { summary, settings: saved };
  });

  // Pedidos guardados
  handle('orders:list', (pin, status) => { checkPin(pin); return listOrders(status); });
  handle('orders:counts', async (pin) => {
    checkPin(pin);
    const all = await listOrders();
    return Object.fromEntries(Object.keys(STATUS_LABEL).map((k) => [k, all.filter((o) => o.status === k).length]));
  });
  handle('orders:get', async (pin, no) => {
    checkPin(pin);
    const o = await getOrder(no);
    if (!o) throw new Error('Pedido no encontrado');
    return { ...o, photoPaths: Object.fromEntries(Object.entries(storedPhotos(o)).map(([id, p]) => [id, p.src])) };
  });
  handle('orders:delete', (pin, no) => { checkPin(pin); return deleteOrder(no); });
  handle('orders:repeat', (pin, no, indexes, destination) => { checkPin(pin); return repeatOrder(no, indexes, destination, (p) => send('order-progress', p)); });
  handle('orders:retry', (pin, no) => { checkPin(pin); return retryOrder(no, (p) => send('order-progress', p)); });
  handle('orders:reprocess', async (pin, no) => {
    checkPin(pin);
    const o = await getOrder(no);
    if (!o) throw new Error('Pedido no encontrado');
    return loadOrderIntoSession(o);
  });

  // Máscaras de eventos
  handle('masks:list', async () => {
    await fsp.mkdir(dataDir('masks'), { recursive: true });
    return (await fsp.readdir(dataDir('masks'))).filter((f) => /\.png$/i.test(f)).map((name) => ({ name, path: path.join(dataDir('masks'), name) }));
  });
  handle('masks:add', async (pin) => {
    checkPin(pin);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PNG con transparencia', extensions: ['png'] }] });
    for (const f of r.filePaths || []) await fsp.copyFile(f, path.join(dataDir('masks'), path.basename(f)));
    return true;
  });
  handle('masks:remove', async (pin, name) => {
    checkPin(pin);
    await fsp.rm(path.join(dataDir('masks'), path.basename(name)), { force: true });
    return true;
  });

  // ---------- Sesión de cliente ----------
  handle('session:new', async () => {
    browseRoots = new Set();
    const s = await session.newSession();
    startEmailWatch(send);
    return s;
  });
  handle('session:get', () => session.sessionView());
  handle('session:clear', async () => {
    stopEmailWatch(); cancelPhoneCopy(); stopWatchingDrives();
    browseRoots = new Set();
    await session.clearSession();
    return true;
  });
  handle('session:remove', (id) => session.removePhoto(id));

  /** Importa al pedido elementos del carrete: {path} local o {remote:{kind:'srvshare'|'gallery',…}}. */
  handle('roll:import', async (entries) => {
    const out = [];
    for (const e of entries) {
      try {
        let file = e.path;
        if (e.remote?.kind === 'srvshare') file = await downloadServerFile(e.remote.path);
        else if (e.remote?.kind === 'gallery') file = await galleryDownload(e.remote.token, e.remote.id);
        else assertBrowsable(file);
        // PDF: se importa la página elegida convertida a imagen de 300 ppp.
        if (extOf(file) === '.pdf') {
          const bad = await checkContent(file);
          if (bad) throw new Error(bad);
          file = await readable(file, session.inboxDir('pdf'), e.page || 1);
        }
        const [r] = await session.importFiles([file], e.origin, [e.name]);
        out.push(r?.photo || null);
      } catch (err) {
        session.emit('import-issue', { name: e.name, reason: err.message });
        out.push(null);
      }
    }
    return out;
  });

  // PDF: número de páginas (cada página es una foto del carrete)
  handle('pdf:pages', async (file) => {
    assertBrowsable(file);
    const bad = await checkContent(file);
    if (bad) throw new Error(bad);
    return pdfPageCount(file);
  });
  // Archivos remotos que hay que tener en local antes de cargarlos (p. ej. PDF del servidor)
  handle('roll:fetch', async (remote) => {
    if (remote?.kind === 'srvshare') return downloadServerFile(remote.path);
    if (remote?.kind === 'gallery') return galleryDownload(remote.token, remote.id);
    throw new Error('Origen no válido');
  });
  // Tamaño elegido en «Más tamaños» que pasa a la lista rápida (si así está configurado)
  handle('quicksizes:promote', (sizeId, replaceId) => {
    const s = getSettings();
    if (s.otherSizeMode !== 'permanent' || !s.printSizes.some((z) => z.id === sizeId)) return s.quickSizes;
    const list = s.quickSizes.filter((id) => id !== sizeId);
    const i = list.indexOf(replaceId);
    if (i >= 0) list[i] = sizeId; else list.push(sizeId);
    saveSettings({ ...s, quickSizes: list });
    send('settings', publicSettings());
    return list;
  });

  // Unidades USB / tarjetas
  handle('drives:list', async () => { const d = await listDrives(); d.forEach((x) => browseRoots.add(x.root)); return d; });
  handle('drives:watch', () => { watchDrives((d) => { d.forEach((x) => browseRoots.add(x.root)); send('drives', d); }); return true; });
  handle('drives:unwatch', () => { stopWatchingDrives(); return true; });

  // Carpetas locales y de red
  handle('folder:list', (dir) => { assertBrowsable(dir); return listFolder(dir); });
  handle('folder:scan', (dir, recursive = true) => { assertBrowsable(dir); return walkFiles(dir, { maxDepth: recursive ? 8 : 0 }); });
  handle('share:list', () => getSettings().shareFolders.map((f) => ({ ...f, available: fs.existsSync(f.path) })));

  // Carpeta compartida del servidor
  handle('srvshare:list', (rel, recursive) => listServerShare(rel || '', !!recursive));

  // WiFi / QR
  handle('upload:info', () => uploadInfo());

  // Móvil por cable
  handle('phone:list', () => listPhones());
  handle('phone:copy', async (device) => {
    const dest = session.inboxDir('cable');
    browseRoots.add(dest);
    await copyFromPhone(device, dest, 300, (ev) => send('phone-progress', ev));
    return dest;
  });
  handle('phone:cancel', () => { cancelPhoneCopy(); return true; });

  // Bluetooth
  handle('bt:open', () => openBluetoothReceiver());
  handle('bt:recent', () => { const s = session.getSession(); return recentBluetoothFiles(s ? s.startedAt : Date.now()); });
  handle('bt:inbox', () => bluetoothInbox());

  // Correo
  handle('email:status', () => ({ ...emailStatus(), address: getSettings().email.address, enabled: getSettings().email.enabled }));

  // Galerías
  handle('gallery:login', (code, password) => galleryLogin(code, password));

  // Pedidos del cliente
  handle('printers:list', () => listPrinters());
  handle('order:quote', (spec) => quote(spec));
  handle('order:printable', () => printableSizes());
  handle('order:submit', (spec, opts) => submitOrder(spec, (p) => send('order-progress', p), opts || {}));
  handle('order:hold', (spec, customer, code) => holdOrder(spec, customer, code));
  // PIN de caja: el cliente lo introduce en la pantalla final o más tarde desde el inicio.
  handle('order:release', (no, pin) => releaseOrder(no, pin, (p) => send('order-progress', p)));
  handle('order:state', (no) => orderState(no));
  handle('order:findAwaiting', async (input) => { const o = await findAwaiting(input); return o ? { orderNo: o.orderNo, total: o.total } : null; });
  handle('orders:release', (pin, no) => { checkPin(pin); return releaseOrder(no, null, (p) => send('order-progress', p), { staff: true }); });
  handle('order:resume', async (code) => {
    const held = await findHeld(code);
    if (!held) throw new Error('No hay ningún pedido guardado con ese código');
    return loadOrderIntoSession(await getOrder(held.orderNo));
  });
}

function registerProtocol() {
  // kimg://f/file?p=RUTA        → archivo original o derivado
  // kimg://f/thumb?p=RUTA&s=360 → vista previa de baja calidad generada bajo demanda
  protocol.handle('kimg', async (req) => {
    try {
      const u = new URL(req.url);
      const p = u.searchParams.get('p');
      if (!p || !session.isAllowedPath(p, allowedRoots())) return new Response('No permitido', { status: 403 });
      const size = Math.min(2000, Math.max(120, parseInt(u.searchParams.get('s'), 10) || 360));
      const page = Math.max(1, parseInt(u.searchParams.get('pg'), 10) || 1);
      const file = u.pathname.startsWith('/thumb') ? await cachedThumb(p, size, page) : p;
      return net.fetch(pathToFileURL(file).toString());
    } catch (e) {
      return new Response(String(e.message), { status: 500 });
    }
  });
}

app.whenReady().then(async () => {
  registerProtocol();
  registerIpc();
  await ensureSampleMasks().catch((e) => console.error('Máscaras:', e.message));
  await session.purgeStaleSessions();
  purgeOrders().catch(() => {});
  setInterval(() => purgeOrders().catch(() => {}), 6 * 3600_000);
  startUploadServer();
  startRetryLoop((msg) => console.log(msg));
  startBackupScheduler((msg) => console.log(msg));
  // Tickets: reenvío de los que no llegaron y consulta de ventas confirmadas o anuladas en caja.
  setInterval(() => { retryTickets().catch(() => {}); pollTickets((m) => console.log(m)).catch(() => {}); }, 20_000);
  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { session.clearSession(); });
