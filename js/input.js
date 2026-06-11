/* Unified input: keyboard (WASD/arrows + Space/F/E) and touch
   (left-half virtual joystick + right-side fire buttons).
   Also hardens the page against mobile gestures that reload or scroll
   the page mid-steer (pull-to-refresh, overscroll nav, pinch zoom). */

const Input = (() => {
  const keys = new Set();

  const state = {
    // keyboard tank controls
    forward: 0,        // -1..1
    turn: 0,           // -1..1
    // joystick (touch): when active, gives a desired world heading
    joyActive: false,
    joyAngle: 0,
    joyMag: 0,
    // weapons (true while requested)
    fireShell: false,
    fireMG: false,
    dropMine: false,   // edge-triggered; consumed by game
    anyInput: false,
  };

  /* ---------- keyboard ---------- */

  const PREVENT_KEYS = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar',
  ]);

  window.addEventListener('keydown', (e) => {
    if (PREVENT_KEYS.has(e.key)) e.preventDefault(); // stop page scroll
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyE') state.dropMine = true;
    state.anyInput = true;
    refreshKeyboardAxes();
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    refreshKeyboardAxes();
  });

  window.addEventListener('blur', () => {
    keys.clear();
    refreshKeyboardAxes();
  });

  function refreshKeyboardAxes() {
    const up = keys.has('KeyW') || keys.has('ArrowUp');
    const down = keys.has('KeyS') || keys.has('ArrowDown');
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    state.forward = (up ? 1 : 0) - (down ? 1 : 0);
    state.turn = (right ? 1 : 0) - (left ? 1 : 0);
    state.fireShell = keys.has('Space');
    state.fireMG = keys.has('KeyF') || keys.has('ShiftLeft') || keys.has('ShiftRight');
  }

  /* ---------- mobile reload / gesture prevention ---------- */

  // Block pull-to-refresh and rubber-band scrolling everywhere in the game.
  document.addEventListener('touchmove', (e) => {
    e.preventDefault();
  }, { passive: false });

  // Block iOS pinch-zoom gestures.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());

  // Block double-tap zoom (rapid second tap).
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 350) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener('contextmenu', (e) => e.preventDefault());

  /* ---------- touch joystick ---------- */

  // Fixed circle-in-circle joystick: the base stays anchored bottom-left
  // and the thumb knob deflects from the base center.
  const stickZone = document.getElementById('stickZone');
  const stickBase = document.getElementById('stickBase');
  const stickThumb = document.getElementById('stickThumb');
  const GRAB_RADIUS = 110; // how far from the stick a touch may start and still grab it

  let stickTouchId = null;
  let stickCenter = { x: 0, y: 0 };

  // Base/thumb sizes change with screen size (media queries), so measure live.
  function stickMetrics() {
    const b = stickBase.clientWidth || 124;
    const t = stickThumb.clientWidth || 56;
    return { center: (b - t) / 2, range: b / 2 - 14 };
  }

  function setThumb(dx, dy) {
    const m = stickMetrics();
    stickThumb.style.left = (m.center + dx) + 'px';
    stickThumb.style.top = (m.center + dy) + 'px';
  }

  function applyDeflection(clientX, clientY) {
    const range = stickMetrics().range;
    let dx = clientX - stickCenter.x;
    let dy = clientY - stickCenter.y;
    const d = Math.hypot(dx, dy);
    const mag = Math.min(1, d / range);
    if (d > range) { dx = dx / d * range; dy = dy / d * range; }
    setThumb(dx, dy);
    if (mag > 0.12) {
      state.joyActive = true;
      state.joyAngle = Math.atan2(dy, dx);
      state.joyMag = mag;
    } else {
      state.joyActive = false;
      state.joyMag = 0;
    }
  }

  stickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickTouchId !== null) return;
    const t = e.changedTouches[0];
    const r = stickBase.getBoundingClientRect();
    stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    // only grab when the touch starts on or near the stick
    if (Math.hypot(t.clientX - stickCenter.x, t.clientY - stickCenter.y) > GRAB_RADIUS) return;
    stickTouchId = t.identifier;
    stickBase.classList.add('active');
    stickThumb.classList.remove('spring');
    applyDeflection(t.clientX, t.clientY);
    state.anyInput = true;
  }, { passive: false });

  stickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouchId) continue;
      applyDeflection(t.clientX, t.clientY);
    }
  }, { passive: false });

  function endStick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouchId) continue;
      stickTouchId = null;
      state.joyActive = false;
      state.joyMag = 0;
      stickBase.classList.remove('active');
      stickThumb.classList.add('spring'); // knob springs back to center
      setThumb(0, 0);
    }
  }
  stickZone.addEventListener('touchend', endStick);
  stickZone.addEventListener('touchcancel', endStick);

  /* ---------- touch buttons ---------- */

  function bindButton(id, onDown, onUp) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      state.anyInput = true;
      onDown();
    }, { passive: false });
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('pressed');
      if (onUp) onUp();
    };
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    return el;
  }

  let touchShell = false, touchMG = false;
  bindButton('btnShell', () => { touchShell = true; }, () => { touchShell = false; });
  bindButton('btnMG', () => { touchMG = true; }, () => { touchMG = false; });
  bindButton('btnMine', () => { state.dropMine = true; });

  // Reveal touch controls the moment any touch happens. The control deck
  // changes the playfield size, so the game must re-measure its canvas.
  function enableTouchUI() {
    if (document.body.classList.contains('has-touch')) return;
    document.body.classList.add('has-touch');
    window.dispatchEvent(new Event('resize'));
  }
  window.addEventListener('touchstart', enableTouchUI, { once: true, passive: true });
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    enableTouchUI();
  }

  /* ---------- polling API used by the game loop ---------- */

  function read() {
    return {
      forward: state.forward,
      turn: state.turn,
      joyActive: state.joyActive,
      joyAngle: state.joyAngle,
      joyMag: state.joyMag,
      fireShell: state.fireShell || touchShell,
      fireMG: state.fireMG || touchMG,
    };
  }

  // Edge-triggered mine drop: returns true once per press.
  function consumeMine() {
    const v = state.dropMine;
    state.dropMine = false;
    return v;
  }

  return { read, consumeMine, state };
})();
