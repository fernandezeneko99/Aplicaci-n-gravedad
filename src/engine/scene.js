/*
 * Gravedad · de la escena leída en After a la escena del motor, y del resultado al archivo que After aplica.
 * Las formas llegan en coordenadas de capa junto con la matriz de la capa (capa → composición);
 * el motor las quiere relativas al cuerpo (origen en el punto de anclaje, sin rotación).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GravedadScene = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function apply(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }

  // Capa → cuerpo: primero a la composición con la matriz, luego relativo a la pose (origen y ángulo).
  function toBody(matrix, pose) {
    var a = -pose.a * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return function (p) { var w = apply(matrix, p), dx = w[0] - pose.x, dy = w[1] - pose.y; return [c * dx - s * dy, s * dx + c * dy]; };
  }

  function uniformScale(m) {
    var sx = Math.sqrt(m[0] * m[0] + m[1] * m[1]), sy = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
    var ortho = Math.abs(m[0] * m[2] + m[1] * m[3]) <= 1e-6 * Math.max(1, sx * sy);
    return ortho && Math.abs(sx - sy) <= 0.01 * Math.max(sx, sy) ? sx : 0;
  }

  function rectContour(r) { var x0 = r.x - r.w / 2, y0 = r.y - r.h / 2; return [[x0, y0], [x0 + r.w, y0], [x0 + r.w, y0 + r.h], [x0, y0 + r.h]]; }
  function circleContour(c) { var out = []; for (var i = 0; i < 32; i++) { var a = i / 32 * Math.PI * 2; out.push([c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r]); } return out; }

  // layerShape: {kind:'rect'|'circle'|'contours'|'stroke'} o contornos de alfa {contours} ya en coordenadas de capa.
  function bodyShape(layerShape, matrix, pose) {
    if (!layerShape) throw Error('Sin forma');
    var f = toBody(matrix, pose), map = function (list) { return list.map(f); };
    if (layerShape.kind === 'circle') {
      var k = uniformScale(matrix);
      if (k) { var c = f([layerShape.x, layerShape.y]); return { kind: 'circle', x: c[0], y: c[1], r: layerShape.r * k }; }
      return { kind: 'poly', contours: [map(circleContour(layerShape))] };
    }
    if (layerShape.kind === 'rect') return { kind: 'poly', contours: [map(rectContour(layerShape))], tolerance: 0 };
    if (layerShape.kind === 'stroke') {
      var det = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
      return { kind: 'stroke', thickness: layerShape.thickness * Math.sqrt(det), paths: layerShape.paths.map(function (p) { return { points: map(p.points), closed: !!p.closed }; }) };
    }
    return { kind: 'poly', contours: layerShape.contours.map(map) };
  }

  // Contornos del alfa (píxeles del PNG) → coordenadas de capa.
  function rasterToLayer(contours, job) {
    return { kind: 'contours', contours: contours.map(function (c) { return c.map(function (p) { return [job.left + p[0] / job.scale, job.top + p[1] / job.scale]; }); }) };
  }

  // host: escena de gravedad.jsx con layerShape resuelto en cada cuerpo/emisor.
  function build(host) {
    var scene = { fps: host.fps, frames: host.frames, width: host.width, height: host.height, world: host.world, bodies: [], forces: host.forces || [], emitters: [] };
    host.bodies.forEach(function (b) {
      scene.bodies.push({ id: b.id, type: b.type, spawn: b.spawn, despawn: b.despawn, pose: b.pose, velocity: b.velocity, track: b.track, material: b.material, shape: bodyShape(b.layerShape, b.matrix, b.pose) });
    });
    (host.emitters || []).forEach(function (e) {
      scene.emitters.push({ id: e.id, from: e.from, to: e.to, max: e.max, lifetime: e.lifetime, size: e.size, sizeVariation: e.sizeVariation, speedVariation: e.speedVariation, spin: e.spin, randomRotation: e.randomRotation, seed: e.seed, material: e.material, track: e.track, shape: bodyShape(e.layerShape, e.matrix, e.templatePose) });
    });
    return scene;
  }

  // Lo que After necesita para escribir: solo los cuerpos dinámicos y las partículas.
  function payload(host, result) {
    var bodies = {}, emitters = {};
    host.bodies.forEach(function (b) { if (b.type === 'dynamic' && result.bodies[b.id]) bodies[b.id] = result.bodies[b.id]; });
    (host.emitters || []).forEach(function (e) { emitters[e.id] = { template: e.template, templateAngle: e.templatePose.a }; });
    return { compId: host.compId, frames: host.frames, bodies: bodies, particles: result.particles, emitters: emitters };
  }

  function script(data) { return 'Gravedad._incoming = ' + JSON.stringify(data) + ';\n'; }

  return { build: build, payload: payload, script: script, bodyShape: bodyShape, rasterToLayer: rasterToLayer, toBody: toBody };
}));
