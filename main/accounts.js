'use strict';
/**
 * Cuentas de Microsoft guardadas (userData/cuentas.dat), cifradas con el sistema (safeStorage = DPAPI en Windows):
 * nadie que copie el archivo a otro ordenador puede usarlas.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const FILE = path.join(app.getPath('userData'), 'cuentas.dat');
let state = load();

function load() {
  try {
    const raw = fs.readFileSync(FILE);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    const s = JSON.parse(json);
    return { activa: s.activa || null, cuentas: Array.isArray(s.cuentas) ? s.cuentas : [] };
  } catch { return { activa: null, cuentas: [] }; }
}

async function save() {
  const json = JSON.stringify(state);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  await fsp.writeFile(FILE, data);
}

/** Lo que ve la interfaz (sin tokens). */
function list() {
  return {
    activa: state.activa,
    cuentas: state.cuentas.map((c) => ({ uuid: c.uuid, nombre: c.nombre, skin: c.skin || null })),
  };
}

function active() { return state.cuentas.find((c) => c.uuid === state.activa) || null; }

async function upsert(acc) {
  const i = state.cuentas.findIndex((c) => c.uuid === acc.uuid);
  if (i >= 0) state.cuentas[i] = { ...state.cuentas[i], ...acc }; else state.cuentas.push(acc);
  state.activa = acc.uuid;
  await save();
}

async function select(uuid) {
  if (state.cuentas.some((c) => c.uuid === uuid)) { state.activa = uuid; await save(); }
  return list();
}

async function remove(uuid) {
  state.cuentas = state.cuentas.filter((c) => c.uuid !== uuid);
  if (state.activa === uuid) state.activa = state.cuentas[0]?.uuid || null;
  await save();
  return list();
}

module.exports = { list, active, upsert, select, remove };
