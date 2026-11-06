'use strict';
/** Lector mínimo de .zip/.jar (para sacar las librerías nativas): solo lo que trae Node. */
const zlib = require('zlib');
const fsp = require('fs/promises');
const path = require('path');

/** Lista de entradas { name, method, compSize, offset } leyendo el directorio central. */
function entries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip no válido');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function read(buf, e) {
  const n = buf.readUInt16LE(e.offset + 26), x = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + n + x;
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`compresión ${e.method} no soportada`);
}

/** Saca del .jar lo que cumpla `filter(name)` a `dest` (sin las carpetas META-INF). */
async function extract(file, dest, filter = () => true) {
  const buf = await fsp.readFile(file);
  for (const e of entries(buf)) {
    if (e.name.endsWith('/') || e.name.startsWith('META-INF/') || !filter(e.name)) continue;
    const root = path.resolve(dest);
    const target = path.resolve(root, e.name);
    if (!target.startsWith(root + path.sep)) continue;               // nada fuera de la carpeta
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, read(buf, e));
  }
}

/** Lee un archivo de dentro del .jar (o null). */
async function readEntry(file, name) {
  const buf = await fsp.readFile(file);
  const e = entries(buf).find((x) => x.name === name);
  return e ? read(buf, e) : null;
}

module.exports = { extract, readEntry };
