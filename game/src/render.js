// Drawing only: the world's state, the current screen, a timestamp and a little metadata in,
// pixels out. The 1280x720 playfield is scaled to fit the window and centred; the margin is filled
// with the backdrop colour. The neon comes from layered strokes and additive blobs, not from
// shadowBlur: every shape is drawn twice, a wide faint pass and a thin bright one. Text that holds
// a number is rebuilt only when the number changes, so a frame allocates nothing.
import { COMBO, DASH, FIELD, FONT, PALETTE, PICKUP, PLAYER } from './config.js';
import { createRandom } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

function cachedLabel(prefix, fmt = String) {
  let value = -1;
  let label = '';
  return function next_(next) {
    if (next !== value) {
      value = next;
      label = prefix + fmt(next);
    }
    return label;
  };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0, ratio: 1 };

  // Three parallax layers of stars, generated once from a fixed seed so the sky is the same
  // every visit and every screenshot.
  const stars = [];
  {
    const srng = createRandom(0xc0ffee);
    const layers = [
      { n: 70, speed: 7, size: 1.0, alpha: 0.35 },
      { n: 48, speed: 15, size: 1.5, alpha: 0.5 },
      { n: 30, speed: 26, size: 2.1, alpha: 0.7 },
    ];
    for (const layer of layers) {
      for (let i = 0; i < layer.n; i += 1) {
        stars.push({
          x: srng() * FIELD.width,
          y: srng() * FIELD.height,
          size: layer.size * (0.7 + srng() * 0.6),
          speed: layer.speed * (0.8 + srng() * 0.4),
          tw: srng() * Math.PI * 2,
          alpha: layer.alpha,
        });
      }
    }
  }

  const vignette = ctx.createRadialGradient(FIELD.width / 2, FIELD.height / 2, 280, FIELD.width / 2, FIELD.height / 2, 780);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(2, 4, 12, 0.6)');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.ratio = ratio;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  /** Window coordinates to field coordinates (clamped into the arena). */
  function toField(clientX, clientY) {
    return {
      x: Math.max(8, Math.min(FIELD.width - 8, (clientX * view.ratio - view.x) / view.scale)),
      y: Math.max(8, Math.min(FIELD.height - 8, (clientY * view.ratio - view.y) / view.scale)),
    };
  }

  // --- primitives -------------------------------------------------------------

  const fonts = new Map();
  function setFont(size, weight) {
    const key = `${weight}|${size}`;
    let f = fonts.get(key);
    if (!f) {
      f = `${weight ? `${weight} ` : ''}${size}px ${FONT}`;
      fonts.set(key, f);
    }
    ctx.font = f;
  }

  function text(value, x, y, size, color, align = 'left', weight = '', baseline = 'alphabetic') {
    setFont(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(value, x, y);
  }

  /** Big heading with chromatic neon edges. */
  function neonText(value, x, y, size, core = PALETTE.playerCore) {
    text(value, x - 2.5, y, size, PALETTE.chaser, 'center', 'bold');
    text(value, x + 2.5, y, size, PALETTE.player, 'center', 'bold');
    text(value, x, y, size, core, 'center', 'bold');
  }

  /** Draw `path` twice: wide and faint, then thin and bright — the cheap neon glow. */
  function glowStroke(path, color, width, alpha = 0.16) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    path();
    ctx.lineWidth = width * 3.2;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.globalAlpha = 1;
    ctx.stroke();
  }

  function glowFill(path, color, width) {
    path();
    ctx.fillStyle = color;
    ctx.fill();
    if (width) glowStroke(path, color, width);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function polygon(n, r, rot = 0) {
    ctx.beginPath();
    for (let i = 0; i < n; i += 1) {
      const a = rot + (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** The player's hull, pointing along +x in local space; `s` scales it. */
  function shipPath(s = 1) {
    ctx.beginPath();
    ctx.moveTo(19 * s, 0);
    ctx.lineTo(-13 * s, 11 * s);
    ctx.lineTo(-7 * s, 0);
    ctx.lineTo(-13 * s, -11 * s);
    ctx.closePath();
  }

  function additive(on) {
    ctx.globalCompositeOperation = on ? 'lighter' : 'source-over';
  }

  // --- world layers -------------------------------------------------------------

  function drawBackdrop(state, now) {
    ctx.fillStyle = PALETTE.field;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    ctx.fillStyle = PALETTE.star;
    const t = state.time;
    for (const s of stars) {
      const y = (((s.y + t * s.speed) % FIELD.height) + FIELD.height) % FIELD.height;
      const tw = 0.55 + 0.45 * Math.sin(now * 0.002 + s.tw);
      ctx.globalAlpha = s.alpha * tw;
      ctx.fillRect(s.x, y, s.size, s.size);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 80; x < FIELD.width; x += 80) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, FIELD.height);
    }
    for (let y = 80; y < FIELD.height; y += 80) {
      ctx.moveTo(0, y);
      ctx.lineTo(FIELD.width, y);
    }
    ctx.stroke();
    glowStroke(() => {
      ctx.beginPath();
      ctx.rect(6, 6, FIELD.width - 12, FIELD.height - 12);
    }, PALETTE.border, 2, 0.35);
  }

  function drawPlayer(state, now) {
    const p = state.player;
    // blinking after a hit: hidden on every other tenth of a second (the dash has its own blink)
    if (p.invuln > 0 && p.dashT <= 0 && Math.floor(p.invuln * 10) % 2 === 1) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    const dashing = p.dashT > 0;
    if (dashing) ctx.scale(1.25, 0.85);
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 30) {
      const flick = 0.7 + 0.3 * Math.sin(now * 0.05);
      additive(true);
      ctx.globalAlpha = 0.6 * flick * Math.min(1, speed / PLAYER.speed);
      ctx.fillStyle = PALETTE.player;
      ctx.beginPath();
      ctx.moveTo(-12, 4.5);
      ctx.lineTo(-14 - speed * 0.045 * flick, 0);
      ctx.lineTo(-12, -4.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      additive(false);
    }
    glowFill(shipPath, PALETTE.player, 2.2);
    ctx.fillStyle = PALETTE.playerCore;
    ctx.beginPath();
    ctx.arc(5, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemies(state, now) {
    for (const e of state.enemies) {
      if (!e.active) continue;
      const color = PALETTE[e.kind];
      ctx.save();
      ctx.translate(e.x, e.y);
      switch (e.kind) {
        case 'chaser':
        case 'mini': {
          const s = e.kind === 'mini' ? 0.55 : 1;
          ctx.rotate(e.a);
          glowFill(() => {
            ctx.beginPath();
            ctx.moveTo(17 * s, 0);
            ctx.lineTo(-10 * s, 9 * s);
            ctx.lineTo(-5 * s, 0);
            ctx.lineTo(-10 * s, -9 * s);
            ctx.closePath();
          }, color, 2);
          break;
        }
        case 'shooter': {
          ctx.rotate(e.a);
          const charge = Math.max(0, 1 - e.fireT / 0.5);
          if (charge > 0) {
            additive(true);
            ctx.globalAlpha = charge * 0.8;
            ctx.strokeStyle = PALETTE.playerCore;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(10, 0);
            ctx.lineTo(20 + charge * 8, 0);
            ctx.stroke();
            ctx.globalAlpha = 1;
            additive(false);
          }
          glowFill(() => polygon(4, 13, Math.PI / 4), color, 2);
          ctx.fillStyle = PALETTE.playerCore;
          ctx.beginPath();
          ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'charger': {
          ctx.rotate(e.a);
          if (e.state === 1) {
            const pulse = 0.5 + 0.5 * Math.sin(now * 0.025);
            additive(true);
            ctx.globalAlpha = 0.28 + pulse * 0.4;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.setLineDash([10, 8]);
            ctx.beginPath();
            ctx.moveTo(16, 0);
            ctx.lineTo(300, 0);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            additive(false);
          }
          const flash = e.state === 1 && Math.floor(now / 90) % 2 === 0;
          glowFill(() => {
            ctx.beginPath();
            ctx.moveTo(18, 0);
            ctx.lineTo(-8, 12);
            ctx.lineTo(-3, 0);
            ctx.lineTo(-8, -12);
            ctx.closePath();
          }, flash ? PALETTE.playerCore : color, 2);
          break;
        }
        case 'splitter': {
          ctx.rotate(e.t * 0.8);
          glowFill(() => polygon(6, e.r), color, 2);
          ctx.strokeStyle = PALETTE.playerCore;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1.4;
          polygon(6, e.r * 0.5, -e.t * 1.6);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        default: { // elite flagship
          additive(true);
          ctx.globalAlpha = 0.08 + 0.04 * Math.sin(now * 0.004);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(0, 0, e.r * 2.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          additive(false);
          ctx.rotate(e.a);
          glowStroke(() => {
            ctx.beginPath();
            for (let i = 0; i < 3; i += 1) {
              const a0 = (i / 3) * Math.PI * 2;
              ctx.moveTo(Math.cos(a0) * (e.r + 10), Math.sin(a0) * (e.r + 10));
              ctx.arc(0, 0, e.r + 10, a0, a0 + Math.PI * 0.55);
            }
          }, color, 3);
          glowFill(() => polygon(6, e.r), color, 2.6);
          ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now * 0.006);
          ctx.fillStyle = PALETTE.playerCore;
          ctx.beginPath();
          ctx.arc(0, 0, e.r * 0.32, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          // health bar, unrotated
          ctx.rotate(-e.a);
          const w = 96;
          const frac = Math.max(0, e.hp / e.maxHp);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.fillRect(-w / 2, -e.r - 24, w, 6);
          ctx.fillStyle = frac > 0.4 ? color : PALETTE.danger;
          ctx.fillRect(-w / 2, -e.r - 24, w * frac, 6);
          break;
        }
      }
      // white flash when hit
      if (e.flash > 0) {
        ctx.globalAlpha = Math.min(1, e.flash * 9) * 0.85;
        ctx.fillStyle = PALETTE.playerCore;
        ctx.beginPath();
        ctx.arc(0, 0, e.r * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawBullets(state) {
    additive(true);
    for (const b of state.bullets) {
      if (!b.active) continue;
      ctx.fillStyle = b.hostile ? PALETTE.enemyBullet : PALETTE.bullet;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PALETTE.playerCore;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    additive(false);
  }

  function drawParticles(state) {
    additive(true);
    for (const p of state.particles) {
      if (!p.active) continue;
      const a = p.life / p.maxLife;
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      const s = p.size * (0.35 + 0.65 * a);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    additive(false);
  }

  function drawRings(state) {
    additive(true);
    for (const r of state.rings) {
      if (!r.active) continue;
      const a = r.life / r.maxLife;
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * a + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    additive(false);
  }

  function drawGhosts(state) {
    for (const g of state.ghosts) {
      if (!g.active) continue;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.a);
      ctx.globalAlpha = (g.life / g.maxLife) * 0.35;
      ctx.strokeStyle = PALETTE.player;
      ctx.lineWidth = 1.6;
      shipPath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPickups(state, now) {
    for (const k of state.pickups) {
      if (!k.active) continue;
      // blink just before expiring
      if (k.life < 2 && Math.floor(k.life * 6) % 2 === 0) continue;
      ctx.save();
      ctx.translate(k.x, k.y);
      const pulse = 0.8 + 0.2 * Math.sin(now * 0.008 + k.t * 3);
      additive(true);
      ctx.globalAlpha = 0.16 * pulse;
      ctx.fillStyle = PALETTE.pickup;
      ctx.beginPath();
      ctx.arc(0, 0, PICKUP.radius * 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      additive(false);
      ctx.rotate(now * 0.002);
      glowFill(() => polygon(4, PICKUP.radius, Math.PI / 4), PALETTE.pickup, 2);
      ctx.restore();
    }
  }

  function drawTexts(state) {
    setFont(17, 'bold');
    ctx.textBaseline = 'middle';
    for (const t of state.texts) {
      if (!t.active) continue;
      ctx.globalAlpha = Math.min(1, t.life / (t.maxLife * 0.5));
      setFont(t.size, 'bold');
      ctx.fillStyle = t.color;
      ctx.textAlign = 'center';
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  // --- HUD ---------------------------------------------------------------------

  const scoreLabel = cachedLabel('');
  const waveLabel = cachedLabel('WAVE ');
  const multLabel = cachedLabel('×', (v) => (v / 10).toFixed(1));
  const bestLabel = cachedLabel('BEST ');
  const finalScoreLabel = cachedLabel('');

  function drawHud(state, now) {
    const p = state.player;
    text('SCORE', 26, 22, 15, PALETTE.muted, 'left', 'bold', 'top');
    text(scoreLabel(state.score), 26, 40, 32, PALETTE.text, 'left', 'bold', 'top');
    if (state.mult > 1) {
      const col = state.mult >= 3 ? PALETTE.chaser : PALETTE.player;
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = PALETTE.text;
      ctx.fillRect(26, 84, 190, 7);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.fillRect(26, 84, 190 * Math.max(0, state.comboT / COMBO.window), 7);
      text(multLabel(Math.round(state.mult * 10)), 26, 98, 22, col, 'left', 'bold', 'top');
      text('COMBO', 100, 104, 13, PALETTE.muted, 'left', 'bold', 'top');
    }
    text(waveLabel(state.wave), FIELD.width / 2, 22, 30, PALETTE.text, 'center', 'bold', 'top');
    if (state.phase === 'inter') {
      text(`下一波 ${Math.ceil(state.interT)}`, FIELD.width / 2, 60, 15, PALETTE.muted, 'center', 'bold', 'top');
    }
    // hull, as small ship silhouettes
    const iconW = 18;
    const iconGap = 8;
    const startX = FIELD.width - 26 - PLAYER.lives * iconW - (PLAYER.lives - 1) * iconGap;
    text('HULL', startX - 10, 22, 15, PALETTE.muted, 'right', 'bold', 'top');
    for (let i = 0; i < PLAYER.lives; i += 1) {
      ctx.save();
      ctx.translate(startX + i * (iconW + iconGap) + iconW / 2, 24 + iconW / 2);
      ctx.rotate(-Math.PI / 2);
      if (i < p.lives) glowFill(() => shipPath(0.6), PALETTE.player, 1.6);
      else {
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = PALETTE.muted;
        ctx.lineWidth = 1.4;
        shipPath(0.6);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    // dash meter
    const dw = 86;
    const dx0 = FIELD.width - 26 - dw;
    text('DASH', dx0 - 10, 56, 13, PALETTE.muted, 'right', 'bold', 'top');
    const frac = Math.max(0, Math.min(1, 1 - p.dashCd / (DASH.cooldown + DASH.time)));
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = PALETTE.text;
    ctx.fillRect(dx0, 58, dw, 6);
    ctx.globalAlpha = 1;
    if (frac >= 1) {
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now * 0.01);
      ctx.fillStyle = PALETTE.player;
    } else {
      ctx.fillStyle = PALETTE.muted;
    }
    ctx.fillRect(dx0, 58, dw * frac, 6);
    ctx.globalAlpha = 1;
  }

  function drawAnnounce(state) {
    const a = state.ann;
    if (a.t <= 0) return;
    const elapsed = a.dur - a.t;
    ctx.globalAlpha = Math.min(1, elapsed / 0.18, a.t / 0.45);
    neonText(a.text, FIELD.width / 2, 244, 52);
    if (a.sub) text(a.sub, FIELD.width / 2, 284, 22, PALETTE.muted, 'center', 'bold');
    ctx.globalAlpha = 1;
  }

  function drawReticle(aim, now) {
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = PALETTE.player;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(aim.x, aim.y, 9 + Math.sin(now * 0.008) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = PALETTE.playerCore;
    ctx.fillRect(aim.x - 1, aim.y - 1, 2, 2);
    ctx.globalAlpha = 1;
  }

  // --- overlays ----------------------------------------------------------------

  function drawVignette() {
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
  }

  function drawDamageFlash(state) {
    const f = state.damageFlash;
    ctx.globalAlpha = f * 0.16;
    ctx.fillStyle = PALETTE.danger;
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    ctx.globalAlpha = f * 0.55;
    ctx.strokeStyle = PALETTE.danger;
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, FIELD.width - 16, FIELD.height - 16);
    ctx.globalAlpha = 1;
  }

  function panelBase(w, h, accent = PALETTE.player) {
    const x = (FIELD.width - w) / 2;
    const y = (FIELD.height - h) / 2;
    ctx.fillStyle = PALETTE.panel;
    ctx.fillRect(x, y, w, h);
    glowStroke(() => {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    }, accent, 1.6, 0.3);
    // corner ticks
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    const t = 16;
    ctx.beginPath();
    ctx.moveTo(x, y + t);
    ctx.lineTo(x, y);
    ctx.lineTo(x + t, y);
    ctx.moveTo(x + w - t, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + t);
    ctx.moveTo(x + w, y + h - t);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - t, y + h);
    ctx.moveTo(x + t, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - t);
    ctx.stroke();
    return { x, y };
  }

  function button(label, sub, cx, cy, w, h, now, accent = PALETTE.player) {
    const pulse = 0.55 + 0.35 * Math.sin(now * 0.006);
    const path = () => roundRect(cx - w / 2, cy - h / 2, w, h, 10);
    path();
    ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
    ctx.fill();
    glowStroke(path, accent, 1.8, 0.25 + pulse * 0.5);
    text(label, cx, cy - (sub ? 8 : 0), 22, PALETTE.text, 'center', 'bold', 'middle');
    if (sub) text(sub, cx, cy + 14, 13, PALETTE.muted, 'center', 'bold', 'middle');
  }

  const CONTROLS = [
    ['WASD / 方向键', '移动'],
    ['鼠标', '瞄准 · 按住左键连续射击'],
    ['SPACE', '冲刺 — 短冷却，冲刺中无敌'],
    ['P / ESC', '暂停'],
    ['M', '静音'],
  ];

  function drawTitle(state, now, best) {
    const { x, y } = panelBase(680, 500);
    const cx = FIELD.width / 2;
    neonText('NEON BASTION', cx, y + 96, 58);
    text('霓 虹 堡 垒', cx, y + 126, 20, PALETTE.muted, 'center', 'bold');
    text('ARENA SURVIVAL · 霓虹竞技场生存战', cx, y + 154, 14, PALETTE.muted, 'center', 'bold');
    let rowY = y + 202;
    for (const [keys, desc] of CONTROLS) {
      roundRect(x + 78, rowY - 13, 150, 26, 6);
      ctx.strokeStyle = PALETTE.muted;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
      text(keys, x + 153, rowY, 14, PALETTE.text, 'center', 'bold', 'middle');
      text(desc, x + 246, rowY, 16, PALETTE.muted, 'left', 'bold', 'middle');
      rowY += 38;
    }
    text(bestLabel(best), cx, y + 398, 18, PALETTE.pickup, 'center', 'bold');
    button('开始游戏 · START', '点击或按 回车 / 空格', cx, y + 448, 300, 52, now);
  }

  function drawOver(state, now, meta) {
    const { y } = panelBase(640, 430, PALETTE.chaser);
    const cx = FIELD.width / 2;
    text('BASTION DOWN', cx, y + 54, 15, PALETTE.muted, 'center', 'bold');
    neonText('堡垒陷落', cx, y + 112, 52, PALETTE.chaser);
    text(finalScoreLabel(state.score), cx, y + 178, 40, PALETTE.text, 'center', 'bold');
    text(`到达波次  WAVE ${state.wave}`, cx, y + 226, 19, PALETTE.muted, 'center', 'bold');
    text(`历史最高  BEST ${meta.best}`, cx, y + 258, 19, PALETTE.pickup, 'center', 'bold');
    if (meta.newBest) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now * 0.008);
      text('★ 新纪录 NEW RECORD ★', cx, y + 294, 20, PALETTE.pickup, 'center', 'bold');
      ctx.globalAlpha = 1;
    }
    button('再战一次 · RESTART', '按 R 或点击', cx, y + 356, 300, 52, now, PALETTE.chaser);
  }

  function drawPaused(state) {
    const { y } = panelBase(520, 320);
    const cx = FIELD.width / 2;
    neonText('PAUSED', cx, y + 96, 44);
    text('游戏已暂停', cx, y + 130, 18, PALETTE.muted, 'center', 'bold');
    const rows = [
      ['P / ESC', '继续战斗'],
      ['R', '重新开始'],
      ['M', '静音开关'],
    ];
    let ry = y + 186;
    for (const [k, d] of rows) {
      text(k, cx - 40, ry, 15, PALETTE.text, 'right', 'bold', 'middle');
      text(d, cx - 16, ry, 15, PALETTE.muted, 'left', 'bold', 'middle');
      ry += 34;
    }
  }

  // --- one frame ----------------------------------------------------------------

  /** Paint one frame. `meta` is { best, newBest, aim: {x, y} }. */
  function draw(state, screen, now, meta) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = view.scale;
    // screen shake, smooth in the transform so it stays silky at any refresh rate
    const sh = state.shake;
    const ox = sh > 0.05 ? Math.sin(now * 0.041) * sh : 0;
    const oy = sh > 0.05 ? Math.cos(now * 0.037) * sh * 0.8 : 0;
    ctx.setTransform(s, 0, 0, s, view.x + ox * s, view.y + oy * s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, FIELD.width, FIELD.height);
    ctx.clip();
    drawBackdrop(state, now);
    drawPickups(state, now);
    drawGhosts(state);
    drawEnemies(state, now);
    if (!state.over) drawPlayer(state, now);
    drawBullets(state);
    drawParticles(state);
    drawRings(state);
    drawTexts(state);
    ctx.restore();
    // overlays sit still while the world shakes
    ctx.setTransform(s, 0, 0, s, view.x, view.y);
    drawVignette();
    if (state.damageFlash > 0) drawDamageFlash(state);
    if (screen === SCREEN_PLAY) {
      drawHud(state, now);
      drawAnnounce(state);
      drawReticle(meta.aim, now);
    } else if (screen === SCREEN_TITLE) {
      drawTitle(state, now, meta.best);
    } else if (screen === SCREEN_PAUSED) {
      drawHud(state, now);
      drawPaused(state);
    } else if (screen === SCREEN_OVER) {
      drawHud(state, now);
      drawOver(state, now, meta);
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw, toField };
}
