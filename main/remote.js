'use strict';
/**
 * Repositorio de datos de GitHub (público): de ahí salen launcher.json, noticias.json, las imágenes, los fondos y los
 * archivos de cada modo (plus/…, vanilla/…). Se pide la lista de archivos con su «sha» (una huella del contenido) y
 * solo se descarga lo que ha cambiado. Todo se guarda en cache/ para que el launcher funcione sin internet.
 *
 * Límite de GitHub sin cuenta: 60 consultas a la hora por conexión. Con la etiqueta ETag, las consultas que no han
 * cambiado no cuentan; además, la lista se reutiliza durante 2 minutos.
 */
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { DIRS, CONFIG, readJson, writeJson, gitBlobSha, fileGitSha, fetchT } = require('./util');

const D = CONFIG.datos || {};
const TREE_CACHE = path.join(DIRS.cache, 'arbol.json');
const DATA_DIR = path.join(DIRS.cache, 'datos');

let memo = null;          // { at, files: Map(path → {sha,size}) }

function configured() { return D.usuario && !String(D.usuario).startsWith('TU_') && D.repositorio; }

/** Carpeta del repositorio donde están los datos ("" = la raíz). */
const PREFIX = D.carpeta ? String(D.carpeta).replace(/^\/+|\/+$/g, '') + '/' : '';

function rawUrl(p) {
  return `https://raw.githubusercontent.com/${D.usuario}/${D.repositorio}/${D.rama || 'main'}/${(PREFIX + p).split('/').map(encodeURIComponent).join('/')}`;
}

/** Lista de archivos del repositorio (path → {sha, size}). Sin conexión, la última que se descargó. */
async function tree(force = false) {
  if (!configured()) return new Map();
  if (!force && memo && Date.now() - memo.at < 120000) return memo.files;
  const cached = readJson(TREE_CACHE, null);
  try {
    const r = await fetchT(`https://api.github.com/repos/${D.usuario}/${D.repositorio}/git/trees/${D.rama || 'main'}?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json', ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) },
    });
    if (r.status === 304 && cached) {
      memo = { at: Date.now(), files: new Map(cached.files) };
    } else if (r.ok) {
      const j = await r.json();
      const files = (j.tree || []).filter((e) => e.type === 'blob' && e.path.startsWith(PREFIX))
        .map((e) => [e.path.slice(PREFIX.length), { sha: e.sha, size: e.size }]);
      await writeJson(TREE_CACHE, { etag: r.headers.get('etag'), files });
      memo = { at: Date.now(), files: new Map(files) };
    } else {
      throw new Error(`GitHub respondió ${r.status}`);
    }
  } catch (e) {
    if (!cached) throw new Error(`No se pudo leer el repositorio de datos (${e.message}).`);
    memo = { at: Date.now() - 60000, files: new Map(cached.files), offline: true };
  }
  return memo.files;
}

/** Descarga un archivo del repositorio a `dest` (si no está ya igual) y comprueba su huella. */
async function download(p, info, dest) {
  if ((await fileGitSha(dest)) === info.sha) return false;
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchT(rawUrl(p), {}, 120000);
      if (!r.ok) throw new Error(`${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (gitBlobSha(buf) !== info.sha) throw new Error('el archivo ha llegado incompleto');
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest + '.part', buf);
      await fsp.rename(dest + '.part', dest);
      return true;
    } catch (e) { last = e; }
  }
  throw new Error(`No se pudo descargar ${p}: ${last.message}`);
}

/** Un archivo del repositorio guardado en cache/datos (devuelve su ruta local o null). */
async function cachedFile(p) {
  const files = await tree().catch(() => new Map());
  const local = path.join(DATA_DIR, p);
  const info = files.get(p);
  if (info) {
    try { await download(p, info, local); } catch { /* se usa la copia que haya */ }
  }
  try { await fsp.access(local); return local; } catch { return null; }
}

async function cachedJson(p, fallback) {
  const f = await cachedFile(p);
  if (!f) return fallback;
  try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return fallback; }
}

/** launcher.json del repositorio, encima de los valores por defecto de launcher.config.json. */
async function launcherConfig() {
  const def = CONFIG.porDefecto || {};
  const j = await cachedJson('launcher.json', {});
  return {
    minecraft: j.minecraft || def.minecraft || '1.21.11',
    neoforge: j.neoforge || def.neoforge,
    servidor: { ...(def.servidor || {}), ...(j.servidor || {}) },
    mantenimiento: j.mantenimiento || null,           // { "mensaje": "…" } bloquea el botón de jugar
    aviso: j.aviso || null,                           // { "texto": "…", "enlace": "…" } franja arriba
    evento: j.evento || null,                         // { "titulo": "…", "fecha": "2026-12-01T20:00:00+01:00" }
    versionMinima: j.versionMinimaLauncher || null,
    modos: { vanilla: true, plus: true, ...(j.modos || {}) },
  };
}

/** Noticias (más nuevas primero) y fondos, con las imágenes ya descargadas (rutas file://). */
async function content() {
  const files = await tree().catch(() => new Map());
  const news = await cachedJson('noticias.json', []);
  const out = [];
  for (const n of (Array.isArray(news) ? news : [])) {
    if (n.publicar && Date.parse(n.publicar) > Date.now()) continue;        // programada
    let img = null;
    if (n.imagen && !/^https?:/.test(n.imagen)) {
      const f = await cachedFile(n.imagen);
      img = f ? pathToFileURL(f).href : null;
    } else if (n.imagen) img = n.imagen;
    out.push({ ...n, imagen: img });
  }
  out.sort((a, b) => (b.fijada ? 1 : 0) - (a.fijada ? 1 : 0) || String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const fondos = [];
  for (const p of [...files.keys()].filter((k) => /^fondos\/.+\.(png|jpe?g|webp)$/i.test(k)).sort()) {
    const f = await cachedFile(p);
    if (f) fondos.push(pathToFileURL(f).href);
  }
  return { noticias: out, fondos, sinConexion: !!memo?.offline, configurado: !!configured() };
}

module.exports = { tree, download, launcherConfig, content, configured };
