// `devx doctor --fix` — the mechanical repairs (db36af).
//
// Only the classes a detector marked `fixable` reach this file, and the
// boundary is not re-litigated here: `dead-owner`, `orphan-worktree` and
// `dead-blocker` have no applier AT ALL, so a future edit that flips one of
// their `fixable` flags still cannot mutate anything. That is deliberate —
// the 2026-08-12 dataset had two dead-owner claims with identical signatures
// needing opposite actions, and a `--fix` that treated the class as
// mechanical would have destroyed 132 uncommitted lines of real work.
//
// Every fix appends an audit line to the affected spec's status log, under
// `## Status log` and never at EOF (the dvx103 discipline test bounds its
// scan to that section). Append-only: doctor adds lines, it never rewrites
// them.
//
// Spec: dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md

import { unlinkSync } from "node:fs";
import { join } from "node:path";

import { type BacklogLockFn, withBacklogLock } from "../backlog/mutate.js";
import { writeAtomic } from "../supervisor-internal.js";
import { releaseSpecLockForClosedSpec } from "../devx/spec-lock.js";
import { appendStatusLogLine } from "../devx/status-log.js";
import { findSpecForHashAnyType, readEngineState } from "../engine/frontmatter.js";
import { type DoctorFs, realDoctorFs } from "./detect.js";
import type { Finding, FixResult } from "./types.js";

export interface FixOpts {
  repoRoot: string;
  fs?: DoctorFs;
  /** Write seam. Defaults to an ATOMIC tmp+rename write — see applyFixes. */
  write?: (p: string, contents: string) => void;
  /** Unlink seam. */
  unlink?: (p: string) => void;
  /** Async exec seam for the worktree discards. */
  exec?: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Test seam — replaces the cross-process backlog lock. */
  lock?: BacklogLockFn;
  /** Clock seam for the audit lines. */
  now?: () => Date;
}

/**
 * The statuses doctor can WRITE to a backlog row.
 *
 * Deliberately not every `SpecStatus`: `deleted` and `superseded` are
 * expressed as `~~struck~~` rows, not as a checkbox, so there is no marker to
 * write. `detectMirrorDrift` gates on this same map — marking a finding
 * fixable that the applier cannot write produced a permanently re-firing
 * `ok:false`, a `devx doctor` that exits 3 forever and a loop that emits
 * `doctor:fixed {ok:false}` every night (found in review).
 */
export const ROW_MARKER: Record<string, string> = {
  ready: " ",
  "in-progress": "/",
  blocked: "-",
  done: "x",
};

/** Git refs this is willing to hand to `git branch -D`. Mirrors git-tx's
 *  `assertSafeRef` posture: no leading dash (would parse as a flag), no
 *  whitespace, no `..`, no shell/glob metacharacters. */
export function isSafeBranchName(name: string): boolean {
  if (name === "" || name.length > 255) return false;
  if (name.startsWith("-")) return false;
  if (name.includes("..") || name.includes("@{")) return false;
  return /^[A-Za-z0-9._\/-]+$/.test(name) && !name.endsWith("/") && !name.endsWith(".lock");
}

/** Rewrite `status:` INSIDE the leading `---` frontmatter block only. */
export function replaceFrontmatterStatus(content: string, status: string): string {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return content;
  const next = m[1].replace(/^status:[ \t]*\S.*$/m, `status: ${status}`);
  if (next === m[1]) return content;
  return `---\n${next}\n---${content.slice(m[0].length)}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isoLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
  );
}

/**
 * Rewrite one backlog row's checkbox + `Status:` prose to agree with the
 * spec's frontmatter. Pure — the caller owns the read and the write.
 *
 * Textual splice on the single matching line, not a markdown roundtrip: the
 * rest of the file (blank-line separators between epic sections, hand-typed
 * prose) must come back byte-identical, and an AST roundtrip would reformat
 * it. Same reasoning as `flipDevMdRow`/`flipBacklogRowDone`.
 */
export function rewriteRowStatus(
  content: string,
  specPath: string,
  status: string,
): { content: string; changed: boolean } {
  const box = ROW_MARKER[status];
  if (box === undefined) return { content, changed: false };
  // ANCHORED to the row that IS this spec, not any row that mentions it.
  // A bare `.includes()` matched the first line containing the backticked
  // path — and cross-references like "Follow-up to `dev/dev-x.md`" are an
  // ordinary shape in these backlogs, so the splice landed on the wrong row
  // (found in review, with a repro). That got sharper once the worktree
  // repair started calling this to reset a row to `ready`: a mis-anchored
  // match could flip a merged `[x]` row back to `[ ]` and hand a shipped
  // item to the next pick.
  const rowRe = new RegExp(`^- \\[.\\] \`${escapeRegex(specPath)}\`(?=[\\s—-]|$)`);
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!rowRe.test(lines[i])) continue;
    // `break`, not `continue`: once the row for this path is found, a
    // refusal to rewrite it must END the scan. Falling through would let a
    // `[locked]` target hand the splice to some later unrelated row.
    if (/\[locked\]/i.test(lines[i])) break;
    // Struck rows are hand-abandoned; `detectMirrorDrift` skips them for
    // that reason, and the applier must agree or the two disagree about
    // what is off-limits.
    if (/^- ~~/.test(lines[i])) break;
    const before = lines[i];
    lines[i] = lines[i].replace(/^- \[.\] /, `- [${box}] `);
    // Same `(?=[.\s]|$)` anchoring the claim and mark-done flips use — a
    // bare \b would rewrite "Status: in-progress-ish".
    lines[i] = lines[i].replace(
      new RegExp(`Status: (${Object.keys(ROW_MARKER).join("|")})(?=[.\\s]|$)`),
      `Status: ${status}`,
    );
    return { content: lines.join("\n"), changed: lines[i] !== before };
  }
  return { content, changed: false };
}

/** Append doctor's audit line under `## Status log`. Reuses the shared
 *  splicer so the section-bounded placement can't drift from mark-done's. */
function audit(
  opts: FixOpts,
  hash: string,
  message: string,
  fs: DoctorFs,
  write: (p: string, c: string) => void,
): string | null {
  try {
    const resolved = findSpecForHashAnyType(opts.repoRoot, hash);
    if (resolved === null) return null;
    const content = fs.readFile(resolved.path);
    const stamp = isoLocal((opts.now ?? (() => new Date()))());
    write(resolved.path, appendStatusLogLine(content, `- ${stamp} — ${message}`));
    return resolved.path.startsWith(`${opts.repoRoot}/`)
      ? resolved.path.slice(opts.repoRoot.length + 1)
      : resolved.path;
  } catch {
    // An unwritable audit line must not undo a repair that already happened.
    return null;
  }
}

/**
 * Apply the fixable findings. Returns one FixResult per attempt — including
 * failures, which are `ok: false` with the reason rather than an exception:
 * one unfixable lock must not abandon the other thirteen.
 *
 * Everything runs inside ONE backlog-lock hold. Mirror-drift rewrites the
 * backlog and stale-lock unlinks under `.devx-cache/locks/`; both are the
 * mutations a concurrent claim races on.
 */
export async function applyFixes(
  findings: readonly Finding[],
  opts: FixOpts,
): Promise<FixResult[]> {
  const fs = opts.fs ?? realDoctorFs;
  // tmp+rename by default. Doctor rewrites DEV.md and spec files, and the
  // loop's unattended run-start self-heal does it with nobody watching — a
  // Ctrl-C or ENOSPC mid-write would truncate the backlog. "Atomic state
  // writes via tmp+rename" is a 4-epic cross-epic pattern in LEARN.md; the
  // first cut used a bare writeFileSync and only DOCUMENTED that callers
  // should do better (found in review).
  const write = opts.write ?? ((p: string, c: string) => writeAtomic(p, c));
  const unlink = opts.unlink ?? ((p: string) => unlinkSync(p));
  const lock: BacklogLockFn =
    opts.lock ??
    (<T,>(label: string, fn: () => T): T =>
      withBacklogLock(join(opts.repoRoot, ".devx-cache"), label, fn));

  const results: FixResult[] = [];
  const fixable = findings.filter((f) => f.fixable);

  // Synchronous classes, under one lock hold.
  lock("doctor-fix", () => {
    for (const f of fixable) {
      if (f.class === "stale-lock") {
        try {
          // The shared primitive, not a raw unlink — AC 6 says build the
          // release once and call it from all three sites. It also re-checks
          // liveness at APPLY time, which closes the detect→fix window: a
          // hash re-claimed in the seconds between the scan and the repair
          // keeps its lock instead of losing it to a stale finding.
          const res = releaseSpecLockForClosedSpec(f.target, { unlink });
          if (!res.released && res.reason !== "missing") {
            throw new Error(
              res.reason === "not-owner"
                ? `a live holder ('${res.owner ?? "unknown"}') acquired it since the scan — left in place`
                : res.reason,
            );
          }
          const written =
            f.hash !== undefined
              ? audit(opts, f.hash, `devx doctor --fix: removed stale spec lock (${f.detail})`, fs, write)
              : null;
          results.push({
            class: f.class,
            target: f.target,
            ok: true,
            action: `removed the stale lock`,
            // The lock itself is gitignored; only the audit line is tracked.
            ...(written !== null ? { paths: [written] } : {}),
          });
        } catch (e) {
          results.push({
            class: f.class,
            target: f.target,
            ok: false,
            action: "remove the stale lock",
            error: e instanceof Error ? e.message : String(e),
          });
        }
        continue;
      }
      if (f.class === "mirror-drift") {
        try {
          const backlogPath = join(opts.repoRoot, f.backlog ?? "DEV.md");
          const resolved = f.hash === undefined ? null : findSpecForHashAnyType(opts.repoRoot, f.hash);
          if (resolved === null) throw new Error("spec no longer resolves");
          const status = readEngineState(fs.readFile(resolved.path)).status;
          if (status === null) throw new Error("spec frontmatter carries no status");
          const next = rewriteRowStatus(fs.readFile(backlogPath), f.target, status);
          if (!next.changed) throw new Error("row not found or already correct");
          write(backlogPath, next.content);
          const written =
            f.hash !== undefined
              ? audit(
                  opts,
                  f.hash,
                  `devx doctor --fix: reconciled the ${f.backlog} row to '${status}' (frontmatter is the source of truth)`,
                  fs,
                  write,
                )
              : null;
          results.push({
            class: f.class,
            target: f.target,
            ok: true,
            action: `rewrote the ${f.backlog} row to '${status}' to match the spec frontmatter`,
            paths: [f.backlog ?? "DEV.md", ...(written !== null ? [written] : [])],
          });
        } catch (e) {
          results.push({
            class: f.class,
            target: f.target,
            ok: false,
            action: "reconcile the backlog row to the spec frontmatter",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  });

  // Async class: discard a bookkeeping-only worktree + its branch and reset
  // the spec to ready. OUTSIDE the lock hold — `withBacklogLock` is
  // synchronous by contract, and these shell out to git.
  const exec = opts.exec;
  for (const f of fixable.filter((x) => x.class === "bookkeeping-only-abandonment")) {
    if (exec === undefined) {
      results.push({
        class: f.class,
        target: f.target,
        ok: false,
        action: "discard the bookkeeping-only worktree",
        error: "no exec seam supplied",
      });
      continue;
    }
    try {
      // APPLY-TIME RE-CHECK, before anything destructive.
      //
      // The finding was computed back in `collectFindings`, and the natural
      // trigger for `doctor --fix` is "a loop looks wedged" — i.e. exactly
      // when a peer may claim in the window between the scan and the repair.
      // A `/devx` resume-claim landing there flips the spec to `in-progress`
      // and resumes INTO this very worktree (Phase 1 resume-detection); a
      // `--force` remove would then destroy a live session's tree. The
      // stale-lock path already re-checks at apply time; this asymmetry was
      // the bug (found in review).
      if (f.hash !== undefined) {
        const nowResolved = findSpecForHashAnyType(opts.repoRoot, f.hash);
        const nowStatus =
          nowResolved === null ? null : readEngineState(fs.readFile(nowResolved.path)).status;
        if (nowStatus === "in-progress") {
          results.push({
            class: f.class,
            target: f.target,
            ok: false,
            action: "discard the bookkeeping-only worktree",
            error: `'${f.hash}' became in-progress since the scan — a peer claimed it and may be working in this worktree; left untouched`,
          });
          continue;
        }
      }

      // THREE steps, not one. Discarding the worktree alone leaves the spec
      // parked `blocked` and the branch behind — so the item the loop was
      // supposed to be unwedged for is still unclaimable, which is the whole
      // point of the repair. (Caught in review: the loop's self-heal would
      // have "succeeded" and changed nothing that mattered.)
      const r = await exec("git", ["worktree", "remove", "--force", f.target], {
        cwd: opts.repoRoot,
      });
      if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `exit ${r.exitCode}`);
      const done: string[] = ["discarded the bookkeeping-only worktree"];
      const extraPaths: string[] = [];

      // 2. Delete the branch. Safe here and ONLY here: the worktree held
      // nothing but `chore(loop): record iteration N` commits on a clean
      // tree, which `isBookkeepingOnlyWorktree` verified — so `-D` destroys
      // no work. Warn-and-continue: a leaked branch is untidy, a half-done
      // repair that stops here is worse.
      if (f.branch !== undefined && isSafeBranchName(f.branch)) {
        const b = await exec("git", ["branch", "-D", f.branch], { cwd: opts.repoRoot });
        done.push(
          b.exitCode === 0 || /not found/i.test(`${b.stderr}${b.stdout}`)
            ? `deleted ${f.branch}`
            : `could NOT delete ${f.branch} (${b.stderr.trim() || `exit ${b.exitCode}`}) — remove it by hand`,
        );
      } else if (f.branch !== undefined) {
        done.push(
          `refused to delete branch '${f.branch}' — the name is not a safe ref; delete it by hand after checking where it came from`,
        );
      }

      // 3. Reset the spec to `ready` so the next pick can actually claim it.
      // Without this the repair is cosmetic.
      if (f.hash !== undefined) {
        const resolved = findSpecForHashAnyType(opts.repoRoot, f.hash);
        if (resolved !== null) {
          const content = fs.readFile(resolved.path);
          // Bounded to the FRONTMATTER block. An unbounded `/^status:/m`
          // rewrites the first body line that happens to start with
          // `status:` when the frontmatter has none (found in review).
          const next = replaceFrontmatterStatus(content, "ready");
          if (next !== content) {
            write(resolved.path, next);
            done.push("reset the spec to `status: ready`");
            extraPaths.push(
              resolved.path.startsWith(`${opts.repoRoot}/`)
                ? resolved.path.slice(opts.repoRoot.length + 1)
                : resolved.path,
            );
            // And the backlog row, or the mirror drifts the moment we fix it.
            const backlogPath = join(opts.repoRoot, f.backlog ?? "DEV.md");
            try {
              const rel = resolved.path.slice(opts.repoRoot.length + 1);
              const row = rewriteRowStatus(fs.readFile(backlogPath), rel, "ready");
              if (row.changed) {
                write(backlogPath, row.content);
                done.push(`flipped the ${f.backlog ?? "DEV.md"} row to [ ]`);
                extraPaths.push(f.backlog ?? "DEV.md");
              }
            } catch {
              // The frontmatter is the source of truth and it is already
              // correct; a row that lags is doctor's own mirror-drift
              // finding on the next run, not a failed repair.
            }
          }
        }
      }

      const written =
        f.hash !== undefined
          ? audit(
              opts,
              f.hash,
              `devx doctor --fix: ${done.join("; ")} — the worktree held only loop bookkeeping commits and a clean tree, so nothing a human would want was lost`,
              fs,
              write,
            )
          : null;
      results.push({
        class: f.class,
        target: f.target,
        ok: true,
        action: done.join("; "),
        paths: [...extraPaths, ...(written !== null ? [written] : [])],
      });
    } catch (e) {
      results.push({
        class: f.class,
        target: f.target,
        ok: false,
        action: "discard the bookkeeping-only worktree",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return results;
}
