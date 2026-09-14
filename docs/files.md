# The `.artisan/` directory

Everything the CLI knows lives next to your project. Commit it or ignore it —
`artisan scan` regenerates it from source, but your notes and layout survive
re-scans, so committing keeps that history.

| File | Meaning |
| --- | --- |
| `diagram.json` | the source of truth — nodes, members, relations, notes, positions |
| `diagram.html` | the editor as ONE self-contained file (double-click to open) |
| `diagram.puml` | PlantUML mirror — what agents read |
| `map.json` | type → source file / namespace (so reports can point at code) |
| `last-ai.json` | snapshot the agent last consumed (baseline for `diff`) |
| `last-human.json` | snapshot the human last acknowledged (baseline for `mark-ai`) |
| `pending.json` | agent changes the human has not seen yet (amber highlights) |
| `changelog.json` | append-only history of changes and acks |
| `editor/` | bundled editor assets (inlined into `diagram.html`) |

## Diagram shape

`diagram.json` is plain JSON:

```ts
interface Member {
  id: string;
  vis: '+' | '-' | '#' | '~';
  name: string;
  type: string;
  mods: string[];
  params: string | null;
  note?: string;
}

interface UmlNode {
  id: string;
  kind: 'class' | 'abstract' | 'interface' | 'enum' | 'record' | 'struct';
  name: string;
  x: number | null; y: number | null;
  attributes: Member[]; methods: Member[];
  note?: string;
}

interface UmlEdge {
  id: string;
  kind: 'association' | 'inheritance' | 'realization' | 'dependency'
      | 'aggregation' | 'composition';
  from: string; to: string;
  label: string; fromMult: string; toMult: string;
  note?: string;
}

interface Diagram {
  seq: number;          // bumped on every write
  projectNotes: string;
  nodes: UmlNode[]; edges: UmlEdge[];
}
```

Agents edit this file directly (then `artisan mark-ai`); humans edit it through
the editor (autosave), `artisan add/edit/remove`, or by hand.

## Editor contract

The bundled editor comes from the
[`artisan-uml`](https://www.npmjs.com/package/artisan-uml) npm package. Its
`layout-constants.mjs` pins the box-size math the CLI mirrors when estimating
node sizes; the CLI's `editorContract` field must match the editor's
`CONTRACT_VERSION`. A mismatch fails loudly on `artisan scan` instead of
silently corrupting layout. `ARTISAN_EDITOR=path/to/dist` overrides the
installed editor during development.
