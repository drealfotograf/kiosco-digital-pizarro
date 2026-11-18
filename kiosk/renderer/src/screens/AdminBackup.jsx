import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon, Modal } from '../components/ui.jsx';

const DAYS = [[1, 'L'], [2, 'M'], [3, 'X'], [4, 'J'], [5, 'V'], [6, 'S'], [0, 'D']];
const DEF = { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '14:00', to: '16:00', parts: { settings: true, orders: true, stats: true, masks: true }, mode: 'incremental', folder: '', keepDays: 15, fullEvery: 7 };
const size = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round((b || 0) / 1e3)} kB`).replace('.', ',');
const when = (iso) => new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Ajustes → Copia de seguridad: programación, partes, completa o incremental, carpeta del servidor, restaurar y configuración completa. */
export default function AdminBackup({ s, set, pin, pick, toast, dirty, setS }) {
  const b = { ...DEF, ...(s.backup || {}), parts: { ...DEF.parts, ...(s.backup?.parts || {}) } };
  const sb = (k, v) => set('backup', { ...b, [k]: v });
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState('');
  const [restore, setRestore] = useState(null); // { name, parts:Set }
  const [secrets, setSecrets] = useState(false);
  const [reset, setReset] = useState(false);
  const load = () => api('admin:backupStatus', pin).then(setInfo).catch((e) => toast({ type: 'error', text: e.message }));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const st = info?.status || {};
  const partLabel = info?.parts || { settings: 'Ajustes', orders: 'Pedidos y fotos', stats: 'Estadísticas', masks: 'Máscaras' };

  const run = async (mode) => {
    setBusy('Haciendo la copia de seguridad…');
    try { const r = await api('admin:backupRun', pin, mode); toast({ type: 'ok', text: `Copia ${r.lastMode}: ${r.lastCopied} archivo(s) copiados (${size(r.lastBytes)})` }); }
    catch (e) { toast({ type: 'error', text: e.message }); }
    setBusy(''); load();
  };
  const doRestore = async () => {
    setBusy('Restaurando…');
    try {
      const r = await api('admin:backupRestore', pin, restore.name, [...restore.parts]);
      toast({ type: 'ok', text: `Restaurados ${r.restored} archivo(s)` });
      setRestore(null);
      setS(await api('admin:settings', pin));
    } catch (e) { toast({ type: 'error', text: e.message }); }
    setBusy('');
  };
  const exportAll = async () => {
    try { const r = await api('admin:sectionExport', pin, 'all', { secrets }); if (r) toast({ type: 'ok', text: `Configuración exportada a ${r.path}` }); } catch (e) { toast({ type: 'error', text: e.message }); }
  };
  const importAll = async () => {
    try { const r = await api('admin:sectionImport', pin, 'all'); if (r) { setS(await api('admin:settings', pin)); toast({ type: 'ok', text: 'Configuración completa importada y guardada' }); } } catch (e) { toast({ type: 'error', text: e.message }); }
  };

  return (
    <>
      <h2>Copia de seguridad</h2>
      <div className={`card col bk-status ${st.lastOk === false ? 'bad' : ''}`}>
        {st.lastRun
          ? <span><b>Última copia:</b> {when(st.lastRun)} · {st.lastOk ? `${st.lastMode}, ${st.lastCopied} archivo(s) copiados de ${st.lastFiles} (${size(st.lastBytes)})` : <span style={{ color: 'var(--err)' }}>falló: {st.lastError}</span>}</span>
          : <span className="muted">Todavía no se ha hecho ninguna copia.</span>}
        {!b.folder && <span style={{ color: 'var(--err)' }}>Elige la carpeta del servidor: sin ella no se hacen copias.</span>}
        <div className="row">
          <button className="btn primary" disabled={!!busy || dirty || !b.folder} onClick={() => run()}><Icon name="check" size={18} /> Hacer copia ahora</button>
          <button className="btn" disabled={!!busy || dirty || !b.folder} onClick={() => run('full')}>Copia completa ahora</button>
          {dirty && <span className="muted small">Guarda los cambios antes de copiar</span>}
          {busy && <span className="row small" style={{ gap: 8 }}><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> {busy}</span>}
        </div>
      </div>

      <div className="card col" style={{ maxWidth: 1000 }}>
        <label className="row deliv-opt" style={{ gap: 12 }}>
          <input type="checkbox" checked={!!b.enabled} onChange={(e) => sb('enabled', e.target.checked)} style={{ width: 28, height: 28 }} />
          <span className="col" style={{ gap: 2 }}><b>Copia automática</b><span className="muted small">Se hace una vez al día dentro de la franja, los días marcados. Si falla, lo vuelve a intentar cada 15 minutos dentro de la franja.</span></span>
        </label>
        <div className="form">
          <label>Días</label>
          <div className="row" style={{ gap: 6 }}>{DAYS.map(([d, l]) => {
            const on = b.days.includes(d);
            return <button key={d} className={`chip sm bk-day ${on ? 'on' : ''}`} onClick={() => sb('days', on ? b.days.filter((x) => x !== d) : [...b.days, d])}>{l}</button>;
          })}<button className="btn sm" onClick={() => sb('days', [0, 1, 2, 3, 4, 5, 6])}>Todos</button></div>
          <label>Franja horaria</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>De <input className="inp" type="time" style={{ width: 130 }} value={b.from} onChange={(e) => sb('from', e.target.value)} /> a <input className="inp" type="time" style={{ width: 130 }} value={b.to} onChange={(e) => sb('to', e.target.value)} /></div>
          <label>Qué copiar</label>
          <div className="row" style={{ gap: 14 }}>
            <button className="btn sm" onClick={() => sb('parts', { settings: true, orders: true, stats: true, masks: true })}>Todo el kiosco</button>
            {Object.entries(partLabel).map(([k, l]) => <label key={k} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!b.parts[k]} onChange={(e) => sb('parts', { ...b.parts, [k]: e.target.checked })} style={{ width: 22, height: 22 }} />{l}</label>)}
          </div>
          <label>Tipo de copia</label>
          <div className="col" style={{ gap: 4 }}>
            <div className="seg" style={{ maxWidth: 520 }}>
              <button className={b.mode === 'incremental' ? 'on' : ''} onClick={() => sb('mode', 'incremental')}>Incremental (solo lo que cambia)</button>
              <button className={b.mode === 'full' ? 'on' : ''} onClick={() => sb('mode', 'full')}>Completa</button>
            </div>
            {b.mode === 'incremental' && <span className="muted small">Cada {b.fullEvery || 7} días se hace una completa automáticamente, para que las copias no dependan de una muy antigua.</span>}
          </div>
          <label>Carpeta del servidor</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="inp" value={b.folder} onChange={(e) => sb('folder', e.target.value)} placeholder={'\\\\SERVIDOR\\Copias'} />
            <button className="btn sm" onClick={() => pick('backup.folder')}>Elegir</button>
          </div>
          <label>Conservar</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input className="inp" type="number" min="1" max="365" style={{ width: 110 }} value={b.keepDays} onChange={(e) => sb('keepDays', Math.max(1, Number(e.target.value) || 15))} /><span className="muted">días; después se borra la más antigua</span></div>
        </div>
      </div>

      <div className="card col" style={{ maxWidth: 1000 }}>
        <b>Copias guardadas</b>
        {!info?.list?.length && <span className="muted small">No hay copias en la carpeta elegida.</span>}
        {info?.list?.length > 0 && (
          <table className="t">
            <thead><tr><th>Fecha</th><th>Tipo</th><th>Partes</th><th className="n">Archivos</th><th className="n">Copiado</th><th /></tr></thead>
            <tbody>{[...info.list].reverse().map((c) => (
              <tr key={c.name}>
                <td>{when(c.at)}</td><td>{c.mode}{c.base ? <div className="muted small">sobre {c.base.slice(0, 10)}</div> : null}</td>
                <td className="small">{Object.entries(c.parts || {}).filter(([, v]) => v).map(([k]) => partLabel[k]).join(', ')}</td>
                <td className="n">{c.files}</td><td className="n">{c.copied} · {size(c.bytes)}</td>
                <td><button className="btn sm" onClick={() => setRestore({ name: c.name, at: c.at, parts: new Set(Object.entries(c.parts || {}).filter(([, v]) => v).map(([k]) => k)) })}>Restaurar…</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card col" style={{ maxWidth: 1000 }}>
        <b>Toda la configuración del programa</b>
        <span className="muted small">Exporta en un archivo todos los ajustes y configuraciones (tamaños, tarifas, impresoras, lotes, letras, envío, seguridad…) para restaurar el kiosco tal como está ahora o copiarlo a otro.</span>
        <div className="row">
          <button className="btn" disabled={dirty} onClick={exportAll}><Icon name="download" size={18} /> Exportar configuración</button>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={secrets} onChange={(e) => setSecrets(e.target.checked)} /> Incluir contraseñas y claves (guarda el archivo en un sitio seguro)</label>
        </div>
        <div className="row">
          <button className="btn" disabled={dirty} onClick={importAll}><Icon name="plus" size={18} /> Importar configuración</button>
          {!reset ? <button className="btn danger" onClick={() => setReset(true)}>Volver a los ajustes de fábrica</button>
            : <><span className="small" style={{ color: 'var(--err)' }}>Se pierden tamaños, tarifas y ajustes propios (se conservan el PIN, las claves y las copias).</span>
              <button className="btn danger" onClick={async () => { try { await api('admin:factoryReset', pin); setS(await api('admin:settings', pin)); setReset(false); toast({ type: 'ok', text: 'Ajustes de fábrica restaurados' }); } catch (e) { toast({ type: 'error', text: e.message }); } }}>Sí, restablecer</button>
              <button className="btn" onClick={() => setReset(false)}>No</button></>}
        </div>
      </div>

      {restore && (
        <Modal onClose={() => setRestore(null)}>
          <h2 style={{ margin: 0, fontWeight: 400 }}>Restaurar la copia del {when(restore.at)}</h2>
          <p className="muted" style={{ margin: 0 }}>Los archivos de las partes marcadas se sustituyen por los de la copia. La programación y la carpeta de copias actuales se conservan.</p>
          <div className="col" style={{ gap: 8 }}>
            {Object.entries(partLabel).map(([k, l]) => (
              <label key={k} className="row" style={{ gap: 8 }}><input type="checkbox" checked={restore.parts.has(k)} onChange={() => { const n = new Set(restore.parts); n.has(k) ? n.delete(k) : n.add(k); setRestore({ ...restore, parts: n }); }} style={{ width: 22, height: 22 }} />{l}</label>
            ))}
          </div>
          <div className="row"><div className="spacer" /><button className="btn" onClick={() => setRestore(null)}>Cancelar</button><button className="btn danger" disabled={!restore.parts.size || !!busy} onClick={doRestore}>Restaurar</button></div>
        </Modal>
      )}
    </>
  );
}
