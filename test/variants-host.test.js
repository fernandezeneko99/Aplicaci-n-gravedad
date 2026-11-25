'use strict';
// Variantes de integración con After: capas, tiempos, padres, expresiones, bloqueos, partículas, uniones y avisos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createHost, MockAE, Shape, FootageItem, FileSource } = require('./mock-ae.js');
const Pipeline = require('../src/engine/pipeline.js');
const Raster = require('../src/engine/raster.js');

const HOST = path.join(__dirname, '..', 'src', 'host');
function setup(o) {
  o = o || {};
  const h = createHost(HOST);
  const c = h.project.items.addComp('Variantes', o.w || 1280, o.h || 720, 1, o.duration || 4, o.fps || 25);
  h.project.activeItem = c;
  return { h, c };
}
function shape(c, name, size, pos, kind) {
  const l = c.layers.addShape(); l.name = name;
  const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
  if (kind === 'ellipse') v.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue(size);
  else v.addProperty('ADBE Vector Shape - Rect').property('ADBE Vector Rect Size').setValue(size);
  v.addProperty('ADBE Vector Graphic - Fill');
  l.transform.position.setValue(pos);
  return l;
}
function io(h) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-var-'));
  return { tempDir: dir, async call(m, a) { const r = h.call(m, a); if (!r.ok) throw Error(r.error); return r.data; }, async readAlpha(j) { return Raster.traceFile(j.file); }, async writeText(n, t) { const f = path.join(dir, n); fs.writeFileSync(f, t); return f; }, progress() {} };
}
const ok = (r) => { assert.ok(r.ok, r.error); return r.data; };
const sel = (c, layers) => { for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; layers.forEach((l) => { l.selected = true; }); };
const make = (h, c, layers, mode) => { sel(c, layers); return ok(h.call('assign', { mode: mode || 'dynamic' })); };
const fx = (l, name) => l.property('ADBE Effect Parade').property('Gravedad · ' + name);
const setFx = (l, name, v) => { fx(l, name).property(1)._value = v; };
const lastKey = (l) => { const P = l.transform.position; return P.keys[P.keys.length - 1]; };
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---------- Tiempo ----------
test('29,97 fps con el área de trabajo desplazada: las claves caen exactamente en fotogramas', async () => {
  const { h, c } = setup({ fps: 29.97, duration: 40 });
  c.workAreaStart = 1001 / 29.97; c.workAreaDuration = 2;
  const b = shape(c, 'b', [40, 40], [300, 100]); make(h, c, [b]);
  await Pipeline.simulate(io(h));
  b.transform.position.keys.forEach((k) => { const f = k.t * 29.97; assert.ok(Math.abs(f - Math.round(f)) < 1e-3, 'clave fuera de fotograma: ' + f); });
  assert.ok(Math.abs(b.transform.position.keys[0].t - c.workAreaStart) < 1e-6);
});
test('capa que termina dentro del área de trabajo: claves solo mientras existe', async () => {
  const { h, c } = setup();
  const b = shape(c, 'b', [40, 40], [300, 100]); b.outPoint = 1; make(h, c, [b]);
  await Pipeline.simulate(io(h));
  assert.ok(lastKey(b).t < 1);
});
test('capa fuera del área de trabajo: se ignora sin error', async () => {
  const { h, c } = setup();
  c.workAreaStart = 2; c.workAreaDuration = 2;
  const early = shape(c, 'antes', [40, 40], [300, 100]); early.outPoint = 1.5;
  const b = shape(c, 'b', [40, 40], [600, 100]);
  make(h, c, [early, b]);
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.host.bodies.length, 1);
  assert.strictEqual(early.transform.position.numKeys, 0);
});
test('área de trabajo de 1 fotograma', async () => {
  const { h, c } = setup(); c.workAreaDuration = 1 / 25;
  const b = shape(c, 'b', [40, 40], [300, 100]); make(h, c, [b]);
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.scene.frames, 1);
  assert.deepStrictEqual(plain(lastKey(b).v), [300, 100]);
});

// ---------- Estados de capa ----------
test('capa bloqueada: se desbloquea para escribir y se vuelve a bloquear', async () => {
  const { h, c } = setup();
  const b = shape(c, 'b', [40, 40], [300, 100]);
  b.locked = true; make(h, c, [b]); assert.ok(b.locked, 'sigue bloqueada tras asignar');
  await Pipeline.simulate(io(h));
  assert.ok(b.transform.position.numKeys > 5); assert.ok(b.locked);
  ok(h.call('clear')); assert.strictEqual(b.transform.position.numKeys, 0); assert.ok(b.locked);
  sel(c, [b]); ok(h.call('bodies', { values: { bounce: 0.9 } })); assert.strictEqual(fx(b, 'Rebote').property(1).value, 0.9); assert.ok(b.locked);
});
test('expresión en la posición: se desactiva al escribir la simulación', async () => {
  const { h, c } = setup();
  const b = shape(c, 'b', [40, 40], [300, 100]);
  b.transform.position.expression = 'wiggle(2,20)'; b.transform.position.expressionEnabled = true; b.transform.position.expressionFn = () => [300, 100];
  make(h, c, [b]);
  await Pipeline.simulate(io(h));
  assert.strictEqual(b.transform.position.expressionEnabled, false);
  assert.ok(lastKey(b).v[1] > 600);
});
test('capa oculta (ojo apagado) sigue siendo un cuerpo: obstáculo invisible', async () => {
  const { h, c } = setup();
  const wall = shape(c, 'muro', [400, 30], [640, 400]); wall.enabled = false;
  const b = shape(c, 'b', [40, 40], [640, 100]);
  make(h, c, [wall], 'fixed'); make(h, c, [b]);
  await Pipeline.simulate(io(h));
  assert.ok(Math.abs(lastKey(b).v[1] - 365) < 1.5);
});
test('tipo Desactivado: la capa no participa', async () => {
  const { h, c } = setup();
  const wall = shape(c, 'muro', [400, 30], [640, 400]); make(h, c, [wall], 'fixed');
  setFx(wall, 'Tipo', 3);
  const b = shape(c, 'b', [40, 40], [640, 100]); make(h, c, [b]);
  await Pipeline.simulate(io(h));
  assert.ok(lastKey(b).v[1] > 650);
});
test('capa 3D convertida después de asignar: aviso, no error', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]), b = shape(c, 'b', [40, 40], [600, 100]); make(h, c, [a, b]);
  a.threeDLayer = true;
  const out = await Pipeline.simulate(io(h));
  assert.ok(out.warnings.some((w) => /3D/.test(w)));
  assert.strictEqual(a.transform.position.numKeys, 0);
});
test('capa duplicada con sus controles: ambas se simulan', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]); make(h, c, [a]);
  const b = a.duplicate(); b.transform.position.setValue([700, 100]);
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.summary.written, 2);
});
test('rotación previa con claves del usuario: la simulación continúa desde ella', async () => {
  const { h, c } = setup(); c.workAreaStart = 1; c.workAreaDuration = 2;
  const b = shape(c, 'b', [80, 20], [300, 300]);
  b.transform.rotation.setValueAtTime(0, 0); b.transform.rotation.setValueAtTime(1, 90);
  make(h, c, [b]); ok(h.call('world', { gravity: 0, floor: false, sides: false }));
  const out = await Pipeline.simulate(io(h));
  assert.ok(Math.abs(out.host.bodies[0].velocity.a - 90) < 1, 'gira a 90°/s heredados');
  assert.strictEqual(b.transform.rotation.keys[0].t, 0, 'conserva la clave del usuario');
});

// ---------- Padres ----------
test('cadena de 3 padres girados y escalados: pose inicial exacta en la composición', async () => {
  const { h, c } = setup();
  const p1 = c.layers.addNull(); p1.transform.position.setValue([400, 200]); p1.transform.rotation.setValue(30);
  const p2 = c.layers.addNull(); p2.transform.position.setValue([100, 0]); p2.transform.scale.setValue([150, 150]); p2._parent = p1;
  const b = shape(c, 'b', [20, 20], [40, 0]); b._parent = p2;
  make(h, c, [b]);
  const expect = MockAE.apply(MockAE.world(b, 0), [0, 0]);
  await Pipeline.simulate(io(h));
  const k0 = b.transform.position.keys[0].v;
  assert.ok(Math.hypot(k0[0] - expect[0], k0[1] - expect[1]) < 0.01, k0 + ' vs ' + expect);
  assert.ok(Math.abs(b.transform.rotation.keys[0].v - 30) < 1e-6);
});
test('padre que también es dinámico: los dos caen por separado', async () => {
  const { h, c } = setup();
  const p = shape(c, 'padre', [60, 60], [300, 100]);
  const k = shape(c, 'hija', [30, 30], [100, 0]); k._parent = p;
  make(h, c, [p, k]);
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.summary.written, 2);
  assert.strictEqual(k.parent, null);
});

// ---------- Mundo ----------
test('borrar sin nulo de mundo y con el nulo borrado después de simular', async () => {
  const { h, c } = setup();
  const b = shape(c, 'b', [40, 40], [300, 100]); make(h, c, [b]);
  assert.strictEqual(ok(h.call('clear')).cleared, 0);
  await Pipeline.simulate(io(h));
  c._layers.find((l) => l.comment.indexOf('gravedad:mundo') === 0).remove();
  // Sin el nulo de mundo no hay registro para distinguir claves: no se borra a ciegas y se avisa.
  const r = ok(h.call('clear'));
  assert.strictEqual(r.cleared, 0); assert.strictEqual(r.legacy.length, 1); assert.match(r.legacy[0], /^b \(capa \d+\)$/);
  assert.ok(b.transform.position.numKeys > 5);
});
test('ajustes del mundo con valores basura se ignoran', () => {
  const { h } = setup();
  const s = ok(h.call('world', { gravity: 'mucho', gravityAngle: null, airDrag: -5, quality: 99999, floor: 'sí' }));
  assert.strictEqual(s.world.gravity, 980); assert.strictEqual(s.world.airDrag, 0); assert.strictEqual(s.world.quality, 960); assert.strictEqual(s.world.floor, true);
});
test('desactualizada: cambia con fricción o tipo, no con seleccionar o mover el tiempo', async () => {
  const { h, c } = setup();
  const b = shape(c, 'b', [40, 40], [300, 100]), f = shape(c, 'f', [300, 30], [300, 600]); make(h, c, [b]); make(h, c, [f], 'fixed');
  await Pipeline.simulate(io(h));
  const stale = () => ok(h.call('inspect', { deep: true })).sim.stale;
  assert.strictEqual(stale(), false);
  sel(c, [f]); c.time = 2; assert.strictEqual(stale(), false, 'seleccionar o mover el tiempo no cuenta');
  setFx(b, 'Fricción', 0.9); assert.strictEqual(stale(), true, 'cambiar la fricción sí');
  setFx(b, 'Fricción', 0.4); assert.strictEqual(stale(), false);
  setFx(f, 'Tipo', 1); assert.strictEqual(stale(), true, 'cambiar el tipo sí');
  setFx(f, 'Tipo', 2); c.workAreaDuration = 3; assert.ok(ok(h.call('inspect', { deep: true })).sim.frames !== 75 || stale(), 'cambiar el área de trabajo sí');
});
test('re-simular tras cambiar la gravedad reescribe las claves', async () => {
  const { h, c } = setup();
  const b = shape(c, 'b', [40, 40], [300, 100]); make(h, c, [b]);
  await Pipeline.simulate(io(h));
  const y1 = b.transform.position.keys[10].v[1];
  ok(h.call('world', { gravity: 160 }));
  await Pipeline.simulate(io(h));
  assert.ok(b.transform.position.keys[10].v[1] < y1 - 10);
});
test('latido sin composición y búsqueda de fotograma fuera de rango', () => {
  const { h, c } = setup();
  assert.strictEqual(ok(h.call('seek', { frame: 9999 })).frame, 99);
  assert.strictEqual(ok(h.call('seek', { frame: -5 })).frame, 0);
  h.project.activeItem = null;
  assert.strictEqual(JSON.parse(require('vm').runInContext('Gravedad.tick()', h.ctx)).data, null);
});

// ---------- Inspector ----------
test('inspector con selección mezclada: solo cambia los cuerpos; el tipo convierte capas nuevas', () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]), plainLayer = shape(c, 'normal', [40, 40], [500, 100]);
  make(h, c, [a]);
  sel(c, [a, plainLayer]);
  assert.strictEqual(ok(h.call('bodies', { values: { density: 3 } })).changed, 1);
  assert.strictEqual(plainLayer.property('ADBE Effect Parade').numProperties, 0);
  assert.strictEqual(ok(h.call('bodies', { values: { type: 'fixed' } })).changed, 2);
  assert.strictEqual(fx(plainLayer, 'Tipo').property(1).value, 2);
});
test('inspector: valores fuera de rango se recortan', () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]); make(h, c, [a]); sel(c, [a]);
  ok(h.call('bodies', { values: { bounce: 7, density: -1, shape: 9 } }));
  assert.strictEqual(fx(a, 'Rebote').property(1).value, 1); assert.strictEqual(fx(a, 'Densidad').property(1).value, 0.001); assert.strictEqual(fx(a, 'Forma').property(1).value, 3);
});
test('control animado por el usuario: el inspector pone clave en el instante actual', () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]); make(h, c, [a]); sel(c, [a]);
  const p = fx(a, 'Rebote').property(1); p.setValueAtTime(0, 0.1); p.setValueAtTime(2, 0.5);
  c.time = 1; ok(h.call('bodies', { values: { bounce: 0.8 } }));
  assert.strictEqual(p.numKeys, 3); assert.strictEqual(p.valueAtTime(1), 0.8);
});

// ---------- Contornos compartidos ----------
test('20 capas del mismo PNG: un único render de alfa', async () => {
  const { h, c } = setup();
  const src = new FootageItem('hoja.png', 60, 40, new FileSource(true), (x, y) => ((x - 30) / 30) ** 2 + ((y - 20) / 20) ** 2 <= 1); h.project._items.push(src);
  const layers = []; for (let i = 0; i < 20; i++) { const l = c.layers.add(src); l.transform.position.setValue([80 + i * 55, 100]); layers.push(l); }
  make(h, c, layers);
  await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 1);
});
test('misma precomposición usada 5 veces: un único render', async () => {
  const { h, c } = setup();
  const pre = h.project.items.addComp('pieza', 80, 80, 1, 4, 25); pre.alphaFn = (x, y) => x + y < 80;
  const layers = []; for (let i = 0; i < 5; i++) { const l = c.layers.addPrecomp(pre); l.transform.position.setValue([150 + i * 200, 100]); layers.push(l); }
  make(h, c, layers);
  await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 1);
});
test('precomposición con un efecto que cambia el alfa no comparte render', async () => {
  const { h, c } = setup();
  const pre = h.project.items.addComp('pieza', 80, 80, 1, 4, 25); pre.alphaFn = () => true;
  const a = c.layers.addPrecomp(pre), b = c.layers.addPrecomp(pre); a.transform.position.setValue([300, 100]); b.transform.position.setValue([800, 100]);
  b.property('ADBE Effect Parade').addProperty('ADBE Slider Control').name = 'Mi efecto';
  make(h, c, [a, b]);
  await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 2);
});
test('el render de alfa nunca deja composiciones temporales, aunque falle', async () => {
  const { h, c } = setup();
  const t = c.layers.addText('X'); t._rect = { left: 0, top: 0, width: 0, height: 0 };
  const t2 = c.layers.addText('Y'); t2._rect = { left: 0, top: -50, width: 40, height: 50 }; t2._alphaFn = () => true; t2.transform.position.setValue([600, 100]);
  make(h, c, [t, t2]);
  const before = h.project.numItems;
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(h.project.numItems, before);
  assert.ok(out.warnings.length >= 1, 'avisa del texto vacío');
});

// ---------- Partículas ----------
async function emitWith(h, c, templates, tweak) {
  sel(c, templates); ok(h.call('particles'));
  const em = c._layers.find((l) => l.comment === 'gravedad:emisor');
  setFx(em, 'Máximo', 10); setFx(em, 'Ritmo', 50);
  if (tweak) tweak(em);
  const out = await Pipeline.simulate(io(h));
  return { em, out, parts: c._layers.filter((l) => String(l.comment).indexOf('gravedad:particula:') === 0) };
}
test('partículas de texto', async () => {
  const { h, c } = setup();
  const t = c.layers.addText('★'); t._rect = { left: -20, top: -40, width: 40, height: 40 }; t._alphaFn = (x, y) => Math.abs(x) + Math.abs(y + 20) < 20;
  const { parts } = await emitWith(h, c, [t]);
  assert.strictEqual(parts.length, 10);
});
test('partículas de metraje con alfa: un solo render para todas', async () => {
  const { h, c } = setup();
  const src = new FootageItem('gota.png', 30, 40, new FileSource(true), (x, y) => Math.hypot(x - 15, y - 25) < 15 || (y < 25 && Math.abs(x - 15) < (y / 25) * 15)); h.project._items.push(src);
  const l = c.layers.add(src);
  const { parts } = await emitWith(h, c, [l]);
  assert.strictEqual(parts.length, 10); assert.strictEqual(MockAE.stats.pngs, 1);
});
test('plantilla girada y escalada: las partículas heredan escala y giro relativos', async () => {
  const { h, c } = setup();
  const l = shape(c, 'p', [40, 10], [100, 100]); l.transform.scale.setValue([200, 200]); l.transform.rotation.setValue(45);
  const { parts } = await emitWith(h, c, [l], (em) => { setFx(em, 'Variación de tamaño', 0); setFx(em, 'Tamaño', 50); });
  parts.forEach((p) => assert.deepStrictEqual(plain(p.transform.scale.value), [100, 100]));
});
test('emisor con padre animado: emite desde donde está', async () => {
  const { h, c } = setup();
  const l = shape(c, 'p', [10, 10], [100, 100]);
  sel(c, [l]); ok(h.call('particles'));
  const em = c._layers.find((x) => x.comment === 'gravedad:emisor');
  const parent = c.layers.addNull(); parent.transform.position.setValueAtTime(0, [0, 0]); parent.transform.position.setValueAtTime(4, [800, 0]);
  em._parent = parent; em.transform.position.setValue([100, 100]);
  setFx(em, 'Anchura', 0); setFx(em, 'Velocidad', 0);
  const out = await Pipeline.simulate(io(h));
  out.result.particles.forEach((p) => assert.ok(Math.abs(p.data[0] - (100 + 800 * p.from / 100)) < 2, 'nace bajo el emisor'));
});
test('emisor apagado (ojo) no emite; emisor sin plantilla avisa', async () => {
  const { h, c } = setup();
  const l = shape(c, 'p', [10, 10], [100, 100]); sel(c, [l]); ok(h.call('particles'));
  const em = c._layers.find((x) => x.comment === 'gravedad:emisor');
  const b = shape(c, 'b', [40, 40], [600, 100]); make(h, c, [b]);
  em.enabled = false;
  let out = await Pipeline.simulate(io(h)); assert.strictEqual(out.result.particles.length, 0);
  em.enabled = true; l.remove();
  out = await Pipeline.simulate(io(h));
  assert.ok(out.warnings.some((w) => /capa de partícula/.test(w)));
});
test('dos emisores comparten plantilla', async () => {
  const { h, c } = setup();
  const l = shape(c, 'p', [10, 10], [100, 100]);
  sel(c, [l]); ok(h.call('particles')); sel(c, [l]); ok(h.call('particles'));
  c._layers.filter((x) => x.comment === 'gravedad:emisor').forEach((em) => { setFx(em, 'Máximo', 5); setFx(em, 'Ritmo', 40); });
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.summary.created, 10);
});
test('borrar la simulación quita también las partículas bloqueadas por el usuario', async () => {
  const { h, c } = setup();
  const l = shape(c, 'p', [10, 10], [100, 100]);
  const { parts } = await emitWith(h, c, [l]);
  parts[0].locked = true;
  assert.strictEqual(ok(h.call('clear')).removed, 10);
});

// ---------- Uniones y marcadores ----------
test('unión con la capa destino borrada: aviso y la capa cae normal (no se queda colgada)', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [30, 30], [300, 100]), b = shape(c, 'b', [30, 30], [500, 100]);
  make(h, c, [a, b]);
  sel(c, [a, b]); ok(h.call('join', { type: 'distance' }));
  const holder = [a, b].find((l) => l.property('ADBE Effect Parade').property('Gravedad · Unión')), other = holder === a ? b : a;
  other.remove();
  const out = await Pipeline.simulate(io(h));
  assert.ok(out.warnings.some((w) => /ya no existe/.test(w)), out.warnings.join(' | '));
  assert.ok(lastKey(holder).v[1] > 600, 'cae normal');
});
test('unión de una sola capa (colgada de su anclaje) sigue funcionando tras reordenar capas', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [30, 30], [300, 100]); a.transform.anchorPoint.setValue([-100, 0]);
  sel(c, [a]); ok(h.call('join', { type: 'pivot' }));
  shape(c, 'nueva encima', [10, 10], [50, 50]);
  const out = await Pipeline.simulate(io(h));
  assert.deepStrictEqual(out.scene.joints.map((j) => j.b), [null]);
  a.transform.position.keys.forEach((k) => assert.ok(Math.hypot(k.v[0] - 300, k.v[1] - 100) < 1));
});
test('pivote entre dos dinámicos: giran juntos alrededor del anclaje', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [100, 20], [400, 300]), b = shape(c, 'b', [100, 20], [400, 300]);
  sel(c, [a, b]); ok(h.call('join', { type: 'pivot' }));
  ok(h.call('world', { gravity: 0 }));
  setFx(a, 'Giro inicial', 180);
  await Pipeline.simulate(io(h));
  a.transform.position.keys.forEach((k, i) => { const kb = b.transform.position.keys[Math.min(i, b.transform.position.keys.length - 1)]; assert.ok(Math.hypot(k.v[0] - kb.v[0], k.v[1] - kb.v[1]) < 2); });
});
test('los marcadores del usuario se conservan al re-simular y al borrar', async () => {
  const { h, c } = setup();
  ok(h.call('world', { markers: true }));
  const b = shape(c, 'b', [60, 60], [300, 300]); make(h, c, [b]); setFx(b, 'Rebote', 0);
  b.property('ADBE Marker').setValueAtTime(0.5, { comment: 'Mi nota' });
  await Pipeline.simulate(io(h)); await Pipeline.simulate(io(h));
  const M = b.property('ADBE Marker');
  assert.ok(M.keys.some((k) => k.v.comment === 'Mi nota'));
  assert.strictEqual(M.keys.filter((k) => k.v.comment === 'Gravedad · choque').length, 1);
  ok(h.call('clear'));
  assert.deepStrictEqual(M.keys.map((k) => k.v.comment), ['Mi nota']);
});

// ---------- Escala ----------
test('300 cuerpos: escritura sin errores y claves recortadas', async () => {
  const { h, c } = setup({ w: 1920, h: 1080, duration: 6 });
  const layers = []; for (let i = 0; i < 300; i++) layers.push(shape(c, 'c' + i, [24, 24], [40 + (i % 50) * 37, 40 + Math.floor(i / 50) * 40], i % 2 ? 'ellipse' : 'rect'));
  make(h, c, layers);
  const t = Date.now(), out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.summary.written, 300);
  assert.ok(out.summary.keys < 300 * 150 * 2, 'claves recortadas: ' + out.summary.keys);
  assert.ok(Date.now() - t < 60000);
});
