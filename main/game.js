'use strict';
/**
 * Instalar y lanzar Minecraft en los dos modos:
 *   vanilla → Minecraft limpio.
 *   plus    → NeoForge + lo que haya en plus/ del repositorio de datos (Zeroria+, mods, config, shaders…).
 * Usa @xmcl/installer (Java, Minecraft, NeoForge, librerías y recursos) y @xmcl/core (lanzar).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { DIRS, readJson, writeJson } = require('./util');
const remote = require('./remote');
const sync = require('./sync');
const settings = require('./settings');
const auth = require('./auth');

let running = null;             // proceso del juego
const STATE = path.join(DIRS.cache, 'instalado.json');

function gameDir(mode) {
  const d = path.join(DIRS.instancias, mode);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** Ejecuta una tarea de xmcl informando del progreso (0..1). */
async function runTask(task, stage, report) {
  let last = 0;
  return task.startAndWait({
    onUpdate() {
      const now = Date.now();
      if (now - last < 120) return;
      last = now;
      report(stage, task.total ? task.progress / task.total : null, task.progress, task.total);
    },
  });
}

async function javaFor(component, report) {
  const { fetchJavaRuntimeManifest, installJavaRuntimeTask } = await import('@xmcl/installer');
  const dest = path.join(DIRS.java, component);
  const exe = path.join(dest, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
  if (fs.existsSync(exe)) return exe;
  report('Descargando Java', 0);
  const manifest = await fetchJavaRuntimeManifest({ target: component });
  await runTask(installJavaRuntimeTask({ destination: dest, manifest }), 'Descargando Java', report);
  if (!fs.existsSync(exe)) throw new Error('No se pudo instalar Java.');
  return exe;
}

async function versionInstalled(id) {
  const { Version } = await import('@xmcl/core');
  try { return await Version.parse(DIRS.minecraft, id); } catch { return null; }
}

/** Deja listo el modo y devuelve { versionId, javaPath, gameDir, servidor }. */
async function prepare(mode, report) {
  const cfg = await remote.launcherConfig();
  if (cfg.mantenimiento) throw new Error(cfg.mantenimiento.mensaje || 'El servidor está en mantenimiento.');
  if (cfg.modos[mode] === false) throw new Error('Este modo no está disponible ahora mismo.');
  const inst = await import('@xmcl/installer');
  const mc = cfg.minecraft;

  // 1) Minecraft
  report('Comprobando Minecraft', null);
  let base = await versionInstalled(mc);
  if (!base) {
    const list = await inst.getVersionList();
    const meta = list.versions.find((v) => v.id === mc);
    if (!meta) throw new Error(`No existe la versión ${mc} de Minecraft.`);
    await runTask(inst.installTask(meta, DIRS.minecraft), `Descargando Minecraft ${mc}`, report);
    base = await versionInstalled(mc);
  }
  // 2) Java (el que pide esa versión)
  const component = base.javaVersion?.component || 'java-runtime-delta';
  const javaPath = await javaFor(component, report);

  // 3) NeoForge (solo Plus)
  let versionId = mc;
  if (mode === 'plus') {
    if (!cfg.neoforge) throw new Error('Falta la versión de NeoForge en launcher.json.');
    const state = readJson(STATE, {});
    const key = `neoforge-${cfg.neoforge}`;
    versionId = state[key];
    if (!versionId || !(await versionInstalled(versionId))) {
      report(`Instalando NeoForge ${cfg.neoforge}`, null);
      versionId = await runTask(inst.installNeoForgedTask('neoforge', cfg.neoforge, DIRS.minecraft, { java: javaPath }),
        `Instalando NeoForge ${cfg.neoforge}`, report);
      await writeJson(STATE, { ...state, [key]: versionId });
    }
  }

  // 4) Librerías y recursos (también repara lo que falte o esté mal)
  const resolved = await versionInstalled(versionId);
  await runTask(inst.installDependenciesTask(resolved), 'Comprobando archivos', report);

  // 5) Archivos del repositorio de datos (mods, config…)
  const dir = gameDir(mode);
  if (remote.configured()) {
    await sync.syncMode(mode, dir, (i, n, f) => report(`Sincronizando ${mode === 'plus' ? 'Zeroria+' : 'archivos'}`, n ? i / n : null, i, n, f));
  }
  if (mode === 'plus') await sync.setShaders(dir, settings.get().shaders);
  return { versionId, javaPath, gameDir: dir, servidor: cfg.servidor };
}

/** Jugar. Llama a on.progress / on.started / on.exit / on.log. */
async function play(mode, on) {
  if (running) throw new Error('El juego ya está abierto.');
  const report = (etapa, frac, actual, total, archivo) => on.progress?.({ etapa, frac, actual, total, archivo });
  report('Comprobando la cuenta', null);
  const acc = await auth.ensureActive();
  const prep = await prepare(mode, report);
  const s = settings.get();
  const { launch } = await import('@xmcl/core');
  const extraMCArgs = [];
  if (s.entrarAlServidor && prep.servidor?.host) {
    extraMCArgs.push('--quickPlayMultiplayer', `${prep.servidor.host}:${prep.servidor.puerto || 25565}`);
  }
  report('Abriendo Minecraft', 1);
  const logFile = path.join(DIRS.logs, `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  const out = fs.createWriteStream(logFile);
  const proc = await launch({
    gamePath: prep.gameDir,
    resourcePath: DIRS.minecraft,
    javaPath: prep.javaPath,
    version: prep.versionId,
    gameProfile: { id: acc.uuid, name: acc.nombre },
    accessToken: acc.mcToken,
    userType: 'msa',
    minMemory: Math.min(1024, s.ramMb),
    maxMemory: s.ramMb,
    resolution: s.pantallaCompleta ? { fullscreen: true } : { width: s.anchura, height: s.altura },
    extraJVMArgs: s.jvmArgs ? s.jvmArgs.split(/\s+/).filter(Boolean) : [],
    extraMCArgs,
    launcherName: 'Zeroria Launcher',
    launcherBrand: 'zeroria',
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

async function repair(mode) {
  await sync.forget(gameDir(mode));
  const state = readJson(STATE, {});
  if (mode === 'plus') await writeJson(STATE, Object.fromEntries(Object.entries(state).filter(([k]) => !k.startsWith('neoforge-'))));
}

module.exports = { play, repair, gameDir, isRunning: () => !!running };
