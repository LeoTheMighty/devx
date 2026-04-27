## (from /devx-init) Test runner — vitest, jest, node --test, or other?

A `package.json` was detected. The local-CI gate (`devx.config.yaml → projects[]`)
needs a `test:` command. Without one, `/devx` Phase 5 falls back to a no-op
echo and the local gate stops catching things.

**Options:** vitest (default — Jest-compatible API + fast) / jest / `node --test` (built-in, zero deps) / other.
**Recommendation:** vitest if you have any frontend, `node --test` for a
pure-Node CLI; jest only if a teammate already standardized on it.

- [ ] Pick a test runner and confirm the test command devx should run.

## (from /devx-init) Package manager — npm, pnpm, yarn, or bun?

Cosmetically: lockfile name + the `bash.allow` list. Operationally: monorepo
support (`workspaces:`) varies between them.

**Options:** npm (default — built in) / pnpm (fast, strict) / yarn (Berry-style PnP) / bun (fastest, less mature).
**Recommendation:** npm unless you already prefer otherwise; pnpm if monorepo.

- [ ] Confirm the package manager devx should call.

## (from /devx-init) Bundler — Vite, esbuild, tsup, parcel, webpack, or none?

If the first slice is a CLI, pick `none` — devx will skip bundler config.

**Options:** Vite (default for app/UI) / esbuild / tsup (CLI/library) / parcel / webpack / none.
**Recommendation:** none for CLI/library; Vite for any UI.

- [ ] Pick a bundler (or `none`).
