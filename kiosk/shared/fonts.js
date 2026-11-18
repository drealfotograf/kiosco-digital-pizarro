// Letras que se pueden elegir en Administración → Letras. Todas funcionan sin internet:
// Montserrat y Plus Jakarta Sans van dentro de la aplicación; el resto vienen con Windows 10/11.
export const FONT_CHOICES = [
  { family: 'Montserrat', label: 'Montserrat', kind: 'sans', css: '"Montserrat Variable", Montserrat', bundled: true },
  { family: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans', kind: 'sans', css: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans"', bundled: true },
  { family: 'Segoe UI', label: 'Segoe UI', kind: 'sans' },
  { family: 'Segoe UI Light', label: 'Segoe UI Light', kind: 'sans' },
  { family: 'Bahnschrift', label: 'Bahnschrift', kind: 'sans' },
  { family: 'Corbel', label: 'Corbel', kind: 'sans' },
  { family: 'Corbel Light', label: 'Corbel Light', kind: 'sans' },
  { family: 'Candara', label: 'Candara', kind: 'sans' },
  { family: 'Calibri Light', label: 'Calibri Light', kind: 'sans' },
  { family: 'Sitka Display', label: 'Sitka Display', kind: 'serif' },
  { family: 'Sitka Heading', label: 'Sitka Heading', kind: 'serif' },
  { family: 'Sitka Text', label: 'Sitka Text', kind: 'serif' },
  { family: 'Constantia', label: 'Constantia', kind: 'serif' },
  { family: 'Georgia', label: 'Georgia', kind: 'serif' },
  { family: 'Cambria', label: 'Cambria', kind: 'serif' },
  { family: 'Palatino Linotype', label: 'Palatino Linotype', kind: 'serif' },
  { family: 'Gabriola', label: 'Gabriola', kind: 'serif' }
];

export const DEFAULT_FONTS = {
  ui: 'Montserrat', // texto general del programa
  headings: 'Montserrat', // títulos
  // Mensajes de la pantalla de espera: cada uno con su letra y estilo; van rotando.
  messages: [
    { family: 'Montserrat', weight: 200, upper: true },
    { family: 'Sitka Display', italic: true },
    { family: 'Plus Jakarta Sans', weight: 300 },
    { family: 'Corbel Light' },
    { family: 'Sitka Heading' }
  ]
};

/** Pila CSS de una letra (con su respaldo según sea de palo seco o con remate). */
export function fontStack(family) {
  const f = FONT_CHOICES.find((x) => x.family === family);
  const base = f?.css || `"${String(family || 'Montserrat').replace(/"/g, '')}"`;
  return `${base}, ${f?.kind === 'serif' ? 'Georgia, serif' : '"Segoe UI", system-ui, sans-serif'}`;
}
