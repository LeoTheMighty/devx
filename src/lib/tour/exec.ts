// Shared exec seam for the tour modules (v2t101).
//
// Same injectable shell-out shape as await-remote-ci.ts (dvx105), extended
// with an `env` passthrough because publish.ts drives git plumbing against a
// temporary GIT_INDEX_FILE (so the user's real index / worktree is never
// disturbed). Tests inject a fake; production uses spawnSync.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md

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
    // Tour diffs can be large; default 1MB maxBuffer truncates silently.
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
