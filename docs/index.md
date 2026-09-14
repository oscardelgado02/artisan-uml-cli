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

## Why I built this

I'm [Óscar Delgado](https://oscardelgado.dev), a software engineer. I like to plan the
architecture first and keep it visible as the codebase grows, that's why I built the
[`artisan-uml`](https://github.com/oscardelgado02/artisan-uml) editor.

Agentic coding workflows changed how fast we build, but they brought a new problem:
agents happily create architecture on their own, new classes, new abstractions,
rewired dependencies, without any real control from the engineer, unless you write a
really specific prompt every time. The result is often code that works today and
drifts tomorrow, with no shared picture of the system.

This CLI is my answer for that side of the workflow. It turns your codebase into a
diagram you can *see*, gives you a fluid, visual space to make the architectural
decisions yourself, and then lets the agent do what it is great at, implementing them
fast. You keep the control and the overview; the agents keep the speed. Everyone
works from the same picture.

I released it as open source so that as many people as possible can use it. If it
helps you stay in the driver's seat of your next project, it was worth building.
