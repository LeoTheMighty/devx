---
hash: cli305
type: dev
created: 2026-04-26T19:35:00-07:00
title: Cross-platform install + WSL PATH detection
from: _bmad-output/planning-artifacts/epic-cli-skeleton.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
owner: /devx-2026-04-26T20:30-cli305
blocked_by: [cli304]
branch: feat/dev-cli305
---

## Goal

Document the cross-platform install matrix and add WSL-specific detection: warn the user if `npm i -g` is landing binaries on the Windows host (`/mnt/c/`) instead of the WSL filesystem.

## Acceptance criteria

- [ ] `package/INSTALL.md` documents install on macOS / Ubuntu / WSL2-Ubuntu / Windows-host
- [ ] Postinstall (cli304) detects WSL via `uname -r` containing `microsoft` AND `npm config get prefix` matching `/mnt/c/`; prints recommendation `npm config set prefix ~/.npm-global` + PATH update line
- [ ] GitHub Actions matrix runs vitest on macos-latest + ubuntu-latest (Windows-host best-effort manual)
- [ ] WSL detection short-circuits cleanly when not WSL — zero overhead

## Technical notes

- Don't try to detect Windows-from-PowerShell paths from inside Node — the platform identifier is sufficient.
- WSL-host crossover is the single most common install foot-gun for Node CLIs.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T20:30 — claimed by /devx in session 2026-04-26T20:30-cli305
- 2026-04-26T20:31 — implemented + self-reviewed; refactored postinstall.js into wrapper + postinstall-lib.mjs with WSL host-crossover detection; added INSTALL.md (at repo root, not package/) + .github/workflows/devx-ci.yml matrix (macos-latest + ubuntu-latest, Node 20). 25 new tests (106 total green).
- 2026-04-26T20:32 — merged via PR #12 (squash → 1a58274)
