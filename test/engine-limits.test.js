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

// B4: Box2D dormía los cuerpos lentos (< 0,5 px/s durante 0,5 s): una deriva lenta o una gravedad mínima se detenían.
test('B4 · deriva lenta de 0,3 px/s en el espacio no se detiene', () => {
  const r = Sim.run(scene({ fps: 25, frames: 101, world: { gravity: 0 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 100, y: 100 }, velocity: { x: 0.3, y: 0 }, shape: { kind: 'box', w: 20, h: 20 } }] }));
  assert.ok(Math.abs(last(r.bodies.a)[0] - 101.2) < 0.05, 'recorre ' + (last(r.bodies.a)[0] - 100).toFixed(3) + ' px de 1,2');
});
test('B4 · gravedad de 1 px/s² hace caer ½·g·t²', () => {
  const r = Sim.run(scene({ fps: 25, frames: 76, world: { gravity: 1 }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 0, y: 0 }, shape: { kind: 'box', w: 20, h: 20 } }] }));
  assert.ok(Math.abs(last(r.bodies.a)[1] - 4.5) < 0.1, 'cae ' + last(r.bodies.a)[1]);
});
test('B4 · los cuerpos en reposo siguen durmiéndose (las claves se recortan)', () => {
  const r = Sim.run(scene({ fps: 25, frames: 150, world: { gravity: 980, floor: true }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 500, y: 900 }, shape: { kind: 'box', w: 100, h: 100 }, material: { restitution: 0 } }] }));
  const d = r.bodies.a.data, n = d.length / 3; let still = 0;
  for (let k = n - 1; k > 0 && d[k * 3] === d[k * 3 - 3] && d[k * 3 + 1] === d[k * 3 - 2] && d[k * 3 + 2] === d[k * 3 - 1]; k--) still++;
  assert.ok(still > 80, 'fotogramas idénticos al final: ' + still);
});

// B5: cuerpos que empiezan muy solapados salían despedidos (hasta 14000 px/s) y más cuanto mayor la calidad.
for (const quality of [240, 960]) {
  test('B5 · dos cajas solapadas al 90 % a ' + quality + ' Hz se separan sin salir despedidas', () => {
    const sc = scene({ fps: 25, frames: 75, world: { gravity: 0, quality }, bodies: [0, 1].map((i) => ({ id: 'o' + i, type: 'dynamic', pose: { x: 960 + i * 10, y: 540, a: 0 }, shape: { kind: 'box', w: 100, h: 100 } })) });
    const r = Sim.run(sc);
    let worst = 0; for (const id of ['o0', 'o1']) { const d = r.bodies[id].data; for (let k = 1; k < d.length / 3; k++) worst = Math.max(worst, Math.hypot(d[k * 3] - d[k * 3 - 3], d[k * 3 + 1] - d[k * 3 - 2]) * 25); }
    assert.ok(worst < 1000, 'velocidad máxima ' + worst.toFixed(0) + ' px/s');
    const a = last(r.bodies.o0), b = last(r.bodies.o1);
    assert.ok(Math.abs(b[0] - a[0]) > 98, 'acaban separadas: ' + Math.abs(b[0] - a[0]).toFixed(1) + ' px');
  });
}
// B6: el límite de relación de masas se medía con la gravedad terrestre; con más gravedad las pilas se hundían.
test('B6 · pila con densidades 0,01–9,9 y gravedad 2500 px/s²: sin penetraciones visibles', () => {
  const bodies = []; let y = 1080;
  for (let i = 0; i < 11; i++) { y -= 20; bodies.push({ id: 's' + i, type: 'dynamic', pose: { x: 960, y: y - 0.5, a: 0 }, shape: { kind: 'box', w: 160, h: 40 }, material: { density: i % 2 ? 9.86 : 0.01, friction: 0.8, restitution: 0 } }); y -= 20.5; }
  const sc = scene({ fps: 23.976, frames: 120, world: { gravity: 2492, floor: true, sides: true, quality: 240 }, bodies });
  const r = Sim.run(sc);
  assert.ok(worstPenetration(sc, r) <= 2, 'penetración ' + worstPenetration(sc, r).toFixed(2) + ' px');
  assert.ok(r.warnings.some((w) => w.code === 'masa-limitada' && w.limit < 1000), 'avisa del límite reducido');
});

// Lote 2: una tabla animada fina (3 px) que avanza 20–115 px por fotograma, o tiembla, empuja los cuerpos sin atravesarlos.
for (const [label, step] of [['avance constante de 60 px/fot.', (k) => -60 * k], ['temblor de hasta 115 px/fot.', (k) => (k % 2 ? -1 : 1) * Math.min(115, 6 * k) - 30 * k]]) {
  test('pared animada fina · ' + label + ': la caja que empuja queda siempre por delante', () => {
    const frames = 30, track = []; for (let k = 0; k < frames; k++) track.push([1200 + step(k), 540, 0]);
    const r = Sim.run(scene({ fps: 25, frames, world: { gravity: 0, quality: 60 }, bodies: [{ id: 'w', type: 'kinematic', pose: { x: 1200, y: 540, a: 0 }, track, shape: { kind: 'box', w: 3, h: 700 } }, { id: 'b', type: 'dynamic', pose: { x: 1000, y: 600, a: 0 }, shape: { kind: 'box', w: 18, h: 18 } }] }));
    const W = r.bodies.w.data, B = r.bodies.b.data;
    for (let k = 0; k < frames; k++) assert.ok(B[k * 3] < W[k * 3], 'fotograma ' + k + ': caja en ' + B[k * 3].toFixed(1) + ', pared en ' + W[k * 3].toFixed(1));
  });
}

// B7 (lote 2, aleatorias 1119 y 703): un cuerpo unido a la vez a una capa animada y al mundo no puede cumplir las dos
// uniones; Box2D respondía con impulsos sin límite (saltos de 8000–40000 px en un fotograma en una composición de 640 px).
const worstJump = (r) => { let w = 0; for (const rec of Object.values(r.bodies).concat(r.particles)) { const d = rec.data; for (let k = 1; k < d.length / 3; k++) w = Math.max(w, Math.hypot(d[k * 3] - d[k * 3 - 3], d[k * 3 + 1] - d[k * 3 - 2])); } return w; };
for (const seed of [1119, 703]) {
  test('B7 · caso reducido aleatorias ' + seed + ': unión imposible con una capa animada sin saltos absurdos y con aviso', () => {
    const sc = require('./fixtures/b7-aleatorias-' + seed + '.json'), r = Sim.run(JSON.parse(JSON.stringify(sc)));
    assert.ok(worstJump(r) < Math.max(sc.width, sc.height), 'salto máximo ' + worstJump(r).toFixed(0) + ' px/fotograma');
    const w = r.warnings.find((x) => x.code === 'velocidad-limitada');
    assert.ok(w, 'avisa: ' + JSON.stringify(r.warnings));
    assert.ok(sc.joints.some((j) => j.a === w.id || j.b === w.id), 'nombra una capa con unión: ' + w.id);
  });
}
test('B7 · el limitador no actúa en escenas con causa física (impulso de 100000 px/s, pala rápida, fuerza fuerte)', () => {
  const fast = Sim.run(scene({ fps: 25, frames: 50, world: { gravity: 980, floor: true, sides: true }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 500, y: 500 }, velocity: { x: 100000, y: -100000, a: 100000 }, shape: { kind: 'circle', r: 12 } }] }));
  const track = []; for (let k = 0; k < 30; k++) track.push([1200 - 60 * k, 540, 0]);
  const paddle = Sim.run(scene({ fps: 25, frames: 30, world: { gravity: 0 }, bodies: [{ id: 'w', type: 'kinematic', pose: { x: 1200, y: 540, a: 0 }, track, shape: { kind: 'box', w: 3, h: 700 } }, { id: 'b', type: 'dynamic', pose: { x: 1000, y: 540 }, shape: { kind: 'circle', r: 8 }, material: { restitution: 1 } }] }));
  const force = Sim.run(scene({ fps: 25, frames: 100, world: { gravity: 0 }, forces: [{ type: 'wind', track: [[0, 0, 0, 50000, 0]] }], bodies: [{ id: 'a', type: 'dynamic', pose: { x: 100, y: 500 }, shape: { kind: 'circle', r: 12 } }] }));
  for (const r of [fast, paddle, force]) assert.ok(!r.warnings.some((x) => x.code === 'velocidad-limitada'), JSON.stringify(r.warnings));
});
