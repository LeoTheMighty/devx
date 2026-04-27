---
hash: cli301
type: dev
created: 2026-04-26T19:35:00-07:00
title: npm package scaffold + commander dispatch
from: _bmad-output/planning-artifacts/epic-cli-skeleton.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: done
branch: feat/dev-cli301
owner: /devx
merged_pr: 7
merged_sha: 3641bd6
---

## Goal

Scaffold the `@devx/cli` npm package: `package.json` with `bin` entry, `tsconfig.json` strict mode, `vitest` setup, root entrypoint at `src/cli.ts` using `commander` for command dispatch via a static registration array.

## Acceptance criteria

- [x] `package.json` has `bin: { devx: "./dist/cli.js" }`, `engines.node: ">=20"`, `type: "module"`
- [x] `tsconfig.json` strict mode + `module: ESNext` + `target: ES2022`
- [x] `vitest.config.ts` with coverage threshold matching `coverage.threshold` from `devx.config.yaml`
- [x] `src/cli.ts` registers commands from a static array (no glob magic); `node dist/cli.js --help` exits 0
- [x] Build pipeline: `npm run build` → tsc → `dist/cli.js`
- [x] Smoke test: `devx --help` exits 0 with non-empty stdout
- [x] CI green on the smoke test (no remote workflow yet — local gates authoritative per /devx Phase 7 contract)

## Technical notes

- Use `commander` (mature, TypeScript-friendly) over `cac` (smaller but less type-helpful).
- Static registration array beats glob discovery — no surprise.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T19:55 — claimed by /devx; branch feat/dev-cli301 (single-branch YOLO; integration_branch: null)
- 2026-04-26T20:07 — impl complete: package.json (@devx/cli, bin, engines), tsconfig.build.json, vitest.config.ts (threshold sourced from devx.config.yaml via loadValidatedConfig), src/cli.ts (commander + static array), test/cli.test.ts. `npm run build` → dist/cli.js → `node dist/cli.js --help` exits 0 with non-empty stdout. Existing cfg201/cfg202/cfg203 tests still green.
- 2026-04-26T20:09 — self-review found 2 bugs, fixed in same commit: (HIGH) `isMainEntry()` failed for symlinked bin (npm i -g path) — fixed with `realpathSync` on both sides, regression test added; (MED) `npm test` skipped subprocess smoke when dist/ absent — fixed by chaining `npm run build` before `vitest run`.
- 2026-04-26T20:10 — PR #7 opened https://github.com/LeoTheMighty/devx/pull/7; no remote CI workflow detected (.github/workflows/ missing) — local gates are authoritative per /devx Phase 7 contract.
- 2026-04-26T20:11 — merged via PR #7 (squash → 3641bd6). Reconciled local main with origin (claim commit 4c85ab6 was not pushed before PR open → squash subsumed it; reset --hard origin/main was safe since 3641bd6 contains the claim diff). Filed debug-flow01 to fix the claim-not-pushed flow.
