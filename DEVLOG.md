# Devlog

## 20.09.2026
- Removals highlight now too: `remove` records `removed` refs with a ghost snapshot of what was deleted (node, member, or cascaded relations with endpoint names) — the editor draws struck-through tombstones until you confirm. (Earlier note that removals don't highlight is obsolete.)
- Fine-grained review: `artisan ack node:Wolf:removed` accepts a single ref (same `type:id:change` key format for all types), `artisan reject [keys...]` reverts diagram changes — per-ref inverse ops (un-add, un-modify via ghost, un-remove by re-inserting the ghost), or a full restore from `last-human.json` with no keys. serve gets `POST /api/ack {keys}` and `POST /api/reject {keys}` (returns the post-revert diagram so the editor can resync without phantom diffs).
- `diff.mjs` ghosts: removals, modifications and renames recorded by `diff`/`mark-ai` now carry the same ghost snapshots as CLI removals, so reverts work for agent-made changes too, and tombstones survive reloads for both paths.
- Optimistic concurrency: `PUT /api/diagram` takes `If-Match` (revision derived from the file's mtime) and answers 409 when a stale tab tries to save over newer disk state — the editor reloads disk, disk always wins.
- `POST /api/pending {refs}`: the served editor can persist its own disk-diff detections (editor-made additions/removals) so they survive a page reload, exactly like CLI-recorded refs.
- Bug: `remove node` crashed after deleting when a cascaded relation's other endpoint was looked up by id through the name-only resolver — the removal landed but the refs never got recorded (ghosts died on reload). Endpoints are resolved before the delete now.
- Global npm installs get `diagram.html` now: `findEditorDist` was looking for the hoisted `artisan-uml` dep at `node_modules/node_modules/artisan-uml` — a path that never exists — so `scan` skipped the self-contained editor whenever the CLI came from `npm install -g` or npx. Added the correct sibling path (`<prefix>/lib/node_modules/artisan-uml`).

## 18.09.2026
- `scan` tells the truth now: the "Open the editor" line only prints when `.artisan/diagram.html` was actually written — otherwise you get the real reason and the fix (the bundled editor ships with the npm install, or set `ARTISAN_EDITOR`).
- Agent packs stop at a missing `artisan`: the retry hint is `npx --yes artisan-uml-cli <command>` (pnpm dlx still listed), and `install.sh` checks `command -v artisan` after installing and explains the PATH fix.
- `mark-ai` explains the handoff: reload `.artisan/diagram.html` to see the amber proposals, or run `artisan serve` for live updates — browser tabs can't auto-reload a file on disk.
