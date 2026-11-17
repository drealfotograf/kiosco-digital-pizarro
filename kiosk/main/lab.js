import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getSettings } from './config.js';

/**
 * Envía un pedido al servidor de la tienda (modo http) o lo copia a una carpeta
 * compartida / carpeta caliente del laboratorio (modo folder).
 */
export async function sendToLab(record, files) {
  const lab = getSettings().lab;
  if (lab.mode === 'folder') {
    if (!lab.folder) throw new Error('No se ha configurado la carpeta del laboratorio');
    const dir = path.join(lab.folder, record.orderNo);
    for (const [i, f] of files.entries()) {
      const item = record.items[i];
      const sub = path.join(dir, item.size.replace(/[^\w\- ,.]/g, '_'));
      await fsp.mkdir(sub, { recursive: true });
      await fsp.copyFile(f, path.join(sub, path.basename(f)));
    }
    await fsp.writeFile(path.join(dir, 'pedido.json'), JSON.stringify(record, null, 2));
    await fsp.writeFile(path.join(dir, 'pedido.txt'), summaryText(record));
    return { ok: true };
  }

  const url = lab.serverUrl.replace(/\/+$/, '') + '/api/orders';
  const form = new FormData();
  form.append('manifest', JSON.stringify(record));
  for (const f of files) form.append('files', await fs.openAsBlob(f, { type: 'image/jpeg' }), path.basename(f));
  let res;
  try {
    res = await fetch(url, { method: 'POST', body: form, headers: { 'x-kiosk-key': lab.kioskKey || '' }, signal: AbortSignal.timeout(10 * 60_000) });
  } catch (e) {
    throw new Error('No se puede conectar con el servidor del laboratorio. Comprueba la red.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `El servidor respondió ${res.status}`);
  }
  return res.json();
}

export function summaryText(r) {
  const lines = [
    `Pedido ${r.orderNo}  ·  ${new Date(r.createdAt).toLocaleString('es-ES')}`,
    `Cliente: ${r.customer?.name || '-'}   Tel: ${r.customer?.phone || '-'}`,
    `Total: ${r.total.toFixed(2)} ${r.currency}`,
    '',
    ...r.items.map((i) => `${i.qty} x ${i.size}   ${i.file}`)
  ];
  return lines.join('\r\n');
}

export async function testLab() {
  const lab = getSettings().lab;
  if (lab.mode === 'folder') {
    try { await fsp.access(lab.folder, fs.constants.W_OK); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  }
  try {
    const r = await fetch(lab.serverUrl.replace(/\/+$/, '') + '/api/ping', { headers: { 'x-kiosk-key': lab.kioskKey || '' }, signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    return j.ok ? { ok: true } : { ok: false, error: j.error || 'Clave del kiosco incorrecta' };
  } catch (e) { return { ok: false, error: e.message }; }
}
