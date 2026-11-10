# Commands

> **Language support:** the scanner speaks C# only today (Unity-friendly).
> A second language plugs into the shared extractor `lib/extract.mjs` — see the
> README's *Supported languages*.

```bash
artuml help          # overview
artuml help <cmd>    # detailed help for one command
```

## Core

| Command | What it does |
| --- | --- |
| `artuml scan` | Parse C# → `.artisan/diagram.json` + `diagram.puml` + single-file `diagram.html`. Re-scan keeps positions and notes. Seeds `.artisan/config.json` with defaults if absent. |
| `artuml diff [--json] [--peek]` | Human diagram changes → markdown report for the agent (renames detected, removals ask). Consumes them. `--peek` reports **without** consuming — for look-only checks (`status` does this internally). |
| `artuml impl-diff [--src DIR] [--json]` | Diagram vs code, read-only: diagram items missing from the code, code drift not in the diagram, signature mismatches. Marks nothing seen — run it after `diff` in `/artisan-implement` to catch anything acked or scanned out-of-band. Writes `.artisan/impl-diff.json` so the editor can show its "Code out of sync" badge. |
| `artuml scaffold [--src DIR] [--json] [--yes]` | Apply the impl-diff result to the code: create stub files/members for diagrammed-but-missing items, patch signature mismatches, apply renames silently, move files when a node's `dir` changed (sole-type files only). Removals (code not in the diagram) are gated behind one `y/n` prompt — `--yes` skips it; non-interactive shells remove nothing and list candidates. Refreshes `impl-diff.json`, so the editor badge clears. |
| `artuml config [key] [value]` | Read config (no args: everything; one key: its value) or set `artuml config <key> <value>` — validated and written to the project file. Also `artuml help config`. |
| `artuml mark-ai` | After agent edits to `diagram.json`: merge them into pending as new refs (existing unacknowledged refs are kept) — amber in editor. Diffing against `last-ai.json` means human edits already consumed by `diff` are never misattributed as AI changes. |
| `artuml ack` | Mark pending agent changes as seen by the human. |
| `artuml status` | Diagram size, pending changes in both directions — plus, when human changes exist, the actual change report as a non-consuming peek. |
| `artuml help [<cmd>]` | Help overview, or detailed help for one command. |
| `artuml editor` | Open the editor app in your browser (`app` alias). |
| `artuml serve [--port N]` | Optional localhost server: live autosave + pending API. With `autoServe: true` in config, every command starts it on demand. |

## Editing from the terminal

These are **human edits** — the agent picks them up via `artuml diff`.

### Add

```bash
artuml add node <Name> [--kind class|abstract|interface|enum|record|struct]
              [--x N --y N] [--note "..."] [--dir PATH]
artuml add member <Class> <attribute|method|value> <Name>
              [--type T] [--params P] [--vis +|-|#|~]
              [--mods static,abstract,...] [--note "..."]
artuml add edge <From> <To> [--kind inheritance|realization|composition|
              aggregation|association|dependency]
              [--label L] [--from-mult A] [--to-mult B]
```

New nodes without `--x/--y` are auto-placed next to their neighbours. Duplicate
classes, duplicate relations and enum values on non-enums are rejected.

### Edit

```bash
artuml edit node <Name> [--name New] [--kind K] [--x N --y N] [--note "..."]
               [--dir PATH]
artuml edit member <Class> <Name> [--name New] [--type T] [--params P]
              [--vis +] [--mods static,abstract] [--note "..."]
artuml edit edge <From> <To> [--kind K] [--new-kind K] [--label L]
              [--from-mult A] [--to-mult B]
```

`--name` keeps the item id — `diff` reports it as a rename. `--note` alone (a
bare flag) clears the note; `--label-off` clears a relation label. When a pair
of classes has several relations, select with `--kind`. `--dir` sets a node's
directory (project-root-relative, e.g. `src/Combat`) — `artuml scaffold`
creates/moves that type's file there; `--dir` alone clears it. The editor has
the same control: right-click a class → **Set directory…**, and the toolbar
**Dir** button sets the project default.

### Remove

```bash
artuml remove node <Name>
artuml remove member <Class> <Name> [--kind attribute|method|value]
artuml remove edge <From> <To> [--kind K]
```

`rm` is an alias. Removing a node cascades its relations. Pass `--kind` when a
member name is ambiguous (attribute + method with the same name).

## Notes everywhere

Notes bind your agent: on classes, members and relations (via the editor or
`--note`), plus project-level notes (the editor's **Notes** button). `diff`
surfaces all of them in the report, and scan/plantUML keep them.

## Config

Optional settings live in two places — the project file wins:

1. `.artisan/config.json` (per project; `scan` seeds it with the defaults)
2. `~/.config/artuml/config.json` (global fallback)

Read or write them without an editor via `artuml config`:
`artuml config` prints everything, `artuml config stubBody` prints one key,
`artuml config stubBody empty` sets it (validated).

| Key | Default | Meaning |
| --- | --- | --- |
| `askBeforeRemove` | `true` | `artuml scaffold` prompts once before removing code the diagram no longer declares. `false` = remove without asking. |
| `autoServe` | `false` | Every `artuml` command then ensures `artuml serve` is running (probes `localhost:4173/api/status`, starts it if absent). |
| `scaffoldDir` | *(src root)* | Default directory for class files `artuml scaffold` creates — seeded by `scan` to the `--src` root. Per-node `dir` overrides it for that type. |
| `stubBody` | `"throw"` | Method stub bodies scaffold writes: `"throw"` = `throw new NotImplementedException();`, `"empty"` = `{ }`, `"todo"` = body with a `// TODO: scaffold` comment. |
