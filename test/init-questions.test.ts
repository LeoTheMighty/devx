// init-questions.ts tests (ini501).
//
// Three load-bearing scenarios from the spec ACs:
//   - best-case 3   — mature returning user with ~/.devx/config.yaml
//   - worst-case 13 — empty repo, first-time user
//   - mid-case ~7   — partial signals available
//
// Plus targeted coverage of the skip-table evaluator, Q32 mode×shape
// conflict halt, and aborted-by-halt path. No real prompts: ask/confirm are
// stubbed and assertions inspect transcript + counts + config.
//
// Spec: dev/dev-ini501-2026-04-26T19:35-init-question-flow.md

import { describe, expect, it } from "vitest";

import type { InitState } from "../src/lib/init-state.js";
import {
  type AskContext,
  type QuestionId,
  type RunInitOpts,
  type Skips,
  type UserPrefs,
  QUESTIONS,
  buildConfig,
  detectQ32Conflict,
  evaluateSkipTable,
  runInitQuestions,
} from "../src/lib/init-questions.js";

// ---------------------------------------------------------------------------
// Synthetic InitState builders
// ---------------------------------------------------------------------------

function baseState(): InitState {
  return {
    repoRoot: "/tmp/fake",
    kind: "empty",
    hasCommits: false,
    hasUncommittedChanges: false,
    defaultBranch: "main",
    currentBranch: "main",
    isOnDefaultBranch: true,
    hasRemote: false,
    remoteUrl: null,
    developBranchExists: false,
    mainProtected: false,
    hasTags: false,
    multipleAuthorsLast90d: false,
    devxVersion: null,
    hasUserConfig: false,
    userConfigPath: "/tmp/fake/no-user-config",
    hasReadme: false,
    readmeFirstParagraph: null,
    personasPopulated: false,
    detectedStack: "empty",
    detectedStackFile: null,
    hasProdEnvVars: false,
    hasGithubWorkflows: false,
    hasTests: false,
    inferredShape: "empty-dream",
    halts: [],
  };
}

function emptyRepoState(): InitState {
  // Worst case: nothing to infer except shape (empty-dream from no commits).
  // To force shape to ask too, drop the inferredShape signal.
  return { ...baseState(), inferredShape: null };
}

function matureRepoState(opts: { hasGithubWorkflows?: boolean } = {}): InitState {
  return {
    ...baseState(),
    kind: "existing",
    hasCommits: true,
    hasReadme: true,
    readmeFirstParagraph: "A reading tracker for hardcover habits.",
    personasPopulated: true,
    multipleAuthorsLast90d: true,
    detectedStack: "typescript",
    detectedStackFile: "package.json",
    hasProdEnvVars: true,
    developBranchExists: true,
    mainProtected: true,
    hasTags: true,
    hasTests: true,
    inferredShape: "production-careful",
    hasGithubWorkflows: opts.hasGithubWorkflows ?? true,
  };
}

function richUserPrefs(): UserPrefs {
  return {
    promotion: { autonomy: { initial_n: 5, rollback_penalty: 0.5 } },
    permissions: { bash: { allow: ["git", "gh", "npm"] } },
    capacity: { daily_spend_cap_usd: 10 },
    notifications: { channels: [{ kind: "email", to: "x@y.com", digest_only: true }] },
  };
}

// ---------------------------------------------------------------------------
// ask/confirm stubs
// ---------------------------------------------------------------------------

interface ScriptedAsk {
  asks: AskContext[];
  ask: (ctx: AskContext) => unknown;
}

function scripted(answersByQ: Partial<Record<QuestionId, unknown>>): ScriptedAsk {
  const asks: AskContext[] = [];
  return {
    asks,
    ask: (ctx) => {
      asks.push(ctx);
      const v = answersByQ[ctx.question.id];
      if (v === undefined) {
        throw new Error(`scripted ask missing answer for ${ctx.question.id}`);
      }
      return v;
    },
  };
}

function defaultAnswers(): Record<QuestionId, unknown> {
  return {
    n1: "A test thing",
    n2: "Hello world demo",
    n3: "you propose",
    n4: "solo",
    n5: "typescript + node",
    n6: "empty-dream",
    n7: "YOLO",
    n8: "single-branch",
    n9: { initialN: 0, rollbackPenalty: 0.5 },
    n10: ["git", "gh", "npm"],
    n11: { ciProvider: "github-actions", browserHarness: "playwright" },
    n12: null,
    n13: { channels: [], quietHours: "22:00-08:00" },
  };
}

// ---------------------------------------------------------------------------
// evaluateSkipTable — focused per-row coverage
// ---------------------------------------------------------------------------

describe("ini501 — evaluateSkipTable", () => {
  it("README → N1 confirm-skip with first paragraph as default", () => {
    const skips = evaluateSkipTable({ ...baseState(), hasReadme: true, readmeFirstParagraph: "Foo." });
    expect(skips.n1).toBeDefined();
    expect(skips.n1?.requiresConfirm).toBe(true);
    expect(skips.n1?.defaultValue).toBe("Foo.");
  });

  it("populated personas → N3 silent skip", () => {
    const skips = evaluateSkipTable({ ...baseState(), personasPopulated: true });
    expect(skips.n3?.requiresConfirm).toBe(false);
  });

  it("multi-author → N4 silent skip, value=team", () => {
    const skips = evaluateSkipTable({ ...baseState(), multipleAuthorsLast90d: true });
    expect(skips.n4?.defaultValue).toBe("team");
    expect(skips.n4?.requiresConfirm).toBe(false);
  });

  it("detected stack file → N5 silent skip with stack name", () => {
    const skips = evaluateSkipTable({
      ...baseState(),
      detectedStack: "flutter",
      detectedStackFile: "pubspec.yaml",
    });
    expect(skips.n5?.defaultValue).toBe("flutter");
  });

  it("multi-stack repo (mixed) → N5 NOT skipped — user must pick a primary", () => {
    const skips = evaluateSkipTable({
      ...baseState(),
      detectedStack: "mixed",
      detectedStackFile: "package.json,Cargo.toml",
    });
    expect(skips.n5).toBeUndefined();
  });

  it("inferred empty-dream → N6 silent skip", () => {
    const skips = evaluateSkipTable({ ...baseState(), inferredShape: "empty-dream" });
    expect(skips.n6?.defaultValue).toBe("empty-dream");
    expect(skips.n6?.requiresConfirm).toBe(false);
  });

  it("inferred production-careful → N6 confirm-skip", () => {
    const skips = evaluateSkipTable({ ...baseState(), inferredShape: "production-careful" });
    expect(skips.n6?.defaultValue).toBe("production-careful");
    expect(skips.n6?.requiresConfirm).toBe(true);
  });

  it("prod env var → N7 silent skip with PROD", () => {
    const skips = evaluateSkipTable({ ...baseState(), hasProdEnvVars: true });
    expect(skips.n7?.defaultValue).toBe("PROD");
    expect(skips.n7?.requiresConfirm).toBe(false);
  });

  it("empty-dream + no prod signals → N7 silent YOLO", () => {
    const skips = evaluateSkipTable({ ...baseState(), inferredShape: "empty-dream" });
    expect(skips.n7?.defaultValue).toBe("YOLO");
    expect(skips.n7?.requiresConfirm).toBe(false);
  });

  it("develop + protected main → N8 silent split", () => {
    const skips = evaluateSkipTable({
      ...baseState(),
      developBranchExists: true,
      mainProtected: true,
    });
    expect(skips.n8?.defaultValue).toBe("develop-main-split");
  });

  it("user prefs.promotion.autonomy.initial_n → N9 silent skip", () => {
    const skips = evaluateSkipTable(baseState(), {
      promotion: { autonomy: { initial_n: 7, rollback_penalty: 0.3 } },
    });
    expect(skips.n9).toBeDefined();
    expect((skips.n9?.defaultValue as { initialN: number }).initialN).toBe(7);
  });

  it("user prefs.permissions.bash.allow → N10 silent skip", () => {
    const skips = evaluateSkipTable(baseState(), {
      permissions: { bash: { allow: ["git"] } },
    });
    expect(skips.n10?.defaultValue).toEqual(["git"]);
  });

  it(".github/workflows present → N11 silent skip", () => {
    const skips = evaluateSkipTable({ ...baseState(), hasGithubWorkflows: true });
    expect(skips.n11).toBeDefined();
  });

  it("user prefs daily cap → N12 silent skip", () => {
    const skips = evaluateSkipTable(baseState(), {
      capacity: { daily_spend_cap_usd: 25 },
    });
    expect(skips.n12?.defaultValue).toBe(25);
  });

  it("user prefs notifications → N13 silent skip", () => {
    const skips = evaluateSkipTable(baseState(), {
      notifications: { quiet_hours: "23:00-07:00" },
    });
    expect(skips.n13).toBeDefined();
  });

  it("baseline empty state → no skips", () => {
    const skips = evaluateSkipTable({ ...baseState(), inferredShape: null });
    // Without any signals at all (and inferredShape forced null), nothing skips.
    expect(Object.keys(skips)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Best/mid/worst case scenarios — the AC goals
// ---------------------------------------------------------------------------

describe("ini501 — runInitQuestions — best / mid / worst", () => {
  it("worst-case: empty repo, no user prefs → 13 prompts, complete config", async () => {
    const state = emptyRepoState();
    const { ask, asks } = scripted(defaultAnswers());
    const result = await runInitQuestions({
      state,
      userPrefs: null,
      ask,
    });
    expect(result.aborted).toBe(false);
    expect(result.counts.total).toBe(13);
    expect(result.counts.promptsShown).toBe(13);
    expect(result.counts.asked).toBe(13);
    expect(result.counts.confirmed).toBe(0);
    expect(result.counts.inferredSilently).toBe(0);
    expect(asks).toHaveLength(13);
    // Every question asked, in narrative order.
    expect(asks.map((a) => a.question.id)).toEqual(QUESTIONS.map((q) => q.id));
    // Config has every required top-level field.
    expect(result.config.devx_version).toBeTruthy();
    expect(result.config.mode).toBe("YOLO");
    expect(result.config.project.shape).toBe("empty-dream");
    expect(result.config.git?.integration_branch).toBeNull();
  });

  it("best-case: mature returning user → ≤3 prompts, complete config", async () => {
    const state = matureRepoState();
    const userPrefs = richUserPrefs();
    // Only N2 should be asked (it's never inferable). N1, N6, N7 require confirm
    // (we accept). Everything else is silently inferred.
    // Acceptance: promptsShown ≤ 3.
    const answers = defaultAnswers();
    const { ask, asks } = scripted(answers);
    const result = await runInitQuestions({
      state,
      userPrefs,
      ask,
      confirm: () => true,
      onHalt: () => true,
    });
    expect(result.aborted).toBe(false);
    expect(result.counts.promptsShown).toBeLessThanOrEqual(3);
    // N2 (first slice) is the load-bearing always-ask.
    expect(asks.find((a) => a.question.id === "n2")).toBeDefined();
    // Config is complete and reflects mature inference.
    expect(result.config.project.shape).toBe("production-careful");
    expect(result.config.mode).toBe("PROD");
    expect(result.config.git?.integration_branch).toBe("develop");
    expect(result.config.git?.pr_strategy).toBe("pr-to-develop");
  });

  it("mid-case: partial signals → ~7 prompts, complete config", async () => {
    // Mid: README + personas + multi-author + workflows + user prefs notifications.
    // Skipped: N1(confirm), N3, N4, N11, N13 = 5 skipped (3 silent + 2 confirm).
    // Asked: N2, N5, N6, N7, N8, N9, N10, N12 = 8 asked.
    // promptsShown = 8 asked + 1 confirm (N1; N6 inferred null so it's asked) = 9.
    // To land at ~7, we'll narrow further: also detected stack + inferred shape.
    const state: InitState = {
      ...baseState(),
      kind: "existing",
      hasCommits: true,
      hasReadme: true,
      readmeFirstParagraph: "Mid-case repo.",
      personasPopulated: true,
      multipleAuthorsLast90d: true,
      detectedStack: "typescript",
      detectedStackFile: "package.json",
      hasGithubWorkflows: true,
      inferredShape: null, // ambiguous → N6 still asked
      hasProdEnvVars: false,
    };
    const userPrefs: UserPrefs = {
      notifications: { quiet_hours: "22:00-08:00" },
    };
    const { ask, asks } = scripted(defaultAnswers());
    const result = await runInitQuestions({ state, userPrefs, ask });
    expect(result.aborted).toBe(false);
    // Expect somewhere in the 6–8 range (one confirm + ~6 asks).
    expect(result.counts.promptsShown).toBeGreaterThanOrEqual(6);
    expect(result.counts.promptsShown).toBeLessThanOrEqual(8);
    // Each question lands somewhere — total is always 13.
    expect(Object.keys(result.answers)).toHaveLength(13);
    // All silent skips landed.
    const silent = result.transcript.filter((t) => t.kind === "inferred-silently").map((t) => t.id);
    expect(silent).toEqual(expect.arrayContaining(["n3", "n4", "n5", "n11", "n13"]));
    expect(asks.length + result.transcript.filter((t) => t.kind === "confirmed").length).toBe(
      result.counts.promptsShown,
    );
  });
});

// ---------------------------------------------------------------------------
// Halt-and-confirm + Q32 conflict
// ---------------------------------------------------------------------------

describe("ini501 — halts and Q32 conflict", () => {
  it("fatal halt (corrupt-config) aborts before any question", async () => {
    const state: InitState = {
      ...baseState(),
      kind: "corrupt-config",
      halts: [
        {
          kind: "corrupt-config",
          message: "halt — devx.config.yaml is corrupt; manual review required",
          options: [],
          fatal: true,
        },
      ],
    };
    let askCount = 0;
    const result = await runInitQuestions({
      state,
      ask: () => {
        askCount += 1;
        return null;
      },
      onHalt: () => true, // user "proceeds" but fatal=true wins
    });
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("corrupt-config");
    expect(askCount).toBe(0);
  });

  it("non-fatal halt: user aborts → run aborts before questions", async () => {
    const state: InitState = {
      ...baseState(),
      hasUncommittedChanges: true,
      halts: [
        {
          kind: "uncommitted-changes",
          message: "uncommitted",
          options: [{ key: "a", label: "abort" }],
          fatal: false,
        },
      ],
    };
    let askCount = 0;
    const result = await runInitQuestions({
      state,
      ask: () => {
        askCount += 1;
        return null;
      },
      onHalt: () => false,
    });
    expect(result.aborted).toBe(true);
    expect(askCount).toBe(0);
  });

  it("non-fatal halt: user proceeds → questions run", async () => {
    const state = emptyRepoState();
    state.halts = [
      {
        kind: "uncommitted-changes",
        message: "uncommitted",
        options: [{ key: "s", label: "stash" }],
        fatal: false,
      },
    ];
    const { ask } = scripted(defaultAnswers());
    const result = await runInitQuestions({
      state,
      ask,
      onHalt: () => true,
    });
    expect(result.aborted).toBe(false);
    expect(result.counts.promptsShown).toBe(13);
  });

  it("Q32 mode×shape conflict (YOLO + production-careful) detected", () => {
    expect(detectQ32Conflict("YOLO", "production-careful")).not.toBeNull();
    expect(detectQ32Conflict("PROD", "empty-dream")).not.toBeNull();
    expect(detectQ32Conflict("YOLO", "empty-dream")).toBeNull();
    expect(detectQ32Conflict("PROD", "production-careful")).toBeNull();
  });

  it("Q32 conflict fires after N7 lands; aborting halts the run", async () => {
    const state = emptyRepoState();
    const answers = defaultAnswers();
    answers.n6 = "production-careful";
    answers.n7 = "YOLO";
    const { ask } = scripted(answers);
    let q32Fired = false;
    const result = await runInitQuestions({
      state,
      ask,
      onHalt: (h) => {
        if (h.kind === "mode-shape-conflict") {
          q32Fired = true;
          return false; // abort
        }
        return true;
      },
    });
    expect(q32Fired).toBe(true);
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("q32-conflict");
  });

  it("Q32 conflict fires but user proceeds → run completes", async () => {
    const state = emptyRepoState();
    const answers = defaultAnswers();
    answers.n6 = "production-careful";
    answers.n7 = "YOLO";
    const { ask } = scripted(answers);
    let q32Fired = false;
    const result = await runInitQuestions({
      state,
      ask,
      onHalt: (h) => {
        if (h.kind === "mode-shape-conflict") q32Fired = true;
        return true;
      },
    });
    expect(q32Fired).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.config.mode).toBe("YOLO");
    expect(result.config.project.shape).toBe("production-careful");
  });
});

// ---------------------------------------------------------------------------
// Confirm-rejection path
// ---------------------------------------------------------------------------

describe("ini501 — confirm rejection path", () => {
  it("confirm=false → ask is called for the same question with override", async () => {
    const state: InitState = {
      ...baseState(),
      hasReadme: true,
      readmeFirstParagraph: "Inferred default.",
    };
    let asked = false;
    const result = await runInitQuestions({
      state,
      ask: (ctx) => {
        if (ctx.question.id === "n1") {
          asked = true;
          return "user override";
        }
        return defaultAnswers()[ctx.question.id];
      },
      confirm: (ctx) => ctx.question.id !== "n1", // reject N1 only
    });
    expect(asked).toBe(true);
    expect(result.answers.n1).toBe("user override");
    const n1Entry = result.transcript.find((t) => t.id === "n1");
    expect(n1Entry?.kind).toBe("rejected-default");
  });
});

// ---------------------------------------------------------------------------
// buildConfig — direct unit coverage
// ---------------------------------------------------------------------------

describe("ini501 — buildConfig", () => {
  it("YOLO + empty-dream → single-branch + thoroughness=send-it", () => {
    const cfg = buildConfig(baseState(), {
      ...defaultAnswers(),
      n6: "empty-dream",
      n7: "YOLO",
    });
    expect(cfg.mode).toBe("YOLO");
    expect(cfg.thoroughness).toBe("send-it");
    expect(cfg.git?.integration_branch).toBeNull();
    expect(cfg.git?.branch_prefix).toBe("feat/");
    expect(cfg.git?.pr_strategy).toBe("pr-to-main");
  });

  it("PROD → develop/main split + thoroughness=thorough (auto-infer when n8 unanswered)", () => {
    const answers = defaultAnswers();
    delete (answers as Partial<Record<QuestionId, unknown>>).n8;
    const cfg = buildConfig(baseState(), {
      ...answers,
      n6: "production-careful",
      n7: "PROD",
    });
    expect(cfg.thoroughness).toBe("thorough");
    expect(cfg.git?.integration_branch).toBe("develop");
    expect(cfg.git?.branch_prefix).toBe("develop/");
    expect(cfg.git?.pr_strategy).toBe("pr-to-develop");
    expect(cfg.git?.protect_main).toBe(true);
  });

  it("BETA → balanced + split inferred from team", () => {
    const cfg = buildConfig(
      { ...baseState(), multipleAuthorsLast90d: true },
      { ...defaultAnswers(), n7: "BETA", n4: "team", n8: undefined as unknown as string },
    );
    expect(cfg.thoroughness).toBe("balanced");
    expect(cfg.git?.integration_branch).toBe("develop");
  });

  it("preserves _meta from freeform N1/N2/N3/N5", () => {
    const cfg = buildConfig(baseState(), {
      ...defaultAnswers(),
      n1: "Reading tracker",
      n2: "Show all books on a shelf",
      n3: "solo founders",
      n5: "TypeScript + React",
    });
    expect(cfg._meta.plan_seed).toBe("Reading tracker");
    expect(cfg._meta.first_slice).toBe("Show all books on a shelf");
    expect(cfg._meta.who_for).toBe("solo founders");
    expect(cfg._meta.stack_description).toBe("TypeScript + React");
  });
});
