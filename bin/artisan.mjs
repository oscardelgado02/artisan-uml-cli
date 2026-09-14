#!/usr/bin/env node
// artisan — human-first class diagrams for agentic coding.
// Commands: scan | serve | diff | mark-ai | ack | status | help
import { runScan } from '../lib/scan.mjs';
import { runServe } from '../lib/serve.mjs';
import { runDiff, markAi, runAck, runStatus } from '../lib/diff.mjs';
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
  status                                Show unseen human changes / pending AI changes.

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
    runAck();
    break;
  case 'status':
    runStatus();
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    console.log(HELP);
    break;
  default:
    fail(`Unknown command: ${cmd}\n\n${HELP}`);
}
