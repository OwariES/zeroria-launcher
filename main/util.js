'use strict';
/** Rutas, configuración y utilidades comunes del launcher. */
const { app } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/** Carpeta de datos del juego: %APPDATA%\.zeroria (aparte de la .minecraft normal). */
const ROOT = path.join(app.getPath('appData'), '.zeroria');
const DIRS = {
  root: ROOT,
  minecraft: path.join(ROOT, 'minecraft'),        // versiones, librerías y recursos (compartido por los dos modos)
  java: path.join(ROOT, 'java'),
  instancias: path.join(ROOT, 'instancias'),      // instancias/vanilla y instancias/plus (mundos, opciones, mods…)
  cache: path.join(ROOT, 'cache'),
  logs: path.join(ROOT, 'logs'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

/** launcher.config.json (va dentro del instalador). */
const CONFIG = readJson(path.join(__dirname, '..', 'launcher.config.json'), {});

/** SHA-1 «de git» de un archivo (el que da GitHub para cada archivo del repositorio). */
function gitBlobSha(buffer) {
  return crypto.createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex');
}

async function fileGitSha(file) {
  try { return gitBlobSha(await fsp.readFile(file)); } catch { return null; }
}

/** fetch con tiempo límite. */
async function fetchT(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'User-Agent': 'ZeroriaLauncher', ...(opts.headers || {}) } });
  } finally { clearTimeout(t); }
}

module.exports = { DIRS, CONFIG, readJson, writeJson, gitBlobSha, fileGitSha, fetchT };
