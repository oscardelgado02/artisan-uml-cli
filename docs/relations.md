# Relations

`artisan scan` detects all six UML relation kinds from your source. These are
pragmatic heuristics — hand-tune anything in the editor; re-scan keeps your
edits.

| Kind | Detected from |
| --- | --- |
| Inheritance (extends) | `class Dog : Animal` — a base type that is a scanned class/abstract/record/struct |
| Realization (implements) | a base type that is a scanned interface; Unity convention `IFoo` → `Foo` also linked |
| Composition (owns) | field initialized inline: `Engine engine = new Engine();` |
| Aggregation (has-a) | collection-typed field: `List<Weapon> weapons;` / `Weapon[] slots;` |
| Association | plain field of a scanned type: `Engine engine;` |
| Dependency | method parameter or return type references a scanned type — only when no stronger relation links the pair |

## Precedence

One member produces at most one relation, strongest wins. Pairs already linked
by inheritance/realization/composition/aggregation/association don't get a
dependency on top — the weaker signal would just be noise.

## Layout

Layered: roots (classes with no parents) rank on top, children below, so
inheritance trees read top-down. The order inside each layer balances relation
crossings; inheritance, realization and composition carry more weight than
looser links.

## In the editor

Click any relation to edit its **kind, label and multiplicities** (`1`,
`0..*`, …), reverse it, add a note, or delete it. See the
[editor docs](https://editor.artisan-uml.dev/docs/) for drawing relations by
hand.
