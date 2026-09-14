<div align="center">
  <img src="assets/wordmark.svg" alt="Artisan UML CLI" width="300" />

  <h2>CLI</h2>
</div>

A zero-dependency Node CLI (≥18) that keeps your code and a class diagram in sync —
built for **agentic workflows** (opencode, Claude Code, Codex). It scans your C#
into an editable UML diagram, lets you redesign the architecture **by hand** in the
editor, and turns those decisions back into code — while tracking who changed what,
human or agent.

Architecture decisions stay yours. The diagram is the meeting point: agents read it
(`diagram.puml`), the human edits it (`diagram.html`), and `artisan` reconciles both
sides. Any agentic workflow can drive this package from the terminal — no special
plugins required.

[![npm](https://img.shields.io/npm/v/artisan-uml-cli)](https://www.npmjs.com/package/artisan-uml-cli)
![Node](https://img.shields.io/badge/node-%E2%89%A518-green)
![Deps](https://img.shields.io/badge/dependencies-zero-brightgreen)

## Why

The editor, [`artisan-uml`](https://www.npmjs.com/package/artisan-uml), makes designing
architecture fluid. This CLI plugs it into the loop you actually work in: an agentic
coding workflow. One command scans your C# into the editor; another reads your diagram
edits and refactors the code — detecting **renames** (not delete-then-recreate),
scaffolding new classes, and never touching existing members without asking. Notes you
write on classes, members or the project become instructions agents honor.

## Quick start

```bash
npm install -g artisan-uml-cli

cd your-unity-project
artisan scan
```

Then open **`.artisan/diagram.html`** — the editor as one self-contained file, no
server needed. Click **Connect file** once so your edits autosave to
`.artisan/diagram.json`. The bundled editor is the published
[`artisan-uml`](https://www.npmjs.com/package/artisan-uml) package, inlined into the file.

### With your coding agent

The main [Artisan repo](https://github.com/oscardelgado02/artisan) ships slash-command
packs (`/artisan-scan`, `/artisan-diff`, `/artisan-implement`, `/artisan-architect`,
`/artisan-status`) for opencode, Claude Code and Codex — its `install.sh` copies them
into your agent's command folder. Without them, any agent can still work from this
document: run `artisan diff` and read its markdown report, edit `.artisan/diagram.json`
and run `artisan mark-ai`.

## The workflow

1. **`artisan scan`** — parses your C# into `.artisan/diagram.json` + a PlantUML mirror
   agents read. Re-scan keeps your positions and notes.
2. **You redesign** in the editor: drag, rewire, rename, add classes, write notes.
3. **`artisan diff`** — compares the diagram against the last known state and prints a
   markdown report for your agent: *rename these*, *scaffold these*, *notes to honor*.
   Removals are never auto-deleted; the agent must ask.
4. **The agent implements** — refactors renames, scaffolds new code, writes bodies per
   your notes.
5. **`artisan mark-ai`** — when an *agent* restructures the diagram, its changes show up
   **amber** in the editor until you press **Mark seen** (`artisan ack`).
6. **`artisan status`** — size, pending changes in both directions.

## Commands

| Command | What it does |
| --- | --- |
| `artisan scan` | Parse C# → diagram (merges your edits: positions and notes survive) + writes `.artisan/diagram.html` |
| `artisan serve` | (optional) editor at `http://localhost:4173`, live autosave |
| `artisan diff` | Human diagram edits → markdown report for the agent; consumes them |
| `artisan mark-ai` | Record agent-made `diagram.json` edits as pending (amber in editor) |
| `artisan ack` | Human confirms agent changes seen (or the "Mark seen" button) |
| `artisan status` | Diagram size, pending changes both directions |
| `artisan add node <Name> [--kind ...] [--x --y] [--note]` | Add a class box from the terminal (auto-placed unless positioned) |
| `artisan add member <Class> <attribute\|method\|value> <Name> [--type --params --vis --mods --note]` | Add members to an existing class |
| `artisan add edge <From> <To> [--kind --label --from-mult --to-mult]` | Add a relation between two classes |
| `artisan editor` | Open the Artisan UML editor app (bundled from the `artisan-uml` package) — creates `.artisan/` with an empty diagram if none exists |

Scan skips `Library/`, `obj/`, `bin/`, `Temp/`, `Logs/`, `Packages/`, `Editor/` —
Unity-aware out of the box.

### How relations are detected

| Kind | Detected from |
| --- | --- |
| Inheritance (extends) | `class Dog : Animal` |
| Realization (implements) | `class Dog : IPet` (interface base; Unity convention: `IFoo` → `Foo` also linked) |
| Composition (owns) | field initialized inline: `Engine engine = new Engine();` |
| Aggregation (has-a) | collection-typed field: `List<Weapon> weapons;` / `Weapon[] slots;` |
| Association | plain field of a scanned type: `Engine engine;` |
| Dependency | method parameter/return type references a scanned type (only when no stronger edge links the pair) |

Layout is layered — roots (no parents) on top, children below, so inheritance trees
read top-down. These are pragmatic heuristics: hand-tune relations and positions in the
editor, and re-scan keeps your edits.

## The `.artisan/` directory

Everything the CLI knows lives here, next to your project:

| File | Meaning |
| --- | --- |
| `diagram.json` | source of truth (nodes, edges, notes, positions) |
| `diagram.puml` | PlantUML mirror — what agents read |
| `map.json` | type → source file |
| `last-ai.json` / `last-human.json` | change-tracking baselines |
| `pending.json` | Agent changes the human hasn't seen yet |
| `changelog.json` | history of consumed changes |
| `editor/` | bundled editor assets (inlined into `diagram.html`) |
| `diagram.html` | the editor as a single self-contained file |

Commit it or ignore it — it regenerates from source with `artisan scan`, but your
notes and layout survive re-scans, so committing keeps that history.

## Project structure

```
├── bin/artisan.mjs        entry point: command dispatch
├── lib/
│   ├── csharp.mjs         pragmatic C# parser (types, members, nesting, partials)
│   ├── diagram.mjs        relation detection + layered auto-layout
│   ├── scan.mjs           the scan command: merge, snapshots, layout
│   ├── diff.mjs           change tracking: renames, pending refs, reports
│   ├── edit.mjs           add node/member/edge commands + `artisan editor`
│   ├── embed.mjs          inlines the editor into the single-file diagram.html
│   ├── serve.mjs          optional localhost server (live autosave + pending API)
│   ├── contract.mjs       editor contract guard (see below)
│   └── store.mjs          .artisan paths, JSON persistence, stable ids
└── test/run.mjs           self-checks: parser, diff engine, scan flow, layout
```

## Editor contract

The bundled editor comes from the
[`artisan-uml`](https://www.npmjs.com/package/artisan-uml) npm package. Its
`layout-constants.mjs` pins the box-size math the CLI mirrors when estimating node
sizes before your browser measures them; this package's `editorContract` field must
match the editor's `CONTRACT_VERSION`. A mismatch **fails loudly on `artisan scan`**
instead of silently corrupting the layout. For development, a local
`ARTISAN_EDITOR=path/to/dist` overrides the installed editor.

## Development

```bash
pnpm install        # links the workspace/registry editor package
pnpm test           # parser, diff engine, scan flow, layout checks
node bin/artisan.mjs help
```

## License

[MIT](LICENSE) © Óscar Delgado
