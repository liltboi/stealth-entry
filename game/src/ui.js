// The mission frames around the game: title, level briefing, pause, success, failure and the
// campaign-complete screen. These are drawn over the already-rendered facility, so the world and
// its cones stay visible behind the interface. No game state is changed here; ui.js is pure paint.

import { FIELD, FONT, MONO, PALETTE, SCREENS } from './config.js';

const rgbCache = new Map();
function rgba(hex, alpha) {
  let rgb = rgbCache.get(hex);
  if (!rgb) {
    const value = Number.parseInt(hex.slice(1), 16);
    rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    rgbCache.set(hex, rgb);
  }
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function font(context, size, weight = 500, mono = false) {
  context.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
}

function text(context, value, x, y, size, colour, align = 'left', weight = 500, mono = false) {
  font(context, size, weight, mono);
  context.fillStyle = colour;
  context.textAlign = align;
  context.fillText(value, x, y);
}

function tracked(context, value, x, y, size, colour, spacing, align = 'left', weight = 700, mono = false) {
  font(context, size, weight, mono);
  context.fillStyle = colour;
  context.textAlign = 'left';
  const chars = [...value];
  let width = 0;
  for (const char of chars) width += context.measureText(char).width + spacing;
  width -= spacing;
  let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  for (const char of chars) {
    context.fillText(char, cursor, y);
    cursor += context.measureText(char).width + spacing;
  }
}

function cutPath(context, x, y, w, h, cut) {
  context.beginPath();
  context.moveTo(x + cut, y);
  context.lineTo(x + w, y);
  context.lineTo(x + w, y + h - cut);
  context.lineTo(x + w - cut, y + h);
  context.lineTo(x, y + h);
  context.lineTo(x, y + cut);
  context.closePath();
}

function panel(context, x, y, w, h, accent, alpha = 0.82) {
  cutPath(context, x, y, w, h, 14);
  context.fillStyle = `rgba(4,10,19,${alpha})`;
  context.fill();
  context.strokeStyle = `${accent}66`;
  context.lineWidth = 1;
  context.stroke();
  context.strokeStyle = accent;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x + 14, y + 1);
  context.lineTo(x + w - 26, y + 1);
  context.stroke();
  context.strokeStyle = `${accent}55`;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 1, y + 14);
  context.lineTo(x + 1, y + h - 14);
  context.stroke();
}

function keycap(context, label, x, y) {
  font(context, 9, 700, true);
  const w = Math.max(30, context.measureText(label).width + 14);
  cutPath(context, x, y - 13, w, 19, 3);
  context.fillStyle = 'rgba(17,33,51,0.95)';
  context.fill();
  context.strokeStyle = 'rgba(90,150,185,0.65)';
  context.lineWidth = 1;
  context.stroke();
  text(context, label, x + w / 2, y, 9, PALETTE.text, 'center', 700, true);
  return w;
}

function prompt(context, message, x, y, time, colour = PALETTE.exit) {
  const pulse = 0.62 + 0.38 * Math.sin(time * 3.2);
  context.save();
  context.globalAlpha = pulse;
  text(context, message, x, y, 13, colour, 'center', 800, true);
  context.restore();
  // Small flanking chevrons.
  context.strokeStyle = `${colour}${Math.round(pulse * 170).toString(16).padStart(2, '0')}`;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x - 128, y - 10);
  context.lineTo(x - 120, y - 4);
  context.lineTo(x - 128, y + 2);
  context.moveTo(x + 128, y - 10);
  context.lineTo(x + 120, y - 4);
  context.lineTo(x + 128, y + 2);
  context.stroke();
}

function backdrop(context, strength = 0.68) {
  const gradient = context.createLinearGradient(0, 0, FIELD.width, 0);
  gradient.addColorStop(0, `rgba(3,7,14,${strength})`);
  gradient.addColorStop(0.55, `rgba(3,7,14,${strength * 0.76})`);
  gradient.addColorStop(1, 'rgba(3,7,14,0.18)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, FIELD.width, FIELD.height);
  const vertical = context.createLinearGradient(0, 0, 0, FIELD.height);
  vertical.addColorStop(0, 'rgba(3,7,14,0.32)');
  vertical.addColorStop(0.5, 'rgba(3,7,14,0)');
  vertical.addColorStop(1, 'rgba(3,7,14,0.52)');
  context.fillStyle = vertical;
  context.fillRect(0, 0, FIELD.width, FIELD.height);
}

function glitchTitle(context, value, x, y, size, time, align = 'left') {
  const jitter = Math.sin(time * 1.7) > 0.86 ? 2 : 0;
  text(context, value, x - 2 + jitter, y, size, 'rgba(255,59,96,0.34)', align, 900);
  text(context, value, x + 2 - jitter, y, size, 'rgba(56,232,255,0.3)', align, 900);
  text(context, value, x, y, size, PALETTE.text, align, 900);
}

function statBlock(context, label, value, x, y, colour = PALETTE.text) {
  text(context, label, x, y, 8, 'rgba(124,147,176,0.95)', 'left', 700, true);
  text(context, value, x, y + 24, 21, colour, 'left', 800, true);
}

function drawTitle(context, data, time) {
  backdrop(context, 0.78);

  // Oversized ghost mission code for depth behind the title.
  context.save();
  context.globalAlpha = 0.08;
  tracked(context, 'INFILTRATION', 84, 545, 72, '#2e7ea3', 4, 'left', 900, true);
  context.restore();

  const accent = PALETTE.patrol;
  context.fillStyle = rgba(accent, 0.9);
  context.fillRect(82, 132, 44, 3);
  tracked(context, 'MAKE.FUN // STEALTH OPERATION', 140, 138, 10, 'rgba(152,226,255,0.85)', 2.4, 'left', 700, true);

  glitchTitle(context, 'SHADOW', 78, 252, 96, time);
  glitchTitle(context, 'PROTOCOL', 78, 344, 96, time);
  tracked(context, 'A NEON-NOIR INFILTRATION GAME', 82, 378, 11, 'rgba(255,111,145,0.95)', 3.2, 'left', 700, true);

  text(context, 'Read the cones. Break the sight line. Vanish.', 84, 414, 16, 'rgba(212,231,247,0.9)', 'left', 400);

  // Controls plate.
  const px = 82;
  const py = 456;
  const pw = 520;
  const ph = 126;
  panel(context, px, py, pw, ph, accent, 0.78);
  tracked(context, 'FIELD CONTROLS', px + 20, py + 24, 8, rgba(accent, 0.9), 2, 'left', 700, true);
  const row1 = py + 50;
  let cursor = px + 20;
  cursor += keycap(context, 'WASD', cursor, row1) + 6;
  text(context, 'MOVE', cursor + 2, row1, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 52;
  cursor += keycap(context, 'SHIFT', cursor, row1) + 6;
  text(context, 'SPRINT', cursor + 2, row1, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 62;
  cursor += keycap(context, 'CTRL', cursor, row1) + 6;
  text(context, 'CROUCH', cursor + 2, row1, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);

  const row2 = py + 82;
  cursor = px + 20;
  cursor += keycap(context, 'LMB', cursor, row2) + 6;
  text(context, 'NOISE DECOY', cursor + 2, row2, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 112;
  cursor += keycap(context, 'P', cursor, row2) + 6;
  text(context, 'PAUSE', cursor + 2, row2, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 62;
  cursor += keycap(context, 'R', cursor, row2) + 6;
  text(context, 'RESTART', cursor + 2, row2, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);

  text(context, 'Dark floor conceals you. Neon does not.', px + 20, py + 108, 10, 'rgba(255,200,87,0.85)', 'left', 400);

  // Mission chips.
  const chips = ['03 MISSIONS', '02/03/04 OFFICERS', 'ONE WAY OUT'];
  let chipX = 82;
  for (const chip of chips) {
    font(context, 9, 700, true);
    const cw = context.measureText(chip).width + 22;
    cutPath(context, chipX, 604, cw, 24, 6);
    context.fillStyle = 'rgba(10,20,34,0.9)';
    context.fill();
    context.strokeStyle = 'rgba(56,232,255,0.35)';
    context.lineWidth = 1;
    context.stroke();
    text(context, chip, chipX + cw / 2, 620, 9, 'rgba(126,190,218,0.9)', 'center', 700, true);
    chipX += cw + 10;
  }

  prompt(context, 'PRESS SPACE OR CLICK TO DEPLOY', 380, 674, time, PALETTE.exit);

  // Right-hand telemetry so the composition is not empty on the far side.
  context.save();
  context.globalAlpha = 0.55;
  text(context, 'BUILD 2026.11', FIELD.width - 32, 44, 9, 'rgba(124,147,176,0.9)', 'right', 600, true);
  text(context, 'DRAND ANCHOR / VERIFIED', FIELD.width - 32, 60, 8, 'rgba(77,255,184,0.75)', 'right', 600, true);
  context.restore();
}

function drawIntro(context, data, time) {
  const accent = PALETTE.patrol;
  backdrop(context, 0.6);
  const level = data.level;
  const x = 72;
  const y = 96;
  const w = 604;
  const h = 520;
  panel(context, x, y, w, h, accent, 0.86);

  context.save();
  context.globalAlpha = 0.09;
  tracked(context, String(level.id).padStart(2, '0'), x + w - 34, y + 190, 190, accent, 0, 'right', 900, true);
  context.restore();

  tracked(context, `MISSION ${String(level.id).padStart(2, '0')} / 03`, x + 28, y + 42, 10, rgba(accent, 0.95), 2.6, 'left', 700, true);
  text(context, level.name, x + 28, y + 88, 44, PALETTE.text, 'left', 900);
  tracked(context, level.subtitle, x + 28, y + 112, 9, 'rgba(124,147,176,0.95)', 1.8, 'left', 600, true);

  context.strokeStyle = 'rgba(56,232,255,0.25)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 28, y + 136);
  context.lineTo(x + w - 28, y + 136);
  context.stroke();

  let lineY = y + 174;
  for (const line of level.briefing) {
    text(context, line, x + 28, lineY, 15, 'rgba(206,228,246,0.92)', 'left', 400);
    lineY += 27;
  }

  // Objective card.
  const oy = y + 244;
  cutPath(context, x + 28, oy, w - 56, 92, 8);
  context.fillStyle = 'rgba(9,23,37,0.9)';
  context.fill();
  context.strokeStyle = rgba(PALETTE.exit, 0.4);
  context.lineWidth = 1;
  context.stroke();
  tracked(context, 'OBJECTIVE', x + 46, oy + 24, 8, rgba(PALETTE.exit, 0.9), 2, 'left', 700, true);
  let objective;
  if (level.objective === 'core-exit') objective = 'RECOVER CORE-01  →  REACH THE EXTRACTION LIFT';
  else if (level.objective === 'cores-exit') objective = 'RECOVER CORE-01 + CORE-02  →  REACH THE WEST LIFT';
  else objective = 'REACH THE FREIGHT LIFT WITHOUT BEING DETECTED';
  text(context, objective, x + 46, oy + 52, 13, PALETTE.text, 'left', 700, true);
  text(context, `THREAT: ${level.guards.length} PATROLS   //   PAR ${level.par}s`, x + 46, oy + 74, 10, 'rgba(255,200,87,0.85)', 'left', 600, true);

  // Tip line.
  context.fillStyle = rgba(PALETTE.suspicious, 0.9);
  context.fillRect(x + 28, oy + 122, 3, 28);
  text(context, level.tip, x + 42, oy + 133, 12, 'rgba(212,231,247,0.92)', 'left', 400);
  text(context, 'TIP', x + 42, oy + 116, 8, rgba(PALETTE.suspicious, 0.85), 'left', 700, true);

  // Field legend: the three cone colours and the safe floor, explained while the mission loads.
  const legendY = y + 430;
  context.strokeStyle = 'rgba(56,232,255,0.18)';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 28, legendY - 18);
  context.lineTo(x + w - 28, legendY - 18);
  context.stroke();
  tracked(context, 'FIELD LEGEND', x + 28, legendY, 8, 'rgba(124,147,176,0.9)', 2, 'left', 700, true);
  const legend = [
    ['PATROL', PALETTE.patrol, x + 28],
    ['SUSPICIOUS', PALETTE.suspicious, x + 150],
    ['ALERT / CHASE', PALETTE.alert, x + 296],
  ];
  for (const [label, colour, lx] of legend) {
    context.fillStyle = rgba(colour, 0.22);
    context.beginPath();
    context.moveTo(lx + 10, legendY + 20);
    context.arc(lx + 10, legendY + 20, 14, -0.62, 0.62);
    context.closePath();
    context.fill();
    context.strokeStyle = rgba(colour, 0.8);
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = colour;
    context.beginPath();
    context.arc(lx + 10, legendY + 20, 2.6, 0, Math.PI * 2);
    context.fill();
    text(context, label, lx + 32, legendY + 23, 8, 'rgba(196,220,238,0.9)', 'left', 700, true);
  }
  cutPath(context, x + 474, legendY + 8, 30, 24, 3);
  context.fillStyle = 'rgba(2,6,13,0.95)';
  context.fill();
  context.strokeStyle = rgba(PALETTE.shadowEdge, 0.8);
  context.setLineDash([3, 3]);
  context.stroke();
  context.setLineDash([]);
  text(context, 'SHADOW = SAFE', x + 512, legendY + 23, 8, rgba('#68d3ff', 0.9), 'left', 700, true);

  prompt(context, 'PRESS SPACE TO DEPLOY', x + w / 2, y + h - 34, time, PALETTE.exit);
}

function drawPaused(context, data, time) {
  backdrop(context, 0.58);
  const w = 520;
  const h = 300;
  const x = (FIELD.width - w) / 2;
  const y = (FIELD.height - h) / 2 - 10;
  panel(context, x, y, w, h, PALETTE.suspicious, 0.9);
  tracked(context, 'OPERATION SUSPENDED', x + w / 2, y + 48, 9, rgba(PALETTE.suspicious, 0.9), 3, 'center', 700, true);
  text(context, 'PAUSED', x + w / 2, y + 104, 52, PALETTE.text, 'center', 900);
  text(context, 'The cones are frozen. Breathe.', x + w / 2, y + 138, 14, 'rgba(190,214,234,0.85)', 'center', 400);
  let cursor = x + 96;
  cursor += keycap(context, 'WASD', cursor, y + 184) + 8;
  text(context, 'MOVE', cursor + 2, y + 184, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 66;
  cursor += keycap(context, 'LMB', cursor, y + 184) + 8;
  text(context, 'DECOY', cursor + 2, y + 184, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 72;
  cursor += keycap(context, 'R', cursor, y + 184) + 8;
  text(context, 'RESTART', cursor + 2, y + 184, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  prompt(context, 'PRESS P TO RESUME', x + w / 2, y + h - 38, time, PALETTE.exit);
  void data;
}

function drawSuccess(context, data, time) {
  const level = data.level;
  const stats = data.stats;
  backdrop(context, 0.7);
  const x = 72;
  const y = 86;
  const w = 580;
  const h = 548;
  const accent = PALETTE.exit;
  panel(context, x, y, w, h, accent, 0.88);

  context.save();
  context.globalAlpha = 0.1;
  tracked(context, 'CLEAR', x + w - 24, y + 170, 128, accent, 2, 'right', 900, true);
  context.restore();

  tracked(context, `OPERATION CLEAR // MISSION ${String(level.id).padStart(2, '0')}`, x + 30, y + 44, 9, rgba(accent, 0.95), 2.2, 'left', 700, true);
  text(context, 'MISSION', x + 30, y + 96, 42, PALETTE.text, 'left', 900);
  text(context, 'COMPLETE', x + 30, y + 142, 42, accent, 'left', 900);
  text(context, `${level.name} EXTRACTED`, x + 30, y + 174, 13, 'rgba(188,230,216,0.9)', 'left', 700, true);

  context.strokeStyle = rgba(accent, 0.25);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(x + 30, y + 196);
  context.lineTo(x + w - 30, y + 196);
  context.stroke();

  statBlock(context, 'TIME', stats.time, x + 30, y + 234);
  statBlock(context, 'PEAK DETECTION', stats.peak, x + 200, y + 234, PALETTE.suspicious);
  statBlock(context, 'DECOYS USED', String(stats.decoys), x + 398, y + 234, PALETTE.noise);

  // Rank plate.
  const rankX = x + w - 158;
  const rankY = y + 292;
  cutPath(context, rankX, rankY, 128, 128, 12);
  context.fillStyle = rgba(data.rankColour ?? accent, 0.12);
  context.fill();
  context.strokeStyle = rgba(data.rankColour ?? accent, 0.85);
  context.lineWidth = 2;
  context.stroke();
  text(context, 'RANK', rankX + 64, rankY + 28, 9, 'rgba(180,220,235,0.8)', 'center', 700, true);
  text(context, stats.rank, rankX + 64, rankY + 96, 64, data.rankColour ?? accent, 'center', 900);
  text(context, data.stats.rankLabel, rankX + 64, rankY + 116, 7, 'rgba(180,220,235,0.75)', 'center', 600, true);

  text(context, 'FIELD NOTES', x + 30, y + 310, 8, 'rgba(124,147,176,0.9)', 'left', 700, true);
  const note = data.successNote;
  let noteY = y + 336;
  for (const line of note) {
    text(context, line, x + 30, noteY, 12, 'rgba(196,220,238,0.88)', 'left', 400);
    noteY += 21;
  }

  const nextLevel = data.levelIndex + 1 < data.levelCount;
  text(context, nextLevel ? 'NEXT MISSION UNLOCKED' : 'CAMPAIGN COMPLETE', x + 30, y + 444, 10, nextLevel ? rgba(PALETTE.exit, 0.9) : rgba(PALETTE.suspicious, 0.9), 'left', 700, true);
  prompt(context, nextLevel ? 'PRESS SPACE — NEXT MISSION' : 'PRESS SPACE — CAMPAIGN REPORT', x + w / 2, y + h - 36, time, accent);
}

function drawFailed(context, data, time) {
  backdrop(context, 0.7);
  const w = 600;
  const h = 400;
  const x = (FIELD.width - w) / 2;
  const y = (FIELD.height - h) / 2;
  const accent = PALETTE.alert;

  // Critical red wash.
  const red = context.createRadialGradient(FIELD.width / 2, FIELD.height / 2, 80, FIELD.width / 2, FIELD.height / 2, 700);
  red.addColorStop(0, 'rgba(255,59,96,0.04)');
  red.addColorStop(1, `rgba(255,59,96,${0.2 + 0.08 * Math.sin(time * 7)})`);
  context.fillStyle = red;
  context.fillRect(0, 0, FIELD.width, FIELD.height);

  panel(context, x, y, w, h, accent, 0.9);
  tracked(context, 'SIGNAL LOST // OPERATION BURNED', x + w / 2, y + 48, 9, rgba(accent, 0.95), 2.8, 'center', 700, true);
  text(context, 'MISSION', x + w / 2, y + 112, 46, 'rgba(230,210,220,0.9)', 'center', 900);
  text(context, 'FAILED', x + w / 2, y + 160, 52, accent, 'center', 900);

  text(context, data.reason, x + w / 2, y + 208, 16, PALETTE.text, 'center', 700);
  text(context, data.failHint, x + w / 2, y + 238, 12, 'rgba(190,214,234,0.85)', 'center', 400);

  const sx = x + 96;
  let cursor = sx;
  cursor += keycap(context, 'R', cursor, y + 288) + 8;
  text(context, 'RETRY MISSION', cursor + 2, y + 288, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);
  cursor += 140;
  cursor += keycap(context, 'SPACE', cursor, y + 288) + 8;
  text(context, 'RESTART', cursor + 2, y + 288, 9, 'rgba(200,222,240,0.8)', 'left', 600, true);

  prompt(context, 'PRESS R TO RETRY', x + w / 2, y + h - 42, time, accent);
}

function drawVictory(context, data, time) {
  backdrop(context, 0.72);
  const w = 700;
  const h = 480;
  const x = (FIELD.width - w) / 2;
  const y = (FIELD.height - h) / 2 - 8;
  const accent = PALETTE.exit;
  panel(context, x, y, w, h, accent, 0.9);

  context.save();
  context.globalAlpha = 0.09;
  tracked(context, '03/03', x + w - 28, y + 180, 150, accent, 0, 'right', 900, true);
  context.restore();

  tracked(context, 'SHADOW PROTOCOL // CAMPAIGN REPORT', x + 34, y + 46, 9, rgba(accent, 0.95), 2.4, 'left', 700, true);
  text(context, 'PROTOCOL', x + 34, y + 100, 44, PALETTE.text, 'left', 900);
  text(context, 'COMPLETE', x + 34, y + 146, 44, accent, 'left', 900);
  text(context, 'Three facilities. Three lifts. Nobody saw you leave.', x + 34, y + 178, 14, 'rgba(198,232,218,0.9)', 'left', 400);

  context.strokeStyle = rgba(accent, 0.25);
  context.beginPath();
  context.moveTo(x + 34, y + 200);
  context.lineTo(x + w - 34, y + 200);
  context.stroke();

  statBlock(context, 'TOTAL TIME', data.totalTime, x + 34, y + 238);
  statBlock(context, 'BEST RANK', data.bestRank, x + 224, y + 238, PALETTE.suspicious);
  statBlock(context, 'PEAK DETECTION', data.worstPeak, x + 400, y + 238, PALETTE.alert);
  statBlock(context, 'DECOYS THROWN', String(data.totalDecoys), x + 548, y + 238, PALETTE.noise);

  const medals = data.ranks;
  for (let i = 0; i < medals.length; i += 1) {
    const mx = x + 34 + i * 210;
    cutPath(context, mx, y + 294, 190, 70, 8);
    context.fillStyle = 'rgba(8,24,34,0.9)';
    context.fill();
    context.strokeStyle = 'rgba(77,255,184,0.35)';
    context.lineWidth = 1;
    context.stroke();
    text(context, `MISSION 0${i + 1}`, mx + 14, y + 317, 8, 'rgba(124,147,176,0.9)', 'left', 700, true);
    text(context, medals[i], mx + 14, y + 348, 22, accent, 'left', 900);
    text(context, data.rankLabels[i], mx + 176, y + 348, 7, 'rgba(160,200,215,0.7)', 'right', 600, true);
  }

  text(context, 'The city never saw the shadow move.', x + w / 2, y + 410, 12, 'rgba(180,215,230,0.8)', 'center', 400);
  prompt(context, 'PRESS SPACE TO RUN IT AGAIN', x + w / 2, y + h - 36, time, accent);
}

/** Routes one overlay screen to its painter. screen may be null for pure gameplay. */
export function drawScreen(context, screen, data, time) {
  if (!screen || screen === SCREENS.PLAY) return;
  if (screen === SCREENS.TITLE) drawTitle(context, data, time);
  else if (screen === SCREENS.INTRO) drawIntro(context, data, time);
  else if (screen === SCREENS.PAUSED) drawPaused(context, data, time);
  else if (screen === SCREENS.SUCCESS) drawSuccess(context, data, time);
  else if (screen === SCREENS.FAILED) drawFailed(context, data, time);
  else if (screen === SCREENS.VICTORY) drawVictory(context, data, time);
}
