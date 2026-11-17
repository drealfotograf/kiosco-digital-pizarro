export const api = (ch, ...args) => window.kiosk.call(ch, ...args);
export const on = (ch, cb) => window.kiosk.on(ch, cb);
export const fileUrl = (p) => `kimg://f/file?p=${encodeURIComponent(p)}`;
export const thumbUrl = (p, s = 360, page = 0) => `kimg://f/thumb?p=${encodeURIComponent(p)}&s=${s}${page ? `&pg=${page}` : ''}`;
