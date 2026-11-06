'use strict';
/** Zeroria Launcher: ventana, comunicación con la interfaz y actualizaciones del propio launcher. */
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const { DIRS, CONFIG } = require('./util');
const settings = require('./settings');
const accounts = require('./accounts');
const auth = require('./auth');
const remote = require('./remote');
const status = require('./status');
const game = require('./game');

let win = null;

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 720, minWidth: 980, minHeight: 620, frame: false, show: false,
    backgroundColor: '#120d0a', title: 'Zeroria Launcher',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  // los enlaces se abren en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(() => { createWindow(); setupUpdater(); });
app.on('window-all-closed', () => { if (!game.isRunning()) app.quit(); });

// ------------------------------------------------------------------ ventana
ipcMain.on('ventana', (_e, what) => {
  if (!win) return;
  if (what === 'minimizar') win.minimize();
  else if (what === 'maximizar') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (what === 'cerrar') win.close();
});

// ------------------------------------------------------------------ datos para la interfaz
const safe = (fn) => async (...args) => {
  try { return { ok: true, data: await fn(...args) }; }
  catch (e) { return { ok: false, error: e.message || String(e), code: e.code }; }
};

ipcMain.handle('inicio', safe(async () => ({
  version: app.getVersion(),
  ajustes: settings.get(),
  cuentas: accounts.list(),
  enlaces: CONFIG.enlaces || {},
  datosConfigurados: remote.configured(),
})));
ipcMain.handle('launcher', safe(() => remote.launcherConfig()));
ipcMain.handle('contenido', safe(() => remote.content()));
ipcMain.handle('servidor', safe(async () => {
  const cfg = await remote.launcherConfig();
  const s = cfg.servidor || {};
  return { ...(await status.ping(s.host, s.puerto || 25565)), nombre: s.nombre || 'Zeroria', host: s.host };
}));

ipcMain.handle('cuenta:anadir', safe(() => auth.login(win)));
ipcMain.handle('cuenta:elegir', safe((_e, uuid) => accounts.select(uuid)));
ipcMain.handle('cuenta:quitar', safe((_e, uuid) => accounts.remove(uuid)));

ipcMain.handle('ajustes:guardar', safe((_e, patch) => settings.set(patch)));

ipcMain.handle('carpeta', safe(async (_e, which) => {
  const map = { juego: game.gameDir(settings.get().modo), registros: DIRS.logs, raiz: DIRS.root,
    capturas: path.join(game.gameDir(settings.get().modo), 'screenshots') };
  const p = map[which] || DIRS.root;
  fs.mkdirSync(p, { recursive: true });
  await shell.openPath(p);
}));
ipcMain.handle('enlace', safe((_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); }));
ipcMain.handle('reparar', safe((_e, mode) => game.repair(mode)));

// ------------------------------------------------------------------ jugar
ipcMain.handle('jugar', safe(async (_e, mode) => {
  const s = settings.get();
  await game.play(mode, {
    progress: (p) => send('progreso', p),
    started: () => {
      send('juego', { estado: 'abierto' });
      if (s.alJugar === 'ocultar') win?.hide();
      else if (s.alJugar === 'cerrar') setTimeout(() => app.quit(), 500);
    },
    exit: (info) => {
      if (!win || win.isDestroyed()) { app.quit(); return; }      // se cerró la ventana mientras se jugaba
      win.show(); win.focus();
      send('juego', { estado: 'cerrado', ...info });
    },
  });
}));
ipcMain.handle('abrir-archivo', safe(async (_e, file) => {
  if (file && fs.existsSync(file) && (file.startsWith(DIRS.root))) await shell.openPath(file);
}));

// ------------------------------------------------------------------ actualizaciones del launcher (GitHub Releases)
function setupUpdater() {
  if (!app.isPackaged) return;
  let updater;
  try { ({ autoUpdater: updater } = require('electron-updater')); } catch { return; }
  updater.autoDownload = true;
  updater.on('update-available', (i) => send('actualizacion', { estado: 'descargando', version: i.version }));
  updater.on('download-progress', (p) => send('actualizacion', { estado: 'descargando', frac: p.percent / 100 }));
  updater.on('update-downloaded', (i) => send('actualizacion', { estado: 'lista', version: i.version }));
  updater.on('error', () => {});
  ipcMain.handle('actualizacion:instalar', () => updater.quitAndInstall(false, true));
  updater.checkForUpdates().catch(() => {});
  setInterval(() => updater.checkForUpdates().catch(() => {}), 30 * 60 * 1000);
}

process.on('unhandledRejection', (e) => console.error(e));
process.on('uncaughtException', (e) => {
  console.error(e);
  dialog.showErrorBox('Zeroria Launcher', String(e?.stack || e));
});
