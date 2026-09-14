// `artisan scan` — parse code into .artisan/, copy the editor, merge with
// existing human edits (positions, notes, cam).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseCsFile } from './csharp.mjs';
import { buildEdges, layout, toPlantUML } from './diagram.mjs';
import { artisanDir, ensureDir, hid, normalizeDiagram, readJSON, writeJSON, uid } from './store.mjs';
import { writeEmbedded, findEditorDist } from './embed.mjs';

const SKIP_DIRS = new Set([
  '.artisan', '.git', 'node_modules', 'Library', 'obj', 'bin', 'Temp', 'Logs',
  'UserSettings', 'Packages', 'Build', 'Builds', 'Logs', 'MemoryCaptures',
]);

function findCsFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.artisan') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(p);
      } else if (e.isFile() && e.name.endsWith('.cs')) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out.sort();
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
    console.log('  (editor build not found — set ARTISAN_EDITOR or build editor/ first; skipping copy)');
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
  const files = findCsFiles(root);
  if (!files.length) {
    console.error(`No .cs files found under ${root}`);
    process.exit(1);
  }
  const entries = [];
  const map = {};
  for (const f of files) {
    const rel = path.relative(root, f);
    let nodes;
    try {
      nodes = parseCsFile(fs.readFileSync(f, 'utf8'), rel);
    } catch (e) {
      console.error(`  (skipped ${rel}: ${e.message})`);
      continue;
    }
    for (const { node, meta } of nodes) {
      entries.push({ node, meta });
      map[node.id] = { file: meta.file, namespace: meta.namespace, line: meta.line, full: meta.full };
    }
  }
  // dedupe by full name across files (partial classes etc.)
  const seen = new Map();
  const dedup = [];
  for (const en of entries) {
    const prev = seen.get(en.node.id);
    if (!prev) {
      seen.set(en.node.id, en);
      dedup.push(en);
    } else {
      // partial class across files: merge members not already present
      const have = new Set([
        ...prev.node.attributes.map((m) => m.id),
        ...prev.node.methods.map((m) => m.id),
      ]);
      for (const m of en.node.methods) if (!have.has(m.id)) prev.node.methods.push(m);
      for (const m of en.node.attributes) if (!have.has(m.id)) prev.node.attributes.push(m);
    }
  }

  const diagram = normalizeDiagram({
    seq: 1,
    projectNotes: '',
    nodes: dedup.map(({ node }) => ({ ...node })),
    edges: buildEdges(dedup).map((e) => ({ ...e, id: uid() })),
  });
  // keep deterministic edge ids stable across scans: derive from endpoints
  diagram.edges.forEach((e) => {
    e.id = 'e' + hid(e.kind + '|' + e.from + '|' + e.to).slice(0, 12);
  });

  const old = readJSON(artisanDir('diagram.json'));
  mergeOld(diagram, normalizeDiagram(old));
  if (!old) layout(diagram);
  else {
    const fresh = new Set(diagram.nodes.filter((n) => n.x == null || n.y == null).map((n) => n.id));
    if (fresh.size) layout(diagram, fresh);
  }

  ensureDir();
  writeJSON(artisanDir('diagram.json'), diagram);
  fs.writeFileSync(artisanDir('diagram.puml'), toPlantUML(diagram));
  writeJSON(artisanDir('map.json'), map);
  if (!readJSON(artisanDir('last-ai.json'))) writeJSON(artisanDir('last-ai.json'), diagram);
  if (!readJSON(artisanDir('last-human.json'))) writeJSON(artisanDir('last-human.json'), diagram);
  if (!readJSON(artisanDir('pending.json'))) writeJSON(artisanDir('pending.json'), []);
  appendLog('scan', `scanned ${files.length} files → ${diagram.nodes.length} types, ${diagram.edges.length} relations`);
  const dist = copyEditor();
  if (dist) {
    try {
      writeEmbedded(dist, diagram, readJSON(artisanDir('pending.json')) || []);
      console.log('  .artisan/diagram.html written (self-contained editor)');
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
  console.log(`\nOpen the editor:  double-click .artisan/diagram.html  (or: artisan serve)`);
}

export function appendLog(actor, summary) {
  const log = readJSON(artisanDir('changelog.json')) || [];
  log.push({ t: new Date().toISOString(), actor, summary });
  writeJSON(artisanDir('changelog.json'), log.slice(-500));
}

export { execFileSync };
