<!-- refined: party-mode 2026-04-28 (inline critique; thoroughness=balanced; lenses: PM/Dev/Architect/Infra/Murat — UX skipped, no frontend layer) -->

# Epic — Mode-derived merge gate (renamed from epic-promotion-gate-yolo-beta)

**Plan:** `plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md`
**Slug:** `epic-merge-gate-modes`
**Order:** 1 of 5 (Phase 1 — Single-agent core loop) — independent
**User sees:** "When `/devx` decides whether to auto-merge a PR, the decision is one function call: `mergeGateFor(mode, signals)`. The same function is what (future) develop→main promotion will call. Same gate, two consumption sites — exercised by every self-host run."

## Overview

The plan-spec b01000 originally named this `epic-promotion-gate-yolo-beta`, framed as a `develop → main` gate. Per Q1=(c) (resolved 2026-04-28), the epic is rebranded to `epic-merge-gate-modes` and reduced to a single primitive that both consumers call: `/devx`'s feature-branch → `main` merge under single-branch (the only path exercised by self-host) and the latent `/devx-manage` `develop → main` promotion path under split-branch (built and unit-tested but dead-code-until-needed). One implementation, one truth table, no duplicated mode logic across two skills.

## Goal

Eliminate the "what does merge mean in YOLO" / "what does promotion mean in BETA" decision points scattered across `/devx` and (eventually) `/devx-manage`. A single pure function returns `{merge, reason, advice?}` from `(mode, signals)`. Skills consume the decision; they don't re-implement it. Every mode change in `devx.config.yaml` propagates uniformly.

## End-user flow

1. Leonid runs `/devx <hash>`. `/devx` reaches Phase 8 (auto-merge step).
2. `/devx` calls `devx merge-gate <hash>` (or invokes `mergeGateFor()` inline). The CLI passthrough reads `devx.config.yaml`, the spec file, and live PR/CI state via `gh`. It prints a JSON gate decision: `{merge: true, reason: "YOLO + ci=success"}`.
3. `/devx` parses the decision; `merge: true` → executes `gh pr merge --squash --delete-branch`; `merge: false` → emits the `reason` to status log and stops or files INTERVIEW per `advice`.
4. Same flow under BETA (gate = YOLO + no blocking comments) and PROD (gate = BETA + coverage clear) and LOCKDOWN (gate = always false; advice = "manual merge required"). Trust-gradient override files INTERVIEW regardless of mode when `count < initialN`.
5. (Latent path) When a non-self-host devx user opts into split-branch (`git.integration_branch: develop`), `/devx-manage`'s `promoteIntegrationToDefault()` calls `mergeGateFor(mode, signals)` at the develop→main step. Same truth table, same advice.

## Backend changes

- New file `src/lib/merge-gate.ts` exporting:
  - `type Mode = 'YOLO' | 'BETA' | 'PROD' | 'LOCKDOWN'`
  - `type GateSignals = { ciConclusion: 'success' | 'failure' | 'cancelled' | null; blockingReviewComments: number; coveragePctTouched: number | null; lockdownActive: boolean; trustGradient: { count: number; initialN: number } }`
  - `type GateDecision = { merge: boolean; reason: string; advice?: string[] }`
  - `function mergeGateFor(mode: Mode, signals: GateSignals): GateDecision`
- New file `src/lib/manage/promote.ts` exporting `function promoteIntegrationToDefault(mode, signals): Promise<{promoted: boolean; reason: string}>`. Implementation calls `mergeGateFor()` and (when `merge: true`) executes `gh api repos/<org>/<repo>/merges` from `develop` to `main`. **Currently called from nowhere in self-host.** Documented as dead-code-until-split-branch in the file header so it's findable when needed.
- New CLI subcommand `devx merge-gate <hash>` in `src/commands/merge-gate.ts`. Reads spec, config, and live PR/CI state via `gh`; calls `mergeGateFor()`; prints JSON decision to stdout. Exit 0 on `merge: true`, exit 1 on `merge: false`. Used by `/devx` Phase 8 as an externalized decision step (debuggable; testable without spinning the whole skill).
- `src/lib/help.ts` — register `merge-gate` as a Phase 1 real command (drops the stub annotation).

## Infrastructure changes

None. (No CI pipeline changes; no GitHub Actions wiring; no secrets.) Only adds a CLI subcommand and a TS module; everything tested via vitest.

## Design principles (from research)

- **One source of truth for gate logic.** Two skills can disagree about modes; one function cannot. Repeated cross-epic-pattern-class regression (LEARN.md) is "skill body says X, code says Y" — extracting the decision into a tested pure function eliminates that class.
- **Pure function + thin wiring.** No I/O inside `mergeGateFor()`. CLI passthrough collects signals (gh state, coverage, config) and feeds the pure function. Easy to unit-test the truth table; easy to integration-test the wiring separately.
- **Default to safe (no-merge).** Unknown mode, malformed signals, missing config → `{merge: false, reason: 'unsafe defaults'}`. Never auto-merge in ambiguity.
- **Trust-gradient is an override, not a mode-leaf.** Explicit override that fires regardless of mode. Code path: check trust-gradient first; if blocked, return INTERVIEW advice; otherwise mode logic.
- **Advice as a string array.** When `merge: false`, advice carries actionable next steps (`["file INTERVIEW Q#X for approval"]` or `["wait for CI", "address blocking comments"]`). Skills parse advice and act; users grep for it.
- **Develop→main is built but cold.** A function in `src/lib/manage/promote.ts` exists, has tests, and is callable. No call site in self-host. The cost (one file + tests) is small; the value (zero-rework when split-branch users arrive) is high.

## File structure

```
src/
├── lib/
│   ├── merge-gate.ts                       ← new: mergeGateFor() pure function
│   └── manage/
│       └── promote.ts                      ← new: promoteIntegrationToDefault() wrapper (dead-code-until-split-branch)
├── commands/
│   └── merge-gate.ts                       ← new: `devx merge-gate <hash>` CLI passthrough
└── lib/help.ts                             ← modified: drop stub annotation for merge-gate
test/
├── merge-gate-truth-table.test.ts          ← new: per-mode truth-table tests
├── merge-gate-trust-gradient.test.ts       ← new: trust-gradient override tests
├── merge-gate-cli.test.ts                  ← new: CLI passthrough tests (gh mock)
└── promote-integration.test.ts             ← new: promote dead-path tests (calls gate; mocks gh api merges)
```

## Story list with ACs

### mrg101 — `mergeGateFor()` pure function + truth-table tests
- [ ] `src/lib/merge-gate.ts` exports `Mode`, `GateSignals`, `GateDecision`, and `mergeGateFor(mode, signals)`.
- [ ] Truth table holds for all 4 modes against all relevant signal combinations:
  - YOLO: `merge=true` iff `ciConclusion ∈ {success, null}` AND `lockdownActive == false`. (`ciConclusion: null` ↔ "no remote CI configured" — local gates were authoritative; YOLO accepts.)
  - BETA: YOLO conditions + `blockingReviewComments == 0`.
  - PROD: BETA conditions + `coveragePctTouched != null AND coveragePctTouched >= 1.0`.
  - LOCKDOWN: `merge=false` always; `reason: "lockdown active; manual merge required"`.
- [ ] Trust-gradient override: `count < initialN` returns `{merge: false, reason: "trust-gradient: <count>/<initialN>", advice: ["file INTERVIEW for approval"]}` — checked BEFORE mode logic.
- [ ] Unknown / malformed mode returns `{merge: false, reason: "unknown mode: <value>"}`.
- [ ] Missing `coveragePctTouched` under PROD returns `{merge: false, reason: "PROD: coverage data missing"}`.
- [ ] No I/O inside the function — pure (verified by test that imports the file with `fs` and `child_process` shadowed to throw on use).
- [ ] Vitest tests: `test/merge-gate-truth-table.test.ts` covers ≥ 16 distinct rows; `test/merge-gate-trust-gradient.test.ts` covers override-applies-and-overrides-mode-success cases.

### mrg102 — `devx merge-gate <hash>` CLI passthrough + integration into `/devx` Phase 8
- [ ] `src/commands/merge-gate.ts` registers `devx merge-gate <hash>`. Reads spec file at `dev/dev-<hash>-*.md` (resolves via `dev/` glob); reads `devx.config.yaml`; calls `gh pr view <#>` and `gh pr checks <#>` for live signals; calls `mergeGateFor()`; prints JSON decision to stdout.
- [ ] Exit 0 on `merge: true`; exit 1 on `merge: false`. (Lets shell-style `if devx merge-gate "$HASH"; then gh pr merge ...; fi` consume the decision.)
- [ ] When no PR exists for the spec yet (frontmatter has no PR link), exit 2 + `{merge: false, reason: "no PR yet"}`.
- [ ] Coverage signal sourced from `coverage` runner output if `devx.config.yaml → coverage.enabled` is true; else `null`.
- [ ] `.claude/commands/devx.md` Phase 8 updated to invoke `devx merge-gate <hash>` (CLI passthrough) instead of inlining mode logic. Removes the existing "Behavior by mode" table from the skill body — it now lives in `merge-gate.ts` only.
- [ ] Test fixtures: golden spec + config + mocked `gh` outputs → expected JSON decision per mode.
- [ ] `src/lib/help.ts` shows `devx merge-gate` as Phase 1 real command (no `(coming in Phase N)` annotation).

### mrg103 — Develop→main promotion code path (latent / dead-code-until-split-branch)
- [ ] `src/lib/manage/promote.ts` exports `promoteIntegrationToDefault(mode, signals)`. Implementation: call `mergeGateFor(mode, signals)`; if `merge: true`, call `gh api repos/<owner>/<repo>/merges` (POST `{base: 'main', head: 'develop'}`); return `{promoted, reason}`.
- [ ] File header comment block declares: "DEAD CODE in self-host (single-branch). Exercised only when `git.integration_branch != null`. Do not delete; this is the contract for future split-branch users. Tests below prove the contract."
- [ ] Tests `test/promote-integration.test.ts` cover: gate-says-merge → API called; gate-says-no-merge → API not called; LOCKDOWN → not called; trust-gradient block → not called.
- [ ] Not registered as a CLI subcommand. Not called from `/devx-manage` v0. Importable for future use.

### mrgret — Retro: bmad-retrospective on epic-merge-gate-modes
- [ ] Run `bmad-retrospective` against the 3 shipped stories (mrg101, mrg102, mrg103); append findings to `LEARN.md § epic-merge-gate-modes`.
- [ ] Each finding tagged `[confidence]` (low/med/high) + `[blast-radius]` (memory / skill / template / config / docs / code).
- [ ] Low-blast-radius findings applied in the retro PR.
- [ ] Higher-blast-radius findings filed as `MANUAL.md` rows or new dev specs.
- [ ] Cross-epic patterns hitting ≥3 retros total promoted into `LEARN.md § Cross-epic patterns`.
- [ ] Sprint-status row for `mrgret` present + `LEARN.md § epic-merge-gate-modes` section exists with new content.

## Dependencies

- **Blocked-by:** none (independent — no Phase 1 peer dependencies).
- **Blocks:** `epic-devx-skill` (mrg102 lands the CLI passthrough that `/devx` Phase 8 consumes).

## Open questions for the user

None. Q1 resolved (rebrand + unified primitive). Trust-gradient is `0/0` for this project; never fires.

## Layer-by-layer gap check

- **Backend:** mrg101 + mrg102 + mrg103. Pure function, CLI passthrough, latent split-branch wrapper. ✓
- **Infrastructure:** None — no CI / GitHub / supervisor changes. ✓ explicit (only the `gh pr merge` invocation in `/devx`'s Phase 8 already exists; this epic doesn't change it).
- **Frontend:** None — no UI surface. ✓

## Party-mode refined (2026-04-28, inline)

Lenses applied: PM, Dev (backend), Architect, Infra, Murat (QA / test architect). UX skipped — no frontend layer.

### Findings + decisions

**PM (end-user value).** The end-user value here is "the gate decision is unambiguous + auditable." A skill-body table is ambiguous (LLM reading drift); a tested function is not. ✓ Plan delivers this. No flow changes.

**Dev (backend framing).** Two sharp questions:
- *Where does `coveragePctTouched` come from at the gate site?* The signal-collection surface is in `merge-gate.ts`'s caller (the CLI passthrough mrg102), not in the pure function. **Locked decision:** mrg102 spec gets an explicit AC: "Coverage signal collection from `coverage:` runner output is mocked at unit-test layer; integration test exercises with vitest fixture coverage report (no real CI run required)."
- *What about partial CI conclusions?* `gh pr checks` can return mixed states (`success`, `failure`, `pending`, `cancelled`, `skipped`, `neutral`, `action_required`). Pure function only handles `success | failure | cancelled | null`. **Locked decision:** mrg101 AC bumped — non-success conclusions other than `cancelled` (e.g., `pending`, `action_required`) treat as `failure` for the gate's purposes; reason string includes the raw conclusion for audit.

**Architect.** Concern: tying `mergeGateFor()` shape to the mode-derived merge gate makes it hard to add per-project signal weights later (e.g., a project that wants `coverage >= 0.9` instead of `1.0` under PROD). **Locked decision:** out of scope for Phase 1 — `mergeGateFor()` honors mode-derived thresholds only; per-project tuning lands as a Phase 9 epic (`epic-modes-and-gates`). Function signature is stable; tuning will pass extra knobs through `signals.config` without breaking the surface.

**Infra.** No infra changes — confirmed. Concern: mrg103's "dead code" path against split-branch projects could rot silently. **Locked decision:** mrg103 AC bumped — `test/promote-integration.test.ts` covers ALL gate-decision paths (4 modes × success/failure CI × trust-gradient on/off); promote function is exercised in CI even though no production code calls it.

**Murat (QA / Test architect).** Risks:
- *Hidden coupling between gate and PR description.* If `gh pr view` returns malformed JSON, the gate decision could mis-fire. **Locked decision:** mrg102 AC bumped — graceful-degrade path: malformed `gh` output → exit 2 + `{merge: false, reason: "gh signal collection failed"}`. Never auto-merge on signal failure.
- *Truth-table size.* 4 modes × 4 CI states × 2 lockdown × 2 trust-gradient × 4 coverage states = 256 combinations. Realistic minimum: ≥16 distinct rows covering edge cases (each mode's pass/fail boundary; trust-gradient override; LOCKDOWN regardless; null-CI under YOLO). ✓ Already in mrg101 AC.
- *Murat would explicitly add:* a regression test asserting `mergeGateFor()` is import-pure (no `fs`, no `child_process`, no global state mutation). ✓ Already in mrg101 AC.

### Cross-epic locked decisions added to global list
1. **Mode-gate is a pure function consumed via `devx merge-gate <hash>` CLI passthrough.** No skill-body inlining of mode logic. (Anchor for dvx106.)
2. **Non-success CI conclusions (other than `cancelled`) treat as `failure` at the gate.** Reason string carries raw conclusion.
3. **`gh` signal-collection failure → safe-default `{merge: false, reason: "gh signal collection failed"}`.** Never auto-merge on uncertain signals.

### Story boundary changes
None. mrg101 / mrg102 / mrg103 / mrgret unchanged in scope.
