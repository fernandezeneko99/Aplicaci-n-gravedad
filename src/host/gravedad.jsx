/*
 * Gravedad - lado After Effects (ExtendScript ES3).
 * Lee la escena, crea los controles nativos y escribe la simulacion como fotogramas clave.
 * La fisica se calcula en el panel (engine/sim.js); aqui no hay ningun plugin compilado.
 */
if (typeof JSON === 'undefined') $.evalFile(new File(new File($.fileName).parent.fsName + '/json2.js'));
$.evalFile(new File(new File($.fileName).parent.fsName + '/geometry.jsx'));

var Gravedad = (function () {
  var VERSION = '1.1.1';
  var TAG = { world: 'gravedad:mundo', force: 'gravedad:fuerza', emitter: 'gravedad:emisor', particle: 'gravedad:particula:', sample: 'gravedad-forma de ejemplo' };
  var N = {
    type: 'Gravedad \u00b7 Tipo', shape: 'Gravedad \u00b7 Forma', density: 'Gravedad \u00b7 Densidad', friction: 'Gravedad \u00b7 Fricci\u00f3n', bounce: 'Gravedad \u00b7 Rebote',
    gravity: 'Gravedad \u00b7 Gravedad', angle: 'Gravedad \u00b7 Direcci\u00f3n', floor: 'Gravedad \u00b7 Suelo', sides: 'Gravedad \u00b7 Lados', ceiling: 'Gravedad \u00b7 Techo', drag: 'Gravedad \u00b7 Resistencia del aire', quality: 'Gravedad \u00b7 Calidad',
    forceType: 'Gravedad \u00b7 Tipo de fuerza', strength: 'Gravedad \u00b7 Intensidad', range: 'Gravedad \u00b7 Alcance',
    template: 'Gravedad \u00b7 Capa de part\u00edcula', rate: 'Gravedad \u00b7 Ritmo', max: 'Gravedad \u00b7 M\u00e1ximo', speed: 'Gravedad \u00b7 Velocidad', spread: 'Gravedad \u00b7 Dispersi\u00f3n', width: 'Gravedad \u00b7 Anchura', life: 'Gravedad \u00b7 Vida', size: 'Gravedad \u00b7 Tama\u00f1o', sizeVar: 'Gravedad \u00b7 Variaci\u00f3n de tama\u00f1o', spin: 'Gravedad \u00b7 Giro', seed: 'Gravedad \u00b7 Semilla', fade: 'Gravedad \u00b7 Desvanecer',
    impulse: 'Gravedad \u00b7 Impulso', impulseAngle: 'Gravedad \u00b7 Direcci\u00f3n del impulso', spinStart: 'Gravedad \u00b7 Giro inicial',
    joint: 'Gravedad \u00b7 Uni\u00f3n', jointTo: 'Gravedad \u00b7 Unida a', stiffness: 'Gravedad \u00b7 Rigidez del muelle', damping: 'Gravedad \u00b7 Amortiguaci\u00f3n',
    markers: 'Gravedad \u00b7 Marcadores al chocar'
  };
  var MAX_TEMPLATES = 8, JOINTS = ['pivot', 'distance', 'spring'];
  var NAMES = { world: 'Gravedad \u00b7 Mundo', force: 'Gravedad \u00b7 Fuerza', emitter: 'Gravedad \u00b7 Emisor', particleShape: 'Forma de part\u00edcula', temp: 'Gravedad \u00b7 temporal' };
  var TYPE = { dynamic: 1, fixed: 2, off: 3 };
  var tempItems = [];

  // ---------- Utilidades ----------
  function wrap(fn, raw) {
    var quiet = false;
    try { app.beginSuppressDialogs(); quiet = true; } catch (ignore) {}
    try { var arg = raw ? JSON.parse(raw) : {}; return JSON.stringify({ ok: true, data: fn(arg) }); }
    catch (e) { return JSON.stringify({ ok: false, error: String(e.message || e), line: e.line }); }
    finally { if (quiet) try { app.endSuppressDialogs(false); } catch (ignore2) {} }
  }
  // After no permite modificar una capa bloqueada: se desbloquea solo mientras se escribe y se vuelve a bloquear.
  function unlocked(l, fn) { var was = false; try { was = l.locked; } catch (e) {} if (was) l.locked = false; try { return fn(); } finally { if (was) try { l.locked = true; } catch (e2) {} } }
  function undo(name, fn) { app.beginUndoGroup(name); try { return fn(); } finally { app.endUndoGroup(); } }
  function comp(passive) {
    var c = app.project && app.project.activeItem;
    if (!(c instanceof CompItem) && !passive && app.activeViewer && app.activeViewer.type === ViewerType.VIEWER_COMPOSITION) { app.activeViewer.setActive(); c = app.project.activeItem; }
    if (!(c instanceof CompItem)) throw Error('Abre una composici\u00f3n.');
    return c;
  }
  function parade(layer) { try { return layer.property('ADBE Effect Parade'); } catch (e) { return null; } }
  function control(layer, name) {
    var fx = parade(layer);
    if (!fx) return null;
    for (var i = 1; i <= fx.numProperties; i++) if (fx.property(i).name === name) return fx.property(i);
    return null;
  }
  function read(layer, name, fallback, t) {
    var fx = control(layer, name);
    if (!fx || !fx.enabled) return fallback;
    var p = fx.property(1);
    try { return t === undefined ? p.value : p.valueAtTime(t, false); } catch (e) { return fallback; }
  }
  function addControl(layer, match, name, value) {
    var fx = control(layer, name);
    if (fx) return fx;
    fx = parade(layer).addProperty(match);
    if (!fx) throw Error('No se pudo crear el control ' + name + '.');
    fx.name = name;
    fx = control(layer, name);
    if (value !== undefined) fx.property(1).setValue(value);
    return fx;
  }
  // Menu desplegable nativo; si After no permite cambiar sus opciones se usa un deslizador con el mismo numero.
  function addMenu(layer, name, items, value) {
    var fx = control(layer, name);
    if (fx) return fx;
    var effects = parade(layer), created = null;
    try {
      created = effects.addProperty('ADBE Dropdown Control');
      var index = created.propertyIndex;
      created.property(1).setPropertyParameters(items);
      created = effects.property(index);
      created.name = name;
      control(layer, name).property(1).setValue(value);
    } catch (e) {
      // Se borra solo el desplegable recien creado (el ultimo de la lista), nunca uno del usuario.
      try { var last = effects.property(effects.numProperties); if (last && last.matchName === 'ADBE Dropdown Control' && last.name !== name) last.remove(); } catch (ignore) {}
      addControl(layer, 'ADBE Slider Control', name, value);
    }
    return control(layer, name);
  }
  function isTagged(layer, tag) { try { return String(layer.comment).indexOf(tag) === 0; } catch (e) { return false; } }
  function find(c, tag) { for (var i = 1; i <= c.numLayers; i++) if (isTagged(c.layer(i), tag)) return c.layer(i); return null; }
  function findAll(c, tag) { var out = []; for (var i = 1; i <= c.numLayers; i++) if (isTagged(c.layer(i), tag)) out.push(c.layer(i)); return out; }
  function isBody(layer) { return !!control(layer, N.type) && !isTagged(layer, TAG.particle); }
  function bodyType(layer) { var v = Math.round(read(layer, N.type, TYPE.off)); return v === TYPE.dynamic ? 'dynamic' : v === TYPE.fixed ? 'fixed' : 'off'; }
  function select(c, layers) { for (var i = 1; i <= c.numLayers; i++) c.layer(i).selected = false; for (var j = 0; j < layers.length; j++) layers[j].selected = true; }
  function frameTime(c, k) { return c.workAreaStart + k / c.frameRate; }
  function frameCount(c) { return Math.max(1, Math.round(c.workAreaDuration * c.frameRate)); }
  function transformProp(layer, name) { return layer.property('ADBE Transform Group').property(name); }
  function animatedProp(p) { return !!p && (p.numKeys > 0 || (p.canSetExpression && p.expressionEnabled && p.expression !== '')); }

  // ---------- Transformaciones 2D ----------
  function position(layer, t) {
    var p = transformProp(layer, 'ADBE Position');
    if (p.dimensionsSeparated) return [transformProp(layer, 'ADBE Position_0').valueAtTime(t, false), transformProp(layer, 'ADBE Position_1').valueAtTime(t, false)];
    var v = p.valueAtTime(t, false); return [v[0], v[1]];
  }
  function localMatrix(layer, t) {
    var a = transformProp(layer, 'ADBE Anchor Point').valueAtTime(t, false), p = position(layer, t), s = transformProp(layer, 'ADBE Scale').valueAtTime(t, false), r = transformProp(layer, 'ADBE Rotate Z').valueAtTime(t, false) * Math.PI / 180;
    var c = Math.cos(r), sn = Math.sin(r), sx = s[0] / 100, sy = s[1] / 100;
    return [c * sx, sn * sx, -sn * sy, c * sy, p[0] - (c * sx * a[0] - sn * sy * a[1]), p[1] - (sn * sx * a[0] + c * sy * a[1])];
  }
  function worldMatrix(layer, t) {
    var m = localMatrix(layer, t), guard = 0, l = layer;
    while (l.parent && guard++ < 50) { l = l.parent; m = GravedadGeometry.mul(localMatrix(l, t), m); }
    return m;
  }
  function animated(layer) {
    var l = layer, guard = 0;
    while (l && guard++ < 50) {
      var names = ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Rotate Z', 'ADBE Position_0', 'ADBE Position_1'];
      for (var i = 0; i < names.length; i++) { var p = null; try { p = transformProp(l, names[i]); } catch (e) { p = null; } if (animatedProp(p)) return true; }
      l = l.parent;
    }
    return false;
  }
  // Pose = punto de anclaje en la composicion y angulo del eje X de la capa (grados, continuo).
  function pose(layer, t, previous) {
    var m = worldMatrix(layer, t), a = transformProp(layer, 'ADBE Anchor Point').valueAtTime(t, false), o = GravedadGeometry.point(m, [a[0], a[1]]);
    var ang = Math.atan2(m[1], m[0]) * 180 / Math.PI;
    if (previous !== undefined) { while (ang - previous > 180) ang -= 360; while (ang - previous < -180) ang += 360; }
    return { x: o[0], y: o[1], a: ang, m: m };
  }
  function rotationGuess(layer, t) { var r = 0, l = layer, guard = 0; while (l && guard++ < 50) { r += transformProp(l, 'ADBE Rotate Z').valueAtTime(t, false); l = l.parent; } return r; }
  function round(v) { return Math.round(v * 1000) / 1000; }
  function round2(v) { return Math.round(v * 100) / 100; }

  // ---------- Mundo ----------
  function worldSettings(c) {
    var w = find(c, TAG.world);
    if (!w) return { exists: false, gravity: 980, gravityAngle: 0, floor: true, sides: true, ceiling: false, airDrag: 0, quality: 240, markers: false };
    return { exists: true, gravity: read(w, N.gravity, 980), gravityAngle: read(w, N.angle, 0), floor: !!read(w, N.floor, 1), sides: !!read(w, N.sides, 1), ceiling: !!read(w, N.ceiling, 0), airDrag: Math.max(0, read(w, N.drag, 0)), quality: Math.max(60, Math.min(960, read(w, N.quality, 240))), markers: !!read(w, N.markers, 0) };
  }
  function ensureWorld(c) {
    var w = find(c, TAG.world);
    if (w) return w;
    w = c.layers.addNull(c.duration);
    w.name = NAMES.world; w.comment = TAG.world; w.guideLayer = true;
    addControl(w, 'ADBE Slider Control', N.gravity, 980);
    addControl(w, 'ADBE Angle Control', N.angle, 0);
    addControl(w, 'ADBE Checkbox Control', N.floor, 1);
    addControl(w, 'ADBE Checkbox Control', N.sides, 1);
    addControl(w, 'ADBE Checkbox Control', N.ceiling, 0);
    addControl(w, 'ADBE Slider Control', N.drag, 0);
    addControl(w, 'ADBE Slider Control', N.quality, 240);
    addControl(w, 'ADBE Checkbox Control', N.markers, 0);
    w.moveToEnd();
    return w;
  }

  // ---------- Huella de la escena ----------
  // Resume todo lo que la simulacion lee (poses de partida, contornos aproximados, controles, mundo y area de trabajo).
  // Se compara con la guardada al simular para avisar de que la simulacion esta desactualizada.
  function hashText(text) { var h1 = 5381, h2 = 52711; for (var i = 0; i < text.length; i++) { var ch = text.charCodeAt(i); h1 = ((h1 * 33) ^ ch) % 4294967296; h2 = ((h2 * 31) + ch) % 4294967296; } return h1.toString(36) + h2.toString(36); }
  function effectValues(l, out) {
    var fx = parade(l);
    if (!fx) return;
    for (var i = 1; i <= fx.numProperties; i++) {
      var e = fx.property(i);
      if (e.name.indexOf('Gravedad') !== 0) continue;
      var p = e.property(1);
      out.push(e.name, e.enabled, p.numKeys);
      try {
        // Un control de capa guarda un indice que cambia al insertar capas: se usa el id de la capa a la que apunta.
        if (e.matchName === 'ADBE Layer Control') { var ix = Math.round(p.value), cc = l.containingComp; out.push(ix >= 1 && ix <= cc.numLayers ? 'id' + cc.layer(ix).id : 0); }
        else out.push(p.numKeys ? p.valueAtTime(c0start, false) + ',' + p.valueAtTime(c0end, false) : p.value);
      } catch (ignore) {}
    }
  }
  var c0start = 0, c0end = 0;
  function signature(c) {
    var parts = [VERSION, c.workAreaStart, c.workAreaDuration, c.frameRate, c.width, c.height], i, k;
    c0start = c.workAreaStart; c0end = c.workAreaStart + c.workAreaDuration;
    for (i = 1; i <= c.numLayers; i++) {
      var l = c.layer(i);
      if (isTagged(l, TAG.particle)) continue;
      var world = isTagged(l, TAG.world), guideLayer = isTagged(l, TAG.force) || isTagged(l, TAG.emitter), body = !world && !guideLayer && !!control(l, N.type);
      if (!world && !guideLayer && !body) continue;
      parts.push(l.id, l.enabled);
      effectValues(l, parts);
      if (world) continue;
      parts.push(round(l.inPoint), round(l.outPoint));
      var t = Math.max(c.workAreaStart, l.inPoint), q = pose(l, t, rotationGuess(l, t));
      parts.push(Math.round(q.x * 100), Math.round(q.y * 100), Math.round(q.a * 100), Math.round(q.m[0] * 1e4), Math.round(q.m[1] * 1e4), Math.round(q.m[2] * 1e4), Math.round(q.m[3] * 1e4));
      if (body) { try { var r = l.sourceRectAtTime(t, false); parts.push(round(r.left), round(r.top), round(r.width), round(r.height)); } catch (e) {} }
      // Lo que se mueve por su cuenta (fijos animados, fuerzas, emisores) se muestrea a lo largo del area de trabajo.
      if ((guideLayer || (body && bodyType(l) === 'fixed')) && animated(l)) {
        for (k = 1; k <= 8; k++) { var tk = c.workAreaStart + c.workAreaDuration * k / 8, s = pose(l, tk); parts.push(Math.round(s.x * 10), Math.round(s.y * 10), Math.round(s.a * 10)); }
      }
    }
    return hashText(parts.join('|'));
  }
  // Datos de la ultima simulacion guardados en el comentario del nulo de mundo.
  function simInfo(c) {
    var w = find(c, TAG.world), out = {};
    if (!w) return null;
    var parts = String(w.comment).split(';');
    for (var i = 1; i < parts.length; i++) { var kv = parts[i].split('='); if (kv.length === 2) out[kv[0]] = kv[1]; }
    return out.sig ? { sig: out.sig, frames: +out.frames, start: +out.start, fps: +out.fps, date: out.date || '' } : null;
  }
  function selectionInfo(c) {
    var sel = c.selectedLayers, out = [];
    for (var i = 0; i < sel.length && i < 40; i++) {
      var l = sel[i], item = { id: String(l.id), name: l.name, body: isBody(l), role: isTagged(l, TAG.world) ? 'world' : isTagged(l, TAG.force) ? 'force' : isTagged(l, TAG.emitter) ? 'emitter' : isTagged(l, TAG.particle) ? 'particle' : 'layer' };
      if (item.body) {
        item.type = bodyType(l); item.shape = Math.round(read(l, N.shape, 1));
        item.density = read(l, N.density, 1); item.friction = read(l, N.friction, 0.4); item.bounce = read(l, N.bounce, 0.2);
        item.impulse = read(l, N.impulse, 0); item.impulseAngle = read(l, N.impulseAngle, 0); item.spinStart = read(l, N.spinStart, 0);
        item.joint = control(l, N.joint) ? Math.round(read(l, N.joint, 4)) : 0;
      }
      out.push(item);
    }
    return out;
  }

  // ---------- Resumen para el panel ----------
  function summary(c, deep) {
    var out = { version: VERSION, comp: { id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, start: c.workAreaStart, duration: c.workAreaDuration, frames: frameCount(c), time: c.time }, world: worldSettings(c), dynamic: 0, fixed: 0, off: 0, forces: 0, emitters: 0, particles: 0, simulated: 0, selected: c.selectedLayers.length, selection: selectionInfo(c) };
    var info = simInfo(c);
    if (info) { out.sim = info; if (deep) out.sim.stale = info.sig !== signature(c); }
    if (deep) { var pend = pendingSettles(c, readStore(c)), names = []; for (var pi = 0; pi < pend.length && pi < 5; pi++) if (pend[pi].layer) names.push(pend[pi].layer.name); out.pendingTypes = names; }
    for (var i = 1; i <= c.numLayers; i++) {
      var l = c.layer(i);
      if (isTagged(l, TAG.particle)) { out.particles++; continue; }
      if (isTagged(l, TAG.force)) { out.forces++; continue; }
      if (isTagged(l, TAG.emitter)) { out.emitters++; continue; }
      if (!control(l, N.type)) continue;
      var type = bodyType(l);
      out[type]++;
      if (type === 'dynamic' && (transformProp(l, 'ADBE Position').numKeys > 0 || transformProp(l, 'ADBE Position_0').numKeys > 0)) out.simulated++;
    }
    return out;
  }

  // ---------- Asignar cuerpos ----------
  function validate(layer) {
    if (!(layer instanceof AVLayer) && !(layer instanceof ShapeLayer) && !(layer instanceof TextLayer)) throw Error(layer.name + ': solo capas visibles (formas, texto, s\u00f3lidos, metraje o precomposiciones).');
    if (layer.nullLayer) throw Error(layer.name + ': un nulo no tiene contorno. Usa Fuerza o selecci\u00f3nalo como emisor.');
    if (layer.threeDLayer) throw Error(layer.name + ': Gravedad trabaja en 2D. Desactiva el 3D de la capa.');
    if (layer instanceof AVLayer && !layer.hasVideo) throw Error(layer.name + ': la capa no tiene imagen.');
    if (isTagged(layer, TAG.world) || isTagged(layer, TAG.force) || isTagged(layer, TAG.emitter)) throw Error(layer.name + ': es un control de Gravedad.');
  }
  function makeBody(layer, type) {
    if (type !== TYPE.dynamic) settleType(layer, type);
    addMenu(layer, N.type, ['Din\u00e1mico', 'Fijo', 'Desactivado'], type);
    control(layer, N.type).property(1).setValue(type);
    addMenu(layer, N.shape, ['Autom\u00e1tica', 'Caja', 'C\u00edrculo'], 1);
    addControl(layer, 'ADBE Slider Control', N.density, 1);
    addControl(layer, 'ADBE Slider Control', N.friction, 0.4);
    addControl(layer, 'ADBE Slider Control', N.bounce, 0.2);
    addControl(layer, 'ADBE Slider Control', N.impulse, 0);
    addControl(layer, 'ADBE Angle Control', N.impulseAngle, 0);
    addControl(layer, 'ADBE Slider Control', N.spinStart, 0);
  }
  function assign(arg) {
    var c = comp(), layers = c.selectedLayers, type = TYPE[arg.mode];
    if (!type) throw Error('Tipo no v\u00e1lido.');
    if (!layers.length) throw Error('Selecciona capas en la l\u00ednea de tiempo.');
    for (var i = 0; i < layers.length; i++) validate(layers[i]);
    return undo('Gravedad \u00b7 Asignar', function () {
      for (var j = 0; j < layers.length; j++) (function (l) { unlocked(l, function () { makeBody(l, type); }); }(layers[j]));
      var s = summary(c); s.assigned = layers.length; return s;
    });
  }

  // ---------- Uniones ----------
  // La union vive en la primera capa seleccionada: su punto de anclaje es el pivote o el extremo de la barra/muelle.
  // Con una sola capa, queda colgada de un punto fijo de la composicion (su anclaje).
  function join(arg) {
    var c = comp(), layers = c.selectedLayers, kind = 1;
    for (var k = 0; k < JOINTS.length; k++) if (JOINTS[k] === arg.type) kind = k + 1;
    if (layers.length < 1 || layers.length > 2) throw Error('Selecciona una capa (se cuelga de su punto de anclaje) o dos capas para unirlas.');
    for (var i = 0; i < layers.length; i++) validate(layers[i]);
    return undo('Gravedad \u00b7 Unir', function () {
      // After no garantiza el orden de seleccion: la union va en la capa que se mueve (la que no es Fija).
      var a = layers[0], b = layers.length > 1 ? layers[1] : null;
      if (b && isBody(a) && bodyType(a) === 'fixed' && !(isBody(b) && bodyType(b) === 'fixed')) { var swap = a; a = b; b = swap; }
      if (b && !isBody(b)) unlocked(b, function () { makeBody(b, TYPE.fixed); });
      unlocked(a, function () {
        if (!isBody(a)) makeBody(a, TYPE.dynamic);
        addMenu(a, N.joint, ['Pivote', 'Barra r\u00edgida', 'Muelle', 'Ninguna'], kind);
        control(a, N.joint).property(1).setValue(kind);
        addControl(a, 'ADBE Layer Control', N.jointTo);
        // Apuntar a si misma = colgada de su anclaje. "Ninguna" queda para "la capa unida ya no existe".
        control(a, N.jointTo).property(1).setValue(b ? b.index : a.index);
        addControl(a, 'ADBE Slider Control', N.stiffness, 2);
        addControl(a, 'ADBE Slider Control', N.damping, 0.2);
      });
      var s = summary(c); s.joined = b ? 2 : 1; return s;
    });
  }

  // ---------- Mundo desde el panel ----------
  // Campos \u00abclave=valor\u00bb del comentario del nulo de mundo (estado de la simulacion y memoria de los interruptores).
  function commentFields(w) {
    var out = {}, parts = String(w.comment).split(';');
    for (var i = 1; i < parts.length; i++) { var kv = parts[i].split('='); if (kv.length === 2) out[kv[0]] = kv[1]; }
    return out;
  }
  function setCommentFields(w, fields) {
    var text = TAG.world;
    for (var k in fields) if (fields.hasOwnProperty(k) && fields[k] !== null && fields[k] !== undefined) text += ';' + k + '=' + fields[k];
    w.comment = text;
  }
  function setWorld(arg) {
    var c = comp();
    return undo('Gravedad \u00b7 Mundo', function () {
      var w = ensureWorld(c), mem = commentFields(w), G = control(w, N.gravity).property(1);
      // Los interruptores recuerdan lo que habia: Espacio guarda la gravedad (Luna, Marte...) y Tierra la recupera;
      // quitar paredes guarda que bordes estaban y ponerlas los recupera (el techo incluido).
      if (arg.environment === 'space') { if (G.value !== 0) mem.g = G.value; setIfChanged(G, 0); }
      if (arg.environment === 'earth' && G.value === 0) setIfChanged(G, mem.g && isFinite(+mem.g) && +mem.g !== 0 ? +mem.g : 980);
      if (typeof arg.walls === 'boolean') {
        var F = control(w, N.floor).property(1), S = control(w, N.sides).property(1), T = control(w, N.ceiling).property(1);
        if (!arg.walls) { if (F.value || S.value || T.value) mem.e = (F.value ? 'f' : '') + (S.value ? 's' : '') + (T.value ? 't' : ''); setIfChanged(F, 0); setIfChanged(S, 0); setIfChanged(T, 0); }
        else if (!F.value && !S.value && !T.value) { var e = mem.e || 'fs'; setIfChanged(F, e.indexOf('f') >= 0 ? 1 : 0); setIfChanged(S, e.indexOf('s') >= 0 ? 1 : 0); setIfChanged(T, e.indexOf('t') >= 0 ? 1 : 0); }
      }
      setCommentFields(w, mem);
      if (arg.markers !== undefined) addControl(w, 'ADBE Checkbox Control', N.markers, 0).property(1).setValue(arg.markers ? 1 : 0);
      var nums = { gravity: [N.gravity, -100000, 100000], gravityAngle: [N.angle, -3600, 3600], airDrag: [N.drag, 0, 100], quality: [N.quality, 60, 960] }, flags = { floor: N.floor, sides: N.sides, ceiling: N.ceiling };
      for (var key in nums) if (nums.hasOwnProperty(key) && typeof arg[key] === 'number' && isFinite(arg[key])) setIfChanged(control(w, nums[key][0]).property(1), Math.max(nums[key][1], Math.min(nums[key][2], arg[key])));
      for (var f in flags) if (flags.hasOwnProperty(f) && typeof arg[f] === 'boolean') setIfChanged(control(w, flags[f]).property(1), arg[f] ? 1 : 0);
      return summary(c);
    });
  }

  // Escribir una propiedad es lo caro en After: solo se escribe si cambia (y nunca sobre una con claves).
  // Si el control esta animado, se ajusta la clave en el instante actual de la composicion.
  function setIfChanged(p, v) { if (p.numKeys) { p.setValueAtTime(comp(true).time, v); return; } if (p.value !== v) p.setValue(v); }

  // ---------- Ajustes de los cuerpos seleccionados (inspector del panel) ----------
  function setBodies(arg) {
    var c = comp(), sel = c.selectedLayers, values = arg.values || {}, changed = 0;
    var map = { density: [N.density, 0.001, 1000], friction: [N.friction, 0, 10], bounce: [N.bounce, 0, 1], impulse: [N.impulse, -100000, 100000], impulseAngle: [N.impulseAngle, -3600, 3600], spinStart: [N.spinStart, -100000, 100000], shape: [N.shape, 1, 3] };
    if (!sel.length) throw Error('Selecciona capas con f\u00edsica en la l\u00ednea de tiempo.');
    return undo('Gravedad \u00b7 Ajustar cuerpos', function () {
      for (var i = 0; i < sel.length; i++) {
        var l = sel[i];
        if (!isBody(l) && !values.type) continue;
        if (!isBody(l)) validate(l);
        unlocked(l, function () { applyValues(l); });
        changed++;
      }
      var s = summary(c); s.changed = changed; return s;
    });
    function applyValues(l) {
        if (!isBody(l)) makeBody(l, TYPE[values.type] || TYPE.dynamic);
        if (values.type && TYPE[values.type]) { if (TYPE[values.type] !== TYPE.dynamic) settleType(l, TYPE[values.type]); setIfChanged(control(l, N.type).property(1), TYPE[values.type]); }
        for (var key in map) {
          if (!map.hasOwnProperty(key) || typeof values[key] !== 'number' || !isFinite(values[key])) continue;
          var fx = control(l, map[key][0]);
          if (!fx) fx = addControl(l, key === 'impulseAngle' ? 'ADBE Angle Control' : 'ADBE Slider Control', map[key][0], 0);
          setIfChanged(fx.property(1), Math.max(map[key][1], Math.min(map[key][2], values[key])));
        }
    }
  }

  function seek(arg) { var c = comp(true), k = Math.max(0, Math.min(frameCount(c) - 1, Math.round(arg.frame))); c.time = frameTime(c, k); return { time: c.time, frame: k }; }

  // ---------- Guias dibujadas (flecha y alcance) ----------
  function guide(c, name, tag, color, rangeExpression) {
    var l = c.layers.addShape();
    l.name = name; l.comment = tag; l.guideLayer = true;
    var root = l.property('ADBE Root Vectors Group'), g = root.addProperty('ADBE Vector Group');
    g.name = 'Flecha';
    var v = g.property('ADBE Vectors Group'), path = v.addProperty('ADBE Vector Shape - Group'), s = new Shape();
    s.vertices = [[-40, -6], [30, -6], [30, -20], [70, 0], [30, 20], [30, 6], [-40, 6]]; s.closed = true;
    s.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]; s.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
    path.property('ADBE Vector Shape').setValue(s);
    v.addProperty('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue(color);
    if (rangeExpression) {
      var r = root.addProperty('ADBE Vector Group');
      r.name = 'Alcance';
      var rv = r.property('ADBE Vectors Group'), e = rv.addProperty('ADBE Vector Shape - Ellipse');
      e.property('ADBE Vector Ellipse Size').expression = rangeExpression;
      var st = rv.addProperty('ADBE Vector Graphic - Stroke');
      st.property('ADBE Vector Stroke Color').setValue(color); st.property('ADBE Vector Stroke Width').setValue(2);
      try { st.property('ADBE Vector Stroke Dashes').addProperty('ADBE Vector Stroke Dash 1').setValue(8); } catch (ignore) {}
    }
    l.transform.position.setValue([c.width / 2, c.height / 2]);
    return l;
  }
  function force(arg) {
    var c = comp();
    return undo('Gravedad \u00b7 Fuerza', function () {
      var attract = arg.type === 'attract';
      var expr = 'var r=effect("' + N.range + '")(1)*2; r>0?[r,r]:[0,0]';
      var l = guide(c, attract ? 'Gravedad \u00b7 Atractor' : 'Gravedad \u00b7 Ventilador', TAG.force, attract ? [0.55, 0.45, 1] : [0.3, 0.75, 1], expr);
      addMenu(l, N.forceType, ['Viento', 'Atracci\u00f3n'], attract ? 2 : 1);
      addControl(l, 'ADBE Slider Control', N.strength, attract ? 800 : 600);
      addControl(l, 'ADBE Slider Control', N.range, attract ? Math.round(Math.min(c.width, c.height) / 3) : 0);
      if (!attract) l.transform.rotation.setValue(-90);
      select(c, [l]);
      return summary(c);
    });
  }

  // ---------- Particulas ----------
  // La forma de ejemplo se crea una sola vez por composicion y se reutiliza (antes cada clic anadia otro circulo).
  function sampleShape(c) {
    for (var i = 1; i <= c.numLayers; i++) if (String(c.layer(i).comment) === TAG.sample) return c.layer(i);
    var l = c.layers.addShape();
    l.name = NAMES.particleShape; l.comment = TAG.sample;
    var g = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'), v = g.property('ADBE Vectors Group');
    v.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue([36, 36]);
    v.addProperty('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue([1, 0.53, 0.61]);
    l.transform.position.setValue([c.width / 2, c.height / 2]);
    return l;
  }
  function templateName(i) { return i ? N.template + ' ' + (i + 1) : N.template; }
  function particles() {
    var c = comp(), sel = c.selectedLayers, chosen = [], emitter = null;
    for (var i = 0; i < sel.length; i++) {
      if (isTagged(sel[i], TAG.emitter)) { if (!emitter) emitter = sel[i]; continue; }
      if (chosen.length < MAX_TEMPLATES && !sel[i].nullLayer && !isTagged(sel[i], 'gravedad:')) chosen.push(sel[i]);
    }
    for (i = 0; i < chosen.length; i++) validate(chosen[i]);
    // Con un emisor seleccionado no se crea otro: las capas seleccionadas se anaden como formas de ese emisor.
    if (emitter) {
      if (!chosen.length) throw Error('Ya hay un emisor seleccionado. Selecciona tambi\u00e9n las capas que quieras a\u00f1adir como formas, o deselecci\u00f3nalo para crear otro emisor.');
      return undo('Gravedad \u00b7 A\u00f1adir formas al emisor', function () {
        var have = templatesOf(emitter, c), ids = {}, added = 0;
        for (var a = 0; a < have.length; a++) ids[have[a].id] = true;
        var slot = 0; while (slot < MAX_TEMPLATES && control(emitter, templateName(slot))) slot++;
        for (var b = 0; b < chosen.length && slot < MAX_TEMPLATES; b++) {
          if (ids[chosen[b].id]) continue;
          addControl(emitter, 'ADBE Layer Control', templateName(slot)); control(emitter, templateName(slot)).property(1).setValue(chosen[b].index);
          (function (tl) { unlocked(tl, function () { tl.enabled = false; }); }(chosen[b]));
          slot++; added++;
        }
        select(c, [emitter]);
        var s = summary(c); s.addedTemplates = added; return s;
      });
    }
    return undo('Gravedad \u00b7 Part\u00edculas', function () {
      if (!chosen.length) chosen.push(sampleShape(c));
      var l = guide(c, NAMES.emitter, TAG.emitter, [1, 0.6, 0.25], 'var w=effect("' + N.width + '")(1); [4,Math.max(w,1)]');
      l.transform.position.setValue([c.width / 2, c.height * 0.12]);
      l.transform.rotation.setValue(90);
      // Varias capas seleccionadas = varias formas: cada particula elige una al azar (confeti, hojas...).
      for (var t = 0; t < chosen.length; t++) { addControl(l, 'ADBE Layer Control', templateName(t)); control(l, templateName(t)).property(1).setValue(chosen[t].index); }
      addControl(l, 'ADBE Slider Control', N.rate, 20);
      addControl(l, 'ADBE Slider Control', N.max, 100);
      addControl(l, 'ADBE Slider Control', N.speed, 300);
      addControl(l, 'ADBE Angle Control', N.spread, 30);
      addControl(l, 'ADBE Slider Control', N.width, Math.round(Math.min(400, c.width * 0.3)));
      addControl(l, 'ADBE Slider Control', N.life, 0);
      addControl(l, 'ADBE Slider Control', N.size, 100);
      addControl(l, 'ADBE Slider Control', N.sizeVar, 30);
      addControl(l, 'ADBE Slider Control', N.spin, 90);
      addControl(l, 'ADBE Slider Control', N.fade, 0.3);
      addControl(l, 'ADBE Slider Control', N.seed, 1);
      for (t = 0; t < chosen.length; t++) (function (tl) { unlocked(tl, function () { tl.enabled = false; }); }(chosen[t]));
      select(c, [l]);
      return summary(c);
    });
  }

  // ---------- Lectura de la escena ----------
  function solidSource(l) { try { return l.source && l.source.mainSource instanceof SolidSource; } catch (e) { return false; } }
  function opaqueFootage(l) {
    try { return l.source instanceof FootageItem && !(l.source.mainSource instanceof SolidSource) && l.source.mainSource && l.source.mainSource.hasAlpha === false; } catch (e) { return false; }
  }
  function boxOf(l, t) { var r = l.sourceRectAtTime(t, false); return { kind: 'rect', x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }

  // Render del alfa: se copia la capa a una composicion temporal con transformacion neutra.
  function tempFolder() {
    for (var i = 1; i <= app.project.numItems; i++) { var it = app.project.item(i); if (it instanceof FolderItem && it.name === NAMES.temp) return it; }
    var f = app.project.items.addFolder(NAMES.temp); tempItems.push(f); return f;
  }
  function neutral(p, value) {
    if (!p) return;
    try { if (p.canSetExpression && p.expressionEnabled) p.expressionEnabled = false; } catch (e) {}
    while (p.numKeys > 0) p.removeKey(p.numKeys);
    p.setValue(value);
  }
  function renderAlpha(l, c, t, dir, id) {
    var r = l.sourceRectAtTime(t, false);
    if (!(r.width > 0 && r.height > 0)) throw Error('sin l\u00edmites');
    var k = Math.min(1, 2000 / Math.max(r.width, r.height)), w = Math.max(4, Math.ceil(r.width * k) + 4), h = Math.max(4, Math.ceil(r.height * k) + 4);
    var tc = app.project.items.addComp(NAMES.temp + ' ' + id, w, h, 1, Math.max(c.duration, t + 1), c.frameRate);
    tc.parentFolder = tempFolder(); tempItems.push(tc);
    tc.bgColor = [0, 0, 0];
    l.copyToComp(tc);
    var copy = tc.layer(1);
    if (copy.parent) copy.parent = null;
    var tr = copy.property('ADBE Transform Group');
    try { if (tr.property('ADBE Position').dimensionsSeparated) { neutral(tr.property('ADBE Position_0'), 0); neutral(tr.property('ADBE Position_1'), 0); tr.property('ADBE Position').dimensionsSeparated = false; } } catch (eSep) {}
    neutral(tr.property('ADBE Anchor Point'), [r.left, r.top]);
    neutral(tr.property('ADBE Position'), [2, 2]);
    neutral(tr.property('ADBE Scale'), [k * 100, k * 100]);
    neutral(tr.property('ADBE Rotate Z'), 0);
    neutral(tr.property('ADBE Opacity'), 100);
    copy.enabled = true; copy.guideLayer = false; copy.solo = false;
    try { copy.motionBlur = false; } catch (e1) {}
    // Sombras, brillos y desenfoques ensucian el alfa: se apagan en la copia.
    var fx = parade(copy);
    if (fx) for (var i = 1; i <= fx.numProperties; i++) { var m = fx.property(i).matchName; if (/Shadow|Glo|Blur|Glow/i.test(m)) fx.property(i).enabled = false; }
    var file = new File(dir + '/alfa-' + id + '-' + new Date().getTime() + '.png');
    tc.saveFrameToPng(t, file);
    return { file: file.fsName, left: r.left - 2 / k, top: r.top - 2 / k, scale: k };
  }

  function visualEffects(l) {
    var fx = parade(l);
    if (!fx) return false;
    for (var i = 1; i <= fx.numProperties; i++) if (fx.property(i).enabled && fx.property(i).name.indexOf('Gravedad') !== 0) return true;
    return false;
  }
  function geometryOf(l, c, t, dir, cache) {
    var kind = Math.round(read(l, N.shape, 1)), g = null, note = null;
    if (kind === 2) return { shape: boxOf(l, t) };
    if (kind === 3) { var b = boxOf(l, t); return { shape: { kind: 'circle', x: b.x, y: b.y, r: (b.w + b.h) / 4 } }; }
    if (l instanceof AVLayer || l instanceof ShapeLayer || l instanceof TextLayer) g = GravedadGeometry.masks(l, t);
    if (g && g.skippedMasks) note = 'mascaras';
    if (g && g.shrunkMasks) note = 'mascara-contraida';
    if (!g && l instanceof ShapeLayer) g = GravedadGeometry.shapeLayer(l, t);
    if (!g && (solidSource(l) || opaqueFootage(l))) g = boxOf(l, t);
    if (!g) {
      // Capas con la misma fuente (metraje o precomposicion) en el mismo instante comparten render, salvo que tengan
      // efectos propios que cambien el alfa.
      var key = l.source && !visualEffects(l) ? 'fuente' + l.source.id + '@' + Math.round(l.sourceTime(t) * 1000) : null;
      if (key && cache[key]) return { raster: cache[key], fallback: boxOf(l, t), note: note };
      try { var job = renderAlpha(l, c, t, dir, l.id); if (key) cache[key] = job; return { raster: job, fallback: boxOf(l, t), note: note }; }
      catch (e) { return { shape: boxOf(l, t), note: 'alfa' }; }
    }
    return { shape: g, note: note };
  }

  function material(l) {
    return { density: Math.max(0.001, read(l, N.density, 1)), friction: Math.max(0, read(l, N.friction, 0.4)), restitution: Math.min(1, Math.max(0, read(l, N.bounce, 0.2))) };
  }

  function spanOf(l, c, frames) {
    var spawn = Math.max(0, Math.ceil((l.inPoint - c.workAreaStart) * c.frameRate - 1e-6)), despawn = Math.min(frames, Math.ceil((l.outPoint - c.workAreaStart) * c.frameRate - 1e-6));
    return { spawn: spawn, despawn: despawn };
  }

  function describe(l, c, frames, dir, cache, kindOverride) {
    var type = kindOverride || bodyType(l), span = spanOf(l, c, frames);
    if (type === 'off' || span.despawn <= span.spawn) return null;
    var t = frameTime(c, span.spawn), p = pose(l, t, rotationGuess(l, t)), geo = geometryOf(l, c, t, dir, cache);
    var body = { id: String(l.id), index: l.index, name: l.name, type: type === 'dynamic' ? 'dynamic' : 'static', spawn: span.spawn, despawn: span.despawn < frames ? span.despawn : null, pose: { x: round(p.x), y: round(p.y), a: round(p.a) }, matrix: p.m, material: material(l), note: geo.note };
    if (geo.shape) body.layerShape = geo.shape; else { body.raster = geo.raster; body.fallback = geo.fallback; }
    if (type === 'fixed' && animated(l)) {
      body.type = 'kinematic'; body.track = [];
      var prev = p.a;
      for (var k = span.spawn; k < (span.despawn || frames); k++) { var q = pose(l, frameTime(c, k), prev); prev = q.a; body.track.push([round(q.x), round(q.y), round(q.a)]); }
    }
    if (type === 'dynamic') {
      // Lanzamiento: la animacion propia justo antes del inicio da la velocidad inicial.
      var dt = 1 / c.frameRate, before = pose(l, t - dt, p.a);
      if (animated(l) && hasKeyBefore(l, t)) body.velocity = { x: round((p.x - before.x) / dt), y: round((p.y - before.y) / dt), a: round((p.a - before.a) / dt) };
      if (animated(l) && !hasKeyBefore(l, t) && l.parent && animated(l.parent)) body.note = body.note || 'padre-animado';
      // Impulso: 0 grados = hacia arriba, 90 = derecha (como el dial de angulo de After).
      var imp = read(l, N.impulse, 0), dir = read(l, N.impulseAngle, 0) * Math.PI / 180, spin = read(l, N.spinStart, 0);
      if (imp || spin) { var v = body.velocity || { x: 0, y: 0, a: 0 }; body.velocity = { x: round(v.x + Math.sin(dir) * imp), y: round(v.y - Math.cos(dir) * imp), a: round(v.a + spin) }; }
    }
    return body;
  }
  function hasKeyBefore(l, t) {
    var props = ['ADBE Position', 'ADBE Rotate Z', 'ADBE Position_0', 'ADBE Position_1'];
    for (var i = 0; i < props.length; i++) { var p = null; try { p = transformProp(l, props[i]); } catch (e) {} if (p && p.numKeys && p.keyTime(1) < t - 1e-4) return true; }
    return false;
  }

  function templatesOf(l, c) {
    var out = [];
    for (var i = 0; i < MAX_TEMPLATES; i++) {
      var fx = control(l, templateName(i));
      if (!fx) { if (i) break; else continue; }
      var ix = Math.round(fx.property(1).value);
      if (ix >= 1 && ix <= c.numLayers && c.layer(ix) !== l && !isTagged(c.layer(ix), 'gravedad:')) out.push(c.layer(ix));
    }
    return out;
  }
  function gather(arg) {
    var c = comp(), frames = frameCount(c), dir = arg.tempDir || Folder.temp.fsName, cache = {};
    var folder = new Folder(dir); if (!folder.exists) folder.create();
    var scene = { compId: c.id, fps: c.frameRate, frames: frames, start: c.workAreaStart, width: c.width, height: c.height, world: worldSettings(c), bodies: [], forces: [], emitters: [], problems: [] };
    var i, k, l, templates = {}, emitterLayers = findAll(c, TAG.emitter);
    for (i = 0; i < emitterLayers.length; i++) { var tl = templatesOf(emitterLayers[i], c); for (k = 0; k < tl.length; k++) templates[tl[k].id] = true; }
    for (i = 1; i <= c.numLayers; i++) {
      l = c.layer(i);
      if (!isBody(l) || templates[l.id]) continue;
      if (l.threeDLayer) { scene.problems.push(l.name + ': es 3D, se ignora.'); continue; }
      try { var b = describe(l, c, frames, dir, cache); if (b) scene.bodies.push(b); }
      catch (e) { scene.problems.push(l.name + ': ' + e.message); }
    }
    // Uniones definidas en los cuerpos.
    scene.joints = [];
    for (i = 1; i <= c.numLayers; i++) {
      l = c.layer(i);
      if (!isBody(l) || !control(l, N.joint) || templates[l.id]) continue;
      var jk = Math.round(read(l, N.joint, 4));
      if (jk < 1 || jk > 3) continue;
      var bi = Math.round(read(l, N.jointTo, 0));
      if (bi < 1 || bi > c.numLayers) { scene.problems.push(l.name + ': la capa a la que estaba unida ya no existe; se ignora la uni\u00f3n.'); continue; }
      var other = c.layer(bi) !== l ? c.layer(bi) : null;
      scene.joints.push({ a: String(l.id), b: other ? String(other.id) : null, type: JOINTS[jk - 1], frequency: Math.max(0.05, read(l, N.stiffness, 2)), damping: Math.max(0, read(l, N.damping, 0.2)) });
    }
    var forces = findAll(c, TAG.force);
    for (i = 0; i < forces.length; i++) {
      l = forces[i]; var f = { id: String(l.id), type: Math.round(read(l, N.forceType, 1)) === 2 ? 'attract' : 'wind', track: [] }, span = spanOf(l, c, frames), prev;
      if (!l.enabled) continue;
      for (k = 0; k < frames; k++) {
        var tt = frameTime(c, k), q = pose(l, tt, prev); prev = q.a;
        var on = k >= span.spawn && k < span.despawn;
        f.track.push([round(q.x), round(q.y), round(q.a), on ? read(l, N.strength, 0, tt) : 0, Math.max(0, read(l, N.range, 0, tt))]);
      }
      scene.forces.push(f);
    }
    var emitters = findAll(c, TAG.emitter);
    for (i = 0; i < emitters.length; i++) {
      l = emitters[i];
      if (!l.enabled) continue;
      var tpls = templatesOf(l, c);
      if (!tpls.length) { scene.problems.push(l.name + ': elige la capa de part\u00edcula en Controles de efectos.'); continue; }
      try {
        var span2 = spanOf(l, c, frames), e = { id: String(l.id), name: l.name, templates: [], from: span2.spawn, to: span2.despawn < frames ? span2.despawn : null,
          max: Math.max(0, Math.min(2000, Math.round(read(l, N.max, 100)))), lifetime: Math.max(0, read(l, N.life, 0)), fade: Math.max(0, read(l, N.fade, 0)), size: Math.max(0.01, read(l, N.size, 100) / 100), sizeVariation: Math.max(0, Math.min(0.95, read(l, N.sizeVar, 30) / 100)),
          spin: Math.abs(read(l, N.spin, 90)), randomRotation: true, seed: Math.max(1, Math.round(read(l, N.seed, 1))), speedVariation: 0.15, material: material(tpls[0]), track: [] };
        for (var ti = 0; ti < tpls.length; ti++) {
          var tpl = tpls[ti];
          validate(tpl);
          var t0 = frameTime(c, Math.max(0, Math.min(frames - 1, spanOf(tpl, c, frames).spawn))), p0 = pose(tpl, t0, rotationGuess(tpl, t0)), g0 = geometryOf(tpl, c, t0, dir, cache);
          var item = { id: String(tpl.id), name: tpl.name, templatePose: { x: round(p0.x), y: round(p0.y), a: round(p0.a) }, matrix: p0.m, material: material(tpl), note: g0.note };
          if (g0.shape) item.layerShape = g0.shape; else { item.raster = g0.raster; item.fallback = g0.fallback; }
          e.templates.push(item);
        }
        var prev2;
        for (k = 0; k < frames; k++) {
          var t2 = frameTime(c, k), q2 = pose(l, t2, prev2); prev2 = q2.a;
          e.track.push([round(q2.x), round(q2.y), round(q2.a), Math.max(0, read(l, N.rate, 20, t2)), read(l, N.speed, 300, t2), Math.abs(read(l, N.spread, 30, t2)), Math.max(0, read(l, N.width, 0, t2))]);
        }
        scene.emitters.push(e);
      } catch (err) { scene.problems.push(l.name + ': ' + err.message); }
    }
    scene.signature = signature(c);
    if (!scene.bodies.length && !scene.emitters.length) throw Error('No hay cuerpos. Selecciona capas y pulsa Din\u00e1mico o Fijo, o crea Part\u00edculas.');
    return scene;
  }

  // Borra las composiciones temporales del render de alfa.
  function cleanup() {
    for (var i = tempItems.length - 1; i >= 0; i--) { try { tempItems[i].remove(); } catch (e) {} }
    tempItems = [];
    for (var j = app.project.numItems; j >= 1; j--) { var it = app.project.item(j); if (it.name === NAMES.temp || it.name.indexOf(NAMES.temp + ' ') === 0) { try { it.remove(); } catch (e2) {} } }
    return true;
  }

  // ---------- Escritura ----------
  function removeKeysIn(p, from, to, keep) {
    if (!p || !p.numKeys) return;
    for (var i = p.numKeys; i >= 1; i--) {
      var t = p.keyTime(i);
      if (t < from - 1e-4 || t > to + 1e-4) continue;
      // Las claves que caen justo en un fotograma que se va a escribir se sobrescriben: borrarlas es el paso lento.
      if (keep && keep(t)) continue;
      p.removeKey(i);
    }
  }
  function layerById(c, id) { for (var i = 1; i <= c.numLayers; i++) if (String(c.layer(i).id) === String(id)) return c.layer(i); return null; }
  function writeMotion(l, c, rec, rot0, times, record) {
    var n = rec.data.length / 3, pos = [], rot = [], t = [], i;
    keysWritten += n * 2;
    var tr = l.property('ADBE Transform Group'), P = tr.property('ADBE Position'), R = tr.property('ADBE Rotate Z');
    var a0 = rec.data[2], three = !P.dimensionsSeparated && P.value.length === 3, z = three ? P.value[2] : 0;
    for (i = 0; i < n; i++) {
      t.push(times[rec.from + i]);
      // Centesimas de pixel y de grado: imperceptible y permite reconocer despues cada clave escrita.
      var x = round2(rec.data[i * 3]), y = round2(rec.data[i * 3 + 1]);
      pos.push(three ? [x, y, z] : [x, y]);
      rot.push(round2(rot0 + rec.data[i * 3 + 2] - a0));
    }
    var end = times[times.length - 1] + 1 / c.frameRate, first = rec.from, last = rec.from + n - 1, fps = c.frameRate, start = c.workAreaStart;
    var keep = function (tk) { var k = Math.round((tk - start) * fps); return k >= first && k <= last && Math.abs(times[k] - tk) < 1e-4; };
    if (P.dimensionsSeparated) {
      var X = tr.property('ADBE Position_0'), Y = tr.property('ADBE Position_1'), xs = [], ys = [];
      for (i = 0; i < n; i++) { xs.push(pos[i][0]); ys.push(pos[i][1]); }
      X.expressionEnabled = false; Y.expressionEnabled = false;
      removeKeysIn(X, t[0], end, keep); removeKeysIn(Y, t[0], end, keep);
      X.setValuesAtTimes(t, xs); Y.setValuesAtTimes(t, ys);
      if (record) { hashes(record, 'ADBE Position_0', xs); hashes(record, 'ADBE Position_1', ys); }
    } else {
      if (P.expressionEnabled) P.expressionEnabled = false;
      removeKeysIn(P, t[0], end, keep);
      P.setValuesAtTimes(t, pos);
      if (record) hashes(record, 'ADBE Position', pos);
    }
    if (R.expressionEnabled) R.expressionEnabled = false;
    removeKeysIn(R, t[0], end, keep);
    R.setValuesAtTimes(t, rot);
    if (record) { hashes(record, 'ADBE Rotate Z', rot); record.from = rec.from; record.n = n; record.start = c.workAreaStart; record.fps = c.frameRate; }
  }
  function hashes(record, name, values) {
    var pr = record.props[name] || (record.props[name] = { h: [], orig: [] }), out = [];
    for (var i = 0; i < values.length; i++) out.push(valueHash(values[i]));
    pr.h = out;
  }
  function removeParticles(c) {
    var list = [];
    for (var i = 1; i <= c.numLayers; i++) if (isTagged(c.layer(i), TAG.particle)) list.push(c.layer(i));
    for (var j = 0; j < list.length; j++) { list[j].locked = false; list[j].remove(); }
    return list.length;
  }
  function stripControls(l) {
    var fx = parade(l);
    if (!fx) return;
    for (var i = fx.numProperties; i >= 1; i--) if (fx.property(i).name.indexOf('Gravedad \u00b7 ') === 0) fx.property(i).remove();
  }

  var MARK = 'Gravedad \u00b7 choque', keysWritten = 0;
  function removeMarkers(l) {
    var m = l.property('ADBE Marker');
    if (!m) return;
    for (var i = m.numKeys; i >= 1; i--) { try { if (m.keyValue(i).comment === MARK) m.removeKey(i); } catch (e) {} }
  }
  function addMarker(l, t) { var m = l.property('ADBE Marker'); if (m) m.setValueAtTime(t, new MarkerValue(MARK)); }
  // Desvanecimiento al final de la vida de la particula (Opacidad).
  function fadeOut(l, p, fade, times, c) {
    var O = l.property('ADBE Transform Group').property('ADBE Opacity');
    if (!fade || p.to === null || p.to === undefined) return;
    var end = times[p.to], begin = Math.max(times[p.from], end - fade), o = O.valueAtTime(begin, false);
    if (O.expressionEnabled) O.expressionEnabled = false;
    while (O.numKeys) O.removeKey(O.numKeys);
    O.setValueAtTime(begin, o); O.setValueAtTime(end, 0);
  }

  // result: archivo JS escrito por el panel con "Gravedad._incoming = {...}".
  function apply(arg) {
    var c = comp(), frames, times = [], k;
    Gravedad._incoming = null;
    $.evalFile(new File(arg.file));
    var res = Gravedad._incoming; Gravedad._incoming = null;
    if (!res || res.compId !== c.id) throw Error('La simulaci\u00f3n no corresponde a la composici\u00f3n activa. Vuelve a simular.');
    frames = res.frames;
    for (k = 0; k <= frames; k++) times.push(round(frameTime(c, k) * 1e6) / 1e6);
    return undo('Gravedad \u00b7 Simular', function () {
      var written = 0, created = 0, problems = [], now = {}, hadWorld = !!find(c, TAG.world), store = readStore(c), end = times[times.length - 1] + 1 / c.frameRate;
      keysWritten = 0;
      removeParticles(c);
      // Capas simuladas antes que ya no son dinamicas (cambiadas en Controles de efectos): se asientan primero.
      var pend = pendingSettles(c, store);
      for (var q = 0; q < pend.length; q++) { if (!pend[q].layer) { delete store.layers[pend[q].id]; continue; } (function (pl, pt) { try { unlocked(pl, function () { settleLayer(pl, c, store, pt === 'fixed' ? 'freeze' : 'restore'); }); } catch (eP) { problems.push(pl.name + ': ' + eP.message); } }(pend[q].layer, pend[q].type)); }
      for (var id in res.bodies) {
        if (!res.bodies.hasOwnProperty(id)) continue;
        var rec = res.bodies[id], l = layerById(c, id);
        if (!l || !rec.data.length || !isBody(l) || bodyType(l) !== 'dynamic') continue;
        try {
          unlocked(l, function () {
            // La rotacion se escribe como giro relativo a la de partida; se lee antes de quitar el padre.
            var rot0 = rotationGuess(l, times[rec.from]);
            var record = backupLayer(l, c, store, times[rec.from], end);
            if (l.parent) l.parent = null;
            writeMotion(l, c, rec, rot0, times, record); written++; now[String(l.id)] = true;
            removeMarkers(l);
            if (res.markers && res.contacts && res.contacts[id]) for (var h = 0; h < res.contacts[id].length; h++) addMarker(l, times[res.contacts[id][h]]);
          });
        } catch (e) { problems.push(l.name + ': ' + e.message); }
      }
      for (var i = 0; i < res.particles.length; i++) {
        var p = res.particles[i], e2 = res.emitters[p.emitter], info = e2 ? e2.templates[p.template || 0] : null, tpl = info ? layerById(c, info.id) : null;
        if (!tpl || !p.data.length) continue;
        var dup = tpl.duplicate();
        dup.locked = false;
        dup.name = tpl.name + ' \u00b7 ' + (p.index < 10 ? '00' : p.index < 100 ? '0' : '') + p.index;
        dup.comment = TAG.particle + p.emitter;
        stripControls(dup);
        var rT = rotationGuess(dup, times[p.from]);
        if (dup.parent) dup.parent = null;
        dup.enabled = true;
        var tr = dup.property('ADBE Transform Group'), S = tr.property('ADBE Scale'), P = tr.property('ADBE Position');
        var s0 = S.valueAtTime(times[p.from], false);
        neutral(S, s0.length === 3 ? [s0[0] * p.scale, s0[1] * p.scale, s0[2]] : [s0[0] * p.scale, s0[1] * p.scale]);
        if (P.dimensionsSeparated) { neutral(tr.property('ADBE Position_0'), 0); neutral(tr.property('ADBE Position_1'), 0); } else neutral(P, P.value);
        neutral(tr.property('ADBE Rotate Z'), 0);
        // Rotacion de la capa = la de la plantilla + lo que gira la particula respecto a la pose de la plantilla.
        writeMotion(dup, c, p, rT + p.data[2] - info.angle, times);
        fadeOut(dup, p, e2.fade, times, c);
        try {
          if (times[p.from] > dup.inPoint) dup.inPoint = times[p.from];
          if (p.to !== null && p.to !== undefined && times[p.to] < dup.outPoint) dup.outPoint = times[p.to];
        } catch (eTrim) { problems.push(dup.name + ': ' + eTrim.message); }
        dup.moveBefore(tpl);
        created++;
      }
      var w = ensureWorld(c), d = new Date();
      writeStore(c, store);
      // Si el nulo de mundo se acaba de crear, la huella se recalcula (el mundo forma parte de ella).
      var mem = commentFields(w);
      var sig = hadWorld && arg.signature ? arg.signature : signature(c);
      mem.ids = null; mem.sig = sig; mem.frames = frames; mem.start = c.workAreaStart; mem.fps = c.frameRate; mem.date = d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
      setCommentFields(w, mem);
      var s = summary(c, true); s.written = written; s.created = created; s.keys = keysWritten; s.problems = problems; return s;
    });
  }

  // ---------- Registro de lo que escribio la simulacion ----------
  // Por cada capa simulada se guarda (en marcadores del nulo de mundo, asi viaja con el proyecto y con Deshacer):
  //   - el tramo de fotogramas escrito y una huella del valor de cada clave generada;
  //   - una copia completa de las claves que la capa tenia antes (valor, interpolacion, suavizado, tangentes),
  //     su valor estatico, si tenia expresion activa y su padre.
  // Asi la limpieza solo quita claves de Gravedad y devuelve las originales; lo que el usuario anada despues se queda.
  var STORE = 'Gravedad \u00b7 datos';
  function storeMarkers(c) {
    var w = find(c, TAG.world), out = [];
    if (!w) return out;
    var M = w.property('ADBE Marker');
    for (var i = 1; i <= M.numKeys; i++) { var v = M.keyValue(i); if (String(v.comment).indexOf(STORE) === 0) out.push({ index: i, comment: String(v.comment) }); }
    return out;
  }
  function readStore(c) {
    var parts = storeMarkers(c), text = '';
    for (var i = 0; i < parts.length; i++) text += parts[i].comment.substring(parts[i].comment.indexOf('\n') + 1);
    if (!text) return { v: 1, layers: {} };
    try { var o = JSON.parse(text); if (o && o.layers) return o; } catch (e) {}
    return { v: 1, layers: {} };
  }
  function writeStore(c, store) {
    var w = ensureWorld(c), M = w.property('ADBE Marker'), old = storeMarkers(c), any = false;
    for (var i = old.length - 1; i >= 0; i--) M.removeKey(old[i].index);
    for (var id in store.layers) if (store.layers.hasOwnProperty(id)) { any = true; break; }
    if (!any) return;
    // Trozos de 20000 caracteres, un marcador por fotograma desde el inicio del nulo.
    var text = JSON.stringify(store), n = Math.ceil(text.length / 20000);
    for (var k = 0; k < n; k++) M.setValueAtTime(w.inPoint + k * c.frameDuration, new MarkerValue(STORE + ' ' + (k + 1) + '/' + n + ' (no borrar)\n' + text.substring(k * 20000, (k + 1) * 20000)));
  }
  function legacyIds(c) {
    var w = find(c, TAG.world), out = {}, m = w ? /;ids=([0-9,]*)/.exec(String(w.comment)) : null;
    if (m && m[1]) { var list = m[1].split(','); for (var i = 0; i < list.length; i++) if (list[i]) out[list[i]] = true; }
    return out;
  }
  function valueHash(v) {
    if (v instanceof Array) { var parts = []; for (var i = 0; i < v.length; i++) parts.push(Math.round(v[i] * 100)); return hashText(parts.join(',')); }
    return hashText(String(Math.round(v * 100)));
  }
  function easeOut(list) { var out = []; for (var i = 0; i < list.length; i++) out.push([list[i].speed, list[i].influence]); return out; }
  function easeIn(list) { var out = []; for (var i = 0; i < list.length; i++) out.push(new KeyframeEase(list[i][0], list[i][1])); return out; }
  function keyInfo(p, i) {
    var k = { t: p.keyTime(i), v: p.keyValue(i) };
    try { k.ii = p.keyInInterpolationType(i); k.oi = p.keyOutInterpolationType(i); } catch (e1) {}
    try { k.ie = easeOut(p.keyInTemporalEase(i)); k.oe = easeOut(p.keyOutTemporalEase(i)); } catch (e2) {}
    try { k.ta = p.keyTemporalAutoBezier(i); k.tc = p.keyTemporalContinuous(i); } catch (e3) {}
    if (p.isSpatial) { try { k.it = p.keyInSpatialTangent(i); k.ot = p.keyOutSpatialTangent(i); k.sa = p.keySpatialAutoBezier(i); k.sc = p.keySpatialContinuous(i); k.r = p.keyRoving(i); } catch (e4) {} }
    return k;
  }
  function restoreKey(p, k) {
    p.setValueAtTime(k.t, k.v);
    var i = p.nearestKeyIndex(k.t);
    try { if (k.ii) p.setInterpolationTypeAtKey(i, k.ii, k.oi); } catch (e1) {}
    try { if (k.ie) p.setTemporalEaseAtKey(i, easeIn(k.ie), easeIn(k.oe)); } catch (e2) {}
    try { if (k.ta !== undefined) { p.setTemporalContinuousAtKey(i, k.tc); p.setTemporalAutoBezierAtKey(i, k.ta); } } catch (e3) {}
    if (p.isSpatial && k.it) { try { p.setSpatialTangentsAtKey(i, k.it, k.ot); p.setSpatialContinuousAtKey(i, k.sc); p.setSpatialAutoBezierAtKey(i, k.sa); if (k.r) p.setRovingAtKey(i, true); } catch (e4) {} }
  }
  function motionProps(l) {
    var tr = l.property('ADBE Transform Group'), P = tr.property('ADBE Position');
    return P.dimensionsSeparated ? [tr.property('ADBE Position_0'), tr.property('ADBE Position_1'), tr.property('ADBE Rotate Z')] : [P, tr.property('ADBE Rotate Z')];
  }
  // Una clave es de Gravedad si cae en un fotograma que escribio la simulacion y conserva el valor que escribio.
  function generated(rec, pr, t, v) {
    if (!rec || !pr) return false;
    var k = Math.round((t - rec.start) * rec.fps), j = k - rec.from;
    return j >= 0 && j < pr.h.length && Math.abs(rec.start + k / rec.fps - t) < 1e-3 && pr.h[j] === valueHash(v);
  }
  // Antes de escribir: se guarda lo que la capa tenia (solo la primera vez) y las claves del usuario que se van a tapar.
  function backupLayer(l, c, store, from, to) {
    var id = String(l.id), rec = store.layers[id], props = motionProps(l), i, j;
    if (!rec) {
      rec = store.layers[id] = { props: {}, parent: l.parent ? String(l.parent.id) : null, from: 0, start: c.workAreaStart, fps: c.frameRate };
      for (j = 0; j < props.length; j++) {
        var q = props[j], st = { h: [], orig: [], expr: q.canSetExpression && q.expressionEnabled ? true : false };
        if (!q.numKeys) st.value = q.value;
        rec.props[q.matchName] = st;
      }
    }
    for (j = 0; j < props.length; j++) {
      var p = props[j], pr = rec.props[p.matchName];
      if (!pr) pr = rec.props[p.matchName] = { h: [], orig: [] };
      for (i = 1; i <= p.numKeys; i++) {
        var t = p.keyTime(i);
        if (t < from - 1e-4 || t > to + 1e-4 || generated(rec, pr, t, p.keyValue(i))) continue;
        var dup = false;
        for (var o = 0; o < pr.orig.length; o++) if (Math.abs(pr.orig[o].t - t) < 1e-4) { dup = true; break; }
        if (!dup) pr.orig.push(keyInfo(p, i));
      }
    }
    return rec;
  }
  // Quita las claves de Gravedad y devuelve las originales. mode: 'restore' (como antes de simular) o 'freeze'
  // (Fijo en la pose visible en el instante actual). Devuelve true si toco la capa.
  function settleLayer(l, c, store, mode) {
    var id = String(l.id), rec = store.layers[id];
    if (!rec) return false;
    var props = motionProps(l), i, j, frozen = null, userKeys = 0;
    if (mode === 'freeze') {
      var tf = Math.max(rec.start + rec.from / rec.fps, Math.min(rec.start + (rec.from + rec.n - 1) / rec.fps, c.time));
      frozen = [];
      for (j = 0; j < props.length; j++) frozen.push(props[j].valueAtTime(tf, false));
    }
    for (j = 0; j < props.length; j++) {
      var p = props[j], pr = rec.props[p.matchName];
      for (i = p.numKeys; i >= 1; i--) { if (generated(rec, pr, p.keyTime(i), p.keyValue(i))) p.removeKey(i); else userKeys++; }
    }
    var hasOwn = false;
    for (j = 0; j < props.length; j++) { var pr2 = rec.props[props[j].matchName]; if (pr2 && pr2.orig.length) hasOwn = true; }
    var parent = rec.parent ? layerById(c, rec.parent) : null;
    if (mode === 'freeze' && !hasOwn && !userKeys) {
      // Fijo sin animacion propia: se queda donde se ve ahora (en coordenadas de la composicion) y recupera su padre.
      for (j = 0; j < props.length; j++) props[j].setValue(frozen[j]);
      if (parent) l.parent = parent;
    } else {
      // Como estaba antes de simular: padre sin compensar (los valores guardados son relativos a el) y claves originales.
      if (parent && !userKeys) l.setParentWithJump(parent);
      for (j = 0; j < props.length; j++) {
        var q = props[j], st = rec.props[q.matchName];
        if (!st) continue;
        for (i = 0; i < st.orig.length; i++) { var exists = false; for (var e = 1; e <= q.numKeys; e++) if (Math.abs(q.keyTime(e) - st.orig[i].t) < 1e-4) exists = true; if (!exists) restoreKey(q, st.orig[i]); }
        if (!q.numKeys && st.value !== undefined) q.setValue(st.value);
        if (st.expr && q.canSetExpression) q.expressionEnabled = true;
      }
    }
    removeMarkers(l);
    delete store.layers[id];
    return true;
  }
  // Cambio de tipo de una capa simulada: Fijo conserva la pose actual; Desactivado vuelve a como estaba.
  function settleType(l, type) {
    var c = l.containingComp, store = readStore(c);
    if (!store.layers[String(l.id)]) return false;
    unlocked(l, function () { settleLayer(l, c, store, type === TYPE.fixed ? 'freeze' : 'restore'); });
    writeStore(c, store);
    return true;
  }
  // Cambios hechos en Controles de efectos: se aplican al simular o al borrar.
  function pendingSettles(c, store) {
    var out = [];
    for (var id in store.layers) {
      if (!store.layers.hasOwnProperty(id)) continue;
      var l = layerById(c, id);
      if (!l) { out.push({ id: id, layer: null }); continue; }
      var t = isBody(l) ? bodyType(l) : 'off';
      if (t !== 'dynamic') out.push({ id: id, layer: l, type: t });
    }
    return out;
  }
  function normalize() {
    var c = comp(), store = readStore(c), list = pendingSettles(c, store);
    if (!list.length) return { settled: 0 };
    return undo('Gravedad \u00b7 Aplicar cambios de tipo', function () {
      for (var i = 0; i < list.length; i++) {
        var it = list[i];
        if (!it.layer) { delete store.layers[it.id]; continue; }
        (function (l, type) { unlocked(l, function () { settleLayer(l, c, store, type === 'fixed' ? 'freeze' : 'restore'); }); }(it.layer, it.type));
      }
      writeStore(c, store);
      return { settled: list.length };
    });
  }

  function clear() {
    var c = comp();
    return undo('Gravedad \u00b7 Borrar simulaci\u00f3n', function () {
      var cleared = 0, removed = removeParticles(c), store = readStore(c), legacy = legacyIds(c), skipped = [];
      for (var id in store.layers) {
        if (!store.layers.hasOwnProperty(id)) continue;
        var l = layerById(c, id);
        if (!l) { delete store.layers[id]; continue; }
        if (unlocked(l, function () { return settleLayer(l, c, store, 'restore'); })) cleared++;
      }
      // Proyectos de la 1.1.1: sin registro no se puede distinguir; no se borra a ciegas.
      for (var lid in legacy) if (legacy.hasOwnProperty(lid)) { var ll = layerById(c, lid); if (ll && motionProps(ll)[0].numKeys) skipped.push(ll.name); }
      // Dinamicas con claves pero sin registro (nulo de mundo borrado, capa duplicada...): tampoco se tocan.
      for (var n = 1; n <= c.numLayers; n++) {
        var dl = c.layer(n);
        if (store.layers[String(dl.id)] === undefined && !legacy[String(dl.id)] && isBody(dl) && bodyType(dl) === 'dynamic' && (motionProps(dl)[0].numKeys > 1 || motionProps(dl)[motionProps(dl).length - 1].numKeys > 1)) skipped.push(dl.name);
      }
      writeStore(c, store);
      var w0 = find(c, TAG.world);
      if (w0) { var m0 = commentFields(w0); m0.sig = m0.frames = m0.start = m0.fps = m0.date = m0.ids = null; setCommentFields(w0, m0); }
      var s0 = summary(c); s0.cleared = cleared; s0.removed = removed; s0.legacy = skipped; return s0;
    });
  }

  function selectBodies(arg) {
    var c = comp(), list = [];
    for (var i = 1; i <= c.numLayers; i++) { var l = c.layer(i); if (isBody(l) && (!arg.mode || bodyType(l) === arg.mode)) list.push(l); }
    select(c, list);
    return summary(c);
  }

  return {
    VERSION: VERSION,
    _incoming: null,
    inspect: function (raw) { return wrap(function (arg) { return summary(comp(true), !!arg.deep); }, raw); },
    bodies: function (raw) { return wrap(setBodies, raw); },
    normalize: function (raw) { return wrap(normalize, raw); },
    // Latido barato (varias veces por segundo): tiempo actual y si cambio la composicion o la seleccion.
    tick: function () {
      try {
        var c = app.project && app.project.activeItem;
        if (!(c instanceof CompItem)) return '{"ok":true,"data":null}';
        var sel = c.selectedLayers, ids = [];
        for (var i = 0; i < sel.length && i < 40; i++) ids.push(sel[i].id);
        return '{"ok":true,"data":{"comp":' + c.id + ',"time":' + c.time + ',"layers":' + c.numLayers + ',"sel":"' + ids.join(',') + '","start":' + c.workAreaStart + ',"duration":' + c.workAreaDuration + '}}';
      } catch (e) { return '{"ok":false,"error":"tick"}'; }
    },
    seek: function (raw) { return wrap(seek, raw); },
    assign: function (raw) { return wrap(assign, raw); },
    join: function (raw) { return wrap(join, raw); },
    world: function (raw) { return wrap(setWorld, raw); },
    force: function (raw) { return wrap(force, raw); },
    particles: function (raw) { return wrap(particles, raw); },
    gather: function (raw) { return wrap(gather, raw); },
    cleanup: function (raw) { return wrap(cleanup, raw); },
    apply: function (raw) { return wrap(apply, raw); },
    clear: function (raw) { return wrap(clear, raw); },
    select: function (raw) { return wrap(selectBodies, raw); }
  };
}());
