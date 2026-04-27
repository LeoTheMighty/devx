---
hash: cfg202
type: dev
created: 2026-04-26T19:35:00-07:00
title: YAML round-trip lib using eemeli/yaml
from: _bmad-output/planning-artifacts/epic-config-schema.md
plan: plan/plan-a01000-2026-04-26T19:30-foundation.md
status: in-progress
branch: feat/dev-cfg202
owner: /devx
---

## Goal

Implement `src/lib/config-io.ts` providing comment-preserving YAML I/O for `devx.config.yaml` (project) and `~/.devx/config.yaml` (user). Built on `eemeli/yaml`'s `parseDocument` mode. Supports leaf-scalar writes only in Phase 0.

## Acceptance criteria

- [ ] `loadProject()` and `loadUser()` parse with `parseDocument` mode and return the `Document` instance
- [ ] `loadMerged()` deep-merges (project overrides user) for reads; returns plain JS object
- [ ] `setLeaf(path: string[], value: string|number|bool, target: 'project'|'user')` writes via `doc.setIn(path, value)` and serializes with `doc.toString()`
- [ ] User-config path resolution cross-platform: `$XDG_CONFIG_HOME/devx/config.yaml` → fall back to `~/.config/devx/config.yaml` (Linux); `~/.devx/config.yaml` (macOS); same as Linux on WSL
- [ ] Round-trip regression test: load `test/fixtures/valid-yaml-with-comments.yaml`, set a leaf scalar, write back; assert diff is exactly the one-line change (no comments, ordering, anchors lost)
- [ ] Refuses sub-tree writes; throws `Error("Phase 0 supports leaf scalar writes only — see Phase 1")` if path resolves to a non-scalar
- [ ] Atomic write: tmp file + rename, never partial

## Technical notes

- Avoid `js-yaml` — it discards comments.
- `eemeli/yaml` has a `parseDocument` API that returns a CST-backed `Document`. Mutate via `doc.setIn`; serialize via `doc.toString()`.

## Status log

- 2026-04-26T19:35 — created by /devx-plan
- 2026-04-26T20:00 — claimed by /devx; branch feat/dev-cfg202 (single-branch model — git.integration_branch is null per devx.config.yaml; spec frontmatter said develop/dev-cfg202 which is stale, corrected here). Note: spec ACs say XDG-on-Linux for user-config path; epic-config-schema.md "locked decisions" say `~/.devx/` everywhere. Following spec ACs (source of truth). On macOS the two are identical so no behavior delta for this project.
- 2026-04-26T20:30 — implemented + self-reviewed + local CI clean (17 cfg202 tests + 3 schema-smoke tests pass, typecheck clean). PR opened: https://github.com/LeoTheMighty/devx/pull/5. Awaiting human merge — no GitHub Actions workflow exists yet and prior PRs (#1-#4) were all merged by the user; following established practice. Implementation note: setLeaf mutates the existing Scalar.value in place rather than going through doc.setIn — setIn replaces the Scalar node and loses any inline comment attached to it, which the spec's "no comments lost" diff regression guards against. Falls back to setIn only when the path doesn't exist yet.
