import React, { useEffect, useState } from 'react';
import { DEFAULT_FONTS, fontStack } from '../../../shared/fonts.js';

export const QUOTES = [
  'Tus fotos son tu memoria del pasado.',
  'Imprime tus recuerdos, nunca los perderás.',
  'La memoria es frágil, las fotos te recuerdan tus mejores momentos, no los pierdas.'
];

// Tamaños y recorridos de ampliación y paneo que van alternando; las letras se eligen en Administración → Letras.
const SIZES = [56, 66, 58, 64, 54];
const PANS = ['pan-a', 'pan-b', 'pan-c', 'pan-d'];

/** Frases que cambian cada `every` segundos con efecto de ampliación y paneo (pantalla de espera). */
export default function Quotes({ every = 15, quotes = QUOTES, fonts }) {
  const list = fonts?.length ? fonts : DEFAULT_FONTS.messages;
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), every * 1000);
    return () => clearInterval(t);
  }, [every]);
  const q = quotes[n % quotes.length];
  const f = list[n % list.length];
  const st = { font: fontStack(f.family), size: SIZES[n % SIZES.length], weight: f.weight || 400, italic: !!f.italic, upper: !!f.upper, spacing: f.upper ? '.14em' : '.01em', pan: PANS[n % PANS.length] };
  const long = q.length > 60;
  return (
    <div className="quotes" aria-live="polite">
      <p key={n} className={`quote ${st.pan}`}
        style={{ fontFamily: st.font, fontSize: Math.round(st.size * (long ? 0.72 : 1) * (st.upper ? 0.85 : 1)), fontStyle: st.italic ? 'italic' : 'normal', fontWeight: st.weight, letterSpacing: st.spacing || 0, textTransform: st.upper ? 'uppercase' : 'none', animationDuration: `${every}s` }}>
        {q}
      </p>
    </div>
  );
}
