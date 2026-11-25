'use strict';
// Variantes de física pura: cada prueba cambia una condición distinta del mundo, del tiempo o de los cuerpos.
const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../src/engine/sim.js');

const W = 1920, H = 1080;
const scene = (o) => Object.assign({ fps: 25, frames: 100, width: W, height: H, world: { gravity: 980 }, bodies: [] }, o);
const box = (w, h) => ({ kind: 'box', w, h });
const ball = (r) => ({ kind: 'circle', r });
const dyn = (id, x, y, shape, extra) => Object.assign({ id, type: 'dynamic', pose: { x, y, a: 0 }, shape }, extra || {});
const fix = (id, x, y, shape, extra) => Object.assign({ id, type: 'static', pose: { x, y, a: 0 }, shape }, extra || {});
const at = (rec, k) => rec.data.slice(k * 3, k * 3 + 3);
const last = (rec) => rec.data.slice(-3);
const finite = (r) => { for (const id in r.bodies) r.bodies[id].data.forEach((v) => assert.ok(Number.isFinite(v), id + ' no finito')); };

// ---------- Gravedad: dirección e intensidad ----------
for (const [angle, dx, dy] of [[0, 0, 1], [90, -1, 0], [180, 0, -1], [-90, 1, 0], [45, -Math.SQRT1_2, Math.SQRT1_2]]) {
  test('gravedad con dirección ' + angle + '°: cae en ese sentido ½·g·t²', () => {
    const r = Sim.run(scene({ frames: 26, world: { gravity: 980, gravityAngle: angle }, bodies: [dyn('a', 960, 540, box(20, 20))] }));
    const [x, y] = at(r.bodies.a, 25);
    assert.ok(Math.abs(x - 960 - dx * 490) < 15 && Math.abs(y - 540 - dy * 490) < 15, angle + '°: ' + x + ',' + y);
  });
}
test('gravedad de Júpiter (2480 px/s²) y de la Luna (160 px/s²)', () => {
  for (const g of [2480, 160]) {
    const r = Sim.run(scene({ frames: 13, world: { gravity: g }, bodies: [dyn('a', 0, 0, box(10, 10))] }));
    const y = at(r.bodies.a, 12)[1], expect = 0.5 * g * 0.48 * 0.48;
    assert.ok(Math.abs(y - expect) / expect < 0.05, g + ': ' + y + ' vs ' + expect);
  }
});
test('gravedad extrema (100000 px/s²) no produce valores no finitos', () => {
  const bodies = []; for (let i = 0; i < 20; i++) bodies.push(dyn('b' + i, 100 + i * 80, 500, i % 2 ? box(40, 40) : ball(20)));
  const r = Sim.run(scene({ frames: 50, world: { gravity: 100000, floor: true, sides: true }, bodies }));
  finite(r);
  for (const id in r.bodies) assert.ok(last(r.bodies[id])[1] < H + 5, id + ' atraviesa el suelo');
});
test('gravedad hacia arriba con techo: se apilan contra el techo', () => {
  const r = Sim.run(scene({ frames: 100, world: { gravity: 980, gravityAngle: 180, ceiling: true }, bodies: [dyn('a', 500, 500, box(100, 60))] }));
  assert.ok(Math.abs(last(r.bodies.a)[1] - 30) < 1.5);
});

// ---------- Fotogramas por segundo y calidad ----------
for (const fps of [12, 23.976, 29.97, 50, 60]) {
  test('fps ' + fps + ': la caída libre a 1 s es la misma', () => {
    const frames = Math.round(fps) + 1, r = Sim.run(scene({ fps, frames, bodies: [dyn('a', 0, 0, box(10, 10))] }));
    const k = Math.round(fps), t = k / fps, y = at(r.bodies.a, k)[1];
    assert.ok(Math.abs(y - 490 * t * t) < 12, fps + ' fps: ' + y);
    assert.strictEqual(r.bodies.a.data.length, frames * 3);
  });
}
test('calidad 60 y 960 Hz llegan al mismo reposo', () => {
  const ends = [60, 960].map((quality) => last(Sim.run(scene({ frames: 120, world: { gravity: 980, floor: true, quality }, bodies: [dyn('a', 500, 300, box(80, 80))] })).bodies.a));
  assert.ok(Math.abs(ends[0][1] - ends[1][1]) < 1 && Math.abs(ends[0][1] - 1040) < 1.5);
});
test('un solo fotograma: devuelve la pose inicial', () => {
  const r = Sim.run(scene({ frames: 1, bodies: [dyn('a', 10, 20, box(10, 10), { pose: { x: 10, y: 20, a: 33 } })] }));
  assert.deepStrictEqual(r.bodies.a.data, [10, 20, 33]);
});

// ---------- Materiales ----------
test('resistencia del aire limita la velocidad', () => {
  const free = at(Sim.run(scene({ frames: 51, bodies: [dyn('a', 0, 0, box(10, 10))] })).bodies.a, 50)[1];
  const drag = at(Sim.run(scene({ frames: 51, world: { gravity: 980, airDrag: 2 }, bodies: [dyn('a', 0, 0, box(10, 10))] })).bodies.a, 50)[1];
  assert.ok(drag < free * 0.6, 'con aire ' + drag + ' vs ' + free);
});
test('rebote 1: la pelota vuelve casi a la misma altura; rebote 0: no rebota', () => {
  const run = (restitution) => Sim.run(scene({ frames: 75, world: { gravity: 980, floor: true, wallBounce: restitution }, bodies: [dyn('a', 500, 580, ball(40), { material: { restitution } })] })).bodies.a;
  const bouncy = run(1), ys = []; for (let k = 0; k < 75; k++) ys.push(at(bouncy, k)[1]);
  const lowAfterHit = Math.min(...ys.slice(ys.indexOf(Math.max(...ys))));
  assert.ok(lowAfterHit < 620, 'sube hasta ' + lowAfterHit);
  const dead = run(0), ys0 = []; for (let k = 0; k < 75; k++) ys0.push(at(dead, k)[1]);
  const hit = ys0.findIndex((y) => y > 1035);
  assert.ok(Math.min(...ys0.slice(hit)) > 1030, 'sin rebote');
});
test('fricción: en una rampa de 20° el hielo se desliza y la goma se queda', () => {
  const ramp = { id: 'r', type: 'static', pose: { x: 960, y: 700, a: 20 }, shape: box(1400, 40), material: { friction: 1 } };
  const run = (friction) => { const r = Sim.run(scene({ frames: 100, bodies: [ramp, { id: 'b', type: 'dynamic', pose: { x: 960, y: 640, a: 20 }, shape: box(60, 40), material: { friction } }] })); return last(r.bodies.b)[0]; };
  assert.ok(run(0.02) > 1150, 'el hielo baja');
  assert.ok(Math.abs(run(1) - 960) < 15, 'la goma no se mueve');
});
test('masa: un objeto denso empuja a uno ligero en un choque frontal', () => {
  const r = Sim.run(scene({ frames: 40, world: { gravity: 0 }, bodies: [dyn('heavy', 400, 540, box(60, 60), { material: { density: 20 }, velocity: { x: 400, y: 0 } }), dyn('light', 700, 540, box(60, 60), { material: { density: 0.5 } })] }));
  assert.ok(last(r.bodies.heavy)[0] > 650, 'el pesado sigue avanzando');
  assert.ok(last(r.bodies.light)[0] > 1100, 'el ligero sale disparado');
});
test('giro inicial sin gravedad: gira a velocidad constante', () => {
  const r = Sim.run(scene({ frames: 26, world: { gravity: 0 }, bodies: [dyn('a', 500, 500, box(100, 20), { velocity: { x: 0, y: 0, a: 90 } })] }));
  assert.ok(Math.abs(at(r.bodies.a, 25)[2] - 90) < 1);
});

// ---------- Escalas extremas ----------
test('composición 8K (7680 × 4320): cae y reposa en el suelo', () => {
  const r = Sim.run({ fps: 25, frames: 150, width: 7680, height: 4320, world: { gravity: 980, floor: true }, bodies: [dyn('a', 3840, 3000, box(400, 400))] });
  assert.ok(Math.abs(last(r.bodies.a)[1] - 4120) < 2);
});
test('composición diminuta (64 × 64) con un objeto de 8 px', () => {
  const r = Sim.run({ fps: 25, frames: 60, width: 64, height: 64, world: { gravity: 980, floor: true, sides: true }, bodies: [dyn('a', 32, 10, box(8, 8))] });
  assert.ok(Math.abs(last(r.bodies.a)[1] - 60) < 1);
});
test('cuerpo enorme (6000 px) como suelo y bola de 2 px encima', () => {
  const r = Sim.run(scene({ frames: 100, bodies: [fix('f', 960, 900, box(6000, 100)), dyn('b', 960, 600, ball(1))] }));
  assert.ok(Math.abs(last(r.bodies.b)[1] - 849) < 1, String(last(r.bodies.b)));
});
test('objeto muy rápido (6000 px/s) no atraviesa una pared fija de 2 px', () => {
  const r = Sim.run(scene({ frames: 25, world: { gravity: 0 }, bodies: [fix('w', 1200, 540, box(2, 600)), dyn('b', 300, 540, ball(8), { velocity: { x: 6000, y: 0 } })] }));
  for (let k = 0; k < 25; k++) assert.ok(at(r.bodies.b, k)[0] < 1200, 'atraviesa en el fotograma ' + k);
});
test('cuerpos que empiezan superpuestos se separan sin explotar', () => {
  const bodies = []; for (let i = 0; i < 10; i++) bodies.push(dyn('b' + i, 960 + i * 0.5, 540, box(100, 100)));
  const r = Sim.run(scene({ frames: 50, world: { gravity: 980, floor: true, sides: true }, bodies }));
  finite(r);
  for (const id in r.bodies) { const d = r.bodies[id].data; for (let k = 1; k < 50; k++) assert.ok(Math.hypot(d[k * 3] - d[k * 3 - 3], d[k * 3 + 1] - d[k * 3 - 2]) < 400, id + ' sale disparado'); }
});
test('solo lados (sin suelo): caen fuera por abajo', () => {
  const r = Sim.run(scene({ frames: 60, world: { gravity: 980, sides: true }, bodies: [dyn('a', 960, 900, box(50, 50))] }));
  assert.ok(last(r.bodies.a)[1] > H + 100);
});

// ---------- Cuerpos animados, apariciones ----------
test('pala que gira (rotación animada) golpea una bola', () => {
  const track = []; for (let k = 0; k < 75; k++) track.push([960, 700, -60 + k * 4]);
  const r = Sim.run(scene({ frames: 75, world: { gravity: 980, floor: true }, bodies: [{ id: 'pala', type: 'kinematic', pose: { x: 960, y: 700, a: -60 }, track, shape: { kind: 'box', x: 150, y: 0, w: 300, h: 20 } }, dyn('b', 1150, 450, ball(25))] }));
  const d = r.bodies.pala.data; assert.ok(Math.abs(d[d.length - 1] - track[74][2]) < 0.5, 'la pala sigue su rotación');
  assert.ok(Math.abs(last(r.bodies.b)[0] - 1150) > 50, 'la bola sale golpeada');
});
test('cuerpo animado que desaparece a mitad: deja de chocar', () => {
  const track = []; for (let k = 0; k < 100; k++) track.push([960, 800, 0]);
  const r = Sim.run(scene({ frames: 100, bodies: [{ id: 'k', type: 'kinematic', despawn: 40, pose: { x: 960, y: 800, a: 0 }, track, shape: box(400, 40) }, dyn('b', 960, 600, box(50, 50))] }));
  assert.strictEqual(r.bodies.k.data.length, 40 * 3);
  assert.ok(last(r.bodies.b)[1] > 1100, 'cae al desaparecer la plataforma');
});
test('suelo fijo que aparece tarde: atrapa a los que aún caen', () => {
  const r = Sim.run(scene({ frames: 80, world: { gravity: 980 }, bodies: [fix('f', 960, 900, box(800, 40), { spawn: 10 }), dyn('b', 960, 100, box(50, 50))] }));
  assert.ok(Math.abs(last(r.bodies.b)[1] - 855) < 1.5);
});

// ---------- Fuerzas ----------
test('ventilador con alcance: empuja dentro del círculo y nada fuera', () => {
  const r = Sim.run(scene({ frames: 50, world: { gravity: 0 }, forces: [{ type: 'wind', track: [[500, 540, 0, 800, 300]] }], bodies: [dyn('in', 500, 600, box(20, 20)), dyn('out', 500, 1000, box(20, 20))] }));
  assert.ok(last(r.bodies.in)[0] > 600);
  assert.strictEqual(last(r.bodies.out)[0], 500);
});
test('repulsor (intensidad negativa) aleja', () => {
  const r = Sim.run(scene({ frames: 30, world: { gravity: 0 }, forces: [{ type: 'attract', track: [[960, 540, 0, -900, 0]] }], bodies: [dyn('a', 1060, 540, box(20, 20))] }));
  assert.ok(last(r.bodies.a)[0] > 1150);
});
test('fuerza animada: se enciende a mitad de la simulación', () => {
  const track = []; for (let k = 0; k < 60; k++) track.push([0, 0, 0, k < 30 ? 0 : 800, 0]);
  const r = Sim.run(scene({ frames: 60, world: { gravity: 0 }, forces: [{ type: 'wind', track }], bodies: [dyn('a', 500, 500, box(20, 20))] }));
  assert.strictEqual(at(r.bodies.a, 29)[0], 500);
  assert.ok(last(r.bodies.a)[0] > 600);
});
test('dos ventiladores opuestos se anulan', () => {
  const r = Sim.run(scene({ frames: 40, world: { gravity: 0 }, forces: [{ type: 'wind', track: [[0, 0, 0, 500, 0]] }, { type: 'wind', track: [[0, 0, 180, 500, 0]] }], bodies: [dyn('a', 500, 500, box(20, 20))] }));
  assert.ok(Math.abs(last(r.bodies.a)[0] - 500) < 0.5);
});

// ---------- Partículas ----------
const emitter = (o) => Object.assign({ id: 'e', max: 50, seed: 5, shape: ball(6), track: [[960, 100, 90, 20, 200, 30, 100]] }, o);
test('partículas: ritmo 0 no emite; máximo 0 no emite', () => {
  assert.strictEqual(Sim.run(scene({ frames: 40, emitters: [emitter({ track: [[960, 100, 90, 0, 200, 30, 100]] })] })).particles.length, 0);
  assert.strictEqual(Sim.run(scene({ frames: 40, emitters: [emitter({ max: 0 })] })).particles.length, 0);
});
test('partículas: ritmo fraccionario se acumula (0,5/s durante 4 s = 2)', () => {
  const r = Sim.run(scene({ frames: 101, emitters: [emitter({ track: [[960, 100, 90, 0.5, 200, 30, 0]] })] }));
  assert.strictEqual(r.particles.length, 2);
});
test('partículas: el emisor animado reparte la emisión a lo largo de su camino', () => {
  const track = []; for (let k = 0; k < 50; k++) track.push([200 + k * 30, 100, 90, 25, 0, 0, 0]);
  const r = Sim.run(scene({ frames: 50, world: { gravity: 0 }, emitters: [emitter({ track, max: 100 })] }));
  r.particles.forEach((p) => assert.ok(Math.abs(p.data[0] - (200 + p.from * 30)) < 1, 'nace donde está el emisor'));
});
test('partículas: vida más larga que la simulación → sin fin', () => {
  const r = Sim.run(scene({ frames: 30, emitters: [emitter({ lifetime: 100 })] }));
  r.particles.forEach((p) => assert.strictEqual(p.to, null));
});
test('partículas: sin dispersión ni variación salen todas en la misma dirección y velocidad', () => {
  const r = Sim.run(scene({ frames: 20, world: { gravity: 0 }, emitters: [emitter({ track: [[960, 540, 0, 50, 300, 0, 0]], speedVariation: 0, spin: 0 })] }));
  r.particles.filter((p) => p.data.length >= 9).forEach((p) => { assert.ok(Math.abs(p.data[4] - p.data[1]) < 1e-6); assert.ok(Math.abs(p.data[3] - p.data[0] - 12) < 0.01); });
});
test('partículas: semilla distinta, resultado distinto; misma semilla, idéntico', () => {
  const a = Sim.run(scene({ frames: 30, emitters: [emitter({ seed: 1 })] })), b = Sim.run(scene({ frames: 30, emitters: [emitter({ seed: 1 })] })), c = Sim.run(scene({ frames: 30, emitters: [emitter({ seed: 2 })] }));
  assert.deepStrictEqual(a.particles, b.particles);
  assert.notDeepStrictEqual(a.particles, c.particles);
});
test('partículas: el emisor deja de emitir en su punto de salida', () => {
  const r = Sim.run(scene({ frames: 80, emitters: [emitter({ to: 20, max: 1000 })] }));
  r.particles.forEach((p) => assert.ok(p.from < 20));
});

// ---------- Uniones ----------
test('cadena de 6 eslabones con pivotes: se mantiene unida', () => {
  const bodies = [], joints = [];
  for (let i = 0; i < 6; i++) { bodies.push({ id: 'l' + i, type: 'dynamic', pose: { x: 600 + i * 60, y: 200, a: 0 }, shape: { kind: 'box', x: 30, y: 0, w: 60, h: 12 } }); joints.push({ a: 'l' + i, b: i ? 'l' + (i - 1) : null, type: 'pivot' }); }
  const r = Sim.run(scene({ frames: 100, bodies, joints }));
  for (let k = 0; k < 100; k += 10) for (let i = 1; i < 6; i++) {
    const p = at(r.bodies['l' + (i - 1)], k), q = at(r.bodies['l' + i], k), a = p[2] * Math.PI / 180;
    const end = [p[0] + Math.cos(a) * 60, p[1] + Math.sin(a) * 60];
    assert.ok(Math.hypot(end[0] - q[0], end[1] - q[1]) < 2, 'eslabón ' + i + ' separado en ' + k);
  }
});
test('muelle con amortiguación alta oscila menos que con amortiguación baja', () => {
  const amp = (damping) => { const r = Sim.run(scene({ frames: 150, bodies: [fix('a', 960, 100, box(20, 20)), dyn('b', 960, 300, box(30, 30))], joints: [{ a: 'b', b: 'a', type: 'spring', frequency: 1, damping }] })); const ys = []; for (let k = 100; k < 150; k++) ys.push(at(r.bodies.b, k)[1]); return Math.max(...ys) - Math.min(...ys); };
  assert.ok(amp(1) < amp(0.02) * 0.5);
});
test('unión a un cuerpo animado: lo arrastra', () => {
  const track = []; for (let k = 0; k < 75; k++) track.push([300 + k * 10, 300, 0]);
  const r = Sim.run(scene({ frames: 75, bodies: [{ id: 'k', type: 'kinematic', pose: { x: 300, y: 300, a: 0 }, track, shape: box(20, 20) }, dyn('b', 300, 450, box(30, 30))], joints: [{ a: 'b', b: 'k', type: 'distance' }] }));
  assert.ok(last(r.bodies.b)[0] > 800);
});
test('unión entre dos fijos: se ignora con aviso', () => {
  const r = Sim.run(scene({ frames: 5, bodies: [fix('a', 0, 0, box(10, 10)), fix('b', 100, 0, box(10, 10))], joints: [{ a: 'a', b: 'b', type: 'pivot' }] }));
  assert.ok(r.warnings.some((w) => w.code === 'union-sin-dinamico'));
});
test('determinismo con choques complejos: dos ejecuciones idénticas', () => {
  const bodies = []; for (let i = 0; i < 40; i++) bodies.push(dyn('b' + i, 300 + (i % 10) * 70, 100 + Math.floor(i / 10) * 80, i % 2 ? box(50, 30) : ball(22), { pose: { x: 300 + (i % 10) * 70, y: 100 + Math.floor(i / 10) * 80, a: i * 17 } }));
  const sc = scene({ frames: 80, world: { gravity: 980, floor: true, sides: true }, bodies });
  assert.deepStrictEqual(Sim.run(JSON.parse(JSON.stringify(sc))).bodies, Sim.run(JSON.parse(JSON.stringify(sc))).bodies);
});

test('bola dentro de un anillo hueco dinámico: caen juntos y la bola no se escapa', () => {
  const ring = []; for (let i = 0; i < 48; i++) { const a = i / 48 * 2 * Math.PI; ring.push([Math.cos(a) * 150, Math.sin(a) * 150]); }
  const r = Sim.run(scene({ frames: 120, world: { gravity: 980, floor: true }, bodies: [
    { id: 'ring', type: 'dynamic', pose: { x: 960, y: 400 }, shape: { kind: 'stroke', thickness: 12, paths: [{ points: ring, closed: true }] } },
    dyn('b', 960, 400, ball(40), { velocity: { x: 900, y: -300 } })] }));
  for (let k = 0; k < 120; k++) { const p = at(r.bodies.ring, k), q = at(r.bodies.b, k); assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) < 150 - 6 - 40 + 2, 'la bola sale del anillo en ' + k); }
});
test('anchura del emisor: reparte las partículas en perpendicular a su dirección', () => {
  const r = Sim.run(scene({ frames: 30, world: { gravity: 0 }, emitters: [emitter({ max: 60, track: [[960, 540, 0, 100, 0, 0, 400]] })] }));
  const xs = r.particles.map((p) => p.data[0]), ys = r.particles.map((p) => p.data[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 1, 'dirección 0°: misma x');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 300 && Math.max(...ys) - Math.min(...ys) <= 400, 'repartidas en 400 px de y');
});
