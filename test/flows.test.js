'use strict';
// Flujos completos de un editor en el modelo de After: cambios de tipo con el cursor en distintos instantes, Fijo →
// Dinámico, secuencias con cambio de inicio, clave editada a mano, cancelar, borrar, deshacer y reabrir, y fallos a mitad.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createHost, MockAE } = require('./mock-ae.js');
const Pipeline = require('../src/engine/pipeline.js');
const Raster = require('../src/engine/raster.js');

const HOST = path.join(__dirname, '..', 'src', 'host');
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
function setup() { const h = createHost(HOST); const c = h.project.items.addComp('Flujos', 1280, 720, 1, 4, 25); h.project.activeItem = c; return { h, c }; }
function shape(c, name, kind, size, pos) {
  const l = c.layers.addShape(); l.name = name;
  const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
  v.addProperty(kind === 'circle' ? 'ADBE Vector Shape - Ellipse' : 'ADBE Vector Shape - Rect').property(kind === 'circle' ? 'ADBE Vector Ellipse Size' : 'ADBE Vector Rect Size').setValue(size);
  v.addProperty('ADBE Vector Graphic - Fill');
  l.transform.position.setValue(pos);
  return l;
}
function io(h, extra) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-flujos-')); return Object.assign({ tempDir: d, async call(m, a) { const r = h.call(m, a); if (!r.ok) throw Error(r.error); return r.data; }, async readAlpha(j) { return Raster.traceFile(j.file); }, async writeText(n, t) { const f = path.join(d, n); fs.writeFileSync(f, t); return f; }, progress() {} }, extra || {}); }
const ok = (r) => { assert.ok(r.ok, r.error); return r.data; };
const sel = (c, ls) => { for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; ls.forEach((l) => { l.selected = true; }); };
const plain = (v) => JSON.parse(JSON.stringify(v));
const byId = (c, id) => c._layers.find((l) => l.id === id);
const keys = (p) => plain(p.keys.map((k) => ({ t: +k.t.toFixed(6), v: k.v, a: k.a || null })));
const controls = (l) => plain(l.property('ADBE Effect Parade')._children.map((e) => [e.name, e.property(1).value]));
const fx = (l) => l.property('ADBE Effect Parade').property('Gravedad · Tipo').property(1);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' ≈ ' + b);

// Escena: A (bola sin animación propia), P (pala con claves propias de Posición y suavizado), B (caja que cae sobre ellas).
async function scene() {
  const { h, c } = setup();
  const A = shape(c, 'A', 'circle', [60, 60], [400, 300]);
  const P = shape(c, 'P', 'rect', [200, 20], [800, 300]);
  P.transform.position.setValueAtTime(0, [800, 300]); P.transform.position.setValueAtTime(1, [820, 300]);
  P.transform.position.setInterpolationTypeAtKey(2, KIT.BEZIER, KIT.HOLD); P.transform.position.setTemporalEaseAtKey(2, [{ speed: 2, influence: 60 }], [{ speed: 0, influence: 20 }]);
  for (let i = 1; i <= P.transform.position.numKeys; i++) P.transform.position._k(i);
  const original = keys(P.transform.position);
  const B = shape(c, 'B', 'rect', [40, 40], [400, 100]);
  sel(c, [A, P, B]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  return { h, c, A, P, B, original };
}

// ---------- Cambio de tipo con el cursor al principio, a mitad y al final ----------
for (const [label, t] of [['principio', 0], ['mitad', 1.2], ['final', 3.96], ['después del final', 10]]) {
  for (const via of ['panel', 'Controles de efectos']) {
    test('Fijo con el cursor al ' + label + ' (' + via + '): posición, rotación y controladores; B choca con A en esa pose', async () => {
      const { h, c, A, B } = await scene();
      const tc = Math.min(t, 99 / 25);
      c.time = t;
      const visible = plain(A.transform.position.valueAtTime(tc)), rot = A.transform.rotation.valueAtTime(tc), before = controls(A);
      if (via === 'panel') { sel(c, [A]); ok(h.call('assign', { mode: 'fixed' })); }
      else { fx(A)._value = 2; c.time = t; }
      // Por Controles de efectos el cambio surte efecto al simular; se mueve B encima de la pose congelada para comprobar el choque.
      B.transform.position.keys.length = 0; B.transform.position._value = [visible[0], visible[1] - 200];
      const out = await Pipeline.simulate(io(h));
      const engineA = out.host.bodies.find((b) => b.id === String(A.id));
      assert.strictEqual(engineA.type, 'static');
      assert.deepStrictEqual(plain(A.transform.position.value), visible, 'posición congelada');
      near(A.transform.rotation.value, rot, 1e-6, 'rotación congelada');
      near(engineA.pose.x, visible[0], 0.01, 'el motor usa la pose que se ve'); near(engineA.pose.y, visible[1], 0.01); near(engineA.pose.a, rot, 0.01);
      const after = controls(A); assert.strictEqual(after.length, 8); assert.deepStrictEqual(after.filter((e) => e[0] !== 'Gravedad · Tipo'), before.filter((e) => e[0] !== 'Gravedad · Tipo'));
      const bEnd = B.transform.position.keys.slice(-1)[0].v;
      assert.ok(bEnd[1] < visible[1] - 30 - 20 + 2 && bEnd[1] > visible[1] - 120, 'B se apoya sobre A congelada: ' + bEnd + ' (A en ' + visible + ')');
    });
  }
}
test('Fijo con animación propia (P): recupera sus claves con interpolación y las sigue; B choca con ella', async () => {
  const { h, c, P, original } = await scene();
  c.time = 2; sel(c, [P]); ok(h.call('assign', { mode: 'fixed' }));
  assert.deepStrictEqual(keys(P.transform.position), original);
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.host.bodies.find((b) => b.id === String(P.id)).type, 'kinematic');
});
test('Desactivado por panel y por Controles de efectos: vuelve a como estaba y deja de participar', async () => {
  for (const via of ['panel', 'efectos']) {
    const { h, c, A, P, original } = await scene();
    c.time = 2;
    if (via === 'panel') { sel(c, [A, P]); ok(h.call('bodies', { values: { type: 'off' } })); } else { fx(A)._value = 3; fx(P)._value = 3; }
    const out = await Pipeline.simulate(io(h));
    assert.ok(!out.host.bodies.some((b) => b.id === String(A.id) || b.id === String(P.id)), via + ': no participan');
    assert.deepStrictEqual(plain(A.transform.position.value), [400, 300]); assert.strictEqual(A.transform.position.numKeys, 0);
    assert.deepStrictEqual(keys(P.transform.position), original);
  }
});
test('Fijo → Dinámico: arranca desde la pose congelada y la pose que se ve es la que usa el motor', async () => {
  const { h, c, A } = await scene();
  c.time = 1.2; const visible = plain(A.transform.position.valueAtTime(1.2)), rot = A.transform.rotation.valueAtTime(1.2);
  sel(c, [A]); ok(h.call('assign', { mode: 'fixed' })); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h)), b = out.host.bodies.find((x) => x.id === String(A.id));
  assert.strictEqual(b.type, 'dynamic');
  near(b.pose.x, visible[0], 0.01); near(b.pose.y, visible[1], 0.01); near(b.pose.a, rot, 0.01);
  assert.deepStrictEqual(plain(A.transform.position.keys[0].v), visible, 'la primera clave escrita es la pose congelada');
});

// ---------- Secuencia completa de un editor ----------
test('secuencia: simular → cambiar inicio → re-simular → editar clave → cancelar → borrar → deshacer → reabrir → borrar', async () => {
  const { h, c, P, original } = await scene();
  c.workAreaStart = 0.4; c.workAreaDuration = 3;
  await Pipeline.simulate(io(h));
  // El usuario edita a mano una clave de P (cambia valor e interpolación) y añade otra suya fuera de la rejilla.
  const k = 5, tk = P.transform.position.keys[k].t; P.transform.position.keys[k].v = [700, 250]; P.transform.position.setInterpolationTypeAtKey(k + 1, KIT.HOLD, KIT.HOLD);
  P.transform.position.setValueAtTime(2.345, [10, 10]);
  const edited = keys(P.transform.position);
  // Cancelar a mitad no cambia nada.
  let n = 0; await assert.rejects(Pipeline.simulate(io(h, { maxFramesPerSlice: 5, cancelled: () => ++n > 2 })), /cancelada/);
  assert.deepStrictEqual(keys(P.transform.position), edited);
  // Borrar: quita lo generado, conserva lo editado y lo añadido, devuelve lo original.
  ok(h.call('clear'));
  let pk = keys(P.transform.position);
  assert.ok(pk.some((x) => Math.abs(x.t - tk) < 1e-6 && x.v[0] === 700 && x.a.outI === KIT.HOLD), 'clave editada con su interpolación');
  assert.ok(pk.some((x) => Math.abs(x.t - 2.345) < 1e-6), 'clave añadida');
  original.forEach((o) => assert.ok(pk.some((x) => Math.abs(x.t - o.t) < 1e-6 && JSON.stringify(x.v) === JSON.stringify(o.v) && JSON.stringify(x.a) === JSON.stringify(o.a)), 'original en ' + o.t));
  // Deshacer el Borrar vuelve a la simulación aplicada, con su registro.
  assert.strictEqual(MockAE.undo(h.project), 'Gravedad · Borrar simulación');
  const P2 = byId(c, P.id); assert.deepStrictEqual(keys(P2.transform.position), edited);
  // Guardar y reabrir (contexto nuevo sobre el mismo proyecto) y Borrar de nuevo: mismo resultado.
  const h2 = createHost(HOST, h); ok(h2.call('clear'));
  assert.deepStrictEqual(keys(byId(c, P.id).transform.position), pk);
});
test('deshacer Simular, Fijo y Borrar devuelve exactamente el estado anterior', async () => {
  const { h, c, A, B } = await scene();
  const snapKeys = () => plain(c._layers.map((l) => [l.id, l.transform.position.keys.map((k) => [k.t, k.v]), l.transform.position.value, String(l.comment)]));
  c.time = 1; const s0 = snapKeys(); // deshacer no mueve el cursor
  sel(c, [byId(c, A.id)]); ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(MockAE.undo(h.project), 'Gravedad · Asignar'); assert.deepStrictEqual(snapKeys(), s0, 'deshacer Fijo');
  await Pipeline.simulate(io(h)); const s1 = snapKeys();
  ok(h.call('clear')); assert.strictEqual(MockAE.undo(h.project), 'Gravedad · Borrar simulación'); assert.deepStrictEqual(snapKeys(), s1, 'deshacer Borrar');
  assert.strictEqual(MockAE.undo(h.project), 'Gravedad · Simular'); assert.deepStrictEqual(snapKeys(), s0, 'deshacer Simular');
  // Tras deshacer, el registro (marcadores del nulo de mundo) vuelve con las claves: Borrar sigue distinguiéndolas.
  ok(h.call('clear')); assert.strictEqual(byId(c, B.id).transform.position.numKeys, 0);
});

// ---------- Fallo a mitad de la escritura ----------
test('fallo a mitad: queda registrado lo escrito; limpiar y reintentar no duplica claves, capas ni controladores', async () => {
  const { h, c, A } = await scene();
  const tpl = shape(c, 'plantilla', 'circle', [10, 10], [600, 100]); sel(c, [tpl]); ok(h.call('particles'));
  const em = c._layers.find((l) => l.comment === 'gravedad:emisor'); em.property('ADBE Effect Parade').property('Gravedad · Máximo').property(1)._value = 4; em.property('ADBE Effect Parade').property('Gravedad · Ritmo').property(1)._value = 40;
  const count = () => ({ layers: c.numLayers, keysA: byId(c, A.id).transform.position.numKeys, ctrlA: byId(c, A.id).property('ADBE Effect Parade').numProperties, particles: c._layers.filter((l) => String(l.comment).startsWith('gravedad:particula:')).length, stores: byId(c, c._layers.find((l) => String(l.comment).startsWith('gravedad:mundo')).id).property('ADBE Marker').numKeys });
  await Pipeline.simulate(io(h)); const clean = count();
  const orig = tpl.duplicate; let calls = 0; tpl.duplicate = function () { if (++calls === 3) throw Error('fallo simulado al duplicar'); return orig.apply(this, arguments); };
  await assert.rejects(Pipeline.simulate(io(h)), /fallo simulado/);
  const failed = count();
  assert.strictEqual(failed.ctrlA, clean.ctrlA, 'controladores sin duplicar');
  assert.strictEqual(failed.keysA, clean.keysA, 'claves de A sin duplicar');
  tpl.duplicate = orig;
  await Pipeline.simulate(io(h)); assert.deepStrictEqual(count(), clean, 'reintento = estado limpio');
  ok(h.call('clear'));
  assert.strictEqual(byId(c, A.id).transform.position.numKeys, 0);
  assert.strictEqual(c._layers.filter((l) => String(l.comment).startsWith('gravedad:particula:')).length, 0);
});
