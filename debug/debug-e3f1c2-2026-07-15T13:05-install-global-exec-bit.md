---
hash: e3f1c2
type: debug
created: 2026-07-15T13:05:00-06:00
title: install:global produces non-executable devx (dist/cli.js missing +x)
from: user report 2026-07-15 (devx command not found after npm run install:global)
status: in-progress
owner: /devx-loop-2026-07-15T18-11-34-721-81197
---

## Goal
`npm run install:global` yields a global `devx` that runs. Today the bin
symlink points at `dist/cli.js` which tsc emits mode 644; exec fails with
`permission denied` (zsh surfaces it as "command not found" in some paths).

## Repro (confirmed live 2026-07-15)
1. `npm run install:global` → "changed 1 package"
2. `devx --version` → permission denied / not found
3. `ls -l $(npm prefix -g)/lib/node_modules/@devx/cli/dist/cli.js` → -rw-r--r--

## Acceptance criteria
- [ ] Build step sets +x on dist/cli.js (e.g. in scripts/build-info.mjs or a
      dedicated postbuild chmod), so a fresh checkout + install:global works
- [ ] Regression test asserts the executable bit on dist/cli.js post-build
- [ ] INSTALL.md unchanged (the documented flow just works)

## Status log
- 2026-07-15T13:05 — filed after live repro; user's install hand-patched with chmod +x as a workaround
- 2026-07-15T12:11:34-06:00 — claimed by /devx in session /devx-loop-2026-07-15T18-11-34-721-81197
- 2026-07-15T18:23:03.290Z — loop iteration 1: Fixed the missing exec bit on dist/cli.js via a chmod in the build step, added a RED/GREEN-verified regression test, and confirmed the fix end-to-end through a throwaway-prefix tarball install with the full 2128-test gate green.
  - Change: scripts/build-info.mjs now chmods dist/cli.js to 0755 on every build (before the git-provenance branch, so tarball builds get it too; fails loud if the entrypoint is missing)
  - Change: Added test/build-exec-bit.test.ts asserting the exec bit on dist/cli.js post-build, using the repo's established skipIf(!dist) pattern; verified it fails on mode 0644 and passes after a build
  - Change: Filed out-of-scope bug debug-b365ac (spec + DEBUG.md entry): yaml is a devDependency but is imported at runtime by dist/lib/config-io.js, so clean packed-tarball installs crash with ERR_MODULE_NOT_FOUND
  - Learning: The exec bit set at build time survives npm pack and a global tarball install (verified in a throwaway prefix), so a build-time chmod is sufficient — no postinstall hook needed
  - Learning: A clean-machine install of the current package is broken independently of the exec bit: yaml lives in devDependencies but is a runtime import, crashing devx before argv parsing; dev-repo runs mask this because node_modules contains dev deps (filed as debug-b365ac)
  - Learning: npm i -g does not restore the exec bit on the bin target file itself, confirming the fix must happen at pack/build time
