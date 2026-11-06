'use strict';
/**
 * Instalar y lanzar Minecraft en los dos modos:
 *   vanilla → Minecraft limpio.
 *   plus    → NeoForge + lo que haya en plus/ del repositorio de datos (Zeroria+, mods, config, shaders…).
 * La descarga y el arranque los hace mc.js (sin librerías de terceros).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { DIRS, readJson, writeJson } = require('./util');
const remote = require('./remote');
const sync = require('./sync');
const settings = require('./settings');
const auth = require('./auth');
const mc = require('./mc');

let running = null;             // proceso del juego
const STATE = path.join(DIRS.cache, 'instalado.json');

function gameDir(mode) {
  const d = path.join(DIRS.instancias, mode);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Deja listo el modo y devuelve { versionId, javaPath, gameDir, natDir, servidor }. `deep` = comprobar el SHA-1 de todo. */
async function prepare(mode, report, deep = false) {
  const cfg = await remote.launcherConfig();
  if (cfg.mantenimiento) throw new Error(cfg.mantenimiento.mensaje || 'El servidor está en mantenimiento.');
  if (cfg.modos[mode] === false) throw new Error('Este modo no está disponible ahora mismo.');
  const mcId = cfg.minecraft;
  const state = readJson(STATE, {});
  deep = deep || !!state.reparar?.[mode];

  // 1) Minecraft y el Java que pide
  const vanilla = await mc.installVanilla(DIRS.minecraft, mcId, report, deep);
  const javaPath = await mc.installJava(DIRS.java, vanilla.javaVersion?.component || 'java-runtime-delta', report);

  // 2) NeoForge (solo Plus)
  let versionId = mcId;
  if (mode === 'plus') {
    if (!cfg.neoforge) throw new Error('Falta la versión de NeoForge en launcher.json.');
    versionId = await mc.installNeoForge(DIRS.minecraft, mcId, cfg.neoforge, javaPath, report);
  }

  // 3) Librerías, nativas y recursos (lo que falte o esté mal)
  const resolved = await mc.resolveVersion(DIRS.minecraft, versionId);
  const natDir = await mc.installLibraries(DIRS.minecraft, resolved, report, deep);
  await mc.installAssets(DIRS.minecraft, resolved, report, deep);

  // 4) Archivos del repositorio de datos (mods, config…)
  const dir = gameDir(mode);
  if (remote.configured()) {
    await sync.syncMode(mode, dir, (i, n, f) => report(`Sincronizando ${mode === 'plus' ? 'Zeroria+' : 'archivos'}`, n ? i / n : null, i, n, f));
  }
  if (mode === 'plus') await sync.setShaders(dir, settings.get().shaders);
  if (state.reparar?.[mode]) { delete state.reparar[mode]; await writeJson(STATE, state); }
  return { versionId, javaPath, gameDir: dir, natDir, servidor: cfg.servidor };
}

/** Jugar. Llama a on.progress / on.started / on.exit / on.log. */
async function play(mode, on) {
  if (running) throw new Error('El juego ya está abierto.');
  const report = (etapa, frac, actual, total, archivo) => on.progress?.({ etapa, frac, actual, total, archivo });
  report('Comprobando la cuenta', null);
  const acc = await auth.ensureActive();
  const prep = await prepare(mode, report);
  const s = settings.get();
  const server = s.entrarAlServidor && prep.servidor?.host ? `${prep.servidor.host}:${prep.servidor.puerto || 25565}` : null;
  report('Abriendo Minecraft', 1);
  const logFile = path.join(DIRS.logs, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const out = fs.createWriteStream(logFile);
  const proc = await mc.launch({
    mcDir: DIRS.minecraft, versionId: prep.versionId, java: prep.javaPath, gameDir: prep.gameDir, natDir: prep.natDir,
    account: acc, ramMb: s.ramMb, jvmArgs: s.jvmArgs ? s.jvmArgs.split(/\s+/).filter(Boolean) : [],
    resolution: { width: s.anchura, height: s.altura, fullscreen: s.pantallaCompleta }, server,
    launcherVersion: require('electron').app.getVersion(),
  });
  running = proc;
  let started = false;
  const onData = (chunk) => {
    out.write(chunk);
    if (!started && /Setting user|LWJGL|Backend library|Loading Minecraft/.test(chunk.toString())) {
      started = true; on.started?.();
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  setTimeout(() => { if (!started && running === proc) { started = true; on.started?.(); } }, 20000);
  proc.on('exit', (code) => {
    running = null;
    out.end();
    on.exit?.({ code, log: logFile, juegoLog: path.join(prep.gameDir, 'logs', 'latest.log'), crash: code !== 0 ? lastCrash(prep.gameDir) : null });
  });
}

function lastCrash(dir) {
  try {
    const d = path.join(dir, 'crash-reports');
    const f = fs.readdirSync(d).filter((x) => x.endsWith('.txt')).map((x) => path.join(d, x))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    return f && Date.now() - fs.statSync(f).mtimeMs < 5 * 60 * 1000 ? f : null;
  } catch { return null; }
}

/** «Reparar»: la próxima vez se comprueba el SHA-1 de todo y se vuelve a bajar lo que no esté bien. */
async function repair(mode) {
  await sync.forget(gameDir(mode));
  const state = readJson(STATE, {});
  state.reparar = { ...(state.reparar || {}), [mode]: true };
  await writeJson(STATE, state);
}

module.exports = { play, repair, gameDir, isRunning: () => !!running };
