---
hash: b20003
type: dev
created: 2026-04-23T13:12:00-07:00
title: Backlog markdown → structured model parser
from: _bmad-output/planning-artifacts/epic-github-connection-read.md
plan: plan/plan-7a2d1f-2026-04-23T13:00-mobile-companion-v01.md
status: ready
branch: develop/dev-b20003
blocked_by: [b20002]
---

## Goal
Parse each of the 8 backlog file shapes (`DEV.md`, `PLAN.md`, `TEST.md`, `DEBUG.md`, `FOCUS.md`, `INTERVIEW.md`, `MANUAL.md`, `LESSONS.md`) into typed Dart models. Golden-file test against this repo's own real backlog formats.

## Acceptance criteria
- [ ] `BacklogParser.parseDev(text)` returns `List<DevItem>`
- [ ] Analogous parsers for each backlog type, each returning its typed items
- [ ] `SpecFileSummary.fromMarkdown(text)` extracts frontmatter + title + status + status log
- [ ] Tolerates missing optional fields, extra whitespace, unknown characters
- [ ] Golden-file tests use this repo's current `DEV.md` / `INTERVIEW.md` / `MANUAL.md` / etc. (copy into `mobile/test/parsers/fixtures/`)
- [ ] Malformed lines log a warning and skip, not crash

## Technical notes
- Parsers are pure functions — no I/O, no network, no state
- Frontmatter parsing uses `yaml` package
- Date parsing uses ISO 8601 only; reject other formats

## Status log
- 2026-04-23T13:12 — created by /dev-plan

## Files expected
- `mobile/lib/core/parsers/backlog_parser.dart`
- `mobile/lib/core/parsers/spec_file_parser.dart`
- `mobile/lib/core/models/backlog_item.dart`
- `mobile/lib/core/models/interview_question.dart`
- `mobile/lib/core/models/manual_action.dart`
- `mobile/test/parsers/backlog_parser_test.dart`
- `mobile/test/parsers/fixtures/` (copied from devx repo root)
