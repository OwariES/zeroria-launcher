'use strict';
/**
 * Pone en la instancia de un modo (instancias/plus o instancias/vanilla) los archivos de su carpeta del repositorio
 * de datos (plus/… o vanilla/…):
 *  - mods/: copia EXACTA del repositorio (los .jar que no estén allí se quitan: así se actualizan y se borran solos).
 *  - options.txt: solo la primera vez (son los ajustes iniciales; luego son del jugador).
 *  - lo demás (config/, resourcepacks/, shaderpacks/…): se pone si falta y se actualiza cuando cambia en el
 *    repositorio; lo que se quita del repositorio se borra.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const remote = require('./remote');
const { readJson, writeJson } = require('./util');

const FIRST_TIME_ONLY = new Set(['options.txt', 'optionsshaders.txt']);

async function syncMode(mode, gameDir, onProgress) {
  const files = await remote.tree(true);
  const prefix = `${mode}/`;
  const wanted = [...files.entries()].filter(([p]) => p.startsWith(prefix) && !/(^|\/)(\.gitkeep|README\.md|LEEME\.md)$/i.test(p));
  const stateFile = path.join(gameDir, '.zeroria-sync.json');
  const state = readJson(stateFile, {});
  const next = {};
  let i = 0;
  const queue = [...wanted];
  const work = async () => {
    while (queue.length) {
      const [p, info] = queue.shift();
      const rel = p.slice(prefix.length);
      const dest = path.join(gameDir, rel);
      next[rel] = info.sha;
      if (FIRST_TIME_ONLY.has(rel) && fs.existsSync(dest)) { onProgress?.(++i, wanted.length, rel); continue; }
      await remote.download(p, info, dest);
      onProgress?.(++i, wanted.length, rel);
    }
  };
  await Promise.all(Array.from({ length: 4 }, work));
  // lo que ya no está en el repositorio
  for (const rel of Object.keys(state)) {
    if (!(rel in next) && !FIRST_TIME_ONLY.has(rel)) await fsp.rm(path.join(gameDir, rel), { force: true });
  }
  const modsDir = path.join(gameDir, 'mods');
  if (wanted.some(([p]) => p.startsWith(prefix + 'mods/')) || fs.existsSync(modsDir)) {
    for (const f of await fsp.readdir(modsDir).catch(() => [])) {
      if (f.endsWith('.jar') && !(`mods/${f}` in next)) await fsp.rm(path.join(modsDir, f), { force: true });
    }
  }
  await writeJson(stateFile, next);
  return wanted.length;
}

/** «Reparar»: olvida lo sincronizado; la próxima vez se comprueba y se vuelve a bajar todo lo que no esté igual. */
async function forget(gameDir) {
  await fsp.rm(path.join(gameDir, '.zeroria-sync.json'), { force: true });
}

/** Shaders sí/no (Iris): config/iris.properties → enableShaders. */
async function setShaders(gameDir, on) {
  const f = path.join(gameDir, 'config', 'iris.properties');
  let text = '';
  try { text = await fsp.readFile(f, 'utf8'); } catch { /* no existe aún */ }
  const line = `enableShaders=${on ? 'true' : 'false'}`;
  text = /^enableShaders=.*$/m.test(text) ? text.replace(/^enableShaders=.*$/m, line) : (text ? text.replace(/\s*$/, '\n') : '') + line + '\n';
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, text);
}

module.exports = { syncMode, forget, setShaders };
