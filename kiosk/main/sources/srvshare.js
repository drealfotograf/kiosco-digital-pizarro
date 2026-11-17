// Carpeta compartida del servidor de la tienda: libre acceso desde el kiosco (con la clave del kiosco, sin contraseña de cliente).
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSettings } from '../config.js';
import { inboxDir } from '../session.js';

const base = () => getSettings().lab.serverUrl.replace(/\/+$/, '');
const key = () => getSettings().lab.kioskKey || '';
const url = (route, rel, extra = '') => `${base()}/api/share/${route}?path=${encodeURIComponent(rel)}${extra}&k=${encodeURIComponent(key())}`;

export async function listServerShare(rel = '', recursive = false) {
  let r;
  try {
    r = await fetch(`${base()}/api/share/list?path=${encodeURIComponent(rel)}${recursive ? '&recursive=1' : ''}`, { headers: { 'x-kiosk-key': key() }, signal: AbortSignal.timeout(15000) });
  } catch { throw new Error('No se puede conectar con el servidor de la tienda'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error del servidor');
  return {
    ...j,
    files: j.files.map((f) => ({ ...f, thumb: url('thumb', f.path, '&s=360'), preview: url('thumb', f.path, '&s=1600') }))
  };
}

export async function downloadServerFile(rel) {
  const r = await fetch(url('file', rel), { headers: { 'x-kiosk-key': key() } });
  if (!r.ok) throw new Error('No se pudo descargar el archivo del servidor');
  const file = path.join(inboxDir('servidor'), `${crypto.randomBytes(3).toString('hex')}_${path.basename(rel)}`);
  await fsp.writeFile(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
