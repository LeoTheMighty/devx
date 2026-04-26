# Modes — risk posture tied to user-data stewardship

devx has four project-wide risk modes. They're the single knob that tunes every gate, autonomy ladder, promotion rule, and self-healing confidence threshold in the system. The discriminator is simple:

**Do we have user data whose integrity matters?**

- No → **YOLO**. Move fast, break things, ship on green.
- A few real users, we care but can recover → **BETA**.
- Real users whose data/trust we've promised to steward → **PROD**.
- Something's on fire right now → **LOCKDOWN**.

One config setting (`devx.config.yaml → mode`) or one command (`/devx-mode <name>`) cascades to every subsystem.

---

## 1. The four modes at a glance

| Mode | User-data stewardship | Default for | Shipping mantra |
|---|---|---|---|
| **YOLO** | None — solo-test DB, no external users | Empty repos, pre-launch, demos, toys | "Ship on green. We'll fix it live." |
| **BETA** | A handful of real users, recoverable on bad ship | Waitlist, alpha, closed friends | "Ship carefully. One nightly oops is OK, two is a crisis." |
| **PROD** | Real user base whose trust matters | Shipping products | "Measure twice, cut once. Rollback plans mandatory." |
| **LOCKDOWN** | Production + live incident | Active outage, security incident, bad merge in flight | "Nothing ships until this is resolved." |

### The asymmetry

Going **up** the risk scale is cheap — `YOLO → BETA → PROD` is just a config change.

Going **down** the scale is **deliberate and logged**. `PROD → BETA` or `PROD → YOLO` is rarely what you want and almost always a sign you've mis-set the mode or you're about to hurt users. The `/devx-mode` command refuses to downgrade out of PROD without a justification that gets written to `MANUAL.md` as a decision record. This is the guardrail against "oh it's fine, I'll just turn off the gates for this one push."

### LOCKDOWN is a one-way door in

Any mode → `LOCKDOWN` is instant. `LOCKDOWN` → anything requires explicit user acknowledgement that the incident is resolved and writes a `learn/*.md` entry so LearnAgent can extract what to prevent next time.

---

## 2. What each mode does to each subsystem

### 2.1 Promotion gate (`develop → main`, when split is enabled)

| Mode | Behavior |
|---|---|
| YOLO | Auto-promote on CI green. No soak, no panel, no extended checks. |
| BETA | `fast-ship` mode default (CI green + no reviewer-blocking comments). |
| PROD | `careful` mode default (CI + 24h soak + exploratory QA + focus-group clear). |
| LOCKDOWN | All promotion blocked. Explicit `/devx-promote --force` required, writes a decision record. |

When the develop/main split is disabled (`git.integration_branch: null`), the
promotion gate collapses into the merge gate: every PR or direct push to
`main` is treated as a deploy, subject to the same mode rules above (so a
PROD single-branch project still requires CI + soak + QA + panel before each
merge — the gate just runs once instead of twice). Recommended for solo YOLO
or prototype repos; not recommended for PROD (the develop split exists
specifically to let you merge fast on `develop` without deploying every
merge).

### 2.2 Trust-gradient autonomy ladder

| Mode | Initial N (promotions before auto-promote) | After rollback |
|---|---|---|
| YOLO | 0 — full autonomy immediately | stays 0 |
| BETA | 3 | halves |
| PROD | 10 (current default) | halves |
| LOCKDOWN | ∞ (frozen) | — |

### 2.3 Self-healing

| Mode | Auto-apply ceiling | Requires approval at |
|---|---|---|
| YOLO | Through CLAUDE.md; skill edits queue; agent-prompt edits queue | skill edits + prompts |
| BETA | Through config + memory; CLAUDE.md edits queue | CLAUDE.md + skill edits + prompts |
| PROD | Through memory + config; CLAUDE.md + skill + prompt edits queue | CLAUDE.md + above |
| LOCKDOWN | Nothing auto-applies; all edits queue with `lockdown-deferred` tag | everything |

### 2.4 Focus-group panel

| Mode | Pre-plan consultation | Pre-promotion review | Block threshold |
|---|---|---|---|
| YOLO | Skipped | Skipped | n/a |
| BETA | Consulted, non-blocking (advisory) | Consulted, advisory | — |
| PROD | Consulted, can insert INTERVIEW entries | Required, binding | 40% weighted block |
| LOCKDOWN | Required for anything that gets force-promoted | Required | 10% weighted block |

### 2.5 Coverage gate (line-level touched surface)

| Mode | Threshold | Blocks merge? |
|---|---|---|
| YOLO | Informational only | No |
| BETA | 80% | Warning, not block |
| PROD | 100% | Yes |
| LOCKDOWN | 100% + browser-QA pass | Yes |

### 2.6 Exploratory QA (browser-use)

| Mode | Schedule | Cost cap |
|---|---|---|
| YOLO | On-demand only | $1/day |
| BETA | Nightly on develop | $5/day |
| PROD | Nightly + pre-promotion | $10/day |
| LOCKDOWN | Every commit on develop + every proposed promotion | $25/day (temporary) |

### 2.7 Database / data operations

This matters most. The mode gates destructive data changes because this is where user-data mistakes happen.

| Mode | Migration apply | Destructive change (DROP COLUMN, DELETE FROM, schema rename) | User-data deletion |
|---|---|---|---|
| YOLO | Auto-apply on merge | Allowed inline | Allowed |
| BETA | Auto-apply + logged | Queued to `MANUAL.md`, requires user approval | Queued + approval |
| PROD | Approved + backup confirmed | Blocked; requires `MANUAL.md` approval + pre-change backup recorded + N-day cooldown (default 24h) | Blocked without named backup ref + two-step confirmation |
| LOCKDOWN | All migrations frozen | Blocked | Blocked |

### 2.8 Parallel agent capacity

| Mode | Default cap | Notes |
|---|---|---|
| YOLO | 5 | Move fast, parallelize aggressively |
| BETA | 3 (current default) | — |
| PROD | 3 | — |
| LOCKDOWN | 1 | Single-file focus on the incident |

### 2.9 Deploy cadence

| Mode | Production deploy trigger |
|---|---|
| YOLO | Any `main` push |
| BETA | `main` push + 1hr soak in staging |
| PROD | `main` push + 1hr staging + canary to 10% traffic + automated rollback on error-rate spike |
| LOCKDOWN | Manual deploy with explicit user sign-off |

### 2.10 Mobile companion app write permissions

| Mode | What the phone can do |
|---|---|
| YOLO | Everything: add items, answer INTERVIEW, approve promotions, trigger deploys |
| BETA | Everything except trigger deploys |
| PROD | Add items, answer INTERVIEW, approve panel-blocked promotions; no direct deploy triggering; no destructive ops |
| LOCKDOWN | Read-only (phone can see incident state but can't change it) |

---

## 3. How modes are set and changed

### 3.1 At `/devx-init`

New init question (inserted as Q3 in the six-question flow):

> **devx:** One more framing question — is anyone's data in this app you care about protecting? (Options: no / handful-of-beta-users / yes-real-users)

- "no" → YOLO
- "handful" → BETA
- "yes" → PROD
- Detected existing repo with a `DATABASE_URL` pointing at a non-local host → default to BETA, ask for confirmation.
- Detected existing repo with deployed users (Analytics config, Sentry DSN, any APNs/FCM registration) → default to PROD, ask for confirmation.

Written to `devx.config.yaml → mode: <name>`.

### 3.2 `/devx-mode` command

```
/devx-mode                 → show current mode + subsystem settings derived from it
/devx-mode yolo            → set YOLO (confirms if downgrading from BETA or PROD)
/devx-mode beta            → set BETA
/devx-mode prod            → set PROD
/devx-mode lockdown [reason]
                           → set LOCKDOWN with optional short reason
/devx-mode resume          → exit LOCKDOWN (requires resolution statement, writes learn/)
/devx-mode --dry-run <name>
                           → show what WOULD change without changing it
```

### 3.3 Mode transitions — friction profile

| Transition | Friction |
|---|---|
| YOLO → BETA | Trivial. "I have users now." One-word confirm. |
| BETA → PROD | Ritual. Confirms: rollback plan exists, observability configured, backup strategy documented, on-call contact set. Checks `devx.config.yaml` for each; asks to fill in missing pieces before accepting. |
| any → LOCKDOWN | Instant. No friction. Triage enforces within one tick. |
| PROD → BETA | Blocked by default. Requires `--confirm-downgrade` flag + written justification + writes `MANUAL.md` record. |
| PROD → YOLO | Blocked by default. Same as above, plus a 60-second countdown with "really? really?" prompt. This should be almost never used. |
| BETA → YOLO | Allowed with a warning + `MANUAL.md` record. |
| LOCKDOWN → (any) | Requires: resolution statement, named incident file under `learn/`, and if applicable a regression test under `test/`. |

### 3.4 Where current mode is always visible

- `devx.config.yaml → mode:` (source of truth).
- Status line in Claude Code (if hooks configured) — shows `[YOLO]` / `[BETA]` / `[PROD]` / `[🔒 LOCKDOWN]`.
- Mobile companion — persistent banner color (green / yellow / red / purple) + explicit mode label at top of every tab.
- Every PR description auto-stamped with mode at creation time: `Created under: BETA mode`.
- `devx status` output leads with the mode and derived gate summary.

---

## 4. Why four modes and not more

Considered and rejected:

- **STAGING** as a fifth mode: overlap with BETA is too high. If you have a staging environment, that's a deploy target, not a risk posture. The mode applies to how devx *operates* on the project, not which environment it deploys to.
- **RED TEAM / CHAOS** for intentional fault injection: interesting but out of scope for v1. Add as a variant of PROD later with explicit injection schedules.
- **DEV / TEST / PROD** as separate modes: DEV and TEST are environment names, not risk modes. A single project in YOLO can deploy to three environments.

Four modes is the smallest set that captures the four meaningfully different risk postures. More modes = decision fatigue setting up each project; fewer modes = can't express the difference between "pre-launch demo" and "shipping to 10 friends."

---

## 5. Mode ↔ feature matrix (quick reference)

For every subsystem, find your mode and see the behavior. Everything in one place so devs and agents can check without re-reading the full spec.

| Subsystem | YOLO | BETA | PROD | LOCKDOWN |
|---|---|---|---|---|
| Promotion gate | CI green | CI + no blockers | CI + soak + QA + panel | Manual only |
| Autonomy N | 0 | 3 | 10 | ∞ |
| Self-healing apply | ≤CLAUDE.md | ≤config | ≤memory | none |
| Focus-group plan | skip | advisory | binding | required |
| Focus-group pre-ship | skip | advisory | binding 40% | binding 10% |
| Coverage threshold | info | 80% | 100% | 100% + QA |
| Exploratory QA | on-demand | nightly | nightly + pre-ship | every commit |
| Migrations | auto | auto + log | approval + backup + cooldown | frozen |
| Destructive DB ops | allowed | approval | blocked + 2-step | blocked |
| Agent cap | 5 | 3 | 3 | 1 |
| Deploy | on main push | + soak | + canary + auto-rollback | manual sign-off |
| Mobile writes | full | full − deploy | limited | read-only |

---

## 6. Integration with existing subsystems

- **DESIGN.md § Trust-gradient autonomy** — replaces fixed `N=10` default with mode-derived default.
- **DESIGN.md § Fast-ship vs careful promotion modes** — these now map onto mode: YOLO→fast-ship-always, BETA→fast-ship-default, PROD→careful-default, LOCKDOWN→manual-always.
- **SELF_HEALING.md § Confidence gates** — the auto-apply ceiling column in that doc is now mode-derived. Same thresholds, different ceilings.
- **FOCUS_GROUP.md § Pre-promotion panel** — block weight threshold is mode-derived (40% in PROD, 10% in LOCKDOWN).
- **QA.md § Cadence** — cost cap + cadence pulled from mode.
- **MOBILE.md § Write permissions** — new mode-gated permission matrix.

---

## 7. Anti-patterns

- **Don't set PROD and then hand-override every gate.** If you're overriding more than once a week, the mode is wrong for the project. Downgrade explicitly or reassess scope.
- **Don't run a shared project across devs with different modes.** The mode is per-project, not per-user. If two devs want different gates, that's a conversation, not a config trick.
- **Don't use LOCKDOWN as a reviewer substitute.** LOCKDOWN is for live incidents. If you're in it for more than 24 hours, something else is broken.
- **Don't forget to leave LOCKDOWN.** Triage reminds you every 4 hours. Ignore the reminder three times → `MANUAL.md` entry + the mobile app goes loud.
- **Don't treat YOLO as "no discipline."** YOLO still means CI has to be green. It relaxes the *gates*, not the *code quality*. Coverage is informational but tests still run. Lint still runs. The difference is what blocks vs. what warns.

---

## 8. Default mode detection at `/devx-init`

Heuristics for the initial recommendation before asking:

| Signal | Suggests |
|---|---|
| Empty repo | YOLO |
| Repo has commits but no `DATABASE_URL` / `.env.production` | YOLO |
| Repo has staging `DATABASE_URL` but not prod | BETA |
| Repo has prod `DATABASE_URL`, Sentry DSN, or deployed analytics | PROD |
| Repo has open `DEBUG.md` items tagged `incident` | LOCKDOWN |
| Existing devx project being re-initted | inherit current mode |

Always asks for confirmation; never silently assumes.

---

## 9. Open questions

Appending to OPEN_QUESTIONS.md.

- **Q26. Mode switching schedule.** Should PROD projects be allowed to schedule temporary YOLO windows (e.g., "next 2 hours I'm doing a migration rehearsal on a non-prod branch, treat it as YOLO")? Probably yes, but only on non-`develop`, non-`main` branches, and auto-reverts on timer. Defer to v1.5.
- **Q27. Per-feature mode.** Some features are riskier than others. Could the mode be per-epic instead of per-project? Leaning no — adds cognitive cost for marginal gain. One knob per project keeps the system explainable.
- **Q28. Mode-aware learn cadence.** In YOLO we want rapid self-healing; in PROD we want cautious. Is the self-healing schedule itself mode-derived (nightly in YOLO, weekly digest in PROD)? Leaning yes — ties to SELF_HEALING.md §"Compaction" and persona-evolution cadence.
