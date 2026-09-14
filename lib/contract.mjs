// Contract between the artisan-uml-cli CLI and the artisan-uml editor package.
// The editor owns the box-size math (layout-constants.mjs); the CLI mirrors it
// to estimate node sizes for scan layout. Both sides pin a version:
//   editor  layout-constants.mjs -> CONTRACT_VERSION
//   cli     package.json         -> editorContract
// On mismatch `artisan scan` fails loudly instead of producing diagrams whose
// boxes quietly disagree with what the editor renders.

import { readFileSync } from 'node:fs';

const FALLBACK = {
  CHAR_PX: 7.4,
  NODE_MAX_PX: 640,
  NODE_MIN_PX: 220,
  ROW_PAD: 48,
  NOTE_GLYPH: 14,
  NAME_CAP: 240,
  NAME_FLOOR: 120,
  PARAMS_CAP: 240,
  PARAMS_FLOOR: 80,
  CONTRACT_VERSION: 2,
};

export const EDITOR = { ...FALLBACK };
export let editorSource = 'built-in defaults';

// Artisan's own layered layout (same file the editor's Tidy button uses).
export let LAYOUT = null;

// 1. npm installs / workspace: resolve the editor package normally.
// 2. Bundled installs (install.sh): constants + layout copied into ../editor-dist/
//    relative to lib/ (i.e. dist/editor-dist in published layout).
const bundled = (f) => new URL(`../editor-dist/${f}`, import.meta.url).href;
for (const load of [
  (f) => import('artisan-uml/' + f),
  (f) => import(bundled(f)),
]) {
  try {
    Object.assign(EDITOR, await load('layout-constants.mjs'));
    LAYOUT = await load('layout.mjs');
    editorSource = 'artisan-uml editor package';
    break;
  } catch {
    /* next candidate */
  }
}

export function assertEditorContract() {
  if (editorSource === 'built-in defaults') return; // nothing to compare against
  if (!LAYOUT) {
    throw new Error(
      'Artisan layout module not found — the artisan-uml package ships layout.mjs.\n' +
        'Update artisan-uml (or reinstall artisan-uml-cli) so both are in sync.'
    );
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const want = pkg?.editorContract ?? 1;
  if (EDITOR.CONTRACT_VERSION !== want) {
    throw new Error(
      `Artisan editor contract mismatch.\n` +
        `  editor CONTRACT_VERSION = ${EDITOR.CONTRACT_VERSION}  (from ${editorSource})\n` +
        `  artisan-uml-cli expects  = ${want}\n` +
        `Update artisan-uml and set "editorContract" in artisan-uml-cli's package.json to\n` +
        `the matching CONTRACT_VERSION, so CLI box-size estimates match the editor's rendering.`
    );
  }
}
