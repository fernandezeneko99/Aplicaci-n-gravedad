'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createHost, MockAE, Shape, FootageItem, FileSource } = require('./mock-ae.js');
const Pipeline = require('../src/engine/pipeline.js');
const Raster = require('../src/engine/raster.js');

const HOST = path.join(__dirname, '..', 'src', 'host');

function setup(opts) {
  opts = opts || {};
  const h = createHost(HOST);
  const c = h.project.items.addComp('Comp 1', opts.w || 1280, opts.h || 720, 1, opts.duration || 4, opts.fps || 25);
  h.project.activeItem = c;
  return { h, c };
}
function shape(c, name, kind, size, pos, opts) {
  opts = opts || {};
  const l = c.layers.addShape(); l.name = name;
  const g = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'), v = g.property('ADBE Vectors Group');
  if (kind === 'ellipse') v.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue(size);
  else if (kind === 'rect') v.addProperty('ADBE Vector Shape - Rect').property('ADBE Vector Rect Size').setValue(size);
  else { const p = v.addProperty('ADBE Vector Shape - Group'), s = new Shape(); s.vertices = kind; s.inTangents = kind.map(() => [0, 0]); s.outTangents = kind.map(() => [0, 0]); s.closed = opts.closed !== false; p.property('ADBE Vector Shape').setValue(s); }
  if (opts.stroke) { v.addProperty('ADBE Vector Graphic - Stroke').property('ADBE Vector Stroke Width').setValue(opts.stroke); }
  else v.addProperty('ADBE Vector Graphic - Fill');
  l.transform.position.setValue(pos);
  return l;
}
function select(c, layers) { for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; layers.forEach((l) => { l.selected = true; }); }

function io(h, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-test-'));
  return Object.assign({
    tempDir: dir,
    async call(method, arg) { const r = h.call(method, arg); if (!r.ok) throw Error(r.error + ' (línea ' + r.line + ')'); return r.data; },
    async readAlpha(job) { return Raster.traceFile(job.file); },
    async writeText(name, text) { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; },
    progress() {}
  }, extra || {});
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const ok = (r) => { assert.ok(r.ok, r.error + ' línea ' + r.line); return r.data; };
const keysOf = (p) => JSON.parse(JSON.stringify(p.keys.map((k) => [k.t, k.v])));

test('sin composición activa: error claro', () => {
  const h = createHost(HOST);
  const r = h.call('inspect');
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /composici/);
});

test('asignar crea controles nativos y el resumen los cuenta', () => {
  const { h, c } = setup();
  const a = shape(c, 'Bola', 'ellipse', [100, 100], [300, 100]), b = shape(c, 'Suelo', 'rect', [800, 40], [640, 600]);
  select(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  select(c, [b]); const s = ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(s.dynamic, 1); assert.strictEqual(s.fixed, 1);
  const fx = a.property('ADBE Effect Parade');
  const names = fx._children.map((e) => e.name);
  assert.deepStrictEqual(names, ['Gravedad · Tipo', 'Gravedad · Forma', 'Gravedad · Densidad', 'Gravedad · Fricción', 'Gravedad · Rebote', 'Gravedad · Impulso', 'Gravedad · Dirección del impulso', 'Gravedad · Giro inicial']);
  assert.deepStrictEqual(plain(fx.property(1).property(1).items), ['Dinámico', 'Fijo', 'Desactivado']);
  assert.strictEqual(fx.property(1).property(1).value, 1);
  assert.strictEqual(b.property('ADBE Effect Parade').property(1).property(1).value, 2);
  // reasignar no duplica controles y cambia el tipo
  select(c, [a]); ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(a.property('ADBE Effect Parade').numProperties, 8);
  assert.strictEqual(ok(h.call('inspect')).fixed, 2);
  assert.deepStrictEqual(MockAE.stats.undoGroups.slice(-1), ['Gravedad · Asignar']);
});

test('si el menú desplegable falla se usa un deslizador equivalente', () => {
  const { h, c } = setup();
  MockAE.failDropdown = true;
  try {
    const a = shape(c, 'A', 'rect', [50, 50], [100, 100]); select(c, [a]); ok(h.call('assign', { mode: 'fixed' }));
    const fx = a.property('ADBE Effect Parade');
    assert.strictEqual(fx.property(1).matchName, 'ADBE Slider Control');
    assert.strictEqual(fx.property(1).property(1).value, 2);
    assert.ok(!fx._children.some((e) => e.matchName === 'ADBE Dropdown Control'));
  } finally { MockAE.failDropdown = false; }
});

test('validación: nulos, 3D y sin selección', () => {
  const { h, c } = setup();
  const n = c.layers.addNull(); select(c, [n]);
  assert.match(h.call('assign', { mode: 'dynamic' }).error, /nulo/);
  const s = shape(c, 'S', 'rect', [10, 10], [0, 0]); s.threeDLayer = true; select(c, [s]);
  assert.match(h.call('assign', { mode: 'dynamic' }).error, /2D/);
  select(c, []);
  assert.match(h.call('assign', { mode: 'dynamic' }).error, /Selecciona/);
});

test('simulación completa: la bola cae sobre la plataforma y se escriben claves por fotograma', async () => {
  const { h, c } = setup();
  const ball = shape(c, 'Bola', 'ellipse', [100, 100], [640, 100]), floor = shape(c, 'Plataforma', 'rect', [600, 40], [640, 500]);
  select(c, [ball]); ok(h.call('assign', { mode: 'dynamic' }));
  select(c, [floor]); ok(h.call('assign', { mode: 'fixed' }));
  const out = await Pipeline.simulate(io(h));
  assert.deepStrictEqual(out.warnings, []);
  assert.strictEqual(out.scene.bodies.find((b) => b.id === String(ball.id)).shape.kind, 'circle');
  const P = ball.transform.position;
  assert.ok(P.numKeys > 20 && P.numKeys <= 100, 'claves por fotograma hasta que reposa: ' + P.numKeys);
  P.keys.forEach((k, i) => assert.ok(Math.abs(k.t - i / 25) < 1e-6, 'una clave en cada fotograma'));
  assert.deepStrictEqual(plain(P.keys[0].v), [640, 100]);
  const end = P.keys.slice(-1)[0].v;
  assert.ok(Math.abs(end[1] - (480 - 50)) < 2, 'reposa sobre la plataforma: ' + end);
  assert.strictEqual(floor.transform.position.numKeys, 0, 'el fijo no se toca');
  assert.strictEqual(out.summary.written, 1);
  assert.strictEqual(out.summary.simulated, 1);
  assert.deepStrictEqual(MockAE.stats.undoGroups.slice(-1), ['Gravedad · Simular']);
  // Re-simular parte de la misma pose (la primera clave) y da lo mismo
  const first = keysOf(P);
  await Pipeline.simulate(io(h));
  assert.deepStrictEqual(keysOf(P), first);
});

test('borrar simulación devuelve la capa a su pose de partida', async () => {
  const { h, c } = setup();
  const box = shape(c, 'Caja', 'rect', [80, 80], [300, 200]); box.transform.rotation.setValue(20);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.ok(box.transform.position.numKeys > 10);
  const s = ok(h.call('clear'));
  assert.strictEqual(s.cleared, 1);
  assert.strictEqual(box.transform.position.numKeys, 0);
  assert.deepStrictEqual(plain(box.transform.position.value), [300, 200]);
  assert.ok(Math.abs(box.transform.rotation.value - 20) < 1e-6);
});

test('animación del usuario antes del inicio: se conserva y da la velocidad de lanzamiento', async () => {
  const { h, c } = setup({ duration: 4 });
  c.workAreaStart = 1; c.workAreaDuration = 2;
  const box = shape(c, 'Lanzada', 'rect', [40, 40], [100, 300]);
  const P = box.transform.position; P.setValueAtTime(0.5, [0, 300]); P.setValueAtTime(1, [200, 300]);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  ok(h.call('world', { environment: 'space', walls: false }));
  const out = await Pipeline.simulate(io(h));
  const b = out.host.bodies[0];
  assert.ok(Math.abs(b.velocity.x - 400) < 1, 'velocidad ' + JSON.stringify(b.velocity));
  assert.deepStrictEqual(plain(P.keys[0]), { t: 0.5, v: [0, 300] }, 'la clave del usuario sigue');
  const last = P.keys[P.keys.length - 1];
  assert.ok(Math.abs(last.t - (1 + 49 / 25)) < 1e-6);
  assert.ok(Math.abs(last.v[0] - (200 + 400 * 49 / 25)) < 2, 'sigue moviéndose a 400 px/s: ' + last.v);
  // Borrar conserva la animación del usuario y deja la pose en el inicio
  ok(h.call('clear'));
  assert.deepStrictEqual(P.keys.map((k) => k.t), [0.5, 1]);
});

test('capa con padre: se quita el padre conservando la pose y se simula en la composición', async () => {
  const { h, c } = setup();
  const parent = c.layers.addNull(); parent.transform.position.setValue([400, 100]); parent.transform.rotation.setValue(30);
  const box = shape(c, 'Hija', 'rect', [60, 60], [100, 0]); box.parent = null; box._parent = parent;
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  const b = out.host.bodies[0];
  assert.ok(Math.abs(b.pose.a - 30) < 1e-6);
  assert.strictEqual(box.parent, null);
  const k0 = box.transform.position.keys[0].v, r0 = box.transform.rotation.keys[0].v;
  assert.ok(Math.abs(k0[0] - (400 + 100 * Math.cos(Math.PI / 6))) < 0.01 && Math.abs(k0[1] - (100 + 100 * Math.sin(Math.PI / 6))) < 0.01, String(k0));
  assert.ok(Math.abs(r0 - 30) < 1e-6);
});

test('fijo animado (cinemático) sigue su animación y empuja', async () => {
  const { h, c } = setup();
  const pusher = shape(c, 'Pala', 'rect', [80, 200], [100, 600]);
  pusher.transform.position.setValueAtTime(0, [100, 600]); pusher.transform.position.setValueAtTime(3, [1100, 600]);
  const box = shape(c, 'Caja', 'rect', [60, 60], [400, 690]);
  select(c, [pusher]); ok(h.call('assign', { mode: 'fixed' }));
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  const kin = out.scene.bodies.find((b) => b.id === String(pusher.id));
  assert.strictEqual(kin.type, 'kinematic');
  assert.strictEqual(kin.track.length, 100);
  assert.strictEqual(pusher.transform.position.numKeys, 2, 'la animación del fijo no cambia');
  assert.ok(box.transform.position.keys.slice(-1)[0].v[0] > 900, 'empujada: ' + box.transform.position.keys.slice(-1)[0].v);
});

test('dimensiones separadas: se escriben X e Y', async () => {
  const { h, c } = setup();
  const box = shape(c, 'Sep', 'rect', [40, 40], [0, 0]);
  const tr = box.property('ADBE Transform Group'); tr.property('ADBE Position').dimensionsSeparated = true; tr.property('ADBE Position_0').setValue(300); tr.property('ADBE Position_1').setValue(100);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.strictEqual(tr.property('ADBE Position_0').numKeys, tr.property('ADBE Position_1').numKeys);
  assert.ok(tr.property('ADBE Position_1').keys.slice(-1)[0].v > 600);
});

test('alfa de metraje: se renderiza, se traza y se borra la composición temporal', async () => {
  const { h, c } = setup();
  // Triángulo con transparencia en una imagen de 200x200
  const src = new FootageItem('tri.png', 200, 200, new FileSource(true), (x, y) => y >= 20 && y <= 180 && Math.abs(x - 100) <= (y - 20) * 0.5);
  h.project._items.push(src);
  const tri = c.layers.add(src); tri.transform.position.setValue([640, 200]);
  select(c, [tri]); ok(h.call('assign', { mode: 'dynamic' }));
  const before = h.project.numItems;
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 1);
  assert.strictEqual(h.project.numItems, before, 'sin composiciones temporales');
  const shp = out.scene.bodies[0].shape, xs = shp.contours.flat().map((p) => p[0]), ys = shp.contours.flat().map((p) => p[1]);
  assert.ok(Math.min(...ys) > -85 && Math.min(...ys) < -75, 'vértice superior ~ -80: ' + Math.min(...ys));
  assert.ok(Math.max(...xs) > 75 && Math.max(...xs) < 85);
  // Reposa sobre el suelo (base del triángulo a 80 px por debajo del ancla)
  const last = tri.transform.position.keys.slice(-1)[0].v;
  assert.ok(Math.abs(last[1] - (720 - 80)) < 4, String(last));
});

test('metraje opaco y sólidos usan su rectángulo sin renderizar', async () => {
  const { h, c } = setup();
  const solid = c.layers.addSolid([1, 0, 0], 'Sólido', 100, 50, 1); solid.transform.position.setValue([300, 300]);
  const jpg = new FootageItem('foto.jpg', 120, 80, new FileSource(false)); h.project._items.push(jpg);
  const photo = c.layers.add(jpg); photo.transform.position.setValue([800, 300]);
  select(c, [solid, photo]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 0);
  assert.ok(Math.abs(solid.transform.position.keys.slice(-1)[0].v[1] - (720 - 25)) < 0.5);
  assert.ok(Math.abs(photo.transform.position.keys.slice(-1)[0].v[1] - (720 - 40)) < 0.6, String(photo.transform.position.keys.slice(-1)[0].v));
  assert.strictEqual(out.warnings.length, 0);
});

test('trazo sin relleno = recipiente hueco que retiene objetos', async () => {
  const { h, c } = setup();
  const cup = shape(c, 'Vaso', [[-150, -150], [-150, 150], [150, 150], [150, -150]], null, [640, 500], { stroke: 12, closed: false });
  const ball = shape(c, 'Bola', 'ellipse', [60, 60], [640, 300]);
  select(c, [cup]); ok(h.call('assign', { mode: 'fixed' }));
  select(c, [ball]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.scene.bodies.find((b) => b.id === String(cup.id)).shape.kind, 'stroke');
  const end = ball.transform.position.keys.slice(-1)[0].v;
  assert.ok(Math.abs(end[1] - (650 - 6 - 30)) < 2, 'dentro del vaso: ' + end);
});

test('forma con modificadores (repetidor): se usa el alfa renderizado', async () => {
  const { h, c } = setup();
  const l = shape(c, 'Repetida', 'rect', [50, 50], [300, 100]);
  l.property('ADBE Root Vectors Group').property(1).property('ADBE Vectors Group').addProperty('ADBE Vector Filter - Repeater');
  select(c, [l]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 1);
  assert.ok(Math.abs(l.transform.position.keys.slice(-1)[0].v[1] - 695) < 3, String(l.transform.position.keys.slice(-1)[0].v));
});

test('forma forzada a caja o círculo', async () => {
  const { h, c } = setup();
  const l = shape(c, 'Estrella', [[0, -50], [15, -15], [50, 0], [15, 15], [0, 50], [-15, 15], [-50, 0], [-15, -15]], null, [300, 100]);
  select(c, [l]); ok(h.call('assign', { mode: 'dynamic' }));
  l.property('ADBE Effect Parade').property('Gravedad · Forma').property(1)._value = 3;
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.scene.bodies[0].shape.kind, 'circle');
  assert.strictEqual(out.scene.bodies[0].shape.r, 50);
});

test('mundo: espacio sin paredes; Tierra con paredes', async () => {
  const { h, c } = setup();
  const s = ok(h.call('world', { environment: 'space', walls: false }));
  assert.strictEqual(s.world.gravity, 0); assert.strictEqual(s.world.floor, false);
  const s2 = ok(h.call('world', { environment: 'earth', walls: true }));
  assert.strictEqual(s2.world.gravity, 980); assert.strictEqual(s2.world.floor, true); assert.strictEqual(s2.world.sides, true);
  assert.strictEqual(c._layers.filter((l) => String(l.comment).indexOf('gravedad:mundo') === 0).length, 1, 'un solo mundo');
});

test('fuerza: ventilador creado con guía y controles; empuja a los cuerpos', async () => {
  const { h, c } = setup();
  ok(h.call('world', { environment: 'space', walls: false }));
  const fan = ok(h.call('force', { type: 'wind' }));
  assert.strictEqual(fan.forces, 1);
  const f = c._layers.find((l) => l.comment === 'gravedad:fuerza');
  assert.ok(f.guideLayer);
  f.transform.rotation.setValue(0);
  const box = shape(c, 'Caja', 'rect', [40, 40], [200, 360]);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.ok(box.transform.position.keys.slice(-1)[0].v[0] > 1000);
});

test('partículas: crea emisor y plantilla, genera capas y las reemplaza al re-simular', async () => {
  const { h, c } = setup({ duration: 2 });
  const s = ok(h.call('particles'));
  assert.strictEqual(s.emitters, 1);
  const em = c._layers.find((l) => l.comment === 'gravedad:emisor'), tpl = c._layers.find((l) => l.name === 'Forma de partícula');
  assert.strictEqual(tpl.enabled, false);
  em.property('ADBE Effect Parade').property('Gravedad · Máximo').property(1)._value = 12;
  const out = await Pipeline.simulate(io(h));
  const parts = c._layers.filter((l) => String(l.comment).indexOf('gravedad:particula:') === 0);
  assert.strictEqual(parts.length, 12);
  assert.strictEqual(out.summary.created, 12);
  parts.forEach((p) => { assert.ok(p.enabled); assert.strictEqual(p.property('ADBE Effect Parade').numProperties, 0); assert.ok(p.transform.position.numKeys > 1); assert.ok(p.inPoint > 0 || p.transform.position.keys[0].t === 0); });
  const p0 = parts.find((p) => /001$/.test(p.name));
  assert.ok(Math.abs(p0.inPoint - p0.transform.position.keys[0].t) < 1e-6);
  await Pipeline.simulate(io(h));
  assert.strictEqual(c._layers.filter((l) => String(l.comment).indexOf('gravedad:particula:') === 0).length, 12, 'sin duplicados');
  ok(h.call('clear'));
  assert.strictEqual(c._layers.filter((l) => String(l.comment).indexOf('gravedad:particula:') === 0).length, 0);
});

test('capa que entra tarde aparece en su punto de entrada', async () => {
  const { h, c } = setup();
  const box = shape(c, 'Tarde', 'rect', [40, 40], [300, 100]); box.inPoint = 2;
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  const P = box.transform.position;
  assert.strictEqual(P.keys[0].t, 2); assert.deepStrictEqual(plain(P.keys[0].v), [300, 100]);
  assert.ok(P.numKeys <= 50 && P.numKeys > 20);
});

test('escena sin cuerpos: mensaje que explica qué hacer', async () => {
  const { h } = setup();
  await assert.rejects(Pipeline.simulate(io(h)), /No hay cuerpos/);
});

test('el archivo de resultado se lee con evalFile y una composición distinta se rechaza', async () => {
  const { h, c } = setup();
  const box = shape(c, 'Caja', 'rect', [40, 40], [300, 100]);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  const f = path.join(os.tmpdir(), 'gravedad-otro.jsx');
  fs.writeFileSync(f, 'Gravedad._incoming = {"compId": 999, "frames": 1, "bodies": {}, "particles": [], "emitters": {}};');
  assert.match(h.call('apply', { file: f }).error, /ya no existe/);
});

test('impulso inicial desde los controles (0° = arriba)', async () => {
  const { h, c } = setup();
  ok(h.call('world', { environment: 'space', walls: false }));
  const box = shape(c, 'Lanzada', 'rect', [40, 40], [300, 300]);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  const fx = box.property('ADBE Effect Parade');
  fx.property('Gravedad · Impulso').property(1)._value = 250; fx.property('Gravedad · Dirección del impulso').property(1)._value = 90; fx.property('Gravedad · Giro inicial').property(1)._value = 45;
  await Pipeline.simulate(io(h));
  const P = box.transform.position.keys, R = box.transform.rotation.keys;
  assert.ok(Math.abs(P[25].v[0] - 550) < 1 && Math.abs(P[25].v[1] - 300) < 0.5, 'a 250 px/s a la derecha: ' + P[25].v);
  assert.ok(Math.abs(R[25].v - 45) < 0.5, 'gira 45°/s: ' + R[25].v);
});

test('unir: una capa queda colgada de su anclaje (péndulo); dos capas, barra entre anclajes', async () => {
  const { h, c } = setup();
  const bob = shape(c, 'Péndulo', 'rect', [30, 30], [400, 100]);
  bob.property('ADBE Transform Group').property('ADBE Anchor Point')._value = [-150, 0];
  select(c, [bob]);
  const s = ok(h.call('join', { type: 'pivot' }));
  assert.strictEqual(s.joined, 1); assert.strictEqual(s.dynamic, 1);
  const out = await Pipeline.simulate(io(h));
  assert.deepStrictEqual(out.scene.joints, [{ a: String(bob.id), b: null, type: 'pivot', frequency: 2, damping: 0.2 }]);
  const keys = bob.transform.position.keys;
  keys.forEach((k) => assert.ok(Math.hypot(k.v[0] - 400, k.v[1] - 100) < 1, 'el pivote no se mueve: ' + k.v));
  assert.ok(Math.max(...bob.transform.rotation.keys.map((k) => k.v)) > 60, 'oscila');

  const hook = shape(c, 'Gancho', 'rect', [20, 20], [900, 100]), weight = shape(c, 'Peso', 'ellipse', [40, 40], [900, 300]);
  select(c, [weight, hook]);
  ok(h.call('join', { type: 'spring' }));
  weight.property('ADBE Effect Parade').property('Gravedad · Rigidez del muelle').property(1)._value = 0.5;
  assert.strictEqual(hook.property('ADBE Effect Parade').property(1).property(1).value, 2, 'la segunda capa pasa a Fijo');
  await Pipeline.simulate(io(h));
  assert.ok(weight.transform.position.keys.some((k) => k.v[1] > 330), 'el muelle se estira');
  assert.strictEqual(hook.transform.position.numKeys, 0);
});

test('marcadores al chocar se escriben y se reemplazan', async () => {
  const { h, c } = setup();
  ok(h.call('world', { markers: true }));
  const box = shape(c, 'Caja', 'rect', [60, 60], [300, 300]);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  box.property('ADBE Effect Parade').property('Gravedad · Rebote').property(1)._value = 0;
  await Pipeline.simulate(io(h));
  const M = box.property('ADBE Marker');
  assert.strictEqual(M.numKeys, 1);
  assert.strictEqual(M.keys[0].v.comment, 'Gravedad · choque');
  await Pipeline.simulate(io(h));
  assert.strictEqual(M.numKeys, 1, 'no se duplican');
  ok(h.call('clear'));
  assert.strictEqual(M.numKeys, 0);
});

test('partículas con varias formas seleccionadas y desvanecimiento', async () => {
  const { h, c } = setup({ duration: 2 });
  const a = shape(c, 'Confeti A', 'rect', [20, 8], [100, 100]), b = shape(c, 'Confeti B', 'ellipse', [14, 14], [140, 100]);
  select(c, [a, b]);
  ok(h.call('particles'));
  const em = c._layers.find((l) => l.comment === 'gravedad:emisor'), fx = em.property('ADBE Effect Parade');
  assert.ok(fx.property('Gravedad · Capa de partícula 2'));
  assert.ok(!a.enabled && !b.enabled);
  fx.property('Gravedad · Máximo').property(1)._value = 30; fx.property('Gravedad · Ritmo').property(1)._value = 60; fx.property('Gravedad · Vida').property(1)._value = 1;
  await Pipeline.simulate(io(h));
  const parts = c._layers.filter((l) => String(l.comment).indexOf('gravedad:particula:') === 0);
  assert.strictEqual(parts.length, 30);
  assert.ok(parts.some((p) => p.name.indexOf('Confeti A') === 0) && parts.some((p) => p.name.indexOf('Confeti B') === 0));
  const O = parts[0].property('ADBE Transform Group').property('ADBE Opacity');
  assert.strictEqual(O.numKeys, 2); assert.strictEqual(O.keys[1].v, 0);
  assert.ok(Math.abs(O.keys[1].t - parts[0].outPoint) < 1e-6);
});

test('claves recortadas: un cuerpo en reposo no recibe claves repetidas', async () => {
  const { h, c } = setup({ duration: 8 });
  const box = shape(c, 'Caja', 'rect', [60, 60], [300, 600]);
  select(c, [box]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.ok(box.transform.position.numKeys < 60, 'se detienen al reposar: ' + box.transform.position.numKeys);
});

test('unir: la unión va en la capa que se mueve aunque se seleccione después', () => {
  const { h, c } = setup();
  const hook = shape(c, 'Gancho', 'rect', [20, 20], [600, 100]); select(c, [hook]); ok(h.call('assign', { mode: 'fixed' }));
  const bob = shape(c, 'Bola', 'ellipse', [40, 40], [600, 300]);
  c._layers.splice(c._layers.indexOf(hook), 1); c._layers.unshift(hook); // el gancho queda primero
  select(c, [hook, bob]); ok(h.call('join', { type: 'distance' }));
  assert.ok(bob.property('ADBE Effect Parade').property('Gravedad · Unión'));
  assert.ok(!hook.property('ADBE Effect Parade').property('Gravedad · Unión'));
});
