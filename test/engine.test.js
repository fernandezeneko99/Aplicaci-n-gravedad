'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../src/engine/sim.js');

const base = (extra) => Object.assign({ fps: 25, frames: 100, width: 1920, height: 1080, world: { gravity: 980, floor: true, sides: true }, bodies: [] }, extra);
const box = (w, h) => ({ kind: 'box', w, h });
const last = (rec) => rec.data.slice(-3);

function polyArea(pieces) { return pieces.reduce((s, q) => s + Math.abs(Sim.area(q)), 0); }

test('una caja cae y reposa sobre el suelo', () => {
  const r = Sim.run(base({ frames: 150, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 960, y: 200, a: 0 }, shape: box(100, 100) }] }));
  const [x, y, a] = last(r.bodies.a);
  assert.ok(Math.abs(y - 1030) < 2, 'reposa con su centro a 50 px del suelo, y=' + y);
  assert.ok(Math.abs(x - 960) < 1);
  assert.ok(Math.abs(a) < 1);
  assert.strictEqual(r.bodies.a.data.length, 150 * 3);
  // primer fotograma = pose inicial exacta
  assert.deepStrictEqual(r.bodies.a.data.slice(0, 3), [960, 200, 0]);
});

test('la caída libre sigue la gravedad (½·g·t²)', () => {
  const r = Sim.run(base({ frames: 26, world: { gravity: 980 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 0, y: 0 }, shape: box(20, 20) }] }));
  const y1s = r.bodies.a.data[25 * 3 + 1];
  assert.ok(Math.abs(y1s - 490) < 15, 'tras 1 s cae ~490 px, cayó ' + y1s);
});

test('espacio: sin gravedad, la velocidad inicial se conserva', () => {
  const r = Sim.run(base({ frames: 26, world: { gravity: 0 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 100, y: 100 }, velocity: { x: 200, y: 0 }, shape: box(20, 20) }] }));
  const [x, y] = last(r.bodies.a);
  assert.ok(Math.abs(x - 300) < 2 && Math.abs(y - 100) < 0.5, x + ',' + y);
});

test('una pila de cajas se mantiene estable', () => {
  const bodies = [];
  for (let i = 0; i < 6; i++) bodies.push({ id: 'b' + i, type: 'dynamic', pose: { x: 960, y: 1080 - 50 - i * 101 }, shape: box(100, 100) });
  const r = Sim.run(base({ frames: 200, bodies }));
  for (let i = 0; i < 6; i++) {
    const [x, y] = last(r.bodies['b' + i]);
    assert.ok(Math.abs(x - 960) < 3, 'b' + i + ' x=' + x);
    assert.ok(Math.abs(y - (1080 - 50 - i * 100)) < 4, 'b' + i + ' y=' + y);
  }
});

test('un cuerpo fijo hace de plataforma', () => {
  const r = Sim.run(base({ world: { gravity: 980 }, bodies: [
    { id: 'p', type: 'static', pose: { x: 500, y: 600 }, shape: box(400, 20) },
    { id: 'a', type: 'dynamic', pose: { x: 500, y: 300 }, shape: { kind: 'circle', r: 30 } }] }));
  const [, y] = last(r.bodies.a);
  assert.ok(Math.abs(y - (590 - 30)) < 2, 'la bola reposa en la plataforma, y=' + y);
});

test('rotación: una caja girada cae y se asienta plana', () => {
  const r = Sim.run(base({ frames: 200, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 960, y: 500, a: 30 }, shape: box(200, 60) }] }));
  const [, y, a] = last(r.bodies.a);
  const m = ((a % 180) + 180) % 180;
  assert.ok(m < 1 || m > 179, 'queda horizontal, a=' + a);
  assert.ok(Math.abs(y - 1050) < 3, 'y=' + y);
});

test('descomposición convexa: forma en L conserva el área', () => {
  const L = [[0, 0], [200, 0], [200, 50], [50, 50], [50, 200], [0, 200]];
  const d = Sim.decompose([L]);
  assert.ok(d.pieces.length >= 2);
  assert.ok(Math.abs(polyArea(d.pieces) - 17500) < 1, 'área ' + polyArea(d.pieces));
  d.pieces.forEach((q) => assert.ok(q.length <= 8));
});

test('descomposición: estrella cóncava y sentido horario', () => {
  const star = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 40 : 100, a = i * Math.PI / 5; star.push([Math.cos(a) * r, -Math.sin(a) * r]); }
  const d = Sim.decompose([star]);
  const expected = Math.abs(Sim.area(star));
  assert.ok(Math.abs(polyArea(d.pieces) - expected) < 1);
});

test('descomposición: agujeros se rellenan, piezas separadas se mantienen', () => {
  const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  const d = Sim.decompose([square(0, 0, 100), square(25, 25, 50), square(300, 0, 40)]);
  assert.ok(Math.abs(polyArea(d.pieces) - (10000 + 1600)) < 1);
});

test('descomposición: un círculo de 200 vértices queda en piezas válidas', () => {
  const c = []; for (let i = 0; i < 200; i++) c.push([Math.cos(i / 200 * 2 * Math.PI) * 80, Math.sin(i / 200 * 2 * Math.PI) * 80]);
  const d = Sim.decompose([c]);
  d.pieces.forEach((q) => assert.ok(q.length <= 8 && q.length >= 3));
  assert.ok(Math.abs(polyArea(d.pieces) - Math.PI * 6400) < 300);
});

test('contorno que se cruza: se usa el casco convexo sin romperse', () => {
  const bow = [[0, 0], [100, 100], [100, 0], [0, 100]];
  const d = Sim.decompose([bow]);
  assert.ok(d.pieces.length >= 1);
});

test('forma degenerada no rompe la simulación y avisa', () => {
  const r = Sim.run(base({ bodies: [{ id: 'z', type: 'dynamic', pose: { x: 0, y: 0 }, shape: { kind: 'poly', contours: [[[0, 0], [0.1, 0], [0.2, 0]]] } }] }));
  assert.ok(r.warnings.some((w) => w.id === 'z' && w.code === 'sin-forma'));
  assert.ok(!r.bodies.z);
});

test('recipiente hueco (trazo) retiene una bola', () => {
  const cup = { kind: 'stroke', thickness: 10, paths: [{ points: [[-100, -100], [-100, 100], [100, 100], [100, -100]], closed: false }] };
  const r = Sim.run(base({ frames: 120, bodies: [
    { id: 'cup', type: 'static', pose: { x: 960, y: 800 }, shape: cup },
    { id: 'ball', type: 'dynamic', pose: { x: 960, y: 600 }, shape: { kind: 'circle', r: 30 } }] }));
  const [x, y] = last(r.bodies.ball);
  assert.ok(Math.abs(x - 960) < 70 && Math.abs(y - (900 - 5 - 30)) < 3, 'la bola queda dentro: ' + x + ',' + y);
});

test('cuerpo animado (cinemático) empuja a los dinámicos', () => {
  const track = []; for (let k = 0; k < 100; k++) track.push([200 + k * 10, 1000, 0]);
  const r = Sim.run(base({ bodies: [
    { id: 'pusher', type: 'kinematic', pose: { x: 200, y: 1000 }, track, shape: box(100, 100) },
    { id: 'box', type: 'dynamic', pose: { x: 500, y: 1030 }, shape: box(60, 60) }] }));
  const p = r.bodies.pusher.data, n = p.length / 3;
  assert.ok(Math.abs(p[(n - 1) * 3] - track[n - 1][0]) < 0.5, 'el animado sigue su pista exacta');
  assert.ok(last(r.bodies.box)[0] > 1100, 'la caja fue empujada');
});

test('ventilador empuja en la dirección del nulo; con alcance solo dentro del radio', () => {
  const r = Sim.run(base({ world: { gravity: 0 }, frames: 50, forces: [{ type: 'wind', track: [[0, 500, 0, 400, 0]] }], bodies: [{ id: 'a', type: 'dynamic', pose: { x: 500, y: 500 }, shape: box(20, 20) }] }));
  assert.ok(last(r.bodies.a)[0] > 800);
  const r2 = Sim.run(base({ world: { gravity: 0 }, frames: 50, forces: [{ type: 'wind', track: [[0, 0, 0, 400, 100]] }], bodies: [{ id: 'a', type: 'dynamic', pose: { x: 500, y: 500 }, shape: box(20, 20) }] }));
  assert.strictEqual(last(r2.bodies.a)[0], 500);
});

test('atractor atrae hacia su centro', () => {
  const r = Sim.run(base({ world: { gravity: 0 }, frames: 30, forces: [{ type: 'attract', track: [[1000, 500, 0, 600, 0]] }], bodies: [{ id: 'a', type: 'dynamic', pose: { x: 500, y: 500 }, shape: box(20, 20) }] }));
  assert.ok(last(r.bodies.a)[0] > 600);
});

test('aparición y desaparición según los puntos de entrada y salida', () => {
  const r = Sim.run(base({ frames: 60, bodies: [{ id: 'a', type: 'dynamic', spawn: 20, despawn: 40, pose: { x: 100, y: 100 }, shape: box(20, 20) }] }));
  assert.strictEqual(r.bodies.a.from, 20);
  assert.strictEqual(r.bodies.a.data.length, 20 * 3);
  assert.deepStrictEqual(r.bodies.a.data.slice(0, 3), [100, 100, 0]);
});

test('partículas: ritmo, máximo, vida y determinismo', () => {
  const em = { id: 'e1', max: 30, lifetime: 1, size: 1, sizeVariation: 0.3, seed: 42, shape: { kind: 'circle', r: 10 }, track: [[960, 100, 90, 50, 300, 30, 200]] };
  const sc = base({ frames: 100, emitters: [em] });
  const r = Sim.run(sc), r2 = Sim.run(JSON.parse(JSON.stringify(sc)));
  assert.strictEqual(r.particles.length, 30);
  assert.deepStrictEqual(r.particles, r2.particles);
  const p0 = r.particles[0];
  assert.strictEqual(p0.to - p0.from, 25);
  assert.strictEqual(p0.data.length, 25 * 3);
  assert.ok(p0.data[4] > p0.data[1], 'emite hacia abajo (90°)');
  r.particles.forEach((p) => assert.ok(p.scale >= 0.7 - 1e-9 && p.scale <= 1.3 + 1e-9));
});

test('ejecución por tramos da el mismo resultado que de una vez', () => {
  const sc = base({ frames: 80, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 960, y: 0, a: 10 }, shape: box(80, 40) }] });
  const s = Sim.create(JSON.parse(JSON.stringify(sc)));
  let st; do { st = s.step(7); } while (!st.done);
  assert.deepStrictEqual(s.result().bodies, Sim.run(sc).bodies);
});

test('sin paredes los objetos salen de la composición', () => {
  const r = Sim.run(base({ frames: 60, world: { gravity: 980 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 960, y: 900 }, shape: box(50, 50) }] }));
  assert.ok(last(r.bodies.a)[1] > 1200);
});

test('escena grande: 300 cuerpos x 250 fotogramas en tiempo razonable', () => {
  const bodies = [];
  for (let i = 0; i < 300; i++) bodies.push({ id: 'b' + i, type: 'dynamic', pose: { x: 100 + (i % 30) * 58, y: 50 + Math.floor(i / 30) * 60, a: i * 7 }, shape: i % 2 ? box(40, 40) : { kind: 'circle', r: 22 } });
  const t = Date.now();
  const r = Sim.run(base({ frames: 250, bodies }));
  const ms = Date.now() - t;
  assert.ok(ms < 30000, ms + ' ms');
  for (const id in r.bodies) { const [x, y] = last(r.bodies[id]); assert.ok(x > 0 && x < 1920 && y > 0 && y < 1080, id + ' dentro: ' + x + ',' + y); }
});
