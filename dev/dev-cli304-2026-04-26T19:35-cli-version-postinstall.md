---
hash: cli304
type: dev
created: 2026-04-26T19:35:00-07:00
title: `devx --version` + postinstall PATH verification
from: _bmad-output/planning-artifacts/epic-cli-skeleton.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx
blocked_by: [cli301]
branch: feat/dev-cli304
---

## Goal

Wire `devx --version` to print the package version. Add a postinstall script that verifies `command -v devx` resolves and prints the platform-specific PATH-fix command if not. Postinstall is non-fatal.

## Acceptance criteria

- [ ] `devx --version` prints `package.json` version, exits 0
- [ ] `npm i -g @devx/cli` runs `scripts/postinstall.js` after install
- [ ] Postinstall executes `command -v devx` (or platform equivalent on Windows); on success prints nothing
- [ ] On failure prints platform-specific PATH-fix advice (macOS, Linux, WSL)
- [ ] Postinstall **never throws** — exit 0 even on PATH failure (warn-only)
- [ ] `package.json` `scripts.postinstall: "node scripts/postinstall.js"`

## Technical notes

- Read version via `import { version } from '../package.json' with { type: 'json' }` (Node ≥ 20).
- Postinstall avoids dependency on built TS — pure JS file.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T20:30 — claimed by /devx; branch feat/dev-cli304 (single-branch per devx.config.yaml: integration_branch=null). `devx --version` already wired in cli301 (src/cli.ts readPackageVersion + .version()) and tested in test/cli.test.ts → cli304 work is the postinstall script + package.json scripts.postinstall hook + tests.
- 2026-04-26T20:45 — impl: scripts/postinstall.js (warn-only, gated on npm_config_global==="true", spawns `sh -c 'command -v devx'` POSIX / `where devx` Windows; platform branches darwin/linux/wsl/win32). package.json: scripts.postinstall + files[] entry. test/postinstall.test.ts (6 tests, POSIX-only, subprocess-driven via process.execPath). Self-review: 8 findings, all resolved (most cosmetic; 1 real: tests must use process.execPath not bare "node" since they override PATH). Local CI green: 81/81 tests pass.
- 2026-04-26T20:50 — merged via PR #11 (squash → 17428b9). No remote CI workflow configured → local gates were authoritative per /devx Phase 7. YOLO auto-merge per trust-gradient (count=0/threshold=0).
