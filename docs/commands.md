# Commands

```bash
artisan help          # overview
artisan help <cmd>    # detailed help for one command
```

## Core

| Command | What it does |
| --- | --- |
| `artisan scan` | Parse C# → `.artisan/diagram.json` + `diagram.puml` + single-file `diagram.html`. Re-scan keeps positions and notes. |
| `artisan diff [--json]` | Human diagram changes → markdown report for the agent (renames detected, removals ask). Consumes them. |
| `artisan mark-ai` | After agent edits to `diagram.json`: record as pending (amber in editor). |
| `artisan ack` | Mark pending agent changes as seen by the human. |
| `artisan status` | Diagram size, pending changes in both directions. |
| `artisan editor` | Open the editor app in your browser (`app` alias). |
| `artisan serve [--port N]` | Optional localhost server: live autosave + pending API. |

## Editing from the terminal

These are **human edits** — the agent picks them up via `artisan diff`.

### Add

```bash
artisan add node <Name> [--kind class|abstract|interface|enum|record|struct]
              [--x N --y N] [--note "..."]
artisan add member <Class> <attribute|method|value> <Name>
              [--type T] [--params P] [--vis +|-|#|~]
              [--mods static,abstract,...] [--note "..."]
artisan add edge <From> <To> [--kind inheritance|realization|composition|
              aggregation|association|dependency]
              [--label L] [--from-mult A] [--to-mult B]
```

New nodes without `--x/--y` are auto-placed next to their neighbours. Duplicate
classes, duplicate relations and enum values on non-enums are rejected.

### Edit

```bash
artisan edit node <Name> [--name New] [--kind K] [--x N --y N] [--note "..."]
artisan edit member <Class> <Name> [--name New] [--type T] [--params P]
              [--vis +] [--mods static,abstract] [--note "..."]
artisan edit edge <From> <To> [--kind K] [--new-kind K] [--label L]
              [--from-mult A] [--to-mult B]
```

`--name` keeps the item id — `diff` reports it as a rename. `--note` alone (a
bare flag) clears the note; `--label-off` clears a relation label. When a pair
of classes has several relations, select with `--kind`.

### Remove

```bash
artisan remove node <Name>
artisan remove member <Class> <Name> [--kind attribute|method|value]
artisan remove edge <From> <To> [--kind K]
```

`rm` is an alias. Removing a node cascades its relations. Pass `--kind` when a
member name is ambiguous (attribute + method with the same name).

## Notes everywhere

Notes bind your agent: on classes, members and relations (via the editor or
`--note`), plus project-level notes (the editor's **Notes** button). `diff`
surfaces all of them in the report, and scan/plantUML keep them.
