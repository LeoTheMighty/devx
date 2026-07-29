// `devx loop` — trusted unattended operation (v2l101).
//
//   devx loop [--until <HH:MM>] [--max-items N] [--max-tokens N]
//             [--only <type>] [--dry-run]
//             [--epic <slug|hash>]… [--workstream <slug>]…
//             [--items <h1,h2,…>] [--exclude <hash|epic>]… [--focus <text>]
//
// A MODE OF THE MANAGER, not a new daemon (v2/04 §7): the command acquires
// the mgr106 manager lock, runs the outer claim cycle under night budgets,
// injects the gnhf iteration contract into fresh worker sessions, and emits
// the morning report at exit — ALWAYS, including on SIGTERM/SIGINT (the
// handlers below abort the driver, which funnels through its finalizer;
// mgr106's SIGTERM-clean drain pattern).
//
// Sleep inhibition (v2/04 §4): the sup40x supervisor scaffold owns the
// "keep devx running" problem for the manager units; for an interactively
// started `devx loop` the inhibitor is wired HERE — darwin `caffeinate -i
// -w <pid>` / linux `systemd-inhibit`, with the DEVX_SLEEP_INHIBITED env
// loop-breaker so an outer wrapper can pre-claim the job.
//
// Exit codes: 0 stopped clean · 1 lock held · 2 aborted (permanent error /
// 3 abandoned items) · 3 mode-refused (LOCKDOWN, D-6) · 4 bad flags or
// worktree-launch refusal (mlc101 — R1).
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md

import { dirname } from "node:path";
import type { Command } from "commander";

import { findProjectConfig } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import { runLoop, type LoopFlags } from "../lib/loop/driver.js";
import { type LoopScope } from "../lib/loop/scope.js";
import { startSleepInhibit } from "../lib/loop/sleep-inhibit.js";
import {
  resolveRepoRoot,
  tryRealpath,
  type RepoRootInfo,
} from "../lib/repo-root.js";

interface LoopCliOpts {
  until?: string;
  maxItems?: string;
  maxTokens?: string;
  only?: string;
  dryRun?: boolean;
  allowWorktreeRoot?: boolean;
  /** mlc106 scope flags. `--epic`/`--workstream`/`--exclude` are repeatable
   *  (commander accumulates into an array); `--items` is one comma list;
   *  `--focus` is free text. */
  epic?: string[];
  workstream?: string[];
  items?: string[];
  exclude?: string[];
  focus?: string;
}

/** Commander collector for a repeatable option. */
export function collectFlag(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * Split a `--items a,b,c` list. Commas AND whitespace both separate, so
 * `--items "a, b"` and `--items "a b"` are the same list; empty entries are
 * preserved as "" so validateScope can name the stray-comma typo rather
 * than silently swallowing it.
 */
export function parseItemsFlag(raw: string): string[] {
  const parts = raw.split(",").map((s) => s.trim());
  // A single unsplit chunk may still be whitespace-separated.
  return parts.flatMap((p) => (p === "" ? [""] : p.split(/\s+/)));
}

/**
 * Build the driver-facing scope from the raw CLI options.
 *
 * `--items` is repeatable and CONCATENATES, like its four siblings. Leaving
 * it single-valued made commander last-wins, so `--items a,b --items c`
 * silently discarded `a,b` and the overnight run worked the wrong set with
 * nothing to notice it — `validateScope` can't object, because what survived
 * was perfectly legal (review BH#1).
 */
export function scopeFromCliOpts(opts: LoopCliOpts): LoopScope {
  return {
    epics: opts.epic ?? [],
    workstreams: opts.workstream ?? [],
    items: (opts.items ?? []).flatMap(parseItemsFlag),
    excludes: opts.exclude ?? [],
    // `--focus ""` is a user error, not "no focus": keep the empty string so
    // validateScope exits 4 instead of silently dropping the directive.
    // Repeated `--focus` is plain commander last-wins, matching the other
    // single-value options (`--until`, `--only`, `--max-items`); only the
    // list-shaped flags accumulate.
    focus: opts.focus !== undefined ? opts.focus : null,
  };
}

export function parseIntFlag(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  // Strict digits-only: `parseInt("1e6")` is 1 — a silent million-fold
  // budget TIGHTENING — and "5.9" silently floors. Reject both shapes so
  // the driver's flag validation exits 4 instead (EC-LOW-12).
  if (!/^\d+$/.test(v.trim())) return Number.NaN;
  return Number.parseInt(v.trim(), 10);
}

export async function runLoopCommand(
  opts: LoopCliOpts,
  /** Test seam (review finding LOW-9): lets the signal→AbortController
   *  wiring be exercised without standing up a real loop run. */
  deps: { runLoop?: typeof runLoop } = {},
): Promise<number> {
  const runLoopFn = deps.runLoop ?? runLoop;

  // Canonical root (mlc101): a loop launched from inside a linked worktree
  // would fork the whole `.devx-cache` universe from every peer (R1) —
  // refuse and name the main checkout. Non-git cwd falls back to the
  // legacy config-walk resolution (RepoRootError → null).
  let rootInfo: RepoRootInfo | null;
  try {
    rootInfo = resolveRepoRoot();
  } catch {
    rootInfo = null;
  }
  if (rootInfo?.isLinkedWorktree && opts.allowWorktreeRoot !== true) {
    process.stderr.write(
      `devx loop: refusing to start from a linked worktree.\n` +
        `Run from the main checkout: ${rootInfo.root}\n` +
        `(--allow-worktree-root overrides — test-only.)\n`,
    );
    return 4;
  }
  // Root resolution, in precedence order (adversarial-review MED — the
  // canonical root must not override a legitimately nested project):
  //   - non-git cwd → legacy config-walk resolution;
  //   - allowed linked worktree → the worktree is deliberately its own
  //     universe (test fixtures rely on this);
  //   - devx.config.yaml below the git toplevel (nested project) → the
  //     config dir owns DEV.md/.devx-cache; canonicalization only exists
  //     to kill worktree forks, which the refusal above already did;
  //   - otherwise → the canonical main root.
  const configPath = findProjectConfig();
  const configDir = configPath !== null ? dirname(configPath) : null;
  let repoRoot: string;
  if (rootInfo === null || rootInfo.isLinkedWorktree) {
    repoRoot = configDir ?? process.cwd();
  } else if (configDir !== null && tryRealpath(configDir) !== rootInfo.root) {
    repoRoot = configDir;
  } else {
    repoRoot = rootInfo.root;
  }

  const flags: LoopFlags = {
    ...(opts.until !== undefined ? { until: opts.until } : {}),
    ...(opts.maxItems !== undefined ? { maxItems: parseIntFlag(opts.maxItems) as number } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: parseIntFlag(opts.maxTokens) as number } : {}),
    ...(opts.only !== undefined ? { only: opts.only } : {}),
    ...(opts.dryRun === true ? { dryRun: true } : {}),
    scope: scopeFromCliOpts(opts),
  };

  // SIGTERM/SIGINT → abort the driver; it drains the current step, writes
  // the morning report, releases the lock, and returns (mgr106 pattern).
  const ac = new AbortController();
  const onSignal = (sig: NodeJS.Signals): void => {
    process.stderr.write(`devx loop: received ${sig}; draining (report will be written)\n`);
    ac.abort();
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);

  // Sleep inhibitor — best-effort, skipped for dry runs.
  const inhibitor =
    flags.dryRun === true
      ? null
      : await startSleepInhibit().catch(() => null);
  if (inhibitor !== null && inhibitor.kind === "skipped" && inhibitor.reason !== "already-inhibited") {
    process.stderr.write(
      `devx loop: sleep inhibitor unavailable (${inhibitor.reason}) — the machine may sleep mid-run\n`,
    );
  }

  try {
    const result = await runLoopFn({ repoRoot, flags, signal: ac.signal });
    return result.exitCode;
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    inhibitor?.stop();
  }
}

export function register(program: Command): void {
  const cmd = program
    .command("loop")
    .description(
      "Run the overnight loop: claim backlog items, iterate with fresh worker sessions, merge on green, write a morning report (LOCKDOWN refuses)",
    )
    .option("--until <HH:MM>", "Wall-clock deadline (next occurrence)")
    .option("--max-items <n>", "Cap items claimed this run (min with loop.max_items)")
    .option("--max-tokens <n>", "Cap total tokens this run (min with loop.max_total_tokens)")
    .option("--only <type>", "Restrict picks to one spec type (dev | debug)")
    .option(
      "--epic <slug|hash>",
      "Restrict picks to a DEV.md `### Epic — …` section (slug or plan hash; repeatable)",
      collectFlag,
    )
    .option(
      "--workstream <slug>",
      "Restrict picks to an engine workstream's members (repeatable)",
      collectFlag,
    )
    .option(
      "--items <h1,h2,...>",
      "Restrict picks to these spec hashes AND claim them in this order (repeatable; lists concatenate)",
      collectFlag,
    )
    .option(
      "--exclude <hash|epic>",
      "Never pick this hash or epic (repeatable)",
      collectFlag,
    )
    .option(
      "--focus <text>",
      "Free-text directive passed verbatim to every worker iteration (steers the slice; masks nothing)",
    )
    .option("--dry-run", "Print the plan (items, budgets, mode) without claiming or spawning", false)
    .option(
      "--allow-worktree-root",
      "Skip the linked-worktree launch refusal (test-only; forks the .devx-cache universe)",
      false,
    )
    .action(async (opts: LoopCliOpts) => {
      const code = await runLoopCommand(opts);
      if (code !== 0) process.exit(code);
    });

  attachPhase(cmd, 2);
}

export const name = "loop";
export const phase = 2;
