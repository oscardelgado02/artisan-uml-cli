<div align="center">
  <img src="assets/wordmark.svg" alt="Artisan UML CLI" width="300" />

  <h2>CLI</h2>
</div>

A zero-dependency Node CLI (≥18) that keeps your code and a class diagram in sync —
built for **agentic workflows** (opencode, Claude Code, Codex). It scans your C#
into an editable UML diagram, lets you redesign the architecture **by hand** in the
editor, and turns those decisions back into code — while tracking who changed what,
human or agent.

> **Language support:** C# only, for now. More languages are planned.

Architecture decisions stay yours. The diagram is the meeting point: agents read it
(`diagram.puml`), the human edits it (`diagram.html`), and `artisan` reconciles both
sides. Any agentic workflow can drive this package from the terminal — no special
plugins required.

[![npm](https://img.shields.io/npm/v/artisan-uml-cli)](https://www.npmjs.com/package/artisan-uml-cli)
![Node](https://img.shields.io/badge/node-%E2%89%A518-green)
![Deps](https://img.shields.io/badge/dependencies-zero-brightgreen)

## Why I built this

I'm [Óscar Delgado](https://oscardelgado.dev), a software engineer. I like to plan the architecture first and keep
it visible as the codebase grows, that's why I built the
[`artisan-uml`](https://github.com/oscardelgado02/artisan-uml) editor.

Agentic coding workflows changed how fast we build, but they brought a new problem:
agents happily create architecture on their own, new classes, new abstractions,
rewired dependencies, without any real control from the engineer, unless you write a
really specific prompt every time. The result is often code that works today and
drifts tomorrow, with no shared picture of the system.

This CLI is my answer for that side of the workflow. It turns your codebase into a
diagram you can *see*, gives you a fluid, visual space to make the architectural
decisions yourself, and then lets the agent do what it is great at, implementing them
fast. You keep the control and the overview; the agents keep the speed. Everyone
works from the same picture.

I released it as open source so that as many people as possible can use it. If it
helps you stay in the driver's seat of your next project, it was worth building.

## Quick start

```bash
pnpm install -g artisan-uml-cli
# or: npm install -g artisan-uml-cli

cd your-unity-project
artisan scan
```

`artisan` not on PATH (common in agent shells and non-login terminals)? Run the
package instead — same commands: `npx --yes artisan-uml-cli scan`.

Then open **`.artisan/diagram.html`** — the editor as one self-contained file, no
server needed. Click **Connect file** once so your edits autosave to
`.artisan/diagram.json`. The bundled editor is the published
[`artisan-uml`](https://www.npmjs.com/package/artisan-uml) package, inlined into the file.

### `editor` or `serve`?

Two ways to run the same editor:

| | `artisan editor` | `artisan serve` |
| --- | --- | --- |
| What runs | nothing — writes `diagram.html`, opens it | localhost HTTP server (`:4173`) |
| Autosave | browser File System Access API (**Connect file**, one click) | `PUT /api/diagram` over localhost |
| Extra | none | pending-changes API (`GET /api/pending`, `POST /api/ack`) |
| Browser | Chrome, Edge | any browser, incl. Firefox / Safari |

On Chrome/Edge, `editor` is all you need; `serve` is the fallback for browsers
without the file-handle API, or when you want the pending API.

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
   **amber** in the editor until you press **Mark seen** (`artisan ack`). Terminal edits
   (`add`/`edit`/`remove`) record the same refs, so they highlight and survive a reload too.
   Removals render as struck-through amber **tombstones** (classes, members, relations),
   and every item carries ✓ / ✕ chips for individual accept (`ack`) or reject.
6. **`artisan status`** — size, pending changes in both directions.

## Commands

| Command | What it does |
| --- | --- |
| `artisan scan` | Parse C# → diagram (merges your edits: positions and notes survive) + writes `.artisan/diagram.html` |
| `artisan serve` | (optional) editor at `http://localhost:4173`, live autosave; picks up external `diagram.json` changes and highlights them (rev-guarded: stale tabs can't clobber newer disk state) |
| `artisan diff` | Human diagram edits → markdown report for the agent; consumes them |
| `artisan impl-diff [--src DIR] [--json]` | Diagram ↔ code comparison (read-only): diagram items missing from the code, code drift not in the diagram, signature mismatches — so the agent can sync code after acks or out-of-band scans |
| `artisan mark-ai` | Record agent-made `diagram.json` edits as pending (amber in editor) |
| `artisan ack [refs...]` | Human confirms AI changes seen (or the editor's ✓ chips / "Mark seen" button); with keys like `node:Wolf:removed` accepts just those |
| `artisan reject [refs...]` | Undo pending AI changes — with keys like `node:Wolf:added` reverts exactly those (ghost-snapshot reverts); without keys restores `diagram.json` from the last human state |
| `artisan status` | Diagram size, pending changes both directions |
| `artisan add node <Name> [--kind ...] [--x --y] [--note]` | Add a class box from the terminal (auto-placed unless positioned) |
| `artisan add member <Class> <attribute\|method\|value> <Name> [--type --params --vis --mods --note]` | Add members to an existing class |
| `artisan add edge <From> <To> [--kind --label --from-mult --to-mult]` | Add a relation between two classes |
| `artisan edit node <Name> [--name --kind --x --y --note]` | Rename / re-kind / move / note a class (renames keep the id) |
| `artisan edit member <Class> <Name> [--name --type --params --vis --mods --note]` | Update an existing member |
| `artisan edit edge <From> <To> [--kind --new-kind --label --from-mult --to-mult]` | Update a relation (`--label-off` clears the label) |
| `artisan remove node <Name>` | Delete a class (its relations cascade) |
| `artisan remove member <Class> <Name> [--kind]` / `remove edge <From> <To> [--kind]` | Delete a member or relation |
| `artisan editor` | Open the Artisan UML editor app (bundled from the `artisan-uml` package) — creates `.artisan/` with an empty diagram if none exists |
| `artisan help [command]` | Overview or detailed help for one command |

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
| `pending.json` | Changes the human hasn't seen yet (agent `mark-ai` + terminal `add`/`edit`/`remove`) |
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

## Documentation

Full documentation lives in [`docs/`](docs/) and is hosted on GitHub Pages:
**[Documentation](https://cli.artisan-uml.dev/)** — getting
started, the workflow, commands, the `.artisan/` directory, relations and agent
packs.

## Community

- [Contributing](CONTRIBUTING.md) — dev setup, tests and PR expectations
- [Code of Conduct](CODE_OF_CONDUCT.md) — Contributor Covenant
- [Security](SECURITY.md) — how to report vulnerabilities privately

## License

[MIT](LICENSE) © Óscar Delgado
