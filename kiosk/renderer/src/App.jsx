import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, on, fileUrl, thumbUrl } from './api.js';
import Home from './screens/Home.jsx';
import Sources from './screens/Sources.jsx';
import Studio from './screens/Studio.jsx';
import IdPhoto from './screens/IdPhoto.jsx';
import IdLots from './screens/IdLots.jsx';
import Checkout, { Done, AwaitPin } from './screens/Checkout.jsx';
import Admin from './screens/Admin.jsx';
import { Modal, Icon, TouchField, Busy } from './components/ui.jsx';
import { checkFileName, extOf } from '../../shared/presets.js';
import { DEFAULT_EDIT, landOf } from './screens/Studio.jsx';
import { galleryNetSources } from './screens/Sources.jsx';
import { fontStack } from '../../shared/fonts.js';

function applyFonts(f = {}) {
  const r = document.documentElement.style;
  r.setProperty('--font-ui', fontStack(f.ui || 'Montserrat'));
  r.setProperty('--font-head', fontStack(f.headings || f.ui || 'Montserrat'));
  // Tamaños independientes: letra de todo el programa y tamaño de menús y barras.
  r.setProperty('--fs', String(Math.min(1.6, Math.max(0.7, Number(f.fontScale) || 1))));
  r.setProperty('--ms', String(Math.min(1.6, Math.max(0.7, Number(f.menuScale) || 1))));
}

const freshId = (s) => ({ presetId: null, custom: { w: 35, h: 45 }, people: [], sheetId: s.idDefaults.sheetId, gapMm: s.idDefaults.gapMm, marginMm: s.idDefaults.marginMm, guides: s.idDefaults.guides, faceGuides: s.idDefaults.faceGuides, separateSheets: false });

/** Elemento del carrete: archivo local, remoto (servidor/galería) o foto ya importada. */
function entryFrom(f, origin) {
  if (f.photo) return { key: `p:${f.photo.id}`, name: f.photo.name, origin, photo: f.photo, thumb: fileUrl(f.photo.thumb), preview: fileUrl(f.photo.preview) };
  if (f.remote) return { key: `r:${f.remote.kind}:${f.remote.path || f.remote.id}`, name: f.name, origin, remote: f.remote, thumb: f.thumb, preview: f.preview };
  const pg = f.page || 0;
  return { key: `l:${f.path.toLowerCase()}${pg ? `#${pg}` : ''}`, name: f.name, origin, path: f.path, page: pg, thumb: thumbUrl(f.path, 360, pg), preview: thumbUrl(f.path, 1600, pg) };
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [screen, setScreen] = useState('home');
  const [flow, setFlow] = useState('prints');
  const [initialSource, setInitialSource] = useState('usb');
  const [session, setSession] = useState(null);
  const [roll, setRoll] = useState([]);
  const [items, setItems] = useState([]);
  const [edits, setEdits] = useState({}); // por foto: filtro, color, giro, marco, encuadre y recorte por tamaño
  const [idState, setIdState] = useState(null);
  const [idLots, setIdLots] = useState([]);
  const [netOnly, setNetOnly] = useState(null); // Mi galería: solo las entradas de red permitidas
  const [spec, setSpec] = useState(null);
  const [orderOpts, setOrderOpts] = useState({});
  const [result, setResult] = useState(null);
  const [adminPin, setAdminPin] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [idleWarn, setIdleWarn] = useState(0);
  const [issues, setIssues] = useState([]);
  const [holdOpen, setHoldOpen] = useState(null);
  const [busy, setBusy] = useState('');
  const lastTouch = useRef(Date.now());
  const toastTimer = useRef(null);
  const rollRef = useRef(roll);
  const editsRef = useRef(edits);
  const itemsRef = useRef(items);
  // Estadísticas de la sesión del cliente (anónimas): inicio, fuentes usadas y si hizo pedido.
  const statRef = useRef(null);
  rollRef.current = roll;
  editsRef.current = edits;
  itemsRef.current = items;

  const toast = useCallback((t) => {
    setToastMsg(t);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);

  /** Aviso de archivo no válido. Devuelve una promesa que se resuelve al confirmar ('ok' | 'skipAll'). */
  const askIssue = useCallback((issue) => new Promise((resolve) => setIssues((l) => [...l, { ...issue, resolve }])), []);

  /**
   * Carga archivos en el carrete. Primero comprueba la extensión de cada uno; si no es válida
   * muestra el aviso, espera la confirmación y continúa con los siguientes.
   */
  const loadIntoRoll = useCallback(async (files, origin) => {
    if (statRef.current && origin) statRef.current.sources.add(String(origin));
    let quiet = false;
    const added = [];
    const have = new Set(rollRef.current.map((e) => e.key));
    for (const f of files) {
      if (!f.photo) {
        const chk = checkFileName(f.name);
        if (!chk.ok) {
          if (!quiet && (await askIssue({ name: f.name, reason: chk.reason, origin, canSkip: true })) === 'skipAll') quiet = true;
          continue;
        }
      }
      // PDF: cada página es una foto del carrete (los remotos se descargan antes).
      if (!f.photo && extOf(f.name) === '.pdf') {
        try {
          const path = f.remote ? await api('roll:fetch', f.remote) : f.path;
          const n = await api('pdf:pages', path);
          for (let p = 1; p <= n; p++) {
            const e = entryFrom({ path, page: p, name: n > 1 ? `${f.name} · pág. ${p}/${n}` : f.name }, origin);
            if (!have.has(e.key)) { have.add(e.key); added.push(e); }
          }
        } catch (err) {
          if (!quiet && (await askIssue({ name: f.name, reason: err.message || 'El PDF está dañado o protegido.', origin, canSkip: true })) === 'skipAll') quiet = true;
        }
        continue;
      }
      const e = entryFrom(f, origin);
      if (have.has(e.key)) continue;
      have.add(e.key);
      added.push(e);
    }
    if (added.length) setRoll((r) => [...r, ...added]);
    else if (files.length) toast({ type: 'error', text: 'No se ha encontrado ninguna foto compatible' });
    return added.length;
  }, [askIssue, toast]);

  /** Importa (copia el original y crea vistas previas) un elemento del carrete cuando entra en el pedido. */
  const ensurePhoto = useCallback(async (e) => {
    if (e.photo) return e.photo;
    // Copia virtual: comparte el original con su foto de origen.
    if (e.virtualOf) {
      const src = rollRef.current.find((x) => x.key === e.virtualOf);
      const p = src && (await ensurePhotoRef.current(src));
      if (p) setRoll((r) => r.map((x) => (x.key === e.key ? { ...x, photo: p } : x)));
      return p || null;
    }
    try {
      const [photo] = await api('roll:import', [{ path: e.path, page: e.page, remote: e.remote, name: e.name, origin: e.origin }]);
      if (!photo) { setRoll((r) => r.filter((x) => x.key !== e.key)); return null; }
      setRoll((r) => r.map((x) => (x.key === e.key ? { ...x, photo } : x)));
      return photo;
    } catch (err) { toast({ type: 'error', text: err.message }); return null; }
  }, [toast]);
  const ensurePhotoRef = useRef(ensurePhoto);
  ensurePhotoRef.current = ensurePhoto;

  /** Copia virtual: nueva entrada del carrete con el mismo original y ajustes independientes (parte de los actuales). */
  const virtualCopy = (e) => {
    const base = e.virtualOf || e.key;
    let n = 1;
    while (rollRef.current.some((x) => x.key === `v${n}:${base}`)) n++;
    const key = `v${n}:${base}`;
    const src = rollRef.current.find((x) => x.key === base) || e;
    setRoll((r) => {
      const i = r.findIndex((x) => x.key === e.key);
      const v = { ...src, key, virtualOf: base, name: `${src.name} · copia ${n}` };
      return [...r.slice(0, i + 1), v, ...r.slice(i + 1)];
    });
    setEdits((all) => (all[e.key] ? { ...all, [key]: JSON.parse(JSON.stringify(all[e.key])) } : all));
    toast({ type: 'ok', text: 'Copia virtual creada: puedes encuadrarla y editarla por separado' });
  };
  const removeVirtual = (e) => {
    setRoll((r) => r.filter((x) => x.key !== e.key));
    setItems((l) => l.filter((i) => i.rollKey !== e.key));
    setEdits((all) => { const n = { ...all }; delete n[e.key]; return n; });
  };

  useEffect(() => {
    api('settings:public').then(setSettings);
    const offs = [
      on('session', setSession), on('toast', toast), on('settings', setSettings),
      on('import-issue', (i) => setIssues((l) => [...l, { ...i, resolve: () => {} }])),
      on('roll-add', ({ files, origin }) => loadIntoRoll(files, origin)),
      // Reimpresión automática: avisa al personal cuando la impresora falla y se reintenta
      on('print:retry', (d) => toast({ type: 'error', text: `⚠️ ${d.printer}: error al imprimir ${d.file}. Reintento ${d.attempt}/${d.maxRetries} en ${d.nextRetryIn} s…` })),
      on('print:retry-ok', (d) => toast({ type: 'ok', text: `✅ ${d.printer}: reimpresión correcta de ${d.file} (intento ${d.attempt})` })),
      on('print:failed', (d) => toast({ type: 'error', text: `❌ ${d.printer}: no se pudo imprimir ${d.file} tras varios intentos. Revisa la impresora.` })),
      on('printers:discovered', (list) => toast({ type: 'ok', text: `🖨️ Nueva(s) impresora(s): ${list.map((p) => p.displayName).join(', ')}` }))
    ];
    return () => offs.forEach((f) => f());
  }, [toast, loadIntoRoll]);

  const finish = useCallback(async (reason) => {
    const st = statRef.current;
    statRef.current = null;
    if (st) api('stats:session', { start: st.start, photos: rollRef.current.length, sources: [...st.sources], flow: st.flow, ordered: st.ordered, reason: reason === 'idle' ? 'idle' : 'user' }).catch(() => {});
    await api('session:clear');
    setRoll([]); setItems([]); setEdits({}); setIdLots([]); setNetOnly(null); setSpec(null); setResult(null); setIdleWarn(0); setOrderOpts({}); setIssues([]);
    setScreen('home');
  }, []);

  // Inactividad: aviso y vuelta al inicio borrando las fotos del cliente.
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now(); setIdleWarn(0); };
    window.addEventListener('pointerdown', touch, true);
    const t = setInterval(() => {
      if (!settings || ['home', 'admin'].includes(screen) || busy) return;
      const idle = (Date.now() - lastTouch.current) / 1000;
      const limit = Math.max(30, settings.idleSeconds || 180);
      if (idle > limit + 20) finish('idle');
      else if (idle > limit) setIdleWarn(Math.ceil(limit + 20 - idle));
    }, 1000);
    return () => { window.removeEventListener('pointerdown', touch, true); clearInterval(t); };
  }, [settings, screen, finish, busy]);

  const start = async (f, src = 'usb', opts = {}) => {
    await api('session:new');
    statRef.current = { start: new Date().toISOString(), sources: new Set(), flow: f, ordered: false };
    setNetOnly(opts.netOnly || null);
    setFlow(f); setInitialSource(src); setItems([]); setEdits({}); setRoll([]); setIdLots([]); setOrderOpts({});
    setIdState(freshId(settings));
    setScreen('sources');
  };

  /** Abre un pedido guardado (retenido o para reprocesar) con todos sus ajustes. */
  const openOrder = (o, opts) => {
    const entries = o.photos.map((p) => entryFrom({ photo: p }, p.origin || 'Pedido guardado'));
    // Las copias virtuales se vuelven a crear a partir de su foto de origen.
    for (const it of o.spec.items || []) {
      if (!it.vc) continue;
      const base = `p:${it.photoId}`;
      const key = `${it.vc}:${base}`;
      const src = entries.find((e) => e.key === base);
      if (src && !entries.some((e) => e.key === key)) entries.splice(entries.indexOf(src) + 1, 0, { ...src, key, virtualOf: base, name: `${src.name} · copia ${it.vc.slice(1)}` });
    }
    setRoll(entries);
    setOrderOpts(opts);
    setFlow(o.kind === 'id' || o.spec?.kind === 'idlots' ? 'id' : 'prints');
    if (o.spec?.kind === 'idlots') {
      setIdLots(o.spec.lots.map((l, i) => ({ ...l, uid: `o${i}`, rollKey: `p:${l.photoId}` })));
      setScreen('idlots');
    } else if (o.kind === 'id') {
      setIdState({ ...freshId(settings), ...o.spec, people: o.spec.people.map((p) => ({ ...p, rollKey: `p:${p.photoId}` })) });
      setScreen('id');
    } else {
      // Se reconstruyen las copias por tamaño y los ajustes de cada foto.
      const ed = {};
      for (const it of o.spec.items) {
        const rk = it.vc ? `${it.vc}:p:${it.photoId}` : `p:${it.photoId}`;
        const cur = ed[rk] || {
          ...DEFAULT_EDIT, adjust: it.adjust || DEFAULT_EDIT.adjust, angle: (it.angle || 0) - (it.rot || 0), rot: it.rot || 0, mask: it.mask || '', mode: it.mode || 'fill', bg: it.bg || '#ffffff',
          border: !!it.border, borderMm: it.borderMm || 5, borderColor: it.borderColor || '#ffffff', roundCorners: !!it.roundCorners, frameLine: !!it.frameLine, overlay: it.overlay || { texts: [], strokes: [] }, crops: {}, fits: {}, land: {}
        };
        cur.crops[it.sizeId] = it.crop || null;
        cur.fits[it.sizeId] = it.fit || null;
        cur.land[it.sizeId] = !!it.landscape;
        ed[rk] = cur;
      }
      setEdits(ed);
      setItems(o.spec.items.map((it, i) => ({ key: `r${i}`, rollKey: it.vc ? `${it.vc}:p:${it.photoId}` : `p:${it.photoId}`, photoId: it.photoId, sizeId: it.sizeId, qty: it.qty })));
      setScreen('studio');
    }
  };

  const resume = async (code) => {
    setBusy('Recuperando tu pedido…');
    try { const o = await api('order:resume', code); openOrder(o, { resumeOf: o.code }); return true; } finally { setBusy(''); }
  };

  /** Desde el inicio: nº de ticket + PIN de caja → se imprime el pedido pagado. */
  const pinRelease = async (ticketNo, pin) => {
    const o = await api('order:findAwaiting', ticketNo);
    if (!o) throw new Error('No hay ningún pedido pendiente de pago con ese número.');
    setBusy('Imprimiendo tu pedido…');
    try {
      const r = await api('order:release', o.orderNo, pin);
      setResult({ ...r, paid: true }); setScreen('done');
    } finally { setBusy(''); }
  };

  /** Mi galería (personal): solo las entradas de red que el administrador ha elegido. */
  const openGallery = () => {
    const allowed = galleryNetSources(settings);
    if (!allowed.length) { toast({ type: 'error', text: 'No hay ninguna entrada de red para «Mi galería». Elígela en Ajustes → Fuentes de fotos.' }); return; }
    start('prints', allowed[0], { netOnly: allowed });
  };

  const hold = async (customer) => {
    setBusy('Guardando tu pedido…');
    try {
      const r = await api('order:hold', holdOpen, customer, orderOpts.resumeOf);
      setHoldOpen({ done: r.code });
    } catch (e) { toast({ type: 'error', text: e.message }); setHoldOpen(null); }
    setBusy('');
  };

  if (!settings) return null;
  // Letras elegidas en Administración → Letras (programa y títulos; los mensajes van aparte en la pantalla de espera).
  applyFonts(settings.fonts);
  // Modo oscuro
  document.documentElement.setAttribute('data-theme', settings.darkMode ? 'dark' : 'light');
  // Fotos de carnet: lotes nuevos; los pedidos antiguos por formato se siguen abriendo en su pantalla.
  const idScreen = idState?.people?.length ? 'id' : 'idlots';
  const issue = issues[0];
  const closeIssue = (answer) => { issue.resolve(answer); setIssues((l) => l.slice(1)); };
  /** Especificación del pedido: lee de refs para capturar siempre el último encuadre. */
  const printSpec = () => ({
    kind: 'prints',
    items: itemsRef.current.map((it) => {
      const ed = { ...DEFAULT_EDIT, ...(editsRef.current[it.rollKey] || {}) };
      const ph = rollRef.current.find((e) => e.key === it.rollKey)?.photo;
      const size = settings.printSizes.find((s) => s.id === it.sizeId);
      const ov = ed.overlay || {};
      const vc = it.rollKey.startsWith('v') ? it.rollKey.split(':')[0] : undefined;
      return {
        photoId: it.photoId, sizeId: it.sizeId, qty: it.qty, mode: ed.mode, bg: ed.bg, mask: ed.mask, adjust: ed.adjust, angle: (ed.rot || 0) + (ed.angle || 0), rot: ed.rot || 0,
        crop: ed.crops[it.sizeId] || null, fit: ed.mode === 'fit' ? ed.fits?.[it.sizeId] || null : null,
        landscape: landOf(ed, size, ph),
        border: !size?.card && !!ed.border, borderMm: ed.borderMm || 5, borderColor: ed.borderColor || '#ffffff', roundCorners: !!ed.roundCorners, frameLine: !!ed.frameLine, round: !!size?.round,
        overlay: ov.texts?.length || ov.strokes?.length ? ov : null,
        ...(vc ? { vc, name: rollRef.current.find((e) => e.key === it.rollKey)?.name } : {})
      };
    })
  });

  return (
    <>
      {screen === 'home' && <Home settings={settings} onStart={start} onResume={resume} onPinRelease={pinRelease} onGallery={openGallery} onAdmin={(pin) => { setAdminPin(pin); setScreen('admin'); }} />}
      {screen === 'sources' && (
        <Sources session={session} settings={settings} flow={flow} roll={roll} initial={netOnly ? netOnly[0] : initialSource} only={netOnly} onLoad={loadIntoRoll}
          backLabel={roll.length ? 'Volver a mis fotos' : 'Cancelar'}
          onBack={() => (roll.length ? setScreen(flow === 'id' ? idScreen : 'studio') : finish())}
          onNext={() => setScreen(flow === 'id' ? idScreen : 'studio')} />
      )}
      {screen === 'studio' && (
        <Studio settings={settings} roll={roll} items={items} setItems={setItems} edits={edits} setEdits={setEdits} ensurePhoto={ensurePhoto} toast={toast}
          onVirtualCopy={virtualCopy} onRemoveVirtual={removeVirtual}
          onAddMore={() => { setInitialSource('usb'); setScreen('sources'); }}
          onHold={() => setHoldOpen(printSpec())}
          onCancel={finish}
          onNext={() => { setSpec(printSpec()); setScreen('checkout'); }} />
      )}
      {screen === 'id' && idState && (
        <IdPhoto settings={settings} roll={roll} ensurePhoto={ensurePhoto} state={idState} setState={setIdState}
          onBack={finish} onAddMore={() => setScreen('sources')} onHold={(s) => setHoldOpen(s)}
          onNext={(s) => { setSpec(s); setScreen('checkout'); }} />
      )}
      {screen === 'idlots' && (
        <IdLots settings={settings} roll={roll} ensurePhoto={ensurePhoto} lots={idLots} setLots={setIdLots}
          onBack={finish} onAddMore={() => setScreen('sources')} onHold={(s) => setHoldOpen(s)}
          onNext={(s) => { setSpec(s); setScreen('checkout'); }} />
      )}
      {screen === 'checkout' && spec && (
        <Checkout settings={settings} spec={spec} roll={roll} orderOpts={orderOpts} onBack={() => setScreen(spec.kind === 'idlots' ? 'idlots' : spec.kind === 'id' ? 'id' : 'studio')}
          onDone={(r) => { if (statRef.current) statRef.current.ordered = true; setResult(r); setScreen(r.awaiting ? 'await' : 'done'); }} />
      )}
      {screen === 'await' && result && <AwaitPin result={result} settings={settings} onFinish={finish} onReleased={(r) => { setResult({ ...r, paid: true }); setScreen('done'); }} />}
      {screen === 'done' && result && <Done result={result} settings={settings} onFinish={finish} />}
      {screen === 'admin' && adminPin && (
        <Admin pin={adminPin} toast={toast} onExit={() => { setAdminPin(null); setScreen('home'); }}
          onReprocess={(o) => { setAdminPin(null); openOrder(o, { reprocessOf: o.orderNo }); }} />
      )}

      {issue && (
        <Modal>
          <div className="row"><span className="logo" style={{ width: 52, height: 52, background: 'var(--err)' }}><Icon name="close" size={26} /></span>
            <h2 style={{ margin: 0 }}>No se puede cargar este archivo</h2></div>
          <div className="issue-file">{issue.name}</div>
          <p style={{ fontSize: 19, margin: 0 }}><b>Motivo:</b> {issue.reason}</p>
          <p className="muted" style={{ margin: 0 }}>Se omite este archivo y se continúa con los siguientes.{issues.length > 1 ? ` Quedan ${issues.length - 1} aviso(s).` : ''}</p>
          <div className="row"><div className="spacer" />
            {issue.canSkip && <button className="btn" onClick={() => { issues.forEach((i) => i.canSkip && i.resolve('skipAll')); setIssues((l) => l.filter((i) => !i.canSkip)); }}>No avisar más en esta carga</button>}
            <button className="btn primary lg" onClick={() => closeIssue('ok')}>Entendido, continuar</button>
          </div>
        </Modal>
      )}

      {holdOpen && <HoldModal state={holdOpen} onCancel={() => setHoldOpen(null)} onSave={hold} onDone={() => { setHoldOpen(null); finish(); }} />}
      {busy && <Busy text={busy} />}
      {idleWarn > 0 && (
        <Modal>
          <h2 style={{ margin: 0 }}>¿Sigues ahí?</h2>
          <p style={{ fontSize: 20, margin: 0 }}>Por tu privacidad, en {idleWarn} segundos se borrarán tus fotos y volveremos al inicio. Si quieres continuar más tarde, pulsa «Guardar para después».</p>
          <div className="row"><div className="spacer" /><button className="btn primary lg" onClick={() => { lastTouch.current = Date.now(); setIdleWarn(0); }}>Sigo aquí</button></div>
        </Modal>
      )}
      {toastMsg && <div className={`toast ${toastMsg.type || ''}`}>{toastMsg.text}</div>}
    </>
  );
}

function HoldModal({ state, onCancel, onSave, onDone }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  if (state.done) {
    return (
      <Modal>
        <h2 style={{ margin: 0 }}>Pedido guardado</h2>
        <p style={{ fontSize: 19, margin: 0 }}>Para continuar más tarde, en la pantalla de inicio pulsa <b>«Continuar un pedido»</b> e introduce este código:</p>
        <div className="code-big">{state.done}</div>
        <p className="muted" style={{ margin: 0 }}>Haz una foto a este código. Tus fotos y ajustes se conservan durante 30 días.</p>
        <div className="row"><div className="spacer" /><button className="btn primary lg" onClick={onDone}>Terminar</button></div>
      </Modal>
    );
  }
  return (
    <Modal onClose={onCancel}>
      <h2 style={{ margin: 0 }}>Guardar para continuar después</h2>
      <p className="muted" style={{ margin: 0 }}>Se guardan tus fotos con todos los ajustes. Te daremos un código para recuperarlo.</p>
      <TouchField value={name} onChange={setName} placeholder="Nombre (opcional)" />
      <TouchField value={phone} onChange={setPhone} placeholder="Teléfono (opcional)" layout="num" maxLength={15} />
      <div className="row"><div className="spacer" /><button className="btn" onClick={onCancel}>Cancelar</button><button className="btn primary lg" onClick={() => onSave({ name: name.trim(), phone: phone.trim() })}>Guardar</button></div>
    </Modal>
  );
}
