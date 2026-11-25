'use strict';
// El panel real (index.html + app.js + motores) en Chromium, hablando con el After simulado del mock.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const { createHost } = require('./mock-ae.js');
const Raster = require('../src/engine/raster.js');

const SRC = process.env.GRAVEDAD_SRC || path.join(__dirname, '..', 'src');
const SHOTS = process.env.GRAVEDAD_SHOTS;

async function open(h, viewport, slow) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: viewport || { width: 380, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-panel-'));
  await page.exposeFunction('__hostEval', (script) => String(vm.runInContext(script, h.ctx)));
  await page.exposeFunction('__readAlpha', (job) => Raster.traceFile(job.file));
  await page.exposeFunction('__writeText', (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; });
  await page.addInitScript((d) => {
    window.__gravedadTestEnv = { root: '/ext', tempDir: d.dir, slowYield: d.slow, maxFramesPerSlice: d.slow ? 5 : undefined, evalScript: (s) => window.__hostEval(s), readAlpha: (j) => window.__readAlpha(j), writeText: (n, t) => window.__writeText(n, t) };
  }, { dir, slow: slow || 0 });
  await page.goto('file://' + path.join(SRC, 'index.html'));
  return { browser, page, errors };
}
const text = (page, sel) => page.textContent(sel);
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const el = document.querySelector(s); return !!el && new RegExp(r).test(el.textContent); }, [sel, re.source], { timeout: timeout || 10000 });

function scene(opts) {
  opts = opts || {};
  const h = createHost(path.join(SRC, 'host'));
  const c = h.project.items.addComp('Escena', 1280, 720, 1, opts.duration || 3, 25);
  h.project.activeItem = c;
  const add = (name, kind, size, pos) => {
    const l = c.layers.addShape(); l.name = name;
    const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
    v.addProperty(kind).property(kind === ELLIPSE ? 'ADBE Vector Ellipse Size' : 'ADBE Vector Rect Size').setValue(size);
    v.addProperty('ADBE Vector Graphic - Fill');
    l.transform.position.setValue(pos);
    return l;
  };
  return { h, c, add };
}
const ELLIPSE = 'ADBE Vector Shape - Ellipse', RECT = 'ADBE Vector Shape - Rect';
// Colores del medidor en una fila de píxeles.
const meterColors = (page) => page.evaluate(() => {
  const c = document.getElementById('meter'), d = c.getContext('2d').getImageData(0, Math.floor(c.height * 0.6), c.width, 1).data, out = { green: 0, orange: 0, red: 0 };
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; if (g > 170 && r < 150) out.green++; else if (r > 220 && g > 170 && b < 160) out.orange++; else if (r > 200 && g < 150 && b < 130) out.red++; }
  return out;
});

test('panel: flujo completo con clics reales, medidor y desactualizada', { timeout: 60000 }, async () => {
  const { h, c, add } = scene();
  const ball = add('Bola', ELLIPSE, [120, 120], [500, 120]);
  const ramp = add('Rampa', RECT, [700, 40], [640, 520]); ramp.transform.rotation.setValue(12);
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena · 1280×720 · 25 fps · sin cuerpos/);
    assert.strictEqual(await text(page, '#meterStart'), '0');
    assert.strictEqual(await text(page, '#meterEnd'), '74');
    await page.click('#simulate');
    await page.waitForSelector('#status.error');
    assert.match(await text(page, '#status'), /No hay cuerpos/);

    ball.selected = true; await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    assert.ok(await page.evaluate(() => document.getElementById('inspector').open), 'el inspector se abre');
    ball.selected = false; ramp.selected = true; await page.click('#fixed');
    await waitText(page, '#compChip', /1 dinámico · 1 fijo/);

    await page.click('#simulate');
    await waitText(page, '#status', /Simulado en/, 30000);
    assert.ok(ball.transform.position.numKeys > 20);
    assert.ok(ball.transform.position.keys.slice(-1)[0].v[0] > 600, 'rueda por la rampa');
    assert.ok(!(await page.isHidden('#viewer')));
    await waitText(page, '#simState', /Simulada a las .* al día/);
    const after = await meterColors(page);
    assert.ok(after.green > 200, 'medidor verde: ' + JSON.stringify(after));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-simulado.png'), fullPage: true });

    // Clic en el medidor mueve el tiempo de After y la vista previa
    const box = await page.locator('#meter').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.waitForFunction(() => document.getElementById('frameLabel').textContent.startsWith('37'));
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(Math.abs(c.time - 37 / 25) < 1e-6, 'tiempo de After ' + c.time);

    // Cambiar la escena la deja desactualizada (naranja)
    ramp.transform.rotation.setValue(20);
    await page.click('#apple');
    await waitText(page, '#simState', /Desactualizada/);
    const stale = await meterColors(page);
    assert.ok(stale.orange > 40 && stale.green < 20, 'medidor naranja: ' + JSON.stringify(stale));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-desactualizada.png'), fullPage: true });

    await page.click('#clear');
    await waitText(page, '#status', /borrada/);
    assert.strictEqual(ball.transform.position.numKeys, 0);
    await waitText(page, '#simState', /Área de trabajo/);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: inspector con materiales y ajustes del mundo escriben en After', { timeout: 30000 }, async () => {
  const { h, c, add } = scene();
  const a = add('A', RECT, [50, 50], [300, 100]), b = add('B', ELLIPSE, [50, 50], [500, 100]);
  a.selected = true; b.selected = true;
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena/);
    await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    await waitText(page, '#selInfo', /2 cuerpos/);
    await page.click('#materials button:has-text("Pelota")');
    await waitText(page, '#status', /Ajustado en 2 capas/);
    const fx = (l, n) => l.property('ADBE Effect Parade').property('Gravedad · ' + n).property(1).value;
    assert.strictEqual(fx(a, 'Rebote'), 0.88); assert.strictEqual(fx(b, 'Densidad'), 0.4);
    await page.waitForFunction(() => document.querySelector('#materials button[data-index="1"]').getAttribute('aria-pressed') === 'true');
    await page.fill('#selControls input[type=number][data-key="friction"]', '0.15');
    await page.waitForFunction(() => document.querySelector('#materials button[data-index="1"]').getAttribute('aria-pressed') === 'false');
    assert.strictEqual(fx(a, 'Fricción'), 0.15);
    await page.click('#selControls .seg[data-key="type"] button[data-value="fixed"]');
    await waitText(page, '#compChip', /2 fijos/);
    await page.click('#worldPanel summary');
    await page.click('#planets button:has-text("Luna")');
    await waitText(page, '#worldInfo', /Luna/);
    await page.check('[data-world="ceiling"]');
    await waitText(page, '#worldInfo', /techo/);
    await page.click('[data-world-seg="quality"] button[data-value="960"]');
    await page.waitForFunction(() => document.querySelector('[data-world-seg="quality"] button[data-value="960"]').getAttribute('aria-pressed') === 'true');
    const w = c._layers.find((l) => l.comment.indexOf('gravedad:mundo') === 0), wv = (n) => w.property('ADBE Effect Parade').property('Gravedad · ' + n).property(1).value;
    assert.strictEqual(wv('Gravedad'), 160); assert.strictEqual(wv('Techo'), 1); assert.strictEqual(wv('Calidad'), 960);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-ajustes.png'), fullPage: true });
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: cancelar una simulación larga no toca las capas; el medidor avanza y el panel responde', { timeout: 60000 }, async () => {
  const { h, c, add } = scene({ duration: 120 });
  const layers = [];
  for (let i = 0; i < 150; i++) layers.push(add('Caja ' + i, RECT, [30, 30], [60 + (i % 25) * 46, 40 + Math.floor(i / 25) * 45]));
  layers.forEach((l) => { l.selected = true; });
  const { browser, page, errors } = await open(h, null, 40);
  try {
    await waitText(page, '#compChip', /Escena/);
    await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    await page.click('#simulate');
    await waitText(page, '#simState', /Fotograma \d+ de 3000/);
    await waitText(page, '#meterInfo', /quedan/);
    await page.waitForFunction(() => +(/Fotograma (\d+)/.exec(document.getElementById('simState').textContent) || [0, 0])[1] > 200, null, { timeout: 20000 });
    const running = await meterColors(page);
    assert.ok(running.red > 0, 'rojo mientras calcula: ' + JSON.stringify(running));
    // Mayor salto entre fotogramas de pantalla del panel durante 1 s de simulación: debe seguir fluido.
    const jank = await page.evaluate(() => new Promise((res) => { let lastT = performance.now(), max = 0; const end = lastT + 1000; (function f(t) { max = Math.max(max, t - lastT); lastT = t; if (t < end) requestAnimationFrame(f); else res(max); }(lastT)); }));
    assert.ok(jank < 250, 'el panel sigue respondiendo (salto máximo ' + Math.round(jank) + ' ms)');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-simulando.png'), fullPage: true });
    assert.strictEqual(await text(page, '#simLabel'), 'Cancelar');
    await page.click('#simulate');
    try { await waitText(page, '#status', /cancelada/, 20000); } catch (e) { throw Error('estado: ' + await text(page, '#status')); }
    assert.strictEqual(layers[0].transform.position.numKeys, 0, 'sin claves');
    await waitText(page, '#simLabel', /^Simular$/);
    assert.strictEqual(await page.isDisabled('#dynamic'), false);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: errores de After se muestran y los botones vuelven a habilitarse', { timeout: 30000 }, async () => {
  const { h, c } = scene();
  const n = c.layers.addNull(); n.selected = true;
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena/);
    await page.click('#dynamic');
    await page.waitForSelector('#status.error');
    assert.match(await text(page, '#status'), /nulo/);
    assert.strictEqual(await page.isDisabled('#dynamic'), false);
    h.project.activeItem = null;
    await page.click('#apple');
    await waitText(page, '#status', /composici/);
    assert.ok(await page.isHidden('#compChip'));
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: diseño a 260 px de ancho sin desbordes, con todas las secciones abiertas', { timeout: 30000 }, async () => {
  const { h, add } = scene();
  const a = add('A', RECT, [50, 50], [300, 100]); a.selected = true;
  const { browser, page, errors } = await open(h, { width: 260, height: 1700 });
  try {
    await waitText(page, '#compChip', /Escena/);
    await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'desborde horizontal de ' + overflow + ' px');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-estrecho.png'), fullPage: true });
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: unir capas, marcadores y choques en el medidor', { timeout: 30000 }, async () => {
  const { h, add } = scene();
  const bob = add('Bola', ELLIPSE, [60, 60], [500, 200]);
  const box = add('Caja', RECT, [60, 60], [900, 300]);
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena/);
    bob.selected = true;
    await page.selectOption('#jointType', 'spring');
    await page.click('#join');
    await waitText(page, '#status', /Muelle/);
    assert.strictEqual(bob.property('ADBE Effect Parade').property('Gravedad · Unión').property(1).value, 3);
    bob.selected = false; box.selected = true; await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    await page.click('#worldPanel summary');
    await page.check('[data-world="markers"]');
    await waitText(page, '#worldInfo', /marcadores/);
    await page.click('#simulate');
    await waitText(page, '#status', /Simulado en/, 30000);
    assert.ok(box.property('ADBE Marker').numKeys >= 1, 'marcadores de choque');
    const ticks = await page.evaluate(() => { const c = document.getElementById('meter'), d = c.getContext('2d').getImageData(0, 2, c.width, 1).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 230) n++; return n; });
    assert.ok(ticks >= 1, 'marca de choque en el medidor');
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: doble clic en Simular no cancela la simulación', { timeout: 30000 }, async () => {
  const { h, add } = scene();
  const b = add('B', RECT, [40, 40], [400, 100]); b.selected = true;
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena/);
    await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    await page.dblclick('#simulate');
    await waitText(page, '#status', /Simulado en|cancelada/, 20000);
    assert.match(await text(page, '#status'), /Simulado en/);
    assert.ok(b.transform.position.numKeys > 5);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: tres anchos con avisos, cambio de tipo pendiente y secciones abiertas, sin desbordes', { timeout: 60000 }, async () => {
  for (const width of [260, 380, 600]) {
    const { h, c, add } = scene();
    const a = add('Pelota con un nombre bastante largo para probar el ajuste', ELLIPSE, [60, 60], [400, 100]), b = add('B', RECT, [40, 40], [600, 100]);
    a.selected = true; b.selected = true;
    const { browser, page, errors } = await open(h, { width, height: 1800 });
    try {
      await waitText(page, '#compChip', /Escena/);
      await page.click('#dynamic'); await page.waitForSelector('#status.ok');
      await page.click('#simulate'); await waitText(page, '#status', /Simulado en/, 30000);
      b.property('ADBE Effect Parade').property('Gravedad · Tipo').property(1)._value = 2;
      await page.click('#apple');
      await waitText(page, '#simState', /Tipo cambiado en B/);
      await page.evaluate(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 0, width + ' px: desborde de ' + overflow);
      // Ningún texto recortado sin puntos suspensivos en los botones principales
      const clipped = await page.evaluate(() => Array.from(document.querySelectorAll('.cards strong, #simLabel, .small')).filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis').map((e) => e.textContent));
      assert.deepStrictEqual(clipped, [], width + ' px: texto cortado');
      const st = await page.evaluate(() => { const e = document.getElementById('simState'); return e.scrollWidth <= e.clientWidth + 1 && e.textContent; });
      assert.ok(/se aplica al simular o borrar/.test(st), width + ' px: el estado se lee entero');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-' + width + '.png'), fullPage: true });
      assert.deepStrictEqual(errors, []);
    } finally { await browser.close(); }
  }
});
