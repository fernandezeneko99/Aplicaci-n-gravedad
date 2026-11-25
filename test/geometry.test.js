'use strict';
/*
 * Bordes y colisiones con todo tipo de capas y formas, de extremo a extremo (After simulado → motor → claves).
 * El contorno visible de cada forma se calcula aquí de forma independiente (geometría analítica, no el código del host)
 * y, tras simular, se comprueba que el objeto toca el suelo con su borde visible: ni hueco ni hundimiento.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createHost, MockAE, Shape, FootageItem, FileSource } = require('./mock-ae.js');
const Pipeline = require('../src/engine/pipeline.js');
const Raster = require('../src/engine/raster.js');

const HOST = path.join(__dirname, '..', 'src', 'host');
const W = 1280, H = 720, TOL = 1.5, TOL_RASTER = 3;

function setup(seconds) {
  const h = createHost(HOST);
  const c = h.project.items.addComp('Formas', W, H, 1, seconds || 4, 25);
  h.project.activeItem = c;
  return { h, c };
}
function io(h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-geo-'));
  return { tempDir: dir, async call(m, a) { const r = h.call(m, a); if (!r.ok) throw Error(r.error); return r.data; }, async readAlpha(job) { return Raster.traceFile(job.file); }, async writeText(n, t) { const f = path.join(dir, n); fs.writeFileSync(f, t); return f; }, progress() {} };
}
const ok = (r) => { assert.ok(r.ok, r.error); return r.data; };
function select(c, layers) { for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; layers.forEach((l) => { l.selected = true; }); }
async function simulate(h, c, dynamic, fixed) {
  if (dynamic.length) { select(c, dynamic); ok(h.call('assign', { mode: 'dynamic' })); }
  if (fixed && fixed.length) { select(c, fixed); ok(h.call('assign', { mode: 'fixed' })); }
  return Pipeline.simulate(io(h));
}

// ---------- Construcción de capas de forma y su contorno de referencia ----------
const unit = [1, 0, 0, 1, 0, 0];
const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const ap = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
function groupMatrix(g) { const r = (g.rotation || 0) * Math.PI / 180, s = g.scale || [100, 100], a = g.anchor || [0, 0], p = g.position || [0, 0]; return mul(mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), p[0], p[1]], [s[0] / 100, 0, 0, s[1] / 100, 0, 0]), [1, 0, 0, 1, -a[0], -a[1]]); }
function bezier(p0, p1, p2, p3, t) { const u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; }
// Puntos densos del borde de cada forma (coordenadas del grupo).
function samples(item) {
  const out = [];
  if (item.ellipse) { const [w, h] = item.ellipse, p = item.pos || [0, 0]; for (let i = 0; i < 720; i++) { const a = i / 720 * 2 * Math.PI; out.push([p[0] + Math.cos(a) * w / 2, p[1] + Math.sin(a) * h / 2]); } }
  if (item.rect) {
    const [w, h] = item.rect, p = item.pos || [0, 0], r = Math.min(item.round || 0, w / 2, h / 2);
    for (let i = 0; i < 2000; i++) {
      const t = i / 2000 * 4, side = Math.floor(t), f = t - side;
      let pt = side === 0 ? [-w / 2 + f * w, -h / 2] : side === 1 ? [w / 2, -h / 2 + f * h] : side === 2 ? [w / 2 - f * w, h / 2] : [-w / 2, h / 2 - f * h];
      if (r) { const cx = Math.max(-w / 2 + r, Math.min(w / 2 - r, pt[0])), cy = Math.max(-h / 2 + r, Math.min(h / 2 - r, pt[1])), dx = pt[0] - cx, dy = pt[1] - cy, d = Math.hypot(dx, dy); if (d > r) pt = [cx + dx / d * r, cy + dy / d * r]; }
      out.push([pt[0] + p[0], pt[1] + p[1]]);
    }
  }
  if (item.star) {
    const st = item.star, n = st.type === 2 ? st.points : st.points * 2, v = [];
    for (let q = 0; q < n; q++) { const a = ((st.rotation || 0) - 90 + q * 360 / n) * Math.PI / 180, r = st.type !== 2 && q % 2 ? st.inner : st.outer; v.push([Math.cos(a) * r, Math.sin(a) * r]); }
    for (let q = 0; q < n; q++) { const a = v[q], b = v[(q + 1) % n]; for (let k = 0; k < 50; k++) out.push([a[0] + (b[0] - a[0]) * k / 50, a[1] + (b[1] - a[1]) * k / 50]); }
  }
  if (item.path) {
    const v = item.path, ins = item.inT || v.map(() => [0, 0]), outs = item.outT || v.map(() => [0, 0]), n = v.length, count = item.closed === false ? n - 1 : n;
    for (let j = 0; j < count; j++) { const k = (j + 1) % n; for (let s = 0; s < 120; s++) out.push(bezier(v[j], [v[j][0] + outs[j][0], v[j][1] + outs[j][1]], [v[k][0] + ins[k][0], v[k][1] + ins[k][1]], v[k], s / 120)); }
    if (item.closed === false) out.push(v[n - 1]);
  }
  return out;
}
// Crea la capa y devuelve también sus puntos de borde en coordenadas de capa y el medio grosor de trazo visible.
function shapeLayer(c, spec) {
  const l = c.layers.addShape(); l.name = spec.name || 'Forma';
  const ref = { points: [], half: 0 };
  function build(parentContents, items, m) {
    let stroke = 0, fill = false;
    items.forEach((it) => {
      if (it.group) {
        const g = parentContents.addProperty('ADBE Vector Group'), tr = g.property('ADBE Vector Transform Group');
        if (it.group.position) tr.property('ADBE Vector Position').setValue(it.group.position);
        if (it.group.scale) tr.property('ADBE Vector Scale').setValue(it.group.scale);
        if (it.group.rotation) tr.property('ADBE Vector Rotation').setValue(it.group.rotation);
        if (it.group.anchor) tr.property('ADBE Vector Anchor').setValue(it.group.anchor);
        if (it.group.opacity !== undefined) tr.property('ADBE Vector Group Opacity').setValue(it.group.opacity);
        if (it.group.opacity === 0) { build(g.property('ADBE Vectors Group'), it.group.contents, null); return; }
        build(g.property('ADBE Vectors Group'), it.group.contents, mul(m || unit, groupMatrix(it.group)));
      } else if (it.ellipse) { const e = parentContents.addProperty('ADBE Vector Shape - Ellipse'); e.property('ADBE Vector Ellipse Size').setValue(it.ellipse); if (it.pos) e.property('ADBE Vector Ellipse Position').setValue(it.pos); }
      else if (it.rect) { const r = parentContents.addProperty('ADBE Vector Shape - Rect'); r.property('ADBE Vector Rect Size').setValue(it.rect); if (it.pos) r.property('ADBE Vector Rect Position').setValue(it.pos); if (it.round) r.property('ADBE Vector Rect Roundness').setValue(it.round); }
      else if (it.star) { const s = parentContents.addProperty('ADBE Vector Shape - Star'); s.property('ADBE Vector Star Type').setValue(it.star.type || 1); s.property('ADBE Vector Star Points').setValue(it.star.points); s.property('ADBE Vector Star Outer Radius').setValue(it.star.outer); s.property('ADBE Vector Star Inner Radius').setValue(it.star.inner || 0); if (it.star.round) s.property('ADBE Vector Star Outer Roundess').setValue(it.star.round); }
      else if (it.path) { const p = parentContents.addProperty('ADBE Vector Shape - Group'), sh = new Shape(); sh.vertices = it.path; sh.inTangents = it.inT || it.path.map(() => [0, 0]); sh.outTangents = it.outT || it.path.map(() => [0, 0]); sh.closed = it.closed !== false; p.property('ADBE Vector Shape').setValue(sh); }
      else if (it.fill !== undefined) { const f = parentContents.addProperty(it.gradient ? 'ADBE Vector Graphic - G-Fill' : 'ADBE Vector Graphic - Fill'); if (it.fill === 'transparent') f.property('ADBE Vector Fill Opacity').setValue(0); if (it.fill === 'disabled') f.enabled = false; if (it.fill === true) fill = true; }
      else if (it.stroke) { const s = parentContents.addProperty(it.gradient ? 'ADBE Vector Graphic - G-Stroke' : 'ADBE Vector Graphic - Stroke'); s.property('ADBE Vector Stroke Width').setValue(it.stroke); stroke = it.stroke; }
      else if (it.modifier) { const f = parentContents.addProperty(it.modifier); if (it.mode) f.property('ADBE Vector Merge Type').setValue(it.mode); }
      if (m && (it.ellipse || it.rect || it.star || it.path)) samples(it).forEach((p) => ref.points.push(ap(m, p)));
    });
    if (m && stroke) ref.half = Math.max(ref.half, stroke / 2 * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])));
  }
  build(l.property('ADBE Root Vectors Group'), [{ group: { contents: spec.contents } }], unit);
  l.transform.position.setValue(spec.pos || [W / 2, 200]);
  if (spec.rotation) l.transform.rotation.setValue(spec.rotation);
  if (spec.scale) l.transform.scale.setValue(spec.scale);
  if (spec.anchor) l.transform.anchorPoint.setValue(spec.anchor);
  l._ref = ref;
  return l;
}
// Pose final de la capa (ya sin padre) → borde más bajo visible en la composición.
function lowest(l, ref, frame) {
  const tr = l.property('ADBE Transform Group'), P = tr.property('ADBE Position'), R = tr.property('ADBE Rotate Z');
  const pick = (prop) => prop.numKeys ? (frame === undefined ? prop.keys[prop.keys.length - 1].v : prop.valueAtTime(frame)) : prop.value;
  const p = pick(P), r = pick(R) * Math.PI / 180, s = tr.property('ADBE Scale').value, a = tr.property('ADBE Anchor Point').value;
  const m = mul(mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), p[0], p[1]], [s[0] / 100, 0, 0, s[1] / 100, 0, 0]), [1, 0, 0, 1, -a[0], -a[1]]);
  const k = Math.sqrt(Math.abs(s[0] * s[1])) / 100;
  let max = -Infinity; for (const q of ref.points) max = Math.max(max, ap(m, q)[1]);
  return max + (ref.half || 0) * k;
}
function assertOnFloor(l, ref, tol, label) {
  const y = lowest(l, ref || l._ref);
  assert.ok(Math.abs(y - H) <= (tol || TOL), (label || l.name) + ': borde visible a ' + (y - H).toFixed(2) + ' px del suelo');
}

// ---------- Capas de forma: cada tipo cae y apoya su borde visible en el suelo ----------
const CASES = [
  { name: 'rectángulo', contents: [{ rect: [200, 120] }, { fill: true }], rotation: 25 },
  { name: 'rectángulo con trazo de 24 px', contents: [{ rect: [200, 120] }, { fill: true }, { stroke: 24 }], rotation: 10 },
  { name: 'rectángulo redondeado', contents: [{ rect: [220, 140], round: 40 }, { fill: true }], rotation: 35 },
  { name: 'círculo', contents: [{ ellipse: [150, 150] }, { fill: true }] },
  { name: 'círculo con trazo de 16 px', contents: [{ ellipse: [150, 150] }, { fill: true }, { stroke: 16 }] },
  { name: 'elipse ovalada', contents: [{ ellipse: [260, 90] }, { fill: true }], rotation: 50 },
  { name: 'estrella de 5 puntas', contents: [{ star: { points: 5, outer: 110, inner: 45 } }, { fill: true }], rotation: 7 },
  { name: 'estrella de 12 puntas muy afilada', contents: [{ star: { points: 12, outer: 120, inner: 30 } }, { fill: true }] },
  { name: 'polígono de 6 lados', contents: [{ star: { type: 2, points: 6, outer: 90 } }, { fill: true }], rotation: 13 },
  { name: 'triángulo', contents: [{ star: { type: 2, points: 3, outer: 100 } }, { fill: true }], rotation: 70 },
  { name: 'trazado irregular cóncavo con curvas', contents: [{ path: [[-120, -40], [-30, -110], [40, -60], [130, -90], [110, 60], [10, 20], [-60, 110]], inT: [[0, 30], [-40, 0], [-10, -20], [-20, -20], [20, -30], [30, 0], [10, 30]], outT: [[0, -30], [40, 0], [10, 20], [20, 20], [-20, 30], [-30, 0], [-10, -30]] }, { fill: true }], rotation: 20 },
  { name: 'forma de C (muy cóncava)', contents: [{ path: [[-100, -100], [100, -100], [100, -60], [-60, -60], [-60, 60], [100, 60], [100, 100], [-100, 100]] }, { fill: true }], rotation: 90 },
  { name: 'trazado abierto con relleno (After lo cierra)', contents: [{ path: [[-100, 50], [0, -100], [100, 50]], closed: false }, { fill: true }] },
  { name: 'relleno degradado con trazo degradado', contents: [{ rect: [180, 100] }, { fill: true, gradient: true }, { stroke: 20, gradient: true }], rotation: 15 },
  { name: 'grupo escalado, girado y con anclaje', contents: [{ group: { scale: [150, 80], rotation: 30, anchor: [20, -10], position: [15, 5], contents: [{ rect: [120, 120] }, { fill: true }] } }] },
  { name: 'dos piezas separadas en una capa', contents: [{ ellipse: [80, 80], pos: [-90, 0] }, { rect: [60, 120], pos: [90, 0] }, { fill: true }], rotation: 5 },
  { name: 'grupo oculto (opacidad 0) no colisiona', contents: [{ rect: [100, 100] }, { fill: true }, { group: { opacity: 0, contents: [{ rect: [600, 600], pos: [0, 300] }, { fill: true }] } }] },
  { name: 'forma diminuta (6 px)', contents: [{ rect: [6, 6] }, { fill: true }] },
  { name: 'barra fina (300 × 3 px)', contents: [{ rect: [300, 3] }, { fill: true }], rotation: 3 }
];
for (const k of CASES) {
  test('borde visible en el suelo · ' + k.name, async () => {
    const { h, c } = setup(k.seconds || 4);
    const l = shapeLayer(c, k);
    const out = await simulate(h, c, [l]);
    assert.deepStrictEqual(out.warnings, []);
    assertOnFloor(l);
  });
}

test('trazo sin relleno (anillo hueco dinámico): apoya el borde exterior del trazo', async () => {
  const { h, c } = setup();
  const ring = shapeLayer(c, { name: 'anillo', contents: [{ ellipse: [200, 200] }, { stroke: 20 }] });
  const out = await simulate(h, c, [ring]);
  assert.strictEqual(out.scene.bodies[0].shape.kind, 'stroke');
  assertOnFloor(ring);
});

test('relleno transparente o desactivado + trazo = hueco', async () => {
  for (const fill of ['transparent', 'disabled']) {
    const { h, c } = setup();
    const l = shapeLayer(c, { name: fill, contents: [{ rect: [160, 160] }, { fill }, { stroke: 10 }] });
    const out = await simulate(h, c, [l]);
    assert.strictEqual(out.scene.bodies[0].shape.kind, 'stroke', fill);
    assertOnFloor(l, null, TOL, fill);
  }
});

test('trazo abierto en U (vaso): una bola cae dentro y no lo atraviesa', async () => {
  const { h, c } = setup();
  const cup = shapeLayer(c, { name: 'vaso', pos: [640, 500], contents: [{ path: [[-150, -150], [-150, 150], [150, 150], [150, -150]], closed: false }, { stroke: 14 }] });
  const ball = shapeLayer(c, { name: 'bola', pos: [640, 250], contents: [{ ellipse: [80, 80] }, { fill: true }] });
  await simulate(h, c, [ball], [cup]);
  const end = ball.transform.position.keys.slice(-1)[0].v;
  assert.ok(Math.abs(end[1] - (650 - 7 - 40)) <= TOL, 'reposa en el fondo interior: ' + end);
  assert.ok(Math.abs(end[0] - 640) < 110, 'dentro del vaso: ' + end);
});

test('rampa hecha con un trazo abierto: la bola rueda a distancia radio + medio trazo', async () => {
  const { h, c } = setup(3);
  const ramp = shapeLayer(c, { name: 'rampa', pos: [640, 400], contents: [{ path: [[-500, -150], [500, 150]], closed: false }, { stroke: 12 }] });
  const ball = shapeLayer(c, { name: 'bola', pos: [240, 150], contents: [{ ellipse: [60, 60] }, { fill: true }] });
  await simulate(h, c, [ball], [ramp]);
  const keys = ball.transform.position.keys, len = Math.hypot(1000, 300), nx = -300 / len, ny = 1000 / len;
  let touching = 0;
  for (const k of keys.slice(25, 50)) { const d = Math.abs((k.v[0] - 640) * nx + (k.v[1] - 400) * ny); if (d < 60) { touching++; assert.ok(Math.abs(d - 36) <= TOL, 'distancia a la rampa ' + d.toFixed(2)); } }
  assert.ok(touching > 10, 'rueda sobre la rampa');
});

test('cóncava fija (C): una bola entra en el hueco y se queda dentro', async () => {
  const { h, c } = setup();
  const cshape = shapeLayer(c, { name: 'C', pos: [640, 560], contents: [{ path: [[-150, -150], [-100, -150], [-100, 100], [100, 100], [100, -150], [150, -150], [150, 150], [-150, 150]] }, { fill: true }] });
  const ball = shapeLayer(c, { name: 'bola', pos: [640, 200], contents: [{ ellipse: [100, 100] }, { fill: true }] });
  await simulate(h, c, [ball], [cshape]);
  const end = ball.transform.position.keys.slice(-1)[0].v;
  assert.ok(Math.abs(end[1] - (660 - 50)) <= TOL && Math.abs(end[0] - 640) < 60, 'en el fondo del hueco: ' + end);
});

test('apilado: una estrella sobre una caja no se hunde en ella', async () => {
  const { h, c } = setup(5);
  const box = shapeLayer(c, { name: 'caja', pos: [640, 600], contents: [{ rect: [400, 80] }, { fill: true }] });
  const star = shapeLayer(c, { name: 'estrella', pos: [640, 300], contents: [{ star: { points: 5, outer: 80, inner: 35 } }, { fill: true }] });
  await simulate(h, c, [box, star]);
  assertOnFloor(box);
  const boxTop = box.transform.position.keys.slice(-1)[0].v[1] - 40;
  const starBottom = lowest(star, star._ref);
  assert.ok(Math.abs(starBottom - boxTop) <= TOL, 'contacto exacto: ' + (starBottom - boxTop).toFixed(2));
});

test('transformaciones de capa: escala no uniforme, espejo, anclaje desplazado y rotación', async () => {
  const variants = [{ scale: [50, 200] }, { scale: [-100, 100], rotation: 30 }, { scale: [100, -80] }, { anchor: [60, -40], rotation: 45 }, { scale: [250, 250] }];
  for (const v of variants) {
    const { h, c } = setup();
    const l = shapeLayer(c, Object.assign({ name: JSON.stringify(v), contents: [{ star: { points: 4, outer: 70, inner: 30 } }, { fill: true }] }, v));
    await simulate(h, c, [l]);
    assertOnFloor(l, null, TOL, JSON.stringify(v));
  }
});

test('capa con padre escalado: se quita el padre y el borde sigue siendo el visible', async () => {
  const { h, c } = setup();
  const parent = c.layers.addNull(); parent.transform.position.setValue([400, 150]); parent.transform.scale.setValue([200, 200]);
  const l = shapeLayer(c, { name: 'hija', pos: [50, 20], contents: [{ rect: [60, 40] }, { fill: true }] });
  l._parent = parent;
  await simulate(h, c, [l]);
  assert.strictEqual(l.parent, null);
  assertOnFloor(l);
});

// ---------- Modificadores de forma: se usa el alfa renderizado ----------
for (const mod of [['recortar trazados', 'ADBE Vector Filter - Trim'], ['combinar trazados en modo restar', 'ADBE Vector Filter - Merge', 3], ['repetidor', 'ADBE Vector Filter - Repeater']]) {
  test('modificador «' + mod[0] + '»: se detecta el contorno por el alfa', async () => {
    const { h, c } = setup();
    const l = shapeLayer(c, { name: mod[0], contents: [{ rect: [200, 100] }, { fill: true }, { modifier: mod[1], mode: mod[2] }] });
    // Lo que After dibujaría: un triángulo (distinto de la caja, para comprobar que se usa el alfa).
    l._rect = { left: -100, top: -50, width: 200, height: 100 };
    l._alphaFn = (x, y) => y >= -50 && y <= 50 && Math.abs(x) <= (y + 50);
    const out = await simulate(h, c, [l]);
    assert.strictEqual(MockAE.stats.pngs, 1, 'se renderiza el alfa');
    const pts = out.scene.bodies[0].shape.contours.flat();
    assert.ok(Math.min(...pts.map((p) => p[1])) < -45 && Math.max(...pts.map((p) => Math.abs(p[0]) * (p[1] < -30))) < 30, 'contorno triangular, no caja');
    const ref = { points: [[0, -50], [-100, 50], [100, 50]].flatMap((a, i, arr) => { const b = arr[(i + 1) % 3], o = []; for (let k = 0; k < 100; k++) o.push([a[0] + (b[0] - a[0]) * k / 100, a[1] + (b[1] - a[1]) * k / 100]); return o; }) };
    assertOnFloor(l, ref, TOL_RASTER);
  });
}

test('estrella con esquinas redondeadas: se usa el alfa', async () => {
  const { h, c } = setup();
  const l = shapeLayer(c, { name: 'estrella redonda', contents: [{ star: { points: 5, outer: 100, inner: 50, round: 30 } }, { fill: true }] });
  l._rect = { left: -100, top: -100, width: 200, height: 200 };
  l._alphaFn = (x, y) => Math.hypot(x, y) <= 90;
  const out = await simulate(h, c, [l]);
  assert.strictEqual(MockAE.stats.pngs, 1);
  const ref = { points: Array.from({ length: 360 }, (_, i) => [Math.cos(i * Math.PI / 180) * 90, Math.sin(i * Math.PI / 180) * 90]) };
  assertOnFloor(l, ref, TOL_RASTER);
  assert.deepStrictEqual(out.warnings, []);
});

// ---------- Máscaras ----------
function solid(c, w, h, pos) { const s = c.layers.addSolid([1, 0, 0], 'Sólido', w, h, 1); s.transform.position.setValue(pos || [W / 2, 200]); return s; }
function mask(l, verts, opts) {
  opts = opts || {};
  const m = l.property('ADBE Mask Parade').addProperty('ADBE Mask Atom'), sh = new Shape();
  sh.vertices = verts; sh.inTangents = verts.map(() => [0, 0]); sh.outTangents = verts.map(() => [0, 0]); sh.closed = true;
  m.property('ADBE Mask Shape').setValue(sh);
  if (opts.mode) m.maskMode = opts.mode;
  if (opts.inverted) m.inverted = true;
  if (opts.expansion) m.property('ADBE Mask Offset').setValue(opts.expansion);
  return m;
}
const tri = [[150, 0], [300, 260], [0, 260]], triRef = (grow) => ({ points: tri.flatMap((a, i) => { const b = tri[(i + 1) % 3], o = []; for (let k = 0; k < 200; k++) o.push([a[0] + (b[0] - a[0]) * k / 200, a[1] + (b[1] - a[1]) * k / 200]); return o; }), half: grow || 0 });

test('máscara triangular en un sólido: colisiona el triángulo, no el sólido', async () => {
  const { h, c } = setup();
  const s = solid(c, 300, 300); mask(s, tri);
  const out = await simulate(h, c, [s]);
  assert.strictEqual(out.scene.bodies[0].shape.kind, 'poly');
  assertOnFloor(s, triRef());
});

test('máscara con expansión positiva: el borde crece lo expandido', async () => {
  const { h, c } = setup();
  const s = solid(c, 300, 300); mask(s, tri, { expansion: 12 });
  await simulate(h, c, [s]);
  // La expansión redondea las esquinas: el punto más bajo queda entre 12 px (lado) y la banda del trazo.
  const y = lowest(s, triRef(12));
  assert.ok(y - H <= TOL && y - H >= -12, 'expansión aplicada: ' + (y - H).toFixed(2));
});

test('máscaras en modo restar o invertidas se ignoran con aviso; expansión negativa avisa', async () => {
  const { h, c } = setup();
  const s = solid(c, 300, 300); mask(s, tri); mask(s, [[0, 0], [50, 0], [50, 50]], { mode: 'SUBTRACT' });
  const out = await simulate(h, c, [s]);
  assert.ok(out.warnings.some((w) => /máscaras en modo Añadir/.test(w)));
  assertOnFloor(s, triRef());
  const { h: h2, c: c2 } = setup();
  const s2 = solid(c2, 300, 300); mask(s2, tri, { expansion: -10 });
  const out2 = await simulate(h2, c2, [s2]);
  assert.ok(out2.warnings.some((w) => /expansión negativa/.test(w)));
});

test('máscara sobre una capa de forma manda sobre su contenido', async () => {
  const { h, c } = setup();
  const l = shapeLayer(c, { name: 'forma con máscara', contents: [{ rect: [300, 300] }, { fill: true }] });
  mask(l, [[-50, -50], [50, -50], [50, 50], [-50, 50]]);
  await simulate(h, c, [l]);
  assertOnFloor(l, { points: [[-50, 50], [50, 50], [-50, -50], [50, -50]] });
});

// ---------- Texto, precomposiciones y metraje (alfa renderizado) ----------
function letters(x, y) {
  // «HI» de 200 × 120 en coordenadas de capa (la línea base en y = 0, el texto hacia arriba).
  if (y < -120 || y > 0) return false;
  const inH = (x >= -100 && x <= -80) || (x >= -40 && x <= -20) || (x >= -100 && x <= -20 && y >= -70 && y <= -50);
  const inI = x >= 40 && x <= 60;
  return inH || inI;
}
test('capa de texto: colisiona con las letras (alfa), cada letra es una pieza', async () => {
  const { h, c } = setup();
  const t = c.layers.addText('HI'); t.transform.position.setValue([640, 200]);
  t._rect = { left: -100, top: -120, width: 160, height: 120 }; t._alphaFn = letters;
  const out = await simulate(h, c, [t]);
  assert.strictEqual(MockAE.stats.pngs, 1);
  assert.ok(out.scene.bodies[0].shape.contours.length >= 2, 'H e I por separado');
  const ref = { points: [] }; for (let y = -120; y <= 0; y += 1) for (let x = -100; x <= 60; x += 1) if (letters(x, y)) ref.points.push([x, y]);
  assertOnFloor(t, ref, TOL_RASTER);
});

test('texto: una bola cae entre las letras H e I y queda en el hueco', async () => {
  const { h, c } = setup();
  const t = c.layers.addText('HI'); t.transform.position.setValue([640, 700]);
  t._rect = { left: -100, top: -120, width: 160, height: 120 }; t._alphaFn = letters;
  const ball = shapeLayer(c, { name: 'bola', pos: [650, 400], contents: [{ ellipse: [50, 50] }, { fill: true }] });
  await simulate(h, c, [ball], [t]);
  const end = ball.transform.position.keys.slice(-1)[0].v;
  assert.ok(end[0] > 620 && end[0] < 680, 'entre las letras: ' + end);
});

test('precomposición con contenido en L: concavidad respetada', async () => {
  const { h, c } = setup();
  const pre = h.project.items.addComp('Precomp L', 300, 300, 1, 4, 25);
  pre.alphaFn = (x, y) => x >= 0 && x <= 300 && y >= 0 && y <= 300 && (x <= 80 || y >= 220);
  const l = c.layers.addPrecomp(pre); l.transform.position.setValue([640, 570]);
  const ball = shapeLayer(c, { name: 'bola', pos: [720, 200], contents: [{ ellipse: [100, 100] }, { fill: true }] });
  await simulate(h, c, [ball], [l]);
  assert.strictEqual(MockAE.stats.pngs, 1);
  const end = ball.transform.position.keys.slice(-1)[0].v;
  // El suelo interior de la L está en y = 570 - 150 + 220 = 640; la bola (r = 50) reposa en 590.
  assert.ok(Math.abs(end[1] - 590) <= TOL_RASTER, 'apoya en el interior de la L: ' + end);
});

test('precomposición dinámica: borde visible en el suelo', async () => {
  const { h, c } = setup();
  const pre = h.project.items.addComp('Precomp rombo', 200, 200, 1, 4, 25);
  pre.alphaFn = (x, y) => Math.abs(x - 100) + Math.abs(y - 100) <= 100;
  const l = c.layers.addPrecomp(pre); l.transform.rotation.setValue(10);
  await simulate(h, c, [l]);
  const ref = { points: [] }; for (let a = 0; a < 400; a++) { const t = a / 400 * 4, s = Math.floor(t), f = t - s, v = [[100, 0], [200, 100], [100, 200], [0, 100]]; const p = v[s], q = v[(s + 1) % 4]; ref.points.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
  assertOnFloor(l, ref, TOL_RASTER);
});

test('PNG con alfa y agujero (dónut): el agujero se rellena, el borde exterior colisiona', async () => {
  const { h, c } = setup();
  const src = new FootageItem('donut.png', 240, 240, new FileSource(true), (x, y) => { const d = Math.hypot(x - 120, y - 120); return d <= 110 && d >= 50; });
  h.project._items.push(src);
  const l = c.layers.add(src);
  const out = await simulate(h, c, [l]);
  assert.strictEqual(out.scene.bodies[0].shape.contours.length >= 1, true);
  const ref = { points: Array.from({ length: 720 }, (_, i) => [120 + Math.cos(i / 720 * 2 * Math.PI) * 110, 120 + Math.sin(i / 720 * 2 * Math.PI) * 110]) };
  assertOnFloor(l, ref, TOL_RASTER);
});

test('formas forzadas: Caja y Círculo usan los límites de la capa', async () => {
  for (const [kind, expect] of [[2, 'poly'], [3, 'circle']]) {
    const { h, c } = setup();
    const l = shapeLayer(c, { name: 'estrella', contents: [{ star: { points: 5, outer: 100, inner: 40 } }, { fill: true }] });
    l._rect = { left: -100, top: -100, width: 200, height: 200 };
    select(c, [l]); ok(h.call('assign', { mode: 'dynamic' }));
    l.property('ADBE Effect Parade').property('Gravedad · Forma').property(1)._value = kind;
    const out = await Pipeline.simulate(io(h));
    assert.strictEqual(out.scene.bodies[0].shape.kind, expect);
    const y = l.transform.position.keys.slice(-1)[0].v[1];
    if (kind === 3) assert.ok(Math.abs(y - (H - 100)) <= TOL, 'círculo de radio 100: ' + y);
  }
});

test('trazado que se cruza (figura en 8): colisiona con aviso, sin romperse', async () => {
  const { h, c } = setup();
  const l = shapeLayer(c, { name: 'ocho', contents: [{ path: [[-100, -60], [100, 60], [100, -60], [-100, 60]] }, { fill: true }] });
  const out = await simulate(h, c, [l]);
  assert.ok(out.warnings.some((w) => /se cruza/.test(w)), out.warnings.join(' | '));
  assert.ok(l.transform.position.keys.slice(-1)[0].v[1] < H, 'no atraviesa el suelo');
});

// ---------- Rendimiento ----------
test('rendimiento: contorno irregular de 1500 vértices se descompone rápido', () => {
  const Sim = require('../src/engine/sim.js');
  const pts = []; for (let i = 0; i < 1500; i++) { const a = i / 1500 * 2 * Math.PI, r = 300 + 60 * Math.sin(a * 13) + 25 * Math.sin(a * 41); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const t = Date.now(), d = Sim.decompose([pts]), ms = Date.now() - t;
  assert.ok(ms < 1500, 'descomposición en ' + ms + ' ms');
  assert.ok(d.pieces.length > 5);
});

test('rendimiento: trazar el alfa de una imagen de 2000 × 2000', () => {
  const w = 2000, img = { width: w, height: w, alpha: (x, y) => (Math.hypot(x - 1000, y - 1000) < 900 + 80 * Math.sin(Math.atan2(y - 1000, x - 1000) * 9) ? 255 : 0) };
  const t = Date.now(), cs = Raster.trace(img), ms = Date.now() - t;
  assert.ok(ms < 3000, 'trazado en ' + ms + ' ms');
  assert.ok(cs.length >= 1 && cs[0].length > 20);
});

test('rendimiento: re-simular sin cambios no borra claves una a una', async () => {
  const { h, c } = setup(6);
  const layers = []; for (let i = 0; i < 20; i++) layers.push(shapeLayer(c, { name: 'c' + i, pos: [100 + i * 55, 100 + (i % 3) * 60], contents: [{ rect: [40, 40] }, { fill: true }] }));
  await simulate(h, c, layers);
  MockAE.stats.removeKey = 0;
  await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.removeKey, 0, 'claves sobrescritas en su sitio, no borradas');
});

// ---------- Montón de formas mezcladas: nadie se mete dentro de nadie ----------
function worldOutline(l) {
  const tr = l.property('ADBE Transform Group'), P = tr.property('ADBE Position'), R = tr.property('ADBE Rotate Z');
  const p = P.numKeys ? P.keys[P.keys.length - 1].v : P.value, r = (R.numKeys ? R.keys[R.keys.length - 1].v : R.value) * Math.PI / 180, s = tr.property('ADBE Scale').value, a = tr.property('ADBE Anchor Point').value;
  const m = mul(mul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), p[0], p[1]], [s[0] / 100, 0, 0, s[1] / 100, 0, 0]), [1, 0, 0, 1, -a[0], -a[1]]);
  return l._ref.points.map((q) => ap(m, q));
}
function inside(poly, pt) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (((poly[i][1] > pt[1]) !== (poly[j][1] > pt[1])) && (pt[0] < (poly[j][0] - poly[i][0]) * (pt[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0])) c = !c; return c; }
function depth(poly, pt) { let d = Infinity; for (let i = 0; i < poly.length; i += 2) d = Math.min(d, Math.hypot(poly[i][0] - pt[0], poly[i][1] - pt[1])); return d; }

test('montón de 30 formas mezcladas: sin penetraciones visibles y todas dentro', { timeout: 120000 }, async () => {
  const { h, c } = setup(8);
  const kinds = [
    [{ rect: [70, 50] }, { fill: true }],
    [{ ellipse: [60, 60] }, { fill: true }],
    [{ star: { points: 5, outer: 45, inner: 20 } }, { fill: true }],
    [{ star: { type: 2, points: 3, outer: 45 } }, { fill: true }],
    [{ path: [[-40, -40], [40, -40], [40, -20], [-20, -20], [-20, 20], [40, 20], [40, 40], [-40, 40]] }, { fill: true }],
    [{ path: [[-45, -15], [-10, -45], [15, -25], [45, -35], [35, 25], [5, 10], [-25, 40]], inT: [[0, 10], [-15, 0], [-5, -8], [-8, -8], [8, -10], [10, 0], [4, 10]], outT: [[0, -10], [15, 0], [5, 8], [8, 8], [-8, 10], [-10, 0], [-4, -10]] }, { fill: true }],
    [{ rect: [60, 40], round: 15 }, { fill: true }, { stroke: 8 }],
    [{ ellipse: [80, 40] }, { fill: true }]
  ];
  const layers = [];
  for (let i = 0; i < 30; i++) layers.push(shapeLayer(c, { name: 'f' + i, pos: [180 + (i % 10) * 92, 80 + Math.floor(i / 10) * 110], rotation: (i * 37) % 360, contents: kinds[i % kinds.length] }));
  const out = await simulate(h, c, layers);
  assert.deepStrictEqual(out.warnings, []);
  const polys = layers.map(worldOutline);
  let worst = 0, where = '';
  for (let a = 0; a < polys.length; a++) for (let b = 0; b < polys.length; b++) {
    if (a === b) continue;
    for (const pt of polys[a]) if (inside(polys[b], pt)) { const d = depth(polys[b], pt); if (d > worst) { worst = d; where = layers[a].name + ' dentro de ' + layers[b].name; } }
  }
  const strokeHalf = 4;
  if (process.env.GRAVEDAD_VERBOSE) console.log('penetración máxima', worst.toFixed(2), where);
  assert.ok(worst <= 1.5, 'penetración máxima ' + worst.toFixed(2) + ' px (' + where + ')');
  polys.forEach((p, i) => p.forEach((q) => assert.ok(q[0] > -2 && q[0] < W + 2 && q[1] < H + 2, layers[i].name + ' fuera de la composición: ' + q)));
});
