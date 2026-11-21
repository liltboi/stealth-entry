// Boot, the fixed-step loop and the campaign state machine. One frame reads input, advances the
// simulation in 1/60 s steps (several in a slow frame, none in a fast one), then paints.
//
// Screens: title -> briefing -> play -> (success -> next briefing | failure -> retry) -> victory.
// The loop owns level progression, objective checks, ranks and the deterministic screenshot
// scenes behind ?shot=start|play|alert|success. Seed is accepted so a shareable URL and its
// screenshots are reproducible; the simulation itself is deterministic apart from tiny cosmetic
// sparks.
//
// Screenshot staging creates the real game state and paints the real renderer, but places the
// agent, officers, cones, meter and time at a fixed, composed moment. Nothing is faked in the
// drawing: the cones are the same ray-cast fans the guards use to see.

import { BEST_KEY, GUARD, PALETTE, PLAYER, SCREENS, STEP, WORLD } from './config.js';
import { LEVELS } from './levels.js';
import {
  addFootstepTrail,
  addSparkles,
  collectDataCores,
  coresRemaining,
  createWorld,
  playerInExit,
  pointInShadow,
  showToast,
  updateEffects,
} from './world.js';
import { createGuards, updateGuards } from './guards.js';
import {
  createPlayer,
  isFullyDetected,
  throwNoiseDecoy,
  updateDetection,
  updatePlayer,
} from './player.js';
import { createRenderer } from './render.js';
import {
  ACTION_CONFIRM,
  ACTION_PAUSE,
  ACTION_RESTART,
  createInput,
} from './input.js';

const MAX_FRAME = 0.25;
const MAX_STEPS = 8;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const statusLine = document.getElementById('status');
const renderer = createRenderer(canvas);
const world = createWorld();
const state = world.state;

const game = {
  screen: SCREENS.TITLE,
  levelIndex: 0,
  world,
  shot: Boolean(shot),
  shotTime: 4.2 + (seed % 7) * 0.11,
  time: 0,
  seedOffset: (seed % 13) * 0.017,
  shake: 0,
  results: [],
  lastStats: null,
  reason: '',
  failHint: '',
  successNote: [],
  rankColour: PALETTE.patrol,
  hintCooldown: 0,
  bestRank: readBestRank(),
};

let accumulator = 0;

/* ---------------------------------------------------------------------------------------------
 * Campaign helpers
 * ------------------------------------------------------------------------------------------- */

function formatClock(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

const RANK_ORDER = { S: 4, A: 3, B: 2, C: 1 };

function computeRank(time, peak, par) {
  if (peak <= 0.35 && time <= par) return 'S';
  if (peak <= 0.62 && time <= par * 1.5) return 'A';
  if (peak <= 0.88) return 'B';
  return 'C';
}

function rankColour(rank) {
  if (rank === 'S') return PALETTE.exit;
  if (rank === 'A') return PALETTE.patrol;
  if (rank === 'B') return PALETTE.suspicious;
  return PALETTE.alert;
}

function rankLabel(rank) {
  if (rank === 'S') return 'GHOST PROTOCOL';
  if (rank === 'A') return 'CLEAN INFILTRATION';
  if (rank === 'B') return 'MESSY BUT OUT';
  return 'LOUD EXTRACTION';
}

function noteForRank(rank, level) {
  const recovery = level.cores.length > 0 ? `${level.cores.length === 1 ? 'CORE-01' : 'BOTH CORES'} recovered from ${level.name}.` : 'The freight manifest never flagged the entry.';
  if (rank === 'S') {
    return [recovery, 'No cone held you for more than a heartbeat.', 'The facility still believes the sector is empty.'];
  }
  if (rank === 'A') {
    return [recovery, 'One trace, broken before the alarm could settle.', 'The lift log records a sensor fault, nothing more.'];
  }
  if (rank === 'B') {
    return [recovery, 'The alarm heard you before the lift did.', 'You still walked out. That is the job.'];
  }
  return [recovery, 'Every camera in the sector saw the shape of you.', 'Mission complete; the legend stays messy.'];
}

function readBestRank() {
  try {
    return window.localStorage.getItem(BEST_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveBestRank(rank) {
  try {
    window.localStorage.setItem(BEST_KEY, rank);
  } catch {
    // Storage can be unavailable in private windows; the rank then lasts this visit only.
  }
}

function bestOf(ranks) {
  let best = '';
  for (const rank of ranks) {
    if (!rank) continue;
    if (!best || (RANK_ORDER[rank] ?? 0) > (RANK_ORDER[best] ?? 0)) best = rank;
  }
  return best;
}

function announce(message) {
  if (statusLine) statusLine.textContent = message;
}

/* ---------------------------------------------------------------------------------------------
 * Level lifecycle
 * ------------------------------------------------------------------------------------------- */

/** Build the player and guards for a level index on top of world.loadLevel's geometry. */
function prepareLevel(index) {
  world.loadLevel(index);
  const level = state.level;
  state.player = createPlayer(level.spawn);
  state.player.aimX = level.spawn.x + 130;
  state.player.aimY = level.spawn.y - 80;
  state.player.aimAngle = Math.atan2(state.player.aimY - level.spawn.y, state.player.aimX - level.spawn.x);
  state.guards = createGuards(level.guards);
  game.levelIndex = index;
  game.hintCooldown = 0;
  return state;
}

function startCampaign() {
  game.results = new Array(LEVELS.length).fill(null);
  game.lastStats = null;
  game.successNote = [];
  startMission(0);
}

function startMission(index) {
  prepareLevel(index);
  game.screen = SCREENS.INTRO;
  game.reason = '';
  game.failHint = '';
  game.lastStats = null;
  game.shake = 0;
  accumulator = 0;
  announce(`Mission ${index + 1}: ${state.level.name}. Press Space to deploy.`);
}

function beginMission() {
  game.screen = SCREENS.PLAY;
  accumulator = 0;
  announce(`Mission ${state.level.id} active. ${state.level.tip}`);
}

function retryLevel() {
  prepareLevel(game.levelIndex);
  game.screen = SCREENS.PLAY;
  game.lastStats = null;
  game.shake = 0;
  accumulator = 0;
  announce(`Mission ${state.level.id} restarted.`);
}

function completeLevel() {
  const level = state.level;
  const time = state.levelTime;
  const peak = Math.min(1, state.peakDetection);
  const rank = computeRank(time, peak, level.par);
  const result = {
    timeSeconds: time,
    timeLabel: formatClock(time),
    peak,
    peakLabel: `${Math.round(peak * 100)}%`,
    decoys: state.decoysUsed,
    rank,
    rankLabel: rankLabel(rank),
  };
  game.results[game.levelIndex] = result;
  game.lastStats = result;
  game.successNote = noteForRank(rank, level);
  game.rankColour = rankColour(rank);
  game.screen = SCREENS.SUCCESS;
  game.shake = 0;
  accumulator = 0;
  state.toast = null;
  addSparkles(state, state.player.x, state.player.y, PALETTE.exit, 30);
  announce(`Mission complete. Rank ${rank}. ${formatClock(time)}. Press Space.`);
}

function failLevel(reason, hint) {
  game.screen = SCREENS.FAILED;
  game.reason = reason;
  game.failHint = hint;
  game.shake = 1;
  accumulator = 0;
  state.toast = null;
  announce(`Mission failed. ${reason}. Press R to retry.`);
}

function finishCampaign() {
  const completed = game.results.filter(Boolean);
  const campaignBest = bestOf(completed.map((result) => result.rank));
  if (campaignBest && (RANK_ORDER[campaignBest] ?? 0) > (RANK_ORDER[game.bestRank] ?? 0)) {
    game.bestRank = campaignBest;
    saveBestRank(campaignBest);
  }
  game.screen = SCREENS.VICTORY;
  game.shake = 0;
  accumulator = 0;
  announce(`Campaign complete. Best rank ${game.bestRank || campaignBest || 'A'}. Press Space to run it again.`);
}

function nextAfterSuccess() {
  if (game.levelIndex + 1 < LEVELS.length) startMission(game.levelIndex + 1);
  else finishCampaign();
}

function summarizeCampaign() {
  const completed = game.results.filter(Boolean);
  const totalSeconds = completed.reduce((sum, result) => sum + result.timeSeconds, 0);
  const worstPeak = completed.reduce((worst, result) => Math.max(worst, result.peak), 0);
  const totalDecoys = completed.reduce((sum, result) => sum + result.decoys, 0);
  const ranks = LEVELS.map((level, index) => game.results[index]?.rank ?? '—');
  const labels = LEVELS.map((level, index) => game.results[index]?.rankLabel ?? 'UNPLAYED');
  return {
    totalTime: formatClock(totalSeconds),
    worstPeak: `${Math.round(worstPeak * 100)}%`,
    totalDecoys,
    ranks,
    rankLabels: labels,
    bestRank: bestOf(ranks.filter((rank) => rank !== '—')) || game.bestRank || '—',
  };
}

/* ---------------------------------------------------------------------------------------------
 * Input/state transitions
 * ------------------------------------------------------------------------------------------- */

function handleActions(actions) {
  if (game.shot) return;
  if (game.screen === SCREENS.TITLE) {
    if (actions & ACTION_CONFIRM) startCampaign();
    return;
  }
  if (game.screen === SCREENS.INTRO) {
    if (actions & ACTION_CONFIRM) beginMission();
    else if (actions & ACTION_PAUSE) game.screen = SCREENS.TITLE;
    return;
  }
  if (game.screen === SCREENS.PLAY) {
    if (actions & ACTION_PAUSE) {
      game.screen = SCREENS.PAUSED;
      announce('Paused. The patrols are frozen.');
    } else if (actions & ACTION_RESTART) {
      retryLevel();
    }
    return;
  }
  if (game.screen === SCREENS.PAUSED) {
    if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
      game.screen = SCREENS.PLAY;
      announce('Resumed.');
    } else if (actions & ACTION_RESTART) {
      retryLevel();
    }
    return;
  }
  if (game.screen === SCREENS.SUCCESS) {
    if (actions & ACTION_CONFIRM) nextAfterSuccess();
    else if (actions & ACTION_RESTART) retryLevel();
    return;
  }
  if (game.screen === SCREENS.FAILED) {
    if (actions & (ACTION_RESTART | ACTION_CONFIRM)) retryLevel();
    return;
  }
  if (game.screen === SCREENS.VICTORY) {
    if (actions & (ACTION_CONFIRM | ACTION_RESTART)) startCampaign();
  }
}

/** One fixed simulation step while the mission is live. */
function stepPlay(dt) {
  const player = state.player;
  const alarmBefore = state.alarm;

  updatePlayer(state, player, input.movement(), dt);
  updateGuards(state, state.guards, player, dt);
  updateEffects(state, dt);
  updateDetection(state, player, state.guards, dt);
  collectDataCores(state, player);

  if (state.alarm - alarmBefore > 0.05) game.shake = Math.max(game.shake, 0.3);
  if (game.hintCooldown > 0) game.hintCooldown = Math.max(0, game.hintCooldown - dt);

  let capturer = null;
  for (const guard of state.guards) if (guard.capturedPlayer) capturer = guard;
  if (capturer) {
    failLevel('AN OFFICER REACHED YOU', 'Break line of sight before an alert guard closes the distance.');
    return;
  }
  if (isFullyDetected(player)) {
    failLevel('DETECTION CRITICAL', 'Slip behind cover or into shadow and let the meter drain before it fills.');
    return;
  }

  if (!playerInExit(state, player)) return;
  const remaining = coresRemaining(state);
  if (remaining > 0) {
    if (game.hintCooldown <= 0) {
      showToast(state, `EXIT LOCKED — ${remaining} CORE${remaining === 1 ? '' : 'S'} REMAINING`, 'bad', 1.8);
      game.hintCooldown = 2.2;
    }
    return;
  }
  if (player.detection > WORLD.exitDetectionLimit) {
    if (game.hintCooldown <= 0) {
      showToast(state, 'EXIT JAMMED — BREAK LINE OF SIGHT', 'bad', 1.9);
      game.hintCooldown = 2.2;
    }
    return;
  }
  completeLevel();
}

/* ---------------------------------------------------------------------------------------------
 * Drawing and the frame
 * ------------------------------------------------------------------------------------------- */

function buildUiData() {
  const campaign = summarizeCampaign();
  const stats = game.lastStats ?? {
    timeLabel: '00:00',
    peakLabel: '0%',
    decoys: 0,
    rank: 'C',
    rankLabel: 'IN PROGRESS',
  };
  return {
    level: state.level,
    levelIndex: game.levelIndex,
    levelCount: LEVELS.length,
    stats: {
      time: stats.timeLabel,
      peak: stats.peakLabel,
      decoys: stats.decoys,
      rank: stats.rank,
      rankLabel: stats.rankLabel,
    },
    reason: game.reason,
    failHint: game.failHint,
    successNote: game.successNote,
    rankColour: game.rankColour,
    totalTime: campaign.totalTime,
    bestRank: campaign.bestRank,
    worstPeak: campaign.worstPeak,
    totalDecoys: campaign.totalDecoys,
    ranks: campaign.ranks,
    rankLabels: campaign.rankLabels,
    bestStored: game.bestRank,
  };
}

function renderFrame() {
  const time = game.shot ? game.shotTime : game.time + game.seedOffset;
  renderer.beginFrame(time, game.shot ? 0 : game.shake);
  renderer.drawWorld(state, state.player, state.guards, time);
  if (game.screen === SCREENS.PLAY || game.screen === SCREENS.PAUSED) {
    renderer.drawHud(state, state.player, time);
  }
  if (game.screen !== SCREENS.PLAY) {
    renderer.drawOverlay(game.screen, buildUiData(), time);
  }
  renderer.endFrame();
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const delta = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
  last = now;
  game.time += delta;

  // Clicks are only live during play; on a menu a click is a confirm, not a decoy.
  const clicks = input.takeClicks();
  const actions = input.takeActions();
  if (game.screen === SCREENS.PLAY) {
    for (const click of clicks) throwNoiseDecoy(state, state.player, click.x, click.y);
  }
  handleActions(actions);

  if (game.screen === SCREENS.PLAY) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= STEP && game.screen === SCREENS.PLAY && steps < MAX_STEPS) {
      stepPlay(STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps >= MAX_STEPS && accumulator > STEP) accumulator = 0;
  } else {
    accumulator = 0;
  }

  if (game.shake > 0) game.shake = Math.max(0, game.shake - delta * 1.8);
  renderFrame();
}

/* ---------------------------------------------------------------------------------------------
 * Screenshot scenes
 * ------------------------------------------------------------------------------------------- */

function stagePlayer(x, y, facing, options = {}) {
  const player = state.player;
  player.x = x;
  player.y = y;
  player.vx = 0;
  player.vy = 0;
  player.facing = facing;
  player.crouching = Boolean(options.crouch);
  player.sprinting = Boolean(options.sprint);
  player.stance = player.crouching ? 'crouch' : player.sprinting ? 'sprint' : 'walk';
  player.moving = Boolean(options.moving);
  player.speedNow = player.moving ? (player.sprinting ? PLAYER.sprintSpeed : player.crouching ? PLAYER.crouchSpeed : PLAYER.walkSpeed) : 0;
  player.inShadow = pointInShadow(state, x, y);
  player.hidden = options.hidden ?? (player.inShadow && !player.sprinting);
  player.seen = Boolean(options.seen);
  player.seenBy = player.seen ? 1 : 0;
  player.detection = options.detection ?? 0;
  player.displayDetection = player.detection;
  player.peakDetection = options.peak ?? player.detection;
  player.statusLabel = options.status ?? (player.seen ? 'SPOTTED' : player.hidden ? 'CONCEALED' : 'UNSEEN');
  player.noiseRadius = options.noise ?? (player.sprinting ? 212 : player.crouching ? 46 : 0);
  player.noiseLevel = Math.min(1, player.noiseRadius / 212);
  player.decoyCharges = options.decoys ?? PLAYER.decoyCharges;
  player.decoyCooldown = 0;
  player.sprintTrail = options.trail ?? [];
  player.aimX = options.aimX ?? x + 120;
  player.aimY = options.aimY ?? y - 60;
  player.aimAngle = Math.atan2(player.aimY - y, player.aimX - x);
}

function stageGuard(guard, x, y, facing, stateName, suspicion) {
  guard.x = x;
  guard.y = y;
  guard.facing = facing;
  guard.desiredFacing = facing;
  guard.state = stateName;
  guard.suspicion = suspicion;
  guard.currentFov = stateName === 'alert' ? GUARD.alertFov : guard.baseFov;
  guard.currentRange = stateName === 'alert' ? GUARD.alertRange : guard.baseRange;
  guard.seesPlayer = stateName !== 'patrol';
  guard.flash = stateName === 'alert' ? 1 : stateName === 'suspicious' ? 0.6 : 0;
  guard.alertTimer = stateName === 'alert' ? 2.6 : 0;
  guard.waitTimer = 0;
  guard.lastSeenX = state.player.x;
  guard.lastSeenY = state.player.y;
  guard.scanBase = facing;
  guard.distanceToPlayer = Math.hypot(state.player.x - x, state.player.y - y);
}

/** The attract/title backdrop: a live-looking slice of SERVER SPINE, frozen for the menu. */
function stageTitleScene() {
  stagePlayer(760, 528, -0.45, {
    detection: 0.28,
    status: 'TRACE COOLING',
    moving: true,
    noise: 116,
    aimX: 940,
    aimY: 320,
  });
  stageGuard(state.guards[0], 300, 110, 0.04, 'patrol', 0);
  stageGuard(state.guards[1], 900, 340, Math.atan2(528 - 340, 760 - 900), 'suspicious', 0.44);
  stageGuard(state.guards[2], 1180, 560, -Math.PI / 2, 'patrol', 0);
  addFootstepTrail(state, [
    { x: 826, y: 574 },
    { x: 804, y: 560 },
    { x: 784, y: 545 },
    { x: 770, y: 534 },
  ], false);
}

function stageShotPlay() {
  prepareLevel(1);
  stagePlayer(680, 430, 2.55, {
    crouch: true,
    detection: 0.58,
    peak: 0.63,
    seen: true,
    status: 'SPOTTED',
    aimX: 878,
    aimY: 300,
  });
  stageGuard(state.guards[0], 280, 110, 0.05, 'patrol', 0);
  stageGuard(state.guards[1], 900, 340, Math.atan2(430 - 340, 680 - 900), 'suspicious', 0.58);
  stageGuard(state.guards[2], 1180, 560, -Math.PI / 2, 'patrol', 0);
  addFootstepTrail(state, [
    { x: 522, y: 560 },
    { x: 550, y: 540 },
    { x: 578, y: 518 },
    { x: 608, y: 494 },
    { x: 640, y: 470 },
    { x: 662, y: 450 },
  ], false);
  state.alarm = 0.34;
  state.levelTime = 38.6;
  state.peakDetection = 0.63;
  state.decoysUsed = 1;
  game.screen = SCREENS.PLAY;
  game.shotTime = 4.3 + (seed % 5) * 0.07;
}

function stageShotAlert() {
  prepareLevel(2);
  stagePlayer(600, 592, -1.1, {
    sprint: true,
    moving: true,
    detection: 0.87,
    peak: 0.92,
    seen: true,
    status: 'HUNTED',
    aimX: 494,
    aimY: 648,
    trail: [
      { x: 626, y: 552, ttl: 0.3 },
      { x: 616, y: 568, ttl: 0.3 },
      { x: 608, y: 580, ttl: 0.3 },
    ],
  });
  stageGuard(state.guards[0], 900, 150, Math.PI, 'patrol', 0);
  stageGuard(state.guards[1], 640, 478, 1.93, 'alert', 0.9);
  stageGuard(state.guards[2], 1120, 180, Math.PI, 'patrol', 0);
  stageGuard(state.guards[3], 300, 650, 0, 'patrol', 0);
  addFootstepTrail(state, [
    { x: 632, y: 518 },
    { x: 622, y: 538 },
    { x: 614, y: 558 },
    { x: 606, y: 576 },
  ], true);
  state.alarm = 0.88;
  state.levelTime = 72.4;
  state.peakDetection = 0.92;
  state.decoysUsed = 2;
  state.toast = { text: 'SECTOR ALERT — BREAK LINE OF SIGHT', kind: 'bad', ttl: 1.15, max: 2.4 };
  game.screen = SCREENS.PLAY;
  game.shotTime = 4.6 + (seed % 5) * 0.07;
}

function stageShotSuccess() {
  prepareLevel(1);
  state.cores[0].collected = true;
  state.coresTaken = 1;
  stagePlayer(1178, 168, -Math.PI / 2, {
    detection: 0.04,
    peak: 0.64,
    status: 'UNSEEN',
    aimX: 1080,
    aimY: 250,
  });
  stageGuard(state.guards[0], 420, 110, 0, 'patrol', 0);
  stageGuard(state.guards[1], 700, 660, Math.PI, 'patrol', 0);
  stageGuard(state.guards[2], 1050, 420, Math.PI / 2, 'patrol', 0);
  addSparkles(state, 1178, 168, PALETTE.exit, 30);
  addSparkles(state, 1140, 150, PALETTE.core, 16);
  state.alarm = 0;
  state.levelTime = 61.2;
  state.peakDetection = 0.64;
  state.decoysUsed = 1;
  game.lastStats = {
    timeSeconds: 61.2,
    timeLabel: '01:01',
    peak: 0.64,
    peakLabel: '64%',
    decoys: 1,
    rank: 'A',
    rankLabel: rankLabel('A'),
  };
  game.results[1] = game.lastStats;
  game.rankColour = rankColour('A');
  game.successNote = noteForRank('A', state.level);
  game.screen = SCREENS.SUCCESS;
  game.shotTime = 5.0 + (seed % 5) * 0.07;
}

function stageShotStart() {
  prepareLevel(1);
  stageTitleScene();
  game.screen = SCREENS.TITLE;
  game.shotTime = 4.1 + (seed % 5) * 0.07;
}

function runShot(name) {
  game.shot = true;
  window.__shotReady = false;
  if (name === 'play') stageShotPlay();
  else if (name === 'alert' || name === 'tension') stageShotAlert();
  else if (name === 'success' || name === 'end') stageShotSuccess();
  else if (name === 'intro') {
    prepareLevel(0);
    game.screen = SCREENS.INTRO;
    game.shotTime = 4.1 + (seed % 5) * 0.07;
  } else stageShotStart();

  let painted = 0;
  function paint() {
    renderFrame();
    painted += 1;
    if (painted < 3) {
      requestAnimationFrame(paint);
    } else {
      window.__shotReady = true;
      document.body.dataset.shotReady = '1';
    }
  }
  requestAnimationFrame(paint);
}

/* ---------------------------------------------------------------------------------------------
 * Boot
 * ------------------------------------------------------------------------------------------- */

const input = createInput(canvas, (clientX, clientY) => renderer.screenToWorld(clientX, clientY));

// A tiny read-only handle for automated smoke tests and curious players. The game does not use it.
window.__shadowProtocol = { game, state, world };

// Leaving the tab pauses a live mission rather than letting a guard walk into an idle agent.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.screen === SCREENS.PLAY && !game.shot) {
    game.screen = SCREENS.PAUSED;
    announce('Paused.');
  }
});

if (shot) {
  runShot(shot);
} else {
  prepareLevel(1);
  stageTitleScene();
  game.screen = SCREENS.TITLE;
  game.levelIndex = 0;
  announce('Shadow Protocol. Press Space or click to deploy.');
  requestAnimationFrame((now) => {
    last = now;
    requestAnimationFrame(frame);
  });
}
