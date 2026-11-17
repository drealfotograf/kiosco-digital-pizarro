// Filtros y corrección de color como una única matriz afín RGB (valores 0..1):
//   salida = M · rgb + o
// La misma matriz se usa en la vista previa (feColorMatrix de SVG, en sRGB) y en el render final (sharp recomb + linear),
// así lo que el cliente ve es lo que se imprime.

const LUM = [0.2126, 0.7152, 0.0722];
const I = () => ({ m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], o: [0, 0, 0] });

/** Aplica a y después b. */
function then(a, b) {
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => b.m[i][0] * a.m[0][j] + b.m[i][1] * a.m[1][j] + b.m[i][2] * a.m[2][j]));
  const o = [0, 1, 2].map((i) => b.m[i][0] * a.o[0] + b.m[i][1] * a.o[1] + b.m[i][2] * a.o[2] + b.o[i]);
  return { m, o };
}
const diag = (r, g, b, o = [0, 0, 0]) => ({ m: [[r, 0, 0], [0, g, 0], [0, 0, b]], o });
const OPS = {
  bri: (k) => diag(k, k, k),
  con: (k) => diag(k, k, k, [0.5 * (1 - k), 0.5 * (1 - k), 0.5 * (1 - k)]),
  sat: (s) => ({ m: [0, 1, 2].map((i) => [0, 1, 2].map((j) => (1 - s) * LUM[j] + (i === j ? s : 0))), o: [0, 0, 0] }),
  warm: (w) => diag(1 + 0.12 * w, 1 + 0.02 * w, 1 - 0.14 * w),
  fade: (f) => diag(1 - f, 1 - f, 1 - f, [f, f, f]),
  tint: ([r, g, b]) => diag(r, g, b),
  sepia: (a) => {
    const s = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]];
    return { m: [0, 1, 2].map((i) => [0, 1, 2].map((j) => (1 - a) * (i === j ? 1 : 0) + a * s[i][j])), o: [0, 0, 0] };
  }
};

export const FILTERS = [
  { id: 'none', name: 'Original', ops: [] },
  { id: 'vivid', name: 'Vívido', ops: [['sat', 1.35], ['con', 1.1]] },
  { id: 'warm', name: 'Cálido', ops: [['warm', 0.7], ['sat', 1.08]] },
  { id: 'cool', name: 'Frío', ops: [['warm', -0.7]] },
  { id: 'golden', name: 'Dorado', ops: [['warm', 0.45], ['tint', [1.04, 1.0, 0.9]], ['con', 1.05]] },
  { id: 'soft', name: 'Suave', ops: [['con', 0.86], ['bri', 1.06]] },
  { id: 'matte', name: 'Mate', ops: [['fade', 0.1], ['sat', 0.88]] },
  { id: 'drama', name: 'Drama', ops: [['con', 1.32], ['sat', 0.8]] },
  { id: 'vintage', name: 'Vintage', ops: [['sepia', 0.35], ['fade', 0.08], ['con', 0.92]] },
  { id: 'sepia', name: 'Sepia', ops: [['sepia', 1]] },
  { id: 'bw', name: 'B/N', ops: [['sat', 0]] },
  { id: 'noir', name: 'Noir', ops: [['sat', 0], ['con', 1.35]] }
];

export const DEFAULT_ADJUST = { filter: 'none', brightness: 0, contrast: 0, saturation: 0, warmth: 0 };

/** adjust: { filter, brightness, contrast, saturation, warmth } (cada ajuste de -100 a 100). */
export function buildMatrix(adjust = {}) {
  const a = { ...DEFAULT_ADJUST, ...adjust };
  let t = I();
  for (const [op, v] of FILTERS.find((f) => f.id === a.filter)?.ops || []) t = then(t, OPS[op](v));
  if (a.brightness) t = then(t, OPS.bri(1 + (a.brightness / 100) * 0.5));
  if (a.contrast) t = then(t, OPS.con(1 + (a.contrast / 100) * 0.6));
  if (a.saturation) t = then(t, OPS.sat(1 + a.saturation / 100));
  if (a.warmth) t = then(t, OPS.warm(a.warmth / 100));
  return t;
}

export function isIdentity(t) {
  return t.m.every((r, i) => r.every((v, j) => Math.abs(v - (i === j ? 1 : 0)) < 1e-6)) && t.o.every((v) => Math.abs(v) < 1e-6);
}

/** Valores para <feColorMatrix type="matrix">. */
export function svgMatrixValues(adjust) {
  const { m, o } = buildMatrix(adjust);
  const r = (v) => +v.toFixed(5);
  return [0, 1, 2].map((i) => `${r(m[i][0])} ${r(m[i][1])} ${r(m[i][2])} 0 ${r(o[i])}`).join(' ') + ' 0 0 0 1 0';
}
