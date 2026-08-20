// `devx learn-helper …` — CLI passthrough for the /devx-learn skill body and
// its hooks. Mirrors the plan-helper pattern: the skill body (or, for `listen`,
// Claude Code itself) invokes a small helper, the helper does the deterministic
// work, the caller uses the result.
//
//   slug   — the only mechanical piece of /devx-learn (design §Discarded
//            rejects a transcript-mining CLI arm — judgment stays prose).
//            Session content is untrusted, so branch/file slugs are minted here
//            and only here; the skill body never passes raw session text to
//            git/gh (E-6 guard).
//   listen — the Stop + SessionEnd hook entry point (rtl101). Registered in
//            `.claude/settings.json`, so it runs at every turn end in every
//            hooked repo.
//   route  — the apply-vs-propose predicate for an unattended run (c808b1).
//            Mechanical because it answers a harness fact — which paths hang
//            on a confirmation prompt an unattended tab cannot accept — not a
//            judgment call. See src/lib/learn/route.ts.
//
// Exit codes:
//   0 — always for `slug`; sanitized slug printed on stdout. The sanitizer
//       total-functions every input (empty/hostile → 'session-retro' or a
//       safe reduction), so there is no failure path.
//   0 — always for `listen`, on every path including garbage stdin and an
//       unwritable queue. A hook that can fail a turn is worse than a missed
//       detection (design.md §Constraints); the listener core is already total,
//       and the try/catch here is the second belt.
//   0 — always for `route`; the verdict is on stdout as JSON, not in the exit
//       status. A `propose` is a normal, expected answer, and an exit code a
//       shell reads as failure would make the skill body's `||` arms fire on
//       the routine path.
//   2 — commander usage error (unknown subcommand; handled by commander).
//
// Spec: dev/dev-hfi104-2026-07-24T10:41-devx-learn-skill.md (T4.2),
//       dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.4),
//       dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md (route)
// Design: _devx/workstreams/harness-fold-in/design.md §Interfaces,
//         _devx/workstreams/retro-listener/design.md §Interfaces

import { readFileSync } from "node:fs";
import process from "node:process";

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import {
  type ListenerDeps,
  type ListenerResult,
  handleHookPayload,
  isRetroGuarded,
} from "../lib/learn/listener.js";
import type { LearnEnv } from "../lib/learn/queue.js";
import { type LearnRouteOpts, routeLearnPaths } from "../lib/learn/route.js";
import { sanitizeLearnSlug } from "../lib/learn/slug.js";

export interface RunLearnSlugOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
}

/**
 * Sanitize the raw args into one slug. Multiple words arrive as separate
 * argv entries (the skill body passes unquoted prose); joining with a space
 * lets the sanitizer turn the gaps into dash separators. Zero args → the
 * 'session-retro' fallback, same as an empty string.
 */
export function runLearnSlug(args: string[], opts: RunLearnSlugOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  out(`${sanitizeLearnSlug(args.join(" "))}\n`);
  return 0;
}

export interface RunLearnRouteOpts extends LearnRouteOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Print only the decision word (`apply`/`propose`) instead of the JSON. */
  quiet?: boolean;
}

/**
 * `devx learn-helper route <path…>` — print the apply-vs-propose verdict for a
 * row's change set as JSON (`{decision, reason, verdicts}`), one verdict per
 * path so a report can name the rule that decided each one.
 *
 * Zero paths is not a usage error: a row whose "proposed change" never named a
 * file is exactly the row an unattended run must not apply, so it routes to
 * `propose` like any other unappliable row.
 */
export function runLearnRoute(paths: string[], opts: RunLearnRouteOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const result = routeLearnPaths(paths, { repoRoot: opts.repoRoot, home: opts.home });
  out(opts.quiet ? `${result.decision}\n` : `${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

export interface RunLearnListenOpts {
  /** Test seam: the hook environment (`DEVX_RETRO`, `DEVX_LEARN_HOME`). */
  env?: LearnEnv;
  /** Test seam: stdin reader. Defaults to a blocking read of fd 0. */
  readInput?: () => string;
  /** Test seam: forwarded to the listener core (clock, lock options). */
  deps?: ListenerDeps;
  /** Test seam: observe what the listener decided (nothing is printed). */
  onResult?: (result: ListenerResult) => void;
}

/**
 * Read the whole of stdin as one string.
 *
 * `readFileSync(0)` rather than the stream API on purpose: the hook payload is
 * small and already buffered by the time Claude Code spawns us, and a
 * synchronous read keeps the process from paying an event-loop turn per
 * invocation — the G-3 latency bound (p95 < 500ms end to end, E-7) is spent
 * almost entirely on node startup, so nothing else here may add to it.
 *
 * Throws when stdin is a TTY with nothing to give (EAGAIN); the caller treats
 * that like any other failure — exit 0, do nothing.
 */
function readStdin(): string {
  return readFileSync(0, "utf8");
}

/**
 * `devx learn-helper listen` — one hook payload from stdin, at most one queue
 * append or marker touch, exit 0 unconditionally.
 *
 * The order matters: the `DEVX_RETRO` guard is answered *before* stdin is
 * touched (E-2), and a payload that isn't JSON is a no-op rather than an error
 * — Claude Code owns that pipe, and speculating about a malformed payload is
 * strictly worse than ignoring it.
 */
export function runLearnListen(opts: RunLearnListenOpts = {}): number {
  try {
    const env = opts.env ?? process.env;
    if (isRetroGuarded(env)) return 0;

    let payload: unknown;
    try {
      payload = JSON.parse((opts.readInput ?? readStdin)());
    } catch {
      return 0; // unreadable stdin or non-JSON payload — nothing to detect
    }

    const result = handleHookPayload(payload, env, opts.deps);
    opts.onResult?.(result);
  } catch {
    // Unreachable in principle (the core is total) and swallowed in practice:
    // no error this command could report is worth failing a turn over.
  }
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("learn-helper")
    .description(
      "Helpers invoked by the /devx-learn skill body. Subcommand-driven; mirrors `devx plan-helper`'s passthrough pattern.",
    );

  sub
    .command("slug")
    .description(
      "Sanitize free text into a safe slug for learn branches/files (lowercase, [a-z0-9-], ≤40 chars; empty → 'session-retro'). The only sanctioned path from session text to git/gh names.",
    )
    .argument("[raw...]", "raw text to sanitize (session-mined learning title)")
    .action((raw: string[]) => {
      const code = runLearnSlug(raw ?? []);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("route")
    .description(
      "Apply-vs-propose predicate for an unattended /devx-learn run: prints {decision, reason, verdicts} JSON for the given paths. `propose` for anything an unattended tab cannot edit (.claude/**, skills/**, settings.json, outside the repo); `apply` otherwise. Exit 0 either way.",
    )
    .argument("[paths...]", "paths the row would change (repo-relative or absolute)")
    .option("-q, --quiet", "print only the decision word")
    .option("--repo-root <dir>", "repo root the paths are relative to (default: cwd)")
    .action((paths: string[], options: { quiet?: boolean; repoRoot?: string }) => {
      const code = runLearnRoute(paths ?? [], {
        quiet: options.quiet,
        repoRoot: options.repoRoot,
      });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("listen")
    .description(
      "Claude Code Stop/SessionEnd hook entry point: reads one hook payload on stdin and queues the session for a /devx-learn retro when the wrap-up carried the canonical nudge. Silent, non-blocking, exits 0 on every path.",
    )
    .action(() => {
      runLearnListen();
    });

  attachPhase(sub, 1);
}
