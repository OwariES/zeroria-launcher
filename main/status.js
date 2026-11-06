'use strict';
/** Estado del servidor con el «ping» normal de Minecraft (Server List Ping): jugadores, versión, MOTD, latencia. */
const net = require('net');

function varint(n) {
  const out = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
}

function readVarint(buf, off) {
  let n = 0, shift = 0, b;
  do {
    if (off >= buf.length) return null;
    b = buf[off++]; n |= (b & 0x7f) << shift; shift += 7;
  } while (b & 0x80);
  return [n, off];
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

function textOf(c) {
  if (!c) return '';
  if (typeof c === 'string') return c.replace(/§./g, '');
  return (c.text || '') + (c.extra || []).map(textOf).join('');
}

function ping(host, port = 25565, timeout = 5000) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let data = Buffer.alloc(0);
    let start = 0;
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeout, () => done({ online: false }));
    sock.on('error', () => done({ online: false }));
    sock.on('connect', () => {
      const h = Buffer.from(host, 'utf8');
      const port16 = Buffer.alloc(2); port16.writeUInt16BE(port);
      sock.write(packet(0x00, Buffer.concat([varint(774), varint(h.length), h, port16, varint(1)])));
      sock.write(packet(0x00, Buffer.alloc(0)));
      start = Date.now();
    });
    sock.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      const len = readVarint(data, 0);
      if (!len || data.length < len[1] + len[0]) return;
      try {
        let [, off] = readVarint(data, len[1]);            // id del paquete
        const sl = readVarint(data, off);
        const json = JSON.parse(data.slice(sl[1], sl[1] + sl[0]).toString('utf8'));
        done({
          online: true, ms: Date.now() - start,
          jugadores: json.players?.online ?? 0, maximo: json.players?.max ?? 0,
          version: json.version?.name || '', motd: textOf(json.description),
        });
      } catch { done({ online: false }); }
    });
  });
}

module.exports = { ping };
