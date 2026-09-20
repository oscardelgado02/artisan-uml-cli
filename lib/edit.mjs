// Programmatic diagram edits from the terminal: `artisan add ...` and `artisan editor`.
// These are HUMAN edits — recorded in diagram.json like editor changes.
// Each mutation also appends refs to pending.json (the same file `mark-ai`
// uses) so the editor highlights the change amber — across reloads too,
// until the human acks. `artisan diff` picks the edits up for the agent.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { artisanDir, readJSON, writeJSON, hid, uid, normalizeDiagram } from './store.mjs';
import { layout, toPlantUML } from './diagram.mjs';
import { findEditorDist, refreshEmbedded, writeEmbedded } from './embed.mjs';

function recordPending(refs) {
  const pending = readJSON(artisanDir('pending.json')) || [];
  const key = (r) => r.type + ':' + r.id + ':' + r.change;
  const seen = new Set(pending.map(key));
  for (const r of refs) {
    if (!seen.has(key(r))) {
      pending.push(r);
      seen.add(key(r));
    }
  }
  writeJSON(artisanDir('pending.json'), pending);
}

const KINDS = new Set(['class', 'abstract', 'interface', 'enum', 'record', 'struct']);
const EDGE_KINDS = new Set(['inheritance', 'realization', 'composition', 'aggregation', 'association', 'dependency']);

function fail(msg) {
  throw new Error(msg); // bin catches and exits; tests can assert on throws
}

function loadDiagram() {
  const d = readJSON(artisanDir('diagram.json'));
  if (!d) fail('No .artisan/diagram.json — run `artisan scan` (or `artisan editor`) first.');
  return normalizeDiagram(d);
}

function findNode(d, name, role) {
  const hit = d.nodes.find((n) => n.name.toLowerCase() === String(name).toLowerCase());
  if (!hit) fail(`No class named "${name}" in the diagram. Known: ${d.nodes.map((n) => n.name).join(', ')}`);
  return hit;
}

function persist(d) {
  d.seq = (d.seq || 0) + 1;
  writeJSON(artisanDir('diagram.json'), d);
  fs.writeFileSync(artisanDir('diagram.puml'), toPlantUML(d));
  refreshEmbedded();
}

function addNode(pos, args) {
  const name = pos[0];
  if (!name) fail('Usage: artisan add node <Name> [--kind class] [--x N --y N] [--note "..."]');
  const d = loadDiagram();
  if (d.nodes.some((n) => n.name.toLowerCase() === name.toLowerCase()))
    fail(`Class "${name}" already exists in the diagram.`);
  const kind = (args.kind || 'class').toLowerCase();
  if (!KINDS.has(kind)) fail(`Unknown kind "${kind}" — one of: ${[...KINDS].join(', ')}`);
  const node = {
    id: hid('type|' + name),
    kind,
    name,
    x: args.x !== undefined ? Number(args.x) : null,
    y: args.y !== undefined ? Number(args.y) : null,
    attributes: [],
    methods: [],
  };
  if (args.note) node.note = String(args.note);
  d.nodes.push(node);
  if (node.x == null || node.y == null) layout(d, new Set([node.id]));
  persist(d);
  recordPending([{ type: 'node', id: node.id, change: 'added', summary: `new ${kind} ${name}` }]);
  console.log(`Added ${kind} ${name} at (${Math.round(node.x)}, ${Math.round(node.y)}).`);
}

function addMember(pos, args) {
  // add member <Class> <attribute|method|value> <Name> [--type T] [--params P] [--vis +] [--mods static,abstract] [--note]
  const [cls, slot, name] = pos;
  if (!cls || !slot || !name)
    fail('Usage: artisan add member <Class> <attribute|method|value> <Name> [--type T] [--params P] [--vis +] [--mods static,abstract] [--note "..."]');
  const d = loadDiagram();
  const node = findNode(d, cls);
  const slotL = slot.toLowerCase();
  if (slotL === 'value' && node.kind !== 'enum')
    fail(`${node.name} is a ${node.kind} — values live in enums. Use attribute or method.`);
  if (slotL !== 'attribute' && slotL !== 'method' && slotL !== 'value')
    fail(`Member slot must be attribute, method or value (got "${slot}").`);
  const arr = slotL === 'method' ? node.methods : node.attributes;
  const k = arr.length;
  const type = args.type != null ? String(args.type) : '';
  const params = args.params != null ? String(args.params) : '';
  const member = {
    id: hid(`${node.name}|${slotL === 'method' ? 'm' : 'a'}|${name}|${slotL === 'method' ? params : type}`) + (k ? '-' + k : ''),
    vis: args.vis != null ? String(args.vis) : '+',
    name: String(name),
    type,
    mods: args.mods ? String(args.mods).split(',').map((s) => s.trim()).filter(Boolean) : [],
    params: slotL === 'method' ? params : null,
  };
  if (args.note) member.note = String(args.note);
  arr.push(member);
  persist(d);
  recordPending([{ type: 'member', id: member.id, nodeId: node.id, change: 'added', summary: `${node.name}: + ${slotL === 'method' ? `${name}(${params})` : name}` }]);
  console.log(`Added ${slotL} ${node.name}.${name}${slotL === 'method' ? '(' + params + ')' : ''}${type ? ': ' + type : ''}`);
}

function addEdge(pos, args) {
  // add edge <From> <To> [--kind association] [--label L] [--from-mult A] [--to-mult B]
  const [from, to] = pos;
  if (!from || !to) fail('Usage: artisan add edge <From> <To> [--kind inheritance|realization|composition|aggregation|association|dependency] [--label L] [--from-mult A] [--to-mult B]');
  const d = loadDiagram();
  const kind = (args.kind || 'association').toLowerCase();
  if (!EDGE_KINDS.has(kind)) fail(`Unknown relation kind "${kind}" — one of: ${[...EDGE_KINDS].join(', ')}`);
  const a = findNode(d, from);
  const b = findNode(d, to);
  const id = 'e' + hid(`${kind}|${a.id}|${b.id}`).slice(0, 12);
  if (d.edges.some((e) => e.id === id)) fail(`That ${kind} relation already exists.`);
  d.edges.push({
    id,
    kind,
    from: a.id,
    to: b.id,
    label: args.label != null ? String(args.label) : '',
    fromMult: args['from-mult'] != null ? String(args['from-mult']) : '',
    toMult: args['to-mult'] != null ? String(args['to-mult']) : '',
  });
  persist(d);
  recordPending([{ type: 'edge', id, change: 'added', summary: `new ${kind} relation ${a.name} → ${b.name}` }]);
  console.log(`Added ${kind} relation ${a.name} -> ${b.name}.`);
}

export function parseFlags(rest) {
  const pos = [];
  const args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) args[a.slice(2)] = true;
      else {
        args[a.slice(2)] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, args };
}

export function runAdd(argv) {
  const [slot, ...rest] = argv;
  const { pos, args } = parseFlags(rest);
  switch ((slot || '').toLowerCase()) {
    case 'node': return addNode(pos, args);
    case 'member': return addMember(pos, args);
    case 'edge': return addEdge(pos, args);
    default:
      fail(`Usage: artisan add <node|member|edge> ...\n\n  artisan add node <Name> [--kind class] [--x N --y N] [--note "..."]\n  artisan add member <Class> <attribute|method|value> <Name> [--type T] [--params P] [--vis +] [--mods static,abstract] [--note "..."]\n  artisan add edge <From> <To> [--kind association] [--label L] [--from-mult A] [--to-mult B]`);
  }
}

// ---- edit ---------------------------------------------------------------

function findEdge(d, fromName, toName, kind) {
  const a = findNode(d, fromName);
  const b = findNode(d, toName);
  const hits = d.edges.filter((e) => {
    const direct = e.from === a.id && e.to === b.id;
    const reverse = e.from === b.id && e.to === a.id;
    return direct || reverse;
  });
  if (kind != null) {
    const k = String(kind).toLowerCase();
    const kept = hits.filter((e) => e.kind === k);
    if (!kept.length) fail(`No ${k} relation between ${a.name} and ${b.name}.`);
    return kept[0];
  }
  if (!hits.length) fail(`No relation between ${a.name} and ${b.name}.`);
  if (hits.length > 1)
    fail(`Several relations between ${a.name} and ${b.name} (${hits.map((e) => e.kind).join(', ')}) — pass --kind.`);
  return hits[0];
}

function findMember(node, name, slot) {
  const n = String(name).toLowerCase();
  const slots = slot ? [String(slot).toLowerCase()] : ['attributes', 'methods'];
  const hits = [];
  for (const s of slots) {
    const arr = node[s] || [];
    arr.forEach((m, i) => { if (m.name.toLowerCase() === n) hits.push({ s, m, i }); });
  }
  if (!hits.length) {
    const known = [...(node.attributes || []), ...(node.methods || [])].map((m) => m.name);
    fail(`No member "${name}" in ${node.name}. Known: ${known.join(', ') || '(none)'}`);
  }
  if (hits.length > 1) fail(`"${name}" exists more than once in ${node.name} — pass --kind attribute|method|value.`);
  return hits[0];
}

function editNode(pos, args) {
  if (!pos[0]) fail('Usage: artisan edit node <Name> [--name New] [--kind K] [--x N --y N] [--note "..."]');
  const d = loadDiagram();
  const node = findNode(d, pos[0]);
  if (args.kind != null) {
    const kind = String(args.kind).toLowerCase();
    if (!KINDS.has(kind)) fail(`Unknown kind "${kind}" — one of: ${[...KINDS].join(', ')}`);
    node.kind = kind;
  }
  if (args.x != null) node.x = Number(args.x);
  if (args.y != null) node.y = Number(args.y);
  if (args.note != null) {
    if (args.note === true) delete node.note;
    else node.note = String(args.note);
  }
  if (args.name != null) {
    const name = String(args.name);
    if (name.toLowerCase() !== node.name.toLowerCase() && d.nodes.some((n) => n.name.toLowerCase() === name.toLowerCase()))
      fail(`Class "${name}" already exists in the diagram.`);
    node.name = name; // id stays — diff reports the rename for the agent
  }
  if (node.x == null || node.y == null) layout(d, new Set([node.id]));
  persist(d);
  recordPending([{ type: 'node', id: node.id, change: 'modified', summary: args.name != null ? `renamed to ${node.name}` : `updated ${node.name}` }]);
  console.log(`Updated ${node.kind} ${node.name}.`);
}

function editMember(pos, args) {
  // edit member <Class> <Name> [--name New] [--type T] [--params P] [--vis +] [--mods ...] [--note]
  const [cls, name] = pos;
  if (!cls || !name)
    fail('Usage: artisan edit member <Class> <Name> [--name New] [--type T] [--params P] [--vis +] [--mods static,abstract] [--note "..."]');
  const d = loadDiagram();
  const node = findNode(d, cls);
  const { s, m } = findMember(node, name, args.kind);
  if (args.name != null) m.name = String(args.name); // id stays — diff reports the rename
  if (args.type != null) m.type = String(args.type);
  if (s === 'methods') {
    if (args.params != null) m.params = String(args.params);
  } else if (args.params != null) fail(`--params only applies to methods (${node.name}.${m.name} is an ${s === 'attributes' && node.kind === 'enum' ? 'enum value' : 'attribute'}).`);
  if (args.vis != null) m.vis = String(args.vis);
  if (args.mods != null) m.mods = String(args.mods).split(',').map((x) => x.trim()).filter(Boolean);
  if (args.note != null) {
    if (args.note === true) delete m.note;
    else m.note = String(args.note);
  }
  persist(d);
  recordPending([{ type: 'member', id: m.id, nodeId: node.id, change: 'modified', summary: `${node.name}.${m.name}: updated` }]);
  console.log(`Updated ${node.name}.${m.name}.`);
}

function editEdge(pos, args) {
  const [from, to] = pos;
  if (!from || !to) fail('Usage: artisan edit edge <From> <To> [--kind K] [--new-kind K] [--label L] [--from-mult A] [--to-mult B] [--label-off]');
  const d = loadDiagram();
  const e = findEdge(d, from, to, args.kind);
  const a = d.nodes.find((n) => n.id === e.from);
  const b = d.nodes.find((n) => n.id === e.to);
  if (args['new-kind'] != null) {
    const k = String(args['new-kind']).toLowerCase();
    if (!EDGE_KINDS.has(k)) fail(`Unknown relation kind "${k}" — one of: ${[...EDGE_KINDS].join(', ')}`);
    e.kind = k;
  }
  if (args['label-off']) e.label = '';
  else if (args.label != null) e.label = String(args.label);
  if (args['from-mult'] != null) e.fromMult = args['from-mult'] === true ? '' : String(args['from-mult']);
  if (args['to-mult'] != null) e.toMult = args['to-mult'] === true ? '' : String(args['to-mult']);
  persist(d);
  recordPending([{ type: 'edge', id: e.id, change: 'modified', summary: `relation ${a.name} → ${b.name}: updated` }]);
  console.log(`Updated ${e.kind} relation ${a.name} -> ${b.name}.`);
}

export function runEdit(argv) {
  const [slot, ...rest] = argv;
  const { pos, args } = parseFlags(rest);
  switch ((slot || '').toLowerCase()) {
    case 'node': return editNode(pos, args);
    case 'member': return editMember(pos, args);
    case 'edge': return editEdge(pos, args);
    default:
      fail(`Usage: artisan edit <node|member|edge> ...\n\n  artisan edit node <Name> [--name New] [--kind K] [--x N --y N] [--note "..."]\n  artisan edit member <Class> <Name> [--name New] [--type T] [--params P] [--vis +] [--mods static,abstract] [--note "..."]\n  artisan edit edge <From> <To> [--kind K] [--new-kind K] [--label L] [--from-mult A] [--to-mult B]`);
  }
}

// ---- remove --------------------------------------------------------------

function removeNode(pos) {
  if (!pos[0]) fail('Usage: artisan remove node <Name>');
  const d = loadDiagram();
  const node = findNode(d, pos[0]);
  d.nodes = d.nodes.filter((n) => n.id !== node.id);
  const before = d.edges.length;
  d.edges = d.edges.filter((e) => e.from !== node.id && e.to !== node.id);
  const dropped = before - d.edges.length;
  persist(d);
  console.log(`Removed ${node.name}${dropped ? ` (and ${dropped} relation${dropped === 1 ? '' : 's'})` : ''}.`);
}

function removeMember(pos, args) {
  // remove member <Class> <Name> [--kind attribute|method|value]
  const [cls, name] = pos;
  if (!cls || !name) fail('Usage: artisan remove member <Class> <Name> [--kind attribute|method|value]');
  const d = loadDiagram();
  const node = findNode(d, cls);
  const { s, m } = findMember(node, name, args.kind);
  node[s] = node[s].filter((x) => x !== m);
  persist(d);
  console.log(`Removed ${node.name}.${m.name}.`);
}

function removeEdge(pos, args) {
  const [from, to] = pos;
  if (!from || !to) fail('Usage: artisan remove edge <From> <To> [--kind K]');
  const d = loadDiagram();
  const e = findEdge(d, from, to, args.kind);
  const a = d.nodes.find((n) => n.id === e.from);
  const b = d.nodes.find((n) => n.id === e.to);
  d.edges = d.edges.filter((x) => x !== e);
  persist(d);
  console.log(`Removed ${e.kind} relation ${a.name} -> ${b.name}.`);
}

export function runRemove(argv) {
  const [slot, ...rest] = argv;
  const { pos, args } = parseFlags(rest);
  switch ((slot || '').toLowerCase()) {
    case 'node': return removeNode(pos);
    case 'member': return removeMember(pos, args);
    case 'edge': return removeEdge(pos, args);
    default:
      fail(`Usage: artisan remove <node|member|edge> ...\n\n  artisan remove node <Name>\n  artisan remove member <Class> <Name> [--kind attribute|method|value]\n  artisan remove edge <From> <To> [--kind K]`);
  }
}

// Open the editor app. Existing diagram.json is embedded fresh into
// diagram.html; with no diagram yet, a fresh empty one is created first.
export function runEditor() {
  let d = readJSON(artisanDir('diagram.json'));
  if (!d) {
    d = normalizeDiagram({ seq: 1, projectNotes: '', nodes: [], edges: [] });
    fs.mkdirSync('.artisan', { recursive: true });
    writeJSON(artisanDir('diagram.json'), d);
  }
  const dist = findEditorDist();
  if (!dist) fail('No editor build found — install the artisan-uml npm package (pnpm install) or set ARTISAN_EDITOR.');
  writeEmbedded(dist, d, readJSON(artisanDir('pending.json')) || []);
  const target = 'file://' + path.resolve(artisanDir('diagram.html'));
  for (const cmd of ['xdg-open', 'open']) {
    try {
      spawn(cmd, [target], { stdio: 'ignore', detached: true }).on('error', () => {});
      break;
    } catch {
      /* try next */
    }
  }
  console.log(`Editor written to .artisan/diagram.html\nOpening in your browser... (${target})`);
}
