// Failure-mode handling for `/devx-init` (ini506).
//
// Three Phase-0 failure surfaces — every one degrades to local-setup-still-
// usable + 1 MANUAL.md entry + an `init_partial: true` flag at the top of
// devx.config.yaml. Modes ≥ BETA refuse-to-spawn dev work while the flag is
// up. The user's recovery path is `devx init --resume-gh` (src/commands/init.ts)
// which replays the queued ops and clears the flag once everything succeeds.
//
// Public surface:
//   - setInitPartial / readInitPartial — top-level flag round-trip.
//   - assertNotPartial(opts) — guard imported by every dev command (Phase 1
//     /devx-plan / /devx wire this in; the function is exported now so the
//     contract is locked).
//   - handleBmadInstallFailure(opts) — captures exit/stderr; offers
//     `[r]etry / [s]kip / [a]bort` via injected prompt; on skip writes
//     `bmad.modules: []` + appends a MANUAL entry; on abort throws
//     InitAbortedError; on retry returns the decision so the orchestrator
//     can re-invoke its installer.
//   - handleGhNotAuth(opts) — appends the gh-not-auth MANUAL entry. The
//     queueing of deferred ops is already done by init-gh.ts (ini503) when
//     `ghAuthOk === false`; this handler exists so the orchestrator has one
//     entry-point that handles the flag + MANUAL bookkeeping symmetrically
//     across all three failure modes.
//   - handleNoRemote(opts) — forces `promotion.gate: manual-only` (regardless
//     of mode), appends a MANUAL entry. The init-gh.ts no-remote path already
//     queued the workflow-push + branch + protection ops to
//     `.devx-cache/pending-gh-ops.json`.
//   - replayPendingGhOps(opts) — reads the queue, replays each op against
//     `gh` + `git`, returns per-op success/failure. The src/commands/init.ts
//     `--resume-gh` entrypoint owns the "clear flag iff all-green" decision —
//     this function is purely transactional + idempotent so it can be re-run.
//   - PendingGhOpsCorruptError — surfaced by replay when the queue file is
//     unparseable (per ini506 AC: "corrupt pending-gh-ops.json → abort with
//     clear error").
//
// All MANUAL writes are idempotent: re-running /devx-init with the same
// failure mode does NOT duplicate entries. We detect by the per-kind anchor
// `<!-- devx:init-failure:<kind> -->` we inject inside each entry; if the
// anchor is already on disk, we skip the append.
//
// Spec: dev/dev-ini506-2026-04-26T19:35-init-failure-modes.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Document, parseDocument } from "yaml";

import type {
  GhExec,
  ManualEntry,
  ManualEntryKind,
  PendingGhOp,
  PendingGhOpsFile,
  ProtectionPutPayload,
} from "./init-gh.js";
import { defaultGhExec, resolveRepoSlug } from "./init-gh.js";
import type { GitExec } from "./init-state.js";
import { defaultGitExec } from "./init-state.js";
import { setLeaf } from "./config-io.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Mode = "YOLO" | "BETA" | "PROD" | "LOCKDOWN";

/** Modes for which assertNotPartial throws. YOLO intentionally allows work
 *  to continue even with deferred init — pre-launch dogfood eats its own
 *  partial state. BETA and above refuse-to-spawn until the flag is cleared. */
export const PARTIAL_BLOCKING_MODES: ReadonlySet<Mode> = new Set(["BETA", "PROD", "LOCKDOWN"]);

export class InitPartialError extends Error {
  constructor(public readonly mode: Mode, public readonly configPath: string) {
    super(
      `devx: init.partial is true in mode ${mode}; refuse-to-spawn until you run ` +
        `\`devx init --resume-gh\` (or hand-clear init_partial in ${configPath}).`,
    );
    this.name = "InitPartialError";
  }
}

export class InitAbortedError extends Error {
  constructor(reason: string) {
    super(`devx-init aborted: ${reason}`);
    this.name = "InitAbortedError";
  }
}

export class PendingGhOpsCorruptError extends Error {
  constructor(public readonly path: string, cause: string) {
    super(
      `devx init --resume-gh: ${path} is unparseable (${cause}). ` +
        `Hand-fix the JSON or delete the file to abandon the queued work.`,
    );
    this.name = "PendingGhOpsCorruptError";
  }
}

// ---------- BMAD-install ---------------------------------------------------

export type BmadDecision = "retry" | "skip" | "abort";

export type BmadPrompt = (opts: {
  exitCode: number;
  stderr: string;
  attempts: number;
}) => BmadDecision | Promise<BmadDecision>;

export interface BmadFailureOpts {
  repoRoot: string;
  exitCode: number;
  stderr: string;
  /** 1-indexed retry counter. Caller bumps before re-invoking. */
  attempts: number;
  prompt: BmadPrompt;
  /** Override config path for tests. */
  configPath?: string;
  /** Override MANUAL.md path for tests. */
  manualPath?: string;
  /** Override timestamp on the MANUAL entry header. */
  now?: () => Date;
}

export interface BmadFailureOutcome {
  decision: BmadDecision;
  /** True iff `bmad.modules: []` was written + init_partial flipped true. Only
   *  set on `skip`. */
  wroteSkipState: boolean;
  /** Truncated stderr we recorded into the MANUAL entry — useful for tests. */
  recordedStderr: string;
}

// ---------- gh-not-auth + no-remote ----------------------------------------

export interface GhNotAuthOpts {
  repoRoot: string;
  /** The MANUAL entry shape returned by init-gh.ts (already constructed there
   *  so the body wording is centralized). */
  manualEntry: ManualEntry;
  configPath?: string;
  manualPath?: string;
  now?: () => Date;
}

export interface GhNotAuthOutcome {
  manualAppended: boolean;
  flagFlipped: boolean;
}

export interface NoRemoteOpts {
  repoRoot: string;
  manualEntry: ManualEntry;
  configPath?: string;
  manualPath?: string;
  now?: () => Date;
}

export interface NoRemoteOutcome {
  manualAppended: boolean;
  flagFlipped: boolean;
  promotionGateForced: boolean;
}

// ---------- replay ---------------------------------------------------------

export type ReplayOpKind = PendingGhOp["kind"];

export interface ReplayOpResult {
  kind: ReplayOpKind;
  success: boolean;
  /** Short human-readable note for the per-op log line. */
  note: string;
}

export interface ReplayResult {
  /** All ops that were in the queue at the start of the replay. */
  attempted: number;
  /** Per-op outcomes in the order the queue stored them. */
  results: ReplayOpResult[];
  /** True iff every op succeeded. The caller should clear init_partial only
   *  when this is true (and remove the queue file for cleanliness). */
  allSucceeded: boolean;
  /** Ops that did NOT succeed. Caller writes these back to the queue so the
   *  next `--resume-gh` picks up where this run left off. */
  remaining: PendingGhOp[];
}

export interface ReplayOpts {
  repoRoot: string;
  /** Override pending-gh-ops.json path (defaults to .devx-cache/...). */
  pendingPath?: string;
  /** Injectable gh CLI for tests. */
  gh?: GhExec;
  /** Injectable git CLI for tests. */
  git?: GitExec;
  /** Override the default-branch read; the queued payloads sometimes don't
   *  carry it. */
  defaultBranch?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MANUAL_ANCHOR_PREFIX = "<!-- devx:init-failure:";
const MANUAL_ANCHOR_SUFFIX = " -->";
const MANUAL_HEADER_LINE = "## /devx-init deferred work";
const PENDING_OPS_RELATIVE = ".devx-cache/pending-gh-ops.json";

// ---------------------------------------------------------------------------
// Flag round-trip
// ---------------------------------------------------------------------------

interface ConfigPathOpts {
  repoRoot: string;
  configPath?: string;
}

function resolveConfigPath(opts: ConfigPathOpts): string {
  return opts.configPath ?? join(opts.repoRoot, "devx.config.yaml");
}

function resolveManualPath(opts: { repoRoot: string; manualPath?: string }): string {
  return opts.manualPath ?? join(opts.repoRoot, "MANUAL.md");
}

function resolvePendingPath(opts: { repoRoot: string; pendingPath?: string }): string {
  return opts.pendingPath ?? join(opts.repoRoot, PENDING_OPS_RELATIVE);
}

/** Read the top-level `init_partial:` boolean. Returns false if the file or
 *  the key is absent — absence is the success state. */
export function readInitPartial(opts: ConfigPathOpts): boolean {
  const path = resolveConfigPath(opts);
  if (!existsSync(path)) return false;
  try {
    const doc = parseDocument(readFileSync(path, "utf8"));
    const v = doc.get("init_partial");
    return v === true;
  } catch {
    // Corrupt YAML → treat as not-partial; the corrupt-config halt is the
    // detection-side concern (init-state.ts), not init-failure's job.
    return false;
  }
}

/** Set the top-level `init_partial:` flag. cfg202's setLeaf round-trips
 *  comments + key order; for the "key didn't exist" case it appends at end
 *  of map (eemeli/yaml's setIn semantics) which is fine — `init_partial`
 *  is intentionally near-the-top documentation in the schema's narrative
 *  order, not strictly first in render order. */
export function setInitPartial(opts: ConfigPathOpts & { partial: boolean }): void {
  const path = resolveConfigPath(opts);
  if (!existsSync(path)) {
    // No config to flag yet — nothing to do. Caller (init orchestrator) wrote
    // the config first; if they didn't, surface clearly rather than silently
    // creating a half-config from this call.
    throw new Error(
      `setInitPartial: ${path} does not exist; init-write must run before flag flips`,
    );
  }
  setLeaf(["init_partial"], opts.partial, "project", { projectPath: path });
}

/** Read mode + init_partial; throw if the flag is up AND mode ∈ ≥ BETA.
 *  YOLO continues to run with deferred init by design. */
export function assertNotPartial(opts: ConfigPathOpts): void {
  const path = resolveConfigPath(opts);
  if (!existsSync(path)) return;
  let doc: Document;
  try {
    doc = parseDocument(readFileSync(path, "utf8"));
  } catch {
    // Corrupt config is its own failure mode (handled at init time); not our
    // job to also block on it here. Let downstream surface it.
    return;
  }
  if (doc.get("init_partial") !== true) return;
  const mode = doc.get("mode");
  if (typeof mode !== "string") return;
  const m = mode as Mode;
  if (PARTIAL_BLOCKING_MODES.has(m)) {
    throw new InitPartialError(m, path);
  }
}

// ---------------------------------------------------------------------------
// MANUAL.md append (idempotent per kind)
// ---------------------------------------------------------------------------

interface AppendManualOpts {
  manualPath: string;
  kind: string;
  /** Single-line title (becomes the bullet's bold header). */
  title: string;
  /** Multi-line body. Each line is indented under the bullet. */
  body: string;
  now: Date;
}

interface AppendManualOutcome {
  appended: boolean;
}

function anchorFor(kind: string): string {
  return `${MANUAL_ANCHOR_PREFIX}${kind}${MANUAL_ANCHOR_SUFFIX}`;
}

/** Append a single bullet to MANUAL.md under a "## /devx-init deferred work"
 *  section. If a bullet for this kind is already present (detected via the
 *  per-kind anchor comment), do nothing. */
function appendManualEntry(opts: AppendManualOpts): AppendManualOutcome {
  const anchor = anchorFor(opts.kind);

  let existing = "";
  if (existsSync(opts.manualPath)) {
    existing = readFileSync(opts.manualPath, "utf8");
    if (existing.includes(anchor)) {
      return { appended: false };
    }
  }

  const ts = opts.now.toISOString();
  const indentedBody = opts.body
    .split("\n")
    .map((line) => (line.length > 0 ? `  ${line}` : "  "))
    .join("\n");

  const bullet = [
    `- [ ] **devx-init: ${opts.kind}** — ${opts.title}`,
    indentedBody,
    `  Filed: ${ts}  ${anchor}`,
    "",
  ].join("\n");

  let next: string;
  if (existing.length === 0) {
    next = `# MANUAL — Actions only the user can do\n\n${MANUAL_HEADER_LINE}\n\n${bullet}`;
  } else if (existing.includes(MANUAL_HEADER_LINE)) {
    // Append the bullet under the existing section. We append at end-of-file
    // rather than under the section header so we don't have to splice into
    // the middle (which risks reflow of user content). New entries cluster
    // at the bottom, matching how DEV.md / DEBUG.md grow.
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    next = `${existing}${sep}${bullet}`;
  } else {
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    next = `${existing}${sep}${MANUAL_HEADER_LINE}\n\n${bullet}`;
  }

  writeAtomic(opts.manualPath, next);
  return { appended: true };
}

// ---------------------------------------------------------------------------
// BMAD-install failure
// ---------------------------------------------------------------------------

const BMAD_STDERR_TRUNCATE = 800;

export async function handleBmadInstallFailure(
  opts: BmadFailureOpts,
): Promise<BmadFailureOutcome> {
  const decision = await opts.prompt({
    exitCode: opts.exitCode,
    stderr: opts.stderr,
    attempts: opts.attempts,
  });

  if (decision === "retry") {
    return { decision, wroteSkipState: false, recordedStderr: "" };
  }
  if (decision === "abort") {
    throw new InitAbortedError(
      `BMAD install failed (exit ${opts.exitCode}); user chose abort after ${opts.attempts} attempt(s)`,
    );
  }

  // decision === "skip" — write bmad.modules: [], flip init_partial, append MANUAL.
  const configPath = resolveConfigPath(opts);
  const manualPath = resolveManualPath(opts);
  const now = (opts.now ?? (() => new Date()))();

  const recordedStderr = truncateStderr(opts.stderr);
  writeBmadModulesEmpty(configPath);
  setInitPartial({ ...opts, partial: true });
  appendManualEntry({
    manualPath,
    kind: "bmad-install-failed",
    title: `BMAD install failed (exit ${opts.exitCode}) — modules deferred`,
    body: bmadSkipManualBody(opts.exitCode, recordedStderr),
    now,
  });

  return { decision, wroteSkipState: true, recordedStderr };
}

function truncateStderr(s: string): string {
  const cleaned = s.trim();
  if (cleaned.length <= BMAD_STDERR_TRUNCATE) return cleaned;
  return `${cleaned.slice(0, BMAD_STDERR_TRUNCATE)}… (truncated)`;
}

function bmadSkipManualBody(exitCode: number, stderr: string): string {
  // Pick a fence that doesn't appear in stderr so a captured npm error that
  // happens to contain literal ``` doesn't escape the code block and break
  // MANUAL.md's markdown rendering. Backtick-only escalation (3 → 4 → 5).
  const fence = pickFence(stderr);
  return [
    `BMAD installation failed and was skipped during \`/devx-init\`.`,
    `\`bmad.modules\` is now \`[]\`; devx commands that need a BMAD workflow`,
    `(e.g. \`/devx-plan\`'s \`bmad-create-prd\`, \`/devx\`'s \`bmad-create-story\`)`,
    `will refuse to run until BMAD is reinstalled.`,
    "",
    "Recovery:",
    "  1. Investigate the failure (stderr captured below).",
    "  2. Re-run `npx bmad-method install` manually.",
    "  3. Re-run `/devx-init` (it detects the existing config and finishes",
    "     the BMAD step in upgrade mode).",
    "",
    `Exit code: ${exitCode}`,
    stderr.length > 0 ? `stderr:\n${fence}\n${stderr}\n${fence}` : "stderr: (empty)",
  ].join("\n");
}

function pickFence(content: string): string {
  let fence = "```";
  while (content.includes(fence)) fence += "`";
  return fence;
}

/** Write bmad.modules: [] without going through cfg202's setLeaf (which
 *  would reject the existing array node). Goes straight to the YAML doc. */
function writeBmadModulesEmpty(configPath: string): void {
  const raw = readFileSync(configPath, "utf8");
  const doc = parseDocument(raw);
  doc.setIn(["bmad", "modules"], []);
  writeAtomic(configPath, doc.toString());
}

// ---------------------------------------------------------------------------
// gh-not-auth
// ---------------------------------------------------------------------------

export function handleGhNotAuth(opts: GhNotAuthOpts): GhNotAuthOutcome {
  const manualPath = resolveManualPath(opts);
  const now = (opts.now ?? (() => new Date()))();

  const append = appendManualEntry({
    manualPath,
    kind: opts.manualEntry.kind,
    title: titleForGhFailure(opts.manualEntry.kind),
    body: opts.manualEntry.body,
    now,
  });

  setInitPartial({ ...opts, partial: true });

  return { manualAppended: append.appended, flagFlipped: true };
}

function titleForGhFailure(kind: ManualEntryKind): string {
  switch (kind) {
    case "no-remote":
      return "GitHub-side scaffolding deferred — no `origin` remote";
    case "gh-not-authenticated":
      return "GitHub-side scaffolding deferred — `gh` is not authenticated";
    case "gh-missing-scopes":
      return "Branch protection deferred — `gh` token missing scopes";
    case "private-free-tier":
      return "Branch protection deferred — free-tier private repo";
  }
}

// ---------------------------------------------------------------------------
// No-remote
// ---------------------------------------------------------------------------

export function handleNoRemote(opts: NoRemoteOpts): NoRemoteOutcome {
  const configPath = resolveConfigPath(opts);
  const manualPath = resolveManualPath(opts);
  const now = (opts.now ?? (() => new Date()))();

  // Force the promotion gate to manual-only regardless of mode. Without a
  // remote there's nothing automated to promote against, so any other gate
  // would silently auto-pass. The user can flip back manually after they
  // add a remote (or rely on `devx init --resume-gh` which clears the flag
  // but does NOT touch promotion.gate — promotion is a separate axis).
  setLeaf(["promotion", "gate"], "manual-only", "project", {
    projectPath: configPath,
  });

  const append = appendManualEntry({
    manualPath,
    kind: opts.manualEntry.kind,
    title: titleForGhFailure(opts.manualEntry.kind),
    body: opts.manualEntry.body,
    now,
  });

  setInitPartial({ ...opts, partial: true });

  return {
    manualAppended: append.appended,
    flagFlipped: true,
    promotionGateForced: true,
  };
}

// ---------------------------------------------------------------------------
// Resume-gh replay
// ---------------------------------------------------------------------------

export function replayPendingGhOps(opts: ReplayOpts): ReplayResult {
  const path = resolvePendingPath(opts);
  if (!existsSync(path)) {
    return { attempted: 0, results: [], allSucceeded: true, remaining: [] };
  }

  const raw = readFileSync(path, "utf8");
  let parsed: PendingGhOpsFile;
  try {
    parsed = JSON.parse(raw) as PendingGhOpsFile;
  } catch (err) {
    throw new PendingGhOpsCorruptError(
      path,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray(parsed.ops)) {
    throw new PendingGhOpsCorruptError(
      path,
      `expected {version,created,ops:[]}, got ${describeShape(parsed)}`,
    );
  }

  const gh = opts.gh ?? defaultGhExec(opts.repoRoot);
  const git = opts.git ?? defaultGitExec;
  const slug = resolveRepoSlug(git, opts.repoRoot);
  const defaultBranch = opts.defaultBranch ?? readDefaultBranch(git, opts.repoRoot);

  const results: ReplayOpResult[] = [];
  const remaining: PendingGhOp[] = [];

  for (const op of parsed.ops) {
    if (!isPendingOp(op)) {
      results.push({
        kind: "apply-branch-protection", // best-effort label; queue is malformed
        success: false,
        note: "skipped — malformed op entry",
      });
      // Drop malformed entries from the queue rewrite — they would fail forever.
      continue;
    }
    const r = replayOne({ op, gh, git, repoRoot: opts.repoRoot, slug, defaultBranch });
    results.push(r);
    if (!r.success) remaining.push(op);
  }

  const allSucceeded = remaining.length === 0;
  return { attempted: parsed.ops.length, results, allSucceeded, remaining };
}

/** Re-write the queue file with only the ops that didn't succeed. When
 *  `remaining` is empty, leaves an empty-ops file in place (so a watcher
 *  on `.devx-cache/` still observes the state change). Preserves the
 *  original `created:` timestamp so post-mortem readers can see when the
 *  batch was first queued, not when the latest replay happened. */
export function writeRemainingPendingOps(opts: {
  repoRoot: string;
  pendingPath?: string;
  remaining: PendingGhOp[];
  now?: () => Date;
}): void {
  const path = resolvePendingPath(opts);
  const created = readQueueCreated(path) ?? (opts.now ?? (() => new Date()))().toISOString();

  if (opts.remaining.length === 0) {
    if (existsSync(path)) {
      const cleared: PendingGhOpsFile = { version: 1, created, ops: [] };
      writeAtomic(path, JSON.stringify(cleared, null, 2) + "\n");
    }
    return;
  }
  const next: PendingGhOpsFile = { version: 1, created, ops: opts.remaining };
  writeAtomic(path, JSON.stringify(next, null, 2) + "\n");
}

function readQueueCreated(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PendingGhOpsFile>;
    return typeof parsed.created === "string" ? parsed.created : null;
  } catch {
    return null;
  }
}

interface ReplayOneOpts {
  op: PendingGhOp;
  gh: GhExec;
  git: GitExec;
  repoRoot: string;
  slug: string | null;
  defaultBranch: string;
}

function replayOne(opts: ReplayOneOpts): ReplayOpResult {
  const { op, gh, git, slug, defaultBranch, repoRoot } = opts;
  const opSlug = resolveOpSlug(op, slug);

  switch (op.kind) {
    case "create-develop-branch": {
      if (opSlug === null) return failNoSlug(op.kind);
      const sha = readPayloadString(op.payload, "from_sha") ?? readHeadSha(git, repoRoot);
      if (!sha) {
        return { kind: op.kind, success: false, note: "no SHA available (HEAD probe failed and payload had no from_sha)" };
      }
      const branch = readPayloadString(op.payload, "branch") ?? "develop";
      const r = gh([
        "api",
        "-X",
        "POST",
        `repos/${opSlug}/git/refs`,
        "-f",
        `ref=refs/heads/${branch}`,
        "-f",
        `sha=${sha}`,
      ]);
      if (r.exitCode === 0) {
        return { kind: op.kind, success: true, note: `created refs/heads/${branch} → ${sha.slice(0, 7)}` };
      }
      // 422 = "Reference already exists" — treat as success (matches init-gh.ts).
      if (/\bHTTP 422\b/.test(r.stderr) || /Reference already exists/i.test(r.stderr)) {
        return { kind: op.kind, success: true, note: `refs/heads/${branch} already exists` };
      }
      return { kind: op.kind, success: false, note: `gh refs POST failed: ${truncateGhErr(r.stderr)}` };
    }

    case "set-default-branch": {
      if (opSlug === null) return failNoSlug(op.kind);
      const to = readPayloadString(op.payload, "to") ?? "develop";
      const r = gh(["api", "-X", "PATCH", `repos/${opSlug}`, "-f", `default_branch=${to}`]);
      if (r.exitCode === 0) {
        return { kind: op.kind, success: true, note: `default_branch → ${to}` };
      }
      return { kind: op.kind, success: false, note: `gh repos PATCH failed: ${truncateGhErr(r.stderr)}` };
    }

    case "apply-branch-protection": {
      if (opSlug === null) return failNoSlug(op.kind);
      const branch = readPayloadString(op.payload, "branch") ?? defaultBranch;
      const protection = readPayloadObject(op.payload, "protection");
      if (!protection) {
        return { kind: op.kind, success: false, note: "queue entry missing `protection` payload" };
      }
      const r = gh(
        [
          "api",
          "-X",
          "PUT",
          `repos/${opSlug}/branches/${branch}/protection`,
          "--input",
          "-",
        ],
        // The queue stored the payload as plain JSON; we round-trip it back
        // verbatim so the same shape that init-gh.ts built lands at the API.
        { input: JSON.stringify(protection as unknown as ProtectionPutPayload) },
      );
      if (r.exitCode === 0) {
        return { kind: op.kind, success: true, note: `protection applied to ${branch}` };
      }
      if (/\bHTTP 403\b/.test(r.stderr)) {
        return {
          kind: op.kind,
          success: false,
          note: "gh token missing scopes — run `gh auth refresh -h github.com -s repo,workflow`",
        };
      }
      return { kind: op.kind, success: false, note: `gh protection PUT failed: ${truncateGhErr(r.stderr)}` };
    }

    case "push-workflows": {
      if (opSlug === null) return failNoSlug(op.kind);
      const paths = readPayloadStringArray(op.payload, "paths");
      if (paths.length === 0) {
        return { kind: op.kind, success: true, note: "no workflow paths queued — nothing to verify" };
      }
      // Verify each workflow is reachable on the default branch via Contents
      // API. We can't actually push from here (the user owns commit + push),
      // but we can confirm the file is on the remote so the user knows the
      // workflow gate is wired. Anything missing → failure with the actionable
      // hint.
      //
      // Per-segment encoding (not encodeURIComponent on the whole path) so
      // forward slashes survive — GitHub's Contents API treats `%2F` as a
      // literal segment containing a slash, which 404s on every directoried
      // path. Encode each component separately and re-join with `/`.
      const missing: string[] = [];
      for (const p of paths) {
        const enc = p.split("/").map(encodeURIComponent).join("/");
        const r = gh(["api", `repos/${opSlug}/contents/${enc}?ref=${defaultBranch}`]);
        if (r.exitCode !== 0) missing.push(p);
      }
      if (missing.length === 0) {
        return { kind: op.kind, success: true, note: `verified ${paths.length} workflow file(s) on ${defaultBranch}` };
      }
      return {
        kind: op.kind,
        success: false,
        note: `missing on remote ${defaultBranch}: ${missing.join(", ")}. Commit + push the .github/workflows/ files first.`,
      };
    }
  }
}

function failNoSlug(kind: ReplayOpKind): ReplayOpResult {
  return {
    kind,
    success: false,
    note: "no GitHub remote — add `origin` (`git remote add origin <url>`) and re-run `devx init --resume-gh`",
  };
}

function resolveOpSlug(op: PendingGhOp, fallback: string | null): string | null {
  const fromPayload = readPayloadString(op.payload, "repo");
  return fromPayload ?? fallback;
}

function readDefaultBranch(git: GitExec, cwd: string): string {
  const r = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  if (r.exitCode === 0) {
    const ref = r.stdout.trim();
    const slash = ref.indexOf("/");
    return slash === -1 ? ref : ref.slice(slash + 1);
  }
  const cfg = git(["config", "--get", "init.defaultBranch"], cwd);
  if (cfg.exitCode === 0 && cfg.stdout.trim()) return cfg.stdout.trim();
  return "main";
}

function readHeadSha(git: GitExec, cwd: string): string | null {
  const r = git(["rev-parse", "HEAD"], cwd);
  if (r.exitCode !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

function readPayloadString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readPayloadStringArray(payload: Record<string, unknown>, key: string): string[] {
  const v = payload[key];
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string" && s.length > 0);
}

function readPayloadObject(payload: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = payload[key];
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function truncateGhErr(stderr: string, max = 200): string {
  const cleaned = stderr.trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

function isPendingOp(op: unknown): op is PendingGhOp {
  if (typeof op !== "object" || op === null) return false;
  const o = op as { kind?: unknown; payload?: unknown };
  if (typeof o.kind !== "string") return false;
  if (typeof o.payload !== "object" || o.payload === null) return false;
  // Only the four known kinds are replayable. Forward-compat: silently skip
  // unknown kinds rather than throwing — a future devx may file new op kinds
  // we don't understand yet, and crashing on resume would brick recovery.
  return (
    o.kind === "create-develop-branch" ||
    o.kind === "set-default-branch" ||
    o.kind === "apply-branch-protection" ||
    o.kind === "push-workflows"
  );
}

function describeShape(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// Re-export queue + entry types so src/commands/init.ts has a single import surface.
export type { ManualEntry, PendingGhOp, PendingGhOpsFile } from "./init-gh.js";
