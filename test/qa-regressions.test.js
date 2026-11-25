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

// ---------- F4: los interruptores del mundo recuerdan la configuración ----------
test('F4 · Luna → Espacio → Tierra recupera la gravedad de la Luna', () => {
  const { h } = setup();
  ok(h.call('world', { gravity: 160 }));
  assert.strictEqual(ok(h.call('world', { environment: 'space' })).world.gravity, 0);
  assert.strictEqual(ok(h.call('world', { environment: 'earth' })).world.gravity, 160);
});
test('F4 · Espacio dos veces seguidas no pierde la gravedad guardada', () => {
  const { h } = setup();
  ok(h.call('world', { gravity: 370 }));
  ok(h.call('world', { environment: 'space' })); ok(h.call('world', { environment: 'space' }));
  assert.strictEqual(ok(h.call('world', { environment: 'earth' })).world.gravity, 370);
});
test('F4 · quitar y poner paredes conserva el techo y los bordes elegidos', () => {
  const { h } = setup();
  ok(h.call('world', { floor: true, sides: false, ceiling: true }));
  const off = ok(h.call('world', { walls: false })).world;
  assert.ok(!off.floor && !off.sides && !off.ceiling);
  const on = ok(h.call('world', { walls: true })).world;
  assert.deepStrictEqual([on.floor, on.sides, on.ceiling], [true, false, true]);
});
test('F4 · la memoria de los interruptores sobrevive a Simular y Borrar', async () => {
  const { h, c } = setup();
  ok(h.call('world', { gravity: 160 })); ok(h.call('world', { environment: 'space' }));
  const b = shape(c, 'b', [40, 40], [300, 100]); sel(c, [b]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h)); ok(h.call('clear'));
  assert.strictEqual(ok(h.call('world', { environment: 'earth' })).world.gravity, 160);
});
test('F4 · Tierra con una gravedad ya distinta de 0 no la cambia', () => {
  const { h } = setup();
  ok(h.call('world', { gravity: 2480 }));
  assert.strictEqual(ok(h.call('world', { environment: 'earth' })).world.gravity, 2480);
});

// ---------- F5: fuerzas acotadas a una capa ----------
function fan(h, c) {
  ok(h.call('world', { gravity: 0, floor: false, sides: false }));
  ok(h.call('force', { type: 'wind' }));
  const f = c._layers.find((l) => l.comment === 'gravedad:fuerza'); f.transform.rotation.setValue(0);
  return f;
}
const ffx = (l, n) => l.property('ADBE Effect Parade').property('Gravedad · ' + n).property(1);
test('F5 · por defecto el ventilador afecta a todas las capas (comportamiento anterior conservado)', async () => {
  const { h, c } = setup(); fan(h, c);
  const a = shape(c, 'a', [40, 40], [300, 300]), b = shape(c, 'b', [40, 40], [300, 500]);
  sel(c, [a, b]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.ok(a.transform.position.numKeys > 1 && b.transform.position.numKeys > 1);
});
test('F5 · «Solo a la capa» empuja solo a esa capa', async () => {
  const { h, c } = setup(); const f = fan(h, c);
  const a = shape(c, 'a', [40, 40], [300, 300]), b = shape(c, 'b', [40, 40], [300, 500]);
  sel(c, [a, b]); ok(h.call('assign', { mode: 'dynamic' }));
  ffx(f, 'A todas las capas')._value = 0; ffx(f, 'Solo a la capa').setValue(a.index);
  await Pipeline.simulate(io(h));
  assert.ok(a.transform.position.keys.slice(-1)[0].v[0] > 600, 'a empujada');
  assert.deepStrictEqual(plain(b.transform.position.keys.slice(-1)[0].v), [300, 500], 'b quieta');
});
test('F5 · capa elegida borrada: la fuerza no se aplica a nadie y se avisa (no pasa a «todas»)', async () => {
  const { h, c } = setup(); const f = fan(h, c);
  const a = shape(c, 'a', [40, 40], [300, 300]), b = shape(c, 'b', [40, 40], [300, 500]);
  sel(c, [b]); ok(h.call('assign', { mode: 'dynamic' }));
  ffx(f, 'A todas las capas')._value = 0; ffx(f, 'Solo a la capa').setValue(a.index);
  a.remove();
  const out = await Pipeline.simulate(io(h));
  assert.ok(out.warnings.some((w) => /esta fuerza no se aplica/.test(w)));
  assert.deepStrictEqual(plain(b.transform.position.keys.slice(-1)[0].v), [300, 500]);
});
test('F5 · fuerza acotada a un emisor: solo sus partículas, no las de otro emisor ni los cuerpos', () => {
  const r = Sim.run({ fps: 25, frames: 40, width: 1920, height: 1080, world: { gravity: 0 },
    forces: [{ type: 'wind', only: 'e1', track: [[0, 0, 0, 800, 0]] }],
    emitters: [{ id: 'e1', max: 5, seed: 1, shape: { kind: 'circle', r: 5 }, track: [[500, 300, 90, 50, 0, 0, 0]] }, { id: 'e2', max: 5, seed: 2, shape: { kind: 'circle', r: 5 }, track: [[500, 700, 90, 50, 0, 0, 0]] }],
    bodies: [{ id: 'b', type: 'dynamic', pose: { x: 500, y: 900 }, shape: { kind: 'box', w: 20, h: 20 } }] });
  r.particles.forEach((p) => { const moved = p.data[p.data.length - 3] - p.data[0]; if (p.emitter === 'e1') assert.ok(moved > 10); else assert.ok(Math.abs(moved) < 1e-6); });
  assert.strictEqual(r.bodies.b.data.slice(-3)[0], 500);
});

// ---------- F3: dinámicos rápidos no atraviesan a otros dinámicos finos ----------
for (const [v, r] of [[3000, 3], [8000, 8], [15000, 3]]) {
  test('F3 · bola de radio ' + r + ' a ' + v + ' px/s contra una tabla dinámica de 3 px: no la atraviesa', () => {
    const res = Sim.run({ fps: 25, frames: 30, width: 1920, height: 1080, world: { gravity: 0 }, bodies: [
      { id: 't', type: 'dynamic', pose: { x: 1000, y: 540 }, shape: { kind: 'box', w: 3, h: 500 }, material: { density: 5 } },
      { id: 'b', type: 'dynamic', pose: { x: 200, y: 540 }, shape: { kind: 'circle', r }, velocity: { x: v, y: 0 } }] });
    for (let k = 0; k < 30; k++) assert.ok(res.bodies.b.data[k * 3] <= res.bodies.t.data[k * 3] + 2 + r, 'atraviesa en el fotograma ' + k);
  });
}
test('F3 · partículas a 6000 px/s no escapan de un anillo dinámico de 4 px', () => {
  const ring = []; for (let i = 0; i < 40; i++) { const a = i / 40 * 2 * Math.PI; ring.push([Math.cos(a) * 200, Math.sin(a) * 200]); }
  const res = Sim.run({ fps: 25, frames: 50, width: 1920, height: 1080, world: { gravity: 0 }, bodies: [{ id: 'ring', type: 'dynamic', pose: { x: 960, y: 540 }, shape: { kind: 'stroke', thickness: 4, paths: [{ points: ring, closed: true }] }, material: { density: 20 } }],
    emitters: [{ id: 'e', max: 60, seed: 3, shape: { kind: 'circle', r: 4 }, track: [[960, 540, 0, 600, 6000, 360, 0]], spin: 0 }] });
  res.particles.forEach((p) => { for (let k = 0; k < p.data.length / 3; k++) { const rx = res.bodies.ring.data[(p.from + k) * 3], ry = res.bodies.ring.data[(p.from + k) * 3 + 1]; assert.ok(Math.hypot(p.data[k * 3] - rx, p.data[k * 3 + 1] - ry) < 200, 'escapa'); } });
});

// ---------- Integridad: fallo a mitad de la escritura y cambio de composición ----------
test('fallo a mitad de la escritura: lo ya escrito queda registrado y Borrar lo deshace', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]);
  a.transform.position.setValueAtTime(0, [300, 100]); a.transform.position.setValueAtTime(2, [350, 100]);
  sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  const tpl = shape(c, 'plantilla', [10, 10], [600, 100]); sel(c, [tpl]); ok(h.call('particles'));
  tpl.duplicate = () => { throw Error('fallo simulado al duplicar'); };
  await assert.rejects(Pipeline.simulate(io(h)), /fallo simulado/);
  assert.ok(a.transform.position.numKeys > 5, 'a se escribió antes del fallo');
  ok(h.call('clear'));
  assert.deepStrictEqual(a.transform.position.keys.map((k) => k.t), [0, 2], 'sus claves originales vuelven');
});
test('reintento tras el fallo: simular de nuevo funciona y no duplica registros', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  const tpl = shape(c, 'plantilla', [10, 10], [600, 100]); sel(c, [tpl]); ok(h.call('particles'));
  const original = tpl.duplicate; tpl.duplicate = () => { throw Error('fallo simulado'); };
  await assert.rejects(Pipeline.simulate(io(h)));
  tpl.duplicate = original;
  const out = await Pipeline.simulate(io(h));
  assert.ok(out.summary.created > 0);
  ok(h.call('clear'));
  assert.strictEqual(a.transform.position.numKeys, 0); assert.deepStrictEqual(plain(a.transform.position.value), [300, 100]);
});
test('cambiar de composición mientras se calcula: las claves van a la composición simulada', async () => {
  const { h, c } = setup();
  const a = shape(c, 'a', [40, 40], [300, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  const other = h.project.items.addComp('Otra', 640, 360, 1, 2, 25);
  const base = io(h);
  await Pipeline.simulate(Object.assign({}, base, { progress(f, m, info) { if (info && info.phase === 'simular') h.project.activeItem = other; } }));
  assert.ok(a.transform.position.numKeys > 5);
  assert.strictEqual(other.numLayers, 0, 'la otra composición no se toca');
});

// ---------- Casos de editor: fuentes ausentes y nombres especiales ----------
test('metraje con el archivo ausente: colisiona con su caja y se avisa (no se renderiza)', async () => {
  const { FootageItem, FileSource } = require('./mock-ae.js');
  const { h, c } = setup();
  const src = new FootageItem('perdido.png', 120, 80, new FileSource(true), () => true); src.footageMissing = true; h.project._items.push(src);
  const l = c.layers.add(src); sel(c, [l]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(MockAE.stats.pngs, 0);
  assert.ok(out.warnings.some((w) => /falta su archivo/.test(w)));
  assert.ok(Math.abs(l.transform.position.keys.slice(-1)[0].v[1] - 680) < 1);
});
test('nombres con tildes, comillas, barras y emojis en capas y composición', async () => {
  const { h, c } = setup();
  c.name = 'Composición «final» / v2 ñ "😀"';
  const a = shape(c, 'Pelota \\ "roja" · ñandú 🍎', [40, 40], [300, 100], true);
  sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.host.bodies[0].name, 'Pelota \\ "roja" · ñandú 🍎');
  assert.strictEqual(ok(h.call('inspect', {})).comp.name, c.name);
  ok(h.call('clear')); assert.strictEqual(a.transform.position.numKeys, 0);
});
test('capa con remapeo de tiempo: se simula y Borrar la deja como estaba', async () => {
  const { h, c } = setup();
  const a = shape(c, 'remapeada', [40, 40], [300, 100]); a.timeRemapEnabled = true; a.startTime = -0.5;
  sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  assert.ok(a.transform.position.numKeys > 5);
  ok(h.call('clear')); assert.deepStrictEqual(plain(a.transform.position.value), [300, 100]);
});
