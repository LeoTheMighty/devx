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
