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

  // F6: dos cuerpos con la misma forma que empiezan en la misma pose (una capa duplicada sin mover) son dos cuerpos,
  // pero sin dirección en la que separarse: caen como uno solo. No se cambia la composición; se avisa con el número de capa.
  function coincident(host, scene) {
    var seen = {}, out = [], byId = {};
    host.bodies.forEach(function (b) { byId[b.id] = b; });
    scene.bodies.forEach(function (b) {
      var src = byId[b.id];
      if (!src || b.type === 'static') return;
      var key = [Math.round(b.pose.x * 2), Math.round(b.pose.y * 2), Math.round((b.pose.a || 0) * 2), b.spawn || 0, JSON.stringify(b.shape, function (k, v) { return typeof v === 'number' ? Math.round(v * 10) / 10 : v; })].join('|');
      if (seen[key]) out.push('«' + seen[key].name + '» (capa ' + seen[key].index + ') y «' + src.name + '» (capa ' + src.index + ') empiezan en el mismo sitio con la misma forma: se moverán como un solo cuerpo. Mueve una de ellas antes de simular.');
      else seen[key] = src;
    });
    return out;
  }

  function describeWarning(w, names) {
    var who = names[w.id] || 'Una capa';
    if (w.code === 'sin-forma') return who + ': su contorno es demasiado pequeño para colisionar; se ignora.';
    if (w.code === 'calidad-subida') return 'Densidades muy distintas (relación ' + Math.round(w.ratio) + ':1): la calidad sube de ' + w.from + ' a ' + w.hz + ' pasos/s para que no se atraviesen. Tarda algo más.';
    if (w.code === 'calidad-paredes') return 'Paredes móviles finas (' + Math.round(w.thickness * 10) / 10 + ' px) y objetos rápidos (' + Math.round(w.speed) + ' px/s): la calidad sube de ' + w.from + ' a ' + w.hz + ' pasos/s para que no las atraviesen.';
    if (w.code === 'masa-limitada') return 'Relación de densidades de ' + Math.round(w.ratio) + ':1: por encima de 1000:1 la física no es estable; se simula como 1000:1.';
    if (w.code === 'union-sin-capa') return who + ': la capa a la que está unida no es un cuerpo; se ignora la unión.';
    if (w.code === 'union-sin-dinamico') return who + ': una unión necesita al menos un cuerpo dinámico.';
    if (w.code === 'contorno-cruzado') return who + ': el trazado se cruza consigo mismo; se usa su contorno convexo.';
    return who + ': ' + w.code;
  }

  function now() { return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(); }

  async function simulate(io) {
    var warnings = [];
    io.progress(0, 'Leyendo la escena…');
    // Capas simuladas cuyo tipo se cambió en Controles de efectos: se asientan antes de leer la escena
    // (Fijo en la pose del instante actual; Desactivado, como estaba antes de simular).
    var norm = await io.call('normalize', {});
    if (norm && norm.settled) warnings.push(norm.settled + (norm.settled === 1 ? ' capa cambiada' : ' capas cambiadas') + ' de tipo en Controles de efectos: Fijo se queda en la pose del instante actual y Desactivado vuelve a como estaba.');
    var host = await io.call('gather', { tempDir: io.tempDir });
    (host.problems || []).forEach(function (p) { warnings.push(p); });
    var names = {};
    host.bodies.forEach(function (b) {
      names[b.id] = b.name;
      if (b.note === 'alfa') warnings.push(b.name + ': no se pudo leer su alfa; colisiona con su caja.');
      if (b.note === 'fuente-ausente') warnings.push(b.name + ': falta su archivo de origen; colisiona con su caja. Vuelve a vincular el metraje y simula de nuevo.');
      if (b.note === 'mascara-contraida') warnings.push(b.name + ': la expansión negativa de máscara no se aplica a la colisión; colisiona con el trazado de la máscara.');
      if (b.note === 'mascaras') warnings.push(b.name + ': solo se usan las máscaras en modo Añadir sin invertir.');
      if (b.note === 'padre-animado') warnings.push(b.name + ': su padre está animado; al simular se quita el padre.');
    });
    (host.emitters || []).forEach(function (e) { e.templates.forEach(function (t) { if (t.note === 'alfa') warnings.push(t.name + ' (partícula): no se pudo leer su alfa; colisiona con su caja.'); }); });
    try {
      if (host.bodies.some(function (b) { return b.raster; }) || (host.emitters || []).some(function (e) { return e.templates.some(function (t) { return t.raster; }); })) io.progress(0.02, 'Detectando contornos…');
      await resolveRasters(host, io, warnings);
    } finally {
      try { await io.call('cleanup', {}); } catch (ignore) {}
    }
    // Protección de memoria: cada cuerpo guarda 3 números por fotograma. Más de ~4 millones de muestras no cabe con soltura.
    var bodiesTotal = host.bodies.length + (host.emitters || []).reduce(function (n, e) { return n + (e.max || 0); }, 0), samples = bodiesTotal * host.frames;
    if (samples > 4e6) throw Error('Escena demasiado grande: ' + bodiesTotal + ' cuerpos × ' + host.frames + ' fotogramas. Acorta el área de trabajo, baja el Máximo de partículas o divide la escena en varias composiciones.');
    if (bodiesTotal > 600) warnings.push(bodiesTotal + ' cuerpos: la simulación y la escritura de claves pueden tardar. El medidor muestra el tiempo restante y puedes cancelar.');
    // Por tramos de tiempo (no de fotogramas): el panel y After siguen respondiendo aunque la escena sea enorme.
    var scene = Scene.build(host);
    coincident(host, scene).forEach(function (w) { warnings.push(w); });
    var run = Sim.create(scene), state, began = now(), budget = io.budget || 25;
    io.progress(0.05, 'Simulando…', { phase: 'simular', frame: 0, frames: scene.frames });
    do {
      if (io.cancelled && io.cancelled()) throw Error('Simulación cancelada. Las capas no se han modificado.');
      var slice = now();
      var count = 0, maxFrames = io.maxFramesPerSlice || Infinity;
      do { state = run.step(1); count++; } while (!state.done && now() - slice < budget && count < maxFrames);
      var elapsed = (now() - began) / 1000, rate = state.frame / Math.max(1e-3, elapsed), eta = (state.frames - state.frame) / Math.max(1e-3, rate);
      io.progress(0.05 + 0.85 * state.frame / state.frames, 'Simulando · fotograma ' + state.frame + ' de ' + state.frames, { phase: 'simular', frame: state.frame, frames: state.frames, fps: rate, eta: eta });
      if (io.yield) await io.yield();
    } while (!state.done);
    var result = run.result();
    result.warnings.forEach(function (w) { warnings.push(describeWarning(w, names)); });
    if (io.cancelled && io.cancelled()) throw Error('Simulación cancelada. Las capas no se han modificado.');
    io.progress(0.92, 'Escribiendo fotogramas clave en After…', { phase: 'escribir' });
    var data = Scene.payload(host, result), file = await io.writeText('resultado-' + host.compId + '.jsx', Scene.script(data));
    var summary = await io.call('apply', { file: file, signature: host.signature });
    (summary.problems || []).forEach(function (p) { warnings.push(p); });
    var stats = { seconds: (now() - began) / 1000, frames: scene.frames, bodies: scene.bodies.length, particles: result.particles.length };
    io.progress(1, 'Listo', { phase: 'listo' });
    return { summary: summary, warnings: warnings, host: host, scene: scene, result: result, stats: stats };
  }

  return { simulate: simulate, resolveRasters: resolveRasters };
}));
