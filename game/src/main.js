// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s steps
// (several in a slow frame, none in a fast one), and the renderer paints what is there. The game
// moves between four screens: title, play, paused and game over. The title screen steps the world
// in demo mode, a self-playing backdrop battle.
//
// ?seed=N fixes the battle. ?shot=start|play|end (with &seed=N) stages that scene instead of
// running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, FIELD, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_DASH,
  EVENT_ELITE,
  EVENT_ELITE_DOWN,
  EVENT_ESHOOT,
  EVENT_HURT,
  EVENT_KILL,
  EVENT_MILESTONE,
  EVENT_OVER,
  EVENT_PICKUP,
  EVENT_SHOOT,
  EVENT_WAVE,
  EVENT_WAVECLEAR,
} from './world.js';
import { ACTION_CONFIRM, ACTION_MUTE, ACTION_PAUSE, ACTION_RESTART, createInput } from './input.js';
import { SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE, createRenderer } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, performance.now(), {
      best: scene.best,
      newBest: false,
      aim: scene.aim,
    });
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas, renderer.toField);
  const stepInput = { mx: 0, my: 0, ax: FIELD.width / 2, ay: FIELD.height / 2, firing: false, dash: false };
  let screen = SCREEN_TITLE;
  let best = readBest();
  let newBest = false;
  let muted = false;
  let accumulator = 0;
  let last = performance.now();
  let overGuard = 0;

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function startGame() {
    world.reset();
    newBest = false;
    accumulator = 0;
    screen = SCREEN_PLAY;
    audio.unlock();
    audio.setIntensity(1);
    audio.startMusic();
    announce('战斗开始。3 点生命。');
  }

  function endGame() {
    screen = SCREEN_OVER;
    overGuard = 0.6; // ignore the click that was still held when the ship died
    audio.stopMusic();
    if (world.state.score > best) {
      best = world.state.score;
      newBest = true;
      saveBest(best);
    }
    announce(`游戏结束。得分 ${world.state.score}，最高 ${best}。按 R 再来。`);
  }

  function handleActions(frameDt) {
    let actions = input.takeActions();
    if (screen === SCREEN_OVER && overGuard > 0) actions &= ACTION_MUTE;
    if (actions & ACTION_MUTE) {
      muted = !muted;
      audio.unlock();
      audio.setMuted(muted);
      announce(muted ? '已静音。' : '声音开启。');
    }
    if (overGuard > 0) overGuard -= frameDt;
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame();
    } else if (screen === SCREEN_PLAY) {
      if (actions & ACTION_PAUSE) {
        screen = SCREEN_PAUSED;
        audio.stopMusic();
        announce('已暂停。');
      } else if (actions & ACTION_RESTART) {
        startGame();
      }
    } else if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        audio.startMusic();
        announce('继续。');
      } else if (actions & ACTION_RESTART) {
        startGame();
      }
    } else if (screen === SCREEN_OVER) {
      if (actions & (ACTION_CONFIRM | ACTION_RESTART)) startGame();
    }
  }

  function handleEvents(events) {
    if (events & EVENT_OVER) {
      audio.gameOver();
      endGame();
      return;
    }
    if (events & EVENT_SHOOT) audio.shoot();
    if (events & EVENT_DASH) audio.dash();
    if (events & EVENT_ESHOOT) audio.eshoot();
    if (events & EVENT_HURT) {
      audio.hurt();
      announce(`被击中！剩余 ${world.state.player.lives} 点生命。`);
    }
    if (events & EVENT_KILL) audio.explode(false);
    if (events & EVENT_ELITE_DOWN) audio.explode(true);
    if (events & EVENT_ELITE) {
      audio.eliteIn();
      announce('警告：精英旗舰出现。');
    }
    if (events & EVENT_PICKUP) audio.pickup();
    if (events & EVENT_WAVECLEAR) audio.waveClear();
    if (events & EVENT_MILESTONE) audio.milestone();
    if (events & EVENT_WAVE) {
      audio.waveStart();
      audio.setIntensity(world.state.wave);
      announce(`第 ${world.state.wave} 波来袭。`);
    }
  }

  function step(demo) {
    stepInput.mx = input.mx();
    stepInput.my = input.my();
    stepInput.ax = input.aimX();
    stepInput.ay = input.aimY();
    stepInput.firing = input.isFiring();
    stepInput.dash = input.dashHeld();
    return world.step(STEP, stepInput, demo);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - last) / 1000, MAX_FRAME);
    accumulator += frameDt;
    last = now;
    handleActions(frameDt);
    let events = 0;
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP) {
        events |= step(screen === SCREEN_TITLE);
        accumulator -= STEP;
      }
    } else if (screen === SCREEN_OVER) {
      // keep stepping so the final explosion plays out behind the panel
      while (accumulator >= STEP) {
        world.step(STEP, stepInput, false);
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    if (screen === SCREEN_PLAY) handleEvents(events);
    renderer.draw(world.state, screen, now, {
      best,
      newBest,
      aim: { x: stepInput.ax, y: stepInput.ay },
    });
  }

  // Leaving the tab pauses a running game rather than letting the battle go unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      audio.stopMusic();
      announce('已暂停。');
    }
  });

  announce('NEON BASTION。点击或按回车开始。');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
