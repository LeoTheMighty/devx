---
hash: pin104
type: dev
created: 2026-07-14T12:03:00-07:00
title: install:global + SHA provenance + docs-to-reality (INSTALL.md, SETUP.md)
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: in-progress
owner: /devx-2026-07-15T1014-98093
blocked_by: [pin101]
branch: feat/dev-pin104
---

## Goal

Distribution v1: `npm run install:global` installs from this checkout with
git-SHA version provenance, and the install docs describe only what
exists. Phase 4 of workstream `portability-install` (plan.md § Phase 4);
parallel-safe with pin102/pin103.

## Acceptance criteria

- [ ] `scripts/build-info.mjs` writes `dist/build-info.json`
      `{ sha, builtAt }` from `git rev-parse --short HEAD`; wired into
      `npm run build`; `dist/build-info.json` not git-tracked.
- [ ] Version surface (src/cli.ts:99 + small `src/lib/version.ts`):
      `devx --version` → `<semver>+<sha>` when build-info exists, plain
      semver otherwise (no codegen in src/). The skills header (pin102)
      and init's `devx_version` stamp consume the same resolved string.
- [ ] `npm run install:global` = build + `npm i -g .`; verified on this
      machine: `devx --version` = `0.1.0+<sha>` recorded in the status
      log.
- [ ] `test/version-sha.test.ts`: shape
      `/^\d+\.\d+\.\d+\+[0-9a-f]{7,}$/m` with build-info present; plain
      semver without.
- [ ] `INSTALL.md` rewritten: local global install is the documented path
      (package unpublished); explicit npm-link warning; **work-repo
      caveat**: shared/work repos run BETA/PROD (never YOLO auto-merge),
      org policy on sending code to Claude is the operator's call
      (INTERVIEW Q#11).
- [ ] `docs/SETUP.md` Part 2 rewritten around `skills/` + `devx init`;
      phantom `install.sh` + v1 skill names (`devx-triage` etc.) deleted.
- [ ] Workstream eval E-6 flips GREEN
      (`npx tsx portability-install/evals/E-6_docs-paths.ts` exit 0) and
      E-5 flips GREEN (`…/E-5_version-sha.ts` exit 0).
- [ ] Full suite green.

## Technical notes

- E-6 enumerates its phantom checks (install.sh, devx-triage, skills/
  existence, install:global presence, npm-link warning) — the doc rewrite
  must satisfy exactly those plus read coherently.
- Keep `private: true`.

## Status log

- 2026-07-14T12:03 — emitted by /devx-plan RED stage (b3f7a1, phase 4/5).
- 2026-07-15T10:14:45-06:00 — claimed by /devx in session /devx-2026-07-15T1014-98093
