'use strict';
// Regresiones de QA: cada prueba reproduce un fallo encontrado en la auditoría (ver QA_PROGRESS.md).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createHost, MockAE } = require('./mock-ae.js');
const Pipeline = require('../src/engine/pipeline.js');
const Raster = require('../src/engine/raster.js');
const Sim = require('../src/engine/sim.js');

const HOST = path.join(__dirname, '..', 'src', 'host');
function setup(o) { o = o || {}; const h = createHost(HOST); const c = h.project.items.addComp('QA', 1280, 720, 1, o.duration || 4, 25); h.project.activeItem = c; return { h, c }; }
function shape(c, name, size, pos, ellipse) {
  const l = c.layers.addShape(); l.name = name;
  const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
  v.addProperty(ellipse ? 'ADBE Vector Shape - Ellipse' : 'ADBE Vector Shape - Rect').property(ellipse ? 'ADBE Vector Ellipse Size' : 'ADBE Vector Rect Size').setValue(size);
  v.addProperty('ADBE Vector Graphic - Fill');
  l.transform.position.setValue(pos);
  return l;
}
function io(h) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-qa-')); return { tempDir: d, async call(m, a) { const r = h.call(m, a); if (!r.ok) throw Error(r.error); return r.data; }, async readAlpha(j) { return Raster.traceFile(j.file); }, async writeText(n, t) { const f = path.join(d, n); fs.writeFileSync(f, t); return f; }, progress() {} }; }
const ok = (r) => { assert.ok(r.ok, r.error); return r.data; };
const sel = (c, ls) => { for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; ls.forEach((l) => { l.selected = true; }); };
const plain = (v) => JSON.parse(JSON.stringify(v));
const fx = (l) => l.property('ADBE Effect Parade').property('Gravedad · Tipo');

// ---------- F1: cambiar de Dinámico a Fijo/Desactivado tras simular ----------
async function simulatedBall() {
  const { h, c } = setup();
  const ball = shape(c, 'bola', [60, 60], [300, 100], true), other = shape(c, 'caja', [60, 60], [700, 100]);
  sel(c, [ball, other]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.ok(ball.transform.position.numKeys > 5);
  return { h, c, ball, other };
}
test('F1 · Fijo desde el panel tras simular: vuelve a su pose de partida, sin claves', async () => {
  const { h, c, ball } = await simulatedBall();
  sel(c, [ball]); ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(ball.transform.position.numKeys, 0);
  assert.deepStrictEqual(plain(ball.transform.position.value), [300, 100]);
  const g = ok(h.call('gather', { tempDir: os.tmpdir() }));
  assert.strictEqual(g.bodies.find((b) => b.id === String(ball.id)).type, 'static', 'no es un fijo animado');
});
test('F1 · Desactivado desde el inspector tras simular: sin claves y «Borrar» no la toca más', async () => {
  const { h, c, ball } = await simulatedBall();
  sel(c, [ball]); ok(h.call('bodies', { values: { type: 'off' } }));
  assert.strictEqual(ball.transform.position.numKeys, 0);
  assert.strictEqual(ok(h.call('clear')).cleared, 1, 'solo la otra capa');
});
test('F1 · Fijo cambiado a mano en Controles de efectos: re-simular no usa la trayectoria vieja y limpia sus claves', async () => {
  const { h, c, ball, other } = await simulatedBall();
  ball.property('ADBE Effect Parade').property('Gravedad · Tipo').property(1)._value = 2;
  // La otra caja cae justo encima de donde estaba la bola: debe apoyarse en la bola fija en su pose de partida.
  const out = await Pipeline.simulate(io(h));
  const b = out.host.bodies.find((x) => x.id === String(ball.id));
  assert.strictEqual(b.type, 'static');
  assert.deepStrictEqual(b.pose, { x: 300, y: 100, a: 0 });
  assert.strictEqual(ball.transform.position.numKeys, 0, 'claves de la simulación anterior eliminadas');
});
test('F1 · «Borrar simulación» limpia también capas simuladas que ya no son dinámicas', async () => {
  const { h, c, ball } = await simulatedBall();
  ball.property('ADBE Effect Parade').property('Gravedad · Tipo').property(1)._value = 3;
  assert.strictEqual(ok(h.call('clear')).cleared, 2);
  assert.strictEqual(ball.transform.position.numKeys, 0);
});
test('F1 · un Fijo animado por el usuario (nunca simulado) sigue siendo animado', async () => {
  const { h, c } = setup();
  const pad = shape(c, 'pala', [100, 20], [100, 600]); pad.transform.position.setValueAtTime(0, [100, 600]); pad.transform.position.setValueAtTime(3, [1000, 600]);
  const b = shape(c, 'b', [30, 30], [400, 100]);
  sel(c, [pad]); ok(h.call('assign', { mode: 'fixed' })); sel(c, [b]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.host.bodies.find((x) => x.id === String(pad.id)).type, 'kinematic');
  assert.strictEqual(pad.transform.position.numKeys, 2, 'su animación intacta');
});
test('F1 · pasar a Fijo y volver a Dinámico: simula de nuevo desde la pose de partida', async () => {
  const { h, c, ball } = await simulatedBall();
  sel(c, [ball]); ok(h.call('assign', { mode: 'fixed' })); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.deepStrictEqual(plain(ball.transform.position.keys[0].v), [300, 100]);
  assert.ok(ball.transform.position.numKeys > 5);
});

// ---------- F1 ampliado: claves propias, pose de Fijo, Desactivado, vías de cambio, reapertura y duplicados ----------
const { KeyframeInterpolationType: KIT } = { KeyframeInterpolationType: { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 } };
// Escena mínima: A (bola con claves propias y suavizado dentro del área de trabajo), B (caja dinámica), suelo fijo.
async function scene(opts) {
  opts = opts || {};
  const { h, c } = setup({ duration: 4 });
  const floor = shape(c, 'suelo', [1200, 40], [640, 700]);
  const A = shape(c, 'A', [80, 80], [400, 200], !opts.boxA), B = shape(c, 'B', [60, 60], [400, 40]);
  const P = A.transform.position;
  P.setValueAtTime(0, [400, 200]); P.setValueAtTime(1.5, [420, 200]);
  P.setInterpolationTypeAtKey(2, KIT.BEZIER, KIT.HOLD); P.setTemporalEaseAtKey(2, [{ speed: 3, influence: 70 }], [{ speed: 0, influence: 20 }]); P.setSpatialTangentsAtKey(2, [-30, 5], [10, 0]);
  sel(c, [floor]); ok(h.call('assign', { mode: 'fixed' }));
  sel(c, [A, B]); ok(h.call('assign', { mode: 'dynamic' }));
  for (let i = 1; i <= P.numKeys; i++) P._k(i); // atributos completos de las claves originales
  const original = JSON.parse(JSON.stringify(P.keys));
  if (!opts.skipSim) await Pipeline.simulate(io(h));
  return { h, c, A, B, floor, P, original };
}
const keyAttrs = (P) => JSON.parse(JSON.stringify(P.keys.map((k) => ({ t: k.t, v: k.v, a: k.a }))));
const at = (l, t) => plain(l.transform.position.valueAtTime(t));

test('F1 · Borrar restaura las claves propias de A con su valor e interpolación, y deja B en su pose de partida', async () => {
  const { h, A, B, P, original } = await scene();
  assert.ok(P.numKeys > 10, 'la simulación sustituyó las claves');
  ok(h.call('clear'));
  assert.deepStrictEqual(keyAttrs(P), original.map((k) => ({ t: k.t, v: k.v, a: k.a })));
  assert.strictEqual(P.keys[1].a.outI, KIT.HOLD); assert.deepStrictEqual(plain(P.keys[1].a.inT), [-30, 5]);
  assert.strictEqual(B.transform.position.numKeys, 0); assert.deepStrictEqual(plain(B.transform.position.value), [400, 40]);
});
test('F1 · claves que el usuario añade o edita después de simular sobreviven a Borrar', async () => {
  const { h, c, A, P } = await scene();
  P.setValueAtTime(3.37, [10, 10]);                 // fuera de la rejilla de fotogramas
  const k = 8, tk = P.keys[k].t; P.keys[k].v = [999, 999]; // edita una clave generada (fotograma 8)
  ok(h.call('clear'));
  assert.ok(P.keys.some((x) => Math.abs(x.t - 3.37) < 1e-6), 'la clave añadida sigue');
  assert.ok(P.keys.some((x) => Math.abs(x.t - tk) < 1e-6 && x.v[0] === 999), 'la clave editada sigue');
  assert.ok(P.keys.some((x) => x.t === 0) && P.keys.some((x) => Math.abs(x.t - 1.5) < 1e-6), 'las originales vuelven');
});
test('F1 · re-simular dos veces no convierte claves de Gravedad en «originales»', async () => {
  const { h, P, original } = await scene();
  await Pipeline.simulate(io(h)); await Pipeline.simulate(io(h));
  ok(h.call('clear'));
  assert.deepStrictEqual(P.keys.map((k) => k.t), original.map((k) => k.t));
});
test('F1 · Fijo con el cursor al inicio: se queda en la pose de partida; B choca con él ahí', async () => {
  const { h, c, A, B } = await scene({ boxA: true });
  c.time = 0;
  sel(c, [A]); ok(h.call('assign', { mode: 'fixed' }));
  assert.deepStrictEqual(at(A, 0), [400, 200]);
  await Pipeline.simulate(io(h));
  // A conserva su animación propia (claves originales): el Fijo la sigue
  assert.deepStrictEqual(plain(A.transform.position.keys.map((k) => k.t)), [0, 1.5]);
  const bEnd = B.transform.position.keys.slice(-1)[0].v;
  assert.ok(bEnd[1] < 200 - 40 - 30 + 2 && bEnd[1] > 100, 'B se apoya sobre A: ' + bEnd);
});
test('F1 · Fijo con el cursor a mitad: se congela donde se ve en ese instante (cuerpo sin animación propia)', async () => {
  const { h, c, B } = await scene();
  c.time = 0.8;
  const visible = at(B, 0.8);
  sel(c, [B]); ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(B.transform.position.numKeys, 0);
  assert.deepStrictEqual(plain(B.transform.position.value), visible, 'pose congelada en 0,8 s');
  const out = await Pipeline.simulate(io(h));
  const fixedB = out.host.bodies.find((b) => b.id === String(B.id));
  assert.strictEqual(fixedB.type, 'static'); assert.ok(Math.abs(fixedB.pose.y - visible[1]) < 0.01, 'colisiona en la pose congelada');
});
test('F1 · Desactivado: B vuelve a como estaba y deja de participar (A ya no choca con B)', async () => {
  const { h, c, A, B } = await scene({ skipSim: true });
  B.transform.position.setValue([400, 400]); // B debajo de A: A se apoya en B
  await Pipeline.simulate(io(h));
  const withB = A.transform.position.keys.slice(-1)[0].v[1];
  sel(c, [B]); ok(h.call('bodies', { values: { type: 'off' } }));
  assert.strictEqual(B.transform.position.numKeys, 0); assert.deepStrictEqual(plain(B.transform.position.value), [400, 400]);
  await Pipeline.simulate(io(h));
  const withoutB = A.transform.position.keys.slice(-1)[0].v[1];
  assert.ok(withoutB > withB + 30, 'A cae más abajo sin B: ' + withB + ' → ' + withoutB);
  assert.ok(!(await Pipeline.simulate(io(h))).host.bodies.some((b) => b.id === String(B.id)));
});
test('F1 · el mismo cambio desde Controles de efectos surte efecto al simular (Fijo a mitad) y avisa', async () => {
  const { h, c, B } = await scene();
  c.time = 0.8; const visible = at(B, 0.8);
  fx(B).property(1)._value = 2;
  // Hasta simular, After no ha cambiado nada (el cambio es solo del control) y el panel lo informa
  assert.ok(B.transform.position.numKeys > 5);
  assert.deepStrictEqual(ok(h.call('inspect', { deep: true })).pendingTypes, ['B']);
  const out = await Pipeline.simulate(io(h));
  assert.ok(out.warnings.some((w) => /Controles de efectos/.test(w)));
  assert.strictEqual(B.transform.position.numKeys, 0); assert.deepStrictEqual(plain(B.transform.position.value), visible);
  assert.deepStrictEqual(ok(h.call('inspect', { deep: true })).pendingTypes, []);
});
test('F1 · el cambio desde Controles de efectos también se aplica al Borrar (Desactivado → como estaba)', async () => {
  const { h, A, P, original } = await scene();
  fx(A).property(1)._value = 3;
  ok(h.call('clear'));
  assert.deepStrictEqual(P.keys.map((k) => k.t), original.map((k) => k.t));
});
test('F1 · cerrar y reabrir (contexto nuevo sobre el mismo proyecto): el registro persiste y Borrar restaura', async () => {
  const { h, A, P, original } = await scene();
  const h2 = createHost(HOST, h);
  const r = h2.call('clear'); assert.ok(r.ok, r.error);
  assert.deepStrictEqual(P.keys.map((k) => k.t), original.map((k) => k.t));
});
test('F1 · duplicar una capa simulada: limpiar una no afecta a la otra', async () => {
  const { h, c, B } = await scene();
  const copy = B.duplicate(); const copyKeys = copy.transform.position.numKeys;
  ok(h.call('clear'));
  assert.strictEqual(B.transform.position.numKeys, 0);
  assert.strictEqual(copy.transform.position.numKeys, copyKeys, 'la copia no se toca (sin registro propio)');
  sel(c, [copy]); ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(copy.transform.position.numKeys, copyKeys, 'cambiar el tipo de la copia tampoco borra a ciegas');
});
test('F1 · proyecto de la 1.1.1 (solo lista de ids): no se borran claves a ciegas y se avisa', async () => {
  const { h, c, B } = await scene();
  const w = c._layers.find((l) => String(l.comment).indexOf('gravedad:mundo') === 0);
  w.property('ADBE Marker').keys = []; w.comment = 'gravedad:mundo;ids=' + B.id;
  const n = B.transform.position.numKeys, r = ok(h.call('clear'));
  assert.strictEqual(B.transform.position.numKeys, n);
  assert.ok(r.legacy.includes('B'));
});
test('F1 · capa con padre: Desactivado recupera el padre y sus valores originales sin saltos', async () => {
  const { h, c } = setup();
  const parent = c.layers.addNull(); parent.transform.position.setValue([300, 100]); parent.transform.rotation.setValue(20);
  const k = shape(c, 'hija', [40, 40], [100, 0]); k._parent = parent;
  sel(c, [k]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.strictEqual(k.parent, null);
  sel(c, [k]); ok(h.call('bodies', { values: { type: 'off' } }));
  assert.strictEqual(k.parent, parent);
  assert.deepStrictEqual(plain(k.transform.position.value), [100, 0]);
  assert.strictEqual(k.transform.rotation.value, 0);
});
test('F1 · capa con padre: Fijo a mitad congela la pose visible y recupera el padre con compensación', async () => {
  const { h, c } = setup();
  const parent = c.layers.addNull(); parent.transform.position.setValue([300, 100]);
  const k = shape(c, 'hija', [40, 40], [100, 0]); k._parent = parent;
  sel(c, [k]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  c.time = 1; const visible = at(k, 1);
  sel(c, [k]); ok(h.call('assign', { mode: 'fixed' }));
  assert.strictEqual(k.parent, parent);
  const world = MockAE.apply(MockAE.world(k, 1), k.transform.anchorPoint.value);
  assert.ok(Math.hypot(world[0] - visible[0], world[1] - visible[1]) < 0.01, 'misma pose en la composición');
});

// ---------- F2: Partículas no duplica círculos ni emisores ----------
const samples = (c) => c._layers.filter((l) => l.name === 'Forma de partícula').length;
const emitters = (c) => c._layers.filter((l) => l.comment === 'gravedad:emisor');
test('F2 · dos clics sin selección: una sola forma de ejemplo reutilizada', () => {
  const { h, c } = setup();
  ok(h.call('particles'));
  sel(c, []); ok(h.call('particles'));
  assert.strictEqual(samples(c), 1);
  assert.strictEqual(emitters(c).length, 2, 'sin selección, cada clic crea un emisor (intencionado)');
});
test('F2 · doble clic (el emisor recién creado queda seleccionado): no se duplica nada y se explica', () => {
  const { h, c } = setup();
  ok(h.call('particles'));
  const r = h.call('particles');
  assert.strictEqual(r.ok, false); assert.match(r.error, /Ya hay un emisor seleccionado/);
  assert.strictEqual(samples(c), 1); assert.strictEqual(emitters(c).length, 1);
});
test('F2 · emisor + capas seleccionadas: se añaden como formas sin repetir las que ya tiene', () => {
  const { h, c } = setup();
  const a = shape(c, 'hoja', [20, 10], [100, 100]), b = shape(c, 'flor', [15, 15], [150, 100], true);
  sel(c, [a]); ok(h.call('particles'));
  const em = emitters(c)[0];
  sel(c, [em, a, b]); const r = ok(h.call('particles'));
  assert.strictEqual(r.addedTemplates, 1);
  assert.ok(em.property('ADBE Effect Parade').property('Gravedad · Capa de partícula 2'));
  assert.ok(!em.property('ADBE Effect Parade').property('Gravedad · Capa de partícula 3'));
  assert.strictEqual(emitters(c).length, 1); assert.strictEqual(b.enabled, false);
});
test('F2 · la forma de ejemplo reutilizada sigue sirviendo de plantilla al simular', async () => {
  const { h, c } = setup();
  ok(h.call('particles')); sel(c, []); ok(h.call('particles'));
  emitters(c).forEach((em) => { em.property('ADBE Effect Parade').property('Gravedad · Máximo').property(1)._value = 3; em.property('ADBE Effect Parade').property('Gravedad · Ritmo').property(1)._value = 30; });
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.summary.created, 6);
});
