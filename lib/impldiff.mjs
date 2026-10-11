// `artisan impl-diff` — compare the diagram against the actual code.
// The regular `diff` tracks human-vs-AI diagram state; impl-diff closes the
// loop the other way: what the diagram wants that the code lacks, and what
// the code has that the diagram never adopted. Read-only — touches no state.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsFile } from './csharp.mjs';
import { buildEdges } from './diagram.mjs';
import { findCsFiles } from './scan.mjs';
import { artisanDir, hid, normalizeDiagram, readJSON, writeJSON } from './store.mjs';
import { diffDiagram } from './diff.mjs';

// Parse all code under root into a diagram-shaped structure (same shapes as scan).
export function parseCodeDiagram(root) {
  root = path.resolve(root);
  const files = findCsFiles(root);
  const entries = [];
  const map = {};
  for (const f of files) {
    const rel = path.relative(root, f);
    let nodes;
    try {
      nodes = parseCsFile(fs.readFileSync(f, 'utf8'), rel);
    } catch {
      continue;
    }
    for (const { node, meta } of nodes) {
      entries.push({ node, meta });
      map[node.id] = { file: meta.file, namespace: meta.namespace, line: meta.line, full: meta.full };
    }
  }
  // dedupe by full name across files (partial classes), merging members — same as scan
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
  diagram.edges.forEach((e) => {
    e.id = 'e' + hid(e.kind + '|' + e.from + '|' + e.to).slice(0, 12);
  });
  return { diagram, map };
}

// Adopt diagram ids for same-name code nodes/members so diffDiagram can match
// them (editor/CLI-added items carry random ids; scan-derived ids already match
// but are re-derived here for uniformity). Diagram-unspecified type/mods ("")
// never count as mismatches; notes and project notes are human-only, never diffed.
export function alignFresh(fresh, diagram) {
  const dByName = new Map(diagram.nodes.map((n) => [n.name, n]));
  const idMap = new Map(); // old fresh node id -> adopted diagram node id
  for (const n of fresh.nodes) {
    const d = dByName.get(n.name);
    if (!d) continue;
    idMap.set(n.id, d.id);
    n.id = d.id;
    if (d.note) n.note = d.note;
    alignMembers(n.attributes, d.attributes || [], false);
    alignMembers(n.methods, d.methods || [], true);
  }
  for (const e of fresh.edges) {
    e.from = idMap.get(e.from) || e.from;
    e.to = idMap.get(e.to) || e.to;
  }
  fresh.projectNotes = diagram.projectNotes || '';
}

function alignMembers(freshList, diagList, isMethod) {
  const pool = [...diagList];
  for (const m of freshList) {
    // prefer exact overload match, fall back to first same-name member
    let idx = pool.findIndex((p) => p.name === m.name && (p.params ?? '') === (m.params ?? ''));
    if (idx < 0) idx = pool.findIndex((p) => p.name === m.name);
    if (idx < 0) continue;
    const d = pool.splice(idx, 1)[0];
    m.id = d.id;
    if (d.note) m.note = d.note;
    if (!d.type) m.type = ''; // diagram left the type unspecified
    if (!(d.mods || []).length) m.mods = []; // diagram left modifiers unspecified
  }
}

export function implDiff({ src = '.' } = {}) {
  const diagram = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const { diagram: fresh, map } = parseCodeDiagram(src);
  alignFresh(fresh, diagram);
  const res = diffDiagram(diagram, fresh);
  // direction: removed = in diagram, missing from code; added = in code, not in diagram
  return { res, map };
}

export function formatImplReport(res, map) {
  const has = (arr) => arr.length > 0;
  const any = has(res.added) || has(res.removed) || has(res.modified);
  if (!any) return 'Implementation matches the diagram.';
  const fileByName = new Map();
  for (const [id, m] of Object.entries(map || {})) fileByName.set(m.full.split('.').pop(), m.file);
  const where = (className) => {
    const f = fileByName.get(className);
    return f ? ` — ${f}` : ' — new file';
  };
  const L = ['# Implementation diff — diagram vs code'];
  if (has(res.removed)) {
    L.push('');
    L.push('## In the diagram, missing from the code — implement these');
    for (const r of res.removed) {
      if (r.type === 'class') L.push(`- Class ${r.name} (${r.kind})${where(r.name)}`);
      else if (r.type === 'member') L.push(`- ${r.class}: + ${r.what}${where(r.class)}`);
      else L.push(`- Relation: ${r.name}`);
    }
  }
  if (has(res.added)) {
    L.push('');
    L.push('## In the code, not in the diagram — adopt into the diagram or remove');
    for (const a of res.added) {
      if (a.type === 'class') L.push(`- Class ${a.name} (${a.kind})${where(a.name)}`);
      else if (a.type === 'member') L.push(`- ${a.class}: + ${a.what}${where(a.class)}`);
      else L.push(`- Relation: ${a.name}`);
    }
  }
  if (has(res.modified)) {
    L.push('');
    L.push('## Signature mismatches — code differs from the diagram');
    for (const m of res.modified) L.push(`- ${m.ref}: ${m.what}`);
  }
  return L.join('\n');
}

export function runImplDiff({ src = '.', json = false } = {}) {
  const { res, map } = implDiff({ src });
  // persisted summary so the editor can flag code/diagram drift (read-only for
  // diagram state — this is a derived report artifact, marks nothing seen)
  writeJSON(artisanDir('impl-diff.json'), {
    changed: !!(res.added.length || res.removed.length || res.modified.length),
    counts: { missing: res.removed.length, drift: res.added.length, mismatch: res.modified.length },
    t: new Date().toISOString(),
  });
  if (json) console.log(JSON.stringify(res, null, 2));
  else console.log(formatImplReport(res, map));
}
