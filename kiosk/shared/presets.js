import { DEFAULT_FONTS } from './fonts.js';
// Datos compartidos entre el proceso principal y la interfaz.
// Todas las medidas en milímetros, siempre en vertical (ancho <= alto).

export const DEFAULT_PRINT_SIZES = [
  { id: '9x13', name: '9 x 13 cm', w: 89, h: 127, price: 0.3, printers: [], useDriverPaper: false },
  { id: '10x15', name: '10 x 15 cm', w: 102, h: 152, price: 0.35, printers: [], useDriverPaper: false },
  // Polaroid sobre papel 10x15: foto visible y 2 cm de margen inferior; debajo se marca el corte.
  { id: 'pola10', name: 'Polaroid 8,5x8,5', w: 102, h: 152, price: 0.6, printers: [], useDriverPaper: false, card: { h: 113.5, win: { x: 8.5, y: 8.5, w: 85, h: 85 } } },
  { id: 'pola8', name: 'Polaroid 8x10', w: 102, h: 152, price: 0.6, printers: [], useDriverPaper: false, card: { h: 131, win: { x: 11, y: 11, w: 80, h: 100 } } },
  { id: '13x18', name: '13 x 18 cm', w: 127, h: 178, price: 0.9, printers: [], useDriverPaper: false },
  { id: '15x20', name: '15 x 20 cm', w: 152, h: 203, price: 1.5, printers: [], useDriverPaper: false },
  { id: '20x30', name: '20 x 30 cm', w: 203, h: 305, price: 3.5, printers: [], useDriverPaper: false },
  { id: '30x40', name: '30 x 40 cm', w: 305, h: 406, price: 9, printers: [], useDriverPaper: false },
  { id: 'A4', name: 'A4 (21 x 29,7 cm)', w: 210, h: 297, price: 3, printers: [], useDriverPaper: false }
];

// crownMm: distancia aproximada desde el borde superior hasta la coronilla.
// headMin/headMax: altura de la cabeza (barbilla a coronilla) admitida.
export const DEFAULT_ID_PRESETS = [
  { id: 'es-dni', name: 'España DNI / NIE', region: 'Europa', w: 26, h: 32, headMin: 22, headMax: 26, crownMm: 2.5, price: 6 },
  { id: 'eu-pass', name: 'Pasaporte / Visado UE (Schengen)', region: 'Europa', w: 35, h: 45, headMin: 32, headMax: 36, crownMm: 4, price: 8 },
  { id: 'uk-pass', name: 'Reino Unido', region: 'Europa', w: 35, h: 45, headMin: 29, headMax: 34, crownMm: 5, price: 8 },
  { id: 'us-pass', name: 'EEUU Pasaporte / Visa (2x2")', region: 'América', w: 51, h: 51, headMin: 25, headMax: 35, crownMm: 7, price: 10 },
  { id: 'ca-pass', name: 'Canadá', region: 'América', w: 50, h: 70, headMin: 31, headMax: 36, crownMm: 10, price: 10 },
  { id: 'mx-pass', name: 'México Pasaporte', region: 'América', w: 35, h: 45, headMin: 32, headMax: 36, crownMm: 4, price: 8 },
  { id: 'cn-visa', name: 'China Visado', region: 'Asia', w: 33, h: 48, headMin: 28, headMax: 33, crownMm: 4, price: 10 },
  { id: 'in-visa', name: 'India Visado (2x2")', region: 'Asia', w: 51, h: 51, headMin: 25, headMax: 35, crownMm: 7, price: 10 }
];

// Lotes de fotos carnet: número de fotos por persona y precio cerrado. presetId vacío = cualquier formato.
// Lotes de fotos de carné (papel 10x15). Se activan o desactivan en Administración → Fotos carnet.
// Lotes de carné. paper: hoja de impresión ('10x15' o '15x20'). face: guías de cara (mm: altura de cabeza mín./máx.
// y distancia de la coronilla al borde). uso: nota solo para el personal (en la pantalla del cliente no salen países).
const F3545 = { headMin: 32, headMax: 36, crownMm: 4 };
const F5151 = { headMin: 25, headMax: 35, crownMm: 6 };
const F3040 = { headMin: 25, headMax: 29, crownMm: 3 };
const F4040 = { headMin: 26, headMax: 30, crownMm: 4 };
const F3348 = { headMin: 28, headMax: 33, crownMm: 4 };
const F5070 = { headMin: 31, headMax: 36, crownMm: 12 };
const F2632 = { headMin: 22, headMax: 26, crownMm: 2.5 };
export const DEFAULT_ID_LOT_TYPES = [
  // ---- Papel 10x15 ----
  { id: 'c8', name: '8 fotos 35x45', paper: '10x15', kind: 'grid', pw: 35, ph: 45, cols: 4, rows: 2, landscape: true, price: 8, enabled: true, face: F3545, uso: 'España, UE/Schengen, Reino Unido, Australia y la mayoría de países' },
  { id: 'c4g', name: '4 fotos 35x45 + 1 de 7x10', paper: '10x15', kind: 'grid+big', pw: 35, ph: 45, cols: 2, rows: 2, big: { w: 70, h: 100 }, landscape: true, price: 9, enabled: true, face: F3545, uso: 'Como el anterior, con una foto grande de recuerdo' },
  // 5,1x5,1 cm (2x2"): en 10x15 caben 4 (2 filas exactas de 51 mm, sin separación vertical).
  { id: 's4', name: '4 fotos 5,1x5,1', paper: '10x15', kind: 'grid', pw: 51, ph: 51, cols: 2, rows: 2, landscape: true, price: 10, enabled: true, face: F5151, uso: 'EEUU, India y otros países que piden 2x2"' },
  // La 5x7 usa el mismo encuadre que las pequeñas (mismo ancho y misma altura de la cabeza; se alarga hacia abajo).
  { id: 's4b', name: '4 fotos 5,1x5,1 + 1 de 5x7', paper: '10x15', kind: 'grid+big', pw: 51, ph: 51, cols: 2, rows: 2, big: { w: 50, h: 70 }, bigFollows: true, landscape: true, price: 11, enabled: true, face: F5151, uso: 'Como el anterior, con una 5x7 del mismo encuadre' },
  { id: 'p10-3040', name: '9 fotos 3x4', paper: '10x15', kind: 'grid', pw: 30, ph: 40, cols: 3, rows: 3, landscape: false, price: 8, enabled: true, face: F3040, uso: 'Brasil, Colombia, Rusia, Ucrania y otros (3x4 cm)' },
  { id: 'p10-4040', name: '6 fotos 4x4', paper: '10x15', kind: 'grid', pw: 40, ph: 40, cols: 3, rows: 2, landscape: true, price: 8, enabled: true, face: F4040, uso: 'Argentina y otros (4x4 cm)' },
  { id: 'p10-3348', name: '8 fotos 33x48', paper: '10x15', kind: 'grid', pw: 33, ph: 48, cols: 4, rows: 2, landscape: true, price: 9, enabled: true, face: F3348, uso: 'Visado de China' },
  { id: 'p10-5070', name: '2 fotos 5x7', paper: '10x15', kind: 'grid', pw: 50, ph: 70, cols: 2, rows: 1, landscape: true, price: 9, enabled: true, face: F5070, uso: 'Pasaporte de Canadá' },
  { id: 'c12', name: '12 fotos 26x32', paper: '10x15', kind: 'grid', pw: 26, ph: 32, cols: 3, rows: 4, landscape: false, price: 8, enabled: false, face: F2632, uso: 'Documentos que piden 26x32 mm' },
  // ---- Papel 15x20 ----
  { id: 'p20-3545', name: '15 fotos 35x45', paper: '15x20', kind: 'grid', pw: 35, ph: 45, cols: 5, rows: 3, landscape: true, price: 14, enabled: true, face: F3545, uso: 'España, UE/Schengen, Reino Unido, Australia… (para familias o grupos)' },
  { id: 'p20-5151', name: '6 fotos 5,1x5,1', paper: '15x20', kind: 'grid', pw: 51, ph: 51, cols: 3, rows: 2, landscape: true, price: 14, enabled: true, face: F5151, uso: 'EEUU, India (2x2")' },
  { id: 'p20-3040', name: '18 fotos 3x4', paper: '15x20', kind: 'grid', pw: 30, ph: 40, cols: 6, rows: 3, landscape: true, price: 14, enabled: true, face: F3040, uso: 'Brasil, Colombia, Rusia, Ucrania y otros (3x4 cm)' },
  { id: 'p20-4040', name: '12 fotos 4x4', paper: '15x20', kind: 'grid', pw: 40, ph: 40, cols: 4, rows: 3, landscape: true, price: 14, enabled: true, face: F4040, uso: 'Argentina y otros (4x4 cm)' },
  { id: 'p20-3348', name: '15 fotos 33x48', paper: '15x20', kind: 'grid', pw: 33, ph: 48, cols: 5, rows: 3, landscape: true, price: 15, enabled: true, face: F3348, uso: 'Visado de China' },
  { id: 'p20-5070', name: '6 fotos 5x7', paper: '15x20', kind: 'grid', pw: 50, ph: 70, cols: 3, rows: 2, landscape: true, price: 15, enabled: true, face: F5070, uso: 'Pasaporte de Canadá' },
  { id: 'p20-2632', name: '28 fotos 26x32', paper: '15x20', kind: 'grid', pw: 26, ph: 32, cols: 7, rows: 4, landscape: true, price: 14, enabled: false, face: F2632, uso: 'Documentos que piden 26x32 mm' }
];
export const DEFAULT_ID_OPTIONS = { allowGuides: true, allowBorder: true, guides: true, border: false, faceGuides: true };

export const DEFAULT_ID_LOTS = [
  { id: 'lot4', name: 'Lote 4 fotos', presetId: '', photos: 4, price: 6 },
  { id: 'lot8', name: 'Lote 8 fotos', presetId: '', photos: 8, price: 9 }
];

// ---------- Formatos de archivo ----------
// RAW de cámara: se imprime la vista previa JPEG a tamaño completo que la cámara guarda dentro del archivo.
export const RAW_EXT = ['.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2', '.orf', '.rw2', '.raf', '.pef', '.srw', '.3fr', '.erf', '.kdc', '.mrw', '.mef', '.iiq', '.rwl', '.x3f'];
export const SUPPORTED_EXT = ['.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.heic', '.heif', '.avif', '.gif', '.pdf', '.tif', '.tiff', ...RAW_EXT];
export const VIDEO_EXT = ['.mp4', '.mov', '.avi', '.mkv', '.3gp', '.m4v', '.wmv', '.webm', '.mts', '.m2ts', '.flv', '.mpg', '.mpeg', '.hevc'];
export const SUPPORTED_LABEL = 'JPEG, PNG, WEBP, HEIC, HEIF, AVIF, GIF, TIFF, PDF y RAW de cámara';

export const extOf = (name) => { const m = /\.[^.\\/]+$/.exec(String(name || '')); return m ? m[0].toLowerCase() : ''; };

/** Primera comprobación por extensión. Devuelve {ok} o {ok:false, reason}. */
export function checkFileName(name) {
  const ext = extOf(name);
  if (SUPPORTED_EXT.includes(ext)) return { ok: true };
  if (VIDEO_EXT.includes(ext)) return { ok: false, reason: `Es un vídeo (${ext}). El kiosco solo imprime fotos.` };
  if (!ext) return { ok: false, reason: 'El archivo no tiene extensión y no se puede identificar.' };
  return { ok: false, reason: `Formato no compatible (${ext}). Formatos admitidos: ${SUPPORTED_LABEL}.` };
}

/** Precio unitario según tramos por cantidad total de ese tamaño. */
export function priceFor(size, totalQty) {
  let p = Number(size?.price) || 0;
  for (const t of [...(size?.tiers || [])].sort((a, b) => a.from - b.from)) if (totalQty >= t.from) p = Number(t.price);
  return p;
}

export const DEFAULT_SHEETS = [
  { id: '10x15', name: '10 x 15 cm', w: 102, h: 152 },
  { id: '13x18', name: '13 x 18 cm', w: 127, h: 178 },
  { id: 'A4', name: 'A4', w: 210, h: 297 }
];

export const DEFAULT_SETTINGS = {
  schema: 6, // = SETTINGS_SCHEMA
  storeName: 'Pizarro',
  // Tamaños que se ven directamente en la zona de selección; el resto, en «Más tamaños».
  quickSizes: ['9x13', '10x15', '13x18', '15x20', '20x30', 'A4'],
  // Al elegir un tamaño de «Más tamaños»: 'temporary' (solo para este cliente) o 'permanent' (queda en la lista rápida).
  otherSizeMode: 'temporary',
  currency: '€',
  adminPin: '1234',
  kioskMode: false,
  idleSeconds: 180,
  dpi: 300,
  printSizes: DEFAULT_PRINT_SIZES,
  idPresets: DEFAULT_ID_PRESETS,
  sheets: DEFAULT_SHEETS,
  idDefaults: { sheetId: '10x15', gapMm: 2, marginMm: 3, guides: 'marks', faceGuides: true },
  idLots: DEFAULT_ID_LOTS,
  idLotTypes: DEFAULT_ID_LOT_TYPES,
  // Impresora de todos los lotes de un papel ('10x15', '15x20'). Cada lote puede tener la suya (lot.printers).
  lotPrinters: { '10x15': [], '15x20': [] },
  // Por impresora: gestión de color (sRGB o perfil ICC, correcciones) y rollo cargado (contador de papel).
  printerCfg: {},
  // Impresora simulada para pruebas: los tamaños sin impresora que admite una DNP DS620 se «imprimen» como JPEG en una carpeta.
  simPrinter: { enabled: true, folder: '' },
  // Fotos de los pedidos: se guardan 30 días salvo que el cliente pida que se borren.
  keepPhotosDefault: true,
  // PIN de caja (3 cifras aleatorias por pedido): 'off', 'all' (todo) o 'custom' (copias, carnet o tamaños concretos).
  pin: { mode: 'all', prints: true, idlots: true, sizes: [] },
  // Ticket para pagar en caja. printer vacío = se guarda en PDF (pruebas). Se envía al servidor para Gestión Pizarro.
  ticket: { enabled: true, printer: '', ivaPct: 21, header: '', footer: 'Gracias por tu visita' },
  idOptions: DEFAULT_ID_OPTIONS,
  ordersRetentionDays: 30,
  // Datos del responsable para la información RGPD y el aviso legal de la pantalla de inicio.
  legal: { company: '', nif: '', address: '', email: '', phone: '', dpo: '', registry: '' },
  upload: { port: 8787, wifiSsid: '', wifiPassword: '', wifiType: 'WPA' },
  shareFolders: [],
  // «Mi galería» (solo personal, con PIN): entradas de red permitidas. 'gallery', 'server' y 'share:<ruta>'.
  galleryNet: ['gallery', 'server'],
  // Letras (Administración → Letras): programa y títulos por un lado, mensajes de la pantalla de espera por otro.
  fonts: DEFAULT_FONTS,
  // Copia de seguridad: días (0 = domingo) y franja, partes, completa o incremental, carpeta del servidor y 15 días.
  backup: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '14:00', to: '16:00', parts: { settings: true, orders: true, stats: true, masks: true }, mode: 'incremental', folder: '', keepDays: 15, fullEvery: 7 },
  // Verificación tras 5 PIN erróneos: app de autenticación en el móvil de la empresa (TOTP) y/o código por correo (SMTP).
  security: { totpEnabled: false, totpSecret: '', email: '', smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: '' } },
  bluetoothInbox: 'C:\\KioscoPizarro\\Bluetooth',
  showFixedDrives: false,
  email: { enabled: false, address: '', host: '', port: 993, secure: true, user: '', pass: '', pollSeconds: 20 },
  lab: { mode: 'http', serverUrl: 'http://localhost:4000', kioskKey: '', folder: '' },
  // Qué se hace al confirmar un pedido: imprimir en el kiosco y/o enviar una copia al servidor.
  // Si el servidor no responde, se guarda en localFallback y se reintenta cada pocos minutos.
  delivery: { print: true, server: false, serverFolder: 'Laboratorio', localFallback: 'C:\\KioscoPizarro\\Pendientes', retryMinutes: 5 },
  defaultBorderMm: 5,
  masks: { activeEventMask: '' }
};

export function money(v, currency = '€') {
  return `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} ${currency}`;
}

// ---------- Código de color por tamaño (miniaturas y leyenda) ----------
// Tonos que combinan con la paleta Pizarro y se distinguen bien entre sí.
export const SIZE_COLORS = ['#C9B29A', '#6B7055', '#4F7CA6', '#B5654A', '#8E6FA8', '#2F8C7C', '#C79A2E', '#A84C6E', '#5E6B7A', '#7FA35A', '#D07F3E', '#3F5E8C'];
export function sizeColor(sizes, id) {
  const s = sizes.find((z) => z.id === id);
  if (s?.color) return s.color;
  const i = sizes.findIndex((z) => z.id === id);
  return SIZE_COLORS[(i < 0 ? 0 : i) % SIZE_COLORS.length];
}

/** Versión de la estructura de ajustes; al subirla, config.js añade lo nuevo a instalaciones existentes. */
export const SETTINGS_SCHEMA = 6;

// ---------- Texto y escritura a mano sobre la copia ----------
// Fuentes de Windows: así la vista previa (Chromium) y la impresión (canvas) usan exactamente la misma letra.
export const OVERLAY_FONTS = [
  { id: 'mano', name: 'Manuscrita', family: 'Segoe Script', file: 'segoesc.ttf' },
  { id: 'rotulador', name: 'Rotulador', family: 'Ink Free', file: 'Inkfree.ttf' },
  { id: 'carta', name: 'Carta', family: 'Segoe Print', file: 'segoepr.ttf' },
  { id: 'clasica', name: 'Clásica', family: 'Georgia', file: 'georgia.ttf' },
  { id: 'moderna', name: 'Moderna', family: 'Segoe UI Light', file: 'segoeuil.ttf' }
];
export const OVERLAY_COLORS = ['#333333', '#0F2740', '#ffffff', '#B5654A', '#6B7055', '#C9B29A', '#A84C6E'];
export const hasOverlay = (o) => !!(o && ((o.texts && o.texts.length) || (o.strokes && o.strokes.length)));

/**
 * Salida de un tamaño: 'print' (imprimir aquí), 'server' (enviar al servidor) o 'both'.
 * Si el tamaño tiene 'auto' (o nada), sigue los ajustes generales de Impresión y envío.
 */
export const SIZE_OUTPUTS = [['auto', 'Según ajustes generales'], ['print', 'Imprimir'], ['server', 'Enviar al servidor'], ['both', 'Imprimir y enviar']];
export function sizeOutput(size, settings) {
  const o = size?.out;
  if (o === 'print' || o === 'server' || o === 'both') return o;
  const d = settings?.delivery || {};
  const pr = d.print !== false, sv = !!d.server;
  return pr && sv ? 'both' : sv ? 'server' : pr ? 'print' : 'none';
}

/** Formatos de papel de la DNP DS620 (mm, en vertical): 9x13, 10x15, 13x18, 15x20, 15x23 y la tira 5x15. */
export const DS620_MEDIA = [[89, 127], [102, 152], [127, 178], [152, 203], [152, 229], [51, 152]];
export function ds620Supports(wMm, hMm) {
  const a = Math.min(wMm, hMm), b = Math.max(wMm, hMm);
  return DS620_MEDIA.some(([w, h]) => Math.abs(w - a) <= 3 && Math.abs(h - b) <= 3);
}

/** Valida un tamaño importado. Devuelve un texto de error o ''. */
export function sizeProblem(z) {
  const num = (v, a, b) => Number.isFinite(Number(v)) && Number(v) >= a && Number(v) <= b;
  if (!z || typeof z.id !== 'string' || !z.id.trim()) return 'falta el identificador';
  if (typeof z.name !== 'string' || !z.name.trim()) return 'falta el nombre';
  if (!num(z.w, 10, 1500) || !num(z.h, 10, 1500)) return 'medidas no válidas';
  if (!num(z.price ?? 0, 0, 100000)) return 'precio no válido';
  if (z.tiers != null && (!Array.isArray(z.tiers) || z.tiers.some((t) => !num(t?.from, 1, 1e6) || !num(t?.price, 0, 100000)))) return 'tramos de precio no válidos';
  if (z.color != null && !/^#[0-9a-f]{6}$/i.test(z.color)) return 'color no válido';
  if (z.out != null && !SIZE_OUTPUTS.some(([k]) => k === z.out)) return 'salida no válida';
  if (z.card != null) {
    const c = z.card, W = Math.min(z.w, z.h);
    if (!num(c.h, 10, Math.max(z.w, z.h)) || !c.win || !num(c.win.x, 0, W) || !num(c.win.y, 0, c.h) || !num(c.win.w, 5, W) || !num(c.win.h, 5, c.h) || c.win.x + c.win.w > W + 0.01 || c.win.y + c.win.h > c.h + 0.01) return 'formato Polaroid no válido';
  }
  return '';
}
