// Shadow Protocol — hand-in program for make.fun's best-stealth-game bounty.
//
// The playable build is game/: plain static assets (index.html plus local ES modules) that a
// desktop browser opens offline. The judge-facing captures are screenshots/. This program stages
// both trees into the drop folder and then emits dossier.json there, using the vendored
// make.fun grader so the manifest is derived from precisely the files being submitted.
//
// Inside the grader container the drop folder is /output; elsewhere point MAKEFUN_OUTPUT_DIR at
// it. Run the hand-in with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// To play locally, run `node serve.ts` and open http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** Directory holding this script, and therefore game/, screenshots/ and vendor/. */
const projectRoot = dirname(fileURLToPath(import.meta.url));

/** Where the staged submission goes: the grader's /output, or MAKEFUN_OUTPUT_DIR if set. */
const dropDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/**
 * The scorer's limits, copied from the reference gate. `text_max_bytes` is the only cap that
 * affects the bytes written; the rest exist to reject here what the scorer would reject there:
 * more than 4 screenshots (or any over 256 KiB), more than 993 files or 48 MiB under game/, or
 * any game/ path longer than 1000 bytes.
 */
function collectOutputCaps() {
  return {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  };
}

/** Copy game/ and screenshots/ from the project into the drop folder. */
function stageArtifacts(sourceRoot: string, destination: string): void {
  mkdirSync(destination, { recursive: true });

  // The game itself is required; cpSync throws if it is missing.
  cpSync(join(sourceRoot, 'game'), join(destination, 'game'), { recursive: true });

  // Screenshots are optional, but the drop folder always gets the directory.
  const stagedShots = join(destination, 'screenshots');
  mkdirSync(stagedShots, { recursive: true });

  const sourceShots = join(sourceRoot, 'screenshots');
  if (existsSync(sourceShots)) {
    cpSync(sourceShots, stagedShots, { recursive: true });
  }
}

/** Build the judge's summary from the staged tree and write it as dossier.json. */
function writeDossier(destination: string): void {
  const dossier = buildDossier(destination, collectOutputCaps());
  writeFileSync(join(destination, 'dossier.json'), dossier);
}

stageArtifacts(projectRoot, dropDir);
writeDossier(dropDir);
