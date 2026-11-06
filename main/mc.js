'use strict';
/**
 * Instalar y lanzar Minecraft sin librerías de terceros (como el launcher oficial):
 *  - versiones, librerías, recursos y registros, de los servidores de Mojang (comprobando el SHA-1 de cada archivo);
 *  - Java, el que pide cada versión (el mismo «runtime» que usa el launcher oficial);
 *  - NeoForge, con su instalador oficial sin ventana (--installClient);
 *  - el comando para lanzar, a partir del JSON de la versión (reglas, argumentos y classpath).
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const zip = require('./zip');
const { fetchT } = require('./util');

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_ALL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const RESOURCES = 'https://resources.download.minecraft.net';
const NEOFORGE = (v) => `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`;
const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch;                                  // 'x64', 'arm64', 'ia32'

// ------------------------------------------------------------------ descargas

async function sha1File(file) {
  return new Promise((resolve) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', () => resolve(null));
  });
}

/** ¿Está ya bien? (mismo tamaño y, si se sabe, mismo SHA-1) */
async function ok(file, sha1, size, deep) {
  try {
    const st = await fsp.stat(file);
    if (size != null && st.size !== size) return false;
    if (!sha1 || !deep) return size != null || st.size > 0;
    return (await sha1File(file)) === sha1;
  } catch { return false; }
}

async function download(url, file, sha1, size) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetchT(url, {}, 180000);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (sha1 && crypto.createHash('sha1').update(buf).digest('hex') !== sha1) throw new Error('archivo incompleto');
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file + '.part', buf);
      await fsp.rename(file + '.part', file);
      return buf.length;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 600 * (i + 1))); }
  }
  throw new Error(`No se pudo descargar ${path.basename(file)} (${last.message}).`);
}

/** Descarga una lista [{ url, file, sha1, size }] con varias a la vez; progress(hechos, total). */
async function downloadAll(list, progress, deep = false, parallel = 12) {
  const todo = [];
  for (const it of list) if (!(await ok(it.file, it.sha1, it.size, deep))) todo.push(it);
  let done = list.length - todo.length;
  progress?.(done, list.length);
  const q = [...todo];
  const work = async () => {
    while (q.length) {
      const it = q.shift();
      await download(it.url, it.file, it.sha1, it.size);
      progress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, Math.max(1, q.length)) }, work));
}

async function getJson(url) {
  const r = await fetchT(url, {}, 30000);
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

// ------------------------------------------------------------------ reglas del JSON de versión

function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== OS) match = false;
      if (r.os.arch && !((r.os.arch === 'x86' && ARCH === 'ia32') || r.os.arch === ARCH)) match = false;
    }
    if (r.features) for (const [k, v] of Object.entries(r.features)) if (!!features[k] !== v) match = false;
    if (match) allow = r.action === 'allow';
  }
  return allow;
}

/** "grupo:artefacto:versión[:clasificador][@ext]" → ruta en libraries/ */
function libPath(name) {
  let [coords, ext = 'jar'] = name.split('@');
  const [g, a, v, c] = coords.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

/** Las nativas de otra arquitectura (p. ej. natives-windows-arm64 en un PC x64) no se usan. */
function wrongArch(name) {
  const c = name.split(':')[3] || '';
  if (!c.startsWith('natives-')) return false;
  if (/-arm64$/.test(c)) return ARCH !== 'arm64';
  if (/-x86$/.test(c)) return ARCH !== 'ia32';
  return ARCH === 'arm64' && OS === 'windows' && false;
}

// ------------------------------------------------------------------ versiones

function versionFile(mcDir, id) { return path.join(mcDir, 'versions', id, `${id}.json`); }

async function readVersion(mcDir, id) {
  try { return JSON.parse(await fsp.readFile(versionFile(mcDir, id), 'utf8')); } catch { return null; }
}

/** El JSON ya «resuelto»: con lo heredado de la versión padre (NeoForge hereda de la de Minecraft). */
async function resolveVersion(mcDir, id) {
  const v = await readVersion(mcDir, id);
  if (!v) return null;
  if (!v.inheritsFrom) return { ...v, jarId: v.jar || v.id };
  const parent = await resolveVersion(mcDir, v.inheritsFrom);
  if (!parent) return null;
  const seen = new Set();
  const libs = [];
  for (const l of [...(v.libraries || []), ...(parent.libraries || [])]) {
    const [g, a, , c] = l.name.split(':');
    const key = `${g}:${a}:${c || ''}`;
    if (seen.has(key)) continue;
    seen.add(key); libs.push(l);
  }
  return {
    ...parent, ...v,
    libraries: libs,
    arguments: {
      jvm: [...(parent.arguments?.jvm || []), ...(v.arguments?.jvm || [])],
      game: [...(parent.arguments?.game || []), ...(v.arguments?.game || [])],
    },
    assetIndex: v.assetIndex || parent.assetIndex, assets: v.assets || parent.assets,
    downloads: parent.downloads, javaVersion: v.javaVersion || parent.javaVersion, logging: parent.logging,
    jarId: parent.jarId,
  };
}

/** Minecraft «tal cual»: JSON, cliente, librerías, recursos y registro. */
async function installVanilla(mcDir, id, report, deep) {
  let v = await readVersion(mcDir, id);
  if (!v) {
    report('Buscando Minecraft ' + id, null);
    const man = await getJson(MANIFEST);
    const meta = man.versions.find((x) => x.id === id);
    if (!meta) throw new Error(`No existe la versión ${id} de Minecraft.`);
    await download(meta.url, versionFile(mcDir, id), meta.sha1);
    v = await readVersion(mcDir, id);
  }
  await fsp.writeFile(path.join(mcDir, 'launcher_profiles.json'), '{"profiles":{}}').catch(() => {});
  const c = v.downloads.client;
  await downloadAll([{ url: c.url, file: path.join(mcDir, 'versions', id, `${id}.jar`), sha1: c.sha1, size: c.size }],
    (d, n) => report(`Descargando Minecraft ${id}`, n ? d / n : null), deep);
  return v;
}

/** Librerías de una versión resuelta (y sus nativas, ya sacadas a su carpeta). */
async function installLibraries(mcDir, v, report, deep) {
  const list = [];
  for (const l of v.libraries) {
    if (!rulesAllow(l.rules) || wrongArch(l.name)) continue;
    const art = l.downloads?.artifact;
    if (art?.url) list.push({ url: art.url, file: path.join(mcDir, 'libraries', art.path || libPath(l.name)), sha1: art.sha1, size: art.size });
    else if (!art && l.url) list.push({ url: l.url.replace(/\/?$/, '/') + libPath(l.name), file: path.join(mcDir, 'libraries', libPath(l.name)) });
    // nativas al estilo antiguo (versiones viejas)
    const cls = l.natives?.[OS]?.replace('${arch}', ARCH === 'ia32' ? '32' : '64');
    const nat = cls && l.downloads?.classifiers?.[cls];
    if (nat) list.push({ url: nat.url, file: path.join(mcDir, 'libraries', nat.path), sha1: nat.sha1, size: nat.size, native: true });
  }
  await downloadAll(list, (d, n) => report('Descargando librerías', n ? d / n : null, d, n), deep);
  // nativas: las de clasificador natives-* y las antiguas
  const natDir = path.join(mcDir, 'versions', v.id, 'natives');
  await fsp.mkdir(natDir, { recursive: true });
  for (const l of v.libraries) {
    if (!rulesAllow(l.rules) || wrongArch(l.name)) continue;
    const c = l.name.split(':')[3] || '';
    const art = l.downloads?.artifact;
    if (c.startsWith('natives-') && art) {
      await zip.extract(path.join(mcDir, 'libraries', art.path || libPath(l.name)), natDir, (n) => /\.(dll|so|dylib|jnilib)$/i.test(n)).catch(() => {});
    }
  }
  for (const it of list.filter((x) => x.native)) await zip.extract(it.file, natDir).catch(() => {});
  return natDir;
}

/** Recursos (sonidos, idiomas…) y el archivo de registro. */
async function installAssets(mcDir, v, report, deep) {
  const ai = v.assetIndex;
  const idxFile = path.join(mcDir, 'assets', 'indexes', `${ai.id}.json`);
  await downloadAll([{ url: ai.url, file: idxFile, sha1: ai.sha1, size: ai.size }], null, true);
  const idx = JSON.parse(await fsp.readFile(idxFile, 'utf8'));
  const list = Object.values(idx.objects).map((o) => ({
    url: `${RESOURCES}/${o.hash.slice(0, 2)}/${o.hash}`, file: path.join(mcDir, 'assets', 'objects', o.hash.slice(0, 2), o.hash), sha1: o.hash, size: o.size,
  }));
  await downloadAll(list, (d, n) => report('Descargando recursos', n ? d / n : null, d, n), deep, 16);
  const lg = v.logging?.client?.file;
  if (lg) await downloadAll([{ url: lg.url, file: path.join(mcDir, 'assets', 'log_configs', lg.id), sha1: lg.sha1, size: lg.size }], null, true);
}

// ------------------------------------------------------------------ Java

async function installJava(javaDir, component, report) {
  const dest = path.join(javaDir, component);
  const exe = path.join(dest, 'bin', OS === 'windows' ? 'javaw.exe' : 'java');
  const marker = path.join(dest, '.zeroria-ok');
  if (fs.existsSync(exe) && fs.existsSync(marker)) return exe;
  report('Descargando Java', null);
  const all = await getJson(JAVA_ALL);
  const plat = OS === 'windows' ? (ARCH === 'arm64' ? 'windows-arm64' : ARCH === 'ia32' ? 'windows-x86' : 'windows-x64') : OS === 'osx' ? (ARCH === 'arm64' ? 'mac-os-arm64' : 'mac-os') : 'linux';
  const entry = all[plat]?.[component]?.[0];
  if (!entry) throw new Error(`No hay Java «${component}» para este sistema.`);
  const man = await getJson(entry.manifest.url);
  const list = [];
  for (const [p, f] of Object.entries(man.files)) {
    if (f.type === 'directory') await fsp.mkdir(path.join(dest, p), { recursive: true });
    else if (f.type === 'file') list.push({ url: f.downloads.raw.url, file: path.join(dest, p), sha1: f.downloads.raw.sha1, size: f.downloads.raw.size, exec: f.executable });
  }
  await downloadAll(list, (d, n) => report('Descargando Java', n ? d / n : null, d, n), false, 12);
  if (OS !== 'windows') for (const it of list) if (it.exec) await fsp.chmod(it.file, 0o755).catch(() => {});
  await fsp.writeFile(marker, entry.version?.name || 'ok');
  return exe;
}

// ------------------------------------------------------------------ NeoForge

async function installNeoForge(mcDir, mcId, neoVersion, javaw, report) {
  const id = `neoforge-${neoVersion}`;
  const v = await readVersion(mcDir, id);
  if (v && v.inheritsFrom === mcId) return id;
  report(`Instalando NeoForge ${neoVersion}`, null);
  const inst = path.join(mcDir, 'cache', `neoforge-${neoVersion}-installer.jar`);
  if (!fs.existsSync(inst)) await download(NEOFORGE(neoVersion), inst);
  let realId = id;
  try {
    const prof = JSON.parse((await zip.readEntry(inst, 'install_profile.json')).toString('utf8'));
    realId = prof.version || prof.install?.version || prof.versionInfo?.id || id;
  } catch { /* nombre de siempre */ }
  const java = javaw.replace(/javaw\.exe$/i, 'java.exe');
  await new Promise((resolve, reject) => {
    const p = spawn(java, ['-jar', inst, '--installClient', mcDir], { cwd: path.dirname(inst), windowsHide: true });
    let tail = '';
    const onOut = (d) => {
      tail = (tail + d.toString()).slice(-4000);
      const line = d.toString().trim().split('\n').pop();
      if (line) report(`Instalando NeoForge ${neoVersion}`, null, null, null, line.slice(0, 90));
    };
    p.stdout.on('data', onOut); p.stderr.on('data', onOut);
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 || fs.existsSync(versionFile(mcDir, realId)) ? resolve() : reject(new Error('El instalador de NeoForge ha fallado:\n' + tail.slice(-600)))));
  });
  if (!fs.existsSync(versionFile(mcDir, realId))) throw new Error('NeoForge no se ha instalado bien.');
  return realId;
}

// ------------------------------------------------------------------ lanzar

function fill(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(fill(a, vars)); continue; }
    if (!rulesAllow(a.rules, features)) continue;
    for (const s of [].concat(a.value)) out.push(fill(s, vars));
  }
  return out;
}

/**
 * Arranca el juego. opts: { mcDir, versionId, java, gameDir, natDir, account:{uuid,nombre,mcToken}, ramMb,
 * resolution:{width,height,fullscreen}, jvmArgs[], server:"host:puerto"|null }
 */
async function launch(opts) {
  const v = await resolveVersion(opts.mcDir, opts.versionId);
  if (!v) throw new Error('Falta la versión del juego: usa «Reparar instalación».');
  const sep = OS === 'windows' ? ';' : ':';
  const cp = [];
  for (const l of v.libraries) {
    if (!rulesAllow(l.rules) || wrongArch(l.name) || l.downloads?.artifact === null) continue;
    if (l.natives && !l.downloads?.artifact) continue;
    const p = path.join(opts.mcDir, 'libraries', l.downloads?.artifact?.path || libPath(l.name));
    if (fs.existsSync(p) && !cp.includes(p)) cp.push(p);
  }
  cp.push(path.join(opts.mcDir, 'versions', v.jarId, `${v.jarId}.jar`));
  const [host, port] = (opts.server || '').split(':');
  const vars = {
    auth_player_name: opts.account.nombre, version_name: v.id, game_directory: opts.gameDir,
    assets_root: path.join(opts.mcDir, 'assets'), game_assets: path.join(opts.mcDir, 'assets'), assets_index_name: v.assetIndex.id,
    auth_uuid: opts.account.uuid, auth_access_token: opts.account.mcToken, auth_session: opts.account.mcToken,
    clientid: '', auth_xuid: '', user_type: 'msa', version_type: 'Zeroria', user_properties: '{}',
    resolution_width: String(opts.resolution?.width || 1280), resolution_height: String(opts.resolution?.height || 720),
    quickPlayMultiplayer: opts.server || '', quickPlayPath: path.join(opts.gameDir, 'quickPlay', 'log.json'),
    natives_directory: opts.natDir, launcher_name: 'Zeroria Launcher', launcher_version: opts.launcherVersion || '1',
    classpath: cp.join(sep), classpath_separator: sep, library_directory: path.join(opts.mcDir, 'libraries'),
  };
  const features = {
    has_custom_resolution: !opts.resolution?.fullscreen, is_quick_play_multiplayer: !!opts.server,
    is_demo_user: false, has_quick_plays_support: false, is_quick_play_singleplayer: false, is_quick_play_realms: false,
  };
  const jvm = [`-Xms${Math.min(1024, opts.ramMb)}M`, `-Xmx${opts.ramMb}M`, ...(opts.jvmArgs || [])];
  if (v.arguments?.jvm?.length) jvm.push(...expandArgs(v.arguments.jvm, vars, features));
  else jvm.push(`-Djava.library.path=${opts.natDir}`, '-cp', vars.classpath);
  const lg = v.logging?.client;
  if (lg?.argument) jvm.push(lg.argument.replace('${path}', path.join(opts.mcDir, 'assets', 'log_configs', lg.file.id)));
  let game = v.arguments?.game?.length ? expandArgs(v.arguments.game, vars, features)
    : fill(v.minecraftArguments || '', vars).split(' ').filter(Boolean);
  if (opts.server && !game.includes('--quickPlayMultiplayer')) game.push('--quickPlayMultiplayer', opts.server);
  if (opts.resolution?.fullscreen) game.push('--fullscreen');
  await fsp.mkdir(opts.gameDir, { recursive: true });
  const proc = spawn(opts.java, [...jvm, v.mainClass, ...game], { cwd: opts.gameDir, windowsHide: false, detached: false });
  return proc;
}

module.exports = { installVanilla, resolveVersion, installLibraries, installAssets, installJava, installNeoForge, launch };
