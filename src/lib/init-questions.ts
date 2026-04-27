// 13-question flow + skip-table evaluator + config builder for `/devx-init`
// (ini501).
//
// Public surface:
//   - QUESTIONS                — readonly N1..N13 in narrative order (FR-A).
//   - evaluateSkipTable(...)   — pure: maps state + user prefs → skip decisions.
//   - buildConfig(...)         — pure: maps decisions + answers → partial config.
//   - runInitQuestions(...)    — orchestrator: walks the 13 in order, calls
//                                injected ask()/confirm(), returns the full
//                                {answers, config, transcript, counts} bundle.
//
// No side effects. Every prompt the user sees comes through the injected
// AnswerProvider / ConfirmProvider — this module only describes what to ask
// and assembles the result. The real `/devx-init` skill will wire stdin/tty
// providers; tests pass scripted ones.
//
// Voice (per persona-leonid + epic party-mode notes): "got it" / "locked" /
// "next" — never "Great!" or "Awesome!".
//
// Spec: dev/dev-ini501-2026-04-26T19:35-init-question-flow.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import type {
  HaltAndConfirm,
  InitState,
  ProjectShape,
} from "./init-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionId =
  | "n1"
  | "n2"
  | "n3"
  | "n4"
  | "n5"
  | "n6"
  | "n7"
  | "n8"
  | "n9"
  | "n10"
  | "n11"
  | "n12"
  | "n13";

export type Mode = "YOLO" | "BETA" | "PROD" | "LOCKDOWN";

export type GitStrategy = "single-branch" | "develop-main-split";

export interface Question {
  id: QuestionId;
  /** The prompt text shown to the user. */
  prompt: string;
  /** Optional one-line hint shown under the prompt. */
  hint?: string;
}

export interface SkipDecision<T = unknown> {
  /** Human-readable reason for the inferred default. */
  reason: string;
  /** The inferred default value for the question. */
  defaultValue: T;
  /** When true, the orchestrator must ask the user to confirm — it still
   *  counts as one prompt shown. */
  requiresConfirm: boolean;
}

export type Skips = Partial<Record<QuestionId, SkipDecision>>;

/** What the AnswerProvider receives for each question. */
export interface AskContext {
  question: Question;
  /** Present when the question would normally be skipped but requires
   *  explicit confirmation. */
  inferredDefault?: unknown;
  /** Reason for the inferred default. */
  reason?: string;
  /** If the user has provided context for similar questions in their
   *  ~/.devx/config.yaml, that path is included so providers can echo it. */
  userConfigPath?: string;
}

export type AnswerProvider = (ctx: AskContext) => unknown | Promise<unknown>;
export type ConfirmProvider = (ctx: AskContext) => boolean | Promise<boolean>;

export type TranscriptEntryKind =
  | "asked" // user supplied a freeform answer
  | "confirmed" // user accepted an inferred default
  | "rejected-default" // user rejected an inferred default and supplied their own
  | "inferred-silently"; // skipped, default applied without prompting

export interface TranscriptEntry {
  id: QuestionId;
  kind: TranscriptEntryKind;
  value: unknown;
  reason?: string;
}

export interface RunInitOpts {
  state: InitState;
  /** Loaded ~/.devx/config.yaml (if any). Plain JS object, project values
   *  not merged. */
  userPrefs?: UserPrefs | null;
  ask: AnswerProvider;
  /** Defaults to (ctx) => true — useful for tests where every confirm is
   *  accepted automatically. */
  confirm?: ConfirmProvider;
  /** Callback fired for every halt-and-confirm before questions begin and
   *  for the optional Q32 mode×shape conflict halt after N7. The handler
   *  decides whether to abort. Returning false aborts the run. */
  onHalt?: (halt: HaltAndConfirm) => boolean | Promise<boolean>;
}

/** Subset of ~/.devx/config.yaml fields the question flow consults. */
export interface UserPrefs {
  promotion?: {
    autonomy?: {
      initial_n?: number;
      rollback_penalty?: number;
    };
  };
  permissions?: {
    bash?: {
      allow?: string[];
    };
  };
  capacity?: {
    daily_spend_cap_usd?: number;
  };
  notifications?: {
    channels?: unknown[];
    quiet_hours?: string;
  };
}

export interface InitCounts {
  /** Questions where the user typed a fresh answer. */
  asked: number;
  /** Questions where the user accepted an inferred default. */
  confirmed: number;
  /** Questions where a default was applied silently (no prompt). */
  inferredSilently: number;
  /** Always 13. */
  total: number;
  /** asked + confirmed — the human-attention number. */
  promptsShown: number;
}

export interface RunInitResult {
  /** Final canonical answer per question, regardless of source. */
  answers: Record<QuestionId, unknown>;
  /** Partial devx.config.yaml shape — caller writes via init-write.ts (ini502). */
  config: PartialConfig;
  /** Ordered audit trail of how each question landed. */
  transcript: TranscriptEntry[];
  /** Skip decisions evaluated up front. */
  skips: Skips;
  counts: InitCounts;
  /** True iff onHalt told us to abort. */
  aborted: boolean;
  abortReason?: string;
}

// ---------------------------------------------------------------------------
// PartialConfig — the shape buildConfig produces.
// ---------------------------------------------------------------------------

export interface PartialConfig {
  devx_version: string;
  mode: Mode;
  project: { shape: ProjectShape };
  thoroughness?: "send-it" | "balanced" | "thorough";
  capacity?: { daily_spend_cap_usd?: number | null };
  permissions?: { bash?: { allow?: string[] } };
  git?: {
    integration_branch?: string | null;
    branch_prefix?: string;
    pr_strategy?: "direct-to-main" | "pr-to-main" | "pr-to-develop";
    protect_main?: boolean;
  };
  promotion?: {
    autonomy?: { initial_n?: number; rollback_penalty?: number };
  };
  ci?: { provider?: "github-actions" | "none" };
  qa?: { browser_harness?: "playwright" | "cypress" | "none" };
  notifications?: {
    channels?: unknown[];
    quiet_hours?: string;
  };
  // Internal context — ini502 strips this before writing devx.config.yaml.
  // Consumed by the /devx-init narrative (greeting echo, hand-off summary).
  _meta: {
    plan_seed: string;
    first_slice: string;
    who_for: string;
    team_size: "solo" | "team";
    stack_description: string;
  };
  /** Set true by ini506 when init has deferred work. ini501 never sets it
   *  but the field is reserved here so buildConfig has a single canonical
   *  shape across the epic. */
  init_partial?: boolean;
}

// ---------------------------------------------------------------------------
// QUESTIONS — N1..N13 in narrative order (FR-A).
// ---------------------------------------------------------------------------

export const QUESTIONS: readonly Question[] = Object.freeze([
  {
    id: "n1",
    prompt: "What are you building?",
    hint: "one or two sentences — this seeds PLAN.md and drives the PRD.",
  },
  {
    id: "n2",
    prompt: "First slice — what's the smallest demo that matters?",
    hint: "becomes the first dev/dev-*.md spec.",
  },
  {
    id: "n3",
    prompt: "Who's it for?",
    hint:
      "either list 4-6 archetypes (\"founders, devs, designers, ...\") or say \"you propose\".",
  },
  {
    id: "n4",
    prompt: "Solo or team?",
    hint: "shapes persona priorities + ceremony defaults.",
  },
  {
    id: "n5",
    prompt: "Stack — language(s), framework(s), runtime(s)?",
    hint: "drives language_runners + harness defaults.",
  },
  {
    id: "n6",
    prompt:
      "Project shape — empty-dream, bootstrapped-rewriting, mature-refactor-and-add, mature-yolo-rewrites, or production-careful?",
    hint: "see docs/DESIGN.md §Project shapes for what each means.",
  },
  {
    id: "n7",
    prompt: "Real users today, or pre-launch?",
    hint:
      "real users → PROD; pre-launch dogfood → YOLO; in-between → BETA; frozen → LOCKDOWN.",
  },
  {
    id: "n8",
    prompt:
      "Git strategy — single-branch on main, or develop/main split with branch protection?",
    hint:
      "solo + YOLO usually picks single-branch; team or PROD usually picks the split.",
  },
  {
    id: "n9",
    prompt:
      "Promotion / autonomy ladder — initial trust threshold N (commits before agent merges land unattended)?",
    hint: "0 = full autonomy from commit 1 (YOLO default); higher = more guardrail.",
  },
  {
    id: "n10",
    prompt:
      "Permissions — which bash commands should agents be allowed to run unprompted?",
    hint:
      "the usual safe list: git, gh, npm, pnpm, yarn, pip, pytest, cargo, go, dart, flutter, etc.",
  },
  {
    id: "n11",
    prompt:
      "Infra — CI provider (github-actions / none) and browser harness (playwright / cypress / none)?",
    hint: "github-actions + playwright is the devx default.",
  },
  {
    id: "n12",
    prompt: "Daily cost cap (USD)? Leave blank for no cap.",
    hint: "for solo dogfood, blank or a small number ($5-$50) is fine.",
  },
  {
    id: "n13",
    prompt: "Notifications — email / push / digest? Quiet hours?",
    hint:
      "default: email digest at 09:00 + push only for INTERVIEW + MANUAL + system-critical.",
  },
]);

// ---------------------------------------------------------------------------
// Skip-table evaluator
// ---------------------------------------------------------------------------

export function evaluateSkipTable(
  state: InitState,
  userPrefs: UserPrefs | null = null,
): Skips {
  const skips: Skips = {};

  // N1 — README first paragraph proposed; user confirms (counts as a prompt).
  if (state.hasReadme && state.readmeFirstParagraph) {
    skips.n1 = {
      reason: "README.md detected — first paragraph proposed",
      defaultValue: state.readmeFirstParagraph,
      requiresConfirm: true,
    };
  }

  // N3 — personas already on disk: reuse silently.
  if (state.personasPopulated) {
    skips.n3 = {
      reason: "focus-group/personas/ already populated — reusing",
      defaultValue: "(reusing existing personas/)",
      requiresConfirm: false,
    };
  }

  // N4 — multi-author git history → team (silent inference).
  // Skip-table row labelled N5 in PRD applies semantically to N4 (Solo or team?).
  if (state.multipleAuthorsLast90d) {
    skips.n4 = {
      reason: "git shortlog shows >1 author in last 90d — team",
      defaultValue: "team",
      requiresConfirm: false,
    };
  }

  // N5 — single-stack file detected → infer silently. "mixed" stays unasked
  // because we have no way to pick a primary stack from probe data alone.
  if (
    state.detectedStack !== "empty" &&
    state.detectedStack !== "mixed" &&
    state.detectedStackFile
  ) {
    skips.n5 = {
      reason: `${state.detectedStackFile} detected — stack inferred as ${state.detectedStack}`,
      defaultValue: state.detectedStack,
      requiresConfirm: false,
    };
  }

  // N6 — project shape inferable from repo state.
  if (state.inferredShape !== null) {
    skips.n6 = {
      reason:
        state.inferredShape === "empty-dream"
          ? "empty repo — empty-dream"
          : "commits + tests + tags detected — production-careful (please confirm)",
      defaultValue: state.inferredShape,
      requiresConfirm: state.inferredShape !== "empty-dream",
    };
  }

  // N7 — mode inferred from prod env vars OR from project shape. Silent
  // because shape already gates user attention (and prod env vars are
  // overwhelming evidence). User can override via /devx-mode later.
  if (state.hasProdEnvVars) {
    skips.n7 = {
      reason: "production env vars detected — mode=PROD",
      defaultValue: "PROD",
      requiresConfirm: false,
    };
  } else if (state.inferredShape === "empty-dream") {
    skips.n7 = {
      reason: "empty-dream + no prod signals — mode=YOLO",
      defaultValue: "YOLO",
      requiresConfirm: false,
    };
  } else if (state.inferredShape === "production-careful") {
    skips.n7 = {
      reason: "production-careful shape → mode=PROD",
      defaultValue: "PROD",
      requiresConfirm: false,
    };
  }

  // N8 — develop branch + protected main → keep develop/main split.
  if (state.developBranchExists && state.mainProtected) {
    skips.n8 = {
      reason: "develop branch exists + main protected — keeping the split",
      defaultValue: "develop-main-split",
      requiresConfirm: false,
    };
  }

  // N9 — user prefs carry an autonomy default? Reuse silently.
  const userInitialN = userPrefs?.promotion?.autonomy?.initial_n;
  if (typeof userInitialN === "number") {
    skips.n9 = {
      reason: "~/.devx/config.yaml has promotion.autonomy.initial_n — reusing",
      defaultValue: {
        initialN: userInitialN,
        rollbackPenalty:
          userPrefs?.promotion?.autonomy?.rollback_penalty ?? 0.5,
      },
      requiresConfirm: false,
    };
  }

  // N10 — user prefs carry a bash allow-list? Reuse silently.
  const userBashAllow = userPrefs?.permissions?.bash?.allow;
  if (Array.isArray(userBashAllow) && userBashAllow.length > 0) {
    skips.n10 = {
      reason: "~/.devx/config.yaml has permissions.bash.allow — reusing",
      defaultValue: userBashAllow,
      requiresConfirm: false,
    };
  }

  // N11 — github-actions workflows already present.
  if (state.hasGithubWorkflows) {
    skips.n11 = {
      reason: ".github/workflows/* present — ci.provider=github-actions",
      defaultValue: { ciProvider: "github-actions", browserHarness: "playwright" },
      requiresConfirm: false,
    };
  }

  // N12 — user prefs carry a daily cap? Reuse silently.
  const userCap = userPrefs?.capacity?.daily_spend_cap_usd;
  if (typeof userCap === "number") {
    skips.n12 = {
      reason: "~/.devx/config.yaml has capacity.daily_spend_cap_usd — reusing",
      defaultValue: userCap,
      requiresConfirm: false,
    };
  }

  // N13 — any user-prefs notifications config → reuse.
  if (
    userPrefs?.notifications?.channels !== undefined ||
    userPrefs?.notifications?.quiet_hours !== undefined
  ) {
    skips.n13 = {
      reason: "~/.devx/config.yaml has notifications.* — reusing",
      defaultValue: {
        channels: userPrefs.notifications.channels ?? [],
        quietHours: userPrefs.notifications.quiet_hours ?? null,
      },
      requiresConfirm: false,
    };
  }

  return skips;
}

// ---------------------------------------------------------------------------
// Q32 mode×shape conflict — see epic party-mode critique.
// ---------------------------------------------------------------------------

const Q32_CONFLICT_PAIRS: ReadonlyArray<{ mode: Mode; shape: ProjectShape; reason: string }> = [
  {
    mode: "YOLO",
    shape: "production-careful",
    reason:
      "YOLO + production-careful contradicts itself — YOLO disables the gates production-careful exists to enforce.",
  },
  {
    mode: "PROD",
    shape: "empty-dream",
    reason:
      "PROD + empty-dream contradicts itself — PROD demands gates that empty-dream is meant to skip.",
  },
];

export function detectQ32Conflict(
  mode: Mode,
  shape: ProjectShape,
): HaltAndConfirm | null {
  const hit = Q32_CONFLICT_PAIRS.find((p) => p.mode === mode && p.shape === shape);
  if (!hit) return null;
  return {
    kind: "mode-shape-conflict",
    message: `mode×shape conflict: ${hit.reason}`,
    options: [
      { key: "y", label: "lock-anyway" },
      { key: "n", label: "go-back-and-change" },
      { key: "a", label: "abort" },
    ],
    fatal: false,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runInitQuestions(opts: RunInitOpts): Promise<RunInitResult> {
  const { state, ask } = opts;
  const userPrefs = opts.userPrefs ?? null;
  const confirm = opts.confirm ?? (() => true);
  const onHalt = opts.onHalt ?? (() => true);

  // 1. Halt-and-confirm prompts (state-derived) before any question runs.
  for (const halt of state.halts) {
    const proceed = await onHalt(halt);
    if (!proceed || halt.fatal) {
      return {
        answers: emptyAnswers(),
        config: emptyConfig(),
        transcript: [],
        skips: {},
        counts: zeroCounts(),
        aborted: true,
        abortReason: halt.kind,
      };
    }
  }

  const skips = evaluateSkipTable(state, userPrefs);
  const transcript: TranscriptEntry[] = [];
  const answers: Record<QuestionId, unknown> = {} as Record<QuestionId, unknown>;
  let asked = 0;
  let confirmed = 0;
  let inferredSilently = 0;

  for (const q of QUESTIONS) {
    const skip = skips[q.id];
    const askCtx: AskContext = {
      question: q,
      inferredDefault: skip?.defaultValue,
      reason: skip?.reason,
      userConfigPath: state.userConfigPath,
    };

    if (!skip) {
      // Plain ask path.
      const answer = await ask(askCtx);
      answers[q.id] = answer;
      transcript.push({ id: q.id, kind: "asked", value: answer });
      asked += 1;
      // Mode×shape conflict check after N7 lands.
      if (q.id === "n7") {
        const maybeConflict = await maybeFireQ32(answers, onHalt);
        if (maybeConflict.aborted) {
          return abortedResult(answers, transcript, skips, asked, confirmed, inferredSilently, maybeConflict.reason ?? "q32-conflict");
        }
      }
      continue;
    }

    if (!skip.requiresConfirm) {
      // Silent inference.
      answers[q.id] = skip.defaultValue;
      transcript.push({
        id: q.id,
        kind: "inferred-silently",
        value: skip.defaultValue,
        reason: skip.reason,
      });
      inferredSilently += 1;
      if (q.id === "n7") {
        const maybeConflict = await maybeFireQ32(answers, onHalt);
        if (maybeConflict.aborted) {
          return abortedResult(answers, transcript, skips, asked, confirmed, inferredSilently, maybeConflict.reason ?? "q32-conflict");
        }
      }
      continue;
    }

    // Confirm path — show the inferred default, ask for ack.
    const accepted = await confirm(askCtx);
    if (accepted) {
      answers[q.id] = skip.defaultValue;
      transcript.push({
        id: q.id,
        kind: "confirmed",
        value: skip.defaultValue,
        reason: skip.reason,
      });
      confirmed += 1;
    } else {
      const overridden = await ask(askCtx);
      answers[q.id] = overridden;
      transcript.push({
        id: q.id,
        kind: "rejected-default",
        value: overridden,
        reason: skip.reason,
      });
      asked += 1;
    }
    if (q.id === "n7") {
      const maybeConflict = await maybeFireQ32(answers, onHalt);
      if (maybeConflict.aborted) {
        return abortedResult(answers, transcript, skips, asked, confirmed, inferredSilently, maybeConflict.reason ?? "q32-conflict");
      }
    }
  }

  const config = buildConfig(state, answers as Record<QuestionId, unknown>);

  return {
    answers,
    config,
    transcript,
    skips,
    counts: {
      asked,
      confirmed,
      inferredSilently,
      total: QUESTIONS.length,
      promptsShown: asked + confirmed,
    },
    aborted: false,
  };
}

async function maybeFireQ32(
  answers: Record<QuestionId, unknown>,
  onHalt: NonNullable<RunInitOpts["onHalt"]>,
): Promise<{ aborted: boolean; reason?: string }> {
  const mode = answers.n7 as Mode | undefined;
  const shapeAnswer = answers.n6 as ProjectShape | undefined;
  if (!mode || !shapeAnswer) return { aborted: false };
  const conflict = detectQ32Conflict(mode, shapeAnswer);
  if (!conflict) return { aborted: false };
  const proceed = await onHalt(conflict);
  if (!proceed) return { aborted: true, reason: "q32-conflict" };
  return { aborted: false };
}

function abortedResult(
  answers: Record<QuestionId, unknown>,
  transcript: TranscriptEntry[],
  skips: Skips,
  asked: number,
  confirmed: number,
  inferredSilently: number,
  reason: string,
): RunInitResult {
  return {
    answers,
    config: emptyConfig(),
    transcript,
    skips,
    counts: {
      asked,
      confirmed,
      inferredSilently,
      total: QUESTIONS.length,
      promptsShown: asked + confirmed,
    },
    aborted: true,
    abortReason: reason,
  };
}

function emptyAnswers(): Record<QuestionId, unknown> {
  return {} as Record<QuestionId, unknown>;
}

function emptyConfig(): PartialConfig {
  return {
    devx_version: "",
    mode: "YOLO",
    project: { shape: "empty-dream" },
    _meta: {
      plan_seed: "",
      first_slice: "",
      who_for: "",
      team_size: "solo",
      stack_description: "",
    },
  };
}

function zeroCounts(): InitCounts {
  return {
    asked: 0,
    confirmed: 0,
    inferredSilently: 0,
    total: QUESTIONS.length,
    promptsShown: 0,
  };
}

// ---------------------------------------------------------------------------
// buildConfig — answers → partial devx.config.yaml shape
// ---------------------------------------------------------------------------

const DEFAULT_BASH_ALLOW: readonly string[] = [
  "git",
  "gh",
  "npm",
  "pnpm",
  "yarn",
  "pip",
  "pytest",
  "cargo",
  "go",
  "dart",
  "flutter",
  "playwright",
  "eslint",
  "prettier",
  "ts-node",
  "tsx",
  "node",
];

const DEVX_VERSION = "0.1.0";

export function buildConfig(
  state: InitState,
  answers: Record<QuestionId, unknown>,
): PartialConfig {
  const mode = (answers.n7 as Mode | undefined) ?? "YOLO";
  const shape = (answers.n6 as ProjectShape | undefined) ?? "empty-dream";
  const teamSize =
    (answers.n4 as "solo" | "team" | undefined) ??
    (state.multipleAuthorsLast90d ? "team" : "solo");

  const gitStrategyAnswer = answers.n8 as GitStrategy | undefined;
  const gitStrategy: GitStrategy =
    gitStrategyAnswer ??
    (mode === "PROD" || teamSize === "team"
      ? "develop-main-split"
      : "single-branch");
  const integrationBranch = gitStrategy === "develop-main-split" ? "develop" : null;
  const branchPrefix = gitStrategy === "develop-main-split" ? "develop/" : "feat/";
  const prStrategy: NonNullable<NonNullable<PartialConfig["git"]>["pr_strategy"]> =
    gitStrategy === "develop-main-split" ? "pr-to-develop" : "pr-to-main";

  const promotion = answers.n9 as
    | { initialN?: number; rollbackPenalty?: number }
    | undefined;

  const bashAllowAnswer = answers.n10 as string[] | undefined;
  const bashAllow = Array.isArray(bashAllowAnswer)
    ? bashAllowAnswer
    : [...DEFAULT_BASH_ALLOW];

  const infra = answers.n11 as
    | {
        ciProvider?: "github-actions" | "none";
        browserHarness?: "playwright" | "cypress" | "none";
      }
    | undefined;

  const dailyCap = answers.n12 as number | null | undefined;

  const notifications = answers.n13 as
    | { channels?: unknown[]; quietHours?: string | null }
    | undefined;

  const config: PartialConfig = {
    devx_version: DEVX_VERSION,
    mode,
    project: { shape },
    thoroughness: mode === "YOLO" ? "send-it" : mode === "PROD" ? "thorough" : "balanced",
    capacity: {
      daily_spend_cap_usd: typeof dailyCap === "number" ? dailyCap : null,
    },
    permissions: { bash: { allow: bashAllow } },
    git: {
      integration_branch: integrationBranch,
      branch_prefix: branchPrefix,
      pr_strategy: prStrategy,
      protect_main: gitStrategy === "develop-main-split",
    },
    promotion: {
      autonomy: {
        initial_n: promotion?.initialN ?? (mode === "YOLO" ? 0 : 5),
        rollback_penalty: promotion?.rollbackPenalty ?? 0.5,
      },
    },
    ci: { provider: infra?.ciProvider ?? "github-actions" },
    qa: { browser_harness: infra?.browserHarness ?? "playwright" },
    notifications: {
      channels: notifications?.channels ?? [
        { kind: "email", to: null, digest_only: true },
      ],
      quiet_hours: notifications?.quietHours ?? "22:00-08:00",
    },
    _meta: {
      plan_seed: typeof answers.n1 === "string" ? answers.n1 : "",
      first_slice: typeof answers.n2 === "string" ? answers.n2 : "",
      who_for: typeof answers.n3 === "string" ? answers.n3 : "",
      team_size: teamSize,
      stack_description: typeof answers.n5 === "string" ? answers.n5 : state.detectedStack,
    },
  };

  return config;
}
