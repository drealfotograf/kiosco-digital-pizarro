import express from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import fsp from 'node:fs/promises';
import { getSession, inboxDir, emit } from '../session.js';
import { getSettings } from '../config.js';
import { checkFileName } from '../../shared/presets.js';

// Pequeño servidor web en la red WiFi de la tienda: el cliente escanea el QR y sube sus fotos desde el navegador.
let server = null;

export function localIp() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) candidates.push({ name, address: a.address });
    }
  }
  const score = (c) => (/vEthernet|VirtualBox|VMware|Hyper-V|WSL/i.test(c.name) ? 10 : 0) + (/^192\.168\./.test(c.address) ? 0 : /^10\./.test(c.address) ? 1 : 2);
  candidates.sort((a, b) => score(a) - score(b));
  return candidates[0]?.address || '127.0.0.1';
}

const page = (code, store) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Enviar fotos · ${store}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f3ef;color:#1d1b18}
main{max-width:480px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}p{color:#5d5850;margin:0 0 20px}
label.btn{display:block;text-align:center;background:#c2410c;color:#fff;padding:18px;border-radius:14px;font-size:18px;font-weight:600}
input{display:none}#st{margin-top:18px;font-size:16px}
.bar{height:10px;background:#e5e0d8;border-radius:6px;overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;width:0;background:#c2410c;transition:width .2s}
.code{font-family:ui-monospace,monospace;background:#fff;padding:2px 8px;border-radius:6px}
</style></head><body><main>
<h1>${store}</h1><p>Sesión <span class="code">${code}</span>. Elige las fotos que quieres imprimir; aparecerán en la pantalla del kiosco.</p>
<label class="btn">Elegir fotos<input id="f" type="file" accept="image/*,application/pdf" multiple></label>
<div id="st"></div><div class="bar"><i id="b"></i></div>
<script>
const f=document.getElementById('f'),st=document.getElementById('st'),b=document.getElementById('b');
f.onchange=async()=>{const files=[...f.files];let ok=0;const bad=[];
for(let i=0;i<files.length;i++){st.textContent='Enviando '+(i+1)+' de '+files.length+'…';
const fd=new FormData();fd.append('photo',files[i]);
try{const r=await fetch(location.pathname+'/upload',{method:'POST',body:fd});if(r.ok)ok++;else{const j=await r.json().catch(()=>({}));bad.push(files[i].name+': '+(j.error||'error'));}}catch(e){bad.push(files[i].name+': sin conexión');}
b.style.width=((i+1)/files.length*100)+'%';}
st.textContent='✔ '+ok+' foto(s) enviada(s). Puedes enviar más.'+(bad.length?' No enviadas: '+bad.join(' · '):'');f.value='';};
</script></main></body></html>`;

export function startUploadServer() {
  if (server) return;
  const app = express();
  const port = getSettings().upload.port || 8787;

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      try { cb(null, inboxDir('wifi')); } catch (e) { cb(e); }
    },
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname || 'foto.jpg').replace(/[^\w.\-]/g, '_');
      cb(null, `${crypto.randomBytes(3).toString('hex')}_${safe}`);
    }
  });
  // Se aceptan todos los archivos para poder avisar en el kiosco de los que no son compatibles.
  const upload = multer({ storage, limits: { fileSize: 80 * 1024 * 1024, files: 1 } });

  const checkCode = (req, res, next) => {
    const s = getSession();
    if (!s || req.params.code !== s.code) return res.status(404).send('<p style="font:18px system-ui;padding:24px">Esta sesión ha terminado. Escanea de nuevo el código QR del kiosco.</p>');
    next();
  };

  app.get('/u/:code', checkCode, (req, res) => res.send(page(req.params.code, getSettings().storeName)));
  app.post('/u/:code/upload', checkCode, upload.single('photo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Archivo no válido' });
    const name = path.basename(req.file.originalname || 'archivo');
    const chk = checkFileName(name);
    if (!chk.ok) {
      await fsp.rm(req.file.path, { force: true });
      emit('import-issue', { name, reason: chk.reason });
      return res.status(415).json({ error: chk.reason });
    }
    emit('roll-add', { origin: 'Móvil (WiFi)', files: [{ path: req.file.path, name }] });
    res.json({ ok: true });
  });
  app.use((err, req, res, next) => res.status(400).json({ error: err.message }));

  server = app.listen(port, '0.0.0.0');
  server.on('error', (e) => console.error('Servidor de subida:', e.message));
}

export async function uploadInfo() {
  const s = getSession();
  const st = getSettings();
  const url = s ? `http://${localIp()}:${st.upload.port}/u/${s.code}` : '';
  const qr = url ? await QRCode.toDataURL(url, { margin: 1, width: 520 }) : '';
  let wifiQr = '';
  if (st.upload.wifiSsid) {
    const esc = (v) => String(v).replace(/([\\;,:"])/g, '\\$1');
    const wifi = `WIFI:T:${st.upload.wifiType || 'WPA'};S:${esc(st.upload.wifiSsid)};P:${esc(st.upload.wifiPassword || '')};;`;
    wifiQr = await QRCode.toDataURL(wifi, { margin: 1, width: 400 });
  }
  return { url, qr, wifiQr, ssid: st.upload.wifiSsid };
}
