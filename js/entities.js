/* Entities: Tank, Shell, Bullet, Mine, particles + collision helpers.
   Damage hierarchy (strongest to weakest): tank ram, mine, shell, bullet. */

const DMG = {
  RAM_MAX: 50,   // full-speed head-on collision
  MINE: 45,
  SHELL: 25,
  BULLET: 4,
};

const REGEN_DELAY = 3.5;   // seconds without damage before repairs start
const REGEN_RATE = 8;      // hp per second

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* Circle vs rect: returns push-out vector or null. */
function circleRectHit(px, py, r, rect) {
  const cx = clamp(px, rect.x, rect.x + rect.w);
  const cy = clamp(py, rect.y, rect.y + rect.h);
  const dx = px - cx, dy = py - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: r - d };
  }
  // Center is inside the rect: push out along the shallowest axis.
  const left = px - rect.x, right = rect.x + rect.w - px;
  const top = py - rect.y, bottom = rect.y + rect.h - py;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, depth: left + r };
  if (m === right) return { nx: 1, ny: 0, depth: right + r };
  if (m === top) return { nx: 0, ny: -1, depth: top + r };
  return { nx: 0, ny: 1, depth: bottom + r };
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/* Sampled line-of-sight check against the wall list. */
function hasLOS(walls, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(dist / 12));
  for (let i = 1; i < steps; i++) {
    const px = x0 + dx * i / steps, py = y0 + dy * i / steps;
    for (const w of walls) {
      if (pointInRect(px, py, w)) return false;
    }
  }
  return true;
}

/* ============================ Tank ============================ */

class Tank {
  constructor(team, x, y, angle, isPlayer) {
    this.team = team;           // 0 = player side (green), 1 = enemy (red)
    this.isPlayer = !!isPlayer;
    this.x = x; this.y = y;
    this.spawnX = x; this.spawnY = y; this.spawnAngle = angle;
    this.angle = angle;
    this.radius = 17;
    this.maxHp = 100;
    this.hp = 100;
    this.alive = true;
    this.respawnT = 0;
    this.invulnT = 2;
    this.speed = 0;
    this.maxSpeed = 170;
    this.accel = 380;
    this.turnRate = 3.4;
    this.throttle = 0;          // -1..1
    this.steer = 0;             // -1..1
    this.desiredAngle = null;   // joystick / AI heading mode
    this.desiredThrottle = 0;
    this.cdShell = 0;
    this.cdMG = 0;
    this.cdMine = 0;
    this.ramCd = 0;
    this.lastHitT = 999;
    this.carryingFlag = null;   // flag object or null
    this.ai = null;             // attached by game for enemies
    this.trackPhase = 0;
    this.turretAngle = angle;   // turret can aim independently (auto-target)
    this.armorItem = null;      // pickup armor: { name, duration, remaining }
    this.autoTargetT = 0;       // auto-target pickup time left
    this.lockTarget = null;
    this.lockT = 0;
  }

  maxMines() { return 4 + (this.mineBonus || 0); }

  update(dt, game) {
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.respawn(game);
      return;
    }

    this.cdShell = Math.max(0, this.cdShell - dt);
    this.cdMG = Math.max(0, this.cdMG - dt);
    this.cdMine = Math.max(0, this.cdMine - dt);
    this.ramCd = Math.max(0, this.ramCd - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.lastHitT += dt;

    // pickup armor: countdown starts at the first hit taken while armored
    if (this.armorItem && this.armorItem.remaining >= 0) {
      this.armorItem.remaining -= dt;
      if (this.armorItem.remaining <= 0) this.armorItem = null;
    }

    // Repairs accumulate while not taking hits.
    if (this.lastHitT > REGEN_DELAY && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + REGEN_RATE * dt);
    }

    // --- steering ---
    let throttle = this.throttle;
    if (this.desiredAngle !== null) {
      const diff = angleDiff(this.desiredAngle, this.angle);
      this.angle += clamp(diff, -this.turnRate * dt, this.turnRate * dt);
      // Only drive forward when roughly facing the requested heading.
      const align = Math.cos(diff);
      throttle = this.desiredThrottle * clamp(align, 0, 1);
      if (Math.abs(diff) > 1.4) throttle = 0; // rotate in place first
    } else {
      this.angle += this.steer * this.turnRate * dt;
    }

    const targetSpeed = throttle * this.maxSpeed * (throttle < 0 ? 0.55 : 1);
    if (this.speed < targetSpeed) this.speed = Math.min(targetSpeed, this.speed + this.accel * dt);
    else this.speed = Math.max(targetSpeed, this.speed - this.accel * dt);

    // mud and barbed wire slow the tank down (dense wire nearly stops it)
    const terrain = game.terrainFactor ? game.terrainFactor(this) : 1;
    this.x += Math.cos(this.angle) * this.speed * terrain * dt;
    this.y += Math.sin(this.angle) * this.speed * terrain * dt;
    this.trackPhase += Math.abs(this.speed * terrain) * dt * 0.15;

    // --- wall / river / rubble collision (slide) ---
    const solids = game.tankSolids || game.walls;
    for (const w of solids) {
      const hit = circleRectHit(this.x, this.y, this.radius, w);
      if (hit) {
        this.x += hit.nx * hit.depth;
        this.y += hit.ny * hit.depth;
      }
    }
    // Czech hedgehogs: solid to tanks, projectiles pass between the beams
    if (game.hedgehogs) {
      for (const h of game.hedgehogs) {
        const dx = this.x - h.x, dy = this.y - h.y;
        const d = Math.hypot(dx, dy), minD = h.r + this.radius;
        if (d < minD && d > 0.001) {
          this.x += dx / d * (minD - d);
          this.y += dy / d * (minD - d);
        }
      }
    }
    this.x = clamp(this.x, this.radius, game.worldW - this.radius);
    this.y = clamp(this.y, this.radius, game.worldH - this.radius);

    // turret relaxes back to the hull heading unless a lock is steering it
    if (!this.lockTarget) {
      const td = angleDiff(this.angle, this.turretAngle);
      this.turretAngle += clamp(td, -6 * dt, 6 * dt);
    }
  }

  damage(amount, game, source) {
    if (!this.alive || this.invulnT > 0) return;
    if (this.armorItem) {
      if (this.armorItem.remaining < 0) this.armorItem.remaining = this.armorItem.duration;
      amount *= 0.3;
    }
    this.hp -= amount;
    this.lastHitT = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(game, source);
    }
  }

  die(game, source) {
    if (!this.alive) return;
    this.alive = false;
    this.speed = 0;
    this.respawnT = this.isPlayer ? 2.6 : 4.2;
    game.onTankDestroyed(this, source);
  }

  respawn(game) {
    this.alive = true;
    this.hp = this.maxHp;
    this.x = this.spawnX; this.y = this.spawnY;
    this.angle = this.spawnAngle;
    this.turretAngle = this.spawnAngle;
    this.speed = 0;
    this.invulnT = 2.2;
    this.lastHitT = 999;
    this.cdShell = 0.5; this.cdMG = 0.5; this.cdMine = 1;
    this.autoTargetT = 0;
    this.lockTarget = null;
    this.armorItem = null;
  }

  muzzle(dist) {
    return {
      x: this.x + Math.cos(this.turretAngle) * dist,
      y: this.y + Math.sin(this.turretAngle) * dist,
    };
  }

  fireShell(game) {
    if (!this.alive || this.cdShell > 0) return false;
    this.cdShell = 1.0 * (this.shellCdMult || 1);
    const m = this.muzzle(26);
    game.shells.push(new Shell(m.x, m.y, this.turretAngle, this));
    game.sfx.shell();
    game.addKick(this, -14);
    if (game.spawnMuzzle) game.spawnMuzzle(m.x, m.y, this.turretAngle, false);
    return true;
  }

  fireMG(game) {
    if (!this.alive || this.cdMG > 0) return false;
    this.cdMG = 0.11;
    const m = this.muzzle(26);
    const spread = (Math.random() - 0.5) * 0.10;
    game.bullets.push(new Bullet(m.x, m.y, this.turretAngle + spread, this));
    game.sfx.mg();
    if (game.spawnMuzzle) game.spawnMuzzle(m.x, m.y, this.turretAngle, true);
    return true;
  }

  dropMine(game) {
    if (!this.alive || this.cdMine > 0) return false;
    const mine = game.mines.filter(m => m.owner === this && !m.dead);
    if (mine.length >= this.maxMines()) return false;
    this.cdMine = 1.4;
    const bx = this.x - Math.cos(this.angle) * 30;
    const by = this.y - Math.sin(this.angle) * 30;
    game.mines.push(new Mine(bx, by, this));
    game.sfx.mine();
    return true;
  }

  draw(ctx) {
    if (!this.alive) return;
    const body = this.team === 0 ? '#3f9e58' : '#b5483c';
    const dark = this.team === 0 ? '#2c6e3e' : '#7e322a';
    const turret = this.team === 0 ? '#54c771' : '#d8604f';

    ctx.save();
    ctx.translate(this.x, this.y);

    // grounding shadow
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath();
    ctx.ellipse(3, 4, 18.5, 15.5, this.angle, 0, Math.PI * 2);
    ctx.fill();

    if (this.invulnT > 0 && Math.floor(this.invulnT * 10) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }

    ctx.save();
    ctx.rotate(this.angle);
    // treads
    ctx.fillStyle = '#1d242b';
    ctx.fillRect(-16, -16, 32, 9);
    ctx.fillRect(-16, 7, 32, 9);
    // tread links scroll with movement
    ctx.fillStyle = '#39434d';
    for (let i = 0; i < 5; i++) {
      const off = ((i * 7 + this.trackPhase * 7) % 32) - 16;
      ctx.fillRect(off, -16, 3, 9);
      ctx.fillRect(off, 7, 3, 9);
    }
    // hull
    ctx.fillStyle = body;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-15, -10, 30, 20, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // turret + barrel rotate independently of the hull
    ctx.save();
    ctx.rotate(this.turretAngle);
    ctx.fillStyle = dark;
    ctx.fillRect(6, -3, 22, 6);
    ctx.fillStyle = turret;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // pickup armor shimmer
    if (this.armorItem) {
      const counting = this.armorItem.remaining >= 0;
      ctx.strokeStyle = counting && Math.floor(this.armorItem.remaining * 6) % 2 === 0
        ? 'rgba(95, 217, 232, .45)' : 'rgba(95, 217, 232, .95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 23, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // carried flag streams behind the tank
    if (this.carryingFlag) {
      const fx = this.x - Math.cos(this.angle) * 22;
      const fy = this.y - Math.sin(this.angle) * 22;
      drawFlag(ctx, fx, fy, this.carryingFlag.team === 0 ? '#6fe08a' : '#ff7a6b', 0.85,
               this.carryingFlag.team);
    }

    // hp bar (only when damaged)
    if (this.hp < this.maxHp) {
      const w = 32, frac = this.hp / this.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(this.x - w / 2 - 1, this.y - 30, w + 2, 6);
      ctx.fillStyle = frac > 0.5 ? '#5fd877' : frac > 0.25 ? '#e8c44b' : '#e0524b';
      ctx.fillRect(this.x - w / 2, this.y - 29, w * frac, 4);
    }
  }
}

/* Custom flag artwork: when assets/enemy-flag.svg exists it is loaded
   into FlagAssets.enemy (see game.js) and replaces the vector enemy
   flag; otherwise the built-in pennant is drawn. */
const FlagAssets = { enemy: null };

function drawFlag(ctx, x, y, color, scale = 1, team) {
  if (team === 1 && FlagAssets.enemy) {
    const img = FlagAssets.enemy;
    const h = 34 * scale;
    const w = h * ((img.width && img.height) ? img.width / img.height : 1);
    // anchor the artwork's bottom-left near the pole's ground point
    ctx.drawImage(img, x - w * 0.15, y + 10 * scale - h, w, h);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#d9e2ea';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.lineTo(0, -14);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -14);
  ctx.lineTo(15, -9);
  ctx.lineTo(0, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ============================ Shell ============================ */

class Shell {
  constructor(x, y, angle, owner) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * 430;
    this.vy = Math.sin(angle) * 430;
    this.angle = angle;
    this.owner = owner;
    this.team = owner.team;
    this.r = 4.5;
    this.life = 2.2;
    this.dead = false;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.explode(game); return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    for (const w of game.walls) {
      if (circleRectHit(this.x, this.y, this.r, w)) { this.explode(game); return; }
    }
    // breakable walls take shell hits and eventually crumble
    for (const bw of game.breakWalls || []) {
      if (circleRectHit(this.x, this.y, this.r, bw)) {
        game.damageBreakWall(bw);
        this.explode(game);
        return;
      }
    }
    for (const t of game.tanks) {
      if (!t.alive || t.team === this.team) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < t.radius + this.r) {
        t.damage(DMG.SHELL * (this.owner.dmgMult || 1), game, this.owner);
        this.explode(game);
        return;
      }
    }
  }

  explode(game) {
    if (this.dead) return;
    this.dead = true;
    game.spawnExplosion(this.x, this.y, 26, '#ffb347');
    game.sfx.boomSmall();
    // small splash to nearby enemy tanks
    for (const t of game.tanks) {
      if (!t.alive || t.team === this.team) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < 46) t.damage(DMG.SHELL * 0.4 * (this.owner.dmgMult || 1), game, this.owner);
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = '#ffd9a0';
    ctx.beginPath();
    ctx.ellipse(0, 0, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ============================ Bullet ============================ */

class Bullet {
  constructor(x, y, angle, owner) {
    this.x = x; this.y = y;
    this.vx = Math.cos(angle) * 620;
    this.vy = Math.sin(angle) * 620;
    this.owner = owner;
    this.team = owner.team;
    this.r = 2;
    this.life = 0.9;
    this.dead = false;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    for (const w of game.walls) {
      if (pointInRect(this.x, this.y, w)) {
        this.dead = true;
        game.spawnSpark(this.x, this.y);
        return;
      }
    }
    for (const bw of game.breakWalls || []) {
      if (pointInRect(this.x, this.y, bw)) {
        this.dead = true;
        game.spawnSpark(this.x, this.y);
        return;
      }
    }
    for (const t of game.tanks) {
      if (!t.alive || t.team === this.team) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < t.radius + this.r) {
        t.damage(DMG.BULLET * (this.owner.dmgMult || 1), game, this.owner);
        game.spawnSpark(this.x, this.y);
        this.dead = true;
        return;
      }
    }
  }

  draw(ctx) {
    ctx.fillStyle = '#ffe98a';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ============================ Mine ============================ */

class Mine {
  constructor(x, y, owner) {
    this.x = x; this.y = y;
    this.owner = owner;
    this.team = owner.team;
    this.r = 9;
    this.triggerR = 24;
    this.blastR = 75;
    this.armT = 1.2;       // safe handling time after drop
    this.fuse = 60;        // idle lifetime before final countdown
    this.countdown = -1;   // becomes 10 when the fuse expires
    this.beepT = 0;
    this.dead = false;
  }

  armed() { return this.armT <= 0; }

  update(dt, game) {
    if (this.armT > 0) { this.armT -= dt; return; }

    if (this.countdown < 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) this.countdown = 10; // 1 minute idle -> 10s countdown
    } else {
      this.countdown -= dt;
      this.beepT -= dt;
      if (this.beepT <= 0) {
        game.sfx.beep();
        // beeping accelerates as detonation approaches
        this.beepT = clamp(this.countdown / 10, 0.12, 1);
      }
      if (this.countdown <= 0) { this.explode(game); return; }
    }

    // pressure trigger: any tank (including the owner once armed)
    for (const t of game.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < this.triggerR + t.radius * 0.4) { this.explode(game); return; }
    }
  }

  explode(game) {
    if (this.dead) return;
    this.dead = true;
    game.spawnExplosion(this.x, this.y, 52, '#ff8c42');
    game.sfx.boomBig();
    game.shake(8);
    for (const t of game.tanks) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < this.blastR + t.radius) {
        const falloff = clamp(1 - d / (this.blastR + t.radius), 0.35, 1);
        t.damage(DMG.MINE * falloff, game, this.owner);
      }
    }
  }

  draw(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    // contact shadow
    ctx.fillStyle = 'rgba(0, 0, 0, .25)';
    ctx.beginPath();
    ctx.ellipse(1.5, 2, this.r + 1, this.r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    // domed steel body
    const grad = ctx.createRadialGradient(-3, -3.5, 1, 0, 0, this.r);
    if (this.armed()) {
      grad.addColorStop(0, '#6c757d');
      grad.addColorStop(0.55, '#42484e');
      grad.addColorStop(1, '#23272b');
    } else {
      grad.addColorStop(0, '#8a949c');
      grad.addColorStop(0.55, '#5b636b');
      grad.addColorStop(1, '#343a40');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c2024';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // pressure plate ring + bolts
    ctx.strokeStyle = 'rgba(20, 23, 26, .7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, this.r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#1c2024';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.PI / 6;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * this.r * 0.78, Math.sin(a) * this.r * 0.78, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    // status light: slow amber when idle, fast red during final countdown
    let lit, color;
    if (this.countdown >= 0) {
      const rate = clamp(this.countdown, 0.6, 10) / 10;
      lit = Math.floor(time / (0.07 + rate * 0.18)) % 2 === 0;
      color = '#ff3b30';
    } else {
      lit = this.armed() && Math.floor(time / 0.6) % 2 === 0;
      color = '#ffb020';
    }
    if (lit) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // visible countdown number for the final 10 seconds
    if (this.countdown >= 0 && this.countdown < 10) {
      ctx.fillStyle = '#ff6b5e';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(Math.ceil(this.countdown), 0, -14);
    }
    ctx.restore();
  }
}
