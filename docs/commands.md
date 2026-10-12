# Commands

```bash
artuml help          # overview
artuml help <cmd>    # detailed help for one command
```

## Core

| Command | What it does |
| --- | --- |
| `artuml scan` | Parse C# → `.artisan/diagram.json` + `diagram.puml` + single-file `diagram.html`. Re-scan keeps positions and notes. |
| `artuml diff [--json]` | Human diagram changes → markdown report for the agent (renames detected, removals ask). Consumes them. |
| `artuml impl-diff [--src DIR] [--json]` | Diagram vs code, read-only: diagram items missing from the code, code drift not in the diagram, signature mismatches. Marks nothing seen — run it after `diff` in `/artisan-implement` to catch anything acked or scanned out-of-band. Writes `.artisan/impl-diff.json` so the editor can show its "Code out of sync" badge. |
| `artuml mark-ai` | After agent edits to `diagram.json`: record as pending (amber in editor). |
| `artuml ack` | Mark pending agent changes as seen by the human. |
| `artuml status` | Diagram size, pending changes in both directions. |
| `artuml help [<cmd>]` | Help overview, or detailed help for one command. |
| `artuml editor` | Open the editor app in your browser (`app` alias). |
| `artuml serve [--port N]` | Optional localhost server: live autosave + pending API. |

## Editing from the terminal

These are **human edits** — the agent picks them up via `artuml diff`.

### Add

```bash
artuml add node <Name> [--kind class|abstract|interface|enum|record|struct]
              [--x N --y N] [--note "..."]
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
artuml edit member <Class> <Name> [--name New] [--type T] [--params P]
              [--vis +] [--mods static,abstract] [--note "..."]
artuml edit edge <From> <To> [--kind K] [--new-kind K] [--label L]
              [--from-mult A] [--to-mult B]
```

`--name` keeps the item id — `diff` reports it as a rename. `--note` alone (a
bare flag) clears the note; `--label-off` clears a relation label. When a pair
of classes has several relations, select with `--kind`.

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
