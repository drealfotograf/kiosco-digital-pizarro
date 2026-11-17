import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Dentro del instalador los scripts van desempaquetados fuera del .asar.
const script = path.join(here, '..', 'scripts', 'mtp.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const psArgs = (extra) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, ...extra];

export function listPhones() {
  return new Promise((resolve) => {
    execFile('powershell.exe', psArgs(['-Mode', 'list']), { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return resolve([]);
      try { const r = JSON.parse(stdout.trim() || '[]'); resolve(Array.isArray(r) ? r : [r]); } catch { resolve([]); }
    });
  });
}

let current = null;

/** Copia fotos del móvil a dest. onEvent recibe {total}|{done,total,file}|{error} */
export function copyFromPhone(device, dest, max, onEvent) {
  cancelPhoneCopy();
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', psArgs(['-Mode', 'copy', '-Device', device, '-Dest', dest, '-Max', String(max)]), { windowsHide: true });
    current = child;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch { /* línea no JSON */ }
      }
    });
    child.on('close', (code) => { if (current === child) current = null; resolve(code); });
  });
}

export function cancelPhoneCopy() { if (current) { current.kill(); current = null; } }
