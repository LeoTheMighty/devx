# Expectations — Retro Listener

<!-- Gate 1 input. Minimum 3 E-blocks (config: engine.expectations_min).
     Every business goal (G-) must be covered by at least one expectation;
     every Covers: ID must resolve in prd.md. EARS regex enforced by
     `devx gate prd`: "When .+, the system SHALL .+". A P0 with a vague
     Verified-by target fails the gate. -->

## E-1: Nudge detection + durable enqueue

- **Priority:** P0
- **Covers:** G-2, UC-1, CAP-1, FR-1
- **Trigger:** A Stop hook payload on stdin whose `last_assistant_message`
  contains the canonical nudge sentence — verbatim, or hard-wrapped across
  lines; and control payloads with a reworded sentence or a duplicate
  `session_id`.
- **Expectation (EARS):** When a Stop payload containing the canonical nudge
  (including a whitespace-rewrapped copy) is piped to `devx learn-helper
  listen`, the system SHALL append exactly one queue entry with
  `session_id`, `transcript_path`, `cwd`, and `ts`, SHALL append no entry
  for an already-pending `session_id` or a reworded sentence, and SHALL
  exit 0 on every input including garbage stdin.
- **Threshold:** 100% of the enumerated cases pass; the garbage-stdin case
  exits 0 with an unchanged queue.
- **Verified by:** `test/learn-listener.test.ts`

## E-2: The listener is inert inside a retro

- **Priority:** P0
- **Covers:** G-2, UC-4, CAP-1, FR-1
- **Trigger:** The listener invoked with `DEVX_RETRO=1` in the environment
  and a nudge-bearing Stop payload on stdin. (The other half of the
  self-trigger bound — the wrapper exporting the variable — is E-9.)
- **Expectation (EARS):** When `DEVX_RETRO=1` is set, the system SHALL exit
  0 without reading the payload or writing to the queue.
- **Threshold:** 0 queue writes and 0 marker writes under the guard, across
  100% of payload shapes exercised (nudge-bearing Stop, SessionEnd,
  garbage).
- **Verified by:** `test/learn-listener.test.ts`

## E-3: Session-over readiness fails safe

- **Priority:** P1
- **Covers:** CAP-2, FR-3
- **Trigger:** Queue entries with a fresh transcript, an idle transcript, a
  missing `transcript_path`, and an undatable hand-edited entry. (The
  SessionEnd denylist half of session-over detection is E-10.)
- **Expectation (EARS):** When a queue entry has no transcript to stat, the
  system SHALL age it against its own queue `ts` rather than treating it as
  instantly ready, and an undatable hand-edited entry SHALL serve rather
  than wedge the queue.
- **Threshold:** 100% of the ≥4 enumerated readiness cases (fresh, idle,
  missing-transcript, undatable) produce the specified verdict; the
  missing-transcript case reports not-ready for the full idle window (0
  early spawns).
- **Verified by:** `test/learn-watch.test.ts`

## E-4: Serial watcher — singleton, outcomes, malformed entries

- **Priority:** P0
- **Covers:** G-1, UC-2, UC-3, CAP-3, CAP-4, FR-3, FR-4
- **Trigger:** A second watcher starting while one holds the lock; completion
  markers containing `0`, `129`, `error-cd`, a nonzero status, and no marker
  within the timeout; queue entries missing `session_id` or `cwd`; a
  processed entry passed to `requeue`.
- **Expectation (EARS):** When a second watcher starts while the singleton
  lock is held, the system SHALL refuse to drain and exit nonzero; when a
  completion marker records status `0` the system SHALL file `completed`,
  status ≥ 128 `completed-interrupted`, `error-cd` `error-cd`, other nonzero
  `error-fork:<status>`, and no marker within the bounded wait `timeout`;
  when an entry lacks `session_id` or `cwd` the system SHALL retire it as
  `error-malformed` before any prompt or spawn; when no spawn arm is
  available (no tmux, not darwin) the system SHALL print the command and
  file the entry as `manual` immediately without awaiting a marker; and
  when a processed entry is requeued the system SHALL restore it with its
  original `ts`.
- **Threshold:** 100% of enumerated outcome mappings correct; the malformed
  entries never reach the spawn or allow-prompt code paths.
- **Verified by:** `test/learn-watch.test.ts`

## E-5: `--dry-run` is non-destructive

- **Priority:** P1
- **Covers:** UC-6, CAP-4, FR-4
- **Trigger:** `devx learn-watch --dry-run` over a queue with ready entries,
  including while another watcher holds the singleton lock.
- **Expectation (EARS):** When `--dry-run` runs, the system SHALL print the
  spawn command for each ready entry exactly once and SHALL leave the queue
  file, done log, and markers directory byte-identical, and SHALL NOT be
  refused by a held singleton lock.
- **Threshold:** byte-identical before/after comparison of queue + done log
  + markers; exit 0 under a held lock.
- **Verified by:** `test/learn-watch.test.ts`

## E-6: Wire-protocol pin — reword fails CI

- **Priority:** P0
- **Covers:** G-2, CAP-5, FR-5
- **Trigger:** The hook's detection pattern constant and the prose following
  the `nudge-canonical` marker in `.claude/commands/devx-learn.md`, compared
  whitespace-collapsed.
- **Expectation (EARS):** When the structural suite runs, the system SHALL
  assert the detection pattern is a whitespace-collapsed substring of the
  marker prose, so that rewording the marker without updating the pattern
  fails the suite in the same PR.
- **Threshold:** 100% pass against the current marker and 100% fail rate on
  the mutated-marker negative case (≥2 mutations exercised in-memory: a
  reworded verb and a deleted clause).
- **Verified by:** `test/learn-nudge-pin.test.ts`

## E-7: Hook overhead per Stop event

- **Priority:** P1
- **Covers:** G-3, FR-1
- **Trigger:** Repeated invocations of the built listener (`devx
  learn-helper listen`) with a non-matching Stop payload on stdin, timed
  end-to-end on darwin.
- **Expectation (EARS):** When the listener is invoked 20 times against the
  built CLI, the system SHALL complete each invocation in under 500ms at
  p95.
- **Threshold:** p95 < 500ms over 20 runs on the reference machine.
- **Verified by:** `_devx/workstreams/retro-listener/evals/E-7_hook-latency.ts`

## E-8: Installation is idempotent and ownership-respecting

- **Priority:** P1
- **Covers:** CAP-6, FR-2
- **Trigger:** The hook-install step run twice against a repo with no
  `.claude/settings.json`, and once against a settings file already
  containing unrelated user-authored hooks.
- **Expectation (EARS):** When the hook-install step runs, the system SHALL
  produce identical settings content on a second run (idempotent), SHALL
  merge its Stop/SessionEnd registrations without removing or reordering
  existing user entries, and SHALL leave a devx-recognizable ownership
  signature on the entries it wrote.
- **Threshold:** run-twice diff is 0 bytes; 100% of pre-existing user hook
  entries survive byte-intact (0 removed, 0 reordered).
- **Verified by:** `test/learn-hook-install.test.ts`

## E-9: The spawn wrapper exports the retro guard

- **Priority:** P0
- **Covers:** G-2, UC-4, CAP-3, FR-3
- **Trigger:** The wrapper command generated for a queue entry, inspected
  as a string and under the fake spawn seam.
- **Expectation (EARS):** When the watcher builds the spawn wrapper, the
  system SHALL place the `DEVX_RETRO=1` export ahead of the `claude
  --resume … --fork-session` invocation so every hook the forked retro
  runs inherits the guard.
- **Threshold:** 100% of generated wrapper commands contain the export
  before the `claude` token (asserted for the tmux, darwin, and manual
  arms — 3/3).
- **Verified by:** `test/learn-watch.test.ts`

## E-10: SessionEnd denylist gates the fast path

- **Priority:** P1
- **Covers:** CAP-2, FR-1
- **Trigger:** SessionEnd payloads with each denylisted reason (`clear`,
  `resume`, `bypass_permissions_disabled`, `logout`), an unknown reason,
  and a missing reason, for a pending session.
- **Expectation (EARS):** When SessionEnd carries a denylisted reason, the
  system SHALL NOT write an `.ended` marker, and when the reason is
  unknown or absent the system SHALL write one (denylist, not allowlist).
- **Threshold:** 100% of the 6 enumerated reason cases (4 denylisted + 1
  unknown + 1 absent) produce the specified marker behavior.
- **Verified by:** `test/learn-listener.test.ts`
