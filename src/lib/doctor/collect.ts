// `devx doctor`'s detector fan-out (db36af).
//
// Lives in `src/lib/doctor/` rather than in the command, because the loop
// driver consults it too — and a lib importing a command module drags
// commander and the config loader into the overnight loop's import graph
// (review finding). The command stays a thin renderer over this, which is
// what the spec's Technical notes ask for.
//
// Spec: dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md

import { realExecAsync } from "../exec.js";
import {
  detectDeadBlockers,
  detectDeadOwners,
  detectMirrorDrift,
  detectStaleLocks,
  detectWorktrees,
} from "./detect.js";
import type { Finding } from "./types.js";

/**
 * Run every detector.
 *
 * The four sync detectors always run; the worktree scan shells out to git
 * and is best-effort — a git failure there must not take the other four's
 * findings down with it, because doctor is advisory and a partial report
 * beats no report.
 */
export async function collectFindings(
  repoRoot: string,
  opts: Record<string, unknown> = {},
): Promise<Finding[]> {
  const base = { repoRoot, ...opts } as never;
  const sync = [
    ...detectStaleLocks(base),
    ...detectMirrorDrift(base),
    ...detectDeadOwners(base),
    ...detectDeadBlockers(base),
  ];
  let worktrees: Finding[] = [];
  try {
    worktrees = await detectWorktrees({
      exec: realExecAsync,
      ...(base as object),
    } as never);
  } catch {
    worktrees = [];
  }
  return [...sync, ...worktrees];
}
