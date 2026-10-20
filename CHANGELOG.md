# Changelog

## 0.5.1 — 20.10.2026

### Fixed
- The editor is back. `artisan-uml@1.2.1` was published without its built `dist/` (the folder is gitignored and the tarball was packed from an unbuilt checkout), so every install ended up without an editor: `artuml scan` skipped `diagram.html` and `artuml editor`/`serve` failed. This release requires `artisan-uml@^1.2.2`, which ships the built editor again (`artisan-uml` 1.2.2 adds a `prepack` build and a publish guard).
- The "editor build not found" hint no longer claims that `npm install -g artisan-uml-cli` bundles the editor — it never did. It now points at the `artisan-uml` package.

### Added
- `artuml --version` (also `-v`) prints the CLI version.
- `prepublishOnly` now also checks that the `artisan-uml` dependency ships its built `dist/` (the failure that broke 1.2.1), so a manual publish cannot repeat it.

### Changed
- The editor and the layout constants come from the `artisan-uml` package only: the lookup for a bundled `editor-dist/` copy (never produced by anything) is gone.
- `pnpm-workspace.yaml`: `minimumReleaseAgeExclude` excludes our own `artisan-uml` by name, so a fresh editor release is installable right away instead of waiting out the 24 h age gate.

## 0.5.0 — 18.10.2026

### Added
- Config system: optional global `~/.config/artuml/config.json` and per-project `.artisan/config.json` (project wins). Keys: `askBeforeRemove` (default `true` — skills prompt before removals) and `autoServe` (default `false` — every mutating/reading command then ensures `artuml serve` is running). `scan` seeds the project config with defaults if absent.
- `artuml diff --peek` — report unseen human changes **without** consuming them (no `last-ai.json` write). `artuml status` now embeds this peek, so one command shows counters *and* the actual human changes.
- `serve` gains an already-running check (`ensureServeRunning`, probed via `GET /api/status` on port 4173) used by the autoServe hook; spawned instances set `ARTISAN_NO_BROWSER=1` so they never steal focus.
- `GET /api/impl` caches its parse per revision (60 s TTL) — the editor's ~30 s poll no longer re-parses the whole code tree each time.

### Changed
- **BREAKING (behavior):** `mark-ai` now *merges* new refs into `pending.json` (dedup by key) instead of overwriting the file — agent runs can no longer clobber unacknowledged human CLI-edit refs.
- `refreshEmbedded` skips the ~92 KB `diagram.html` rewrite when diagram/pending/impl state (and the editor shell) are unchanged — read-only commands like `status` and `diff --peek` no longer churn the file.
- Shared source extractor (`lib/extract.mjs`): the copy-pasted walk+parse+dedupe pipeline in `scan` and `impl-diff` is one function now — the seam a second language plugs into.

## 0.4.0 — 12.10.2026

### Changed
- **BREAKING: the binary is now `artuml`** (formerly `artisan`) — a name collision with Laravel's `artisan` too often broke `PATH` installs. All commands, help text and examples now use `artuml scan`, `artuml diff`, `artuml serve`, etc. Update any scripts that call `artisan …`.
- Package names unchanged: still `npm i artisan-uml-cli`. The `.artisan/` state dir, the `ARTISAN_EDITOR` env var and the `/artisan-*` slash-command packs keep their names.
- `npx --yes artisan-uml-cli` / `pnpm dlx artisan-uml-cli` still work as before — only the on-PATH name changed.

## 0.3.0 — 11.10.2026

### Added
- `artisan impl-diff` — read-only comparison of the diagram against the actual code: diagram items **missing from the code** (the regular diff misses them once acked or scanned out-of-band), code **drift not in the diagram**, and **signature mismatches**. Report only; marks nothing seen. Command docs added.
- `serve` endpoint `GET /api/impl` and an impl-state field in the embedded `diagram.html` payload — the editor's "Code out of sync" badge reads from these.

### Fixed
- Rescan no longer removes and re-adds freshly created nodes: same-name and CLI-added classes keep their diagram ids across rescans (renames, out-of-band deletes), so no phantom add/remove churn in the diff.

## 0.2.0 — 20.09.2026

### Added
- Terminal edits record pending refs: `add`/`edit`/`remove` write the same refs `mark-ai` uses, so editor highlights (amber additions, tombstone removals) survive page reloads. Removals carry a ghost snapshot of the deleted node/member/relation.
- Fine-grained review: `artisan ack <refs...>` accepts single refs (keys like `node:Wolf:removed`), `artisan reject [refs...]` reverts diagram changes — per-ref inverse ops via ghost snapshots, or "reject all" reverting exactly the refs still pending (never wholesale-restoring over individually accepted changes).
- `serve` API: `POST /api/ack {keys}`, `POST /api/reject {keys}` (returns the post-revert diagram), `POST /api/pending {refs}` for editor-recorded refs.
- Optimistic concurrency: `PUT /api/diagram` takes `If-Match` (revision from the file's mtime) and answers 409 on stale-tab saves.

### Fixed
- `findEditorDist` never found the hoisted `artisan-uml` dep on global installs (`npm -g`/npx) — `scan` skipped writing `diagram.html`. Correct sibling path added.
- `remove node` crashed while recording cascaded relation refs (id passed to the name-only resolver) — removal landed but refs were lost, killing ghost tombstones on reload.
- `mark-ai`/`diff` refs now carry ghost snapshots for removals, modifications and renames, so reverts and tombstones work for agent-made changes too.

### Notes
- `serve` serves the editor from `.artisan/editor/` — after rebuilding the editor package, refresh that folder (`rm -rf .artisan/editor && artisan scan`) or the served tab keeps running the old bundle.
