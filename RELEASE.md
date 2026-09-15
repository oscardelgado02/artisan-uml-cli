Your agent writes great code and terrible architecture. It never sees the shape of the system, and it doesn't wait for your say-so before building. This CLI closes that loop.

Give your coding agent a living class diagram — and give yourself the final word.

    pnpm install -g artisan-uml-cli
    cd your-unity-project
    artisan scan

Open `.artisan/diagram.html` — the full Artisan UML editor as a single self-contained file. No server, no account, no setup.

**What you get**

- `artisan scan` — parses your C# into a living diagram with all six UML relations, plus a PlantUML mirror the agent can read. Re-scans keep your positions and notes.
- `artisan diff` — after you redesign, writes a report for your agent: renames detected as renames, new types to scaffold, and your notes as instructions to honor.
- `artisan mark-ai` / `artisan ack` — agent architecture changes appear highlighted in amber in your editor. You review, you confirm. Architecture decisions stay human.
- `artisan add / edit / remove` — grow or prune the diagram from the terminal.
- `artisan editor` / `artisan serve` — the same editor with autosave, on any browser.
- `artisan help <command>` — every command documented in the terminal.

**Designed for trust**

- Zero runtime dependencies. Nothing phones home. Everything it knows lives in `.artisan/`, next to your project.
- Your work is never destroyed — re-scan merges, never overwrites. Agents never delete without asking.
- Agent packs included: `/artisan-*` slash commands for opencode, Claude Code and Codex.

C# first — built by a Unity developer, for Unity projects. More languages planned. Fully open source.

Docs: https://cli.artisan-uml.dev
Issues: https://github.com/oscardelgado02/artisan-uml-cli/issues
