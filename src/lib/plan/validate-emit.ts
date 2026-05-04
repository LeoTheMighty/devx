// Pure cross-reference validator for `/devx-plan` Phase 6 (pln103). Runs
// after Phase 5/6 emission to catch the regression class where the planner
// emits half-broken artifacts (a spec without a sprint-status row, a DEV.md
// row pointing at a missing spec, a `branch:` frontmatter that ignores
// `git.integration_branch`, etc.).
//
// Closes the LEARN.md cross-epic patterns:
//   - `[high] [skill+docs] Planner-emitted branch: frontmatter ignored
//     devx.config.yaml` (paired with pln101's deriveBranch).
//   - `[high] [docs+skill] Retro stories (*ret) absent from sprint-status.yaml`
//     (paired with pln102's emitRetroStory + locked-decision-#7 atomic emit).
//   - `[high] [docs] Source-of-truth precedence rule` (paired with pln104).
//
// Six structural checks against the epic file + emitted artifacts:
//
//   1. Stories listed under `## Story list` in the epic (heading shape
//      `### <hash> — <title>`) must each have a matching `dev/dev-<hash>-*.md`.
//   2. Every DEV.md row in the epic's section must reference a spec that
//      exists on disk.
//   3. Every story under the epic in sprint-status.yaml must have a matching
//      `dev/dev-<hash>-*.md`.
//   4. The retro story (`<3letter>ret`) — derived from the parents' shared
//      prefix — must have all three artifacts: dev spec, DEV.md row,
//      sprint-status row.
//   5. Each spec's `branch:` frontmatter must equal
//      `deriveBranch(config, "dev", hash)` for the resolved config.
//   6. Each `**Locked decision:** ...` prose bullet that anchors on a story
//      hash (`<hash> AC bumped — ...`) — every backticked phrase inside the
//      bullet must appear somewhere in the referenced spec body. Heuristic;
//      reported as `warn`-severity (advisory, doesn't change exit code).
//      The hard part of "spec contradicts locked decision" is genuinely
//      semantic — the structural drift "epic was updated but spec wasn't" is
//      what we can detect cheaply.
//
// Exit-code mapping (the CLI passthrough in plan-helper.ts owns this):
//   0 = epic found AND zero error-severity issues (warn-severity is OK).
//   1 = epic found AND ≥ 1 error-severity issue.
//   2 = epic file not found.
//
// Pure: no fs writes, no env reads, no LLM calls. Filesystem reads are
// routed through the `ValidateEmitFs` seam so the unit tests can drive
// every branch on a synthetic-epic fixture without a temp dir per assert.
//
// Spec: dev/dev-pln103-2026-04-28T19:30-plan-validate-emit.md

import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";

import {
  type DeriveBranchConfig,
  deriveBranch,
} from "./derive-branch.js";

// Same hash regex as plan-helper.ts (3-12 alnum chars). Used for the
// synthesized retro hash and for parsing dev/ filenames; story-list
// extraction uses STORY_HEADING_RE which embeds the same constraint.

// Match `### <hash> — <title>` (em dash, U+2014). The Phase 1 epic files
// all use this shape; party-mode subheadings (`### Findings + decisions`,
// `### Cross-epic locked decisions...`) don't satisfy the hash regex so
// they're naturally rejected.
const STORY_HEADING_RE = /^### ([a-z0-9]{3,12}) — /i;

// Match a DEV.md spec row in any of the four checkbox states + the
// strikethrough-wrap shape. Captures the spec path inside the backticks.
// Mirrors the row-shape regex in emit-retro-story.ts:insertDevMdRow so the
// two stay in lockstep.
const DEV_MD_ROW_RE =
  /^(?:~~)?- \[[\sx\/\-]\] `(dev\/dev-[a-z0-9]{3,12}-[^`]+\.md)`/i;

// Match a sprint-status story row: `- key: <hash>` at any indent. Captures
// the hash. Locked to `[a-z0-9]{3,12}` so plan-level keys (`epic-<slug>`,
// `plan-<id>`) don't match — we only want story-level rows.
const SPRINT_STATUS_STORY_RE = /^\s*- key: ([a-z0-9]{3,12})\s*$/;

// Match `epic-<slug>` keys to find the epic block in sprint-status.yaml.
const SPRINT_STATUS_EPIC_RE = /^\s*- key: epic-(.+?)\s*$/;

// Match a "Locked decision" prose anchor in party-mode-refined sections.
// Two shapes show up empirically (mrg, prt, plan-skill epics):
//   "**Locked decision:** <hash> AC bumped — <phrase>"
//   "<phrase>. **Locked decision:** mrg103 AC bumped — <phrase>"
// We capture the bullet body (between the `**Locked decision:**` marker
// and the next blank-line / next bold-marker) so the backtick scanner has
// the full sentence to look at.
const LOCKED_DECISION_RE = /\*\*Locked decision:\*\*\s+([^\n]+(?:\n(?!\s*\n)(?!\s*\*\*)[^\n]+)*)/g;

// Match `<hash> AC bumped` (or " AC bumped" alone, in which case we walk
// back to find the nearest hash mentioned). Used to anchor a locked
// decision to a specific spec.
const AC_BUMPED_RE = /\b([a-z]{2,5}\d{2,4})\s+AC\s+bumped\b/i;

// Match anything inside backticks; used to extract specific tokens from
// locked-decision prose to compare against spec body.
const BACKTICK_TOKEN_RE = /`([^`\n]{1,200})`/g;

export interface ValidationIssue {
  /** error-severity issues fail the run (exit 1). warn-severity issues are
   *  advisory only — printed, but don't change the exit code. */
  severity: "error" | "warn";
  /** Short check identifier — `spec-missing`, `branch-mismatch`, etc.
   *  Stable string that callers + tests can grep. */
  check: string;
  /** Human-readable message naming the offending entity + expected shape. */
  message: string;
  /** Optional `path:line` reference. Caller prints verbatim. */
  location?: string;
}

export interface ValidateEmitInputs {
  /** Absolute path to the repo root (the dir containing devx.config.yaml,
   *  DEV.md, and `_bmad-output/`). */
  repoRoot: string;
  /** Epic slug — the part after `epic-` in the filename. e.g. for
   *  `epic-devx-plan-skill.md`, `epicSlug` is `devx-plan-skill`. */
  epicSlug: string;
  /** Resolved config snapshot — used by deriveBranch for check #5. */
  config: DeriveBranchConfig;
}

export interface ValidateEmitFs {
  readFile(path: string): string;
  exists(path: string): boolean;
  /** List filenames in a dir. Used for the dev/ scan; absent dir → []. */
  readdir(path: string): string[];
}

export interface ValidateEmitResult {
  /** All issues collected across the six checks. */
  issues: ValidationIssue[];
  /** True iff the epic file was found and validation ran. False → exit 2. */
  epicFound: boolean;
  /** Path of the epic file we tried to read (for the error message in
   *  the epic-not-found case). */
  epicPath: string;
}

const realFs: ValidateEmitFs = {
  readFile: (p) => readFileSync(p, "utf8"),
  exists: (p) => existsSync(p),
  readdir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
};

/**
 * Validate cross-references for one epic. Pure; all I/O routed through
 * `fsOverride`. The CLI passthrough (`devx plan-helper validate-emit
 * <epic-slug>`) is the only impure caller.
 */
export function validateEmit(
  inputs: ValidateEmitInputs,
  fsOverride: Partial<ValidateEmitFs> = {},
): ValidateEmitResult {
  // CRLF normalization wrapper: every parser below splits on `\n` and matches
  // against literal newline anchors. A spec / DEV.md / sprint-status.yaml saved
  // with CRLF (Windows hand-edit, or `git config core.autocrlf=true`) leaves a
  // trailing `\r` on each line that breaks `lines[i].trimStart() === ...`
  // equality and `^---\n` frontmatter regexes. We normalize once at entry so
  // every downstream consumer sees pure-`\n` content. The emit pipeline (pln102)
  // only writes `\n`, so the project's own emissions are already safe — this
  // guards against hand-edits and fresh clones with autocrlf on.
  const rawFs: ValidateEmitFs = { ...realFs, ...fsOverride };
  const fs: ValidateEmitFs = {
    readFile: (p) => rawFs.readFile(p).replace(/\r\n/g, "\n"),
    exists: (p) => rawFs.exists(p),
    readdir: (p) => rawFs.readdir(p),
  };
  const epicRel = `_bmad-output/planning-artifacts/epic-${inputs.epicSlug}.md`;
  const epicPath = join(inputs.repoRoot, epicRel);

  if (!fs.exists(epicPath)) {
    return { issues: [], epicFound: false, epicPath };
  }

  const epicBody = fs.readFile(epicPath);
  const issues: ValidationIssue[] = [];

  // --- 0) Index dev/ once so checks 1/2/3/4 share the lookup. -----------
  const devDir = join(inputs.repoRoot, "dev");
  const devFiles = fs.readdir(devDir).filter((n) => n.endsWith(".md"));
  // hash → first matching dev spec filename (relative to dev/).
  // Duplicate hashes are detected and surfaced as errors — the spec
  // convention is one-spec-per-hash; a second file claiming the same hash
  // is either a stale rename leftover or a planning bug.
  const specByHash = new Map<string, string>();
  const duplicateHashes = new Map<string, string[]>();
  // Sort filenames for deterministic specByHash content; readdir order is
  // filesystem-dependent and would otherwise leak into error messages.
  const sortedDevFiles = [...devFiles].sort();
  for (const fn of sortedDevFiles) {
    // dev-<hash>-<ts>-<slug>.md  →  hash = first segment after "dev-".
    const m = fn.match(/^dev-([a-z0-9]{3,12})-/i);
    if (!m) continue;
    const hash = m[1];
    if (!specByHash.has(hash)) {
      specByHash.set(hash, fn);
    } else {
      const list = duplicateHashes.get(hash) ?? [specByHash.get(hash)!];
      list.push(fn);
      duplicateHashes.set(hash, list);
    }
  }

  // --- 0b) Duplicate spec hashes are an error. The spec convention is
  //         one-spec-per-hash (CLAUDE.md "Spec file convention"); a stale
  //         leftover after a slug rename + a fresh emit silently fails check
  //         5 (whichever ordering readdir returned wins). Surface it. ----
  for (const [hash, files] of duplicateHashes) {
    issues.push({
      severity: "error",
      check: "duplicate-spec-for-hash",
      message: `hash '${hash}' has ${files.length} matching spec files: ${files.join(", ")}`,
      location: "dev/",
    });
  }

  // --- 1) Epic story headings → dev specs exist. ------------------------
  const storyHashes = parseStoryHashes(epicBody);
  const storyHashSet = new Set(storyHashes.map((s) => s.hash));
  for (const { hash, line } of storyHashes) {
    if (!specByHash.has(hash)) {
      issues.push({
        severity: "error",
        check: "spec-missing",
        message: `epic story '${hash}' has no matching dev spec under dev/`,
        location: `${epicRel}:${line}`,
      });
    }
  }

  // --- 1b) Orphan-spec check: dev specs whose `from:` references this epic
  //         but whose hash does NOT appear in the epic's story-list. The
  //         pln103 AC literal wording ("Every dev spec under dev/dev-* whose
  //         from: references the epic file exists on disk") is most useful
  //         when read as: every spec claiming to be from this epic must be
  //         tracked by the epic. A spec left behind after a story rename or
  //         scope-cut is the regression class this catches. ------------
  const epicFromMarker = `epic-${inputs.epicSlug}.md`;
  for (const fn of sortedDevFiles) {
    const m = fn.match(/^dev-([a-z0-9]{3,12})-/i);
    if (!m) continue;
    const hash = m[1];
    if (storyHashSet.has(hash)) continue; // already tracked, no orphan
    let body: string;
    try {
      body = fs.readFile(join(inputs.repoRoot, "dev", fn));
    } catch {
      continue;
    }
    const fromVal = parseFrontmatterValue(body, "from");
    if (fromVal && fromVal.endsWith(epicFromMarker)) {
      issues.push({
        severity: "error",
        check: "orphan-spec-claims-epic",
        message: `spec for '${hash}' has \`from: ...epic-${inputs.epicSlug}.md\` but no story heading exists in the epic`,
        location: `dev/${fn}`,
      });
    }
  }

  // --- 2) DEV.md rows in the epic's section → specs exist. --------------
  const devMdRel = "DEV.md";
  const devMdPath = join(inputs.repoRoot, devMdRel);
  if (fs.exists(devMdPath)) {
    const devMdRows = parseEpicDevMdRows(
      fs.readFile(devMdPath),
      storyHashes.map((s) => s.hash),
    );
    for (const row of devMdRows) {
      const specAbs = join(inputs.repoRoot, row.specPath);
      if (!fs.exists(specAbs)) {
        issues.push({
          severity: "error",
          check: "devmd-row-points-at-missing-spec",
          message: `DEV.md row references missing spec '${row.specPath}'`,
          location: `${devMdRel}:${row.line}`,
        });
      }
    }
  } else {
    issues.push({
      severity: "error",
      check: "devmd-missing",
      message: `DEV.md not found at ${devMdRel}`,
      location: devMdRel,
    });
  }

  // --- 3) sprint-status.yaml stories under the epic → specs exist. ------
  const sprintRel =
    "_bmad-output/implementation-artifacts/sprint-status.yaml";
  const sprintPath = join(inputs.repoRoot, sprintRel);
  let sprintStoryHashes: Array<{ hash: string; line: number }> = [];
  if (fs.exists(sprintPath)) {
    sprintStoryHashes = parseEpicSprintStatusStories(
      fs.readFile(sprintPath),
      inputs.epicSlug,
    );
    for (const { hash, line } of sprintStoryHashes) {
      if (!specByHash.has(hash)) {
        issues.push({
          severity: "error",
          check: "sprint-status-points-at-missing-spec",
          message: `sprint-status.yaml story '${hash}' under epic-${inputs.epicSlug} has no matching dev spec`,
          location: `${sprintRel}:${line}`,
        });
      }
    }
  } else {
    issues.push({
      severity: "error",
      check: "sprint-status-missing",
      message: `sprint-status.yaml not found at ${sprintRel}`,
      location: sprintRel,
    });
  }

  // --- 4) Retro trifecta — the `<prefix>ret` hash must have all three
  //         artifacts. Derive the prefix from the FIRST non-retro story
  //         hash; this matches emit-retro-story.ts's contract exactly. ---
  const nonRetroHashes = storyHashes
    .map((s) => s.hash)
    .filter((h) => !h.endsWith("ret"));
  if (nonRetroHashes.length > 0) {
    const prefix = nonRetroHashes[0].slice(0, 3);
    const retroHash = `${prefix}ret`;
    // (a) Spec exists.
    const specOk = specByHash.has(retroHash);
    if (!specOk) {
      issues.push({
        severity: "error",
        check: "retro-trifecta-missing-spec",
        message: `retro spec for '${retroHash}' not found under dev/`,
        location: epicRel,
      });
    }
    // (b) DEV.md row exists. Reuse the row-scan we did for check #2 — but
    //     re-read since we may have skipped it on missing DEV.md.
    if (fs.exists(devMdPath)) {
      const devMdContent = fs.readFile(devMdPath);
      const hasRetroRow = devMdHasRowForHash(
        devMdContent,
        retroHash,
        storyHashes.map((s) => s.hash),
      );
      if (!hasRetroRow) {
        issues.push({
          severity: "error",
          check: "retro-trifecta-missing-devmd-row",
          message: `retro '${retroHash}' has no row in DEV.md (looked under same epic section)`,
          location: devMdRel,
        });
      }
    }
    // (c) Sprint-status row exists.
    if (fs.exists(sprintPath)) {
      const hasRetroSprint = sprintStoryHashes.some(
        (s) => s.hash === retroHash,
      );
      if (!hasRetroSprint) {
        issues.push({
          severity: "error",
          check: "retro-trifecta-missing-sprint-status",
          message: `retro '${retroHash}' has no row in sprint-status.yaml under epic-${inputs.epicSlug}`,
          location: sprintRel,
        });
      }
    }
  }

  // --- 5) spec frontmatter `branch:` matches deriveBranch(config, "dev", hash). ---
  for (const { hash } of storyHashes) {
    const specFn = specByHash.get(hash);
    if (!specFn) continue; // already flagged in check #1
    const specRel = `dev/${specFn}`;
    const specBody = fs.readFile(join(inputs.repoRoot, specRel));
    const branch = parseFrontmatterValue(specBody, "branch");
    if (branch === null) {
      // Missing branch: frontmatter is a pln101-class regression. Flag.
      issues.push({
        severity: "error",
        check: "spec-missing-branch-frontmatter",
        message: `spec for '${hash}' has no \`branch:\` frontmatter line`,
        location: specRel,
      });
      continue;
    }
    const expected = deriveBranch(inputs.config, "dev", hash);
    if (branch !== expected) {
      issues.push({
        severity: "error",
        check: "branch-mismatch",
        message: `spec for '${hash}' has branch='${branch}'; deriveBranch yields '${expected}'`,
        location: specRel,
      });
    }
  }

  // --- 6) Locked decisions vs spec ACs. ----------------------------------
  //
  // Two-tier check:
  //
  //   (a) Error-severity: locked decision targets a hash via `<hash> AC
  //       bumped` AND that hash isn't in the epic's story list. This is
  //       structural drift — either the story was dropped from the epic
  //       and the locked decision wasn't updated, or the locked decision
  //       has a typo. Fix-required.
  //
  //   (b) Warn-severity heuristic: each backticked identifier-like token
  //       in the locked-decision body that doesn't appear in the
  //       referenced spec body. Caught structurally — the AC says "flag
  //       conflicts" with file paths + line numbers — but kept advisory
  //       because semantic conflict-detection is genuinely the pln104
  //       surface, not pln103's. Token filter: no whitespace AND ≤50
  //       chars; excludes example strings used as fixture data and quoted
  //       prose. Dedup per (hash, token) so a single bullet with the same
  //       token twice produces one warn, not two.
  //
  // Heuristic anchors only on `<hash> AC bumped`. The earlier fallback to
  // "first hash-shaped token in the bullet" was dropped because
  // adversarial review surfaced that it produced false-positive warns
  // when a Locked decision mentioned multiple hashes in passing.
  // Precision matters more than recall for a warn-severity advisory;
  // missed-anchors that are load-bearing get caught by the (a) error
  // path.
  const lockedDecisions = parseLockedDecisions(epicBody);
  const seenTokenHits = new Set<string>(); // `${hash}\0${token}`
  for (const ld of lockedDecisions) {
    if (!ld.anchorHash) continue;
    if (!storyHashSet.has(ld.anchorHash)) {
      issues.push({
        severity: "error",
        check: "locked-decision-references-unknown-hash",
        message: `locked decision targets hash '${ld.anchorHash}' which has no story heading in the epic`,
        location: `${epicRel}:${ld.line}`,
      });
      continue;
    }
    const specFn = specByHash.get(ld.anchorHash);
    if (!specFn) continue; // story missing → already flagged in check #1
    const specBody = fs.readFile(
      join(inputs.repoRoot, "dev", specFn),
    );
    for (const token of ld.backtickedTokens) {
      if (token.length > 50) continue;
      if (/\s/.test(token)) continue;
      const dedupKey = `${ld.anchorHash} ${token}`;
      if (seenTokenHits.has(dedupKey)) continue;
      if (!specBody.includes(token)) {
        seenTokenHits.add(dedupKey);
        issues.push({
          severity: "warn",
          check: "locked-decision-token-missing-from-spec",
          message: `locked decision references '\`${token}\`' but spec for '${ld.anchorHash}' doesn't mention it`,
          location: `${epicRel}:${ld.line} → dev/${specFn}`,
        });
      }
    }
  }

  return { issues, epicFound: true, epicPath };
}

// ---------------------------------------------------------------------------
// Parsers — exported for the unit tests that exercise them in isolation.
// ---------------------------------------------------------------------------

export interface StoryHashRef {
  hash: string;
  /** 1-based line number in the epic file. */
  line: number;
}

export function parseStoryHashes(epicBody: string): StoryHashRef[] {
  const lines = epicBody.split("\n");
  // Walk only the body of `## Story list with ACs` (the Phase 1 convention)
  // OR the next-best anchor "## Stories" / "## Story list" — fall back to
  // scanning all `### <hash> — ` headings if we can't find a story-list
  // anchor at all. The fallback handles older epic files that haven't
  // adopted the canonical heading; the strict scan handles party-mode
  // subheadings under "## Party-mode refined" that begin with `###` but
  // are not story headings (e.g., `### Findings + decisions`).
  let inStoryList = false;
  let foundAnchor = false;
  const hits: StoryHashRef[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /^## Story list( with ACs)?\s*$/.test(line) ||
      /^## Stories\s*$/.test(line)
    ) {
      inStoryList = true;
      foundAnchor = true;
      continue;
    }
    // Any other `## ` heading exits the story-list section. The earlier
    // shape (`!startsWith("## Story")`) was over-permissive — it would
    // hold inStoryList through any heading like "## Story rationale" or
    // "## Story exclusions", silently pulling story-shaped headings from
    // unrelated sections into the result. Now: ONLY the canonical
    // re-entry headings keep inStoryList; everything else exits.
    if (
      inStoryList &&
      line.startsWith("## ") &&
      !/^## Story list( with ACs)?\s*$/.test(line) &&
      !/^## Stories\s*$/.test(line)
    ) {
      inStoryList = false;
    }
    if (inStoryList) {
      const m = line.match(STORY_HEADING_RE);
      if (m) hits.push({ hash: m[1], line: i + 1 });
    }
  }
  if (foundAnchor) return hits;
  // Fallback: scan every `### <hash> — ` heading in the file. (Older epics
  // pre-Phase-1 didn't have an explicit "Story list" anchor.)
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(STORY_HEADING_RE);
    if (m) hits.push({ hash: m[1], line: i + 1 });
  }
  return hits;
}

export interface DevMdRowRef {
  specPath: string;
  /** 1-based line number in DEV.md. */
  line: number;
}

/**
 * Find DEV.md rows belonging to the epic. We scan every section header
 * (`### `) and pick the section whose body references at least one of the
 * epic's story hashes. Returns the spec paths from rows in that section
 * (any checkbox state, including ~~strikethrough~~).
 *
 * Tracks fenced code blocks (lines starting with three or more backticks)
 * and skips matches inside them — DEV.md may legitimately quote example
 * row syntax inside a fence; that example shouldn't trip the validator
 * with a `devmd-row-points-at-missing-spec` error against documentation.
 */
export function parseEpicDevMdRows(
  devMdContent: string,
  epicHashes: string[],
): DevMdRowRef[] {
  if (epicHashes.length === 0) return [];
  const lines = devMdContent.split("\n");

  // First pass: compute fence-state per line so the section-finder and the
  // collector both honor it.
  const inFence: boolean[] = new Array(lines.length).fill(false);
  let fenceOpen = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i])) {
      // Line that opens or closes a fence is itself NOT inside the fence
      // (markdown convention) — flip state AFTER recording false.
      inFence[i] = false;
      fenceOpen = !fenceOpen;
    } else {
      inFence[i] = fenceOpen;
    }
  }

  const headerIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!inFence[i] && lines[i].startsWith("### ")) headerIdxs.push(i);
  }
  if (headerIdxs.length === 0) return [];

  const epicHashSet = new Set(epicHashes);
  // Find the first section that mentions any epic hash. (Conservative:
  // a section that mentions only the retro hash but not the parents
  // wouldn't match — but every emitted section by /devx-plan Phase 5
  // includes the parents, so this is safe in practice.)
  let targetIdx = -1;
  for (let s = 0; s < headerIdxs.length; s++) {
    const start = headerIdxs[s];
    const end = s + 1 < headerIdxs.length ? headerIdxs[s + 1] : lines.length;
    for (let i = start + 1; i < end; i++) {
      if (inFence[i]) continue;
      const m = lines[i].match(DEV_MD_ROW_RE);
      if (!m) continue;
      // Spec path: dev/dev-<hash>-<ts>-<slug>.md → extract hash.
      const hashMatch = m[1].match(/^dev\/dev-([a-z0-9]{3,12})-/i);
      if (hashMatch && epicHashSet.has(hashMatch[1])) {
        targetIdx = s;
        break;
      }
    }
    if (targetIdx !== -1) break;
  }
  if (targetIdx === -1) return [];

  const sectionStart = headerIdxs[targetIdx];
  const sectionEnd =
    targetIdx + 1 < headerIdxs.length
      ? headerIdxs[targetIdx + 1]
      : lines.length;

  const out: DevMdRowRef[] = [];
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (inFence[i]) continue;
    const m = lines[i].match(DEV_MD_ROW_RE);
    if (m) out.push({ specPath: m[1], line: i + 1 });
  }
  return out;
}

export function devMdHasRowForHash(
  devMdContent: string,
  hash: string,
  epicHashes: string[],
): boolean {
  const rows = parseEpicDevMdRows(devMdContent, epicHashes);
  for (const r of rows) {
    const m = r.specPath.match(/^dev\/dev-([a-z0-9]{3,12})-/i);
    if (m && m[1] === hash) return true;
  }
  return false;
}

export interface SprintStatusStoryRef {
  hash: string;
  line: number;
}

/**
 * Walk sprint-status.yaml; find the `- key: epic-<slug>` line; collect
 * `- key: <hash>` story lines under it (until the next `- key: epic-…`
 * or `- key: plan-…` or end-of-file). Returns each story hash + its
 * 1-based line number.
 */
export function parseEpicSprintStatusStories(
  sprintContent: string,
  epicSlug: string,
): SprintStatusStoryRef[] {
  const lines = sprintContent.split("\n");
  const epicTrigger = `- key: epic-${epicSlug}`;
  let epicIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart() === epicTrigger) {
      epicIdx = i;
      break;
    }
  }
  if (epicIdx === -1) return [];

  const epicDashCol = lines[epicIdx].indexOf("-");
  let epicEnd = lines.length;
  for (let i = epicIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (trimmed === "") continue;
    const dashCol = lines[i].indexOf("-");
    // Same-indent or shallower `- key: epic-...` / `- key: plan-...` ends
    // the block.
    if (dashCol !== -1 && dashCol <= epicDashCol) {
      if (
        SPRINT_STATUS_EPIC_RE.test(lines[i]) ||
        /^\s*- key: plan-/.test(lines[i])
      ) {
        epicEnd = i;
        break;
      }
    }
  }

  const out: SprintStatusStoryRef[] = [];
  for (let i = epicIdx + 1; i < epicEnd; i++) {
    const m = lines[i].match(SPRINT_STATUS_STORY_RE);
    if (m) out.push({ hash: m[1], line: i + 1 });
  }
  return out;
}

/**
 * Pull the value of a top-level YAML scalar from the spec's frontmatter
 * block. Frontmatter is the first `---`/`---` delimited block. Returns
 * `null` if the key isn't present (or the value is empty).
 *
 * Strips: surrounding YAML quotes (single or double), inline `#`-prefixed
 * comments, leading/trailing whitespace. Tolerates the empty-frontmatter
 * shape `---\n---` (regex makes the inner newline optional).
 *
 * We don't pull in a YAML lib here — the frontmatter shape is highly
 * constrained (8 known keys, all scalar) and a small set of regexes
 * covers every shape we've seen across pln101/pln102's emitted artifacts
 * + adversarial-review-surfaced hand-edits.
 */
export function parseFrontmatterValue(
  specBody: string,
  key: string,
): string | null {
  // `\r?\n` so a CRLF spec that bypassed the validator's outer normalize
  // (e.g., a direct call from tests) still parses; `\n?---` so an empty
  // frontmatter block (`---\n---`) is recognized.
  const m = specBody.match(/^---\r?\n([\s\S]*?)\r?\n?---/);
  if (!m) return null;
  const fm = m[1];
  const re = new RegExp(`^${escapeRe(key)}:\\s*(.*)$`, "m");
  const v = fm.match(re);
  if (!v) return null;
  let raw = v[1];
  // Strip inline `# ...` comments (YAML semantics). Don't strip if the
  // `#` appears inside surrounding quotes — but we don't bother detecting
  // that case here since none of the frontmatter keys we read (branch,
  // from) ever embed `#` inside their value.
  const hashIdx = raw.indexOf(" #");
  if (hashIdx !== -1) raw = raw.slice(0, hashIdx);
  raw = raw.trim();
  // Strip surrounding YAML quotes. `"feat/dev-foo"` → `feat/dev-foo`.
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1);
  }
  return raw === "" ? null : raw;
}

export interface LockedDecisionRef {
  /** Hash this locked decision is about (parsed from `<hash> AC bumped`
   *  or from a containing bullet). null if we can't anchor. */
  anchorHash: string | null;
  /** Tokens inside backticks within this locked decision's prose. */
  backtickedTokens: string[];
  /** 1-based line of the `**Locked decision:**` marker. */
  line: number;
}

/**
 * Extract `**Locked decision:** ...` bullets from the epic's party-mode
 * section. Each result carries the anchor hash (the spec it should affect)
 * and the list of backticked tokens inside the bullet. Heuristic — works
 * on the prose shape used by every Phase 1 epic.
 *
 * Two adversarial-review hardenings:
 *   - Multiple `**Locked decision:**` markers on the same line each
 *     produce their own ref (matchAll, not includes-once). Earlier
 *     shape mis-attributed the second decision's tokens to the first.
 *   - Continuation-body collection clamps tightly: it stops on a blank
 *     line, on the start of a new top-level bullet (`/^\s*- /`), AND on
 *     any line that itself contains another `**Locked decision:**`
 *     marker. Earlier shape allowed continuation prose to swallow the
 *     next decision's tokens.
 */
export function parseLockedDecisions(epicBody: string): LockedDecisionRef[] {
  const out: LockedDecisionRef[] = [];
  const lines = epicBody.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineMatches = [...lines[i].matchAll(/\*\*Locked decision:\*\*/g)];
    if (lineMatches.length === 0) continue;
    if (lineMatches.length === 1) {
      // Common case: one marker per line. Continuation walk picks up
      // subsequent prose lines (until a stop condition) so multi-line
      // bullets render their tokens correctly.
      const body: string[] = [lines[i]];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (next.trim() === "") break;
        if (/^\s*- /.test(next)) break;
        if (/^\s*\*\*/.test(next)) break;
        if (next.includes("**Locked decision:**")) break;
        body.push(next);
      }
      out.push(buildLockedDecisionRef(body.join(" "), i + 1));
    } else {
      // Multi-marker line: split the line at every `**Locked decision:**`
      // boundary so each gets its own ref with its own tokens. Markers in
      // the same line never have continuation lines (the next physical
      // line still starts at i+1 and would attach to the LAST split
      // segment in spirit, but the cleanest semantics is: same-line
      // markers don't continue).
      const lineText = lines[i];
      const positions = lineMatches.map((m) => m.index ?? 0);
      for (let k = 0; k < positions.length; k++) {
        const start = positions[k];
        const end = k + 1 < positions.length ? positions[k + 1] : lineText.length;
        out.push(buildLockedDecisionRef(lineText.slice(start, end), i + 1));
      }
    }
  }
  return out;
}

function buildLockedDecisionRef(
  bulletText: string,
  line: number,
): LockedDecisionRef {
  // Anchor ONLY on `<hash> AC bumped` — the canonical Phase 1 epic shape.
  // The earlier "first hash-shaped token" fallback was dropped per
  // adversarial-review finding: it produced false-positive warns when a
  // Locked decision mentioned multiple hashes in passing. Precision >
  // recall for a warn-severity advisory.
  let anchorHash: string | null = null;
  const acm = bulletText.match(AC_BUMPED_RE);
  if (acm) anchorHash = acm[1];
  const tokens: string[] = [];
  for (const m of bulletText.matchAll(BACKTICK_TOKEN_RE)) {
    tokens.push(m[1]);
  }
  return { anchorHash, backtickedTokens: dedup(tokens), line };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedup<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
