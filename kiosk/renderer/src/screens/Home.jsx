import React, { useEffect, useState, useCallback } from 'react';
import { Icon, Logo, Modal, TouchField } from '../components/ui.jsx';
import { api } from '../api.js';
import { LegalLink } from '../components/Legal.jsx';
import PinLock, { parseLock, errorText } from '../components/PinLock.jsx';

const SLOGANS = [
  'Tus recuerdos,\nimpresos hoy.',
  'Cada foto\ncuenta una historia.',
  'Momentos únicos,\nimpresiones eternas.',
  'Del móvil\nal papel en minutos.',
  'Revive tus mejores\nmomentos.',
];
const SLOGAN_PANS = ['home-pan-a', 'home-pan-b', 'home-pan-c', 'home-pan-d', 'home-pan-e'];

/** Inicio con la identidad Pizarro: panel azul con el logotipo y las opciones a la derecha. */
export default function Home({ settings, onStart, onAdmin, onResume, onPinRelease, onGallery }) {
  const [pinFor, setPinFor] = useState('admin'); // 'admin' (ajustes) o 'gallery' (Mi galería, solo personal)
  const [resumeOpen, setResumeOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [tNo, setTNo] = useState('');
  const [tPin, setTPin] = useState('');
  const [tErr, setTErr] = useState('');
  const [code, setCode] = useState('');
  const [rErr, setRErr] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [lock, setLock] = useState(null);
  const [paper, setPaper] = useState([]);
  useEffect(() => { const f = () => api('printers:alerts').then(setPaper).catch(() => {}); f(); const t = setInterval(f, 60_000); return () => clearInterval(t); }, []); // bloqueo tras 5 PIN erróneos (ajustes / Mi galería)
  const [tLock, setTLock] = useState(null); // bloqueo del PIN de caja

  const tryPin = async () => {
    try { await api('admin:check', pin); setPinOpen(false); setLock(null); if (pinFor === 'gallery') onGallery(); else onAdmin(pin); }
    catch (e) { setPin(''); setLock(parseLock(e.message)); setErr(errorText(e.message)); } // PIN erróneo: se borra lo escrito
  };
  const options = [
    { icon: 'print', title: 'Imprimir fotos', text: 'Desde tu móvil, USB, tarjeta, correo, Bluetooth o PDF.', go: () => onStart('prints') },
    { icon: 'id', title: 'Fotos carnet', text: 'Lotes de fotos 35x45 para DNI, pasaporte y otros documentos.', go: () => onStart('id') },
  ];

  const [sloganIdx, setSloganIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSloganIdx((i) => (i + 1) % SLOGANS.length), 15_000);
    return () => clearInterval(t);
  }, []);
  const slogan = SLOGANS[sloganIdx];
  const pan = SLOGAN_PANS[sloganIdx % SLOGAN_PANS.length];
  const L = settings.legal || {};

  return (
    <div className="home2">
      <aside className="brand-panel">
        <div className="brand-top">
          <Logo height={140} color="var(--cream)" />
          <span className="brand-since">Capturamos tus mejores recuerdos<br />Desde 1986</span>
        </div>
        <div className="brand-slogan-wrap">
          <h1 key={sloganIdx} className={`brand-slogan ${pan}`}>
            {slogan.split('\n').map((l, i) => <span key={i}>{i > 0 && <br />}{l}</span>)}
          </h1>
        </div>
        <div className="brand-foot">
          {(L.phone || L.email) && (
            <span className="brand-contact">
              {L.phone && <span>{L.phone}</span>}
              {L.phone && L.email && <span> · </span>}
              {L.email && <span>{L.email}</span>}
            </span>
          )}
          <span className="foot">Toca una opción para empezar</span>
        </div>
      </aside>

      <main className="home-options">
        <div className="top">
          {/* Mi galería: icono discreto, solo para el personal (PIN de seguridad); solo entradas de red elegidas en Ajustes */}
          <button className="staff-btn" onClick={() => { setPinFor('gallery'); setPin(''); setErr(''); setPinOpen(true); }} aria-label="Mi galería (personal)" title="Mi galería"><Icon name="gallery" size={22} /></button>
          <button className={`staff-btn ${paper.length ? 'alert' : ''}`} onClick={() => { setPinFor('admin'); setPin(''); setErr(''); setPinOpen(true); }} aria-label="Ajustes del personal" title={paper.length ? paper.map((x) => `${x.printer}: ${x.level === 'empty' ? 'sin papel' : `quedan ${x.left}`}`).join(' · ') : undefined}>
            <Icon name="cog" size={22} />
            {/* Aviso discreto para el personal: poco papel en alguna impresora */}
            {paper.length > 0 && <i className={`staff-dot ${paper.some((x) => x.level === 'empty') ? 'empty' : 'low'}`}>{Math.min(...paper.map((x) => x.left))}</i>}
          </button>
        </div>
        <span className="label">¿Qué quieres hacer?</span>
        {options.map((o) => (
          <button key={o.title} className="option" onClick={o.go}>
            <span className="oi"><Icon name={o.icon} size={34} /></span>
            <span><h2>{o.title}</h2><p>{o.text}</p></span>
            <span className="arrow"><Icon name="next" size={30} /></span>
          </button>
        ))}
        <button className="btn resume" onClick={() => { setCode(''); setRErr(''); setResumeOpen(true); }}><Icon name="list" /> Continuar un pedido guardado</button>
        {settings.pin?.mode && settings.pin.mode !== 'off' && (
          <button className="btn resume" onClick={() => { setTNo(''); setTPin(''); setTErr(''); setPayOpen(true); }}><Icon name="print" /> Tengo un PIN de caja</button>
        )}
        <LegalLink settings={settings} />
      </main>

      {payOpen && (
        <Modal onClose={() => setPayOpen(false)}>
          <h2 style={{ margin: 0, fontWeight: 400 }}>Imprimir un pedido pagado</h2>
          <p className="muted" style={{ margin: 0 }}>Escribe el número de tu ticket y el PIN de 3 cifras que te han dado en caja.</p>
          <TouchField value={tNo} onChange={(v) => setTNo(v.replace(/\D/g, '').slice(0, 6))} placeholder="Nº de ticket" layout="num" maxLength={6} />
          <TouchField value={tPin} onChange={(v) => setTPin(v.replace(/\D/g, '').slice(0, 3))} placeholder="PIN" layout="num" secret maxLength={3} />
          {tLock && <PinLock lock={tLock} onUnlocked={() => { setTLock(null); setTErr(''); }} />}
          {tErr && !tLock && <div style={{ color: 'var(--err)' }}>{tErr}</div>}
          <div className="row"><div className="spacer" /><button className="btn" onClick={() => setPayOpen(false)}>Cancelar</button>
            {!tLock && <button className="btn primary" disabled={!tNo || tPin.length !== 3} onClick={async () => { try { await onPinRelease(tNo, tPin); setPayOpen(false); } catch (e) { setTPin(''); setTLock(parseLock(e.message)); setTErr(errorText(e.message)); } }}>Imprimir</button>}</div>
        </Modal>
      )}
      {resumeOpen && (
        <Modal onClose={() => setResumeOpen(false)}>
          <h2 style={{ margin: 0, fontWeight: 400 }}>Continuar un pedido</h2>
          <p className="muted" style={{ margin: 0 }}>Introduce el código que te dimos al guardar el pedido.</p>
          <TouchField value={code} onChange={setCode} placeholder="Código" layout="code" upper autoFocus maxLength={8} />
          {rErr && <div style={{ color: 'var(--err)', fontWeight: 600 }}>{rErr}</div>}
          <div className="row"><div className="spacer" /><button className="btn" onClick={() => setResumeOpen(false)}>Cancelar</button>
            <button className="btn primary" disabled={code.length < 4} onClick={async () => { try { await onResume(code); setResumeOpen(false); } catch (e) { setRErr(e.message); } }}>Continuar</button></div>
        </Modal>
      )}
      {pinOpen && (
        <Modal onClose={() => setPinOpen(false)}>
          <div className="row"><Logo mark height={52} color="var(--navy)" /><h2 style={{ margin: 0, fontWeight: 400 }}>{pinFor === 'gallery' ? 'Mi galería' : 'Ajustes del personal'}</h2></div>
          <p className="muted" style={{ margin: 0 }}>{pinFor === 'gallery' ? 'Solo para el personal. Introduce el PIN de seguridad.' : 'Introduce el PIN de administración.'}</p>
          {lock
            ? <PinLock lock={lock} onUnlocked={() => { setLock(null); setErr(''); }} />
            : <>
              <TouchField value={pin} onChange={setPin} placeholder="PIN" layout="num" secret autoFocus maxLength={8} />
              {err && <div style={{ color: 'var(--err)', fontWeight: 600 }}>{err}</div>}
            </>}
          <div className="row"><div className="spacer" /><button className="btn" onClick={() => setPinOpen(false)}>Cancelar</button>{!lock && <button className="btn primary" disabled={!pin} onClick={tryPin}>Entrar</button>}</div>
        </Modal>
      )}
    </div>
  );
}
