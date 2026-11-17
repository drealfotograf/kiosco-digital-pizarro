import React, { useEffect, useState } from 'react';
import { api, fileUrl } from '../api.js';
import { Icon } from '../components/ui.jsx';
import AdminOrders from './AdminOrders.jsx';
import LotPreview from '../components/LotPreview.jsx';
import { sizeColor, DEFAULT_ID_OPTIONS } from '../../../shared/presets.js';

const TABS = [
  ['orders', 'Pedidos'], ['general', 'General'], ['print', 'Impresión y envío'], ['sizes', 'Tamaños e impresoras'], ['tariffs', 'Tarifas'], ['lots', 'Lotes de carnet'], ['id', 'Formatos carnet'],
  ['sources', 'Fuentes de fotos'], ['lab', 'Laboratorio y galerías'], ['masks', 'Máscaras y eventos']
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
          {TABS.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>)}
          <div className="spacer" />
          <button className="btn danger" onClick={() => api('admin:quit', pin)}>Cerrar aplicación</button>
        </nav>
        <section>
          {tab === 'orders' && <AdminOrders pin={pin} settings={s} toast={toast} onReprocess={onReprocess} />}

          {tab === 'tariffs' && (
            <>
              <h2>Tarifas</h2>
              <p className="muted" style={{ margin: 0 }}>Precios de copias (con tramos por cantidad), fotos carnet y lotes. Los tramos se escriben como <code>cantidad:precio</code> separados por «|»; por ejemplo <code>50:0,30 | 100:0,25</code> significa 0,30 € desde 50 copias y 0,25 € desde 100.</p>
              <div className="row">
                <button className="btn" disabled={dirty} onClick={async () => { const f = await api('tariffs:export', pin); if (f) toast({ type: 'ok', text: `Tarifas exportadas a ${f}` }); }}><Icon name="download" /> Exportar (CSV / Excel)</button>
                <button className="btn" disabled={dirty} onClick={async () => {
                  try { const r = await api('tariffs:import', pin); if (r) { setS(r.settings); toast({ type: 'ok', text: `Importado: ${r.summary.updated} actualizadas, ${r.summary.added} nuevas, ${r.summary.skipped} omitidas` }); } } catch (e) { toast({ type: 'error', text: e.message }); }
                }}><Icon name="plus" /> Importar</button>
                {dirty && <span className="muted small">Guarda los cambios antes de importar o exportar</span>}
              </div>
              <h3 style={{ margin: 0 }}>Copias</h3>
              <table className="t">
                <thead><tr><th>Tamaño</th><th style={{ width: 120 }}>Precio/ud</th><th>Tramos por cantidad</th></tr></thead>
                <tbody>{s.printSizes.map((z, i) => (
                  <tr key={z.id}><td>{z.name}</td>
                    <td><input className="inp" type="number" step="0.01" value={z.price} onChange={(e) => listEdit('printSizes', i, 'price', Number(e.target.value))} /></td>
                    <td><TierInput value={z.tiers} onChange={(t) => listEdit('printSizes', i, 'tiers', t)} /></td></tr>
                ))}</tbody>
              </table>
              <h3 style={{ margin: 0 }}>Fotos carnet (precio por hoja)</h3>
              <table className="t">
                <thead><tr><th>Formato</th><th style={{ width: 120 }}>Precio</th></tr></thead>
                <tbody>{s.idPresets.map((p, i) => (
                  <tr key={p.id}><td>{p.name}</td><td><input className="inp" type="number" step="0.5" value={p.price} onChange={(e) => listEdit('idPresets', i, 'price', Number(e.target.value))} /></td></tr>
                ))}</tbody>
              </table>
              <h3 style={{ margin: 0 }}>Lotes</h3>
              <table className="t">
                <thead><tr><th>Lote</th><th style={{ width: 120 }}>Precio</th></tr></thead>
                <tbody>{s.idLots.map((l, i) => (
                  <tr key={l.id}><td>{l.name} · {l.photos} fotos</td><td><input className="inp" type="number" step="0.5" value={l.price} onChange={(e) => listEdit('idLots', i, 'price', Number(e.target.value))} /></td></tr>
                ))}</tbody>
              </table>
            </>
          )}

          {tab === 'lots' && (
            <>
              <h2>Lotes de fotos de carnet</h2>
              <p className="muted" style={{ margin: 0 }}>Cada lote es una hoja 10x15 con la misma foto. Activa los que se ofrecen en el kiosco, cambia el nombre y el precio por lote. La vista previa muestra cómo se imprime.</p>
              <div className="lot-admin">
                {(s.idLotTypes || []).map((l, i) => (
                  <div key={l.id} className={`card col lot-card ${l.enabled === false ? 'off' : ''}`}>
                    <LotPreview lot={l} entry={{ guides: s.idOptions?.guides, border: s.idOptions?.border }} width={300} />
                    <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={l.enabled !== false} onChange={(e) => listEdit('idLotTypes', i, 'enabled', e.target.checked)} style={{ width: 24, height: 24 }} />Ofrecer en el kiosco</label>
                    <input className="inp" value={l.name} onChange={(e) => listEdit('idLotTypes', i, 'name', e.target.value)} />
                    <div className="row" style={{ flexWrap: 'nowrap' }}><span className="muted small" style={{ flex: 1 }}>Precio por lote</span><input className="inp" type="number" step="0.5" style={{ width: 110 }} value={l.price} onChange={(e) => listEdit('idLotTypes', i, 'price', Number(e.target.value))} /></div>
                    <span className="muted small">{l.kind === 'grid+big' ? `${l.cols * l.rows} fotos ${l.pw}x${l.ph} mm + 1 de ${l.big.w}x${l.big.h} mm` : `${l.cols * l.rows} fotos ${l.pw}x${l.ph} mm`} · papel {l.landscape === false ? 'vertical' : 'horizontal'}</span>
                  </div>
                ))}
              </div>
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

          {tab === 'print' && <DeliverySettings s={s} set={set} pin={pin} pick={pick} toast={toast} dirty={dirty} />}

          {tab === 'general' && (
            <>
              <h2>General</h2>
              <div className="form">
                <label>Guardar pedidos durante (días)</label>{txt('ordersRetentionDays', { type: 'number', min: 1 })}
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
              <h2>Tamaños de copia e impresoras</h2>
              <p className="muted" style={{ margin: 0 }}>Asigna una o varias impresoras a cada tamaño; los trabajos se reparten entre ellas. Un tamaño sin impresora solo se puede pedir al laboratorio.</p>
              <table className="t">
                <thead><tr><th>Color</th><th>Nombre</th><th>Ancho mm</th><th>Alto mm</th><th>Precio</th><th>Impresoras</th><th>Papel del driver</th><th>Lista rápida</th><th></th></tr></thead>
                <tbody>
                  {s.printSizes.map((z, i) => (
                    <tr key={i}>
                      <td style={{ width: 54 }}><input type="color" value={sizeColor(s.printSizes, z.id)} title="Color de este tamaño en la zona de selección" onChange={(e) => listEdit('printSizes', i, 'color', e.target.value)} style={{ width: 40, height: 36, border: 0, background: 'none' }} /></td>
                      <td><input className="inp" value={z.name} onChange={(e) => listEdit('printSizes', i, 'name', e.target.value)} /></td>
                      <td style={{ width: 90 }}><input className="inp" type="number" value={z.w} onChange={(e) => listEdit('printSizes', i, 'w', Number(e.target.value))} /></td>
                      <td style={{ width: 90 }}><input className="inp" type="number" value={z.h} onChange={(e) => listEdit('printSizes', i, 'h', Number(e.target.value))} /></td>
                      <td style={{ width: 100 }}><input className="inp" type="number" step="0.05" value={z.price} onChange={(e) => listEdit('printSizes', i, 'price', Number(e.target.value))} /></td>
                      <td>
                        {printers.map((p) => {
                          const on = (z.printers || []).includes(p.name);
                          return <span key={p.name} className={`pchip ${on ? 'on' : ''}`} onClick={() => listEdit('printSizes', i, 'printers', on ? z.printers.filter((x) => x !== p.name) : [...(z.printers || []), p.name])}>{p.displayName}</span>;
                        })}
                        {!printers.length && <span className="muted small">No se encontraron impresoras</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!z.useDriverPaper} onChange={(e) => listEdit('printSizes', i, 'useDriverPaper', e.target.checked)} title="Usar el tamaño de papel configurado en el driver" /></td>
                      <td style={{ textAlign: 'center' }}><input type="checkbox" checked={(s.quickSizes || []).includes(z.id)} title="Se ve directamente en la zona de selección"
                        onChange={(e) => set('quickSizes', e.target.checked ? [...(s.quickSizes || []), z.id] : (s.quickSizes || []).filter((x) => x !== z.id))} /></td>
                      <td className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <button className="btn sm" disabled={!z.printers?.length || dirty} title={dirty ? 'Guarda primero' : ''} onClick={async () => {
                          try { await api('admin:testPrint', pin, z.printers[0], z.id); toast({ type: 'ok', text: 'Página de prueba enviada' }); } catch (e) { toast({ type: 'error', text: e.message }); }
                        }}>Prueba</button>
                        <button className="btn sm danger" onClick={() => set('printSizes', s.printSizes.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <button className="btn" onClick={() => set('printSizes', [...s.printSizes, { id: `s${Date.now()}`, name: 'Nuevo tamaño', w: 100, h: 150, price: 0.5, printers: [], useDriverPaper: false }])}><Icon name="plus" /> Añadir tamaño</button>
                <button className="btn" onClick={() => api('printers:list').then(setPrinters)}>Actualizar impresoras</button>
              </div>
            </>
          )}

          {tab === 'id' && (
            <>
              <h2>Formatos de foto carnet</h2>
              <p className="muted" style={{ margin: 0 }}>Cabeza mín./máx.: altura de barbilla a coronilla. Coronilla: distancia desde el borde superior. Precio por hoja.</p>
              <table className="t">
                <thead><tr><th>Nombre</th><th>Región</th><th>Ancho</th><th>Alto</th><th>Cabeza mín.</th><th>Cabeza máx.</th><th>Coronilla</th><th>Precio</th><th></th></tr></thead>
                <tbody>
                  {s.idPresets.map((p, i) => (
                    <tr key={i}>
                      <td><input className="inp" value={p.name} onChange={(e) => listEdit('idPresets', i, 'name', e.target.value)} /></td>
                      <td style={{ width: 120 }}><input className="inp" value={p.region || ''} onChange={(e) => listEdit('idPresets', i, 'region', e.target.value)} /></td>
                      {['w', 'h', 'headMin', 'headMax', 'crownMm', 'price'].map((f) => (
                        <td key={f} style={{ width: 82 }}><input className="inp" type="number" step="0.5" value={p[f]} onChange={(e) => listEdit('idPresets', i, f, Number(e.target.value))} /></td>
                      ))}
                      <td><button className="btn sm danger" onClick={() => set('idPresets', s.idPresets.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row"><button className="btn" onClick={() => set('idPresets', [...s.idPresets, { id: `c${Date.now()}`, name: 'Nuevo formato', region: 'Otros', w: 35, h: 45, headMin: 32, headMax: 36, crownMm: 4, price: 8 }])}><Icon name="plus" /> Añadir formato</button></div>
              <h2>Hojas para carnet</h2>
              <table className="t">
                <thead><tr><th>Nombre</th><th>Ancho mm</th><th>Alto mm</th><th></th></tr></thead>
                <tbody>
                  {s.sheets.map((p, i) => (
                    <tr key={i}>
                      <td><input className="inp" value={p.name} onChange={(e) => listEdit('sheets', i, 'name', e.target.value)} /></td>
                      <td><input className="inp" type="number" value={p.w} onChange={(e) => listEdit('sheets', i, 'w', Number(e.target.value))} /></td>
                      <td><input className="inp" type="number" value={p.h} onChange={(e) => listEdit('sheets', i, 'h', Number(e.target.value))} /></td>
                      <td><button className="btn sm danger" onClick={() => set('sheets', s.sheets.filter((_, j) => j !== i))}><Icon name="trash" size={18} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row"><button className="btn" onClick={() => set('sheets', [...s.sheets, { id: `h${Date.now()}`, name: 'Nueva hoja', w: 102, h: 152 }])}><Icon name="plus" /> Añadir hoja</button></div>
              <p className="muted small">Para imprimir hojas de carnet en el kiosco, crea en «Tamaños e impresoras» un tamaño con las mismas medidas que la hoja y asígnale impresora.</p>
              <div className="form">
                <label>Separación por defecto (mm)</label>{txt('idDefaults.gapMm', { type: 'number' })}
                <label>Margen de hoja (mm)</label>{txt('idDefaults.marginMm', { type: 'number' })}
                <label>Guías de corte</label>
                <select className="inp" value={s.idDefaults.guides} onChange={(e) => set('idDefaults.guides', e.target.value)}>
                  <option value="none">Sin guías</option><option value="marks">Marcas de corte</option><option value="lines">Líneas completas</option>
                </select>
                <label>Guías de cara</label>{chk('idDefaults.faceGuides', 'Activadas por defecto')}
              </div>
            </>
          )}

          {tab === 'sources' && (
            <>
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
function DeliverySettings({ s, set, pin, pick, toast, dirty }) {
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
