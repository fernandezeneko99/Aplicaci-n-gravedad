'use strict';
// Sincronización del panel con After: sondeos ligero/completo, respuestas fuera de orden y clics sobre Simular.
// La prueba controla el orden de las respuestas reteniendo en el navegador las que elige y liberándolas después.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const { chromium } = require('playwright');
const { createHost } = require('./mock-ae.js');
const Raster = require('../src/engine/raster.js');

const SRC = process.env.GRAVEDAD_SRC || path.join(__dirname, '..', 'src');
const ELLIPSE = 'ADBE Vector Shape - Ellipse', RECT = 'ADBE Vector Shape - Rect';

async function open(h) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 380, height: 1100 } });
  const errors = [], calls = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gravedad-sync-'));
  await page.exposeFunction('__hostEval', (script) => { const m = /^Gravedad\.(\w+)\(/.exec(script); if (m) calls.push(m[1]); return String(vm.runInContext(script, h.ctx)); });
  await page.exposeFunction('__readAlpha', (job) => Raster.traceFile(job.file));
  await page.exposeFunction('__writeText', (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; });
  await page.addInitScript((d) => {
    // Retención controlada: si __holdNext coincide con la llamada, la respuesta queda guardada hasta __release().
    window.__held = [];
    window.__gravedadTestEnv = { root: '/ext', tempDir: d, readAlpha: (j) => window.__readAlpha(j), writeText: (n, t) => window.__writeText(n, t),
      evalScript: (s) => window.__hostEval(s).then((r) => {
        if (window.__holdNext && window.__holdNext.test(s)) { window.__holdNext = null; return new Promise((res) => { window.__held.push(() => res(r)); }); }
        return r;
      }) };
    window.__release = () => { const f = window.__held.shift(); if (f) f(); return !!f; };
  }, dir);
  await page.goto('file://' + path.join(SRC, 'index.html'));
  return { browser, page, errors, calls };
}
function comp(h, name) {
  const c = h.project.items.addComp(name, 1280, 720, 1, 3, 25);
  const add = (n, kind, size, pos) => { const l = c.layers.addShape(); l.name = n; const v = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group').property('ADBE Vectors Group'); v.addProperty(kind).property(kind === ELLIPSE ? 'ADBE Vector Ellipse Size' : 'ADBE Vector Rect Size').setValue(size); v.addProperty('ADBE Vector Graphic - Fill'); l.transform.position.setValue(pos); return l; };
  return { c, add };
}
const waitText = (page, sel, re, timeout) => page.waitForFunction(([s, r]) => { const el = document.querySelector(s); return !!el && new RegExp(r).test(el.textContent); }, [sel, re.source], { timeout: timeout || 15000 });
const text = (page, sel) => page.textContent(sel);
async function simulated(page, h, A) {
  const a = A.add('Bola', ELLIPSE, [60, 60], [400, 100]), b = A.add('B', RECT, [40, 40], [700, 100]);
  a.selected = true; b.selected = true;
  await page.click('#dynamic'); await page.waitForSelector('#status.ok');
  await page.click('#simulate'); await waitText(page, '#status', /Simulado en/, 30000);
  a.selected = false; b.selected = false;
  return { a, b };
}

test('sincronía · el sondeo ligero conserva el aviso de tipo pendiente y el aviso desaparece al simular', { timeout: 60000 }, async () => {
  const h = createHost(path.join(SRC, 'host')), A = comp(h, 'Escena A'); h.project.activeItem = A.c;
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena A/);
    const { b } = await simulated(page, h, A);
    b.property('ADBE Effect Parade').property('Gravedad · Tipo').property(1)._value = 2;
    await page.click('#apple'); // sondeo completo
    await waitText(page, '#simState', /Tipo cambiado en B/);
    // Varios sondeos ligeros (cambio de selección) alternados: el aviso se mantiene.
    for (let i = 0; i < 4; i++) { b.selected = !b.selected; await page.waitForTimeout(700); assert.match(await text(page, '#simState'), /Tipo cambiado en B/, 'tras el ligero ' + i); }
    await page.click('#simulate'); await waitText(page, '#status', /Simulado en/, 30000);
    await waitText(page, '#simState', /al día/);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('sincronía · una respuesta tardía de la composición anterior no recupera sus datos ni sus avisos', { timeout: 60000 }, async () => {
  const h = createHost(path.join(SRC, 'host')), A = comp(h, 'Escena A'), B = comp(h, 'Escena B'); h.project.activeItem = A.c;
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena A/);
    const { b } = await simulated(page, h, A);
    b.property('ADBE Effect Parade').property('Gravedad · Tipo').property(1)._value = 2;
    // Se retiene la próxima respuesta completa (de A, con el aviso de tipo pendiente).
    await page.evaluate(() => { window.__holdNext = /Gravedad\.inspect\(.*deep\\":true/; });
    await page.click('#apple');
    await page.waitForFunction(() => window.__held.length === 1);
    // Mientras tanto el usuario cambia a B y el panel la pinta.
    h.project.activeItem = B.c;
    await page.click('#apple');
    await waitText(page, '#compChip', /Escena B/);
    // Llega la respuesta vieja de A.
    await page.evaluate(() => window.__release());
    await page.waitForTimeout(400);
    assert.match(await text(page, '#compChip'), /Escena B/, 'sigue en B');
    assert.doesNotMatch(await text(page, '#simState'), /Tipo cambiado|Desactualizada|Simulada/, 'sin avisos de A');
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('sincronía · una respuesta tardía del área de trabajo anterior no recupera «desactualizada»', { timeout: 60000 }, async () => {
  const h = createHost(path.join(SRC, 'host')), A = comp(h, 'Escena A'); h.project.activeItem = A.c;
  const { browser, page, errors } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena A/);
    await simulated(page, h, A);
    const G = A.c._layers.find((l) => String(l.comment).startsWith('gravedad:mundo')).property('ADBE Effect Parade').property('Gravedad · Gravedad').property(1);
    G._value = 500;                                   // la escena cambia → desactualizada
    await page.evaluate(() => { window.__holdNext = /Gravedad\.inspect\(.*deep\\":true/; });
    await page.click('#apple'); await page.waitForFunction(() => window.__held.length === 1);
    G._value = 980;                                   // y vuelve a como estaba al simular
    await page.click('#apple'); await waitText(page, '#simState', /al día/);
    await page.evaluate(() => window.__release()); await page.waitForTimeout(400);
    assert.match(await text(page, '#simState'), /al día/, 'la respuesta vieja no pinta «desactualizada»');
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});

test('sincronía · un clic en Simular con el puntero quieto inicia una sola simulación y el resultado se ve', { timeout: 60000 }, async () => {
  const h = createHost(path.join(SRC, 'host')), A = comp(h, 'Escena A'); h.project.activeItem = A.c;
  const { browser, page, errors, calls } = await open(h);
  try {
    await waitText(page, '#compChip', /Escena A/);
    const a = A.add('Bola', ELLIPSE, [60, 60], [400, 100]); a.selected = true;
    await page.click('#dynamic'); await page.waitForSelector('#status.ok');
    calls.length = 0;
    await page.hover('#simulate'); await page.click('#simulate');
    await waitText(page, '#status', /Simulado en/, 30000);
    await page.waitForTimeout(800);
    assert.strictEqual(calls.filter((c) => c === 'gather').length, 1, 'una sola lectura de escena');
    assert.strictEqual(calls.filter((c) => c === 'apply').length, 1, 'una sola escritura');
    assert.match(await text(page, '#status'), /Simulado en/);
    // Un error con el puntero quieto encima tampoco queda tapado
    a.remove();
    await page.click('#simulate'); await page.waitForSelector('#status.error');
    await page.waitForTimeout(600);
    assert.match(await text(page, '#status'), /No hay cuerpos/);
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
});
