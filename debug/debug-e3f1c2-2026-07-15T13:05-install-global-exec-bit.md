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
