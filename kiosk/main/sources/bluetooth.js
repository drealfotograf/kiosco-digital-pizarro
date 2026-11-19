import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings } from '../config.js';
import { walkFiles } from '../images.js';

// Windows recibe archivos por Bluetooth con el asistente "fsquirt" (Recibir archivos).
// Configura en el asistente la carpeta de destino = carpeta "bluetoothInbox" de los ajustes.
let btProc = null;

export function openBluetoothReceiver() {
  if (btProc && !btProc.killed) return { ok: true, already: true };
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'fsquirt.exe');
  if (!fs.existsSync(exe)) return { ok: false, error: 'Este equipo no tiene Bluetooth disponible.' };
  btProc = spawn(exe, ['-receive'], { detached: true, stdio: 'ignore' });
  btProc.on('exit', () => { btProc = null; });
  btProc.unref();
  return { ok: true };
}

export function closeBluetoothReceiver() {
  if (!btProc || btProc.killed) return;
  try { process.kill(btProc.pid); } catch {}
  btProc = null;
}

export function bluetoothInbox() {
  const dir = getSettings().bluetoothInbox;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Fotos recibidas desde que empezó la sesión. */
export async function recentBluetoothFiles(since) {
  const files = await walkFiles(bluetoothInbox(), { maxDepth: 2, max: 500 });
  // La fecha de creación indica cuándo llegó el archivo (la de modificación puede ser la original de la foto).
  return files.filter((f) => {
    try { const st = fs.statSync(f.path); return Math.max(st.birthtimeMs, st.mtimeMs) >= since - 60_000; } catch { return false; }
  });
}
