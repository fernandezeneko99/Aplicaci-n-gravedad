'use strict';
// Regresiones de los fallos del motor encontrados por la batería de escenas (ver QA_PROGRESS.md, «Batería»).
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../src/engine/sim.js');
const L = require('../tools/battery/lib.js');

const scene = (o) => Object.assign({ fps: 25, frames: 20, width: 1920, height: 1080, world: { gravity: 0 }, bodies: [] }, o);
const last = (rec) => rec.data.slice(-3);
function worstPenetration(sc, res) {
  const k = sc.frames - 1, placed = sc.bodies.map((b) => { const f = L.frameOf(res.bodies[b.id], k); return L.place(L.pieces(b.shape), f[0], f[1], f[2]); });
  let m = 0; for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) m = Math.max(m, L.bodyPenetration(placed[i], placed[j]));
  return m;
}

// B1: Box2D limitaba lo que un cuerpo avanza por subpaso (2 m = 100 px): los impulsos altos del panel se recortaban.
test('B1 · impulso de 100000 px/s a 12 fps y calidad Rápida recorre la distancia completa', () => {
  const r = Sim.run(scene({ fps: 12, frames: 13, world: { gravity: 0, quality: 60 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 0, y: 0 }, velocity: { x: 100000, y: 0 }, shape: { kind: 'circle', r: 5 } }] }));
  assert.ok(Math.abs(last(r.bodies.a)[0] - 100000) < 5, 'recorre ' + last(r.bodies.a)[0]);
});
test('B1 · giro de 100000°/s se mantiene', () => {
  const r = Sim.run(scene({ fps: 25, frames: 26, world: { gravity: 0, quality: 60 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 0, y: 0 }, velocity: { x: 0, y: 0, a: 100000 }, shape: { kind: 'box', w: 20, h: 20 } }] }));
  assert.ok(Math.abs(last(r.bodies.a)[2] - 100000) < 5, 'gira ' + last(r.bodies.a)[2]);
});

// B2: pilas con densidades muy distintas se atravesaban (hasta 40 px). La calidad sube lo justo y se avisa.
function stack(ratio, quality) {
  const bodies = []; let y = 1080;
  for (let i = 0; i < 10; i++) { y -= 20; bodies.push({ id: 's' + i, type: 'dynamic', pose: { x: 960, y: y - 0.5, a: 0 }, shape: { kind: 'box', w: 200, h: 40 }, material: { density: i % 2 ? ratio : 1, friction: 0.8, restitution: 0 } }); y -= 20.5; }
  return scene({ frames: 100, world: { gravity: 980, floor: true, sides: true, quality }, bodies });
}
for (const [ratio, quality, maxPen] of [[39, 60, 1.5], [200, 240, 1.5], [1000, 240, 1.5], [20000, 240, 2], [1e6, 240, 2]]) {
  test('B2 · pila con relación de densidades ' + ratio + ':1 a ' + quality + ' Hz: penetración ≤ ' + maxPen + ' px', () => {
    const sc = stack(ratio, quality), r = Sim.run(sc), pen = worstPenetration(sc, r);
    assert.ok(pen <= maxPen, 'penetración ' + pen.toFixed(2) + ' px');
    const needed = Math.min(ratio, 1000) <= 40 ? 120 : Math.min(ratio, 1000) <= 200 ? 240 : 960;
    assert.strictEqual(r.warnings.some((w) => w.code === 'calidad-subida'), needed > quality, 'aviso de calidad subida solo si hace falta');
    if (ratio > 1000) assert.ok(r.warnings.some((w) => w.code === 'masa-limitada'));
  });
}
test('B2 · densidades parecidas (≤10:1) no cambian la calidad ni avisan', () => {
  const r = Sim.run(stack(8, 60));
  assert.deepStrictEqual(r.warnings, []);
});

// B3: un anillo dinámico fino con partículas rápidas dejaba escapar partículas (apretadas a través de la pared).
test('B3 · anillo dinámico de 4 px con partículas a 3400 px/s y calidad 120: ninguna escapa y se avisa', () => {
  const ring = []; for (let i = 0; i < 63; i++) { const a = i / 63 * 2 * Math.PI; ring.push([Math.cos(a) * 112, Math.sin(a) * 112]); }
  const sc = scene({ fps: 30, frames: 30, world: { gravity: 0, quality: 120 }, bodies: [{ id: 'ring', type: 'dynamic', pose: { x: 960, y: 540, a: 0 }, shape: { kind: 'stroke', thickness: 4.4, paths: [{ points: ring, closed: true }] }, material: { density: 20 } }],
    emitters: [{ id: 'e', max: 64, seed: 7, shape: { kind: 'circle', r: 6.75 }, track: [[960, 540, 0, 400, 3400, 360, 0]], spin: 0 }] });
  const r = Sim.run(sc);
  assert.ok(r.warnings.some((w) => w.code === 'calidad-paredes'));
  for (const p of r.particles) for (let i = 0; i < p.data.length / 3; i++) { const c = L.frameOf(r.bodies.ring, p.from + i); assert.ok(Math.hypot(p.data[i * 3] - c[0], p.data[i * 3 + 1] - c[1]) < 112 + 2.2 + 1, 'escapa en el fotograma ' + (p.from + i)); }
});
test('B3 · un anillo fino que se mueve no se vuelve «bala» (las balas no chocan entre sí en Box2D)', () => {
  const ring = []; for (let i = 0; i < 40; i++) { const a = i / 40 * 2 * Math.PI; ring.push([Math.cos(a) * 200, Math.sin(a) * 200]); }
  const sc = scene({ fps: 25, frames: 40, world: { gravity: 0, quality: 240 }, bodies: [{ id: 'ring', type: 'dynamic', pose: { x: 960, y: 540 }, velocity: { x: 3000, y: 0 }, shape: { kind: 'stroke', thickness: 3, paths: [{ points: ring, closed: true }] } }, { id: 'b', type: 'dynamic', pose: { x: 960, y: 540 }, velocity: { x: 3000, y: 0 }, shape: { kind: 'circle', r: 5 } }] });
  const r = Sim.run(sc);
  for (let k = 0; k < 40; k++) { const c = L.frameOf(r.bodies.ring, k), b = L.frameOf(r.bodies.b, k); assert.ok(Math.hypot(b[0] - c[0], b[1] - c[1]) < 200, 'la bola sale del anillo en ' + k); }
});
