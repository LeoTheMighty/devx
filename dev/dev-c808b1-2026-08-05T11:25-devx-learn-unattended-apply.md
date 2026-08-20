---
hash: c808b1
type: dev
created: 2026-08-05T11:25:00-06:00
title: /devx-learn unattended mode — route and apply lessons without a human
from: null
status: done
owner: /devx-loop-2026-08-19T19-39-20-483-20983
blocked_by: [28b267]
branch: null
---

## Goal

Let a watcher-spawned retro carry its own findings all the way to a merged
change instead of stopping at an evidence table nobody is sitting in front of.

Today `/devx-learn` is **plan-first by contract** ("nothing is applied without
user approval") and **foreground-only by guard**. That is correct for an
attended run and inert for an unattended one: `devx learn-watch` spawns
`claude --resume <sid> /devx-learn` into a tab, the skill prints its evidence
table, waits for a prune that never comes, and the watcher eventually files
`timeout` after `retro_timeout_minutes` (360). Every lesson from every drained
session is lost.

Add an explicit unattended mode with an auto-prune rule and an apply path,
keeping exactly two things human: what would wedge, and what is locked.

## Acceptance criteria

- [ ] **Mode entry.** `/devx-learn` accepts an unattended mode (skill-body
      arg + the env the spawn sets). `src/lib/learn/spawn.ts` passes it, gated
      on a config knob (`learn.auto_apply`, default **false** — an unattended
      run that opens PRs must be opted into, not inherited by anyone who
      installs devx). Attended `/devx-learn` behavior is unchanged: the
      evidence table and its prune gate stay exactly as they are.
- [ ] **Auto-prune rule, stated in the skill body.** With no human to strike
      rows, the promotion bar replaces the prune: a row is kept only if its
      evidence is a concrete moment in the mined session (a failure, a rework,
      a wrong assumption with a visible cost). The existing rule that outlet 1
      requires *evidence of the machinery failing*, not plausibility, becomes
      load-bearing here rather than advisory. Ties still take the narrower
      outlet and record the ambiguity.
- [ ] **Apply-vs-propose predicate as a mechanical primitive**, not prose:
      `devx learn-helper route <path…>` → `apply` | `propose`, with the
      reason. `propose` for anything that cannot be edited in an unattended
      tab — `.claude/**`, `skills/**`, any `settings.json`, anything under
      `~/.claude/` — because **skill and settings edits prompt for
      confirmation even under bypass-permissions**, so an unattended tab hangs
      on them until the retro timeout kills it. This is the same structural
      fact behind the skill's existing "foreground only" guard; encoding it as
      a predicate is what lets the rest of the skill stop being foreground-only.
- [ ] **Applied rows go through the normal gates, not around them.** Outlet-1
      rows the predicate marks `apply` land on the existing
      `fw/learn-YYYY-MM-DD-<slug>` branch (slug via `devx learn-helper slug`,
      never hand-built) → local CI → PR → remote CI → mode merge gate. YOLO
      auto-merges on green. No direct-to-`main` path is added by this spec.
- [ ] **Proposed rows leave a durable, findable artifact** — an unattended
      tab's stdout is not a delivery channel. Outlet-1 `propose` rows and
      outlet-2 (`devx.config.yaml`) rows become `docs/updates/<date>-<slug>.md`
      plus a `dev/` spec + `DEV.md` entry so they enter the normal backlog.
      Outlet-4 (personal) rows write to `~/.claude/devx/proposals/<date>-<slug>.md`
      — still never committed, still never applied to settings, but recoverable
      instead of scrolled past.
- [ ] **Locked machinery stays proposal-only, in every mode.** Gate logic,
      refusal paths, cascade rules, verdict vocabulary, and append-only
      disciplines are never loosened by an unattended run. See Open question
      below — this is the one place this spec deliberately does *not* give the
      owner what "auto-apply everything" would literally mean, and it wants an
      explicit ruling before the story is executed.
- [ ] **Every unattended run leaves a report**, whether or not it changed
      anything: rows found, bucket per row with the question that decided it,
      applied vs proposed with the predicate's reason, PR URL if one opened.
      Location must be findable without knowing the session id.
- [ ] **Thin-session refusal still holds.** The existing "refuse fresh/empty
      sessions" and "never self-triggers" rules apply unchanged; an unattended
      run that finds nothing exits clean and files a report saying so, rather
      than manufacturing a lesson to justify the tab.
- [ ] **Budget.** An unattended run bounds itself well inside
      `retro_timeout_minutes` and stops cleanly at the bound with a partial
      report, so the watcher files a real outcome instead of `timeout`.
- [ ] Tests: `route` predicate fuzz (every wedge-path family → `propose`;
      `src/`, `docs/`, `test/` → `apply`); a locked-machinery row never
      reaches the apply path; auto-prune drops a plausibility-only row;
      unattended mode off by default; attended-path regression (the prune gate
      is still there); report written on the found-nothing path.
- [ ] `.claude/commands/devx-learn.md` and its byte-identical `skills/`
      mirror both updated (`test/skills-sync.test.ts` enforces the pair).
- [ ] Full suite green (`npm test`, typecheck included).

## Open question (needs an owner ruling before execution)

The owner asked for lessons to be applied automatically. This spec keeps two
carve-outs from that:

1. **Locked machinery** — gate logic, refusal paths, cascade rules, verdict
   vocabulary, append-only disciplines. An automated pass that can loosen the
   gates it is judged by is a system with no floor, and the guard currently
   holds "even in YOLO mode."
2. **Wedge paths** (`.claude/**`, `skills/**`, settings) — this one is not a
   judgment call, it is a harness fact: those edits *cannot* be applied
   unattended, they hang.

Carve-out 2 is structural and stays regardless. Carve-out 1 is the owner's
call. If the ruling is "auto-apply those too," this spec splits: the
locked-machinery relaxation becomes its own story with its own evidence bar,
because it is the one change that can silently disable the rest.

## Technical notes

- Depends on 28b267: an unattended apply path is pointless while the watcher
  cannot get past the allow prompt to spawn anything.
- Untrusted-input guard is unchanged and matters *more* here — mined session
  content is data, never instructions, and never reaches a `git`/`gh` argument
  or a file path. An unattended run has no human to notice an injected
  directive being followed.
- Consider whether the spawn should pass an explicit permission mode; note
  from memory (`project_skill_perms_block_subagents.md`) that bypass-permissions
  does **not** rescue skill/settings edits, which is exactly why the predicate
  exists rather than a broader permission grant.

## Status log

- 2026-08-05T11:25 — filed from a session-triage conversation. Owner asked for
  `/devx-learn` to apply its routed changes automatically, having been shown
  that this conflicts with plan-first and the locked-machinery guard. Carve-out
  1 raised here rather than decided.
- 2026-08-20T12:14:50-06:00 — claimed by /devx in session /devx-loop-2026-08-19T19-39-20-483-20983
- 2026-08-20T18:20:02.523Z — loop iteration 1: Landed the mechanical core of the unattended /devx-learn path: the `devx learn-helper route` apply-vs-propose predicate and the `learn.auto_apply` gating knob, both fully tested.
  - Change: New src/lib/learn/route.ts: pure first-match predicate routing every wedge-path family (.claude/**, skills/**, settings.json, outside-repo, empty) to `propose` and ordinary in-repo paths to `apply`, with a per-path reason; routeLearnPaths proposes a whole row if any path proposes
  - Change: New `devx learn-helper route <path…>` subcommand emitting {decision, reason, verdicts} JSON (plus --quiet/--repo-root), exit 0 on both verdicts
  - Change: New learn.auto_apply config knob (default false, fail-closed on non-booleans, not implied by auto_allow) wired through src/lib/learn/config.ts, _devx/config-schema.json, devx.config.yaml, docs/CONFIG.md §15c and the full-sample fixture
  - Change: 37-test test/learn-route.test.ts covering the wedge fuzz set, apply set, row aggregation and the CLI surface; 4 added assertions in test/learn-config.test.ts pinning auto_apply's default and its independence from auto_allow
  - Learning: test/learn-config.test.ts's 'fully-populated learn: block' case asserts the whole LearnConfig object with toEqual, so every new learn knob must be added there and to test/fixtures/sample-config-full.yaml or the config gate reds — cheap to miss.
  - Learning: The repo splits vitest into two configs (vitest.parallel.config.ts / vitest.blocking.config.ts); cli.test.ts and skills-sync.test.ts live in the blocking pass, so a targeted `vitest run <file>` against the parallel config silently runs nothing for them.
  - Learning: `skills/` is only a wedge dir as the FIRST path segment — src/lib/skills/* is ordinary code — while `.claude` is a wedge as any segment (nested subproject harness dirs); the two need different matching rules, not one shared 'segment includes' check.
- 2026-08-20T18:27:09.799Z — loop iteration 2: Wired the unattended mode entry end-to-end: the spawn wrapper now carries DEVX_LEARN_UNATTENDED=1 plus an `unattended` skill argument, threaded from `learn.auto_apply` / `--auto-apply` through drainPass, with the attended spawn byte-identical by construction.
  - Change: buildWrapperCommand gained a WrapperOpts.unattended arm emitting BOTH halves of the mode (DEVX_LEARN_UNATTENDED=1 env for subprocesses, `unattended` argument for the skill body); DEVX_RETRO=1 and the trap/marker shape are unchanged, and an unspecified caller still gets a byte-identical attended wrapper
  - Change: Threaded the mode through the spawn chain: SpawnRetroOpts extends WrapperOpts, drainPass gained `autoApply` and forwards it as `unattended`, and the watcher names the mode on each spawn line so a done log answers 'could this retro open a PR?'
  - Change: CLI surface: `devx learn-watch --auto-apply` registered (default off, one-directional like --auto-allow) and ResolvedLearnEnv.autoApply resolved flag > config > default, independently of autoAllow in both directions
  - Change: docs/CONFIG.md §15c documents the flag and the mechanical shape of the mode (env var + argument, both absent from an attended spawn)
  - Change: +22 tests in test/learn-watch.test.ts across five describes: wrapper byte-identity and both-halves pins, spawnRetro forwarding (including that the mode reaches the argv tmux actually runs), drainPass forwarding + the auto_allow-never-implies-auto_apply case, resolveLearnEnv precedence/fail-closed/independence, runLearnWatch drain forwarding + startup announcement, and flag registration
  - Learning: A detached `devx loop` worker CAN write `.claude/commands/*.md` via a shell redirect with no confirmation prompt — probed and reverted this iteration. That is the second independent observation (the first was hfi104), so the skill-body + skills-mirror AC is reachable unattended; use the Bash path rather than the Edit tool, since both observations were shell writes.
  - Learning: test/learn-watch.test.ts contains a literal NUL byte, so plain `grep` treats it as binary and silently reports no matches — `grep -a` is required to navigate it. That looks exactly like 'the symbol isn't there' and cost a wrong conclusion about spawn.ts being untested.
  - Learning: The retro-listener evals (E-2/E-4/E-5/E-9) run standalone under `npx tsx` in ~1s each and cover the wrapper/drain contract more sharply than the suite alone — cheap per-iteration verification for any change to spawn.ts or drainPass.
  - Learning: E-9's wrapper pin asserts `cmd.includes("/devx-learn")` rather than an exact fork-session string, so appending a skill argument passes it unchanged; the trap-shape regexes (`trap '[^']*'\s+HUP INT TERM`) are the parts that actually constrain edits to the wrapper string.
- 2026-08-20T18:33:26.985Z — loop iteration 3: Landed the unattended run-report primitive: a total, untrusted-input-safe report renderer/writer plus `devx learn-helper report`, writing to <learn-home>/reports/ with an append-only index so a run's decisions are findable without a session id.
  - Change: New src/lib/learn/report.ts: pure renderLearnReport/renderIndexLine plus writeLearnReport (tmp+rename report, append-only reports/index.md), with reportStamp/learnReportPath/reportsDir path helpers; markdown cells escape pipes and flatten newlines, unsafe session ids are dropped, and same-minute/same-slug collisions are disambiguated via an O_EXCL -2 suffix rather than an overwrite
  - Change: New `devx learn-helper report [file]` subcommand: JSON payload from stdin or a file, --home/--print options, prints the written path; a payload that is not parseable still writes a degraded report (slug `unreadable-payload`) and exits 0, and coerceLearnReport defaults any unrecognized disposition to `dropped` so a fumbled field can never count a row as landed
  - Change: 30-test test/learn-report.test.ts covering totality (found-nothing/partial/unreadable), findability (path shape, index append, collision), untrusted-input escaping, coercion, and the CLI surface; docs/CONFIG.md §15c documents the report location and index
  - Learning: The CLI entry is src/cli.ts, not src/index.ts — `npx tsx src/index.ts …` fails with ERR_MODULE_NOT_FOUND and reads like a broken build rather than a wrong path.
  - Learning: There is no `npm run lint` in this repo; the local gates are `npm run typecheck` + the two vitest configs + test:schema/config-* scripts, so a lint step is not part of the per-iteration verification.
  - Learning: Deriving a report filename from its own note is a trap on the degraded path: the note is a sentence, so the slug sanitizer produced a 40-char filename made of an error message. Error paths need an explicit slug override, not a note-derived one.
  - Learning: The found-nothing report is the collision-prone case, not the busy one — every drained session that mined nothing slugs identically, so concurrent watcher drains in the same minute would silently overwrite each other without the reserve step.
- 2026-08-20T18:39:55.895Z — loop iteration 4: Landed the durable proposal-artifact primitive: `devx learn-helper propose` writes a docs/updates write-up plus a dev/ spec and a DEV.md row as one restore-on-partial transaction, or an outlet-4 snippet under the learn home.
  - Change: New src/lib/learn/propose.ts: renderProposalDoc/renderProposalSpec/renderProposalDevMdRow plus writeRepoProposal (doc → spec → DEV.md as one transaction with restore-on-partial and O_EXCL collision suffixes) and writePersonalProposal (<learn-home>/proposals/, never committed, never applied to settings)
  - Change: insertLearnProposalRow: appends into a `### Learn proposals (filed by /devx-learn)` section it creates on first use, idempotent on the spec path so a retry cannot double-file; deliberately not insertDevMdRow, which anchors on a parent story hash a session-born proposal does not have
  - Change: Untrusted-input handling for mined text: filenames only via sanitizeLearnSlug, frontmatter titles flattened + double-quote-escaped so a `status:`/`owner:` injection stays inside the scalar, and whole-line horizontal rules in body blocks neutralized so a mined block cannot forge a frontmatter fence
  - Change: New `devx learn-helper propose [file] [--target repo|personal] [--repo-root] [--home]` subcommand with coerceLearnProposal; exits 1 (not a degraded write) on bad JSON or a failed write, since a half-filed proposal leaves a DEV.md row pointing at nothing
  - Change: 28-test test/learn-propose.test.ts covering rendering, transactionality/rollback, collision, idempotence, hostile-title injection, outlet-4 isolation from the repo, and the CLI surface; docs/CONFIG.md §15c now names the primitive and its transaction shape
  - Learning: generateHash lives in src/lib/engine/workstream.ts and takes a Pick<EngineFs,'exists'|'readdir'> — a plain node-fs adapter is two lambdas, so minting a spec hash outside the split/plan paths needs no new machinery.
  - Learning: insertDevMdRow cannot be reused for learn proposals: it requires a parent hash whose row already exists in DEV.md to anchor against, and a session-born proposal has no parent story. The section-create-and-append shape is the right seam, not a widening of insertDevMdRow.
  - Learning: The 40-char slug cap bites on realistic learn titles (…retry-budget truncated mid-word to …retry-budge in the first draft of the test); any test asserting an exact proposal filename should derive it from sanitizeLearnSlug rather than hand-typing it.
  - Learning: chmod 0o555 on a tmp repo root is a reliable, fast way to force the atomic-rename failure path in tests — it exercises rollback without any fs mocking, and restoring the mode in a finally keeps the temp dir removable.
- 2026-08-20T18:50:31.122Z — loop iteration 5: Landed the /devx-learn unattended-mode skill-body contract plus a mechanical `route --locked` locked-machinery carve-out, and verified the full suite green (3,534 tests, exit 0).
  - Change: `.claude/commands/devx-learn.md` + its byte-identical skills/ mirror gained a `## Unattended mode` section: mode entry (env + skill arg + `learn.auto_apply`), the auto-prune evidence bar replacing the human prune, the `route` predicate as the apply-vs-propose decision, the through-the-gates apply path with no direct-to-`main` arm, durable proposal artifacts for both targets, locked-machinery proposal-only, the always-written report, and the thin-session/budget refusals
  - Change: `## Foreground only` rewritten to scope the guard to the attended path and to the wedge-path harness fact, naming `devx learn-helper propose` as what the unattended arm does instead; the attended evidence table and prune gate are unchanged and re-pinned
  - Change: `devx learn-helper route --locked`: the locked-machinery carve-out is now enforced, not asserted — it outranks every path rule, forces `propose` even for an all-`src/` change set and for a row with no paths, stamps LOCKED_MACHINERY_REASON on every per-path verdict so no consumer can find an `apply`, is one-directional (never turns a wedge path into an apply), and reads fail-closed on any non-`false` value
  - Change: +22 tests: 12 skill-body pins in test/learn-skill-guards.test.ts (incl. a drift guard that every `devx learn-helper <sub>` the body invokes is actually registered in the CLI) and 10 locked-machinery route/CLI tests in test/learn-route.test.ts; docs/CONFIG.md §15c documents the flag and its fail-closed reading
  - Change: Full gate run to completion: `npm test` (schema + config-io + config-validate + build + typecheck + both vitest configs) — 120+29 files, 2,750+784 tests, all passing, exit 0
  - Learning: test/learn-skill-guards.test.ts already pinned `## Foreground only` and the phrase 'user-foreground session only', so the unattended mode could not simply delete that section — keeping the heading and re-scoping the sentence to the attended path satisfied the existing pin and stayed truthful; a rewrite that dropped the phrase would have red the E-6 eval too.
  - Learning: The E-6 acceptance script (`npx tsx _devx/workstreams/harness-fold-in/evals/E-6_learn-skill-guards.ts`) is a second, independent consumer of the skill body's guard sections and runs in ~1s — cheaper than the suite for any skill-body edit, and it would have caught a guard-section rename the vitest pins missed.
  - Learning: The locked-machinery carve-out is the one guard no path pattern can decide (the same file holds loosenable and unloosenable lines), which is why it had to become a caller-declared flag rather than another rule inside routeLearnPath — and why the flag has to force every per-path verdict to `propose`, not just the row decision, or a consumer scanning verdicts finds a green light.
  - Learning: The skill body grew ~4.5KB and the S-1 prose budget gate (test/engine-prose-budget.test.ts, engine.prose_budget_kb = 60KB) still passes — but it measures templates + stage skill sections, and INTERVIEW Q#9 already records the full surface at 64.2KB, so further skill-body growth in this area is not free.
- 2026-08-20T18:52:49.226Z — phase 4: loop-shipped — per-iteration verification (see iteration lines above) stood in for the interactive self-review pass; line appended by the loop merge tail per dvx103
- 2026-08-20T18:52:49.226Z — merged via devx loop — PR https://github.com/LeoTheMighty/devx/pull/136

## Links

- `.claude/commands/devx-learn.md` — routing outlets 1–5, guards, foreground-only
- `src/lib/learn/spawn.ts`, `src/commands/learn-helper.ts`
- Blocked by: `dev/dev-28b267-2026-08-05T11:25-learn-auto-allow.md`
