---
hash: pin104
type: dev
created: 2026-07-14T12:03:00-07:00
title: install:global + SHA provenance + docs-to-reality (INSTALL.md, SETUP.md)
from: plan/plan-b3f7a1-2026-07-14T10:40-portability-install.md
plan: _devx/workstreams/portability-install
status: done
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
- 2026-07-15T10:16 — phase 2: spec ACs direct (v2 native); 8 ACs; workstream=portability-install; red-artifacts=E-5_version-sha.ts,E-6_docs-paths.ts — re-ran both, RED confirmed (E-5: no build-info.mjs; E-6: 4 phantom/missing doc checks).
- 2026-07-15T10:35 — phase 3: implemented — scripts/build-info.mjs (+ stale-embed cleanup), src/lib/version.ts resolveVersion() consumed by cli.ts/--version + init.ts skills header + init-questions devx_version stamp (hardcoded DEVX_VERSION const removed); npm run install:global; INSTALL.md + docs/SETUP.md rewritten (phantom install.sh + devx-triage deleted; npm-link warning; work-repo BETA/PROD + org-policy caveat). E-5 + E-6 GREEN.
- 2026-07-15T10:33 — AC 3 verified on this machine: `npm run install:global` → `devx --version` = 0.1.0+e83febb.
- 2026-07-15T10:36 — phase 4: single-pass adversarial review (~160 src LoC, docs-dominated diff, under 3-agent threshold); 4 findings (0 HIGH, 1 MED, 3 LOW); ALL fixed in-place — MED: stale dist/build-info.json survived a failed SHA probe (version could report a sha the build didn't come from; now rmSync'd); LOW: verified decideSkillInstall exact-string compare means +sha differences correctly overwrite (pin102 anticipated), config schema devx_version accepts the composed string, cli --version test is prefix-tolerant; re-review clean.
- 2026-07-15T10:42 — phase 5: local CI green — full suite 2126 passed (109 files; was 2121), typecheck + schema + config gates in npm test.
- 2026-07-15T10:36 — phase 7: PR opened https://github.com/LeoTheMighty/devx/pull/74; tour built + published; remote CI devx-ci green (run 29432638535).
- 2026-07-15T10:37 — phase 8: hold clear; merge-gate {"merge":true} exit 0.
- 2026-07-15T10:37 — merged via PR #74 (squash → 4e6bc43)
