'use strict';
// El panel real (index.html + app.js + motores) en Chromium, hablando con el After simulado del mock.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const { createHost, Shape } = require('./mock-ae.js');
const Raster = require('../src/engine/raster.js');

const SRC = process.env.GRAVEDAD_SRC || path.join(__dirname, '..', 'src');
const SHOTS = process.env.GRAVEDAD_SHOTS;

async function open(h, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: viewport || { width: 380, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-panel-'));
  await page.exposeFunction('__hostEval', (script) => String(vm.runInContext(script, h.ctx)));
  await page.exposeFunction('__readAlpha', (job) => Raster.traceFile(job.file));
  await page.exposeFunction('__writeText', (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; });
  await page.addInitScript((d) => {
    window.__gravedadTestEnv = { root: '/ext', tempDir: d, evalScript: (s) => window.__hostEval(s), readAlpha: (j) => window.__readAlpha(j), writeText: (n, t) => window.__writeText(n, t) };
  }, dir);
  await page.goto('file://' + path.join(SRC, 'index.html'));
  return { browser, page, errors };
}

function scene() {
  const h = createHost(path.join(SRC, 'host'));
  const c = h.project.items.addComp('Escena', 1280, 720, 1, 3, 25);
  h.project.activeItem = c;
  const add = (name, kind, size, pos) => {
    const l = c.layers.addShape(); l.name = name;
    const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group');
    v.addProperty(kind).property(kind === 'ADBE Vector Shape - Ellipse' ? 'ADBE Vector Ellipse Size' : 'ADBE Vector Rect Size').setValue(size);
    v.addProperty('ADBE Vector Graphic - Fill');
    l.transform.position.setValue(pos);
    return l;
  };
  return { h, c, add };
}

test('panel: flujo completo con clics reales', { timeout: 60000 }, async () => {
  const { h, c, add } = scene();
  const ball = add('Bola', 'ADBE Vector Shape - Ellipse', [120, 120], [500, 120]);
  const ramp = add('Rampa', 'ADBE Vector Shape - Rect', [700, 40], [640, 520]); ramp.transform.rotation.setValue(12);
  const { browser, page, errors } = await open(h);
  try {
    await page.waitForFunction(() => document.getElementById('scene').textContent.includes('Escena'));
    assert.match(await page.textContent('#scene'), /sin cuerpos/);
    // Simular sin cuerpos: mensaje útil
    await page.click('#simulate');
    await page.waitForSelector('#status.error');
    assert.match(await page.textContent('#status'), /No hay cuerpos/);

    ball.selected = true; await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    ball.selected = false; ramp.selected = true; await page.click('#fixed');
    await page.waitForFunction(() => /1 fijo/.test(document.getElementById('scene').textContent));
    assert.match(await page.textContent('#scene'), /1 dinámico · 1 fijo · 75 fotogramas/);

    await page.click('#simulate');
    await page.waitForFunction(() => /Simulado en/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    assert.strictEqual(ball.transform.position.numKeys, 75);
    assert.ok(!(await page.isHidden('#viewer')), 'la vista previa aparece');
    assert.match(await page.textContent('#simState'), /simulada/);
    // La bola rueda rampa abajo (hacia la derecha) y cae
    const end = ball.transform.position.keys[74].v;
    assert.ok(end[0] > 600, 'rueda por la rampa: ' + end);
    // Vista previa: el deslizador recorre los fotogramas y dibuja
    await page.fill('#frame', '40');
    await page.dispatchEvent('#frame', 'input');
    assert.strictEqual(await page.textContent('#frameLabel'), '40 / 74');
    const painted = await page.evaluate(() => { const c = document.getElementById('canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
    assert.ok(painted > 1000, 'el lienzo tiene dibujo: ' + painted);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-simulado.png'), fullPage: true });

    // Espacio y paredes cambian el mundo en After
    await page.click('label:has(#environment)');
    await page.waitForFunction(() => /Espacio/.test(document.getElementById('status').textContent));
    assert.strictEqual(c._layers.find((l) => l.comment === 'gravedad:mundo').property('ADBE Effect Parade').property('Gravedad · Gravedad').property(1).value, 0);
    await page.click('label:has(#walls)');
    await page.waitForFunction(() => /Sin paredes/.test(document.getElementById('status').textContent));

    // Borrar
    await page.click('#clear');
    await page.waitForFunction(() => /borrada/.test(document.getElementById('status').textContent));
    assert.strictEqual(ball.transform.position.numKeys, 0);
    assert.ok(await page.isHidden('#viewer'));

    // Fuerza y partículas desde el panel
    await page.click('#force'); await page.waitForFunction(() => /Ventilador/.test(document.getElementById('status').textContent));
    await page.click('#particles'); await page.waitForFunction(() => /Emisor creado/.test(document.getElementById('status').textContent));
    assert.match(await page.textContent('#scene'), /1 fuerza · 1 emisor/);
    await page.click('#simulate');
    await page.waitForFunction(() => /Simulado en/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    assert.match(await page.textContent('#status'), /partículas/);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-particulas.png'), fullPage: true });
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: errores de After se muestran y los botones vuelven a habilitarse', { timeout: 30000 }, async () => {
  const { h, c, add } = scene();
  const n = c.layers.addNull(); n.selected = true;
  const { browser, page, errors } = await open(h);
  try {
    await page.waitForFunction(() => document.getElementById('scene').textContent.includes('Escena'));
    await page.click('#dynamic');
    await page.waitForSelector('#status.error');
    assert.match(await page.textContent('#status'), /nulo/);
    assert.strictEqual(await page.isDisabled('#dynamic'), false);
    // Sin composición activa
    h.project.activeItem = null;
    await page.click('#apple');
    await page.waitForFunction(() => /composici/.test(document.getElementById('status').textContent));
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: diseño a 260 px de ancho sin desbordes', { timeout: 30000 }, async () => {
  const { h } = scene();
  const { browser, page, errors } = await open(h, { width: 260, height: 700 });
  try {
    await page.waitForFunction(() => document.getElementById('scene').textContent.includes('Escena'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, 'desborde horizontal de ' + overflow + ' px');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-estrecho.png'), fullPage: true });
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('panel: unir capas y marcadores al chocar', { timeout: 30000 }, async () => {
  const { h, c, add } = scene();
  const bob = add('Bola', 'ADBE Vector Shape - Ellipse', [60, 60], [500, 200]);
  const { browser, page, errors } = await open(h);
  try {
    await page.waitForFunction(() => document.getElementById('scene').textContent.includes('Escena'));
    bob.selected = true;
    await page.selectOption('#jointType', 'spring');
    await page.click('#join');
    await page.waitForFunction(() => /Muelle/.test(document.getElementById('status').textContent));
    assert.strictEqual(bob.property('ADBE Effect Parade').property('Gravedad · Unión').property(1).value, 3);
    await page.click('label:has(#markers)');
    await page.waitForFunction(() => /Marcadores al chocar activados/.test(document.getElementById('status').textContent));
    assert.strictEqual(await page.isChecked('#markers'), true);
    await page.click('#simulate');
    await page.waitForFunction(() => /Simulado en/.test(document.getElementById('status').textContent), null, { timeout: 30000 });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'panel-uniones.png'), fullPage: true });
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});
