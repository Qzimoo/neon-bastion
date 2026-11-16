// Keyboard and pointer input, mapped into field coordinates. Held keys and the pointer give a
// continuous state (move vector, aim point, firing); one-shot presses are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and never counted twice.
// Space is both dash (in play) and confirm (on the title and game-over screens); the loop decides.

import { FIELD } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;
export const ACTION_MUTE = 8;

const UP = new Set(['KeyW', 'ArrowUp']);
const DOWN = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const DASH = new Set(['Space']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);
const MUTE = new Set(['KeyM']);
const CONFIRM = new Set(['Enter']);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createInput(target, toField) {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  let dash = false;
  let firing = false;
  let actions = 0;
  const aim = { x: FIELD.width / 2, y: FIELD.height / 2 };

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (DASH.has(event.code)) {
      dash = true;
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (RESTART.has(event.code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
    else if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (DASH.has(event.code)) dash = false;
  });
  // A key or button released while the tab is hidden never sends its event: let go of everything
  // on blur.
  window.addEventListener('blur', () => {
    up = down = left = right = dash = firing = false;
  });

  window.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    firing = true;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    firing = false;
  });
  window.addEventListener('pointermove', (event) => {
    const spot = toField(event.clientX, event.clientY);
    aim.x = spot.x;
    aim.y = spot.y;
  });
  // No right-click menu over the arena.
  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    mx: () => (right ? 1 : 0) - (left ? 1 : 0),
    my: () => (down ? 1 : 0) - (up ? 1 : 0),
    dashHeld: () => dash,
    aimX: () => aim.x,
    aimY: () => aim.y,
    isFiring: () => firing,
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
