# 2026-10-18 — Skills + CLI efficiency pass (v0.5.0)

Decision record for the 0.5.0 iteration. Same change landed in both repos:
`artisan` (agent packs) and `artisan-uml-cli` (CLI). Interview format: grilling
until no open questions remained; everything below was confirmed with the
project owner before implementation.

## Problem

The skills felt inefficient: the architect edited `diagram.json` by hand,
read-only commands churned a ~92 KB `diagram.html`, `status` didn't show the
actual human changes, removals were handled ad hoc, and nothing was
configurable.

## Decisions

1. **Architect goes through the CLI.** `add`/`edit`/`remove` first; direct
   `diagram.json` edits are a last resort for cases no command covers. One
   `mark-ai` after all changes (so the agent's own edits don't resurface as
   "human changes" in the next diff).
2. **`/artisan-edit` deleted** (all three tool packs). Redundant with
   `/artisan-architect`.
3. **Removals: one prompt per run.** Scaffold/implement collect ALL removals
   from both reports and ask exactly once: *"The following classes will be
   removed. Do you want to continue?"* — gated by `askBeforeRemove`.
4. **Config system.** Global `~/.config/artuml/config.json` + per-project
   `.artisan/config.json` (project wins). Initial keys: `askBeforeRemove`
   (default `true`), `autoServe` (default `false`). `scan` seeds the project
   file with defaults.
5. **autoServe.** When enabled, every relevant command probes
   `localhost:4173/api/status` and spawns `artuml serve` if absent (spawned
   instances set `ARTISAN_NO_BROWSER=1`).
6. **status shows the real changes.** New non-consuming `diff --peek`; the
   `status` command embeds it. Only scaffold/implement consume (`diff`).
7. **Scan points at serve.** After a scan, the skill runs `mark-ai` and tells
   the human: modify the architecture via `/artisan-serve` (highly
   recommended) — a standalone `diagram.html` is read-only.
8. **Languages stay C#-only.** But the copy-pasted parser pipeline in `scan`
   and `impl-diff` was deduplicated into one extractor (`lib/extract.mjs`) —
   the seam a second language plugs into. Both READMEs document this.
9. **mark-ai merges, never clobbers.** It now merges refs into `pending.json`
   by key (like terminal edits always did) instead of overwriting the file —
   unacknowledged human CLI edits survive agent runs.
10. **Perf.** `refreshEmbedded` skips the editor rewrite when nothing changed;
    `GET /api/impl` caches its parse per revision (60 s TTL).

## Rejected / deferred

- Second-language parsers — deferred until there's a real second language.
- Deduplicating the per-pack retry-hint boilerplate into an include — the
  install script owns pack generation; not worth the indirection now.
- Diff rename detection is O(removed×added) — fine at current diagram sizes.

## Where it landed

- CLI: `lib/extract.mjs`, `lib/config.mjs` (new); `scan`, `impldiff`, `diff`,
  `store`, `edit`, `embed`, `serve`, `bin/artuml.mjs` (changed); tests 51 ✓.
- Packs: `artisan-{scan,scaffold,implement,architect,status}.md` rewritten ×3,
  `artisan-edit.md` deleted ×3.
- Docs: both READMEs, `docs/commands.md`, `docs/files.md`, `docs/workflow.md`,
  site docs, CHANGELOGs.
