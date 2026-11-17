import { execFile } from 'node:child_process';
import { getSettings } from '../config.js';

// Detecta unidades extraíbles (USB, tarjetas SD/CF) consultando WMI cada pocos segundos.
let timer = null;
let last = '[]';

function query() {
  return new Promise((resolve) => {
    const cmd = 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,Size,FreeSpace | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) return resolve([]);
      try {
        let list = JSON.parse(stdout || '[]');
        if (!Array.isArray(list)) list = [list];
        const sys = (process.env.SystemDrive || 'C:').toUpperCase();
        const showFixed = getSettings().showFixedDrives;
        resolve(list
          .filter((d) => d.Size && (d.DriveType === 2 || (showFixed && d.DriveType === 3 && d.DeviceID.toUpperCase() !== sys)))
          .map((d) => ({ id: d.DeviceID, root: d.DeviceID + '\\', label: d.VolumeName || (d.DriveType === 2 ? 'Memoria USB / Tarjeta' : 'Disco'), size: d.Size, removable: d.DriveType === 2 })));
      } catch { resolve([]); }
    });
  });
}

export async function listDrives() { return query(); }

export function watchDrives(onChange) {
  stopWatchingDrives();
  const tick = async () => {
    const drives = await query();
    const json = JSON.stringify(drives);
    if (json !== last) { last = json; onChange(drives); }
  };
  tick();
  timer = setInterval(tick, 3000);
}

export function stopWatchingDrives() { if (timer) clearInterval(timer); timer = null; last = '[]'; }
