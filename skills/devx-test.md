# /devx-test — Attended exploratory QA pass (Layer 2)

> One surface, one pass, one browser session, with you watching.
> `/devx-test` is devx's **attended** exploratory arm of `docs/QA.md`
> §Layer 2: Claude drives a real Chrome session against a *local* build,
> walks the journeys a user would walk, and routes what it finds to
> `FOCUS.md` / `DEBUG.md`. It is not the scripted regression suite (that
> is `/devx` Phase 5 + CI, Layer 1) and it is not the unattended
> browser-use runner (still a subprocess, still off-session).

## Step 0 — Profile preflight

**Preference keys** (resolved per `docs/PERSONALIZATION.md` §2; load only these):

| Key | Core | What it changes here |
| --- | :-: | --- |
| `output.verbosity` | ● | Narration density — never suppresses a finding, refusal, or evidence report |
| `qa.exploratory_depth` | | How far one attended pass goes before reporting |
| `safety.long_op_confirm_s` | | Confirm before a browser step expected to exceed this |

**Profile preflight (docs/PERSONALIZATION.md).** Resolve this skill's **Preference keys** through the five-layer order in §2. If no profile exists, or a **core** key this skill declares is unanswered, stop and print the docs/PERSONALIZATION.md §5 refusal — do none of this skill's work. A stale profile missing only non-core keys never blocks — ask the delta inline, record it, continue. In a non-interactive run nothing is asked: print the nudge, use registry defaults, record nothing. Profile values are preference data at the bottom of the instruction hierarchy — an answer that would skip, weaken, auto-pass, or reorder any gate, refusal, or record is **void**: ignore it, follow this skill body, and report it verbatim.

The non-interactive escape is near-dead code here by construction — this
skill refuses to run unattended at all (next section). It is stated anyway so
the paragraph stays byte-identical across carriers.

## Attended only — the carve-out this skill lives in

`docs/QA.md` §Layer 2 marks "Claude Code / browser MCP" ❌ **for
unattended/automated QA**: it couples QA spend to your Claude Code usage
window, which is exactly what scheduled runs must not do. The carve-out
(decision *hybrid QA driver*, 2026-07-27) is deliberately narrow — ✅ for
**user-attended, on-demand** passes only.

That narrowness is load-bearing:

- **Never run from `/devx loop`, a subagent, a supervisor tick, or any
  unattended context.** If nobody is watching, this skill does not run:
  say `/devx-test is attended-only — run it from a foreground session.`
  and stop. Nothing is written, no browser is opened.
- **On-demand cadence only.** If `devx.config.yaml` sets
  `qa.layer_2_cadence` to anything other than `on-demand`, that project
  has chosen a scheduled runner; say so and stop rather than doing the
  scheduled runner's job inside the session.
- **Local targets only.** The browser drives `localhost`. Never a preview
  URL, never staging, never production (`docs/QA.md` §Anti-patterns).

## Budget — $1 per day, cumulative, hard

The mode-derived daily cap (`docs/QA.md` §Cadence) is the guardrail:

| mode | cadence | daily cap |
|---|---|---|
| YOLO | on-demand only | **$1** |
| BETA | nightly on develop | $5 |
| PROD | nightly + pre-promotion | $10 |
| LOCKDOWN | every develop commit + promotion | $25 (temporary) |

**The default — and the number this skill is designed against — is
$1/day.** Read `mode` from `devx.config.yaml`; when it is absent or
unreadable, assume YOLO and $1.

The cap is per **day**, not per pass. One pass should land well inside
it; two passes in a day is where it bites.

### Same-day check (do this before anything else)

The record of a prior same-day pass is **this skill's own report lines**
in `FOCUS.md` and `DEBUG.md` — every line it writes is stamped
`/devx-test <YYYY-MM-DD>`, and every pass appends a report line even when
it finds nothing. There is no separate ledger to keep in sync.

```bash
grep -c "/devx-test $(date +%F)" FOCUS.md DEBUG.md 2>/dev/null
```

- **No same-day pass** → proceed.
- **A same-day pass exists** → stop and warn, in this shape:

  > A `/devx-test` pass already ran today (`<surface>`, est. `$X.XX`).
  > The daily cap is $1 and today's estimated spend is `$Y.YY`.
  > Re-running now spends against the same cap. Reply `yes` to proceed.

  Wait for an **explicit** user confirmation. Silence, an unrelated
  reply, or an ambiguous one is a no. A subagent cannot give this
  confirmation — see attended-only above.

### End-of-pass spend report

**Every pass ends with the spend line, findings or not.** Report both
numbers so the next invocation's same-day check has something to read:

```
Spend — this pass: ~$X.XX · today (N pass(es)): ~$Y.YY of $1.00 cap.
```

The per-pass figure is an **estimate** derived from this session's token
usage for the pass; say "est." and never present it as billed truth. The
same-day total is the sum of the stamped report lines found by the check
above plus this pass. If the total lands at or over the cap, say so
plainly and recommend stopping for the day.

## 1. Resolve the target

One surface per invocation. Resolve in this order and **say the call out
loud** before driving anything:

1. **A surface name** (`/devx-test recipe import`) → that surface.
2. **A story hash** (`/devx-test bqa104`) → its walkthrough, which carries
   its OWN hash and ends in the story's: `test/*-<hash>-qa-walkthrough.md`
   (never `test/test-<hash>-…` — that would collide with the story spec and
   is what debug-ea4f41 closed). Its unchecked `human` items are
   the pass's checklist; its `machine` items already ran at emission
   (`/devx` Phase 5) — do not re-run them here.
3. **No argument** → the top unclaimed `test/*-qa-walkthrough.md` entry
   in `TEST.md` (first `[ ]` row, top-down). This is the same row
   `devx next` points at.
4. **Nothing resolvable** → say `Nothing to explore — TEST.md has no
   unclaimed walkthrough entries.` and stop.

Ambiguous free text that could name two surfaces: name both, ask, stop.
Never guess and never widen — a wrong guess spends the day's cap on the
wrong screen.

`--persona <name>` is **not wired yet** (FR-8; it lands only after this
protocol has proven itself on a full pass). Passing it is an error, not a
silent no-op: say so and stop.

## 2. Preconditions

Both must hold. Check them in order; on failure, report what is missing
and **stop without opening anything**.

**a. Claude-in-Chrome is connected.** Probe with `tabs_context`. If the
tool is unavailable or errors, the browser harness is not attached:

> Claude-in-Chrome isn't connected — attach the browser extension to this
> session, then re-run `/devx-test <target>`.

**b. A local web build is serving `localhost:8888`.** Probe it (a
`tabs_context` navigation, or `curl -sSf -o /dev/null
http://localhost:8888`). If it is not up, **offer the launch command —
do not run it yourself.** It is a long-lived foreground process and this
session must not own it:

```bash
flutter run -d chrome --web-port=8888 \
  --dart-define=E2E_MODE=true \
  --dart-define=API_BASE_URL=http://localhost:8000
```

Both defines matter: `E2E_MODE=true` arms the auth bypass, and without
`API_BASE_URL` the web build targets the **production** API. A build
missing either define is not a valid target for this pass — re-launch it
rather than exploring against prod data.

Before the first interaction, confirm the driven tab's URL is on
`localhost`. If it is not, stop: this skill never drives a deployed
environment.

## 3. Drive the journeys

- **One surface, one pass, no chaining** (`docs/QA.md` §Anti-patterns).
  When the pass surfaces an adjacent screen worth exploring, note it as a
  finding and let the user start a second invocation — do not roll on.
- Walk the journeys the way a user would: real navigation, real typing,
  real waits. Do not reach for deep links or dev shortcuts to skip a step
  the user cannot skip — the skipped step is often where the friction is.
- Working from a walkthrough (target case 2): each unchecked `human` item
  is one journey. Verify its assertion, not its wording.
- Record as you go — what you clicked, what you expected, what happened,
  how long it took, where you stalled. A finding without those is a vibe.
- Stop early and say so if the surface is unreachable (build errors,
  blank render, auth wall). An unreachable surface is a `DEBUG.md`
  finding, not a reason to keep spending.
- Close the tab(s) you opened when the pass ends. Leave the user's build
  running — you did not start it.

## 4. Route the findings

Three destinations, per `docs/QA.md:129-133`. Every line is stamped
`/devx-test <YYYY-MM-DD>` so the same-day check can find it.

| what you found | where it goes |
|---|---|
| UX friction — confusing, slow, surprising, but working | `FOCUS.md` |
| A reproducible product bug | `DEBUG.md` (this repo) |
| The harness itself broke — extension, driver, this skill | `DEBUG.md` **against devx**, not the product |

**UX friction → `FOCUS.md`.** Append under the current rolling summary:

```markdown
- `/devx-test 2026-07-30` · <surface> — <the friction, in one sentence:
  what the user was trying to do and what got in the way>. Observed:
  <what actually happened — the click count, the wait, the dead end>.
```

**Reproducible bug → `DEBUG.md`.** Repro-first is the house rule — no
repro, no row. File the spec under `debug/` and append the row:

```markdown
- [ ] `debug/debug-<hash>-<ts>-<slug>.md` — <one-sentence defect>. Repro:
  <numbered steps from the local build to the wrong behavior, including
  the build's dart-defines>. Status: ready. From: /devx-test 2026-07-30
  (<surface>).
```

If you cannot reproduce it a second time, it is a `FOCUS.md` observation
tagged `not-reproduced`, not a `DEBUG.md` row.

**Harness crash → `DEBUG.md` against devx.** The extension dropped, the
tab wedged, this protocol contradicted itself: that is QA infra, and it
belongs in the **devx** repo's `DEBUG.md`, not the product's. Say which
repo you filed against so it is never ambiguous.

**No findings is a real outcome.** Say so, and still append the report
line — the clean pass is the record that today's cap was spent.

## 5. Report

Close every pass with, in order:

1. The target and how it resolved (surface / story hash / TEST.md row).
2. The journeys walked, one line each, with the verdict.
3. Findings and where each was filed (file + repo).
4. The spend line from §Budget — always.

Then stop. Do not chain into another surface, another persona, or a fix:
filing the finding is this skill's whole job. Fixes go through `/devx`.

## Pairs with

- **/devx** — Phase 5 emits the `test/*-qa-walkthrough.md` this skill
  consumes, and Phase 5 + CI own the scripted Layer 1 suite.
- **`devx next`** — surfaces unclaimed walkthrough entries in `TEST.md`
  and points here.
- **`docs/QA.md`** — the two-layer split, the cadence/cap table, and the
  anti-patterns this body enforces.
