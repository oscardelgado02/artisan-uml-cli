# Security Policy

## Supported versions

Only the latest release of `artisan-uml-cli` receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue for security reports.**

Use [GitHub private vulnerability reporting](https://github.com/oscardelgado02/artisan-uml-cli/security/advisories/new)
— it is the fastest, most private channel.

## Scope

The CLI is a local, zero-dependency Node program. It reads your source files,
writes `.artisan/` next to your project, and ships the bundled editor from the
[`artisan-uml`](https://www.npmjs.com/package/artisan-uml) package (see that
package's security policy for editor-side scope).

Areas worth scrutiny:

- **Source parsing** — the C# parser reads your repository files; it must
  never execute anything it parses and must fail safely on malformed input.
- **Local server** (`artisan serve`) — binds `127.0.0.1` only, serves the
  bundled editor and the `.artisan/` API. The static handler must not serve
  files outside `.artisan/editor/`.
- **Generated HTML** — `diagram.html` inlines your diagram data; class names,
  members and notes must be data, never executed markup.
- **File paths** — `ARTISAN_EDITOR` and `--src` are trusted, local,
  user-provided paths by design.

Out of scope: anything requiring a malicious dependency install (there are no
runtime dependencies), the dev toolchain, and the editor application itself
(see the `artisan-uml` package).
