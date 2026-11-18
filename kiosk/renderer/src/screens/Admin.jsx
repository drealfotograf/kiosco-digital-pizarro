import React, { useEffect, useState } from 'react';
import { api, fileUrl } from '../api.js';
import { Icon } from '../components/ui.jsx';
import AdminOrders from './AdminOrders.jsx';
import AdminStats from './AdminStats.jsx';
import AdminTariffs from './AdminTariffs.jsx';
import AdminTools from './AdminTools.jsx';
import AdminBackup from './AdminBackup.jsx';
import AdminPrinterStatus from './AdminPrinterStatus.jsx';
import LotPreview from '../components/LotPreview.jsx';
import { FONT_CHOICES, DEFAULT_FONTS, fontStack } from '../../../shared/fonts.js';
import { QUOTES } from '../components/Quotes.jsx';
import { sizeColor, DEFAULT_ID_OPTIONS, SIZE_OUTPUTS, sizeOutput, ds620Supports } from '../../../shared/presets.js';

const TABS = [
  ['orders', 'Pedidos'], ['stats', 'Estadísticas'], ['general', 'General'], ['fonts', 'Letras'], ['print', 'Impresión y envío'], ['sizes', 'Tamaños'], ['printers', 'Impresoras'], ['tariffs', 'Tarifas'], ['lots', 'Lotes de carnet'],
  ['sources', 'Fuentes de fotos'], ['lab', 'Laboratorio y galerías'], ['masks', 'Máscaras y eventos'], ['backup', 'Copia de seguridad']
];

const tiersToText = (t = []) => t.map((x) => `${x.from}:${String(x.price).replace('.', ',')}`).join(' | ');
const textToTiers = (txt) => String(txt || '').split('|').map((p) => p.split(':').map((v) => v.trim())).filter((p) => p.length === 2)
  .map(([f, p]) => ({ from: parseInt(f, 10), price: parseFloat(p.replace(',', '.')) })).filter((t) => t.from > 0 && Number.isFinite(t.price));

function TierInput({ value, onChange }) {
  const [txt, setTxt] = useState(tiersToText(value));
  useEffect(() => setTxt(tiersToText(value)), [value]);
  return <input className="inp" placeholder="50:0,30 | 100:0,25" value={txt} onChange={(e) => setTxt(e.target.value)} onBlur={() => onChange(textToTiers(txt))} />;
}

export default function Admin({ pin: initialPin, onExit, toast, onReprocess }) {
  const [pin, setPin] = useState(initialPin);
  const [tab, setTab] = useState('orders');
  const [lotPaperTab, setLotPaperTab] = useState('10x15');
  const [paperAlerts, setPaperAlerts] = useState([]);
  useEffect(() => { api('printers:alerts').then(setPaperAlerts).catch(() => {}); }, [tab]); // Lotes de carnet: pestaña de papel abierta
  const [s, setS] = useState(null);
  const [printers, setPrinters] = useState([]);
  const [masks, setMasks] = useState([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { api('admin:settings', initialPin).then(setS); api('printers:list').then(setPrinters); loadMasks(); }, [initialPin]);
  const loadMasks = () => api('masks:list').then(setMasks);
  const set = (path, value) => {
    setDirty(true);
    setS((old) => {
      const next = structuredClone(old);
      const keys = path.split('.');
      let o = next;
      for (const k of keys.slice(0, -1)) o = o[k];
      o[keys.at(-1)] = value;
      return next;
    });
  };
  const save = async () => {
    try { const saved = await api('admin:save', pin, s); setS(saved); setPin(saved.adminPin); setDirty(false); toast({ type: 'ok', text: 'Ajustes guardados' }); } catch (e) { toast({ type: 'error', text: e.message }); }
  };
  const pick = async (path) => { const d = await api('admin:pickFolder', pin); if (d) set(path, d); };
  if (!s) return <div className="empty"><div className="spinner" /></div>;

  const txt = (path, props = {}) => {
    const v = path.split('.').reduce((o, k) => o?.[k], s);
    return <input className="inp" value={v ?? ''} onChange={(e) => set(path, props.type === 'number' ? Number(e.target.value) : e.target.value)} {...props} />;
  };
  const chk = (path, label) => {
    const v = path.split('.').reduce((o, k) => o?.[k], s);
    return <label className="row" style={{ gap: 8, color: 'var(--ink)' }}><input type="checkbox" checked={!!v} onChange={(e) => set(path, e.target.checked)} style={{ width: 24, height: 24 }} />{label}</label>;
  };
  const listEdit = (key, idx, field, value) => { const arr = structuredClone(s[key]); arr[idx][field] = value; set(key, arr); };

  return (
    <div className="screen">
      <div className="topbar">
        <h1><Icon name="cog" /> Administración</h1>
        {dirty && <span className="muted">Cambios sin guardar</span>}
        <button className="btn primary" onClick={save} disabled={!dirty}>Guardar</button>
        <button className="btn" onClick={onExit}>Volver al kiosco</button>
      </div>
      <div className="admin" style={{ flex: 1, minHeight: 0 }}>
        <nav>
          {TABS.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}{id === 'printers' && paperAlerts.length > 0 && <i className={`nav-dot ${paperAlerts.some((x) => x.level === 'empty') ? 'empty' : 'low'}`} title="Queda poco papel" />}</button>)}
          <div className="spacer" />
          <button className="btn danger" onClick={() => api('admin:quit', pin)}>Cerrar aplicación</button>
        </nav>
        <section>
          <AdminTools key={tab} tab={tab} pin={pin} toast={toast} dirty={dirty} onImported={async () => { setS(await api('admin:settings', pin)); setDirty(false); loadMasks(); }} />
          {tab === 'orders' && <AdminOrders pin={pin} settings={s} toast={toast} onReprocess={onReprocess} />}

          {tab === 'tariffs' && <AdminTariffs s={s} set={set} printers={printers} pin={pin} toast={toast} dirty={dirty} setS={setS} />}

          {tab === 'lots' && (
            <>
              <h2>Lotes de fotos de carnet</h2>
              <p className="muted" style={{ margin: 0 }}>Cada lote es una hoja de 10x15 o de 15x20 con la misma foto. Activa los que se ofrecen en el kiosco, cambia el nombre y el precio por lote. La vista previa muestra cómo se imprime.</p>
              <div className="row">
                <button className="btn" disabled={dirty} title={dirty ? 'Guarda primero' : ''} onClick={async () => {
                  try { const f = await api('idlots:export', pin); if (f) toast({ type: 'ok', text: `Plantillas exportadas a ${f}` }); } catch (e) { toast({ type: 'error', text: e.message }); }
                }}>Exportar plantillas</button>
                <button className="btn" disabled={dirty} title={dirty ? 'Guarda primero' : ''} onClick={async () => {
                  try {
                    const r = await api('idlots:import', pin);
                    if (!r) return;
                    setS(r.settings);
                    const sk = r.summary.skipped;
                    toast({ type: sk.length ? 'error' : 'ok', text: `Plantillas: ${r.summary.added} nuevas, ${r.summary.updated} actualizadas${sk.length ? `, ${sk.length} omitidas (${sk.join('; ')})` : ''}` });
                  } catch (e) { toast({ type: 'error', text: e.message }); }
                }}>Cargar plantillas</button>
                {dirty && <span className="muted small">Guarda los cambios antes de exportar o cargar</span>}
              </div>
              {/* Una pestaña por papel; la elegida ocupa toda la página */}
              <div className="paper-tabs">
                {['10x15', '15x20'].map((p) => {
                  const n = (s.idLotTypes || []).filter((l) => (l.paper || '10x15') === p);
                  return (
                    <button key={p} className={lotPaperTab === p ? 'on' : ''} onClick={() => setLotPaperTab(p)}>
                      <b>Papel {p === '15x20' ? '15 x 20' : '10 x 15'}</b>
                      <span>{n.length} lotes · {n.filter((l) => l.enabled !== false).length} ofrecidos</span>
                    </button>
                  );
                })}
              </div>
              {[lotPaperTab].map((paper) => {
                const lp = s.lotPrinters?.[paper] || [];
                const label = paper === '15x20' ? '15 x 20' : '10 x 15';
                return (
                  <div key={paper} className="col" style={{ gap: 10 }}>
                    <div className="card col" style={{ gap: 6 }}>
                      <span className="small"><b>Impresora de todos los lotes {label}</b> <span className="muted">(si no marcas ninguna, la del tamaño de copia {label} en «Impresoras»)</span></span>
                      <div className="row" style={{ gap: 4 }}>{printers.map((p) => {
                        const on = lp.includes(p.name);
                        return <span key={p.name} className={`pchip ${on ? 'on' : ''}`} onClick={() => set('lotPrinters', { ...(s.lotPrinters || {}), [paper]: on ? lp.filter((x) => x !== p.name) : [...lp, p.name] })}>{p.displayName}</span>;
                      })}</div>
                    </div>
                    <div className="lot-admin">
                      {(s.idLotTypes || []).map((l, i) => ((l.paper || '10x15') !== paper ? null : (
                  <div key={l.id} className={`card col lot-card ${l.enabled === false ? 'off' : ''}`}>
                    <LotPreview lot={l} entry={{ guides: s.idOptions?.guides, border: s.idOptions?.border }} width={220} maxH={140} />
                    <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={l.enabled !== false} onChange={(e) => listEdit('idLotTypes', i, 'enabled', e.target.checked)} style={{ width: 24, height: 24 }} />Ofrecer en el kiosco</label>
                    <input className="inp" value={l.name} onChange={(e) => listEdit('idLotTypes', i, 'name', e.target.value)} />
                    <div className="row" style={{ flexWrap: 'nowrap' }}><span className="muted small" style={{ flex: 1 }}>Código en Gestión</span><input className="inp" style={{ width: 150 }} value={l.code || ''} placeholder={`CARNET-${l.id}`} onChange={(e) => listEdit('idLotTypes', i, 'code', e.target.value.trim())} /></div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}><span className="muted small" style={{ flex: 1 }}>Precio por lote</span><input className="inp" type="number" step="0.5" style={{ width: 110 }} value={l.price} onChange={(e) => listEdit('idLotTypes', i, 'price', Number(e.target.value))} /></div>
                    {l.uso && <span className="small lot-uso" title={`${l.uso} (solo lo ve el personal)`}>Uso: {l.uso}</span>}
                    <label className="col" style={{ gap: 2 }}>
                      <span className="small"><b>Impresora de este lote</b></span>
                      <select className="inp" value={(l.printers || [])[0] || ''} onChange={(e) => listEdit('idLotTypes', i, 'printers', e.target.value ? [e.target.value] : [])}>
                        <option value="">La de su papel</option>
                        {printers.map((p) => <option key={p.name} value={p.name}>{p.displayName}</option>)}
                      </select>
                    </label>
                    <span className="muted small">{l.kind === 'grid+big' ? `${l.cols * l.rows} fotos ${l.pw}x${l.ph} mm + 1 de ${l.big.w}x${l.big.h} mm${l.bigFollows ? ' (mismo encuadre)' : ''}` : `${l.cols * l.rows} fotos ${l.pw}x${l.ph} mm`} · papel {l.landscape === false ? 'vertical' : 'horizontal'}</span>
                    <button className="btn sm danger" style={{ alignSelf: 'flex-start' }} onClick={() => set('idLotTypes', s.idLotTypes.filter((_, j) => j !== i))}><Icon name="trash" size={16} /> Quitar plantilla</button>
                  </div>

                      )))}
                    </div>
                  </div>
                );
              })}
              <h2>Opciones para el cliente</h2>
              <div className="form">
                {(() => { const o = { ...DEFAULT_ID_OPTIONS, ...(s.idOptions || {}) }; const so = (k, v) => set('idOptions', { ...o, [k]: v }); const c = (k, label) => <label className="row" style={{ gap: 8, color: 'var(--ink)' }}><input type="checkbox" checked={!!o[k]} onChange={(e) => so(k, e.target.checked)} style={{ width: 24, height: 24 }} />{label}</label>; return (<>
                  <label>Guías de corte</label><div className="col" style={{ gap: 4 }}>{c('allowGuides', 'El cliente puede activarlas')}{c('guides', 'Activadas de inicio')}</div>
                  <label>Marco de foto</label><div className="col" style={{ gap: 4 }}>{c('allowBorder', 'El cliente puede activarlo')}{c('border', 'Activado de inicio')}</div>
                  <label>Guías de cara</label>{c('faceGuides', 'Mostrar al encuadrar')}
                </>); })()}
              </div>
            </>
          )}

          {tab === 'backup' && <AdminBackup s={s} set={set} pin={pin} pick={pick} toast={toast} dirty={dirty} setS={setS} />}
          {tab === 'stats' && <AdminStats pin={pin} settings={s} toast={toast} />}
          {tab === 'fonts' && <FontSettings s={s} set={set} />}
          {tab === 'general' && <SecuritySettings s={s} set={set} pin={pin} toast={toast} dirty={dirty} />}

          {tab === 'print' && <DeliverySettings s={s} set={set} pin={pin} pick={pick} toast={toast} dirty={dirty} printers={printers} />}

          {tab === 'general' && (
            <>
              <h2>General</h2>
              <div className="form">
                <label>Guardar pedidos y fotos durante (días)</label>{txt('ordersRetentionDays', { type: 'number', min: 1 })}
                <label>Fotos del cliente</label>{chk('keepPhotosDefault', 'Guardarlas por defecto (el cliente puede pedir que se borren en el resumen del pedido)')}
                <label style={{ gridColumn: '1 / -1', marginTop: 10, color: 'var(--navy)' }}>Datos legales (RGPD y aviso legal de la pantalla de inicio)</label>
                <label>Nombre o razón social</label>{txt('legal.company')}
                <label>NIF / CIF</label>{txt('legal.nif')}
                <label>Dirección</label>{txt('legal.address')}
                <label>Correo de contacto</label>{txt('legal.email')}
                <label>Teléfono</label>{txt('legal.phone')}
                <label>Delegado de protección de datos</label>{txt('legal.dpo', { placeholder: 'Opcional' })}
                <label>Registro mercantil</label>{txt('legal.registry', { placeholder: 'Solo si es sociedad' })}
                <label>Nombre de la tienda</label>{txt('storeName')}
                <label>Moneda</label>{txt('currency')}
                <label>PIN de administración</label>{txt('adminPin')}
                <label>Volver al inicio tras (s)</label>{txt('idleSeconds', { type: 'number', min: 30 })}
                <label>Resolución de impresión (ppp)</label>{txt('dpi', { type: 'number', min: 150, max: 600 })}
                <label>Modo oscuro</label>{chk('darkMode', 'Interfaz con colores oscuros (reducir brillo en tiendas con poca luz)')}
                <label>Modo kiosco</label>{chk('kioskMode', 'Pantalla completa bloqueada (requiere reiniciar la app)')}
                <label>«Más tamaños»</label>
                <select className="inp" value={s.otherSizeMode || 'temporary'} onChange={(e) => set('otherSizeMode', e.target.value)}>
                  <option value="temporary">Puntual: el tamaño elegido solo se añade para ese cliente</option>
                  <option value="permanent">Siempre: el tamaño elegido queda en la lista rápida</option>
                </select>
              </div>
            </>
          )}

          {tab === 'sizes' && (
            <>
              <h2>Tamaños de copia</h2>
              <p className="muted" style={{ margin: 0 }}>Medidas, precio, color en la zona de selección y qué se hace con cada tamaño al confirmar el pedido. Las impresoras se asignan en el menú «Impresoras».</p>
              <div className="row">
                <button className="btn" disabled={dirty} title={dirty ? 'Guarda primero' : ''} onClick={async () => {
                  try { const f = await api('sizes:export', pin); if (f) toast({ type: 'ok', text: `Tamaños y tarifas exportados a ${f}` }); } catch (e) { toast({ type: 'error', text: e.message }); }
                }}>Exportar tamaños</button>
                <button className="btn" disabled={dirty} title={dirty ? 'Guarda primero' : ''} onClick={async () => {
                  try {
                    const r = await api('sizes:import', pin);
                    if (!r) return;
                    setS(r.settings);
                    const sk = r.summary.skipped;
                    toast({ type: sk.length ? 'error' : 'ok', text: `Tamaños: ${r.summary.added} nuevos, ${r.summary.updated} actualizados${sk.length ? `, ${sk.length} omitidos (${sk.join('; ')})` : ''}` });
                  } catch (e) { toast({ type: 'error', text: e.message }); }
                }}>Importar tamaños</button>
                <span className="muted small">El archivo lleva medidas, precios, tramos, colores y salida. Las impresoras no se exportan: son de cada kiosco.</span>
              </div>
              <table className="t">
                <thead><tr><th>Color</th><th>Nombre</th><th title="Código de artículo en Gestión Pizarro">Código</th><th>Ancho mm</th><th>Alto mm</th><th>Precio</th><th>Al confirmar el pedido</th><th>Lista rápida</th><th></th></tr></thead>
                <tbody>
                  {s.printSizes.map((z, i) => (
                    <tr key={i}>
                      <td style={{ width: 54 }}><input type="color" value={sizeColor(s.printSizes, z.id)} title="Color de este tamaño en la zona de selección" onChange={(e) => listEdit('printSizes', i, 'color', e.target.value)} style={{ width: 40, height: 36, border: 0, background: 'none' }} /></td>
                      <td><input className="inp" value={z.name} onChange={(e) => listEdit('printSizes', i, 'name', e.target.value)} /></td>
                      <td style={{ width: 120 }}><input className="inp" value={z.code || ''} placeholder={`FOTO-${z.id}`} onChange={(e) => listEdit('printSizes', i, 'code', e.target.value.trim())} /></td>
                      <td style={{ width: 90 }}><input className="inp" type="number" value={z.w} onChange={(e) => listEdit('printSizes', i, 'w', Number(e.target.value))} /></td>
                      <td style={{ width: 90 }}><input className="inp" type="number" value={z.h} onChange={(e) => listEdit('printSizes', i, 'h', Number(e.target.value))} /></td>
                      <td style={{ width: 100 }}><input className="inp" type="number" step="0.05" value={z.price} onChange={(e) => listEdit('printSizes', i, 'price', Number(e.target.value))} /></td>
                      <td style={{ width: 260 }}>
                        <select className="inp" value={z.out || 'auto'} onChange={(e) => listEdit('printSizes', i, 'out', e.target.value)}>
                          {SIZE_OUTPUTS.map(([k, l]) => <option key={k} value={k}>{k === 'auto' ? `${l} (${({ print: 'imprimir', server: 'servidor', both: 'imprimir y enviar', none: 'nada' })[sizeOutput({}, s)]})` : l}</option>)}
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={(s.quickSizes || []).includes(z.id)} title="Se ve directamente en la zona de selección"
                        onChange={(e) => set('quickSizes', e.target.checked ? [...(s.quickSizes || []), z.id] : (s.quickSizes || []).filter((x) => x !== z.id))} /></td>
                      <td><button className="btn sm danger" onClick={() => set('printSizes', s.printSizes.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <button className="btn" onClick={() => set('printSizes', [...s.printSizes, { id: `s${Date.now()}`, name: 'Nuevo tamaño', w: 100, h: 150, price: 0.5, printers: [], useDriverPaper: false, out: 'auto' }])}><Icon name="plus" /> Añadir tamaño</button>
              </div>
            </>
          )}

          {tab === 'printers' && <AdminPrinterStatus pin={pin} printers={printers} setPrinters={setPrinters} toast={toast} s={s} set={set} save={save} dirty={dirty} />}
          {tab === 'sources' && (
            <>
              <h2>Mi galería (solo personal)</h2>
              <p className="muted" style={{ margin: 0 }}>Se abre con el icono de galería de la pantalla de inicio y el PIN de seguridad. Solo puede cargar fotos de las entradas de red que marques aquí (una o varias).</p>
              <div className="card col" style={{ maxWidth: 900, gap: 8 }}>
                {[['gallery', 'Galerías privadas del servidor', !s.lab?.serverUrl], ['server', 'Carpeta compartida del servidor', !s.lab?.serverUrl],
                  ...(s.shareFolders || []).map((f) => [`share:${f.path}`, `Carpeta de red: ${f.name} (${f.path})`, false])].map(([k, l, off]) => {
                  const g = s.galleryNet || ['gallery', 'server'];
                  const on = g.includes(k);
                  return (
                    <label key={k} className="row" style={{ gap: 10, opacity: off ? 0.5 : 1 }}>
                      <input type="checkbox" checked={on} onChange={() => set('galleryNet', on ? g.filter((x) => x !== k) : [...g, k])} style={{ width: 24, height: 24 }} />
                      {l}{off && <span className="muted small"> · falta la dirección del servidor</span>}
                    </label>
                  );
                })}
                {!(s.shareFolders || []).length && <span className="muted small">Para usar carpetas de red, añádelas más abajo en «Carpetas compartidas».</span>}
              </div>
              <h2>WiFi del kiosco (QR)</h2>
              <div className="form">
                <label>Nombre de la red (SSID)</label>{txt('upload.wifiSsid')}
                <label>Contraseña WiFi</label>{txt('upload.wifiPassword')}
                <label>Seguridad</label>
                <select className="inp" value={s.upload.wifiType} onChange={(e) => set('upload.wifiType', e.target.value)}><option>WPA</option><option>WEP</option><option value="nopass">Abierta</option></select>
                <label>Puerto de subida</label>{txt('upload.port', { type: 'number' })}
              </div>
              <p className="muted small">El móvil del cliente debe estar en la misma red que el kiosco. La primera vez Windows pedirá permiso en el firewall: acepta «Redes privadas».</p>

              <h2>Unidades</h2>
              <div className="form"><label>Discos duros externos</label>{chk('showFixedDrives', 'Mostrar también discos USB no extraíbles')}</div>

              <h2>Bluetooth</h2>
              <div className="form">
                <label>Carpeta de recepción</label>
                <div className="row" style={{ flexWrap: 'nowrap' }}>{txt('bluetoothInbox')}<button className="btn sm" onClick={() => pick('bluetoothInbox')}>Elegir</button></div>
              </div>
              <p className="muted small">En el asistente de Windows «Recibir archivos», guarda en esta carpeta.</p>

              <h2>Carpetas de red</h2>
              {s.shareFolders.map((f, i) => (
                <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="inp" style={{ width: 240 }} placeholder="Nombre visible" value={f.name} onChange={(e) => listEdit('shareFolders', i, 'name', e.target.value)} />
                  <input className="inp" placeholder="\\\\SERVIDOR\\fotos" value={f.path} onChange={(e) => listEdit('shareFolders', i, 'path', e.target.value)} />
                  <button className="btn sm" onClick={() => pick(`shareFolders.${i}.path`)}>Elegir</button>
                  <button className="btn sm danger" onClick={() => set('shareFolders', s.shareFolders.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button>
                </div>
              ))}
              <div className="row"><button className="btn" onClick={() => set('shareFolders', [...s.shareFolders, { name: 'Fotos compartidas', path: '' }])}><Icon name="plus" /> Añadir carpeta</button></div>

              <h2>Correo electrónico (IMAP)</h2>
              <div className="form">
                <label>Activar</label>{chk('email.enabled', 'Recibir fotos por correo')}
                <label>Dirección para clientes</label>{txt('email.address', { placeholder: 'fotos@mitienda.com' })}
                <label>Servidor IMAP</label>{txt('email.host', { placeholder: 'imap.gmail.com' })}
                <label>Puerto</label>{txt('email.port', { type: 'number' })}
                <label>SSL/TLS</label>{chk('email.secure', 'Conexión segura')}
                <label>Usuario</label>{txt('email.user')}
                <label>Contraseña</label>{txt('email.pass', { type: 'password' })}
                <label>Comprobar cada (s)</label>{txt('email.pollSeconds', { type: 'number', min: 10 })}
              </div>
              <div className="row">
                <button className="btn" onClick={async () => { const r = await api('admin:testEmail', pin, s.email); toast(r.ok ? { type: 'ok', text: 'Conexión correcta' } : { type: 'error', text: r.error }); }}>Probar conexión</button>
                <span className="muted small">Usa un buzón exclusivo para el kiosco (con Gmail, una «contraseña de aplicación»).</span>
              </div>
            </>
          )}

          {tab === 'lab' && (
            <>
              <h2>Envío al laboratorio</h2>
              <div className="form">
                <label>Modo</label>
                <select className="inp" value={s.lab.mode} onChange={(e) => set('lab.mode', e.target.value)}>
                  <option value="http">Servidor de la tienda (recomendado)</option>
                  <option value="folder">Carpeta compartida / carpeta caliente</option>
                </select>
                <label>Dirección del servidor</label>{txt('lab.serverUrl', { placeholder: 'http://192.168.1.10:4000' })}
                <label>Clave del kiosco</label>{txt('lab.kioskKey', { type: 'password' })}
                {s.lab.mode === 'folder' && <><label>Carpeta del laboratorio</label><div className="row" style={{ flexWrap: 'nowrap' }}>{txt('lab.folder')}<button className="btn sm" onClick={() => pick('lab.folder')}>Elegir</button></div></>}
              </div>
              <p className="muted small">La dirección del servidor también se usa para las galerías privadas de los clientes.</p>
              <div className="row"><button className="btn" disabled={dirty} onClick={async () => { const r = await api('admin:testLab', pin); toast(r.ok ? { type: 'ok', text: 'Conexión correcta' } : { type: 'error', text: r.error }); }}>Probar conexión</button>{dirty && <span className="muted small">Guarda antes de probar</span>}</div>
            </>
          )}

          {tab === 'masks' && (
            <>
              <h2>Máscaras y marcos para eventos</h2>
              <p className="muted" style={{ margin: 0 }}>Imágenes PNG con transparencia (por ejemplo 1200 x 1800 px). Se adaptan al tamaño de copia y se giran si la foto es horizontal.</p>
              <div className="form">
                <label>Máscara del evento activo</label>
                <select className="inp" value={s.masks.activeEventMask} onChange={(e) => set('masks.activeEventMask', e.target.value)}>
                  <option value="">Ninguna (el cliente elige)</option>
                  {masks.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div className="masks">
                {masks.map((m) => (
                  <div key={m.name} className="m col" style={{ gap: 6 }}>
                    <img src={fileUrl(m.path)} alt="" />
                    <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', background: '#fff', borderRadius: 8, padding: '2px 6px' }}>
                      <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      <button className="btn sm danger" onClick={async () => { await api('masks:remove', pin, m.name); loadMasks(); }}><Icon name="trash" size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row"><button className="btn" onClick={async () => { await api('masks:add', pin); loadMasks(); }}><Icon name="plus" /> Añadir máscaras PNG</button></div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** Impresión y envío al servidor: qué se hace al confirmar un pedido. */
function DeliverySettings({ s, set, pin, pick, toast, dirty, printers = [] }) {
  const d = { print: true, server: false, serverFolder: 'Laboratorio', localFallback: '', retryMinutes: 5, ...(s.delivery || {}) };
  const sd = (k, v) => set('delivery', { ...d, [k]: v });
  const [folders, setFolders] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => {
    setErr('');
    try { const r = await api('admin:serverFolders', pin); setFolders(r.folders || []); } catch (e) { setFolders([]); setErr(e.message); }
  };
  useEffect(() => { if (d.server) load(); }, [d.server]); // eslint-disable-line react-hooks/exhaustive-deps
  const box = (k, label, hint) => (
    <label className="row deliv-opt" style={{ gap: 12 }}>
      <input type="checkbox" checked={!!d[k]} onChange={(e) => sd(k, e.target.checked)} style={{ width: 28, height: 28 }} />
      <span className="col" style={{ gap: 2 }}><b>{label}</b><span className="muted small">{hint}</span></span>
    </label>
  );
  return (
    <>
      <h2>Impresión y envío</h2>
      <p className="muted" style={{ margin: 0 }}>Al confirmar un pedido se hace lo que actives aquí (una cosa, la otra o las dos).</p>
      <div className="card col" style={{ maxWidth: 900 }}>
        {box('print', 'Imprimir en este kiosco', 'Cada tamaño va a su impresora (Tamaños e impresoras). Si un tamaño no tiene impresora, el pedido se envía al servidor.')}
        {box('server', 'Enviar al servidor', 'Copia en JPEG en una carpeta del servidor: AAAA_MM_DD_Nº / tamaño / AAAA_MM_DD_Nº_foto.jpeg')}
        {!d.print && !d.server && <div style={{ color: 'var(--err)' }}>Activa al menos una de las dos opciones.</div>}
      </div>
      <TicketPinSettings s={s} set={set} printers={printers} />
      <div className="card col" style={{ maxWidth: 900 }}>
        <label className="row deliv-opt" style={{ gap: 12 }}>
          <input type="checkbox" checked={!!s.simPrinter?.enabled} onChange={(e) => set('simPrinter', { ...(s.simPrinter || {}), enabled: e.target.checked })} style={{ width: 28, height: 28 }} />
          <span className="col" style={{ gap: 2 }}><b>Simular una impresora DNP DS620 (pruebas)</b>
            <span className="muted small">Los tamaños sin impresora que admite la DS620 (9x13, 10x15, 13x18, 15x20, 15x23 y 5x15, incluidas Polaroid y lotes de carnet) se «imprimen» como JPEG en una carpeta, con un registro. Desactívalo cuando conectes la impresora real.</span></span>
        </label>
        {s.simPrinter?.enabled && (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="inp" value={s.simPrinter?.folder || ''} placeholder={'Documentos\\KioscoPizarro\\Impresora simulada DNP DS620'} onChange={(e) => set('simPrinter', { ...s.simPrinter, folder: e.target.value })} />
            <button className="btn sm" onClick={() => pick('simPrinter.folder')}>Elegir</button>
            <button className="btn sm" onClick={() => api('admin:openSimFolder', pin).catch((e) => toast({ type: 'error', text: e.message }))}>Abrir carpeta</button>
          </div>
        )}
      </div>
      {d.server && (
        <div className="form" style={{ maxWidth: 900 }}>
          <label>Carpeta de destino en el servidor</label>
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="inp" list="srv-folders" value={d.serverFolder || ''} onChange={(e) => sd('serverFolder', e.target.value)} placeholder="Laboratorio" />
              <datalist id="srv-folders">{(folders || []).map((f) => <option key={f} value={f} />)}</datalist>
              <button className="btn sm" onClick={load}>Actualizar</button>
            </div>
            {folders && folders.length > 0 && <div className="row" style={{ gap: 6 }}>{folders.map((f) => <button key={f} className={`chip sm ${d.serverFolder === f ? 'on' : ''}`} onClick={() => sd('serverFolder', f)}>{f}</button>)}</div>}
            {err ? <span className="small" style={{ color: 'var(--err)' }}>No se pueden leer las carpetas del servidor: {err}</span>
              : <span className="muted small">Son las subcarpetas de la «carpeta raíz de exportación» del servidor. Si escribes un nombre nuevo, se crea al enviar.</span>}
          </div>
          <label>Si el servidor no responde, guardar en</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="inp" value={d.localFallback || ''} onChange={(e) => sd('localFallback', e.target.value)} placeholder={'C:\\KioscoPizarro\\Pendientes'} />
            <button className="btn sm" onClick={() => pick('delivery.localFallback')}>Elegir</button>
          </div>
          <label>Reintentar el envío cada</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input className="inp" type="number" min="1" max="120" style={{ width: 110 }} value={d.retryMinutes} onChange={(e) => sd('retryMinutes', Math.max(1, Number(e.target.value) || 5))} /><span className="muted">minutos</span></div>
        </div>
      )}
      {d.server && (
        <div className="row">
          <button className="btn" disabled={dirty} onClick={async () => {
            try { const n = await api('admin:retryPending', pin); toast({ type: 'ok', text: n ? `${n} pedido(s) pendientes enviados al servidor` : 'No hay pedidos pendientes, o el servidor sigue sin responder' }); } catch (e) { toast({ type: 'error', text: e.message }); }
          }}>Reintentar pendientes ahora</button>
          {dirty && <span className="muted small">Guarda antes de reintentar</span>}
        </div>
      )}
    </>
  );
}

function TicketPreview({ s, tk }) {
  const L = s.legal || {};
  const name = s.storeName || 'Nombre de la tienda';
  const head = (tk.header || '').split('\n').filter(Boolean);
  const foot = (tk.footer || '').split('\n').filter(Boolean);
  return (
    <div style={{ background: '#fff', color: '#000', fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11, lineHeight: 1.35, width: 260, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, margin: '4px 0' }}>
      {tk.logo && <div style={{ textAlign: 'center', marginBottom: 6 }}><img src={tk.logo} alt="" style={{ maxHeight: 36, maxWidth: 120 }} /></div>}
      <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 14 }}>{name}</div>
      {L.nif && <div style={{ textAlign: 'center', fontSize: 9.5 }}>NIF: {L.nif}{L.address ? ` · ${L.address}` : ''}</div>}
      {head.map((l, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9.5 }}>{l}</div>)}
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '5px 0' }} />
      <div style={{ textAlign: 'center', fontSize: 10 }}>TICKET DE PEDIDO · PAGO EN CAJA</div>
      <div style={{ textAlign: 'center', fontSize: 22, fontWeight: 800 }}>Nº 001</div>
      <div style={{ textAlign: 'center', fontSize: 9.5 }}>PED-20261118-001 · 18/11/2026 10:00</div>
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '5px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5 }}><span>2 × Foto 10×15</span><span>1,20 €</span></div>
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '5px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 13 }}><span>TOTAL</span><span>1,20 €</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}><span>Base imponible</span><span>0,99 €</span></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5 }}><span>IVA {tk.ivaPct || 21} %</span><span>0,21 €</span></div>
      <div style={{ border: '1.5px solid #000', borderRadius: 4, padding: '3px 5px', margin: '5px 0', textAlign: 'center', fontWeight: 700, fontSize: 10 }}>PENDIENTE DE PAGO EN CAJA</div>
      {foot.map((l, i) => <div key={i} style={{ textAlign: 'center', fontSize: 9.5 }}>{l}</div>)}
      <div style={{ textAlign: 'center', fontSize: 8.5, marginTop: 4, color: '#666' }}>Documento no válido como factura.</div>
    </div>
  );
}

/** Ticket para pagar en caja y PIN de 3 cifras para imprimir. */
function TicketPinSettings({ s, set, printers }) {
  const tk = { enabled: true, printer: '', ivaPct: 21, header: '', footer: '', ...(s.ticket || {}) };
  const st = (k, v) => set('ticket', { ...tk, [k]: v });
  const p = { mode: 'off', prints: true, idlots: true, sizes: [], ...(s.pin || {}) };
  const sp = (k, v) => set('pin', { ...p, [k]: v });
  const real = printers.filter((x) => !x.simulated);
  return (
    <>
      <div className="card col" style={{ maxWidth: 900 }}>
        <label className="row deliv-opt" style={{ gap: 12 }}>
          <input type="checkbox" checked={tk.enabled !== false} onChange={(e) => st('enabled', e.target.checked)} style={{ width: 28, height: 28 }} />
          <span className="col" style={{ gap: 2 }}><b>Ticket para pagar en caja</b>
            <span className="muted small">Al confirmar el pedido se imprime un ticket con el número, las líneas (con el código de artículo de cada tamaño o lote), el total y el IVA, y un código de barras. Se envía al servidor como «pendiente» para Gestión Pizarro: no cuenta en contabilidad hasta que en caja se confirma la venta.</span></span>
        </label>
        {tk.enabled !== false && (
          <div className="form">
            <label>Impresora de tickets</label>
            <select className="inp" value={tk.printer} onChange={(e) => st('printer', e.target.value)}>
              <option value="">Ninguna: guardar en PDF (pruebas)</option>
              {real.map((x) => <option key={x.name} value={x.name}>{x.displayName}</option>)}
            </select>
            <label>IVA incluido (%)</label>
            <input className="inp" type="number" min="0" max="50" style={{ width: 110 }} value={tk.ivaPct} onChange={(e) => st('ivaPct', Number(e.target.value))} />
            <label>Logo del ticket (imagen pequeña, se centra arriba)</label>
            <div className="row" style={{ gap: 12 }}>
              {tk.logo && <img src={tk.logo} alt="Logo" style={{ maxHeight: 48, maxWidth: 160, objectFit: 'contain' }} />}
              <input type="file" accept="image/*" style={{ fontSize: 14 }} onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                const r = new FileReader(); r.onload = () => st('logo', r.result); r.readAsDataURL(f);
              }} />
              {tk.logo && <button className="btn sm" onClick={() => st('logo', '')}>Quitar</button>}
            </div>
            <label>Cabecera (una línea por renglón)</label>
            <textarea className="inp" rows={3} value={tk.header} onChange={(e) => st('header', e.target.value)} placeholder={'Razón social · NIF\nDirección\nTeléfono'} />
            <label>Pie</label>
            <textarea className="inp" rows={2} value={tk.footer} onChange={(e) => st('footer', e.target.value)} />
            <label style={{ marginTop: 12 }}>Vista previa del ticket</label>
            <TicketPreview s={s} tk={tk} />
          </div>
        )}
      </div>
      <div className="card col" style={{ maxWidth: 900 }}>
        <b>PIN de caja para imprimir</b>
        <span className="muted small">Cada pedido recibe un PIN de 3 cifras al azar. El cliente paga en caja con su ticket, allí le dan el PIN y lo escribe en el kiosco para que empiece la impresión. El personal ve el PIN en Pedidos → Pendientes de pago (y en la web del servidor). Si en Gestión se confirma la venta, se imprime solo.</span>
        <div className="seg" style={{ maxWidth: 620 }}>
          {[['off', 'Desactivado'], ['all', 'Para todo'], ['custom', 'Solo para algunas cosas']].map(([k, l]) => <button key={k} className={p.mode === k ? 'on' : ''} onClick={() => sp('mode', k)}>{l}</button>)}
        </div>
        {p.mode === 'custom' && (
          <div className="col" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!p.prints} onChange={(e) => sp('prints', e.target.checked)} style={{ width: 22, height: 22 }} /> Todas las copias</label>
            <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={!!p.idlots} onChange={(e) => sp('idlots', e.target.checked)} style={{ width: 22, height: 22 }} /> Fotos de carnet</label>
            {!p.prints && (
              <div className="row" style={{ gap: 6 }}>
                <span className="muted small">Solo estos tamaños:</span>
                {s.printSizes.map((z) => {
                  const on = (p.sizes || []).includes(z.id);
                  return <span key={z.id} className={`pchip ${on ? 'on' : ''}`} onClick={() => sp('sizes', on ? p.sizes.filter((x) => x !== z.id) : [...(p.sizes || []), z.id])}>{z.name}</span>;
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** ¿Está instalada esta letra? (se compara el ancho de un texto con dos letras de respaldo distintas) */
function fontAvailable(family) {
  const f = FONT_CHOICES.find((x) => x.family === family);
  if (f?.bundled) return true;
  const c = document.createElement('canvas').getContext('2d');
  const txt = 'mmmmmmmmmmlliWWQ@#ñ';
  return ['monospace', 'serif'].some((fb) => {
    c.font = `40px ${fb}`; const a = c.measureText(txt).width;
    c.font = `40px "${family}", ${fb}`; return c.measureText(txt).width !== a;
  });
}

/** Letras del programa (texto y títulos) y, por separado, las de los mensajes de la pantalla de espera. */
function FontSettings({ s, set }) {
  const fonts = { ...DEFAULT_FONTS, ...(s.fonts || {}) };
  const sf = (k, v) => set('fonts', { ...fonts, [k]: v });
  // Vista previa al momento de los tamaños (al salir sin guardar vuelven los guardados).
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--fs', String(Number(fonts.fontScale) || 1));
    r.setProperty('--ms', String(Number(fonts.menuScale) || 1));
  }, [fonts.fontScale, fonts.menuScale]);
  const avail = FONT_CHOICES.filter((x) => fontAvailable(x.family));
  const msgs = fonts.messages?.length ? fonts.messages : DEFAULT_FONTS.messages;
  const idx = (fam) => msgs.findIndex((m) => m.family === fam);
  const toggle = (fam) => {
    const i = idx(fam);
    if (i >= 0) { if (msgs.length > 1) sf('messages', msgs.filter((_, j) => j !== i)); }
    else sf('messages', [...msgs, { family: fam }]);
  };
  const setOpt = (fam, k, v) => sf('messages', msgs.map((m) => (m.family === fam ? { ...m, [k]: v } : m)));
  const pick = (k, label, sample) => (
    <div className="col" style={{ gap: 8 }}>
      <b>{label}</b>
      <div className="font-grid">
        {avail.map((x) => (
          <button key={x.family} className={`font-card ${fonts[k] === x.family ? 'on' : ''}`} onClick={() => sf(k, x.family)} style={{ fontFamily: fontStack(x.family) }}>
            <span className="fc-sample">{sample}</span><span className="fc-name">{x.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <h2>Letras</h2>
      <p className="muted" style={{ margin: 0 }}>Todas funcionan sin internet: Montserrat y Plus Jakarta Sans van con el programa y el resto vienen con Windows. Solo aparecen las que están instaladas en este equipo.</p>

      <h2 style={{ marginTop: 10 }}>Tamaño</h2>
      <p className="muted" style={{ margin: 0 }}>Se ajustan por separado: el tamaño de la letra de todo el programa y el tamaño de los menús (barras, botones, pestañas y teclado). Se ve al momento; pulsa «Guardar» para que se quede.</p>
      <div className="card col" style={{ maxWidth: 900, gap: 14 }}>
        {[['fontScale', 'Letra', 'Texto de todas las pantallas'], ['menuScale', 'Menús', 'Barras, botones, pestañas y teclado táctil']].map(([k, l, d]) => {
          const v = Math.round((Number(fonts[k]) || 1) * 100);
          return (
            <div key={k} className="size-row">
              <span className="col" style={{ gap: 0 }}><b>{l}</b><span className="muted small">{d}</span></span>
              <button className="btn sm" onClick={() => sf(k, Math.max(0.7, (v - 5) / 100))} aria-label={`${l} más pequeño`}>A−</button>
              <input type="range" min="70" max="160" step="5" value={v} onChange={(e) => sf(k, Number(e.target.value) / 100)} />
              <button className="btn sm" onClick={() => sf(k, Math.min(1.6, (v + 5) / 100))} aria-label={`${l} más grande`}>A+</button>
              <b className="size-val">{v} %</b>
              <button className="btn sm" disabled={v === 100} onClick={() => sf(k, 1)}>100 %</button>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 10 }}>Resto del programa</h2>
      {pick('ui', 'Texto general (botones, listas, avisos)', 'Elige y edita tus fotos 10 x 15')}
      {pick('headings', 'Títulos', 'Resumen del pedido')}

      <h2 style={{ marginTop: 10 }}>Mensajes de la pantalla de espera</h2>
      <p className="muted" style={{ margin: 0 }}>Marca una o varias letras: cada mensaje sale con la siguiente, cambiando cada 15 s. Puedes ponerlas en cursiva, en mayúsculas o más finas.</p>
      <div className="font-grid msgs">
        {avail.map((x) => {
          const i = idx(x.family);
          const m = msgs[i] || {};
          const on = i >= 0;
          return (
            <div key={x.family} className={`font-card msg ${on ? 'on' : ''}`}>
              <button className="fc-main" onClick={() => toggle(x.family)}
                style={{ fontFamily: fontStack(x.family), fontStyle: m.italic ? 'italic' : 'normal', fontWeight: m.weight || 400, textTransform: m.upper ? 'uppercase' : 'none', letterSpacing: m.upper ? '.12em' : 0 }}>
                <span className="fc-sample">{QUOTES[0]}</span>
                <span className="fc-name">{on ? `${i + 1}.º · ` : ''}{x.label}</span>
              </button>
              {on && (
                <div className="row" style={{ gap: 6 }}>
                  <button className={`chip sm ${m.italic ? 'on' : ''}`} onClick={() => setOpt(x.family, 'italic', !m.italic)}>Cursiva</button>
                  <button className={`chip sm ${m.upper ? 'on' : ''}`} onClick={() => setOpt(x.family, 'upper', !m.upper)}>Mayúsculas</button>
                  <button className={`chip sm ${m.weight && m.weight < 400 ? 'on' : ''}`} onClick={() => setOpt(x.family, 'weight', m.weight && m.weight < 400 ? 400 : 200)}>Fina</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="row"><button className="btn" onClick={() => set('fonts', DEFAULT_FONTS)}>Volver a las letras de serie</button></div>
    </>
  );
}

/** Verificación tras 5 PIN erróneos: móvil de la empresa (app de autenticación) y correo de la empresa. */
function SecuritySettings({ s, set, pin, toast, dirty }) {
  const sec = { totpEnabled: false, email: '', smtp: {}, ...(s.security || {}) };
  const smtp = { host: '', port: 587, secure: false, user: '', pass: '', from: '', ...(sec.smtp || {}) };
  const ss = (k, v) => set('security', { ...sec, [k]: v });
  const sm = (k, v) => ss('smtp', { ...smtp, [k]: v });
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const start = async () => { try { setSetup(await api('admin:totpSetup', pin)); setCode(''); } catch (e) { toast({ type: 'error', text: e.message }); } };
  const confirm = async () => {
    try { await api('admin:totpConfirm', pin, setup.secret, code); setSetup(null); toast({ type: 'ok', text: 'Móvil de la empresa vinculado' }); const fresh = await api('admin:settings', pin); set('security', fresh.security); }
    catch (e) { toast({ type: 'error', text: e.message }); setCode(''); }
  };
  return (
    <>
      <h2 style={{ marginTop: 18 }}>Seguridad de los PIN</h2>
      <p className="muted" style={{ margin: 0 }}>Si alguien se equivoca 5 veces con un PIN (ajustes, Mi galería o PIN de caja), queda bloqueado 5 minutos. Para desbloquearlo antes hace falta un código del móvil o del correo de la empresa.</p>
      <div className="card col" style={{ maxWidth: 900 }}>
        <b>Móvil de la empresa</b>
        <span className="muted small">Con una app de autenticación (Google Authenticator, Microsoft Authenticator…). No necesita SMS ni conexión en el móvil.</span>
        {sec.totpLinked || sec.totpEnabled
          ? <div className="row"><span style={{ color: 'var(--ok)', fontWeight: 600 }}>✔ Vinculado</span><button className="btn sm" onClick={start}>Vincular otro móvil</button><button className="btn sm danger" onClick={() => ss('totpEnabled', false)}>Desactivar</button></div>
          : !setup && <div className="row"><button className="btn" onClick={start}>Vincular el móvil de la empresa</button></div>}
        {setup && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <img src={setup.qr} alt="Código QR para la app de autenticación" style={{ width: 220, height: 220, borderRadius: 12, background: '#fff' }} />
            <div className="col" style={{ gap: 8, flex: 1 }}>
              <span>1. En el móvil de la empresa, abre la app de autenticación y escanea este código.</span>
              <span className="muted small">Clave manual: <span className="mono">{setup.secret}</span></span>
              <span>2. Escribe el código de 6 cifras que muestra la app:</span>
              <input className="inp" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} style={{ width: 160, fontSize: 22, letterSpacing: 4 }} />
              <div className="row"><button className="btn" onClick={() => setSetup(null)}>Cancelar</button><button className="btn primary" disabled={code.length !== 6} onClick={confirm}>Confirmar</button></div>
            </div>
          </div>
        )}
      </div>
      <div className="card col" style={{ maxWidth: 900 }}>
        <b>Correo de la empresa</b>
        <span className="muted small">Se envía un código de 6 cifras (válido 10 minutos) a esta dirección.</span>
        <div className="form">
          <label>Correo que recibe los códigos</label><input className="inp" value={sec.email || ''} onChange={(e) => ss('email', e.target.value.trim())} placeholder="seguridad@tuempresa.es" />
          <label>Servidor de salida (SMTP)</label><input className="inp" value={smtp.host} onChange={(e) => sm('host', e.target.value.trim())} placeholder="smtp.tuempresa.es" />
          <label>Puerto</label><div className="row" style={{ flexWrap: 'nowrap' }}><input className="inp" type="number" style={{ width: 110 }} value={smtp.port} onChange={(e) => sm('port', Number(e.target.value))} /><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!!smtp.secure} onChange={(e) => sm('secure', e.target.checked)} /> SSL (puerto 465)</label></div>
          <label>Usuario</label><input className="inp" value={smtp.user} onChange={(e) => sm('user', e.target.value.trim())} />
          <label>Contraseña</label><input className="inp" type="password" value={smtp.pass} onChange={(e) => sm('pass', e.target.value)} />
          <label>Remitente</label><input className="inp" value={smtp.from} onChange={(e) => sm('from', e.target.value.trim())} placeholder="Kiosco Pizarro <kiosco@tuempresa.es>" />
        </div>
        <div className="row"><button className="btn" disabled={dirty || !sec.email || !smtp.host} onClick={async () => { try { const r = await api('admin:testMail', pin); toast({ type: 'ok', text: `Correo de prueba enviado a ${r.to}` }); } catch (e) { toast({ type: 'error', text: e.message }); } }}>Enviar correo de prueba</button>{dirty && <span className="muted small">Guarda antes de probar</span>}</div>
      </div>
    </>
  );
}
