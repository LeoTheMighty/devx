// Shared injectable exec seam (originally v2t101; rehomed here at tur101 when
// the review tour was retired and this became the general shell-out seam).
//
// Same shape as await-remote-ci.ts (dvx105), extended with an `env`
// passthrough for callers that drive git plumbing against a scratch
// GIT_INDEX_FILE (so the user's real index / worktree is never disturbed).
// Tests inject a fake; production uses spawnSync.
//
// Consumers: devx/hold-check.ts, next/gather.ts, loop/git-tx.ts.
//
// Spec: dev/dev-tur101-2026-08-04T10:00-retire-review-tour.md

import { spawnSync } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type Exec = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
) => ExecResult;

export const realExec: Exec = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts?.cwd,
    // Merge over process.env rather than replace — git needs HOME/PATH etc.
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    // Diffs and `gh` JSON payloads can be large; the default 1MB maxBuffer
    // truncates silently.
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status === null) {
    const detail = r.error ? r.error.message : "spawn returned null status";
    return { stdout: r.stdout ?? "", stderr: detail, exitCode: 127 };
  }
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    exitCode: r.status,
  };
};

/**
 * Is `relPath` excluded by the repo's ignore rules?
 *
 * `git check-ignore -q` exits 0 when the path IS ignored, 1 when it is not,
 * and >1 on error. Anything that is not a clean "yes" answers false: a repo
 * without git, a spawn failure, or an unexpected exit code must not silently
 * drop a derived artifact from a commit — the caller's `git add` is the
 * backstop and a WARN there beats a missing artifact here.
 *
 * Hosts: devx/mark-done.ts (the attended cleanup commit) and
 * loop/driver.ts's merge tail (debug-8a9586) — both ask the same question
 * about the same file, GRAPH.md.
 */
export function isGitIgnored(
  exec: Exec,
  repoRoot: string,
  relPath: string,
): boolean {
  try {
    return (
      exec("git", ["check-ignore", "-q", "--", relPath], { cwd: repoRoot })
        .exitCode === 0
    );
  } catch {
    return false;
  }
}
