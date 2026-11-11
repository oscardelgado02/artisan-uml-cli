# The workflow

The point of Artisan: **architecture decisions stay with the human**; the agent
implements. The diagram is the contract between both.

## 1. Scan

```bash
artuml scan
```

Parses your C# into `.artisan/diagram.json` (the source of truth) and
`diagram.puml` — the PlantUML mirror your agent reads. Your positions, notes and
relations survive every re-scan; new classes land next to what they belong to.

## 2. You redesign

Open `.artisan/diagram.html` (or run `artuml editor`). Drag, rewire, rename,
add classes, write notes on classes, members, relations — and project-level
notes the agent must honor. From the terminal: `artuml add`, `artuml edit`,
`artuml remove`.

## 3. `artuml diff` — hand your changes to the agent

```bash
artuml diff
```

Compares the diagram against the last state the agent consumed and prints a
markdown report:

- **Renames** — detected as renames (member signature match or overlap
  heuristics), so the agent refactors instead of deleting + recreating.
  Renames done via `artuml edit --name` keep the item id and are always
  reported as renames.
- **Added** — classes/members to scaffold. The agent must not touch existing
  members beyond renaming.
- **Removed** — never auto-deleted. The agent must ask first.
- **Notes** — project, class, member and relation notes, binding for the agent.

Running `diff` consumes the changes (marks them seen), so it reports each change
once. `diff --peek` reports without consuming — and `artuml status` embeds such
a peek whenever human changes are waiting.

## 4. `artuml scaffold` — the mechanical work, for free

```bash
artuml scaffold [--src DIR] [--yes]
```

Applies `impl-diff` directly to your code: creates stub class files for removed
diagram items, splices new members into existing files, patches modified
signatures, applies renames (files, declarations and identifiers), and moves
files whose class got a new `dir` (set per node via `artuml edit node
<Name> --dir Combat` — relative to the default dir, the editor's *Set
directory…*, or `scaffoldDir` in config: the ROOT all files live under). Generated bodies follow `stubBody` (`throw` →
`NotImplementedException`, `empty`, `todo`); notes land as `// NOTE:` comments;
namespaces are taken from a same-directory sibling or omitted.

Removals (classes that exist in code but not in the diagram) are never silent:
one y/n prompt lists them, `--yes` pre-answers it, and `askBeforeRemove: false`
skips it. Renames refactored outside the renamed file, declined removals and
planned relations are listed under *For the agent* — judgement stays with the
agent, not the tool. Then `impl-diff.json` is refreshed from the new source.

## 5. The agent implements

Refactors remaining call sites after a rename, writes real bodies into the
stubs per your notes, reviews any code drift `diff` didn't know about. The
agent packs (`/artisan-scaffold`, `/artisan-implement`, …) run `diff` and
`scaffold` themselves and follow these rules. Removals are collected and asked
about in one prompt — gated by the `askBeforeRemove` config (see
`docs/commands.md`).

## 6. `artuml mark-ai` — agent changes back to you

When an *agent* restructures the diagram — preferably via `artuml add/edit/remove`
(direct `diagram.json` edits are a last resort), then:

```bash
artuml mark-ai
```

its changes become **pending**: shown amber in the editor with a **Mark seen**
button until you acknowledge them (`artuml ack` or the button). You always see
what the agent did to your architecture. `mark-ai` merges new refs into
`pending.json` — it never clobbers unacknowledged changes.

## 7. `artuml status`

```bash
artuml status
```

Diagram size, unseen human changes and pending agent changes at a glance —
including the actual human change report (non-consuming peek).

## The loop

`scan` → you edit → `diff` → `scaffold` → agent implements → `mark-ai` → you
ack → repeat. `changelog.json` keeps the full history of who changed what.
