'use strict';
// F6 / F7: capas duplicadas a mano. Cada copia debe ser una identidad independiente desde la lectura de la composición
// hasta el motor, la escritura de claves, el registro y Borrar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { createHost } = require('./mock-ae.js');
const Pipeline = require('../src/engine/pipeline.js');
const Raster = require('../src/engine/raster.js');
const Sim = require('../src/engine/sim.js');

const HOST = path.join(__dirname, '..', 'src', 'host');
function setup() { const h = createHost(HOST); const c = h.project.items.addComp('F6', 1280, 720, 1, 4, 25); h.project.activeItem = c; return { h, c }; }
function shape(c, name, kind, size, pos) {
  const l = c.layers.addShape(); l.name = name;
  const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
  v.addProperty(kind === 'circle' ? 'ADBE Vector Shape - Ellipse' : 'ADBE Vector Shape - Rect').property(kind === 'circle' ? 'ADBE Vector Ellipse Size' : 'ADBE Vector Rect Size').setValue(size);
  v.addProperty('ADBE Vector Graphic - Fill');
  l.transform.position.setValue(pos);
  return l;
}
function io(h) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-f6-')); return { tempDir: d, async call(m, a) { const r = h.call(m, a); if (!r.ok) throw Error(r.error); return r.data; }, async readAlpha(j) { return Raster.traceFile(j.file); }, async writeText(n, t) { const f = path.join(d, n); fs.writeFileSync(f, t); return f; }, progress() {} }; }
const ok = (r) => { assert.ok(r.ok, r.error); return r.data; };
const sel = (c, ls) => { for (let i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; ls.forEach((l) => { l.selected = true; }); };
const plain = (v) => JSON.parse(JSON.stringify(v));
const ys = (l) => l.transform.position.keys.map((k) => k.v[1]);
const controls = (l) => plain(l.property('ADBE Effect Parade')._children.map((e) => [e.name, e.property(1).value]));

// Caso mínimo: original en x=400, copia en x=800 con un obstáculo fijo debajo.
async function minimal(opts) {
  opts = opts || {};
  const { h, c } = setup();
  const obstacle = shape(c, 'obstáculo', 'rect', [200, 30], [800, 400]); sel(c, [obstacle]); ok(h.call('assign', { mode: 'fixed' }));
  const a = shape(c, 'bola', 'circle', [80, 80], [400, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  sel(c, [a]); ok(h.call('bodies', { values: { bounce: 0.3, density: 2 } }));
  const b = a.duplicate(); b.transform.position.setValue([800, 100]);
  const out = opts.skipSim ? null : await Pipeline.simulate(io(h));
  return { h, c, a, b, obstacle, out };
}

test('F6 · caso mínimo: el motor recibe dos cuerpos, genera dos trayectorias y solo cambia la del que choca', async () => {
  const { a, b, out } = await minimal();
  assert.notStrictEqual(a.id, b.id, 'identificadores distintos');
  const dyn = out.scene.bodies.filter((x) => x.type === 'dynamic');
  assert.deepStrictEqual(dyn.map((x) => x.id).sort(), [String(a.id), String(b.id)].sort());
  assert.ok(out.result.bodies[String(a.id)] && out.result.bodies[String(b.id)], 'dos trayectorias');
  assert.strictEqual(out.summary.written, 2);
  // Original: cae hasta el suelo. Copia: se queda sobre el obstáculo.
  assert.ok(Math.abs(a.transform.position.keys.slice(-1)[0].v[1] - 680) < 1);
  assert.ok(Math.abs(b.transform.position.keys.slice(-1)[0].v[1] - 345) < 1);
  // Antes del choque las dos trayectorias son idénticas (misma forma y material); después solo cambia la de la copia.
  const ya = ys(a), yb = ys(b), hit = yb.findIndex((y, i) => Math.abs(y - ya[i]) > 0.01);
  assert.ok(hit > 5, 'divergen en el fotograma ' + hit + ', cuando la copia toca el obstáculo');
  assert.ok(Math.abs(yb[hit] - 345) < 30, 'la divergencia ocurre en el obstáculo: y=' + yb[hit]);
});
test('F6 · el original simulado solo coincide con el original simulado sin la copia (la copia no le afecta)', async () => {
  const { a, out } = await minimal();
  const alone = out.scene.bodies.filter((x) => x.id === String(a.id) || x.type !== 'dynamic');
  const solo = Sim.run(Object.assign({}, out.scene, { bodies: alone }));
  assert.deepStrictEqual(solo.bodies[String(a.id)].data, out.result.bodies[String(a.id)].data);
});
test('F6 · pasar la copia a Fijo no toca las claves ni la configuración del original', async () => {
  const { h, c, a, b } = await minimal();
  const keysA = plain(a.transform.position.keys), ctrlA = controls(a);
  c.time = 1; sel(c, [b]); ok(h.call('assign', { mode: 'fixed' }));
  assert.deepStrictEqual(plain(a.transform.position.keys), keysA);
  assert.deepStrictEqual(controls(a), ctrlA);
  assert.strictEqual(b.transform.position.numKeys, 0);
});
test('F6 · eliminar solo la copia: el original conserva claves y configuración; re-simular y Borrar funcionan', async () => {
  const { h, a, b } = await minimal();
  const keysA = plain(a.transform.position.keys), ctrlA = controls(a);
  b.remove();
  assert.deepStrictEqual(plain(a.transform.position.keys), keysA);
  assert.deepStrictEqual(controls(a), ctrlA);
  await Pipeline.simulate(io(h));
  const r = ok(h.call('clear'));
  assert.strictEqual(r.cleared, 1); assert.deepStrictEqual(r.legacy, []);
  assert.deepStrictEqual(plain(a.transform.position.value), [400, 100]);
});
test('F6 · Borrar limpia original y copia por separado, cada una a su pose de partida', async () => {
  const { h, a, b } = await minimal();
  const r = ok(h.call('clear'));
  assert.strictEqual(r.cleared, 2); assert.deepStrictEqual(r.legacy, []);
  assert.deepStrictEqual(plain(a.transform.position.value), [400, 100]);
  assert.deepStrictEqual(plain(b.transform.position.value), [800, 100]);
});
test('F6 · tres copias con el mismo nombre y orden cambiado: tres identidades, tres trayectorias', async () => {
  const { h, c } = setup();
  const a = shape(c, 'bola', 'circle', [60, 60], [200, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  const copies = [1, 2, 3].map((i) => { const d = a.duplicate(); d.transform.position.setValue([200 + i * 250, 100 + i * 40]); return d; });
  copies[1].moveToEnd(); a.moveBefore(copies[2]);
  const out = await Pipeline.simulate(io(h));
  assert.strictEqual(out.summary.written, 4);
  const ids = new Set(out.host.bodies.map((x) => x.id)); assert.strictEqual(ids.size, 4);
  [a].concat(copies).forEach((l, i) => assert.ok(l.transform.position.keys[0].v[0] === (i ? 200 + i * 250 : 200), 'cada una empieza en su sitio'));
  copies[0].moveToEnd();
  const r = ok(h.call('clear'));
  assert.strictEqual(r.cleared, 4);
  [a].concat(copies).forEach((l, i) => assert.deepStrictEqual(plain(l.transform.position.value), i ? [200 + i * 250, 100 + i * 40] : [200, 100]));
});
test('F6 · duplicar después de simular y mover la copia: identidad nueva, sin registro heredado', async () => {
  const { h, c } = setup();
  const a = shape(c, 'bola', 'circle', [80, 80], [400, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  const b = a.duplicate(); b.transform.position.keys[0].v = [900, 100];
  const out = await Pipeline.simulate(io(h));
  assert.deepStrictEqual(out.host.bodies.find((x) => x.id === String(b.id)).pose, { x: 900, y: 100, a: 0 });
  assert.deepStrictEqual(out.warnings, []);
});
test('F6 · cerrar y reabrir (contexto nuevo): la separación se mantiene al borrar', async () => {
  const { h, a, b } = await minimal();
  const h2 = createHost(HOST, h);
  const r = ok(h2.call('clear'));
  assert.strictEqual(r.cleared, 2);
  assert.deepStrictEqual(plain(a.transform.position.value), [400, 100]); assert.deepStrictEqual(plain(b.transform.position.value), [800, 100]);
});
test('F6 · copia sin mover (misma pose y forma): aviso con número de capa; siguen siendo dos cuerpos', async () => {
  const { h, c } = setup();
  const a = shape(c, 'bola', 'circle', [80, 80], [640, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  const b = a.duplicate();
  const out = await Pipeline.simulate(io(h));
  const w = out.warnings.filter((x) => /empiezan en el mismo sitio/.test(x));
  assert.strictEqual(w.length, 1, out.warnings.join(' | '));
  assert.match(w[0], /«bola» \(capa \d+\) y «bola» \(capa \d+\)/);
  assert.strictEqual(out.summary.written, 2);
});
test('F6 · misma pose pero distinta forma o tamaño: sin aviso (sí se separan)', async () => {
  const { h, c } = setup();
  const a = shape(c, 'bola', 'circle', [80, 80], [640, 100]), b = shape(c, 'bola', 'circle', [60, 60], [640, 100]);
  sel(c, [a, b]); ok(h.call('assign', { mode: 'dynamic' }));
  const out = await Pipeline.simulate(io(h));
  assert.ok(!out.warnings.some((x) => /mismo sitio/.test(x)));
});
test('F7 · copia simulada (con registro) restaurada por Borrar: no aparece como «no tocada»', async () => {
  const { h, c } = setup();
  const a = shape(c, 'bola', 'circle', [80, 80], [400, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  const b = a.duplicate(); b.transform.position.keys[0].v = [900, 100];
  await Pipeline.simulate(io(h));
  const r = ok(h.call('clear'));
  assert.strictEqual(r.cleared, 2);
  assert.deepStrictEqual(r.legacy, [], 'ninguna capa a la vez restaurada y «no tocada»');
});
test('F7 · capa con claves sin registro: el aviso la nombra con su número de capa', async () => {
  const { h, c } = setup();
  const a = shape(c, 'bola', 'circle', [80, 80], [400, 100]); sel(c, [a]); ok(h.call('assign', { mode: 'dynamic' }));
  await Pipeline.simulate(io(h));
  const b = a.duplicate();
  const r = ok(h.call('clear'));
  assert.deepStrictEqual(r.legacy, ['bola (capa ' + b.index + ')']);
});
