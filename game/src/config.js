// Every tuning number and colour in one place. The playfield is a fixed 1280x720 logical area;
// the renderer scales it to the window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720, margin: 18 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 11,
  speed: 350,
  accel: 2600,
  friction: 7,
  lives: 3,
  invulnTime: 1.3,
  fireInterval: 0.13,
  bulletSpeed: 760,
  bulletDamage: 1,
  bulletRadius: 4,
  spread: 0.055,
  recoil: 26,
};

export const DASH = {
  speed: 950,
  time: 0.16,
  cooldown: 1.5,
  buffer: 0.12, // extra invulnerability after the dash itself ends
  ghostInterval: 0.024,
  hitDamage: 2, // what a dash-through does to the small enemies
};

export const ENEMY_BULLET = { radius: 5, life: 6 };

/** Each kill adds `perKill` to the multiplier for `window` seconds; the bar shows the time left. */
export const COMBO = { window: 4.0, perKill: 0.1, max: 5.0 };

/** Base stats per enemy kind; hp and speed scale up with the wave number. */
export const ENEMIES = {
  chaser: { hp: 3, speed: 128, radius: 13, score: 100, steer: 3.2 },
  shooter: { hp: 4, speed: 96, radius: 13, score: 150, near: 250, far: 400, fireInterval: 2.3, bulletSpeed: 245, aimJitter: 0.12 },
  charger: { hp: 5, speed: 118, radius: 15, score: 200, trigger: 440, approachLimit: 4.0, telegraph: 0.72, dashSpeed: 700, dashTime: 0.42, recover: 0.85 },
  splitter: { hp: 6, speed: 78, radius: 17, score: 150, children: 2 },
  mini: { hp: 1, speed: 195, radius: 9, score: 50, steer: 4.5 },
  elite: {
    hp: 55, speed: 52, radius: 42, score: 2500, keep: 300,
    ringCount: 14, ringSpeed: 185, ringEvery: 2.6,
    volleySpeed: 260, volleyEvery: 2.1,
    spiralSpeed: 150, spiralRate: 0.15,
    broodEvery: 3.6,
  },
};

export const WAVES = {
  intermission: 3.2,
  hpScale: 0.15, hpScaleMax: 3.5,
  speedScale: 0.045, speedScaleMax: 0.9,
  fireScale: 0.05, fireScaleMax: 0.5, // shooter fire intervals shrink to at most half
  spawnInterval: 1.05, spawnIntervalMin: 0.34, spawnIntervalPerWave: 0.055,
};

/** How many of each kind a wave wants, as f(wave); kinds unlock as the waves go by. */
export const WAVE_MIX = {
  chaser: (w) => 3 + Math.ceil(w * 1.1),
  shooter: (w) => (w >= 2 ? 1 + Math.floor(w * 0.7) : 0),
  splitter: (w) => (w >= 3 ? Math.floor(w * 0.6) : 0),
  charger: (w) => (w >= 4 ? Math.floor(w * 0.55) : 0),
  cap: 34,
  eliteEvery: 5,
  eliteAdds: 0.5, // an elite wave brings half the usual escort
};

export const PICKUP = {
  dropChance: 0.07,
  life: 9,
  magnetRange: 110,
  magnetPull: 1500,
  magnetSpeed: 520,
  radius: 10,
  bonus: 300, // when the hull is already full
};

/** Pool sizes, allocated once at boot; nothing allocates per frame after that. */
export const POOL = { bullets: 320, enemies: 96, particles: 720, rings: 48, texts: 40, pickups: 8, ghosts: 24 };

export const PALETTE = {
  backdrop: '#04050c',
  field: '#070a16',
  grid: 'rgba(90, 225, 255, 0.05)',
  border: '#1d3f61',
  star: '#a9c4e6',
  player: '#00e5ff',
  playerCore: '#eafcff',
  bullet: '#a5f4ff',
  chaser: '#ff2d78',
  shooter: '#ff9640',
  charger: '#ffd60a',
  splitter: '#3ef794',
  mini: '#9dfccf',
  elite: '#b44dff',
  enemyBullet: '#ff5f8f',
  pickup: '#ffe14d',
  text: '#e8f6ff',
  muted: '#7487a6',
  danger: '#ff2a3c',
  panel: 'rgba(6, 12, 24, 0.88)',
};

export const FONT = '"Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'neon-bastion.best';
