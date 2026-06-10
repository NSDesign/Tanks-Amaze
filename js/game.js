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

  const THEMES = [
    {
      name: 'City', floor: '#41464c', speck: '#4d5359',
      wall: '#67737e', wallEdge: '#2c343c',
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
      name: 'Town', floor: '#8d7c5f', speck: '#9c8b6c',
      wall: '#a05a40', wallEdge: '#5e3322',
      detail(ctx, r) { // roof ridges
        ctx.strokeStyle = 'rgba(255,255,255,.18)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (r.w > r.h) { ctx.moveTo(r.x + 4, r.y + r.h / 2); ctx.lineTo(r.x + r.w - 4, r.y + r.h / 2); }
        else { ctx.moveTo(r.x + r.w / 2, r.y + 4); ctx.lineTo(r.x + r.w / 2, r.y + r.h - 4); }
        ctx.stroke();
      },
    },
    {
      name: 'Forest', floor: '#3e6339', speck: '#476f41',
      wall: '#27462a', wallEdge: '#16291a',
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
      detail(ctx, r) { // cracked rock
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
    {
      name: 'Tundra', floor: '#c3d2da', speck: '#b1c2cc',
      wall: '#7395ab', wallEdge: '#46647a',
      detail(ctx, r) { // ice sheen
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        if (r.w > r.h) ctx.fillRect(r.x + 3, r.y + 3, r.w - 6, 3);
        else ctx.fillRect(r.x + 3, r.y + 3, 3, r.h - 6);
      },
    },
  ];

  const LEVELS = [
    { cols: 13, rows: 9, enemies: 2 },
    { cols: 15, rows: 11, enemies: 2 },
    { cols: 15, rows: 11, enemies: 3 },
    { cols: 17, rows: 11, enemies: 3 },
    { cols: 17, rows: 13, enemies: 4 },
  ];

  const CELL = 100;
  const WALL_T = 14;
  const ENEMY_CAPTURES_TO_LOSE = 3;

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
    msg: document.getElementById('msg'),
    mineCount: document.getElementById('mineCount'),
    btnShell: document.getElementById('btnShell'),
    btnMG: document.getElementById('btnMG'),
    btnMine: document.getElementById('btnMine'),
    overlay: document.getElementById('overlay'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayText: document.getElementById('overlay-text'),
    overlayBtn: document.getElementById('overlay-btn'),
  };

  let dpr = 1, viewW = 0, viewH = 0, viewScale = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    // zoom out a touch on small screens so corridors stay readable
    viewScale = Math.max(0.7, Math.min(1.05, Math.min(viewW, viewH) / 560));
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

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
    flags: [],
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

    shake(amp) {
      this.shakeAmp = Math.max(this.shakeAmp, amp);
      this.shakeT = 0.35;
    },

    addKick(tank, amount) {
      tank.speed += amount;
    },

    spawnExplosion(x, y, size, color) {
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

    /* ---------- level setup ---------- */

    startLevel(levelIdx) {
      const cfg = LEVELS[levelIdx % LEVELS.length];
      this.level = levelIdx;
      this.theme = THEMES[levelIdx % THEMES.length];
      const cols = cfg.cols, rows = cfg.rows;
      this.cells = Maze.generate(cols, rows);
      this.walls = Maze.buildWallRects(this.cells, CELL, WALL_T);
      this.worldW = cols * CELL;
      this.worldH = rows * CELL;
      this.shells = [];
      this.bullets = [];
      this.mines = [];
      this.particles = [];
      this.tanks = [];

      // Bases: player bottom-left, enemy top-right.
      const pBase = this.cellCenter(0, rows - 1);
      const eBase = this.cellCenter(cols - 1, 0);
      this.flags = [
        { team: 0, baseX: pBase.x, baseY: pBase.y, x: pBase.x, y: pBase.y, state: 'base', carrier: null, returnT: 0 },
        { team: 1, baseX: eBase.x, baseY: eBase.y, x: eBase.x, y: eBase.y, state: 'base', carrier: null, returnT: 0 },
      ];

      this.player = new Tank(0, pBase.x, pBase.y, -Math.PI / 2, true);
      this.tanks.push(this.player);

      const enemyCount = cfg.enemies + Math.min(this.cycle, 2);
      const spawnCells = [
        [cols - 1, 0], [cols - 2, 0], [cols - 1, 1], [cols - 2, 1],
        [cols - 3, 0], [cols - 1, 2],
      ];
      for (let i = 0; i < enemyCount; i++) {
        const sc = spawnCells[i % spawnCells.length];
        const p = this.cellCenter(sc[0], sc[1]);
        const t = new Tank(1, p.x, p.y, Math.PI / 2, false);
        // faster AI tanks on later cycles
        t.maxSpeed *= 1 + this.cycle * 0.08;
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

      // base pads
      for (const f of this.flags) {
        g.fillStyle = f.team === 0 ? 'rgba(110, 224, 138, .25)' : 'rgba(255, 122, 107, .25)';
        g.strokeStyle = f.team === 0 ? 'rgba(110, 224, 138, .7)' : 'rgba(255, 122, 107, .7)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(f.baseX, f.baseY, 38, 0, Math.PI * 2);
        g.fill();
        g.stroke();
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
      g.fillStyle = '#5d7488';
      for (const r of this.walls) {
        g.fillRect(r.x * s, r.y * s, Math.max(1, r.w * s), Math.max(1, r.h * s));
      }
      this.miniCanvas = c;
      this.miniScale = s;
    },

    /* ---------- flow ---------- */

    start() {
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
      sfx.capture();
      this.showMsg('FLAG CAPTURED! +1', 2.4);
      this.shake(6);
      this.state = 'levelup';
      this.stateT = 2.0;
    },

    onEnemyCapture() {
      this.enemyScore++;
      sfx.lose();
      this.shake(6);
      if (this.enemyScore >= ENEMY_CAPTURES_TO_LOSE) {
        this.showMsg('YOUR FLAG IS GONE', 3);
        this.state = 'gameover';
        this.stateT = 1.6;
      } else {
        this.showMsg(`ENEMY CAPTURED YOUR FLAG (${this.enemyScore}/${ENEMY_CAPTURES_TO_LOSE})`, 2.6);
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
              `All ${LEVELS.length} terrains conquered — final score ${this.playerScore}–${this.enemyScore}.<br>` +
              'The war continues at higher difficulty if you keep rolling.',
              'KEEP ROLLING');
            return;
          }
          this.state = 'playing';
          this.startLevel(next);
        }
      } else if (this.state === 'gameover') {
        this.stateT -= dt;
        if (this.stateT <= 0 && el.overlay.classList.contains('hidden')) {
          showOverlay('DEFEAT', `The enemy captured your flag ${ENEMY_CAPTURES_TO_LOSE} times.<br>Final score ${this.playerScore}–${this.enemyScore}.`, 'TRY AGAIN');
        }
      }

      if (this.state === 'menu') return;

      // --- player controls ---
      if (this.player.alive && this.state === 'playing') {
        const inp = Input.read();
        if (inp.joyActive) {
          this.player.desiredAngle = inp.joyAngle;
          this.player.desiredThrottle = inp.joyMag;
        } else {
          this.player.desiredAngle = null;
          this.player.throttle = inp.forward;
          this.player.steer = inp.turn;
        }
        if (inp.fireShell) this.player.fireShell(this);
        if (inp.fireMG) this.player.fireMG(this);
        if (Input.consumeMine()) this.player.dropMine(this);
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

      for (const p of this.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.92;
        p.vy *= 0.92;
      }
      this.particles = this.particles.filter(p => p.life > 0);

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
          hasLOS(this.walls, t.x, t.y, player.x, player.y);
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

      const myMines = this.mines.filter(m => m.owner === p && !m.dead).length;
      el.mineCount.textContent = '×' + (p.maxMines() - myMines);

      el.btnShell.classList.toggle('cooldown', p.cdShell > 0.15);
      el.btnMine.classList.toggle('cooldown', p.cdMine > 0.15 || myMines >= p.maxMines());

      let status = '';
      if (p.carryingFlag) status = '🚩 You have the enemy flag — return to your base!';
      else if (this.flags[0].state === 'carried') status = '⚠ The enemy has your flag!';
      else if (this.flags[0].state === 'dropped') status = 'Your flag is on the ground — touch it to return it.';
      el.flagstatus.textContent = status;
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

      for (const m of this.mines) m.draw(ctx, this.time);

      for (const f of this.flags) {
        if (f.state !== 'carried') {
          const bob = Math.sin(this.time * 3) * 2;
          drawFlag(ctx, f.x, f.y + bob, f.team === 0 ? '#6fe08a' : '#ff7a6b', 1.15);
        }
      }

      for (const t of this.tanks) t.draw(ctx);
      for (const s of this.shells) s.draw(ctx);
      for (const b of this.bullets) b.draw(ctx);

      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      this.renderMinimap();
    },

    renderMinimap() {
      if (!this.miniCanvas) return;
      mctx.clearRect(0, 0, minimap.width, minimap.height);
      mctx.drawImage(this.miniCanvas, 0, 0);
      const s = this.miniScale;
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

  function onOverlayButton() {
    sfx.unlock();
    if (game.state === 'victory') {
      // keep rolling: same scores, next cycle of terrains
      game.state = 'playing';
      el.overlay.classList.add('hidden');
      game.startLevel(game.level + 1);
    } else {
      game.start();
    }
  }
  el.overlayBtn.addEventListener('click', onOverlayButton);
  el.overlayBtn.addEventListener('touchend', (e) => { e.preventDefault(); onOverlayButton(); }, { passive: false });

  /* ============================ Main loop ============================ */

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
