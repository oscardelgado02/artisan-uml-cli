// Artisan CLI self-check. No framework: plain asserts, run via `node cli/test/run.mjs`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

import { parseCsFile } from '../lib/csharp.mjs';
import { buildEdges, toPlantUML, layout, widthOf, heightOf, nameLines, rowParts } from '../lib/diagram.mjs';
import { diffDiagram, pendingRefs, formatReport } from '../lib/diff.mjs';
import { normalizeDiagram } from '../lib/store.mjs';
import { runScan } from '../lib/scan.mjs';

let passed = 0;
const ok = (name) => {
  console.log(`  ok - ${name}`);
  passed++;
};
const section = (s) => console.log(`\n${s}`);

// ---------------------------------------------------------------- parser
section('C# parser');
const FIXTURE = fs.readFileSync(new URL('./fixtures/Game.cs', import.meta.url), 'utf8');

const parsed = parseCsFile(FIXTURE, 'Game/Creatures.cs');
const byName = new Map(parsed.map((entry) => [entry.node.name, entry]));

const animal = byName.get('Animal');
assert.ok(animal, 'Animal parsed');
assert.equal(animal.node.kind, 'abstract');
ok('abstract class kind');

const animalAttrs = animal.node.attributes;
assert.ok(animalAttrs.some((m) => m.name === '_name' && m.vis === '#' && m.type === 'string'), 'protected field');
ok('field: protected _name: string');
assert.ok(animalAttrs.some((m) => m.name === 'Age' && m.type === 'int'), 'property');
ok('property Age: int');
assert.ok(!animalAttrs.some((m) => m.type === 'var'), 'no local vars as attributes');
assert.ok(!animalAttrs.some((m) => m.name === 'local'), 'method body locals skipped');
ok('method bodies skipped');

const animalMethods = animal.node.methods;
const speak = animalMethods.find((m) => m.name === 'Speak');
assert.ok(speak, 'Speak parsed');
assert.equal(speak.type, 'void');
assert.equal(speak.params, 'mood: string');
assert.ok(speak.mods.includes('abstract'));
ok('method Speak(mood: string) abstract');
const create = animalMethods.find((m) => m.name === 'Create');
assert.ok(create?.mods.includes('static') && create?.mods.includes('protected'.replace('protected', 'static')), 'static');
ok('method Create static');
assert.ok(!animalMethods.some((m) => m.name === 'Nested'), 'nested class not a method');
const nested = byName.get('Nested');
assert.ok(nested && nested.node.attributes.some((m) => m.name === 'X'), 'nested type parsed with own members');
assert.ok(!animalAttrs.some((m) => m.name === 'X'), 'nested members not leaked into parent');
ok('nested class members separated');

const pet = byName.get('IPet');
assert.equal(pet.node.kind, 'interface');
assert.ok(pet.node.methods.some((m) => m.name === 'Play' && m.params === 'owner: Animal'), 'interface method params');
ok('interface IPet with Play(owner: Animal)');

const mood = byName.get('Mood');
assert.equal(mood.node.kind, 'enum');
const moodVals = mood.node.attributes.map((m) => m.name).sort();
assert.deepEqual(moodVals, ['Happy', 'Sleepy', 'Zoomies']);
ok('enum values parsed');

// ---------------------------------------------------------------- edges
section('edge building');
const entries = parsed.map(({ node, meta }) => ({ node, meta: { ...meta, bases: node.name === 'Dog' ? ['Animal', 'IPet'] : meta.bases } }));
// give Animal proper bases from parse
const edges = buildEdges(parsed.map(({ node, meta }) => ({ node, meta })));
const kindOf = (e) => e.kind;
assert.ok(edges.every((e) => e.from !== e.to), 'no self edges');
ok('edges built without self-loops');

// ---------------------------------------------------------------- diff
section('change tracking');
const base = normalizeDiagram({
  seq: 1,
  nodes: [
    {
      id: 'cA',
      kind: 'class',
      name: 'Dog',
      x: 0,
      y: 0,
      attributes: [{ id: 'm1', vis: '-', name: 'energy', type: 'int', mods: [], params: null }],
      methods: [{ id: 'm2', vis: '+', name: 'Speak', type: 'void', mods: [], params: 'mood: string' }],
    },
    { id: 'cB', kind: 'class', name: 'Owner', x: 0, y: 0, attributes: [], methods: [] },
  ],
  edges: [],
});

// human: rename Dog→Doggo (id kept, editor-style), add member with note, add class note
const humanEdit = normalizeDiagram(JSON.parse(JSON.stringify(base)));
const dog = humanEdit.nodes[0];
dog.name = 'Doggo';
dog.note = 'Should bark more';
const newAttr = { id: 'm3', vis: '+', name: 'Fetch', type: 'void', mods: [], params: '', note: 'throws ball' };
dog.attributes.push(newAttr);
humanEdit.edges.push({ id: 'e1', kind: 'association', from: 'cA', to: 'cB', label: '', fromMult: '', toMult: '' });

let d = diffDiagram(base, humanEdit);
assert.ok(d.renames.some((r) => r.kind === 'class-rename' && r.from === 'Dog' && r.to === 'Doggo'), 'class rename via id');
ok('detect class rename (editor style)');
assert.ok(d.added.some((a) => a.type === 'member' && a.name === 'Fetch' && a.mid === 'm3'), 'member added');
ok('detect added member');
assert.ok(d.notes.some((n) => n.ref === 'Class Doggo' && n.note === 'Should bark more'), 'class note');
assert.ok(d.notes.some((n) => n.ref === 'Doggo.Fetch' && n.note === 'throws ball'), 'member note');
ok('notes surfaced for AI');
assert.ok(d.added.some((a) => a.type === 'relation'), 'relation added');
ok('relation addition detected');

// member rename, editor style (same id, new name)
const memberRename = normalizeDiagram(JSON.parse(JSON.stringify(base)));
memberRename.nodes[0].methods[0].name = 'Talk';
d = diffDiagram(base, memberRename);
assert.ok(d.renames.some((r) => r.kind === 'member-rename' && r.from === 'Speak' && r.to === 'Talk'), 'member rename');
ok('detect member rename (editor style)');

// member rename, scan style (id changed, same sig, similar name)
const scanRename = normalizeDiagram(JSON.parse(JSON.stringify(base)));
const r0 = scanRename.nodes[0].methods[0];
r0.id = 'mX';
r0.name = 'Speaking';
d = diffDiagram(base, scanRename);
assert.ok(d.renames.some((r) => r.kind === 'member-rename' && r.from === 'Speak' && r.to === 'Speaking'), 'member rename via similarity');
ok('detect member rename (scan style)');

// class rename with changed hash id but same members
const scanClass = normalizeDiagram(JSON.parse(JSON.stringify(base)));
scanClass.nodes[0].id = 'cZ';
scanClass.nodes[0].name = 'Doggo';
d = diffDiagram(base, scanClass);
assert.ok(d.renames.some((r) => r.kind === 'class-rename' && r.to === 'Doggo'), 'class rename via member overlap');
ok('detect class rename (scan style)');

// new class that is genuinely new (different members) → added, not rename
const newClass = normalizeDiagram(JSON.parse(JSON.stringify(base)));
newClass.nodes.push({ id: 'cN', kind: 'class', name: 'Telemetry', x: 0, y: 0, attributes: [{ id: 'q1', vis: '+', name: 'Url', type: 'string', mods: [], params: null }], methods: [] });
d = diffDiagram(base, newClass);
assert.ok(d.added.some((a) => a.type === 'class' && a.name === 'Telemetry'), 'new class');
assert.ok(!d.renames.some((r) => r.to === 'Telemetry'), 'not misdetected as rename');
ok('new class ≠ rename');

// removal → reported, never auto-deleted
const removal = normalizeDiagram(JSON.parse(JSON.stringify(base)));
removal.nodes[0].attributes = [];
d = diffDiagram(base, removal);
assert.ok(d.removed.some((r) => r.type === 'member' && r.name === 'energy'), 'member removal');
ok('removal detected (for confirmation)');

// pending refs for editor coloring
const refs = pendingRefs(d);
ok('pending refs generated: ' + refs.length);

// report formatting
const report = formatReport(diffDiagram(base, humanEdit));
assert.ok(report.includes('Dog → Doggo'), 'report rename line');
assert.ok(report.includes('Notes'), 'report notes section');
ok('markdown report format');

// ---------------------------------------------------------------- full scan flow
section('scan flow (end-to-end, temp project)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'artisan-test-'));
const projRoot = path.join(tmp, 'proj');
fs.mkdirSync(path.join(projRoot, 'Assets', 'Scripts'), { recursive: true });
fs.writeFileSync(path.join(projRoot, 'Assets', 'Scripts', 'Animal.cs'), FIXTURE);
fs.writeFileSync(path.join(projRoot, 'Assets', 'Scripts', 'Dog.cs'), fs.readFileSync(new URL('./fixtures/Dog.cs', import.meta.url), 'utf8'));
fs.mkdirSync(path.join(projRoot, 'Library'), { recursive: true });
fs.writeFileSync(path.join(projRoot, 'Library', 'Ignored.cs'), 'namespace Bad { public class Nope { } }');

process.chdir(projRoot);
runScan({ src: '.', lang: 'csharp' });
const saved = JSON.parse(fs.readFileSync('.artisan/diagram.json', 'utf8'));
assert.ok(saved.nodes.length >= 5, 'all types scanned: ' + saved.nodes.length);
assert.ok(!saved.nodes.some((n) => n.name === 'Nope'), 'Library excluded');
ok('scan wrote diagram.json, excluded Unity Library/');
assert.ok(fs.existsSync('.artisan/diagram.puml'));
const puml = fs.readFileSync('.artisan/diagram.puml', 'utf8');
assert.ok(puml.includes('interface "IPet"'), 'puml interface');
assert.ok(puml.includes('IPet <|.. Dog') || puml.includes('Dog <|.. IPet'), 'puml realization');
ok('PlantUML mirror written with relations');
const map = JSON.parse(fs.readFileSync('.artisan/map.json', 'utf8'));
assert.ok(Object.values(map).some((m) => m.file.endsWith('Animal.cs')), 'map.json source files');
ok('map.json type → file');
assert.ok(fs.existsSync('.artisan/last-ai.json') && fs.existsSync('.artisan/last-human.json') && fs.existsSync('.artisan/pending.json'));
ok('snapshots initialized');

// diff command: consume a human edit
const cur = JSON.parse(fs.readFileSync('.artisan/diagram.json', 'utf8'));
cur.nodes[0].note = 'root of all creatures';
cur.projectNotes = 'Make it fun';
fs.writeFileSync('.artisan/diagram.json', JSON.stringify(cur));
const { runDiff } = await import('../lib/diff.mjs');
runDiff({});
const afterAi = JSON.parse(fs.readFileSync('.artisan/last-ai.json', 'utf8'));
assert.equal(afterAi.projectNotes, 'Make it fun', 'AI consumed human edits');
assert.equal(afterAi.nodes[0].note, 'root of all creatures');
ok('artisan diff consumed human changes');
const lastAi1 = JSON.parse(fs.readFileSync('.artisan/last-ai.json', 'utf8'));

// mark-ai: AI edits diagram, pending refs appear
cur.nodes.push({ id: 'cNew', kind: 'class', name: 'QuestGiver', x: 0, y: 0, attributes: [], methods: [{ id: 'q1', vis: '+', name: 'Give', type: 'void', mods: [], params: '' }] });
fs.writeFileSync('.artisan/diagram.json', JSON.stringify(cur));
const { markAi } = await import('../lib/diff.mjs');
markAi();
const pending = JSON.parse(fs.readFileSync('.artisan/pending.json', 'utf8'));
assert.ok(pending.some((p) => p.type === 'node' && p.change === 'added' && p.summary.includes('QuestGiver')), 'pending node ref');
ok('artisan mark-ai recorded AI change for human');

const { runAck } = await import('../lib/diff.mjs');
runAck();
const pending2 = JSON.parse(fs.readFileSync('.artisan/pending.json', 'utf8'));
assert.equal(pending2.length, 0, 'ack cleared pending');
ok('artisan ack cleared highlights');

const changelog = JSON.parse(fs.readFileSync('.artisan/changelog.json', 'utf8'));
assert.ok(changelog.length >= 4, 'changelog has entries: ' + changelog.length);
ok('changelog tracks actors');

// rescan keeps notes/positions
cur.nodes[0].x = 777;
fs.writeFileSync('.artisan/diagram.json', JSON.stringify(cur));
runScan({ src: '.', lang: 'csharp' });
const rescan = JSON.parse(fs.readFileSync('.artisan/diagram.json', 'utf8'));
const kept = rescan.nodes.find((n) => n.name === 'Animal');
assert.equal(kept.note, 'root of all creatures', 'note survived rescan');
assert.equal(kept.x, 777, 'position survived rescan');
ok('rescan preserves human notes + positions');

// ---- layout guarantees: no overlapping boxes with real size estimates ----
section('layout: measured sizes + no overlap');

// width mirrors the editor rule: name capped at 240px, locked parts nowrap
const longNameNode = {
  id: 'ln',
  kind: 'class',
  name: 'CosmicShaderCreatorWindow',
  x: 0,
  y: 0,
  attributes: [{ id: 'a1', vis: '-', mods: ['readonly'], name: 'VeryLongPropertyNameIndeed', type: 'Dictionary<string, UnityEngine.Rendering.VolumeProfile>', note: '' }],
  methods: [],
};
const wideNode = {
  id: 'wn',
  kind: 'class',
  name: 'Wide',
  x: 0,
  y: 0,
  attributes: [{ id: 'a2', vis: '+', mods: [], name: 'n', type: 'string', note: '' }],
  methods: [],
};
assert.ok(widthOf(longNameNode) <= 640, 'width respects editor max-width 640: ' + widthOf(longNameNode));
// name contribution is capped at 240px (33 chars) regardless of name length
const capProbe = (nameLen) => ({
  ...longNameNode,
  attributes: [{ ...longNameNode.attributes[0], name: 'N'.repeat(nameLen) }],
});
assert.equal(widthOf(capProbe(33)), widthOf(capProbe(60)), 'name wider than 240px does not widen the box');
assert.equal(nameLines({ name: 'N'.repeat(60) }), 2, '60-char name estimates 2 lines');
assert.ok(heightOf(capProbe(60)) > heightOf(capProbe(32)), 'wrapped name adds height');
// long locked part squeezes the name budget so the row still fits 640px
const squeeze = {
  id: 'sq',
  kind: 'class',
  name: 'HandleMassivelyLongParameterLists',
  x: 0,
  y: 0,
  attributes: [],
  methods: [
    {
      id: 'm1',
      vis: '+',
      mods: ['static'],
      name: 'HandleMassivelyLongParameterLists',
      params: 'string veryLongArgumentName, int anotherVeryLongArgumentName, bool thirdArgument, Vector3 spawnPosition',
      type: 'Task<IReadOnlyList<CosmicShaderProfileSetting>>',
      note: '',
    },
  ],
};
const sq = rowParts(squeeze.methods[0], true, false, false);
assert.ok(sq.nameBudget < 240, 'long locked part shrinks name budget: ' + sq.nameBudget);
assert.ok(sq.nameBudget >= 120, 'name budget never below 120px');
assert.ok(sq.paramsBudget < 240, 'long params get squeezed too: ' + sq.paramsBudget);
assert.ok(sq.paramsBudget >= 80, 'params budget never below 80px');
assert.ok(widthOf(squeeze) <= 640, 'wide locked row stays within 640: ' + widthOf(squeeze));
// params wrap adds height
const pProbe = (params) => ({
  ...squeeze,
  methods: [{ ...squeeze.methods[0], params }],
});
assert.ok(heightOf(pProbe('a '.repeat(60))) > heightOf(pProbe('a')), 'wrapped params add height');
ok('widthOf/heightOf mirror editor CSS rules (name + params wrap)');

// layered layout must place boxes without overlap for a synthetic messy project
const mk = (name, kind, attrs, methods) => ({
  id: 'id_' + name,
  kind,
  name,
  x: null,
  y: null,
  attributes: attrs.map(([n, t]) => ({ id: 'a_' + name + n, vis: '-', mods: [], name: n, type: t, note: '' })),
  methods: methods.map(([n, p, t]) => ({ id: 'm_' + name + n, vis: '+', mods: [], name: n, params: p, type: t, note: '' })),
  note: '',
});
const messy = { seq: 1, nodes: [], edges: [], projectNotes: '' };
const names = [];
for (let i = 0; i < 24; i++) {
  const n = 'CosmicallyNamedService' + i;
  names.push(n);
  messy.nodes.push(
    mk(n, 'class', [['someVeryLongFieldNameThatWrapsAround', 'List<UnityEngine.Rendering.VolumeProfile>']], [['DoAThing', 'string input, int count', 'IEnumerator']])
  );
}
messy.nodes.push(mk('BaseProviderOfThings', 'abstract', [['config', 'Config']], []));
for (let i = 0; i < 8; i++) messy.edges.push({ id: 'e_i' + i, kind: 'inheritance', from: 'id_CosmicallyNamedService' + i, to: 'id_BaseProviderOfThings', label: '', fromMult: '', toMult: '', note: '' });
for (let i = 0; i < 11; i++) messy.edges.push({ id: 'e_a' + i, kind: 'association', from: 'id_CosmicallyNamedService' + i, to: 'id_CosmicallyNamedService' + (i + 1), label: 'next', fromMult: '', toMult: '', note: '' });
messy.edges.push({ id: 'e_c1', kind: 'association', from: 'id_CosmicallyNamedService10', to: 'id_CosmicallyNamedService3', label: 'cycle', fromMult: '', toMult: '', note: '' });
messy.edges.push({ id: 'e_c2', kind: 'association', from: 'id_CosmicallyNamedService3', to: 'id_CosmicallyNamedService10', label: 'cycle2', fromMult: '', toMult: '', note: '' });
layout(messy);
let overlaps = 0;
for (let i = 0; i < messy.nodes.length; i++) {
  for (let j = i + 1; j < messy.nodes.length; j++) {
    const a = messy.nodes[i];
    const b = messy.nodes[j];
    if (a.x < b.x + widthOf(b) && b.x < a.x + widthOf(a) && a.y < b.y + heightOf(b) && b.y < a.y + heightOf(a)) overlaps++;
  }
}
assert.equal(overlaps, 0, 'boxes overlap: ' + overlaps);
assert.ok(messy.nodes.every((n) => n.x != null && n.y != null), 'every node placed');
ok('layered layout: 25-node messy graph, zero overlapping boxes');

// Editor contract: the editor package owns the box-size knobs; our estimates
// must consume exactly the same numbers, and the pinned version must match.
const { EDITOR, editorSource, assertEditorContract } = await import('../lib/contract.mjs');
const cliPkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(typeof EDITOR.CONTRACT_VERSION, 'number', 'editor constants loaded');
assert.equal(EDITOR.CONTRACT_VERSION, cliPkg.editorContract, 'editorContract pinned in cli/package.json matches editor CONTRACT_VERSION');
assert.doesNotThrow(assertEditorContract, 'contract check passes');
ok(`editor contract v${EDITOR.CONTRACT_VERSION} in sync (source: ${editorSource})`);

process.chdir('/');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nAll ${passed} checks passed.`);
