// The game's rules and state, with no drawing and no browser in it: the player's ship, the pools
// of enemies, bullets, pickups and effects, the wave director, the combo multiplier, collisions
// and score. step() advances one fixed step and returns what happened as bit flags, so the caller
// can react without the world knowing about screens or sound. `demo` mode runs the title screen's
// backdrop battle: chasers drift in, the ship fights on its own, and nothing can hurt anything.
import { COMBO, DASH, ENEMIES, ENEMY_BULLET, FIELD, PICKUP, PALETTE, PLAYER, POOL, WAVE_MIX, WAVES } from './config.js';

export const EVENT_SHOOT = 1;
export const EVENT_DASH = 2;
export const EVENT_HURT = 4;
export const EVENT_OVER = 8;
export const EVENT_KILL = 16;
export const EVENT_ELITE = 32;
export const EVENT_ELITE_DOWN = 64;
export const EVENT_ESHOOT = 128;
export const EVENT_PICKUP = 256;
export const EVENT_WAVE = 512;
export const EVENT_WAVECLEAR = 1024;
export const EVENT_MILESTONE = 2048;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}

export function createWorld(random) {
  const player = {
    x: 0, y: 0, vx: 0, vy: 0, angle: -Math.PI / 2, radius: PLAYER.radius,
    lives: PLAYER.lives, invuln: 0, fireT: 0, dashT: 0, dashCd: 0, dashA: 0, ghostT: 0, dashId: 0,
  };
  const bullets = [];
  const enemies = [];
  const particles = [];
  const rings = [];
  const texts = [];
  const pickups = [];
  const ghosts = [];
  for (let i = 0; i < POOL.bullets; i += 1) bullets.push({ active: false, hostile: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0 });
  for (let i = 0; i < POOL.enemies; i += 1) {
    enemies.push({
      active: false, kind: '', base: null, x: 0, y: 0, a: 0, hp: 0, maxHp: 0, r: 0, speed: 0, score: 0,
      t: 0, state: 0, sT: 0, sT2: 0, fireT: 0, flash: 0, entered: false, strafe: 1, wob: 0, locked: 0,
      pattern: 0, spiral: 0, lastDash: -1,
    });
  }
  for (let i = 0; i < POOL.particles; i += 1) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, drag: 3.2, color: '' });
  for (let i = 0; i < POOL.rings; i += 1) rings.push({ active: false, x: 0, y: 0, r: 0, speed: 0, life: 0, maxLife: 1, width: 3, color: '' });
  for (let i = 0; i < POOL.texts; i += 1) texts.push({ active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1, size: 17, color: '', str: '' });
  for (let i = 0; i < POOL.pickups; i += 1) pickups.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, t: 0 });
  for (let i = 0; i < POOL.ghosts; i += 1) ghosts.push({ active: false, x: 0, y: 0, a: 0, life: 0, maxLife: 1 });

  const state = {
    player,
    bullets, enemies, particles, rings, texts, pickups, ghosts,
    score: 0, wave: 1, combo: 0, comboT: 0, mult: 1, time: 0, shake: 0, damageFlash: 0,
    phase: 'combat', interT: 0, spawnT: 0, alive: 0,
    ann: { text: '', sub: '', t: 0, dur: 1 },
    over: false,
  };

  const spawnQueue = [];
  let queueAt = 0;
  let ev = 0;
  let demoT = 0;

  function announce(text, sub, dur) {
    state.ann.text = text;
    state.ann.sub = sub;
    state.ann.t = dur;
    state.ann.dur = dur;
  }

  function freeIn(pool) {
    for (let i = 0; i < pool.length; i += 1) if (!pool[i].active) return pool[i];
    return null;
  }

  function reset() {
    const pools = [bullets, enemies, particles, rings, texts, pickups, ghosts];
    for (const pool of pools) for (const it of pool) it.active = false;
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2 + 80;
    player.vx = 0;
    player.vy = 0;
    player.lives = PLAYER.lives;
    player.invuln = 0;
    player.fireT = 0;
    player.dashT = 0;
    player.dashCd = 0;
    player.dashId = 0;
    player.angle = -Math.PI / 2;
    state.score = 0;
    state.wave = 1;
    state.combo = 0;
    state.comboT = 0;
    state.mult = 1;
    state.time = 0;
    state.shake = 0;
    state.damageFlash = 0;
    state.alive = 0;
    state.over = false;
    spawnQueue.length = 0;
    demoT = 0;
    buildWave(1);
    state.phase = 'combat';
    state.spawnT = 0.9;
    announce('WAVE 1', '敌潮来袭', 2.2);
  }

  /** Build this wave's spawn queue; on elite waves the flagship comes first, then half an escort. */
  function buildWave(w) {
    spawnQueue.length = 0;
    queueAt = 0;
    const elite = w % WAVE_MIX.eliteEvery === 0;
    const scale = elite ? WAVE_MIX.eliteAdds : 1;
    const rest = [];
    const want = [
      ['chaser', Math.round(WAVE_MIX.chaser(w) * scale)],
      ['shooter', Math.round(WAVE_MIX.shooter(w) * scale)],
      ['splitter', Math.round(WAVE_MIX.splitter(w) * scale)],
      ['charger', Math.round(WAVE_MIX.charger(w) * scale)],
    ];
    for (const [kind, n] of want) for (let i = 0; i < n; i += 1) rest.push(kind);
    // Fisher-Yates with the world's own random: the same seed gives the same battle.
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = (random() * (i + 1)) | 0;
      const t = rest[i];
      rest[i] = rest[j];
      rest[j] = t;
    }
    if (elite) spawnQueue.push('elite');
    for (const kind of rest) if (spawnQueue.length < WAVE_MIX.cap) spawnQueue.push(kind);
  }

  function edgeSpot() {
    const side = (random() * 4) | 0;
    const m = 36;
    if (side === 0) return { x: random() * FIELD.width, y: -m };
    if (side === 1) return { x: random() * FIELD.width, y: FIELD.height + m };
    if (side === 2) return { x: -m, y: random() * FIELD.height };
    return { x: FIELD.width + m, y: random() * FIELD.height };
  }

  function spawnEnemy(kind, x, y) {
    const e = freeIn(enemies);
    if (!e) return null;
    const base = ENEMIES[kind];
    const w = state.wave;
    e.active = true;
    e.kind = kind;
    e.base = base;
    const hpScale = kind === 'elite'
      ? 1 + 0.45 * (w / WAVE_MIX.eliteEvery - 1)
      : Math.min(1 + WAVES.hpScaleMax, 1 + WAVES.hpScale * (w - 1));
    const spScale = kind === 'elite' ? 1 : Math.min(1 + WAVES.speedScaleMax, 1 + WAVES.speedScale * (w - 1));
    e.maxHp = e.hp = Math.round(base.hp * hpScale);
    e.speed = base.speed * spScale;
    e.r = base.radius;
    e.score = base.score;
    const spot = x === undefined ? edgeSpot() : null;
    e.x = spot ? spot.x : x;
    e.y = spot ? spot.y : y;
    e.t = 0;
    e.state = 0;
    e.sT = base.approachLimit ?? 3;
    e.sT2 = 1.5 + random() * 2;
    e.fireT = kind === 'shooter' ? 1 + random() * 1.4 : kind === 'elite' ? 1.6 : 0;
    e.flash = 0;
    e.entered = false;
    e.strafe = random() < 0.5 ? -1 : 1;
    e.wob = random() * Math.PI * 2;
    e.locked = 0;
    e.spiral = random() * Math.PI * 2;
    e.pattern = ((w / WAVE_MIX.eliteEvery) | 0) % 3;
    e.lastDash = -1;
    e.a = Math.atan2(player.y - e.y, player.x - e.x);
    state.alive += 1;
    if (kind === 'elite') {
      ev |= EVENT_ELITE;
      announce('WARNING', '精英旗舰逼近', 2.6);
      state.shake = Math.min(24, state.shake + 9);
    }
    return e;
  }

  function fireEnemyBullet(x, y, angle, speed) {
    const b = freeIn(bullets);
    if (!b) return;
    b.active = true;
    b.hostile = true;
    b.x = x;
    b.y = y;
    b.vx = Math.cos(angle) * speed;
    b.vy = Math.sin(angle) * speed;
    b.r = ENEMY_BULLET.radius;
    b.life = ENEMY_BULLET.life;
  }

  function firePlayerBullet() {
    const p = player;
    const b = freeIn(bullets);
    if (!b) return;
    const angle = p.angle + (random() - 0.5) * PLAYER.spread;
    b.active = true;
    b.hostile = false;
    b.x = p.x + Math.cos(p.angle) * 16;
    b.y = p.y + Math.sin(p.angle) * 16;
    b.vx = Math.cos(angle) * PLAYER.bulletSpeed;
    b.vy = Math.sin(angle) * PLAYER.bulletSpeed;
    b.r = PLAYER.bulletRadius;
    b.life = 1.1;
    p.vx -= Math.cos(p.angle) * PLAYER.recoil;
    p.vy -= Math.sin(p.angle) * PLAYER.recoil;
    burst(b.x, b.y, PALETTE.player, 2, 130, 2.2, 0.16);
    ev |= EVENT_SHOOT;
  }

  // --- effects ---------------------------------------------------------------

  function burst(x, y, color, n, speed, size, life) {
    for (let i = 0; i < n; i += 1) {
      const p = freeIn(particles);
      if (!p) return;
      const a = random() * Math.PI * 2;
      const s = speed * (0.35 + random() * 0.9);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = p.life = life * (0.6 + random() * 0.7);
      p.size = size * (0.7 + random() * 0.7);
      p.drag = 3.2;
      p.color = color;
    }
  }

  function ring(x, y, color, maxR, width = 3) {
    const r = freeIn(rings);
    if (!r) return;
    r.active = true;
    r.x = x;
    r.y = y;
    r.r = 4;
    r.speed = maxR / 0.38;
    r.maxLife = r.life = 0.38;
    r.width = width;
    r.color = color;
  }

  function popText(x, y, str, color, size = 17) {
    const t = freeIn(texts);
    if (!t) return;
    t.active = true;
    t.x = x;
    t.y = y;
    t.vy = -46;
    t.maxLife = t.life = 0.85;
    t.size = size;
    t.color = color;
    t.str = str;
  }

  function spawnGhost() {
    const g = freeIn(ghosts);
    if (!g) return;
    g.active = true;
    g.x = player.x;
    g.y = player.y;
    g.a = player.angle;
    g.maxLife = g.life = 0.26;
  }

  function spawnPickup(x, y) {
    const k = freeIn(pickups);
    if (!k) return;
    const a = random() * Math.PI * 2;
    k.active = true;
    k.x = x;
    k.y = y;
    k.vx = Math.cos(a) * 70;
    k.vy = Math.sin(a) * 70;
    k.life = PICKUP.life;
    k.t = 0;
  }

  // --- scoring ---------------------------------------------------------------

  function addKill(e) {
    state.combo += 1;
    state.comboT = COMBO.window;
    const next = Math.min(COMBO.max, 1 + state.combo * COMBO.perKill);
    if (Math.floor(next) > Math.floor(state.mult)) {
      ev |= EVENT_MILESTONE;
      popText(player.x, player.y - 34, `×${next.toFixed(1)}`, PALETTE.pickup, 24);
    }
    state.mult = next;
    const pts = Math.round(e.score * state.mult);
    state.score += pts;
    popText(e.x, e.y - e.r - 6, `+${pts}`, PALETTE[e.kind]);
  }

  function killEnemy(e, scored) {
    e.active = false;
    state.alive -= 1;
    const color = PALETTE[e.kind];
    const big = e.kind === 'elite';
    burst(e.x, e.y, color, big ? 110 : 12 + Math.round(e.r), big ? 520 : 300, big ? 4.6 : 3, big ? 0.9 : 0.45);
    ring(e.x, e.y, color, big ? 210 : 30 + e.r * 2.4, big ? 6 : 3);
    state.shake = Math.min(24, state.shake + (big ? 13 : 1.4));
    if (!scored) return; // the title screen's backdrop battle keeps no score
    ev |= big ? EVENT_ELITE_DOWN : EVENT_KILL;
    addKill(e);
    if (big) {
      announce('ELITE DOWN', '精英旗舰已摧毁', 2.2);
      spawnPickup(e.x - 14, e.y);
      spawnPickup(e.x + 14, e.y);
    } else if (e.kind === 'splitter') {
      for (let i = 0; i < e.base.children; i += 1) {
        const child = spawnEnemy('mini', e.x + (i - 0.5) * 16, e.y + (random() - 0.5) * 10);
        if (child) child.entered = true;
      }
    } else if (random() < PICKUP.dropChance) {
      spawnPickup(e.x, e.y);
    }
  }

  function damagePlayer(sx, sy) {
    const p = player;
    p.lives -= 1;
    p.invuln = PLAYER.invulnTime;
    state.damageFlash = 1;
    state.shake = Math.min(24, state.shake + 12);
    state.combo = 0;
    state.mult = 1;
    state.comboT = 0;
    const a = Math.atan2(p.y - sy, p.x - sx);
    p.vx += Math.cos(a) * 380;
    p.vy += Math.sin(a) * 380;
    burst(p.x, p.y, PALETTE.danger, 42, 420, 3.4, 0.5);
    ring(p.x, p.y, PALETTE.danger, 130, 4);
    ev |= EVENT_HURT;
    if (p.lives <= 0) {
      p.lives = 0;
      state.over = true;
      burst(p.x, p.y, PALETTE.player, 130, 560, 4.4, 1.1);
      burst(p.x, p.y, PALETTE.playerCore, 50, 300, 3, 0.7);
      ring(p.x, p.y, PALETTE.player, 260, 6);
      ring(p.x, p.y, PALETTE.playerCore, 170, 3);
      state.shake = 24;
      ev |= EVENT_OVER;
    }
  }

  // --- updates ---------------------------------------------------------------

  function updatePlayer(dt, input) {
    const p = player;
    p.angle = Math.atan2(input.ay - p.y, input.ax - p.x);
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.vx = Math.cos(p.dashA) * DASH.speed;
      p.vy = Math.sin(p.dashA) * DASH.speed;
      p.ghostT -= dt;
      if (p.ghostT <= 0) {
        spawnGhost();
        p.ghostT = DASH.ghostInterval;
      }
      if (p.dashT <= 0) {
        p.vx *= 0.35;
        p.vy *= 0.35;
      }
    } else {
      const mx = input.mx;
      const my = input.my;
      p.vx += mx * PLAYER.accel * dt;
      p.vy += my * PLAYER.accel * dt;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > PLAYER.speed) {
        const k = PLAYER.speed / sp;
        p.vx *= k;
        p.vy *= k;
      }
      if (mx === 0 && my === 0) {
        const damp = Math.exp(-PLAYER.friction * dt);
        p.vx *= damp;
        p.vy *= damp;
      }
    }
    p.x = clamp(p.x + p.vx * dt, FIELD.margin, FIELD.width - FIELD.margin);
    p.y = clamp(p.y + p.vy * dt, FIELD.margin, FIELD.height - FIELD.margin);
    if (p.invuln > 0) p.invuln -= dt;
    if (p.dashCd > 0) p.dashCd -= dt;
    p.fireT -= dt;
    if (input.firing) {
      while (p.fireT <= 0) {
        firePlayerBullet();
        p.fireT += PLAYER.fireInterval;
      }
    } else if (p.fireT < 0) p.fireT = 0;
    if (input.dash && p.dashCd <= 0 && p.dashT <= 0) {
      const mv = Math.hypot(input.mx, input.my);
      p.dashA = mv > 0.1 ? Math.atan2(input.my, input.mx) : p.angle;
      p.dashT = DASH.time;
      p.dashCd = DASH.cooldown + DASH.time;
      p.dashId += 1;
      p.invuln = Math.max(p.invuln, DASH.time + DASH.buffer);
      p.ghostT = 0;
      burst(p.x, p.y, PALETTE.player, 14, 260, 2.8, 0.3);
      ev |= EVENT_DASH;
    }
  }

  /** Shooter fire intervals shrink as the waves climb, to at most half. */
  function fireScale() {
    return Math.max(1 - WAVES.fireScaleMax, 1 - WAVES.fireScale * (state.wave - 1));
  }

  function updateEnemies(dt) {
    const p = player;
    for (const e of enemies) {
      if (!e.active) continue;
      e.t += dt;
      if (e.flash > 0) e.flash -= dt;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const base = e.base;
      switch (e.kind) {
        case 'chaser':
        case 'mini': {
          e.a = lerpAngle(e.a, Math.atan2(dy, dx), base.steer * dt);
          e.wob += dt * 3.1;
          const dir = e.a + (e.kind === 'mini' ? Math.sin(e.wob) * 0.6 : 0);
          e.x += Math.cos(dir) * e.speed * dt;
          e.y += Math.sin(dir) * e.speed * dt;
          break;
        }
        case 'shooter': {
          let mx;
          let my;
          if (dist > base.far) {
            mx = ux;
            my = uy;
          } else if (dist < base.near) {
            mx = -ux;
            my = -uy;
          } else {
            e.sT2 -= dt;
            if (e.sT2 <= 0) {
              e.strafe *= -1;
              e.sT2 = 1.6 + random() * 2.2;
            }
            mx = -uy * e.strafe;
            my = ux * e.strafe;
          }
          e.x += mx * e.speed * dt;
          e.y += my * e.speed * dt;
          e.a = Math.atan2(dy, dx);
          e.fireT -= dt;
          if (e.fireT <= 0 && e.entered) {
            fireEnemyBullet(e.x + ux * 14, e.y + uy * 14, e.a + (random() - 0.5) * base.aimJitter, base.bulletSpeed);
            e.fireT = base.fireInterval * fireScale();
            ev |= EVENT_ESHOOT;
          }
          break;
        }
        case 'charger': {
          e.sT -= dt;
          if (e.state === 0) {
            e.x += ux * e.speed * dt;
            e.y += uy * e.speed * dt;
            e.a = Math.atan2(dy, dx);
            if (dist < base.trigger || e.sT <= 0) {
              e.state = 1;
              e.sT = base.telegraph;
              e.locked = e.a;
            }
          } else if (e.state === 1) {
            // telegraphing: track the player until the last moment, then lock the aim
            if (e.sT > 0.18) e.locked = Math.atan2(dy, dx);
            e.a = e.locked;
            if (e.sT <= 0) {
              e.state = 2;
              e.sT = base.dashTime;
            }
          } else if (e.state === 2) {
            e.x += Math.cos(e.locked) * base.dashSpeed * dt;
            e.y += Math.sin(e.locked) * base.dashSpeed * dt;
            if (random() < 0.5) burst(e.x, e.y, PALETTE.charger, 1, 60, 2.4, 0.24);
            if (e.sT <= 0) {
              e.state = 3;
              e.sT = base.recover;
            }
          } else {
            e.x += ux * e.speed * 0.3 * dt;
            e.y += uy * e.speed * 0.3 * dt;
            e.a = Math.atan2(dy, dx);
            if (e.sT <= 0) {
              e.state = 0;
              e.sT = 1.4 + random() * 1.6;
            }
          }
          break;
        }
        case 'splitter': {
          e.wob += dt * 1.8;
          const dir = Math.atan2(dy, dx) + Math.sin(e.wob) * 0.5;
          e.a = dir;
          e.x += Math.cos(dir) * e.speed * dt;
          e.y += Math.sin(dir) * e.speed * dt;
          break;
        }
        case 'elite': {
          let mx = 0;
          let my = 0;
          if (dist > base.keep + 70) {
            mx = ux;
            my = uy;
          } else if (dist < base.keep - 70) {
            mx = -ux;
            my = -uy;
          }
          e.x += mx * e.speed * dt;
          e.y += my * e.speed * dt;
          e.a += dt * 0.7;
          if (!e.entered) break; // attacks wait until the flagship is fully in the arena
          if (e.pattern === 0) {
            e.fireT -= dt;
            if (e.fireT <= 0) {
              for (let i = 0; i < base.ringCount; i += 1) fireEnemyBullet(e.x, e.y, e.t + (i / base.ringCount) * Math.PI * 2, base.ringSpeed);
              fireEnemyBullet(e.x, e.y, Math.atan2(dy, dx) - 0.22, base.volleySpeed);
              fireEnemyBullet(e.x, e.y, Math.atan2(dy, dx), base.volleySpeed);
              fireEnemyBullet(e.x, e.y, Math.atan2(dy, dx) + 0.22, base.volleySpeed);
              e.fireT = base.ringEvery;
              ev |= EVENT_ESHOOT;
            }
          } else if (e.pattern === 1) {
            e.fireT -= dt;
            if (e.fireT <= 0) {
              for (let i = -1; i <= 1; i += 1) fireEnemyBullet(e.x, e.y, Math.atan2(dy, dx) + i * 0.2, base.volleySpeed);
              e.fireT = base.volleyEvery;
              ev |= EVENT_ESHOOT;
            }
            e.sT -= dt;
            if (e.sT <= 0) {
              if (state.alive < 30) {
                const a = random() * Math.PI * 2;
                spawnEnemy('chaser', e.x + Math.cos(a) * 50, e.y + Math.sin(a) * 50);
                spawnEnemy('chaser', e.x - Math.cos(a) * 50, e.y - Math.sin(a) * 50);
              }
              e.sT = base.broodEvery;
            }
          } else {
            e.spiral += dt * 2.3;
            e.fireT -= dt;
            if (e.fireT <= 0) {
              fireEnemyBullet(e.x, e.y, e.spiral, base.spiralSpeed);
              fireEnemyBullet(e.x, e.y, e.spiral + Math.PI, base.spiralSpeed);
              e.fireT = base.spiralRate;
            }
          }
          break;
        }
      }
      // Drift in from the edge, then stay in the arena.
      const m = 26;
      if (!e.entered) {
        if (e.x > m && e.x < FIELD.width - m && e.y > m && e.y < FIELD.height - m) e.entered = true;
      } else {
        e.x = clamp(e.x, m, FIELD.width - m);
        e.y = clamp(e.y, m, FIELD.height - m);
      }
    }
  }

  function updateBullets(dt, demo) {
    const p = player;
    for (const b of bullets) {
      if (!b.active) continue;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0 || b.x < -40 || b.x > FIELD.width + 40 || b.y < -40 || b.y > FIELD.height + 40) {
        b.active = false;
        continue;
      }
      if (!b.hostile || demo) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const rr = b.r + p.radius;
      if (dx * dx + dy * dy < rr * rr) {
        if (p.dashT > 0) {
          // dashing through a bullet cuts it down
          b.active = false;
          burst(b.x, b.y, PALETTE.bullet, 5, 220, 3, 0.3);
        } else if (p.invuln <= 0) {
          b.active = false;
          damagePlayer(b.x, b.y);
        }
      }
    }
  }

  function collide(demo) {
    const p = player;
    // player bullets vs enemies
    for (const b of bullets) {
      if (!b.active || b.hostile) continue;
      for (const e of enemies) {
        if (!e.active) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const rr = b.r + e.r;
        if (dx * dx + dy * dy < rr * rr) {
          b.active = false;
          e.hp -= PLAYER.bulletDamage;
          e.flash = 0.12;
          const vl = Math.hypot(b.vx, b.vy) || 1;
          e.x += (b.vx / vl) * 3;
          e.y += (b.vy / vl) * 3;
          burst(b.x, b.y, PALETTE.bullet, 3, 190, 2.4, 0.22);
          if (e.hp <= 0) killEnemy(e, !demo);
          break;
        }
      }
    }
    if (demo) return; // the backdrop battle never touches
    // enemies vs player
    for (const e of enemies) {
      if (!e.active) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const rr = e.r + p.radius + 1;
      if (dx * dx + dy * dy >= rr * rr) continue;
      if (p.dashT > 0) {
        // a dash cuts through the small kinds, once each per dash
        if ((e.kind === 'chaser' || e.kind === 'mini' || e.kind === 'splitter') && e.lastDash !== p.dashId) {
          e.lastDash = p.dashId;
          e.hp -= DASH.hitDamage;
          e.flash = 0.12;
          const d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * 34;
          e.y += (dy / d) * 34;
          burst(e.x, e.y, PALETTE.player, 8, 260, 3, 0.3);
          if (e.hp <= 0) killEnemy(e, true);
        }
      } else if (p.invuln <= 0) {
        damagePlayer(e.x, e.y);
        const d = Math.hypot(dx, dy) || 1;
        e.x += (dx / d) * 70;
        e.y += (dy / d) * 70;
      }
    }
  }

  function updatePickups(dt) {
    const p = player;
    for (const k of pickups) {
      if (!k.active) continue;
      k.t += dt;
      k.life -= dt;
      if (k.life <= 0) {
        k.active = false;
        continue;
      }
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < PICKUP.magnetRange) {
        k.vx += (dx / d) * PICKUP.magnetPull * dt;
        k.vy += (dy / d) * PICKUP.magnetPull * dt;
        const s = Math.hypot(k.vx, k.vy);
        if (s > PICKUP.magnetSpeed) {
          k.vx *= PICKUP.magnetSpeed / s;
          k.vy *= PICKUP.magnetSpeed / s;
        }
      } else {
        const damp = Math.exp(-2.2 * dt);
        k.vx *= damp;
        k.vy *= damp;
      }
      k.x = clamp(k.x + k.vx * dt, 12, FIELD.width - 12);
      k.y = clamp(k.y + k.vy * dt, 12, FIELD.height - 12);
      if (d < p.radius + PICKUP.radius + 4) {
        k.active = false;
        if (p.lives < PLAYER.lives) {
          p.lives += 1;
          popText(p.x, p.y - 26, '+1 HULL', PALETTE.pickup, 20);
        } else {
          state.score += PICKUP.bonus;
          popText(p.x, p.y - 26, `+${PICKUP.bonus}`, PALETTE.pickup, 20);
        }
        burst(k.x, k.y, PALETTE.pickup, 18, 260, 2.8, 0.4);
        ev |= EVENT_PICKUP;
      }
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function updateRings(dt) {
    for (const r of rings) {
      if (!r.active) continue;
      r.life -= dt;
      r.r += r.speed * dt;
      if (r.life <= 0) r.active = false;
    }
  }

  function updateTexts(dt) {
    for (const t of texts) {
      if (!t.active) continue;
      t.life -= dt;
      t.y += t.vy * dt;
      if (t.life <= 0) t.active = false;
    }
  }

  function updateGhosts(dt) {
    for (const g of ghosts) {
      if (!g.active) continue;
      g.life -= dt;
      if (g.life <= 0) g.active = false;
    }
  }

  // --- wave director ---------------------------------------------------------

  function updateWave(dt) {
    if (state.phase === 'combat') {
      if (queueAt < spawnQueue.length) {
        state.spawnT -= dt;
        if (state.spawnT <= 0) {
          spawnEnemy(spawnQueue[queueAt]);
          queueAt += 1;
          state.spawnT += Math.max(WAVES.spawnIntervalMin, WAVES.spawnInterval - WAVES.spawnIntervalPerWave * (state.wave - 1));
        }
      } else if (state.alive <= 0) {
        state.phase = 'inter';
        state.interT = WAVES.intermission;
        const bonus = 100 * state.wave;
        state.score += bonus;
        announce('WAVE CLEAR', `奖励 +${bonus} · 下一波马上来`, 2.2);
        ev |= EVENT_WAVECLEAR;
      }
    } else {
      state.interT -= dt;
      if (state.interT <= 0) {
        state.wave += 1;
        buildWave(state.wave);
        state.phase = 'combat';
        state.spawnT = 0.7;
        const labels = ['敌潮来袭', '敌潮增强', '全面进攻', '火力压制', '决死坚守'];
        announce(`WAVE ${state.wave}`, labels[(state.wave - 1) % labels.length], 2.2);
        ev |= EVENT_WAVE;
      }
    }
  }

  // --- title screen backdrop -------------------------------------------------

  const demoArgs = { mx: 0, my: 0, ax: 0, ay: 0, firing: false, dash: false };

  function demoInput() {
    const p = player;
    const t = state.time;
    const tx = FIELD.width / 2 + Math.cos(t * 0.5) * 240;
    const ty = FIELD.height / 2 + Math.sin(t * 0.9) * 140;
    demoArgs.mx = clamp((tx - p.x) * 0.03, -1, 1);
    demoArgs.my = clamp((ty - p.y) * 0.03, -1, 1);
    let target = null;
    let bd = Infinity;
    for (const e of enemies) {
      if (!e.active) continue;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < bd) {
        bd = d;
        target = e;
      }
    }
    if (target) {
      demoArgs.ax = target.x;
      demoArgs.ay = target.y;
      demoArgs.firing = true;
    } else {
      demoArgs.ax = FIELD.width / 2;
      demoArgs.ay = FIELD.height / 2;
      demoArgs.firing = false;
    }
    return demoArgs;
  }

  function updateDemoSpawn(dt) {
    demoT -= dt;
    if (demoT > 0) return;
    let count = 0;
    for (const e of enemies) if (e.active && e.kind === 'chaser') count += 1;
    if (count < 5) spawnEnemy('chaser');
    demoT = 0.8;
  }

  // --- one fixed step ---------------------------------------------------------

  function step(dt, input, demo) {
    ev = 0;
    state.time += dt;
    state.shake = Math.max(0, state.shake - state.shake * 5.5 * dt - 2 * dt);
    state.damageFlash = Math.max(0, state.damageFlash - dt * 1.6);
    if (state.ann.t > 0) state.ann.t -= dt;

    if (state.over) {
      // the ship is gone; let the last explosion play out behind the game-over panel
      updateParticles(dt);
      updateRings(dt);
      updateTexts(dt);
      updateGhosts(dt);
      return ev;
    }

    updatePlayer(dt, demo ? demoInput() : input);
    if (demo) updateDemoSpawn(dt);
    else updateWave(dt);
    updateEnemies(dt);
    updateBullets(dt, demo);
    if (!demo) updatePickups(dt);
    collide(demo);
    updateParticles(dt);
    updateRings(dt);
    updateTexts(dt);
    updateGhosts(dt);
    return ev;
  }

  reset();
  return { state, reset, step };
}
