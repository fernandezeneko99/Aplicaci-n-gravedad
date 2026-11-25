'use strict';
/*
 * Familias de escenas. Cada familia: make(seed) → { scene, check(res) → [fallos] }.
 * Los rangos siguen los admitidos por el panel (gravedad ±100000, impulso ±100000 px/s, calidad 60–960 Hz, densidad
 * 0,001–1000, fricción 0–10, rebote 0–1) y prueban sus límites a propósito.
 */
const L = require('./lib.js');
const { rng, FPS, QUALITY, RES, pieces, place, extent, frameOf, lastFrame, genericChecks, minThickness, speedCap, substeps } = L;
const box = (w, h) => ({ kind: 'box', w, h });
const ball = (r) => ({ kind: 'circle', r });
const fail = (check, expected, observed, frame) => ({ check, expected, observed, frame });

const families = {};

// 1. Caída libre: ½·g·t² en cualquier dirección, fps, calidad y fotograma de inicio.
families.caida = { count: 800, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), g = r.chance(0.1) ? r.pick([1, 100000]) : r.range(50, 5000), angle = r.range(-180, 180);
  const spawn = r.int(0, 5), sceneProbe = { fps, world: { quality } }, cap = speedCap(sceneProbe) * 0.9;
  const tMax = Math.min(2.5, cap / g), frames = spawn + Math.max(3, Math.floor(tMax * fps));
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: g, gravityAngle: angle, quality }, bodies: [{ id: 'a', type: 'dynamic', spawn, pose: { x: 960, y: 540, a: 0 }, shape: box(20, 20) }] };
  return { scene, check(res) {
    const rec = res.bodies.a, dt = 1 / (fps * substeps(scene)), rad = angle * Math.PI / 180, dir = [-Math.sin(rad), Math.cos(rad)];
    for (const k of [spawn + Math.floor((frames - spawn) / 2), frames - 1]) {
      const t = (k - spawn) / fps, d = 0.5 * g * t * t + 0.5 * g * t * dt, f = frameOf(rec, k);
      const ex = 960 + dir[0] * d, ey = 540 + dir[1] * d, err = Math.hypot(f[0] - ex, f[1] - ey), tol = 0.6 + 1e-4 * d;
      if (err > tol) return [fail('caída libre', '(' + ex.toFixed(2) + ', ' + ey.toFixed(2) + ') ±' + tol.toFixed(2), '(' + f[0] + ', ' + f[1] + ')', k)];
    }
    return [];
  } };
} };

// 2. Inercia sin gravedad: velocidad y giro constantes, incluidos los máximos del panel. Con resistencia del aire, la
// solución discreta exacta del integrador.
families.inercia = { count: 700, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), drag = r.chance(0.3) ? r.range(0.05, 5) : 0;
  const speed = r.chance(0.15) ? r.pick([20000, 50000, 100000]) : r.range(0, 3000), dirA = r.range(0, 2 * Math.PI), spin = r.chance(0.15) ? r.pick([-100000, 36000, 100000]) : r.range(-720, 720);
  const frames = r.int(3, 40), vx = Math.cos(dirA) * speed, vy = Math.sin(dirA) * speed;
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: 0, quality, airDrag: drag }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 960, y: 540, a: 0 }, velocity: { x: vx, y: vy, a: spin }, shape: r.chance(0.5) ? ball(10) : box(16, 16) }] };
  return { scene, check(res) {
    const sub = substeps(scene), dt = 1 / (fps * sub), rec = res.bodies.a, k = frames - 1, n = k * sub, f = frameOf(rec, k);
    let dist = 0, ang = 0;
    if (drag) { let v = 1; for (let i = 1; i <= n; i++) { v /= 1 + dt * drag; dist += v * dt; } ang = spin * dist; dist *= speed; }
    else { dist = speed * n * dt; ang = spin * n * dt; }
    const ex = 960 + Math.cos(dirA) * dist, ey = 540 + Math.sin(dirA) * dist, err = Math.hypot(f[0] - ex, f[1] - ey), tol = 0.6 + 2e-5 * dist;
    if (err > tol) return [fail('inercia', 'recorre ' + dist.toFixed(1) + ' px a ' + speed.toFixed(0) + ' px/s', 'recorre ' + Math.hypot(f[0] - 960, f[1] - 540).toFixed(1) + ' px', k)];
    if (Math.abs(f[2] - ang) > 0.6 + 2e-5 * Math.abs(ang)) return [fail('giro', ang.toFixed(1) + '°', f[2] + '°', k)];
    return [];
  } };
} };

// 3. Reposo: cualquier forma cae y apoya su borde visible en el suelo.
families.reposo = { count: 900, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), g = r.range(300, 3000), size = r.chance(0.1) ? r.pick([4, 6, 600]) : r.range(10, 300);
  const [W, H] = r.pick(RES.slice(1, 5)), shape = L.randomShape(r, Math.min(size, W * 0.4, H * 0.4)), drop = r.range(0, H * 0.4);
  const fall = Math.sqrt(2 * (H * 0.6) / g), frames = Math.min(400, Math.ceil((fall + 3) * fps));
  const scene = { fps, frames, width: W, height: H, world: { gravity: g, floor: true, sides: true, quality }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: W / 2, y: H * 0.15 + drop * 0.2, a: r.range(0, 360) }, shape, material: { friction: r.range(0.3, 1), restitution: r.range(0, 0.2), density: r.range(0.1, 10) } }] };
  return { scene, check(res) {
    const out = genericChecks(scene, res); if (out.length) return out;
    const rec = res.bodies.a, f = frameOf(rec, frames - 1), e = extent(place(pieces(shape), f[0], f[1], f[2])), gap = H - e.y1, tol = 1.5 + 0.005 * size;
    if (Math.abs(gap) > tol) return [fail('reposo en el suelo', 'borde visible a 0 ±' + tol.toFixed(2) + ' px del suelo', gap.toFixed(2) + ' px', frames - 1)];
    return [];
  } };
} };

// 4. Contención: caja cerrada (suelo, lados, techo), muchos cuerpos rápidos.
families.contencion = { count: 800, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), [W, H] = r.pick(RES.slice(1, 5)), n = r.int(1, 30), cap = speedCap({ fps, world: { quality } }) * 0.8;
  const bodies = [];
  for (let i = 0; i < n; i++) { const size = r.range(6, Math.min(W, H) * 0.12), sp = r.range(0, Math.min(4000, cap)), a = r.range(0, 2 * Math.PI); bodies.push({ id: 'b' + i, type: 'dynamic', pose: { x: (i % 6 + 0.5) * W / 6, y: (Math.floor(i / 6) + 0.5) * H / 6, a: r.range(0, 360) }, velocity: { x: Math.cos(a) * sp, y: Math.sin(a) * sp, a: r.range(-360, 360) }, shape: L.randomShape(r, size), material: { restitution: r.range(0, 1), friction: r.range(0, 1) } }); }
  const scene = { fps, frames: r.int(20, 120), width: W, height: H, world: { gravity: r.range(0, 2000), gravityAngle: r.range(-180, 180), floor: true, sides: true, ceiling: true, quality }, bodies };
  return { scene, check(res) { return genericChecks(scene, res, { penTol: 2.5 }); } };
} };

// 5. Paredes finas contra cuerpos pequeños y rápidos: fija, dinámica o animada.
families.paredFina = { count: 800, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), kind = r.pick(['static', 'dynamic', 'kinematic']), thick = r.range(1, 4), rr = r.range(1, 10);
  const cap = speedCap({ fps, world: { quality } }) * 0.95, speed = r.range(500, Math.min(30000, cap)), frames = r.int(15, 40);
  const wall = { id: 'w', type: kind, pose: { x: 1200, y: 540, a: 0 }, shape: box(thick, 700), material: { density: 20 } };
  if (kind === 'kinematic') { wall.track = []; for (let k = 0; k < frames; k++) wall.track.push([1200 + k * r.range(-3, 3), 540, 0]); }
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: 0, quality }, bodies: [wall, { id: 'b', type: 'dynamic', pose: { x: 300, y: 540 + r.range(-200, 200), a: 0 }, velocity: { x: speed, y: 0 }, shape: r.chance(0.6) ? ball(rr) : box(rr * 2, rr * 2) }] };
  return { scene, check(res) {
    const W = res.bodies.w, B = res.bodies.b;
    for (let k = 0; k < frames; k++) {
      const w = frameOf(W, k), b = frameOf(B, k), a = -w[2] * Math.PI / 180, dx = b[0] - w[0], dy = b[1] - w[1], lx = Math.cos(a) * dx - Math.sin(a) * dy, ly = Math.sin(a) * dx + Math.cos(a) * dy;
      if (Math.abs(ly) < 300 && lx > thick / 2 + rr * 1.5 + 1) return [fail('pared fina (' + kind + ')', 'no atraviesa una pared de ' + thick.toFixed(1) + ' px a ' + speed.toFixed(0) + ' px/s', 'al otro lado (' + lx.toFixed(1) + ' px)', k)];
    }
    return [];
  } };
} };

// 6. Partículas rápidas dentro de un anillo cerrado (fijo o dinámico).
families.anillo = { count: 700, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), R = r.range(80, 400), t = r.range(2, 12), seg = r.int(16, 64), dyn = r.chance(0.5);
  const cap = speedCap({ fps, world: { quality } }) * 0.9, speed = r.range(100, Math.min(8000, cap)), pr = r.range(1.5, Math.min(8, R / 8));
  const ring = []; for (let i = 0; i < seg; i++) { const a = i / seg * 2 * Math.PI; ring.push([Math.cos(a) * R, Math.sin(a) * R]); }
  const scene = { fps, frames: r.int(20, 60), width: 1920, height: 1080, world: { gravity: r.chance(0.5) ? 0 : r.range(100, 2000), quality },
    bodies: [{ id: 'ring', type: dyn ? 'dynamic' : 'static', pose: { x: 960, y: 540, a: 0 }, shape: { kind: 'stroke', thickness: t, paths: [{ points: ring, closed: true }] }, material: { density: 20 } }],
    emitters: [{ id: 'e', max: r.int(5, 80), seed: r.int(1, 1e6), shape: ball(pr), track: [[960, 540, r.range(0, 360), r.range(50, 600), speed, 360, 0]], spin: 0 }] };
  // El anillo poligonal tiene su borde interior más cerca en el centro de cada lado.
  const inner = (R - t / 2) * Math.cos(Math.PI / seg);
  return { scene, check(res) {
    const ringRec = res.bodies.ring;
    for (const p of res.particles) for (let i = 0; i < p.data.length / 3; i++) {
      const k = p.from + i, c = frameOf(ringRec, k), d = Math.hypot(p.data[i * 3] - c[0], p.data[i * 3 + 1] - c[1]);
      if (d > R + t / 2 + 1) return [fail('anillo cerrado', 'partículas a menos de ' + inner.toFixed(1) + ' px del centro', 'una a ' + d.toFixed(1) + ' px (fuera del anillo)', k)];
    }
    return [];
  } };
} };

// 7. Alcance de las fuerzas: global, con radio, limitado a un cuerpo o a un emisor; varias a la vez.
families.fuerzas = { count: 700, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), frames = r.int(10, 50), n = r.int(2, 6), mode = r.pick(['radio', 'cuerpo', 'emisor', 'varias']);
  const bodies = []; for (let i = 0; i < n; i++) bodies.push({ id: 'b' + i, type: 'dynamic', pose: { x: 300, y: 120 + i * 160, a: 0 }, shape: r.chance(0.5) ? ball(20) : box(36, 36) });
  const forces = [], emitters = [];
  const affected = new Set();
  const strength = r.range(100, 3000) * (r.chance(0.2) ? -1 : 1);
  if (mode === 'radio') { const target = r.int(0, n - 1); forces.push({ type: 'wind', track: [[300, 120 + target * 160, 0, strength, 70]] }); affected.add('b' + target); }
  if (mode === 'cuerpo') { const target = r.int(0, n - 1); forces.push({ type: r.pick(['wind', 'attract']), only: 'b' + target, track: [[r.chance(0.5) ? 1500 : 300, 900, r.range(-90, 90), strength, r.chance(0.5) ? 0 : 5000]] }); affected.add('b' + target); }
  if (mode === 'emisor') {
    emitters.push({ id: 'e1', max: 1, seed: 1, shape: ball(4), track: [[1400, 300, 0, 1000, 0, 0, 0]] }, { id: 'e2', max: 1, seed: 2, shape: ball(4), track: [[1400, 800, 0, 1000, 0, 0, 0]] });
    forces.push({ type: 'wind', only: 'e1', track: [[0, 0, r.range(-180, 180), strength, 0]] }); affected.add('e1');
  }
  if (mode === 'varias') { const t1 = r.int(0, n - 1), t2 = (t1 + 1) % n; forces.push({ type: 'wind', only: 'b' + t1, track: [[0, 0, 0, strength, 0]] }, { type: 'attract', only: 'b' + t2, track: [[1800, 120 + t2 * 160, 0, Math.abs(strength), 0]] }); affected.add('b' + t1); affected.add('b' + t2); }
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: 0 }, bodies, forces, emitters };
  return { scene, check(res) {
    for (const b of bodies) {
      const rec = res.bodies[b.id], f = frameOf(rec, frames - 1), moved = Math.hypot(f[0] - b.pose.x, f[1] - b.pose.y);
      if (!affected.has(b.id) && moved > 1e-6) return [fail('fuerza acotada (' + mode + ')', b.id + ' quieto', 'se movió ' + moved.toFixed(3) + ' px', frames - 1)];
      if (affected.has(b.id) && moved < 0.05) return [fail('fuerza acotada (' + mode + ')', b.id + ' empujado', 'no se movió', frames - 1)];
    }
    for (const p of res.particles) { const moved = Math.hypot(p.data[p.data.length - 3] - p.data[0], p.data[p.data.length - 2] - p.data[1]); if (p.emitter === 'e2' && moved > 1e-6) return [fail('fuerza a emisor', 'partículas de e2 quietas', 'se movieron ' + moved.toFixed(3), p.from)]; if (p.emitter === 'e1' && p.data.length > 6 && moved < 0.01) return [fail('fuerza a emisor', 'partículas de e1 empujadas', 'quietas', p.from)]; }
    return [];
  } };
} };

// 8. Emisores: cantidad (ritmo, máximo, ventana), vida, posición de nacimiento y dirección dentro de la dispersión.
families.emisores = { count: 700, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), frames = r.int(5, 120), rate = r.chance(0.1) ? 0 : r.range(0.2, 200), max = r.chance(0.1) ? 0 : r.int(1, 300);
  const from = r.int(0, Math.floor(frames / 3)), to = r.chance(0.5) ? null : r.int(from + 1, frames), life = r.chance(0.5) ? 0 : r.range(0.05, 3);
  const angle = r.range(-180, 180), spread = r.range(0, 180), width = r.range(0, 800), speed = r.range(50, 1500);
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: 0 }, emitters: [{ id: 'e', from, to, max, lifetime: life, seed: r.int(1, 1e6), speedVariation: 0, spin: 0, shape: ball(r.range(0.5, 4)), track: [[960, 540, angle, rate, speed, spread, width]] }] };
  return { scene, check(res) {
    const active = Math.max(0, (to === null ? frames : to) - from), raw = active * rate / fps, expect = Math.min(max, Math.floor(raw + 1e-9)), near = Math.abs(raw - Math.round(raw)) < 1e-6;
    const got = res.particles.length;
    if (got !== expect && !(near && Math.abs(got - expect) <= 1 && got <= max)) return [fail('cantidad de partículas', expect + ' (ritmo ' + rate.toFixed(2) + ' × ' + active + ' fot. / ' + fps + ', máx. ' + max + ')', String(got), frames - 1)];
    const lf = life > 0 ? Math.max(1, Math.round(life * fps)) : 0, rad = angle * Math.PI / 180;
    for (const p of res.particles) {
      if (p.from < from || (to !== null && p.from >= to)) return [fail('ventana de emisión', 'nace en [' + from + ', ' + to + ')', 'nace en ' + p.from, p.from)];
      if (lf && p.from + lf < frames && p.to !== p.from + lf) return [fail('vida', 'muere en ' + (p.from + lf), String(p.to), p.from)];
      const along = -(p.data[0] - 960) * Math.sin(rad) + (p.data[1] - 540) * Math.cos(rad), ahead = (p.data[0] - 960) * Math.cos(rad) + (p.data[1] - 540) * Math.sin(rad);
      if (Math.abs(along) > width / 2 + 0.01 || Math.abs(ahead) > 0.01) return [fail('nacimiento sobre la línea del emisor', 'a ±' + (width / 2).toFixed(1) + ' px de la línea', 'desvío ' + along.toFixed(2) + ' / ' + ahead.toFixed(2), p.from)];
      // La dirección solo se mide en partículas que nacen aisladas (si nacen juntas, chocan y se desvían con razón).
      const alone = res.particles.every((o) => o === p || Math.abs(o.from - p.from) > 1 || Math.hypot(o.data[0] - p.data[0], o.data[1] - p.data[1]) > 40);
      if (alone && p.data.length >= 6) { const vx = p.data[3] - p.data[0], vy = p.data[4] - p.data[1], dev = Math.abs(((Math.atan2(vy, vx) - rad) * 180 / Math.PI + 540) % 360 - 180); if (Math.hypot(vx, vy) > 0.5 && dev > spread / 2 + 1) return [fail('dispersión', '≤ ' + (spread / 2).toFixed(1) + '°', dev.toFixed(1) + '°', p.from)]; }
    }
    return [];
  } };
} };

// 9. Uniones: pivote al mundo, barra rígida, cadena y muelle.
families.uniones = { count: 600, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), kind = r.pick(['pivote', 'barra', 'cadena', 'muelle']), frames = r.int(20, 120), g = r.range(0, 3000);
  const bodies = [], joints = [];
  if (kind === 'pivote') { bodies.push({ id: 'a', type: 'dynamic', pose: { x: 960, y: 300, a: r.range(0, 360) }, shape: { kind: 'box', x: r.range(30, 200), y: 0, w: r.range(10, 80), h: r.range(10, 80) } }); joints.push({ a: 'a', b: null, type: 'pivot' }); }
  if (kind === 'barra') { bodies.push({ id: 'f', type: 'static', pose: { x: 960, y: 200, a: 0 }, shape: box(20, 20) }, { id: 'a', type: 'dynamic', pose: { x: 960 + r.range(-300, 300), y: 200 + r.range(50, 400), a: 0 }, shape: ball(r.range(8, 40)), velocity: { x: r.range(-800, 800), y: 0 } }); joints.push({ a: 'a', b: 'f', type: 'distance' }); }
  if (kind === 'cadena') { const n = r.int(2, 8), len = r.range(20, 80); for (let i = 0; i < n; i++) { bodies.push({ id: 'l' + i, type: 'dynamic', pose: { x: 600 + i * len, y: 200, a: 0 }, shape: { kind: 'box', x: len / 2, y: 0, w: len, h: r.range(4, 16) } }); joints.push({ a: 'l' + i, b: i ? 'l' + (i - 1) : null, type: 'pivot' }); } }
  if (kind === 'muelle') { bodies.push({ id: 'f', type: 'static', pose: { x: 960, y: 200, a: 0 }, shape: box(20, 20) }, { id: 'a', type: 'dynamic', pose: { x: 960, y: 200 + r.range(50, 400), a: 0 }, shape: box(30, 30) }); joints.push({ a: 'a', b: 'f', type: 'spring', frequency: r.range(0.1, 8), damping: r.range(0, 2) }); }
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: g, quality }, bodies, joints };
  return { scene, check(res) {
    const out = genericChecks(scene, res, { noPenetration: true }); if (out.length) return out;
    if (kind === 'pivote') for (let k = 0; k < frames; k++) { const f = frameOf(res.bodies.a, k); if (Math.hypot(f[0] - 960, f[1] - 300) > 1.5) return [fail('pivote', 'el anclaje no se mueve (±1,5 px)', 'se desplaza ' + Math.hypot(f[0] - 960, f[1] - 300).toFixed(2) + ' px', k)]; }
    if (kind === 'barra') { const L0 = Math.hypot(bodies[1].pose.x - 960, bodies[1].pose.y - 200); for (let k = 0; k < frames; k++) { const f = frameOf(res.bodies.a, k), d = Math.hypot(f[0] - 960, f[1] - 200); if (Math.abs(d - L0) > 2 + 0.01 * L0) return [fail('barra rígida', 'longitud ' + L0.toFixed(1), d.toFixed(1), k)]; } }
    if (kind === 'cadena') { const n = bodies.length, len = bodies[1] ? bodies[1].pose.x - bodies[0].pose.x : 0; for (let k = 0; k < frames; k += 3) for (let i = 1; i < n; i++) { const p = frameOf(res.bodies['l' + (i - 1)], k), q = frameOf(res.bodies['l' + i], k), a = p[2] * Math.PI / 180, end = [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len]; if (Math.hypot(end[0] - q[0], end[1] - q[1]) > 2.5) return [fail('cadena', 'eslabones unidos (±2,5 px)', 'separación ' + Math.hypot(end[0] - q[0], end[1] - q[1]).toFixed(2) + ' px en el eslabón ' + i, k)]; } }
    return [];
  } };
} };

// 10. Pilas con proporciones de masa extremas.
families.pilas = { count: 600, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), n = r.int(2, 18), W = r.range(30, 300), bodies = [];
  let y = 1080;
  for (let i = 0; i < n; i++) { const h = r.range(12, 80), w = W * r.range(0.6, 1.2); y -= h / 2; bodies.push({ id: 's' + i, type: 'dynamic', pose: { x: 960 + r.range(-2, 2), y: y - 0.5, a: 0 }, shape: box(w, h), material: { density: r.chance(0.3) ? r.pick([0.01, 50, 200]) : r.range(0.2, 10), friction: r.range(0.4, 1), restitution: 0 } }); y -= h / 2 + 0.5; }
  const scene = { fps, frames: r.int(40, 160), width: 1920, height: 1080, world: { gravity: r.range(300, 2500), floor: true, sides: true, quality }, bodies };
  return { scene, check(res) { return genericChecks(scene, res, { penTol: 2.5 }); } };
} };

// 11. Cuerpos animados: siguen su trayectoria exacta y empujan sin dejarse atravesar.
families.animados = { count: 600, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), frames = r.int(20, 100), track = [], ax = r.range(50, 600), aw = r.range(0.5, 4), rot = r.range(-720, 720);
  for (let k = 0; k < frames; k++) { const t = k / fps; track.push([960 + ax * Math.sin(aw * t), 700 + r.range(-0.0, 0.0), rot * t]); }
  const bodies = [{ id: 'k', type: 'kinematic', pose: { x: track[0][0], y: track[0][1], a: track[0][2] }, track, shape: box(r.range(40, 300), r.range(8, 40)) }];
  const n = r.int(0, 8); for (let i = 0; i < n; i++) bodies.push({ id: 'd' + i, type: 'dynamic', pose: { x: 600 + i * 90, y: 300 + r.range(0, 200), a: 0 }, shape: L.randomShape(r, r.range(15, 60)) });
  const scene = { fps, frames, width: 1920, height: 1080, world: { gravity: r.range(300, 2000), floor: true, sides: true, ceiling: true, quality }, bodies };
  return { scene, check(res) {
    for (let k = 0; k < frames; k++) { const f = frameOf(res.bodies.k, k), t = track[k], ang = Math.abs(((f[2] - t[2]) % 360 + 540) % 360 - 180); if (Math.hypot(f[0] - t[0], f[1] - t[1]) > 0.05 || ang > 0.05) return [fail('trayectoria animada', JSON.stringify(t.map((v) => +v.toFixed(2))), JSON.stringify(f), k)]; }
    return genericChecks(scene, res, { penTol: 3, containTol: 3 });
  } };
} };

// 12. Cuerpos que empiezan parcialmente superpuestos: se separan sin explotar.
families.superpuestos = { count: 500, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), n = r.int(2, 6), size = r.range(20, 150), overlap = r.range(0.1, 0.9), bodies = [];
  for (let i = 0; i < n; i++) bodies.push({ id: 'o' + i, type: 'dynamic', pose: { x: 960 + i * size * (1 - overlap), y: 500 + r.range(-3, 3), a: r.range(0, 30) }, shape: r.chance(0.5) ? ball(size / 2) : box(size, size) });
  const frames = Math.ceil(fps * 3), scene = { fps, frames, width: 1920, height: 1080, world: { gravity: r.range(0, 2000), floor: true, sides: true, quality }, bodies };
  return { scene, check(res) {
    for (const b of bodies) { const rec = res.bodies[b.id]; for (let k = 1; k < frames; k++) { const p = frameOf(rec, k - 1), q = frameOf(rec, k), v = Math.hypot(q[0] - p[0], q[1] - p[1]) * fps; if (v > 6000) return [fail('separación sin explosión', 'velocidad < 6000 px/s', b.id + ' a ' + v.toFixed(0) + ' px/s', k)]; } }
    return genericChecks(scene, res, { penTol: 3 });
  } };
} };

// 13. Duplicados: dos cuerpos idénticos ya identificados se simulan por separado (la copia no altera al original).
families.duplicados = { count: 500, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), size = r.range(20, 150), shape = L.randomShape(r, size), copies = r.int(1, 4), gap = size * r.range(1.6, 4);
  const bodies = [{ id: 'orig', type: 'dynamic', pose: { x: 300, y: 150, a: r.range(0, 360) }, shape, material: { restitution: r.range(0, 0.6) } }];
  for (let i = 1; i <= copies; i++) bodies.push({ id: 'copia' + i, type: 'dynamic', pose: { x: 300 + i * gap, y: 150, a: bodies[0].pose.a }, shape, material: bodies[0].material });
  bodies.push({ id: 'obst', type: 'static', pose: { x: 300 + gap, y: 600, a: 0 }, shape: box(size * 1.2, 20) });
  const scene = { fps, frames: r.int(30, 120), width: 1920, height: 1080, world: { gravity: r.range(300, 2000), floor: true, quality }, bodies };
  return { scene, check(res) {
    const Sim = require('../../src/engine/sim.js');
    const solo = Sim.run(Object.assign({}, scene, { bodies: [bodies[0]] }));
    if (JSON.stringify(solo.bodies.orig.data) !== JSON.stringify(res.bodies.orig.data)) return [fail('identidad independiente', 'el original no cambia por tener copias', 'trayectoria distinta', 0)];
    const a = res.bodies.orig.data, b = res.bodies.copia1.data, g = scene.world.gravity;
    let diverged = false; for (let i = 1; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) > 0.01) { diverged = true; break; }
    // Solo se exige si la copia llega al obstáculo dentro del tiempo simulado.
    const reach = Math.sqrt(2 * Math.max(0, 590 - 150 - size / 2) / g) + 0.2;
    if (!diverged && reach < (scene.frames - 1) / scene.fps) return [fail('choque solo de la copia', 'la copia sobre el obstáculo diverge del original', 'trayectorias iguales', scene.frames - 1)];
    return genericChecks(scene, res, { penTol: 2.5 });
  } };
} };

// 14. Rejilla sistemática: fps × calidad × gravedad × forma × bordes (cada combinación, una escena).
const GRID = []; for (const fps of FPS) for (const quality of QUALITY) for (const g of [200, 980, 4000]) for (const shapeKind of [0, 1, 2, 3, 4]) for (const walls of [0, 1]) GRID.push({ fps, quality, g, shapeKind, walls });
families.rejilla = { count: GRID.length, make(seed) {
  const p = GRID[seed % GRID.length], r = rng(seed + 7), size = 60;
  const shape = [ball(size / 2), box(size, size * 0.6), L.randomShape(rng(seed * 3 + 1), size), { kind: 'stroke', thickness: 6, paths: [{ points: [[-30, -30], [-30, 30], [30, 30], [30, -30]], closed: true }] }, { kind: 'poly', contours: [[[0, -30], [30, 30], [-30, 30]]] }][p.shapeKind];
  const frames = Math.ceil(p.fps * (Math.sqrt(2 * 900 / p.g) + 2));
  const scene = { fps: p.fps, frames, width: 1920, height: 1080, world: { gravity: p.g, floor: true, sides: !!p.walls, ceiling: !!p.walls, quality: p.quality }, bodies: [{ id: 'a', type: 'dynamic', pose: { x: 960, y: 100, a: r.range(0, 90) }, shape, material: { restitution: 0, friction: 0.8 } }] };
  return { scene, check(res) {
    const out = genericChecks(scene, res); if (out.length) return out;
    const f = frameOf(res.bodies.a, frames - 1), e = extent(place(pieces(shape), f[0], f[1], f[2])), gap = 1080 - e.y1;
    if (Math.abs(gap) > 1.5) return [fail('reposo (rejilla)', 'borde a 0 ±1,5 px del suelo', gap.toFixed(2) + ' px', frames - 1)];
    return [];
  } };
} };

// 15. Escenas aleatorias completas: cuerpos de todo tipo, fuerzas, emisores, uniones y animados.
families.aleatorias = { count: 2000, make(seed) {
  const r = rng(seed), fps = r.pick(FPS), quality = r.pick(QUALITY), [W, H] = r.pick(RES.slice(0, 6)), n = r.int(1, 25), frames = r.int(2, 90), bodies = [], forces = [], emitters = [], joints = [];
  const walls = r.chance(0.6), cap = speedCap({ fps, world: { quality } }) * 0.8;
  for (let i = 0; i < n; i++) {
    const type = r.pick(['dynamic', 'dynamic', 'dynamic', 'static', 'kinematic']), size = r.range(2, Math.min(W, H) * 0.2), b = { id: 'r' + i, type, spawn: r.chance(0.2) ? r.int(0, frames - 1) : 0, pose: { x: r.range(0, W), y: r.range(0, H), a: r.range(0, 360) }, shape: L.randomShape(r, size), material: { density: r.range(0.01, 50), friction: r.range(0, 2), restitution: r.range(0, 1) } };
    if (r.chance(0.15)) b.despawn = r.int(b.spawn + 1, frames);
    if (type === 'dynamic' && r.chance(0.5)) { const v = r.range(0, Math.min(5000, cap)), a = r.range(0, 2 * Math.PI); b.velocity = { x: Math.cos(a) * v, y: Math.sin(a) * v, a: r.range(-1000, 1000) }; }
    if (type === 'kinematic') { b.track = []; for (let k = b.spawn; k < (b.despawn || frames); k++) b.track.push([b.pose.x + (k - b.spawn) * r.range(-5, 5), b.pose.y, b.pose.a + k]); }
    bodies.push(b);
  }
  for (let i = 0, nf = r.int(0, 3); i < nf; i++) forces.push({ type: r.pick(['wind', 'attract']), only: r.chance(0.3) ? 'r' + r.int(0, n - 1) : undefined, track: [[r.range(0, W), r.range(0, H), r.range(-180, 180), r.range(-3000, 3000), r.chance(0.5) ? 0 : r.range(20, 800)]] });
  for (let i = 0, ne = r.int(0, 2); i < ne; i++) emitters.push({ id: 'e' + i, max: r.int(0, 60), lifetime: r.chance(0.5) ? 0 : r.range(0.1, 2), seed: r.int(1, 1e6), shape: L.randomShape(r, r.range(2, 20)), track: [[r.range(0, W), r.range(0, H), r.range(-180, 180), r.range(0, 120), r.range(0, Math.min(3000, cap)), r.range(0, 360), r.range(0, 400)]] });
  for (let i = 0, nj = r.int(0, 3); i < nj && n > 1; i++) joints.push({ a: 'r' + r.int(0, n - 1), b: r.chance(0.3) ? null : 'r' + r.int(0, n - 1), type: r.pick(['pivot', 'distance', 'spring']), frequency: r.range(0.2, 5), damping: r.range(0, 1) });
  const scene = { fps, frames, width: W, height: H, world: { gravity: r.chance(0.1) ? 0 : r.range(-500, 5000), gravityAngle: r.range(-180, 180), airDrag: r.chance(0.3) ? r.range(0, 5) : 0, floor: walls, sides: walls, ceiling: walls && r.chance(0.5), quality }, bodies, forces, emitters, joints };
  // Aquí cuerpos aleatorios pueden empezar superpuestos o unidos entre sí: se comprueba estabilidad, no penetración.
  return { scene, check(res) { return genericChecks(scene, res, { noPenetration: true, noContain: true }); } };
} };

module.exports = families;
