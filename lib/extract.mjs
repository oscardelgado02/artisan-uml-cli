// Shared source-extraction pipeline: file walk + language parse + partial-class
// dedupe + deterministic edge ids. One implementation serves both `scan` (writes
// .artisan state) and `impl-diff` (fresh read-only parse) — and is the seam a
// second language plugs into: add a parser + a find<X>Files, dispatch on the
// project's stack here.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsFile } from './csharp.mjs';
import { buildEdges } from './diagram.mjs';
import { hid, normalizeDiagram } from './store.mjs';

const SKIP_DIRS = new Set([
  '.artisan', '.git', 'node_modules', 'Library', 'obj', 'bin', 'Temp', 'Logs',
  'UserSettings', 'Packages', 'Build', 'Builds', 'Logs', 'MemoryCaptures',
]);

export function findCsFiles(root) {
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

// Parse all code under root into a diagram-shaped structure (same shapes as scan).
// onSkip({ rel, message }) reports per-file parse failures (scan logs them,
// impl-diff stays silent).
export function parseCodeDiagram(root, { onSkip } = {}) {
  root = path.resolve(root);
  const files = findCsFiles(root);
  const entries = [];
  const map = {};
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    let nodes;
    try {
      nodes = parseCsFile(fs.readFileSync(f, 'utf8'), rel);
    } catch (e) {
      if (onSkip) onSkip({ rel, message: e.message });
      continue;
    }
    for (const { node, meta } of nodes) {
      entries.push({ node, meta });
      map[node.id] = { file: meta.file, namespace: meta.namespace, line: meta.line, full: meta.full };
    }
  }
  // dedupe by full name across files (partial classes etc.), merging members
  const seen = new Map();
  const dedup = [];
  for (const en of entries) {
    const prev = seen.get(en.node.id);
    if (!prev) {
      seen.set(en.node.id, en);
      dedup.push(en);
    } else {
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
    edges: buildEdges(dedup),
  });
  // deterministic edge ids stable across scans: derive from endpoints
  diagram.edges.forEach((e) => {
    e.id = 'e' + hid(e.kind + '|' + e.from + '|' + e.to).slice(0, 12);
  });
  return { diagram, map, files };
}
