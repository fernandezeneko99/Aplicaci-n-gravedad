/* Gravedad - contornos en coordenadas de capa. ExtendScript (ES3): sin let/const, sin forEach, sin JSON nativo. */
var GravedadGeometry = (function () {
  var TOLERANCE = 0.6, LIMIT = 4000;
  function mul(a, b) { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; }
  function point(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }
  function det(m) { return m[0] * m[3] - m[1] * m[2]; }
  function val(g, name, t, fallback) { var p = null; try { p = g.property(name); } catch (e) { p = null; } if (!p) return fallback; try { return p.valueAtTime(t, false); } catch (e2) { return fallback; } }
  function matrix(g, t) {
    var a = val(g, 'ADBE Vector Anchor', t, [0, 0]), p = val(g, 'ADBE Vector Position', t, [0, 0]), s = val(g, 'ADBE Vector Scale', t, [100, 100]);
    var r = val(g, 'ADBE Vector Rotation', t, 0) * Math.PI / 180, sk = val(g, 'ADBE Vector Skew', t, 0) * Math.PI / 180, ax = val(g, 'ADBE Vector Skew Axis', t, 0) * Math.PI / 180;
    var c = Math.cos(r), sn = Math.sin(r), ca = Math.cos(ax), sa = Math.sin(ax);
    var skew = mul(mul([ca, sa, -sa, ca, 0, 0], [1, 0, -Math.tan(sk), 1, 0, 0]), [ca, -sa, sa, ca, 0, 0]);
    return mul(mul(mul([c, sn, -sn, c, p[0], p[1]], skew), [s[0] / 100, 0, 0, s[1] / 100, 0, 0]), [1, 0, 0, 1, -a[0], -a[1]]);
  }
  function distance(p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; return l ? Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(l) : Math.sqrt(Math.pow(p[0] - a[0], 2) + Math.pow(p[1] - a[1], 2)); }
  function curve(a, b, c, d, out, depth) {
    if (depth > 10 || Math.max(distance(b, a, d), distance(c, a, d)) <= TOLERANCE) { out.push(d); return; }
    var ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], cd = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
    var abc = [(ab[0] + bc[0]) / 2, (ab[1] + bc[1]) / 2], bcd = [(bc[0] + cd[0]) / 2, (bc[1] + cd[1]) / 2], mid = [(abc[0] + bcd[0]) / 2, (abc[1] + bcd[1]) / 2];
    curve(a, ab, abc, mid, out, depth + 1); curve(mid, bcd, cd, d, out, depth + 1);
  }
  // Bezier -> polilinea. Devuelve {points, closed}.
  function flatten(shape, m) {
    var v = shape.vertices, ins = shape.inTangents, outs = shape.outTangents, n = v.length, out = [];
    if (!n) return { points: [], closed: !!shape.closed };
    out.push(point(m, v[0]));
    var count = shape.closed ? n : n - 1;
    for (var j = 0; j < count; j++) {
      var k = (j + 1) % n;
      curve(point(m, v[j]), point(m, [v[j][0] + outs[j][0], v[j][1] + outs[j][1]]), point(m, [v[k][0] + ins[k][0], v[k][1] + ins[k][1]]), point(m, v[k]), out, 0);
    }
    if (shape.closed && out.length > 1) out.pop();
    return { points: out, closed: !!shape.closed };
  }
  function ellipse(size, pos, m) {
    var a = [], count = Math.min(64, Math.max(20, Math.ceil(Math.PI * Math.sqrt(Math.max(size[0], size[1]) / 0.8))));
    for (var q = 0; q < count; q++) { var ang = q * 2 * Math.PI / count; a.push(point(m, [pos[0] + size[0] / 2 * Math.cos(ang), pos[1] + size[1] / 2 * Math.sin(ang)])); }
    return a;
  }
  function rect(sz, ps, round, m) {
    var a = [], q, corner;
    round = Math.min(round, sz[0] / 2, sz[1] / 2);
    if (round < 0.1) a = [[-sz[0] / 2, -sz[1] / 2], [sz[0] / 2, -sz[1] / 2], [sz[0] / 2, sz[1] / 2], [-sz[0] / 2, sz[1] / 2]];
    else for (corner = 0; corner < 4; corner++) {
      var cx = (corner === 0 || corner === 3 ? 1 : -1) * (sz[0] / 2 - round), cy = (corner < 2 ? 1 : -1) * (sz[1] / 2 - round);
      for (q = 0; q <= 6; q++) { var ang = (corner * 90 + q * 15) * Math.PI / 180; a.push([cx + round * Math.cos(ang), cy + round * Math.sin(ang)]); }
    }
    for (q = 0; q < a.length; q++) a[q] = point(m, [a[q][0] + ps[0], a[q][1] + ps[1]]);
    return a;
  }
  function star(p, t, m) {
    var sides = Math.max(3, Math.round(val(p, 'ADBE Vector Star Points', t, 5))), type = val(p, 'ADBE Vector Star Type', t, 1), outer = val(p, 'ADBE Vector Star Outer Radius', t, 100), inner = val(p, 'ADBE Vector Star Inner Radius', t, 50), rot = val(p, 'ADBE Vector Star Rotation', t, 0), ps = val(p, 'ADBE Vector Star Position', t, [0, 0]), a = [];
    var count = type === 1 ? sides * 2 : sides;
    for (var q = 0; q < count; q++) { var ang = (rot - 90 + q * 360 / count) * Math.PI / 180, r = type === 1 && q % 2 ? inner : outer; a.push(point(m, [ps[0] + r * Math.cos(ang), ps[1] + r * Math.sin(ang)])); }
    return a;
  }

  // Capa de formas. Devuelve null si contiene algo que no se puede leer como vector (se usara el alfa).
  function shapeLayer(layer, t) {
    var paths = [], stroke = 0, fill = false, unsupported = false, circles = [], shapes = 0, identity = [1, 0, 0, 1, 0, 0];
    function walk(g, m) {
      for (var i = 1; i <= g.numProperties; i++) {
        var p = g.property(i), n = p.matchName;
        if (p.enabled === false) continue;
        if (n === 'ADBE Vector Group') {
          var tr = p.property('ADBE Vector Transform Group');
          if (val(tr, 'ADBE Vector Group Opacity', t, 100) <= 0) continue;
          walk(p.property('ADBE Vectors Group'), mul(m, matrix(tr, t)));
        } else if (n === 'ADBE Vector Shape - Group') { shapes++; paths.push(flatten(p.property('ADBE Vector Shape').valueAtTime(t, false), m)); }
        else if (n === 'ADBE Vector Shape - Ellipse') {
          shapes++;
          var size = val(p, 'ADBE Vector Ellipse Size', t, [100, 100]), pos = val(p, 'ADBE Vector Ellipse Position', t, [0, 0]);
          var sx = Math.sqrt(m[0] * m[0] + m[1] * m[1]), sy = Math.sqrt(m[2] * m[2] + m[3] * m[3]), ortho = Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(1, sx * sy);
          if (Math.abs(size[0] - size[1]) <= Math.max(0.5, size[0] * 0.01) && Math.abs(sx - sy) <= 0.01 * Math.max(sx, sy) && ortho) circles.push({ c: point(m, pos), r: size[0] / 2 * sx });
          paths.push({ points: ellipse(size, pos, m), closed: true });
        } else if (n === 'ADBE Vector Shape - Rect') { shapes++; paths.push({ points: rect(val(p, 'ADBE Vector Rect Size', t, [100, 100]), val(p, 'ADBE Vector Rect Position', t, [0, 0]), val(p, 'ADBE Vector Rect Roundness', t, 0), m), closed: true }); }
        else if (n === 'ADBE Vector Shape - Star') {
          shapes++;
          if (val(p, 'ADBE Vector Star Outer Roundess', t, 0) !== 0 || val(p, 'ADBE Vector Star Inner Roundess', t, 0) !== 0) unsupported = true;
          else paths.push({ points: star(p, t, m), closed: true });
        } else if (n === 'ADBE Vector Graphic - Fill') { if (val(p, 'ADBE Vector Fill Opacity', t, 100) > 0) fill = true; }
        else if (n === 'ADBE Vector Graphic - Stroke') { if (val(p, 'ADBE Vector Stroke Opacity', t, 100) > 0) stroke = Math.max(stroke, val(p, 'ADBE Vector Stroke Width', t, 0) * Math.sqrt(Math.abs(det(m)))); }
        else if (n === 'ADBE Vector Graphic - G-Fill') fill = true;
        else if (n === 'ADBE Vector Graphic - G-Stroke') stroke = Math.max(stroke, val(p, 'ADBE Vector Stroke Width', t, 0) * Math.sqrt(Math.abs(det(m))));
        else if (n === 'ADBE Vector Filter - Merge') { if (val(p, 'ADBE Vector Merge Type', t, 1) > 2) unsupported = true; }
        else if (n.indexOf('ADBE Vector Filter') === 0) unsupported = true;
      }
    }
    walk(layer.property('ADBE Root Vectors Group'), identity);
    if (unsupported || !paths.length) return null;
    var total = 0;
    for (var i = 0; i < paths.length; i++) total += paths[i].points.length;
    if (total > LIMIT) return null;
    if (!fill && stroke > 0) return { kind: 'stroke', paths: paths, thickness: stroke };
    if (shapes === 1 && circles.length === 1) return { kind: 'circle', x: circles[0].c[0], y: circles[0].c[1], r: circles[0].r };
    var contours = [];
    for (i = 0; i < paths.length; i++) if (paths[i].points.length >= 3) contours.push(paths[i].points);
    return contours.length ? { kind: 'contours', contours: contours } : null;
  }

  // Mascaras en modo Anadir: definen el contorno de cualquier capa AV.
  function masks(layer, t) {
    var parade = layer.property('ADBE Mask Parade'), out = [], skipped = 0;
    if (!parade) return null;
    for (var i = 1; i <= parade.numProperties; i++) {
      var mask = parade.property(i);
      if (mask.maskMode === MaskMode.NONE) continue;
      if (mask.maskMode !== MaskMode.ADD || mask.inverted) { skipped++; continue; }
      var f = flatten(mask.property('ADBE Mask Shape').valueAtTime(t, false), [1, 0, 0, 1, 0, 0]);
      if (f.points.length >= 3) out.push(f.points);
    }
    return out.length ? { kind: 'contours', contours: out, skippedMasks: skipped } : null;
  }

  return { shapeLayer: shapeLayer, masks: masks, mul: mul, point: point };
}());
