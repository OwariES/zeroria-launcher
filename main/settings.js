'use strict';
/** Ajustes del jugador (userData/ajustes.json). */
const { app } = require('electron');
const os = require('os');
const path = require('path');
const { readJson, writeJson } = require('./util');

const FILE = path.join(app.getPath('userData'), 'ajustes.json');
const totalMb = Math.floor(os.totalmem() / 1024 / 1024);

const DEFAULTS = {
  modo: 'vanilla',                 // 'vanilla' | 'plus'
  ramMb: Math.max(2048, Math.min(6144, Math.floor(totalMb / 3 / 512) * 512)),
  anchura: 1280,
  altura: 720,
  pantallaCompleta: false,
  jvmArgs: '',
  alJugar: 'ocultar',              // 'ocultar' | 'cerrar' | 'nada'
  shaders: true,                   // solo en Plus (Iris)
  entrarAlServidor: true,          // al darle a Jugar, directo a Zeroria
};

let current = { ...DEFAULTS, ...readJson(FILE, {}) };

function get() { return { ...current, ramTotalMb: totalMb }; }

async function set(patch) {
  const clean = {};
  for (const k of Object.keys(DEFAULTS)) if (k in patch) clean[k] = patch[k];
  if ('ramMb' in clean) clean.ramMb = Math.max(1024, Math.min(totalMb - 1024, Math.round(Number(clean.ramMb) || DEFAULTS.ramMb)));
  if ('anchura' in clean) clean.anchura = Math.max(640, Math.round(Number(clean.anchura) || 1280));
  if ('altura' in clean) clean.altura = Math.max(480, Math.round(Number(clean.altura) || 720));
  if ('modo' in clean && !['vanilla', 'plus'].includes(clean.modo)) delete clean.modo;
  current = { ...current, ...clean };
  await writeJson(FILE, current);
  return get();
}

module.exports = { get, set };
