// Keyboard and pointer input, translated into intents the game loop can consume once per frame.
// WASD / arrows steer; Shift sprints; Ctrl or C crouches. Space/Enter confirm a screen, P/Escape
// pauses, R restarts. The mouse aims and, on a left click during play, throws a noise decoy at
// the world point under the cursor. Clicks are queued with their world position so a click that
// lands between two frames is never lost.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_RESTART = 4;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const CROUCH = new Set(['ControlLeft', 'ControlRight', 'KeyC']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const RESTART = new Set(['KeyR']);

/**
 * @param {HTMLCanvasElement} target  canvas that receives pointer clicks
 * @param {(clientX:number, clientY:number) => {x:number,y:number}} toWorld  screen -> playfield
 */
export function createInput(target, toWorld) {
  const held = new Set();
  const anyHeld = (keys) => {
    for (const key of keys) if (held.has(key)) return true;
    return false;
  };
  let pointerX = 640;
  let pointerY = 360;
  let actions = 0;
  const clicks = [];

  window.addEventListener('keydown', (event) => {
    const code = event.code;
    if (
      UP.has(code) || DOWN.has(code) || LEFT.has(code) || RIGHT.has(code) ||
      SPRINT.has(code) || CROUCH.has(code)
    ) {
      held.add(code);
      event.preventDefault();
      return;
    }
    if (CONFIRM.has(code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
      event.preventDefault();
    } else if (PAUSE.has(code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
      event.preventDefault();
    } else if (RESTART.has(code)) {
      if (!event.repeat) actions |= ACTION_RESTART;
      event.preventDefault();
    }
  });

  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });

  // A tab switch never sends keyup for held keys: release everything when focus leaves.
  window.addEventListener('blur', () => {
    held.clear();
    actions = 0;
    clicks.length = 0;
  });

  target.addEventListener('pointermove', (event) => {
    const point = toWorld(event.clientX, event.clientY);
    pointerX = point.x;
    pointerY = point.y;
  });

  target.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);
    pointerX = point.x;
    pointerY = point.y;
    clicks.push({ x: point.x, y: point.y });
    if (clicks.length > 8) clicks.shift();
    actions |= ACTION_CONFIRM;
  });

  target.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    /** Normalized steering vector, sprint/crouch flags and the current cursor aim point. */
    movement() {
      return {
        x: (anyHeld(RIGHT) ? 1 : 0) - (anyHeld(LEFT) ? 1 : 0),
        y: (anyHeld(DOWN) ? 1 : 0) - (anyHeld(UP) ? 1 : 0),
        sprint: anyHeld(SPRINT),
        crouch: anyHeld(CROUCH),
        aimX: pointerX,
        aimY: pointerY,
      };
    },
    /** One-shot key presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Left clicks since the last call, with playfield coordinates. */
    takeClicks() {
      const taken = clicks.slice();
      clicks.length = 0;
      return taken;
    },
    /** Exposed for the HUD's aim reticle without allocating a click. */
    pointer() {
      return { x: pointerX, y: pointerY };
    },
  };
}
