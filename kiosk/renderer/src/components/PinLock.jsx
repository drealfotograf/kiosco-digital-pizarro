import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { TouchField } from './ui.jsx';

/** Si el error es un bloqueo por 5 PIN erróneos, devuelve { gate, until, channels }; si no, null. */
export function parseLock(message) {
  const m = /BLOQUEO:(\{.*?\})\|/.exec(String(message || ''));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
/** Texto del error sin los datos técnicos del bloqueo. */
export const errorText = (message) => String(message || '').replace(/^.*BLOQUEO:\{.*?\}\|/, '');

/**
 * Bloqueo tras 5 PIN erróneos: cuenta atrás de 5 minutos o verificación con el móvil de la empresa
 * (código de la app de autenticación) o con un código enviado al correo de la empresa.
 */
export default function PinLock({ lock, onUnlocked }) {
  const [now, setNow] = useState(Date.now());
  const [method, setMethod] = useState(null); // 'totp' | 'email'
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.ceil((lock.until - now) / 1000));
  useEffect(() => { if (left === 0) onUnlocked(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMail = async () => {
    setBusy(true); setMsg('');
    try { const r = await api('security:sendCode', lock.gate); setMethod('email'); setMsg(`Código enviado a ${r.to}.`); }
    catch (e) { setMsg(`No se ha podido enviar el correo: ${e.message}`); }
    setBusy(false);
  };
  const verify = async () => {
    setBusy(true); setMsg('');
    try { await api('security:verify', lock.gate, method, code); onUnlocked(); }
    catch (e) { setMsg(errorText(e.message)); setCode(''); }
    setBusy(false);
  };

  return (
    <div className="pin-lock col">
      <b style={{ color: 'var(--err)', fontSize: 18 }}>Demasiados intentos: el PIN está bloqueado.</b>
      <div className="row" style={{ gap: 10 }}>
        <span>Espera</span><span className="mono lock-timer">{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>
        <span className="muted small">o verifica la identidad:</span>
      </div>
      {!method && (
        <div className="row" style={{ gap: 8 }}>
          {lock.channels?.includes('totp') && <button className="btn" onClick={() => { setMethod('totp'); setMsg(''); }}>Móvil de la empresa</button>}
          {lock.channels?.includes('email') && <button className="btn" disabled={busy} onClick={sendMail}>Enviar código al correo</button>}
          {!lock.channels?.length && <span className="muted small">No hay móvil ni correo de verificación configurados: hay que esperar.</span>}
        </div>
      )}
      {method && (
        <>
          <span className="small">{method === 'totp' ? 'Abre la app de autenticación del móvil de la empresa y escribe el código de 6 cifras.' : 'Escribe el código de 6 cifras que ha llegado al correo de la empresa.'}</span>
          <TouchField value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="Código de verificación" layout="num" maxLength={6} autoFocus />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => { setMethod(null); setCode(''); setMsg(''); }}>Otro método</button>
            <button className="btn primary" disabled={code.length !== 6 || busy} onClick={verify}>Verificar</button>
          </div>
        </>
      )}
      {msg && <span className="small" style={{ color: msg.startsWith('Código enviado') ? 'var(--ok)' : 'var(--err)' }}>{msg}</span>}
    </div>
  );
}
