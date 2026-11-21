// Every tuning number and colour for Shadow Protocol lives here. The playfield is a fixed
// 1280x720 logical area; the renderer scales it to the window, so no rule depends on screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** Screens the game can be on. Kept here so every module can name them without importing each other. */
export const SCREENS = {
  TITLE: 'title',
  INTRO: 'intro',
  PLAY: 'play',
  PAUSED: 'paused',
  SUCCESS: 'success',
  FAILED: 'failed',
  VICTORY: 'victory',
};

export const PLAYER = {
  radius: 12,
  walkSpeed: 182,
  sprintSpeed: 292,
  crouchSpeed: 104,
  acceleration: 14,
  decoyCharges: 3,
  decoyCooldown: 4.5,
  decoyRange: 360,
  decoyLife: 3.4,
  decoyRadius: 245,
  corePickupRange: 30,
};

export const GUARD = {
  radius: 14,
  patrolSpeed: 63,
  investigateSpeed: 92,
  chaseSpeed: 166,
  fov: 1.62,
  alertFov: 2.0,
  range: 286,
  alertRange: 330,
  turnSpeed: 5.2,
  closeSenseRange: 92,
  captureRange: 30,
  waypointWait: 0.55,
};

export const DETECTION = {
  gainBase: 0.42,
  crouchFactor: 0.72,
  shadowFactor: 0.24,
  decay: 0.4,
  alertDecay: 0.16,
  suspiciousAt: 0.26,
  alertAt: 0.66,
  searchFor: 3.6,
  failAt: 1,
};

export const WORLD = {
  border: 26,
  exitDetectionLimit: 0.55,
  alarmDecay: 0.11,
  alarmSuspicious: 0.1,
  alarmAlert: 0.4,
};

export const PALETTE = {
  backdrop: '#04060d',
  floor: '#0a1120',
  floorDeep: '#070c17',
  floorPanel: '#0c1526',
  grid: '#16324a',
  shadow: '#03060c',
  shadowEdge: '#1b4a66',
  wall: '#111d32',
  wallFace: '#162640',
  wallLight: '#2b4a72',
  wallDark: '#0a1220',
  crate: '#15223a',
  crateEdge: '#3b6f9c',
  crateBand: '#1c3050',
  pillar: '#1a2942',
  desk: '#122033',
  core: '#5ef9ff',
  coreHot: '#c9ffff',
  exit: '#4dffb8',
  exitDeep: '#0d3a2e',
  patrol: '#38e8ff',
  suspicious: '#ffc857',
  alert: '#ff3b60',
  guard: '#ff6f91',
  guardDark: '#571c30',
  guardFace: '#ffd9c4',
  player: '#e8fbff',
  playerGlow: '#46e6ff',
  playerCore: '#39b9ff',
  text: '#eaf6ff',
  muted: '#7c93b0',
  panel: '#08111f',
  panelEdge: '#2b6580',
  noise: '#9ae8ff',
  locked: '#ff5e7a',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = 'ui-monospace, "SFMono-Regular", "Cascadia Mono", "Menlo", monospace';

/** Storage key for the best campaign rating (this browser only). */
export const BEST_KEY = 'shadow-protocol.best';
