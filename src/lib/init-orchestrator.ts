// Top-level orchestrator for `/devx-init` (ini508 / Phase 1 hand-off).
//
// Composes the per-phase init-* modules (ini501 questions, ini502 local writes,
// ini503 GitHub-side scaffolding, ini504 personas + INTERVIEW seeding, ini505
// supervisor install, ini506 failure-mode bookkeeping, ini507 upgrade re-run)
// into the single linear flow the `/devx-init` slash command exposes to the
// user.
//
// Why a separate module: every init-* unit ships its own contract + tests; the
// slash command is a thin wrapper around this orchestrator (it owns the I/O
// providers + the human-facing copy, nothing else). Extracting the
// composition lets ini508's e2e tests exercise the full flow without spinning
// up a Claude session — they just call `runInit({ ... })` with scripted
// answer / confirm / halt providers and assert on the disk state.
//
// Behavior:
//   - On `kind === "already-on-devx"` → delegates to `runInitUpgrade` (ini507).
//     The fresh-init phases are skipped entirely. The upgrade outcome is
//     wrapped in an `OrchestratorResult` so the caller has a single shape to
//     pattern-match on.
//   - On `kind === "corrupt-config"` → returns `aborted` with the corrupt
//     halt's reason. Caller files an INTERVIEW.md entry.
//   - On `kind ∈ {"empty", "existing"}` → fresh-init: questions → local writes
//     → gh-side writes → personas + INTERVIEW seed → supervisor install →
//     failure-mode bookkeeping (no-remote / gh-not-auth set init_partial via
//     ini506 handlers).
//   - Halt-and-confirm prompts (uncommitted-changes, non-default-branch,
//     mode×shape conflict) flow through the injected `onHalt` provider.
//     Returning false aborts the run.
//
// Spec: dev/dev-ini508-2026-04-26T19:35-init-end-to-end-test.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md
// Builds on: every ini5xx module — wraps, never duplicates business logic.

import { handleGhNotAuth, handleNoRemote } from "./init-failure.js";
import type { GhExec, InitGhResult, ManualEntry } from "./init-gh.js";
import { writeInitGh } from "./init-gh.js";
import { seedInterview, type SeedInterviewResult } from "./init-interview.js";
import {
  seedPersonas,
  type ResolveOverflow,
  type SeedPersonasResult,
} from "./init-personas.js";
import {
  type AnswerProvider,
  type ConfirmProvider,
  type PartialConfig,
  type RunInitResult as QuestionsResult,
  type UserPrefs,
  runInitQuestions,
} from "./init-questions.js";
import {
  type DetectOpts,
  type GitExec,
  type HaltAndConfirm,
  type InitState,
  detectInitState,
} from "./init-state.js";
import {
  type InitSupervisorResult,
  runInitSupervisor,
} from "./init-supervisor.js";
import {
  runInitUpgrade,
  type RunInitUpgradeOpts,
  type UpgradeResult,
} from "./init-upgrade.js";
import {
  type PrTemplateResult,
  type WriteInitResult,
  writeInitFiles,
  writePrTemplate,
} from "./init-write.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type OrchestratorMode = "fresh" | "upgrade";

export type OrchestratorStatus =
  | "completed"
  | "aborted-by-halt"
  | "aborted-corrupt"
  | "aborted-questions";

/** What the fresh-init path actually wrote / did. Each per-phase result is
 *  the exact shape its source module returns — no re-projection — so
 *  downstream consumers (the slash command's checklist UI, the e2e tests)
 *  see authoritative data. */
export interface FreshInitOutcome {
  state: InitState;
  questions: QuestionsResult;
  localWrites: WriteInitResult;
  /** PR-template write outcome (prt101). Populated after localWrites and
   *  before githubWrites so e2e tests can assert on the canonical Phase 1
   *  shape on disk. */
  prTemplate: PrTemplateResult;
  githubWrites: InitGhResult;
  personas: SeedPersonasResult;
  interview: SeedInterviewResult;
  supervisor: InitSupervisorResult;
  /** Failure-mode follow-ups invoked after writeInitGh observed a degraded
   *  path (no-remote / gh-not-auth). Empty array on the green path. */
  failureBookkeeping: ReadonlyArray<{
    kind: "no-remote" | "gh-not-authenticated" | "gh-missing-scopes" | "private-free-tier";
    flagFlipped: boolean;
    manualAppended: boolean;
  }>;
}

export interface OrchestratorResult {
  mode: OrchestratorMode;
  status: OrchestratorStatus;
  /** Set when status === "completed" and mode === "fresh". */
  fresh?: FreshInitOutcome;
  /** Set when mode === "upgrade" (regardless of status — upgrade halts surface
   *  here as well). */
  upgrade?: UpgradeResult;
  /** Set when status starts with "aborted-". */
  reason?: string;
}

export interface RunInitOpts {
  repoRoot: string;
  /** Loaded ~/.devx/config.yaml; passed through to runInitQuestions. */
  userPrefs?: UserPrefs | null;
  /** Per-question answer provider — required for fresh init. */
  ask: AnswerProvider;
  /** Confirm provider for inferred-default acceptance. Defaults to `() => true`. */
  confirm?: ConfirmProvider;
  /** Halt-and-confirm decision provider. Returning false aborts the run. */
  onHalt?: (halt: HaltAndConfirm) => boolean | Promise<boolean>;
  /** Resolver for the 6+ archetypes case (init-personas overflow path). */
  resolveOverflow?: ResolveOverflow;
  /** Inject a fixed `now` so timestamps in written files are reproducible. */
  now?: () => Date;

  // ---- IO seams (forwarded to the underlying modules) ----
  /** Override init-state's git/env probes. */
  detectOpts?: Omit<DetectOpts, "repoRoot">;
  /** Inject the gh CLI used by writeInitGh + supervisor install. */
  gh?: GhExec;
  /** Inject the git CLI used by writeInitGh's queue payloads. */
  git?: GitExec;
  /** Override the templates directory shared by every init-* module. */
  templatesRoot?: string;
  /** Override the .devx-cache dir used by writeInitGh's queue. */
  cacheDir?: string;
  /** Override the .git/hooks dir used by writeInitGh's pre-push hook. */
  hooksDir?: string;
  /** Override the supervisor's install/verify path. */
  supervisorOpts?: Omit<
    Parameters<typeof runInitSupervisor>[0] & object,
    "configPath"
  >;
  /** Skip the supervisor install/verify phase entirely. Useful for tests +
   *  for hosts where the user explicitly disabled the supervisor before
   *  running `/devx-init` (rare; the real path is `manager.os_supervisor:
   *  none` in the config, but tests want to bypass without touching the
   *  rendered config). When true, `fresh.supervisor` is set to a sentinel
   *  "skipped-by-caller" outcome. */
  skipSupervisor?: boolean;
  /** Override upgrade-mode opts when the orchestrator routes to runInitUpgrade. */
  upgradeOpts?: Partial<Omit<RunInitUpgradeOpts, "repoRoot" | "configPath">>;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function runInit(opts: RunInitOpts): Promise<OrchestratorResult> {
  // Forward the top-level git stub into detectInitState too — otherwise the
  // state probe uses the real git CLI and tests that synthesize a remote via
  // `opts.git` would observe `hasRemote: false` (the real tmp repo has no
  // origin), and writeInitGh would take the no-remote branch instead of the
  // intended gh-not-auth branch. Explicit detectOpts.git overrides win.
  const detectOpts: Parameters<typeof detectInitState>[0] = {
    repoRoot: opts.repoRoot,
    ...(opts.git ? { git: opts.git } : {}),
    ...(opts.detectOpts ?? {}),
  };
  const state = detectInitState(detectOpts);

  // ---- Corrupt-config short-circuit ---------------------------------------

  if (state.kind === "corrupt-config") {
    return {
      mode: "upgrade",
      status: "aborted-corrupt",
      reason:
        "devx.config.yaml exists but devx_version is missing — manual review required",
    };
  }

  // ---- Upgrade path -------------------------------------------------------

  if (state.kind === "already-on-devx") {
    const upgrade = await runInitUpgrade({
      repoRoot: opts.repoRoot,
      ...(opts.upgradeOpts ?? {}),
    });
    // Map runInitUpgrade's status enum into the orchestrator's. "halted-
    // corrupt" → aborted-corrupt; "aborted" (user-canceled future path) →
    // aborted-by-halt; "completed" → completed.
    const mapped: OrchestratorStatus =
      upgrade.status === "completed"
        ? "completed"
        : upgrade.status === "halted-corrupt"
          ? "aborted-corrupt"
          : "aborted-by-halt";
    return {
      mode: "upgrade",
      status: mapped,
      upgrade,
      ...(upgrade.status !== "completed" ? { reason: upgrade.reason } : {}),
    };
  }

  // ---- Fresh init: halts → questions → writes → seeds → supervisor -------

  const questions = await runInitQuestions({
    state,
    userPrefs: opts.userPrefs ?? null,
    ask: opts.ask,
    confirm: opts.confirm ?? (() => true),
    onHalt: opts.onHalt ?? (() => true),
  });

  if (questions.aborted) {
    // The halt providers + the questions module already classify the cause;
    // we just surface it so the caller doesn't have to introspect the result
    // shape.
    const reason =
      questions.abortReason === "q32-conflict"
        ? "mode×shape conflict — user opted out at confirmation"
        : `aborted at halt: ${questions.abortReason ?? "unknown"}`;
    return {
      mode: "fresh",
      status: questions.abortReason === "q32-conflict"
        ? "aborted-questions"
        : "aborted-by-halt",
      reason,
    };
  }

  const config = questions.config;

  // 1. Local writes (config + 8 backlogs + spec dirs + CLAUDE.md + .gitignore)
  const localWrites = writeInitFiles({
    repoRoot: opts.repoRoot,
    config,
    state,
    transcript: questions.transcript,
    ...(opts.templatesRoot ? { templatesRoot: opts.templatesRoot } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });

  // 2. PR template (prt101) — Phase 1 site supersedes the Phase 0 ini503 site
  //    that lived under writeInitGh. Default templates root is ../templates/
  //    (parent of init/), but if the caller passed templatesRoot pointing at
  //    .../init/ to drive the rest of init-* modules, climb one level so the
  //    canonical pull_request_template.md is found at
  //    `<templatesRoot>/pull_request_template.md`.
  const prTemplateRoot = opts.templatesRoot
    ? resolvePrTemplateRoot(opts.templatesRoot)
    : undefined;
  const prTemplate = writePrTemplate(opts.repoRoot, {
    ...(prTemplateRoot ? { templatesRoot: prTemplateRoot } : {}),
  });

  // 3. GitHub-side writes (workflows + branch ops; PR template handled above)
  const githubWrites = writeInitGh({
    repoRoot: opts.repoRoot,
    config,
    state,
    ...(opts.templatesRoot ? { templatesRoot: opts.templatesRoot } : {}),
    ...(opts.cacheDir ? { cacheDir: opts.cacheDir } : {}),
    ...(opts.hooksDir ? { hooksDir: opts.hooksDir } : {}),
    ...(opts.gh ? { gh: opts.gh } : {}),
    ...(opts.git ? { git: opts.git } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });

  // 4. Personas (N3-driven)
  const personas = await seedPersonas({
    repoRoot: opts.repoRoot,
    whoFor: typeof questions.answers.n3 === "string" ? questions.answers.n3 : "",
    ...(opts.templatesRoot ? { templatesRoot: opts.templatesRoot } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.resolveOverflow ? { resolveOverflow: opts.resolveOverflow } : {}),
  });

  // 5. INTERVIEW seed (stack-templated)
  const interview = seedInterview({
    repoRoot: opts.repoRoot,
    stack: state.detectedStack,
    ...(opts.templatesRoot ? { templatesRoot: opts.templatesRoot } : {}),
  });

  // 6. Supervisor install + verify (idempotent; verify failure is informational)
  const configPath = localWrites.configPath;
  const supervisor: InitSupervisorResult = opts.skipSupervisor
    ? {
        platform: "none",
        source: "config",
        roles: [
          { role: "manager", status: "skipped", reason: "config-none" },
          { role: "concierge", status: "skipped", reason: "config-none" },
        ],
        wslCrossover: {
          detected: false,
          prefix: null,
          onWindowsHost: false,
          manualMdFiled: false,
        },
      }
    : runInitSupervisor({
        configPath,
        ...(opts.supervisorOpts ?? {}),
      });

  // 7. Failure-mode bookkeeping. writeInitGh emits one ManualEntry per
  //    degraded path it took (no-remote, gh-not-auth, missing-scopes,
  //    private-free-tier). Each gets routed to the matching ini506 handler
  //    so init_partial flips and MANUAL.md gets the entry. The handlers are
  //    idempotent — re-runs do not duplicate entries.
  const failureBookkeeping: Array<{
    kind: "no-remote" | "gh-not-authenticated" | "gh-missing-scopes" | "private-free-tier";
    flagFlipped: boolean;
    manualAppended: boolean;
  }> = [];
  for (const entry of githubWrites.manualEntries) {
    const out = applyFailureBookkeeping({
      repoRoot: opts.repoRoot,
      configPath,
      manualEntry: entry,
      now: opts.now,
    });
    failureBookkeeping.push({
      kind: entry.kind,
      flagFlipped: out.flagFlipped,
      manualAppended: out.manualAppended,
    });
  }

  return {
    mode: "fresh",
    status: "completed",
    fresh: {
      state,
      questions,
      localWrites,
      prTemplate,
      githubWrites,
      personas,
      interview,
      supervisor,
      failureBookkeeping,
    },
  };
}

// ---------------------------------------------------------------------------
// Failure-mode dispatch
// ---------------------------------------------------------------------------

interface ApplyFailureOpts {
  repoRoot: string;
  configPath: string;
  manualEntry: ManualEntry;
  now?: () => Date;
}

interface ApplyFailureOutcome {
  flagFlipped: boolean;
  manualAppended: boolean;
}

function applyFailureBookkeeping(opts: ApplyFailureOpts): ApplyFailureOutcome {
  // no-remote is its own handler (forces promotion.gate to manual-only). The
  // other three paths (gh-not-auth, gh-missing-scopes, private-free-tier)
  // share the same MANUAL-append + flag-flip behavior.
  const args = {
    repoRoot: opts.repoRoot,
    manualEntry: opts.manualEntry,
    configPath: opts.configPath,
    ...(opts.now ? { now: opts.now } : {}),
  };
  if (opts.manualEntry.kind === "no-remote") {
    const r = handleNoRemote(args);
    return { flagFlipped: r.flagFlipped, manualAppended: r.manualAppended };
  }
  const r = handleGhNotAuth(args);
  return { flagFlipped: r.flagFlipped, manualAppended: r.manualAppended };
}

// ---------------------------------------------------------------------------
// PR-template root resolution
//
// The shared `templatesRoot` opt that callers thread through every init-*
// module points at `_devx/templates/init/` (where workflows, personas, etc.
// live). The canonical PR template lives one level up at
// `_devx/templates/pull_request_template.md` (per the prt101 spec). When a
// caller overrides templatesRoot for tests we honor the override but climb
// one directory iff the override ends in `init/`. Otherwise we let the
// caller-supplied root stand as-is (test fixtures that pre-stage a flat
// templates dir).
// ---------------------------------------------------------------------------

function resolvePrTemplateRoot(initTemplatesRoot: string): string {
  const trimmed = initTemplatesRoot.replace(/[/\\]+$/, "");
  const lastSep = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const base = lastSep === -1 ? trimmed : trimmed.slice(lastSep + 1);
  if (base === "init") {
    return trimmed.slice(0, lastSep === -1 ? 0 : lastSep);
  }
  return initTemplatesRoot;
}

// ---------------------------------------------------------------------------
// Convenience: scripted-answer provider for tests + the slash command's
// "scripted-mode" path (when the user supplies `/devx-init <preset>`).
// ---------------------------------------------------------------------------

export interface ScriptedAnswers {
  n1?: string;
  n2?: string;
  n3?: string;
  n4?: "solo" | "team";
  n5?: string;
  n6?: import("./init-state.js").ProjectShape;
  n7?: import("./init-questions.js").Mode;
  n8?: import("./init-questions.js").GitStrategy;
  n9?: { initialN: number; rollbackPenalty?: number };
  n10?: string[];
  n11?: {
    ciProvider?: "github-actions" | "none";
    browserHarness?: "playwright" | "cypress" | "none";
  };
  n12?: number | null;
  n13?: { channels?: unknown[]; quietHours?: string | null };
}

/** Build an AnswerProvider that returns the scripted answer for each question
 *  id. Useful for ini508's e2e suite — pass a partial map and any question
 *  not covered falls through to the inferred default (which the question
 *  flow already handles via the skip-table). Throws on truly-unanswered
 *  questions so the test can't silently take a wrong default. */
export function scriptedAsk(answers: ScriptedAnswers): AnswerProvider {
  return (ctx) => {
    const id = ctx.question.id as keyof ScriptedAnswers;
    if (id in answers) {
      return answers[id];
    }
    if (ctx.inferredDefault !== undefined) {
      return ctx.inferredDefault;
    }
    throw new Error(
      `scriptedAsk: no answer for ${ctx.question.id} and no inferred default — extend the script`,
    );
  };
}
