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
