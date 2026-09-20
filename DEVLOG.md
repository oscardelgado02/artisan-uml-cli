# Devlog

## 20.09.2026
- Global npm installs get `diagram.html` now: `findEditorDist` was looking for the hoisted `artisan-uml` dep at `node_modules/node_modules/artisan-uml` — a path that never exists — so `scan` skipped the self-contained editor whenever the CLI came from `npm install -g` or npx. Added the correct sibling path (`<prefix>/lib/node_modules/artisan-uml`).

## 18.09.2026
- `scan` tells the truth now: the "Open the editor" line only prints when `.artisan/diagram.html` was actually written — otherwise you get the real reason and the fix (the bundled editor ships with the npm install, or set `ARTISAN_EDITOR`).
- Agent packs stop at a missing `artisan`: the retry hint is `npx --yes artisan-uml-cli <command>` (pnpm dlx still listed), and `install.sh` checks `command -v artisan` after installing and explains the PATH fix.
- `mark-ai` explains the handoff: reload `.artisan/diagram.html` to see the amber proposals, or run `artisan serve` for live updates — browser tabs can't auto-reload a file on disk.
