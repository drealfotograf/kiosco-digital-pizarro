import React, { useId } from 'react';
import { FILTERS, DEFAULT_ADJUST, svgMatrixValues } from '../../../shared/color.js';

/** Define un filtro SVG con la misma matriz que usa el render final. Usar con style={{filter:`url(#id)`}}. */
export function FilterDefs({ id, adjust }) {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={svgMatrixValues(adjust)} />
      </filter>
    </svg>
  );
}

/** Imagen con filtro aplicado. */
export function FilteredImg({ src, adjust, style, className }) {
  const id = 'f' + useId().replace(/[^a-z0-9]/gi, '');
  return (
    <>
      <FilterDefs id={id} adjust={adjust} />
      <img src={src} alt="" className={className} style={{ ...style, filter: `url(#${id})` }} draggable={false} />
    </>
  );
}

export function FilterGrid({ src, adjust, onChange, compact = false }) {
  const a = { ...DEFAULT_ADJUST, ...adjust };
  return (
    <div className={`filter-grid ${compact ? 'compact' : ''}`}>
      {FILTERS.map((f) => (
        <button key={f.id} className={`filter-tile ${a.filter === f.id ? 'on' : ''}`} onClick={() => onChange({ ...a, filter: f.id })}>
          <span className="fimg"><FilteredImg src={src} adjust={{ filter: f.id }} /></span>
          <span>{f.name}</span>
        </button>
      ))}
    </div>
  );
}

const SLIDERS = [
  ['brightness', 'Brillo'], ['contrast', 'Contraste'], ['saturation', 'Saturación'], ['warmth', 'Temperatura']
];

export function ColorSliders({ adjust, onChange, only, compact = false }) {
  const a = { ...DEFAULT_ADJUST, ...adjust };
  return (
    <div className={compact ? 'sliders-compact' : 'col'} style={compact ? null : { gap: 6 }}>
      {SLIDERS.filter(([k]) => !only || only.includes(k)).map(([k, label]) => (
        <label key={k} className="slider-row">
          <span className="row" style={{ justifyContent: 'space-between' }}><b>{label}</b><span className="muted small">{a[k] > 0 ? '+' : ''}{a[k]}</span></span>
          <input type="range" min="-100" max="100" step="1" value={a[k]} onChange={(e) => onChange({ ...a, [k]: Number(e.target.value) })}
            onDoubleClick={() => onChange({ ...a, [k]: 0 })} className={k === 'warmth' ? 'warm' : ''} />
        </label>
      ))}
    </div>
  );
}
