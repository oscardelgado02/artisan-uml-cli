# Agent packs

The CLI works with any agent out of the box — an agent only needs `artuml
diff`, `.artisan/diagram.puml` and `.artisan/diagram.json`. The slash-command
packs make it conversational.

The main [Artisan repo](https://github.com/oscardelgado02/artisan) ships packs
for **opencode**, **Claude Code** and **Codex**:

| Slash command | What the agent does |
| --- | --- |
| `/artisan-scan` | Runs `artuml scan`, tells you how to open the editor, reads `diagram.puml` |
| `/artisan-scaffold` | Runs `artuml diff`, then `artuml scaffold`: stubs, splices, renames, moves and patches are mechanical; the agent refactors call sites outside the renamed file, relays removal candidates once and re-runs `scaffold --yes` only after your explicit yes |
| `/artisan-implement` | Same, then writes real bodies into the generated stubs honoring your notes (not just `NotImplementedException`) |
| `/artisan-architect` | You ask; the agent edits `diagram.json` itself and runs `mark-ai` — you review amber changes in the editor |
| `/artisan-status` | Runs `artuml status`, summarizes both directions of pending change |

## Install

```bash
git clone https://github.com/oscardelgado02/artisan
cd artuml && ./install.sh
```

`install.sh` copies the CLI, the bundled editor and the opencode command files
into place. For Claude Code / Codex, copy the files from
`agents/claude/` / `agents/codex/` into their command folders
(`.claude/commands/`, `~/.codex/prompts/`).

## Without packs

Any agent can work from this documentation:

1. `artuml diff` — read the markdown report
2. `artuml scaffold` — the CLI applies the mechanical part to the code
3. Refactor call sites after renames, write real bodies into the stubs per the notes
4. Removal candidates: relay them once, never delete by hand; re-run with
   `artuml scaffold --yes` only after the human explicitly agrees
5. After diagram-side work: edit `.artisan/diagram.json`, run `artuml mark-ai`

## Rules the packs enforce

- The human wins: diagram notes are binding, existing members are untouched
  beyond renames, removals require asking.
- `artuml scaffold` does the mechanical code work; the agent handles everything
  that needs judgement (call-site refactors, declined removals, multi-type
  files, namespace drift) and only re-runs `scaffold --yes` on explicit say-so.
- The agent reports consumed changes; it never silently re-scans.
- Architecture changes proposed by the agent go through `mark-ai` so the human
  reviews them — not direct code surgery.
