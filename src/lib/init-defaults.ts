// Non-interactive AnswerProvider for bare `devx init` (pin103).
//
// The scaffold path is `detectInitState()` → buildDefaultsAsk(state) →
// `runInit({ask})` → `installSkills()`. This module owns ONLY the answers:
// stack-derived where the repo can tell us (n5/n6/n7/n10/n11), conservative
// devx defaults elsewhere, and — per the no-silent-product-decisions
// agreement — every answer we invented rather than derived is recorded as a
// DeferredDecision the CLI appends to INTERVIEW.md after the scaffold lands
// (the same artifact `/devx-init` seeds; seedInterview itself only fires on
// an empty-state INTERVIEW.md, so the CLI uses appendDeferredDecisions for
// these).
//
// Zero write logic here beyond appendDeferredDecisions; orchestrator +
// init-write + init-upgrade + init-skills own the scaffold writes.
//
// Spec: dev/dev-pin103-2026-07-14T12:02-init-noninteractive-scaffold.md
// Plan: _devx/workstreams/portability-install/plan.md § Phase 3

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { AnswerProvider, GitStrategy, Mode, QuestionId } from "./init-questions.js";
import type { HaltAndConfirm, InitState, ProjectShape } from "./init-state.js";
import { acquirePathLockBlocking } from "./manage/lock.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A product decision the defaults provider answered with a placeholder or
 *  an assumption the user should review. Rendered into INTERVIEW.md by
 *  appendDeferredDecisions after the scaffold lands. */
export interface DeferredDecision {
  /** Question id (n1..n13), "q32" (mode×shape conflict halt), a halt kind
   *  ("halt-uncommitted-changes", …), or "detached-head". Doubles as the
   *  INTERVIEW.md idempotency-anchor key. */
  questionId: QuestionId | "q32" | string;
  /** The question as the user would have seen it. */
  prompt: string;
  /** Human-readable rendering of the default the scaffold took. */
  chosen: string;
  /** Why this could not be derived from the repo. */
  why: string;
}

export interface DefaultsAsk {
  ask: AnswerProvider;
  /** Halt handler for the orchestrator: records every proceeded non-fatal
   *  halt as a DeferredDecision (and warns) instead of silently waving it
   *  through — a non-interactive run has no legitimate answer to
   *  stash/commit/abort menus, so the record IS the answer. Always returns
   *  true; fatal halts abort inside the flow regardless. */
  onHalt: (halt: HaltAndConfirm) => boolean;
  /** Populated as questions are answered — read AFTER runInit resolves. */
  deferred: DeferredDecision[];
}

export interface BuildDefaultsAskOpts {
  /** Warn sink for bypassed halts + detached-HEAD notice. Default stderr. */
  warn?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

const N1_PLACEHOLDER =
  "Scaffolded non-interactively — describe what this project builds (see INTERVIEW.md).";
const N2_PLACEHOLDER =
  "Scaffolded non-interactively — pick the smallest demo that matters (see INTERVIEW.md).";

/** Stack → bash allow-list additions. `empty`/`mixed` fall through to the
 *  full hint list — an unknown stack shouldn't strand agents without their
 *  package manager. */
const STACK_ALLOW: Readonly<Record<string, ReadonlyArray<string>>> = {
  typescript: ["npm", "pnpm", "yarn", "node", "npx"],
  python: ["pip", "pytest", "python"],
  rust: ["cargo"],
  go: ["go"],
  flutter: ["dart", "flutter"],
};

const FULL_ALLOW: ReadonlyArray<string> = [
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
];

export function buildDefaultsAsk(state: InitState, opts: BuildDefaultsAskOpts = {}): DefaultsAsk {
  const deferred: DeferredDecision[] = [];
  const warn = opts.warn ?? ((msg) => process.stderr.write(`devx init: ${msg}\n`));

  // Derived once so n6/n7/n8/n9 stay mutually consistent even though the
  // question flow feeds them to us one at a time. MUST mirror the skip
  // table's silent inferences (init-questions.ts evaluateSkipTable): n7 is
  // silently answered PROD when inferredShape is production-careful — if we
  // recomputed mode differently here, the asked n8/n9 answers would be
  // derived from a mode the flow didn't land (the pin103 3-agent review's
  // top finding: PROD config with single-branch/initial_n=0).
  const mode: Mode =
    state.hasProdEnvVars || state.inferredShape === "production-careful"
      ? "PROD"
      : "YOLO";
  // Commits without a stack probe file (docs repo, Makefile project) is an
  // EXISTING codebase, not an empty dream — take the conservative arm.
  const shape: ProjectShape =
    state.inferredShape ??
    (state.detectedStack === "empty" && !state.hasCommits
      ? "empty-dream"
      : "mature-refactor-and-add");
  const gitStrategy: GitStrategy =
    mode === "YOLO" ? "single-branch" : "develop-main-split";

  // Detached HEAD never fires a halt (init-state skips the non-default-
  // branch check when currentBranch is null) — record it ourselves.
  if (state.hasCommits && state.currentBranch === null) {
    warn("HEAD is detached — scaffolding from a detached commit; check out a branch before running /devx");
    deferred.push({
      questionId: "detached-head",
      prompt: "Scaffold ran on a detached HEAD",
      chosen: "proceeded anyway (non-interactive)",
      why: "the claim/PR machinery assumes a branch; check out a branch and confirm the scaffold landed where you meant",
    });
  }

  // Every non-fatal halt the interactive flow would menu (uncommitted
  // changes, non-default branch, mode×shape conflict) is proceeded-through
  // AND recorded — never silently bypassed. Fatal halts abort in the flow.
  const onHalt = (halt: HaltAndConfirm): boolean => {
    warn(`proceeding through halt '${halt.kind}': ${halt.message}`);
    deferred.push({
      questionId: halt.kind === "mode-shape-conflict" ? "q32" : `halt-${halt.kind}`,
      prompt:
        halt.kind === "mode-shape-conflict"
          ? "Mode × project-shape conflict"
          : `Init halt bypassed non-interactively: ${halt.kind}`,
      chosen:
        halt.kind === "mode-shape-conflict"
          ? `locked mode=${mode}, shape=${shape} anyway`
          : "proceeded anyway (non-interactive runs can't answer the interactive menu)",
      why: halt.message,
    });
    return true;
  };

  const ask: AnswerProvider = (ctx) => {
    // Confirm-path robustness: if the flow ever hands us an inferred
    // default, accept it (mirrors scriptedAsk's fallthrough).
    if (ctx.inferredDefault !== undefined) return ctx.inferredDefault;

    switch (ctx.question.id) {
      case "n1":
        if (state.readmeFirstParagraph) return state.readmeFirstParagraph;
        deferred.push({
          questionId: "n1",
          prompt: ctx.question.prompt,
          chosen: `placeholder ("${N1_PLACEHOLDER}")`,
          why: "no README to derive the project description from",
        });
        return N1_PLACEHOLDER;
      case "n2":
        deferred.push({
          questionId: "n2",
          prompt: ctx.question.prompt,
          chosen: `placeholder ("${N2_PLACEHOLDER}")`,
          why: "the first slice is a product decision no repo probe can make",
        });
        return N2_PLACEHOLDER;
      case "n3":
        deferred.push({
          questionId: "n3",
          prompt: ctx.question.prompt,
          chosen: "\"you propose\" — devx drafted the persona panel under focus-group/",
          why: "audience is a product decision; review the proposed panel",
        });
        return "you propose";
      case "n4":
        return "solo";
      case "n5":
        return state.detectedStack;
      case "n6":
        // Asked at all ⇒ the skip table couldn't infer the shape — our value
        // is a guess, not a derivation. Record it.
        if (state.inferredShape === null) {
          deferred.push({
            questionId: "n6",
            prompt: ctx.question.prompt,
            chosen: shape,
            why: "repo state was ambiguous (no tests+tags signal); confirm the project shape",
          });
        }
        return shape;
      case "n7":
        // Asked at all ⇒ no prod-env-vars / production-careful inference
        // fired in the skip table — mode is our guess. Record it.
        deferred.push({
          questionId: "n7",
          prompt: ctx.question.prompt,
          chosen: mode,
          why: state.hasProdEnvVars
            ? "prod env vars detected"
            : "no real-user signal detected; YOLO is the pre-launch default — bump the mode when users arrive",
        });
        return mode;
      case "n8":
        return gitStrategy;
      case "n9":
        return { initialN: mode === "YOLO" ? 0 : 3 };
      case "n10": {
        const extra = STACK_ALLOW[state.detectedStack];
        return extra ? ["git", "gh", ...extra] : [...FULL_ALLOW];
      }
      case "n11":
        // devx scaffolds .github/workflows either way; browser harness is an
        // install-weight assumption we don't make unattended.
        return { ciProvider: "github-actions" as const, browserHarness: "none" as const };
      case "n12":
        return null;
      case "n13":
        // No address to notify unattended; empty channels is the only honest
        // default. (buildConfig coalesces the null quietHours to its own
        // "22:00-08:00" default — inert while channels is empty.)
        return { channels: [], quietHours: null };
      default:
        // A new question landed without a non-interactive default — fail
        // loud so bare `devx init` can't silently invent an answer.
        throw new Error(
          `defaults AnswerProvider: no non-interactive default for question '${ctx.question.id}' — extend init-defaults.ts`,
        );
    }
  };

  return { ask, onHalt, deferred };
}

// ---------------------------------------------------------------------------
// INTERVIEW.md append for deferred decisions
// ---------------------------------------------------------------------------

const DEFERRED_ANCHOR_PREFIX = "<!-- devx:init-defaults:";
const DEFERRED_ANCHOR_SUFFIX = " -->";

export interface AppendDeferredResult {
  appended: number;
  skipped: number;
  targetPath: string;
}

/** Append one `## (from devx init)` section per deferred decision to
 *  INTERVIEW.md. Idempotent per questionId via an HTML-comment anchor
 *  (appendManualEntry's pattern), and serialized under the same O_EXCL lock
 *  family (debug-9c4e21) so a concurrent writer is never clobbered. The
 *  target must already exist — init-write scaffolds INTERVIEW.md before this
 *  runs; a missing file means the call order is broken and we surface it. */
export function appendDeferredDecisions(opts: {
  repoRoot: string;
  deferred: ReadonlyArray<DeferredDecision>;
  interviewPath?: string;
}): AppendDeferredResult {
  const targetPath = opts.interviewPath ?? join(opts.repoRoot, "INTERVIEW.md");
  if (opts.deferred.length === 0) {
    return { appended: 0, skipped: 0, targetPath };
  }
  if (!existsSync(targetPath)) {
    throw new Error(
      `appendDeferredDecisions: ${targetPath} does not exist; init-write must scaffold INTERVIEW.md first`,
    );
  }

  const lock = acquirePathLockBlocking(
    join(opts.repoRoot, ".devx-cache", "locks", "interview-append.lock"),
  );
  try {
    let content = readFileSync(targetPath, "utf8").replace(/\r\n/g, "\n");
    let appended = 0;
    let skipped = 0;
    for (const d of opts.deferred) {
      const anchor = `${DEFERRED_ANCHOR_PREFIX}${d.questionId}${DEFERRED_ANCHOR_SUFFIX}`;
      if (content.includes(anchor)) {
        skipped += 1;
        continue;
      }
      const section = [
        "",
        `## (from devx init) ${d.prompt} ${anchor}`,
        "",
        `Non-interactive scaffold took a default: ${d.chosen}.`,
        `Why it needs you: ${d.why}.`,
        "",
        `- [ ] Confirm or replace this default.`,
        "",
      ].join("\n");
      content = `${content.replace(/\n*$/, "\n")}${section}`;
      appended += 1;
    }
    if (appended > 0) writeAtomic(targetPath, content);
    return { appended, skipped, targetPath };
  } finally {
    lock.release();
  }
}
