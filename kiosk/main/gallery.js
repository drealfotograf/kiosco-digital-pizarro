import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings } from './config.js';
import { inboxDir } from './session.js';

// Acceso desde el kiosco a las galerías privadas alojadas en el servidor de la tienda.
const base = () => getSettings().lab.serverUrl.replace(/\/+$/, '');

export async function galleryLogin(code, password) {
  let r;
  try {
    r = await fetch(`${base()}/api/g/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, password }), signal: AbortSignal.timeout(8000)
    });
  } catch { throw new Error('No se puede conectar con el servidor de galerías'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Código o contraseña incorrectos');
  const list = await fetch(`${base()}/api/g/photos`, { headers: { authorization: `Bearer ${j.token}` } }).then((x) => x.json());
  const t = encodeURIComponent(j.token);
  return {
    token: j.token, title: j.title,
    photos: list.photos.map((p) => ({ ...p, thumbUrl: `${base()}/api/g/file/${p.id}?size=thumb&t=${t}`, previewUrl: `${base()}/api/g/file/${p.id}?size=preview&t=${t}` }))
  };
}

/** Descarga el original de una foto de la galería (la clave del kiosco permite imprimir aunque la galería no deje descargar). */
export async function galleryDownload(token, id) {
  const r = await fetch(`${base()}/api/g/file/${encodeURIComponent(id)}?size=orig`, { headers: { authorization: `Bearer ${token}`, 'x-kiosk-key': getSettings().lab.kioskKey || '' } });
  if (!r.ok) throw new Error('No se pudo descargar la foto de la galería');
  const name = decodeURIComponent((r.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || `${id}.jpg`);
  const file = path.join(inboxDir('galeria'), `${id}_${path.basename(name).replace(/[^\w.\-]/g, '_')}`);
  await fsp.writeFile(file, Buffer.from(await r.arrayBuffer()));
  return file;
}
