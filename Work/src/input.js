// Swipe / keyboard -> a swing intent { kind, aim, depth, pace, curve }.
// Touch and mouse: swipe up = drive (angle aims, length sets depth, speed sets power), tap = push,
// swipe down = lob. Release as the ring closes. Keyboard: Space drive, Z push, C lob,
// arrows / A D aim, up-down depth, Shift hard.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const Input = {
  enabled: true, sens: 1, onSwing: null, keys: {}, drag: null, el: null, dot: null
};

Input.init = function (canvas, dotEl, onSwing) {
  Input.el = canvas; Input.dot = dotEl; Input.onSwing = onSwing;
  canvas.addEventListener("pointerdown", (e) => {
    if (!Input.enabled) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
    Input.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now() };
    if (dotEl) { dotEl.hidden = false; dotEl.style.left = e.clientX + "px"; dotEl.style.top = e.clientY + "px"; }
  });
  canvas.addEventListener("pointermove", (e) => {
    const d = Input.drag; if (!d || e.pointerId !== d.id) return;
    d.x = e.clientX; d.y = e.clientY;
    if (dotEl) { dotEl.style.left = e.clientX + "px"; dotEl.style.top = e.clientY + "px"; }
  });
  const end = (e) => {
    const d = Input.drag; if (!d || e.pointerId !== d.id) return;
    Input.drag = null;
    if (dotEl) dotEl.hidden = true;
    if (!Input.enabled || e.type === "pointercancel") return;
    const it = Input.fromSwipe(d.x0, d.y0, e.clientX, e.clientY, performance.now() - d.t0);
    if (it && Input.onSwing) Input.onSwing(it);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  // iOS Safari ignores user-scalable=no: stop double-tap zoom and pinch.
  let lastTouch = 0;
  document.addEventListener("touchend", (e) => { const n = Date.now(); if (n - lastTouch < 350) e.preventDefault(); lastTouch = n; }, { passive: false });
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    Input.keys[k] = true;
    if (!Input.enabled) return;
    let kind = null;
    if (k === " " || k === "Enter") kind = "drive";
    else if (k === "z" || k === "x") kind = "push";
    else if (k === "c") kind = "lob";
    if (!kind) return;
    e.preventDefault();
    const K = Input.keys;
    const aim = (K.ArrowRight || K.d ? 1 : 0) - (K.ArrowLeft || K.a ? 1 : 0);
    const depth = K.ArrowUp || K.w ? 0.95 : K.ArrowDown || K.s ? 0.15 : 0.6;
    const pace = e.shiftKey ? 0.95 : kind === "push" ? 0.3 : kind === "lob" ? 0.4 : 0.55;
    if (Input.onSwing) Input.onSwing({ kind, aim: aim * 0.8, depth, pace, curve: 0 });
  });
  window.addEventListener("keyup", (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; Input.keys[k] = false; });
  window.addEventListener("blur", () => { Input.keys = {}; Input.drag = null; if (dotEl) dotEl.hidden = true; });
};

Input.fromSwipe = function (x0, y0, x1, y1, ms) {
  const W = window.innerWidth, H = window.innerHeight;
  const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy);
  const fingerW = Math.min(W, H);
  if (dist < 22) {
    // A tap: a short push, aimed by where you tapped.
    return { kind: "push", aim: clamp((x1 / W - 0.5) * 1.2, -0.8, 0.8), depth: 0.4, pace: 0.3, curve: 0 };
  }
  const aim = clamp(dx / (fingerW * 0.35), -1, 1);
  const v = dist / Math.max(40, ms);            // px per ms
  if (dy > 0 && dy > Math.abs(dx) * 0.6) {
    return { kind: "lob", aim: aim * 0.8, depth: clamp(dy / (H * 0.4), 0.2, 1), pace: 0.4, curve: 0 };
  }
  const pace = clamp((v * Input.sens - 0.45) / 2.0, 0.05, 1);
  const depth = clamp(Math.abs(dy) / (H * 0.42), 0.1, 1);
  return { kind: "drive", aim, depth, pace, curve: 0 };
};
