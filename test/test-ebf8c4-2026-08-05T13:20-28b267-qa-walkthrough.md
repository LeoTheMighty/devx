---
hash: ebf8c4
type: test
created: 2026-08-05T13:20:00-06:00
title: "QA walkthrough — learn.auto_allow unattended watcher (28b267)"
from: dev/dev-28b267-2026-08-05T11:25-learn-auto-allow.md
status: ready
owner: null
branch: null
---
# QA walkthrough — Story `28b267`

> `learn.auto_allow` makes `devx learn-watch` servable with nobody at a
> terminal: an unreviewed repo reads as allowed instead of blocking on the
> once-per-repo `[y/N]` prompt. User-visible surfaces are the `--auto-allow`
> flag, the startup policy line, the `--dry-run` wording, and the two skip
> notes. This walkthrough deliberately does NOT cover a real (non-dry) drain —
> that opens a `claude --resume` window per entry, so the spawn arm stays
> covered by the seam-injected suite rather than by a human opening tabs.

## Pre-flight

```bash
# From the story's worktree.
npm run build

# A scratch queue home with one pending entry from a repo nobody has
# reviewed — the 2026-08-05 shape exactly. Never point these at
# ~/.claude/devx; DEVX_LEARN_HOME is the redirect.
export QA=/tmp/qa-28b267
rm -rf "$QA" && mkdir -p "$QA/home"
printf '{"session_id":"5a1d0b7c-0000-4000-8000-abcdef012345","transcript_path":null,"cwd":"/tmp/some-unreviewed-repo","ts":"2026-08-02T09:00:00-06:00"}\n' \
  > "$QA/home/learn-queue.jsonl"
export DEVX_LEARN_HOME="$QA/home"
```

> `devx learn-watch` is a poll loop with no `--max-passes` flag, so every
> command below is bounded by SIGTERM after ~4s. `stopped — queue is durable`
> at the tail of the output is the clean-stop line, not a failure.

## Manual checks

### 1. The flag is discoverable from `--help`

- [x] `machine` — `--auto-allow` is registered, defaults to off, and its help
  text carries the per-run skip-set caveat

```bash
node dist/cli.js learn-watch --help
```

Expected:

```
Options:
  --dry-run      Print the spawn command for every ready session and change
                 nothing (no marker, no done-log row, no queue rewrite);
                 allowed while another watcher is draining (default: false)
  --auto-allow   Treat a repo nobody has reviewed as allowed instead of asking,
                 so an unattended watcher (`nohup`) drains instead of walking
                 past it. A recorded `deny` still wins and repos.json is never
                 written. Same as `learn.auto_allow: true`; the flag only turns
                 it on. NOTE: entries a running watcher already skipped stay
                 skipped for the life of that run — restart it to pick them up
                 (default: false)
  -h, --help     display help for command
```

Invariant: `(default: false)` — the policy is opt-in. A build that ships it on
by default would auto-allow every repo the watcher has ever touched on first
run, which is the one thing this design refuses to do silently.

### 2. Policy OFF still says "a real run would ask first"

- [x] `machine` — the pre-story wording is untouched when the knob is off

```bash
node scripts/../dist/cli.js learn-watch --dry-run   # bounded ~4s, then Ctrl-C
```

Expected (the two load-bearing lines):

```
devx learn-watch: 1 pending · queue /tmp/qa-28b267/home/learn-queue.jsonl
(retros spawn one at a time — end one with /exit, Ctrl-D, or by closing its tab, and the next follows)
(--dry-run: printing spawn commands only — the queue and done log are left alone)
  [dry-run] 5a1d0b7c-0000-4000-8000-abcdef012345 (/tmp/some-unreviewed-repo) — repo not reviewed yet; a real run would ask first
  [dry-run] would spawn: M=/tmp/qa-28b267/home/markers/5a1d0b7c-…done; …; cd /tmp/some-unreviewed-repo || { w error-cd; exit 1; }; DEVX_RETRO=1 claude --resume 5a1d0b7c-… --fork-session "/devx-learn"; w "$?"
stopped — queue is durable; restart me anytime
```

Invariant: no startup policy line, and the ask-first sentence intact. This is
the control — a story that only proved the ON path works could have broken the
OFF path without anyone noticing.

### 3. `--auto-allow` announces the policy and rewrites the dry-run verdict

- [x] `machine` — startup line names the policy; the entry reports
  *would auto-allow* instead of *would ask first*

```bash
node dist/cli.js learn-watch --dry-run --auto-allow   # bounded ~4s
```

Expected:

```
(learn.auto_allow: unreviewed repos are served without asking — a recorded `deny` still wins, and repos.json is never written by the policy)
  [dry-run] 5a1d0b7c-0000-4000-8000-abcdef012345 (/tmp/some-unreviewed-repo) — repo not reviewed; learn.auto_allow is on, so a real run would auto-allow it without asking (repos.json stays untouched)
  [dry-run] would spawn: …
stopped — queue is durable; restart me anytime
```

Invariant: under the policy the words "a real run would ask first" must not
appear anywhere — it is false, and it sends a human to a foreground terminal
they do not need. The startup line is what makes an unattended `watch.log`
answer "why did it never prompt?" without reading source.

### 4. The config path reaches the watcher without the flag

- [x] `machine` — `learn.auto_allow: true` in the launch directory's
  `devx.config.yaml` turns the policy on with no flag passed

```bash
mkdir -p "$QA/proj" && cat > "$QA/proj/devx.config.yaml" <<'YAML'
mode: YOLO
project:
  shape: empty-dream
learn:
  auto_allow: true
YAML
cd "$QA/proj" && node <worktree>/dist/cli.js learn-watch --dry-run   # bounded ~4s
```

Expected — identical policy lines to check 3, with no flag on the command line:

```
(learn.auto_allow: unreviewed repos are served without asking — a recorded `deny` still wins, and repos.json is never written by the policy)
  [dry-run] 5a1d0b7c-0000-4000-8000-abcdef012345 (/tmp/some-unreviewed-repo) — repo not reviewed; learn.auto_allow is on, so a real run would auto-allow it without asking (repos.json stays untouched)
stopped — queue is durable; restart me anytime
```

Invariant: `learn:` is read from the watcher's **launch cwd**, not from the
repo each queued session came from (documented in `docs/CONFIG.md` §15c). A run
launched from a directory with no config falls back to the defaults — i.e. the
policy off. That is the wrinkle to remember when the watcher stops draining
after somebody moves the `nohup` line to a different directory.

### 5. The policy writes nothing

- [x] `machine` — after every run above, the queue home still holds only the
  queue; `repos.json` was never created

```bash
ls "$QA/home"
```

Expected:

```
learn-queue.jsonl
```

Invariant: **a policy is not a decision.** `repos.json` stays the record of
what a *human* reviewed, so turning `auto_allow` back off restores prompting.
If the policy ever recorded, the knob would be one-way: every repo the watcher
touched would stay allowed with no way back short of hand-editing the file.
Asserted at three levels in the suite (`repoDecision`, `drainPass`, and a
byte-identical check against a pre-existing file).

### 6. An unattended watcher actually drains a real queue

- [ ] `human` — run the real thing overnight and confirm the pending entries
  clear · how to verify: `nohup devx learn-watch --auto-allow > ~/watch.log &`
  with `devx learn-watch list` showing pending rows; next morning the same
  `list` shows those session ids under *processed* with outcome `completed`,
  and `~/watch.log` contains the `learn.auto_allow:` startup line rather than
  any `skip … could not be answered` line

Invariant: this is the story's actual goal — the suite proves the decision
path, but only a real overnight run proves a retro window opens, finishes, and
writes its done marker without a human. The two sessions pending since
2026-08-02 are the natural first subjects.

### 7. A repo you deliberately denied stays denied

- [ ] `human` — confirm the policy cannot un-deny a human's refusal · how to
  verify: with the watcher stopped, add `{"/some/repo": "deny"}` to
  `~/.claude/devx/repos.json`, queue a session from that repo, then run
  `devx learn-watch --auto-allow`; the entry must retire with outcome
  `skipped-denied-repo` (visible in `devx learn-watch list`), not spawn a
  window

Invariant: recorded verdict > policy > prompt. Reversing those first two turns
`auto_allow` into a switch that silently overrides every explicit refusal in
the file.

## Regressions to watch

- **The unattended-drain path itself.** The knob has to survive *two* gates —
  `pickReady`'s unservable filter and `repoDecision`'s verdict — and a change
  that teaches only one of them still drains zero entries while every unit
  test of the other passes. The drain-level cases in `test/learn-watch.test.ts`
  (`autoAllow drains an unreviewed repo end to end with no terminal`, plus its
  paired control `without autoAllow the same pass serves nothing`) are the ones
  that catch it; a refactor that narrows the option spread into either call
  must keep them green.
- **`repos.json` growth.** Anything that starts recording on the policy arm
  makes the knob one-way. Watch for a `recordRepoDecision` call added anywhere
  above the prompt in `repoDecision`.
- **The keyless-cwd guard.** `key === ""` sits above every arm including the
  policy; moving it back below `autoAllow` would let an entry whose working
  directory nobody could name come back as `allow`.
- **Prompt-ability logic.** `canPrompt`'s foreground/SIGTTIN check is untouched
  by this story on purpose — auto-allow removes the *need* to prompt, it does
  not make prompting from a background process safe.

## Post-merge follow-ups

- `dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md` — this story
  unblocks the watcher; c808b1 decides what the spawned retro is allowed to do
  without a human (auto-prune rule, apply-vs-propose predicate, applied rows
  through the normal PR + merge gate). It carries an owner ruling and is
  `Blocked-by: 28b267`.
- The launch-cwd config resolution (`learn:` read from wherever the watcher was
  started, not user-globally) is documented rather than fixed — deliberately
  out of scope here, per the spec's technical notes.
