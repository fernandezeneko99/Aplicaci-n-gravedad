'use strict';
/*
 * Modelo mínimo del DOM de scripting de After Effects para ejecutar host/*.jsx en Node.
 * Cubre lo que usa Gravedad: capas 2D, transformaciones con claves, efectos de control, formas, máscaras,
 * padres (con compensación como el selector de padre), duplicar, copiar a otra comp y guardar PNG.
 */
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

let nextId = 1;
const lerp = (a, b, f) => Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * f) : a + (b - a) * f;
const clone = (v) => Array.isArray(v) ? v.map(clone) : (v && typeof v === 'object' && v.vertices ? Object.assign(new Shape(), JSON.parse(JSON.stringify(v))) : v);

class Shape { constructor() { this.vertices = []; this.inTangents = []; this.outTangents = []; this.closed = true; } }

class PropertyBase {
  constructor(matchName, name, parent) { this.matchName = matchName; this.name = name || matchName; this.parentProperty = parent || null; this.enabled = true; this._removed = false; }
  get propertyIndex() { return this.parentProperty ? this.parentProperty._children.indexOf(this) + 1 : 0; }
  remove() { const p = this.parentProperty; p._children.splice(p._children.indexOf(this), 1); this._removed = true; }
  moveTo(i) { const p = this.parentProperty; p._children.splice(p._children.indexOf(this), 1); p._children.splice(i - 1, 0, this); }
}

class Property extends PropertyBase {
  constructor(matchName, name, value, parent) { super(matchName, name, parent); this._value = clone(value); this.keys = []; this.expression = ''; this.expressionEnabled = false; this.canSetExpression = true; this.dimensionsSeparatedValue = false; this.propertyType = 'PROPERTY'; this.numProperties = 0; }
  get value() { return this.valueAtTime(this.ownerTime ? this.ownerTime() : 0, false); }
  get numKeys() { return this.keys.length; }
  keyTime(i) { if (i < 1 || i > this.keys.length) throw Error('key index'); return this.keys[i - 1].t; }
  keyValue(i) { return clone(this.keys[i - 1].v); }
  valueAtTime(t) {
    if (this._layerRef !== undefined) return this._layerRef && !this._layerRef.removed ? this._layerRef.index : 0;
    if (this.expressionEnabled && this.expressionFn) return this.expressionFn(t);
    const k = this.keys;
    if (!k.length) return clone(this._value);
    if (t <= k[0].t) return clone(k[0].v);
    if (t >= k[k.length - 1].t) return clone(k[k.length - 1].v);
    for (let i = 0; i < k.length - 1; i++) if (t >= k[i].t && t <= k[i + 1].t) { if (typeof k[i].v === 'object' && !Array.isArray(k[i].v)) return clone(k[i].v); return lerp(k[i].v, k[i + 1].v, (t - k[i].t) / (k[i + 1].t - k[i].t)); }
  }
  setValue(v) {
    if (this.keys.length) throw Error('Tiene claves: usa setValueAtTime'); this._check(v); this._value = clone(v);
    // Control de capa: After guarda la capa, no su índice; el valor sigue a la capa si se reordena.
    if (this.matchName === 'ADBE Layer Control-0001') this._layerRef = v ? MockAE.project.activeItem.layer(v) : null;
  }
  _check(v) { if (Array.isArray(this._value) && (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !isFinite(x)))) throw Error(this.name + ': valor no válido ' + JSON.stringify(v)); if (typeof this._value === 'number' && (typeof v !== 'number' || !isFinite(v))) throw Error(this.name + ': valor no válido ' + v); }
  setValueAtTime(t, v) { this._check(v); const i = this.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6); if (i >= 0) this.keys[i].v = clone(v); else { this.keys.push({ t, v: clone(v) }); this.keys.sort((a, b) => a.t - b.t); } }
  setValuesAtTimes(ts, vs) { if (ts.length !== vs.length) throw Error('longitudes distintas'); MockAE.stats.setValuesAtTimes++; for (let i = 0; i < ts.length; i++) this.setValueAtTime(ts[i], vs[i]); }
  removeKey(i) { if (i < 1 || i > this.keys.length) throw Error('removeKey fuera de rango'); MockAE.stats.removeKey = (MockAE.stats.removeKey || 0) + 1; this.keys.splice(i - 1, 1); }
  get dimensionsSeparated() { return this.dimensionsSeparatedValue; }
  set dimensionsSeparated(v) { this.dimensionsSeparatedValue = v; }
  setPropertyParameters(items) { if (MockAE.failDropdown) throw Error('No se puede'); if (this.matchName !== 'ADBE Dropdown Control-0001') throw Error('no es menú'); this.items = items; return this; }
}

class Group extends PropertyBase {
  constructor(matchName, name, parent) { super(matchName, name, parent); this._children = []; this.propertyType = 'INDEXED_GROUP'; }
  get numProperties() { return this._children.length; }
  property(k) {
    if (typeof k === 'number') return this._children[k - 1] || null;
    return this._children.find((c) => c.matchName === k || c.name === k) || null;
  }
  add(child) { child.parentProperty = this; this._children.push(child); return child; }
  addProperty(matchName) { const f = factories[matchName]; if (!f) throw Error('addProperty: ' + matchName + ' no soportado'); const c = f(this); c.parentProperty = this; this._children.push(c); return c; }
}

function prop(group, m, n, v) { return group.add(new Property(m, n, v, group)); }

// --- Fábricas de efectos y contenidos de forma ---
const effect = (match, name, param, value) => (parent) => { const g = new Group(match, name, parent); g.propertyType = 'NAMED_GROUP'; prop(g, param, name, value); return g; };
const factories = {
  'ADBE Slider Control': effect('ADBE Slider Control', 'Slider Control', 'ADBE Slider Control-0001', 0),
  'ADBE Angle Control': effect('ADBE Angle Control', 'Angle Control', 'ADBE Angle Control-0001', 0),
  'ADBE Checkbox Control': effect('ADBE Checkbox Control', 'Checkbox Control', 'ADBE Checkbox Control-0001', 0),
  'ADBE Layer Control': effect('ADBE Layer Control', 'Layer Control', 'ADBE Layer Control-0001', 0),
  'ADBE Point Control': effect('ADBE Point Control', 'Point Control', 'ADBE Point Control-0001', [0, 0]),
  'ADBE Dropdown Control': effect('ADBE Dropdown Control', 'Dropdown Menu Control', 'ADBE Dropdown Control-0001', 1),
  'ADBE Drop Shadow': effect('ADBE Drop Shadow', 'Drop Shadow', 'ADBE Drop Shadow-0001', 0),
  'ADBE Vector Group': (parent) => { const g = new Group('ADBE Vector Group', 'Group', parent); g.add(new Group('ADBE Vectors Group', 'Contents', g)); const tr = g.add(new Group('ADBE Vector Transform Group', 'Transform', g)); prop(tr, 'ADBE Vector Anchor', 'Anchor', [0, 0]); prop(tr, 'ADBE Vector Position', 'Position', [0, 0]); prop(tr, 'ADBE Vector Scale', 'Scale', [100, 100]); prop(tr, 'ADBE Vector Rotation', 'Rotation', 0); prop(tr, 'ADBE Vector Skew', 'Skew', 0); prop(tr, 'ADBE Vector Skew Axis', 'Skew Axis', 0); prop(tr, 'ADBE Vector Group Opacity', 'Opacity', 100); return g; },
  'ADBE Vector Shape - Ellipse': (parent) => { const g = new Group('ADBE Vector Shape - Ellipse', 'Ellipse', parent); prop(g, 'ADBE Vector Ellipse Size', 'Size', [100, 100]); prop(g, 'ADBE Vector Ellipse Position', 'Position', [0, 0]); return g; },
  'ADBE Vector Shape - Rect': (parent) => { const g = new Group('ADBE Vector Shape - Rect', 'Rect', parent); prop(g, 'ADBE Vector Rect Size', 'Size', [100, 100]); prop(g, 'ADBE Vector Rect Position', 'Position', [0, 0]); prop(g, 'ADBE Vector Rect Roundness', 'Roundness', 0); return g; },
  'ADBE Vector Shape - Group': (parent) => { const g = new Group('ADBE Vector Shape - Group', 'Path', parent); prop(g, 'ADBE Vector Shape', 'Path', new Shape()); return g; },
  'ADBE Vector Graphic - Fill': (parent) => { const g = new Group('ADBE Vector Graphic - Fill', 'Fill', parent); prop(g, 'ADBE Vector Fill Color', 'Color', [1, 0, 0]); prop(g, 'ADBE Vector Fill Opacity', 'Opacity', 100); return g; },
  'ADBE Vector Graphic - Stroke': (parent) => { const g = new Group('ADBE Vector Graphic - Stroke', 'Stroke', parent); prop(g, 'ADBE Vector Stroke Color', 'Color', [1, 1, 1]); prop(g, 'ADBE Vector Stroke Opacity', 'Opacity', 100); prop(g, 'ADBE Vector Stroke Width', 'Stroke Width', 2); g.add(new Group('ADBE Vector Stroke Dashes', 'Dashes', g)); return g; },
  'ADBE Vector Filter - Repeater': (parent) => new Group('ADBE Vector Filter - Repeater', 'Repeater', parent),
  'ADBE Vector Filter - Trim': (parent) => new Group('ADBE Vector Filter - Trim', 'Trim Paths', parent),
  'ADBE Vector Filter - Merge': (parent) => { const g = new Group('ADBE Vector Filter - Merge', 'Merge Paths', parent); prop(g, 'ADBE Vector Merge Type', 'Mode', 1); return g; },
  'ADBE Vector Graphic - G-Fill': (parent) => { const g = new Group('ADBE Vector Graphic - G-Fill', 'Gradient Fill', parent); prop(g, 'ADBE Vector Fill Opacity', 'Opacity', 100); return g; },
  'ADBE Vector Graphic - G-Stroke': (parent) => { const g = new Group('ADBE Vector Graphic - G-Stroke', 'Gradient Stroke', parent); prop(g, 'ADBE Vector Stroke Opacity', 'Opacity', 100); prop(g, 'ADBE Vector Stroke Width', 'Stroke Width', 2); return g; },
  'ADBE Vector Shape - Star': (parent) => { const g = new Group('ADBE Vector Shape - Star', 'Polystar', parent); prop(g, 'ADBE Vector Star Type', 'Type', 1); prop(g, 'ADBE Vector Star Points', 'Points', 5); prop(g, 'ADBE Vector Star Position', 'Position', [0, 0]); prop(g, 'ADBE Vector Star Rotation', 'Rotation', 0); prop(g, 'ADBE Vector Star Inner Radius', 'Inner Radius', 50); prop(g, 'ADBE Vector Star Outer Radius', 'Outer Radius', 100); prop(g, 'ADBE Vector Star Inner Roundess', 'Inner Roundness', 0); prop(g, 'ADBE Vector Star Outer Roundess', 'Outer Roundness', 0); return g; },
  'ADBE Vector Stroke Dash 1': (parent) => new Property('ADBE Vector Stroke Dash 1', 'Dash', 10, parent),
  'ADBE Mask Atom': (parent) => { const g = new Group('ADBE Mask Atom', 'Mask', parent); g.maskMode = 'ADD'; g.inverted = false; prop(g, 'ADBE Mask Shape', 'Mask Path', new Shape()); prop(g, 'ADBE Mask Offset', 'Mask Expansion', 0); return g; }
};

const MaskMode = { NONE: 'NONE', ADD: 'ADD', SUBTRACT: 'SUBTRACT', INTERSECT: 'INTERSECT' };

// --- Capas ---
class Layer {
  constructor(comp, name, opts) {
    opts = opts || {};
    this.containingComp = comp; this.id = nextId++; this.name = name; this.comment = ''; this.enabled = true; this.selected = false; this.locked = false; this.guideLayer = false; this.threeDLayer = false; this.nullLayer = !!opts.nullLayer; this.hasVideo = true; this.solo = false; this.motionBlur = false;
    this._parent = null; this.startTime = 0; this._in = 0; this._out = comp.duration; this.source = opts.source || null; this.removed = false;
    const root = this._root = new Group('root', 'root');
    const tr = root.add(new Group('ADBE Transform Group', 'Transform', root));
    prop(tr, 'ADBE Anchor Point', 'Anchor Point', [0, 0]);
    const pos = prop(tr, 'ADBE Position', 'Position', [comp.width / 2, comp.height / 2]);
    prop(tr, 'ADBE Position_0', 'X Position', comp.width / 2); prop(tr, 'ADBE Position_1', 'Y Position', comp.height / 2);
    prop(tr, 'ADBE Scale', 'Scale', [100, 100]); prop(tr, 'ADBE Rotate Z', 'Rotation', 0); prop(tr, 'ADBE Opacity', 'Opacity', 100);
    pos.ownerTime = () => comp.time;
    root.add(new Group('ADBE Effect Parade', 'Effects', root));
    const marker = prop(root, 'ADBE Marker', 'Marker', null);
    marker.setValueAtTime = function (t, v) { const i = this.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6); if (i >= 0) this.keys[i].v = v; else { this.keys.push({ t, v }); this.keys.sort((a, b) => a.t - b.t); } };
    marker.keyValue = function (i) { return this.keys[i - 1].v; };
    root.add(new Group('ADBE Mask Parade', 'Masks', root));
    for (const p of tr._children) p.ownerTime = () => comp.time;
  }
  property(k) { return this._root.property(k); }
  get transform() { const tr = this.property('ADBE Transform Group'); return { position: tr.property('ADBE Position'), rotation: tr.property('ADBE Rotate Z'), scale: tr.property('ADBE Scale'), anchorPoint: tr.property('ADBE Anchor Point'), opacity: tr.property('ADBE Opacity') }; }
  get index() { return this.containingComp._layers.indexOf(this) + 1; }
  get inPoint() { return this._in; } set inPoint(v) { if (v >= this._out) throw Error('inPoint >= outPoint'); this._in = v; }
  get outPoint() { return this._out; } set outPoint(v) { if (v <= this._in) throw Error('outPoint <= inPoint'); this._out = v; }
  get parent() { return this._parent; }
  // Como el selector de padre: conserva la posición visual (para escalas uniformes positivas, sin claves en el padre).
  set parent(p) {
    const tr = this.property('ADBE Transform Group'), t = this.containingComp.time;
    const w = MockAE.world(this, t), anchor = tr.property('ADBE Anchor Point').valueAtTime(t);
    let rot = 0, sx = 1, sy = 1, l = this;
    while (l) { const lt = l.property('ADBE Transform Group'); rot += lt.property('ADBE Rotate Z').valueAtTime(t); if (l !== this) { const s = lt.property('ADBE Scale').valueAtTime(t); sx *= s[0] / 100; sy *= s[1] / 100; } l = l._parent; }
    this._parent = p;
    if (p) throw Error('el mock solo compensa al quitar el padre');
    const o = MockAE.apply(w, anchor), P = tr.property('ADBE Position');
    if (P.numKeys) { const d = [o[0] - P.valueAtTime(t)[0], o[1] - P.valueAtTime(t)[1]]; P.keys.forEach((k) => { k.v = [k.v[0] + d[0], k.v[1] + d[1]]; }); } else P._value = [o[0], o[1]];
    const R = tr.property('ADBE Rotate Z'), dr = rot - R.valueAtTime(t);
    if (R.numKeys) R.keys.forEach((k) => { k.v += dr; }); else R._value = rot;
    const S = tr.property('ADBE Scale'), s = S.valueAtTime(t);
    if (!S.numKeys) S._value = [s[0] * sx, s[1] * sy];
  }
  setParentWithJump(p) { this._parent = p; }
  sourceRectAtTime(t) {
    if (this._rect) return this._rect;
    if (this.source && this.source.width) return { left: 0, top: 0, width: this.source.width, height: this.source.height };
    const b = MockAE.shapeBounds(this, t);
    return b || { left: 0, top: 0, width: 0, height: 0 };
  }
  sourceTime(t) { return t - this.startTime; }
  moveToEnd() { const L = this.containingComp._layers; L.splice(L.indexOf(this), 1); L.push(this); }
  moveBefore(other) { const L = this.containingComp._layers; L.splice(L.indexOf(this), 1); L.splice(L.indexOf(other), 0, this); }
  remove() { if (this.locked) throw Error('capa bloqueada'); const L = this.containingComp._layers; L.splice(L.indexOf(this), 1); this.removed = true; }
  duplicate() {
    const c = this.containingComp, d = Object.create(Object.getPrototypeOf(this));
    Object.assign(d, this); d.id = nextId++; d._root = deepCopyGroup(this._root, null, c); d.selected = false;
    c._layers.splice(this.index - 1, 0, d);
    return d;
  }
  copyToComp(target) {
    const d = Object.create(Object.getPrototypeOf(this));
    Object.assign(d, this); d.id = nextId++; d.containingComp = target; d._root = deepCopyGroup(this._root, null, target); d._parent = null;
    target._layers.unshift(d);
  }
}
function deepCopyGroup(g, parent, comp) {
  const n = Object.create(Object.getPrototypeOf(g));
  Object.assign(n, g); n.parentProperty = parent;
  if (g._children) n._children = g._children.map((c) => deepCopyGroup(c, n, comp));
  if (g.keys) { n.keys = g.keys.map((k) => ({ t: k.t, v: clone(k.v) })); n._value = clone(g._value); if (g.ownerTime) n.ownerTime = () => comp.time; }
  return n;
}
class AVLayer extends Layer {}
class ShapeLayer extends AVLayer { constructor(c, n) { super(c, n); this._root.add(new Group('ADBE Root Vectors Group', 'Contents', this._root)); } }
class TextLayer extends AVLayer {}

class Item { constructor(name) { this.id = nextId++; this.name = name; this.parentFolder = null; } remove() { MockAE.project._items.splice(MockAE.project._items.indexOf(this), 1); this.removed = true; } }
class FolderItem extends Item {}
class SolidSource { constructor(color) { this.color = color; this.hasAlpha = false; } }
class FileSource { constructor(hasAlpha) { this.hasAlpha = hasAlpha; } }
class FootageItem extends Item { constructor(name, w, h, mainSource, alphaFn) { super(name); this.width = w; this.height = h; this.mainSource = mainSource; this.alphaFn = alphaFn; } }
class CompItem extends Item {
  constructor(name, w, h, pa, dur, fps) { super(name); this.width = w; this.height = h; this.pixelAspect = pa; this.duration = dur; this.frameRate = fps; this.frameDuration = 1 / fps; this.workAreaStart = 0; this.workAreaDuration = dur; this.time = 0; this._layers = []; this.bgColor = [0, 0, 0]; const c = this;
    this.layers = {
      addNull(d) { const l = new AVLayer(c, 'Null', { nullLayer: true }); l.hasVideo = false; c._layers.unshift(l); return l; },
      addShape() { const l = new ShapeLayer(c, 'Shape Layer'); c._layers.unshift(l); return l; },
      addSolid(color, name, w, h) { const src = new FootageItem(name, w, h, new SolidSource(color)); const l = new AVLayer(c, name, { source: src }); l.property('ADBE Transform Group').property('ADBE Anchor Point')._value = [w / 2, h / 2]; c._layers.unshift(l); return l; },
      addText(text) { const l = new TextLayer(c, text); l.source = null; c._layers.unshift(l); return l; },
      // Precomposición: la capa usa una CompItem como fuente; alphaFn describe su contenido en píxeles de la precomp.
      addPrecomp(comp) { const l = new AVLayer(c, comp.name, { source: comp }); l.property('ADBE Transform Group').property('ADBE Anchor Point')._value = [comp.width / 2, comp.height / 2]; c._layers.unshift(l); return l; },
      add(item) { const l = new AVLayer(c, item.name, { source: item }); l.property('ADBE Transform Group').property('ADBE Anchor Point')._value = [item.width / 2, item.height / 2]; c._layers.unshift(l); return l; }
    };
  }
  get numLayers() { return this._layers.length; }
  layer(i) { return this._layers[i - 1]; }
  get selectedLayers() { return this._layers.filter((l) => l.selected); }
  saveFrameToPng(t, file) {
    // Rasteriza el alfa de la capa copiada (fuente de metraje con alphaFn o rectángulo de la fuente) con su transformación.
    const w = this.width, h = this.height, alpha = new Uint8Array(w * h);
    for (const l of this._layers) {
      if (!l.enabled) continue;
      const m = MockAE.world(l, t), inv = MockAE.invert(m), fn = l._alphaFn || (l.source && l.source.alphaFn), r = l.sourceRectAtTime(t);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = MockAE.apply(inv, [x + 0.5, y + 0.5]);
        const inside = fn ? fn(p[0], p[1]) : (p[0] >= r.left && p[0] < r.left + r.width && p[1] >= r.top && p[1] < r.top + r.height);
        if (inside) alpha[y * w + x] = 255;
      }
    }
    MockAE.stats.pngs++;
    fs.writeFileSync(file.fsName, MockAE.png(w, h, alpha));
  }
}

const MockAE = {
  stats: { setValuesAtTimes: 0, pngs: 0, undoOpen: 0, undoGroups: [] },
  failDropdown: false,
  apply(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; },
  mul(a, b) { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; },
  invert(m) { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; },
  local(l, t) {
    const tr = l.property('ADBE Transform Group'), a = tr.property('ADBE Anchor Point').valueAtTime(t), P = tr.property('ADBE Position');
    const p = P.dimensionsSeparated ? [tr.property('ADBE Position_0').valueAtTime(t), tr.property('ADBE Position_1').valueAtTime(t)] : P.valueAtTime(t);
    const s = tr.property('ADBE Scale').valueAtTime(t), r = tr.property('ADBE Rotate Z').valueAtTime(t) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
    return MockAE.mul([c, sn, -sn, c, p[0], p[1]], MockAE.mul([s[0] / 100, 0, 0, s[1] / 100, 0, 0], [1, 0, 0, 1, -a[0], -a[1]]));
  },
  world(l, t) { let m = MockAE.local(l, t); let p = l._parent; while (p) { m = MockAE.mul(MockAE.local(p, t), m); p = p._parent; } return m; },
  shapeBounds(l) {
    const root = l.property('ADBE Root Vectors Group'); if (!root) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (function walk(g, off) {
      for (const c of g._children) {
        if (c.matchName === 'ADBE Vector Group') { const p = c.property('ADBE Vector Transform Group').property('ADBE Vector Position').value; walk(c.property('ADBE Vectors Group'), [off[0] + p[0], off[1] + p[1]]); }
        else if (c.matchName === 'ADBE Vector Shape - Ellipse' || c.matchName === 'ADBE Vector Shape - Rect') { const s = c._children[0].value, p = c._children[1].value; x0 = Math.min(x0, off[0] + p[0] - s[0] / 2); x1 = Math.max(x1, off[0] + p[0] + s[0] / 2); y0 = Math.min(y0, off[1] + p[1] - s[1] / 2); y1 = Math.max(y1, off[1] + p[1] + s[1] / 2); }
        else if (c.matchName === 'ADBE Vector Shape - Group') { for (const v of c._children[0].value.vertices) { x0 = Math.min(x0, off[0] + v[0]); x1 = Math.max(x1, off[0] + v[0]); y0 = Math.min(y0, off[1] + v[1]); y1 = Math.max(y1, off[1] + v[1]); } }
      }
    })(root, [0, 0]);
    return isFinite(x0) ? { left: x0, top: y0, width: x1 - x0, height: y1 - y0 } : { left: 0, top: 0, width: 0, height: 0 };
  },
  png(w, h, alpha) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; raw[o + 3] = alpha[y * w + x]; } }
    const crcTable = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (tag, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(tag), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
};

// Crea un contexto con `app` y los globales de ExtendScript y carga gravedad.jsx.
function createHost(hostDir) {
  nextId = 1;
  MockAE.stats = { setValuesAtTimes: 0, pngs: 0, undoOpen: 0, undoGroups: [] };
  const project = { _items: [], get numItems() { return this._items.length; }, item(i) { return this._items[i - 1]; }, activeItem: null,
    items: { addComp(name, w, h, pa, dur, fps) { const c = new CompItem(name, w, h, pa, dur, fps); project._items.push(c); return c; }, addFolder(name) { const f = new FolderItem(name); project._items.push(f); return f; } } };
  MockAE.project = project;
  const app = {
    project,
    beginUndoGroup(n) { if (MockAE.stats.undoOpen) throw Error('grupo de deshacer anidado: ' + n); MockAE.stats.undoOpen++; MockAE.stats.undoGroups.push(n); },
    endUndoGroup() { MockAE.stats.undoOpen--; },
    beginSuppressDialogs() {}, endSuppressDialogs() {},
    activeViewer: null
  };
  class File { constructor(p) { this.fsName = path.resolve(String(p)); } get exists() { return fs.existsSync(this.fsName); } get parent() { return new Folder(path.dirname(this.fsName)); } }
  class Folder { constructor(p) { this.fsName = path.resolve(String(p)); } get exists() { return fs.existsSync(this.fsName); } create() { fs.mkdirSync(this.fsName, { recursive: true }); return true; } }
  Folder.temp = new Folder(require('os').tmpdir());
  class MarkerValue { constructor(comment) { this.comment = comment; } }
  const ctx = { MarkerValue, app, CompItem, FootageItem, FolderItem, AVLayer, ShapeLayer, TextLayer, SolidSource, MaskMode, Shape, File, Folder, ViewerType: { VIEWER_COMPOSITION: 1 }, PropertyType: { PROPERTY: 'PROPERTY' }, Math, Date, Error, String, Number, Array, Object, RegExp, isFinite, parseFloat };
  ctx.$ = { fileName: '', evalFile(f) { const file = f.fsName || f; const code = fs.readFileSync(file, 'utf8'); ctx.$.fileName = file; vm.runInContext(code, ctx, { filename: file }); } };
  vm.createContext(ctx);
  // json2 solo se carga si falta JSON: en Node existe, así que se fuerza para probar el mismo camino que en After.
  vm.runInContext('var JSON = undefined;', ctx);
  ctx.$.evalFile(new File(path.join(hostDir, 'gravedad.jsx')));
  return { ctx, app, project, call(method, arg) { const raw = vm.runInContext('Gravedad.' + method + '(' + (arg === undefined ? '' : JSON.stringify(JSON.stringify(arg))) + ')', ctx); const r = JSON.parse(raw); if (MockAE.stats.undoOpen) throw Error('grupo de deshacer abierto tras ' + method); return r; } };
}

module.exports = { createHost, MockAE, Shape, FootageItem, FileSource, CompItem };
