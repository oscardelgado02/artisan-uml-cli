// Change tracking: diff diagrams, detect renames, format reports the agent eats.
// Flows:
//   human edits → `artisan diff`   (AI consumes human changes; marks seen)
//   AI edits     → `artisan mark-ai` (records pending changes; human sees amber in editor)
//   human saw    → `artisan ack`    (clears pending)
import fs from 'node:fs';
import { toPlantUML } from './diagram.mjs';
import { appendLog } from './scan.mjs';
import { artisanDir, normalizeDiagram, readJSON, writeJSON } from './store.mjs';
import { refreshEmbedded } from './embed.mjs';

// --- similarity -------------------------------------------------------------
function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => {
  a = (a || '').toLowerCase();
  b = (b || '').toLowerCase();
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  return max ? 1 - lev(a, b) / max : 1;
};

// --- signatures -------------------------------------------------------------
const mSig = (m) => [m.vis, m.type, [...(m.mods || [])].sort().join(','), m.params ?? ''].join('|');
const nodeMemberSigs = (n) =>
  new Set([
    ...n.attributes.map((m) => 'a:' + mSig(m)),
    ...n.methods.map((m) => 'm:' + mSig(m)),
  ]);

// --- diff engine ------------------------------------------------------------
// Result: { renames, added, removed, modified, notes }
// Member entries carry {mid} (member id) so the editor can highlight by id.
export function diffDiagram(oldD, newD) {
  const res = { renames: [], added: [], removed: [], modified: [], notes: [] };
  const oldById = new Map(oldD.nodes.map((n) => [n.id, n]));
  const newById = new Map(newD.nodes.map((n) => [n.id, n]));

  const removedNodes = oldD.nodes.filter((n) => !newById.has(n.id));
  const addedNodes = newD.nodes.filter((n) => !oldById.has(n.id));

  // 1) matched-by-id nodes → member diff (editor renames keep the id)
  for (const o of oldD.nodes) {
    const n = newById.get(o.id);
    if (!n) continue;
    if (o.name !== n.name) res.renames.push({ from: o.name, to: n.name, node: n.id, kind: 'class-rename' });
    if (o.kind !== n.kind) res.modified.push({ ref: `class ${n.name}`, node: n.id, what: `kind ${o.kind} → ${n.kind}`, ghost: { name: n.name, kind: o.kind } });
    if ((o.note || '') !== (n.note || '')) res.notes.push({ ref: `Class ${n.name}`, note: n.note || '' });
    memberDiff(o, n, res);
  }

  // 2) rename detection among removed+added (name changed → hash id changed)
  const pool = [...addedNodes];
  for (const r of [...removedNodes]) {
    let best = null;
    for (const a of pool) {
      if (a.kind !== r.kind) continue;
      const os = nodeMemberSigs(r);
      const as = nodeMemberSigs(a);
      let common = 0;
      for (const s of as) if (os.has(s)) common++;
      const overlap = common / Math.max(1, Math.min(os.size, as.size));
      const s = sim(r.name, a.name);
      const score = overlap * 0.7 + s * 0.3;
      if ((overlap >= 0.6 && s >= 0.5) || overlap >= 0.9) {
        if (!best || score > best.score) best = { a, score };
      }
    }
    if (best && best.a.name !== r.name) {
      res.renames.push({ from: r.name, to: best.a.name, node: best.a.id, kind: 'class-rename' });
      pool.splice(pool.indexOf(best.a), 1);
      memberDiff(r, best.a, res);
      if (best.a.note) res.notes.push({ ref: `Class ${best.a.name} (renamed from ${r.name})`, note: best.a.note });
    } else {
      // same-name matches are re-adds (e.g. diagram-only class lost and re-created) —
      // leave them in the added pool instead of reporting a noop rename
      if (best) pool.splice(pool.indexOf(best.a), 1);
      res.removed.push({ type: 'class', name: r.name, kind: r.kind, ghost: r });
    }
  }
  for (const a of pool) {
    res.added.push({ type: 'class', name: a.name, kind: a.kind, node: a.id });
    if (a.note) res.notes.push({ ref: `Class ${a.name} (new)`, note: a.note });
    for (const m of [...a.attributes, ...a.methods]) {
      const what =
        m.params != null
          ? `method ${m.name}(${m.params}) : ${m.type}`
          : `attribute ${m.name} : ${m.type}`;
      res.added.push({ type: 'member', name: m.name, what, node: a.id, class: a.name, mid: m.id, params: m.params ?? null });
      if (m.note) res.notes.push({ ref: `${a.name}.${m.name}`, note: m.note });
    }
  }

  // 3) edges
  const nameIn = (d, id) => d.nodes.find((n) => n.id === id)?.name || id;
  const eKeyOf = (d, e) => `${e.kind}|${nameIn(d, e.from)}->${nameIn(d, e.to)}`;
  const oldE = new Map(oldD.edges.map((e) => [eKeyOf(oldD, e), e]));
  const newE = new Set(newD.edges.map((e) => eKeyOf(newD, e)));
  for (const [k, e] of oldE) {
    if (!newE.has(k)) res.removed.push({ type: 'relation', name: k, id: e.id, ghost: { ...e, fromName: nameIn(oldD, e.from), toName: nameIn(oldD, e.to) } });
  }
  for (const e of newD.edges) {
    const k = eKeyOf(newD, e);
    if (!oldE.has(k)) res.added.push({ type: 'relation', name: k, id: e.id });
  }

  // 4) project notes
  if ((oldD.projectNotes || '') !== (newD.projectNotes || '')) {
    res.notes.push({ ref: 'Project', note: newD.projectNotes || '' });
  }
  return res;
}

function memberDiff(o, n, res) {
  for (const [key, label] of [['attributes', 'attribute'], ['methods', 'method']]) {
    const oldM = o[key] || [];
    const newM = n[key] || [];
    const newById = new Map(newM.map((m) => [m.id, m]));
    const pairs = [];
    const used = new Set();
    for (const a of oldM) {
      const b = newById.get(a.id);
      if (b && !used.has(b.id)) {
        pairs.push([a, b]);
        used.add(b.id);
      }
    }
    const removedM = oldM.filter((m) => !used.has(m.id));
    const addedM = newM.filter((m) => !used.has(m.id));

    // id-matched: check renames + modifications
    for (const [a, b] of pairs) {
      if (a.name !== b.name) {
        res.renames.push({ from: a.name, to: b.name, node: n.id, class: n.name, mid: b.id, kind: 'member-rename', ghost: { nodeId: n.id, member: a } });
      }
      const ch = [];
      if (a.vis !== b.vis) ch.push(`visibility ${a.vis} → ${b.vis}`);
      if (a.type !== b.type) ch.push(`type ${a.type || '—'} → ${b.type || '—'}`);
      const am = [...(a.mods || [])].sort().join(',');
      const bm = [...(b.mods || [])].sort().join(',');
      if (am !== bm) ch.push(`modifiers ${am || 'none'} → ${bm || 'none'}`);
      if (key === 'methods' && (a.params ?? '') !== (b.params ?? '')) ch.push(`params (${a.params ?? ''}) → (${b.params ?? ''})`);
      if ((a.note || '') !== (b.note || '')) res.notes.push({ ref: `${n.name}.${b.name}`, note: b.note || '' });
      if (ch.length) res.modified.push({ ref: `${n.name}.${b.name}`, mid: b.id, node: n.id, what: ch.join(', '), ghost: { nodeId: n.id, member: a } });
    }

    // rename heuristic for id-changed members: same section+vis+type+params, similar name
    const pool = [...addedM];
    for (const r of removedM) {
      let best = null;
      for (const a of pool) {
        if (a.vis !== r.vis || a.type !== r.type || (a.params ?? '') !== (r.params ?? '')) continue;
        const s = sim(r.name, a.name);
        if (s >= 0.6 && (!best || s > best.s)) best = { a, s };
      }
      if (best) {
        res.renames.push({ from: r.name, to: best.a.name, node: n.id, class: n.name, mid: best.a.id, kind: 'member-rename', ghost: { nodeId: n.id, member: r, removeId: best.a.id } });
        pool.splice(pool.indexOf(best.a), 1);
        if (best.a.note) res.notes.push({ ref: `${n.name}.${best.a.name} (renamed from ${r.name})`, note: best.a.note });
      } else {
        res.removed.push({ type: 'member', name: r.name, class: n.name, what: `${label} ${r.name}`, mid: r.id, ghost: { nodeId: n.id, member: r } });
      }
    }
    for (const a of pool) {
      res.added.push({
        type: 'member',
        name: a.name,
        class: n.name,
        node: n.id,
        mid: a.id,
        what: key === 'methods' ? `method ${a.name}(${a.params ?? ''}) : ${a.type}` : `attribute ${a.name} : ${a.type}`,
        params: a.params ?? null,
      });
      if (a.note) res.notes.push({ ref: `${n.name}.${a.name}`, note: a.note });
    }
  }
}

// --- reports ----------------------------------------------------------------
export function formatReport(d) {
  const L = [];
  const map = readJSON(artisanDir('map.json')) || {};
  const where = (nodeId) => {
    const m = map[nodeId];
    return m ? `${m.file}${m.line ? ':' + m.line : ''}` : 'new type — create the file';
  };
  const has = (arr) => arr.length > 0;
  if (!has(d.renames) && !has(d.added) && !has(d.removed) && !has(d.modified) && !has(d.notes)) {
    return 'No unseen human changes — the diagram matches what the AI last consumed.';
  }
  L.push('# Human changes (unseen by AI)');
  if (has(d.notes)) {
    L.push('');
    L.push("## Notes — honor these, they are the human's intent");
    for (const nt of d.notes) L.push(`- **${nt.ref}**: "${nt.note}"`);
  }
  if (has(d.renames)) {
    L.push('');
    L.push('## Renames — refactor, do not duplicate');
    for (const r of d.renames) {
      L.push(
        r.kind === 'class-rename'
          ? `- Class ${r.from} → ${r.to} (rename class + file + all references; ${where(r.node)})`
          : `- ${r.class}.${r.from} → ${r.to} (rename member + all references)`
      );
    }
  }
  if (has(d.added)) {
    L.push('');
    L.push('## Added — scaffold these, never touch existing members');
    for (const a of d.added) {
      if (a.type === 'class') L.push(`- New ${a.kind} ${a.name} (${where(a.node)})`);
      else if (a.type === 'member') L.push(`- ${a.class}: + ${a.what}`);
      else L.push(`- Relation: ${a.name}`);
    }
  }
  if (has(d.modified)) {
    L.push('');
    L.push('## Modified');
    for (const m of d.modified) L.push(`- ${m.ref}: ${m.what}`);
  }
  if (has(d.removed)) {
    L.push('');
    L.push('## Removed — DO NOT delete code yet; list these and ask the human to confirm');
    for (const r of d.removed) {
      L.push(
        r.type === 'class'
          ? `- Class ${r.name} (${r.kind})`
          : r.what
            ? `- ${r.class}: ${r.what}`
            : `- Relation: ${r.name}`
      );
    }
  }
  return L.join('\n');
}

// Pending refs for the editor (AI → human): [{type, id, nodeId?, change, summary}]
export function pendingRefs(diffRes) {
  const refs = [];
  const seen = new Set();
  const add = (r) => {
    const k = r.type + ':' + r.id + ':' + r.change;
    if (seen.has(k)) return;
    seen.add(k);
    refs.push(r);
  };
  for (const r of diffRes.renames || []) {
    if (r.kind === 'class-rename') add({ type: 'node', id: r.node, change: 'modified', summary: `renamed from ${r.from}`, ghost: { name: r.from } });
    else add({ type: 'member', id: r.mid, nodeId: r.node, change: 'modified', summary: `${r.class}: renamed from ${r.from}`, ghost: r.ghost });
  }
  for (const a of diffRes.added || []) {
    if (a.type === 'class') add({ type: 'node', id: a.node, change: 'added', summary: `new ${a.kind} ${a.name}` });
    else if (a.type === 'member') add({ type: 'member', id: a.mid, nodeId: a.node, change: 'added', summary: `${a.class}: + ${a.what}` });
    else if (a.id) add({ type: 'edge', id: a.id, change: 'added', summary: `new relation ${a.name}` });
  }
  for (const m of diffRes.modified || []) {
    if (m.mid) add({ type: 'member', id: m.mid, nodeId: m.node, change: 'modified', summary: `${m.ref}: ${m.what}`, ghost: m.ghost });
    else add({ type: 'node', id: m.node ?? m.ref, change: 'modified', summary: `${m.ref}: ${m.what}`, ghost: m.ghost });
  }
  for (const r of diffRes.removed || []) {
    if (r.type === 'class') add({ type: 'node', id: r.ghost?.id ?? r.name, change: 'removed', summary: `removed class ${r.name}`, ghost: r.ghost });
    else if (r.type === 'member') add({ type: 'member', id: r.mid, nodeId: r.node, change: 'removed', summary: `${r.class}: removed ${r.what}`, ghost: r.ghost });
    else if (r.id) add({ type: 'edge', id: r.id, change: 'removed', summary: `removed relation ${r.name}`, ghost: r.ghost });
  }
  return refs;
}

const changeCount = (d) =>
  (d.renames?.length || 0) + (d.added?.length || 0) + (d.removed?.length || 0) + (d.modified?.length || 0) + (d.notes?.length || 0);

// --- commands ----------------------------------------------------------------
export function runDiff({ json = false } = {}) {
  const cur = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const lastAi = normalizeDiagram(readJSON(artisanDir('last-ai.json')));
  const diffRes = diffDiagram(lastAi, cur);
  if (json) console.log(JSON.stringify(diffRes, null, 2));
  else console.log(formatReport(diffRes));
  if (changeCount(diffRes)) {
    appendLog(
      'human',
      `${changeCount(diffRes)} changes consumed by AI (${diffRes.renames.length} renames, ${diffRes.added.length} added, ${diffRes.modified.length} modified, ${diffRes.removed.length} removed, ${diffRes.notes.length} notes)`
    );
  }
  writeJSON(artisanDir('last-ai.json'), cur); // AI has now consumed these
  refreshEmbedded(); // every command keeps diagram.html present/fresh
}

export function markAi() {
  const cur = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const lastHuman = normalizeDiagram(readJSON(artisanDir('last-human.json')));
  const diffRes = diffDiagram(lastHuman, cur);
  const refs = pendingRefs(diffRes);
  writeJSON(artisanDir('pending.json'), refs);
  writeJSON(artisanDir('last-ai.json'), cur); // AI knows its own edits
  const n = changeCount(diffRes) - (diffRes.notes?.length || 0);
  appendLog('ai', `${n} architecture changes marked pending for human`);
  refreshEmbedded();
  console.log(`${n} AI change(s) marked pending.`);
  console.log(`Amber highlights: reload .artisan/diagram.html if it is already open, or run \`artisan serve\` for live updates.`);
  console.log(`Confirm with \`artisan ack\` or the editor's "Mark AI changes seen" button.`);
}

export function runAck({ keys } = {}) {
  const cur = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const pending = readJSON(artisanDir('pending.json')) || [];
  if (Array.isArray(keys) && keys.length) {
    const keep = pending.filter((r) => !keys.includes(`${r.type}:${r.id}:${r.change}`));
    writeJSON(artisanDir('pending.json'), keep);
    appendLog('human', `accepted ${keys.length} AI change(s) individually`);
    refreshEmbedded();
    console.log(`Accepted ${keys.length} AI change(s) individually. ${keep.length} still pending.`);
    return;
  }
  writeJSON(artisanDir('pending.json'), []);
  writeJSON(artisanDir('last-human.json'), cur);
  appendLog('human', `acknowledged ${pending.length} AI changes`);
  refreshEmbedded();
  console.log(`Acknowledged ${pending.length} AI change(s). Highlights cleared.`);
}

// Revert: apply the inverse of pending refs (accept = keep, reject = undo).
// Full reject restores last-human.json wholesale; per-key reject applies the
// inverse of each ref (added → delete, modified → restore ghost, removed →
// re-insert ghost) and adopts the result into both baselines.
export function runReject({ keys } = {}) {
  const pending = readJSON(artisanDir('pending.json')) || [];
  if (!Array.isArray(keys) || !keys.length) {
    // reject all = revert the refs still pending. Individually accepted refs
    // are gone from pending and must stay accepted — never a wholesale restore.
    if (!pending.length) {
      console.log('No pending AI changes to reject.');
      return;
    }
    keys = pending.map((r) => `${r.type}:${r.id}:${r.change}`);
  }
  const keyOf = (r) => `${r.type}:${r.id}:${r.change}`;
  const byKey = new Map(pending.map((r) => [keyOf(r), r]));
  const chosen = keys.map((k) => byKey.get(k)).filter(Boolean);
  if (!chosen.length) {
    console.log('No matching pending refs for the given key(s).');
    return;
  }
  const d = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const nodeOf = (d2, id) => d2.nodes.find((n) => n.id === id);
  const removeMember = (n, id) => {
    n.attributes = (n.attributes || []).filter((m) => m.id !== id);
    n.methods = (n.methods || []).filter((m) => m.id !== id);
  };
  for (const r of chosen) {
    const g = r.ghost || {};
    if (r.change === 'added') {
      if (r.type === 'node') {
        d.nodes = d.nodes.filter((n) => n.id !== r.id);
        d.edges = d.edges.filter((e) => e.from !== r.id && e.to !== r.id);
      } else if (r.type === 'member') {
        const n = nodeOf(d, g.nodeId || r.nodeId);
        if (n) removeMember(n, r.id);
      } else if (r.type === 'edge') {
        d.edges = d.edges.filter((e) => e.id !== r.id);
      }
    } else if (r.change === 'modified') {
      if (r.type === 'node') {
        const n = nodeOf(d, r.id) || d.nodes.find((n) => n.name === r.id);
        if (n) {
          if (g.name) n.name = g.name;
          if (g.kind) n.kind = g.kind;
        }
      } else if (g.member) {
        const n = nodeOf(d, g.nodeId);
        if (!n) continue;
        removeMember(n, r.id);
        if (g.removeId) removeMember(n, g.removeId);
        const restored = { ...g.member, id: r.id };
        if (restored.params != null) n.methods = [...(n.methods || []), restored];
        else n.attributes = [...(n.attributes || []), restored];
      }
    } else if (r.change === 'removed') {
      if (r.type === 'node' && g.id) {
        d.nodes.push({
          id: g.id,
          kind: g.kind || 'class',
          name: g.name || g.id,
          note: g.note || '',
          x: g.x ?? 200,
          y: g.y ?? 200,
          attributes: g.attributes || [],
          methods: g.methods || [],
        });
      } else if (r.type === 'member' && g.member) {
        const n = nodeOf(d, g.nodeId);
        if (!n) continue;
        const restored = { ...g.member, id: r.id };
        if (restored.params != null) n.methods = [...(n.methods || []), restored];
        else n.attributes = [...(n.attributes || []), restored];
      } else if (r.type === 'edge' && g.from) {
        d.edges.push({
          id: r.id,
          kind: g.kind || 'association',
          from: g.from,
          to: g.to,
          label: g.label || '',
          fromMult: g.fromMult || '',
          toMult: g.toMult || '',
          note: g.note || '',
        });
      }
    }
  }
  writeJSON(artisanDir('diagram.json'), d);
  writeJSON(artisanDir('last-ai.json'), d);
  writeJSON(artisanDir('last-human.json'), d);
  const keep = pending.filter((r) => !keys.includes(keyOf(r)));
  writeJSON(artisanDir('pending.json'), keep);
  appendLog('human', `rejected ${chosen.length} AI change(s) individually`);
  refreshEmbedded();
  console.log(`Rejected ${chosen.length} AI change(s). Diagram reverted accordingly. ${keep.length} still pending.`);
}

export function runStatus() {
  if (!fs.existsSync(artisanDir('diagram.json'))) {
    console.log('Not initialized — run `artisan scan` (or /artisan scan).');
    return;
  }
  const cur = normalizeDiagram(readJSON(artisanDir('diagram.json')));
  const lastAi = normalizeDiagram(readJSON(artisanDir('last-ai.json')));
  const humanDiff = diffDiagram(lastAi, cur);
  const pending = readJSON(artisanDir('pending.json')) || [];
  console.log(`Diagram: ${cur.nodes.length} types, ${cur.edges.length} relations${cur.projectNotes ? ' (has project notes)' : ''}`);
  console.log(`Unseen human changes (AI: run \`artisan diff\`): ${changeCount(humanDiff)}`);
  console.log(`Pending AI changes (human: review in the editor): ${pending.length}`);
  for (const p of pending.slice(0, 10)) console.log(`  - [${p.change}] ${p.summary}`);
  refreshEmbedded();
}
