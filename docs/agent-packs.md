# Agent packs

The CLI works with any agent out of the box — an agent only needs `artisan
diff`, `.artisan/diagram.puml` and `.artisan/diagram.json`. The slash-command
packs make it conversational.

The main [Artisan repo](https://github.com/oscardelgado02/artisan) ships packs
for **opencode**, **Claude Code** and **Codex**:

| Slash command | What the agent does |
| --- | --- |
| `/artisan-scan` | Runs `artisan scan`, tells you how to open the editor, reads `diagram.puml` |
| `/artisan-scaffold` | Runs `artisan diff`; refactors renames, scaffolds added classes — never touches existing members, asks before deleting |
| `/artisan-implement` | Same, then writes real bodies honoring your notes (not just stubs) |
| `/artisan-architect` | You ask; the agent edits `diagram.json` itself and runs `mark-ai` — you review amber changes in the editor |
| `/artisan-status` | Runs `artisan status`, summarizes both directions of pending change |

## Install

```bash
git clone https://github.com/oscardelgado02/artisan
cd artisan && ./install.sh
```

`install.sh` copies the CLI, the bundled editor and the opencode command files
into place. For Claude Code / Codex, copy the files from
`agents/claude/` / `agents/codex/` into their command folders
(`.claude/commands/`, `~/.codex/prompts/`).

## Without packs

Any agent can work from this documentation:

1. `artisan diff` — read the markdown report
2. Edit code accordingly (rename → refactor, added → scaffold, removed → ask)
3. After diagram-side work: edit `.artisan/diagram.json`, run `artisan mark-ai`

## Rules the packs enforce

- The human wins: diagram notes are binding, existing members are untouched
  beyond renames, removals require asking.
- The agent reports consumed changes; it never silently re-scans.
- Architecture changes proposed by the agent go through `mark-ai` so the human
  reviews them — not direct code surgery.
