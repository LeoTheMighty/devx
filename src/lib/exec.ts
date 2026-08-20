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

import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants, accessSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { platform } from "node:process";

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

/** Output ceiling, shared by both seams. Diffs and `gh` JSON payloads can be
 *  large, and the 1MB default truncates them silently. The sync seam hands
 *  this to spawnSync, which applies it PER STREAM; the async seam enforces it
 *  by hand (`spawn` has no maxBuffer) against stdout+stderr COMBINED. The
 *  difference only shows up above 64MB on one stream, where neither answer is
 *  useful anyway. */
const MAX_BUFFER = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// PATH resolution (debug-5e1a77)
// ---------------------------------------------------------------------------

/**
 * Cache of `${PATH}\0${cmd}` → absolute path. Keyed by the EFFECTIVE PATH so a
 * caller that overrides `opts.env.PATH` (test shims do) never reads an entry
 * resolved under a different search order.
 */
const resolvedCommands = new Map<string, string>();

/**
 * Resolve a bare command name (`"git"`) to its absolute path BEFORE handing it
 * to `spawn`/`spawnSync`.
 *
 * WHY (debug-5e1a77, measured 2026-08-20 on a 12-core macOS box). When the
 * command has no slash, libuv hands the name to `execvp` in the child, which
 * tries an `execve` against each PATH entry in turn. On macOS a FAILED
 * `execve` attempt is not free — it costs ~5.6ms — so the price of a spawn is
 * linear in the number of PATH entries that miss:
 *
 *   spawnSync("git", ["status"])              154ms   (26 misses before /usr/bin)
 *   spawnSync("/usr/bin/git", ["status"])      11ms
 *   PATH trimmed to "/usr/bin:/bin"            11ms
 *   25 nonexistent dirs then /usr/bin         151ms
 *
 * Identical for the async seam (158ms → 12ms), so this is exec-attempt cost,
 * not a `spawnSync` artifact — and it is invisible from a shell, where the
 * interactive hash table already holds the answer. A dev box with a
 * shell-profile-grown PATH (54 entries, 26 before `/usr/bin`) therefore pays
 * ~14x on EVERY git call devx makes; the loop's driver makes ~60 per
 * iteration. Resolving here costs one `stat` per candidate — microseconds —
 * and is cached after the first walk.
 *
 * Deliberately CONSERVATIVE: anything this function is not certain about
 * returns `cmd` unchanged, so `execvp` still gets to answer and behaviour is
 * exactly today's. That covers Windows (PATHEXT has its own rules), a command
 * that already carries a separator, an empty PATH entry (POSIX reads it as the
 * child's cwd), and a relative PATH entry (resolved against the CHILD's cwd,
 * which is `opts.cwd`, not ours).
 */
export function resolveCommandPath(cmd: string, envPath: string | undefined): string {
  if (platform === "win32") return cmd;
  if (cmd.includes(sep) || cmd.includes("/")) return cmd;
  const searchPath = envPath ?? "";
  if (searchPath === "") return cmd;

  const key = `${searchPath}\0${cmd}`;
  const hit = resolvedCommands.get(key);
  if (hit !== undefined) return hit;

  let answer = cmd;
  for (const dir of searchPath.split(":")) {
    // "" means cwd, and a relative entry resolves against the child's cwd —
    // neither is ours to reproduce. Hand the whole question back to execvp.
    if (dir === "" || !isAbsolute(dir)) return cmd;
    const candidate = join(dir, cmd);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, fsConstants.X_OK);
    } catch {
      continue;
    }
    answer = candidate;
    break;
  }
  resolvedCommands.set(key, answer);
  return answer;
}

/** The PATH the child will actually search, given this call's `opts.env`.
 *  Both seams MERGE `opts.env` over `process.env`, so an override wins. */
function effectivePath(env: Record<string, string> | undefined): string | undefined {
  return env?.PATH ?? process.env.PATH;
}

export const realExec: Exec = (cmd, args, opts) => {
  const r = spawnSync(resolveCommandPath(cmd, effectivePath(opts?.env)), args, {
    encoding: "utf8",
    cwd: opts?.cwd,
    // Merge over process.env rather than replace — git needs HOME/PATH etc.
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
    // Diffs and `gh` JSON payloads can be large; the default 1MB maxBuffer
    // truncates silently.
    maxBuffer: MAX_BUFFER,
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
 * The async twin of {@link Exec}. Same arguments, same result shape — the
 * only difference is that the caller `await`s it.
 */
export type ExecAsync = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> },
) => Promise<ExecResult>;

/**
 * Non-blocking `realExec`.
 *
 * WHY THIS EXISTS (debug-5e1a77). `realExec` is `spawnSync`, so for the whole
 * duration of a child process it holds the event loop. Nothing else in the
 * process gets a tick — including `setTimeout` callbacks. That is not just a
 * latency cost: `@vitest/runner` implements a test's timeout as a promise race
 * against a timer, so a test whose work is a chain of `spawnSync` calls can
 * run 44x past its declared cap and still report PASSED, because the timer in
 * that race never fires. A cap that cannot fire is not enforcement at any
 * value. `test/exec-async-seam.test.ts` demonstrates both halves of that.
 *
 * Behavioural contract — deliberately identical to `realExec`, so a call site
 * can move over by adding `await` and nothing else:
 *
 *   * `opts.env` is MERGED over `process.env`, never a replacement (git needs
 *     HOME/PATH), and only when the caller passes one.
 *   * A spawn failure (ENOENT, EACCES) or a child killed by a signal resolves
 *     — it does not reject — with `exitCode: 127` and the reason in `stderr`.
 *     Callers branch on `exitCode`; a rejection would be a new failure mode
 *     for every one of them.
 *   * Output over {@link MAX_BUFFER} kills the child and reports 127 rather
 *     than silently truncating.
 *
 * One intentional difference: stdin is `ignore` (an immediate EOF) rather than
 * an open pipe. An open pipe is a hang pathway — a child that reads stdin would
 * wait forever for a parent that never writes — and hang-immunity is mandatory
 * on the overnight-loop paths this seam serves (`v2/04-overnight-loop.md` §4).
 * `spawnSync` with no `input` gives the child the same immediate EOF.
 */
export const realExecAsync: ExecAsync = (cmd, args, opts) =>
  new Promise<ExecResult>((resolve) => {
    let settled = false;
    const finish = (r: ExecResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(resolveCommandPath(cmd, effectivePath(opts?.env)), args, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      // spawn throws synchronously only on bad arguments; a missing binary
      // arrives as an 'error' event. Both are the same answer to the caller.
      finish({ stdout: "", stderr: (e as Error).message, exitCode: 127 });
      return;
    }

    let stdout = "";
    let stderr = "";
    let captured = 0;
    let overflowed = false;

    const capture = (which: "stdout" | "stderr") => (chunk: string) => {
      if (overflowed) return;
      captured += Buffer.byteLength(chunk, "utf8");
      if (captured > MAX_BUFFER) {
        overflowed = true;
        child.kill();
        finish({
          stdout,
          stderr: `output exceeded maxBuffer (${MAX_BUFFER} bytes)`,
          exitCode: 127,
        });
        return;
      }
      if (which === "stdout") stdout += chunk;
      else stderr += chunk;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", capture("stdout"));
    child.stderr?.on("data", capture("stderr"));
    // A killed child can leave its pipes to emit EPIPE/ECONNRESET. An
    // unhandled 'error' on a stream is a thrown exception, so absorb them:
    // the child's own 'error'/'close' below is the result-bearing signal.
    child.stdout?.on("error", () => {});
    child.stderr?.on("error", () => {});

    child.on("error", (e) => {
      finish({ stdout, stderr: e.message, exitCode: 127 });
    });

    // 'close' rather than 'exit': 'exit' can arrive before the stdio streams
    // have flushed, which would truncate the output of a fast, chatty child.
    child.on("close", (code, signal) => {
      if (code === null) {
        finish({
          stdout,
          stderr: stderr === "" ? `terminated by signal ${signal}` : stderr,
          exitCode: 127,
        });
        return;
      }
      finish({ stdout, stderr, exitCode: code });
    });
  });

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
