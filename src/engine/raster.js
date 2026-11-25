/*
 * Gravedad · contorno a partir del canal alfa de un PNG (solo lectura local, sin red).
 * Devuelve contornos en píxeles de la imagen: [[[x,y],...], ...].
 */
'use strict';
var fs = require('fs'), zlib = require('zlib');

function decode(buffer) {
  var b = buffer;
  if (b.length > 256 * 1024 * 1024 || b.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw Error('PNG no válido o demasiado grande.');
  var pos = 8, w = 0, h = 0, depth = 8, type = 0, interlace = 0, trns = null, chunks = [];
  while (pos + 12 <= b.length) {
    var len = b.readUInt32BE(pos), tag = b.toString('ascii', pos + 4, pos + 8);
    if (pos + len + 12 > b.length) throw Error('PNG truncado.');
    var data = b.subarray(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (tag === 'IDAT') chunks.push(data);
    else if (tag === 'tRNS') trns = data;
    pos += len + 12;
    if (tag === 'IEND') break;
  }
  var channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || !w || !h) throw Error('PNG no compatible.');
  if (w * h > 40000000) throw Error('PNG fuera del límite de 40 MP.');
  if (interlace) throw Error('PNG entrelazado: guárdalo sin entrelazar.');
  if (depth !== 8 && depth !== 16 && !(type === 3 && depth <= 8)) throw Error('Profundidad de PNG no compatible.');
  var bitsPerPixel = channels * depth, bpp = Math.max(1, bitsPerPixel >> 3), stride = Math.ceil(w * bitsPerPixel / 8);
  var raw = zlib.inflateSync(Buffer.concat(chunks)), image = Buffer.alloc(stride * h);
  if (raw.length < (stride + 1) * h) throw Error('Datos PNG incompletos.');
  for (var y = 0; y < h; y++) {
    var f = raw[y * (stride + 1)], row = y * (stride + 1) + 1;
    if (f > 4) throw Error('Filtro PNG no válido.');
    for (var x = 0; x < stride; x++) {
      var v = raw[row + x], a = x >= bpp ? image[y * stride + x - bpp] : 0, up = y ? image[(y - 1) * stride + x] : 0, c = y && x >= bpp ? image[(y - 1) * stride + x - bpp] : 0, add = 0;
      if (f === 1) add = a; else if (f === 2) add = up; else if (f === 3) add = (a + up) >> 1;
      else if (f === 4) { var p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      image[y * stride + x] = (v + add) & 255;
    }
  }
  // Alfa normalizado 0-255 por píxel.
  function sample(x, y) {
    var at;
    if (type === 3) {
      var bit = x * depth, byte = image[y * stride + (bit >> 3)], index = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      return trns && index < trns.length ? trns[index] : 255;
    }
    if (depth === 16) {
      at = y * stride + x * channels * 2;
      if (type === 6) return image[at + 6]; if (type === 4) return image[at + 2];
      if (trns && type === 0) return image.readUInt16BE(at) === trns.readUInt16BE(0) ? 0 : 255;
      if (trns && type === 2) return image.readUInt16BE(at) === trns.readUInt16BE(0) && image.readUInt16BE(at + 2) === trns.readUInt16BE(2) && image.readUInt16BE(at + 4) === trns.readUInt16BE(4) ? 0 : 255;
      return 255;
    }
    at = y * stride + x * channels;
    if (type === 6) return image[at + 3]; if (type === 4) return image[at + 1];
    if (trns && type === 0) return image[at] === trns.readUInt16BE(0) ? 0 : 255;
    if (trns && type === 2) return image[at] === trns.readUInt16BE(0) && image[at + 1] === trns.readUInt16BE(2) && image[at + 2] === trns.readUInt16BE(4) ? 0 : 255;
    return 255;
  }
  return { width: w, height: h, alpha: sample };
}

function simplify(points, eps) {
  if (points.length < 3) return points;
  var first = points[0], last = points[points.length - 1], dx = last[0] - first[0], dy = last[1] - first[1], len = Math.max(1e-9, Math.sqrt(dx * dx + dy * dy)), max = 0, index = 0;
  for (var i = 1; i < points.length - 1; i++) { var d = Math.abs(dy * points[i][0] - dx * points[i][1] + last[0] * first[1] - last[1] * first[0]) / len; if (d > max) { max = d; index = i; } }
  if (max <= eps) return [first, last];
  return simplify(points.slice(0, index + 1), eps).slice(0, -1).concat(simplify(points.slice(index), eps));
}

// Traza los bordes entre celdas opacas y transparentes de una rejilla (máx. 512 celdas por lado).
function trace(img, options) {
  options = options || {};
  var w = img.width, h = img.height, threshold = options.threshold === undefined ? 128 : options.threshold;
  var step = Math.max(1, Math.ceil(Math.max(w, h) / (options.resolution || 512))), gw = Math.ceil(w / step), gh = Math.ceil(h / step), grid = new Uint8Array(gw * gh), any = false;
  for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
    // Celda opaca si algún píxel muestreado supera el umbral: los objetos finos no desaparecen.
    var on = 0, y0 = gy * step, x0 = gx * step, s = Math.max(1, step >> 1);
    for (var yy = y0; yy < Math.min(h, y0 + step) && !on; yy += s) for (var xx = x0; xx < Math.min(w, x0 + step) && !on; xx += s) if (img.alpha(xx, yy) >= threshold) on = 1;
    grid[gy * gw + gx] = on; if (on) any = true;
  }
  if (!any) throw Error('La imagen no tiene píxeles opacos.');
  var filled = function (x, y) { return x >= 0 && x < gw && y >= 0 && y < gh && grid[y * gw + x] === 1; };
  // Aristas dirigidas (interior a la derecha en pantalla) indexadas por su origen.
  var edges = new Map(), count = 0;
  function add(x, y, x2, y2) { if (++count > 400000) throw Error('Alfa demasiado complejo: simplifica la silueta.'); var k = x + ',' + y, list = edges.get(k); if (!list) edges.set(k, list = []); list.push([x2, y2]); }
  for (gy = 0; gy < gh; gy++) for (gx = 0; gx < gw; gx++) if (filled(gx, gy)) {
    if (!filled(gx, gy - 1)) add(gx, gy, gx + 1, gy);
    if (!filled(gx + 1, gy)) add(gx + 1, gy, gx + 1, gy + 1);
    if (!filled(gx, gy + 1)) add(gx + 1, gy + 1, gx, gy + 1);
    if (!filled(gx - 1, gy)) add(gx, gy + 1, gx, gy);
  }
  var contours = [], eps = options.tolerance === undefined ? 0.75 : options.tolerance;
  while (edges.size) {
    var start = edges.keys().next().value, current = start, poly = [];
    for (var n = 0; n <= count + 1; n++) {
      var list = edges.get(current);
      if (!list || !list.length) break;
      var next = list.pop(); if (!list.length) edges.delete(current);
      var pt = current.split(','); poly.push([+pt[0], +pt[1]]);
      current = next[0] + ',' + next[1];
      if (current === start) break;
    }
    if (poly.length < 4) continue;
    var mid = Math.floor(poly.length / 2);
    var reduced = simplify(poly.slice(0, mid + 1), eps).slice(0, -1).concat(simplify(poly.slice(mid).concat([poly[0]]), eps).slice(0, -1));
    if (reduced.length >= 3) contours.push(reduced.map(function (p) { return [Math.min(w, p[0] * step), Math.min(h, p[1] * step)]; }));
  }
  // Se descartan motas: menos del 0,05 % de la imagen.
  var min = Math.max(4, w * h * 0.0005);
  contours = contours.filter(function (c) { var a = 0; for (var i = 0; i < c.length; i++) { var q = c[(i + 1) % c.length]; a += c[i][0] * q[1] - q[0] * c[i][1]; } return Math.abs(a / 2) >= min; });
  contours.sort(function (a, b) { return b.length - a.length; });
  if (contours.length > 64) contours = contours.slice(0, 64);
  if (!contours.length) throw Error('La imagen no tiene zonas opacas suficientes.');
  return contours;
}

function traceFile(file, options) { return trace(decode(fs.readFileSync(file)), options); }

module.exports = { decode: decode, trace: trace, traceFile: traceFile };
