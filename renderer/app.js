// Zeroria Launcher — interfaz. Habla con el proceso principal solo a través de window.zeroria (preload.js).
if (!window.zeroria) await import('./mock.js');            // solo para ver la interfaz en un navegador
const Z = window.zeroria;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const S = { ajustes: null, cuentas: { activa: null, cuentas: [] }, launcher: null, noticias: [], enlaces: {}, jugando: false, ocupado: false };

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fecha = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const head = (uuid) => uuid ? `https://mc-heads.net/avatar/${uuid}/64` : 'img/icono.png';
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG' && !e.target.src.endsWith('img/icono.png')) e.target.src = 'img/icono.png'; }, true);

function toast(msg, kind = '', action) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = esc(msg);
  if (action) { const b = document.createElement('button'); b.textContent = action.label; b.onclick = action.run; t.append(b); }
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 9000 : 4500);
}
async function call(p) { const r = await p; if (!r.ok) throw Object.assign(new Error(r.error), { code: r.code }); return r.data; }

// ------------------------------------------------------------------ ventana y navegación
$$('[data-win]').forEach((b) => b.addEventListener('click', () => Z.ventana(b.dataset.win)));
function go(page) {
  $$('.rail-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === page));
}
$$('.rail-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));

// ------------------------------------------------------------------ fondos (se van alternando)
let fondos = ['img/fondo.jpg'], fondoI = 0;
function setFondos(list) {
  fondos = list && list.length ? list : ['img/fondo.jpg'];
  const bg = $('#hero-bg');
  bg.innerHTML = '';
  fondos.forEach((u, i) => { const l = document.createElement('div'); l.className = 'layer' + (i === 0 ? ' on' : ''); l.style.backgroundImage = `url("${u}")`; bg.append(l); });
  fondoI = 0;
}
setInterval(() => {
  const layers = $$('#hero-bg .layer');
  if (layers.length < 2) return;
  layers[fondoI].classList.remove('on');
  fondoI = (fondoI + 1) % layers.length;
  layers[fondoI].classList.add('on');
}, 12000);

// ------------------------------------------------------------------ partículas de la estación
(function seasonFx() {
  const c = $('#hero-fx'), g = c.getContext('2d');
  const m = new Date().getMonth();
  const season = m >= 2 && m <= 4 ? 'primavera' : m >= 5 && m <= 7 ? 'verano' : m >= 8 && m <= 10 ? 'otono' : 'invierno';
  const palette = { otono: ['#c8642a', '#e0a040', '#a8401f', '#d98a2b'], primavera: ['#f6b7cf', '#ffd6e6', '#e98fb4'], invierno: ['#ffffff', '#dfe8ff'], verano: ['#fff3a0', '#d8ff9a'] }[season];
  let W = 0, H = 0, parts = [];
  const resize = () => { W = c.width = c.clientWidth; H = c.height = c.clientHeight; };
  new ResizeObserver(resize).observe(c); resize();
  const N = season === 'invierno' ? 90 : season === 'verano' ? 34 : 46;
  const spawn = (init) => ({
    x: Math.random() * W, y: init ? Math.random() * H : -12, s: 2 + Math.random() * (season === 'invierno' ? 2.4 : 3.4),
    vx: (Math.random() - .5) * .4 + (season === 'otono' ? .35 : .1), vy: season === 'verano' ? (Math.random() - .5) * .25 : .35 + Math.random() * .6,
    r: Math.random() * 6.28, vr: (Math.random() - .5) * .04, ph: Math.random() * 6.28, col: palette[Math.random() * palette.length | 0],
  });
  for (let i = 0; i < N; i++) parts.push(spawn(true));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const tick = (t) => {
    g.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.ph += .02; p.x += p.vx + Math.sin(p.ph) * .35; p.y += p.vy; p.r += p.vr;
      if (season === 'verano') {
        if (p.y < H * .35) p.vy = Math.abs(p.vy); if (p.y > H) p.vy = -Math.abs(p.vy);
        g.globalAlpha = .35 + .65 * Math.max(0, Math.sin(t / 700 + p.ph * 3));
        g.fillStyle = p.col; g.shadowColor = p.col; g.shadowBlur = 8;
        g.fillRect(p.x, p.y, 2, 2); g.shadowBlur = 0;
      } else {
        g.globalAlpha = .85;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.col;
        if (season === 'invierno') g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s);
        else { g.fillRect(-p.s, -p.s / 2, p.s * 2, p.s); g.fillRect(-p.s / 2, -p.s, p.s, p.s * 2); }
        g.restore();
      }
      if (p.y > H + 14 || p.x > W + 20 || p.x < -20) Object.assign(p, spawn(false));
    }
    g.globalAlpha = 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();

// ------------------------------------------------------------------ noticias
function newsCard(n, big) {
  const b = document.createElement('button');
  b.className = 'ncard';
  b.innerHTML = `<div class="img" style="${n.imagen ? `background-image:url('${esc(n.imagen)}')` : ''}"></div>
    ${n.fijada ? '<span class="pin">Destacada</span>' : ''}
    <div class="txt"><time>${esc(n.etiqueta ? n.etiqueta + ' · ' : '')}${fecha(n.fecha)}</time><strong>${esc(n.titulo)}</strong>${big && n.resumen ? `<p>${esc(n.resumen)}</p>` : ''}</div>`;
  b.onclick = () => openNews(n);
  return b;
}
function renderNews() {
  const strip = $('#news-cards'), grid = $('#news-grid');
  strip.innerHTML = ''; grid.innerHTML = '';
  if (!S.noticias.length) {
    strip.innerHTML = grid.innerHTML = '<div class="news-empty">Todavía no hay noticias. ¡Vuelve pronto!</div>';
    return;
  }
  S.noticias.slice(0, 3).forEach((n) => strip.append(newsCard(n, false)));
  S.noticias.forEach((n) => grid.append(newsCard(n, true)));
}
/** Texto de las noticias: párrafos (línea en blanco), **negrita**, *cursiva* y [enlaces](https://…). */
function prose(t) {
  return String(t || '').split(/\n\s*\n/).map((p) => '<p>' + esc(p)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-ext>$1</a>').replace(/\n/g, '<br>') + '</p>').join('');
}
function openNews(n) {
  $('#reader-img').style.backgroundImage = n.imagen ? `url('${n.imagen}')` : '';
  $('#reader-date').textContent = fecha(n.fecha);
  $('#reader-title').textContent = n.titulo || '';
  $('#reader-text').innerHTML = prose(n.texto || n.resumen);
  const l = $('#reader-link');
  l.hidden = !n.enlace; l.onclick = () => Z.enlace(n.enlace);
  $('#reader').hidden = false;
}
$('#reader-close').onclick = () => { $('#reader').hidden = true; };
$('#reader').addEventListener('click', (e) => { if (e.target.id === 'reader') $('#reader').hidden = true; });
document.addEventListener('click', (e) => { const a = e.target.closest('a[data-ext]'); if (a) { e.preventDefault(); Z.enlace(a.href); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#reader').hidden = true; });

// ------------------------------------------------------------------ servidor
async function refreshServer() {
  const card = $('#server-card');
  try {
    const s = await call(Z.servidor());
    $('#sv-name').textContent = s.nombre || 'Zeroria';
    card.classList.toggle('on', s.online); card.classList.toggle('off', !s.online);
    if (s.online) {
      $('#sv-detail').textContent = s.motd || `En línea · ${s.ms} ms`;
      $('#sv-count').innerHTML = `${s.jugadores}<span style="color:var(--parch-500)">/${s.maximo}</span><small>jugando</small>`;
    } else {
      $('#sv-detail').textContent = 'Ahora mismo no responde';
      $('#sv-count').innerHTML = '';
    }
  } catch { card.classList.add('off'); $('#sv-detail').textContent = 'Sin conexión'; }
}

// ------------------------------------------------------------------ modos y botón de jugar
function renderModes() {
  const modos = S.launcher?.modos || { vanilla: true, plus: true };
  $$('.mode').forEach((b) => {
    const m = b.dataset.mode;
    b.disabled = modos[m] === false;
    b.classList.toggle('active', S.ajustes.modo === m);
  });
  $('#play-sub').textContent = S.ajustes.modo === 'plus' ? 'con Zeroria+' : 'a Zeroria';
  renderSpecs();
  updatePlay();
}
function renderSpecs() {
  const plus = S.ajustes.modo === 'plus';
  $('#spec-mc').textContent = S.launcher?.minecraft || '—';
  $('#spec-neo-row').hidden = !plus;
  $('#spec-neo').textContent = S.launcher?.neoforge || '—';
  $('#spec-ram').textContent = `${(S.ajustes.ramMb / 1024).toFixed(1).replace('.0', '')} GB`;
  $('#spec-entry').textContent = S.ajustes.entrarAlServidor ? `Directa a ${S.launcher?.servidor?.nombre || 'Zeroria'}` : 'Menú principal';
}
$$('.mode').forEach((b) => b.addEventListener('click', async () => {
  if (S.ocupado) return;
  S.ajustes = await call(Z.guardarAjustes({ modo: b.dataset.mode }));
  renderModes();
}));

function updatePlay() {
  const btn = $('#play');
  const mant = S.launcher?.mantenimiento;
  btn.classList.toggle('locked', !!mant && !S.ocupado);
  if (S.ocupado) return;
  btn.disabled = !!mant || S.jugando;
  btn.classList.remove('busy');
  $('#play-fill').style.width = '0'; $('#play-fill').classList.remove('indet');
  if (mant) { $('#play-label').textContent = 'Mantenimiento'; $('#play-sub').textContent = ''; $('#play-status').textContent = mant.mensaje || ''; }
  else if (S.jugando) { $('#play-label').textContent = 'Jugando'; $('#play-sub').textContent = 'Minecraft está abierto'; }
  else { $('#play-label').textContent = 'Jugar'; $('#play-sub').textContent = S.ajustes.modo === 'plus' ? 'con Zeroria+' : 'a Zeroria'; }
}

$('#play').addEventListener('click', async () => {
  if (S.ocupado || S.jugando) return;
  if (!S.cuentas.activa) { $('#welcome').hidden = false; return; }
  S.ocupado = true;
  const btn = $('#play');
  btn.classList.add('busy'); btn.disabled = true;
  $('#play-label').textContent = 'Preparando…'; $('#play-sub').textContent = ''; $('#play-status').textContent = '';
  $('#play-fill').classList.add('indet');
  try {
    await call(Z.jugar(S.ajustes.modo));
  } catch (e) {
    S.ocupado = false;
    if (e.code === 'caducada' || e.code === 'sin-cuenta') $('#welcome').hidden = false;
    toast(e.message, 'error');
    updatePlay();
  }
});
Z.onProgreso((p) => {
  if (!S.ocupado) return;
  $('#play-label').textContent = p.etapa;
  const fill = $('#play-fill');
  if (p.frac == null) fill.classList.add('indet');
  else { fill.classList.remove('indet'); fill.style.width = `${Math.round(p.frac * 100)}%`; }
  $('#play-sub').textContent = p.frac != null ? `${Math.round(p.frac * 100)} %` : '';
  $('#play-status').textContent = p.archivo || (p.total ? `${p.actual} de ${p.total}` : '');
});
Z.onJuego((j) => {
  if (j.estado === 'abierto') { S.ocupado = false; S.jugando = true; $('#play-status').textContent = ''; updatePlay(); }
  if (j.estado === 'cerrado') {
    S.ocupado = false; S.jugando = false; updatePlay();
    if (j.code && j.code !== 0) {
      toast('Minecraft se ha cerrado con un error.', 'error', { label: 'Ver registro', run: () => Z.abrirArchivo(j.crash || j.juegoLog || j.log) });
    }
  }
});

// ------------------------------------------------------------------ avisos y evento
function renderBanner() {
  const a = S.launcher?.aviso, el = $('#aviso');
  el.hidden = !a?.texto;
  if (a?.texto) { el.textContent = a.texto; el.classList.toggle('link', !!a.enlace); el.onclick = a.enlace ? () => Z.enlace(a.enlace) : null; }
  const ev = S.launcher?.evento, box = $('#evento');
  const t = ev?.fecha ? Date.parse(ev.fecha) : NaN;
  box.hidden = !ev || isNaN(t) || t < Date.now() - 3 * 3600e3;
  if (!box.hidden) {
    $('.evento-label', box).textContent = ev.titulo || 'Próximo evento';
    const upd = () => {
      const d = t - Date.now();
      if (d <= 0) { $('.evento-cuenta', box).textContent = '¡Ahora!'; return; }
      const dd = Math.floor(d / 864e5), hh = Math.floor(d / 36e5) % 24, mm = Math.floor(d / 6e4) % 60, ss = Math.floor(d / 1e3) % 60;
      $('.evento-cuenta', box).textContent = (dd ? `${dd}d ` : '') + `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    };
    upd(); clearInterval(renderBanner.t); renderBanner.t = setInterval(upd, 1000);
  }
  if (S.launcher?.lema) $('#tagline').textContent = S.launcher.lema;
}

// ------------------------------------------------------------------ cuentas
function renderAccounts() {
  const acc = S.cuentas.cuentas.find((c) => c.uuid === S.cuentas.activa);
  $('#rail-avatar').src = acc ? head(acc.uuid) : 'img/icono.png';
  $('#panel-avatar').src = acc ? head(acc.uuid) : 'img/icono.png';
  $('#panel-name').textContent = acc ? acc.nombre : 'Sin cuenta';
  const box = $('#accounts');
  box.innerHTML = '';
  if (!S.cuentas.cuentas.length) box.innerHTML = '<div class="news-empty">Aún no has añadido ninguna cuenta.</div>';
  for (const c of S.cuentas.cuentas) {
    const el = document.createElement('div');
    el.className = 'acc' + (c.uuid === S.cuentas.activa ? ' active' : '');
    el.innerHTML = `<img src="${head(c.uuid)}" alt=""><div class="who"><strong>${esc(c.nombre)}</strong><span>${c.uuid === S.cuentas.activa ? 'En uso' : 'Cuenta de Microsoft'}</span></div>
      <div class="acts">${c.uuid === S.cuentas.activa ? '' : '<button class="use">Usar</button>'}<button class="rm" title="Quitar">Quitar</button></div>`;
    el.querySelector('.use')?.addEventListener('click', async () => { S.cuentas = await call(Z.cuentas.elegir(c.uuid)); renderAccounts(); });
    el.querySelector('.rm').addEventListener('click', async () => { S.cuentas = await call(Z.cuentas.quitar(c.uuid)); renderAccounts(); });
    box.append(el);
  }
  $('#welcome').hidden = !!S.cuentas.activa;
}
async function addAccount() {
  try {
    S.cuentas = await call(Z.cuentas.anadir());
    renderAccounts();
    const acc = S.cuentas.cuentas.find((c) => c.uuid === S.cuentas.activa);
    toast(`¡Hola, ${acc?.nombre || 'aventurero'}!`, 'ok');
  } catch (e) { if (e.code !== 'cancelado') toast(e.message, 'error'); }
}
$('#add-account').onclick = addAccount;
$('#welcome-login').onclick = addAccount;
$('#welcome-buy').onclick = () => Z.enlace(S.enlaces.comprar || 'https://www.minecraft.net');

// ------------------------------------------------------------------ ajustes
function renderSettings() {
  const a = S.ajustes;
  const ram = $('#ram');
  ram.max = Math.max(2048, Math.floor((a.ramTotalMb - 1024) / 512) * 512);
  ram.value = a.ramMb;
  const showRam = () => { $('#ram-out').textContent = `${(ram.value / 1024).toFixed(1).replace('.0', '')} GB`; ram.style.setProperty('--p', `${(ram.value - ram.min) / (ram.max - ram.min) * 100}%`); };
  showRam();
  $('#ram-max').textContent = `${(ram.max / 1024).toFixed(0)} GB`;
  ram.oninput = showRam;
  ram.onchange = () => save({ ramMb: Number(ram.value) });
  $('#fullscreen').checked = a.pantallaCompleta;
  $('#res-row').classList.toggle('off', a.pantallaCompleta);
  $('#fullscreen').onchange = (e) => { $('#res-row').classList.toggle('off', e.target.checked); save({ pantallaCompleta: e.target.checked }); };
  $('#width').value = a.anchura; $('#height').value = a.altura;
  $('#width').onchange = (e) => save({ anchura: Number(e.target.value) });
  $('#height').onchange = (e) => save({ altura: Number(e.target.value) });
  $('#direct').checked = a.entrarAlServidor;
  $('#direct').onchange = (e) => save({ entrarAlServidor: e.target.checked });
  $('#shaders').checked = a.shaders;
  $('#shaders').onchange = (e) => save({ shaders: e.target.checked });
  $('#jvm').value = a.jvmArgs;
  $('#jvm').onchange = (e) => save({ jvmArgs: e.target.value.trim() });
  $$('#onplay button').forEach((b) => { b.classList.toggle('on', b.dataset.v === a.alJugar); b.onclick = () => save({ alJugar: b.dataset.v }); });
}
async function save(patch) {
  try { S.ajustes = await call(Z.guardarAjustes(patch)); renderSettings(); renderSpecs(); }
  catch (e) { toast(e.message, 'error'); }
}
$$('[data-folder]').forEach((b) => b.addEventListener('click', () => Z.carpeta(b.dataset.folder)));
$('#repair').onclick = async () => {
  await call(Z.reparar(S.ajustes.modo));
  toast('Listo: la próxima vez que juegues se comprobarán y repararán todos los archivos.', 'ok');
};

// ------------------------------------------------------------------ actualización del launcher
Z.onActualizacion((u) => {
  const chip = $('#update-chip');
  chip.hidden = false;
  if (u.estado === 'lista') {
    chip.classList.add('ready');
    chip.textContent = `Actualizar a ${u.version} y reiniciar`;
    chip.onclick = () => Z.instalarActualizacion();
  } else {
    chip.textContent = `Descargando actualización${u.frac != null ? ` · ${Math.round(u.frac * 100)} %` : '…'}`;
  }
});

// ------------------------------------------------------------------ arranque
(async () => {
  try {
    const ini = await call(Z.inicio());
    S.ajustes = ini.ajustes; S.cuentas = ini.cuentas; S.enlaces = ini.enlaces || {};
    $('#app-version').textContent = `v${ini.version}`;
    renderSettings(); renderAccounts(); renderModes();
    if (!ini.datosConfigurados) toast('Falta configurar el repositorio de datos (launcher.config.json → datos).', 'error');
  } catch (e) { toast(e.message, 'error'); }
  try { S.launcher = await call(Z.launcher()); renderModes(); renderBanner(); } catch { /* sin conexión */ }
  refreshServer(); setInterval(refreshServer, 30000);
  try {
    const c = await call(Z.contenido());
    S.noticias = c.noticias || []; renderNews(); setFondos(c.fondos);
    if (c.sinConexion) toast('Sin conexión: se muestran las últimas noticias guardadas.');
  } catch { renderNews(); setFondos([]); }
})();
