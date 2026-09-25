---
hash: 143227
type: debug
created: 2026-09-25T10:16:00-06:00
title: "storage.worktree_root is declared, documented, written by init — and read by nothing"
from: plan/plan-47b842-2026-09-25T09:37-loop-and-mobile-scope-review.md
status: ready
owner: null
branch: null
---

## Goal

A knob in `devx.config.yaml` either changes behavior or does not exist.

`storage.worktree_root` looks configurable and is not. Every consumer
hardcodes `.worktrees`, so a user who sets it gets silent non-compliance —
worktrees land somewhere other than where their config says.

## Evidence

Measured on `main` at `a794c62`:

- **Writers / declarations:** `src/lib/init-write.ts:510` (writes
  `worktree_root: ".worktrees"` into a fresh config),
  `_devx/config-schema.json:788`, `devx.config.yaml:303`,
  `docs/CONFIG.md:377`.
- **Readers: none.** No `worktree_root` / `worktreeRoot` read anywhere in
  `src/`.
- **Hardcoded instead**, four sites: `src/lib/doctor/detect.ts:735`,
  `src/lib/devx/claim.ts:1511`, `src/lib/devx/finalize.ts:726`,
  `src/lib/loop/driver.ts:1174`.

Same shape as `debug-inert1` (computed and never read), one layer out: this
one is not merely unread, it is *documented to users as an option*.

## Acceptance criteria

- [ ] AC 1: Decide, don't split the difference — either the four sites read
      the knob, or the knob is removed from the schema, `devx.config.yaml`,
      `docs/CONFIG.md` and `init-write.ts`. Half-honoring it is worse than
      either.
- [ ] AC 2: If honored: a repo configured with a non-default root has its
      worktrees created, found and removed there, end to end — claim,
      finalize, doctor, and the loop driver. A test proves it with a real
      non-default value, not the default.
- [ ] AC 3: If removed: a config carrying the old key still loads without
      error (it is in every config `devx init` has ever written), and the
      removal is noted where users would look.
- [ ] AC 4: Whichever way, no call site keeps a private `.worktrees` literal
      that the others don't share.

## Technical notes

- **Recommendation: honor it.** `.worktrees` inside the repo is the wrong
  default for the dev-environment lease work under discussion (each worktree
  carrying its own ~1 GB venv filled the root volume on 2026-09-22); a
  configurable root is exactly the escape hatch that problem wants. But that
  is a recommendation, not a decision — AC 1 is deliberately either/or.
- Filed from `plan-47b842`'s measurement pass, not fixed there: it is
  unrelated to the loop-freeze decision and deserves its own diff.

## Status log

- 2026-09-25T10:16-06:00 — filed. Writers, readers and the four hardcoded
  call sites all verified by grep at `a794c62`.
