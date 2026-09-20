# Changelog

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
