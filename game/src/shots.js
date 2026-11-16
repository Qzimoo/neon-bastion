// The screenshot scenes behind ?shot=start|play|end. Each one plays the real rules forward from a
// fresh world for a fixed number of steps, steered by a simple autopilot: it aims at the nearest
// enemy, samples a fan of move directions a short way ahead and keeps the one with the best
// worst-case clearance from enemies and bullets. The play scene looks well ahead and holds out;
// the end scene looks barely ahead, walks into trouble like a hurried player, and dies — so the
// same seed always gives the same frame.
import { FIELD, PLAYER, STEP } from './config.js';
import { EVENT_OVER } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const ARGS = { mx: 0, my: 0, ax: 0, ay: 0, firing: false, dash: false };
const DIRS = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
];
const START_SECONDS = 4;
const PLAY_SECONDS = 24;
const END_LIMIT_SECONDS = 240;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** How much clearance the worst nearby threat has from this spot. */
function clearance(state, x, y) {
  let worst = Infinity;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const d = Math.hypot(e.x - x, e.y - y) - e.r;
    if (d < worst) worst = d;
  }
  for (const b of state.bullets) {
    if (!b.active || !b.hostile) continue;
    const d = Math.hypot(b.x - x, b.y - y) - b.r - 6;
    if (d < worst) worst = d;
  }
  return worst;
}

function autopilot(state, look) {
  const p = state.player;
  ARGS.dash = false;
  let target = null;
  let bd = Infinity;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) {
      bd = d;
      target = e;
    }
  }
  if (target) {
    ARGS.ax = target.x;
    ARGS.ay = target.y;
    ARGS.firing = true;
  } else {
    ARGS.ax = FIELD.width / 2;
    ARGS.ay = FIELD.height / 2;
    ARGS.firing = false;
  }
  const dt = Math.min(0.15, look / 4);
  let bestDir = DIRS[0];
  let bestScore = -Infinity;
  let globalWorst = Infinity;
  for (const dir of DIRS) {
    let score = 0;
    let worstClear = Infinity;
    for (let t = dt; t <= look + 1e-6; t += dt) {
      const x = clamp(p.x + dir[0] * PLAYER.speed * t, FIELD.margin, FIELD.width - FIELD.margin);
      const y = clamp(p.y + dir[1] * PLAYER.speed * t, FIELD.margin, FIELD.height - FIELD.margin);
      const c = clearance(state, x, y);
      if (c < worstClear) worstClear = c;
      if (c < 0) score -= 1000;
    }
    score += Math.min(worstClear, 200);
    const px = p.x + dir[0] * PLAYER.speed * look;
    const py = p.y + dir[1] * PLAYER.speed * look;
    // keep off the walls and drift toward the middle of the arena
    score -= Math.max(0, 60 - Math.min(px, FIELD.width - px, py, FIELD.height - py)) * 2;
    score -= Math.hypot(px - FIELD.width / 2, py - FIELD.height / 2) * 0.04;
    if (worstClear < globalWorst) globalWorst = worstClear;
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }
  ARGS.mx = bestDir[0];
  ARGS.my = bestDir[1];
  if (globalWorst < 34) ARGS.dash = true;
  return ARGS;
}

/** Set `world` to the named scene (start, play or end; anything else is start). */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'end') {
    for (let i = 0; i < (START_SECONDS / STEP) | 0; i += 1) world.step(STEP, ARGS, true);
    return { screen: SCREEN_TITLE, best: 0, aim: { x: FIELD.width / 2, y: FIELD.height / 2 } };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  const look = name === 'end' ? 0.12 : 0.5;
  let over = false;
  for (let i = 0; i < (limit / STEP) | 0; i += 1) {
    if (world.step(STEP, autopilot(world.state, look), false) & EVENT_OVER) {
      over = true;
      break;
    }
  }
  return {
    screen: over || world.state.over ? SCREEN_OVER : SCREEN_PLAY,
    best: world.state.score,
    aim: { x: ARGS.ax, y: ARGS.ay },
  };
}
