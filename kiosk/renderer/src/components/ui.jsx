import React, { useState } from 'react';

const paths = {
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  id: 'M3 5h18v14H3zM8.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM5 17c.6-2 2-3 3.5-3s2.9 1 3.5 3M14 9h4M14 13h4',
  gallery: 'M4 4h16v16H4zM4 15l5-5 5 5M13 13l2-2 5 5M15.5 8.5h.01',
  usb: 'M10 2h4v5h-4zM8 7h8v8a4 4 0 0 1-8 0zM12 19v3',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0M12 20h.01',
  phone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
  bt: 'M7 7l10 10-5 5V2l5 5L7 17',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  check: 'M5 12l5 5L20 7',
  close: 'M6 6l12 12M18 6L6 18',
  rotate: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  plus: 'M12 5v14M5 12h14',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01',
  straighten: 'M3 12h18M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1',
  checks: 'M3 7l3 3 5-5M3 17l3 3 5-5M14 7h7M14 17h7',
  chevron: 'M6 9l6 6 6-6',
  layers:'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'
};

/** Logotipo Pizarro: esquinas de encuadre y el nombre en Montserrat Light espaciada. */
export function Logo({ height = 56, color = 'currentColor', mark = false }) {
  if (mark) {
    // Versión icono: solo las esquinas con la P.
    return (
      <svg height={height} viewBox="0 0 120 120" aria-label="Pizarro" role="img">
        <g stroke={color} strokeWidth="3" fill="none" strokeLinecap="square">
          <path d="M14 38V14h24M82 14h24v24M14 82v24h24M82 106h24V82" />
        </g>
        <text x="60" y="75" textAnchor="middle" fontFamily="Montserrat Variable, Montserrat, sans-serif" fontWeight="300" fontSize="46" fill={color}>P</text>
      </svg>
    );
  }
  return (
    <svg height={height} viewBox="0 0 560 200" aria-label="Pizarro" role="img">
      <g stroke={color} strokeWidth="3.2" fill="none" strokeLinecap="square">
        <path d="M112 50V14h52M396 14h52v36M112 150v36h52M396 186h52v-36" />
      </g>
      <text x="291" y="122" textAnchor="middle" fontFamily="Montserrat Variable, Montserrat, sans-serif" fontWeight="300" fontSize="66" letterSpacing="22" fill={color}>PIZARRO</text>
    </svg>
  );
}

export function Icon({ name, size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function Stepper({ value, onChange, min = 1, max = 999 }) {
  return (
    <div className="stepper">
      <button onClick={() => onChange(Math.max(min, value - 1))} aria-label="Menos">−</button>
      <span>{value}</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} aria-label="Más">+</button>
    </div>
  );
}

export function Modal({ children, onClose }) {
  return (
    <div className="modal" onPointerDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className="sheet">{children}</div>
    </div>
  );
}

export function Busy({ text }) {
  return (
    <div className="modal">
      <div className="sheet" style={{ width: 460, alignItems: 'center', textAlign: 'center' }}>
        <div className="spinner" />
        <div className="big" style={{ fontSize: 22 }}>{text || 'Un momento…'}</div>
      </div>
    </div>
  );
}

const LAYOUTS = {
  text: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM@.-'],
  code: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  num: ['123', '456', '789', '0']
};

/** Campo con teclado en pantalla (el kiosco no tiene teclado físico). */
export function TouchField({ value, onChange, placeholder, layout = 'text', secret = false, autoFocus = false, upper = false, maxLength = 60 }) {
  const [open, setOpen] = useState(autoFocus);
  const [lower, setLower] = useState(!upper);
  const press = (k) => { if (value.length < maxLength) onChange(value + (lower && layout === 'text' ? k.toLowerCase() : k)); };
  const shown = secret ? '•'.repeat(value.length) : value;
  return (
    <div className="col">
      <div className={`field ${open ? 'on' : ''}`} onClick={() => setOpen(true)}>
        {shown || <span className="ph-text">{placeholder}</span>}
      </div>
      {open && (
        <div className="kbd">
          {LAYOUTS[layout].map((r) => (
            <div className="r" key={r}>{[...r].map((k) => <button key={k} onClick={() => press(k)}>{lower && layout === 'text' ? k.toLowerCase() : k}</button>)}</div>
          ))}
          <div className="r">
            {layout === 'text' && <button className="wide" onClick={() => setLower(!lower)}>{lower ? 'MAYÚS' : 'minús'}</button>}
            {layout === 'text' && <button className="wide" onClick={() => press(' ')}>Espacio</button>}
            <button className="wide" onClick={() => onChange(value.slice(0, -1))}>⌫ Borrar</button>
            <button className="wide" onClick={() => setOpen(false)}>Listo</button>
          </div>
        </div>
      )}
    </div>
  );
}
