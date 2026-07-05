// `devx loop` — trusted unattended operation (v2l101).
//
//   devx loop [--until <HH:MM>] [--max-items N] [--max-tokens N]
//             [--only <type>] [--dry-run]
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
// 3 abandoned items) · 3 mode-refused (LOCKDOWN, D-6) · 4 bad flags.
//
// Spec: dev/dev-v2l101-2026-07-05T13:06-overnight-loop.md
// Design: v2/04-overnight-loop.md

import { dirname } from "node:path";
import type { Command } from "commander";

import { findProjectConfig } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import { runLoop, type LoopFlags } from "../lib/loop/driver.js";
import { startSleepInhibit } from "../lib/loop/sleep-inhibit.js";

interface LoopCliOpts {
  until?: string;
  maxItems?: string;
  maxTokens?: string;
  only?: string;
  dryRun?: boolean;
}

export function parseIntFlag(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  // Strict digits-only: `parseInt("1e6")` is 1 — a silent million-fold
  // budget TIGHTENING — and "5.9" silently floors. Reject both shapes so
  // the driver's flag validation exits 4 instead (EC-LOW-12).
  if (!/^\d+$/.test(v.trim())) return Number.NaN;
  return Number.parseInt(v.trim(), 10);
}

export async function runLoopCommand(opts: LoopCliOpts): Promise<number> {
  const configPath = findProjectConfig();
  const repoRoot = configPath !== null ? dirname(configPath) : process.cwd();

  const flags: LoopFlags = {
    ...(opts.until !== undefined ? { until: opts.until } : {}),
    ...(opts.maxItems !== undefined ? { maxItems: parseIntFlag(opts.maxItems) as number } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: parseIntFlag(opts.maxTokens) as number } : {}),
    ...(opts.only !== undefined ? { only: opts.only } : {}),
    ...(opts.dryRun === true ? { dryRun: true } : {}),
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
    const result = await runLoop({ repoRoot, flags, signal: ac.signal });
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
    .option("--dry-run", "Print the plan (items, budgets, mode) without claiming or spawning", false)
    .action(async (opts: LoopCliOpts) => {
      const code = await runLoopCommand(opts);
      if (code !== 0) process.exit(code);
    });

  attachPhase(cmd, 2);
}

export const name = "loop";
export const phase = 2;
