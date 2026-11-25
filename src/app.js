/* Gravedad · panel. Orquesta After (host/gravedad.jsx), el motor (engine/*.js) y el medidor (meter.js). */
(function () {
  'use strict';
  var VERSION = '1.2.1';
  var $ = function (id) { return document.getElementById(id); };
  var all = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var deepInfo = null, busy = false, simulating = false, cancelRequested = false, simStarted = 0, last = null, summary = null, playing = false, raf = 0;
  var CONTROLS = ['dynamic', 'fixed', 'force', 'particles', 'clear', 'environment', 'walls', 'join', 'jointType', 'preview'];
  var MATERIALS = [
    { name: 'Goma', density: 1.1, friction: 0.9, bounce: 0.7 }, { name: 'Pelota', density: 0.4, friction: 0.6, bounce: 0.88 },
    { name: 'Madera', density: 0.7, friction: 0.5, bounce: 0.25 }, { name: 'Metal', density: 7.8, friction: 0.35, bounce: 0.1 },
    { name: 'Piedra', density: 2.5, friction: 0.75, bounce: 0.05 }, { name: 'Hielo', density: 0.9, friction: 0.02, bounce: 0.05 },
    { name: 'Papel', density: 0.2, friction: 0.6, bounce: 0.1 }, { name: 'Gelatina', density: 1, friction: 0.8, bounce: 0.45 }
  ];
  var PLANETS = [{ name: 'Espacio', g: 0 }, { name: 'Luna', g: 160 }, { name: 'Marte', g: 370 }, { name: 'Tierra', g: 980 }, { name: 'Júpiter', g: 2480 }];

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
        if (!Raster) return Promise.reject(Error('Node no está disponible en el panel'));
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
      writeText: function (name, text) { if (!fs) return Promise.reject(Error('Node no está disponible en el panel')); var f = path.join(temp, name); fs.writeFileSync(f, text, 'utf8'); return Promise.resolve(f); }
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
      try { reply = JSON.parse(raw); } catch (e) { loaded = null; throw Error('After no respondió (' + String(raw).slice(0, 120) + '). Si está ocupado renderizando, espera y vuelve a intentarlo.'); }
      if (!reply.ok) throw Error(reply.error);
      return reply.data;
    });
  }

  // ---------- Mensajes ----------
  var saved = null;
  // Un resultado o un error no debe quedar tapado por la ayuda del control sobre el que sigue el puntero.
  var hintHold = { until: 0, el: null };
  function status(message, kind) {
    var s = $('status'); s.textContent = message; s.className = kind || ''; saved = null;
    if (kind === 'ok' || kind === 'error') hintHold = { until: Date.now() + 4000, el: hovered };
  }
  function warnings(list) {
    var ul = $('warnings'); ul.textContent = '';
    (list || []).slice(0, 8).forEach(function (w) { var li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
    if (list && list.length > 8) { var more = document.createElement('li'); more.textContent = 'y ' + (list.length - 8) + ' avisos más.'; ul.appendChild(more); }
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function num(v, d) { return (Math.round(v * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toLocaleString('es-ES'); }
  function secs(s) { return s < 60 ? num(s, s < 10 ? 1 : 0) + ' s' : Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s'; }

  // ---------- Medidor de fotogramas ----------
  var meter = new FrameMeter($('meter'), function (k, final) { seekTo(k, final); });
  var seekPending = null, seeking = false;
  function seekTo(k) {
    if (last && !$('viewer').hidden) { stop(); $('frame').value = String(Math.min(k, last.result.frames - 1)); draw(+$('frame').value); }
    seekPending = k;
    if (seeking) return;
    seeking = true;
    // Solo una petición en vuelo: al arrastrar se envía el último fotograma, no cada uno.
    (function next() {
      var target = seekPending; seekPending = null;
      call('seek', { frame: target }).catch(function () {}).then(function () { if (seekPending !== null) next(); else seeking = false; });
    }());
  }
  function frameOf(time, comp) { return Math.round((time - comp.start) * comp.fps); }

  // ---------- Pintar el estado ----------
  function editing(el) { return document.activeElement === el; }
  function render(data) {
    if (!data || !data.comp) return;
    summary = data;
    var c = data.comp, w = data.world;
    $('environment').checked = w.gravity === 0;
    $('walls').checked = !!(w.floor || w.sides);
    var first = Math.round(c.start * c.fps);
    var counts = [];
    if (data.dynamic) counts.push(plural(data.dynamic, 'dinámico', 'dinámicos'));
    if (data.fixed) counts.push(plural(data.fixed, 'fijo', 'fijos'));
    if (data.forces) counts.push(plural(data.forces, 'fuerza', 'fuerzas'));
    if (data.emitters) counts.push(plural(data.emitters, 'emisor', 'emisores'));
    var chip = $('compChip'); chip.hidden = false; chip.textContent = '';
    var b = document.createElement('b'); b.textContent = c.name; chip.appendChild(b);
    chip.appendChild(document.createTextNode(' · ' + c.width + '×' + c.height + ' · ' + num(c.fps, 2) + ' fps · ' + (counts.length ? counts.join(' · ') : 'sin cuerpos')));
    // Medidor y estado de la simulación: si cambió el área de trabajo o la escena, la simulación está desactualizada.
    // El resumen ligero no calcula «desactualizada» ni los cambios de tipo pendientes: se conserva lo último que dijo el
    // resumen completo de esta misma composición y simulación (antes el aviso parpadeaba hasta el siguiente completo).
    var deepKey = c.id + '|' + (data.sim ? data.sim.sig + '|' + data.sim.date : '-');
    if (data.pendingTypes !== undefined) deepInfo = { key: deepKey, stale: !!(data.sim && data.sim.stale), pending: data.pendingTypes };
    var known = deepInfo && deepInfo.key === deepKey ? deepInfo : null;
    if (data.pendingTypes === undefined) data.pendingTypes = known ? known.pending : [];
    var sim = data.sim, sameRange = sim && sim.frames === c.frames && Math.abs(sim.start - c.start) < 1e-6;
    var stale = !!(sim && ((sim.stale !== undefined ? sim.stale : known && known.stale) || !sameRange));
    if (!simulating) {
      meter.set({ frames: c.frames, first: first, simulated: sim ? Math.min(sim.frames, c.frames) : 0, stale: stale, running: null });
      var pending = data.pendingTypes || [];
      $('simState').textContent = pending.length ? 'Tipo cambiado en ' + pending.join(', ') + ': se aplica al simular o borrar' : !sim ? 'Área de trabajo · ' + plural(c.frames, 'fotograma', 'fotogramas') : stale ? 'Desactualizada: la escena cambió, vuelve a simular' : 'Simulada a las ' + sim.date + ' · al día';
      $('simulate').classList.toggle('done', !!sim && !stale);
      $('simulate').classList.toggle('stale', stale);
      $('meterInfo').textContent = secs(c.duration) + ' · ' + plural(c.frames, 'fotograma', 'fotogramas');
    }
    meter.set({ playhead: frameOf(c.time, c) });
    $('meterStart').textContent = first;
    $('meterEnd').textContent = first + c.frames - 1;
    renderWorld(w);
    renderSelection(data.selection || []);
  }

  function setField(selector, value) {
    all(selector).forEach(function (el) {
      if (editing(el)) return;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = String(Math.round(value * 1000) / 1000);
    });
  }
  function renderWorld(w) {
    ['gravity', 'gravityAngle', 'airDrag', 'floor', 'sides', 'ceiling', 'markers'].forEach(function (k) { setField('[data-world="' + k + '"]', w[k]); });
    all('[data-world-seg="quality"] button').forEach(function (bt) { bt.setAttribute('aria-pressed', String(Math.abs(+bt.dataset.value - w.quality) < 1)); });
    all('#planets button').forEach(function (bt) { bt.setAttribute('aria-pressed', String(Math.abs(+bt.dataset.g - w.gravity) < 1)); });
    var planet = PLANETS.filter(function (p) { return Math.abs(p.g - w.gravity) < 1; })[0], edges = [w.floor && 'suelo', w.sides && 'lados', w.ceiling && 'techo'].filter(Boolean);
    $('worldInfo').textContent = (planet ? planet.name : num(w.gravity) + ' px/s²') + ' · ' + (edges.length ? edges.join(', ') : 'sin bordes') + (w.markers ? ' · marcadores' : '');
  }

  function same(list, key) { var v = list[0][key]; for (var i = 1; i < list.length; i++) if (list[i][key] !== v && !(Math.abs(list[i][key] - v) < 1e-6)) return null; return v; }
  function renderSelection(sel) {
    var bodies = sel.filter(function (s) { return s.body; }), others = sel.length - bodies.length;
    $('selInfo').textContent = !sel.length ? 'ninguna' : bodies.length ? plural(bodies.length, 'cuerpo', 'cuerpos') + (others ? ' · ' + others + ' sin física' : '') : plural(sel.length, 'capa sin física', 'capas sin física');
    $('selControls').hidden = !bodies.length;
    $('selEmpty').hidden = !!bodies.length;
    $('selEmpty').textContent = !sel.length ? 'Selecciona capas con física en la línea de tiempo para ajustarlas aquí. Los cambios se aplican a todas las seleccionadas.' : 'Las capas seleccionadas aún no tienen física: pulsa Dinámico o Fijo.';
    if (!bodies.length) return;
    all('#selControls .seg').forEach(function (seg) {
      var v = same(bodies, seg.dataset.key);
      Array.prototype.forEach.call(seg.children, function (bt) { bt.setAttribute('aria-pressed', String(v !== null && String(v) === bt.dataset.value)); });
    });
    ['density', 'friction', 'bounce', 'impulse', 'impulseAngle', 'spinStart'].forEach(function (k) {
      var v = same(bodies, k);
      all('#selControls [data-key="' + k + '"]').forEach(function (el) { if (!editing(el)) { el.value = v === null ? '' : String(Math.round(v * 1000) / 1000); el.placeholder = v === null ? 'varios' : ''; } });
    });
    all('#materials button').forEach(function (bt) {
      var m = MATERIALS[+bt.dataset.index];
      bt.setAttribute('aria-pressed', String(bodies.every(function (s) { return Math.abs(s.density - m.density) < 1e-6 && Math.abs(s.friction - m.friction) < 1e-6 && Math.abs(s.bounce - m.bounce) < 1e-6; })));
    });
  }

  function setBusy(on) {
    busy = on; document.body.classList.toggle('busy', on);
    CONTROLS.forEach(function (id) { $(id).disabled = on; });
    all('.panel-section input, .panel-section button').forEach(function (el) { el.disabled = on && simulating; });
  }

  async function run(fn) {
    if (busy) return;
    setBusy(true); warnings([]);
    try { await fn(); }
    catch (e) { status(e.message, /cancelada/.test(e.message) ? '' : 'error'); }
    finally { setBusy(false); }
  }

  // ---------- Acciones ----------
  function assign(mode) {
    return run(async function () {
      var d = await call('assign', { mode: mode }); render(d);
      status((mode === 'dynamic' ? 'Dinámico' : 'Fijo') + ' · ' + plural(d.assigned, 'capa', 'capas') + '. Ajusta el material en «Capas seleccionadas» y pulsa Simular.', 'ok');
      $('inspector').open = true;
    });
  }
  $('dynamic').onclick = function () { assign('dynamic'); };
  $('fixed').onclick = function () { assign('fixed'); };
  $('force').onclick = function (e) {
    var attract = e.altKey;
    run(async function () {
      render(await call('force', { type: attract ? 'attract' : 'wind' }));
      status(attract ? 'Atractor creado: atrae a los cuerpos dentro de su círculo. Intensidad negativa = repulsor.' : 'Ventilador creado: gira la flecha para orientarlo; Intensidad y Alcance (0 = toda la composición) en Controles de efectos.', 'ok');
    });
  };
  $('particles').onclick = function () {
    run(async function () {
      var d = await call('particles'); render(d);
      if (d.addedTemplates !== undefined) { status(d.addedTemplates ? plural(d.addedTemplates, 'forma añadida', 'formas añadidas') + ' al emisor: cada partícula elige una al azar.' : 'Esas capas ya eran formas de este emisor.', 'ok'); return; }
      status('Emisor creado: muévelo y gíralo. Ritmo, Máximo, Velocidad, Vida, Tamaño y Desvanecer en Controles de efectos. Pulsa Simular para generar las partículas.', 'ok');
    });
  };
  $('join').onclick = function () {
    var type = $('jointType').value, names = { pivot: 'Pivote', distance: 'Barra rígida', spring: 'Muelle' };
    run(async function () {
      var d = await call('join', { type: type }); render(d);
      status(names[type] + (d.joined === 1 ? ': la capa queda colgada de su punto de anclaje.' : ': capas unidas por sus puntos de anclaje.') + ' Rigidez y amortiguación en Controles de efectos.', 'ok');
    });
  };
  function worldChange(patch, message) {
    return run(async function () { render(await call('world', patch)); if (message) status(message, 'ok'); }).then(function () { if (summary) render(summary); });
  }
  $('environment').onchange = function () { worldChange({ environment: this.checked ? 'space' : 'earth' }, this.checked ? 'Espacio · sin gravedad. Las fuerzas siguen activas.' : 'Gravedad restaurada.'); };
  $('walls').onchange = function () { worldChange({ walls: this.checked }, this.checked ? 'Paredes · el suelo y los lados de la composición contienen los objetos.' : 'Sin paredes · los objetos pueden salir de la composición.'); };
  $('clear').onclick = function () {
    run(async function () {
      var d = await call('clear'); render(d); last = null; showViewer(false); meter.set({ contacts: [] });
      if (d.legacy && d.legacy.length) warnings(['Sin datos para distinguir sus claves de las tuyas (versión anterior, capa duplicada o nulo de mundo borrado); no se han tocado: ' + d.legacy.join(', ') + '. Usa Ctrl/Cmd+Z o bórralas a mano.']);
      status(d.cleared || d.removed ? 'Simulación borrada: ' + plural(d.cleared, 'capa', 'capas') + ' en su pose de partida' + (d.removed ? ' y ' + plural(d.removed, 'partícula eliminada', 'partículas eliminadas') : '') + '.' : 'No había simulación que borrar.', 'ok');
    });
  };

  var SIM_HINT = 'Calcula la física en el área de trabajo y la escribe como fotogramas clave de Posición y Rotación. Ctrl/Cmd+Z la deshace.';
  $('simulate').onclick = function () {
    // Un doble clic en Simular no debe cancelar la simulación que acaba de empezar.
    if (simulating) { if (Date.now() - simStarted > 500) { cancelRequested = true; $('simLabel').textContent = 'Cancelando…'; } return; }
    if (busy) return;
    simulating = true; cancelRequested = false; simStarted = Date.now();
    $('simulate').classList.add('running'); $('simulate').classList.remove('done', 'stale');
    $('simLabel').textContent = 'Cancelar'; $('simulate').setAttribute('data-hint', 'Detiene el cálculo sin tocar las capas.');
    meter.set({ running: 0, contacts: [] });
    run(async function () {
      var out = await GravedadPipeline.simulate({
        tempDir: env && env.tempDir,
        call: call,
        readAlpha: function (job) { return env.readAlpha(job); },
        writeText: function (n, t) { return env.writeText(n, t); },
        cancelled: function () { return cancelRequested; },
        maxFramesPerSlice: env.maxFramesPerSlice,
        progress: function (f, msg, info) {
          info = info || {};
          if (info.phase === 'simular') {
            meter.set({ running: info.frame });
            $('simState').textContent = 'Fotograma ' + info.frame + ' de ' + info.frames + (info.fps ? ' · ' + num(info.fps) + ' fps' : '');
            $('meterInfo').textContent = info.eta !== undefined && info.frame < info.frames ? 'quedan ' + secs(info.eta) : '';
            status(msg + (info.fps ? ' · ' + num(info.fps) + ' fotogramas/s' : ''));
          } else { $('simState').textContent = msg; status(msg); }
        },
        yield: function () { return new Promise(function (r) { setTimeout(r, env.slowYield || 0); }); }
      });
      last = out;
      var contacts = []; Object.keys(out.result.contacts || {}).forEach(function (id) { contacts = contacts.concat(out.result.contacts[id]); });
      warnings(out.warnings);
      var s = out.summary, st = out.stats;
      simulating = false;
      render(s);
      meter.set({ contacts: out.scene.world.markers ? contacts : [] });
      status('Simulado en ' + secs(st.seconds) + ' (' + num(st.frames / Math.max(0.001, st.seconds)) + ' fps) · ' + plural(s.written, 'capa animada', 'capas animadas') + (s.created ? ' · ' + plural(s.created, 'partícula', 'partículas') : '') + (s.keys ? ' · ' + num(s.keys) + ' claves' : '') + '. Reproduce la composición; Ctrl/Cmd+Z lo deshace.', 'ok');
      setupViewer(out);
    }).then(function () {
      simulating = false; cancelRequested = false;
      $('simulate').classList.remove('running'); $('simLabel').textContent = 'Simular';
      $('simulate').setAttribute('data-hint', SIM_HINT);
      meter.set({ running: null });
      return refresh(false, true);
    });
  };

  // ---------- Inspector de capas seleccionadas ----------
  var pendingBodies = {}, bodiesTimer = 0;
  function pushBodies(values, now) {
    for (var k in values) if (Object.prototype.hasOwnProperty.call(values, k)) pendingBodies[k] = values[k];
    clearTimeout(bodiesTimer);
    bodiesTimer = setTimeout(function () {
      var v = pendingBodies; pendingBodies = {};
      call('bodies', { values: v }).then(function (d) { render(d); status('Ajustado en ' + plural(d.changed, 'capa', 'capas') + '. Vuelve a simular para ver el cambio.', 'ok'); }).catch(function (e) { status(e.message, 'error'); });
    }, now ? 0 : 280);
  }
  MATERIALS.forEach(function (m, i) {
    var bt = document.createElement('button'); bt.type = 'button'; bt.textContent = m.name; bt.dataset.index = String(i);
    bt.setAttribute('data-hint', m.name + ': densidad ' + num(m.density, 2) + ' · fricción ' + num(m.friction, 2) + ' · rebote ' + num(m.bounce, 2));
    bt.onclick = function () { pushBodies({ density: m.density, friction: m.friction, bounce: m.bounce }, true); };
    $('materials').appendChild(bt);
  });
  all('#selControls .seg').forEach(function (seg) {
    Array.prototype.forEach.call(seg.children, function (bt) {
      bt.type = 'button';
      bt.onclick = function () { var v = {}; v[seg.dataset.key] = seg.dataset.key === 'shape' ? +bt.dataset.value : bt.dataset.value; pushBodies(v, true); };
    });
  });
  all('#selControls input[data-key]').forEach(function (el) {
    el.addEventListener('input', function () {
      var v = parseFloat(el.value); if (!isFinite(v)) return;
      all('#selControls [data-key="' + el.dataset.key + '"]').forEach(function (o) { if (o !== el) o.value = el.value; });
      var patch = {}; patch[el.dataset.key] = v; pushBodies(patch);
    });
  });

  // ---------- Ajustes del mundo ----------
  var pendingWorld = {}, worldTimer = 0;
  function pushWorld(values, now) {
    for (var k in values) if (Object.prototype.hasOwnProperty.call(values, k)) pendingWorld[k] = values[k];
    clearTimeout(worldTimer);
    worldTimer = setTimeout(function () {
      var v = pendingWorld; pendingWorld = {};
      call('world', v).then(function (d) { render(d); }).catch(function (e) { status(e.message, 'error'); });
    }, now ? 0 : 280);
  }
  PLANETS.forEach(function (p) {
    var bt = document.createElement('button'); bt.type = 'button'; bt.textContent = p.name; bt.dataset.g = String(p.g);
    bt.setAttribute('data-hint', p.name + ': ' + p.g + ' px/s² (100 px ≈ 1 m)');
    bt.onclick = function () { pushWorld({ gravity: p.g }, true); };
    $('planets').appendChild(bt);
  });
  all('[data-world]').forEach(function (el) {
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
      var patch = {}, key = el.dataset.world;
      if (el.type === 'checkbox') patch[key] = el.checked;
      else { var v = parseFloat(el.value); if (!isFinite(v)) return; patch[key] = v; all('[data-world="' + key + '"]').forEach(function (o) { if (o !== el) o.value = el.value; }); }
      pushWorld(patch, el.type === 'checkbox');
    });
  });
  all('[data-world-seg="quality"] button').forEach(function (bt) { bt.type = 'button'; bt.onclick = function () { pushWorld({ quality: +bt.dataset.value }, true); }; });

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
  $('frame').oninput = function () { stop(); draw(+this.value); meter.set({ playhead: +this.value }); };
  function stop() { playing = false; cancelAnimationFrame(raf); $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Reproducir'); }
  $('play').onclick = function () {
    if (playing) return stop();
    if (!last) return;
    playing = true; $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pausa');
    var fps = last.scene.fps, start = performance.now(), from = +$('frame').value >= last.result.frames - 1 ? 0 : +$('frame').value;
    (function tick(t) {
      if (!playing) return;
      var k = from + Math.floor((t - start) / 1000 * fps);
      if (k >= last.result.frames) { k = last.result.frames - 1; $('frame').value = String(k); draw(k); return stop(); }
      $('frame').value = String(k); draw(k); meter.set({ playhead: k });
      raf = requestAnimationFrame(tick);
    }(start));
  };

  // ---------- Ayudas al pasar el ratón ----------
  var hovered = null;
  document.addEventListener('mouseover', function (e) {
    var el = e.target.closest && e.target.closest('[data-hint]'), s = $('status');
    // Mientras se muestra un resultado reciente, la ayuda solo aparece si el puntero entra en otro control.
    if (el && el === hintHold.el && Date.now() < hintHold.until) return;
    hovered = el;
    if (!el) { if (saved && s.className === 'hint') { s.textContent = saved.text; s.className = saved.cls; } saved = null; return; }
    if (!saved) saved = { text: s.textContent, cls: s.className };
    s.textContent = el.getAttribute('data-hint'); s.className = 'hint';
  });
  $('apple').oncontextmenu = function (e) { e.preventDefault(); window.location.reload(); };
  $('apple').onclick = function () { refresh(true, true); };
  // Las secciones recuerdan si estaban abiertas.
  all('details[id]').forEach(function (d) {
    var key = 'gravedad:' + d.id;
    try { var v = localStorage.getItem(key); if (v !== null) d.open = v === '1'; } catch (e) {}
    d.addEventListener('toggle', function () { try { localStorage.setItem(key, d.open ? '1' : '0'); } catch (e) {} });
  });

  // ---------- Sincronización con After ----------
  // Latido barato cada medio segundo (tiempo actual y selección). El resumen completo solo cuando algo cambia, y la
  // comprobación de "desactualizada" cada pocos segundos, más espaciada cuanto más tarda en la escena actual.
  var lastTick = '', lastDeep = 0, deepEvery = 4000, ticking = false, noComp = false;
  async function refresh(loud, deep) {
    if (!env || (busy && !simulating && !loud)) return;
    var t0 = Date.now();
    try {
      var first = !summary, d = await call('inspect', { deep: !!deep });
      if (deep) { lastDeep = Date.now(); deepEvery = Math.min(20000, Math.max(4000, (Date.now() - t0) * 25)); }
      render(d);
      // Solo se sustituye el mensaje al empezar, al pedirlo o si el anterior era «abre una composición».
      if (loud || first || noComp) status(!(d.dynamic + d.fixed + d.emitters) ? 'Selecciona capas y pulsa Dinámico o Fijo.' : d.sim && d.sim.stale ? 'La escena cambió desde la última simulación: pulsa Simular para actualizarla.' : d.sim ? 'Simulación al día.' : 'Listo para simular.');
      noComp = false;
    } catch (e) {
      noComp = /composici/.test(e.message);
      if (loud || summary || !$('status').className) status(e.message, noComp ? '' : 'error');
      summary = null; $('compChip').hidden = true; meter.set({ frames: 0 });
    }
  }
  async function heartbeat() {
    if (ticking || busy || document.hidden || !env) return;
    ticking = true;
    try {
      var t = await call('tick');
      var key = t ? [t.comp, t.layers, t.sel, t.start, t.duration].join('|') : 'none';
      var deep = Date.now() - lastDeep > deepEvery;
      if (key !== lastTick || deep) { lastTick = key; await refresh(false, deep); }
      else if (t && summary && summary.comp.id === t.comp) meter.set({ playhead: frameOf(t.time, summary.comp) });
    } catch (e) {} finally { ticking = false; }
  }

  $('version').textContent = VERSION;
  if (!env) status('Abre Gravedad dentro de After Effects (Ventana › Extensiones › Gravedad).', 'error');
  else { refresh(false, true); setInterval(heartbeat, 500); }
  window.gravedadPanel = { call: call, refresh: refresh, meter: meter };
}());
