/*
 * Gravedad · flujo completo de una simulación, independiente de CEP para poder probarlo en Node.
 * io: { call(method, arg) → Promise<data>, readAlpha(job) → Promise<contours>, writeText(name, text) → Promise<path>,
 *       tempDir, progress(fraction, message), yield() → Promise }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'), require('./scene.js'));
  else root.GravedadPipeline = factory(root.GravedadSim, root.GravedadScene);
}(typeof self !== 'undefined' ? self : this, function (Sim, Scene) {
  'use strict';

  // Resuelve los renders de alfa: cada cuerpo con raster pasa a tener layerShape. Un fallo cae a la caja de la capa.
  async function resolveRasters(host, io, warnings) {
    var items = host.bodies.slice(), cache = {};
    (host.emitters || []).forEach(function (e) { items = items.concat(e.templates); });
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.layerShape || !it.raster) continue;
      var key = it.raster.file;
      try {
        if (!cache[key]) cache[key] = io.readAlpha(it.raster);
        var contours = await cache[key];
        it.layerShape = Scene.rasterToLayer(contours, it.raster);
      } catch (e) {
        warnings.push((it.name || 'Capa') + ': no se pudo leer el alfa (' + e.message + '); se usa su caja.');
        it.layerShape = it.fallback || null;
        if (!it.layerShape) throw Error((it.name || 'Capa') + ': no se pudo leer su contorno. ' + e.message);
      }
    }
  }

  function describeWarning(w, names) {
    var who = names[w.id] || 'Una capa';
    if (w.code === 'sin-forma') return who + ': su contorno es demasiado pequeño para colisionar; se ignora.';
    if (w.code === 'union-sin-capa') return who + ': la capa a la que está unida no es un cuerpo; se ignora la unión.';
    if (w.code === 'union-sin-dinamico') return who + ': una unión necesita al menos un cuerpo dinámico.';
    if (w.code === 'contorno-cruzado') return who + ': el trazado se cruza consigo mismo; se usa su contorno convexo.';
    return who + ': ' + w.code;
  }

  async function simulate(io) {
    var warnings = [];
    io.progress(0, 'Leyendo la escena…');
    var host = await io.call('gather', { tempDir: io.tempDir });
    (host.problems || []).forEach(function (p) { warnings.push(p); });
    var names = {};
    host.bodies.forEach(function (b) {
      names[b.id] = b.name;
      if (b.note === 'alfa') warnings.push(b.name + ': no se pudo leer su alfa; colisiona con su caja.');
      if (b.note === 'mascaras') warnings.push(b.name + ': solo se usan las máscaras en modo Añadir sin invertir.');
      if (b.note === 'padre-animado') warnings.push(b.name + ': su padre está animado; al simular se quita el padre.');
    });
    try {
      if (host.bodies.some(function (b) { return b.raster; }) || (host.emitters || []).some(function (e) { return e.raster; })) io.progress(0.02, 'Detectando contornos…');
      await resolveRasters(host, io, warnings);
    } finally {
      try { await io.call('cleanup', {}); } catch (ignore) {}
    }
    var scene = Scene.build(host), run = Sim.create(scene), state, load = scene.bodies.length + scene.emitters.reduce(function (n, e) { return n + (e.max || 0); }, 0) + 1, chunk = Math.max(1, Math.round(4000 / load));
    do {
      state = run.step(chunk);
      io.progress(0.05 + 0.85 * state.frame / state.frames, 'Simulando · fotograma ' + state.frame + ' de ' + state.frames);
      if (io.yield) await io.yield();
    } while (!state.done);
    var result = run.result();
    result.warnings.forEach(function (w) { warnings.push(describeWarning(w, names)); });
    io.progress(0.92, 'Escribiendo fotogramas clave…');
    var data = Scene.payload(host, result), file = await io.writeText('resultado-' + host.compId + '.jsx', Scene.script(data));
    var summary = await io.call('apply', { file: file });
    (summary.problems || []).forEach(function (p) { warnings.push(p); });
    io.progress(1, 'Listo');
    return { summary: summary, warnings: warnings, host: host, scene: scene, result: result };
  }

  return { simulate: simulate, resolveRasters: resolveRasters };
}));
