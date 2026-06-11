/* Tanks Amaze — aerial capture-the-flag through maze terrains.
   Main loop, levels/themes, AI, CTF rules, HUD, rendering, audio. */

(() => {
  'use strict';

  /* ---------- roundRect polyfill (older mobile browsers) ---------- */
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  /* ============================ Audio ============================ */

  const sfx = (() => {
    let ac = null;
    function ctx() {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function tone(freq, dur, type, vol, slideTo) {
      const a = ctx();
      if (!a) return;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g).connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    }
    function blast(dur, vol) {
      const a = ctx();
      if (!a) return;
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource();
      src.buffer = buf;
      const g = a.createGain();
      g.gain.setValueAtTime(vol, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 900;
      src.connect(f).connect(g).connect(a.destination);
      src.start();
    }
    return {
      unlock() { ctx(); },
      shell() { tone(180, 0.18, 'square', 0.12, 50); blast(0.12, 0.1); },
      mg() { tone(900, 0.05, 'square', 0.05, 300); },
      mine() { tone(300, 0.15, 'sine', 0.12, 120); },
      beep() { tone(1250, 0.07, 'square', 0.06); },
      boomSmall() { blast(0.25, 0.18); },
      boomBig() { blast(0.6, 0.32); tone(70, 0.5, 'sine', 0.25, 30); },
      clank() { tone(140, 0.1, 'sawtooth', 0.1, 60); },
      pickup() { tone(520, 0.1, 'square', 0.1, 780); },
      capture() { tone(440, 0.12, 'square', 0.12, 660); setTimeout(() => tone(660, 0.2, 'square', 0.12, 880), 120); },
      lose() { tone(330, 0.3, 'sawtooth', 0.12, 110); },
    };
  })();

  /* ============================ Themes ============================ */

  /* Three terrains, each with its own obstacle profile:
     braid   – how many maze loops (Desert plays open, City is tight)
     breakP  – chance a wall is a crumbling structure
     mudN/wireN/hedgeN – obstacle density multipliers
     river   – has a river with bridges and an under-river tunnel */
  const THEMES = [
    {
      name: 'City', floor: '#41464c', speck: '#4d5359',
      wall: '#67737e', wallEdge: '#2c343c',
      braid: 0.1, breakP: 0.2, mudN: 0.5, wireN: 1.4, hedgeN: 1.7, river: false,
      mudColors: ['#46413a', '#544d44'], // oil & rubble pits
      breakOverlay: 'rgba(0, 0, 0, .16)', // condemned buildings read darker
      detail(ctx, r) { // windows on buildings
        ctx.fillStyle = 'rgba(255, 224, 130, .55)';
        const horizontal = r.w > r.h;
        const n = Math.floor((horizontal ? r.w : r.h) / 18);
        for (let i = 0; i < n; i++) {
          if (Math.random() < 0.35) continue;
          if (horizontal) ctx.fillRect(r.x + 8 + i * 18, r.y + r.h / 2 - 2, 5, 4);
          else ctx.fillRect(r.x + r.w / 2 - 2, r.y + 8 + i * 18, 4, 5);
        }
      },
    },
    {
      name: 'Forest', floor: '#3e6339', speck: '#476f41',
      wall: '#27462a', wallEdge: '#16291a',
      braid: 0.16, breakP: 0.07, mudN: 1.7, wireN: 1.0, hedgeN: 0.5, river: true,
      mudColors: ['#5b4a2e', '#6b583a'], // bog
      breakOverlay: 'rgba(214, 232, 200, .13)', // lighten so they blend with foliage
      detail(ctx, r) { // tree canopies along the wall
        const horizontal = r.w > r.h;
        const len = horizontal ? r.w : r.h;
        for (let i = 8; i < len; i += 16) {
          const jitter = (Math.random() - 0.5) * 5;
          const cx = horizontal ? r.x + i : r.x + r.w / 2 + jitter;
          const cy = horizontal ? r.y + r.h / 2 + jitter : r.y + i;
          ctx.fillStyle = Math.random() < 0.5 ? '#356b39' : '#2d5c32';
          ctx.beginPath();
          ctx.arc(cx, cy, 8 + Math.random() * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    },
    {
      name: 'Desert', floor: '#c5a263', speck: '#b69253',
      wall: '#9c7c45', wallEdge: '#6b522a',
      braid: 0.3, breakP: 0.15, mudN: 1.2, wireN: 0.5, hedgeN: 0.8, river: false,
      breakOverlay: 'rgba(64, 42, 16, .16)', // crumbling adobe reads darker
      mudColors: ['#d6b97e', '#c5a668'], // soft sand sinks the tracks
      detail(ctx, r) { // cracked adobe
        ctx.strokeStyle = 'rgba(60,42,18,.35)';
        ctx.lineWidth = 1.5;
        const horizontal = r.w > r.h;
        const len = horizontal ? r.w : r.h;
        for (let i = 12; i < len; i += 22) {
          ctx.beginPath();
          if (horizontal) { ctx.moveTo(r.x + i, r.y + 2); ctx.lineTo(r.x + i + 6, r.y + r.h - 2); }
          else { ctx.moveTo(r.x + 2, r.y + i); ctx.lineTo(r.x + r.w - 2, r.y + i + 6); }
          ctx.stroke();
        }
      },
    },
  ];

  const LEVELS = [
    // caps = flag captures required to clear the level; enemy speed and
    // firepower also scale with the level index (see startLevel)
    { cols: 13, rows: 9, enemies: 2, caps: 1 },
    { cols: 15, rows: 11, enemies: 2, caps: 1 },
    { cols: 15, rows: 11, enemies: 3, caps: 1 },
    { cols: 17, rows: 11, enemies: 3, caps: 2 },
    { cols: 17, rows: 13, enemies: 4, caps: 2 },
    { cols: 19, rows: 13, enemies: 4, caps: 2 },
  ];

  const CELL = 100;
  const WALL_T = 14;
  // difficulty: [easy, normal, hard]
  const DIFF = {
    names: ['EASY', 'NORMAL', 'HARD'],
    enemyDelta: [-1, 0, 1],
    enemySpeed: [0.85, 1, 1.15],
    enemyReload: [1.6, 1.1, 0.85],
    enemyDamage: [0.85, 1, 1.15],
    capturesToLose: [5, 3, 2],
  };

  /* ============================ DOM ============================ */

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const minimap = document.getElementById('minimap');
  const mctx = minimap.getContext('2d');
  const el = {
    healthbar: document.getElementById('healthbar'),
    score: document.getElementById('score'),
    levelname: document.getElementById('levelname'),
    flagstatus: document.getElementById('flagstatus'),
    powerstatus: document.getElementById('powerstatus'),
    msg: document.getElementById('msg'),
    btnShell: document.getElementById('btnShell'),
    btnMG: document.getElementById('btnMG'),
    btnMine: document.getElementById('btnMine'),
    shellFill: document.getElementById('shellFill'),
    minePips: document.getElementById('minePips'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayText: document.getElementById('overlay-text'),
    overlayBtn: document.getElementById('overlay-btn'),
  };

  let dpr = 1, viewW = 0, viewH = 0, viewScale = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // The playfield sits below the HUD bar and above the touch deck so
    // neither ever covers the tanks or the maze. A canvas is a replaced
    // element and won't stretch on its own, so size it explicitly.
    const topbar = document.getElementById('topbar');
    const deck = document.getElementById('touch');
    const topH = topbar ? topbar.offsetHeight : 0;
    const deckH = document.body.classList.contains('has-touch') && deck ? deck.offsetHeight : 0;
    viewW = Math.max(1, window.innerWidth);
    viewH = Math.max(1, window.innerHeight - topH - deckH);
    canvas.style.top = topH + 'px';
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    // zoom out a touch on small screens so corridors stay readable
    viewScale = Math.max(0.7, Math.min(1.05, Math.min(viewW, viewH) / 560));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();
  // re-measure once fonts/safe-area settle after first layout
  window.addEventListener('load', resize);

  /* ============================ Game ============================ */

  const game = {
    state: 'menu', // menu | playing | levelup | gameover | victory
    level: 0,
    cycle: 0,      // how many times the level list has looped (difficulty)
    playerScore: 0,
    enemyScore: 0,
    cells: null,
    walls: [],
    worldW: 0,
    worldH: 0,
    theme: THEMES[0],
    tanks: [],
    shells: [],
    bullets: [],
    mines: [],
    particles: [],
    rings: [],   // expanding shockwave circles
    flags: [],
    // obstacles & terrain
    river: null,
    riverRects: [],
    breakWalls: [],
    mud: [],
    wires: [],
    hedgehogs: [],
    tunnels: [],
    tankSolids: [],
    losBlockers: [],
    // pickups & air support
    pickups: [],
    pickupT: 0,
    strikes: [],
    bombs: [],
    fires: [],
    player: null,
    floorCanvas: null,
    miniCanvas: null,
    camX: 0, camY: 0,
    shakeT: 0, shakeAmp: 0,
    time: 0,
    msgT: 0,
    stateT: 0,
    sfx,

    cellCenter(cx, cy) {
      return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
    },

    cellAt(x, y) {
      return {
        x: Math.min(this.cells.length - 1, Math.max(0, Math.floor(x / CELL))),
        y: Math.min(this.cells[0].length - 1, Math.max(0, Math.floor(y / CELL))),
      };
    },

    /* Closing river-line walls can disconnect maze regions; re-open
       same-side walls until everything is reachable again. */
    ensureConnected() {
      const cols = this.cells.length, rows = this.cells[0].length;
      for (let guard = 0; guard < 80; guard++) {
        const reach = new Set(['0,0']);
        const stack = [[0, 0]];
        while (stack.length) {
          const [x, y] = stack.pop();
          const c = this.cells[x][y];
          for (const d of Maze.DIRS) {
            if (c.walls[d[2]]) continue;
            const nx = x + d[0], ny = y + d[1];
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const k = nx + ',' + ny;
            if (!reach.has(k)) { reach.add(k); stack.push([nx, ny]); }
          }
        }
        if (reach.size === cols * rows) return;
        let opened = false;
        for (let x = 0; x < cols && !opened; x++) {
          for (let y = 0; y < rows && !opened; y++) {
            if (!reach.has(x + ',' + y)) continue;
            for (const d of Maze.DIRS) {
              const nx = x + d[0], ny = y + d[1];
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              if (reach.has(nx + ',' + ny)) continue;
              // never punch a new crossing through the river line itself
              if (this.river && d[0] === 0) {
                const crossDown = d[1] === 1 && ny === this.river.ry;
                const crossUp = d[1] === -1 && y === this.river.ry;
                if (crossDown || crossUp) continue;
              }
              this.cells[x][y].walls[d[2]] = false;
              this.cells[nx][ny].walls[d[3]] = false;
              opened = true;
              break;
            }
          }
        }
        if (!opened) return; // shouldn't happen, but never loop forever
      }
    },

    rebuildSolids() {
      this.tankSolids = [...this.walls, ...this.breakWalls, ...this.riverRects];
      this.losBlockers = [...this.walls, ...this.breakWalls, ...this.tunnels];
    },

    /* Movement multiplier from terrain under a tank: mud slows, dense
       barbed wire all but stops a tank (light wire just drags). */
    terrainFactor(t) {
      let f = 1;
      for (const m of this.mud) {
        if (Math.hypot(t.x - m.x, t.y - m.y) < m.r + t.radius * 0.4) { f = Math.min(f, 0.45); break; }
      }
      for (const w of this.wires) {
        if (t.x > w.x - t.radius * 0.5 && t.x < w.x + w.w + t.radius * 0.5 &&
            t.y > w.y - t.radius * 0.5 && t.y < w.y + w.h + t.radius * 0.5) {
          f = Math.min(f, w.density >= 0.6 ? 0.1 : 0.5);
        }
      }
      return f;
    },

    damageBreakWall(bw) {
      bw.hits--;
      if (bw.hits <= 0) {
        this.breakWalls = this.breakWalls.filter(b => b !== bw);
        this.spawnExplosion(bw.x + bw.w / 2, bw.y + bw.h / 2, 42, '#c9b18a');
        sfx.boomSmall();
        this.shake(4);
        this.rebuildSolids();
        this.renderMiniWalls();
      } else {
        this.spawnSpark(bw.x + bw.w / 2, bw.y + bw.h / 2);
      }
    },

    /* After a capture the round resets: every tank (enemies included)
       respawns at its base and the field is cleared of munitions. */
    resetRound() {
      this.shells = [];
      this.bullets = [];
      this.mines = [];
      this.strikes = [];
      this.bombs = [];
      this.fires = [];
      this.rings = [];
      for (const f of this.flags) {
        f.state = 'base';
        f.carrier = null;
        f.x = f.baseX; f.y = f.baseY;
        f.returnT = 0;
      }
      for (const t of this.tanks) {
        t.carryingFlag = null;
        t.respawn(this);
        if (t.ai) { t.ai.path = null; t.ai.repathT = Math.random(); }
      }
    },

    shake(amp) {
      this.shakeAmp = Math.max(this.shakeAmp, amp);
      this.shakeT = 0.35;
    },

    addKick(tank, amount) {
      tank.speed += amount;
    },

    spawnExplosion(x, y, size, color) {
      // hot core flash
      this.particles.push({
        kind: 'flash', x, y, vx: 0, vy: 0,
        life: 0.13, maxLife: 0.13, r: size * 0.9, color: '#fff3c4',
      });
      // expanding shockwave ring
      this.rings.push({ x, y, r: size * 0.25, speed: size * 5.5, life: 0.34, maxLife: 0.34 });
      // fire sparks
      for (let i = 0; i < Math.floor(size * 0.7); i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = Math.random() * size * 4;
        this.particles.push({
          x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.35 + Math.random() * 0.4,
          maxLife: 0.75,
          r: 2 + Math.random() * (size * 0.12),
          color: Math.random() < 0.55 ? color : (Math.random() < 0.5 ? '#ffe28a' : '#7a7a7a'),
        });
      }
      // rising smoke that grows and drifts
      for (let i = 0; i < 4 + Math.floor(size / 9); i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.push({
          kind: 'smoke', x: x + Math.cos(a) * size * 0.2, y: y + Math.sin(a) * size * 0.2,
          vx: (Math.random() - 0.5) * 36, vy: -12 - Math.random() * 18,
          life: 0.8 + Math.random() * 0.7, maxLife: 1.5,
          r: 4 + Math.random() * size * 0.14, grow: 16,
          color: Math.random() < 0.5 ? '#3c3c3c' : '#585858',
        });
      }
    },

    spawnMuzzle(x, y, angle, small) {
      const n = small ? 2 : 6;
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * 0.7;
        const sp = 90 + Math.random() * 130;
        this.particles.push({
          x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 0.12 + Math.random() * 0.08, maxLife: 0.2,
          r: 1.5 + Math.random() * 2, color: Math.random() < 0.6 ? '#ffd9a0' : '#ff9d5c',
        });
      }
      if (!small) {
        this.particles.push({
          kind: 'flash', x: x + Math.cos(angle) * 6, y: y + Math.sin(angle) * 6,
          vx: 0, vy: 0, life: 0.07, maxLife: 0.07, r: 11, color: '#ffe9b0',
        });
      }
    },

    spawnSpark(x, y) {
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2;
        this.particles.push({
          x, y,
          vx: Math.cos(a) * 90, vy: Math.sin(a) * 90,
          life: 0.18, maxLife: 0.18, r: 1.5, color: '#ffe98a',
        });
      }
    },

    showMsg(text, dur = 2.2) {
      el.msg.textContent = text;
      el.msg.classList.add('show');
      this.msgT = dur;
    },

    /* ---------- pickups & air support ---------- */

    spawnPickup() {
      const cols = this.cells.length, rows = this.cells[0].length;
      for (let tries = 0; tries < 30; tries++) {
        const cx = (Math.random() * cols) | 0, cy = (Math.random() * rows) | 0;
        const pos = this.cellCenter(cx, cy);
        if (Math.hypot(pos.x - this.flags[0].baseX, pos.y - this.flags[0].baseY) < 150) continue;
        if (Math.hypot(pos.x - this.flags[1].baseX, pos.y - this.flags[1].baseY) < 150) continue;
        if (this.river && Math.abs(pos.y - this.river.y) < 75) continue;
        if (this.hedgehogs.some(h => Math.hypot(h.x - pos.x, h.y - pos.y) < 32)) continue;
        this.pickups.push({ type: (Math.random() * 4) | 0, sub: (Math.random() * 3) | 0, x: pos.x, y: pos.y });
        return;
      }
    },

    applyPickup(pk) {
      const p = this.player;
      sfx.pickup();
      if (pk.type === 0) {
        p.autoTargetT = 10;
        p.lockT = 0;
        this.showMsg('AUTO-TARGET ONLINE (10s)', 2.2);
      } else if (pk.type === 1) {
        const durations = [3, 4, 5];
        const names = ['STEEL', 'COMPOSITE', 'REACTIVE'];
        p.armorItem = { name: names[pk.sub], duration: durations[pk.sub], remaining: -1 };
        this.showMsg(`${names[pk.sub]} ARMOR — ${durations[pk.sub]}s ONCE HIT`, 2.4);
      } else if (pk.type === 2) {
        const names = ['BOMBS', 'NAPALM', 'STRAFING RUN'];
        this.launchAirSupport(pk.sub);
        this.showMsg(`AIR SUPPORT INBOUND — ${names[pk.sub]}`, 2.4);
      } else {
        p.mineBonus = Math.min(8, (p.mineBonus || 0) + 2);
        this.showMsg(`EXTRA MINES — CAPACITY ${p.maxMines()}`, 2.2);
      }
    },

    launchAirSupport(sub) {
      const enemies = this.tanks.filter(t => !t.isPlayer && t.alive);
      let ty = enemies.length
        ? enemies.reduce((s, t) => s + t.y, 0) / enemies.length
        : this.worldH / 2;
      ty = Math.max(60, Math.min(this.worldH - 60, ty));
      this.strikes.push({ type: sub, x: -140, y: ty, vx: 520, dropT: 0.1, done: false });
      sfx.shell();
    },

    strafeHit(x, y) {
      this.spawnSpark(x, y);
      for (const t of this.tanks) {
        if (t.isPlayer || !t.alive) continue;
        if (Math.hypot(t.x - x, t.y - y) < 20) t.damage(6, this, this.player);
      }
    },

    updateSupport(dt) {
      for (const s of this.strikes) {
        s.x += s.vx * dt;
        if (s.x > -40 && s.x < this.worldW + 40) {
          s.dropT -= dt;
          if (s.dropT <= 0) {
            if (s.type === 0) {
              s.dropT = 0.4;
              this.bombs.push({ x: s.x, y: s.y + (Math.random() * 40 - 20), fuse: 0.5, done: false });
            } else if (s.type === 1) {
              s.dropT = 0.16;
              this.fires.push({ x: s.x, y: s.y + (Math.random() * 50 - 25), r: 22 + Math.random() * 10, life: 6 });
            } else {
              s.dropT = 0.05;
              this.strafeHit(s.x + Math.random() * 20, s.y + (Math.random() * 60 - 30));
              if (Math.random() < 0.4) sfx.mg();
            }
          }
        }
        if (s.x > this.worldW + 160) s.done = true;
      }
      this.strikes = this.strikes.filter(s => !s.done);

      for (const b of this.bombs) {
        b.fuse -= dt;
        if (b.fuse <= 0) {
          b.done = true;
          this.spawnExplosion(b.x, b.y, 50, '#ff8c42');
          sfx.boomBig();
          this.shake(6);
          for (const t of this.tanks) {
            if (t.isPlayer || !t.alive) continue;
            const d = Math.hypot(t.x - b.x, t.y - b.y);
            if (d < 90) t.damage(55 * clamp(1 - d / 110, 0.3, 1), this, this.player);
          }
          for (const bw of [...this.breakWalls]) {
            if (b.x > bw.x - 28 && b.x < bw.x + bw.w + 28 &&
                b.y > bw.y - 28 && b.y < bw.y + bw.h + 28) {
              bw.hits = 1;
              this.damageBreakWall(bw);
            }
          }
        }
      }
      this.bombs = this.bombs.filter(b => !b.done);

      for (const f of this.fires) {
        f.life -= dt;
        for (const t of this.tanks) {
          if (t.isPlayer || !t.alive) continue;
          if (Math.hypot(t.x - f.x, t.y - f.y) < f.r + t.radius * 0.6) {
            t.damage(16 * dt, this, this.player);
          }
        }
      }
      this.fires = this.fires.filter(f => f.life > 0);
    },

    /* ---------- level setup ---------- */

    startLevel(levelIdx) {
      const cfg = LEVELS[levelIdx % LEVELS.length];
      this.level = levelIdx;
      this.theme = THEMES[levelIdx % THEMES.length];
      const cols = cfg.cols, rows = cfg.rows;
      this.cells = Maze.generate(cols, rows, this.theme.braid);
      this.worldW = cols * CELL;
      this.worldH = rows * CELL;

      // --- river across the middle (terrains that have one), crossable
      // only at bridges and one tunnel ---
      this.river = null;
      this.riverRects = [];
      if (this.theme.river && rows >= 9) {
        const ry = Math.floor(rows / 2);
        const b1 = 1 + ((Math.random() * (cols / 2 - 2)) | 0);
        const b2 = Math.floor(cols / 2) + 1 + ((Math.random() * (cols / 2 - 3)) | 0);
        let tCol = Math.floor((b1 + b2) / 2);
        if (tCol === b1 || tCol === b2) tCol = Math.min(cols - 2, tCol + 1);
        const crossings = [b1, b2, tCol];
        for (let x = 0; x < cols; x++) {
          const open = crossings.includes(x);
          this.cells[x][ry - 1].walls[2] = !open;
          this.cells[x][ry].walls[0] = !open;
        }
        this.river = { y: ry * CELL, ry, bridges: [b1, b2], tunnelCol: tCol, h: 56 };
        this.ensureConnected();
        const half = this.river.h / 2;
        const gaps = crossings
          .map(cx => ({ a: cx * CELL + CELL / 2 - 34, b: cx * CELL + CELL / 2 + 34 }))
          .sort((u, v) => u.a - v.a);
        let cur = 0;
        for (const g of gaps) {
          if (g.a > cur) this.riverRects.push({ x: cur, y: this.river.y - half, w: g.a - cur, h: this.river.h });
          cur = Math.max(cur, g.b);
        }
        if (cur < this.worldW) this.riverRects.push({ x: cur, y: this.river.y - half, w: this.worldW - cur, h: this.river.h });
      }

      this.walls = Maze.buildWallRects(this.cells, CELL, WALL_T);

      // --- some interior walls are weakened: shells bring them down ---
      this.breakWalls = [];
      const riverBand = this.river ? { a: this.river.y - 40, b: this.river.y + 40 } : null;
      this.walls = this.walls.filter(w => {
        const interior = w.x > 0 && w.y > 0 && w.x + w.w < this.worldW && w.y + w.h < this.worldH;
        const inRiver = riverBand && w.y < riverBand.b && w.y + w.h > riverBand.a;
        if (interior && !inRiver && Math.random() < this.theme.breakP) {
          const hits = 1 + ((Math.random() * 3) | 0); // 1-3 shell hits
          this.breakWalls.push({ x: w.x, y: w.y, w: w.w, h: w.h, hits, maxHits: hits });
          return false;
        }
        return true;
      });

      this.shells = [];
      this.bullets = [];
      this.mines = [];
      this.particles = [];
      this.rings = [];
      this.tanks = [];
      this.pickups = [];
      this.pickupT = 6;
      this.strikes = [];
      this.bombs = [];
      this.fires = [];

      // --- obstacle layout (kept away from bases and river crossings) ---
      const protectedCells = new Set();
      const protect = (cx, cy) => {
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) protectedCells.add((cx + dx) + ',' + (cy + dy));
      };
      protect(0, rows - 1);
      protect(cols - 1, 0);
      if (this.river) {
        for (const x of [...this.river.bridges, this.river.tunnelCol]) {
          protectedCells.add(x + ',' + (this.river.ry - 1));
          protectedCells.add(x + ',' + this.river.ry);
        }
      }
      const freeCells = [];
      for (let x = 0; x < cols; x++)
        for (let y = 0; y < rows; y++)
          if (!protectedCells.has(x + ',' + y)) freeCells.push({ x, y });
      const take = () => freeCells.length ? freeCells.splice((Math.random() * freeCells.length) | 0, 1)[0] : null;
      const area = cols * rows / 100;

      const th = this.theme;
      this.mud = [];
      for (let i = 0; i < Math.round((4 + area * 1.5) * th.mudN); i++) {
        const c2 = take();
        if (c2) this.mud.push({ x: c2.x * CELL + CELL / 2, y: c2.y * CELL + CELL / 2, r: 33 + Math.random() * 10 });
      }
      this.wires = [];
      for (let i = 0; i < Math.round((3 + area) * th.wireN); i++) {
        const c2 = take();
        if (c2) this.wires.push({
          x: c2.x * CELL + 14, y: c2.y * CELL + 14, w: CELL - 28, h: CELL - 28,
          density: Math.random() < 0.35 ? 0.8 : 0.35, // dense wire traps tanks
        });
      }
      this.hedgehogs = [];
      for (let i = 0; i < Math.round((4 + area) * th.hedgeN); i++) {
        const c2 = take();
        if (c2) this.hedgehogs.push({
          x: c2.x * CELL + CELL / 2 + (Math.random() * 24 - 12),
          y: c2.y * CELL + CELL / 2 + (Math.random() * 24 - 12),
          r: 13,
        });
      }

      // The only covered section is the tunnel under the river — corridor
      // roofs looked like floating black slabs and have been removed.
      this.tunnels = [];
      if (this.river) {
        const tx = this.river.tunnelCol * CELL + CELL / 2;
        this.tunnels.push({ x: tx - 34, y: this.river.y - CELL * 0.9, w: 68, h: CELL * 1.8 });
      }

      this.rebuildSolids();

      // Bases: player bottom-left, enemy top-right.
      const pBase = this.cellCenter(0, rows - 1);
      const eBase = this.cellCenter(cols - 1, 0);
      this.flags = [
        { team: 0, baseX: pBase.x, baseY: pBase.y, x: pBase.x, y: pBase.y, state: 'base', carrier: null, returnT: 0 },
        { team: 1, baseX: eBase.x, baseY: eBase.y, x: eBase.x, y: eBase.y, state: 'base', carrier: null, returnT: 0 },
      ];

      this.player = new Tank(0, pBase.x, pBase.y, -Math.PI / 2, true);
      this.tanks.push(this.player);

      const d = this.difficulty;
      const lvlIdx = levelIdx % LEVELS.length;
      this.capsNeeded = cfg.caps;
      this.levelCaptures = 0;
      const lvlF = 1 + lvlIdx * 0.05; // each level the enemy gets quicker...
      const enemyCount = Math.max(1, cfg.enemies + Math.min(this.cycle, 2) + DIFF.enemyDelta[d]);
      const spawnCells = [
        [cols - 1, 0], [cols - 2, 0], [cols - 1, 1], [cols - 2, 1],
        [cols - 3, 0], [cols - 1, 2],
      ];
      for (let i = 0; i < enemyCount; i++) {
        const sc = spawnCells[i % spawnCells.length];
        const p = this.cellCenter(sc[0], sc[1]);
        const t = new Tank(1, p.x, p.y, Math.PI / 2, false);
        // difficulty, level index and later cycles tune AI speed,
        // reload time and shot damage
        t.maxSpeed *= DIFF.enemySpeed[d] * lvlF * (1 + this.cycle * 0.08);
        t.shellCdMult = DIFF.enemyReload[d] / lvlF;
        t.dmgMult = DIFF.enemyDamage[d] * (1 + lvlIdx * 0.08);
        t.ai = {
          role: i === 0 ? 'capture' : 'hunter',
          path: null, wpIdx: 0,
          repathT: Math.random(),
          losT: 0, hasLOS: false,
          stuckT: 0, reverseT: 0,
          mineT: 5 + Math.random() * 10,
        };
        this.tanks.push(t);
      }

      this.renderFloor();
      this.renderMiniWalls();
      el.levelname.textContent = `Level ${levelIdx + 1} · ${this.theme.name}`;
      this.showMsg(`${this.theme.name.toUpperCase()} — STEAL THE RED FLAG`, 2.6);
    },

    renderFloor() {
      const th = this.theme;
      const c = document.createElement('canvas');
      c.width = this.worldW;
      c.height = this.worldH;
      const g = c.getContext('2d');

      g.fillStyle = th.floor;
      g.fillRect(0, 0, c.width, c.height);
      // speckle texture
      g.fillStyle = th.speck;
      for (let i = 0; i < this.worldW * this.worldH / 900; i++) {
        g.fillRect(Math.random() * c.width, Math.random() * c.height, 2.5, 2.5);
      }
      // faint cell grid
      g.strokeStyle = 'rgba(0,0,0,.06)';
      g.lineWidth = 1;
      for (let x = 0; x <= c.width; x += CELL) {
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke();
      }
      for (let y = 0; y <= c.height; y += CELL) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke();
      }

      // river + bridges
      if (this.river) {
        const half = this.river.h / 2;
        g.fillStyle = '#3a6ea5';
        g.fillRect(0, this.river.y - half, c.width, this.river.h);
        g.fillStyle = 'rgba(255,255,255,.18)';
        for (let i = 0; i < c.width / 26; i++) {
          g.fillRect(Math.random() * c.width, this.river.y - half + 6 + Math.random() * (this.river.h - 14), 14, 2);
        }
        g.strokeStyle = '#2c567f';
        g.lineWidth = 3;
        g.strokeRect(-4, this.river.y - half, c.width + 8, this.river.h);
        for (const bx of this.river.bridges) {
          const cx = bx * CELL + CELL / 2;
          g.fillStyle = '#8a6f4d';
          g.fillRect(cx - 32, this.river.y - half - 7, 64, this.river.h + 14);
          g.strokeStyle = '#5e4a31';
          g.lineWidth = 2;
          for (let py = this.river.y - half - 2; py < this.river.y + half + 7; py += 8) {
            g.beginPath();
            g.moveTo(cx - 30, py);
            g.lineTo(cx + 30, py);
            g.stroke();
          }
          g.strokeRect(cx - 32, this.river.y - half - 7, 64, this.river.h + 14);
        }
      }

      // mud / soft sand patches: depth from a radial gradient, a darker
      // sunken rim, wet blobs and a small specular sheen
      for (const m of this.mud) {
        const grad = g.createRadialGradient(m.x - m.r * 0.25, m.y - m.r * 0.2, m.r * 0.15, m.x, m.y, m.r);
        grad.addColorStop(0, th.mudColors[1]);
        grad.addColorStop(0.7, th.mudColors[0]);
        grad.addColorStop(1, th.mudColors[0]);
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(m.x, m.y, m.r, m.r * 0.8, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(0, 0, 0, .22)';
        g.lineWidth = 2.5;
        g.stroke();
        g.fillStyle = th.mudColors[1];
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.arc(m.x + (Math.random() * 2 - 1) * m.r * 0.5,
                m.y + (Math.random() * 2 - 1) * m.r * 0.4,
                4 + Math.random() * 5, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(255, 255, 255, .1)';
        g.beginPath();
        g.ellipse(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.3, m.r * 0.14, -0.5, 0, Math.PI * 2);
        g.fill();
      }

      // barbed wire (denser sections have more strands)
      for (const w of this.wires) {
        const strands = w.density >= 0.6 ? 7 : 4;
        g.strokeStyle = w.density >= 0.6 ? '#737c84' : '#8d959c';
        g.lineWidth = 1.5;
        for (let i = 0; i < strands; i++) {
          const yy = w.y + (i + 0.5) * w.h / strands;
          g.beginPath();
          g.moveTo(w.x, yy);
          g.lineTo(w.x + w.w, yy);
          g.stroke();
          for (let xx = w.x + 6; xx < w.x + w.w; xx += 12) {
            g.beginPath();
            g.moveTo(xx - 3, yy - 3); g.lineTo(xx + 3, yy + 3);
            g.moveTo(xx + 3, yy - 3); g.lineTo(xx - 3, yy + 3);
            g.stroke();
          }
        }
        g.fillStyle = '#55402a';
        g.fillRect(w.x - 2, w.y - 2, 4, w.h + 4);
        g.fillRect(w.x + w.w - 2, w.y - 2, 4, w.h + 4);
      }

      // base pads glow from the center
      for (const f of this.flags) {
        const tc = f.team === 0 ? '110, 224, 138' : '255, 122, 107';
        const pg = g.createRadialGradient(f.baseX, f.baseY, 4, f.baseX, f.baseY, 40);
        pg.addColorStop(0, `rgba(${tc}, .5)`);
        pg.addColorStop(0.7, `rgba(${tc}, .2)`);
        pg.addColorStop(1, `rgba(${tc}, .08)`);
        g.fillStyle = pg;
        g.strokeStyle = `rgba(${tc}, .7)`;
        g.lineWidth = 3;
        g.beginPath();
        g.arc(f.baseX, f.baseY, 38, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.strokeStyle = `rgba(${tc}, .3)`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(f.baseX, f.baseY, 30, 0, Math.PI * 2);
        g.stroke();
      }

      // soft drop shadows give the walls height (two offset passes);
      // breakable walls cast theirs live so rubble leaves no ghost
      g.fillStyle = 'rgba(0, 0, 0, .1)';
      for (const r of this.walls) {
        g.fillRect(r.x + 3, r.y + 4, r.w, r.h);
        g.fillRect(r.x + 6, r.y + 7, r.w, r.h);
      }

      // walls + theme detail
      for (const r of this.walls) {
        g.fillStyle = th.wall;
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = th.wallEdge;
        g.lineWidth = 2;
        g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        th.detail(g, r);
      }
      this.floorCanvas = c;
    },

    renderMiniWalls() {
      const c = document.createElement('canvas');
      c.width = minimap.width;
      c.height = minimap.height;
      const g = c.getContext('2d');
      const sx = c.width / this.worldW, sy = c.height / this.worldH;
      const s = Math.min(sx, sy);
      g.fillStyle = 'rgba(12,18,24,.9)';
      g.fillRect(0, 0, c.width, c.height);
      if (this.river) {
        const half = this.river.h / 2;
        g.fillStyle = '#3a6ea5';
        g.fillRect(0, (this.river.y - half) * s, this.worldW * s, Math.max(2, this.river.h * s));
        g.fillStyle = '#8a6f4d';
        for (const bx of [...this.river.bridges, this.river.tunnelCol]) {
          g.fillRect((bx * CELL + CELL / 2 - 34) * s, (this.river.y - half) * s,
                     Math.max(2, 68 * s), Math.max(2, this.river.h * s));
        }
      }
      g.fillStyle = '#5d7488';
      for (const r of this.walls) {
        g.fillRect(r.x * s, r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s));
      }
      g.fillStyle = '#85765a';
      for (const r of this.breakWalls) {
        g.fillRect(r.x * s, r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s));
      }
      this.miniCanvas = c;
      this.miniScale = s;
    },

    /* ---------- flow ---------- */

    difficulty: 1,
    capturesToLose: DIFF.capturesToLose[1],

    start(difficulty) {
      if (difficulty !== undefined) this.difficulty = difficulty;
      this.capturesToLose = DIFF.capturesToLose[this.difficulty];
      this.playerScore = 0;
      this.enemyScore = 0;
      this.cycle = 0;
      this.victoryShown = false;
      this.state = 'playing';
      this.startLevel(0);
      el.overlay.classList.add('hidden');
    },

    onPlayerCapture() {
      this.playerScore++;
      this.levelCaptures++;
      sfx.capture();
      this.shake(6);
      if (this.levelCaptures >= this.capsNeeded) {
        this.showMsg('AREA SECURED — ADVANCING!', 2.4);
        this.state = 'levelup';
        this.stateT = 2.0;
      } else {
        this.showMsg(`FLAG CAPTURED (${this.levelCaptures}/${this.capsNeeded})`, 2.4);
        this.resetRound();
      }
    },

    onEnemyCapture() {
      this.enemyScore++;
      sfx.lose();
      this.shake(6);
      if (this.enemyScore >= this.capturesToLose) {
        this.showMsg('YOUR FLAG IS GONE', 3);
        this.state = 'gameover';
        this.stateT = 1.6;
      } else {
        this.showMsg(`ENEMY CAPTURED YOUR FLAG (${this.enemyScore}/${this.capturesToLose})`, 2.6);
        this.resetRound();
      }
    },

    onTankDestroyed(tank, source) {
      this.spawnExplosion(tank.x, tank.y, 60, tank.team === 0 ? '#9be08a' : '#ff8c42');
      sfx.boomBig();
      this.shake(10);
      if (tank.carryingFlag) {
        const f = tank.carryingFlag;
        f.state = 'dropped';
        f.x = tank.x; f.y = tank.y;
        f.carrier = null;
        f.returnT = 15;
        tank.carryingFlag = null;
        this.showMsg(f.team === 1 ? 'YOU DROPPED THE FLAG!' : 'YOUR FLAG WAS DROPPED', 2);
      }
      if (tank.isPlayer) this.showMsg('TANK DESTROYED — REDEPLOYING…', 2.2);
    },

    /* ---------- per-frame update ---------- */

    update(dt) {
      this.time += dt;

      if (this.msgT > 0) {
        this.msgT -= dt;
        if (this.msgT <= 0) el.msg.classList.remove('show');
      }

      if (this.state === 'levelup') {
        this.stateT -= dt;
        if (this.stateT <= 0) {
          const next = this.level + 1;
          if (next % LEVELS.length === 0) this.cycle = Math.floor(next / LEVELS.length);
          if (next === LEVELS.length && this.cycle === 1 && !this.victoryShown) {
            this.victoryShown = true;
            this.state = 'victory';
            showOverlay('VICTORY!',
              `All ${LEVELS.length} battles across City, Forest and Desert won on ` +
              `${DIFF.names[this.difficulty]} — final score ${this.playerScore}–${this.enemyScore}.<br>` +
              'The war continues at higher intensity if you keep rolling.',
              'KEEP ROLLING');
            return;
          }
          this.state = 'playing';
          this.startLevel(next);
        }
      } else if (this.state === 'gameover') {
        this.stateT -= dt;
        if (this.stateT <= 0 && el.overlay.classList.contains('hidden')) {
          showOverlay('DEFEAT', `The enemy captured your flag ${this.capturesToLose} times on ${DIFF.names[this.difficulty]}.<br>Final score ${this.playerScore}–${this.enemyScore}.`, 'TRY AGAIN');
        }
      }

      if (this.state === 'menu') return;

      // --- player controls ---
      if (this.player.alive && this.state === 'playing') {
        const p = this.player;
        const inp = Input.read();
        if (inp.joyActive) {
          p.desiredAngle = inp.joyAngle;
          p.desiredThrottle = inp.joyMag;
        } else {
          p.desiredAngle = null;
          p.throttle = inp.forward;
          p.steer = inp.turn;
        }

        // auto-target pickup: turret locks an enemy for 2s at a time
        if (p.autoTargetT > 0) {
          p.autoTargetT -= dt;
          p.lockT -= dt;
          const lt = p.lockTarget;
          const valid = lt && lt.alive && p.lockT > 0 &&
            Math.hypot(lt.x - p.x, lt.y - p.y) < 520 &&
            hasLOS(this.losBlockers, p.x, p.y, lt.x, lt.y);
          if (!valid) {
            p.lockTarget = null;
            let best = null, bd = 520;
            for (const t of this.tanks) {
              if (t.isPlayer || !t.alive) continue;
              const d = Math.hypot(t.x - p.x, t.y - p.y);
              if (d < bd && hasLOS(this.losBlockers, p.x, p.y, t.x, t.y)) { bd = d; best = t; }
            }
            if (best) { p.lockTarget = best; p.lockT = 2; }
          }
          if (p.lockTarget) {
            p.turretAngle = Math.atan2(p.lockTarget.y - p.y, p.lockTarget.x - p.x);
          }
        } else {
          p.lockTarget = null;
        }

        if (inp.fireShell) p.fireShell(this);
        if (inp.fireMG) p.fireMG(this);
        if (Input.consumeMine()) p.dropMine(this);

        // collect special items
        for (const pk of this.pickups) {
          if (Math.hypot(p.x - pk.x, p.y - pk.y) < 28) {
            pk.dead = true;
            this.applyPickup(pk);
          }
        }
        this.pickups = this.pickups.filter(pk => !pk.dead);
      } else {
        Input.consumeMine();
        this.player.throttle = 0;
        this.player.steer = 0;
        this.player.desiredAngle = null;
      }

      // --- AI ---
      for (const t of this.tanks) {
        if (t.ai && t.alive && this.state === 'playing') this.updateAI(t, dt);
      }

      // --- entities ---
      for (const t of this.tanks) t.update(dt, this);
      this.resolveTankCollisions(dt);
      for (const s of this.shells) s.update(dt, this);
      for (const b of this.bullets) b.update(dt, this);
      for (const m of this.mines) m.update(dt, this);
      this.shells = this.shells.filter(s => !s.dead);
      this.bullets = this.bullets.filter(b => !b.dead);
      this.mines = this.mines.filter(m => !m.dead);

      this.updateSupport(dt);

      // fresh pickups appear over time (max 3 on the field)
      if (this.state === 'playing') {
        this.pickupT -= dt;
        if (this.pickupT <= 0) {
          this.pickupT = 9 + Math.random() * 7;
          if (this.pickups.length < 3) this.spawnPickup();
        }
      }

      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === 'smoke') {
          p.r += p.grow * dt;
          p.vy -= 8 * dt;
        } else {
          p.vx *= 0.92;
          p.vy *= 0.92;
        }
      }
      this.particles = this.particles.filter(p => p.life > 0);
      for (const r of this.rings) {
        r.r += r.speed * dt;
        r.life -= dt;
      }
      this.rings = this.rings.filter(r => r.life > 0);

      if (this.state === 'playing') this.updateFlags(dt);

      // --- camera follows player ---
      const targetX = this.player.x - viewW / viewScale / 2;
      const targetY = this.player.y - viewH / viewScale / 2;
      const maxX = Math.max(0, this.worldW - viewW / viewScale);
      const maxY = Math.max(0, this.worldH - viewH / viewScale);
      this.camX += (Math.min(maxX, Math.max(0, targetX)) - this.camX) * Math.min(1, dt * 8);
      this.camY += (Math.min(maxY, Math.max(0, targetY)) - this.camY) * Math.min(1, dt * 8);
      if (this.shakeT > 0) this.shakeT -= dt;

      this.updateHUD();
    },

    resolveTankCollisions() {
      for (let i = 0; i < this.tanks.length; i++) {
        for (let j = i + 1; j < this.tanks.length; j++) {
          const a = this.tanks[i], b = this.tanks[j];
          if (!a.alive || !b.alive) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.001;
          const minD = a.radius + b.radius;
          if (d >= minD) continue;
          const nx = dx / d, ny = dy / d;
          const push = (minD - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;

          // ram damage scales with closing speed; both tanks take it
          const va = { x: Math.cos(a.angle) * a.speed, y: Math.sin(a.angle) * a.speed };
          const vb = { x: Math.cos(b.angle) * b.speed, y: Math.sin(b.angle) * b.speed };
          const closing = (va.x - vb.x) * nx + (va.y - vb.y) * ny;
          if (closing > 90 && a.ramCd <= 0 && b.ramCd <= 0 && a.team !== b.team) {
            const dmg = DMG.RAM_MAX * Math.min(1, closing / 330);
            a.damage(dmg, this, b);
            b.damage(dmg, this, a);
            a.ramCd = 0.8; b.ramCd = 0.8;
            a.speed *= 0.2; b.speed *= 0.2;
            this.spawnSpark((a.x + b.x) / 2, (a.y + b.y) / 2);
            sfx.clank();
            this.shake(4);
          }
        }
      }
    },

    updateAI(t, dt) {
      const ai = t.ai;
      const player = this.player;

      // backing out of a stuck spot overrides everything briefly
      if (ai.reverseT > 0) {
        ai.reverseT -= dt;
        t.desiredAngle = null;
        t.throttle = -0.8;
        t.steer = ai.reverseSteer;
        return;
      }

      // throttled line-of-sight to the player
      ai.losT -= dt;
      if (ai.losT <= 0) {
        ai.losT = 0.25;
        ai.hasLOS = player.alive &&
          Math.hypot(player.x - t.x, player.y - t.y) < 460 &&
          hasLOS(this.losBlockers, t.x, t.y, player.x, player.y);
      }

      // pick destination
      let dest;
      const playerFlag = this.flags[0];
      if (t.carryingFlag) {
        dest = { x: this.flags[1].baseX, y: this.flags[1].baseY };
      } else if (ai.role === 'capture' && playerFlag.state !== 'carried') {
        dest = { x: playerFlag.x, y: playerFlag.y };
      } else if (player.alive) {
        dest = { x: player.x, y: player.y };
      } else {
        dest = { x: this.flags[1].baseX, y: this.flags[1].baseY };
      }

      // repath periodically
      ai.repathT -= dt;
      if (ai.repathT <= 0 || !ai.path || ai.wpIdx >= ai.path.length) {
        ai.repathT = 1.4 + Math.random() * 0.8;
        const from = this.cellAt(t.x, t.y);
        const to = this.cellAt(dest.x, dest.y);
        ai.path = Maze.bfsPath(this.cells, from.x, from.y, to.x, to.y);
        ai.wpIdx = ai.path && ai.path.length > 1 ? 1 : 0;
      }

      // follow path
      let tx = dest.x, ty = dest.y;
      if (ai.path && ai.wpIdx < ai.path.length) {
        const wp = this.cellCenter(ai.path[ai.wpIdx].x, ai.path[ai.wpIdx].y);
        if (Math.hypot(wp.x - t.x, wp.y - t.y) < 34) ai.wpIdx++;
        if (ai.wpIdx < ai.path.length) {
          const wp2 = this.cellCenter(ai.path[ai.wpIdx].x, ai.path[ai.wpIdx].y);
          tx = wp2.x; ty = wp2.y;
        }
      }

      t.desiredAngle = Math.atan2(ty - t.y, tx - t.x);
      t.desiredThrottle = 0.9;

      // combat: face and shoot the player when visible
      if (ai.hasLOS && player.alive && player.invulnT <= 0) {
        const distP = Math.hypot(player.x - t.x, player.y - t.y);
        const aimAngle = Math.atan2(player.y - t.y, player.x - t.x);
        if (distP < 280 && !t.carryingFlag) {
          t.desiredAngle = aimAngle;
          t.desiredThrottle = distP > 150 ? 0.55 : 0.1;
        }
        const aimErr = Math.abs(angleDiff(aimAngle, t.angle));
        if (aimErr < 0.22 && distP < 430) t.fireShell(this);
        if (aimErr < 0.35 && distP < 250) t.fireMG(this);
      }

      // occasional mine when fleeing with the flag or guarding a corridor
      ai.mineT -= dt;
      if (ai.mineT <= 0) {
        ai.mineT = 9 + Math.random() * 12;
        if (t.carryingFlag || Math.random() < 0.5) t.dropMine(this);
      }

      // stuck detection -> brief reverse + repath
      if (Math.abs(t.speed) < 18 && t.desiredThrottle > 0.4) {
        ai.stuckT += dt;
        if (ai.stuckT > 1.1) {
          ai.stuckT = 0;
          ai.reverseT = 0.55;
          ai.reverseSteer = Math.random() < 0.5 ? -1 : 1;
          ai.repathT = 0;
        }
      } else {
        ai.stuckT = 0;
      }
    },

    updateFlags(dt) {
      for (const f of this.flags) {
        if (f.state === 'carried') {
          if (f.carrier && f.carrier.alive) {
            f.x = f.carrier.x;
            f.y = f.carrier.y;
          }
          continue;
        }
        if (f.state === 'dropped') {
          f.returnT -= dt;
          if (f.returnT <= 0) {
            f.state = 'base';
            f.x = f.baseX; f.y = f.baseY;
            this.showMsg(f.team === 0 ? 'YOUR FLAG RETURNED' : 'ENEMY FLAG RETURNED', 1.6);
          }
        }
        for (const t of this.tanks) {
          if (!t.alive) continue;
          const d = Math.hypot(t.x - f.x, t.y - f.y);
          if (d > 30) continue;
          if (f.team !== t.team && !t.carryingFlag) {
            f.state = 'carried';
            f.carrier = t;
            t.carryingFlag = f;
            if (t.isPlayer) { sfx.pickup(); this.showMsg('ENEMY FLAG TAKEN — GET HOME!', 2.2); }
            else if (f.team === 0) { sfx.lose(); this.showMsg('THEY HAVE YOUR FLAG!', 2.2); }
            break;
          }
          if (f.team === t.team && f.state === 'dropped') {
            f.state = 'base';
            f.x = f.baseX; f.y = f.baseY;
            if (t.isPlayer) { sfx.pickup(); this.showMsg('FLAG RETURNED', 1.6); }
            break;
          }
        }
      }

      // scoring: carrier touches own base pad
      for (const t of this.tanks) {
        if (!t.alive || !t.carryingFlag) continue;
        const ownBase = this.flags[t.team];
        const d = Math.hypot(t.x - ownBase.baseX, t.y - ownBase.baseY);
        if (d < 48) {
          const f = t.carryingFlag;
          t.carryingFlag = null;
          f.state = 'base';
          f.carrier = null;
          f.x = f.baseX; f.y = f.baseY;
          if (t.team === 0) this.onPlayerCapture();
          else this.onEnemyCapture();
        }
      }
    },

    /* ---------- HUD ---------- */

    updateHUD() {
      const p = this.player;
      const frac = Math.max(0, p.hp / p.maxHp);
      el.healthbar.style.width = (frac * 100) + '%';
      el.healthbar.className = frac > 0.5 ? '' : frac > 0.25 ? 'warn' : 'low';

      el.score.innerHTML = `<b class="you">${this.playerScore}</b> — <b class="foe">${this.enemyScore}</b>`;
      el.levelname.textContent = `Level ${this.level + 1} · ${this.theme.name}` +
        (this.capsNeeded > 1 ? ` · ⚑ ${this.levelCaptures}/${this.capsNeeded}` : '');

      // FIRE button: rising fill reveals the solid shell as the gun reloads
      const reload = Math.max(0, Math.min(1, 1 - p.cdShell / (p.shellCdMult || 1)));
      el.shellFill.style.height = (reload * 100) + '%';

      // mine rack: every 5 available mines collapse into an ammo box;
      // loose ones overlap as discs; deployed ones remain as outlines
      const total = p.maxMines();
      const deployed = this.mines.filter(m => m.owner === p && !m.dead).length;
      const avail = total - deployed;
      const boxes = Math.floor(avail / 5);
      const loose = avail % 5;
      const sig = boxes + '/' + loose + '/' + deployed;
      if (el.minePips.dataset.sig !== sig) {
        el.minePips.dataset.sig = sig;
        el.minePips.innerHTML = '';
        for (let i = 0; i < boxes; i++) {
          const b = document.createElement('div');
          b.className = 'mbox';
          el.minePips.appendChild(b);
        }
        for (let i = 0; i < loose; i++) {
          const pip = document.createElement('div');
          pip.className = 'pip';
          el.minePips.appendChild(pip);
        }
        for (let i = 0; i < deployed; i++) {
          const pip = document.createElement('div');
          pip.className = 'pip used';
          el.minePips.appendChild(pip);
        }
      }
      el.btnMine.classList.toggle('cooldown', p.cdMine > 0.15 || deployed >= total);

      let status = '';
      if (p.carryingFlag) status = '🚩 You have the enemy flag — return to your base!';
      else if (this.flags[0].state === 'carried') status = '⚠ The enemy has your flag!';
      else if (this.flags[0].state === 'dropped') status = 'Your flag is on the ground — touch it to return it.';
      el.flagstatus.textContent = status;

      const power = [];
      if (p.autoTargetT > 0) power.push(`◎ AUTO-TARGET ${Math.ceil(p.autoTargetT)}s`);
      if (p.armorItem) {
        power.push(p.armorItem.remaining < 0
          ? `⛨ ${p.armorItem.name} ARMOR armed`
          : `⛨ ${p.armorItem.name} ARMOR ${p.armorItem.remaining.toFixed(1)}s`);
      }
      if (this.strikes.length) power.push('✈ AIR SUPPORT ON STATION');
      el.powerstatus.textContent = power.join('  ·  ');
    },

    /* ---------- render ---------- */

    render() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0f14';
      ctx.fillRect(0, 0, viewW, viewH);
      if (!this.cells) return;

      let sx = 0, sy = 0;
      if (this.shakeT > 0) {
        sx = (Math.random() - 0.5) * this.shakeAmp;
        sy = (Math.random() - 0.5) * this.shakeAmp;
      }

      ctx.save();
      ctx.scale(viewScale, viewScale);
      ctx.translate(-this.camX + sx, -this.camY + sy);

      ctx.drawImage(this.floorCanvas, 0, 0);

      // drifting highlights make the river water move
      if (this.river) {
        const half = this.river.h / 2;
        const crossX = [...this.river.bridges, this.river.tunnelCol].map(b => b * CELL + CELL / 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, .17)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 16; i++) {
          const xx = (this.time * 34 + i * (this.worldW / 16)) % this.worldW;
          const yy = this.river.y - half + 8 + ((i * 37) % (this.river.h - 16));
          if (crossX.some(cx2 => Math.abs(xx - cx2) < 50)) continue;
          ctx.beginPath();
          ctx.moveTo(xx, yy);
          ctx.lineTo(xx + 13, yy);
          ctx.stroke();
        }
      }

      // breakable walls (drawn live so cracks can grow and walls vanish)
      ctx.fillStyle = 'rgba(0, 0, 0, .1)';
      for (const bw of this.breakWalls) {
        ctx.fillRect(bw.x + 3, bw.y + 4, bw.w, bw.h);
        ctx.fillRect(bw.x + 6, bw.y + 7, bw.w, bw.h);
      }
      for (const bw of this.breakWalls) {
        ctx.fillStyle = this.theme.wall;
        ctx.fillRect(bw.x, bw.y, bw.w, bw.h);
        // theme-tuned shading: lighter in Forest so they blend with the
        // foliage walls, slightly darker elsewhere
        ctx.fillStyle = this.theme.breakOverlay;
        ctx.fillRect(bw.x, bw.y, bw.w, bw.h);
        ctx.strokeStyle = this.theme.wallEdge;
        ctx.lineWidth = 2;
        ctx.strokeRect(bw.x + 1, bw.y + 1, bw.w - 2, bw.h - 2);
        ctx.strokeStyle = 'rgba(18, 14, 8, .55)';
        ctx.lineWidth = 1.5;
        const cracks = 2 + (bw.maxHits - bw.hits) * 3;
        for (let i = 0; i < cracks; i++) {
          const px = bw.x + 5 + ((i * 53) % Math.max(8, bw.w - 14));
          const py = bw.y + 3 + ((i * 31) % Math.max(6, bw.h - 14));
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + 7, py + 5);
          ctx.lineTo(px + 3, py + 10);
          ctx.stroke();
        }
      }

      for (const m of this.mines) m.draw(ctx, this.time);

      for (const f of this.flags) {
        if (f.state !== 'carried') {
          const bob = Math.sin(this.time * 3) * 2;
          drawFlag(ctx, f.x, f.y + bob, f.team === 0 ? '#6fe08a' : '#ff7a6b', 1.15, f.team);
        }
      }

      // special items, hovering with a soft shadow beneath
      for (const pk of this.pickups) {
        const bob = Math.sin(this.time * 3 + pk.x) * 3;
        const lift = (bob + 3) / 6; // 0 = low point, 1 = high point
        ctx.save();
        ctx.translate(pk.x, pk.y);
        // shadow shrinks and fades as the item floats higher
        ctx.fillStyle = `rgba(0, 0, 0, ${0.3 - lift * 0.12})`;
        ctx.beginPath();
        ctx.ellipse(0, 17, 12 - lift * 3, 4.5 - lift * 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.translate(0, bob - 4);
        ctx.fillStyle = 'rgba(15, 22, 30, .85)';
        ctx.strokeStyle = ['#ff6b5e', '#5fd9e8', '#ffd34d', '#8ee06b'][pk.type];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (pk.type === 0) { // auto-target crosshair
          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, Math.PI * 2);
          ctx.moveTo(-10, 0); ctx.lineTo(-3, 0);
          ctx.moveTo(3, 0); ctx.lineTo(10, 0);
          ctx.moveTo(0, -10); ctx.lineTo(0, -3);
          ctx.moveTo(0, 3); ctx.lineTo(0, 10);
          ctx.stroke();
        } else if (pk.type === 1) { // armor shield
          ctx.beginPath();
          ctx.moveTo(0, -8); ctx.lineTo(7, -4); ctx.lineTo(7, 2);
          ctx.quadraticCurveTo(7, 8, 0, 10);
          ctx.quadraticCurveTo(-7, 8, -7, 2);
          ctx.lineTo(-7, -4);
          ctx.closePath();
          ctx.stroke();
        } else if (pk.type === 2) { // air support plane
          ctx.beginPath();
          ctx.moveTo(0, -9); ctx.lineTo(2.5, -2); ctx.lineTo(10, 1); ctx.lineTo(2.5, 3);
          ctx.lineTo(2, 8); ctx.lineTo(0, 6); ctx.lineTo(-2, 8); ctx.lineTo(-2.5, 3);
          ctx.lineTo(-10, 1); ctx.lineTo(-2.5, -2);
          ctx.closePath();
          ctx.stroke();
        } else { // extra mines: spiked mine with a plus
          ctx.beginPath();
          ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
          ctx.stroke();
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 5.5, Math.sin(a) * 5.5);
            ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(-2.5, 0); ctx.lineTo(2.5, 0);
          ctx.moveTo(0, -2.5); ctx.lineTo(0, 2.5);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Czech hedgehogs
      for (const h of this.hedgehogs) {
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#3c4449';
        ctx.lineWidth = 5;
        for (const a of [0.4, 1.45, 2.5]) {
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 13, Math.sin(a) * 13);
          ctx.lineTo(-Math.cos(a) * 13, -Math.sin(a) * 13);
          ctx.stroke();
        }
        ctx.strokeStyle = '#6d777e';
        ctx.lineWidth = 2;
        for (const a of [0.4, 1.45, 2.5]) {
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11);
          ctx.lineTo(-Math.cos(a) * 11, -Math.sin(a) * 11);
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const t of this.tanks) t.draw(ctx);

      // auto-target lock brackets on the locked enemy
      const lock = this.player.lockTarget;
      if (lock && lock.alive) {
        ctx.strokeStyle = '#ff5b4d';
        ctx.lineWidth = 2;
        const r = 26, g2 = 9;
        for (const [sx2, sy2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.beginPath();
          ctx.moveTo(lock.x + sx2 * r, lock.y + sy2 * (r - g2));
          ctx.lineTo(lock.x + sx2 * r, lock.y + sy2 * r);
          ctx.lineTo(lock.x + sx2 * (r - g2), lock.y + sy2 * r);
          ctx.stroke();
        }
      }

      for (const s of this.shells) s.draw(ctx);
      for (const b of this.bullets) b.draw(ctx);

      // napalm fire
      for (const f of this.fires) {
        const flick = 0.75 + Math.sin(this.time * 18 + f.x) * 0.25;
        ctx.globalAlpha = Math.min(1, f.life) * 0.85;
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * flick, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * 0.45 * flick, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // falling bombs
      for (const b of this.bombs) {
        ctx.fillStyle = '#23272b';
        ctx.beginPath();
        ctx.ellipse(b.x, b.y, 5, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      for (const p of this.particles) {
        const a = Math.max(0, p.life / p.maxLife);
        if (p.kind === 'smoke') ctx.globalAlpha = a * 0.4;
        else if (p.kind === 'flash') ctx.globalAlpha = a * 0.85;
        else ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // shockwave rings
      for (const r of this.rings) {
        const a = Math.max(0, r.life / r.maxLife);
        ctx.strokeStyle = `rgba(255, 214, 150, ${a * 0.7})`;
        ctx.lineWidth = 2 + a * 3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // the under-river tunnel: a stone tube with arched portals at each
      // end so it reads as a tunnel rather than a floating slab
      for (const t of this.tunnels) {
        const vertical = t.h > t.w;
        // dark portal mouths peeking out past the tube ends
        ctx.fillStyle = '#0c0f14';
        ctx.beginPath();
        if (vertical) {
          ctx.ellipse(t.x + t.w / 2, t.y + 6, t.w / 2 - 4, 9, 0, 0, Math.PI * 2);
          ctx.ellipse(t.x + t.w / 2, t.y + t.h - 6, t.w / 2 - 4, 9, 0, 0, Math.PI * 2);
        } else {
          ctx.ellipse(t.x + 6, t.y + t.h / 2, 9, t.h / 2 - 4, 0, 0, Math.PI * 2);
          ctx.ellipse(t.x + t.w - 6, t.y + t.h / 2, 9, t.h / 2 - 4, 0, 0, Math.PI * 2);
        }
        ctx.fill();
        // stone tube
        ctx.fillStyle = 'rgba(74, 82, 96, .96)';
        ctx.strokeStyle = '#262d38';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(t.x, t.y, t.w, t.h, Math.min(t.w, t.h) / 2 - 4);
        ctx.fill();
        ctx.stroke();
        // arch ribs
        ctx.strokeStyle = 'rgba(30, 36, 46, .55)';
        ctx.lineWidth = 2.5;
        if (vertical) {
          for (let yy = t.y + 18; yy < t.y + t.h - 12; yy += 17) {
            ctx.beginPath();
            ctx.moveTo(t.x + 6, yy);
            ctx.quadraticCurveTo(t.x + t.w / 2, yy - 7, t.x + t.w - 6, yy);
            ctx.stroke();
          }
        } else {
          for (let xx = t.x + 18; xx < t.x + t.w - 12; xx += 17) {
            ctx.beginPath();
            ctx.moveTo(xx, t.y + 6);
            ctx.quadraticCurveTo(xx - 7, t.y + t.h / 2, xx, t.y + t.h - 6);
            ctx.stroke();
          }
        }
        // center lane stripe hint
        ctx.strokeStyle = 'rgba(160, 170, 184, .25)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 10]);
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(t.x + t.w / 2, t.y + 12);
          ctx.lineTo(t.x + t.w / 2, t.y + t.h - 12);
        } else {
          ctx.moveTo(t.x + 12, t.y + t.h / 2);
          ctx.lineTo(t.x + t.w - 12, t.y + t.h / 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // support planes fly above everything
      for (const s of this.strikes) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.fillStyle = 'rgba(0, 0, 0, .25)';
        ctx.beginPath();
        ctx.ellipse(10, 30, 26, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9aa6ae';
        ctx.fillRect(-6, -26, 11, 52);          // wings
        ctx.fillRect(-24, -9, 6, 18);           // tail
        ctx.beginPath();
        ctx.roundRect(-24, -5, 50, 10, 5);      // fuselage
        ctx.fill();
        ctx.fillStyle = '#6d777e';
        ctx.beginPath();
        ctx.arc(14, 0, 4, 0, Math.PI * 2);      // canopy
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      this.renderMinimap();
    },

    renderMinimap() {
      if (!this.miniCanvas) return;
      mctx.clearRect(0, 0, minimap.width, minimap.height);
      mctx.drawImage(this.miniCanvas, 0, 0);
      const s = this.miniScale;
      for (const pk of this.pickups) {
        mctx.fillStyle = '#ffd34d';
        mctx.fillRect(pk.x * s - 1.5, pk.y * s - 1.5, 3, 3);
      }
      for (const f of this.flags) {
        mctx.fillStyle = f.team === 0 ? '#6fe08a' : '#ff7a6b';
        mctx.fillRect(f.x * s - 2.5, f.y * s - 2.5, 5, 5);
      }
      for (const t of this.tanks) {
        if (!t.alive) continue;
        mctx.fillStyle = t.isPlayer ? '#ffffff' : '#ff5b4d';
        mctx.beginPath();
        mctx.arc(t.x * s, t.y * s, t.isPlayer ? 3 : 2.4, 0, Math.PI * 2);
        mctx.fill();
      }
    },
  };

  /* ============================ Overlay / flow ============================ */

  function showOverlay(title, html, btnLabel) {
    el.overlayTitle.textContent = title;
    el.overlayText.innerHTML = html;
    el.overlayBtn.textContent = btnLabel;
    el.overlay.classList.remove('hidden');
  }

  let selectedDiff = 1;
  document.querySelectorAll('.diff').forEach(btn => {
    const pick = (e) => {
      e.preventDefault();
      selectedDiff = +btn.dataset.d;
      document.querySelectorAll('.diff').forEach(b => b.classList.toggle('sel', b === btn));
    };
    btn.addEventListener('click', pick);
    btn.addEventListener('touchend', pick, { passive: false });
  });

  function onOverlayButton() {
    sfx.unlock();
    if (game.state === 'victory') {
      // keep rolling: same scores, next cycle of terrains
      game.state = 'playing';
      el.overlay.classList.add('hidden');
      game.startLevel(game.level + 1);
    } else {
      game.start(selectedDiff);
    }
  }
  el.overlayBtn.addEventListener('click', onOverlayButton);
  el.overlayBtn.addEventListener('touchend', (e) => { e.preventDefault(); onOverlayButton(); }, { passive: false });

  /* ============================ Main loop ============================ */

  // Custom flag artwork for both teams: prefer the compressed .svgz
  // (inflated in the browser, since static hosts rarely set the right
  // headers for .svgz), fall back to .svg, then to the built-in pennant.
  // Each SVG is rasterized once to an offscreen canvas so drawing it
  // every frame stays cheap.
  async function loadFlagArt(team, base) {
    const loadImg = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('bad image'));
      img.src = src;
    });
    const fromText = async (text) => {
      const vb = text.match(/viewBox=["']\s*[\d.+-]+[ ,]+[\d.+-]+[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)/);
      const aspect = vb ? parseFloat(vb[1]) / parseFloat(vb[2]) : 0.8;
      const img = await loadImg(URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })));
      const raster = document.createElement('canvas');
      raster.height = 192; // plenty for ~50px on-screen at high dpr
      raster.width = Math.round(192 * aspect);
      raster.getContext('2d').drawImage(img, 0, 0, raster.width, raster.height);
      FlagAssets.aspect[team] = aspect;
      FlagAssets.art[team] = raster;
    };
    try {
      const res = await fetch(base + '.svgz');
      if (!res.ok) throw new Error('missing svgz');
      const buf = new Uint8Array(await res.arrayBuffer());
      let text;
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        // raw gzip bytes — inflate here
        const ds = new DecompressionStream('gzip');
        text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
      } else {
        text = new TextDecoder().decode(buf); // server already inflated it
      }
      await fromText(text);
    } catch (e) {
      try {
        const res = await fetch(base + '.svg');
        if (!res.ok) throw new Error('missing svg');
        await fromText(await res.text());
      } catch (e2) { /* keep the vector pennant */ }
    }
  }
  loadFlagArt(0, 'assets/allied-flag');
  loadFlagArt(1, 'assets/enemy-flag');

  window.__game = game; // debug/testing handle

  let lastT = performance.now();
  function frame(now) {
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 1 / 20); // clamp after tab-switch pauses
    if (game.state !== 'menu') {
      game.update(dt);
      game.render();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
