import React, { useEffect, useState } from 'react';
import { api, on, thumbUrl } from '../api.js';
import { Icon, TouchField } from '../components/ui.jsx';
import { checkFileName } from '../../../shared/presets.js';

const SOURCES = [
  { id: 'usb', icon: 'usb', label: 'USB o tarjeta de memoria' },
  { id: 'wifi', icon: 'wifi', label: 'Móvil por WiFi (QR)' },
  { id: 'cable', icon: 'phone', label: 'Móvil por cable' },
  { id: 'bt', icon: 'bt', label: 'Bluetooth' },
  { id: 'email', icon: 'mail', label: 'Correo electrónico' },
  { id: 'server', icon: 'server', label: 'Carpeta del servidor' },
  { id: 'share', icon: 'folder', label: 'Carpeta de red' },
  { id: 'gallery', icon: 'lock', label: 'Mi galería privada' }
];

/**
 * Elegir el origen de las fotos. Al elegirlo se cargan todos sus archivos (con vista previa de baja calidad)
 * y se pasa a la zona de selección. onLoad(files, origin) → número de fotos añadidas.
 */
/**
 * Entradas de red de «Mi galería» (solo personal), elegidas en Ajustes: 'gallery' (galerías del servidor),
 * 'server' (carpeta del servidor) y 'share:<ruta>' (cada carpeta de red). Devuelve los ids de fuente visibles.
 */
export function galleryNetSources(settings) {
  const g = settings.galleryNet || ['gallery', 'server'];
  const ids = [];
  if (g.includes('gallery') && settings.lab?.serverUrl) ids.push('gallery');
  if (g.includes('server') && settings.lab?.serverUrl) ids.push('server');
  if (g.some((x) => x.startsWith('share:') && (settings.shareFolders || []).some((f) => `share:${f.path}` === x))) ids.push('share');
  return ids;
}

export default function Sources({ session, settings, flow, roll, initial = 'usb', only = null, onLoad, onBack, onNext, backLabel = 'Cancelar' }) {
  const [src, setSrc] = useState(initial);
  const [loading, setLoading] = useState('');
  const shares = settings.shareFolders || [];
  // Con «only» (Mi galería) solo se ven esas entradas de red; si no, todas menos la galería, que es solo del personal.
  const visible = only
    ? SOURCES.filter((s) => only.includes(s.id))
    : SOURCES.filter((s) => s.id !== 'gallery' && (s.id !== 'share' || shares.length) && (s.id !== 'email' || settings.email.enabled) && (s.id !== 'server' || settings.lab.serverUrl));
  const allowedShares = only ? (settings.galleryNet || []).filter((x) => x.startsWith('share:')).map((x) => x.slice(6)) : null;

  const load = async (getFiles, origin) => {
    setLoading('Buscando fotos…');
    try {
      const files = await getFiles();
      setLoading(`Cargando ${files.length} archivo${files.length === 1 ? '' : 's'}…`);
      const n = await onLoad(files, origin);
      if (n > 0) onNext();
      else if (!files.length) setLoading('');
    } finally { setLoading(''); }
  };

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn" onClick={onBack}><Icon name="back" /> {backLabel}</button>
        <h1>{only ? 'Mi galería · entradas de red' : flow === 'id' ? 'Fotos carnet · ¿De dónde sacamos la foto?' : '¿Dónde están tus fotos?'}</h1>
      </div>
      <div className="content" style={{ overflow: 'hidden' }}>
        <div className="sources">
          <div className="source-list">
            {visible.map((s) => (
              <button key={s.id} className={`source-btn ${src === s.id ? 'on' : ''}`} onClick={() => setSrc(s.id)}>
                <span className="ico"><Icon name={s.icon} /></span>{s.label}
              </button>
            ))}
          </div>
          <div className="panel">
            {src === 'usb' && <UsbPanel load={load} />}
            {src === 'wifi' && <WifiPanel roll={roll} onNext={onNext} />}
            {src === 'cable' && <CablePanel load={load} />}
            {src === 'bt' && <BluetoothPanel load={load} />}
            {src === 'email' && <EmailPanel session={session} roll={roll} onNext={onNext} />}
            {src === 'server' && <ServerPanel load={load} />}
            {src === 'share' && <SharePanel load={load} allowed={allowedShares} />}
            {src === 'gallery' && <GalleryPanel load={load} />}
          </div>
        </div>
      </div>
      <div className="footerbar">
        <div className="tray">
          {roll.slice(-14).map((e) => <div className="t" key={e.key}><img src={e.thumb} alt="" /></div>)}
        </div>
        <b>{roll.length} foto{roll.length === 1 ? '' : 's'}</b>
        <button className="btn primary lg" disabled={!roll.length} onClick={onNext}>Ver mis fotos <Icon name="next" /></button>
      </div>
      {loading && (
        <div className="modal"><div className="sheet" style={{ width: 460, alignItems: 'center', textAlign: 'center' }}>
          <div className="spinner" /><div className="big" style={{ fontSize: 22 }}>{loading}</div>
        </div></div>
      )}
    </div>
  );
}

const localFiles = (list) => list.map((f) => ({ path: f.path, name: f.name }));

/**
 * Archivos de la carpeta abierta en miniatura. Tocar marca o desmarca.
 * Importar: las seleccionadas, todas las de esta carpeta, o todas incluidas las subcarpetas.
 */
function FilePicker({ files, subfolders, onImport, onImportAll, onImportDeep }) {
  const ok = files.filter((f) => checkFileName(f.name).ok);
  const bad = files.length - ok.length;
  const [sel, setSel] = useState(() => new Set());
  const [limit, setLimit] = useState(120);
  useEffect(() => { setSel(new Set()); setLimit(120); }, [files]);
  const toggle = (k) => setSel((x) => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const all = sel.size === ok.length && ok.length > 0;
  return (
    <div className="fp col">
      <div className="fp-bar">
        <div className="col" style={{ gap: 2 }}>
          <b>{ok.length} foto{ok.length === 1 ? '' : 's'} en esta carpeta{sel.size ? ` · ${sel.size} seleccionada${sel.size === 1 ? '' : 's'}` : ''}</b>
          <span className="small muted">{subfolders ? `${subfolders} subcarpeta${subfolders === 1 ? '' : 's'} · ` : ''}{bad ? `${bad} archivo${bad === 1 ? '' : 's'} no compatible${bad === 1 ? '' : 's'} · ` : ''}Toca las fotos para elegirlas</span>
        </div>
        <div className="row fp-acts">
          {ok.length > 0 && <button className="btn" onClick={() => setSel(all ? new Set() : new Set(ok.map((f) => f.key)))}><Icon name="checks" /> {all ? 'Ninguna' : 'Seleccionar todas'}</button>}
          <button className="btn primary" disabled={!sel.size} onClick={() => onImport(ok.filter((f) => sel.has(f.key)))}><Icon name="check" /> Importar seleccionadas{sel.size ? ` (${sel.size})` : ''}</button>
          <button className="btn" disabled={!ok.length} onClick={onImportAll}><Icon name="folder" /> Todas ({ok.length})</button>
          {subfolders > 0 && <button className="btn" onClick={onImportDeep}><Icon name="download" /> Todas + subcarpetas</button>}
        </div>
      </div>
      {ok.length > 0 && (
        <div className="fp-grid">
          {ok.slice(0, limit).map((f) => (
            <button key={f.key} className={`fp-item ${sel.has(f.key) ? 'sel' : ''}`} onClick={() => toggle(f.key)}>
              <span className="fp-img"><img src={f.thumb} alt="" loading="lazy" draggable={false} /><span className="fs-check">{sel.has(f.key) && <Icon name="check" size={16} />}</span></span>
              <span className="fp-name">{f.name}</span>
            </button>
          ))}
          {ok.length > limit && <button className="btn fp-more" onClick={() => setLimit(limit + 240)}>Ver más ({ok.length - limit})</button>}
        </div>
      )}
    </div>
  );
}

/** Navegación por carpetas locales: subcarpetas arriba y archivos de la carpeta abierta para elegir. */
function FolderNav({ root, rootLabel, origin, load }) {
  const [dir, setDir] = useState(root);
  const [data, setData] = useState(null);
  const [sub, setSub] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => { setDir(root); }, [root]);
  const [files, setFiles] = useState(null);
  useEffect(() => {
    setErr(''); setData(null); setFiles(null);
    api('folder:list', dir).then(setData).catch((e) => setErr(e.message));
    api('folder:scan', dir, false).then((l) => setFiles(l.map((f) => ({ key: f.path, name: f.name, path: f.path, thumb: thumbUrl(f.path, 240) })))).catch(() => setFiles([]));
  }, [dir]);
  const rel = dir.slice(root.length).split(/[\\/]/).filter(Boolean);
  const crumbs = [{ label: rootLabel, path: root }];
  let acc = root;
  for (const part of rel) { acc = acc.replace(/[\\/]+$/, '') + '\\' + part; crumbs.push({ label: part, path: acc }); }
  return (
    <div className="col">
      <div className="crumbs">{crumbs.map((c, i) => <React.Fragment key={c.path}>{i > 0 && <span className="muted">›</span>}<button className="btn sm" onClick={() => setDir(c.path)}>{c.label}</button></React.Fragment>)}</div>
      {err && <div className="card" style={{ color: 'var(--err)' }}>{err}</div>}
      {data?.folders.length > 0 && (
        <div className="grid fp-folders">
          {data.folders.map((f) => <div key={f.path} className="folder" onClick={() => setDir(f.path)}><Icon name="folder" /> {f.name}</div>)}
        </div>
      )}
      {(!data || !files) && !err && <div className="empty"><div className="spinner" /></div>}
      {data && files && (
        <FilePicker files={files} subfolders={data.folders.length}
          onImport={(list) => load(async () => localFiles(list), origin)}
          onImportAll={() => load(async () => localFiles(files), origin)}
          onImportDeep={() => load(async () => localFiles(await api('folder:scan', dir, true)), origin)} />
      )}
    </div>
  );
}

function UsbPanel({ load }) {
  const [drives, setDrives] = useState(null);
  const [browse, setBrowse] = useState(null);
  useEffect(() => {
    api('drives:list').then(setDrives);
    api('drives:watch');
    const off = on('drives', setDrives);
    return () => { off(); api('drives:unwatch'); };
  }, []);
  useEffect(() => { if (browse && drives && !drives.find((d) => d.root === browse.root)) setBrowse(null); }, [drives, browse]);
  if (browse) return (<><div className="row"><button className="btn sm" onClick={() => setBrowse(null)}><Icon name="back" size={20} /> Unidades</button><h2>{browse.label}</h2></div><FolderNav root={browse.root} rootLabel={browse.id} origin="USB / Tarjeta" load={load} /></>);
  return (
    <>
      <h2>Memoria USB o tarjeta</h2>
      {!drives?.length && (
        <div className="empty">
          <Icon name="usb" size={72} />
          <div className="big">Inserta tu memoria USB o tarjeta</div>
          <div>Aparecerá aquí automáticamente.</div>
        </div>
      )}
      <div className="tiles">
        {(drives || []).map((d) => (
          <div key={d.id} className="tile" style={{ minHeight: 190 }} onClick={() => load(async () => localFiles(await api('folder:scan', d.root, true)), 'USB / Tarjeta')}>
            <span className="ico"><Icon name="usb" size={36} /></span>
            <h2 style={{ fontSize: 24 }}>{d.label}</h2>
            <p>Unidad {d.id} · {(d.size / 1e9).toFixed(1)} GB · Toca para cargar todas las fotos</p>
            <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={(e) => { e.stopPropagation(); setBrowse(d); }}><Icon name="folder" size={18} /> Elegir carpeta</button>
          </div>
        ))}
      </div>
    </>
  );
}

function WifiPanel({ roll, onNext }) {
  const [info, setInfo] = useState(null);
  useEffect(() => { api('upload:info').then(setInfo); }, []);
  const got = roll.filter((e) => e.origin === 'Móvil (WiFi)').length;
  if (!info) return <div className="empty"><div className="spinner" /></div>;
  return (
    <>
      <h2>Envía las fotos desde tu móvil</h2>
      <div className="steps">
        {info.ssid && (
          <div className="step col" style={{ alignItems: 'center' }}>
            <b>1</b><div>Conéctate a la WiFi <strong>{info.ssid}</strong></div>
            <img className="qr" src={info.wifiQr} alt="QR WiFi" style={{ width: 200, height: 200 }} />
          </div>
        )}
        <div className="step col" style={{ alignItems: 'center' }}>
          <b>{info.ssid ? 2 : 1}</b><div>Escanea este código con la cámara</div>
          <img className="qr" src={info.qr} alt="QR para subir fotos" />
          <div className="muted small mono">{info.url}</div>
        </div>
        <div className="step col">
          <b>{info.ssid ? 3 : 2}</b>
          <div>Pulsa <strong>Elegir fotos</strong> y selecciona las que quieras. Aparecerán en el kiosco al momento.</div>
          <p className="muted small" style={{ margin: 0 }}>Funciona en Android y iPhone, sin instalar nada.</p>
          {got > 0 && <><div className="big" style={{ color: 'var(--ok)' }}>✔ {got} recibida{got === 1 ? '' : 's'}</div><button className="btn primary" onClick={onNext}>Ver mis fotos</button></>}
        </div>
      </div>
    </>
  );
}

function CablePanel({ load }) {
  const [phones, setPhones] = useState(null);
  const [searching, setSearching] = useState(false);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState('');
  const search = async () => { setSearching(true); setErr(''); setPhones(await api('phone:list')); setSearching(false); };
  useEffect(() => { search(); const off = on('phone-progress', (ev) => { if (ev.error) setErr(ev.error); else setProg(ev); }); return () => { off(); api('phone:cancel'); }; }, []);
  const copy = async (name) => {
    setErr(''); setProg({ done: 0, total: 0 });
    try {
      const dest = await api('phone:copy', name);
      setProg(null);
      await load(async () => localFiles(await api('folder:scan', dest, true)), 'Móvil (cable)');
    } catch (e) { setErr(e.message); setProg(null); }
  };
  return (
    <>
      <h2>Conecta tu móvil con el cable</h2>
      <div className="steps">
        <div className="step"><b>1</b>Conecta el cable USB y <strong>desbloquea</strong> el móvil.</div>
        <div className="step"><b>2</b><strong>Android:</strong> en el aviso USB elige «Transferencia de archivos».<br /><strong>iPhone:</strong> pulsa «Confiar».</div>
        <div className="step"><b>3</b>Toca tu móvil para cargar sus fotos más recientes.</div>
      </div>
      {err && <div className="card" style={{ color: 'var(--err)' }}>{err}</div>}
      {prog && (
        <div className="card col">
          <div>Copiando fotos… {prog.total ? `${prog.done} de ${prog.total}` : 'buscando'}</div>
          <div className="progress"><i style={{ width: prog.total ? `${(prog.done / prog.total) * 100}%` : '5%' }} /></div>
          <div className="muted small">No desconectes el móvil.</div>
        </div>
      )}
      {!prog && (
        <>
          <div className="row"><button className="btn" onClick={search} disabled={searching}>{searching ? 'Buscando…' : 'Buscar de nuevo'}</button></div>
          {phones && !phones.length && <div className="empty">No se detecta ningún móvil todavía.</div>}
          <div className="tiles">
            {(phones || []).map((p) => (
              <button key={p.name} className="tile" style={{ minHeight: 150 }} onClick={() => copy(p.name)}>
                <span className="ico"><Icon name="phone" size={36} /></span><h2 style={{ fontSize: 24 }}>{p.name}</h2>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BluetoothPanel({ load }) {
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const tick = () => api('bt:recent').then((f) => setFiles((old) => (old.length === f.length ? old : f))).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);
  const open = async () => { const r = await api('bt:open'); setMsg(r.ok ? 'Recepción activada. Envía las fotos desde tu móvil a este equipo.' : r.error); };
  return (
    <>
      <h2>Recibir por Bluetooth</h2>
      <div className="steps">
        <div className="step"><b>1</b>Pulsa <strong>Activar recepción</strong>.</div>
        <div className="step"><b>2</b>En tu móvil: Compartir → Bluetooth → elige este kiosco.</div>
        <div className="step"><b>3</b>Cuando terminen de llegar, pulsa <strong>Cargar</strong>.</div>
      </div>
      <div className="row"><button className="btn" onClick={open}><Icon name="bt" /> Activar recepción</button><span className="muted">{msg}</span></div>
      <div className="load-bar">
        <b>{files.length ? `${files.length} archivo${files.length === 1 ? '' : 's'} recibido${files.length === 1 ? '' : 's'}` : 'Esperando archivos…'}</b>
        <button className="btn primary lg" disabled={!files.length} onClick={() => load(async () => localFiles(files), 'Bluetooth')}><Icon name="download" /> Cargar</button>
      </div>
    </>
  );
}

function EmailPanel({ session, roll, onNext }) {
  const [st, setSt] = useState(null);
  useEffect(() => { api('email:status').then(setSt); return on('email-status', (s) => setSt((o) => ({ ...o, ...s }))); }, []);
  const got = roll.filter((e) => e.origin === 'Correo electrónico').length;
  if (!st) return null;
  return (
    <>
      <h2>Envíanos tus fotos por correo</h2>
      <div className="steps">
        <div className="step"><b>1</b>Escribe a<div className="big" style={{ fontSize: 24, wordBreak: 'break-all' }}>{st.address}</div></div>
        <div className="step"><b>2</b>Pon este código en el <strong>asunto</strong>:<div className="big mono" style={{ fontSize: 44 }}>{session?.code}</div></div>
        <div className="step"><b>3</b>Adjunta las fotos y envía. Llegarán aquí en unos segundos.</div>
      </div>
      <div className="card row"><div className="spinner" style={{ width: 28, height: 28, borderWidth: 4 }} /> {st.text}
        {got > 0 && <><div className="spacer" /><b style={{ color: 'var(--ok)' }}>✔ {got} recibida{got === 1 ? '' : 's'}</b><button className="btn primary" onClick={onNext}>Ver mis fotos</button></>}
      </div>
    </>
  );
}

function SharePanel({ load, allowed = null }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(null);
  useEffect(() => { api('share:list').then((l) => setList(allowed ? l.filter((f) => allowed.includes(f.path)) : l)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (open) return (<><div className="row"><button className="btn sm" onClick={() => setOpen(null)}><Icon name="back" size={20} /> Carpetas</button><h2>{open.name}</h2></div><FolderNav root={open.path} rootLabel={open.name} origin="Carpeta de red" load={load} /></>);
  return (
    <>
      <h2>Carpetas compartidas</h2>
      <div className="tiles">
        {list.map((f) => (
          <button key={f.path} className="tile" style={{ minHeight: 150 }} disabled={!f.available} onClick={() => setOpen(f)}>
            <span className="ico"><Icon name="folder" size={36} /></span><h2 style={{ fontSize: 24 }}>{f.name}</h2>
            <p>{f.available ? f.path : 'No disponible ahora'}</p>
          </button>
        ))}
      </div>
    </>
  );
}

const remoteFiles = (files) => files.map((f) => ({ remote: { kind: 'srvshare', path: f.path }, name: f.name, thumb: f.thumb, preview: f.preview }));

/** Carpeta compartida del servidor de la tienda: acceso libre, sin contraseña. */
function ServerPanel({ load }) {
  const [rel, setRel] = useState('');
  const [data, setData] = useState(null);
  const [sub, setSub] = useState(true);
  const [err, setErr] = useState('');
  useEffect(() => { setErr(''); setData(null); api('srvshare:list', rel, false).then(setData).catch((e) => setErr(e.message)); }, [rel]);
  const parts = rel.split('/').filter(Boolean);
  const imgs = data ? data.files.filter((f) => checkFileName(f.name).ok).length : 0;
  return (
    <>
      <h2>Carpeta del servidor</h2>
      <p className="muted" style={{ margin: 0 }}>Fotos que el estudio ha dejado para ti en el servidor de la tienda. Acceso libre, sin contraseña.</p>
      <div className="crumbs">
        <button className="btn sm" onClick={() => setRel('')}>Inicio</button>
        {parts.map((p, i) => <React.Fragment key={i}><span className="muted">›</span><button className="btn sm" onClick={() => setRel(parts.slice(0, i + 1).join('/'))}>{p}</button></React.Fragment>)}
      </div>
      {err && <div className="card" style={{ color: 'var(--err)' }}>{err}</div>}
      {data && (
        <>
          {data.folders.length > 0 && (
            <div className="grid fp-folders">
              {data.folders.map((f) => <div key={f.path} className="folder" onClick={() => setRel(f.path)}><Icon name="folder" /> {f.name}</div>)}
            </div>
          )}
          <FilePicker files={data.files.map((f) => ({ ...f, key: f.path }))} subfolders={data.folders.length}
            onImport={(list) => load(async () => remoteFiles(list), 'Carpeta del servidor')}
            onImportAll={() => load(async () => remoteFiles(data.files), 'Carpeta del servidor')}
            onImportDeep={() => load(async () => remoteFiles((await api('srvshare:list', rel, true)).files), 'Carpeta del servidor')} />
        </>
      )}
      {!data && !err && <div className="empty"><div className="spinner" /></div>}
    </>
  );
}

function GalleryPanel({ load }) {
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const login = async () => {
    setBusy(true); setErr('');
    try {
      const g = await api('gallery:login', code.trim().toUpperCase(), pass);
      await load(async () => g.photos.map((p) => ({ remote: { kind: 'gallery', id: p.id, token: g.token }, name: p.name, thumb: p.thumbUrl, preview: p.previewUrl })), `Galería: ${g.title}`);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <>
      <h2>Accede a tu galería privada</h2>
      <p className="muted" style={{ margin: 0 }}>Introduce el código y la contraseña que te dio el estudio.</p>
      <div className="col" style={{ maxWidth: 820 }}>
        <TouchField value={code} onChange={setCode} placeholder="Código de galería" layout="code" upper autoFocus maxLength={12} />
        <TouchField value={pass} onChange={setPass} placeholder="Contraseña" layout="text" secret />
        {err && <div style={{ color: 'var(--err)' }}>{err}</div>}
        <button className="btn primary lg" disabled={!code || !pass || busy} onClick={login}><Icon name="lock" /> Entrar</button>
      </div>
    </>
  );
}
