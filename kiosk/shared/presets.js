// Datos compartidos entre el proceso principal y la interfaz.
// Todas las medidas en milímetros, siempre en vertical (ancho <= alto).

export const DEFAULT_PRINT_SIZES = [
  { id: '9x13', name: '9 x 13 cm', w: 89, h: 127, price: 0.3, printers: [], useDriverPaper: false },
  { id: '10x15', name: '10 x 15 cm', w: 102, h: 152, price: 0.35, printers: [], useDriverPaper: false },
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
  ordersRetentionDays: 30,
  upload: { port: 8787, wifiSsid: '', wifiPassword: '', wifiType: 'WPA' },
  shareFolders: [],
  bluetoothInbox: 'C:\\KioscoPizarro\\Bluetooth',
  showFixedDrives: false,
  email: { enabled: false, address: '', host: '', port: 993, secure: true, user: '', pass: '', pollSeconds: 20 },
  lab: { mode: 'http', serverUrl: 'http://localhost:4000', kioskKey: '', folder: '' },
  masks: { activeEventMask: '' }
};

export function money(v, currency = '€') {
  return `${(Math.round(v * 100) / 100).toFixed(2).replace('.', ',')} ${currency}`;
}
