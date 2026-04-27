// `devx init` — Phase 0 real-functional command (12th non-stub).
//
// Today the only subcommand is `--resume-gh`: replay the deferred GitHub-side
// ops queued by /devx-init's failure-mode handlers (init-failure.ts handles
// the queue write; this command consumes it).
//
// The fresh-init flow is a Claude slash command (`/devx-init`), not a CLI
// subcommand — `/devx-init` orchestrates `init-questions.ts` (interactive) +
// `init-state.ts` (reads) + `init-write.ts` (writes) + `init-gh.ts` (gh ops)
// + `init-failure.ts` (failure modes) + `init-personas.ts` + `init-interview.ts`
// + `init-supervisor.ts`. All of those are pure modules so the slash command
// can call them with scripted inputs; `devx init` itself never re-runs the
// full flow.
//
// Surfaces:
//   devx init                 → prints usage to stderr, exit 0 (Phase 0 stub policy)
//   devx init --resume-gh     → replay queued gh ops; clear init_partial iff all-green
//   devx init --help          → commander's standard help
//
// Spec: dev/dev-ini506-2026-04-26T19:35-init-failure-modes.md (AC #5, #8)
// Reuses: src/lib/init-failure.ts (replay + flag), src/lib/init-gh.ts (queue types).

import type { Command } from "commander";

import {
  readInitPartial,
  replayPendingGhOps,
  setInitPartial,
  writeRemainingPendingOps,
} from "../lib/init-failure.js";
import { attachPhase } from "../lib/help.js";

const USAGE = [
  "Usage: devx init --resume-gh",
  "",
  "Replays the GitHub-side scaffolding queued by /devx-init when `gh` was",
  "unauthenticated, the repo had no remote, or branch protection couldn't",
  "be applied. Clears `init_partial: true` once every queued op succeeds.",
  "",
  "The fresh-init flow lives in the `/devx-init` Claude slash command.",
].join("\n");

export interface RunInitOpts {
  /** Test seam: route stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr. */
  err?: (s: string) => void;
  /** Test seam: override repo root (defaults to process.cwd()). */
  repoRoot?: string;
  /** Test seam: forwarded to replay/flag helpers. */
  configPath?: string;
  /** Test seam: forwarded to replay. */
  pendingPath?: string;
  /** Test seam: bypass node:child_process by injecting a fake gh. */
  gh?: Parameters<typeof replayPendingGhOps>[0]["gh"];
  /** Test seam: bypass node:child_process by injecting a fake git. */
  git?: Parameters<typeof replayPendingGhOps>[0]["git"];
}

/** Pure entrypoint — exported for tests. Returns void on success; throws on
 *  any error so commander's exitOverride / the top-level CLI catch translate
 *  into a non-zero exit. No-args = usage = exit 0 (matches `devx config`). */
export function runInit(args: string[], opts: RunInitOpts = {}): void {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const repoRoot = opts.repoRoot ?? process.cwd();

  if (args.length === 0) {
    err(`${USAGE}\n`);
    return;
  }

  // Single supported flag today; fail loud on anything else so we don't
  // silently swallow a typo.
  const [first, ...rest] = args;
  if (first !== "--resume-gh") {
    throw new Error(
      `devx init: unknown subcommand or flag '${first}'\n${USAGE}`,
    );
  }
  if (rest.length > 0) {
    throw new Error(
      `devx init --resume-gh: takes no positional arguments (got ${rest.length})\n${USAGE}`,
    );
  }

  runResumeGh({ repoRoot, opts, out, err });
}

interface ResumeArgs {
  repoRoot: string;
  opts: RunInitOpts;
  out: (s: string) => void;
  err: (s: string) => void;
}

function runResumeGh({ repoRoot, opts, out, err }: ResumeArgs): void {
  // If the queue file isn't there, there's nothing to resume. Exit 0 with
  // a hint so the user knows they're already in the clear. Corrupt JSON
  // rethrows as PendingGhOpsCorruptError per spec AC #8 — we never touch
  // init_partial when the queue is unparseable.
  const result = replayPendingGhOps({
    repoRoot,
    pendingPath: opts.pendingPath,
    gh: opts.gh,
    git: opts.git,
  });

  if (result.attempted === 0) {
    out("devx init --resume-gh: no pending ops to replay\n");
    // Bonus: if the flag is somehow still set with no queue, clear it so the
    // user isn't stuck on a phantom block. This handles the case where the
    // queue file was hand-deleted — better to no-op clear than leave the
    // flag stranded.
    if (readInitPartial({ repoRoot, configPath: opts.configPath })) {
      setInitPartial({ repoRoot, configPath: opts.configPath, partial: false });
      out("devx init --resume-gh: cleared init_partial (queue was already empty)\n");
    }
    return;
  }

  // Per-op log lines on stdout (so the user sees progress); summary on stderr
  // for failure runs to match the convention used by `npm test` etc.
  for (const r of result.results) {
    const tag = r.success ? "ok" : "fail";
    out(`  [${tag}] ${r.kind}: ${r.note}\n`);
  }

  // Persist the remaining queue (drops successful ops; preserves failures so
  // the next run picks up where this left off).
  writeRemainingPendingOps({
    repoRoot,
    pendingPath: opts.pendingPath,
    remaining: result.remaining,
  });

  if (result.allSucceeded) {
    setInitPartial({ repoRoot, configPath: opts.configPath, partial: false });
    out(
      `devx init --resume-gh: all ${result.attempted} op(s) succeeded — init_partial cleared\n`,
    );
    return;
  }

  const failed = result.results.filter((r) => !r.success).length;
  err(
    `devx init --resume-gh: ${failed}/${result.attempted} op(s) failed; init_partial kept. ` +
      `Re-run after fixing the issue(s) above.\n`,
  );
  // Non-zero exit on partial failure so a CI invocation surfaces it.
  throw new Error(`resume-gh: ${failed}/${result.attempted} op(s) failed`);
}

export function register(program: Command): void {
  const sub = program
    .command("init")
    .description("Resume deferred /devx-init work (--resume-gh). Fresh-init lives in the /devx-init slash command.")
    .option("--resume-gh", "Replay queued GitHub-side ops; clear init_partial iff all-green")
    .allowUnknownOption(false)
    .action((opts: { resumeGh?: boolean }) => {
      const args = opts.resumeGh ? ["--resume-gh"] : [];
      runInit(args);
    });
  // cli303: init shipped in Phase 0 (ini506); same phase bucket as `config`.
  attachPhase(sub, 0);
}
