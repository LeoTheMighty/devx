#!/usr/bin/env python3
"""lint_nudge.py — assert the §24 self-learning nudge is present and identical everywhere.

The first instance of FUTURE.md §B.6's "one canonical source, N copies" lint, landed
because the retro listener made this particular copy load-bearing: `hooks/learn-listener.py`
greps the canonical sentence out of the last assistant message to auto-queue a retro
(CONVENTIONS §24, docs/updates/2026-07-28-retro-listener.md). A skill whose copy has
drifted doesn't merely read badly — its sessions silently escape detection forever, with
no error surfaced anywhere. That failure is invisible by construction, so it needs a lint
rather than a review pass.

Scope is deliberately just the nudge. The rest of §B.6 (the §27 todo-reconcile block with
its skill-specific slot, and `harness-archive`'s two-slot variant) needs template matching
rather than the whole-sentence comparison below, and stays a follow-up.

Checks, against the canonical sentence quoted in CONVENTIONS.md §24:
  1. the hook's NUDGE pattern is a substring of the canonical sentence
  2. every skill outside NOT_A_NUDGER *has* a self-learning section, and
  3. carries the sentence verbatim inside it

Check 2 is why this is a closed loop rather than an opt-in scan: keying off the section
marker would silently pass a skill whose block was deleted, which is the likeliest way
this breaks and the one no reviewer would notice.

Whitespace runs are collapsed before comparing, matching how the hook itself matches —
hard-wrapping a copy across lines is fine; changing a word is not. So the invariant is
wording equality, not literal byte equality (CONVENTIONS §18's carve-out says the same).

Usage: lint_nudge.py [--repo-root PATH]     # exit 0 clean, 1 on drift
"""

import re
import sys
from pathlib import Path

CONVENTIONS = Path("docs/harness/CONVENTIONS.md")
HOOK = Path("hooks/learn-listener.py")
SKILLS_DIR = Path("skills")

# The canonical sentence is the one §24 quotes, in italics, as what a skill prints.
CANONICAL_RE = re.compile(r'\*"(There were a lot of things we learned.*?)"\*', re.S)
# Searched within §24 only. Anchoring on the opening phrase anywhere in the file would
# mean a future section that quotes the sentence earlier silently becomes the canonical
# source — and this lint's whole premise is that a bad canonical source is invisible.
SECTION_START_RE = re.compile(r"^#+ 24\.", re.M)
# The end is the next numbered heading that is NOT one of §24's own subheadings:
# a plain `^#+ \d+\.` consumes `#### 24.1.` (as "24" then "."), truncating the
# section at its first subheading — the sentence below it stops being found, and
# the resulting error blames a deleted sentence when someone merely added a heading.
SECTION_END_RE = re.compile(r"^#+ (?!24\.)\d+\.", re.M)
# Skills carry it inside their self-learning section; harness-learn is the outlet
# rather than a nudger, so it has no copy to check.
NUDGER_MARKER = "Self-learning (CONVENTIONS §24)"
NOT_A_NUDGER = {"harness-learn"}


def squash(text):
    """Collapse whitespace runs — the same normalization the hook applies, so a
    hard-wrapped copy passes and a reworded one doesn't."""
    return " ".join(text.split())


def section_24(src):
    """§24's text alone — from its heading to the next numbered one."""
    start = SECTION_START_RE.search(src)
    if not start:
        sys.exit(f"lint-nudge: no '## 24.' heading found in {CONVENTIONS}")
    rest = src[start.end():]
    end = SECTION_END_RE.search(rest)
    return rest[: end.start()] if end else rest


def canonical_sentence(root):
    section = section_24((root / CONVENTIONS).read_text())
    match = CANONICAL_RE.search(section)
    if not match:
        sys.exit(f"lint-nudge: no canonical quoted nudge found in {CONVENTIONS} §24")
    return squash(match.group(1))


def hook_pattern(root):
    src = (root / HOOK).read_text()
    match = re.search(r'^NUDGE = "(.*)"$', src, re.M)
    if not match:
        sys.exit(f"lint-nudge: no NUDGE pattern found in {HOOK}")
    return squash(match.group(1))


def main():
    args = sys.argv[1:]
    root = Path(args[args.index("--repo-root") + 1]) if "--repo-root" in args else Path(".")
    root = root.resolve()

    canonical = canonical_sentence(root)
    pattern = hook_pattern(root)
    failures = []

    if pattern not in canonical:
        failures.append(
            f"{HOOK}: NUDGE pattern is not a substring of the canonical §24 sentence — "
            f"the listener is deaf to every skill.\n"
            f"    pattern:   {pattern}\n"
            f"    canonical: {canonical}"
        )

    # Every skill is required to nudge unless it's on NOT_A_NUDGER. The marker is NOT
    # an opt-in filter: skipping files that lack it would pass the most likely way this
    # breaks — the block deleted or restructured during an unrelated edit — which is the
    # exact invisible failure this lint exists to catch.
    checked = 0
    for skill in sorted((root / SKILLS_DIR).glob("*/SKILL.md")):
        name = skill.parent.name
        if name in NOT_A_NUDGER:
            continue
        checked += 1
        body = skill.read_text()
        rel = SKILLS_DIR / name / "SKILL.md"
        if NUDGER_MARKER not in body:
            failures.append(
                f"{rel}: no '## {NUDGER_MARKER}' section — every skill must nudge "
                f"(add one, or add '{name}' to NOT_A_NUDGER with a reason). Sessions "
                f"ending in this skill will not be detected."
            )
        elif canonical not in squash(body):
            failures.append(
                f"{rel}: self-learning nudge has drifted from "
                f"CONVENTIONS §24 — sessions ending in this skill will not be detected."
            )

    if failures:
        print("lint-nudge: FAIL\n")
        for f in failures:
            print(f"  - {f}")
        print(
            "\nThe §24 nudge is a wire protocol, not prose: hooks/learn-listener.py matches it "
            "verbatim.\nFix the copy, or — if the rewording is intended — update §24, every "
            "skill copy, and the hook's\nNUDGE pattern in the same commit."
        )
        return 1

    print(f"lint-nudge: OK — hook pattern matches §24; {checked} skill copies verbatim")
    return 0


if __name__ == "__main__":
    sys.exit(main())
