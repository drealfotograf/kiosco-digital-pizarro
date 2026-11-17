import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getSettings } from '../config.js';
import { getSession, inboxDir, emit } from '../session.js';
import { checkFileName } from '../../shared/presets.js';

// El cliente envía sus fotos a la dirección de la tienda con el código de sesión en el asunto.
let timer = null;
let busy = false;
let status = { state: 'idle', text: '' };
let notify = () => {};

export const emailStatus = () => status;
const setStatus = (state, text) => { status = { state, text }; notify('email-status', status); };

async function poll() {
  const cfg = getSettings().email;
  const s = getSession();
  if (busy || !cfg.enabled || !s) return;
  busy = true;
  const client = new ImapFlow({
    host: cfg.host, port: Number(cfg.port) || 993, secure: !!cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }, logger: false, socketTimeout: 30000
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false, subject: s.code }, { uid: true });
      setStatus('ok', uids.length ? `Recibiendo ${uids.length} correo(s)…` : 'Esperando tu correo…');
      for (const uid of uids || []) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        const mail = await simpleParser(msg.source);
        const dir = inboxDir('email');
        const saved = [];
        for (const att of mail.attachments || []) {
          // Se ignoran las imágenes incrustadas en la firma; el resto de adjuntos se revisa.
          if (att.contentDisposition === 'inline' && att.size < 30_000) continue;
          const name = att.filename || `adjunto.${(att.contentType || '').split('/')[1] || 'bin'}`;
          const chk = checkFileName(name);
          if (!chk.ok) { emit('import-issue', { name, reason: chk.reason }); continue; }
          const file = path.join(dir, `${crypto.randomBytes(3).toString('hex')}_${path.basename(name).replace(/[^\w.\-]/g, '_')}`);
          await fsp.writeFile(file, att.content);
          saved.push({ path: file, name });
        }
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        if (saved.length) {
          emit('roll-add', { origin: 'Correo electrónico', files: saved });
          notify('toast', { type: 'ok', text: `${saved.length} foto(s) recibida(s) por correo` });
        }
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (err) {
    setStatus('error', 'No se puede conectar con el correo. Avisa al personal.');
    console.error('IMAP:', err.message);
    try { client.close(); } catch { /* nada */ }
  } finally { busy = false; }
}

export function startEmailWatch(notifier) {
  notify = notifier;
  stopEmailWatch();
  const cfg = getSettings().email;
  if (!cfg.enabled) { setStatus('disabled', 'Recepción por correo desactivada'); return; }
  setStatus('ok', 'Esperando tu correo…');
  poll();
  timer = setInterval(poll, Math.max(10, Number(cfg.pollSeconds) || 20) * 1000);
}

export function stopEmailWatch() { if (timer) clearInterval(timer); timer = null; }

export async function testEmail(cfg) {
  const client = new ImapFlow({ host: cfg.host, port: Number(cfg.port) || 993, secure: !!cfg.secure, auth: { user: cfg.user, pass: cfg.pass }, logger: false });
  try { await client.connect(); await client.logout(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}
