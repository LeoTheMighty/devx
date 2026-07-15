---
hash: b365ac
type: debug
created: 2026-07-15T12:14:00-06:00
title: yaml in devDependencies but imported at runtime — tarball install crashes on startup
from: debug/debug-e3f1c2-2026-07-15T13:05-install-global-exec-bit.md
status: in-progress
owner: /devx-loop-2026-07-15T18-11-34-721-81197
---

## Goal
A production install of @devx/cli (tarball or `npm i -g .`, which installs
`dependencies` only) can run `devx` at all. Today `src/lib/config-io.ts`
imports `yaml` at runtime, but `yaml` sits in `devDependencies`, so a clean
install crashes with `ERR_MODULE_NOT_FOUND: Cannot find package 'yaml'`
before commander even parses argv (cli.js's import chain reaches
dist/lib/config-io.js eagerly).

## Repro (confirmed live 2026-07-15, during debug-e3f1c2 verification)
1. `npm pack --pack-destination "$TMP"`
2. `npm i -g --prefix "$TMP/prefix" "$TMP"/devx-cli-0.1.0.tgz`
3. `"$TMP/prefix/bin/devx" --version` →
   `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'yaml' imported from
   .../dist/lib/config-io.js`

Dev-repo runs never see this because `yaml` is present in the repo's
node_modules via devDependencies. Any machine installing from the packed
artifact hits it on every invocation.

## Acceptance criteria
- [ ] `yaml` moves to `dependencies` (or the runtime import is removed) —
      audit for any other devDependency imported from `src/` (runtime code),
      e.g. via a script/test that cross-checks `dist/` imports against
      `package.json` dependencies
- [ ] Regression test: packed-tarball install into a throwaway prefix runs
      `devx --version` successfully (or a cheaper static check pinning
      runtime imports ⊆ dependencies)

## Status log
- 2026-07-15T12:14 — filed from debug-e3f1c2 iteration 1: exec-bit fix verified
  via throwaway-prefix tarball install, which surfaced this pre-existing crash
- 2026-07-15T12:24:50-06:00 — claimed by /devx in session /devx-loop-2026-07-15T18-11-34-721-81197
- 2026-07-15T18:37:37.516Z — loop iteration 1: Moved yaml, ajv, and ajv-formats from devDependencies to dependencies and added a RED/GREEN-verified static test pinning runtime imports ⊆ dependencies, verified end-to-end via throwaway-prefix tarball install with the full 2130-test gate green.
  - Change: Moved yaml, ajv, and ajv-formats to dependencies in package.json (audit found ajv/ajv-formats as additional runtime-imported devDeps via src/lib/config-validate.ts, on every command's entry path); package-lock.json updated to mark them as production packages
  - Change: Added test/runtime-deps.test.ts — scans built dist/ output plus shipped postinstall scripts for bare-specifier imports and fails on any package missing from dependencies, with a self-check that the scanner sees known packages so it can't pass vacuously; verified RED against pre-fix package.json (caught all three packages) and GREEN after
  - Change: Verified the spec's live repro end-to-end: packed tarball installed into a throwaway prefix now runs devx --version (0.1.0+a4d6601) and --help instead of crashing with ERR_MODULE_NOT_FOUND
  - Change: Corrected a stale comment in src/lib/tour/schema.ts claiming ajv was a devDependency kept out of the runtime graph
  - Learning: The spec's audit AC was load-bearing: yaml was not the only offender — ajv and ajv-formats were also devDeps imported at runtime, missed by a naive src/ grep because the import specifier is a subpath (ajv/dist/2020.js); scanning built dist/ output is the reliable audit surface
  - Learning: A specifier regex for this scan must reject whitespace inside the quoted specifier, otherwise quoted prose in code (error messages containing the word 'from') produces false positives
  - Learning: src/lib/tour/schema.ts hand-rolled its validation specifically to keep ajv out of the runtime graph, but config-validate.ts had already made ajv load-bearing on every command's entry path — the design intent and reality had diverged

## Links
- Parent: debug/debug-e3f1c2-2026-07-15T13:05-install-global-exec-bit.md
