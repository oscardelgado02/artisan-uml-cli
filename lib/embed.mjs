// Single-file editor: inline the built editor's JS/CSS into one HTML file with
// the current diagram + pending AI changes embedded (window.__ARTISAN__).
// Why: the user asked for "just an html file" — no server needed to view/edit.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artisanDir, readJSON } from './store.mjs';

// Same lookup as the editor copy step in scan.mjs. Candidates cover:
//   dev override (ARTISAN_EDITOR), this repo, npm installs (sibling of lib/ in
//   node_modules), any project with the editor package installed, and the
//   bundled copy install.sh puts at lib/editor-dist.
export function findEditorDist() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.ARTISAN_EDITOR,
    resolve(here, '../../editor/dist'),
    resolve(here, '../node_modules/artisan-uml/dist'),
    // npm global/npx: hoisted sibling dep (<prefix>/lib/node_modules/artisan-uml)
    resolve(here, '../../artisan-uml/dist'),
    resolve(here, '../../node_modules/artisan-uml/dist'),
    resolve(process.cwd(), 'editor/dist'),
    resolve(process.cwd(), 'node_modules/artisan-uml/dist'),
    resolve(here, 'editor-dist'),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (statSync(join(c, 'index.html')).isFile()) return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function buildEmbeddedHtml(editorDist, diagram, pending, implDiff) {
  let html = readFileSync(join(editorDist, 'index.html'), 'utf8');
  html = html.replace(
    /<link rel="stylesheet"[^>]*href="[^"]*?(assets\/[^"/]+\.css)"[^>]*>/,
    (_, p1) => `<style>${readFileSync(join(editorDist, p1), 'utf8')}</style>`
  );
  html = html.replace(
    /<script type="module"[^>]*src="[^"]*?(assets\/[^"/]+\.js)"[^>]*><\/script>/,
    (_, p1) =>
      `<script type="module">${readFileSync(join(editorDist, p1), 'utf8').replace(/<\/script/g, '<\\/script')}</script>`
  );
  const payload = JSON.stringify({ diagram, pending: pending || [], implDiff: implDiff || null }).replace(/</g, '\\u003c');
  html = html.replace(
    '<script type="module">',
    `<script>window.__ARTISAN__ = ${payload};</script>\n<script type="module">`
  );
  return html;
}

// Rebuild .artisan/diagram.html from the copied editor dist + current state.
export function writeEmbedded(editorDist, diagram, pending, implDiff) {
  writeFileSync(artisanDir('diagram.html'), buildEmbeddedHtml(editorDist, diagram, pending, implDiff));
}

// Rebuild diagram.html from current diagram.json + pending.json (after mark-ai,
// ack, or editor saves). No-op when no editor dist is around.
export function refreshEmbedded() {
  const dist = findEditorDist();
  if (!dist) return false;
  const diagram = readJSON(artisanDir('diagram.json'));
  if (!diagram) return false;
  writeEmbedded(dist, diagram, readJSON(artisanDir('pending.json')) || [], readJSON(artisanDir('impl-diff.json')));
  return true;
}
