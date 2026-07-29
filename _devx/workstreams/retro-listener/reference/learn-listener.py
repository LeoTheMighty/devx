#!/usr/bin/env python3
"""learn-listener.py — detection half of the §24 retro listener (Stop + SessionEnd hooks).

Ships with the harness plugin (registered in hooks/hooks.json), so it runs at every
turn end in every repo the plugin is installed in. Detection is its whole job: on a
Stop whose last assistant message carries the canonical §24 nudge, enqueue the session
for `bin/harness-learn-watch` (the watcher that spawns the interactive /harness-learn
fork); on a SessionEnd that means the human is actually done and reachable (not
`/clear`, `/resume`, or `logout`), drop an `.ended` marker so the watcher knows the
session is truly over. Inert inside a spawned retro (`HARNESS_RETRO`), so retros can
quote §24 without queueing themselves. Never blocks, never prompts, exits 0 on every path.

Design: docs/updates/2026-07-28-retro-listener.md
"""

import fcntl
import json
import os
import sys
import time
from pathlib import Path

# The canonical §24 nudge sentence — one source: CONVENTIONS.md §24's quoted sentence
# (every skill's copy must match it word-for-word; the FUTURE.md §B lint enforces that,
# and this pattern is why it's load-bearing). The substring skips the bolded lead-in and
# em-dash so markdown styling can't break the match, and matching collapses whitespace
# runs — so the invariant is wording equality, not literal byte equality: a hard-wrapped
# copy still detects, a reworded one doesn't.
# REWORDING §24 MUST UPDATE THIS PATTERN IN THE SAME PR — otherwise the listener
# goes silently deaf. Matching is on content, not authorship, so a session that
# merely *quotes* the sentence false-positives; that costs one spawned retro tab
# the user exits — except inside a retro, which is why HARNESS_RETRO exists below.
NUDGE = "run `/harness-learn` to review this thread and open a PR with changes that would help"

# The spawned retro sets this (bin/harness-learn-watch wrapper_command). /harness-learn's
# job is mining and quoting framework text, §24 included, so a retro that ends by quoting
# the nudge would queue *itself* — and its fork carries a fresh session id, so the dedupe
# below never catches it, and nothing bounds the depth. Skipping detection entirely inside
# a retro makes the design's "the loop can't self-trigger" guard mechanical instead of
# relying on /harness-learn never uttering the sentence it exists to reason about.
RETRO_ENV = "HARNESS_RETRO"

# SessionEnd reasons that must NOT take the fast path, for two distinct causes:
#   - the human isn't done — `/clear` and `/resume` end the session object while the
#     user keeps working in that same terminal, and `bypass_permissions_disabled`
#     likewise. Marking the session over would spawn a retro that steals focus mid-work.
#   - the spawn wouldn't work — after `logout` the watcher would run `claude --resume`
#     against an unauthenticated CLI, which can only fail (it degrades to `error-fork:<n>`
#     with a requeue hint, so it's recoverable, but it's a guaranteed-useless tab).
# Either way they drop through to the watcher's idle-mtime fallback, which re-checks
# later — by which time a logged-out user may well have logged back in. Denylist rather
# than allowlist on purpose: an unrecognised or absent reason still marks the session
# ended, so an upstream rename degrades to today's behaviour, not to silence.
NO_FAST_PATH_REASONS = {"clear", "resume", "bypass_permissions_disabled", "logout"}


def squash(text: str) -> str:
    return " ".join(text.split())


def harness_home() -> Path:
    return Path(os.environ.get("HARNESS_LEARN_HOME") or Path.home() / ".claude" / "harness")


def pending_session_ids(queue: Path) -> set:
    ids = set()
    if queue.exists():
        for line in queue.read_text().splitlines():
            try:
                ids.add(json.loads(line).get("session_id"))
            except (ValueError, AttributeError):
                continue
    return ids


def main() -> None:
    if os.environ.get(RETRO_ENV):
        return  # inside a spawned retro — never queue a retro of a retro
    payload = json.load(sys.stdin)
    event = payload.get("hook_event_name")
    sid = payload.get("session_id")
    if not sid:
        return

    home = harness_home()
    queue = home / "learn-queue.jsonl"

    if event == "Stop":
        if NUDGE not in squash(payload.get("last_assistant_message") or ""):
            return
        home.mkdir(parents=True, exist_ok=True)
        # Same lock the watcher takes for its queue rewrite — the dedupe check and
        # append are atomic, so a nudge landing mid-drain is neither lost nor doubled.
        with open(home / ".queue.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if sid in pending_session_ids(queue):
                return  # one pending retro per session, however many skills nudged
            entry = {
                "session_id": sid,
                "transcript_path": payload.get("transcript_path"),
                "cwd": payload.get("cwd"),
                "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            with queue.open("a") as f:
                f.write(json.dumps(entry) + "\n")

    elif event == "SessionEnd":
        if payload.get("reason") in NO_FAST_PATH_REASONS:
            return  # session object ended, human didn't — let the idle window decide
        # Only mark sessions the queue is waiting on — the fast path that lets the
        # watcher spawn immediately instead of waiting out the idle window.
        if sid in pending_session_ids(queue):
            markers = home / "markers"
            markers.mkdir(parents=True, exist_ok=True)
            (markers / f"{sid}.ended").touch()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # a hook that can fail a turn is worse than a missed detection
    sys.exit(0)
