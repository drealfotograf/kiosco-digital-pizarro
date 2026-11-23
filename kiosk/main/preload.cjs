const { contextBridge, ipcRenderer } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

const channels = ['session', 'drives', 'phone-progress', 'email-status', 'order-progress', 'toast', 'settings', 'import-issue', 'roll-add', 'print:retry', 'print:retry-ok', 'print:failed', 'print:queue', 'printers:discovered'];

contextBridge.exposeInMainWorld('kiosk', {
  call,
  on(channel, cb) {
    if (!channels.includes(channel)) throw new Error('Canal no permitido');
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  }
});
