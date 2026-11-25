/*
 * Gravedad - lado After Effects (ExtendScript ES3).
 * Lee la escena, crea los controles nativos y escribe la simulacion como fotogramas clave.
 * La fisica se calcula en el panel (engine/sim.js); aqui no hay ningun plugin compilado.
 */
if (typeof JSON === 'undefined') $.evalFile(new File(new File($.fileName).parent.fsName + '/json2.js'));
$.evalFile(new File(new File($.fileName).parent.fsName + '/geometry.jsx'));

var Gravedad = (function () {
  var VERSION = '1.0.0';
  var TAG = { world: 'gravedad:mundo', force: 'gravedad:fuerza', emitter: 'gravedad:emisor', particle: 'gravedad:particula:' };
  var N = {
    type: 'Gravedad \u00b7 Tipo', shape: 'Gravedad \u00b7 Forma', density: 'Gravedad \u00b7 Densidad', friction: 'Gravedad \u00b7 Fricci\u00f3n', bounce: 'Gravedad \u00b7 Rebote',
    gravity: 'Gravedad \u00b7 Gravedad', angle: 'Gravedad \u00b7 Direcci\u00f3n', floor: 'Gravedad \u00b7 Suelo', sides: 'Gravedad \u00b7 Lados', ceiling: 'Gravedad \u00b7 Techo', drag: 'Gravedad \u00b7 Resistencia del aire', quality: 'Gravedad \u00b7 Calidad',
    forceType: 'Gravedad \u00b7 Tipo de fuerza', strength: 'Gravedad \u00b7 Intensidad', range: 'Gravedad \u00b7 Alcance',
    template: 'Gravedad \u00b7 Capa de part\u00edcula', rate: 'Gravedad \u00b7 Ritmo', max: 'Gravedad \u00b7 M\u00e1ximo', speed: 'Gravedad \u00b7 Velocidad', spread: 'Gravedad \u00b7 Dispersi\u00f3n', width: 'Gravedad \u00b7 Anchura', life: 'Gravedad \u00b7 Vida', size: 'Gravedad \u00b7 Tama\u00f1o', sizeVar: 'Gravedad \u00b7 Variaci\u00f3n de tama\u00f1o', spin: 'Gravedad \u00b7 Giro', seed: 'Gravedad \u00b7 Semilla'
  };
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

  // ---------- Mundo ----------
  function worldSettings(c) {
    var w = find(c, TAG.world);
    if (!w) return { exists: false, gravity: 980, gravityAngle: 0, floor: true, sides: true, ceiling: false, airDrag: 0, quality: 240 };
    return { exists: true, gravity: read(w, N.gravity, 980), gravityAngle: read(w, N.angle, 0), floor: !!read(w, N.floor, 1), sides: !!read(w, N.sides, 1), ceiling: !!read(w, N.ceiling, 0), airDrag: Math.max(0, read(w, N.drag, 0)), quality: Math.max(60, Math.min(960, read(w, N.quality, 240))) };
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
    w.moveToEnd();
    return w;
  }

  // ---------- Resumen para el panel ----------
  function summary(c) {
    var out = { version: VERSION, comp: { id: c.id, name: c.name, width: c.width, height: c.height, fps: c.frameRate, start: c.workAreaStart, duration: c.workAreaDuration, frames: frameCount(c) }, world: worldSettings(c), dynamic: 0, fixed: 0, off: 0, forces: 0, emitters: 0, particles: 0, simulated: 0, selected: c.selectedLayers.length };
    for (var i = 1; i <= c.numLayers; i++) {
      var l = c.layer(i);
      if (isTagged(l, TAG.particle)) { out.particles++; continue; }
      if (isTagged(l, TAG.force)) { out.forces++; continue; }
      if (isTagged(l, TAG.emitter)) { out.emitters++; continue; }
      if (!control(l, N.type)) continue;
      var type = bodyType(l);
      out[type]++;
      if (type === 'dynamic' && transformProp(l, 'ADBE Position').numKeys > 2) out.simulated++;
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
    addMenu(layer, N.type, ['Din\u00e1mico', 'Fijo', 'Desactivado'], type);
    control(layer, N.type).property(1).setValue(type);
    addMenu(layer, N.shape, ['Autom\u00e1tica', 'Caja', 'C\u00edrculo'], 1);
    addControl(layer, 'ADBE Slider Control', N.density, 1);
    addControl(layer, 'ADBE Slider Control', N.friction, 0.4);
    addControl(layer, 'ADBE Slider Control', N.bounce, 0.2);
  }
  function assign(arg) {
    var c = comp(), layers = c.selectedLayers, type = TYPE[arg.mode];
    if (!type) throw Error('Tipo no v\u00e1lido.');
    if (!layers.length) throw Error('Selecciona capas en la l\u00ednea de tiempo.');
    for (var i = 0; i < layers.length; i++) validate(layers[i]);
    return undo('Gravedad \u00b7 Asignar', function () {
      for (var j = 0; j < layers.length; j++) makeBody(layers[j], type);
      var s = summary(c); s.assigned = layers.length; return s;
    });
  }

  // ---------- Mundo desde el panel ----------
  function setWorld(arg) {
    var c = comp();
    return undo('Gravedad \u00b7 Mundo', function () {
      var w = ensureWorld(c);
      if (arg.environment === 'space') control(w, N.gravity).property(1).setValue(0);
      if (arg.environment === 'earth') control(w, N.gravity).property(1).setValue(980);
      if (arg.walls !== undefined) { control(w, N.floor).property(1).setValue(arg.walls ? 1 : 0); control(w, N.sides).property(1).setValue(arg.walls ? 1 : 0); control(w, N.ceiling).property(1).setValue(arg.walls && arg.ceiling ? 1 : 0); }
      return summary(c);
    });
  }

  // ---------- Guias dibujadas (flecha y alcance) ----------
  function guide(c, name, tag, color, rangeExpression) {
    var l = c.layers.addShape();
    l.name = name; l.comment = tag; l.guideLayer = true;
    var root = l.property('ADBE Root Vectors Group'), g = root.addProperty('ADBE Vector Group');
    g.name = 'Flecha';
    var v = g.property('ADBE Vectors Group'), path = v.addProperty('ADBE Vector Shape - Group'), s = new Shape();
    s.vertices = [[-40, -6], [30, -6], [30, -20], [70, 0], [30, 20], [30, 6], [-40, 6]]; s.closed = true;
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
  function sampleShape(c) {
    var l = c.layers.addShape();
    l.name = NAMES.particleShape;
    var g = l.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group'), v = g.property('ADBE Vectors Group');
    v.addProperty('ADBE Vector Shape - Ellipse').property('ADBE Vector Ellipse Size').setValue([36, 36]);
    v.addProperty('ADBE Vector Graphic - Fill').property('ADBE Vector Fill Color').setValue([1, 0.53, 0.61]);
    l.transform.position.setValue([c.width / 2, c.height / 2]);
    return l;
  }
  function particles() {
    var c = comp(), sel = c.selectedLayers, template = null;
    for (var i = 0; i < sel.length; i++) if (!sel[i].nullLayer && !isTagged(sel[i], 'gravedad:')) { template = sel[i]; break; }
    if (template) validate(template);
    return undo('Gravedad \u00b7 Part\u00edculas', function () {
      if (!template) template = sampleShape(c);
      var l = guide(c, NAMES.emitter, TAG.emitter, [1, 0.6, 0.25], 'var w=effect("' + N.width + '")(1); [Math.max(w,1),4]');
      l.transform.position.setValue([c.width / 2, c.height * 0.12]);
      l.transform.rotation.setValue(90);
      addControl(l, 'ADBE Layer Control', N.template);
      control(l, N.template).property(1).setValue(template.index);
      addControl(l, 'ADBE Slider Control', N.rate, 20);
      addControl(l, 'ADBE Slider Control', N.max, 100);
      addControl(l, 'ADBE Slider Control', N.speed, 300);
      addControl(l, 'ADBE Angle Control', N.spread, 30);
      addControl(l, 'ADBE Slider Control', N.width, Math.round(Math.min(400, c.width * 0.3)));
      addControl(l, 'ADBE Slider Control', N.life, 0);
      addControl(l, 'ADBE Slider Control', N.size, 100);
      addControl(l, 'ADBE Slider Control', N.sizeVar, 30);
      addControl(l, 'ADBE Slider Control', N.spin, 90);
      addControl(l, 'ADBE Slider Control', N.seed, 1);
      template.enabled = false;
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
    if (tr.property('ADBE Position').dimensionsSeparated) tr.property('ADBE Position').dimensionsSeparated = false;
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

  function geometryOf(l, c, t, dir, cache) {
    var kind = Math.round(read(l, N.shape, 1)), g = null, note = null;
    if (kind === 2) return { shape: boxOf(l, t) };
    if (kind === 3) { var b = boxOf(l, t); return { shape: { kind: 'circle', x: b.x, y: b.y, r: (b.w + b.h) / 4 } }; }
    if (l instanceof AVLayer || l instanceof ShapeLayer || l instanceof TextLayer) g = GravedadGeometry.masks(l, t);
    if (g && g.skippedMasks) note = 'mascaras';
    if (!g && l instanceof ShapeLayer) g = GravedadGeometry.shapeLayer(l, t);
    if (!g && (solidSource(l) || opaqueFootage(l))) g = boxOf(l, t);
    if (!g) {
      var key = l.source && !(l.source instanceof CompItem) ? 'fuente' + l.source.id + '@' + l.sourceTime(t) : null;
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
    }
    return body;
  }
  function hasKeyBefore(l, t) {
    var props = ['ADBE Position', 'ADBE Rotate Z', 'ADBE Position_0', 'ADBE Position_1'];
    for (var i = 0; i < props.length; i++) { var p = null; try { p = transformProp(l, props[i]); } catch (e) {} if (p && p.numKeys && p.keyTime(1) < t - 1e-4) return true; }
    return false;
  }

  function gather(arg) {
    var c = comp(), frames = frameCount(c), dir = arg.tempDir || Folder.temp.fsName, cache = {};
    var folder = new Folder(dir); if (!folder.exists) folder.create();
    var scene = { compId: c.id, fps: c.frameRate, frames: frames, start: c.workAreaStart, width: c.width, height: c.height, world: worldSettings(c), bodies: [], forces: [], emitters: [], problems: [] };
    var i, k, l, templates = {}, emitterLayers = findAll(c, TAG.emitter);
    for (i = 0; i < emitterLayers.length; i++) { var ix = Math.round(read(emitterLayers[i], N.template, 0)); if (ix >= 1 && ix <= c.numLayers) templates[c.layer(ix).id] = true; }
    for (i = 1; i <= c.numLayers; i++) {
      l = c.layer(i);
      if (!isBody(l) || templates[l.id]) continue;
      if (l.threeDLayer) { scene.problems.push(l.name + ': es 3D, se ignora.'); continue; }
      try { var b = describe(l, c, frames, dir, cache); if (b) scene.bodies.push(b); }
      catch (e) { scene.problems.push(l.name + ': ' + e.message); }
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
      var ti = Math.round(read(l, N.template, 0)), tpl = ti >= 1 && ti <= c.numLayers ? c.layer(ti) : null;
      if (!tpl || tpl === l) { scene.problems.push(l.name + ': elige la capa de part\u00edcula en Controles de efectos.'); continue; }
      try {
        validate(tpl);
        var desc = describe(tpl, c, frames, dir, cache, 'dynamic');
        if (!desc) { var t0 = frameTime(c, 0), p0 = pose(tpl, t0, rotationGuess(tpl, t0)), g0 = geometryOf(tpl, c, t0, dir, cache); desc = { pose: { x: p0.x, y: p0.y, a: round(p0.a) }, matrix: p0.m, layerShape: g0.shape, raster: g0.raster, fallback: g0.fallback }; }
        var span2 = spanOf(l, c, frames), e = { id: String(l.id), name: l.name, template: String(tpl.id), templateIndex: tpl.index, from: span2.spawn, to: span2.despawn < frames ? span2.despawn : null,
          max: Math.max(0, Math.min(2000, Math.round(read(l, N.max, 100)))), lifetime: Math.max(0, read(l, N.life, 0)), size: Math.max(0.01, read(l, N.size, 100) / 100), sizeVariation: Math.max(0, Math.min(0.95, read(l, N.sizeVar, 30) / 100)),
          spin: Math.abs(read(l, N.spin, 90)), randomRotation: true, seed: Math.max(1, Math.round(read(l, N.seed, 1))), speedVariation: 0.15, material: material(tpl), templatePose: desc.pose, matrix: desc.matrix, track: [] };
        if (desc.layerShape) e.layerShape = desc.layerShape; else { e.raster = desc.raster; e.fallback = desc.fallback; }
        var prev2;
        for (k = 0; k < frames; k++) {
          var t2 = frameTime(c, k), q2 = pose(l, t2, prev2); prev2 = q2.a;
          e.track.push([round(q2.x), round(q2.y), round(q2.a), Math.max(0, read(l, N.rate, 20, t2)), read(l, N.speed, 300, t2), Math.abs(read(l, N.spread, 30, t2)), Math.max(0, read(l, N.width, 0, t2))]);
        }
        scene.emitters.push(e);
      } catch (err) { scene.problems.push(l.name + ': ' + err.message); }
    }
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
  function removeKeysIn(p, from, to) {
    if (!p || !p.numKeys) return;
    for (var i = p.numKeys; i >= 1; i--) { var t = p.keyTime(i); if (t >= from - 1e-4 && t <= to + 1e-4) p.removeKey(i); }
  }
  function layerById(c, id) { for (var i = 1; i <= c.numLayers; i++) if (String(c.layer(i).id) === String(id)) return c.layer(i); return null; }
  function writeMotion(l, c, rec, rot0, times) {
    var n = rec.data.length / 3, pos = [], rot = [], t = [], i;
    var tr = l.property('ADBE Transform Group'), P = tr.property('ADBE Position'), R = tr.property('ADBE Rotate Z');
    var a0 = rec.data[2], three = !P.dimensionsSeparated && P.value.length === 3, z = three ? P.value[2] : 0;
    for (i = 0; i < n; i++) {
      t.push(times[rec.from + i]);
      var x = rec.data[i * 3], y = rec.data[i * 3 + 1];
      pos.push(three ? [x, y, z] : [x, y]);
      rot.push(round(rot0 + rec.data[i * 3 + 2] - a0));
    }
    var end = times[times.length - 1] + 1 / c.frameRate;
    if (P.dimensionsSeparated) {
      var X = tr.property('ADBE Position_0'), Y = tr.property('ADBE Position_1'), xs = [], ys = [];
      for (i = 0; i < n; i++) { xs.push(pos[i][0]); ys.push(pos[i][1]); }
      X.expressionEnabled = false; Y.expressionEnabled = false;
      removeKeysIn(X, t[0], end); removeKeysIn(Y, t[0], end);
      X.setValuesAtTimes(t, xs); Y.setValuesAtTimes(t, ys);
    } else {
      if (P.expressionEnabled) P.expressionEnabled = false;
      removeKeysIn(P, t[0], end);
      P.setValuesAtTimes(t, pos);
    }
    if (R.expressionEnabled) R.expressionEnabled = false;
    removeKeysIn(R, t[0], end);
    R.setValuesAtTimes(t, rot);
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
      var written = 0, created = 0, problems = [];
      removeParticles(c);
      for (var id in res.bodies) {
        if (!res.bodies.hasOwnProperty(id)) continue;
        var rec = res.bodies[id], l = layerById(c, id);
        if (!l || !rec.data.length || !isBody(l) || bodyType(l) !== 'dynamic') continue;
        try {
          // La rotacion se escribe como giro relativo a la de partida; se lee antes de quitar el padre.
          var rot0 = rotationGuess(l, times[rec.from]);
          if (l.parent) l.parent = null;
          writeMotion(l, c, rec, rot0, times); written++;
        } catch (e) { problems.push(l.name + ': ' + e.message); }
      }
      for (var i = 0; i < res.particles.length; i++) {
        var p = res.particles[i], e2 = res.emitters[p.emitter], tpl = e2 ? layerById(c, e2.template) : null;
        if (!tpl || !p.data.length) continue;
        var dup = tpl.duplicate();
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
        writeMotion(dup, c, p, rT + p.data[2] - e2.templateAngle, times);
        try {
          if (times[p.from] > dup.inPoint) dup.inPoint = times[p.from];
          if (p.to !== null && p.to !== undefined && times[p.to] < dup.outPoint) dup.outPoint = times[p.to];
        } catch (eTrim) { problems.push(dup.name + ': ' + eTrim.message); }
        dup.moveBefore(tpl);
        created++;
      }
      var s = summary(c); s.written = written; s.created = created; s.problems = problems; return s;
    });
  }

  // Quita las claves que escribio la simulacion: la capa vuelve a su pose de partida.
  function clear() {
    var c = comp(), end = frameTime(c, frameCount(c));
    return undo('Gravedad \u00b7 Borrar simulaci\u00f3n', function () {
      var cleared = 0, removed = removeParticles(c);
      for (var i = 1; i <= c.numLayers; i++) {
        var l = c.layer(i);
        if (!isBody(l) || bodyType(l) !== 'dynamic') continue;
        var tr = l.property('ADBE Transform Group'), P = tr.property('ADBE Position'), R = tr.property('ADBE Rotate Z');
        var span = spanOf(l, c, frameCount(c)), t0 = frameTime(c, span.spawn), list = P.dimensionsSeparated ? [tr.property('ADBE Position_0'), tr.property('ADBE Position_1'), R] : [P, R], touched = false;
        for (var j = 0; j < list.length; j++) {
          var p = list[j];
          if (p.numKeys < 2) continue;
          var rest = p.valueAtTime(t0, false), before = p.numKeys && p.keyTime(1) < t0 - 1e-4;
          removeKeysIn(p, t0, end);
          if (before) p.setValueAtTime(t0, rest); else if (!p.numKeys) p.setValue(rest);
          touched = true;
        }
        if (touched) cleared++;
      }
      var s = summary(c); s.cleared = cleared; s.removed = removed; return s;
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
    inspect: function (raw) { return wrap(function () { return summary(comp(true)); }, raw); },
    assign: function (raw) { return wrap(assign, raw); },
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
