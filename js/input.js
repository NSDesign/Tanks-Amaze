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

  const stickZone = document.getElementById('stickZone');
  const stickBase = document.getElementById('stickBase');
  const stickThumb = document.getElementById('stickThumb');
  const STICK_RANGE = 46; // px of thumb travel

  let stickTouchId = null;
  let stickOrigin = { x: 0, y: 0 };

  function setThumb(dx, dy) {
    stickThumb.style.left = (32 + dx) + 'px';
    stickThumb.style.top = (32 + dy) + 'px';
  }

  stickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickTouchId !== null) return;
    const t = e.changedTouches[0];
    stickTouchId = t.identifier;
    stickOrigin = { x: t.clientX, y: t.clientY };
    stickBase.classList.add('active');
    stickBase.style.left = (t.clientX - 62) + 'px';
    stickBase.style.top = (t.clientY - 62) + 'px';
    stickBase.style.bottom = 'auto';
    setThumb(0, 0);
    state.anyInput = true;
  }, { passive: false });

  stickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouchId) continue;
      let dx = t.clientX - stickOrigin.x;
      let dy = t.clientY - stickOrigin.y;
      const d = Math.hypot(dx, dy);
      const mag = Math.min(1, d / STICK_RANGE);
      if (d > STICK_RANGE) { dx = dx / d * STICK_RANGE; dy = dy / d * STICK_RANGE; }
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
  }, { passive: false });

  function endStick(e) {
    for (const t of e.changedTouches) {
      if (t.identifier !== stickTouchId) continue;
      stickTouchId = null;
      state.joyActive = false;
      state.joyMag = 0;
      stickBase.classList.remove('active');
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

  // Reveal touch controls the moment any touch happens.
  window.addEventListener('touchstart', () => {
    document.body.classList.add('has-touch');
  }, { once: true, passive: true });
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    document.body.classList.add('has-touch');
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
