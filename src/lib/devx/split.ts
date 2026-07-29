// Split primitive (mss101, workstream mid-story-split phase 1) — when a
// `/devx` session or `devx loop` item must stop with remaining work, the
// remainder becomes a first-class follow-up spec wired into the dependency
// tree, claimable cold by any fresh session. Replaces the conversation-prose
// Handoff Snippet contract (retired in phase 4).
//
// Surface (design § Architecture 1):
//
//   validateSplitPayload(raw)   — JSON payload → typed SplitPayload or throw.
//   composeSplit(opts)          — pure: parent spec + backlog + payload →
//                                 follow-up spec body + patched parent +
//                                 patched backlog, both shapes.
//   writeSplitAtomically(...)   — claim rollback posture: tmp siblings,
//                                 capture originals, fixed rename order
//                                 (follow-up → parent → backlog),
//                                 restore-on-partial. 0-byte residue on any
//                                 mid-transaction failure.
//   performSplit(hash, opts)    — orchestration: ownership guard → fresh
//                                 hash → compose → locked atomic write.
//
// Two shapes:
//   merge-first    — parent lands via the normal merge tail at reduced
//                    scope; follow-up is Blocked-by: parent with its own
//                    fresh branch.
//   branch-handoff — WIP branch pushed (caller's job; CLI verifies);
//                    parent closed `superseded`; follow-up starts ready
//                    and inherits the branch.
//
// performSplit does NOT release the parent's spec lock — the interactive
// skill releases it on the branch-handoff path (Phase 9 instruction) and
// the loop driver's splitItem owns release on its paths (design
// § Constraints, last bullet).
//
// Spec: dev/dev-mss101-2026-07-28T13:43-split-primitive-lib-cli.md
// Design: _devx/workstreams/mid-story-split/design.md § Architecture 1

import { randomBytes } from "node:crypto";
import { join } from "node:path";

import {
  type BacklogLockFn,
  withBacklogLock,
} from "../backlog/mutate.js";
import {
  type DeriveBranchConfig,
  deriveBranch,
} from "../plan/derive-branch.js";
import {
  formatTimestamps,
  insertDevMdRow,
} from "../plan/emit-retro-story.js";
import { generateHash } from "../engine/workstream.js";
import {
  CLAIMABLE_TYPES,
  type ClaimFs,
  type ClaimableType,
  findSpecForHash,
  realFs,
} from "./claim.js";
import { specLockOwner, specLockPath } from "./spec-lock.js";
import { normalizeSessionToken } from "./verify-claim.js";

// ---------------------------------------------------------------------------
// Types + errors
// ---------------------------------------------------------------------------

export type SplitShape = "merge-first" | "branch-handoff";

export interface SplitCarriedForward {
  /** "State to trust" — facts the next session takes as given. */
  state_to_trust: string[];
  /** "Gotchas (save time — don't rediscover)". */
  gotchas: string[];
  /** "Do NOT" — actions the next session must avoid. */
  do_not: string[];
}

export interface SplitPayload {
  /** Follow-up spec title. Single-line, non-empty, no `;` (the
   *  Next-command block title rules). */
  title: string;
  /** Follow-up Goal section. Defaults to a generated continuation line. */
  goal?: string;
  /** The remaining acceptance criteria — non-empty, one line each. */
  remaining_acs: string[];
  /** The re-homed Handoff Snippet sections (FR-2). */
  carried_forward: SplitCarriedForward;
  /** Extra learnings (loop path: accumulated key_learnings). Rendered
   *  under the Gotchas section. */
  learnings?: string[];
}

/**
 * Thrown for any non-ownership split failure. `stage` ∈ { "payload",
 * "validate", "resolve", "compose", "write-tmp", "read-pre-rename",
 * "rename" }. CLI maps this to exit 2.
 */
export class SplitError extends Error {
  readonly stage: string;
  constructor(stage: string, message: string) {
    super(`split failed at stage '${stage}': ${message}`);
    this.name = "SplitError";
    this.stage = stage;
  }
}

/**
 * Thrown when the caller does not own the parent's claim — the lock is
 * missing (nothing claimed / not yours to split) or records another
 * session. CLI maps this to exit 3 (the roc101 owned-by-other-session
 * convention). Splitting a live peer's item is the E13 stomp shape.
 */
export class SplitOwnershipError extends Error {
  readonly hash: string;
  /** Recorded lock owner, or null when no lock exists (or its body carries
   *  no attributable owner — see `lockExists`). */
  readonly lockOwner: string | null;
  readonly currentSession: string;
  /** Distinguishes "no lock file" from "lock file exists but its body has
   *  no attributable owner" (empty/mid-write body — review EC finding: the
   *  two need different operator guidance). */
  readonly lockExists: boolean;
  constructor(
    hash: string,
    lockOwner: string | null,
    currentSession: string,
    lockExists = false,
  ) {
    super(
      lockOwner !== null
        ? `spec lock for '${hash}' is owned by '${lockOwner}', not current session '${currentSession}'`
        : lockExists
          ? `spec lock for '${hash}' exists but has no attributable owner (empty/mid-write body) — retry, or inspect the lock before splitting`
          : `no spec lock held for '${hash}' — claim the item before splitting it`,
    );
    this.name = "SplitOwnershipError";
    this.hash = hash;
    this.lockOwner = lockOwner;
    this.currentSession = currentSession;
    this.lockExists = lockExists;
  }
}

const HASH_RE = /^[a-z0-9]{3,12}$/i;

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed JSON payload into a SplitPayload. Throws
 * SplitError("payload") naming every violation at once (one round-trip for
 * the operator fixing a hand-written payload file).
 */
export function validateSplitPayload(raw: unknown): SplitPayload {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SplitError("payload", "payload must be a JSON object");
  }
  const o = raw as Record<string, unknown>;

  let title = "";
  if (typeof o.title !== "string" || o.title.trim() === "") {
    problems.push("title must be a non-empty string");
  } else if (/[\n\r]/.test(o.title)) {
    problems.push("title must be single-line (no newlines)");
  } else if (o.title.includes(";")) {
    problems.push("title must not contain ';' (Next-command block title rules)");
  } else if (/\b(?:Status|Blocked-by|Blocks):/i.test(o.title)) {
    // Review finding (BH-1/EC-2): the title lands in the backlog row BEFORE
    // the real `Status: ready. Blocked-by: …` markers, and parseDevMd's
    // marker regexes take the FIRST match — a title carrying one of these
    // markers would hijack the row's parsed status/blockers (a fresh row
    // reading as `done`, or phantom blockers).
    problems.push(
      "title must not contain 'Status:'/'Blocked-by:'/'Blocks:' (backlog row marker collision)",
    );
  } else {
    title = o.title.trim();
  }

  let goal: string | undefined;
  if (o.goal !== undefined) {
    if (typeof o.goal !== "string" || o.goal.trim() === "") {
      problems.push("goal, when present, must be a non-empty string");
    } else if (/[\n\r]/.test(o.goal)) {
      // Review finding (BH-5): a multi-line goal could inject markdown
      // headings (`## Status log`) into the follow-up body, derailing every
      // future status-log splice. Same single-line rule as the lists.
      problems.push("goal must be single-line (no newlines)");
    } else {
      goal = o.goal.trim();
    }
  }

  const remaining_acs = validateLineList(o.remaining_acs, "remaining_acs", problems);
  if (remaining_acs !== null && remaining_acs.length === 0) {
    problems.push("remaining_acs must be non-empty (an empty split has nothing to carry)");
  }

  let carried: SplitCarriedForward | null = null;
  if (!o.carried_forward || typeof o.carried_forward !== "object" || Array.isArray(o.carried_forward)) {
    problems.push(
      "carried_forward must be an object with state_to_trust, gotchas, do_not",
    );
  } else {
    const c = o.carried_forward as Record<string, unknown>;
    const state_to_trust = validateLineList(c.state_to_trust, "carried_forward.state_to_trust", problems);
    const gotchas = validateLineList(c.gotchas, "carried_forward.gotchas", problems);
    const do_not = validateLineList(c.do_not, "carried_forward.do_not", problems);
    if (state_to_trust !== null && gotchas !== null && do_not !== null) {
      carried = { state_to_trust, gotchas, do_not };
    }
  }

  let learnings: string[] | undefined;
  if (o.learnings !== undefined) {
    const parsed = validateLineList(o.learnings, "learnings", problems);
    if (parsed !== null) learnings = parsed;
  }

  if (problems.length > 0 || carried === null || remaining_acs === null) {
    throw new SplitError("payload", problems.join("; "));
  }
  return {
    title,
    ...(goal !== undefined ? { goal } : {}),
    remaining_acs,
    carried_forward: carried,
    ...(learnings !== undefined ? { learnings } : {}),
  };
}

/** A list of single-line non-empty strings (each becomes one markdown list
 *  row). Returns null after pushing a problem when the shape is wrong. */
function validateLineList(
  raw: unknown,
  field: string,
  problems: string[],
): string[] | null {
  if (!Array.isArray(raw)) {
    problems.push(`${field} must be an array of strings`);
    return null;
  }
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v: unknown = raw[i];
    if (typeof v !== "string" || v.trim() === "") {
      problems.push(`${field}[${i}] must be a non-empty string`);
      return null;
    }
    if (/[\n\r]/.test(v)) {
      problems.push(`${field}[${i}] must be single-line (one list row each)`);
      return null;
    }
    out.push(v.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// composeSplit (pure)
// ---------------------------------------------------------------------------

export interface ComposeSplitOpts {
  /** Parent spec: repo-relative path (`dev/dev-<hash>-<ts>-<slug>.md`) +
   *  full current content. Type + hash are parsed from the path. */
  parent: { path: string; content: string };
  /** Current backlog-file content (DEV.md for dev, DEBUG.md for debug). */
  backlog: string;
  payload: SplitPayload;
  shape: SplitShape;
  /** Fresh hash for the follow-up (caller mints via generateHash). */
  followUpHash: string;
  /** Timestamp source (compose is pure — the caller owns the clock). */
  now: Date;
  /** Follow-up `branch:` frontmatter value — merge-first: freshly derived
   *  for the follow-up's own hash; branch-handoff: the parent's WIP
   *  branch, inherited. */
  followUpBranch: string;
}

export interface ComposeSplitResult {
  /** Repo-relative follow-up spec path. */
  followUpSpecPath: string;
  followUpBody: string;
  /** Parent spec content after `spawned:` append + status-log line (+
   *  superseded patch on branch-handoff). */
  parentAfter: string;
  /** Backlog content after row splice (+ parent-row strike on
   *  branch-handoff). */
  backlogAfter: string;
  /** The spliced backlog row (verbatim, for the performSplit result). */
  devMdRow: string;
}

const SPEC_PATH_RE = /^([a-z]+)\/\1-([a-z0-9]{3,12})-\d{4}-[^/]*\.md$/i;

/**
 * Pure composer for both shapes. No I/O, no clock (caller passes `now`),
 * no hash generation. Throws SplitError("compose") when the parent
 * spec/backlog don't carry the expected structure.
 */
export function composeSplit(opts: ComposeSplitOpts): ComposeSplitResult {
  const pathMatch = SPEC_PATH_RE.exec(opts.parent.path);
  if (!pathMatch) {
    throw new SplitError(
      "compose",
      `parent path '${opts.parent.path}' does not match <type>/<type>-<hash>-<ts>-<slug>.md`,
    );
  }
  const type = pathMatch[1];
  const parentHash = pathMatch[2];
  if (!HASH_RE.test(opts.followUpHash)) {
    throw new SplitError(
      "compose",
      `invalid follow-up hash '${opts.followUpHash}'`,
    );
  }

  const { iso, filenameStamp } = formatTimestamps(opts.now);
  const slug = slugify(opts.payload.title);
  const followUpSpecPath = `${type}/${type}-${opts.followUpHash}-${filenameStamp}-${slug}.md`;

  const followUpBody = renderFollowUpSpec({
    type,
    parentPath: opts.parent.path,
    parentHash,
    payload: opts.payload,
    shape: opts.shape,
    followUpHash: opts.followUpHash,
    followUpBranch: opts.followUpBranch,
    iso,
  });

  // ---- Parent patches: spawned append + status-log line (+ superseded
  //      vocabulary on branch-handoff — reuse, zero parser changes).
  let parentAfter = appendSpawned(opts.parent.content, opts.followUpHash);
  if (opts.shape === "branch-handoff") {
    parentAfter = patchParentSuperseded(parentAfter, opts.followUpHash);
  }
  parentAfter = appendStatusLogLine(
    parentAfter,
    `- ${iso} — split (${opts.shape}): emitted follow-up ${opts.followUpHash} → \`${followUpSpecPath}\` via devx split`,
  );

  // ---- Backlog patches: strike-then-splice so the follow-up row lands
  //      directly after the (possibly struck) parent row.
  let backlogAfter = opts.backlog;
  if (opts.shape === "branch-handoff") {
    backlogAfter = strikeParentRow(backlogAfter, type, parentHash, opts.followUpHash);
  }
  const devMdRow =
    opts.shape === "merge-first"
      ? `- [ ] \`${followUpSpecPath}\` — ${opts.payload.title}. Status: ready. Blocked-by: ${parentHash}.`
      : `- [ ] \`${followUpSpecPath}\` — ${opts.payload.title}. Status: ready.`;
  try {
    backlogAfter = insertDevMdRow(backlogAfter, [parentHash], devMdRow, {
      type,
      anchor: "after-parent",
    });
  } catch (e) {
    throw new SplitError("compose", e instanceof Error ? e.message : String(e));
  }

  return { followUpSpecPath, followUpBody, parentAfter, backlogAfter, devMdRow };
}

interface RenderFollowUpOpts {
  type: string;
  parentPath: string;
  parentHash: string;
  payload: SplitPayload;
  shape: SplitShape;
  followUpHash: string;
  followUpBranch: string;
  iso: string;
}

function renderFollowUpSpec(o: RenderFollowUpOpts): string {
  const p = o.payload;
  const goal =
    p.goal ??
    `Continue ${o.parentHash}: remaining acceptance criteria split out by devx split (${o.shape}).`;
  // merge-first: blocked on the parent landing its reduced scope.
  // branch-handoff: parent is superseded; the follow-up starts ready.
  const blockedByLine =
    o.shape === "merge-first" ? `blocked_by: [${o.parentHash}]\n` : "blocked_by: []\n";

  // Payload AC text keeps its own numbering/wording; strip a leading
  // checkbox if the caller pasted rows verbatim, then re-emit uniformly.
  const acLines = p.remaining_acs
    .map((ac) => `- [ ] ${ac.replace(/^- \[[\sx/-]\]\s*/, "")}`)
    .join("\n");

  return `---
hash: ${o.followUpHash}
type: ${o.type}
created: ${o.iso}
title: "${p.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"
from: ${o.parentPath}
status: ready
${blockedByLine}branch: ${o.followUpBranch}
owner: null
---

## Goal

${goal}

## Acceptance criteria

${acLines}

## Carried forward

### State to trust

${renderList(p.carried_forward.state_to_trust)}

### Gotchas (save time — don't rediscover)

${renderList([...p.carried_forward.gotchas, ...(p.learnings ?? [])])}

### Do NOT

${renderList(p.carried_forward.do_not)}

## Status log

- ${o.iso} — created by devx split from \`${o.parentPath}\` (${o.shape})
`;
}

function renderList(items: string[]): string {
  if (items.length === 0) return "- (none)";
  return items.map((i) => `- ${i}`).join("\n");
}

/** Kebab-case slug from the follow-up title, ≤50 chars (spec convention). */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return slug === "" ? "follow-up" : slug;
}

/**
 * Append the follow-up hash to the parent's `spawned:` frontmatter list —
 * rewrite an existing flow list, or insert `spawned: [<hash>]` after the
 * `from:` line (falling back to after `title:`, then end of block).
 */
function appendSpawned(content: string, followUpHash: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) {
    throw new SplitError("compose", "parent spec missing frontmatter block");
  }
  const fmLines = fmMatch[1].split("\n");
  let spawnedIdx = -1;
  let fromIdx = -1;
  let titleIdx = -1;
  for (let i = 0; i < fmLines.length; i++) {
    if (/^spawned:/.test(fmLines[i])) spawnedIdx = i;
    if (/^from:/.test(fmLines[i])) fromIdx = i;
    if (/^title:/.test(fmLines[i])) titleIdx = i;
  }
  if (spawnedIdx !== -1) {
    // Flow list, with any trailing `# comment` preserved (review BH-6: the
    // old `]\s*$` anchor mangled `spawned: [a] # note` into nested lists).
    const listMatch = /^spawned:\s*\[([^\]]*)\]\s*(#.*)?$/.exec(
      fmLines[spawnedIdx],
    );
    if (listMatch) {
      const existing = listMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      const comment = listMatch[2] ? ` ${listMatch[2]}` : "";
      fmLines[spawnedIdx] = `spawned: [${[...existing, followUpHash].join(", ")}]${comment}`;
    } else {
      // Scalar, empty, or YAML block-list value. For a block list
      // (`spawned:` followed by `  - item` lines) the item lines must be
      // absorbed into the flow rewrite or they'd be orphaned as invalid
      // YAML under the rewritten key (review BH-6).
      const scalar = fmLines[spawnedIdx].replace(/^spawned:\s*/, "").trim();
      const entries = scalar === "" || scalar === "null" ? [] : [scalar];
      let blockEnd = spawnedIdx + 1;
      while (blockEnd < fmLines.length) {
        const itemMatch = /^\s+-\s+(\S.*)$/.exec(fmLines[blockEnd]);
        if (!itemMatch) break;
        entries.push(itemMatch[1].trim());
        blockEnd++;
      }
      fmLines.splice(
        spawnedIdx,
        blockEnd - spawnedIdx,
        `spawned: [${[...entries, followUpHash].join(", ")}]`,
      );
    }
  } else {
    const insertAfter = fromIdx !== -1 ? fromIdx : titleIdx !== -1 ? titleIdx : fmLines.length - 1;
    fmLines.splice(insertAfter + 1, 0, `spawned: [${followUpHash}]`);
  }
  const before = content.slice(0, fmMatch.index);
  const after = content.slice(fmMatch.index + fmMatch[0].length);
  return `${before}---\n${fmLines.join("\n")}\n---${after}`;
}

/** branch-handoff parent terminal patch: `status: superseded`,
 *  `superseded_by: <hash>` (workstream lineage vocabulary at dev-spec
 *  level), `owner:` cleared. */
function patchParentSuperseded(content: string, followUpHash: string): string {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) {
    throw new SplitError("compose", "parent spec missing frontmatter block");
  }
  const fmLines = fmMatch[1].split("\n");
  let statusIdx = -1;
  let supersededIdx = -1;
  for (let i = 0; i < fmLines.length; i++) {
    if (/^status:/.test(fmLines[i])) statusIdx = i;
    if (/^superseded_by:/.test(fmLines[i])) supersededIdx = i;
    if (/^owner:/.test(fmLines[i])) fmLines[i] = "owner: null";
  }
  if (statusIdx === -1) {
    throw new SplitError("compose", "parent spec frontmatter missing `status:` line");
  }
  fmLines[statusIdx] = "status: superseded";
  if (supersededIdx !== -1) {
    fmLines[supersededIdx] = `superseded_by: ${followUpHash}`;
  } else {
    fmLines.splice(statusIdx + 1, 0, `superseded_by: ${followUpHash}`);
  }
  const before = content.slice(0, fmMatch.index);
  const after = content.slice(fmMatch.index + fmMatch[0].length);
  return `${before}---\n${fmLines.join("\n")}\n---${after}`;
}

/**
 * Append one line to the spec's `## Status log` section (append-only per
 * CLAUDE.md). Same section-bounds logic as claim's updateSpecForClaim —
 * that helper fuses the claim frontmatter patch with its log line, so the
 * section splice is re-stated here for the split's own line.
 */
function appendStatusLogLine(content: string, logLine: string): string {
  // `(?:\n|$)` (not bare `\n`) so a spec whose LAST line is the heading
  // with no trailing newline still matches — the old shape appended a
  // duplicate `## Status log` section there (review EC-4).
  const slMatch = /^## Status log[ \t]*(?:\n|$)/m.exec(content);
  if (!slMatch) {
    const tail = content.endsWith("\n") ? "" : "\n";
    return `${content}${tail}\n## Status log\n\n${logLine}\n`;
  }
  const slStart = slMatch.index + slMatch[0].length;
  let slEnd = content.length;
  const nextHeading = /^## /m.exec(content.slice(slStart));
  if (nextHeading) {
    slEnd = slStart + nextHeading.index;
  }
  const sectionBody = content.slice(slStart, slEnd).replace(/\s+$/, "");
  const trailer = slEnd < content.length ? "\n\n" : "\n";
  return (
    content.slice(0, slStart) + `${sectionBody}\n${logLine}${trailer}` + content.slice(slEnd)
  );
}

/**
 * Rewrite the parent's backlog row struck: checkbox retained, content
 * wrapped `~~…~~`, `superseded by <hash>` appended. parseDevMd classifies
 * the result `struck: true` + `status: "superseded"` with zero parser
 * changes (the /superseded/i struck-row path).
 */
function strikeParentRow(
  backlog: string,
  type: string,
  parentHash: string,
  followUpHash: string,
): string {
  const probeRe = new RegExp(
    `^- (\\[[\\sx/-]\\]\\s+)?\`${escapeRegex(type)}/${escapeRegex(type)}-${escapeRegex(parentHash)}-\\d`,
  );
  const lines = backlog.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = probeRe.exec(lines[i]);
    if (m) {
      const prefixLen = 2 + (m[1]?.length ?? 0); // "- " + optional "[x] "
      const prefix = lines[i].slice(0, prefixLen);
      const body = lines[i].slice(prefixLen).replace(/\s+$/, "");
      lines[i] = `${prefix}~~${body}~~ superseded by ${followUpHash}.`;
      return lines.join("\n");
    }
  }
  throw new SplitError(
    "compose",
    `no backlog row found for parent hash '${parentHash}' (type '${type}') to strike`,
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// writeSplitAtomically
// ---------------------------------------------------------------------------

export interface WriteSplitOpts {
  repoRoot: string;
  /** Absolute path to the parent spec file. */
  parentSpecAbs: string;
  /** Absolute path to the backlog file (DEV.md / DEBUG.md). */
  backlogAbs: string;
  fs?: Partial<ClaimFs>;
}

/**
 * Commit the composed split to disk with the claim rollback posture
 * (claim.ts capture-originals / restore-on-partial — NOT the retro
 * partial-commit posture; E-1 demands 0 changed bytes on failure):
 * write `.tmp.<tag>` siblings, capture originals, rename in fixed order
 * follow-up spec → parent spec → backlog, restore every landed rename on
 * any failure, unlink leftover tmps.
 *
 * MUST run inside the caller's backlog-lock hold (sync body) —
 * performSplit owns that; direct callers (tests) own their own locking.
 */
export function writeSplitAtomically(
  composed: ComposeSplitResult,
  opts: WriteSplitOpts,
): void {
  const fs: ClaimFs = { ...realFs, ...(opts.fs ?? {}) };
  const followUpAbs = join(opts.repoRoot, composed.followUpSpecPath);
  if (fs.exists(followUpAbs)) {
    throw new SplitError(
      "write-tmp",
      `refusing to overwrite existing spec at ${followUpAbs}`,
    );
  }

  const tag = `${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}`;
  const followUpTmp = `${followUpAbs}.tmp.${tag}`;
  const parentTmp = `${opts.parentSpecAbs}.tmp.${tag}`;
  const backlogTmp = `${opts.backlogAbs}.tmp.${tag}`;

  const tmpsWritten: string[] = [];
  try {
    fs.writeFile(followUpTmp, composed.followUpBody);
    tmpsWritten.push(followUpTmp);
    fs.writeFile(parentTmp, composed.parentAfter);
    tmpsWritten.push(parentTmp);
    fs.writeFile(backlogTmp, composed.backlogAfter);
    tmpsWritten.push(backlogTmp);
  } catch (e) {
    for (const t of tmpsWritten) fs.unlink(t);
    throw new SplitError("write-tmp", errMessage(e));
  }

  // Capture pre-rename content so failures restore byte-identical state.
  // The follow-up is a NEW file — its "original" is absence (restore =
  // unlink).
  let parentOriginal: string;
  let backlogOriginal: string;
  try {
    parentOriginal = fs.readFile(opts.parentSpecAbs);
    backlogOriginal = fs.readFile(opts.backlogAbs);
  } catch (e) {
    for (const t of tmpsWritten) fs.unlink(t);
    throw new SplitError("read-pre-rename", errMessage(e));
  }

  const renamePlan: Array<{
    tmp: string;
    dest: string;
    /** null = new file; restore by unlinking the dest. */
    original: string | null;
  }> = [
    { tmp: followUpTmp, dest: followUpAbs, original: null },
    { tmp: parentTmp, dest: opts.parentSpecAbs, original: parentOriginal },
    { tmp: backlogTmp, dest: opts.backlogAbs, original: backlogOriginal },
  ];
  const renamesDone: Array<{ dest: string; original: string | null }> = [];
  try {
    for (const step of renamePlan) {
      fs.rename(step.tmp, step.dest);
      renamesDone.push({ dest: step.dest, original: step.original });
    }
  } catch (e) {
    for (const done of renamesDone) {
      try {
        if (done.original === null) {
          fs.unlink(done.dest);
        } else {
          fs.writeFile(done.dest, done.original);
        }
      } catch {
        /* best-effort: operator can recover from git index */
      }
    }
    const renamedDests = new Set(renamesDone.map((r) => r.dest));
    for (const step of renamePlan) {
      if (!renamedDests.has(step.dest)) fs.unlink(step.tmp);
    }
    throw new SplitError("rename", errMessage(e));
  }
}

// ---------------------------------------------------------------------------
// performSplit
// ---------------------------------------------------------------------------

export interface PerformSplitOpts {
  /** The session token that claimed the parent — ALWAYS explicit, never
   *  auto-derived (design § Interfaces: auto-derive would always mismatch
   *  and split must never guess). Raw sessionId or `/devx-<sid>` shape. */
  sessionToken: string;
  repoRoot: string;
  /** For deriveBranch on the merge-first follow-up branch. */
  config: DeriveBranchConfig;
  payload: SplitPayload;
  /** Default: "merge-first". */
  shape?: SplitShape;
  /** Parent spec type (default "dev"). The follow-up always inherits it. */
  type?: string;
  /** Parent WIP branch override for the branch-handoff shape — for callers
   *  that know the claim's branch authoritatively (the loop driver, whose
   *  claim derived it; loop-claimed specs may lack `branch:` frontmatter
   *  because claimSpec never writes one). Defaults to the parent spec's
   *  `branch:` frontmatter. Ignored by merge-first (which derives a fresh
   *  branch for the follow-up's own hash). */
  branch?: string;
  /** Test seam — partial fs override (real fs for unspecified keys). */
  fs?: Partial<ClaimFs>;
  /** Test seam — defaults to wall-clock. */
  now?: () => Date;
  /** Test seam — replaces the cross-process backlog lock. */
  lock?: BacklogLockFn;
}

export interface PerformSplitResult {
  followUpHash: string;
  /** Repo-relative follow-up spec path. */
  followUpSpecPath: string;
  /** The spliced backlog row (verbatim). */
  devMdRow: string;
  shape: SplitShape;
}

const BACKLOG_BY_TYPE: Record<ClaimableType, string> = {
  dev: "DEV.md",
  debug: "DEBUG.md",
};

/**
 * Orchestrate a split: ownership guard → fresh hash → compose → locked
 * atomic write. Throws SplitOwnershipError (CLI exit 3) when the caller
 * doesn't hold the parent's spec lock, BacklogLockTimeoutError (exit 1)
 * on backlog-lock contention, SplitError (exit 2) otherwise.
 *
 * Does NOT release the parent's spec lock — see file header.
 */
export function performSplit(
  hash: string,
  opts: PerformSplitOpts,
): PerformSplitResult {
  if (!HASH_RE.test(hash)) {
    throw new SplitError(
      "validate",
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  if (!opts.repoRoot) {
    throw new SplitError("validate", "repoRoot is required");
  }
  const sessionToken = normalizeSessionToken(opts.sessionToken ?? "");
  if (sessionToken === "") {
    throw new SplitError(
      "validate",
      "sessionToken must be non-empty after normalization",
    );
  }
  const shape: SplitShape = opts.shape ?? "merge-first";
  if (shape !== "merge-first" && shape !== "branch-handoff") {
    throw new SplitError("validate", `invalid shape '${String(shape)}'`);
  }
  const type = opts.type ?? "dev";
  if (!(CLAIMABLE_TYPES as readonly string[]).includes(type)) {
    throw new SplitError(
      "validate",
      `unsplittable spec type '${type}' (expected one of: ${CLAIMABLE_TYPES.join(", ")})`,
    );
  }
  const payload = validateSplitPayload(opts.payload);
  const fs: ClaimFs = { ...realFs, ...(opts.fs ?? {}) };
  const now = (opts.now ?? (() => new Date()))();

  const backlogLock: BacklogLockFn =
    opts.lock ??
    ((label, fn) => withBacklogLock(join(opts.repoRoot, ".devx-cache"), label, fn));

  return backlogLock(`split-${hash}`, (): PerformSplitResult => {
    // ---- Ownership guard (inside the lock hold, so the verdict can't
    //      race a peer's release/re-claim). roc101 posture: no lock =
    //      not yours; token mismatch = a live peer's item — refuse.
    const lockPath = specLockPath(opts.repoRoot, hash);
    if (!fs.exists(lockPath)) {
      throw new SplitOwnershipError(hash, null, sessionToken);
    }
    let lockOwner: string | null;
    try {
      lockOwner = specLockOwner(fs.readFile(lockPath));
    } catch (e) {
      throw new SplitError("validate", `lock read failed: ${errMessage(e)}`);
    }
    if (lockOwner === null) {
      // Lock file exists but carries no attributable owner (empty /
      // mid-write body) — refuse with the lock-exists message shape.
      throw new SplitOwnershipError(hash, null, sessionToken, true);
    }
    if (normalizeSessionToken(lockOwner) !== sessionToken) {
      throw new SplitOwnershipError(hash, lockOwner, sessionToken, true);
    }

    // ---- Resolve parent + backlog.
    const parentSpecAbs = findSpecForHash(fs, opts.repoRoot, hash, type);
    if (!parentSpecAbs) {
      throw new SplitError(
        "resolve",
        `no spec file found at ${join(opts.repoRoot, type)}/${type}-${hash}-*.md`,
      );
    }
    const backlogAbs = join(opts.repoRoot, BACKLOG_BY_TYPE[type as ClaimableType]);
    if (!fs.exists(backlogAbs)) {
      throw new SplitError("resolve", `backlog file not found at ${backlogAbs}`);
    }
    let parentContent: string;
    let backlogContent: string;
    try {
      parentContent = fs.readFile(parentSpecAbs);
      backlogContent = fs.readFile(backlogAbs);
    } catch (e) {
      throw new SplitError("resolve", errMessage(e));
    }

    // ---- Branch fields: merge-first derives a fresh branch for the
    //      follow-up's own hash; branch-handoff inherits the parent's WIP
    //      branch (recording it is the whole point — FR-4).
    const followUpHash = generateHash(fs, opts.repoRoot);
    let followUpBranch: string;
    if (shape === "merge-first") {
      followUpBranch = deriveBranch(opts.config, type, followUpHash);
    } else {
      const override = opts.branch?.trim();
      const parentBranch =
        override !== undefined && override !== ""
          ? override
          : parseFrontmatterBranch(parentContent);
      if (parentBranch === null) {
        throw new SplitError(
          "compose",
          `parent spec has no \`branch:\` frontmatter — branch-handoff needs the recorded WIP branch`,
        );
      }
      followUpBranch = parentBranch;
    }

    const parentRel = relativeSpecPath(parentSpecAbs, type);
    const composed = composeSplit({
      parent: { path: parentRel, content: parentContent },
      backlog: backlogContent,
      payload,
      shape,
      followUpHash,
      now,
      followUpBranch,
    });

    writeSplitAtomically(composed, {
      repoRoot: opts.repoRoot,
      parentSpecAbs,
      backlogAbs,
      fs,
    });

    return {
      followUpHash,
      followUpSpecPath: composed.followUpSpecPath,
      devMdRow: composed.devMdRow,
      shape,
    };
  });
}

/** Parse the parent's `branch:` frontmatter value (null when absent/empty). */
export function parseFrontmatterBranch(content: string): string | null {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return null;
  for (const line of fmMatch[1].split("\n")) {
    const m = /^branch:\s*(.*)$/.exec(line);
    if (m) {
      const v = m[1].trim();
      return v === "" || v === "null" ? null : v;
    }
  }
  return null;
}

/** Repo-relative `<type>/<basename>` from the resolved absolute path —
 *  findSpecForHash returns `<repoRoot>/<type>/<name>.md`, so the basename
 *  plus the known type dir reconstructs the repo-relative shape without
 *  path.relative (which misbehaves on fake-fs pseudo-roots like `/repo`). */
function relativeSpecPath(specAbs: string, type: string): string {
  const base = specAbs.slice(specAbs.lastIndexOf("/") + 1);
  return `${type}/${base}`;
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
