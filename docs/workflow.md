# The workflow

The point of Artisan: **architecture decisions stay with the human**; the agent
implements. The diagram is the contract between both.

## 1. Scan

```bash
artisan scan
```

Parses your C# into `.artisan/diagram.json` (the source of truth) and
`diagram.puml` — the PlantUML mirror your agent reads. Your positions, notes and
relations survive every re-scan; new classes land next to what they belong to.

## 2. You redesign

Open `.artisan/diagram.html` (or run `artisan editor`). Drag, rewire, rename,
add classes, write notes on classes, members, relations — and project-level
notes the agent must honor. From the terminal: `artisan add`, `artisan edit`,
`artisan remove`.

## 3. `artisan diff` — hand your changes to the agent

```bash
artisan diff
```

Compares the diagram against the last state the agent consumed and prints a
markdown report:

- **Renames** — detected as renames (member signature match or overlap
  heuristics), so the agent refactors instead of deleting + recreating.
  Renames done via `artisan edit --name` keep the item id and are always
  reported as renames.
- **Added** — classes/members to scaffold. The agent must not touch existing
  members beyond renaming.
- **Removed** — never auto-deleted. The agent must ask first.
- **Notes** — project, class, member and relation notes, binding for the agent.

Running `diff` consumes the changes (marks them seen), so it reports each change
once.

## 4. The agent implements

Refactors renames, scaffolds new code, writes bodies per your notes. The agent
packs (`/artisan-scaffold`, `/artisan-implement`, …) run `diff` themselves and
follow these rules.

## 5. `artisan mark-ai` — agent changes back to you

When an *agent* restructures the diagram (edits `diagram.json`, then):

```bash
artisan mark-ai
```

its changes become **pending**: shown amber in the editor with a **Mark seen**
button until you acknowledge them (`artisan ack` or the button). You always see
what the agent did to your architecture.

## 6. `artisan status`

```bash
artisan status
```

Diagram size, unseen human changes and pending agent changes at a glance.

## The loop

`scan` → you edit → `diff` → agent implements → `mark-ai` → you ack → repeat.
`changelog.json` keeps the full history of who changed what.
