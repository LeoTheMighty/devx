// `devx doctor` — finding + fix vocabulary (db36af).
//
// Doctor is the reconcile() role from the ManageAgent design surfaced as a
// standalone primitive: it detects, and with `--fix` mechanically repairs,
// the repo-state debris that today requires human forensics. Motivated by
// two datasets, both from real hand-reconciliations of this repo:
//
//   • 2026-07-24 (debug-dc7514): every repair step in the hand-reset commit
//     `5f83f3e` was mechanical once the facts were established.
//   • 2026-08-12 (commit `9e1d9d3`): 14 stale locks, 2 dead-owner claims,
//     2 mirror drifts, 8 dead blockers, 2 orphan worktrees — a full session
//     of forensics, all of it derivable from disk.
//
// THE FIX BOUNDARY IS THE DESIGN'S SPINE, and the 2026-08-12 dataset is why
// it is drawn where it is. Two dead-owner claims that session had IDENTICAL
// detector signatures and needed OPPOSITE actions: `ecdcda`'s worktree had
// no commits and no dirty files (releasing it was pure gain), while
// `c81f04`'s held 132 uncommitted insertions of real work. A `--fix` that
// treated "dead owner" as mechanical would have destroyed the second one.
//
// So: mechanical = derivable from ground truth with ZERO judgment (locks on
// closed specs, checkbox↔frontmatter mirrors, bookkeeping-only worktrees).
// Anything touching real uncommitted or committed work is report-only,
// always. The discriminator for a dead-owner claim is worktree CONTENTS, not
// owner liveness.
//
// Spec: dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md

/** What kind of debris this is. Stable strings — `devx next` renders them
 *  and the JSON is a consumer contract. */
export type FindingClass =
  /** `.devx-cache/locks/spec-<hash>.lock` on a spec that is closed or gone.
   *  Nothing ever reaps these: reaping only fires on a contending claim for
   *  the same hash, which never comes once the item is `[x]`. */
  | "stale-lock"
  /** Spec `in-progress`/`blocked` whose `owner:` session is not live. */
  | "dead-owner"
  /** Backlog checkbox disagrees with spec frontmatter `status:`.
   *  Frontmatter is the source of truth (CLAUDE.md). */
  | "mirror-drift"
  /** `.worktrees/<type>-<hash>/` whose spec is not in-progress. */
  | "orphan-worktree"
  /** A loop-abandoned spec whose preserved worktree holds only the loop's
   *  own bookkeeping commits — it preserves nothing a human would want. */
  | "bookkeeping-only-abandonment"
  /** `blocked_by:` naming a hash that is absent, already done, or struck —
   *  a blocker that can never clear. */
  | "dead-blocker"
  /** Flat-era workstream artifact (pre folder-per-artifact layout):
   *  `<ws>/prd.md` where the engine now reads `<ws>/prd/agent.md`.
   *  Report-only — the repair is a `git mv` the operator runs. */
  | "flat-era-workstream"
  /** `engine.docs_layout` disagrees with the artifact tree on disk — a
   *  `project-level` repo still carrying `<workstreams_root>/<slug>/` doc
   *  sets, or a `workstream` repo carrying `prd.md`/`design.md`/`plan.md` at
   *  the root. Usually an interrupted `devx layout migrate`, which is the
   *  whole reason this class exists: it makes a half-moved tree a REPORTED
   *  state instead of a silent one. Report-only by construction — the repair
   *  moves real authored work, so it sits on the far side of the fix boundary
   *  this file's header draws (dlr103). */
  | "layout-tree-mismatch";

export interface Finding {
  class: FindingClass;
  /** What the finding is about: a hash, a lock path, a worktree path. */
  target: string;
  /** One line, specific enough to act on without re-deriving the facts. */
  detail: string;
  /** Can `--fix` repair this mechanically, with zero judgment? */
  fixable: boolean;
  /** Backlog file the row lives in, when the finding has one. */
  backlog?: string;
  /** Spec hash, when the finding has one. */
  hash?: string;
  /** Branch the finding's worktree is on, when known — so the
   *  bookkeeping-only repair can delete it rather than leaking it. */
  branch?: string;
}

export interface FixResult {
  class: FindingClass;
  target: string;
  /** What was actually done — past tense, specific. */
  action: string;
  /** False when the fix was attempted and failed; `error` says why. */
  ok: boolean;
  /**
   * Repo-relative paths this fix WROTE, for a caller that must commit them.
   *
   * Doctor mutates tracked files — audit lines on specs, backlog rows — and
   * returns. On the interactive path a human commits them with everything
   * else. On the loop's unattended run-start path nobody does, and they then
   * sit dirty on `main` until the merge tail's `git pull --ff-only` fails
   * with "local changes would be overwritten" (found in review). Same
   * contract `mark-done` uses: the writer names its pathspecs so the caller
   * never has to guess, and so never reaches for `git add -A`.
   */
  paths?: string[];
  error?: string;
}

export interface DoctorReport {
  findings: Finding[];
  fixed: FixResult[];
}

/** Exit codes. Advisory shape — doctor is NEVER a merge gate, so a repo
 *  full of findings must not fail anyone's build; only an explicit
 *  `devx doctor` invocation sees the 3. */
export const DOCTOR_EXIT_CLEAN = 0;
export const DOCTOR_EXIT_FINDINGS = 3;
