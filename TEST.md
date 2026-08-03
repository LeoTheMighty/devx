# TEST — test-gap backlog

Test gaps observed during dev work. Each entry points at a spec under `test/`.
Conventions per CLAUDE.md: `[ ]` ready · `[/]` in-progress · `[-]` blocked · `[x]` done.

- [ ] `test/test-c98aee-2026-07-15T11:26-flutter-ci-job.md` — Wire flutter analyze + test into devx-ci for mobile/. Status: ready. From: a10001 (PR #76).
- [ ] `test/test-eac611-2026-07-28T10:12-manage-tick-canonical-state-integration.md` — Integration: manage tick writes state in the canonical universe from a subdir launch. Status: ready. From: mlc101 (PR #91).
- [ ] `test/test-357d0c-2026-07-28T17:15-loop-instance-orphan-and-status-render.md` — Crash-orphaned loop instance driven through admission end-to-end + `devx status` live-loops render (incl. fail-soft). Status: ready. From: mlc105 (PR #98) review tour, which named both gaps.
- [ ] `test/test-b7f2c1-2026-07-29T11:46-unidentified-suite-flake.md` — Suite flake: `loop-driver` E-3 split scenario died on `ENOTEMPTY` in teardown (background `git gc --auto` writing into the fixture's bare origin under `rmSync`). Identified + fixed in PR #103 (AC 1–2 met); **AC 3–4 still open** — long gate runs should persist failure detail so a diagnosis doesn't depend on CI reproducing it. Status: ready. From: mlcret (post-merge gate red, then reproduced by PR #103's CI).
- [ ] `test/test-97f6d8-2026-08-03T09:50-sgr103-qa-walkthrough.md` — QA walkthrough for "Renderer + `devx graph` CLI (write/stdout/check/json/scoping) + initial GRAPH.md"; 3 human check(s) outstanding (GitHub Mermaid render, glyph distinctness, dark-mode legibility — AC 7's attended leg). Status: ready. From: sgr103.
