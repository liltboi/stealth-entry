// Guard AI. Each officer walks a learnable waypoint loop, carries a vision cone that is blocked
// by cover, and moves through three states:
//   patrol     — walks the route, sweeps a calm cyan cone.
//   suspicious — heard something or caught a glimpse; stops, turns toward it, amber cone.
//   alert      — suspicion maxed; chases the agent, wide red cone, shouts and spikes the alarm.
// Suspicion is the officer's local memory of the agent. It rises while the cone holds a clear
// sight line (much slower in shadow, slower again when crouched) and falls when sight is broken.
// The highest suspicion among all guards is the player's detection meter (player.js).
//
// Sound works through walls: sprint footsteps and noise decoys pull officers toward a point even
// when the agent is invisible, which is what makes the decoy pouch useful.

import { DETECTION, GUARD } from './config.js';
import {
  checkLineOfSight,
  distanceBetween,
  moveCircle,
  spikeAlarm,
} from './world.js';

export function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function turnToward(current, target, rate, dt) {
  const difference = angleDifference(target, current);
  const step = Math.max(-rate * dt, Math.min(rate * dt, difference));
  return current + step;
}

/** Build the officers for one level from its guard data. */
export function createGuards(guardData) {
  return guardData.map((data, index) => {
    const route = data.route.map((point) => ({ x: point.x, y: point.y }));
    const first = route[0];
    const second = route[1] ?? route[0];
    const facing = Math.atan2(second.y - first.y, second.x - first.x);
    return {
      name: data.name ?? `SENTRY-${index + 1}`,
      route,
      waypointIndex: 1,
      x: first.x,
      y: first.y,
      radius: GUARD.radius,
      facing,
      desiredFacing: facing,
      speed: data.speed ?? GUARD.patrolSpeed,
      baseFov: data.fov ?? GUARD.fov,
      baseRange: data.range ?? GUARD.range,
      currentFov: data.fov ?? GUARD.fov,
      currentRange: data.range ?? GUARD.range,
      state: 'patrol',
      suspicion: 0,
      seesPlayer: false,
      sawPlayerThisFrame: false,
      distanceToPlayer: Infinity,
      lastSeenX: first.x,
      lastSeenY: first.y,
      lastSeenTimer: 99,
      waitTimer: (data.wait ?? GUARD.waypointWait) + index * 0.2,
      scanBase: facing,
      scanPhase: index * 1.9,
      alertTimer: 0,
      missedFor: 0,
      flash: 0,
      stuckTimer: 0,
      sidestepTimer: 0,
      sidestepSign: index % 2 === 0 ? 1 : -1,
      capturedPlayer: false,
    };
  });
}

/**
 * Does this officer see the agent right now? Four gates, cheapest first: range, cover, cone angle,
 * then the shadow rule (in darkness an officer must be almost on top of the agent).
 */
export function updateGuardVision(state, guard, player) {
  const dx = player.x - guard.x;
  const dy = player.y - guard.y;
  const distance = Math.hypot(dx, dy);
  guard.distanceToPlayer = distance;
  if (distance > guard.currentRange) return false;
  if (!checkLineOfSight(state, guard.x, guard.y, player.x, player.y)) return false;
  const angleTo = Math.atan2(dy, dx);
  if (Math.abs(angleDifference(angleTo, guard.facing)) > guard.currentFov / 2) return false;
  if (player.hidden && distance > GUARD.closeSenseRange) return false;
  return true;
}

/** Cone width and reach ease toward the state's target so a guard's vision reacts smoothly. */
function updateGuardCone(guard, dt) {
  const alert = guard.state === 'alert';
  const targetFov = alert ? GUARD.alertFov : guard.baseFov;
  const targetRange = alert ? GUARD.alertRange : guard.baseRange;
  const ease = Math.min(1, dt * 4.2);
  guard.currentFov += (targetFov - guard.currentFov) * ease;
  guard.currentRange += (targetRange - guard.currentRange) * ease;
}

/** One fixed step for every officer. */
export function updateGuards(state, guards, player, dt) {
  for (let i = 0; i < guards.length; i += 1) {
    const guard = guards[i];
    updateGuardCone(guard, dt);

    const sees = updateGuardVision(state, guard, player);
    guard.seesPlayer = sees;
    guard.sawPlayerThisFrame = sees;
    if (sees) {
      guard.lastSeenX = player.x;
      guard.lastSeenY = player.y;
      guard.lastSeenTimer = 0;
      guard.missedFor = 0;
    } else {
      guard.lastSeenTimer += dt;
      guard.missedFor += dt;
    }

    const previousState = guard.state;
    applyPerception(guard, player, sees, dt);
    listenForNoise(state, guard, player, dt);
    listenForDecoys(state, guard);
    const nextState = chooseGuardState(guard, previousState, sees);
    if (nextState !== previousState) enterGuardState(state, guard, nextState, player);

    if (guard.state === 'alert') updateAlertGuard(state, guard, player, dt);
    else if (guard.state === 'suspicious') updateSuspiciousGuard(state, guard, dt);
    else updatePatrolGuard(state, guard, dt);

    if (guard.flash > 0) guard.flash = Math.max(0, guard.flash - dt * 1.7);
    guard.suspicion = Math.max(0, Math.min(1, guard.suspicion));
  }
}

/** Sight raises suspicion and refreshes the officer's last-known position. */
function applyPerception(guard, player, sees, dt) {
  if (!sees) return;
  const closeness = Math.max(0, 1 - guard.distanceToPlayer / Math.max(1, guard.currentRange));
  let gain = DETECTION.gainBase * (0.45 + 0.6 * closeness);
  if (player.crouching) gain *= DETECTION.crouchFactor;
  if (player.hidden) gain *= DETECTION.shadowFactor;
  if (guard.state === 'suspicious') gain *= 1.12;
  if (guard.state === 'alert') gain *= 1.28;
  guard.suspicion = Math.min(1, guard.suspicion + gain * dt);
}

/** Sprinting is loud; crouching is nearly silent. Sound ignores walls but is muffled by them. */
function listenForNoise(state, guard, player, dt) {
  if (!player.moving || player.noiseRadius <= 0) return;
  const distance = distanceBetween(guard.x, guard.y, player.x, player.y);
  const open = checkLineOfSight(state, guard.x, guard.y, player.x, player.y);
  const reach = player.noiseRadius * (open ? 1 : 0.68);
  if (distance > reach) return;
  const loudness = 1 - distance / reach;
  // Sound alone can make an officer suspicious and send it to the noise, but never past that cap.
  guard.suspicion = Math.min(0.58, guard.suspicion + loudness * 0.62 * dt);
  if (guard.state === 'patrol' && loudness > 0.12) {
    guard.lastSeenX = player.x + Math.sin(guard.scanPhase + state.time) * 24;
    guard.lastSeenY = player.y + Math.cos(guard.scanPhase + state.time) * 24;
    guard.scanBase = Math.atan2(guard.lastSeenY - guard.y, guard.lastSeenX - guard.x);
    guard.desiredFacing = guard.scanBase;
  }
}

/** A thrown decoy is a one-shot pull: nearby officers walk to the clatter and sweep. */
function listenForDecoys(state, guard) {
  if (guard.state === 'alert') return;
  for (let i = 0; i < state.decoys.length; i += 1) {
    const decoy = state.decoys[i];
    if (decoy.heardBy.has(guard)) continue;
    const distance = distanceBetween(guard.x, guard.y, decoy.x, decoy.y);
    if (distance > decoy.radius) continue;
    decoy.heardBy.add(guard);
    const pull = 1 - Math.min(1, distance / decoy.radius);
    guard.suspicion = Math.max(guard.suspicion, 0.34 + pull * 0.18);
    guard.lastSeenX = decoy.x;
    guard.lastSeenY = decoy.y;
    guard.lastSeenTimer = 0;
    guard.scanBase = Math.atan2(decoy.y - guard.y, decoy.x - guard.x);
    guard.desiredFacing = guard.scanBase;
    guard.flash = Math.max(guard.flash, 0.55);
    spikeAlarm(state, 0.05);
  }
}

/**
 * State choice with hysteresis. It takes a real sighting to escalate; once alerted, the officer
 * keeps hunting until suspicion has fallen well back into the amber band.
 */
function chooseGuardState(guard, previousState, sees) {
  if (guard.suspicion >= DETECTION.alertAt) return 'alert';
  if (previousState === 'alert' && guard.suspicion >= 0.42) return 'alert';
  if (guard.suspicion >= DETECTION.suspiciousAt) return 'suspicious';
  if (previousState === 'suspicious' && guard.suspicion >= 0.12) return 'suspicious';
  if (sees) return previousState;
  return 'patrol';
}

function enterGuardState(state, guard, nextState, player) {
  if (nextState === 'alert') {
    guard.alertTimer = DETECTION.searchFor;
    guard.flash = 1;
    guard.lastSeenX = player.x;
    guard.lastSeenY = player.y;
    spikeAlarm(state, 0.38);
    state.alarmsTriggered = (state.alarmsTriggered ?? 0) + 1;
  } else if (nextState === 'suspicious') {
    guard.flash = Math.max(guard.flash, 0.65);
    guard.scanBase = Math.atan2(guard.lastSeenY - guard.y, guard.lastSeenX - guard.x);
  } else if (nextState === 'patrol') {
    guard.waypointIndex = nearestWaypoint(guard);
    guard.alertTimer = 0;
  }
  guard.state = nextState;
}

function nearestWaypoint(guard) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < guard.route.length; i += 1) {
    const point = guard.route[i];
    const distance = distanceBetween(guard.x, guard.y, point.x, point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Walk the loop, pausing and sweeping at each corner. The route is the player's to learn. */
function updatePatrolGuard(state, guard, dt) {
  if (guard.waitTimer > 0) {
    guard.waitTimer -= dt;
    const sweep = guard.scanBase + Math.sin(state.time * 1.35 + guard.scanPhase) * 0.52;
    guard.desiredFacing = sweep;
    turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed * 0.7, dt);
    return;
  }

  const target = guard.route[guard.waypointIndex % guard.route.length];
  const dx = target.x - guard.x;
  const dy = target.y - guard.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 7) {
    guard.waypointIndex = (guard.waypointIndex + 1) % guard.route.length;
    guard.waitTimer = GUARD.waypointWait + 0.25;
    const next = guard.route[guard.waypointIndex % guard.route.length];
    guard.scanBase = Math.atan2(next.y - guard.y, next.x - guard.x);
    guard.desiredFacing = guard.scanBase;
    return;
  }
  guard.desiredFacing = Math.atan2(dy, dx);
  moveGuardToward(state, guard, dx, dy, guard.speed, dt);
  turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed, dt);
}

/** Move toward the last known position, then sweep it. Suspicion itself drains; no timer needed. */
function updateSuspiciousGuard(state, guard, dt) {
  const dx = guard.lastSeenX - guard.x;
  const dy = guard.lastSeenY - guard.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 18) {
    guard.desiredFacing = Math.atan2(dy, dx);
    moveGuardToward(state, guard, dx, dy, GUARD.investigateSpeed, dt);
    turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed, dt);
    return;
  }
  guard.scanBase = Math.atan2(guard.lastSeenY - guard.y, guard.lastSeenX - guard.x);
  guard.desiredFacing = guard.scanBase + Math.sin(state.time * 1.8 + guard.scanPhase) * 0.78;
  turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed * 0.9, dt);
}

/** Charge the agent while visible; otherwise sprint to the last sighting and search there. */
function updateAlertGuard(state, guard, player, dt) {
  const sees = guard.seesPlayer;
  if (sees) {
    guard.alertTimer = DETECTION.searchFor;
    const dx = player.x - guard.x;
    const dy = player.y - guard.y;
    const distance = Math.hypot(dx, dy);
    guard.desiredFacing = Math.atan2(dy, dx);
    moveGuardToward(state, guard, dx, dy, GUARD.chaseSpeed, dt);
    turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed * 1.9, dt);
    if (distance <= GUARD.captureRange) guard.capturedPlayer = true;
    return;
  }

  guard.alertTimer = Math.max(0, guard.alertTimer - dt);
  const dx = guard.lastSeenX - guard.x;
  const dy = guard.lastSeenY - guard.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 22) {
    guard.desiredFacing = Math.atan2(dy, dx);
    moveGuardToward(state, guard, dx, dy, GUARD.chaseSpeed * 0.82, dt);
    turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed * 1.4, dt);
  } else {
    guard.scanBase = Math.atan2(guard.lastSeenY - guard.y, guard.lastSeenX - guard.x);
    guard.desiredFacing = guard.scanBase + Math.sin(state.time * 2.3 + guard.scanPhase) * 1.05;
    turnGuard(guard, guard.desiredFacing, GUARD.turnSpeed * 1.25, dt);
  }
}

function turnGuard(guard, target, rate, dt) {
  guard.facing = turnToward(guard.facing, target, rate, dt);
}

/**
 * Push toward a target with wall sliding. If the officer grinds against cover, it adds a short
 * perpendicular sidestep; that is enough to round the corners in these layouts.
 */
function moveGuardToward(state, guard, dx, dy, speed, dt) {
  const distance = Math.hypot(dx, dy) || 1;
  let mx = (dx / distance) * speed * dt;
  let my = (dy / distance) * speed * dt;

  if (guard.sidestepTimer > 0) {
    guard.sidestepTimer -= dt;
    const side = guard.sidestepSign;
    mx += (-dy / distance) * speed * dt * side;
    my += (dx / distance) * speed * dt * side;
  }

  const result = moveCircle(state, guard, mx, my, guard.radius);
  const moved = Math.hypot(result.movedX, result.movedY);
  const wanted = Math.hypot(mx, my);
  if (wanted > 0.01 && moved < wanted * 0.45) {
    guard.stuckTimer += dt;
    if (guard.stuckTimer > 0.22 && guard.sidestepTimer <= 0) {
      guard.stuckTimer = 0;
      guard.sidestepTimer = 0.55;
      guard.sidestepSign *= -1;
    }
  } else {
    guard.stuckTimer = Math.max(0, guard.stuckTimer - dt);
  }
}

/** Renderer helper: the colour and word for a guard's state. */
export function guardStateTint(guard) {
  if (guard.state === 'alert') return 'alert';
  if (guard.state === 'suspicious') return 'suspicious';
  return 'patrol';
}

