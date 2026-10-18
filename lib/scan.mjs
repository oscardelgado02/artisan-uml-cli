// `artuml scan` — parse code into .artisan/, copy the editor, merge with
// existing human edits (positions, notes, cam).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { layout, toPlantUML } from './diagram.mjs';
import { artisanDir, ensureDir, hid, normalizeDiagram, readJSON, writeJSON } from './store.mjs';
import { writeEmbedded, findEditorDist } from './embed.mjs';
import { parseCodeDiagram } from './extract.mjs';
import { ensureProjectConfig } from './config.mjs';

// Keep ids stable across rescans for same-name nodes: editor/CLI-added nodes
// carry random ids and renamed classes keep their old id, so a plain hash-id
// rescan would swap ids for unchanged classes — the editor's disk-diff then
// reports "removed + added" churn for a diagram that is semantically identical.
// Align fresh ids to the existing diagram by NAME (nodes + members), remap
// relation endpoints, and adopt old relation ids when kind + endpoints match.
function alignIds(diagram, old, map) {
  if (!old) return;
  const oldByName = new Map(old.nodes.map((n) => [n.name, n]));
  const idMap = new Map();
  for (const n of diagram.nodes) {
    const o = oldByName.get(n.name);
    if (!o) continue;
    idMap.set(n.id, o.id);
    n.id = o.id;
    for (const section of ['attributes', 'methods']) {
      const oPool = [...(o[section] || [])];
      for (const m of n[section]) {
        // prefer exact overload match, fall back to first same-name member
        let idx = oPool.findIndex((p) => p.name === m.name && (p.params ?? '') === (m.params ?? ''));
        if (idx < 0) idx = oPool.findIndex((p) => p.name === m.name);
        if (idx < 0) continue;
        m.id = oPool.splice(idx, 1)[0].id;
      }
    }
  }
  for (const e of diagram.edges) {
    e.from = idMap.get(e.from) || e.from;
    e.to = idMap.get(e.to) || e.to;
    e.id = 'e' + hid(e.kind + '|' + e.from + '|' + e.to).slice(0, 12);
  }
  const oldE = new Map((old.edges || []).map((e) => [`${e.kind}|${e.from}|${e.to}`, e.id]));
  for (const e of diagram.edges) {
    const stable = oldE.get(`${e.kind}|${e.from}|${e.to}`);
    if (stable) e.id = stable;
  }
  // map.json keys were built from the fresh ids — remap to the adopted ones
  for (const [freshId, adoptedId] of idMap) {
    if (freshId !== adoptedId && map[freshId]) {
      map[adoptedId] = map[freshId];
      delete map[freshId];
    }
  }
}

// Carry over human-touched fields (position, notes) from an existing diagram.
function mergeOld(newDiagram, oldDiagram) {
  if (!oldDiagram) return;
  const oldNode = new Map(oldDiagram.nodes.map((n) => [n.id, n]));
  for (const n of newDiagram.nodes) {
    const o = oldNode.get(n.id);
    if (!o) continue;
    n.x = o.x;
    n.y = o.y;
    if (o.note) n.note = o.note;
    const om = new Map([...(o.attributes || []), ...(o.methods || [])].map((m) => [m.id, m]));
    for (const m of [...n.attributes, ...n.methods]) {
      const prev = om.get(m.id);
      if (prev?.note) m.note = prev.note;
    }
  }
  newDiagram.projectNotes = oldDiagram.projectNotes || '';
  newDiagram.colorize = oldDiagram.colorize;
  if (oldDiagram.cam && oldDiagram.cam.z !== 1) newDiagram.cam = oldDiagram.cam;
}

function copyEditor() {
  const dist = findEditorDist();
  const target = artisanDir('editor');
  if (!dist) {
    console.log('  (editor build not found — npm install -g artisan-uml-cli bundles it, or set ARTISAN_EDITOR; diagram.html will be skipped)');
    return null;
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(dist, target, { recursive: true });
  console.log(`  editor copied → ${target}/`);
  return dist;
}

export function runScan({ src = '.', lang = 'csharp' }) {
  if (lang !== 'csharp') {
    console.error(`Language "${lang}" not supported yet — v1 ships C#. Others welcome as PRs.`);
    process.exit(1);
  }
  const root = path.resolve(src);
  const { diagram, map, files } = parseCodeDiagram(root, {
    onSkip: ({ rel, message }) => console.error(`  (skipped ${rel}: ${message})`),
  });
  if (!files.length) {
    console.error(`No .cs files found under ${root}`);
    process.exit(1);
  }

  const old = readJSON(artisanDir('diagram.json'));
  alignIds(diagram, normalizeDiagram(old), map);
  mergeOld(diagram, normalizeDiagram(old));
  if (!old) layout(diagram);
  else {
    const fresh = new Set(diagram.nodes.filter((n) => n.x == null || n.y == null).map((n) => n.id));
    if (fresh.size) layout(diagram, fresh);
  }

  ensureDir();
  ensureProjectConfig();
  writeJSON(artisanDir('diagram.json'), diagram);
  fs.writeFileSync(artisanDir('diagram.puml'), toPlantUML(diagram));
  writeJSON(artisanDir('map.json'), map);
  if (!readJSON(artisanDir('last-ai.json'))) writeJSON(artisanDir('last-ai.json'), diagram);
  if (!readJSON(artisanDir('last-human.json'))) writeJSON(artisanDir('last-human.json'), diagram);
  if (!readJSON(artisanDir('pending.json'))) writeJSON(artisanDir('pending.json'), []);
  appendLog('scan', `scanned ${files.length} files → ${diagram.nodes.length} types, ${diagram.edges.length} relations`);
  const dist = copyEditor();
  let htmlWritten = false;
  if (dist) {
    try {
      writeEmbedded(dist, diagram, readJSON(artisanDir('pending.json')) || []);
      console.log('  .artisan/diagram.html written (self-contained editor)');
      htmlWritten = true;
    } catch (e) {
      console.log(`  (diagram.html skipped: ${e.message})`);
    }
  }

  console.log(`\nArtisan scan complete: ${diagram.nodes.length} types, ${diagram.edges.length} relations.`);
  const byKind = {};
  for (const e of diagram.edges) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  console.log(`  relations: ${Object.entries(byKind).map(([k, c]) => `${c} ${k}`).join(', ') || 'none'}`);
  console.log(`  .artisan/diagram.json  (source of truth)`);
  console.log(`  .artisan/diagram.puml  (PlantUML mirror for AI)`);
  console.log(`  .artisan/map.json      (type → source file)`);
  if (htmlWritten) {
    console.log(`\nOpen the editor:  double-click .artisan/diagram.html  (or: artuml serve)`);
  } else {
    console.log(`\nNo editor build found — .artisan/diagram.html was NOT written.`);
    console.log(`  Fix: npm install -g artisan-uml-cli (bundles the editor), or set ARTISAN_EDITOR to an editor build.`);
    console.log(`  Meanwhile diagram.json + diagram.puml are ready.`);
  }
}

export function appendLog(actor, summary) {
  const log = readJSON(artisanDir('changelog.json')) || [];
  log.push({ t: new Date().toISOString(), actor, summary });
  writeJSON(artisanDir('changelog.json'), log.slice(-500));
}

export { execFileSync };
