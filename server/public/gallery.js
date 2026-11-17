const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('gtoken') || '';
let photos = [];
let current = -1;

async function api(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/g/login') { logout(); throw new Error(j.error); }
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}

const src = (p, size) => `/api/g/file/${p.id}?size=${size}&t=${encodeURIComponent(token)}`;

async function load() {
  const d = await api('/api/g/photos');
  photos = d.photos;
  $('title').textContent = d.title;
  $('login').hidden = true;
  $('app').hidden = false;
  if (d.allowDownload) {
    $('zip').hidden = false;
    $('zip').href = `/api/g/zip?t=${encodeURIComponent(token)}`;
    $('zipfav').href = `/api/g/zip?fav=1&t=${encodeURIComponent(token)}`;
  }
  render();
}

function render() {
  const g = $('grid');
  g.innerHTML = '';
  photos.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'ph';
    const img = document.createElement('img');
    img.loading = 'lazy'; img.src = src(p, 'thumb'); img.alt = p.name;
    img.onclick = () => open(i);
    const b = document.createElement('button');
    b.className = 'fav' + (p.favorite ? ' on' : '');
    b.textContent = '★';
    b.title = 'Favorita';
    b.onclick = (e) => { e.stopPropagation(); p.favorite = !p.favorite; saveFavs(); render(); };
    d.append(img, b);
    g.append(d);
  });
  const n = photos.filter((p) => p.favorite).length;
  $('favcount').textContent = `${photos.length} fotos · ${n} favoritas`;
  $('zipfav').hidden = $('zip').hidden || !n;
}

let favTimer;
function saveFavs() {
  clearTimeout(favTimer);
  favTimer = setTimeout(() => api('/api/g/favorites', { method: 'POST', body: JSON.stringify({ ids: photos.filter((p) => p.favorite).map((p) => p.id) }) }).catch(() => {}), 400);
}

function open(i) { current = (i + photos.length) % photos.length; $('lbi').src = src(photos[current], 'preview'); $('lb').hidden = false; }
$('lbx').onclick = () => { $('lb').hidden = true; };
$('lbp').onclick = () => open(current - 1);
$('lbn').onclick = () => open(current + 1);
document.addEventListener('keydown', (e) => {
  if ($('lb').hidden) return;
  if (e.key === 'Escape') $('lb').hidden = true;
  if (e.key === 'ArrowLeft') open(current - 1);
  if (e.key === 'ArrowRight') open(current + 1);
});

function logout() { token = ''; sessionStorage.removeItem('gtoken'); $('app').hidden = true; $('login').hidden = false; }
$('out').onclick = logout;

$('go').onclick = async () => {
  $('lerr').textContent = '';
  try {
    const r = await api('/api/g/login', { method: 'POST', body: JSON.stringify({ code: $('code').value, password: $('pass').value }) });
    token = r.token;
    sessionStorage.setItem('gtoken', token);
    await load();
  } catch (e) { $('lerr').textContent = e.message; }
};
$('pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('go').click(); });
const qcode = new URLSearchParams(location.search).get('c');
if (qcode) $('code').value = qcode;
if (token) load().catch(logout);
