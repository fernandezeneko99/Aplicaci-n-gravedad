'use strict';
// Variantes de contorno por alfa: todos los formatos de PNG que After o un usuario pueden producir y casos límite.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const Raster = require('../src/engine/raster.js');
const Sim = require('../src/engine/sim.js');

// Codificador PNG mínimo e independiente para las pruebas (todos los tipos de color, 8/16 bits, paleta, tRNS).
const CRC = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (tag, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(tag), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png({ w, h, type, depth = 8, pixel, palette, trns, interlace = 0, filter = 0 }) {
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], bpp = Math.ceil(ch * depth / 8), stride = Math.ceil(w * ch * depth / 8), raw = Buffer.alloc((stride + 1) * h);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) {
      const v = pixel(x, y);
      if (type === 3 && depth < 8) { const bit = x * depth; row[bit >> 3] |= v[0] << (8 - depth - (bit & 7)); continue; }
      v.forEach((c, i) => { if (depth === 16) row.writeUInt16BE(c, (x * ch + i) * 2); else row[x * ch + i] = c; });
    }
    rows.push(row);
  }
  for (let y = 0; y < h; y++) {
    const row = rows[y], prev = y ? rows[y - 1] : Buffer.alloc(stride), f = filter === 'mix' ? y % 5 : filter, o = y * (stride + 1);
    raw[o] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })() : 0;
      raw[o + 1 + x] = (row[x] - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type; ihdr[12] = interlace;
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', Buffer.from(palette.flat())));
  if (trns) parts.push(chunk('tRNS', Buffer.from(trns)));
  const z = zlib.deflateSync(raw);
  parts.push(chunk('IDAT', z.subarray(0, z.length >> 1)), chunk('IDAT', z.subarray(z.length >> 1)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
const disc = (x, y) => Math.hypot(x - 50, y - 50) <= 40;
const traced = (buf) => Raster.trace(Raster.decode(buf));
const area = (cs) => cs.reduce((s, c) => s + Math.abs(Sim.area(c)), 0);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≈ ' + b);

test('RGBA 8 bits con los 5 filtros mezclados', () => {
  near(area(traced(png({ w: 100, h: 100, type: 6, filter: 'mix', pixel: (x, y) => [9, 9, 9, disc(x, y) ? 255 : 0] }))), Math.PI * 1600, 160, 'área');
});
test('RGBA 16 bits (composiciones de 16 bpc)', () => {
  near(area(traced(png({ w: 100, h: 100, type: 6, depth: 16, pixel: (x, y) => [1000, 2000, 3000, disc(x, y) ? 65535 : 0] }))), Math.PI * 1600, 160);
});
test('gris con alfa (8 y 16 bits)', () => {
  for (const depth of [8, 16]) near(area(traced(png({ w: 100, h: 100, type: 4, depth, pixel: (x, y) => [50, disc(x, y) ? (depth === 16 ? 65535 : 255) : 0] }))), Math.PI * 1600, 160, depth + ' bits');
});
test('paleta de 8 bits con transparencia (tRNS)', () => {
  near(area(traced(png({ w: 100, h: 100, type: 3, palette: [[0, 0, 0], [255, 0, 0]], trns: [0, 255], pixel: (x, y) => [disc(x, y) ? 1 : 0] }))), Math.PI * 1600, 160);
});
test('paleta de 1, 2 y 4 bits', () => {
  for (const depth of [1, 2, 4]) near(area(traced(png({ w: 100, h: 100, type: 3, depth, palette: [[0, 0, 0], [255, 255, 255]], trns: [0], pixel: (x, y) => [disc(x, y) ? 1 : 0] }))), Math.PI * 1600, 160, depth + ' bits');
});
test('RGB con color transparente (tRNS) y gris con color transparente', () => {
  near(area(traced(png({ w: 100, h: 100, type: 2, trns: [0, 0, 0, 255, 0, 0], pixel: (x, y) => disc(x, y) ? [0, 128, 0] : [0, 255, 0] }))), Math.PI * 1600, 160, 'RGB');
  near(area(traced(png({ w: 100, h: 100, type: 0, trns: [0, 7], pixel: (x, y) => [disc(x, y) ? 200 : 7] }))), Math.PI * 1600, 160, 'gris');
});
test('imagen sin transparencia: el contorno es toda la imagen', () => {
  near(area(traced(png({ w: 80, h: 40, type: 2, pixel: () => [1, 2, 3] }))), 3200, 1);
});
test('alfa semitransparente: el umbral está en el 50 %', () => {
  const cs = traced(png({ w: 100, h: 100, type: 6, pixel: (x) => [0, 0, 0, x < 50 ? 200 : 60] }));
  near(area(cs), 5000, 60);
});
test('línea de 1 px de grosor en una imagen grande no desaparece', () => {
  const cs = traced(png({ w: 1600, h: 400, type: 6, pixel: (x, y) => [0, 0, 0, y === 200 && x > 100 && x < 1500 ? 255 : 0] }));
  assert.ok(cs.length >= 1);
  const xs = cs.flat().map((p) => p[0]); assert.ok(Math.max(...xs) - Math.min(...xs) > 1300);
});
test('varias islas: un contorno por pieza', () => {
  const cs = traced(png({ w: 300, h: 100, type: 6, pixel: (x, y) => [0, 0, 0, [50, 150, 250].some((cx) => Math.hypot(x - cx, y - 50) < 30) ? 255 : 0] }));
  assert.strictEqual(cs.length, 3);
});
test('motas sueltas (ruido) se descartan', () => {
  const cs = traced(png({ w: 400, h: 400, type: 6, pixel: (x, y) => [0, 0, 0, Math.hypot(x - 200, y - 200) < 100 || (x % 97 === 3 && y % 89 === 5) ? 255 : 0] }));
  assert.strictEqual(cs.length, 1);
});
test('dónut: contorno exterior e interior; el motor rellena el agujero', () => {
  const cs = traced(png({ w: 200, h: 200, type: 6, pixel: (x, y) => { const d = Math.hypot(x - 100, y - 100); return [0, 0, 0, d < 90 && d > 40 ? 255 : 0]; } }));
  assert.strictEqual(cs.length, 2);
  near(area(Sim.decompose(cs).pieces), Math.PI * 8100, 800, 'agujero relleno');
});
test('píxel en la esquina (contacto en diagonal) no rompe el trazado', () => {
  const cs = traced(png({ w: 20, h: 20, type: 6, pixel: (x, y) => [0, 0, 0, (x < 10 && y < 10) || (x >= 10 && y >= 10) ? 255 : 0] }));
  near(area(cs), 200, 1);
});
test('forma tocando los bordes de la imagen', () => {
  near(area(traced(png({ w: 50, h: 50, type: 6, pixel: (x, y) => [0, 0, 0, x + y < 60 ? 255 : 0] }))), 50 * 50 - 40 * 41 / 2, 40);
});
test('imagen totalmente transparente: error claro', () => {
  assert.throws(() => traced(png({ w: 50, h: 50, type: 6, pixel: () => [0, 0, 0, 0] })), /opacos/);
});
test('PNG entrelazado, truncado o que no es PNG: error claro', () => {
  assert.throws(() => Raster.decode(png({ w: 10, h: 10, type: 6, interlace: 1, pixel: () => [0, 0, 0, 255] })), /entrelazado/);
  const ok = png({ w: 10, h: 10, type: 6, pixel: () => [0, 0, 0, 255] });
  assert.throws(() => Raster.decode(ok.subarray(0, ok.length - 30)), /PNG/);
  assert.throws(() => Raster.decode(Buffer.from('GIF89a........')), /PNG no válido/);
});
test('contorno rasterizado con muchos dientes (peine) se convierte en cuerpo válido', () => {
  const cs = traced(png({ w: 400, h: 120, type: 6, pixel: (x, y) => [0, 0, 0, y > 80 || (y > 10 && x % 40 < 20) ? 255 : 0] }));
  const r = Sim.run({ fps: 25, frames: 60, width: 1000, height: 600, world: { gravity: 980, floor: true }, bodies: [{ id: 'p', type: 'dynamic', pose: { x: 500, y: 200 }, shape: { kind: 'poly', contours: cs.map((c) => c.map((p) => [p[0] - 200, p[1] - 60])) } }] });
  assert.ok(Math.abs(r.bodies.p.data.slice(-2)[0] - 540) < 3, 'reposa: ' + r.bodies.p.data.slice(-3));
});
