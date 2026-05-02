// Pure functions for rendering the /devx PR body (prt102).
//
// Substitutes the canonical placeholders from
// `_devx/templates/pull_request_template.md` (shipped by prt101) with values
// pulled from `devx.config.yaml` + the spec frontmatter/body. Substitution is
// plain `String.prototype.replace` against line-anchored regexes — no
// template-engine dependency (per the "Substitution is text replace" design
// principle in epic-pr-template.md).
//
// Line-anchored substitution is load-bearing per party-mode locked decision
// #4 in epic-pr-template.md: a placeholder appearing inside a fenced code
// block (or any non-canonical position) MUST NOT substitute. Each substitution
// regex anchors on its canonical line shape (`**Spec:**`, `**Mode:**`, the
// AC-only line). The malicious-template fixture in the unit test exercises
// this.
//
// Unresolved placeholders are surfaced (not silently rendered as empty
// sections) per locked decision #5 — the caller appends a status-log line
// `phase 7: pr body had unresolved placeholder <name>` per unresolved entry,
// keeping the audit trail grep-able post-merge.
//
// Spec: dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md
// Epic: _bmad-output/planning-artifacts/epic-pr-template.md

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Built-in canonical PR template, byte-for-byte identical to
 *  `_devx/templates/pull_request_template.md` shipped by prt101. Used as the
 *  fallback when `.github/pull_request_template.md` is absent (a repo that
 *  predates the template install or hasn't run `/devx-init` upgrade since).
 *
 *  The two markers are kept verbatim:
 *    - `<!-- devx:mode -->`        idempotency marker (stripped from the
 *                                  rendered PR body — useful on disk only).
 *    - `<!-- devx:auto:mode -->`   substitution placeholder (this module
 *                                  replaces it with the active mode). */
export const BUILTIN_TEMPLATE = `<!-- devx:mode -->
**Spec:** \`<dev/dev-<hash>-<ts>-<slug>.md>\`
**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*

## Summary
<1–3 bullets on what changed>

## Acceptance criteria
<checkbox list copied from spec>

## Test plan
<bulleted list of what local CI gates covered + any manual steps>

## Notes for reviewers
<surprises, deviations, follow-ups>
`;

const PR_TEMPLATE_IDEMPOTENCY_MARKER = "<!-- devx:mode -->";

// Placeholder constants — kept as named constants so the unit test asserts
// the exact strings the canonical template ships with.
export const SPEC_PATH_PLACEHOLDER = "<dev/dev-<hash>-<ts>-<slug>.md>";
export const MODE_PLACEHOLDER = "<!-- devx:auto:mode -->";
export const AC_PLACEHOLDER = "<checkbox list copied from spec>";
export const SUMMARY_PLACEHOLDER = "<1–3 bullets on what changed>";
export const TEST_PLAN_PLACEHOLDER =
  "<bulleted list of what local CI gates covered + any manual steps>";
export const NOTES_PLACEHOLDER = "<surprises, deviations, follow-ups>";

// Line-anchored substitution regexes (locked decision #4). Each matches the
// canonical position only — placeholders appearing inside a fenced code
// block, in arbitrary positions, or with adjacent non-canonical text must NOT
// substitute. Tests exercise a malicious-template fixture for each.

/** Matches the canonical `**Spec:** `<dev/dev-<hash>-<ts>-<slug>.md>`` line at
 *  line start. The placeholder text contains regex-special characters; we
 *  template the regex from the literal placeholder via escapeRegex() rather
 *  than hand-write the escaped form (less drift if the canonical placeholder
 *  ever changes). */
const SPEC_LINE_RE = new RegExp(
  `^\\*\\*Spec:\\*\\* \`${escapeRegex(SPEC_PATH_PLACEHOLDER)}\``,
  "m",
);

/** Matches the canonical `**Mode:** <!-- devx:auto:mode --> ...` line at line
 *  start; consumes the trailing annotation up to end-of-line so the rendered
 *  body says `**Mode:** YOLO` cleanly (no leftover `*(stamped at PR-open by
 *  /devx)*` noise). */
const MODE_LINE_RE = new RegExp(
  `^\\*\\*Mode:\\*\\* ${escapeRegex(MODE_PLACEHOLDER)}.*$`,
  "m",
);

/** Matches `<checkbox list copied from spec>` as the entire content of a
 *  line (with optional surrounding whitespace). */
const AC_LINE_RE = new RegExp(
  `^[ \\t]*${escapeRegex(AC_PLACEHOLDER)}[ \\t]*$`,
  "m",
);

/** Matches every idempotency marker line (with its trailing newline) so we can
 *  strip them all from the rendered PR body without leaving blank first lines.
 *  `g` flag is load-bearing: a template that carries the marker more than once
 *  (a `## devx` section + the user accidentally pasting the marker elsewhere)
 *  would otherwise leave the second copy in the rendered body. */
const MARKER_LINE_RE = new RegExp(
  `^${escapeRegex(PR_TEMPLATE_IDEMPOTENCY_MARKER)}\\n?`,
  "gm",
);

/** Line-anchored marker match used by sliceAtMarker — same pattern as
 *  MARKER_LINE_RE but without `g` (we want the first canonical match's index,
 *  not all of them). Line anchoring is load-bearing: a substring match would
 *  fire on user-authored content that happens to mention the marker text in
 *  prose / a code example / a TOC, slicing off everything above and producing
 *  a body whose first non-empty line is the user's mention rather than the
 *  canonical `**Spec:**` line. */
const MARKER_FIRST_LINE_RE = new RegExp(
  `^${escapeRegex(PR_TEMPLATE_IDEMPOTENCY_MARKER)}$`,
  "m",
);

export interface RenderPrBodyOpts {
  /** PR-template text (typically read from `.github/pull_request_template.md`;
   *  falls back to BUILTIN_TEMPLATE when absent — caller's responsibility to
   *  load via loadTemplate()). */
  template: string;
  /** Active mode from `devx.config.yaml`. Uppercased before substitution
   *  (canonical PR-body mode-stamp is uppercase: YOLO/BETA/PROD/LOCKDOWN). */
  mode: string;
  /** Repo-relative spec path (e.g. `dev/dev-prt102-2026-04-28T19:30-...md`).
   *  This is what reviewers + the mobile companion app's PR card anchor on,
   *  so it must be repo-rooted, not absolute. */
  specPath: string;
  /** AC checklist body — typically the result of `extractAcChecklist(specBody)`.
   *  Empty/blank → placeholder remains visible (caller flags unresolved). */
  acChecklist: string;
  /** Optional Summary / Test plan / Notes free-text bodies. Omitted → the
   *  corresponding placeholder remains visible (grep-able audit trail per
   *  locked decision #5; never silently rendered as an empty section). */
  summary?: string;
  testPlan?: string;
  notes?: string;
}

export interface RenderPrBodyResult {
  body: string;
  /** Names of placeholders that COULD NOT be substituted. Caller appends a
   *  status-log line per entry per locked decision #5. Includes both required
   *  (spec-path / mode / acceptance-criteria) and optional (summary /
   *  test-plan / notes) placeholders. */
  unresolvedPlaceholders: string[];
}

export function renderPrBody(opts: RenderPrBodyOpts): RenderPrBodyResult {
  // Slice the template at the idempotency marker if present. When /devx-init
  // appended a `## devx` section under user-authored content (prt101's
  // appended branch), the marker lives partway through the file; we render
  // ONLY the canonical block. Per AC: "First non-empty body line is the
  // **Spec:** line."
  const sliced = sliceAtMarker(opts.template);

  let body = sliced;
  const unresolved: string[] = [];

  // 1. Spec line — line-anchored substitution.
  if (SPEC_LINE_RE.test(body)) {
    body = body.replace(SPEC_LINE_RE, `**Spec:** \`${opts.specPath}\``);
  } else {
    unresolved.push("spec-path");
  }

  // 2. Mode line — line-anchored substitution. Strips the trailing annotation.
  const modeUpper = opts.mode.toUpperCase();
  if (MODE_LINE_RE.test(body)) {
    body = body.replace(MODE_LINE_RE, `**Mode:** ${modeUpper}`);
  } else {
    unresolved.push("mode");
  }

  // 3. AC checklist line — line-anchored. Replace the placeholder line with
  // the multi-line AC block, OR leave the placeholder visible if the spec's
  // AC section is empty / missing (locked decision #5).
  const trimmedAcs = opts.acChecklist.trim();
  if (AC_LINE_RE.test(body)) {
    if (trimmedAcs.length > 0) {
      body = body.replace(AC_LINE_RE, trimmedAcs);
    } else {
      unresolved.push("acceptance-criteria");
    }
  } else if (body.includes(AC_PLACEHOLDER)) {
    // Placeholder present but not on a clean line (custom template) — leave
    // it visible; do NOT substitute (line-anchoring discipline).
    unresolved.push("acceptance-criteria");
  }

  // 4. Optional free-text placeholders. replaceAll is safe here because each
  // placeholder string is distinctive enough that an accidental match would
  // also be a deliberate match (e.g. nobody types `<1–3 bullets on what
  // changed>` outside the canonical Summary section).
  body = maybeReplacePlaceholder(
    body,
    SUMMARY_PLACEHOLDER,
    opts.summary,
    "summary",
    unresolved,
  );
  body = maybeReplacePlaceholder(
    body,
    TEST_PLAN_PLACEHOLDER,
    opts.testPlan,
    "test-plan",
    unresolved,
  );
  body = maybeReplacePlaceholder(
    body,
    NOTES_PLACEHOLDER,
    opts.notes,
    "notes",
    unresolved,
  );

  // 5. Strip the idempotency marker line — useful on disk for /devx-init's
  // "already wrote" detection, noise in the rendered PR body. Stripping last
  // (after substitutions) keeps the spec/mode lines right at the top so the
  // first non-empty line invariant holds.
  body = body.replace(MARKER_LINE_RE, "");

  return { body, unresolvedPlaceholders: unresolved };
}

function maybeReplacePlaceholder(
  body: string,
  placeholder: string,
  value: string | undefined,
  name: string,
  unresolved: string[],
): string {
  if (!body.includes(placeholder)) return body;
  if (value === undefined || value.trim() === "") {
    unresolved.push(name);
    return body;
  }
  return body.split(placeholder).join(value.trim());
}

function sliceAtMarker(template: string): string {
  const m = MARKER_FIRST_LINE_RE.exec(template);
  if (!m) return template;
  return template.slice(m.index);
}

/** Read `.github/pull_request_template.md` from `repoRoot`; return its
 *  contents (UTF-8 BOM stripped, CRLF normalized to LF — both for
 *  line-anchored regex stability), or BUILTIN_TEMPLATE when the file is
 *  absent. Per the "Fallback-on-missing" design principle in
 *  epic-pr-template.md — never blocks PR open.
 *
 *  BOM stripping matters because the substitution regexes anchor on `^`,
 *  which under multiline mode matches the position right after a newline
 *  OR the start of the string. A leading BOM byte (U+FEFF) shifts every
 *  anchor by one character, breaking the `**Spec:**` / `**Mode:**` /
 *  marker-strip detections silently — the rendered body would still
 *  look correct but the first non-empty line invariant (AC 5) would
 *  fail because the marker line wouldn't be stripped. */
export function loadTemplate(repoRoot: string): string {
  const path = join(repoRoot, ".github", "pull_request_template.md");
  if (!existsSync(path)) return BUILTIN_TEMPLATE;
  return readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
}

const AC_HEADING_RE = /^##\s+Acceptance criteria\s*$/m;
const NEXT_H2_RE = /^##\s/m;
const CHECKBOX_LINE_RE = /^[ \t]*-\s+\[[ x/-]\]/;
const SUB_HEADING_RE = /^###\s/;

/** Extract the `## Acceptance criteria` checkbox section from a spec markdown
 *  body. Returns the checkbox lines (and indented continuations + `### `
 *  sub-headings) joined with newlines, OR the empty string if no AC section
 *  exists / no checkboxes present.
 *
 *  Why preserve `### ` sub-headings: prt101's spec splits its ACs into three
 *  sub-groups (`### New surface`, `### Phase 0 surface removal`, `###
 *  Substitution-marker hygiene`). Rendering the PR-body AC list as a flat
 *  checkbox block would lose that grouping — confusing for reviewers
 *  scanning a 20-item list. Sub-headings stay; reviewers see the same
 *  shape as the spec.
 *
 *  Why stop at the next `## ` heading: spec sections after AC (`Technical
 *  notes`, `Status log`, `Links`) are not part of the AC contract and would
 *  bloat the PR body. */
export function extractAcChecklist(specBody: string): string {
  const headingMatch = AC_HEADING_RE.exec(specBody);
  if (!headingMatch) return "";
  const start = headingMatch.index + headingMatch[0].length;
  const rest = specBody.slice(start);
  const nextMatch = NEXT_H2_RE.exec(rest);
  const acBlock = nextMatch ? rest.slice(0, nextMatch.index) : rest;

  const lines = acBlock.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (CHECKBOX_LINE_RE.test(line) || SUB_HEADING_RE.test(line)) {
      out.push(line);
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    // Indented continuation of the previous checkbox, or a blank line between
    // sub-groups — preserve it.
    if (line === "" || /^\s/.test(line)) {
      out.push(line);
      continue;
    }
    // First non-checkbox / non-indented / non-sub-heading line ends the block
    // (defensive: catches stray paragraphs the spec author dropped between
    // checkbox sub-groups without realizing they'd terminate the section).
    break;
  }

  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  if (out.length === 0) return "";
  // Guard: a section that captured ONLY `### ` sub-headings with no
  // checkboxes underneath would render as empty section headers in the PR
  // body — confusing and wrong per AC 4 ("AC list from spec frontmatter
  // (each `- [ ]` line)"). Treat that as no AC content; caller marks
  // unresolved per locked decision #5.
  if (!out.some((line) => CHECKBOX_LINE_RE.test(line))) return "";
  return out.join("\n");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
