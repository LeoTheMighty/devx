---
hash: cli301
type: dev
created: 2026-04-26T19:35:00-07:00
title: npm package scaffold + commander dispatch
from: _bmad-output/planning-artifacts/epic-cli-skeleton.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: ready
branch: develop/dev-cli301
---

## Goal

Scaffold the `@devx/cli` npm package: `package.json` with `bin` entry, `tsconfig.json` strict mode, `vitest` setup, root entrypoint at `src/cli.ts` using `commander` for command dispatch via a static registration array.

## Acceptance criteria

- [ ] `package.json` has `bin: { devx: "./dist/cli.js" }`, `engines.node: ">=20"`, `type: "module"`
- [ ] `tsconfig.json` strict mode + `module: ESNext` + `target: ES2022`
- [ ] `vitest.config.ts` with coverage threshold matching `coverage.threshold` from `devx.config.yaml`
- [ ] `src/cli.ts` registers commands from a static array (no glob magic); `node dist/cli.js --help` exits 0
- [ ] Build pipeline: `npm run build` → tsc → `dist/cli.js`
- [ ] Smoke test: `devx --help` exits 0 with non-empty stdout
- [ ] CI green on the smoke test

## Technical notes

- Use `commander` (mature, TypeScript-friendly) over `cac` (smaller but less type-helpful).
- Static registration array beats glob discovery — no surprise.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
