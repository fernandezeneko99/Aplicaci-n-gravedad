/* Gravedad · panel. Orquesta After (host/gravedad.jsx) y el motor (engine/*.js). */
(function () {
  'use strict';
  var VERSION = '1.0.0';
  var $ = function (id) { return document.getElementById(id); };
  var busy = false, last = null, summary = null, timer = null, playing = false, raf = 0;
  var CONTROLS = ['dynamic', 'fixed', 'force', 'particles', 'simulate', 'clear', 'environment', 'walls', 'join', 'jointType', 'markers'];

  // ---------- Entorno: CEP real o el de las pruebas ----------
  function cepEnv() {
    var cep = window.__adobe_cep__;
    if (!cep) return null;
    var nodeRequire = (window.cep_node && window.cep_node.require) || (typeof window.require === 'function' ? window.require : null);
    var root = decodeURI(cep.getSystemPath('extension')).replace(/^file:\/{2,3}/, '/').replace(/^\/([A-Za-z]:)/, '$1');
    var fs = nodeRequire && nodeRequire('fs'), path = nodeRequire && nodeRequire('path'), os = nodeRequire && nodeRequire('os');
    var Raster = nodeRequire && nodeRequire(path.join(root, 'engine', 'raster.js'));
    var temp = nodeRequire ? path.join(os.tmpdir(), 'Gravedad') : null;
    if (temp && !fs.existsSync(temp)) fs.mkdirSync(temp, { recursive: true });
    return {
      root: root,
      tempDir: temp,
      evalScript: function (script) { return new Promise(function (resolve) { cep.evalScript(script, resolve); }); },
      // After puede terminar de escribir el PNG después de devolver el control: se espera a que el tamaño sea estable.
      readAlpha: function (job) {
        return new Promise(function (resolve, reject) {
          var began = Date.now(), lastSize = -1;
          (function poll() {
            var size = -1;
            try { size = fs.statSync(job.file).size; } catch (e) {}
            if (size > 0 && size === lastSize) {
              try { var contours = Raster.traceFile(job.file); try { fs.unlinkSync(job.file); } catch (e2) {} resolve(contours); } catch (e3) { reject(e3); }
              return;
            }
            lastSize = size;
            if (Date.now() - began > 20000) return reject(Error('After no generó la imagen a tiempo'));
            setTimeout(poll, 120);
          }());
        });
      },
      writeText: function (name, text) { var f = path.join(temp, name); fs.writeFileSync(f, text, 'utf8'); return Promise.resolve(f); }
    };
  }
  var env = window.__gravedadTestEnv || cepEnv();

  // ---------- Comunicación con After ----------
  var loaded = null;
  function ensureHost() {
    if (!loaded) loaded = env.evalScript('typeof Gravedad === "object" ? Gravedad.VERSION : "none"').then(function (v) {
      if (v === VERSION) return;
      var file = env.root + '/host/gravedad.jsx';
      return env.evalScript('try { $.evalFile(new File(' + JSON.stringify(file) + ')); Gravedad.VERSION; } catch (e) { "error: " + e.message; }').then(function (r) {
        if (r !== VERSION) { loaded = null; throw Error('No se pudo cargar el script de Gravedad en After: ' + r); }
      });
    });
    return loaded;
  }
  function call(method, arg) {
    if (!env) return Promise.reject(Error('Abre Gravedad dentro de After Effects (Ventana › Extensiones › Gravedad).'));
    return ensureHost().then(function () {
      return env.evalScript('Gravedad.' + method + '(' + (arg === undefined ? '' : JSON.stringify(JSON.stringify(arg))) + ')');
    }).then(function (raw) {
      var reply;
      try { reply = JSON.parse(raw); } catch (e) { loaded = null; throw Error('After no respondió (' + String(raw).slice(0, 120) + ').'); }
      if (!reply.ok) throw Error(reply.error);
      return reply.data;
    });
  }

  // ---------- Estado en pantalla ----------
  function status(message, kind) { var s = $('status'); s.textContent = message; s.className = kind || ''; saved = null; }
  function warnings(list) {
    var ul = $('warnings'); ul.textContent = '';
    (list || []).slice(0, 8).forEach(function (w) { var li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
    if (list && list.length > 8) { var more = document.createElement('li'); more.textContent = 'y ' + (list.length - 8) + ' avisos más.'; ul.appendChild(more); }
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function render(data) {
    if (!data || !data.comp) return;
    summary = data;
    var w = data.world;
    $('environment').checked = w.gravity === 0;
    $('walls').checked = !!(w.floor || w.sides);
    $('markers').checked = !!w.markers;
    var parts = [];
    if (data.dynamic) parts.push(plural(data.dynamic, 'dinámico', 'dinámicos'));
    if (data.fixed) parts.push(plural(data.fixed, 'fijo', 'fijos'));
    if (data.forces) parts.push(plural(data.forces, 'fuerza', 'fuerzas'));
    if (data.emitters) parts.push(plural(data.emitters, 'emisor', 'emisores'));
    var scene = $('scene'); scene.textContent = '';
    var b = document.createElement('b'); b.textContent = data.comp.name; scene.appendChild(b);
    scene.appendChild(document.createTextNode(' · ' + (parts.length ? parts.join(' · ') : 'sin cuerpos') + ' · ' + data.comp.frames + ' fotogramas'));
    $('simState').textContent = data.simulated || data.particles ? '· simulada' : '';
    $('simulate').classList.toggle('done', !!(data.simulated || data.particles));
    if (!data.simulated && !data.particles) $('progress').style.width = '0';
  }
  function setBusy(on) {
    busy = on; document.body.classList.toggle('busy', on);
    CONTROLS.forEach(function (id) { $(id).disabled = on; });
  }

  async function run(label, fn) {
    if (busy) return;
    setBusy(true); warnings([]);
    try { await fn(); }
    catch (e) { status(e.message, 'error'); }
    finally { setBusy(false); }
  }

  // ---------- Acciones ----------
  function assign(mode) {
    return run(mode, async function () {
      var d = await call('assign', { mode: mode }); render(d);
      status((mode === 'dynamic' ? 'Dinámico' : 'Fijo') + ' · ' + plural(d.assigned, 'capa', 'capas') + '. Ajusta densidad, fricción y rebote en Controles de efectos y pulsa Simular.', 'ok');
    });
  }
  $('dynamic').onclick = function () { assign('dynamic'); };
  $('fixed').onclick = function () { assign('fixed'); };
  $('force').onclick = function (e) {
    var attract = e.altKey;
    run('force', async function () {
      render(await call('force', { type: attract ? 'attract' : 'wind' }));
      status(attract ? 'Atractor creado: atrae a los cuerpos dentro de su círculo. Intensidad negativa = repulsor.' : 'Ventilador creado: gira la flecha para cambiar la dirección; Intensidad y Alcance en Controles de efectos.', 'ok');
    });
  };
  $('particles').onclick = function () {
    run('particles', async function () {
      render(await call('particles'));
      status('Emisor creado: muévelo y gíralo; Ritmo, Máximo, Velocidad y Tamaño en Controles de efectos. Pulsa Simular para generar las partículas.', 'ok');
    });
  };
  $('environment').onchange = function () {
    var space = this.checked;
    run('world', async function () { render(await call('world', { environment: space ? 'space' : 'earth' })); status(space ? 'Espacio · sin gravedad. Las fuerzas siguen activas.' : 'Tierra · gravedad terrestre.', 'ok'); })
      .then(function () { if (summary) render(summary); });
  };
  $('walls').onchange = function () {
    var walls = this.checked;
    run('world', async function () { render(await call('world', { walls: walls })); status(walls ? 'Paredes · el suelo y los lados de la composición contienen los objetos.' : 'Sin paredes · los objetos pueden salir de la composición.', 'ok'); })
      .then(function () { if (summary) render(summary); });
  };
  $('join').onclick = function () {
    var type = $('jointType').value, names = { pivot: 'Pivote', distance: 'Barra rígida', spring: 'Muelle' };
    run('join', async function () {
      var d = await call('join', { type: type }); render(d);
      status(names[type] + (d.joined === 1 ? ': la capa queda colgada de su punto de anclaje.' : ': capas unidas por sus puntos de anclaje.') + ' Cambia el tipo o la rigidez en Controles de efectos.', 'ok');
    });
  };
  $('markers').onchange = function () {
    var on = this.checked;
    run('world', async function () { render(await call('world', { markers: on })); status(on ? 'Marcadores al chocar activados: se escriben al simular.' : 'Marcadores al chocar desactivados.', 'ok'); })
      .then(function () { if (summary) render(summary); });
  };
  $('clear').onclick = function () {
    run('clear', async function () {
      var d = await call('clear'); render(d); last = null; showViewer(false);
      status(d.cleared || d.removed ? 'Simulación borrada: ' + plural(d.cleared, 'capa', 'capas') + ' en su pose de partida' + (d.removed ? ' y ' + plural(d.removed, 'partícula eliminada', 'partículas eliminadas') : '') + '.' : 'No había simulación que borrar.', 'ok');
    });
  };
  $('simulate').onclick = function () {
    run('simulate', async function () {
      var t0 = Date.now();
      $('simulate').classList.remove('done');
      var out = await GravedadPipeline.simulate({
        tempDir: env && env.tempDir,
        call: call,
        readAlpha: function (job) { return env.readAlpha(job); },
        writeText: function (n, t) { return env.writeText(n, t); },
        progress: function (f, msg) { $('progress').style.width = Math.round(f * 100) + '%'; $('simState').textContent = '· ' + Math.round(f * 100) + '%'; status(msg); },
        yield: function () { return new Promise(function (r) { setTimeout(r, 0); }); }
      });
      render(out.summary);
      last = out;
      warnings(out.warnings);
      var s = out.summary, secs = ((Date.now() - t0) / 1000).toFixed(1);
      status('Simulado en ' + secs + ' s · ' + plural(s.written, 'capa animada', 'capas animadas') + (s.created ? ' · ' + plural(s.created, 'partícula', 'partículas') : '') + '. Reproduce la composición; Ctrl+Z lo deshace.', 'ok');
      setupViewer(out);
    });
  };

  // ---------- Vista previa ----------
  function showViewer(on) { $('viewer').hidden = !on; $('preview').setAttribute('aria-pressed', String(on)); if (!on) stop(); }
  $('preview').onclick = function () {
    if (!last) { status('Simula primero para ver la vista previa.'); return; }
    showViewer($('viewer').hidden);
    if (!$('viewer').hidden) draw(+$('frame').value);
  };
  var shapes = null;
  function setupViewer(out) {
    shapes = {};
    out.scene.bodies.forEach(function (b) { shapes[b.id] = { built: GravedadSim.buildPieces(b.shape), type: b.type }; });
    out.scene.emitters.forEach(function (e) { e.shapes.forEach(function (sh, i) { shapes['emisor:' + e.id + ':' + i] = { built: GravedadSim.buildPieces(sh), type: 'particle' }; }); });
    var c = $('canvas'), ratio = out.scene.height / out.scene.width;
    c.width = 640; c.height = Math.max(80, Math.round(640 * ratio));
    $('frame').max = String(out.result.frames - 1); $('frame').value = '0';
    showViewer(true); draw(0);
  }
  var COLORS = { dynamic: '#d3c6f7', static: '#bde6ce', kinematic: '#8fd3b0', particle: '#ffd0e0' };
  function drawShape(ctx, built, x, y, a, scale) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a * Math.PI / 180); ctx.scale(scale, scale);
    ctx.beginPath();
    built.pieces.forEach(function (q) { ctx.moveTo(q[0][0], q[0][1]); for (var i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath(); });
    if (built.circle) { ctx.moveTo(built.circle.x + built.circle.r, built.circle.y); ctx.arc(built.circle.x, built.circle.y, built.circle.r, 0, Math.PI * 2); ctx.moveTo(built.circle.x, built.circle.y); ctx.lineTo(built.circle.x + built.circle.r, built.circle.y); }
    ctx.restore();
  }
  function draw(k) {
    if (!last) return;
    var c = $('canvas'), ctx = c.getContext('2d'), sc = last.scene, s = c.width / sc.width, res = last.result;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.lineWidth = 2 / s; ctx.strokeStyle = '#302735';
    var w = sc.world;
    if (w.floor || w.sides || w.ceiling) {
      ctx.save(); ctx.strokeStyle = '#f5c58a'; ctx.lineWidth = 6 / s; ctx.beginPath();
      if (w.floor) { ctx.moveTo(0, sc.height); ctx.lineTo(sc.width, sc.height); }
      if (w.sides) { ctx.moveTo(0, 0); ctx.lineTo(0, sc.height); ctx.moveTo(sc.width, 0); ctx.lineTo(sc.width, sc.height); }
      if (w.ceiling) { ctx.moveTo(0, 0); ctx.lineTo(sc.width, 0); }
      ctx.stroke(); ctx.restore();
    }
    Object.keys(res.bodies).forEach(function (id) {
      var r = res.bodies[id], i = k - r.from, sh = shapes[id];
      if (!sh || i < 0 || i * 3 >= r.data.length) return;
      ctx.fillStyle = COLORS[sh.type] || COLORS.dynamic;
      drawShape(ctx, sh.built, r.data[i * 3], r.data[i * 3 + 1], r.data[i * 3 + 2], 1); ctx.fill(); ctx.stroke();
    });
    res.particles.forEach(function (p) {
      var i = k - p.from, sh = shapes['emisor:' + p.emitter + ':' + (p.template || 0)];
      if (!sh || i < 0 || i * 3 >= p.data.length) return;
      ctx.fillStyle = COLORS.particle;
      drawShape(ctx, sh.built, p.data[i * 3], p.data[i * 3 + 1], p.data[i * 3 + 2], p.scale); ctx.fill(); ctx.stroke();
    });
    $('frameLabel').textContent = k + ' / ' + (res.frames - 1);
  }
  $('frame').oninput = function () { stop(); draw(+this.value); };
  function stop() { playing = false; cancelAnimationFrame(raf); $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Reproducir'); }
  $('play').onclick = function () {
    if (playing) return stop();
    if (!last) return;
    playing = true; $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pausa');
    var fps = last.scene.fps, start = performance.now(), from = +$('frame').value >= last.result.frames - 1 ? 0 : +$('frame').value;
    (function tick(now) {
      if (!playing) return;
      var k = from + Math.floor((now - start) / 1000 * fps);
      if (k >= last.result.frames) { k = last.result.frames - 1; $('frame').value = String(k); draw(k); return stop(); }
      $('frame').value = String(k); draw(k);
      raf = requestAnimationFrame(tick);
    }(start));
  };

  // ---------- Ayudas al pasar el ratón ----------
  var saved = null;
  Array.prototype.forEach.call(document.querySelectorAll('[data-hint]'), function (el) {
    function show() { var s = $('status'); if (!saved) saved = { text: s.textContent, cls: s.className }; s.textContent = el.getAttribute('data-hint'); s.className = 'hint'; }
    function hide() { var s = $('status'); if (saved && s.className === 'hint') { s.textContent = saved.text; s.className = saved.cls; } saved = null; }
    el.addEventListener('mouseenter', show); el.addEventListener('mouseleave', hide);
    var focusable = el.matches('label') ? el.querySelector('input') : el;
    focusable.addEventListener('focus', show); focusable.addEventListener('blur', hide);
  });
  $('apple').oncontextmenu = function (e) { e.preventDefault(); window.location.reload(); };
  $('apple').onclick = function () { refresh(true); };

  // ---------- Sincronización periódica con la composición activa ----------
  async function refresh(loud) {
    if (busy || !env) return;
    try { var first = !summary, d = await call('inspect'); render(d); if (loud || first || $('status').className === 'error') status(d.dynamic + d.fixed ? 'Listo para simular.' : 'Selecciona capas y pulsa Dinámico o Fijo.'); }
    catch (e) { if (loud || !summary) status(e.message, /composici/.test(e.message) ? '' : 'error'); summary = null; $('scene').textContent = ''; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(async function () { if (!document.hidden) await refresh(false); schedule(); }, 2500); }

  $('version').textContent = VERSION;
  if (!env) status('Abre Gravedad dentro de After Effects (Ventana › Extensiones › Gravedad).', 'error');
  else { refresh(false); schedule(); }
  window.addEventListener('beforeunload', function () { clearTimeout(timer); });
  window.gravedadPanel = { call: call, refresh: refresh };
}());
