#!/usr/bin/env node
'use strict';
/*
 * Batería de escenas del motor de Gravedad.
 *
 *   node tools/battery/run.js                     ejecuta (o retoma) la batería completa por lotes
 *   node tools/battery/run.js --pilot             lote piloto: 10 escenas por familia, sin guardar progreso
 *   node tools/battery/run.js --family F --seed N repite un caso y muestra su detalle
 *   node tools/battery/run.js --reset             borra el progreso guardado
 *   node tools/battery/run.js --summary [archivo] resume el progreso guardado (sin ejecutar)
 *   node tools/battery/run.js --workers 4         número de procesos (por defecto, núcleos)
 *
 * Progreso en qa/battery/state/ (reanudable; se reinicia solo si cambia el motor). Resumen en qa/battery/summary.json
 * y cada fallo en qa/battery/failures/<familia>-<semilla>.json (configuración, semilla, esperado, observado, fotograma
 * y caso reducido).
 */
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..', '..'), OUT = path.join(ROOT, 'qa', 'battery'), STATE = path.join(OUT, 'state'), FAIL = path.join(OUT, 'failures');
const LOT = 100, DETERMINISM_EVERY = 10;

function engineHash() {
  const h = crypto.createHash('sha256');
  for (const f of ['sim.js', 'scene.js', 'planck.min.js']) h.update(fs.readFileSync(path.join(ROOT, 'src', 'engine', f)));
  for (const f of ['lib.js', 'families.js']) h.update(fs.readFileSync(path.join(__dirname, f)));
  return h.digest('hex').slice(0, 16);
}

// ---------- Estrés: escenas grandes o extremas (se cuentan aparte) ----------
function stressScenes() {
  const L = require('./lib.js'), out = [];
  const grid = (n, size, shape, extra) => { const b = []; const cols = Math.ceil(Math.sqrt(n * 1.8)); for (let i = 0; i < n; i++) b.push(Object.assign({ id: 's' + i, type: 'dynamic', pose: { x: 40 + (i % cols) * (size * 1.3), y: 40 + Math.floor(i / cols) * (size * 1.3), a: i * 17 }, shape: shape(i) }, extra || {})); return b; };
  for (const n of [300, 600, 1000]) out.push({ name: n + ' cuerpos', scene: { fps: 30, frames: 150, width: 1920 * 2, height: 1080 * 2, world: { gravity: 980, floor: true, sides: true }, bodies: grid(n, 30, (i) => (i % 3 ? { kind: 'box', w: 26, h: 26 } : { kind: 'circle', r: 13 })) } });
  out.push({ name: '1500 partículas', scene: { fps: 30, frames: 200, width: 1920, height: 1080, world: { gravity: 980, floor: true, sides: true }, emitters: [{ id: 'e', max: 1500, seed: 1, shape: { kind: 'circle', r: 4 }, track: [[960, 100, 90, 400, 600, 90, 1200]] }] } });
  out.push({ name: 'gravedad 100000', scene: { fps: 25, frames: 100, width: 1920, height: 1080, world: { gravity: 100000, floor: true, sides: true, ceiling: true }, bodies: grid(60, 40, (i) => L.randomShape(L.rng(i + 1), 30)) } });
  out.push({ name: 'gravedad negativa -100000', scene: { fps: 25, frames: 100, width: 1920, height: 1080, world: { gravity: -100000, floor: true, sides: true, ceiling: true }, bodies: grid(40, 40, () => ({ kind: 'circle', r: 15 })) } });
  out.push({ name: 'cuerpos de 1 px', scene: { fps: 25, frames: 150, width: 640, height: 360, world: { gravity: 980, floor: true, sides: true }, bodies: grid(200, 4, () => ({ kind: 'box', w: 1, h: 1 })) } });
  out.push({ name: '8K con 200 cuerpos grandes', scene: { fps: 24, frames: 120, width: 7680, height: 4320, world: { gravity: 980, floor: true, sides: true }, bodies: grid(200, 300, (i) => L.randomShape(L.rng(i + 9), 250)) } });
  out.push({ name: '3000 fotogramas', scene: { fps: 60, frames: 3000, width: 1920, height: 1080, world: { gravity: 980, floor: true, sides: true }, bodies: grid(20, 60, () => ({ kind: 'circle', r: 25 }), { material: { restitution: 0.9 } }) } });
  out.push({ name: 'impulsos máximos del panel', scene: { fps: 12, frames: 60, width: 1920, height: 1080, world: { gravity: 0, floor: true, sides: true, ceiling: true, quality: 60 }, bodies: grid(30, 40, () => ({ kind: 'circle', r: 12 }), { velocity: { x: 100000, y: -100000, a: 100000 } }) } });
  out.push({ name: 'densidades 0,001 y 1000 apiladas', scene: { fps: 25, frames: 150, width: 1920, height: 1080, world: { gravity: 980, floor: true, sides: true }, bodies: Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, type: 'dynamic', pose: { x: 960, y: 1060 - i * 41, a: 0 }, shape: { kind: 'box', w: 200, h: 40 }, material: { density: i % 2 ? 1000 : 0.001 } })) } });
  out.push({ name: 'calidad 960 a 12 fps con 400 cuerpos', scene: { fps: 12, frames: 60, width: 1920 * 2, height: 1080 * 2, world: { gravity: 980, floor: true, sides: true, quality: 960 }, bodies: grid(400, 30, () => ({ kind: 'box', w: 24, h: 24 })) } });
  return out;
}

// ---------- Trabajador: ejecuta un lote de una familia ----------
if (!isMainThread) {
  const families = require('./families.js'), Sim = require('../../src/engine/sim.js'), L = require('./lib.js');
  parentPort.on('message', (job) => {
    if (job.stress !== undefined) {
      const s = stressScenes()[job.stress], t = Date.now(); let fails = [];
      try { const res = Sim.run(s.scene); fails = L.genericChecks(s.scene, res, { noPenetration: true, containTol: 4 }); } catch (e) { fails = [{ check: 'excepción', expected: 'sin errores', observed: e.message, frame: null }]; }
      parentPort.postMessage({ stress: job.stress, name: s.name, ms: Date.now() - t, fails });
      return;
    }
    const fam = families[job.family], results = [];
    for (let seed = job.start; seed < job.end; seed++) {
      const t = Date.now(); let made, res, fails, det = null;
      try {
        made = fam.make(seed); res = Sim.run(JSON.parse(JSON.stringify(made.scene))); fails = made.check(res);
        if (seed % DETERMINISM_EVERY === 0) { const again = Sim.run(JSON.parse(JSON.stringify(made.scene))); det = JSON.stringify(again.bodies) === JSON.stringify(res.bodies) && JSON.stringify(again.particles) === JSON.stringify(res.particles); }
      } catch (e) { fails = [{ check: 'excepción', expected: 'sin errores', observed: e.stack.split('\n').slice(0, 3).join(' | '), frame: null }]; }
      results.push({ seed, hash: made ? L.hashScene(made.scene) : null, ms: Date.now() - t, fails, det });
    }
    parentPort.postMessage({ family: job.family, start: job.start, end: job.end, results });
  });
  return;
}

// ---------- Proceso principal ----------
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };
const families = require('./families.js'), L = require('./lib.js'), Sim = require('../../src/engine/sim.js');

// Reduce una escena que falla: quita cuerpos, fuerzas y emisores mientras el fallo (mismo tipo) siga apareciendo.
function reduce(family, seed) {
  const made = families[family].make(seed), check = made.check, base = made.scene, kind = (s) => { try { const f = check(Sim.run(JSON.parse(JSON.stringify(s)))); return f.length ? f[0].check : null; } catch (e) { return 'excepción'; } };
  const target = kind(base); if (!target) return null;
  let scene = JSON.parse(JSON.stringify(base));
  for (const key of ['bodies', 'forces', 'emitters', 'joints']) {
    if (!scene[key]) continue;
    for (let i = scene[key].length - 1; i >= 0; i--) { const trial = JSON.parse(JSON.stringify(scene)); trial[key].splice(i, 1); if (kind(trial) === target) scene = trial; }
  }
  return scene;
}

function single(family, seed) {
  const made = families[family].make(seed), res = Sim.run(JSON.parse(JSON.stringify(made.scene))), fails = made.check(res);
  console.log(JSON.stringify({ family, seed, hash: L.hashScene(made.scene), bodies: (made.scene.bodies || []).length, frames: made.scene.frames, fails }, null, 2));
  if (fails.length) { const small = reduce(family, seed); console.log('caso reducido:', JSON.stringify(small)); }
  process.exitCode = fails.length ? 1 : 0;
}

function loadState(hash) {
  fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(FAIL, { recursive: true });
  const f = path.join(STATE, 'progress.json');
  let st = null; try { st = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  if (!st || st.engine !== hash) st = { engine: hash, started: new Date().toISOString(), lots: {}, stress: {} };
  return st;
}
function saveState(st) { fs.writeFileSync(path.join(STATE, 'progress.json'), JSON.stringify(st)); }

async function battery(pilot) {
  const hash = engineHash(), st = pilot ? { engine: hash, lots: {}, stress: {} } : loadState(hash), workers = +(opt('workers') || os.cpus().length);
  const jobs = [];
  for (const name of Object.keys(families)) {
    const count = pilot ? 10 : families[name].count;
    for (let s = 0; s < count; s += LOT) { const key = name + ':' + s; if (!st.lots[key]) jobs.push({ family: name, start: s, end: Math.min(count, s + LOT), key }); }
  }
  const stressJobs = pilot ? [] : stressScenes().map((_, i) => i).filter((i) => !st.stress[i]).map((i) => ({ stress: i }));
  const queue = jobs.concat(stressJobs), total = queue.length, began = Date.now();
  console.log((pilot ? 'Lote piloto' : 'Batería') + ': ' + total + ' lotes pendientes con ' + workers + ' procesos · motor ' + hash);
  let doneLots = 0;
  await new Promise((resolve) => {
    let active = 0;
    const pool = Array.from({ length: Math.min(workers, queue.length) }, () => new Worker(__filename));
    const feed = (w) => { const job = queue.shift(); if (!job) { w.terminate(); if (--active === 0) resolve(); return; } w.job = job; w.postMessage(job); };
    pool.forEach((w) => {
      active++;
      w.on('message', (m) => {
        if (m.stress !== undefined) st.stress[m.stress] = { name: m.name, ms: m.ms, fails: m.fails };
        else {
          st.lots[w.job.key] = m.results.map((x) => [x.seed, x.hash, x.ms, x.det, x.fails.length ? x.fails : 0]);
          for (const x of m.results) if (x.fails.length && !pilot) fs.writeFileSync(path.join(FAIL, m.family + '-' + x.seed + '.json'), JSON.stringify({ family: m.family, seed: x.seed, engine: hash, fails: x.fails, scene: families[m.family].make(x.seed).scene }, null, 1));
        }
        doneLots++;
        if (!pilot) saveState(st);
        if (doneLots % 10 === 0 || doneLots === total) process.stdout.write('  ' + doneLots + '/' + total + ' lotes · ' + Math.round((Date.now() - began) / 1000) + ' s\n');
        feed(w);
      });
      w.on('error', (e) => { console.error('trabajador:', e.message); feed(w); });
      feed(w);
    });
    if (!pool.length) resolve();
  });
  return summarize(st, pilot);
}

function summarize(st, pilot) {
  const fam = {}, hashes = new Set(), failures = [];
  let det = 0, detFail = 0, scenes = 0, ms = 0;
  for (const key of Object.keys(st.lots)) {
    const name = key.split(':')[0]; fam[name] = fam[name] || { escenas: 0, fallos: 0, determinismo: 0, ms: 0, tipos: {} };
    for (const [seed, hash, t, d, fails] of st.lots[key]) {
      scenes++; ms += t; fam[name].escenas++; fam[name].ms += t; if (hash) hashes.add(hash);
      if (d !== null && d !== undefined) { det++; fam[name].determinismo++; if (!d) { detFail++; failures.push({ family: name, seed, check: 'determinismo' }); } }
      if (fails) { fam[name].fallos++; for (const f of fails) fam[name].tipos[f.check] = (fam[name].tipos[f.check] || 0) + 1; failures.push({ family: name, seed, check: fails[0].check, expected: fails[0].expected, observed: fails[0].observed, frame: fails[0].frame }); }
    }
  }
  const stress = Object.keys(st.stress).map((i) => ({ escena: st.stress[i].name, ms: st.stress[i].ms, fallos: st.stress[i].fails.length ? st.stress[i].fails : 0 }));
  const summary = { motor: st.engine, fecha: new Date().toISOString(), escenasEjecutadas: scenes, escenasDistintas: hashes.size, repeticionesDeterminismo: det, determinismoFallido: detFail, estres: stress.length, segundosCpu: Math.round(ms / 1000), escenasConFallo: failures.filter((f) => f.check !== 'determinismo').length, familias: fam, estresDetalle: stress, fallos: failures.slice(0, 200) };
  if (!pilot) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1)); }
  console.log('\nFamilia              escenas  fallos  determinismo  ms/escena');
  for (const n of Object.keys(fam)) console.log(n.padEnd(20) + String(fam[n].escenas).padStart(8) + String(fam[n].fallos).padStart(8) + String(fam[n].determinismo).padStart(14) + String(Math.round(fam[n].ms / Math.max(1, fam[n].escenas))).padStart(11) + (fam[n].fallos ? '  ' + JSON.stringify(fam[n].tipos) : ''));
  console.log('\nEjecutadas ' + scenes + ' · distintas ' + hashes.size + ' · determinismo ' + det + ' (' + detFail + ' fallidas) · estrés ' + stress.length + ' (' + stress.filter((s) => s.fallos).length + ' con fallo) · con fallo ' + summary.escenasConFallo);
  return summary;
}

(async () => {
  if (opt('reset')) { fs.rmSync(STATE, { recursive: true, force: true }); fs.rmSync(FAIL, { recursive: true, force: true }); console.log('Progreso borrado.'); return; }
  if (opt('family') && opt('seed') !== null) return single(opt('family'), +opt('seed'));
  if (opt('summary')) { const st = JSON.parse(fs.readFileSync(path.join(STATE, 'progress.json'), 'utf8')), s = summarize(st, true); if (opt('summary') !== true) fs.writeFileSync(path.join(OUT, opt('summary')), JSON.stringify(s, null, 1)); return; }
  const s = await battery(!!opt('pilot'));
  process.exitCode = s.escenasConFallo || s.determinismoFallido ? 1 : 0;
})();
