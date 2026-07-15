// `devx init` — non-interactive scaffold (pin103) + `--resume-gh` replay (ini506).
//
// Surfaces:
//   devx init                 → full non-interactive scaffold: detectInitState()
//                               → defaults AnswerProvider → runInit() (fresh|upgrade)
//                               → installSkills(). Deferred product decisions land
//                               in INTERVIEW.md; supervisor install is deferred to
//                               MANUAL.md (an unattended run must not launchctl/
//                               systemctl the host).
//   devx init --global        → skills land in ~/.claude/commands instead of the repo
//   devx init --skip-skills   → scaffold without the skills install
//   devx init --resume-gh     → replay queued gh ops; clear init_partial iff all-green
//                               (ini506 behavior, unchanged)
//   devx init --help          → commander's standard help
//
// Zero write logic lives here — orchestrator + init-write + init-upgrade +
// init-skills + init-defaults own every write (wrap-don't-duplicate).
//
// Spec: dev/dev-pin103-2026-07-14T12:02-init-noninteractive-scaffold.md
// Spec: dev/dev-ini506-2026-04-26T19:35-init-failure-modes.md (AC #5, #8)
// Plan: _devx/workstreams/portability-install/plan.md § Phase 3

import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";

import { appendDeferredDecisions, buildDefaultsAsk } from "../lib/init-defaults.js";
import {
  appendManualEntry,
  readInitPartial,
  replayPendingGhOps,
  setInitPartial,
  writeRemainingPendingOps,
} from "../lib/init-failure.js";
import { runInit as runInitOrchestrator } from "../lib/init-orchestrator.js";
import type { RunInitOpts as OrchestratorOpts } from "../lib/init-orchestrator.js";
import { installSkills } from "../lib/init-skills.js";
import { detectInitState } from "../lib/init-state.js";
import { resolveVersion } from "../lib/version.js";
import { attachPhase } from "../lib/help.js";

const USAGE = [
  "Usage: devx init [--global] [--skip-skills] | devx init --resume-gh",
  "",
  "Bare `devx init` scaffolds a working devx repo non-interactively:",
  "config, backlogs, spec dirs, CLAUDE.md block, CI workflows, and the",
  "packaged skills (repo-local .claude/commands, or ~/.claude/commands",
  "with --global). Product decisions it can't derive are filed in",
  "INTERVIEW.md; the OS-supervisor install is deferred to MANUAL.md.",
  "",
  "--resume-gh replays the GitHub-side scaffolding queued when `gh` was",
  "unauthenticated, the repo had no remote, or branch protection couldn't",
  "be applied. Clears `init_partial: true` once every queued op succeeds.",
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

  // ---- scaffold seams (pin103) ----
  /** Fixed `now` for reproducible timestamps. */
  now?: () => Date;
  /** Forwarded to detectInitState + the orchestrator. */
  detectOpts?: OrchestratorOpts["detectOpts"];
  /** Override the packaged templates dir (orchestrator seam). */
  templatesRoot?: string;
  /** Override the packaged skills dir (installSkills seam). */
  skillsRoot?: string;
  /** Override the version stamped into skill headers. Defaults to the
   *  package.json version. */
  version?: string;
  /** Override the home dir used by --global. */
  homeDir?: string;
  /** Forwarded to the orchestrator's supervisor phase. Defaults to true —
   *  see the MANUAL.md deferral note in runScaffold. */
  skipSupervisor?: boolean;
}

/** Pure entrypoint — exported for tests. Resolves on success; throws on any
 *  error so commander's exitOverride / the top-level CLI catch translate
 *  into a non-zero exit. */
export async function runInit(args: string[], opts: RunInitOpts = {}): Promise<void> {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const repoRoot = opts.repoRoot ?? process.cwd();

  let resumeGh = false;
  let global = false;
  let skipSkills = false;
  for (const a of args) {
    if (a === "--resume-gh") resumeGh = true;
    else if (a === "--global") global = true;
    else if (a === "--skip-skills") skipSkills = true;
    else {
      throw new Error(`devx init: unknown subcommand or flag '${a}'\n${USAGE}`);
    }
  }
  if (resumeGh && (global || skipSkills)) {
    throw new Error(
      `devx init --resume-gh: does not combine with --global/--skip-skills\n${USAGE}`,
    );
  }

  if (resumeGh) {
    runResumeGh({ repoRoot, opts, out, err });
    return;
  }

  await runScaffold({ repoRoot, opts, out, err, global, skipSkills });
}

// ---------------------------------------------------------------------------
// Non-interactive scaffold (pin103)
// ---------------------------------------------------------------------------

interface ScaffoldArgs {
  repoRoot: string;
  opts: RunInitOpts;
  out: (s: string) => void;
  err: (s: string) => void;
  global: boolean;
  skipSkills: boolean;
}

async function runScaffold({ repoRoot, opts, out, err, global, skipSkills }: ScaffoldArgs): Promise<void> {
  const now = opts.now ?? (() => new Date());
  const skipSupervisor = opts.skipSupervisor ?? true;
  const state = detectInitState({ repoRoot, ...(opts.detectOpts ?? {}) });
  const { ask, onHalt, deferred } = buildDefaultsAsk(state, { warn: (m) => err(`devx init: ${m}\n`) });

  // Known gap (recorded in the pin103 review): ~/.devx/config.yaml user
  // prefs are not loaded here — no UserPrefs loader exists in src yet, so
  // the skip table's reuse rows (n9/n10/n12/n13) can't fire on this path.
  // Same behavior as the current interactive flow; wire it when a loader
  // lands.
  const result = await runInitOrchestrator({
    repoRoot,
    ask,
    // Bypassed halts are recorded as DeferredDecisions + warned, never
    // silently waved through (pin103 review finding).
    onHalt,
    now,
    detectOpts: opts.detectOpts,
    templatesRoot: opts.templatesRoot,
    // Unattended runs must not launchctl/systemctl the host: the supervisor
    // install is deferred to a MANUAL.md entry below (graceful-degradation
    // precedent, ini506). `/devx-init` remains the interactive path that
    // installs it for real. The upgrade arm has its own supervisor repair
    // (init-upgrade defaultRepairSupervisor → real runInitSupervisor) — pin
    // its detector to "present" for the same reason (empirically confirmed:
    // the unpinned upgrade rewrote a real ~/Library/LaunchAgents plist
    // during this story's eval run).
    skipSupervisor,
    ...(skipSupervisor
      ? { upgradeOpts: { detect: { "supervisor-units": () => true } } }
      : {}),
  });

  if (result.status !== "completed") {
    err(
      `devx init: scaffold aborted (${result.status}${result.reason ? `: ${result.reason}` : ""})\n`,
    );
    throw new Error(`init scaffold aborted (${result.status})`);
  }

  out(`devx init: ${result.mode} scaffold completed\n`);

  // Bookkeeping BEFORE the skills install (pin103 review finding): if a
  // later step throws, the config is already on disk and the retry routes
  // to the upgrade path — which never re-asks questions — so entries not
  // filed now would be lost forever. All writers below are idempotent.
  if (result.mode === "fresh") {
    // Deferred product decisions → INTERVIEW.md (upgrade runs never ask, so
    // this is fresh-only by construction; gating makes it structural).
    if (deferred.length > 0) {
      const dd = appendDeferredDecisions({ repoRoot, deferred });
      out(
        `devx init: ${dd.appended} decision(s) filed in INTERVIEW.md — review them before planning\n`,
      );
    }
    // Degraded gh-side scaffold is invisible on stdout otherwise — the
    // interactive flow narrates it; here the summary line is all the user
    // gets (pin103 review finding).
    const degraded = result.fresh?.failureBookkeeping.length ?? 0;
    if (degraded > 0) {
      out(
        `devx init: ${degraded} GitHub-side op group(s) deferred — run 'devx init --resume-gh' once gh is authenticated / a remote exists\n`,
      );
    }
  }

  // Supervisor deferral is an ACTION for the user, not a decision → MANUAL.md
  // (idempotent per kind; re-runs don't duplicate). Filed for upgrade runs
  // too — the upgrade arm's supervisor repair is pinned off above.
  if (skipSupervisor) {
    appendManualEntry({
      manualPath: join(repoRoot, "MANUAL.md"),
      kind: "supervisor-install-deferred",
      title: "OS-supervisor install deferred by non-interactive `devx init`",
      body: [
        "Bare `devx init` never installs launchd/systemd/Task Scheduler units",
        "unattended. To install the manager/concierge supervisor, run the",
        "interactive `/devx-init` flow (or see docs/SETUP.md). Until then,",
        "`devx manage` / `devx loop` run only while you start them yourself.",
      ].join("\n"),
      now: now(),
    });
    out("devx init: OS-supervisor install deferred — see MANUAL.md\n");
  }

  // Skills install — the pin102 library owns every ownership rule
  // (absent→write, header+older→overwrite, header+same→no-op,
  // headerless→skip + MANUAL entry).
  if (!skipSkills) {
    const targetDir = global
      ? join(opts.homeDir ?? homedir(), ".claude", "commands")
      : join(repoRoot, ".claude", "commands");
    const outcomes = installSkills({
      targetDir,
      version: opts.version ?? resolveVersion(),
      skillsRoot: opts.skillsRoot,
      manualPath: join(repoRoot, "MANUAL.md"),
      now,
    });
    const byAction = new Map<string, number>();
    for (const o of outcomes) {
      byAction.set(o.action, (byAction.get(o.action) ?? 0) + 1);
    }
    const summary = [...byAction.entries()].map(([a, n]) => `${n} ${a}`).join(", ");
    out(`devx init: skills → ${targetDir} (${summary})\n`);
  } else {
    out("devx init: skills install skipped (--skip-skills)\n");
  }

}

// ---------------------------------------------------------------------------
// --resume-gh (ini506 — unchanged)
// ---------------------------------------------------------------------------

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
    .description(
      "Scaffold a devx repo non-interactively (config, backlogs, CLAUDE.md, CI, skills); --resume-gh replays deferred GitHub-side ops.",
    )
    .option("--resume-gh", "Replay queued GitHub-side ops; clear init_partial iff all-green")
    .option("--global", "Install skills to ~/.claude/commands instead of the repo")
    .option("--skip-skills", "Scaffold without installing the packaged skills")
    .allowUnknownOption(false)
    .action(async (opts: { resumeGh?: boolean; global?: boolean; skipSkills?: boolean }) => {
      const args: string[] = [];
      if (opts.resumeGh) args.push("--resume-gh");
      if (opts.global) args.push("--global");
      if (opts.skipSkills) args.push("--skip-skills");
      await runInit(args);
    });
  // cli303: init shipped in Phase 0 (ini506) as --resume-gh; pin103 (Phase 3
  // of portability-install) added the bare scaffold path.
  attachPhase(sub, 0);
}
