'use strict';
/** Puente seguro entre la interfaz y el proceso principal: la interfaz solo puede hacer esto. */
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch, fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('zeroria', {
  inicio: () => call('inicio'),
  launcher: () => call('launcher'),
  contenido: () => call('contenido'),
  servidor: () => call('servidor'),
  cuentas: {
    anadir: () => call('cuenta:anadir'),
    elegir: (uuid) => call('cuenta:elegir', uuid),
    quitar: (uuid) => call('cuenta:quitar', uuid),
  },
  guardarAjustes: (patch) => call('ajustes:guardar', patch),
  jugar: (modo) => call('jugar', modo),
  reparar: (modo) => call('reparar', modo),
  carpeta: (cual) => call('carpeta', cual),
  abrirArchivo: (f) => call('abrir-archivo', f),
  enlace: (url) => call('enlace', url),
  instalarActualizacion: () => call('actualizacion:instalar'),
  ventana: (accion) => ipcRenderer.send('ventana', accion),
  onProgreso: (fn) => on('progreso', fn),
  onJuego: (fn) => on('juego', fn),
  onActualizacion: (fn) => on('actualizacion', fn),
});
