# INTERVIEW — Questions for the user

Items here block agents waiting on a decision **a human must make**. Distinct
from `MANUAL.md` (actions the user must take). Agents file Q-numbered entries;
you answer inline by checking the box and adding `→ Answer: ...`.
ManageAgent detects answered questions and unblocks the waiting items on its
next reconcile tick.

Format:

```markdown
- [ ] Q#N (from <agent-id> on <spec-hash>)
  - Context: <one sentence on what's blocking>
  - Question: <the question>
  - Blocks: <spec-hash(es) waiting on the answer>
  - Options: (a) ..., (b) ..., (c) ...
  - Agent recommendation: <option + one-line why>
```

---

## Bootstrap questions (from /devx session 2026-04-26)

These predate any agent run. They're decisions the user has signaled informally
in conversation; pinning them here turns the signal into a checkable answer the
loop can read.

- [x] **Q#1 — Confirm YOLO is the right starting mode.**
  - Context: `devx.config.yaml` is being seeded. Mode cascades to every gate,
    autonomy ladder, and ceremony in the system.
  - Question: Confirm `mode: YOLO` for the devx-self project — no real users,
    pre-launch dogfood, ship-on-green-only?
  - Blocks: every gate and promotion decision in this repo.
  - Options: (a) YOLO (current), (b) BETA, (c) PROD.
  - Agent recommendation: (a) — explicitly requested in seeding conversation;
    no users, no data to lose. Reassess at first external dogfooder.
  → Answer: (a) YOLO.

- [x] **Q#2 — Project shape detection.**
  - Context: Repo has commits + planning artifacts but no production code yet.
    `project.shape` shapes DevAgent behavior (rewrite freedom, blast radius).
  - Question: Is `empty-dream` the right shape, or is this
    `bootstrapped-rewriting`?
  - Blocks: DevAgent rewrite latitude, parallelism cap.
  - Options: (a) `empty-dream` — fully greenfield, (b)
    `bootstrapped-rewriting` — has commits, expects big refactors, (c)
    `mature-refactor-and-add`.
  - Agent recommendation: (a) — no shippable code exists yet; planning
    artifacts only. Bump to (b) once `cli301` lands and there's a real CLI to
    refactor.
  → Answer: (a) `empty-dream`.

- [x] **Q#3 — Confirm `develop` branch creation.** *(superseded by Q#7)*
  - Context: `/devx` requires a `develop` branch as the integration target;
    only `main` exists locally and on `origin`.
  - Question: OK to `git checkout -b develop && git push -u origin develop`
    and set branch protection on `main` per `docs/MODES.md` §3?
  - Blocks: every `/devx` run; spec `M3.2` in `MANUAL.md`.
  - Options: (a) yes, do it now, (b) yes but I'll do it manually, (c) defer
    until first real `/devx` claim.
  - Agent recommendation: (a) — required for the loop; `MANUAL.md` already
    flags this as `M3.2`.
  → Answer: Originally (a). Develop was created and the bootstrap commits
    landed there. Then superseded by Q#7 — this project no longer uses a
    develop/main split, and the develop branch is being collapsed back into
    main. /devx is being updated to make the split optional system-wide.

- [x] **Q#4 — Stack confirmation for the devx CLI itself.**
  - Context: Phase 0 epic `epic-cli-skeleton` (`cli301`) needs a language +
    runtime decision before scaffolding. `devx.config.yaml` currently
    placeholder-stubs the `cli` project.
  - Question: What stack for the `devx` CLI?
  - Blocks: `cli301` and everything blocked-by it (`cli302`–`cli305`,
    `cfg204`, `sup401`, `ini501` …).
  - Options: (a) Node + TypeScript + Bun (matches Worker; broad ecosystem),
    (b) Node + TypeScript + npm (most boring, widest reach), (c) Deno,
    (d) Rust, (e) Go.
  - Agent recommendation: (a) — `eemeli/yaml` already specced in `cfg202`;
    Bun's fast startup matters for a CLI invoked from supervisors; same
    runtime as the Cloudflare Worker keeps the toolchain count down.
  → Answer: (a) Node + TypeScript + Bun.

- [x] **Q#5 — Where the user is reachable for INTERVIEW pings.**
  - Context: `notifications.channels` is currently set to email-digest-only.
    Several Phase 0 epics will file INTERVIEW entries; if the user only checks
    email digests, blocking items will stall.
  - Question: Should INTERVIEW filings go push (immediate) or stay in the
    daily 09:00 digest while we're pre-mobile-app?
  - Blocks: nothing strictly, but affects responsiveness of the loop.
  - Options: (a) push immediately (email + future FCM), (b) digest only
    until mobile app ships (Phase 8 mobile-v0.3), (c) push for INTERVIEW +
    MANUAL only, digest for everything else.
  - Agent recommendation: (c) — INTERVIEW/MANUAL are the only things that
    actively block the loop; everything else can wait for the digest.
  → Answer: (c) push for INTERVIEW + MANUAL only; digest everything else.

- [x] **Q#6 — Daily spend cap.**
  - Context: `capacity.daily_spend_cap_usd` is seeded at $25 (soft) / $100
    (hard). Phase 0 work uses Opus for plan/focus/learn agents; cost will
    skew higher than typical dogfood.
  - Question: Are these caps right while building Phase 0–2?
  - Blocks: nothing immediately; `MANUAL.md` files an alert at soft cap, hard
    cap halts spawning.
  - Options: (a) keep $25/$100, (b) raise to $50/$200 for the build-out, (c)
    lower to $10/$30, (d) no cap during build-out.
  - Agent recommendation: (a) — start conservative; raise once first real
    dogfood week shows actual burn.
  → Answer: No dollar caps at all. Capacity gated exclusively on
    `capacity.usage_cap_pct` / `capacity.usage_hard_stop_pct` (percentage of
    Claude org limit hit). Removing `daily_spend_cap_usd` /
    `daily_spend_hard_cap_usd` from `devx.config.yaml`.
  → Note: `docs/CONFIG.md` §2 documents both knobs as defaults; agents reading
    that doc should treat the project config as authoritative when it omits
    them. Worth a future LearnAgent pass to make the dollar caps optional in
    the schema rather than required-with-defaults.

---

- [x] **Q#7 — Make develop/main split + branch protection optional.**
  - Context: Original Q#3 assumed the develop/main split + branch protection
    on `main` were mandatory. User has decided neither should be required —
    `/devx-init` should ask once, recommend the split for non-YOLO, and
    accept "no" cleanly. For this project specifically, opt out of both.
  - Question: Confirm the policy + project-level switch?
  - Blocks: this project's branch model going forward; the design of every
    `/devx-init` interview question 11.
  - Options: (a) recommended-not-required system-wide + this project opts out
    (single-branch on `main`, no protection), (b) keep mandatory.
  - Agent recommendation: (a) — matches user request 2026-04-26.
  → Answer: (a). Applied as:
    - `devx.config.yaml → git.integration_branch: null`,
      `branch_prefix: feat/`, `pr_strategy: pr-to-main`,
      `protect_main: false`.
    - `docs/DESIGN.md` §"Branching model" — relaxed from "opinionated" to
      "recommended; not required". Single-branch flow documented.
    - `docs/CONFIG.md` §4 — emphasize `null` integration_branch is
      first-class. Q11 reframed as "want the split + protection?"
    - `docs/MODES.md` §2.1 — clarify that promotion gate collapses into
      merge gate when single-branch.
    - `docs/ROADMAP.md` — locked-decisions list updated.
    - `.claude/commands/devx.md` — base branch + PR target now resolved
      from `git.*`; supports `pr-to-develop` / `pr-to-main` / `direct-to-main`.
    - `MANUAL.md` M3.1 + M3.2 marked N/A (struck through).
    - `develop` branch collapsed back into `main`.
  → Note: spec files `dev-ini503` (init github scaffolding) and
    `epic-init-skill.md` still reference the old assumption; LearnAgent /
    next /devx-plan pass should reconcile when those items get claimed.

---

- [ ] **Q#8 — Lock the Phase 2 sequence into rot-detection → spec-locks → build-isolation → autoscaling.**
  - Context: `docs/DESIGN.md §"Concurrency model — controller-pattern lineage"` (added 2026-05-02) names the K8s-controller analogy explicitly and sketches the autoscaling target. Phase 2 has several unspecced epics implied by the design (`epic-context-rot-detection`, `epic-spec-locks`, `epic-build-isolation`, `epic-controller-autoscaling`). Going N>1 (concurrent workers) without all four landed in order produces a system that races, corrupts dist/, and compounds context rot rather than catching it. The session 2026-05-02 walked through why each is a hard prerequisite and the natural ordering, but no INTERVIEW entry pins it — `/devx-plan` will see this for the first time when Phase 1 closes and could re-derive in any order if not constrained.
  - Question: Confirm the Phase 2 ordering as a planning constraint that `/devx-plan` and `/devx-manage` must respect, AND confirm "soak N=1 for at least 2 weeks before planning N>1" as a separate gate?
  - Blocks: every Phase 2 epic-emission decision; specifically prevents `/devx-plan` from emitting `epic-controller-autoscaling` before its three prerequisite epics.
  - Options:
    - (a) Lock the order: rot-detection → spec-locks → build-isolation → autoscaling. Soak N=1 ≥ 2 weeks before planning N>1. Codify both in `docs/ROADMAP.md` "Locked cross-epic decisions."
    - (b) Lock the order without the soak gate; trust `/devx-plan` to time the autoscaling epic on its own.
    - (c) Don't lock the order; let `/devx-plan` re-derive each time using the DESIGN.md narrative as input.
    - (d) Different order — specify.
  - Agent recommendation: (a) — the ordering isn't speculative; each epic literally requires the previous one's primitive (autoscaler can't manage workers it can't restart on rot; can't restart on rot without per-spec locks; can't run multiple workers with a shared dist/ build cache). The soak gate is the empirical step every Phase 0 retro flagged as missing-by-default and worth making structural. Cost of (a) is one paragraph in `docs/ROADMAP.md`; cost of (c) is re-deriving the same constraint at every Phase 2 planning pass + risk of picking the wrong order once.
  → Answer:

---

- [ ] **Q#9 — S-1 prose budget: the full-run surface measures 64.2 KB against the 60 KB end-to-end target.** (from /devx on dev-v2o101)
  - Context: v2o101's migration retro measured the prose actually loadable
    for one full PRD→merge run: planning surface (engine templates +
    `.claude/commands/devx-plan.md`) = 24,426 B — comfortably inside the
    60 KB budget — but adding `.claude/commands/devx.md` (which carries six
    arms: dispatch/execute/debug/address/retro/loop) brings the total to
    65,767 B, ~7% over the end-to-end target (and ~88% under the ~550 KB
    BMAD-era baseline). CI keeps gating the planning surface at 60 KB; a
    2×-budget drift tripwire on the full surface landed in
    `test/engine-prose-budget.test.ts`. Full record:
    `_devx/retros/v2-migration-2026-07-05.md` §"S-1 verification" +
    `LEARN.md § v2-migration` E8.
  - Question: Accept 64.2 KB as the new end-to-end budget reality, or
    shrink it back under 60 KB?
  - Blocks: nothing operationally (CI is green either way); blocks closing
    the S-1 ledger line honestly.
  - Options:
    - (a) Raise `engine.prose_budget_kb` to 70 with a rationale comment and
      add `devx.md` to the gated surface list — the budget becomes honest
      and enforced end-to-end.
    - (b) Split `devx.md`'s arms into lazily-referenced per-stage files so
      one run loads only its arm; keep the 60 KB budget.
    - (c) Leave as-is: planning surface gated at 60 KB, full surface
      tripwired at 120 KB, the number recorded in the retro.
  - Agent recommendation: (a) — the 60 KB figure predates the dispatcher
    absorbing six arms into one file; each per-stage §6 target is
    individually met, and (b) trades a real regression class (arm drift
    across files) for a symbolic 4 KB. Cheap, honest, enforced.
  → Answer:

---

- [x] **Q#10 — Supersede ROADMAP:16 "multi-project switcher deferred to v1.5": build the thin fleet layer now.** (from /devx drift-audit session 2026-07-14)
  - Context: The owner's intended use (palateful + a new website repo worked
    overnight on one machine, one shared Claude usage pool, one
    conversational front door) requires multi-repo orchestration.
    `docs/ROADMAP.md:16` locked "single-repo MVP; multi-project switcher
    deferred to v1.5" and ledger O-5 (`v2/07-decisions.md`) holds the
    single-repo invariant. Working agreements forbid silent product
    decisions — this entry is the provenance for the ledger amendment.
  - Question: Bring multi-project forward as a thin outer layer now?
  - Blocks: f1d6b2 (fleet layer plan) and its ledger/docs amendments.
  - Options: (a) thin fleet layer now — registry + serial `devx fleet loop`
    child-processing each repo's own loop + aggregated report + `/devx-fleet`
    front door; each repo stays a standalone single-repo instance;
    cross-repo *workstreams* stay out per O-5. (b) keep the v1.5 deferral.
  - Agent recommendation: (a) — preserves the single-repo invariant per
    instance; fleet is portfolio *scheduling*, not cross-repo planning.
  → Answer: (a) — owner decision 2026-07-14 (approved plan
    `sparkling-bubbling-pie`). Sequencing: vision-gap tracks first, mobile
    backlog paused until f1d6b2 ships. Interim notifications via GitHub
    blockers-issue @mention (doubles as phone-editable TODO), retired by the
    mobile relay when that backlog resumes.

---

- [ ] **Q#11 — Bringing devx into the work repo: mode + org-policy call.** (from /devx drift-audit session 2026-07-14)
  - Context: Portability (b3f7a1) makes `devx init` on any repo real. The
    owner floated using devx on a work repo. Mechanically identical to
    palateful, but two decisions are the owner's alone: (1) YOLO auto-merge
    is wrong for a shared work repo — mode must be BETA/PROD there; (2) org
    policy on sending proprietary code to Claude / running autonomous agents
    against a work codebase.
  - Question: When (if ever) do we init devx on the work repo, and under
    which mode/permissions profile?
  - Blocks: nothing — palateful + website are the near-term targets; this is
    deferred until the owner actually wants it.
  - Options: (a) defer until after the first successful palateful fleet
    night, then decide with evidence in hand, (b) never — personal projects
    only, (c) now, BETA mode, after checking org policy.
  - Agent recommendation: (a) — no reason to decide before the system has
    proven a real overnight night on a personal repo.
  → Answer:

- [ ] **Q#12 — Loop budget unit: which tokens should the rails count?** (from /devx session 2026-07-26, debug-494590)
  - Context: debug-494590 fixed the loop's token meter — workers now report
    authoritative cumulative usage (uncached input / output / cache-write /
    cache-read) from the CLI's stream-json result event, replacing chars/4
    of the final emission (which under-counted by ~3 orders of magnitude, so
    the 2M/item + 10M/run rails could never trip). The fix counts
    input + output + cache-creation ("new tokens processed") against the
    budgets and excludes cache READS (a trivial one-turn session reads ~17k
    cached tokens; counting re-reads of the same context every turn would
    trip 2M/item mid-first-iteration on every honest item). Cache reads are
    still recorded and rendered in the morning report.
  - Question: Is "new tokens processed" the right budget unit, and are the
    2M/item + 10M/run defaults still the intended scale for it?
  - Blocks: nothing — the corrected meter + counter shipped; this tunes it.
  - Options: (a) keep new-tokens counter + current defaults, adjust after
    the next real overnight run's report shows corrected figures, (b) count
    ALL tokens incl. cache reads and raise defaults ~10×, (c) switch the
    rails to cost-based budgets (the result event also reports
    total_cost_usd) and deprecate token units.
  - Agent recommendation: (a) — one real night of corrected data beats
    guessing; (c) is the better long-term unit but is a config-schema
    change, not a debug fix.
  → Answer:

- [ ] **Q#13 — Multi-loop concurrency v1 knobs (workstream 20eb6f).** (from /devx-plan session 2026-07-28)
  - Context: plan-20eb6f makes N concurrent scoped `devx loop`s safe on one
    repo (race inventory R1–R12 in the plan spec). Three tuning decisions
    are user-owned; the PRD proceeds on the recommendations below and none
    of them block the pipeline — answers retune config/flags before the
    first real multi-loop night.
  - Question (13a): Loop admission cap — honor the long-declared
    `capacity.max_concurrent: 5` as the default, or start lower while trust
    builds? Options: (a) 5, (b) 2, (c) 3.
  - Question (13b): What should `--epic` accept? Options: (a) the DEV.md
    heading slug, (b) the plan hash, (c) both, normalized to the same
    partition.
  - Question (13c): Cross-loop shared token budget (today budgets are
    per-process, so N loops spend N× the configured totals). Options:
    (a) explicit follow-up workstream, out of v1; (b) fold a shared-budget
    file into the instance registry story now.
  - Blocks: nothing — recommendations are applied as defaults.
  - Agent recommendation: 13a (a) — the knob was declared at 5 and is
    admission-checked, not a free-for-all; 13b (c) — both, normalized;
    13c (a) — follow-up; per-process budgets are safe, just uncoordinated.
  → Answer:

- [ ] **Q#14 — Claim branch inheritance: how wide should the attach arm be?** (from /devx session 2026-07-28, dev-mss102)
  - Context: mss102 AC 2 reads "when `branch:` names an existing branch, the
    worktree attaches to it (no `-b`)", and the design assumed "specs without
    `branch:` (all existing specs) take the derive path unchanged". That
    assumption is factually wrong: `validate-emit` requires every emitted spec
    to record its own derived branch name, so essentially every spec carries
    `branch:`. Implemented literally, the arm would fire on ordinary claims and
    silently ADOPT a leftover same-named branch (crashed loop run, closed-
    not-merged PR, failed `branch -D`) where the claim used to fail loudly at
    `worktree add -b`. Adversarial review flagged this twice independently.
  - Question: should attach be keyed on "recorded branch differs from the
    derived name" (i.e. only a genuine branch-handoff inherits), or fire
    whenever the recorded branch exists?
  - Blocks: nothing — mss102 shipped on the recommendation below; answering
    (b) is a small follow-up, not a revert.
  - Options: (a) recorded != derived (shipped) — ordinary claims keep
    pre-mss102 behavior byte-for-byte, debris still fails loudly, zero probe
    cost on the common path; (b) attach whenever the branch exists — literal
    AC 2, but silently adopts debris on every reclaim; (c) explicit
    `inherits_branch: true` marker written by `devx split` — most precise,
    but changes mss101's shipped `split.ts` and the spec format.
  - Agent recommendation: (a) as shipped, with (c) as the eventual clean
    form if inheritance ever needs to apply to a non-handoff spec. (a)
    satisfies every E-5 requirement (branch-handoff follow-ups are claimable
    cold; merge-first follow-ups derive) while strictly shrinking blast
    radius. Known residual: when a spec's recorded branch is stale w.r.t. the
    derived name for an unrelated reason (someone changed `branch_prefix` or
    `integration_branch` after emission), each claim now pays one `show-ref`
    plus one failed targeted `git fetch` and prints a WARN.

- [ ] **Q#15 — Split-chain escalation: should a repeatedly-split item ever
  reach a human?** (from /devx session 2026-07-28, dev-mss103)
  - Context: before mss103, an overnight item that exhausted its budget with
    real work landed `[-]` blocked — a human gate. With the budget rail
    splitting instead, the follow-up is an ordinary `[ ]` ready row, so an
    item that reliably lands one good iteration per night and never finishes
    now auto-continues indefinitely: one new spec, one struck parent row, one
    abandonment-streak reset per night, with no escalation. Nothing breaks
    structurally (titles no longer compound — the `Continue <hash>:` prefix is
    stripped on re-split), but the human gate that budget exhaustion used to
    provide is gone. Adversarial review flagged it as the one finding that is
    a product decision rather than a bug.
  - Question: cap the chain?
  - Blocks: nothing — mss103 ships option (a), which is today's behavior.
  - Options: (a) no cap — the morning report naming each split is escalation
    enough; (b) cap at N consecutive branch-handoff splits in one lineage
    (N=2 or 3), then `abandonItem` → `[-]` blocked so a human re-scopes;
    (c) no cap, but `devx next` surfaces a "split chain depth ≥ N" advisory
    row.
  - Agent recommendation: (b) with N=3 — a spec that needed four nights is
    mis-scoped, and re-scoping is exactly the judgment call the blocked state
    exists to request. Implementing it needs lineage depth (walking the
    `from:` chain at split time), so it belongs in its own follow-up spec
    rather than being retrofitted into this phase.

- [x] **Q#16 — PR #118 got no CI run at all: merge on a targeted-subset green, or fix the trigger first?** (from /devx on dev-sgr105)
  - Context: PR #118 (sgr105, `feat/dev-sgr105` → `main`) has had **zero**
    workflow runs since it opened. `devx devx-helper await-remote-ci
    feat/dev-sgr105 --once` returned `{"state":"empty"}` on 41 consecutive
    probes across ~50 minutes; `gh pr checks 118` says "no checks reported";
    `gh run list --branch feat/dev-sgr105` is empty.
    `.github/workflows/devx-ci.yml` triggers on `pull_request: branches:
    [main]`, which this PR matches, and peer branches `feat/dev-sgr106` and
    `feat/dev-28b267` got runs within minutes over the same window — so
    Actions is working and the `on:` filter looks correct. Cause unknown; it
    looks GitHub-side rather than config-side, but I could not prove that.
  - Blocks: dev-sgr105 (PR #118, open, unmerged)
  - Why this is not an auto-merge: `/devx` Phase 7 states that a persistent
    `empty` probe means "silent CI is a config bug, not a green light — do
    NOT auto-merge". `devx merge-gate sgr105` does return `{"merge":true}`,
    but the gate cannot distinguish "CI green" from "CI never ran", which is
    exactly the case Phase 7's rule exists to catch. Compounding it, the
    local full gate is red for reasons predating this branch
    (`debug-620337`), so there is no green signal from either side — only a
    targeted 12-file / 239-test subset covering the touched surface, plus
    E-5 green, typecheck, build, and `sync:skills --check`.
  - Options: (a) re-trigger CI (close/reopen the PR, or push an empty commit)
    and merge normally on green; (b) merge #118 as-is on the strength of the
    targeted subset; (c) investigate the trigger gap first and treat it as a
    defect in its own right before any merge.
  - Agent recommendation: (a) — cheapest, restores the real gate, and costs
    one round-trip. If a re-trigger also produces nothing, escalate to (c);
    a repo where PR CI silently does not fire breaks the merge gate for every
    future story, not just this one.
  → Answer: (a), on the user's "finish it". Closing and reopening PR #118
    re-triggered the workflow immediately — run 31042124974, devx-ci,
    conclusion **success**. Merged on that real signal (squash `4928dd9`);
    no subset-merge was needed.
  → Note: CI green on the full suite also settles `debug-620337` one way —
    those `loop-worker` / `manage-crash-restart-loop` failures do NOT
    reproduce on a clean runner, so they are worktree/host-local, not a code
    defect. `debug-620337`'s AC 3 (a worktree `npm test` green on an
    unmodified checkout) still stands.
  → Note: the residual question is unanswered and worth watching — why did
    the `pull_request` event not fire on OPEN, when peers `feat/dev-sgr106`
    and `feat/dev-28b267` got runs within minutes and the `on:` filter
    matches? One occurrence, self-healed by reopen, so not filed as a spec.
    If a second PR opens with no run, file it: `devx merge-gate` returned
    `{"merge":true}` throughout the outage because it cannot tell "CI green"
    from "CI never ran", so a silent trigger gap silently disables the gate.
  - **Resolved (2026-08-05, /devx sgr105 resume session):** root cause proven
    mechanically — `gh pr view 118 --json mergeable` returned `CONFLICTING`
    (`mergeStateStatus: DIRTY`). GitHub cannot build the merge ref for a
    conflicted PR, so `pull_request`-triggered workflows never start; that is
    why peers got runs and #118 got silence (main moved under the branch when
    #119 + #120 merged, conflicting in DEV.md/TEST.md/DEBUG.md/spec status
    log). Fix applied: merged `origin/main` into `feat/dev-sgr105`, resolved
    the three append-append conflicts, pushed — CI triggered on the merge
    commit. Lesson for the probe: `state: "empty"` should check mergeability
    and name `CONFLICTING` as a distinct, self-serviceable state.

---

## Phase 0 / cli301 prerequisites

Filled by `/devx` automatically when it tries to claim `cli301` and finds the
prerequisites unmet. Currently empty — Q#3 and Q#4 above carry the bootstrap
load.

---

## Mobile companion (Phase 8) prerequisites

Filed by `/devx` against the `dev-a*` / `dev-b*` / `dev-c*` / `dev-d*` epics
when picked up. Currently empty — `MANUAL.md` carries the prerequisites
(M1.x, M3.x, M4.x). INTERVIEW entries here will be questions like
"PAT scopes — repo + workflow only, or repo + workflow + read:org?" once
`b20001` is claimed.

---

## How to answer

1. Edit the line you want to answer; flip `[ ]` → `[x]`.
2. Add a `→ Answer:` bullet directly under the question.
3. Optionally add `→ Note:` lines with extra context the agent should carry
   into the spec status log.

Example:

```markdown
- [x] Q#7 (from DevAgent-7 on dev-a3f2b9)
  - Context: implementing Google OAuth callback
  - Question: Should the redirect URI use root domain or a dedicated subdomain?
  - Blocks: dev-a3f2b9
  - Options: (a) root, (b) subdomain, (c) configurable
  - Agent recommendation: (c)
  → Answer: (c) — make configurable; default to root for now
  → Note: subdomain costs us a cert; revisit at v0.5
```

ManageAgent reads the `→ Answer:` line, copies it into the blocked spec's
status log, flips `status: blocked` → `status: ready`, and the next agent tick
picks the spec back up.

- [ ] **Q#17 — "Blocked on a human" has no way to be expressed, so `devx doctor` reports honest rows as defects.** (from pinret, 2026-08-21)

  `pin105` has sat `[-] blocked` for five weeks, correctly: its scripted half
  merged (PR #75) and its live half needs the owner at a keyboard
  (`MANUAL.md MV-pin105.1`). But its `Blocked-by:` names `pin103` and
  `pin104`, both `done` — so `devx doctor`'s dead-blocker detector (db36af)
  flags it, and the flag is TRUE: the row is blocked on something the
  annotation vocabulary cannot name. The same shape will recur for every
  human-gated item (`9946f9`, the QA walkthroughs, MANUAL rows generally).

  Options:
  - **(a) `blocked_by:` accepts MANUAL/INTERVIEW references** — e.g.
    `Blocked-by: MV-pin105.1` — and the dead-blocker detector resolves them
    against `MANUAL.md`/`INTERVIEW.md` rather than the spec dirs.
    *Recommended*: it is the smallest vocabulary change, it makes the real
    dependency visible to `devx next`, and doctor's detector already has the
    resolution seam.
  - (b) A separate `blocked_on_human:` field, keeping `blocked_by:` purely
    spec-to-spec.
  - (c) Leave it; treat these doctor findings as expected noise on
    human-gated rows.

  Option (c) is the status quo and costs a recurring false-positive on an
  advisory channel whose whole failure mode is being ignored.
