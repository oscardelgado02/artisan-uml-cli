# Changelog

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
