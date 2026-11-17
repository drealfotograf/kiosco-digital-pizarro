import React, { useState } from 'react';
import { Icon, Logo, Modal, TouchField } from '../components/ui.jsx';
import { api } from '../api.js';
import { LegalLink } from '../components/Legal.jsx';

/** Inicio con la identidad Pizarro: panel azul con el logotipo y las opciones a la derecha. */
export default function Home({ settings, onStart, onAdmin, onResume }) {
  const [resumeOpen, setResumeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [rErr, setRErr] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');

  const tryPin = async () => {
    try { await api('admin:check', pin); setPinOpen(false); onAdmin(pin); } catch { setErr('PIN incorrecto'); setPin(''); }
  };
  const options = [
    { icon: 'print', title: 'Imprimir fotos', text: 'Desde tu móvil, USB, tarjeta, correo, Bluetooth o PDF.', go: () => onStart('prints') },
    { icon: 'id', title: 'Fotos carnet', text: 'Lotes de fotos 35x45 para DNI, pasaporte y otros documentos.', go: () => onStart('id') },
    { icon: 'gallery', title: 'Mi galería', text: 'Las fotos de tu sesión o evento, con tu código y contraseña.', go: () => onStart('prints', 'gallery') }
  ];

  return (
    <div className="home2">
      <aside className="brand-panel">
        <div className="brand-center">
          <Logo height={170} color="var(--cream)" />
          <span className="tag">Impresión fotográfica</span>
          <h1>Tus recuerdos,<br /><em>impresos hoy.</em></h1>
        </div>
        <span className="foot">Toca una opción para empezar</span>
      </aside>

      <main className="home-options">
        <div className="top">
          <button className="staff-btn" onClick={() => { setPin(''); setErr(''); setPinOpen(true); }} aria-label="Ajustes del personal"><Icon name="cog" size={22} /></button>
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
        <LegalLink settings={settings} />
      </main>

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
          <div className="row"><Logo mark height={52} color="var(--navy)" /><h2 style={{ margin: 0, fontWeight: 400 }}>Ajustes del personal</h2></div>
          <p className="muted" style={{ margin: 0 }}>Introduce el PIN de administración.</p>
          <TouchField value={pin} onChange={setPin} placeholder="PIN" layout="num" secret autoFocus maxLength={8} />
          {err && <div style={{ color: 'var(--err)', fontWeight: 600 }}>{err}</div>}
          <div className="row"><div className="spacer" /><button className="btn" onClick={() => setPinOpen(false)}>Cancelar</button><button className="btn primary" disabled={!pin} onClick={tryPin}>Entrar</button></div>
        </Modal>
      )}
    </div>
  );
}
