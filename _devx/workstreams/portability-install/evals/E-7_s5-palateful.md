# E-7 — S-5 live checklist: palateful init to working `/devx` (human-run)

Validation type: **human** (P2 — deferred stub is legal at RED; this file
is filled in and executed during val101). Each step maps to one G-3/FR-7
threshold per the design contract (design.md § Migration plan).

## Prerequisites (record before starting)

- [ ] `palateful` is a git repo with a GitHub remote; `gh auth status` ok.
- [ ] devx installed globally: `npm run install:global` from the devx
      checkout; record `devx --version`: `____________`
- [ ] Timestamp stamp file created for the write audit:
      `touch /tmp/devx-s5-stamp`

## Steps ↔ thresholds

| # | Step | Threshold | Result |
|---|---|---|---|
| 1 | `cd ~/palateful && time devx init` then open Claude Code and run `/devx` | dispatcher renders < 120s total (G-1) | ____ |
| 2 | Pick one real bug; run `/devx "<symptom>"` through merge | 1 merged PR (G-3) | ____ |
| 3 | `devx loop --max-items 1` overnight-style run | morning report exists (G-3) | ____ |
| 4 | Write audit: `find ~/.claude ~/.devx -newer /tmp/devx-s5-stamp -not -path '*/palateful/*'` reviewed | only `~/.devx/` entries (FR-7) | ____ |

## Results record

- Date/run-by: ____
- Timing (step 1): ____
- PR link (step 2): ____
- Report path (step 3): ____
- Audit output (step 4): ____
- Verdict: ____
