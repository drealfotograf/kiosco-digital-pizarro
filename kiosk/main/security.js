// Protección de los PIN (administración, Mi galería y PIN de caja de cada pedido).
// - PIN erróneo: se cuenta el fallo (la pantalla borra lo escrito).
// - 5 fallos seguidos: bloqueo de 5 minutos. Se puede desbloquear antes con:
//     · el móvil de la empresa: código de 6 cifras de una app de autenticación (Google Authenticator,
//       Microsoft Authenticator…) vinculada en Administración → General (TOTP, RFC 6238; no hace falta SMS);
//     · el correo de la empresa: se envía un código de 6 cifras (válido 10 minutos) por SMTP.
// Los bloqueos se guardan en disco para que reiniciar el programa no los salte.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getSettings, dataDir } from './config.js';
import { logEvent } from './stats.js';

export const MAX_TRIES = 5;
export const LOCK_MS = 5 * 60_000;
const file = () => dataDir('bloqueos.json');
let gates = null;

function load() {
  if (gates) return gates;
  try { gates = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { gates = {}; }
  return gates;
}
function save() { try { fs.writeFileSync(file(), JSON.stringify(gates)); } catch { /* sin disco: se queda en memoria */ } }

/** Canales de verificación configurados. */
export function channels(s = getSettings()) {
  const sec = s.security || {};
  const out = [];
  if (sec.totpSecret && sec.totpEnabled) out.push('totp');
  if (sec.email && sec.smtp?.host) out.push('email');
  return out;
}

/** Error de bloqueo: el texto lleva los datos para la pantalla (hasta cuándo y cómo verificar). */
function lockError(gate, g) {
  const info = { gate, until: g.until, channels: channels() };
  return new Error(`BLOQUEO:${JSON.stringify(info)}|Demasiados intentos. Espera 5 minutos o verifica con el móvil o el correo de la empresa.`);
}

/** Lanza el error de bloqueo si la puerta está bloqueada (y limpia los bloqueos caducados). */
export function assertOpen(gate) {
  const g = load()[gate];
  if (!g?.until) return;
  if (Date.now() >= g.until) { delete gates[gate]; save(); return; }
  throw lockError(gate, g);
}

/**
 * Comprueba un PIN en una puerta: si falla suma un intento; al quinto bloquea.
 * expected: el PIN correcto. Devuelve true o lanza el error (con los intentos que quedan o el bloqueo).
 */
export function checkGate(gate, pin, expected) {
  assertOpen(gate);
  if (String(pin ?? '').trim() === String(expected)) { if (gates[gate]) { delete gates[gate]; save(); } return true; }
  const g = (gates[gate] ||= { fails: 0 });
  g.fails += 1;
  const kind = gate.startsWith('order:') ? 'caja' : gate;
  if (g.fails >= MAX_TRIES) { g.until = Date.now() + LOCK_MS; g.fails = 0; save(); logEvent('pinfail', { gate: kind, lock: true }); throw lockError(gate, g); }
  logEvent('pinfail', { gate: kind });
  save();
  const left = MAX_TRIES - g.fails;
  throw new Error(`PIN incorrecto. Te queda${left === 1 ? '' : 'n'} ${left} intento${left === 1 ? '' : 's'}.`);
}

export function unlock(gate) { if (load()[gate]) { delete gates[gate]; save(); } }

// ---------- TOTP (app de autenticación en el móvil de la empresa) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}
function b32decode(s) {
  let bits = '';
  for (const c of String(s).replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0'); }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret, t = Date.now(), step = 30) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(ctr).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0');
}
/** Acepta el código actual y el de 30 s antes o después (relojes no exactos). */
export function verifyTotp(secret, code) {
  const c = String(code || '').trim();
  return /^\d{6}$/.test(c) && [-1, 0, 1].some((w) => totp(secret, Date.now() + w * 30_000) === c);
}
export function totpUri(secret, label) {
  return `otpauth://totp/${encodeURIComponent(`Kiosco Pizarro:${label || 'Administración'}`)}?secret=${secret}&issuer=${encodeURIComponent('Kiosco Pizarro')}&digits=6&period=30`;
}

// ---------- Código por correo ----------
const mailCodes = new Map(); // gate → { hash, exp }
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export async function sendMailCode(gate) {
  const s = getSettings();
  const sec = s.security || {};
  if (!sec.email || !sec.smtp?.host) throw new Error('No hay correo de la empresa configurado.');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  mailCodes.set(gate, { hash: sha(code), exp: Date.now() + 10 * 60_000 });
  const { default: nodemailer } = await import('nodemailer');
  const tr = nodemailer.createTransport({
    host: sec.smtp.host, port: Number(sec.smtp.port) || 587, secure: !!sec.smtp.secure,
    auth: sec.smtp.user ? { user: sec.smtp.user, pass: sec.smtp.pass } : undefined, connectionTimeout: 10_000
  });
  await tr.sendMail({
    from: sec.smtp.from || sec.smtp.user || sec.email, to: sec.email,
    subject: `Código de verificación del kiosco: ${code}`,
    text: `Alguien ha fallado 5 veces el PIN en el kiosco (${new Date().toLocaleString('es-ES')}).\r\n\r\nCódigo para desbloquearlo: ${code}\r\n\r\nCaduca en 10 minutos. Si no has sido tú, no hagas nada: el kiosco se desbloquea solo a los 5 minutos.`
  });
  return { to: sec.email.replace(/^(.).*(@.*)$/, '$1•••$2') };
}

/** Verifica un código (móvil o correo) y desbloquea la puerta. */
export function verifyCode(gate, method, code) {
  const sec = getSettings().security || {};
  let ok = false;
  if (method === 'totp') ok = !!sec.totpSecret && verifyTotp(sec.totpSecret, code);
  if (method === 'email') {
    const m = mailCodes.get(gate);
    ok = !!m && Date.now() < m.exp && sha(String(code || '').trim()) === m.hash;
    if (ok) mailCodes.delete(gate);
  }
  if (!ok) throw new Error('Código no válido o caducado.');
  unlock(gate);
  return true;
}
