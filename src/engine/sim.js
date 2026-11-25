/*
 * Gravedad · motor de simulación.
 * Recibe una escena descrita en píxeles de composición (y hacia abajo) y devuelve, fotograma a fotograma,
 * la posición y la rotación de cada cuerpo. Usa planck.js (Box2D) internamente en metros.
 * Funciona igual en el panel (navegador de CEP) y en Node (pruebas).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./planck.min.js'));
  else root.GravedadSim = factory(root.planck);
}(typeof self !== 'undefined' ? self : this, function (planck) {
  'use strict';

  var PPM = 50;            // píxeles por metro: objetos de 25-500 px quedan en el rango óptimo de Box2D
  var MAX_VERTS = 8;       // vértices por pieza convexa
  var MIN_AREA = 1;        // px²: piezas menores se descartan
  var WELD = 0.6;          // px: puntos más cercanos se funden (Box2D los fundiría a 0.25 px)
  var Vec2 = planck.Vec2;
  var SKIN = 0.01 * PPM;   // polygonRadius de Box2D (0,01 m) en píxeles

  // ---------- Geometría ----------
  function area(p) { var a = 0; for (var i = 0, n = p.length; i < n; i++) { var q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; }
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  function dist2(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; }

  function simplify(points, eps) {
    if (points.length < 3) return points.slice();
    var first = points[0], last = points[points.length - 1], dx = last[0] - first[0], dy = last[1] - first[1], len = Math.sqrt(dx * dx + dy * dy), max = 0, index = 0;
    for (var i = 1; i < points.length - 1; i++) {
      var d = len > 1e-9 ? Math.abs(dy * points[i][0] - dx * points[i][1] + last[0] * first[1] - last[1] * first[0]) / len : Math.sqrt(dist2(points[i], first));
      if (d > max) { max = d; index = i; }
    }
    if (max <= eps) return [first, last];
    return simplify(points.slice(0, index + 1), eps).slice(0, -1).concat(simplify(points.slice(index), eps));
  }

  // Contorno cerrado limpio: sin puntos repetidos ni colineales, en sentido positivo.
  function clean(poly, eps) {
    var p = [], i;
    for (i = 0; i < poly.length; i++) {
      var v = [Number(poly[i][0]), Number(poly[i][1])];
      if (!isFinite(v[0]) || !isFinite(v[1])) continue;
      if (!p.length || dist2(p[p.length - 1], v) > WELD * WELD) p.push(v);
    }
    while (p.length > 2 && dist2(p[0], p[p.length - 1]) <= WELD * WELD) p.pop();
    if (p.length < 3) return [];
    if (eps > 0 && p.length > 8) {
      // Simplificación cerrada: se parte por el punto más lejano al primero.
      var far = 0, best = 0;
      for (i = 1; i < p.length; i++) { var d = dist2(p[0], p[i]); if (d > best) { best = d; far = i; } }
      p = simplify(p.slice(0, far + 1), eps).slice(0, -1).concat(simplify(p.slice(far).concat([p[0]]), eps).slice(0, -1));
    }
    var changed = true;
    while (changed && p.length > 3) {
      changed = false;
      for (i = 0; i < p.length && p.length > 3; i++) {
        var a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
        var lab = Math.sqrt(dist2(a, b)), lbc = Math.sqrt(dist2(b, c));
        if (Math.abs(cross(a, b, c)) <= 1e-3 * Math.max(1, lab * lbc) || lab < WELD || lbc < WELD) { p.splice(i, 1); changed = true; i--; }
      }
    }
    if (p.length < 3) return [];
    // Un trazado que se cruza puede tener área neta casi nula: se usa su casco convexo.
    if (Math.abs(area(p)) < MIN_AREA) { var h = hull(p); return h.length >= 3 && Math.abs(area(h)) >= MIN_AREA ? h : []; }
    if (area(p) < 0) p.reverse();
    return p;
  }

  function hull(points) {
    var pts = points.map(function (q) { return [q[0], q[1]]; }).sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (pts.length < 3) return pts;
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop(); lower.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop(); upper.push(pts[i]); }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  function pointInTriangle(p, a, b, c) {
    var d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
  }

  // Triangulación por orejas (polígono simple, sentido positivo). Devuelve índices o null si el contorno se cruza.
  function triangulate(p) {
    var idx = [], tris = [], i;
    for (i = 0; i < p.length; i++) idx.push(i);
    var guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      var found = false;
      for (i = 0; i < idx.length; i++) {
        var ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        var a = p[ia], b = p[ib], c = p[ic];
        if (cross(a, b, c) <= 1e-9) continue;
        var inside = false;
        for (var j = 0; j < idx.length; j++) {
          var k = idx[j];
          if (k === ia || k === ib || k === ic) continue;
          if (pointInTriangle(p[k], a, b, c)) { inside = true; break; }
        }
        if (inside) continue;
        tris.push([ia, ib, ic]); idx.splice(i, 1); found = true; break;
      }
      if (!found) return null;
    }
    if (idx.length === 3) {
      if (cross(p[idx[0]], p[idx[1]], p[idx[2]]) <= 0) return null;
      tris.push(idx.slice());
    }
    return tris;
  }

  function isConvex(poly, p) {
    for (var i = 0, n = poly.length; i < n; i++) if (cross(p[poly[i]], p[poly[(i + 1) % n]], p[poly[(i + 2) % n]]) < -1e-9) return false;
    return true;
  }

  // Hertel-Mehlhorn: une triángulos vecinos mientras el resultado siga siendo convexo y quepa en Box2D.
  function mergeConvex(tris, p) {
    var pieces = tris.map(function (t) { return t.slice(); }), merged = true;
    while (merged) {
      merged = false;
      for (var a = 0; a < pieces.length && !merged; a++) {
        for (var b = a + 1; b < pieces.length && !merged; b++) {
          var A = pieces[a], B = pieces[b];
          if (A.length + B.length - 2 > MAX_VERTS) continue;
          for (var i = 0; i < A.length && !merged; i++) {
            var u = A[i], v = A[(i + 1) % A.length];
            for (var j = 0; j < B.length; j++) {
              if (B[j] === v && B[(j + 1) % B.length] === u) {
                // A recorre u→v, B recorre v→u: se cose B dentro de A.
                var join = A.slice(0, i + 1);
                for (var k = 2; k < B.length; k++) join.push(B[(j + k) % B.length]);
                join = join.concat(A.slice(i + 1));
                if (isConvex(join, p)) { pieces[a] = join; pieces.splice(b, 1); merged = true; }
                break;
              }
            }
          }
        }
      }
    }
    return pieces.map(function (q) { return q.map(function (k) { return p[k]; }); });
  }

  // Pieza convexa demasiado grande para Box2D: abanico desde el primer vértice.
  function splitLarge(poly) {
    if (poly.length <= MAX_VERTS) return [poly];
    var out = [], start = 1;
    while (start < poly.length - 1) {
      var end = Math.min(poly.length - 1, start + MAX_VERTS - 2);
      out.push([poly[0]].concat(poly.slice(start, end + 1)));
      start = end;
    }
    return out;
  }

  function contains(poly, pt) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1])) && (pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) inside = !inside;
    }
    return inside;
  }

  // Contornos (posiblemente cóncavos, con agujeros) → piezas convexas. Los agujeros se rellenan.
  function decompose(contours, tolerance) {
    var cleaned = [], pieces = [], warnings = [];
    for (var i = 0; i < contours.length; i++) { var c = clean(contours[i], tolerance === undefined ? 0.75 : tolerance); if (c.length) cleaned.push(c); }
    cleaned.sort(function (a, b) { return Math.abs(area(b)) - Math.abs(area(a)); });
    var outers = [];
    for (i = 0; i < cleaned.length; i++) {
      var hole = false;
      for (var j = 0; j < outers.length; j++) {
        var inside = 0; for (var k = 0; k < cleaned[i].length; k++) if (contains(outers[j], cleaned[i][k])) inside++;
        if (inside === cleaned[i].length) { hole = true; break; }
      }
      if (!hole) outers.push(cleaned[i]);
    }
    for (i = 0; i < outers.length; i++) {
      var p = outers[i], tris = triangulate(p), convex;
      if (tris) convex = mergeConvex(tris, p);
      else { convex = [hull(p)]; warnings.push('contorno-cruzado'); }
      for (j = 0; j < convex.length; j++) {
        var parts = splitLarge(convex[j]);
        for (k = 0; k < parts.length; k++) { var q = parts[k]; if (q.length >= 3 && Math.abs(area(q)) >= MIN_AREA * 0.25) pieces.push(q); }
      }
    }
    return { pieces: pieces, warnings: warnings };
  }

  // Trazo hueco: cada segmento se convierte en una caja del grosor del trazo.
  function strokeBoxes(paths, thickness) {
    var out = [], h = Math.max(1, thickness) / 2;
    for (var i = 0; i < paths.length; i++) {
      var pts = paths[i].points, closed = !!paths[i].closed;
      var n = pts.length, count = closed ? n : n - 1;
      for (var s = 0; s < count; s++) {
        var a = pts[s], b = pts[(s + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.5) continue;
        var ux = dx / len, uy = dy / len, nx = -uy * h, ny = ux * h, ex = ux * h * 0.5, ey = uy * h * 0.5;
        // Se alarga medio grosor en cada extremo para cerrar las esquinas.
        out.push([[a[0] - ex + nx, a[1] - ey + ny], [a[0] - ex - nx, a[1] - ey - ny], [b[0] + ex - nx, b[1] + ey - ny], [b[0] + ex + nx, b[1] + ey + ny]].reverse());
      }
    }
    return out.map(function (q) { return area(q) < 0 ? q.reverse() : q; });
  }

  // ---------- Formas → fixtures ----------
  // shape: {kind:'circle', x,y,r} | {kind:'box', x,y,w,h} | {kind:'poly', contours:[...]} | {kind:'stroke', paths:[{points,closed}], thickness}
  function buildPieces(shape) {
    if (!shape) throw Error('Cuerpo sin forma.');
    if (shape.kind === 'circle') return { circle: { x: shape.x || 0, y: shape.y || 0, r: Math.max(0.5, shape.r) }, pieces: [], warnings: [] };
    if (shape.kind === 'box') {
      var x = shape.x || 0, y = shape.y || 0, w = Math.max(1, shape.w) / 2, hh = Math.max(1, shape.h) / 2;
      return { pieces: [[[x - w, y - hh], [x + w, y - hh], [x + w, y + hh], [x - w, y + hh]]], warnings: [] };
    }
    if (shape.kind === 'stroke') return { pieces: strokeBoxes(shape.paths, shape.thickness), warnings: [] };
    return decompose(shape.contours || [], shape.tolerance);
  }

  function scalePieces(built, s) {
    if (s === 1) return built;
    return {
      circle: built.circle ? { x: built.circle.x * s, y: built.circle.y * s, r: built.circle.r * s } : null,
      pieces: built.pieces.map(function (q) { return q.map(function (v) { return [v[0] * s, v[1] * s]; }); }),
      warnings: built.warnings
    };
  }

  // Box2D añade una piel de polygonRadius alrededor de cada polígono: se encoge la pieza lo mismo
  // para que los objetos se toquen exactamente por su contorno visible.
  function inset(q, d) {
    var n = q.length, lines = [], out = [], i;
    for (i = 0; i < n; i++) {
      var a = q[i], b = q[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) return q;
      var nx = -dy / len, ny = dx / len; // interior a la izquierda en sentido positivo
      lines.push([a[0] + nx * d, a[1] + ny * d, dx, dy]);
    }
    for (i = 0; i < n; i++) {
      var L1 = lines[(i + n - 1) % n], L2 = lines[i], den = L1[2] * L2[3] - L1[3] * L2[2];
      if (Math.abs(den) < 1e-12) return q;
      var t = ((L2[0] - L1[0]) * L2[3] - (L2[1] - L1[1]) * L2[2]) / den;
      out.push([L1[0] + L1[2] * t, L1[1] + L1[3] * t]);
    }
    return Math.abs(area(out)) > Math.abs(area(q)) * 0.25 && area(out) > 0 ? out : q;
  }

  function attach(body, built, material) {
    var def = { density: Math.max(0.0001, material.density === undefined ? 1 : material.density), friction: Math.max(0, material.friction === undefined ? 0.4 : material.friction), restitution: Math.min(1, Math.max(0, material.restitution === undefined ? 0.2 : material.restitution)) };
    var n = 0;
    if (built.circle) { body.createFixture(new planck.Circle(Vec2(built.circle.x / PPM, built.circle.y / PPM), built.circle.r / PPM), def); n++; }
    for (var i = 0; i < built.pieces.length; i++) {
      var q = built.pieces[i];
      if (area(q) < 0) q = q.slice().reverse();
      q = inset(q, SKIN);
      var verts = [];
      for (var k = 0; k < q.length; k++) verts.push(Vec2(q[k][0] / PPM, q[k][1] / PPM));
      var h = hull(q);
      if (h.length < 3 || Math.abs(area(h)) < MIN_AREA * 0.25) continue;
      body.createFixture(new planck.Polygon(verts), def); n++;
    }
    return n;
  }

  // ---------- Utilidades ----------
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function at(track, k) { return track[Math.max(0, Math.min(track.length - 1, k))]; }
  function rad(d) { return d * Math.PI / 180; }
  function round(v, d) { var m = Math.pow(10, d); return Math.round(v * m) / m; }

  // ---------- Simulación ----------
  // Ejecuta por tramos para que el panel pueda mostrar el progreso: run() devuelve un objeto con step(n).
  function create(scene) {
    var fps = scene.fps, frames = Math.max(1, Math.round(scene.frames)), dtFrame = 1 / fps;
    var w = scene.world || {}, hz = Math.max(60, Math.min(960, w.quality || 240)), sub = Math.max(1, Math.ceil(hz / fps)), dt = dtFrame / sub;
    var g = (w.gravity === undefined ? 980 : w.gravity) / PPM, ga = rad(w.gravityAngle || 0);
    var world = new planck.World({ gravity: Vec2(-Math.sin(ga) * g, Math.cos(ga) * g) });
    var drag = Math.max(0, w.airDrag || 0), warnings = [], out = { frames: frames, fps: fps, bodies: {}, particles: [], contacts: {}, warnings: warnings };
    var ground = world.createBody({ type: 'static' }), byId = {};

    // Paredes en los bordes de la composición: cajas gruesas por fuera para que nada las atraviese.
    if (w.floor || w.sides || w.ceiling) {
      // Se apartan SKIN píxeles para que la piel de Box2D quede justo en el borde.
      var wall = world.createBody({ type: 'static' }), W = scene.width, H = scene.height, T = Math.max(W, H), o = SKIN;
      var boxes = [];
      if (w.floor) boxes.push([W / 2, H + T / 2 + o, W / 2 + T, T / 2]);
      if (w.ceiling) boxes.push([W / 2, -T / 2 - o, W / 2 + T, T / 2]);
      if (w.sides) { boxes.push([-T / 2 - o, H / 2, T / 2, H / 2 + T]); boxes.push([W + T / 2 + o, H / 2, T / 2, H / 2 + T]); }
      boxes.forEach(function (b) { wall.createFixture(new planck.Box(b[2] / PPM, b[3] / PPM, Vec2(b[0] / PPM, b[1] / PPM), 0), { friction: w.wallFriction === undefined ? 0.5 : w.wallFriction, restitution: w.wallBounce || 0 }); });
    }

    var pending = (scene.bodies || []).map(function (b) {
      var built = buildPieces(b.shape);
      if (built.warnings.length) warnings.push({ id: b.id, code: built.warnings[0] });
      return { def: b, built: built, body: null, record: null };
    });
    var live = [];

    function spawn(item, k) {
      var b = item.def, pose = b.type === 'kinematic' && b.track ? at(b.track, k - (b.spawn || 0)) : [b.pose.x, b.pose.y, b.pose.a || 0];
      var type = b.type === 'static' ? 'static' : b.type === 'kinematic' ? 'kinematic' : 'dynamic';
      var body = world.createBody({ type: type, position: Vec2(pose[0] / PPM, pose[1] / PPM), angle: rad(pose[2]), linearDamping: drag, angularDamping: drag, bullet: !!b.bullet });
      var n = attach(body, item.built, b.material || {});
      if (!n) { warnings.push({ id: b.id, code: 'sin-forma' }); world.destroyBody(body); return false; }
      if (type === 'dynamic' && b.velocity) { body.setLinearVelocity(Vec2((b.velocity.x || 0) / PPM, (b.velocity.y || 0) / PPM)); body.setAngularVelocity(rad(b.velocity.a || 0)); }
      body.setUserData(b.id);
      item.body = body; item.record = { from: k, data: [] }; item.spawnFrame = k; byId[b.id] = item;
      out.bodies[b.id] = item.record;
      live.push(item);
      return true;
    }

    // Partículas: emisores que crean cuerpos dinámicos copiando la forma de una capa plantilla.
    var emitters = (scene.emitters || []).map(function (e, i) {
      var shapes = e.shapes || [e.shape];
      return { def: e, built: shapes.map(buildPieces), random: rng(e.seed || (i + 1) * 7919), carry: 0, count: 0 };
    });

    function emit(k) {
      for (var i = 0; i < emitters.length; i++) {
        var em = emitters[i], e = em.def, f = at(e.track, k), x = f[0], y = f[1], angle = f[2], rate = f[3], speed = f[4], spread = f[5], width = f[6];
        if (k < (e.from || 0) || (e.to !== undefined && e.to !== null && k >= e.to)) continue;
        em.carry += Math.max(0, rate) / fps;
        while (em.carry >= 1 && em.count < e.max) {
          em.carry -= 1; em.count++;
          var r = em.random, which = em.built.length > 1 ? Math.min(em.built.length - 1, Math.floor(r() * em.built.length)) : 0, size = Math.max(0.05, (e.size || 1) * (1 + (r() * 2 - 1) * (e.sizeVariation || 0)));
          var dir = rad(angle + (r() * 2 - 1) * spread / 2), along = (r() - 0.5) * width, base = rad(angle);
          var px = x - Math.sin(base) * along, py = y + Math.cos(base) * along, v = speed * (1 + (r() * 2 - 1) * (e.speedVariation || 0));
          var body = world.createBody({ type: 'dynamic', position: Vec2(px / PPM, py / PPM), angle: e.randomRotation ? r() * Math.PI * 2 : 0, linearDamping: drag, angularDamping: drag });
          var n = attach(body, scalePieces(em.built[which], size), (e.materials && e.materials[which]) || e.material || {});
          if (!n) { world.destroyBody(body); continue; }
          body.setLinearVelocity(Vec2(Math.cos(dir) * v / PPM, Math.sin(dir) * v / PPM));
          if (e.spin) body.setAngularVelocity(rad((r() * 2 - 1) * e.spin));
          var rec = { emitter: e.id, template: which, index: em.count, from: k, to: null, scale: round(size, 4), data: [] };
          out.particles.push(rec);
          live.push({ def: { id: null, type: 'dynamic', despawn: e.lifetime > 0 ? k + Math.max(1, Math.round(e.lifetime * fps)) : null }, body: body, record: rec, particle: true });
        }
        if (em.count >= e.max) em.carry = 0;
      }
    }

    var forces = scene.forces || [];
    function applyForces(k) {
      if (!forces.length) return;
      for (var i = 0; i < forces.length; i++) {
        var f = at(forces[i].track, k), fx = f[0] / PPM, fy = f[1] / PPM, fa = rad(f[2]), strength = f[3] / PPM, radius = (f[4] || 0) / PPM, type = forces[i].type;
        if (!strength) continue;
        for (var j = 0; j < live.length; j++) {
          var body = live[j].body;
          if (!body || body.getType() !== 'dynamic') continue;
          var p = body.getWorldCenter(), dx = fx - p.x, dy = fy - p.y, d = Math.sqrt(dx * dx + dy * dy), fall = 1;
          if (radius > 0) { if (d >= radius) continue; var t = d / radius; fall = 1 - t * t * (3 - 2 * t); }
          var m = body.getMass() * strength * fall, ax, ay;
          if (type === 'attract') { if (d < 1e-4) continue; ax = dx / d; ay = dy / d; }
          else { ax = Math.cos(fa); ay = Math.sin(fa); }
          body.applyForceToCenter(Vec2(ax * m, ay * m), true);
        }
      }
    }

    function drive(k) {
      // Cuerpos animados: la velocidad lleva la pose actual a la del siguiente fotograma, así empujan con fuerza real.
      for (var i = 0; i < live.length; i++) {
        var it = live[i];
        if (it.particle || it.def.type !== 'kinematic' || !it.def.track) continue;
        var next = at(it.def.track, k + 1 - (it.def.spawn || 0)), body = it.body, p = body.getPosition();
        body.setLinearVelocity(Vec2((next[0] / PPM - p.x) / dtFrame, (next[1] / PPM - p.y) / dtFrame));
        body.setAngularVelocity((rad(next[2]) - body.getAngle()) / dtFrame);
      }
    }

    // Uniones: se crean en cuanto existen los dos cuerpos. El punto de unión es el anclaje de cada capa (el origen del cuerpo).
    var joints = (scene.joints || []).map(function (j) { return { def: j, made: false }; });
    function connect(k) {
      for (var i = 0; i < joints.length; i++) {
        var J = joints[i], j = J.def;
        if (J.made || J.failed) continue;
        var A = byId[j.a], B = j.b ? byId[j.b] : null;
        if (!A || !A.body || (j.b && (!B || !B.body))) { if (j.b && !(scene.bodies || []).some(function (b) { return b.id === j.b; })) { J.failed = true; warnings.push({ id: j.a, code: 'union-sin-capa' }); } continue; }
        var bodyB = B ? B.body : ground, pa = A.body.getPosition(), pb = B ? B.body.getPosition() : pa;
        if (A.body.getType() !== 'dynamic' && bodyB.getType() !== 'dynamic') { J.failed = true; warnings.push({ id: j.a, code: 'union-sin-dinamico' }); continue; }
        var joint;
        if (j.type === 'pivot') joint = new planck.RevoluteJoint({ collideConnected: false }, A.body, bodyB, Vec2(pa.x, pa.y));
        else {
          // Un muelle sin otra capa tira hacia el punto de partida; una barra rígida sin otra capa sería un pivote.
          if (!B && j.type !== 'spring') { joint = new planck.RevoluteJoint({ collideConnected: false }, A.body, bodyB, Vec2(pa.x, pa.y)); }
          else joint = new planck.DistanceJoint({ collideConnected: true, frequencyHz: j.type === 'spring' ? Math.max(0.05, j.frequency || 2) : 0, dampingRatio: j.type === 'spring' ? Math.max(0, j.damping === undefined ? 0.2 : j.damping) : 0 }, A.body, bodyB, Vec2(pa.x, pa.y), Vec2(pb.x, pb.y));
        }
        world.createJoint(joint); J.made = true;
      }
    }

    // Choques para marcadores: el primer contacto fuerte de cada cuerpo dinámico, sin repetir en menos de 0,1 s.
    var current = 0, lastHit = {}, gap = Math.max(2, Math.round(fps / 10)), minSpeed = (w.markerSpeed || 80) / PPM;
    if (w.markers) world.on('post-solve', function (contact, impulse) {
      var n = impulse.normalImpulses, peak = 0;
      for (var q = 0; q < n.length; q++) peak = Math.max(peak, n[q] || 0);
      [contact.getFixtureA().getBody(), contact.getFixtureB().getBody()].forEach(function (b) {
        var id = b.getUserData();
        if (!id || b.getType() !== 'dynamic' || peak / Math.max(1e-6, b.getMass()) < minSpeed) return;
        if (lastHit[id] !== undefined && current - lastHit[id] < gap) return;
        lastHit[id] = current; (out.contacts[id] = out.contacts[id] || []).push(current);
      });
    });

    var k = 0;
    function step(count) {
      var end = Math.min(frames, k + (count || frames));
      for (; k < end; k++) {
        for (var i = 0; i < pending.length; i++) {
          var it = pending[i];
          if (!it.body && !it.failed && (it.def.spawn || 0) <= k && (it.def.despawn === undefined || it.def.despawn === null || k < it.def.despawn)) { if (!spawn(it, k)) it.failed = true; }
        }
        connect(k);
        emit(k);
        // Bajas: capas que terminan o partículas que agotan su vida.
        for (i = live.length - 1; i >= 0; i--) {
          var d = live[i].def.despawn;
          if (d !== undefined && d !== null && k >= d) { world.destroyBody(live[i].body); if (live[i].particle) live[i].record.to = k; live.splice(i, 1); }
        }
        // Registro del fotograma k (antes de avanzar): el fotograma inicial es la pose de partida.
        for (i = 0; i < live.length; i++) {
          var b = live[i].body, pos = b.getPosition();
          live[i].record.data.push(round(pos.x * PPM, 3), round(pos.y * PPM, 3), round(b.getAngle() * 180 / Math.PI, 3));
        }
        if (k === frames - 1) { k = frames; break; }
        drive(k);
        current = k + 1;
        for (var s = 0; s < sub; s++) { applyForces(k); world.step(dt, 10, 8); }
        for (i = 0; i < live.length; i++) {
          var q = live[i].body.getPosition();
          if (!isFinite(q.x) || !isFinite(q.y)) throw Error('La simulación se volvió inestable. Revisa tamaños y fuerzas extremas.');
        }
      }
      return { done: k >= frames, frame: Math.min(k, frames), frames: frames };
    }

    return { step: step, result: function () { return out; } };
  }

  function run(scene) { var s = create(scene); s.step(); return s.result(); }

  return { create: create, run: run, decompose: decompose, buildPieces: buildPieces, strokeBoxes: strokeBoxes, clean: clean, hull: hull, area: area, PPM: PPM };
}));
