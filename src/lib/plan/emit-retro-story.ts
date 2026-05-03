// Pure helpers + atomic-emit driver for the per-epic retro story emitted by
// `/devx-plan` Phase 5 (pln102). Closes the LEARN.md cross-epic regression
// where Phase 0 had to hand-backfill `*ret` rows into sprint-status.yaml in
// every retro PR (5/5 retros — see CLAUDE.md "How /devx runs" + LEARN.md
// cross-epic patterns row "retros-absent-from-sprint-status").
//
// Two surfaces:
//
//   emitRetroStory(epicSlug, parentHashes, opts)
//     Pure. Returns {specPath, specBody, devMdRow, sprintStatusRow}. No I/O.
//     Goes through every test in plan-emit-retro-story.test.ts without
//     touching disk.
//
//   writeRetroAtomically(emit, opts)
//     I/O driver. Implements epic locked-decision #7 from
//     `_bmad-output/planning-artifacts/epic-devx-plan-skill.md`:
//       (a) write all three to *.tmp files first
//       (b) rename in fixed order: spec → DEV.md → sprint-status.yaml
//       (c) on any rename failure the prior renames are committed; the
//           partial state is logged to stderr as "WARN: retro emission
//           partial — manually verify <missing>". Don't delete partial
//           artifacts (better partial than zero).
//
// The /devx-plan Phase 5 step + the `devx plan-helper emit-retro-story`
// CLI both invoke this (the CLI is the deterministic seam used by the
// skill body, mirroring the mrg102 → merge-gate / pln101 → derive-branch
// pattern).
//
// Spec: dev/dev-pln102-2026-04-28T19:30-plan-emit-retro.md

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// Slug shape: lowercase alphanum + dashes, 1-80 chars. Mirrors the kebab-case
// convention for every existing epic-<slug>.md filename. Anything else
// (slashes, newlines, dots, uppercase) is rejected at function entry to
// prevent slug-injection into the filename or YAML frontmatter.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

// ---------------------------------------------------------------------------
// Pure: emitRetroStory
// ---------------------------------------------------------------------------

export interface EmitRetroStoryOpts {
  /** Plan-spec path the retro descends from — goes into spec frontmatter `plan:`. */
  planPath: string;
  /** YOLO/BETA/PROD/LOCKDOWN at planning time. Provenance only — appears in
   *  the spec's Technical notes, not the ACs (mode-gating happens at /devx
   *  claim time, not at retro plan-time). */
  mode: string;
  /** project.shape at planning time. Provenance only. */
  shape: string;
  /** thoroughness at planning time. Provenance only. */
  thoroughness: string;
  /** Pre-derived branch name (e.g. "feat/dev-mrgret"). Caller composes via
   *  `deriveBranch(config, "dev", ${prefix}ret)` — keeping the call out of
   *  this fn keeps emitRetroStory pure (no config import) and matches the
   *  pln101→pln102 layered-helper pattern. */
  branch: string;
  /** Test seam. Defaults to wall-clock; tests inject a fixed Date to make
   *  the timestamp/filename deterministic. */
  now?: () => Date;
}

export interface EmitRetroStoryResult {
  /** Repo-relative spec path: dev/dev-<prefix>ret-<ts>-retro-<slug>.md. */
  specPath: string;
  /** Full markdown content for the new spec file (no trailing newline by
   *  convention — match other dev specs). */
  specBody: string;
  /** Single line to append under the matching epic in DEV.md (no leading
   *  or trailing newline; the writer adds the newline boundary). */
  devMdRow: string;
  /** YAML chunk to insert under the epic's stories: list in
   *  sprint-status.yaml. Four lines, 10/12-space indented to match the
   *  existing structure. No trailing newline. */
  sprintStatusRow: string;
}

const RETRO_TITLE = "Retro + LEARN.md updates (interim retro discipline)";

/**
 * Compute the per-epic retro spec + the two backlog rows that go alongside it.
 *
 * Pure — no fs, no env, no clock unless `opts.now` is supplied. The result
 * is a fully-materialized, ready-to-write tuple. No half-renderable templates
 * leak out (every placeholder is substituted before return).
 *
 * Throws on:
 *  - empty parentHashes
 *  - parent hashes whose 3-char prefixes don't all match (prevents
 *    accidentally emitting a retro that's blocked-by stories from two
 *    different epics — that would silently break the dependency graph)
 *  - empty/whitespace epicSlug
 */
export function emitRetroStory(
  epicSlug: string,
  parentHashes: string[],
  opts: EmitRetroStoryOpts,
): EmitRetroStoryResult {
  if (!epicSlug || epicSlug.trim() === "") {
    throw new Error("emitRetroStory: epicSlug must be non-empty");
  }
  if (!SLUG_RE.test(epicSlug)) {
    // Rejecting slashes / dots / newlines / uppercase here prevents:
    //  - filename misdirection ("merge-gate/v2" silently writes under dev/merge-gate/v2.md)
    //  - YAML frontmatter break-out ("merge-gate\nstatus: hijacked")
    //  - case-folding drift across filesystems
    throw new Error(
      `emitRetroStory: epicSlug '${epicSlug}' is not kebab-case (must match ${SLUG_RE.source})`,
    );
  }
  if (parentHashes.length === 0) {
    throw new Error(
      "emitRetroStory: parentHashes must contain at least one hash",
    );
  }

  const prefix = parentHashes[0].slice(0, 3);
  for (const p of parentHashes) {
    if (p.slice(0, 3) !== prefix) {
      throw new Error(
        `emitRetroStory: parent hashes must share a 3-char prefix; got '${parentHashes.join(", ")}' (prefix mismatch on '${p}')`,
      );
    }
  }
  const retroHash = `${prefix}ret`;

  const now = (opts.now ?? (() => new Date()))();
  const { iso, filenameStamp } = formatTimestamps(now);

  const specPath = `dev/dev-${retroHash}-${filenameStamp}-retro-${epicSlug}.md`;
  const specBody = renderSpecBody({
    retroHash,
    epicSlug,
    parentHashes,
    iso,
    planPath: opts.planPath,
    branch: opts.branch,
    mode: opts.mode,
    shape: opts.shape,
    thoroughness: opts.thoroughness,
  });
  const devMdRow = `- [ ] \`${specPath}\` — ${RETRO_TITLE}. Status: ready. Blocked-by: ${parentHashes.join(", ")}.`;
  const sprintStatusRow = renderSprintStatusRow(retroHash, parentHashes);

  return { specPath, specBody, devMdRow, sprintStatusRow };
}

interface RenderSpecOpts {
  retroHash: string;
  epicSlug: string;
  parentHashes: string[];
  iso: string;
  planPath: string;
  branch: string;
  mode: string;
  shape: string;
  thoroughness: string;
}

function renderSpecBody(o: RenderSpecOpts): string {
  return `---
hash: ${o.retroHash}
type: dev
created: ${o.iso}
title: ${RETRO_TITLE}
from: _bmad-output/planning-artifacts/epic-${o.epicSlug}.md
plan: ${o.planPath}
status: ready
blocked_by: [${o.parentHashes.join(", ")}]
branch: ${o.branch}
---

## Goal

Run \`bmad-retrospective\` on epic-${o.epicSlug}; append findings to \`LEARN.md § epic-${o.epicSlug}\`.

## Acceptance criteria

- [ ] \`bmad-retrospective\` invoked against shipped stories (${o.parentHashes.join(", ")}).
- [ ] Findings appended to \`LEARN.md § epic-${o.epicSlug}\` (create section if absent).
- [ ] Each finding tagged \`[confidence]\` (low/med/high) + \`[blast-radius]\` (memory/skill/template/config/docs/code).
- [ ] Low-blast findings applied in retro PR.
- [ ] Higher-blast findings filed as MANUAL.md or new specs.
- [ ] Cross-epic patterns hitting ≥3 retros total promoted into \`LEARN.md § Cross-epic patterns\`.
- [ ] Sprint-status row for \`${o.retroHash}\` present (this row is emitted at planning time by pln102; /devx flips status to done at Phase 8.6 cleanup).

## Technical notes

- Sunset per Phase 5 epic-retro-agent + epic-learn-agent.
- Emitted by \`/devx-plan\` Phase 5 (pln102) at planning time — mode=${o.mode}, shape=${o.shape}, thoroughness=${o.thoroughness} (provenance; the retro itself runs under whatever mode is active at /devx claim time).

## Status log

- ${o.iso} — created by /devx-plan
`;
}

function renderSprintStatusRow(
  retroHash: string,
  parentHashes: string[],
): string {
  // 10-space indent for `- key:`, 12-space indent for sub-fields. Matches the
  // existing sprint-status.yaml structure (every story row in the file uses
  // these exact indents — see e.g. `mrgret` block lines 283-286).
  return `          - key: ${retroHash}
            title: ${RETRO_TITLE}
            status: backlog
            blocked_by: [${parentHashes.join(", ")}]`;
}

interface FormattedTs {
  /** Full ISO with offset (matches existing `created:` frontmatter values
   *  like "2026-04-28T19:30:00-07:00"). */
  iso: string;
  /** Filename stamp at minute precision (matches existing dev/ filenames
   *  like "2026-04-28T19:30"). */
  filenameStamp: string;
}

function formatTimestamps(d: Date): FormattedTs {
  // Render in the local TZ so the `created:` frontmatter matches the
  // contributor's wall clock — every existing spec file was produced this
  // way (offset = -07:00 / -08:00 depending on DST).
  //
  // Date.prototype.toISOString returns UTC. We want local-with-offset.
  // Build it manually from the local components.
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const yyyy = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());

  // Timezone offset: negative for west-of-UTC, positive east. JS returns
  // it inverted (getTimezoneOffset is "minutes to add to local to get UTC")
  // so flip the sign for the ISO suffix.
  const offMin = -d.getTimezoneOffset();
  const offSign = offMin >= 0 ? "+" : "-";
  const offAbs = Math.abs(offMin);
  const offHH = pad(Math.floor(offAbs / 60));
  const offMM = pad(offAbs % 60);

  const iso = `${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}${offSign}${offHH}:${offMM}`;
  const filenameStamp = `${yyyy}-${mo}-${dd}T${hh}:${mm}`;
  return { iso, filenameStamp };
}

// ---------------------------------------------------------------------------
// I/O: writeRetroAtomically
// ---------------------------------------------------------------------------

export interface AtomicEmitFs {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  rename(oldPath: string, newPath: string): void;
  exists(path: string): boolean;
  mkdirRecursive(path: string): void;
  unlink(path: string): void;
}

const realFs: AtomicEmitFs = {
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, c) => writeFileSync(p, c, "utf8"),
  rename: (a, b) => renameSync(a, b),
  exists: (p) => existsSync(p),
  mkdirRecursive: (p) => mkdirSync(p, { recursive: true }),
  unlink: (p) => {
    try {
      unlinkSync(p);
    } catch {
      /* swallow: best-effort cleanup */
    }
  },
};

export interface AtomicEmitOpts {
  /** Absolute path to the repo root. Spec is written under <repoRoot>/dev/. */
  repoRoot: string;
  /** Repo-relative path to DEV.md (default "DEV.md"). */
  devMdPath?: string;
  /** Repo-relative path to sprint-status.yaml (default
   *  "_bmad-output/implementation-artifacts/sprint-status.yaml"). */
  sprintStatusPath?: string;
  /** Test seam — inject failures at any fs op. Defaults to real node:fs. */
  fs?: Partial<AtomicEmitFs>;
  /** Test seam for stderr capture. */
  err?: (s: string) => void;
}

export interface AtomicEmitResult {
  /** Absolute paths that successfully renamed (0..3). */
  written: string[];
  /** Absolute paths that didn't make it (only set if partial). */
  partial?: string[];
  /** True iff all three artifacts landed. */
  fullSuccess: boolean;
}

const DEFAULT_DEV_MD = "DEV.md";
const DEFAULT_SPRINT_STATUS =
  "_bmad-output/implementation-artifacts/sprint-status.yaml";

/**
 * Write the three artifacts atomically per epic locked-decision #7.
 *
 * Sequencing:
 *   1. Compose all three target contents (read existing DEV.md +
 *      sprint-status.yaml, splice the new rows in textually, fail with a
 *      clear diagnostic if either insertion can't find the right anchor).
 *   2. writeFile to *.tmp paths for all three. If any of these throws,
 *      clean up any .tmp files written so far and re-throw — no real
 *      file has changed yet, so this is a clean abort.
 *   3. Rename in fixed order: spec → DEV.md → sprint-status.yaml. If a
 *      rename throws, the prior renames are committed (better partial
 *      than zero); we emit a WARN to stderr listing every artifact that
 *      didn't land, leave its .tmp on disk for the operator to inspect,
 *      and return AtomicEmitResult{partial: [...]}. The pln102 spec
 *      explicitly accepts this trade-off (party-mode locked decision #7
 *      — see _bmad-output/planning-artifacts/epic-devx-plan-skill.md).
 */
export function writeRetroAtomically(
  emit: EmitRetroStoryResult,
  opts: AtomicEmitOpts,
): AtomicEmitResult {
  const fs: AtomicEmitFs = { ...realFs, ...(opts.fs ?? {}) };
  const err = opts.err ?? ((s: string) => process.stderr.write(s));
  const devMdRel = opts.devMdPath ?? DEFAULT_DEV_MD;
  const sprintStatusRel = opts.sprintStatusPath ?? DEFAULT_SPRINT_STATUS;

  const specAbs = join(opts.repoRoot, emit.specPath);
  const devMdAbs = join(opts.repoRoot, devMdRel);
  const sprintStatusAbs = join(opts.repoRoot, sprintStatusRel);

  // ---- 1) Compose target contents ----
  if (fs.exists(specAbs)) {
    throw new Error(
      `writeRetroAtomically: refusing to overwrite existing spec at ${specAbs}`,
    );
  }
  if (!fs.exists(devMdAbs)) {
    throw new Error(
      `writeRetroAtomically: DEV.md not found at ${devMdAbs}`,
    );
  }
  if (!fs.exists(sprintStatusAbs)) {
    throw new Error(
      `writeRetroAtomically: sprint-status.yaml not found at ${sprintStatusAbs}`,
    );
  }

  const parentHashes = parseParentsFromDevMdRow(emit.devMdRow);
  const epicSlug = parseEpicSlugFromSpecBody(emit.specBody);

  const devMdBefore = fs.readFile(devMdAbs);
  const devMdAfter = insertDevMdRow(devMdBefore, parentHashes, emit.devMdRow);

  const sprintBefore = fs.readFile(sprintStatusAbs);
  const sprintAfter = insertSprintStatusRow(
    sprintBefore,
    epicSlug,
    emit.sprintStatusRow,
  );

  // ---- 2) Write all three .tmp files ----
  // PID + Date.now() alone collides if two emissions land in the same ms
  // (cheap to provoke under future Phase 2 ManageAgent parallelism, or in
  // a tight test loop). The 8-byte random suffix makes a collision
  // astronomically unlikely AND keeps each of the three tmps independent
  // within one emission (so a failed cleanup of one doesn't shadow another).
  const tag = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
  const specTmp = `${specAbs}.tmp.${tag}.spec`;
  const devMdTmp = `${devMdAbs}.tmp.${tag}.devmd`;
  const sprintStatusTmp = `${sprintStatusAbs}.tmp.${tag}.sprint`;

  const tmpsWritten: string[] = [];
  try {
    // mkdirRecursive is wrapped in the same try as the writes so a
    // permission failure surfaces with the tmp-cleanup path — same shape
    // as a writeFile failure. Without this, the caller would see a bare
    // node:fs ENOENT/EACCES and have no signal about partial state.
    fs.mkdirRecursive(dirname(specAbs));
    fs.writeFile(specTmp, emit.specBody);
    tmpsWritten.push(specTmp);
    fs.writeFile(devMdTmp, devMdAfter);
    tmpsWritten.push(devMdTmp);
    fs.writeFile(sprintStatusTmp, sprintAfter);
    tmpsWritten.push(sprintStatusTmp);
  } catch (e) {
    // Clean up any .tmp we wrote — no real file has changed yet, so this
    // really is a clean abort. The caller sees the original error.
    for (const t of tmpsWritten) fs.unlink(t);
    throw e;
  }

  // ---- 3) Rename in fixed order ----
  const writtenAbs: string[] = [];
  const partialAbs: string[] = [];
  const leftoverTmps: string[] = [];
  const renamePlan: Array<{ tmp: string; dest: string; label: string }> = [
    { tmp: specTmp, dest: specAbs, label: "spec" },
    { tmp: devMdTmp, dest: devMdAbs, label: "DEV.md" },
    { tmp: sprintStatusTmp, dest: sprintStatusAbs, label: "sprint-status.yaml" },
  ];

  let firstFailure: { label: string; cause: unknown } | null = null;
  for (let i = 0; i < renamePlan.length; i++) {
    const { tmp, dest, label } = renamePlan[i];
    if (firstFailure !== null) {
      // A prior rename in this batch failed — we don't attempt subsequent
      // renames per locked decision #7 ("on any rename failure the prior
      // renames are committed but partial state is logged"). The remaining
      // .tmp files are left on disk for the operator (and listed in the
      // WARN below) so they can finish the rename by hand.
      partialAbs.push(dest);
      leftoverTmps.push(tmp);
      continue;
    }
    try {
      fs.rename(tmp, dest);
      writtenAbs.push(dest);
    } catch (cause) {
      firstFailure = { label, cause };
      partialAbs.push(dest);
      leftoverTmps.push(tmp);
    }
  }

  if (firstFailure !== null) {
    // List the actual paths (not just labels like "spec") so the operator
    // doesn't have to grep to find which file to verify. Mirrors the
    // BH[5] adversarial-review finding.
    const missingPaths = renamePlan
      .filter(({ dest }) => partialAbs.includes(dest))
      .map(({ dest }) => dest);
    const causeMsg =
      firstFailure.cause instanceof Error
        ? firstFailure.cause.message
        : String(firstFailure.cause);
    err(
      `WARN: retro emission partial — manually verify ${missingPaths.join(", ")} ` +
        `(rename ${firstFailure.label} failed: ${causeMsg}). ` +
        `Leftover .tmp files (recover by renaming, or git clean -f to discard): ${leftoverTmps.join(", ")}\n`,
    );
    return {
      written: writtenAbs,
      partial: partialAbs,
      fullSuccess: false,
    };
  }

  return { written: writtenAbs, fullSuccess: true };
}

// ---------------------------------------------------------------------------
// Textual splicing helpers (also exported for the validate-emit checker
// that lands in pln103).
// ---------------------------------------------------------------------------

/**
 * Insert the new retro row at the bottom of the epic section in DEV.md.
 *
 * Locates the epic by scanning `### ` heading sections for one whose body
 * contains the first parent hash (matched as `dev-<hash>-`). The new row
 * is spliced after the last existing `- [<state>] \`dev/...` row in that
 * section. Throws if the epic can't be found.
 *
 * Textual rather than markdown-AST because the DEV.md format is line-stable
 * by convention (every backlog file in the repo uses the same `- [ ] \`...\``
 * shape) and an AST roundtrip would risk reformatting the rest of the file.
 */
export function insertDevMdRow(
  content: string,
  parentHashes: string[],
  newRow: string,
): string {
  const lines = content.split("\n");
  const headerIdxs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("### ")) headerIdxs.push(i);
  }
  if (headerIdxs.length === 0) {
    throw new Error(
      "insertDevMdRow: DEV.md has no `### ` section headers — cannot locate epic",
    );
  }

  // Find the section whose body contains the first parent hash. We probe
  // every section rather than just the last so a re-emit (idempotency
  // probe by pln103) finds the right one even when later sections also
  // reference the hash in cross-references.
  //
  // Probe is anchored to a path-component boundary so a hash that's a
  // prefix substring of another (e.g. `mrg10` vs `mrg101`) doesn't match
  // the longer hash's row. Existing rows always look like
  // `\`dev/dev-<hash>-<ts>` — the `-` after the hash is always followed
  // by a digit (the timestamp's first char is YYYY).
  const firstParent = parentHashes[0];
  const probeRe = new RegExp(`dev-${escapeRegex(firstParent)}-\\d`);
  let targetSection = -1;
  for (let s = 0; s < headerIdxs.length; s++) {
    const start = headerIdxs[s];
    const end = s + 1 < headerIdxs.length ? headerIdxs[s + 1] : lines.length;
    for (let i = start + 1; i < end; i++) {
      if (probeRe.test(lines[i])) {
        targetSection = s;
        break;
      }
    }
    if (targetSection !== -1) break;
  }
  if (targetSection === -1) {
    throw new Error(
      `insertDevMdRow: could not locate an epic section in DEV.md containing parent hash '${firstParent}'`,
    );
  }

  const sectionStart = headerIdxs[targetSection];
  const sectionEnd =
    targetSection + 1 < headerIdxs.length
      ? headerIdxs[targetSection + 1]
      : lines.length;

  // Find the last existing `- [...] \`dev/...` row in that section. Match
  // any checkbox state ([ ], [/], [-], [x]) and the strikethrough-wrap
  // pattern (`~~- [x] \`dev/...~~`) so abandoned rows still anchor.
  const rowRe = /^(?:~~)?- \[[\sx\/\-]\] `dev\//;
  let insertAt = -1;
  for (let i = sectionEnd - 1; i > sectionStart; i--) {
    if (rowRe.test(lines[i])) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt === -1) {
    throw new Error(
      `insertDevMdRow: section starting at line ${sectionStart + 1} has no existing dev rows to anchor against`,
    );
  }

  const out = [...lines.slice(0, insertAt), newRow, ...lines.slice(insertAt)];
  return out.join("\n");
}

/**
 * Insert the new retro yaml chunk under the matching epic's stories: list
 * in sprint-status.yaml. Locates the epic by `- key: epic-<slug>` (the
 * canonical key shape used by every entry in the file). Inserts the new
 * `- key: <retroHash>` block after the last existing story under that
 * epic.
 */
export function insertSprintStatusRow(
  content: string,
  epicSlug: string,
  newRow: string,
): string {
  const lines = content.split("\n");
  const epicKeySuffix = `- key: epic-${epicSlug}`;

  let epicIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart() === epicKeySuffix) {
      epicIdx = i;
      break;
    }
  }
  if (epicIdx === -1) {
    throw new Error(
      `insertSprintStatusRow: epic 'epic-${epicSlug}' not found in sprint-status.yaml`,
    );
  }

  // Find the bound of this epic block: next sibling-or-shallower entry.
  // Sibling = `- key: epic-…` at the same indent. Shallower = `- key:
  // plan-…` (next plan, 2-space indent). End-of-file is also a bound.
  const epicDashCol = leadingDashCol(lines[epicIdx]);
  // Story rows nest exactly 4 columns deeper per the canonical 10/12-space
  // shape (epic at col 6 → story at col 10). Lock to that — accepting any
  // deeper `- key:` would let nested sub-lists (e.g. a future `tasks:`
  // block) anchor the splice, which would land the new row at the wrong
  // indent and produce invalid YAML.
  const expectedStoryDashCol = epicDashCol + 4;
  let epicEnd = lines.length;
  for (let i = epicIdx + 1; i < lines.length; i++) {
    const dashCol = leadingDashCol(lines[i]);
    if (dashCol === -1) continue;
    const trimmed = lines[i].trimStart();
    // Next epic at same indent → bound.
    if (dashCol === epicDashCol && trimmed.startsWith("- key: epic-")) {
      epicEnd = i;
      break;
    }
    // Next plan (shallower) → bound.
    if (dashCol < epicDashCol && trimmed.startsWith("- key: plan-")) {
      epicEnd = i;
      break;
    }
  }

  // Find the last `- key:` story line at the canonical story dash-col
  // (epicDashCol + 4 — the 10/12-space convention used by every existing
  // entry in the file). Locking the dash-col rejects nested sub-list
  // entries (e.g. a future `tasks:` block) that would otherwise anchor
  // the splice at the wrong indent.
  let lastStoryIdx = -1;
  for (let i = epicEnd - 1; i > epicIdx; i--) {
    const dashCol = leadingDashCol(lines[i]);
    if (
      dashCol === expectedStoryDashCol &&
      lines[i].trimStart().startsWith("- key: ")
    ) {
      lastStoryIdx = i;
      break;
    }
  }
  if (lastStoryIdx === -1) {
    throw new Error(
      `insertSprintStatusRow: epic 'epic-${epicSlug}' has no existing stories at the expected indent (col ${expectedStoryDashCol}) to anchor against`,
    );
  }

  // Walk forward from lastStoryIdx to find the end of that story block:
  // the first line that is either another `- key:` at the same dash-col,
  // OR shallower indent (next epic / plan), OR a blank line that
  // separates blocks. (Inserting AT a blank line preserves the blank as
  // separator after the new block — verified by test.)
  let insertAt = epicEnd;
  for (let i = lastStoryIdx + 1; i < epicEnd; i++) {
    const dashCol = leadingDashCol(lines[i]);
    if (
      dashCol === expectedStoryDashCol &&
      lines[i].trimStart().startsWith("- ")
    ) {
      insertAt = i;
      break;
    }
    if (dashCol !== -1 && dashCol < expectedStoryDashCol) {
      insertAt = i;
      break;
    }
    if (lines[i].trim() === "") {
      insertAt = i;
      break;
    }
  }

  const out = [
    ...lines.slice(0, insertAt),
    newRow,
    ...lines.slice(insertAt),
  ];
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Internal parsers — extract the parents + slug we need from the
// EmitRetroStoryResult so writeRetroAtomically doesn't need a parallel
// argument list (the EmitRetroStoryResult is itself the contract).
// ---------------------------------------------------------------------------

function parseParentsFromDevMdRow(row: string): string[] {
  // Anchor on end-of-line (the row ends with `…Blocked-by: a, b, c.`) and
  // capture lazily so the period in `Blocked-by` itself can't terminate the
  // hash list. The earlier `[^.]+` shape would silently truncate if the
  // title ever embedded a period after the "Blocked-by:" anchor — hardening
  // here removes the latent bug class.
  const m = row.match(/Blocked-by:\s*([^\n]+?)\.\s*$/);
  if (!m) {
    throw new Error(
      `writeRetroAtomically: could not parse Blocked-by from devMdRow '${row}'`,
    );
  }
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseEpicSlugFromSpecBody(specBody: string): string {
  const m = specBody.match(
    /^from:\s*_bmad-output\/planning-artifacts\/epic-(.+)\.md\s*$/m,
  );
  if (!m) {
    throw new Error(
      "writeRetroAtomically: could not parse epic slug from spec body's `from:` line",
    );
  }
  return m[1];
}

function escapeRegex(s: string): string {
  // POSIX-safe escape — covers anything that could appear in a hash even
  // though our hash regex constrains to alnum. Defensive against future
  // hash-shape changes.
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Column of the first `- ` (dash followed by space) bullet in `line`, or
 * -1 if there isn't one. Distinct from `indexOf("-")` — that would match
 * stray `-` chars (e.g. inside a comment, or an embedded hyphen) and
 * mis-locate the YAML bullet column.
 */
function leadingDashCol(line: string): number {
  const m = line.match(/^(\s*)- /);
  return m ? m[1].length : -1;
}
