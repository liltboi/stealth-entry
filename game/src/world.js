// The facility's rules, with no drawing and no browser in it. world.js builds a level's colliders
// and shadow patches from the data in levels.js, then answers the geometric questions the rest of
// the game asks: can this circle stand here, does a wall cut this sight line, how far does a ray
// travel through the dark, and is this point hidden in shadow. It also owns the small transient
// bookkeeping on the floor: noise decoys, footstep scuffs, sparks, toasts and the alarm level.
//
// Collision is circle-vs-rectangle. Sight lines are segment-vs-rectangle; vision cones are ray
// casts against the same blockers, which is why a cone visibly folds around a crate.

import { FIELD, PLAYER, WORLD } from './config.js';
import { LEVELS } from './levels.js';

let nextSolidId = 1;

/** A fresh, empty state object. main.js fills player and guards after loading a level. */
export function createWorld() {
  const state = {
    levelIndex: 0,
    level: null,
    solids: [],
    shadows: [],
    exit: null,
    cores: [],
    decoys: [],
    footsteps: [],
    sparkles: [],
    toast: null,
    time: 0,
    levelTime: 0,
    alarm: 0,
    peakDetection: 0,
    decoysUsed: 0,
    coresTaken: 0,
    alarmsTriggered: 0,
    player: null,
    guards: [],
  };

  /**
   * Load a level's geometry and reset everything transient. Player and guard state are created
   * by main.js (and by the screenshot stager) so world.js stays independent of both.
   */
  function loadLevel(index) {
    const clamped = Math.max(0, Math.min(LEVELS.length - 1, index | 0));
    const level = LEVELS[clamped];
    state.levelIndex = clamped;
    state.level = level;
    state.solids = buildSolids(level);
    state.shadows = level.shadows.map((shadow, i) => ({ ...shadow, seed: i * 1.71 }));
    state.exit = { ...level.exit, phase: clamped * 0.8 };
    state.cores = level.cores.map((core, i) => ({
      ...core,
      collected: false,
      phase: i * 2.1 + clamped,
    }));
    state.decoys = [];
    state.footsteps = [];
    state.sparkles = [];
    state.toast = null;
    state.time = 0;
    state.levelTime = 0;
    state.alarm = 0;
    state.peakDetection = 0;
    state.decoysUsed = 0;
    state.coresTaken = 0;
    state.alarmsTriggered = 0;
    state.player = null;
    state.guards = [];
    return state;
  }

  loadLevel(0);
  return { state, loadLevel };
}

/** The four outer walls plus every cover piece, all of which block movement and sight. */
function buildSolids(level) {
  const b = WORLD.border;
  const border = [
    { x: 0, y: 0, w: FIELD.width, h: b, kind: 'border', side: 'top' },
    { x: 0, y: FIELD.height - b, w: FIELD.width, h: b, kind: 'border', side: 'bottom' },
    { x: 0, y: 0, w: b, h: FIELD.height, kind: 'border', side: 'left' },
    { x: FIELD.width - b, y: 0, w: b, h: FIELD.height, kind: 'border', side: 'right' },
  ];
  return [...border, ...level.cover].map((solid) => ({
    ...solid,
    id: nextSolidId++,
    blocksSight: true,
    solid: true,
  }));
}

export function distanceBetween(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/** True when the circle at (x, y) overlaps any solid. Used for movement and decoy placement. */
export function circleHitsSolid(state, x, y, radius) {
  const solids = state.solids;
  for (let i = 0; i < solids.length; i += 1) {
    const rect = solids[i];
    const nearestX = Math.max(rect.x, Math.min(x, rect.x + rect.w));
    const nearestY = Math.max(rect.y, Math.min(y, rect.y + rect.h));
    const dx = x - nearestX;
    const dy = y - nearestY;
    if (dx * dx + dy * dy < radius * radius) return true;
  }
  return false;
}

/**
 * Move a circular entity by (dx, dy), one axis at a time so it slides along walls. The entity's
 * radius and the level's solids decide what sticks. Returns how far it actually moved and which
 * axes were blocked, which lets a chasing guard try a sidestep when it runs into a rack.
 */
export function moveCircle(state, entity, dx, dy, radius) {
  const startX = entity.x;
  const startY = entity.y;
  let blockedX = false;
  let blockedY = false;

  if (dx !== 0) {
    const nextX = Math.max(radius, Math.min(FIELD.width - radius, entity.x + dx));
    if (!circleHitsSolid(state, nextX, entity.y, radius)) entity.x = nextX;
    else blockedX = true;
  }
  if (dy !== 0) {
    const nextY = Math.max(radius, Math.min(FIELD.height - radius, entity.y + dy));
    if (!circleHitsSolid(state, entity.x, nextY, radius)) entity.y = nextY;
    else blockedY = true;
  }
  return { movedX: entity.x - startX, movedY: entity.y - startY, blockedX, blockedY };
}

/** Liang-Barsky: does the segment from a to b cross the rectangle? */
function segmentCrossesRect(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let near = 0;
  let far = 1;
  const slab = (origin, delta, min, max) => {
    if (Math.abs(delta) < 1e-7) return origin >= min && origin <= max;
    let t0 = (min - origin) / delta;
    let t1 = (max - origin) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    return near <= far;
  };
  if (!slab(x1, dx, rect.x, rect.x + rect.w)) return false;
  if (!slab(y1, dy, rect.y, rect.y + rect.h)) return false;
  return near <= far;
}

/** True when nothing solid stands between the two points. This is the stealth rule. */
export function checkLineOfSight(state, x1, y1, x2, y2) {
  const solids = state.solids;
  for (let i = 0; i < solids.length; i += 1) {
    if (segmentCrossesRect(x1, y1, x2, y2, solids[i])) return false;
  }
  return true;
}

/** Distance a ray travels from (x, y) at `angle` before it meets a solid, clamped to maxDist. */
export function raycastSolid(state, x, y, angle, maxDist) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let nearest = maxDist;
  const solids = state.solids;
  for (let i = 0; i < solids.length; i += 1) {
    const rect = solids[i];
    let near = 0;
    let far = nearest;
    let hit = true;
    // X slab.
    if (Math.abs(dx) < 1e-7) {
      hit = x >= rect.x && x <= rect.x + rect.w;
    } else {
      let t0 = (rect.x - x) / dx;
      let t1 = (rect.x + rect.w - x) / dx;
      if (t0 > t1) [t0, t1] = [t1, t0];
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      hit = near <= far;
    }
    // Y slab.
    if (hit) {
      if (Math.abs(dy) < 1e-7) {
        hit = y >= rect.y && y <= rect.y + rect.h;
      } else {
        let t0 = (rect.y - y) / dy;
        let t1 = (rect.y + rect.h - y) / dy;
        if (t0 > t1) [t0, t1] = [t1, t0];
        near = Math.max(near, t0);
        far = Math.min(far, t1);
        hit = near <= far && near >= 0;
      }
    }
    if (hit && near > 0.5 && near < nearest) nearest = near;
  }
  return nearest;
}

/** The darkest, safest floor: a point inside any shadow patch. */
export function pointInShadow(state, x, y) {
  const shadows = state.shadows;
  for (let i = 0; i < shadows.length; i += 1) {
    if (pointInRect(x, y, shadows[i])) return true;
  }
  return false;
}

export function shadowAt(state, x, y) {
  const shadows = state.shadows;
  for (let i = 0; i < shadows.length; i += 1) {
    if (pointInRect(x, y, shadows[i])) return shadows[i];
  }
  return null;
}

/** The nearest solid-free point on the line from a safe origin to the wanted point. */
export function findFreePoint(state, fromX, fromY, toX, toY, radius) {
  if (!circleHitsSolid(state, toX, toY, radius)) return { x: toX, y: toY };
  for (let t = 0.92; t > 0; t -= 0.06) {
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    if (!circleHitsSolid(state, x, y, radius)) return { x, y };
  }
  return { x: fromX, y: fromY };
}

/* ---------------------------------------------------------------------------------------------
 * Transient floor bookkeeping
 * ------------------------------------------------------------------------------------------- */

export function showToast(state, text, kind = 'info', seconds = 2.2) {
  state.toast = { text, kind, ttl: seconds, max: seconds };
}

export function addFootstep(state, x, y, loud) {
  state.footsteps.push({ x, y, loud, ttl: 1.5, max: 1.5, angle: state.time * 1.7 });
  if (state.footsteps.length > 42) state.footsteps.shift();
}

export function addSparkles(state, x, y, color, count = 14) {
  const seed = state.time * 9301 + x * 49297 + y * 233;
  for (let i = 0; i < count; i += 1) {
    const a = (seed + i * 2.399) % (Math.PI * 2);
    const speed = 26 + ((seed * (i + 3)) % 90);
    state.sparkles.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      ttl: 0.45 + ((seed + i) % 40) / 100,
      max: 0.85,
      size: 1.5 + ((seed + i * 7) % 24) / 12,
      color,
    });
  }
  if (state.sparkles.length > 140) state.sparkles.splice(0, state.sparkles.length - 140);
}

/** Place a noise decoy at the clicked point, clamped to throw range and pulled out of walls. */
export function placeDecoy(state, player, targetX, targetY) {
  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const dist = Math.hypot(dx, dy) || 1;
  const range = Math.min(PLAYER.decoyRange, dist);
  let x = player.x + (dx / dist) * range;
  let y = player.y + (dy / dist) * range;
  const free = findFreePoint(state, player.x, player.y, x, y, 10);
  x = free.x;
  y = free.y;
  const decoy = {
    x,
    y,
    age: 0,
    ttl: PLAYER.decoyLife,
    radius: PLAYER.decoyRadius,
    heardBy: new Set(),
  };
  state.decoys.push(decoy);
  state.decoysUsed += 1;
  addSparkles(state, x, y, '#9ae8ff', 10);
  return decoy;
}

/** Pick up any core the player is standing on. Returns how many were taken this step. */
export function collectDataCores(state, player) {
  let taken = 0;
  for (let i = 0; i < state.cores.length; i += 1) {
    const core = state.cores[i];
    if (core.collected) continue;
    if (distanceBetween(core.x, core.y, player.x, player.y) <= PLAYER.corePickupRange) {
      core.collected = true;
      state.coresTaken += 1;
      taken += 1;
      addSparkles(state, core.x, core.y, '#5ef9ff', 26);
      showToast(state, `${core.label} SECURED`, 'good', 2.4);
      const left = state.cores.filter((entry) => !entry.collected).length;
      if (left === 0 && state.cores.length > 0) {
        showToast(state, 'ALL CORES SECURED — REACH THE LIFT', 'good', 3);
      }
    }
  }
  return taken;
}

export function coresRemaining(state) {
  return state.cores.filter((core) => !core.collected).length;
}

/** The player's feet are inside the glowing pad. */
export function playerInExit(state, player) {
  const exit = state.exit;
  return (
    player.x >= exit.x - 6 &&
    player.x <= exit.x + exit.w + 6 &&
    player.y >= exit.y - 6 &&
    player.y <= exit.y + exit.h + 6
  );
}

/** Raise the alarm with a sharp spike (a near miss, a decoy noise, a shouted order). */
export function spikeAlarm(state, amount) {
  state.alarm = Math.min(1, state.alarm + amount);
}

/**
 * Advance every transient effect and settle the alarm toward the guards' current tension. This
 * runs whether or not the player is moving, so alarms cool down and toast messages expire.
 */
export function updateEffects(state, dt) {
  state.time += dt;
  state.levelTime += dt;

  for (let i = state.decoys.length - 1; i >= 0; i -= 1) {
    const decoy = state.decoys[i];
    decoy.age += dt;
    if (decoy.age >= decoy.ttl) state.decoys.splice(i, 1);
  }
  for (let i = state.footsteps.length - 1; i >= 0; i -= 1) {
    const step = state.footsteps[i];
    step.ttl -= dt;
    if (step.ttl <= 0) state.footsteps.splice(i, 1);
  }
  for (let i = state.sparkles.length - 1; i >= 0; i -= 1) {
    const spark = state.sparkles[i];
    spark.ttl -= dt;
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vx *= 1 - dt * 2.4;
    spark.vy *= 1 - dt * 2.4;
    if (spark.ttl <= 0) state.sparkles.splice(i, 1);
  }
  if (state.toast) {
    state.toast.ttl -= dt;
    if (state.toast.ttl <= 0) state.toast = null;
  }

  let target = 0;
  let maxSuspicion = 0;
  for (let i = 0; i < state.guards.length; i += 1) {
    const guard = state.guards[i];
    maxSuspicion = Math.max(maxSuspicion, guard.suspicion);
    if (guard.state === 'alert') target = Math.max(target, 0.96);
    else if (guard.state === 'suspicious') target = Math.max(target, 0.5);
  }
  target = Math.max(target, maxSuspicion * 0.62);
  const rate = target > state.alarm ? 2.6 : 0.75;
  state.alarm += (target - state.alarm) * Math.min(1, dt * rate);
  state.alarm = Math.max(0, Math.min(1, state.alarm));
}

/** Used by the screenshot stager to add footsteps along a trail without running the sim. */
export function addFootstepTrail(state, points, loud) {
  for (const point of points) addFootstep(state, point.x, point.y, loud);
}
