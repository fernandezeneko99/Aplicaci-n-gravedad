/*
 * Gravedad · medidor de fotogramas (al estilo de la caché de Blender).
 * Una tira con un hueco por fotograma del área de trabajo:
 *   verde = simulado · naranja rayado = simulado pero la escena cambió · rojo = calculando · oscuro = sin simular.
 * Marcas blancas arriba = choques. Línea rosa = tiempo actual de After. Clic/arrastrar = mover el tiempo.
 */
(function (root) {
  'use strict';
  var C = { track: '#25212b', cell: '#2d2834', done: '#6fbf73', doneEdge: '#8fd694', stale: '#f5c58a', staleDark: '#b98a4f', running: '#e9806a', head: '#ff8fb1', tick: '#f4eff7', text: '#f4eff7', label: '#16141b' };

  function FrameMeter(canvas, onSeek) {
    this.canvas = canvas; this.onSeek = onSeek;
    this.state = { frames: 0, first: 0, simulated: 0, stale: false, running: null, contacts: [], playhead: null, hover: null };
    var self = this, dragging = false;
    function frameAt(e) { var r = canvas.getBoundingClientRect(); return Math.max(0, Math.min(self.state.frames - 1, Math.floor((e.clientX - r.left) / r.width * self.state.frames))); }
    canvas.addEventListener('pointerdown', function (e) { if (!self.state.frames) return; dragging = true; canvas.setPointerCapture(e.pointerId); var k = frameAt(e); self.set({ playhead: k }); if (self.onSeek) self.onSeek(k, false); });
    canvas.addEventListener('pointermove', function (e) {
      if (!self.state.frames) return;
      var k = frameAt(e); self.set({ hover: k });
      if (dragging) { self.set({ playhead: k }); if (self.onSeek) self.onSeek(k, false); }
    });
    canvas.addEventListener('pointerup', function (e) { if (dragging && self.onSeek) self.onSeek(frameAt(e), true); dragging = false; });
    canvas.addEventListener('pointerleave', function () { self.set({ hover: null }); });
    if (root.ResizeObserver) new root.ResizeObserver(function () { self.draw(); }).observe(canvas);
  }

  FrameMeter.prototype.set = function (patch) {
    var changed = false;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k) && this.state[k] !== patch[k]) { this.state[k] = patch[k]; changed = true; }
    if (changed) this.draw();
  };

  FrameMeter.prototype.draw = function () {
    var cv = this.canvas, s = this.state, dpr = root.devicePixelRatio || 1, w = Math.max(10, cv.clientWidth), h = Math.max(10, cv.clientHeight);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var top = 8, bar = h - top - 4, n = s.frames;
    ctx.fillStyle = C.track; roundRect(ctx, 0, top, w, bar, 5); ctx.fill();
    if (!n) return;
    var step = w / n, gap = step >= 4 ? 1 : 0;
    ctx.save(); roundRect(ctx, 0, top, w, bar, 5); ctx.clip();
    // Fotogramas sin simular (huecos visibles solo si caben).
    if (gap) { ctx.fillStyle = C.cell; for (var i = 0; i < n; i++) ctx.fillRect(i * step, top, step - gap, bar); }
    // Simulados (o desactualizados).
    var done = Math.min(n, s.running !== null ? 0 : s.simulated);
    if (done > 0) {
      ctx.fillStyle = s.stale ? C.stale : C.done;
      ctx.fillRect(0, top, done * step - gap, bar);
      if (s.stale) {
        ctx.strokeStyle = C.staleDark; ctx.lineWidth = 3; ctx.beginPath();
        for (var x = -bar; x < done * step; x += 9) { ctx.moveTo(x, top + bar); ctx.lineTo(x + bar, top); }
        ctx.stroke();
      }
      if (gap) { ctx.fillStyle = C.track; for (i = 1; i < done; i++) ctx.fillRect(i * step - gap, top, gap, bar); }
    }
    // En curso: rojo hasta el fotograma calculado.
    if (s.running !== null) {
      ctx.fillStyle = C.running; ctx.fillRect(0, top, Math.min(n, s.running) * step, bar);
      ctx.fillStyle = '#fff3'; ctx.fillRect(Math.max(0, Math.min(n, s.running) * step - 2), top, 2, bar);
    }
    ctx.restore();
    // Choques.
    if (s.contacts && s.contacts.length) {
      ctx.fillStyle = C.tick;
      var seen = {};
      for (i = 0; i < s.contacts.length; i++) { var px = Math.round((s.contacts[i] + 0.5) * step); if (seen[px]) continue; seen[px] = 1; ctx.fillRect(px - 0.5, 1, 1, top - 2); }
    }
    // Tiempo actual de After.
    if (s.playhead !== null && s.playhead >= 0 && s.playhead < n) {
      var hx = (s.playhead + 0.5) * step;
      ctx.fillStyle = C.head; ctx.fillRect(hx - 1, top - 3, 2, bar + 5);
      ctx.beginPath(); ctx.moveTo(hx - 5, top - 6); ctx.lineTo(hx + 5, top - 6); ctx.lineTo(hx, top); ctx.closePath(); ctx.fill();
    }
    // Fotograma bajo el ratón.
    if (s.hover !== null) {
      ctx.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      var label = String(s.first + s.hover), tw = ctx.measureText(label).width + 10, lx = Math.max(0, Math.min(w - tw, (s.hover + 0.5) * step - tw / 2));
      ctx.fillStyle = C.label; roundRect(ctx, lx, top + bar / 2 - 9, tw, 18, 4); ctx.fill();
      ctx.fillStyle = C.text; ctx.textBaseline = 'middle'; ctx.fillText(label, lx + 5, top + bar / 2);
    }
  };

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  root.FrameMeter = FrameMeter;
}(typeof self !== 'undefined' ? self : this));
