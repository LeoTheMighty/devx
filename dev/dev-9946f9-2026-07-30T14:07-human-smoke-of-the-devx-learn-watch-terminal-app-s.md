---
hash: 9946f9
type: dev
created: 2026-07-30T14:07:29-06:00
title: "Human smoke of the devx learn-watch Terminal.app spawn arm"
from: dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md
status: ready
blocked_by: [rtl104]
branch: feat/dev-9946f9
owner: null
---

## Goal

Continue rtl104: remaining acceptance criteria split out by devx split (merge-first).

## Acceptance criteria

- [ ] AC 6 (remainder): one real spawn of a trivial session via the Terminal.app arm on this machine, recorded in the spec status log — a human must watch osascript open the tab, run the forked retro, and confirm the completion marker files the expected outcome. The --dry-run print and the tmux arm were both smoked end-to-end in iteration 3, and the Terminal arm's AppleScript escaping is now pinned against the real osascript parser by test, so only the GUI spawn itself remains.

## Carried forward

### State to trust

- parent dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md shipped its committed portion at reduced scope through the normal PR/CI/merge tail

### Gotchas (save time — don't rediscover)

- The Terminal arm opens a real window on the user's desktop and runs the real claude binary, which is why it cannot be smoked by an unattended loop; the tmux arm can (detached tmux server plus a stub claude on PATH).
- This could equally be filed as a MANUAL.md entry rather than a dev spec — it is an action only the user can take, not work an agent can pick up.

### Do NOT

- Do not redo ACs already shipped by the parent — audit its PR diff first

## Status log

- 2026-07-30T14:07:29-06:00 — created by devx split from `dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md` (merge-first)
