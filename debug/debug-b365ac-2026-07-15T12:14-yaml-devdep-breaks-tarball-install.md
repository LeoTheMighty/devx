---
hash: b365ac
type: debug
created: 2026-07-15T12:14:00-06:00
title: yaml in devDependencies but imported at runtime — tarball install crashes on startup
from: debug/debug-e3f1c2-2026-07-15T13:05-install-global-exec-bit.md
status: ready
owner: null
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

## Links
- Parent: debug/debug-e3f1c2-2026-07-15T13:05-install-global-exec-bit.md
