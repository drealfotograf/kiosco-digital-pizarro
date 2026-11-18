const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('atoken') || '';
let orders = [];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = () => encodeURIComponent(token);

async function api(url, opts = {}) {
  const headers = { authorization: `Bearer ${token}`, ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(url, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/admin/login') { logout(); throw new Error('Sesión caducada'); }
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}

// ---------- Sesión ----------
function logout() { token = ''; sessionStorage.removeItem('atoken'); $('app').hidden = true; $('login').hidden = false; }
$('out').onclick = logout;
$('go').onclick = async () => {
  try {
    token = (await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: $('pwd').value }) })).token;
    sessionStorage.setItem('atoken', token);
    start();
  } catch (e) { $('lerr').textContent = e.message; }
};
$('pwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });

document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  document.querySelectorAll('section[id^=tab-]').forEach((s) => (s.hidden = s.id !== 'tab-' + b.dataset.tab));
}));

// ---------- Pedidos ----------
async function loadOrders() { orders = await api('/api/admin/orders'); renderOrders(); }
function renderOrders() {
  const f = $('ofilter').value;
  const q = $('osearch').value.trim().toLowerCase();
  const list = orders.filter((o) => (!f || o.status === f) && (!q || `${o.orderNo} ${o.customer.name} ${o.customer.phone}`.toLowerCase().includes(q)));
  $('orders').innerHTML = list.map((o) => `
    <tr>
      <td><b class="code">${esc(o.orderNo)}</b><div class="muted small">${esc(new Date(o.createdAt).toLocaleString('es-ES'))}</div><div class="small">${o.kind === 'id' ? 'Fotos carnet' : 'Copias'}</div></td>
      <td>${esc(o.customer.name || '—')}<div class="muted small">${esc(o.customer.phone)}</div></td>
      <td><div class="thumbs">${o.items.slice(0, 6).map((i) => `<img loading="lazy" src="/api/admin/orders/${encodeURIComponent(o.id)}/file/${encodeURIComponent(i.file)}?size=thumb&t=${T()}" title="${esc(i.qty + ' x ' + i.size)}">`).join('')}</div>
        <div class="small muted">${esc(summary(o))}</div></td>
      <td><b>${o.total.toFixed(2)} ${esc(o.currency)}</b></td>
      <td><select data-status="${esc(o.id)}">${['nuevo', 'en proceso', 'listo', 'entregado'].map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
      <td class="row"><a class="btn" href="/api/admin/orders/${encodeURIComponent(o.id)}/zip?t=${T()}">ZIP</a><button class="btn danger" data-del="${esc(o.id)}">Borrar</button></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No hay pedidos.</td></tr>';
}
const summary = (o) => Object.entries(o.items.reduce((a, i) => ((a[i.size] = (a[i.size] || 0) + i.qty), a), {})).map(([s, n]) => `${n} × ${s}`).join(' · ');
$('ofilter').onchange = renderOrders;
$('osearch').oninput = renderOrders;
$('orders').addEventListener('change', async (e) => {
  const id = e.target.dataset.status;
  if (id) { await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) }); loadOrders(); }
});
$('orders').addEventListener('click', async (e) => {
  const id = e.target.dataset.del;
  if (id && confirm(`¿Borrar el pedido ${id} y sus fotos? No se puede deshacer.`)) { await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'DELETE' }); loadOrders(); }
});

// ---------- Galerías ----------
async function loadGalleries() {
  const list = await api('/api/admin/galleries');
  $('galleries').innerHTML = list.map((g) => `
    <tr><td><b>${esc(g.title)}</b><div class="muted small">${esc(new Date(g.createdAt).toLocaleDateString('es-ES'))}${g.allowDownload ? ' · descarga permitida' : ''}</div></td>
    <td class="code">${esc(g.code)}</td><td>${esc(g.client)}</td><td>${g.photos}</td><td>${g.favorites}</td>
    <td class="row"><button class="btn" data-open="${esc(g.id)}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aún no hay galerías.</td></tr>';
  $('galleries').onclick = (e) => { const id = e.target.dataset.open; if (id) openGallery(list.find((g) => g.id === id)); };
}

$('gcreate').onclick = async () => {
  try {
    const g = await api('/api/admin/galleries', { method: 'POST', body: JSON.stringify({ title: $('gtitle').value, client: $('gclient').value, password: $('gpass').value, allowDownload: $('gdl').checked }) });
    const link = `${location.origin}/g?c=${g.code}`;
    $('gcreated').innerHTML = `<div class="card" style="background:var(--accent-soft)">Galería creada. Entrega al cliente:<br>
      Código <b class="code">${esc(g.code)}</b> · Contraseña <b class="code">${esc(g.password)}</b><br>
      <span class="small">Enlace: ${esc(link)}</span><br><span class="small muted">La contraseña no se vuelve a mostrar.</span></div>`;
    $('gtitle').value = $('gclient').value = $('gpass').value = '';
    await loadGalleries();
    openGallery(g);
  } catch (e) { alert(e.message); }
};

async function openGallery(g) {
  const box = $('gdetail');
  box.hidden = false;
  const photos = await api(`/api/admin/galleries/${g.id}/photos`);
  box.innerHTML = `<div class="card col" style="margin-bottom:18px">
    <div class="row"><h3 style="margin:0;flex:1">${esc(g.title)} <span class="code muted">${esc(g.code)}</span></h3>
      <button class="btn" id="gpw">Cambiar contraseña</button>
      <label class="row small"><input type="checkbox" id="gdl2" ${g.allowDownload ? 'checked' : ''}> Permitir descarga</label>
      <button class="btn danger" id="gdel">Borrar galería</button><button class="btn" id="gclose">Cerrar</button></div>
    <div class="row"><input type="file" id="gfiles" multiple accept="image/*"><button class="btn primary" id="gup">Subir fotos</button><span id="gprog" class="muted small"></span></div>
    <div class="grid">${photos.map((p) => `<div class="ph"><img loading="lazy" src="/api/admin/galleries/${g.id}/file/${p.id}?size=thumb&t=${T()}" title="${esc(p.name)}">
      ${p.favorite ? '<button class="fav on" title="Favorita del cliente">★</button>' : ''}<button class="btn danger del" data-pid="${p.id}">×</button></div>`).join('')}</div>
    ${photos.some((p) => p.favorite) ? `<p class="small">Favoritas del cliente: ${esc(photos.filter((p) => p.favorite).map((p) => p.name).join(', '))}</p>` : ''}
  </div>`;
  $('gclose').onclick = () => { box.hidden = true; };
  $('gdl2').onchange = async (e) => { await api(`/api/admin/galleries/${g.id}`, { method: 'PATCH', body: JSON.stringify({ allowDownload: e.target.checked }) }); g.allowDownload = e.target.checked; loadGalleries(); };
  $('gpw').onclick = async () => {
    const p = prompt('Nueva contraseña para el cliente (mínimo 4 caracteres):');
    if (p && p.length >= 4) { await api(`/api/admin/galleries/${g.id}`, { method: 'PATCH', body: JSON.stringify({ password: p }) }); alert('Contraseña cambiada.'); }
  };
  $('gdel').onclick = async () => {
    if (confirm(`¿Borrar la galería «${g.title}» y todas sus fotos? No se puede deshacer.`)) { await api(`/api/admin/galleries/${g.id}`, { method: 'DELETE' }); box.hidden = true; loadGalleries(); }
  };
  box.querySelectorAll('[data-pid]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/galleries/${g.id}/photos/${b.dataset.pid}`, { method: 'DELETE' }); openGallery(g); loadGalleries(); }));
  $('gup').onclick = () => uploadPhotos(g);
}

// Sube en tandas de 10 para mostrar el progreso y no saturar la red.
async function uploadPhotos(g) {
  const files = [...$('gfiles').files];
  if (!files.length) return;
  $('gup').disabled = true;
  for (let i = 0; i < files.length; i += 10) {
    $('gprog').textContent = `Subiendo ${Math.min(i + 10, files.length)} de ${files.length}…`;
    const fd = new FormData();
    files.slice(i, i + 10).forEach((f) => fd.append('files', f));
    try { await api(`/api/admin/galleries/${g.id}/photos`, { method: 'POST', body: fd }); } catch (e) { alert(e.message); break; }
  }
  await loadGalleries();
  openGallery(g);
}

// ---------- Ajustes ----------
async function loadSettings() {
  const c = await api('/api/admin/config');
  $('sname').value = c.storeName; $('shot').value = c.hotFolder; $('skey').value = c.kioskKey; $('sshare').value = c.shareFolder; $('sexport').value = c.exportRoot;
  $('sgkey').value = c.gestionKey || '';
}
$('sgregen').onclick = async () => {
  if (!confirm('Gestión Pizarro dejará de poder confirmar ventas hasta que le pongas la nueva clave. ¿Continuar?')) return;
  const r = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ regenerateGestionKey: true }) });
  $('sgkey').value = r.gestionKey;
};

// ---------- Caja: tickets pendientes de pago ----------
let tickets = [];
const eur = (n, c) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: c || 'EUR' }).format(n || 0);
const ESTADO = { pendiente: 'Pendiente de pago', pagado: 'Pagado', anulado: 'Anulado' };
async function loadTickets() { tickets = await api('/api/admin/tickets'); renderTickets(); }
function renderTickets() {
  const f = $('tfilter').value;
  const q = $('tsearch').value.trim().toLowerCase();
  const list = tickets.filter((t) => (!f || t.estado === f) && (!q || `${t.numero} ${t.corto} ${t.cliente?.name || ''}`.toLowerCase().includes(q)));
  const hoy = new Date().toISOString().slice(0, 10);
  const pagadosHoy = tickets.filter((t) => t.estado === 'pagado' && String(t.confirmadoEn || '').startsWith(hoy));
  $('tsum').textContent = `Hoy: ${pagadosHoy.length} venta(s) confirmadas, ${eur(pagadosHoy.reduce((a, t) => a + t.total, 0))} · ${tickets.filter((t) => t.estado === 'pendiente').length} pendiente(s)`;
  $('tickets').innerHTML = list.map((t) => `
    <tr>
      <td><b>${esc(t.corto || t.numero)}</b><div class="muted small">${esc(t.numero)}</div></td>
      <td>${new Date(t.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td>${esc(t.cliente?.name || '-')}</td>
      <td class="small">${t.lineas.map((l) => `${l.cantidad} × ${esc(l.descripcion)} <span class="muted">(${esc(l.codigo)})</span>`).join('<br>')}</td>
      <td><b>${eur(t.total, t.moneda)}</b></td>
      <td class="code" style="font-size:20px">${t.estado === 'pendiente' && t.pin ? esc(t.pin) : '-'}</td>
      <td>${ESTADO[t.estado] || esc(t.estado)}${t.confirmadoPor ? `<div class="muted small">${t.confirmadoPor === 'gestion' ? 'Gestión' : 'Personal'}</div>` : ''}</td>
      <td>${t.estado === 'pendiente' ? `<button class="btn primary" data-pay="${esc(t.numero)}">Cobrado</button> <button class="btn" data-void="${esc(t.numero)}">Anular</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">No hay tickets</td></tr>';
  $('tickets').querySelectorAll('[data-pay],[data-void]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.pay || b.dataset.void;
    if (b.dataset.void && !confirm('¿Anular la venta de este ticket? El pedido no se imprimirá.')) return;
    try { await api(`/api/admin/tickets/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ estado: b.dataset.pay ? 'pagado' : 'anulado' }) }); await loadTickets(); } catch (e) { alert(e.message); }
  }));
}
$('tfilter').onchange = renderTickets;
$('tsearch').oninput = renderTickets;
$('ssave').onclick = async () => { await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ storeName: $('sname').value, hotFolder: $('shot').value, shareFolder: $('sshare').value, exportRoot: $('sexport').value }) }); $('smsg').textContent = 'Guardado'; };
$('sregen').onclick = async () => {
  if (!confirm('Los kioscos dejarán de poder enviar pedidos hasta que les pongas la nueva clave. ¿Continuar?')) return;
  const r = await api('/api/admin/config', { method: 'PUT', body: JSON.stringify({ regenerateKioskKey: true }) });
  $('skey').value = r.kioskKey;
};

let timer;
async function start() {
  $('login').hidden = true; $('app').hidden = false;
  await Promise.all([loadOrders(), loadGalleries(), loadSettings(), loadTickets()]);
  clearInterval(timer);
  timer = setInterval(() => { loadOrders().catch(() => {}); loadTickets().catch(() => {}); }, 10000);
}
if (token) start().catch(logout);
