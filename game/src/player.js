// The agent: movement, stance, noise, shadow concealment, the decoy pouch and the detection
// meter. Guards decide how suspicious they are (guards.js); this module reads the highest of
// those suspicions as the player's detection meter, smooths it for the HUD, and turns it into a
// clear status word. The meter fills while a cone holds you and drains once you break sight,
// which is the recovery window the whole game is built around.

import { DETECTION, PLAYER } from './config.js';
import {
  addFootstep,
  moveCircle,
  placeDecoy,
  pointInShadow,
  showToast,
} from './world.js';

export function createPlayer(spawn) {
  return {
    x: spawn.x,
    y: spawn.y,
    radius: PLAYER.radius,
    vx: 0,
    vy: 0,
    facing: -Math.PI / 2,
    aimAngle: -Math.PI / 2,
    aimX: spawn.x + 90,
    aimY: spawn.y - 40,
    statusLabel: 'UNSEEN',
    stance: 'walk',
    moving: false,
    sprinting: false,
    crouching: false,
    speedNow: 0,
    hidden: false,
    inShadow: false,
    seen: false,
    seenBy: 0,
    detection: 0,
    displayDetection: 0,
    peakDetection: 0,
    noiseRadius: 0,
    noiseLevel: 0,
    footstepTimer: 0,
    stepPhase: 0,
    decoyCharges: PLAYER.decoyCharges,
    decoyCooldown: 0,
    sprintTrail: [],
    hitFlash: 0,
  };
}

/**
 * One fixed step of movement. `intent` is { x, y, sprint, crouch, aimX, aimY } where x/y are -1..1
 * from the keyboard. Velocity is eased toward the wanted direction so starts and stops feel
 * smooth, then the world resolves it against walls one axis at a time.
 */
export function updatePlayer(state, player, intent, dt) {
  let ix = Number(intent.x) || 0;
  let iy = Number(intent.y) || 0;
  const length = Math.hypot(ix, iy);
  if (length > 1) {
    ix /= length;
    iy /= length;
  }

  player.sprinting = Boolean(intent.sprint) && !intent.crouch && (ix !== 0 || iy !== 0);
  player.crouching = Boolean(intent.crouch);
  player.stance = player.crouching ? 'crouch' : player.sprinting ? 'sprint' : 'walk';
  const speed = player.crouching
    ? PLAYER.crouchSpeed
    : player.sprinting
      ? PLAYER.sprintSpeed
      : PLAYER.walkSpeed;

  const ease = Math.min(1, dt * PLAYER.acceleration);
  player.vx += (ix * speed - player.vx) * ease;
  player.vy += (iy * speed - player.vy) * ease;
  if (ix === 0 && iy === 0) {
    player.vx *= 1 - Math.min(1, dt * 9);
    player.vy *= 1 - Math.min(1, dt * 9);
  }

  const move = moveCircle(state, player, player.vx * dt, player.vy * dt, player.radius);
  if (move.blockedX) player.vx = 0;
  if (move.blockedY) player.vy = 0;

  player.speedNow = Math.hypot(player.vx, player.vy);
  player.moving = player.speedNow > 18;
  if (player.moving) {
    player.facing = Math.atan2(player.vy, player.vx);
    player.stepPhase += dt * (player.sprinting ? 15 : 10);
  }
  if (Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY)) {
    player.aimX = intent.aimX;
    player.aimY = intent.aimY;
    player.aimAngle = Math.atan2(intent.aimY - player.y, intent.aimX - player.x);
  }

  player.inShadow = pointInShadow(state, player.x, player.y);
  // Shadow conceals a quiet agent. Sprinting kicks up noise and a silhouette the dark cannot hold.
  player.hidden = player.inShadow && !player.sprinting;

  player.noiseRadius = !player.moving
    ? 0
    : player.sprinting
      ? 212
      : player.crouching
        ? 46
        : 116;
  player.noiseLevel = Math.min(1, player.noiseRadius / 212);

  emitFootsteps(state, player, dt);
  if (player.decoyCooldown > 0) player.decoyCooldown = Math.max(0, player.decoyCooldown - dt);
  if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt);

  // A short motion trail makes a sprint read instantly, even when standing still in a screenshot.
  if (player.sprinting && player.moving) {
    player.sprintTrail.push({ x: player.x, y: player.y, ttl: 0.3 });
    if (player.sprintTrail.length > 12) player.sprintTrail.shift();
  }
  for (let i = player.sprintTrail.length - 1; i >= 0; i -= 1) {
    player.sprintTrail[i].ttl -= dt;
    if (player.sprintTrail[i].ttl <= 0) player.sprintTrail.splice(i, 1);
  }
}

/** Scuffs on the floor, spaced by stance. Quiet crouch steps barely show; sprints glare. */
function emitFootsteps(state, player, dt) {
  player.footstepTimer -= dt;
  if (!player.moving || player.footstepTimer > 0) return;
  const interval = player.sprinting ? 0.19 : player.crouching ? 0.56 : 0.34;
  player.footstepTimer = interval;
  const side = Math.sin(player.stepPhase) * 6;
  const px = player.x - Math.cos(player.facing) * 8 - Math.sin(player.facing) * side;
  const py = player.y - Math.sin(player.facing) * 8 + Math.cos(player.facing) * side;
  addFootstep(state, px, py, player.sprinting);
}

/** Click: throw a noise decoy at the cursor. Returns true when one actually left the pouch. */
export function throwNoiseDecoy(state, player, targetX, targetY) {
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return false;
  if (player.decoyCooldown > 0) {
    showToast(state, `DECOY RECHARGING ${player.decoyCooldown.toFixed(1)}s`, 'info', 1.2);
    return false;
  }
  if (player.decoyCharges <= 0) {
    showToast(state, 'NO DECOYS LEFT', 'bad', 1.4);
    return false;
  }
  player.decoyCharges -= 1;
  player.decoyCooldown = PLAYER.decoyCooldown;
  placeDecoy(state, player, targetX, targetY);
  showToast(state, 'NOISE DECOY ARMED — PULL THEM AWAY', 'info', 1.9);
  return true;
}

/**
 * Convert the guards' local suspicion into the one meter on screen. The most alert officer
 * drives the meter; the display value eases so the bar moves like a needle, not a jump cut.
 */
export function updateDetection(state, player, guards, dt) {
  let highest = 0;
  let seenBy = 0;
  for (let i = 0; i < guards.length; i += 1) {
    const guard = guards[i];
    if (guard.suspicion > highest) highest = guard.suspicion;
    if (guard.seesPlayer) seenBy += 1;
  }
  player.detection = Math.min(1, highest);
  player.seenBy = seenBy;
  player.seen = seenBy > 0;
  player.peakDetection = Math.max(player.peakDetection, player.detection);
  state.peakDetection = Math.max(state.peakDetection, player.detection);
  player.displayDetection += (player.detection - player.displayDetection) * Math.min(1, dt * 11);
  if (highest === 0 && player.displayDetection < 0.004) player.displayDetection = 0;
  player.statusLabel = detectionStatus(player, state.alarm);
}

/** True when detection is at the cap. main.js reports the reason on the fail screen. */
export function isFullyDetected(player) {
  return player.detection >= DETECTION.failAt - 1e-4;
}

/** The short word the HUD and screen readers use for the current detection state. */
export function detectionStatus(player, alarm) {
  if (player.hidden && !player.seen) return 'CONCEALED';
  if (player.seen && player.detection > DETECTION.alertAt) return 'HUNTED';
  if (player.seen) return 'SPOTTED';
  if (player.detection > 0.12) return 'TRACE COOLING';
  if (alarm > 0.5) return 'ALARM HIGH';
  return 'UNSEEN';
}
