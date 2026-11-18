// Servidor de la tienda: recibe pedidos de los kioscos, los deja listos para el laboratorio
// y aloja las galerías privadas de los clientes (acceso con código + contraseña).
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.PIZARRO_DATA || path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA, 'config.json');
const DB_FILE = path.join(DATA, 'db.json');
fs.mkdirSync(path.join(DATA, 'tmp'), { recursive: true });
sharp.cache(false);

const rand = (n) => crypto.randomBytes(n).toString('hex');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = (len = 6) => Array.from(crypto.randomBytes(len), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const safeName = (n) => path.basename(String(n || 'archivo')).replace(/[^\w.\- ]/g, '_').slice(0, 120);

// ---------- Configuración ----------
function loadConfig() {
  // Se quita el BOM por si el archivo se ha editado con el Bloc de notas.
  if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, ''));
  const adminPassword = makeCode(10);
  const cfg = { port: 4000, adminHash: bcrypt.hashSync(adminPassword, 10), kioskKey: rand(16), hotFolder: '', storeName: 'Kiosco Digital Pizarro' };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  const msg = `Credenciales iniciales del servidor\r\n\r\nContraseña de administración: ${adminPassword}\r\nClave del kiosco: ${cfg.kioskKey}\r\n\r\nCámbialas con: npm run set-password -- NUEVA_CONTRASEÑA\r\nBorra este archivo cuando las hayas guardado.\r\n`;
  fs.writeFileSync(path.join(DATA, 'CREDENCIALES-INICIALES.txt'), msg);
  console.log('\n' + msg);
  return cfg;
}
const config = loadConfig();
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

if (process.argv.includes('--set-password')) {
  const pwd = process.argv[process.argv.indexOf('--set-password') + 1];
  if (!pwd || pwd.length < 6) { console.error('Uso: npm run set-password -- CONTRASEÑA (mínimo 6 caracteres)'); process.exit(1); }
  config.adminHash = bcrypt.hashSync(pwd, 10);
  saveConfig();
  console.log('Contraseña de administración actualizada.');
  process.exit(0);
}

// ---------- Base de datos (JSON) ----------
let db = { orders: [], galleries: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* nueva */ }
let saving = Promise.resolve();
function saveDb() {
  saving = saving.then(async () => {
    const tmp = DB_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(db, null, 1));
    await fsp.rename(tmp, DB_FILE);
  }).catch((e) => console.error('Error guardando la base de datos:', e.message));
  return saving;
}

// ---------- Sesiones y seguridad ----------
const tokens = new Map(); // token -> { type, galleryId, exp }
function issue(type, extra = {}, hours = 12) {
  const t = rand(24);
  tokens.set(t, { type, ...extra, exp: Date.now() + hours * 3600_000 });
  return t;
}
function tokenFrom(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : (req.query.t || '');
}
function auth(type) {
  return (req, res, next) => {
    const t = tokens.get(tokenFrom(req));
    if (!t || t.type !== type || t.exp < Date.now()) return res.status(401).json({ error: 'Sesión caducada. Vuelve a entrar.' });
    req.tok = t;
    next();
  };
}
const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isKiosk = (req) => !!config.kioskKey && eq(req.headers['x-kiosk-key'] || '', config.kioskKey);
function kioskOnly(req, res, next) { if (!isKiosk(req)) return res.status(401).json({ ok: false, error: 'Clave del kiosco incorrecta' }); next(); }

const attempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  req.fail = () => { a.n++; if (a.n >= 8) { a.until = Date.now() + 15 * 60_000; a.n = 0; } attempts.set(ip, a); };
  req.okLogin = () => attempts.delete(ip);
  next();
}
setInterval(() => { const now = Date.now(); for (const [k, v] of tokens) if (v.exp < now) tokens.delete(k); }, 3600_000).unref();

// ---------- App ----------
const app = express();
app.set('trust proxy', false);
app.use(express.json({ limit: '1mb' }));
app.use('/static', express.static(path.join(ROOT, 'public')));
app.get('/', (req, res) => res.redirect('/g'));
app.get('/g', (req, res) => res.sendFile(path.join(ROOT, 'public', 'gallery.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));

const upload = multer({ dest: path.join(DATA, 'tmp'), limits: { fileSize: 150 * 1024 * 1024, files: 500 } });
const cleanupTmp = (files = []) => Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));

// ---------- Carpeta compartida de libre acceso desde los kioscos ----------
// Cualquier foto que se deje en esta carpeta (por red de Windows o copiándola) aparece en los kioscos sin contraseña.
// Solo los kioscos (con su clave) pueden leerla. Las miniaturas aceptan la clave por URL (?k=) para usarlas en <img>.
const shareRoot = () => path.resolve(config.shareFolder || path.join(DATA, 'compartida'));
fs.mkdirSync(shareRoot(), { recursive: true });
function sharePath(rel) {
  const root = shareRoot();
  const p = path.resolve(root, String(rel || '.').replace(/^[\\/]+/, ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw Object.assign(new Error('Ruta no permitida'), { status: 400 });
  return p;
}
const relOf = (p) => path.relative(shareRoot(), p).split(path.sep).join('/');
function kioskOrQueryKey(req, res, next) {
  if (isKiosk(req) || (config.kioskKey && eq(req.query.k || '', config.kioskKey))) return next();
  res.status(401).json({ error: 'Clave del kiosco incorrecta' });
}
const hidden = (n) => n.startsWith('.') || n.startsWith('$') || /^(thumbs\.db|desktop\.ini)$/i.test(n);

app.get('/api/share/list', kioskOrQueryKey, async (req, res, next) => {
  try {
    const dir = sharePath(req.query.path);
    const folders = [];
    const files = [];
    async function walk(d, depth) {
      for (const e of await fsp.readdir(d, { withFileTypes: true })) {
        if (hidden(e.name) || files.length >= 5000) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (depth === 0) folders.push({ name: e.name, path: relOf(p) });
          if (req.query.recursive === '1' && depth < 6) await walk(p, depth + 1);
        } else if (e.isFile()) {
          const st = await fsp.stat(p);
          files.push({ name: e.name, path: relOf(p), size: st.size, mtime: st.mtimeMs });
        }
      }
    }
    await walk(dir, 0);
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => b.mtime - a.mtime);
    res.json({ path: relOf(dir), folders, files });
  } catch (e) { next(e); }
});

app.get('/api/share/thumb', kioskOrQueryKey, async (req, res, next) => {
  try {
    const file = sharePath(req.query.path);
    const size = Math.min(2000, Math.max(100, parseInt(req.query.s, 10) || 360));
    const st = await fsp.stat(file);
    const key = crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${size}`).digest('hex');
    const cacheDir = path.join(DATA, 'cache');
    await fsp.mkdir(cacheDir, { recursive: true });
    const out = path.join(cacheDir, key + '.jpg');
    if (!fs.existsSync(out)) {
      let input = file;
      if (/\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|3fr|erf|kdc|mrw|mef|iiq|rwl|x3f)$/i.test(file)) {
        // RAW de cámara: la mayor imagen JPEG incrustada sirve de vista previa.
        const buf = await fsp.readFile(file);
        let best = null;
        for (let i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff])), n = 0; i >= 0 && n < 60; i = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), i + 3), n++) {
          try { const m = await sharp(buf.subarray(i), { failOn: 'none' }).metadata(); if (m.format === 'jpeg' && m.width && (!best || m.width * m.height > best.a)) best = { i, a: m.width * m.height }; } catch { /* siguiente */ }
        }
        if (!best) throw new Error('RAW sin vista previa');
        input = buf.subarray(best.i);
      } else if (/\.(heic|heif)$/i.test(file)) {
        const { default: heicConvert } = await import('heic-convert');
        input = Buffer.from(await heicConvert({ buffer: await fsp.readFile(file), format: 'JPEG', quality: 0.85 }));
      }
      await sharp(input, { failOn: 'none' }).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(out);
    }
    res.set('cache-control', 'private, max-age=3600');
    res.sendFile(out);
  } catch (e) { res.status(415).json({ error: 'No se puede generar la vista previa' }); }
});

app.get('/api/share/file', kioskOrQueryKey, (req, res, next) => {
  try {
    const file = sharePath(req.query.path);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'No existe' });
    res.download(file, path.basename(file));
  } catch (e) { next(e); }
});

// ---------- Pedidos desde el kiosco ----------
app.get('/api/ping', kioskOnly, (req, res) => res.json({ ok: true, store: config.storeName }));

// ---------- Exportación de pedidos a carpetas de destino ----------
const exportRoot = () => path.resolve(config.exportRoot || path.join(DATA, 'exportaciones'));
const cleanSeg = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().replace(/[. ]+$/, '');

async function exportOrderFiles(dir, files, rels, dest) {
  const root = exportRoot();
  const destDir = path.join(root, cleanSeg(dest) || 'General');
  let saved = 0;
  for (const [i, rel] of rels.entries()) {
    const segs = String(rel).split(/[\\/]+/).map(cleanSeg).filter(Boolean);
    const target = path.join(destDir, ...segs);
    if (!target.startsWith(destDir + path.sep)) continue; // nunca fuera de la carpeta de destino
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(path.join(dir, files[i]), target);
    if (fs.existsSync(target)) saved++; // confirmación real de la copia
  }
  const first = String(rels[0]).split(/[\\/]+/).map(cleanSeg).filter(Boolean)[0] || '';
  return { saved, where: path.join(destDir, first) };
}

app.get('/api/export/folders', kioskOnly, async (req, res) => {
  const root = exportRoot();
  await fsp.mkdir(root, { recursive: true });
  const folders = (await fsp.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && !hidden(e.name)).map((e) => e.name).sort();
  res.json({ root, folders });
});

app.post('/api/orders', kioskOnly, upload.array('files'), async (req, res) => {
  try {
    const m = JSON.parse(req.body.manifest || '{}');
    let id = safeName(m.orderNo || `P${Date.now()}`).replace(/\s/g, '');
    while (db.orders.some((o) => o.id === id)) id += '-' + makeCode(2);
    const dir = path.join(DATA, 'orders', id);
    await fsp.mkdir(dir, { recursive: true });
    const files = [];
    // Copia interna (para el panel): nombre único por posición, porque la misma foto puede ir en varios tamaños.
    for (const [i, f] of (req.files || []).entries()) {
      const name = `${String(i + 1).padStart(3, '0')}_${safeName(f.originalname)}`;
      await fsp.rename(f.path, path.join(dir, name)).catch(async () => { await fsp.copyFile(f.path, path.join(dir, name)); await fsp.rm(f.path, { force: true }); });
      files.push(name);
    }
    const items = (m.items || []).slice(0, files.length).map((it, i) => ({ file: files[i], size: String(it.size || ''), qty: Math.max(1, it.qty | 0), wMm: it.wMm, hMm: it.hMm, original: it.original ? String(it.original) : undefined }));
    // Exportación con la estructura pedida por el kiosco: <carpeta destino>/AAAA_MM_DD_Nº/<tamaño>/AAAA_MM_DD_Nº_foto.jpeg
    let exported = null;
    let rels = [];
    try { rels = JSON.parse(req.body.paths || '[]'); } catch { rels = []; }
    if (rels.length === files.length && rels.length) exported = await exportOrderFiles(dir, files, rels, req.body.dest);
    const order = {
      exportedTo: exported?.where, id, orderNo: String(m.orderNo || id), createdAt: new Date().toISOString(), kind: ['id', 'idlots'].includes(m.kind) ? 'id' : 'prints',
      customer: { name: String(m.customer?.name || '').slice(0, 80), phone: String(m.customer?.phone || '').slice(0, 20) },
      total: Number(m.total) || 0, currency: String(m.currency || '€'), items, status: 'nuevo', kiosk: req.ip
    };
    await fsp.writeFile(path.join(dir, 'pedido.json'), JSON.stringify(order, null, 2));
    db.orders.unshift(order);
    await saveDb();
    if (config.hotFolder) exportToHotFolder(order).catch((e) => console.error('Carpeta caliente:', e.message));
    console.log(`Pedido ${id} recibido: ${items.length} archivo(s), ${order.total} ${order.currency}`);
    res.json({ ok: true, id, exported });
  } catch (e) {
    await cleanupTmp(req.files);
    res.status(400).json({ error: e.message });
  }
});

/** Copia el pedido a la carpeta que vigila el software del minilab, agrupado por tamaño. */
async function exportToHotFolder(order) {
  const src = path.join(DATA, 'orders', order.id);
  for (const it of order.items) {
    const dir = path.join(config.hotFolder, safeName(it.size), order.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(path.join(src, it.file), path.join(dir, it.file));
  }
  const txt = [`Pedido ${order.orderNo}`, `Cliente: ${order.customer.name} ${order.customer.phone}`, `Total: ${order.total} ${order.currency}`, '', ...order.items.map((i) => `${i.qty} x ${i.size}  ${i.file}`)].join('\r\n');
  await fsp.writeFile(path.join(config.hotFolder, `${order.id}.txt`), txt);
}

// ---------- Administración ----------
app.post('/api/admin/login', rateLimit, (req, res) => {
  if (!bcrypt.compareSync(String(req.body.password || ''), config.adminHash)) { req.fail(); return res.status(401).json({ error: 'Contraseña incorrecta' }); }
  req.okLogin();
  res.json({ token: issue('admin') });
});
const admin = auth('admin');

app.get('/api/admin/config', admin, (req, res) => res.json({ hotFolder: config.hotFolder, storeName: config.storeName, kioskKey: config.kioskKey, gestionKey: gestionKey(), shareFolder: shareRoot(), exportRoot: exportRoot() }));
app.put('/api/admin/config', admin, (req, res) => {
  if (typeof req.body.hotFolder === 'string') config.hotFolder = req.body.hotFolder.trim();
  if (typeof req.body.exportRoot === 'string' && req.body.exportRoot.trim()) { config.exportRoot = req.body.exportRoot.trim(); fs.mkdirSync(exportRoot(), { recursive: true }); }
  if (typeof req.body.shareFolder === 'string' && req.body.shareFolder.trim()) {
    config.shareFolder = req.body.shareFolder.trim();
    fs.mkdirSync(shareRoot(), { recursive: true });
  }
  if (typeof req.body.storeName === 'string') config.storeName = req.body.storeName.trim();
  if (req.body.regenerateKioskKey) config.kioskKey = rand(16);
  if (req.body.regenerateGestionKey) config.gestionKey = rand(16);
  saveConfig();
  res.json({ ok: true, kioskKey: config.kioskKey, gestionKey: gestionKey() });
});

app.get('/api/admin/orders', admin, (req, res) => res.json(db.orders));

// ---------- Tickets de caja (pago en caja y contabilidad con Gestión Pizarro) ----------
// El kiosco envía cada ticket como «pendiente». Gestión Pizarro (o el personal desde esta web) confirma si la venta
// se realiza («pagado») o no («anulado»). Solo los pagados cuentan en contabilidad.
const TICKETS = path.join(DATA, 'tickets');
fs.mkdirSync(TICKETS, { recursive: true });
const ticketFile = (id) => path.join(TICKETS, `${String(id).replace(/[^\w-]/g, '_')}.json`);
const readTicket = (id) => { try { return JSON.parse(fs.readFileSync(ticketFile(id), 'utf8')); } catch { return null; } };
const writeTicket = (t) => { const f = ticketFile(t.numero); fs.writeFileSync(f + '.tmp', JSON.stringify(t, null, 2)); fs.renameSync(f + '.tmp', f); };
const allTickets = () => fs.readdirSync(TICKETS).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(TICKETS, f), 'utf8')); } catch { return null; } }).filter(Boolean)
  .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
function gestionKey() { if (!config.gestionKey) { config.gestionKey = rand(16); saveConfig(); } return config.gestionKey; }
gestionKey(); // se crea al arrancar para que la web la muestre y Gestión pueda usarla
function gestionOnly(req, res, next) { if (!eq(req.headers['x-gestion-key'] || '', gestionKey())) return res.status(401).json({ ok: false, error: 'Clave de Gestión incorrecta' }); next(); }
const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);
function cleanTicket(b) {
  if (!b || typeof b.numero !== 'string' || !/^[\w-]{1,40}$/.test(b.numero)) return null;
  const lineas = (Array.isArray(b.lineas) ? b.lineas : []).slice(0, 200).map((l) => ({
    codigo: String(l.codigo || '').slice(0, 40), descripcion: String(l.descripcion || '').slice(0, 120), cantidad: Math.max(0, Math.round(Number(l.cantidad) || 0)), precio: num(l.precio), importe: num(l.importe)
  }));
  return {
    numero: b.numero, corto: String(b.corto || '').slice(0, 12), fecha: String(b.fecha || new Date().toISOString()).slice(0, 40),
    tienda: String(b.tienda || '').slice(0, 80), kiosco: String(b.kiosco || '').slice(0, 40),
    cliente: { name: String(b.cliente?.name || '').slice(0, 80), phone: String(b.cliente?.phone || '').slice(0, 20) },
    lineas, total: num(b.total), moneda: String(b.moneda || 'EUR').slice(0, 3),
    iva: { porcentaje: num(b.iva?.porcentaje), base: num(b.iva?.base), cuota: num(b.iva?.cuota) },
    requierePin: !!b.requierePin, pin: /^\d{3}$/.test(String(b.pin || '')) ? String(b.pin) : undefined
  };
}
function setEstado(t, estado, por, referencia) {
  t.estado = estado; t.confirmadoEn = new Date().toISOString(); t.confirmadoPor = por;
  if (referencia) t.referencia = String(referencia).slice(0, 60);
  writeTicket(t);
  return t;
}

// Kiosco: alta del ticket (no se pisa uno ya confirmado) y consulta de su estado.
app.post('/api/tickets', kioskOnly, (req, res) => {
  const t = cleanTicket(req.body);
  if (!t) return res.status(400).json({ ok: false, error: 'Ticket no válido' });
  const prev = readTicket(t.numero);
  if (prev && prev.estado !== 'pendiente') return res.json({ ok: true, estado: prev.estado });
  writeTicket({ ...t, estado: 'pendiente', recibido: prev?.recibido || new Date().toISOString() });
  res.json({ ok: true, estado: 'pendiente' });
});
app.get('/api/tickets/:id', kioskOnly, (req, res) => {
  const t = readTicket(req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });
  res.json({ ok: true, estado: t.estado });
});

// Gestión Pizarro: lista de tickets (por estado) y confirmación de la venta. Ver GESTION-API.md.
app.get('/api/gestion/tickets', gestionOnly, (req, res) => {
  const e = String(req.query.estado || '');
  res.json(allTickets().filter((t) => !e || t.estado === e));
});
app.get('/api/gestion/tickets/:id', gestionOnly, (req, res) => {
  const t = readTicket(req.params.id);
  t ? res.json(t) : res.status(404).json({ ok: false, error: 'Ticket no encontrado' });
});
app.post('/api/gestion/tickets/:id', gestionOnly, (req, res) => {
  const t = readTicket(req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });
  if (typeof req.body.venta !== 'boolean') return res.status(400).json({ ok: false, error: 'Indica venta: true (realizada) o false (anulada)' });
  if (t.estado !== 'pendiente') return res.status(409).json({ ok: false, error: `El ticket ya está ${t.estado}`, estado: t.estado });
  res.json({ ok: true, ticket: setEstado(t, req.body.venta ? 'pagado' : 'anulado', 'gestion', req.body.referencia) });
});

// Web de administración: lo mismo a mano mientras Gestión no esté conectado.
app.get('/api/admin/tickets', admin, (req, res) => res.json(allTickets()));
app.post('/api/admin/tickets/:id', admin, (req, res) => {
  const t = readTicket(req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });
  if (!['pagado', 'anulado'].includes(req.body.estado)) return res.status(400).json({ ok: false, error: 'Estado no válido' });
  if (t.estado !== 'pendiente') return res.status(409).json({ ok: false, error: `El ticket ya está ${t.estado}` });
  res.json({ ok: true, ticket: setEstado(t, req.body.estado, 'personal') });
});
app.patch('/api/admin/orders/:id', admin, async (req, res) => {
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'No existe' });
  if (['nuevo', 'en proceso', 'listo', 'entregado'].includes(req.body.status)) o.status = req.body.status;
  await saveDb();
  res.json(o);
});
app.delete('/api/admin/orders/:id', admin, async (req, res) => {
  db.orders = db.orders.filter((x) => x.id !== req.params.id);
  await fsp.rm(path.join(DATA, 'orders', safeName(req.params.id)), { recursive: true, force: true });
  await saveDb();
  res.json({ ok: true });
});
app.get('/api/admin/orders/:id/file/:name', admin, async (req, res) => {
  const file = path.join(DATA, 'orders', safeName(req.params.id), safeName(req.params.name));
  if (!fs.existsSync(file)) return res.status(404).end();
  if (req.query.size === 'thumb') {
    res.type('jpeg');
    return sharp(file).resize(300, 300, { fit: 'inside' }).jpeg({ quality: 70 }).pipe(res);
  }
  res.download(file);
});
app.get('/api/admin/orders/:id/zip', admin, (req, res) => {
  const dir = path.join(DATA, 'orders', safeName(req.params.id));
  if (!fs.existsSync(dir)) return res.status(404).end();
  zipDir(res, dir, `${safeName(req.params.id)}.zip`);
});

function zipDir(res, dir, name, filter) {
  res.attachment(name);
  const z = archiver('zip', { zlib: { level: 0 } });
  z.on('error', (e) => res.destroy(e));
  z.pipe(res);
  if (filter) for (const f of filter) z.file(f.path, { name: f.name });
  else z.directory(dir, false);
  z.finalize();
}

// ---------- Galerías ----------
const publicGallery = (g) => ({ id: g.id, code: g.code, title: g.title, client: g.client, allowDownload: g.allowDownload, createdAt: g.createdAt, photos: g.photos.length, favorites: g.favorites.length });
const gdir = (g, ...p) => path.join(DATA, 'galleries', g.id, ...p);

app.get('/api/admin/galleries', admin, (req, res) => res.json(db.galleries.map(publicGallery)));
app.post('/api/admin/galleries', admin, async (req, res) => {
  const password = String(req.body.password || '').trim() || makeCode(6);
  if (password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
  let code;
  do code = makeCode(6); while (db.galleries.some((g) => g.code === code));
  const g = {
    id: rand(8), code, title: String(req.body.title || 'Galería').slice(0, 100), client: String(req.body.client || '').slice(0, 100),
    hash: bcrypt.hashSync(password, 10), allowDownload: !!req.body.allowDownload, createdAt: new Date().toISOString(), photos: [], favorites: []
  };
  db.galleries.unshift(g);
  await fsp.mkdir(gdir(g, 'orig'), { recursive: true });
  await saveDb();
  res.json({ ...publicGallery(g), password });
});
app.patch('/api/admin/galleries/:id', admin, async (req, res) => {
  const g = db.galleries.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'No existe' });
  if (typeof req.body.title === 'string') g.title = req.body.title.slice(0, 100);
  if (typeof req.body.client === 'string') g.client = req.body.client.slice(0, 100);
  if (typeof req.body.allowDownload === 'boolean') g.allowDownload = req.body.allowDownload;
  if (req.body.password) g.hash = bcrypt.hashSync(String(req.body.password), 10);
  await saveDb();
  res.json(publicGallery(g));
});
app.delete('/api/admin/galleries/:id', admin, async (req, res) => {
  const g = db.galleries.find((x) => x.id === req.params.id);
  if (g) await fsp.rm(gdir(g), { recursive: true, force: true });
  db.galleries = db.galleries.filter((x) => x.id !== req.params.id);
  await saveDb();
  res.json({ ok: true });
});
app.get('/api/admin/galleries/:id/photos', admin, (req, res) => {
  const g = db.galleries.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'No existe' });
  res.json(g.photos.map((p) => ({ id: p.id, name: p.name, favorite: g.favorites.includes(p.id) })));
});
app.post('/api/admin/galleries/:id/photos', admin, upload.array('files'), async (req, res) => {
  const g = db.galleries.find((x) => x.id === req.params.id);
  if (!g) { await cleanupTmp(req.files); return res.status(404).json({ error: 'No existe' }); }
  let added = 0;
  for (const f of req.files || []) {
    try {
      const id = rand(6);
      const ext = (path.extname(f.originalname) || '.jpg').toLowerCase();
      const orig = gdir(g, 'orig', id + ext);
      await fsp.rename(f.path, orig).catch(async () => { await fsp.copyFile(f.path, orig); await fsp.rm(f.path, { force: true }); });
      await sharp(orig, { failOn: 'none' }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(gdir(g, 'orig', id + '.preview.jpg'));
      await sharp(gdir(g, 'orig', id + '.preview.jpg')).resize(400, 400, { fit: 'inside' }).jpeg({ quality: 72 }).toFile(gdir(g, 'orig', id + '.thumb.jpg'));
      g.photos.push({ id, name: safeName(f.originalname), file: id + ext });
      added++;
    } catch (e) {
      console.error('No se pudo procesar', f.originalname, e.message);
      await fsp.rm(f.path, { force: true });
    }
  }
  await saveDb();
  res.json({ ok: true, added });
});
app.delete('/api/admin/galleries/:id/photos/:pid', admin, async (req, res) => {
  const g = db.galleries.find((x) => x.id === req.params.id);
  const p = g?.photos.find((x) => x.id === req.params.pid);
  if (!p) return res.status(404).json({ error: 'No existe' });
  g.photos = g.photos.filter((x) => x !== p);
  g.favorites = g.favorites.filter((x) => x !== p.id);
  for (const f of [p.file, `${p.id}.preview.jpg`, `${p.id}.thumb.jpg`]) await fsp.rm(gdir(g, 'orig', f), { force: true });
  await saveDb();
  res.json({ ok: true });
});
app.get('/api/admin/galleries/:id/file/:pid', admin, (req, res) => sendPhoto(res, db.galleries.find((x) => x.id === req.params.id), req.params.pid, req.query.size));

function sendPhoto(res, g, pid, size) {
  const p = g?.photos.find((x) => x.id === pid);
  if (!p) return res.status(404).end();
  if (size === 'orig') return res.download(gdir(g, 'orig', p.file), p.name);
  res.set('cache-control', 'private, max-age=3600');
  res.sendFile(gdir(g, 'orig', `${p.id}.${size === 'thumb' ? 'thumb' : 'preview'}.jpg`));
}

// ---------- Acceso de clientes a su galería ----------
app.post('/api/g/login', rateLimit, (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const g = db.galleries.find((x) => x.code === code);
  if (!g || !bcrypt.compareSync(String(req.body.password || ''), g.hash)) { req.fail(); return res.status(401).json({ error: 'Código o contraseña incorrectos' }); }
  req.okLogin();
  res.json({ token: issue('gallery', { galleryId: g.id }, 6), title: g.title, allowDownload: g.allowDownload });
});
const client = auth('gallery');
const galleryOf = (req) => db.galleries.find((x) => x.id === req.tok.galleryId);

app.get('/api/g/photos', client, (req, res) => {
  const g = galleryOf(req);
  if (!g) return res.status(404).json({ error: 'La galería ya no existe' });
  res.json({ title: g.title, client: g.client, allowDownload: g.allowDownload, photos: g.photos.map((p) => ({ id: p.id, name: p.name, favorite: g.favorites.includes(p.id) })) });
});
app.get('/api/g/file/:pid', client, (req, res) => {
  const g = galleryOf(req);
  // El original solo se entrega si la galería permite descargas o lo pide un kiosco de la tienda (para imprimir).
  if (req.query.size === 'orig' && !g?.allowDownload && !isKiosk(req)) return res.status(403).json({ error: 'Descarga no permitida' });
  sendPhoto(res, g, req.params.pid, req.query.size);
});
app.post('/api/g/favorites', client, async (req, res) => {
  const g = galleryOf(req);
  if (!g) return res.status(404).end();
  const valid = new Set(g.photos.map((p) => p.id));
  g.favorites = [...new Set((req.body.ids || []).filter((id) => valid.has(id)))];
  await saveDb();
  res.json({ ok: true, favorites: g.favorites });
});
app.get('/api/g/zip', client, (req, res) => {
  const g = galleryOf(req);
  if (!g?.allowDownload) return res.status(403).json({ error: 'Descarga no permitida' });
  const only = req.query.fav === '1' ? new Set(g.favorites) : null;
  const files = g.photos.filter((p) => !only || only.has(p.id)).map((p) => ({ path: gdir(g, 'orig', p.file), name: p.name }));
  zipDir(res, null, `${safeName(g.title)}.zip`, files);
});

app.use((err, req, res, next) => { if (!err.status) console.error(err); res.status(err.status || 500).json({ error: err.message }); });

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Servidor ${config.storeName} en http://localhost:${config.port}`);
  console.log(`  Administración: http://localhost:${config.port}/admin`);
  console.log(`  Galerías de clientes: http://localhost:${config.port}/g`);
});
