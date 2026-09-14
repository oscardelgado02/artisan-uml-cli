# artisan-uml-cli — CLI

Zero-dependency Node CLI (≥18) that keeps code and a class diagram in sync.
The `.artisan/` directory in your project holds the state:

| File | Meaning |
|------|---------|
| `diagram.json` | source of truth (nodes, edges, notes, positions) |
| `diagram.puml` | PlantUML mirror — what the AI reads |
| `map.json` | type → source file |
| `last-ai.json` / `last-human.json` | change-tracking baselines |
| `pending.json` | AI changes the human hasn't seen yet |
| `changelog.json` | history of consumed changes |
| `editor/` | bundled editor assets (inlined into `diagram.html`) |
| `diagram.html` | the editor as a single self-contained file |

The bundled editor comes from the [`artisan-uml`](https://www.npmjs.com/package/artisan-uml)
npm package (this package depends on it; a local `ARTISAN_EDITOR` path overrides for dev).
Its `layout-constants.mjs` pins the box-size math the CLI mirrors; `package.json`'s
`editorContract` must match the editor's `CONTRACT_VERSION` — mismatch fails loudly on scan.

## Commands

```
artisan scan        parse C# → diagram (merges your edits: positions, notes survive)
                    + writes .artisan/diagram.html — the editor as ONE file,
                    double-click to open (Connect file button autosaves edits)
artisan serve       (optional) editor at http://localhost:4173, live autosave
artisan diff        human diagram edits → markdown report for the AI; consumes them
artisan mark-ai     record AI-made diagram.json edits as pending (amber in editor)
artisan ack         human confirms AI changes seen (or "Mark seen" button in editor)
artisan status      diagram size, pending changes both directions
```

Scan skips `Library/`, `obj/`, `bin/`, `Temp/`, `Logs/`, `Packages/`, `Editor/` — see `lib/scan.mjs` for the ignore list (Unity-aware).

### How relations are detected

| Kind | Detected from |
|------|---------------|
| inheritance | `class Dog : Animal` |
| realization | `class Dog : IPet` (interface base; Unity convention: `IFoo` → `Foo` also linked) |
| composition | field initialized inline: `Engine engine = new Engine();` |
| aggregation | collection-typed field: `List<Weapon> weapons;` / `Weapon[] slots;` |
| association | plain field of a scanned type: `Engine engine;` |
| dependency | method parameter/return type references a scanned type (only when no stronger edge links the pair) |

Layout is layered: roots (no parents) on top, children below, so inheritance trees read top-down. These are pragmatic heuristics — hand-tune relations and positions in the editor; re-scan keeps your edits.

## Install into a project

```bash
npm install -g artisan-uml-cli
artisan scan
```

## Development

```bash
node cli/test/run.mjs    # self-checks: C# parser, diff engine, scan flow
node cli/bin/artisan.mjs help
```
