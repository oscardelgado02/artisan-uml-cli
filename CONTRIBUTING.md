# Contributing to artisan-uml-cli

Thanks for helping out! This project keeps contributions simple.

## Getting started

```bash
pnpm install   # Node.js 18+ and pnpm (npm works too)
pnpm test      # parser, diff engine, scan flow, layout checks
node bin/artisan.mjs help
```

## Ground rules

- **One PR per feature/fix.** Keep diffs focused; no drive-by refactors.
- **Tests must pass**: `pnpm test` (the self-checks cover the C# parser, the
  diff/rename engine, scan merge semantics and layout placement).
- **No new dependencies.** The CLI is deliberately zero-dependency — Node's
  stdlib and the bundled editor do everything.
- **Respect the editor contract.** `package.json` pins `editorContract`; it must
  match the `CONTRACT_VERSION` exported by the bundled
  [`artisan-uml`](https://www.npmjs.com/package/artisan-uml) package. A mismatch
  fails loudly on `artisan scan` by design — never bypass it.
- **Human changes win.** Any behavior change must keep the guarantees: re-scan
  preserves positions and notes, removals are never auto-deleted by agents,
  `diff` consumes human edits once.
- **Match the existing code style** — plain ESM `.mjs`, no comments unless
  something genuinely needs explaining.

## Reporting issues

Open a GitHub issue with steps to reproduce, expected vs actual behavior, and
the `artisan` command you ran. Security issues: see [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
