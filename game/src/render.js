// All the drawing. The renderer owns the 1280x720 stage: it scales the playfield to the window,
// paints the neon-noir facility (floor grid, shadow patches, cover, exit, cores, vision cones,
// officers, the agent, HUD and screen effects), and hands the final overlay screens to ui.js.
// Nothing here changes the simulation — it only reads state and time.
//
// Vision cones are rebuilt every frame as ray-cast fans: each ray stops at the first solid, so a
// crate or vault wall visibly carves a wedge out of the light. That is the one drawing job that
// is also a rule, and it keeps what the judge sees identical to what the guards can see.

import { FIELD, FONT, MONO, PALETTE } from './config.js';
import { guardStateTint } from './guards.js';
import { coresRemaining, raycastSolid } from './world.js';
import { drawScreen } from './ui.js';

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash(n) {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

const colourCache = new Map();
function rgbOf(hex) {
  let rgb = colourCache.get(hex);
  if (!rgb) {
    const value = Number.parseInt(hex.slice(1), 16);
    rgb = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    colourCache.set(hex, rgb);
  }
  return rgb;
}

function rgba(hex, alpha) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundedPath(context, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function cutPanelPath(context, x, y, w, h, cut) {
  context.beginPath();
  context.moveTo(x + cut, y);
  context.lineTo(x + w, y);
  context.lineTo(x + w, y + h - cut);
  context.lineTo(x + w - cut, y + h);
  context.lineTo(x, y + h);
  context.lineTo(x, y + cut);
  context.closePath();
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d', { alpha: false });
  const view = { scale: 1, x: 0, y: 0, width: 0, height: 0 };

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    view.width = width;
    view.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }
  resize();
  window.addEventListener('resize', resize);

  function screenToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    const py = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
    return {
      x: (px - view.x) / view.scale,
      y: (py - view.y) / view.scale,
    };
  }

  function beginFrame(time, shake = 0) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const shakeX = shake ? Math.sin(time * 91) * shake * 7 : 0;
    const shakeY = shake ? Math.cos(time * 113) * shake * 5 : 0;
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX, view.y + shakeY);
    context.save();
    context.beginPath();
    context.rect(0, 0, FIELD.width, FIELD.height);
    context.clip();
    context.textBaseline = 'alphabetic';
  }

  function endFrame() {
    context.restore();
  }

  function setFont(size, weight = 400, mono = false) {
    context.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
  }

  function text(value, x, y, size, color, align = 'left', weight = 400, mono = false, alpha = 1) {
    context.globalAlpha = alpha;
    setFont(size, weight, mono);
    context.fillStyle = color;
    context.textAlign = align;
    context.fillText(value, x, y);
    context.globalAlpha = 1;
  }

  /** Letter-spaced text without loading a font: each glyph is placed by hand. */
  function trackedText(value, x, y, size, color, spacing, align = 'left', weight = 700, mono = false) {
    setFont(size, weight, mono);
    context.fillStyle = color;
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

  /* -------------------------------------------------------------------------------------------
   * Facility floor
   * ----------------------------------------------------------------------------------------- */

  function drawFloor(state, time) {
    const b = 26;
    context.fillStyle = PALETTE.floor;
    context.fillRect(0, 0, FIELD.width, FIELD.height);

    // Broad service panels break up the floor without competing with cover.
    context.fillStyle = rgba('#0e1a2e', 0.55);
    context.fillRect(b, b, FIELD.width - b * 2, FIELD.height - b * 2);

    // Fine grid and brighter major grid.
    context.strokeStyle = rgba(PALETTE.grid, 0.16);
    context.lineWidth = 1;
    context.beginPath();
    for (let x = b; x <= FIELD.width - b; x += 40) {
      context.moveTo(x, b);
      context.lineTo(x, FIELD.height - b);
    }
    for (let y = b; y <= FIELD.height - b; y += 40) {
      context.moveTo(b, y);
      context.lineTo(FIELD.width - b, y);
    }
    context.stroke();

    context.strokeStyle = rgba(PALETTE.grid, 0.28);
    context.beginPath();
    for (let x = b; x <= FIELD.width - b; x += 160) {
      context.moveTo(x, b);
      context.lineTo(x, FIELD.height - b);
    }
    for (let y = b; y <= FIELD.height - b; y += 160) {
      context.moveTo(b, y);
      context.lineTo(FIELD.width - b, y);
    }
    context.stroke();

    // Faint floor stencil: facility code and a directional sweep line.
    context.save();
    context.globalAlpha = 0.11;
    setFont(54, 800, true);
    context.fillStyle = '#16324a';
    context.textAlign = 'right';
    context.fillText(state.level.code, FIELD.width - 54, FIELD.height - 44);
    context.restore();

    // Cable conduit running along the south wall.
    context.strokeStyle = rgba('#1e4a66', 0.34);
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(b + 8, FIELD.height - 54);
    for (let x = b + 8; x < FIELD.width - b; x += 120) {
      context.lineTo(x + 60, FIELD.height - 54);
      context.lineTo(x + 80, FIELD.height - 58);
      context.lineTo(x + 120, FIELD.height - 58);
    }
    context.stroke();

    // Slow amber service lights blinking high on the walls.
    for (let i = 0; i < 8; i += 1) {
      const x = 100 + i * 150;
      const pulse = 0.28 + 0.22 * Math.sin(time * 1.4 + i * 0.9);
      context.fillStyle = rgba('#ffb45e', pulse);
      context.fillRect(x, b + 4, 18, 2);
    }
  }

  function drawShadows(state, time) {
    for (const shadow of state.shadows) {
      const { x, y, w, h } = shadow;
      context.save();
      roundedPath(context, x, y, w, h, 5);
      context.clip();
      const gradient = context.createLinearGradient(x, y, x, y + h);
      gradient.addColorStop(0, 'rgba(4,10,19,0.92)');
      gradient.addColorStop(0.5, 'rgba(2,6,13,0.95)');
      gradient.addColorStop(1, 'rgba(4,11,20,0.92)');
      context.fillStyle = gradient;
      context.fillRect(x, y, w, h);

      // Diagonal hatching marks the safe floor as an intentional zone, not a flat black hole.
      context.strokeStyle = rgba(PALETTE.shadowEdge, 0.15);
      context.lineWidth = 1;
      context.beginPath();
      for (let offset = -h; offset < w + h; offset += 15) {
        context.moveTo(x + offset, y + h);
        context.lineTo(x + offset + h, y);
      }
      context.stroke();

      // A slow scan line inside the dark tells the eye this floor is still part of the facility.
      const scanY = y + ((time * 16 + shadow.seed * 21) % (h + 20)) - 10;
      const scan = context.createLinearGradient(x, scanY - 12, x, scanY + 12);
      scan.addColorStop(0, rgba(PALETTE.shadowEdge, 0));
      scan.addColorStop(0.5, rgba(PALETTE.shadowEdge, 0.12));
      scan.addColorStop(1, rgba(PALETTE.shadowEdge, 0));
      context.fillStyle = scan;
      context.fillRect(x, scanY - 12, w, 24);
      context.restore();

      const pulse = 0.5 + 0.22 * Math.sin(time * 1.3 + shadow.seed);
      context.save();
      context.shadowColor = rgba(PALETTE.shadowEdge, 0.55);
      context.shadowBlur = 10;
      context.strokeStyle = rgba(PALETTE.shadowEdge, pulse);
      context.lineWidth = 1.4;
      context.setLineDash([7, 8]);
      context.lineDashOffset = -time * 7 - shadow.seed * 8;
      roundedPath(context, x + 0.5, y + 0.5, w - 1, h - 1, 5);
      context.stroke();
      context.restore();
      context.setLineDash([]);

      // Inner safety border and corner brackets.
      context.strokeStyle = rgba(PALETTE.shadowEdge, 0.2);
      context.lineWidth = 1;
      roundedPath(context, x + 5.5, y + 5.5, w - 11, h - 11, 3);
      context.stroke();

      context.strokeStyle = rgba('#68d3ff', 0.9);
      context.lineWidth = 1.6;
      const tick = 12;
      context.beginPath();
      context.moveTo(x, y + tick);
      context.lineTo(x, y);
      context.lineTo(x + tick, y);
      context.moveTo(x + w - tick, y);
      context.lineTo(x + w, y);
      context.lineTo(x + w, y + tick);
      context.moveTo(x, y + h - tick);
      context.lineTo(x, y + h);
      context.lineTo(x + tick, y + h);
      context.moveTo(x + w - tick, y + h);
      context.lineTo(x + w, y + h);
      context.lineTo(x + w, y + h - tick);
      context.stroke();

      if (w > 110) {
        context.save();
        context.globalAlpha = 0.95;
        context.strokeStyle = rgba('#68d3ff', 0.85);
        context.lineWidth = 1;
        context.beginPath();
        context.arc(x + 13, y + 17, 5, 0.15, Math.PI - 0.15);
        context.moveTo(x + 8, y + 17);
        context.lineTo(x + 18, y + 17);
        context.stroke();
        text('SHADOW // SAFE', x + 24, y + 20, 8, rgba('#68d3ff', 0.9), 'left', 700, true);
        context.restore();
      }
    }
  }

  function drawExitPad(state, time) {
    const exit = state.exit;
    const ready = coresRemaining(state) === 0;
    const tint = ready ? PALETTE.exit : '#8b96aa';
    const pulse = 0.5 + 0.3 * Math.sin(time * 2.4);

    context.save();
    const gradient = context.createLinearGradient(exit.x, exit.y, exit.x + exit.w, exit.y + exit.h);
    gradient.addColorStop(0, rgba(PALETTE.exit, ready ? 0.25 + pulse * 0.08 : 0.08));
    gradient.addColorStop(1, rgba(PALETTE.exitDeep, 0.5));
    context.fillStyle = gradient;
    context.fillRect(exit.x, exit.y, exit.w, exit.h);

    // Moving chevrons inside the pad, pointing to its centre.
    context.save();
    context.beginPath();
    context.rect(exit.x + 3, exit.y + 3, exit.w - 6, exit.h - 6);
    context.clip();
    context.strokeStyle = rgba(tint, ready ? 0.55 : 0.26);
    context.lineWidth = 2;
    const shift = (time * 22) % 24;
    for (let i = -1; i < 7; i += 1) {
      const cx = exit.x + 12 + i * 24 + shift;
      context.beginPath();
      context.moveTo(cx - 7, exit.y + 12);
      context.lineTo(cx, exit.y + 22);
      context.lineTo(cx - 7, exit.y + 32);
      context.moveTo(cx - 7, exit.y + exit.h - 32);
      context.lineTo(cx, exit.y + exit.h - 22);
      context.lineTo(cx - 7, exit.y + exit.h - 12);
      context.stroke();
    }
    context.restore();

    context.strokeStyle = rgba(tint, ready ? 0.95 : 0.5);
    context.lineWidth = 2;
    context.strokeRect(exit.x + 0.5, exit.y + 0.5, exit.w - 1, exit.h - 1);
    context.strokeStyle = rgba(tint, 0.35);
    context.lineWidth = 1;
    context.strokeRect(exit.x + 5.5, exit.y + 5.5, exit.w - 11, exit.h - 11);

    text(exit.label ?? 'EXIT', exit.x + exit.w / 2, exit.y + 27, 18, ready ? '#d9fff1' : '#aab4c4', 'center', 800, true);
    text('EXTRACTION', exit.x + exit.w / 2, exit.y + 39, 7, rgba(tint, 0.9), 'center', 600, true);

    const label = ready ? 'EXIT OPEN' : 'EXIT LOCKED';
    const colour = ready ? PALETTE.exit : PALETTE.locked;
    text(label, exit.x + exit.w / 2, exit.y + exit.h + 15, 9, rgba(colour, ready ? 0.95 : 0.85), 'center', 700, true);

    if (ready) {
      context.save();
      context.globalCompositeOperation = 'lighter';
      const beam = context.createLinearGradient(exit.x, exit.y + exit.h, exit.x, exit.y - 34);
      beam.addColorStop(0, rgba(PALETTE.exit, 0.2));
      beam.addColorStop(1, rgba(PALETTE.exit, 0));
      context.fillStyle = beam;
      context.fillRect(exit.x + 12, exit.y - 34, exit.w - 24, exit.h + 34);
      context.restore();
    }
    context.restore();
  }

  function drawCore(context2, core, time) {
    if (core.collected) {
      // Empty pedestal.
      context2.fillStyle = rgba('#1b3350', 0.7);
      context2.beginPath();
      context2.arc(core.x, core.y, 14, 0, TAU);
      context2.fill();
      context2.strokeStyle = rgba('#3c6b8f', 0.6);
      context2.lineWidth = 1;
      context2.stroke();
      return;
    }
    const bob = Math.sin(time * 2.1 + core.phase) * 3;
    const spin = time * 1.1 + core.phase;
    context2.save();
    context2.globalCompositeOperation = 'lighter';
    const glow = context2.createRadialGradient(core.x, core.y + bob, 2, core.x, core.y + bob, 58);
    glow.addColorStop(0, rgba(PALETTE.core, 0.55));
    glow.addColorStop(0.4, rgba(PALETTE.core, 0.16));
    glow.addColorStop(1, rgba(PALETTE.core, 0));
    context2.fillStyle = glow;
    context2.beginPath();
    context2.arc(core.x, core.y + bob, 58, 0, TAU);
    context2.fill();
    context2.restore();

    // Pedestal.
    context2.strokeStyle = rgba('#2b6580', 0.9);
    context2.lineWidth = 1.5;
    context2.beginPath();
    context2.arc(core.x, core.y + 12, 18, 0.1, Math.PI - 0.1);
    context2.stroke();
    context2.fillStyle = rgba('#0b1a2a', 0.9);
    context2.beginPath();
    context2.ellipse(core.x, core.y + 12, 15, 6, 0, 0, TAU);
    context2.fill();

    // Rotating diamond.
    context2.save();
    context2.translate(core.x, core.y + bob);
    context2.rotate(spin);
    const size = 13 + Math.sin(time * 3 + core.phase) * 1.5;
    context2.beginPath();
    context2.moveTo(0, -size);
    context2.lineTo(size * 0.72, 0);
    context2.lineTo(0, size);
    context2.lineTo(-size * 0.72, 0);
    context2.closePath();
    context2.fillStyle = rgba(PALETTE.coreHot, 0.9);
    context2.fill();
    context2.strokeStyle = '#ffffff';
    context2.lineWidth = 1.2;
    context2.stroke();
    context2.fillStyle = rgba(PALETTE.core, 0.8);
    context2.beginPath();
    context2.arc(0, 0, 4.5, 0, TAU);
    context2.fill();
    context2.restore();

    // Orbit ring and ticks.
    context2.strokeStyle = rgba(PALETTE.core, 0.5);
    context2.lineWidth = 1;
    context2.setLineDash([3, 6]);
    context2.beginPath();
    context2.arc(core.x, core.y + bob, 24, spin * 0.6, spin * 0.6 + TAU);
    context2.stroke();
    context2.setLineDash([]);
    context2.strokeStyle = rgba(PALETTE.core, 0.75);
    context2.beginPath();
    for (let i = 0; i < 4; i += 1) {
      const angle = spin * 0.6 + (i * Math.PI) / 2;
      context2.moveTo(core.x + Math.cos(angle) * 22, core.y + bob + Math.sin(angle) * 22);
      context2.lineTo(core.x + Math.cos(angle) * 27, core.y + bob + Math.sin(angle) * 27);
    }
    context2.stroke();

    text(core.label, core.x, core.y + 44, 8, rgba(PALETTE.core, 0.85), 'center', 700, true);
  }

  /* -------------------------------------------------------------------------------------------
   * Vision cones — fan of rays, each stopped by the first blocker
   * ----------------------------------------------------------------------------------------- */

  function coneColour(guard) {
    const tint = guardStateTint(guard);
    if (tint === 'alert') return PALETTE.alert;
    if (tint === 'suspicious') return PALETTE.suspicious;
    return PALETTE.patrol;
  }

  function drawVisionCones(state, guards, time) {
    for (const guard of guards) {
      const colour = coneColour(guard);
      const half = guard.currentFov / 2;
      const rays = 34;
      const points = [{ x: guard.x, y: guard.y }];
      for (let i = 0; i <= rays; i += 1) {
        const angle = guard.facing - half + (guard.currentFov * i) / rays;
        const reach = raycastSolid(state, guard.x, guard.y, angle, guard.currentRange);
        const distance = Math.max(0, reach - 0.8);
        points.push({ x: guard.x + Math.cos(angle) * distance, y: guard.y + Math.sin(angle) * distance });
      }

      context.save();
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
      context.closePath();

      const gradient = context.createRadialGradient(
        guard.x, guard.y, 10,
        guard.x, guard.y, Math.max(40, guard.currentRange),
      );
      const pulse = guard.state === 'alert' ? 0.06 * Math.sin(time * 10) : 0;
      gradient.addColorStop(0, rgba(colour, 0.4 + pulse));
      gradient.addColorStop(0.45, rgba(colour, 0.2 + pulse));
      gradient.addColorStop(1, rgba(colour, 0.045));
      context.fillStyle = gradient;
      context.fill();

      context.save();
      context.shadowColor = rgba(colour, 0.7);
      context.shadowBlur = guard.state === 'alert' ? 16 : 9;
      context.strokeStyle = rgba(colour, guard.state === 'alert' ? 0.9 : 0.62);
      context.lineWidth = guard.state === 'alert' ? 1.9 : 1.4;
      context.stroke();
      context.restore();

      // A brighter core beam, sweeping slowly inside the cone.
      if (guard.currentFov > 0.2) {
        const sweep = guard.facing + Math.sin(time * 1.35 + guard.scanPhase) * half * 0.62;
        const reach = raycastSolid(state, guard.x, guard.y, sweep, guard.currentRange) - 1;
        context.strokeStyle = rgba(colour, 0.28);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(guard.x, guard.y);
        context.lineTo(guard.x + Math.cos(sweep) * reach, guard.y + Math.sin(sweep) * reach);
        context.stroke();
      }
      context.restore();
    }
  }

  /* -------------------------------------------------------------------------------------------
   * Cover and walls
   * ----------------------------------------------------------------------------------------- */

  function drawBorderWall(solid) {
    const { x, y, w, h, side } = solid;
    context.fillStyle = PALETTE.wallDark;
    context.fillRect(x, y, w, h);
    context.strokeStyle = rgba(PALETTE.wallLight, 0.28);
    context.lineWidth = 1;

    if (side === 'top' || side === 'bottom') {
      const inner = side === 'top' ? y + h - 2 : y + 2;
      context.strokeStyle = rgba(PALETTE.patrol, 0.3);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x + 20, inner);
      context.lineTo(x + w - 20, inner);
      context.stroke();
      context.strokeStyle = rgba(PALETTE.wallLight, 0.2);
      context.lineWidth = 1;
      for (let px = x + 30; px < x + w - 30; px += 64) {
        context.strokeRect(px, y + 7, 20, 6);
      }
    } else {
      const inner = side === 'left' ? x + w - 2 : x + 2;
      context.strokeStyle = rgba(PALETTE.patrol, 0.24);
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(inner, y + 20);
      context.lineTo(inner, y + h - 20);
      context.stroke();
      context.strokeStyle = rgba(PALETTE.wallLight, 0.18);
      context.lineWidth = 1;
      for (let py = y + 30; py < y + h - 30; py += 64) {
        context.strokeRect(x + 7, py, 6, 20);
      }
    }
  }

  function drawCrate(solid, time) {
    const { x, y, w, h, id } = solid;
    context.fillStyle = 'rgba(0,0,0,0.42)';
    context.fillRect(x + 4, y + 5, w, h);
    context.fillStyle = PALETTE.crate;
    context.fillRect(x, y, w, h);
    context.strokeStyle = rgba(PALETTE.crateEdge, 0.9);
    context.lineWidth = 1.5;
    context.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);

    // Diagonal braces.
    context.strokeStyle = rgba(PALETTE.crateEdge, 0.26);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 5, y + 5);
    context.lineTo(x + w - 5, y + h - 5);
    context.moveTo(x + w - 5, y + 5);
    context.lineTo(x + 5, y + h - 5);
    context.stroke();

    // Neon strip and corner bolts.
    context.fillStyle = rgba('#7cd6ff', 0.55 + 0.2 * Math.sin(time * 1.6 + id));
    context.fillRect(x + 6, y + 5, Math.max(12, w - 12), 2);
    context.fillStyle = rgba('#0a1220', 0.9);
    const bolts = [[7, 7], [w - 11, 7], [7, h - 11], [w - 11, h - 11]];
    for (const [bx, by] of bolts) context.fillRect(x + bx, y + by, 4, 4);
    text('CARGO', x + w / 2, y + h / 2 + 3, 7, rgba(PALETTE.crateEdge, 0.55), 'center', 700, true);
  }

  function drawRack(solid, time) {
    const { x, y, w, h, id } = solid;
    context.fillStyle = 'rgba(0,0,0,0.42)';
    context.fillRect(x + 4, y + 5, w, h);
    context.fillStyle = '#13233b';
    context.fillRect(x, y, w, h);
    context.strokeStyle = rgba('#4a8bb8', 0.8);
    context.lineWidth = 1.5;
    context.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);

    // Server slots with blinking status LEDs.
    context.strokeStyle = rgba('#2e5d82', 0.55);
    context.lineWidth = 1;
    const horizontal = w >= h;
    const slots = Math.max(3, Math.floor((horizontal ? w : h) / 22));
    for (let i = 0; i < slots; i += 1) {
      if (horizontal) {
        const sx = x + 6 + i * ((w - 12) / slots);
        context.strokeRect(sx, y + 7, (w - 12) / slots - 3, h - 14);
        const on = Math.sin(time * 2.2 + id * 0.7 + i * 1.8) > 0.2;
        context.fillStyle = on ? rgba('#58e6ff', 0.85) : rgba('#2d4a63', 0.7);
        context.fillRect(sx + 2, y + h / 2, 3, 2);
      } else {
        const sy = y + 6 + i * ((h - 12) / slots);
        context.strokeRect(x + 7, sy, w - 14, (h - 12) / slots - 3);
        const on = Math.sin(time * 2.1 + id * 0.9 + i * 1.5) > 0.15;
        context.fillStyle = on ? rgba('#ff6e9d', 0.8) : rgba('#3d2b45', 0.7);
        context.fillRect(x + w - 10, sy + 3, 2, 3);
      }
    }
    context.fillStyle = rgba('#67c9f2', 0.5);
    context.fillRect(x + 4, y + 3, w - 8, 1.5);
    text('SRV', x + w / 2, y + h - 4, 6, rgba('#4a8bb8', 0.6), 'center', 700, true);
  }

  function drawPillar(solid, time) {
    const { x, y, w, h, id } = solid;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2;
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.beginPath();
    context.ellipse(cx + 4, cy + 5, radius, radius, 0, 0, TAU);
    context.fill();

    const gradient = context.createRadialGradient(cx - radius * 0.3, cy - radius * 0.35, 2, cx, cy, radius);
    gradient.addColorStop(0, '#27415f');
    gradient.addColorStop(1, '#0e1a2a');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(cx, cy, radius - 1, 0, TAU);
    context.fill();
    context.strokeStyle = rgba('#5b9ec5', 0.85);
    context.lineWidth = 1.5;
    context.stroke();
    context.strokeStyle = rgba('#7fd8ff', 0.5 + 0.2 * Math.sin(time * 1.9 + id));
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cx, cy, radius - 6, 0, TAU);
    context.stroke();
    context.fillStyle = rgba('#0b1220', 0.9);
    context.beginPath();
    context.arc(cx, cy, radius * 0.32, 0, TAU);
    context.fill();
  }

  function drawDesk(solid) {
    const { x, y, w, h } = solid;
    context.fillStyle = 'rgba(0,0,0,0.4)';
    context.fillRect(x + 4, y + 4, w, h);
    context.fillStyle = PALETTE.desk;
    roundedPath(context, x, y, w, h, 4);
    context.fill();
    context.strokeStyle = rgba('#3b6f9c', 0.7);
    context.lineWidth = 1.2;
    context.stroke();
    // Console screens.
    const screens = Math.max(1, Math.floor(w / 70));
    for (let i = 0; i < screens; i += 1) {
      const sx = x + 10 + i * ((w - 20) / screens);
      const sw = (w - 20) / screens - 8;
      context.fillStyle = rgba('#0a2438', 0.95);
      context.fillRect(sx, y + 8, sw, h - 16);
      context.strokeStyle = rgba('#3aa7c9', 0.65);
      context.lineWidth = 1;
      context.strokeRect(sx, y + 8, sw, h - 16);
      context.strokeStyle = rgba('#67e8ff', 0.35);
      context.beginPath();
      context.moveTo(sx + 4, y + h / 2);
      context.lineTo(sx + sw - 4, y + h / 2);
      context.stroke();
    }
    context.fillStyle = rgba('#3b6f9c', 0.6);
    context.fillRect(x + 6, y + 2, w - 12, 1.5);
  }

  function drawVaultWall(solid) {
    const { x, y, w, h } = solid;
    context.fillStyle = 'rgba(0,0,0,0.4)';
    context.fillRect(x + 3, y + 4, w, h);
    context.fillStyle = PALETTE.wallFace;
    context.fillRect(x, y, w, h);
    context.strokeStyle = rgba('#46749c', 0.9);
    context.lineWidth = 1.4;
    context.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    context.fillStyle = rgba('#6cb6df', 0.45);
    if (w > h) context.fillRect(x + 4, y + 2, w - 8, 2);
    else context.fillRect(x + 2, y + 4, 2, h - 8);
    context.strokeStyle = rgba('#2d5477', 0.5);
    context.lineWidth = 1;
    context.beginPath();
    if (w > h) {
      for (let px = x + 18; px < x + w - 8; px += 26) {
        context.moveTo(px, y + 5);
        context.lineTo(px, y + h - 5);
      }
    } else {
      for (let py = y + 18; py < y + h - 8; py += 26) {
        context.moveTo(x + 5, py);
        context.lineTo(x + w - 5, py);
      }
    }
    context.stroke();
  }

  function drawBarrier(solid) {
    const { x, y, w, h } = solid;
    context.save();
    context.fillStyle = '#121b2a';
    context.fillRect(x, y, w, h);
    context.beginPath();
    context.rect(x, y, w, h);
    context.clip();
    for (let offset = -h; offset < w; offset += 18) {
      context.fillStyle = rgba('#c9a227', 0.55);
      context.beginPath();
      context.moveTo(x + offset, y + h);
      context.lineTo(x + offset + 8, y + h);
      context.lineTo(x + offset + 8 + h, y);
      context.lineTo(x + offset + h, y);
      context.closePath();
      context.fill();
    }
    context.restore();
    context.strokeStyle = rgba('#e4c65c', 0.7);
    context.lineWidth = 1;
    context.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function drawCover(state, time) {
    for (const solid of state.solids) {
      if (solid.kind === 'border') drawBorderWall(solid);
      else if (solid.kind === 'crate') drawCrate(solid, time);
      else if (solid.kind === 'rack') drawRack(solid, time);
      else if (solid.kind === 'pillar') drawPillar(solid, time);
      else if (solid.kind === 'desk') drawDesk(solid);
      else if (solid.kind === 'barrier') drawBarrier(solid);
      else drawVaultWall(solid);
    }
  }

  /* -------------------------------------------------------------------------------------------
   * Floor traces: footsteps, decoys, sparks
   * ----------------------------------------------------------------------------------------- */

  function drawFootsteps(state) {
    for (const step of state.footsteps) {
      const life = step.ttl / step.max;
      const radius = 3 + (1 - life) * 8;
      const colour = step.loud ? PALETTE.suspicious : PALETTE.noise;
      context.strokeStyle = rgba(colour, life * (step.loud ? 0.55 : 0.26));
      context.lineWidth = step.loud ? 1.6 : 1;
      context.beginPath();
      context.ellipse(step.x, step.y, radius * 1.5, radius * 0.7, step.angle, 0, TAU);
      context.stroke();
    }
  }

  function drawDecoys(state, time) {
    for (const decoy of state.decoys) {
      const life = 1 - decoy.age / decoy.ttl;
      context.save();
      context.strokeStyle = rgba(PALETTE.noise, 0.12 * life);
      context.lineWidth = 1;
      context.setLineDash([4, 7]);
      context.beginPath();
      context.arc(decoy.x, decoy.y, decoy.radius, 0, TAU);
      context.stroke();
      context.setLineDash([]);

      for (let ring = 0; ring < 3; ring += 1) {
        const phase = ((time * 0.9 + ring / 3) % 1);
        const radius = 6 + phase * 46;
        context.strokeStyle = rgba(PALETTE.noise, (1 - phase) * 0.55 * life);
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(decoy.x, decoy.y, radius, 0, TAU);
        context.stroke();
      }
      context.fillStyle = rgba(PALETTE.noise, 0.85 * life);
      context.beginPath();
      context.arc(decoy.x, decoy.y, 3, 0, TAU);
      context.fill();
      context.restore();
    }
  }

  function drawSparkles(state) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (const spark of state.sparkles) {
      const alpha = clamp(spark.ttl / spark.max, 0, 1);
      context.fillStyle = rgba(spark.color, alpha * 0.9);
      context.fillRect(spark.x - spark.size / 2, spark.y - spark.size / 2, spark.size, spark.size);
    }
    context.restore();
  }

  /* -------------------------------------------------------------------------------------------
   * Agents
   * ----------------------------------------------------------------------------------------- */

  function drawGuard(guard, time) {
    const tint = guardStateTint(guard);
    const colour = PALETTE[tint === 'patrol' ? 'patrol' : tint];
    const pulse = 0.5 + 0.5 * Math.sin(time * 5 + guard.scanPhase);

    // Ground shadow.
    context.fillStyle = 'rgba(0,0,0,0.48)';
    context.beginPath();
    context.ellipse(guard.x + 3, guard.y + 7, 16, 9, 0, 0, TAU);
    context.fill();

    // A constant faint ring, then the state halo and suspicion arc.
    context.strokeStyle = rgba(colour, 0.16);
    context.lineWidth = 1;
    context.beginPath();
    context.arc(guard.x, guard.y, 19, 0, TAU);
    context.stroke();
    if (guard.state !== 'patrol') {
      context.strokeStyle = rgba(colour, 0.2 + pulse * 0.22);
      context.lineWidth = 2;
      context.beginPath();
      context.arc(guard.x, guard.y, 21 + pulse * 2, 0, TAU);
      context.stroke();
    }
    if (guard.suspicion > 0.03) {
      context.strokeStyle = rgba(colour, 0.85);
      context.lineWidth = 2;
      context.beginPath();
      context.arc(guard.x, guard.y, 19, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(guard.suspicion, 0, 1));
      context.stroke();
    }

    context.save();
    context.translate(guard.x, guard.y);
    context.rotate(guard.facing);

    // Shoulders and torso.
    context.fillStyle = '#3d1424';
    context.beginPath();
    context.ellipse(-1, -11, 6, 4.5, -0.25, 0, TAU);
    context.ellipse(-1, 11, 6, 4.5, 0.25, 0, TAU);
    context.fill();

    const body = context.createRadialGradient(-4, -5, 2, 0, 0, 15);
    body.addColorStop(0, '#71233d');
    body.addColorStop(1, '#2c0d18');
    context.fillStyle = body;
    context.beginPath();
    context.arc(0, 0, 13.5, 0, TAU);
    context.fill();
    context.strokeStyle = rgba(colour, 0.9);
    context.lineWidth = 1.8;
    context.stroke();

    // Armoured chest plate.
    context.fillStyle = rgba(colour, 0.26);
    context.beginPath();
    context.moveTo(-4, -6);
    context.lineTo(6, -4);
    context.lineTo(7, 4);
    context.lineTo(-4, 6);
    context.closePath();
    context.fill();

    // Head and visor point the way the cone points.
    context.fillStyle = PALETTE.guardFace;
    context.beginPath();
    context.arc(4, 0, 6.2, 0, TAU);
    context.fill();
    context.fillStyle = '#2a0e18';
    context.beginPath();
    context.arc(2.5, 0, 5.9, Math.PI * 0.62, Math.PI * 1.38);
    context.fill();
    context.strokeStyle = PALETTE.guard;
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(6, -3.5);
    context.lineTo(9.5, 0);
    context.lineTo(6, 3.5);
    context.stroke();

    // A tiny torch barrel ahead of the head.
    context.fillStyle = rgba(colour, 0.9);
    context.fillRect(11, -1.6, 5, 3.2);
    context.restore();

    // Exclamation / question state bubble.
    if (guard.state !== 'patrol' || guard.flash > 0.02) {
      const pop = 1 + guard.flash * 0.35 + Math.sin(time * 8 + guard.scanPhase) * 0.03;
      const bx = guard.x;
      const by = guard.y - 34;
      context.save();
      context.translate(bx, by);
      context.scale(pop, pop);
      context.fillStyle = 'rgba(5,9,16,0.92)';
      roundedPath(context, -10, -10, 20, 20, 3);
      context.fill();
      context.strokeStyle = rgba(colour, 0.95);
      context.lineWidth = 1.4;
      context.stroke();
      text(guard.state === 'alert' ? '!' : '?', 0, 6, 14, colour, 'center', 800, true);
      context.restore();
    }

    text(guard.name, guard.x, guard.y + 30, 7, rgba('#ffb3c7', 0.55), 'center', 600, true);
  }

  function drawPlayer(player, state, time) {
    // Sprint ghosts.
    for (const ghost of player.sprintTrail) {
      const alpha = (ghost.ttl / 0.3) * 0.28;
      context.fillStyle = rgba(PALETTE.playerGlow, alpha);
      context.beginPath();
      context.arc(ghost.x, ghost.y, player.radius, 0, TAU);
      context.fill();
    }

    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.beginPath();
    context.ellipse(player.x + 4, player.y + 8, 17, 10, 0, 0, TAU);
    context.fill();

    // A wide cold glow makes the agent legible on both dark floor and the bright exit pad.
    const glow = context.createRadialGradient(player.x, player.y, 2, player.x, player.y, 42);
    glow.addColorStop(0, rgba(PALETTE.playerGlow, player.hidden ? 0.24 : 0.45));
    glow.addColorStop(0.45, rgba(PALETTE.playerGlow, player.hidden ? 0.08 : 0.16));
    glow.addColorStop(1, rgba(PALETTE.playerGlow, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(player.x, player.y, 42, 0, TAU);
    context.fill();

    if (player.hidden) {
      context.strokeStyle = rgba(PALETTE.exit, 0.62 + 0.16 * Math.sin(time * 3));
      context.lineWidth = 1.4;
      context.setLineDash([4, 5]);
      context.beginPath();
      context.arc(player.x, player.y, 24, 0, TAU);
      context.stroke();
      context.setLineDash([]);
      text('CONCEALED', player.x, player.y - 30, 8, rgba(PALETTE.exit, 0.9), 'center', 800, true);
    } else {
      context.strokeStyle = rgba(PALETTE.playerGlow, 0.32);
      context.lineWidth = 1;
      context.setLineDash([2, 6]);
      context.beginPath();
      context.arc(player.x, player.y, 23, time * 0.7, time * 0.7 + TAU);
      context.stroke();
      context.setLineDash([]);
    }

    if (player.seen && player.detection > 0.15) {
      context.strokeStyle = rgba(PALETTE.alert, 0.38 + 0.24 * Math.sin(time * 12));
      context.lineWidth = 1.8;
      context.beginPath();
      context.arc(player.x, player.y, 22, 0, TAU);
      context.stroke();
    }

    context.save();
    context.translate(player.x, player.y);
    context.rotate(player.facing);
    const scale = player.crouching ? 0.86 : 1;
    context.scale(scale, scale);
    context.globalAlpha = player.hidden ? 0.9 : 1;

    // Cloak tails trail behind the facing direction.
    context.strokeStyle = rgba(PALETTE.playerGlow, 0.55);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-9, -5);
    context.quadraticCurveTo(-18, -8, -26 - Math.sin(time * 5) * 2, -10);
    context.moveTo(-9, 0);
    context.quadraticCurveTo(-20, 1, -28 - Math.cos(time * 4) * 2, 1);
    context.moveTo(-9, 5);
    context.quadraticCurveTo(-18, 8, -26 - Math.sin(time * 5 + 1) * 2, 10);
    context.stroke();

    // Dark silhouette with a white rim: readable over neon without glow blur.
    context.fillStyle = '#04121e';
    context.beginPath();
    context.moveTo(19, 0);
    context.lineTo(2, 13);
    context.lineTo(-14, 0);
    context.lineTo(2, -13);
    context.closePath();
    context.fill();
    context.strokeStyle = '#eaffff';
    context.lineWidth = 2.2;
    context.stroke();

    // Cyan-white body plate.
    const body = context.createLinearGradient(-10, -10, 14, 10);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.5, '#b9f4ff');
    body.addColorStop(1, '#2d9ddb');
    context.fillStyle = body;
    context.beginPath();
    context.moveTo(14, 0);
    context.lineTo(1, 9);
    context.lineTo(-9, 0);
    context.lineTo(1, -9);
    context.closePath();
    context.fill();
    context.strokeStyle = rgba('#046b8f', 0.9);
    context.lineWidth = 1;
    context.stroke();

    // Head and visor: the agent reads as a figure, not a cursor.
    context.fillStyle = '#f3feff';
    context.beginPath();
    context.arc(6, 0, 5.4, 0, TAU);
    context.fill();
    context.strokeStyle = '#0b4b66';
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = '#0b5f86';
    context.beginPath();
    context.arc(6.5, 0, 3.2, Math.PI * 0.6, Math.PI * 1.4);
    context.fill();
    context.fillStyle = '#ffffff';
    context.fillRect(8.6, -2.2, 1.8, 4.4);

    // Chest core.
    context.fillStyle = '#0b5f86';
    context.beginPath();
    context.arc(-2, 0, 3.2, 0, TAU);
    context.fill();
    context.fillStyle = rgba('#8ff4ff', 0.95);
    context.beginPath();
    context.arc(-2, 0, 1.5, 0, TAU);
    context.fill();

    // Shoulder fins.
    context.strokeStyle = rgba('#a8f2ff', 0.85);
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(-2, -10);
    context.lineTo(-8, -16);
    context.moveTo(-2, 10);
    context.lineTo(-8, 16);
    context.stroke();
    context.restore();

    // Crouch stance underline and a small callsign so the agent is never confused with cover.
    if (player.crouching) {
      context.strokeStyle = rgba(PALETTE.playerGlow, 0.65);
      context.lineWidth = 1.4;
      context.beginPath();
      context.moveTo(player.x - 10, player.y + 21);
      context.lineTo(player.x + 10, player.y + 21);
      context.stroke();
    }
    const inExitPad = state &&
      player.x > state.exit.x - 4 && player.x < state.exit.x + state.exit.w + 4 &&
      player.y > state.exit.y - 4 && player.y < state.exit.y + state.exit.h + 4;
    if (!inExitPad) {
      text(player.hidden ? 'GHOST' : 'AGENT', player.x, player.y + 33, 7, rgba(PALETTE.playerGlow, 0.62), 'center', 700, true);
    }

    // Mouse reticle.
    if (Number.isFinite(player.aimX) && Number.isFinite(player.aimY)) {
      const ready = player.decoyCooldown <= 0 && player.decoyCharges > 0;
      const colour = ready ? PALETTE.noise : PALETTE.muted;
      context.strokeStyle = rgba(colour, ready ? 0.55 : 0.25);
      context.lineWidth = 1;
      context.beginPath();
      context.arc(player.aimX, player.aimY, 7, 0, TAU);
      context.moveTo(player.aimX - 12, player.aimY);
      context.lineTo(player.aimX - 4, player.aimY);
      context.moveTo(player.aimX + 4, player.aimY);
      context.lineTo(player.aimX + 12, player.aimY);
      context.moveTo(player.aimX, player.aimY - 12);
      context.lineTo(player.aimX, player.aimY - 4);
      context.moveTo(player.aimX, player.aimY + 4);
      context.lineTo(player.aimX, player.aimY + 12);
      context.stroke();
      context.fillStyle = rgba(colour, 0.7);
      context.fillRect(player.aimX - 1, player.aimY - 1, 2, 2);
    }
  }

  function drawAmbientDust(time) {
    context.save();
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 30; i += 1) {
      const baseX = hash(i * 4.3) * FIELD.width;
      const baseY = hash(i * 9.1 + 2) * FIELD.height;
      const driftX = Math.sin(time * 0.32 + i * 1.7) * 12;
      const driftY = Math.cos(time * 0.24 + i * 2.3) * 9;
      const alpha = 0.025 + 0.045 * (0.5 + 0.5 * Math.sin(time * 0.8 + i));
      context.fillStyle = rgba('#8fd9ff', alpha);
      context.fillRect(baseX + driftX, baseY + driftY, 1.5, 1.5);
    }
    context.restore();
  }

  function drawVignette(state, player, time) {
    const vignette = context.createRadialGradient(
      FIELD.width / 2, FIELD.height / 2, 190,
      FIELD.width / 2, FIELD.height / 2, 760,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.62, 'rgba(0,0,0,0.18)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, FIELD.width, FIELD.height);

    const alarm = state.alarm;
    if (alarm > 0.02) {
      const pulse = 0.68 + 0.32 * Math.sin(time * 6.4);
      const red = context.createRadialGradient(
        FIELD.width / 2, FIELD.height / 2, 270,
        FIELD.width / 2, FIELD.height / 2, 760,
      );
      red.addColorStop(0, 'rgba(255,30,70,0)');
      red.addColorStop(0.72, rgba(PALETTE.alert, alarm * 0.06 * pulse));
      red.addColorStop(1, rgba(PALETTE.alert, alarm * 0.42 * pulse));
      context.fillStyle = red;
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }

    if (player && player.detection > 0.82) {
      const critical = (player.detection - 0.82) / 0.18;
      context.strokeStyle = rgba(PALETTE.alert, critical * (0.25 + 0.2 * Math.sin(time * 14)));
      context.lineWidth = 10;
      context.strokeRect(5, 5, FIELD.width - 10, FIELD.height - 10);
    }
  }

  /* -------------------------------------------------------------------------------------------
   * HUD
   * ----------------------------------------------------------------------------------------- */

  function panel(x, y, w, h, accent) {
    cutPanelPath(context, x, y, w, h, 10);
    context.fillStyle = 'rgba(6,13,24,0.78)';
    context.fill();
    context.strokeStyle = rgba(PALETTE.panelEdge, 0.55);
    context.lineWidth = 1;
    context.stroke();
    context.strokeStyle = rgba(accent, 0.75);
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x + 10, y + 1);
    context.lineTo(x + w - 18, y + 1);
    context.stroke();
    context.strokeStyle = rgba(accent, 0.3);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x + 1, y + 10);
    context.lineTo(x + 1, y + h - 10);
    context.stroke();
  }

  function drawEyeIcon(x, y, open, colour) {
    context.strokeStyle = colour;
    context.lineWidth = 1.4;
    context.beginPath();
    if (open) {
      context.ellipse(x, y, 10, 6, 0, 0, TAU);
      context.stroke();
      context.fillStyle = colour;
      context.beginPath();
      context.arc(x, y, 2.6, 0, TAU);
      context.fill();
    } else {
      context.moveTo(x - 10, y + 5);
      context.quadraticCurveTo(x, y - 8, x + 10, y + 5);
      context.stroke();
      context.beginPath();
      context.moveTo(x - 11, y - 7);
      context.lineTo(x + 11, y + 7);
      context.stroke();
    }
  }

  function drawCoreIcon(x, y, size, colour, filled) {
    context.save();
    context.translate(x, y);
    context.rotate(Math.PI / 4);
    context.fillStyle = filled ? rgba(colour, 0.85) : 'transparent';
    context.strokeStyle = colour;
    context.lineWidth = 1.2;
    context.fillRect(-size / 2, -size / 2, size, size);
    context.strokeRect(-size / 2, -size / 2, size, size);
    context.restore();
  }

  function drawMissionPanel(state) {
    const x = 18;
    const y = 14;
    const w = 338;
    const h = 78;
    panel(x, y, w, h, PALETTE.patrol);
    text(`MISSION ${String(state.levelIndex + 1).padStart(2, '0')} / 03`, x + 16, y + 21, 8, rgba(PALETTE.patrol, 0.85), 'left', 700, true);
    text(state.level.name, x + 16, y + 42, 20, PALETTE.text, 'left', 800);

    const objectiveY = y + 62;
    const remaining = coresRemaining(state);
    if (state.cores.length > 0) {
      drawCoreIcon(x + 22, objectiveY - 4, 9, remaining > 0 ? PALETTE.core : PALETTE.exit, remaining === 0);
      text(`CORES ${state.coresTaken}/${state.cores.length}`, x + 34, objectiveY, 9, remaining > 0 ? PALETTE.core : PALETTE.exit, 'left', 700, true);
      drawCoreIcon(x + 118, objectiveY - 4, 9, remaining === 0 ? PALETTE.exit : PALETTE.muted, false);
      text(remaining === 0 ? 'EXFIL OPEN' : 'EXIT LOCKED', x + 130, objectiveY, 9, remaining === 0 ? PALETTE.exit : PALETTE.muted, 'left', 700, true);
    } else {
      drawCoreIcon(x + 22, objectiveY - 4, 9, PALETTE.exit, false);
      text('REACH THE LIFT UNSEEN', x + 34, objectiveY, 9, PALETTE.exit, 'left', 700, true);
    }
  }

  function drawDetectionPanel(state, player, time) {
    const x = 374;
    const y = 14;
    const w = 420;
    const h = 78;
    const tint = player.detection > 0.66 ? PALETTE.alert : player.detection > 0.26 ? PALETTE.suspicious : PALETTE.patrol;
    panel(x, y, w, h, tint);
    drawEyeIcon(x + 27, y + 30, !player.hidden, rgba(tint, 0.95));
    text('DETECTION', x + 48, y + 22, 8, rgba(tint, 0.9), 'left', 700, true);

    const barX = x + 48;
    const barY = y + 30;
    const barW = 250;
    const barH = 10;
    context.fillStyle = 'rgba(2,7,14,0.9)';
    context.fillRect(barX, barY, barW, barH);
    context.strokeStyle = rgba(PALETTE.panelEdge, 0.6);
    context.lineWidth = 1;
    context.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);

    const segments = 24;
    const gap = 2;
    const segW = (barW - 4 - gap * (segments - 1)) / segments;
    const lit = player.displayDetection * segments;
    for (let i = 0; i < segments; i += 1) {
      const sx = barX + 2 + i * (segW + gap);
      const fill = clamp(lit - i, 0, 1);
      const segmentTint = i / segments > 0.66 ? PALETTE.alert : i / segments > 0.26 ? PALETTE.suspicious : PALETTE.patrol;
      context.fillStyle = fill > 0 ? rgba(segmentTint, 0.35 + fill * 0.6) : 'rgba(22,42,62,0.55)';
      context.fillRect(sx, barY + 2, segW, barH - 4);
    }

    const status = player.statusLabel;
    const statusColour = status === 'HUNTED' ? PALETTE.alert : status === 'SPOTTED' ? PALETTE.suspicious : status === 'CONCEALED' ? PALETTE.exit : PALETTE.muted;
    text(status, x + 310, y + 39, 11, statusColour, 'left', 800, true);
    text(`${Math.round(player.displayDetection * 100)}%`, x + w - 16, y + 39, 12, rgba(tint, 0.95), 'right', 700, true);

    // Alarm line.
    text('ALARM', x + 48, y + 62, 7, rgba(PALETTE.muted, 0.9), 'left', 700, true);
    const alarmX = x + 92;
    const alarmW = 206;
    context.fillStyle = 'rgba(2,7,14,0.9)';
    context.fillRect(alarmX, y + 56, alarmW, 5);
    context.fillStyle = rgba(state.alarm > 0.55 ? PALETTE.alert : PALETTE.suspicious, 0.85);
    context.fillRect(alarmX, y + 56, alarmW * state.alarm, 5);
    context.strokeStyle = rgba(PALETTE.panelEdge, 0.5);
    context.strokeRect(alarmX + 0.5, y + 56.5, alarmW - 1, 4);
    if (state.alarm > 0.55) {
      context.fillStyle = rgba(PALETTE.alert, 0.5 + 0.4 * Math.sin(time * 9));
      context.fillRect(x + 310, y + 54, 8, 8);
    }
  }

  function drawDecoyPanel(state, player) {
    const x = 812;
    const y = 14;
    const w = 450;
    const h = 78;
    panel(x, y, w, h, PALETTE.noise);
    text('NOISE DECOY', x + 16, y + 22, 8, rgba(PALETTE.noise, 0.9), 'left', 700, true);
    for (let i = 0; i < 3; i += 1) {
      const cx = x + 26 + i * 27;
      const cy = y + 42;
      const available = i < player.decoyCharges;
      context.fillStyle = available ? rgba(PALETTE.noise, 0.85) : 'rgba(30,52,70,0.8)';
      context.beginPath();
      context.moveTo(cx, cy - 8);
      context.lineTo(cx + 8, cy + 7);
      context.lineTo(cx - 8, cy + 7);
      context.closePath();
      context.fill();
      context.strokeStyle = available ? PALETTE.noise : rgba(PALETTE.panelEdge, 0.6);
      context.lineWidth = 1;
      context.stroke();
    }
    if (player.decoyCooldown > 0) {
      text(`RECHARGE ${player.decoyCooldown.toFixed(1)}s`, x + 112, y + 47, 8, rgba(PALETTE.suspicious, 0.9), 'left', 700, true);
    } else {
      text('LMB THROW', x + 112, y + 47, 8, rgba(PALETTE.noise, 0.75), 'left', 700, true);
    }

    const exitReady = coresRemaining(state) === 0;
    text('EXFIL', x + 236, y + 22, 8, rgba(PALETTE.muted, 0.9), 'left', 700, true);
    context.fillStyle = exitReady ? rgba(PALETTE.exit, 0.16) : rgba(PALETTE.locked, 0.12);
    context.fillRect(x + 236, y + 29, 92, 20);
    context.strokeStyle = exitReady ? rgba(PALETTE.exit, 0.8) : rgba(PALETTE.locked, 0.7);
    context.lineWidth = 1;
    context.strokeRect(x + 236.5, y + 29.5, 91, 19);
    text(exitReady ? 'OPEN' : 'LOCKED', x + 282, y + 44, 10, exitReady ? PALETTE.exit : PALETTE.locked, 'center', 800, true);

    text('ELAPSED', x + 354, y + 22, 8, rgba(PALETTE.muted, 0.9), 'left', 700, true);
    text(formatTime(state.levelTime), x + 354, y + 45, 18, PALETTE.text, 'left', 700, true);
    text(`LVL ${state.levelIndex + 1}/3`, x + 354, y + 62, 7, rgba(PALETTE.patrol, 0.7), 'left', 700, true);
  }

  function drawStancePanel(player) {
    const x = 18;
    const y = 626;
    const w = 262;
    const h = 76;
    panel(x, y, w, h, player.hidden ? PALETTE.exit : PALETTE.noise);
    text('STANCE', x + 16, y + 20, 8, rgba(PALETTE.muted, 0.9), 'left', 700, true);
    const stance = player.crouching ? 'CROUCH' : player.sprinting ? 'SPRINT' : 'WALK';
    text(stance, x + 16, y + 40, 15, PALETTE.text, 'left', 800, true);

    text('NOISE', x + 16, y + 58, 7, rgba(PALETTE.muted, 0.9), 'left', 700, true);
    for (let i = 0; i < 5; i += 1) {
      const filled = player.noiseLevel * 5 > i;
      context.fillStyle = filled ? rgba(i > 3 ? PALETTE.alert : PALETTE.suspicious, 0.85) : 'rgba(26,46,64,0.7)';
      context.fillRect(x + 62 + i * 14, y + 52, 10, 8);
    }

    const hidden = player.hidden;
    text(hidden ? 'CONCEALED' : player.seen ? 'EXPOSED' : 'UNDETECTED', x + w - 16, y + 40, 9, hidden ? PALETTE.exit : player.seen ? PALETTE.alert : rgba(PALETTE.muted, 0.8), 'right', 800, true);
    context.fillStyle = hidden ? rgba(PALETTE.exit, 0.5) : player.seen ? rgba(PALETTE.alert, 0.6) : rgba(PALETTE.panelEdge, 0.5);
    context.beginPath();
    context.arc(x + w - 20, y + 60, 3, 0, TAU);
    context.fill();
  }

  function drawCampaignPanel(state) {
    const x = 1000;
    const y = 638;
    const w = 262;
    const h = 64;
    panel(x, y, w, h, PALETTE.patrol);
    text('CAMPAIGN', x + 16, y + 20, 8, rgba(PALETTE.muted, 0.9), 'left', 700, true);
    for (let i = 0; i < 3; i += 1) {
      const active = i === state.levelIndex;
      const done = i < state.levelIndex;
      context.fillStyle = active ? rgba(PALETTE.patrol, 0.9) : done ? rgba(PALETTE.exit, 0.7) : 'rgba(37,64,88,0.7)';
      context.fillRect(x + 16 + i * 30, y + 26, 22, 4);
      text(`0${i + 1}`, x + 16 + i * 30, y + 46, 8, active ? PALETTE.text : rgba(PALETTE.muted, 0.7), 'left', 700, true);
    }
    text('SHADOW PROTOCOL', x + w - 16, y + 20, 8, rgba(PALETTE.patrol, 0.55), 'right', 700, true);
    text('WASD MOVE  SHIFT SPRINT  CTRL CROUCH', x + w - 16, y + 44, 7, rgba(PALETTE.muted, 0.85), 'right', 500, true);
    text('P PAUSE   R RESTART   LMB DECOY', x + w - 16, y + 56, 7, rgba(PALETTE.muted, 0.85), 'right', 500, true);
  }

  function drawToast(state, time) {
    if (!state.toast) return;
    const toast = state.toast;
    const alpha = clamp(Math.min(1, toast.ttl / 0.35), 0, 1);
    const colour = toast.kind === 'good' ? PALETTE.exit : toast.kind === 'bad' ? PALETTE.alert : PALETTE.noise;
    context.save();
    context.globalAlpha = alpha;
    setFont(11, 700, true);
    const width = Math.max(240, context.measureText(toast.text).width + 44);
    const x = FIELD.width / 2 - width / 2;
    const y = 528;
    cutPanelPath(context, x, y, width, 32, 7);
    context.fillStyle = 'rgba(4,10,18,0.9)';
    context.fill();
    context.strokeStyle = rgba(colour, 0.8);
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = rgba(colour, 0.9);
    context.fillRect(x + 12, y + 14.5, 3, 3);
    context.fillRect(x + width - 15, y + 14.5, 3, 3);
    text(toast.text, FIELD.width / 2, y + 21, 10, colour, 'center', 700, true);
    context.restore();
    void time;
  }

  function drawHud(state, player, time) {
    if (!player) return;
    drawMissionPanel(state);
    drawDetectionPanel(state, player, time);
    drawDecoyPanel(state, player);
    drawStancePanel(player);
    drawCampaignPanel(state);
    drawToast(state, time);
  }

  /* -------------------------------------------------------------------------------------------
   * Public frame composition
   * ----------------------------------------------------------------------------------------- */

  function drawWorld(state, player, guards, time) {
    drawFloor(state, time);
    drawShadows(state, time);
    drawExitPad(state, time);
    for (const core of state.cores) drawCore(context, core, time);
    drawVisionCones(state, guards, time);
    drawFootsteps(state);
    drawDecoys(state, time);
    drawCover(state, time);
    for (const guard of guards) drawGuard(guard, time);
    if (player) drawPlayer(player, state, time);
    drawSparkles(state);
    drawAmbientDust(time);
    drawVignette(state, player, time);
  }

  function drawOverlay(screen, data, time) {
    drawScreen(context, screen, data, time);
  }

  return { beginFrame, endFrame, drawWorld, drawHud, drawOverlay, screenToWorld, resize, view };
}
