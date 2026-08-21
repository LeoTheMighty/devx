// `devx doctor` detectors (db36af).
//
// Almost entirely glue, deliberately (spec Technical notes: "wrap, don't
// duplicate"). Backlog parsing is `src/lib/backlog/parse.ts`; spec resolution
// is `findSpecForHashAnyType`; lock liveness and classification are
// `classifySpecLock` (mlc103); the bookkeeping-only predicate is
// `isBookkeepingOnlyWorktree` (dc7514), whose own docstring already names
// `devx doctor` as a consumer. Every one of those is the writer's own
// notion of the thing — a second copy here would be free to drift from it.
//
// Everything in this file is a READER. Nothing writes; `fix.ts` owns that,
// and only for the classes marked `fixable`.
//
// Spec: dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { type DevRow, type SpecStatus, parseDevMd } from "../backlog/parse.js";
import { classifySpecLock } from "../devx/spec-lock.js";
import { SPEC_TYPE_DIRS, findSpecForHashAnyType } from "../engine/frontmatter.js";
import { frontmatterParseError, readEngineState } from "../engine/frontmatter.js";
import { ROW_MARKER } from "./fix.js";
import type { Finding } from "./types.js";

/** Backlog files doctor reconciles, in report order. */
export const DOCTOR_BACKLOGS = ["DEV.md", "DEBUG.md", "PLAN.md"] as const;

export interface DoctorFs {
  exists(p: string): boolean;
  readFile(p: string): string;
  readdir(p: string): string[];
  isDirectory(p: string): boolean;
}

export const realDoctorFs: DoctorFs = {
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, "utf8"),
  readdir: (p) => readdirSync(p),
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
};

export interface DetectOpts {
  repoRoot: string;
  fs?: DoctorFs;
  /**
   * Resolve a hash to its spec's frontmatter status.
   *
   * A SEAM, not a convenience. The default reaches through
   * `findSpecForHashAnyType`, which reads the REAL filesystem with
   * `existsSync`/`readdirSync` and cannot be redirected by `fs` above — so a
   * caller running against an injected filesystem (`devx next`'s snapshot,
   * every fake-fs test) would get "no spec resolves that hash" for a spec
   * that plainly exists in its own universe, and report it as debris. The
   * suite caught exactly that: `test/devx-split.test.ts`'s E-5 fixture
   * asserts `drift = 0` and went red with a phantom stale-lock finding.
   *
   * Return `undefined` for "I have no opinion about this hash" — the
   * detector then stays SILENT rather than treating it as unresolvable.
   */
  statusOf?: (hash: string) => string | null | undefined;
  /** Test seam — forwarded to classifySpecLock. */
  pidAlive?: (pid: number) => boolean;
  /** Test seam — forwarded to classifySpecLock. */
  now?: () => Date;
}

/** One row plus everything doctor needs to know about it, resolved once so
 *  six detectors don't each re-read the same spec off disk. */
interface RowFacts {
  row: DevRow;
  backlog: string;
  /** Absolute spec path, or null when the spec file is gone. */
  specPath: string | null;
  /** Frontmatter `status:`, or null when absent/unreadable. */
  specStatus: string | null;
  /** Non-null when the frontmatter YAML does not parse (9f24c7 / D-13) —
   *  every field read off it is then untrustworthy, so the detectors that
   *  compare against frontmatter must stay silent rather than report a
   *  confident mismatch against a value they could not actually read. */
  parseError: string | null;
  owner: string | null;
  /** The hash resolves in more than one type dir. Not the same as "gone" —
   *  a detector must never treat this as evidence the spec is absent. */
  ambiguous: boolean;
}

function ownerOf(content: string): string | null {
  const m = /^owner:\s*(.+?)\s*$/m.exec(content);
  if (!m) return null;
  const raw = m[1].replace(/^["']|["']$/g, "").trim();
  return raw === "" || raw === "null" || raw === "~" ? null : raw;
}

/**
 * hash → spec path, built from ONE readdir per type dir.
 *
 * `findSpecForHashAnyType` is the right resolver for a single hash, but
 * calling it per row is 7 `readdirSync`s × ~190 rows ≈ 1,300 directory
 * walks — and `gatherRows` runs three times per `collectFindings`, on a path
 * `devx next` executes constantly and the loop executes once per pick. That
 * measured ~136ms added to the dispatcher (review finding). Seven readdirs
 * total instead.
 *
 * AMBIGUOUS IS NOT ABSENT, and conflating them was a HIGH: a hash present in
 * two type dirs used to fall into the "no spec file resolves that hash"
 * branch, which is `fixable: true` — so `doctor --fix`, and the loop's
 * unattended run-start self-heal, would DELETE A LIVE CLAIM'S LOCK on a
 * duplicated hash. `null` here means ambiguous and is reported as its own
 * thing; a missing key means genuinely absent.
 */
function buildSpecIndex(
  repoRoot: string,
  fs: DoctorFs,
): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const type of SPEC_TYPE_DIRS) {
    const dir = join(repoRoot, type);
    if (!fs.exists(dir)) continue;
    let names: string[];
    try {
      names = fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = new RegExp(`^${type}-([A-Za-z0-9]+)-`).exec(name);
      if (!m) continue;
      const hash = m[1];
      // Second sighting of the same hash → ambiguous → unresolvable.
      index.set(hash, index.has(hash) ? null : join(dir, name));
    }
  }
  return index;
}

interface GatherRowsOpts {
  repoRoot: string;
  fs: DoctorFs;
  /** Skip the per-row spec read. `detectDeadBlockers` works entirely off
   *  backlog rows, so resolving 190 specs for it is pure waste. */
  resolveSpecs?: boolean;
  /** Reuse an index across detectors in one run. */
  index?: Map<string, string | null>;
}

function gatherRows(opts: GatherRowsOpts): RowFacts[] {
  const out: RowFacts[] = [];
  const index = opts.index ?? buildSpecIndex(opts.repoRoot, opts.fs);
  const resolveSpecs = opts.resolveSpecs !== false;
  for (const backlog of DOCTOR_BACKLOGS) {
    const p = join(opts.repoRoot, backlog);
    if (!opts.fs.exists(p)) continue;
    let rows: DevRow[];
    try {
      rows = parseDevMd(opts.fs.readFile(p));
    } catch {
      continue;
    }
    for (const row of rows) {
      // `null` = ambiguous (two type dirs claim this hash), absent key =
      // genuinely gone. Both leave specPath null here, but `ambiguous` is
      // recorded so consumers that would otherwise act on "no spec" can
      // stay their hand.
      const indexed = index.get(row.hash);
      const ambiguous = indexed === null;
      const specPath = indexed ?? null;
      let specStatus: string | null = null;
      let parseError: string | null = null;
      let owner: string | null = null;
      if (resolveSpecs && specPath !== null && opts.fs.exists(specPath)) {
        try {
          const content = opts.fs.readFile(specPath);
          parseError = frontmatterParseError(content);
          specStatus = readEngineState(content).status;
          owner = ownerOf(content);
        } catch {
          parseError = "spec unreadable";
        }
      }
      out.push({ row, backlog, specPath, specStatus, parseError, owner, ambiguous });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/**
 * `stale-lock` — a spec lock for an item that is closed or gone.
 *
 * The predicate is deliberately NOT "the recorded PID is dead". An
 * interactive claim runs in a short-lived CLI process, so the pid in a
 * perfectly healthy claim's lock is dead within seconds — pid liveness is
 * not claim liveness (the same reasoning `acquireSpecLock`'s `allowReap`
 * gate is built on). What IS unambiguous is a lock whose spec is `done` or
 * whose spec no longer exists: nobody can claim a closed item, so nobody can
 * legitimately hold its lock. That is the 14-instance class from the
 * 2026-08-12 pass, the oldest of them 16 days old.
 *
 * A dead-PID lock on a still-open item is a `dead-owner` finding instead,
 * and that one is report-only.
 */
export function detectStaleLocks(opts: DetectOpts): Finding[] {
  const fs = opts.fs ?? realDoctorFs;
  const dir = join(opts.repoRoot, ".devx-cache", "locks");
  if (!fs.exists(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return [];
  }
  const findings: Finding[] = [];
  const specIndex = buildSpecIndex(opts.repoRoot, fs);
  for (const name of entries.sort()) {
    const m = /^spec-([A-Za-z0-9]+)\.lock$/.exec(name);
    if (!m) continue;
    const hash = m[1];
    const lockPath = join(dir, name);
    // Ambiguity check FIRST, before any branch that could mark this fixable.
    const indexed = specIndex.get(hash);
    if (indexed === null) {
      findings.push({
        class: "stale-lock",
        target: lockPath,
        hash,
        detail: `lock for '${hash}' but that hash resolves to MORE THAN ONE spec file — ambiguous, not absent. Resolve the duplicate hash first; deleting this lock could release a live claim`,
        // Report-only. This is the branch that used to be fixable and would
        // have force-released a live claim's lock on a duplicated hash.
        fixable: false,
      });
      continue;
    }

    let status: string | null | undefined;
    if (opts.statusOf !== undefined) {
      status = opts.statusOf(hash);
      // Explicit "no opinion" — the caller's universe does not know this
      // hash, which is not the same as "the spec is gone".
      if (status === undefined) continue;
      if (status === null) {
        findings.push({
          class: "stale-lock",
          target: lockPath,
          hash,
          detail: `lock for '${hash}' but no spec file resolves that hash — the spec was renamed, deleted, or the lock outlived it`,
          fixable: true,
        });
        continue;
      }
    } else {
      let resolution: { path: string } | null = null;
      try {
        resolution = findSpecForHashAnyType(opts.repoRoot, hash);
      } catch {
        resolution = null;
      }
      if (resolution === null) {
        findings.push({
          class: "stale-lock",
          target: lockPath,
          hash,
          detail: `lock for '${hash}' but no spec file resolves that hash — the spec was renamed, deleted, or the lock outlived it`,
          fixable: true,
        });
        continue;
      }
      try {
        status = readEngineState(fs.readFile(resolution.path)).status;
      } catch {
        status = null;
      }
    }
    if (status === "done") {
      const cls = classifySpecLock(lockPath, {
        readFile: (p) => fs.readFile(p),
        ...(opts.pidAlive !== undefined ? { pidAlive: opts.pidAlive } : {}),
        ...(opts.now !== undefined ? { now: opts.now } : {}),
      });
      findings.push({
        class: "stale-lock",
        target: lockPath,
        hash,
        detail: `'${hash}' is status: done but still holds a lock (${cls.kind}) — nothing reaps a closed item's lock, because reaping only fires on a contending claim that will never come`,
        fixable: true,
      });
    }
  }
  return findings;
}

/**
 * `mirror-drift` — the backlog checkbox and the spec's frontmatter disagree.
 *
 * Frontmatter is the source of truth per CLAUDE.md, so the fix rewrites the
 * ROW. `devx next` already reports this class on its `drift[]` channel and
 * has done, correctly, for weeks — the detect half existed; the fix half and
 * the "somebody actually runs it" half did not.
 *
 * Skips `[locked]` rows (user-typed, sacrosanct), struck rows (abandoned by
 * hand — the frontmatter is expected to disagree), and any spec whose
 * frontmatter does not parse: a confident mismatch reported against a value
 * that could not be read is worse than silence (9f24c7 / D-13).
 */
export function detectMirrorDrift(opts: DetectOpts): Finding[] {
  const fs = opts.fs ?? realDoctorFs;
  const findings: Finding[] = [];
  for (const f of gatherRows({ repoRoot: opts.repoRoot, fs })) {
    if (f.row.struck) continue;
    if (/\[locked\]/i.test(f.row.raw)) continue;
    if (f.specPath === null || f.specStatus === null) continue;
    if (f.parseError !== null) continue;
    if (f.specStatus === f.row.status) continue;
    // Only flag what the applier can WRITE. `deleted`/`superseded` are
    // expressed as `~~struck~~` rows, not as a checkbox, so marking them
    // fixable produced a finding that failed forever: `devx doctor` exits 3
    // permanently and the loop emits `doctor:fixed {ok:false}` every night
    // (found in review, with a repro).
    const writable = f.specStatus in ROW_MARKER;
    findings.push({
      class: "mirror-drift",
      target: f.row.path,
      hash: f.row.hash,
      backlog: f.backlog,
      detail:
        `${f.backlog} row says '${f.row.status}' but the spec frontmatter says '${f.specStatus}' — frontmatter is the source of truth, so the ROW is wrong` +
        (writable ? "" : `; '${f.specStatus}' has no checkbox form (it is expressed as a ~~struck~~ row), so the repair is a human edit`),
      fixable: writable,
    });
  }
  return findings;
}

/**
 * `dead-blocker` — a blocked row whose `blocked_by:` cannot do its job.
 *
 * Three shapes, all report-only, because the fix (re-root the dependency vs
 * retire the item vs unblock it) is judgment: the blocker is absent from
 * disk, struck `~~superseded~~`, or already `done` while the dependent row
 * is STILL marked blocked. Motivating case: 8 of 10 blocked PLAN.md rows sat
 * behind `c4f1a2`, superseded 2026-07-05, so their blocker could never clear
 * and nothing noticed for five weeks.
 *
 * SCOPED TO ROWS THAT ARE ACTUALLY BLOCKED, which the first real run against
 * this repo forced (the "first real run against the live repo" cross-epic
 * pattern earning its keep again). Reporting every `Blocked-by:` naming a
 * done hash produced 20 findings on a healthy repo — a satisfied blocker on
 * a `ready` row is not a defect, it is the normal end state of a dependency,
 * and the annotation is kept deliberately as provenance. Twenty rows of
 * noise is how an advisory channel gets ignored, which is the failure mode
 * this whole story exists to fix. What IS a defect is a row still sitting in
 * `blocked` whose stated reason has evaporated: either it is claimable now
 * and nobody noticed, or it is blocked on something the annotation does not
 * name.
 */
export function detectDeadBlockers(opts: DetectOpts): Finding[] {
  const fs = opts.fs ?? realDoctorFs;
  // resolveSpecs:false — this detector reads only backlog rows, so
  // resolving ~190 spec files for it is pure waste on a hot path.
  const index = buildSpecIndex(opts.repoRoot, fs);
  const rows = gatherRows({ repoRoot: opts.repoRoot, fs, resolveSpecs: false, index });
  const byHash = new Map<string, RowFacts>();
  for (const f of rows) byHash.set(f.row.hash, f);

  const findings: Finding[] = [];
  for (const f of rows) {
    if (f.row.struck) continue;
    // Only a row that is ACTUALLY blocked can be wedged by its blocker. A
    // `ready` or `done` row's satisfied blocked_by is provenance, not debris.
    if (f.row.status !== "blocked") continue;
    // Union the row's `Blocked-by:` prose with the spec frontmatter's
    // `blocked_by:` list. The AC says "a `blocked_by:` / `Blocked-by:`", and
    // reading only the row made a spec whose blocker lives ONLY in
    // frontmatter invisible (found in review). Resolved lazily and only for
    // rows that are actually blocked — a handful on any real repo — so the
    // hot path still does not read ~190 spec files.
    const fromFrontmatter: string[] = [];
    const specPath = index.get(f.row.hash);
    if (specPath !== undefined && specPath !== null) {
      try {
        fromFrontmatter.push(...readEngineState(fs.readFile(specPath)).blockedBy);
      } catch {
        // Unreadable frontmatter is 9f24c7's class, reported elsewhere.
      }
    }
    const blockers = [...new Set([...f.row.blocked_by, ...fromFrontmatter])];
    for (const b of blockers) {
      const target = byHash.get(b);
      let reason: string | null = null;
      if (target === undefined) {
        if ((index.get(b) ?? null) === null) {
          reason = "names a hash that is on no backlog and resolves to no spec file";
        }
      } else if (target.row.struck) {
        reason = `names '${b}', which is struck (~~superseded/abandoned~~) in ${target.backlog} — it can never reach done, so this blocker never clears`;
      } else if (target.row.status === "done") {
        reason = `is marked blocked, but its blocker '${b}' is already done — either this item is claimable now and nobody noticed, or it is blocked on something \`Blocked-by:\` does not name`;
      }
      if (reason === null) continue;
      findings.push({
        class: "dead-blocker",
        target: `${f.row.hash} → ${b}`,
        hash: f.row.hash,
        backlog: f.backlog,
        detail: `${f.backlog} row '${f.row.hash}' ${reason}`,
        // Report-only: re-root vs retire is a judgment call.
        fixable: false,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Worktree-shaped detectors (async — they shell out to git)
// ---------------------------------------------------------------------------

export interface WorktreeDetectOpts extends DetectOpts {
  /** Async exec seam, same shape the loop's git-tx layer takes. */
  exec: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Test seam — replaces `isBookkeepingOnlyWorktree`. */
  bookkeepingOnly?: (worktree: string, baseRef: string) => Promise<boolean>;
  /**
   * Base ref the worktree branched from.
   *
   * Default `"main"` is a FALLBACK, not an assumption: pass the project's
   * real default/integration branch. On a `master` repo or a split-branch
   * project the literal "main" makes `git log main..HEAD` error, which
   * `isBookkeepingOnlyWorktree` reads conservatively as "real work" — so the
   * fixable class silently never fires and the loop's self-heal is dead with
   * no signal (found in review).
   */
  baseRef?: string;
}

/**
 * `orphan-worktree` and `bookkeeping-only-abandonment`.
 *
 * These share a scan and differ entirely in what the worktree CONTAINS,
 * which is the discriminator the 2026-08-12 dataset proved is the only safe
 * one. Two dead-owner claims that day had identical outside signatures:
 * `ecdcda` (no commits, clean tree — releasing it was pure gain) and
 * `c81f04` (132 uncommitted insertions of real work). So:
 *
 *   • holds only the loop's own `chore(loop): record iteration N` commits
 *     and is clean → `bookkeeping-only-abandonment`, FIXABLE. It preserves
 *     nothing a human would want; the loop's own abandon path already
 *     discards this shape (dc7514).
 *   • anything else → `orphan-worktree`, REPORT-ONLY, always. Worktrees are
 *     never auto-deleted; judgment stays human.
 *
 * `isBookkeepingOnlyWorktree` fails CONSERVATIVE — any git error reads as
 * "real work" — so an unreadable worktree lands in the report-only bucket,
 * which is the safe direction.
 */
export async function detectWorktrees(opts: WorktreeDetectOpts): Promise<Finding[]> {
  const fs = opts.fs ?? realDoctorFs;
  const dir = join(opts.repoRoot, ".worktrees");
  if (!fs.exists(dir)) return [];
  let entries: string[];
  try {
    entries = fs.readdir(dir);
  } catch {
    return [];
  }
  const baseRef = opts.baseRef ?? "main";
  const findings: Finding[] = [];
  for (const name of entries.sort()) {
    const worktree = join(dir, name);
    if (!fs.isDirectory(worktree)) continue;
    const m = new RegExp(`^(${SPEC_TYPE_DIRS.join("|")})-([A-Za-z0-9]+)$`).exec(name);
    if (!m) continue;
    const hash = m[2];

    // Is this actually a registered worktree? A linked worktree has a `.git`
    // POINTER FILE; a leftover directory has nothing.
    //
    // This matters more than it looks. Running `git` with cwd set to an
    // unregistered directory *inside the repo* does not fail — git walks up
    // and answers about the ENCLOSING repository. So
    // `isBookkeepingOnlyWorktree` would report the MAIN checkout's dirty
    // state, conclude "real work", and doctor would tell the operator that a
    // directory of stale build artifacts holds work worth inspecting —
    // forever, on evidence about the wrong repository. Found by running the
    // first real scan against this repo: `.worktrees/dev-a10001` is a
    // leftover `mobile/.dart_tool` tree with no `.git` at all.
    if (!fs.exists(join(worktree, ".git"))) {
      findings.push({
        class: "orphan-worktree",
        target: worktree,
        hash,
        detail: `${worktree} is NOT a registered git worktree (no .git pointer) — a leftover directory, most likely build artifacts from a removed worktree. Nothing git-tracked is at risk; \`rm -rf\` it once you have looked`,
        // Report-only: it is outside git's model entirely, so the
        // bookkeeping-only predicate cannot speak to it and doctor must not
        // rm -rf a directory on a guess.
        fixable: false,
      });
      continue;
    }

    let status: string | null = null;
    let branch: string | undefined;
    const specType = m[1];
    try {
      const resolved = findSpecForHashAnyType(opts.repoRoot, hash);
      if (resolved !== null) {
        const content = fs.readFile(resolved.path);
        status = readEngineState(content).status;
        // The spec's RECORDED branch, not a derived guess: a handed-off
        // follow-up (mss102 attach mode) is on a branch no derivation
        // produces, and deleting the derived name would silently miss it.
        const bm = /^branch:\s*(.+?)\s*$/m.exec(content);
        const raw = bm?.[1]?.replace(/^["']|["']$/g, "").trim();
        if (raw !== undefined && raw !== "" && raw !== "null" && raw !== "~") {
          branch = raw;
        }
      }
    } catch {
      status = null;
    }
    // An in-progress spec's worktree is a LIVE claim, not debris.
    if (status === "in-progress") continue;

    const bookkeepingOnly =
      opts.bookkeepingOnly ??
      (async (wt: string, base: string) => {
        const { isBookkeepingOnlyWorktree } = await import("../loop/git-tx.js");
        return isBookkeepingOnlyWorktree(opts.exec, wt, base);
      });

    let onlyBookkeeping = false;
    try {
      onlyBookkeeping = await bookkeepingOnly(worktree, baseRef);
    } catch {
      onlyBookkeeping = false; // conservative: uncertainty means real work
    }

    if (onlyBookkeeping && status === "done") {
      // The most common leftover of all: a post-merge worktree removal that
      // failed. Clean tree, only loop commits, item already shipped — there
      // is nothing to preserve and nothing to reset. Calling this an
      // "orphan-worktree … holds real work or uncommitted changes" was
      // provably false on this path (found in review).
      findings.push({
        class: "bookkeeping-only-abandonment",
        target: worktree,
        hash,
        backlog: specType === "debug" ? "DEBUG.md" : specType === "plan" ? "PLAN.md" : "DEV.md",
        ...(branch !== undefined ? { branch } : {}),
        detail: `'${hash}' is done but ${worktree} survives with only loop bookkeeping commits and a clean tree — a post-merge cleanup that did not finish; nothing to preserve`,
        fixable: true,
      });
    } else if (onlyBookkeeping && (status === "blocked" || status === "ready" || status === null)) {
      findings.push({
        class: "bookkeeping-only-abandonment",
        target: worktree,
        hash,
        backlog: specType === "debug" ? "DEBUG.md" : specType === "plan" ? "PLAN.md" : "DEV.md",
        ...(branch !== undefined ? { branch } : {}),
        detail: `'${hash}' is ${status ?? "unresolvable"} with a preserved worktree holding only loop bookkeeping commits and a clean tree — it preserves nothing a human would want`,
        fixable: true,
      });
    } else {
      findings.push({
        class: "orphan-worktree",
        target: worktree,
        hash,
        detail: `'${hash}' is ${status ?? "unresolvable"} (not in-progress) but ${worktree} still exists and holds real work or uncommitted changes — inspect it before removing; worktrees are never auto-deleted`,
        fixable: false,
      });
    }
  }
  return findings;
}

/**
 * `dead-owner` — a spec that is open and claimed, whose claim is not live.
 *
 * REPORT-ONLY in every case. The 2026-08-12 dataset is the argument: two
 * claims with the same dead-owner signature needed opposite actions, and the
 * only discriminator was worktree contents. Clearing the owner on the wrong
 * one destroys nothing by itself, but it un-masks the item for re-claim,
 * and the NEXT claim's `worktree add` is what would have destroyed
 * `c81f04`'s 132 uncommitted lines. The worktree detectors above own the
 * one shape that IS mechanical.
 */
export function detectDeadOwners(opts: DetectOpts): Finding[] {
  const fs = opts.fs ?? realDoctorFs;
  const findings: Finding[] = [];
  for (const f of gatherRows({ repoRoot: opts.repoRoot, fs })) {
    if (f.row.struck) continue;
    if (f.specStatus !== "in-progress" && f.specStatus !== "blocked") continue;
    if (f.owner === null) continue;
    const lockPath = join(opts.repoRoot, ".devx-cache", "locks", `spec-${f.row.hash}.lock`);
    if (!fs.exists(lockPath)) {
      findings.push({
        class: "dead-owner",
        target: f.row.hash,
        hash: f.row.hash,
        backlog: f.backlog,
        detail: `'${f.row.hash}' is ${f.specStatus} with owner '${f.owner}' but no lock exists at .devx-cache/locks/spec-${f.row.hash}.lock — an orphaned claim; inspect .worktrees/ before re-claiming`,
        fixable: false,
      });
      continue;
    }
    const cls = classifySpecLock(lockPath, {
      readFile: (p) => fs.readFile(p),
      ...(opts.pidAlive !== undefined ? { pidAlive: opts.pidAlive } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    if (cls.kind === "dead" || cls.kind === "recycled") {
      findings.push({
        class: "dead-owner",
        target: f.row.hash,
        hash: f.row.hash,
        backlog: f.backlog,
        detail: `'${f.row.hash}' is ${f.specStatus} and its lock classifies '${cls.kind}' (owner '${f.owner}') — the claiming session is gone. Report-only: whether to release depends on what the worktree holds, not on owner liveness (2026-08-12: two identical signatures needed opposite actions)`,
        fixable: false,
      });
    }
  }
  return findings;
}
