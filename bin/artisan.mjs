#!/usr/bin/env node
// artisan — human-first class diagrams for agentic coding.
// Commands: scan | serve | diff | mark-ai | ack | status | help
import { runScan } from '../lib/scan.mjs';
import { runServe } from '../lib/serve.mjs';
import { runDiff, markAi, runAck, runReject, runStatus } from '../lib/diff.mjs';
import { runAdd, runEdit, runRemove, runEditor } from '../lib/edit.mjs';
import { artisanDir, readJSON } from '../lib/store.mjs';
import { assertEditorContract } from '../lib/contract.mjs';

const HELP = `artisan — human-first class diagrams for agentic coding

Usage: artisan <command> [options]

Commands:
  scan    [--src DIR] [--lang csharp]   Parse code into .artisan/diagram.json (+ .puml)
                                        and write .artisan/diagram.html — a single
                                        self-contained editor file; just open it.
                                        Re-scan keeps your positions and notes.
  serve   [--port N]                    (Optional) serve the editor at localhost
                                        with live autosave to .artisan/diagram.json.
  diff    [--json]                      Report human diagram changes the AI has not
                                        consumed yet (renames detected). Marks them seen.
  mark-ai                                After the AI edits .artisan/diagram.json:
                                        records changes as pending for the human
                                        (shown amber in the editor + diagram.html).
  ack                                   Mark pending AI changes as seen by the human.
  reject [node|member|edge:<id>:<change> ...]
                                        Undo pending AI changes: per-ref keys revert
                                        just that change; no keys restores the last
                                        human state and clears everything.
  status                                Show unseen human changes / pending AI changes.
  add     node|member|edge ...          Edit the diagram from the terminal:
                                          add node <Name> [--kind class] [--x N --y N] [--note "..."]
                                          add member <Class> <attribute|method|value> <Name>
                                                      [--type T] [--params P] [--vis +]
                                                      [--mods static,abstract] [--note "..."]
                                          add edge <From> <To> [--kind association]
                                                      [--label L] [--from-mult A] [--to-mult B]
  editor                                Open the Artisan UML editor app (bundled from
                                        the artisan-uml package) in your browser.
  edit    node|member|edge ...          Update existing diagram items:
                                          edit node <Name> [--name New] [--kind K]
                                                      [--x N --y N] [--note "..."]
                                          edit member <Class> <Name> [--name New]
                                                      [--type T] [--params P] [--vis +]
                                                      [--mods static,abstract] [--note "..."]
                                          edit edge <From> <To> [--kind K] [--new-kind K]
                                                      [--label L] [--from-mult A] [--to-mult B]
  remove  node|member|edge ...          Delete diagram items (edges cascade with nodes):
                                          remove node <Name>
                                          remove member <Class> <Name> [--kind attribute|method|value]
                                          remove edge <From> <To> [--kind K]
  help    [command]                     Show this help, or detailed help for one command.

Files under .artisan/:
  diagram.json   the source of truth (edit it in the editor)
  diagram.html   the editor as ONE file — double-click to open, no server needed
  diagram.puml   PlantUML mirror for AI consumption
  map.json       node id -> source file / namespace
  last-ai.json   snapshot the AI last consumed
  last-human.json snapshot the human last acknowledged
  pending.json   AI changes the human has not seen yet
  changelog.json append-only history of changes and acks

Environment:
  ARTISAN_EDITOR   path to a built editor (dist/) to copy on scan
`;

const TOPICS = {
  scan: `artisan scan [--src DIR] [--lang csharp]

  Parse your code into .artisan/ and write the self-contained editor:
    diagram.json   source of truth (positions, notes, relations)
    diagram.html   editor as ONE file — double-click to open
    diagram.puml   PlantUML mirror for your coding agent
    map.json / snapshots / pending / changelog

  Re-scan keeps your positions and notes. Languages: C# first.`,
  serve: `artisan serve [--port N]

  (Optional) serve the editor at http://localhost:4173 with live
  autosave to .artisan/diagram.json. Not needed — diagram.html
  already opens as a single file.`,
  diff: `artisan diff [--json]

  Report the human diagram changes your coding agent has not seen
  yet (renames detected, removals ask before deleting). Marks them
  as consumed. --json emits machine-readable output.`,
  'mark-ai': `artisan mark-ai

  After the AGENT edits .artisan/diagram.json: record its changes as
  pending for the human — shown amber in the editor with a Mark
  seen button.`,
  ack: `artisan ack

  Mark pending AI changes as seen by the human (clears the amber
  highlights).`,
  status: `artisan status

  Show unseen human changes and pending AI changes at a glance.`,
  add: `artisan add <node|member|edge> ...

  add node <Name> [--kind class|abstract|interface|enum|record|struct]
                 [--x N --y N] [--note "..."]
  add member <Class> <attribute|method|value> <Name>
             [--type T] [--params P] [--vis +|-|#|~]
             [--mods static,abstract,...] [--note "..."]
  add edge <From> <To> [--kind inheritance|realization|composition|
                       aggregation|association|dependency]
           [--label L] [--from-mult A] [--to-mult B]

  These are HUMAN edits — your agent sees them via \`artisan diff\`.`,
  edit: `artisan edit <node|member|edge> ...

  edit node <Name> [--name New] [--kind K] [--x N --y N] [--note "..."]
  edit member <Class> <Name> [--name New] [--type T] [--params P]
              [--vis +] [--mods static,abstract] [--note "..."]
  edit edge <From> <To> [--kind K] [--new-kind K] [--label L]
            [--from-mult A] [--to-mult B]

  Renames keep the item id — \`artisan diff\` reports them as renames.`,
  remove: `artisan remove <node|member|edge> ...   (alias: rm)

  remove node <Name>
  remove member <Class> <Name> [--kind attribute|method|value]
  remove edge <From> <To> [--kind K]

  Removing a node cascades its relations. Pass --kind when a pair
  of classes has several relations or a class has members sharing
  a name.`,
  editor: `artisan editor     (alias: app)

  Open the Artisan UML editor app (bundled from the artisan-uml
  package) in your browser. Creates .artisan/diagram.json if none
  exists yet.`,
};

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
}

switch (cmd) {
  case 'scan':
    try {
      assertEditorContract();
    } catch (e) {
      fail(e.message);
    }
    runScan({ src: typeof args.src === 'string' ? args.src : '.', lang: args.lang || 'csharp' });
    break;
  case 'serve': {
    const port = typeof args.port === 'string' ? parseInt(args.port, 10) : 4173;
    runServe({ port: Number.isFinite(port) ? port : 4173 });
    break;
  }
  case 'diff':
    if (!readJSON(artisanDir('diagram.json'))) fail('No .artisan/diagram.json — run `artisan scan` first.');
    runDiff({ json: !!args.json });
    break;
  case 'mark-ai':
    if (!readJSON(artisanDir('diagram.json'))) fail('No .artisan/diagram.json — run `artisan scan` first.');
    markAi();
    break;
  case 'ack':
    if (!readJSON(artisanDir('diagram.json'))) fail('No .artisan/diagram.json — run `artisan scan` first.');
    runAck({ keys: rest.filter((a) => /^(node|member|edge):/.test(a)) });
    break;
  case 'reject':
    if (!readJSON(artisanDir('diagram.json'))) fail('No .artisan/diagram.json — run `artisan scan` first.');
    runReject({ keys: rest.filter((a) => /^(node|member|edge):/.test(a)) });
    break;
  case 'status':
    runStatus();
    break;
  case 'add':
    try {
      runAdd(rest);
    } catch (e) {
      fail(e.message);
    }
    break;
  case 'edit':
    try {
      runEdit(rest);
    } catch (e) {
      fail(e.message);
    }
    break;
  case 'remove':
  case 'rm':
    try {
      runRemove(rest);
    } catch (e) {
      fail(e.message);
    }
    break;
  case 'editor':
  case 'app':
    try {
      runEditor();
    } catch (e) {
      fail(e.message);
    }
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined: {
    const topic = rest[0];
    if (!topic) console.log(HELP);
    else {
      const t = TOPICS[topic === 'rm' ? 'remove' : topic];
      if (!t) fail(`No help topic: ${topic}\n\nTopics: ${Object.keys(TOPICS).join(', ')}`);
      console.log(t);
    }
    break;
  }
  default:
    fail(`Unknown command: ${cmd}\n\n${HELP}`);
}
