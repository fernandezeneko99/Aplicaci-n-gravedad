'use strict';
/*
 * Batería de escenas · utilidades comunes: aleatorio reproducible, geometría de comprobación (contornos visibles,
 * penetración entre convexos por separación de ejes) y comprobaciones genéricas que se aplican a toda escena.
 */
const Sim = require('../../src/engine/sim.js');

function rng(seed) {
  // Cada semilla da una secuencia distinta (antes 0 y 1 coincidían).
  let a = (Math.imul((seed >>> 0) + 0x9E3779B9, 2654435761) ^ 0x5bd1e995) >>> 0 || 1;
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p
  };
}

const FPS = [12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
const QUALITY = [60, 120, 240, 480, 960];
const RES = [[64, 64], [640, 360], [1280, 720], [1920, 1080], [1080, 1920], [3840, 2160], [7680, 4320]];
const PPM = Sim.PPM;
const MAX_TRANSLATION_PX = Sim.planckSettings().maxTranslation * PPM; // límite por subpaso del motor

function substeps(scene) { const q = Math.max(60, Math.min(960, (scene.world && scene.world.quality) || 240)); return Math.max(1, Math.ceil(q / scene.fps)); }
function speedCap(scene) { return MAX_TRANSLATION_PX * substeps(scene) * scene.fps; }

// ---------- Formas ----------
function randomShape(r, size) {
  const kind = r.pick(['circle', 'box', 'box', 'poly', 'star', 'ring', 'stroke']);
  if (kind === 'circle') return { kind: 'circle', r: size / 2 };
  if (kind === 'box') return { kind: 'box', w: size, h: size * r.range(0.2, 1.5) };
  if (kind === 'poly') { const n = r.int(3, 9), pts = []; for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI, rr = size / 2 * r.range(0.55, 1); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); } return { kind: 'poly', contours: [pts] }; }
  if (kind === 'star') { const n = r.int(4, 8), pts = []; for (let i = 0; i < n * 2; i++) { const a = i / (n * 2) * 2 * Math.PI, rr = (i % 2 ? 0.45 : 1) * size / 2; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); } return { kind: 'poly', contours: [pts] }; }
  const ring = []; const seg = 24; for (let i = 0; i < seg; i++) { const a = i / seg * 2 * Math.PI; ring.push([Math.cos(a) * size / 2, Math.sin(a) * size / 2]); }
  if (kind === 'ring') return { kind: 'stroke', thickness: Math.max(2, size * r.range(0.05, 0.2)), paths: [{ points: ring, closed: true }] };
  return { kind: 'stroke', thickness: Math.max(2, size * r.range(0.05, 0.2)), paths: [{ points: [[-size / 2, -size / 2], [-size / 2, size / 2], [size / 2, size / 2], [size / 2, -size / 2]], closed: false }] };
}

// Piezas convexas visibles (sin la piel de Box2D) en coordenadas de cuerpo.
const pieceCache = new WeakMap();
function pieces(shape) {
  if (pieceCache.has(shape)) return pieceCache.get(shape);
  const b = Sim.buildPieces(shape), out = b.pieces.map((q) => ({ poly: q }));
  if (b.circle) out.push({ circle: b.circle });
  pieceCache.set(shape, out);
  return out;
}
function place(ps, x, y, deg, scale) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = scale || 1;
  return ps.map((p) => p.circle ? { circle: { x: x + (c * p.circle.x - s * p.circle.y) * k, y: y + (s * p.circle.x + c * p.circle.y) * k, r: p.circle.r * k } } : { poly: p.poly.map((v) => [x + (c * v[0] - s * v[1]) * k, y + (s * v[0] + c * v[1]) * k]) });
}
function extent(ps) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) {
    if (p.circle) { x0 = Math.min(x0, p.circle.x - p.circle.r); x1 = Math.max(x1, p.circle.x + p.circle.r); y0 = Math.min(y0, p.circle.y - p.circle.r); y1 = Math.max(y1, p.circle.y + p.circle.r); }
    else for (const v of p.poly) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
  }
  return { x0, y0, x1, y1 };
}
// Penetración entre dos piezas convexas (0 si no se tocan): mínimo solape en los ejes de separación.
function axesOf(p) { if (p.circle) return []; const ax = []; for (let i = 0; i < p.poly.length; i++) { const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l > 1e-9) ax.push([-dy / l, dx / l]); } return ax; }
function project(p, ax) { if (p.circle) { const d = p.circle.x * ax[0] + p.circle.y * ax[1]; return [d - p.circle.r, d + p.circle.r]; } let lo = Infinity, hi = -Infinity; for (const v of p.poly) { const d = v[0] * ax[0] + v[1] * ax[1]; if (d < lo) lo = d; if (d > hi) hi = d; } return [lo, hi]; }
function penetration(a, b) {
  if (a.circle && b.circle) return Math.max(0, a.circle.r + b.circle.r - Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y));
  let axes = axesOf(a).concat(axesOf(b));
  const circ = a.circle ? a : b.circle ? b : null, poly = a.circle ? b : a;
  if (circ) { let best = null, bd = Infinity; for (const v of poly.poly) { const d = Math.hypot(v[0] - circ.circle.x, v[1] - circ.circle.y); if (d < bd) { bd = d; best = v; } } if (bd > 1e-9) axes.push([(best[0] - circ.circle.x) / bd, (best[1] - circ.circle.y) / bd]); }
  let min = Infinity;
  for (const ax of axes) { const pa = project(a, ax), pb = project(b, ax), o = Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]); if (o <= 0) return 0; if (o < min) min = o; }
  return min === Infinity ? 0 : min;
}
function bodyPenetration(A, B) { let m = 0; for (const a of A) for (const b of B) { const p = penetration(a, b); if (p > m) m = p; } return m; }
function minThickness(ps) { const e = extent(ps); return Math.min(e.x1 - e.x0, e.y1 - e.y0); }

// ---------- Acceso al resultado ----------
function frameOf(rec, k) { const i = k - rec.from; if (i < 0 || i * 3 >= rec.data.length) return null; return [rec.data[i * 3], rec.data[i * 3 + 1], rec.data[i * 3 + 2]]; }
function lastFrame(rec) { const n = rec.data.length / 3; return n - 1 + rec.from; }

// ---------- Comprobaciones genéricas ----------
// Devuelven { ok:false, check, expected, observed, frame } en el primer incumplimiento.
// El limitador de velocidad del motor (B7) solo debe actuar con uniones imposibles; en otra escena es un falso positivo.
function limiterCheck(scene, res) {
  const w = (res.warnings || []).find((x) => x.code === 'velocidad-limitada');
  if (!w || (scene.joints || []).length) return [];
  return [{ check: 'limitador sin uniones', expected: 'sin recortes de velocidad en una escena sin uniones', observed: w.id + ' (+' + w.others + ') a ' + Math.round(w.limit) + ' px/s', frame: null }];
}
function genericChecks(scene, res, opts) {
  opts = opts || {};
  const frames = scene.frames, fails = [];
  const recs = Object.keys(res.bodies).map((id) => ({ id, rec: res.bodies[id] })).concat(res.particles.map((p, i) => ({ id: 'p' + i, rec: p })));
  // 1. Valores finitos
  for (const { id, rec } of recs) for (let i = 0; i < rec.data.length; i++) if (!Number.isFinite(rec.data[i])) return [{ check: 'finitos', expected: 'valores finitos', observed: id + ' NaN/Infinity', frame: rec.from + Math.floor(i / 3) }];
  // 2. Longitud de trayectorias
  for (const b of scene.bodies || []) {
    const rec = res.bodies[b.id]; if (!rec) continue;
    const spawn = b.spawn || 0, end = b.despawn === null || b.despawn === undefined ? frames : Math.min(frames, b.despawn);
    if (rec.from !== spawn || rec.data.length !== (end - spawn) * 3) fails.push({ check: 'longitud', expected: (end - spawn) + ' fotogramas desde ' + spawn, observed: rec.data.length / 3 + ' desde ' + rec.from, frame: rec.from });
  }
  // 3. Sin saltos: el desplazamiento por fotograma no supera el máximo que Box2D permite (+ margen).
  const cap = speedCap(scene) / scene.fps * 1.05 + 1;
  for (const { id, rec } of recs) for (let i = 1; i < rec.data.length / 3; i++) {
    const d = Math.hypot(rec.data[i * 3] - rec.data[i * 3 - 3], rec.data[i * 3 + 1] - rec.data[i * 3 - 2]);
    if (d > cap) { fails.push({ check: 'salto', expected: '≤ ' + cap.toFixed(1) + ' px/fotograma', observed: id + ' ' + d.toFixed(1), frame: rec.from + i }); break; }
  }
  // 4. Contención: con suelo, lados y techo nada sale de la composición.
  const w = scene.world || {};
  if (w.floor && w.sides && w.ceiling && !opts.noContain) {
    const tol = opts.containTol || 2;
    for (const b of scene.bodies || []) {
      if (b.type !== 'dynamic') continue;
      const rec = res.bodies[b.id]; if (!rec) continue;
      const ps = pieces(b.shape);
      for (let k = rec.from; k <= lastFrame(rec); k += Math.max(1, Math.floor(frames / 12))) {
        const f = frameOf(rec, k), e = extent(place(ps, f[0], f[1], f[2]));
        const out = Math.max(-e.x0, -e.y0, e.x1 - scene.width, e.y1 - scene.height);
        if (out > tol + 0.02 * minThickness(ps)) { fails.push({ check: 'contención', expected: 'dentro de la composición (±' + tol + ' px)', observed: b.id + ' sale ' + out.toFixed(2) + ' px', frame: k }); break; }
      }
    }
  }
  // 5. Penetración entre cuerpos (en el último fotograma y a mitad).
  if (!opts.noPenetration && (scene.bodies || []).length <= 60) {
    const tolAbs = opts.penTol || 2;
    const list = (scene.bodies || []).filter((b) => res.bodies[b.id]);
    for (const k of [Math.floor(frames / 2), frames - 1]) {
      const placed = list.map((b) => { const f = frameOf(res.bodies[b.id], k); return f ? { b, ps: place(pieces(b.shape), f[0], f[1], f[2]), thin: minThickness(pieces(b.shape)) } : null; }).filter(Boolean);
      for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
        const A = placed[i], B = placed[j];
        if (A.b.type !== 'dynamic' && B.b.type !== 'dynamic') continue;
        if (opts.skipPair && opts.skipPair(A.b, B.b)) continue;
        const ea = extent(A.ps), eb = extent(B.ps);
        if (ea.x1 < eb.x0 || eb.x1 < ea.x0 || ea.y1 < eb.y0 || eb.y1 < ea.y0) continue;
        const pen = bodyPenetration(A.ps, B.ps), tol = tolAbs + 0.03 * Math.min(A.thin, B.thin);
        if (pen > tol) { fails.push({ check: 'penetración', expected: '≤ ' + tol.toFixed(2) + ' px', observed: A.b.id + '↔' + B.b.id + ' ' + pen.toFixed(2) + ' px', frame: k }); return fails; }
      }
    }
  }
  return fails;
}

function hashScene(scene) { const t = JSON.stringify(scene); let h1 = 2166136261, h2 = 5381; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0; } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36); }

module.exports = { limiterCheck, rng, FPS, QUALITY, RES, PPM, substeps, speedCap, randomShape, pieces, place, extent, penetration, bodyPenetration, minThickness, frameOf, lastFrame, genericChecks, hashScene };
