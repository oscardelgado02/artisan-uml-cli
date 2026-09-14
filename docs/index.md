# Getting started

`artisan-uml-cli` gives your project a living **class diagram** — and gives your
coding agent something to read. You design the architecture in the editor; the
agent implements it.

## Install

Requires [Node.js](https://nodejs.org) 18+.

```bash
pnpm install -g artisan-uml-cli
# or: npm install -g artisan-uml-cli

cd your-unity-project
artisan scan
```

Zero runtime dependencies. Everything it knows lives in `.artisan/`, next to
your project.

## Open the diagram

Run `artisan scan` in your project root, then open **`.artisan/diagram.html`** —
the full editor inlined as one self-contained file. Double-click it; no server,
no install beyond the CLI.

Click **Connect file** once and pick `.artisan/diagram.json` — from then on
every edit autosaves to disk, so your agent always reads fresh state.

Unity-aware out of the box: `Library/`, `obj/`, `bin/`, `Temp/`, `Logs/`,
`Packages/`, `Editor/` are skipped when scanning.

## Re-scan keeps your work

Run `artisan scan` again after code changes: new classes are auto-placed next
to what they belong to, while your positions, notes and relations survive.

## `editor` or `serve`?

Two ways to run the same editor:

| | `artisan editor` | `artisan serve` |
| --- | --- | --- |
| What runs | nothing — writes `diagram.html`, opens it | a localhost HTTP server (`:4173`) |
| Autosave | browser File System Access API (`Connect file`, one click) | `PUT /api/diagram` over localhost |
| Extra | none | pending-changes API (`GET /api/pending`, `POST /api/ack`) |
| Browser | Chrome, Edge (file-handle API) | any browser incl. Firefox / Safari |

On Chrome/Edge, `editor` is all you need. Use `serve` when your browser lacks
the File System Access API or you want the pending API.

## Next steps

- The [workflow](workflow.md) — how you and your agent trade changes
- [Commands](commands.md) — every command, flags and examples
- [Agent packs](agent-packs.md) — `/artisan-*` slash commands for your agent
