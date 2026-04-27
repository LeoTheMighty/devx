// init-write.ts tests (ini502).
//
// Strategy: hermetic tmp dirs as repo roots. Templates root points at the
// real package _devx/templates/init/ so the tests verify the shipped
// template output too. Schema validation runs against the cfg201 schema so
// regressions in renderInitConfig surface as failed validation, not silent
// drift.
//
// Spec: dev/dev-ini502-2026-04-26T19:35-init-local-writes.md

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as yamlParse } from "yaml";

import {
  renderInitConfig,
  writeInitFiles,
  type WriteInitOpts,
} from "../src/lib/init-write.js";
import { detectInitState, type InitState } from "../src/lib/init-state.js";
import type { PartialConfig, TranscriptEntry } from "../src/lib/init-questions.js";
import {
  ConfigError,
  clearConfigCache,
  loadValidatedConfig,
} from "../src/lib/config-validate.js";

const addFormats = (addFormatsImport as { default?: typeof addFormatsImport }).default ?? addFormatsImport;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = resolve(HERE, "..", "_devx", "templates", "init");
const SCHEMA_PATH = resolve(HERE, "..", "_devx", "config-schema.json");

const NOW = () => new Date("2026-04-27T13:00:00.000Z");

function mkRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function fakeState(repoRoot: string, overrides: Partial<InitState> = {}): InitState {
  return {
    repoRoot,
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
    userConfigPath: join(repoRoot, "no-user-config"),
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
    ...overrides,
  };
}

function fakeConfig(overrides: Partial<PartialConfig> = {}): PartialConfig {
  return {
    devx_version: "0.1.0",
    mode: "YOLO",
    project: { shape: "empty-dream" },
    thoroughness: "send-it",
    capacity: { daily_spend_cap_usd: null },
    permissions: { bash: { allow: ["git", "gh", "npm"] } },
    git: {
      integration_branch: null,
      branch_prefix: "feat/",
      pr_strategy: "pr-to-main",
      protect_main: false,
    },
    promotion: { autonomy: { initial_n: 0, rollback_penalty: 0.5 } },
    ci: { provider: "github-actions" },
    qa: { browser_harness: "playwright" },
    notifications: {
      channels: [{ kind: "email", to: "leo@example.com", digest_only: true }],
      quiet_hours: "22:00-08:00",
    },
    _meta: {
      plan_seed: "A reading tracker for indie SREs.",
      first_slice: "log-and-list-books",
      who_for: "founders, devs, designers",
      team_size: "solo",
      stack_description: "typescript",
    },
    ...overrides,
  };
}

function baseOpts(repoRoot: string, overrides: Partial<WriteInitOpts> = {}): WriteInitOpts {
  return {
    repoRoot,
    config: fakeConfig(),
    state: fakeState(repoRoot),
    templatesRoot: TEMPLATES_ROOT,
    now: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validator
// ---------------------------------------------------------------------------

function loadAjv() {
  // Mirror the cfg203 validator's strictness so tests catch the same drift
  // the loader catches at runtime.
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  return ajv.compile(schema);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ini502 — writeInitFiles — fresh empty repo", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini502-fresh-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("creates devx.config.yaml + 8 backlogs + 8 spec dirs + CLAUDE.md + .gitignore", () => {
    const result = writeInitFiles(baseOpts(repo));

    expect(result.configWritten).toBe(true);
    expect(result.backlogsCreated).toEqual([
      "DEV.md",
      "PLAN.md",
      "TEST.md",
      "DEBUG.md",
      "FOCUS.md",
      "INTERVIEW.md",
      "MANUAL.md",
      "LESSONS.md",
    ]);
    expect(result.backlogsSkipped).toEqual([]);
    expect(result.specDirsCreated.sort()).toEqual([
      "debug",
      "dev",
      "focus",
      "focus-group/personas",
      "learn",
      "plan",
      "qa",
      "test",
    ]);
    expect(result.claudeMd).toBe("created");
    expect(result.gitignore).toBe("created");
    expect(result.conflicts).toEqual([]);

    // devx.config.yaml exists, parses, and validates against the cfg201 schema.
    const yaml = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(yaml.startsWith("#")).toBe(true); // header comment first
    expect(yaml).toContain("devx_version: 0.1.0");
    const parsed = yamlParse(yaml);
    expect(parsed.mode).toBe("YOLO");
    expect(parsed.project.shape).toBe("empty-dream");
    const validate = loadAjv();
    const ok = validate(parsed);
    if (!ok) {
      // surface every validation error so the failure is debuggable.
      throw new Error(
        `schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
    expect(ok).toBe(true);

    // Loading via the cfg203 path also succeeds (catches issues the raw schema
    // wouldn't, e.g. coupling between fields). Pin schemaPath + an absent user
    // config so the loader doesn't wander into the host filesystem.
    clearConfigCache();
    expect(() =>
      loadValidatedConfig({
        projectPath: join(repo, "devx.config.yaml"),
        schemaPath: SCHEMA_PATH,
        userPath: join(repo, "no-user-config"),
        reload: true,
      }),
    ).not.toThrow(ConfigError);

    // Backlog files exist with empty-state header.
    for (const f of ["DEV.md", "PLAN.md", "TEST.md", "DEBUG.md", "FOCUS.md", "INTERVIEW.md", "MANUAL.md", "LESSONS.md"]) {
      const body = readFileSync(join(repo, f), "utf8");
      expect(body).toContain("<!-- devx-empty-state-start -->");
      expect(body).toContain("<!-- devx-empty-state-end -->");
    }

    // Spec dirs are real directories.
    for (const d of ["dev", "plan", "test", "debug", "focus", "learn", "qa", "focus-group/personas"]) {
      expect(statSync(join(repo, d)).isDirectory()).toBe(true);
    }

    // CLAUDE.md has the strategic axes filled in + markers present.
    const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(claude).toContain("<!-- devx:start -->");
    expect(claude).toContain("<!-- devx:end -->");
    expect(claude).toContain("**YOLO**");
    expect(claude).toContain("**empty-dream**");
    expect(claude).toContain("**send-it**");
    // The plan-seed placeholder gets replaced with N1's answer.
    expect(claude).toContain("A reading tracker for indie SREs.");

    // .gitignore has the markers.
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(gi).toContain("# >>> devx");
    expect(gi).toContain("# <<< devx");
    expect(gi).toContain(".worktrees/");
    expect(gi).toContain(".devx-cache/");
  });

  it("attaches inline provenance comments for asked vs inferred answers", () => {
    const transcript: TranscriptEntry[] = [
      { id: "n6", kind: "inferred-silently", value: "empty-dream", reason: "empty repo — empty-dream" },
      { id: "n7", kind: "asked", value: "YOLO" },
      { id: "n10", kind: "asked", value: ["git", "gh", "npm"] },
    ];
    writeInitFiles(baseOpts(repo, { transcript }));
    const yaml = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(yaml).toMatch(/mode: YOLO\s+# asked: N7/);
    expect(yaml).toMatch(/shape: empty-dream\s+# inferred: empty repo — empty-dream/);
  });
});

describe("ini502 — writeInitFiles — idempotent re-run", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini502-rerun-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("does not overwrite existing backlog files", () => {
    // Pre-populate DEV.md with user content.
    writeFileSync(join(repo, "DEV.md"), "# DEV — already here\n\n- existing item\n");
    const r1 = writeInitFiles(baseOpts(repo));
    expect(r1.backlogsCreated).not.toContain("DEV.md");
    expect(r1.backlogsSkipped).toContain("DEV.md");
    const after = readFileSync(join(repo, "DEV.md"), "utf8");
    expect(after).toBe("# DEV — already here\n\n- existing item\n");
  });

  it("does not re-create spec subdirectories that already exist", () => {
    mkdirSync(join(repo, "dev"));
    const r = writeInitFiles(baseOpts(repo));
    expect(r.specDirsSkipped).toContain("dev");
    expect(r.specDirsCreated).not.toContain("dev");
  });

  it(".gitignore: re-run with managed block reports already-managed and does not duplicate", () => {
    writeInitFiles(baseOpts(repo)); // create
    const before = readFileSync(join(repo, ".gitignore"), "utf8");
    const r = writeInitFiles(baseOpts(repo)); // re-run
    expect(r.gitignore).toBe("already-managed");
    const after = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(after).toBe(before);
    // Marker must appear exactly once.
    expect(after.match(/# >>> devx/g)?.length).toBe(1);
  });

  it(".gitignore: substring-only marker (e.g. '# >>> devx-build/') does NOT count as already-managed", () => {
    // A neighboring tool's marker shares a prefix with ours — must not
    // suppress the real append.
    writeFileSync(join(repo, ".gitignore"), "node_modules/\n# >>> devx-build/\n# <<< devx-build\n");
    const r = writeInitFiles(baseOpts(repo));
    expect(r.gitignore).toBe("appended");
    const body = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(body).toContain(".worktrees/");
    expect(body).toContain(".devx-cache/");
  });

  it("CLAUDE.md: re-run with unchanged managed block reports skipped (no churn)", () => {
    writeInitFiles(baseOpts(repo)); // create
    const before = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    const r = writeInitFiles(baseOpts(repo)); // re-run identical config
    expect(r.claudeMd).toBe("skipped");
    const after = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(after).toBe(before);
  });

  it("respects skipExistingConfig on re-run", () => {
    writeInitFiles(baseOpts(repo));
    const before = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    const r = writeInitFiles(baseOpts(repo, { skipExistingConfig: true }));
    expect(r.configWritten).toBe(false);
    expect(readFileSync(join(repo, "devx.config.yaml"), "utf8")).toBe(before);
  });
});

describe("ini502 — writeInitFiles — CLAUDE.md merge handling", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini502-claude-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("appends a managed block when CLAUDE.md exists without markers", () => {
    writeFileSync(join(repo, "CLAUDE.md"), "# Project notes\n\nLeonid's hand-written context.\n");
    const r = writeInitFiles(baseOpts(repo));
    expect(r.claudeMd).toBe("appended");
    expect(r.conflicts).toEqual([]);
    const body = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(body.startsWith("# Project notes")).toBe(true);
    expect(body).toContain("Leonid's hand-written context.");
    expect(body).toContain("<!-- devx:start -->");
    expect(body).toContain("<!-- devx:end -->");
  });

  it("flags a conflict when the markers wrap hand-edited content", () => {
    writeFileSync(
      join(repo, "CLAUDE.md"),
      "# Project notes\n<!-- devx:start -->\nuser stuck their own essay in here\n<!-- devx:end -->\n",
    );
    const before = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    const r = writeInitFiles(baseOpts(repo));
    expect(r.claudeMd).toBe("conflict");
    expect(r.conflicts).toHaveLength(1);
    const conflict = r.conflicts[0];
    expect(conflict).toBeDefined();
    expect(conflict?.kind).toBe("claude-md-marker-conflict");
    expect(conflict?.path).toBe(join(repo, "CLAUDE.md"));
    // File must not be touched on conflict.
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("flags a conflict when the user typo'd a strategic-axis value (not silent overwrite)", () => {
    writeInitFiles(baseOpts(repo));
    const fresh = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    // Inject a user edit inside the markers — change the mode bold to a
    // free-form annotation. This MUST trigger a conflict, not be silently
    // reverted on the next /devx-init run.
    const tampered = fresh.replace("**YOLO**", "**YOLO (manual override 2026-04-27)**");
    writeFileSync(join(repo, "CLAUDE.md"), tampered);
    const r = writeInitFiles(baseOpts(repo));
    expect(r.claudeMd).toBe("conflict");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(tampered);
  });

  it("treats orphaned start/end markers as a conflict, not as 'no managed block'", () => {
    // Stray end marker above where any real start would be.
    writeFileSync(
      join(repo, "CLAUDE.md"),
      "# Notes\n\n> Hand-edits inside <!-- devx:end --> markers will trigger…\n\n",
    );
    const before = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    const r = writeInitFiles(baseOpts(repo));
    expect(r.claudeMd).toBe("conflict");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("treats duplicate start markers as a conflict", () => {
    writeFileSync(
      join(repo, "CLAUDE.md"),
      "<!-- devx:start -->\nfirst block\n<!-- devx:end -->\n<!-- devx:start -->\nsecond block\n<!-- devx:end -->\n",
    );
    const before = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    const r = writeInitFiles(baseOpts(repo));
    expect(r.claudeMd).toBe("conflict");
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("updates only the contents inside the markers when they're present and managed", () => {
    // First run produces a CLAUDE.md with our markers.
    writeInitFiles(baseOpts(repo));
    const baseBody = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    // User adds a section *outside* the markers.
    const userAdded = baseBody + "\n## My personal todos\n- ship the thing\n";
    writeFileSync(join(repo, "CLAUDE.md"), userAdded);
    // Re-run with a different mode so the inner block changes — we should
    // overwrite inside the markers but preserve user content outside.
    const opts2 = baseOpts(repo, {
      config: fakeConfig({ mode: "BETA", thoroughness: "balanced" }),
    });
    const r = writeInitFiles(opts2);
    expect(r.claudeMd).toBe("updated");
    const body = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(body).toContain("## My personal todos");
    expect(body).toContain("- ship the thing");
    expect(body).toContain("**BETA**");
    expect(body).toContain("**balanced**");
  });
});

describe("ini502 — writeInitFiles — partial existing backlogs", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini502-partial-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("creates only the missing backlog files; leaves existing ones alone", () => {
    writeFileSync(join(repo, "DEV.md"), "user-owned DEV\n");
    writeFileSync(join(repo, "PLAN.md"), "user-owned PLAN\n");
    const r = writeInitFiles(baseOpts(repo));
    expect(r.backlogsSkipped).toEqual(["DEV.md", "PLAN.md"]);
    expect(r.backlogsCreated).toEqual(["TEST.md", "DEBUG.md", "FOCUS.md", "INTERVIEW.md", "MANUAL.md", "LESSONS.md"]);
    expect(readFileSync(join(repo, "DEV.md"), "utf8")).toBe("user-owned DEV\n");
    expect(readFileSync(join(repo, "PLAN.md"), "utf8")).toBe("user-owned PLAN\n");
    expect(readFileSync(join(repo, "TEST.md"), "utf8")).toContain("<!-- devx-empty-state-start -->");
  });
});

describe("ini502 — atomic write semantics", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini502-atomic-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("leaves no .tmp.* files behind on a successful run", () => {
    writeInitFiles(baseOpts(repo));
    const stragglers = ["devx.config.yaml.tmp", "DEV.md.tmp", "CLAUDE.md.tmp", ".gitignore.tmp"];
    const dirContents = readdirSync(repo);
    for (const tmpName of stragglers) {
      expect(dirContents.some((name) => name.startsWith(tmpName))).toBe(false);
    }
  });
});

describe("ini502 — renderInitConfig — direct unit", () => {
  it("produces YAML that round-trips, validates, and respects mode invariants", () => {
    const validate = loadAjv();
    interface ModeFixture {
      mode: "YOLO" | "BETA" | "PROD" | "LOCKDOWN";
      configOverrides?: Partial<PartialConfig>;
      expectGate: string;
      expectSoakAtLeast: number;
      expectCoverageBlocking: boolean;
    }
    const fixtures: ModeFixture[] = [
      { mode: "YOLO", expectGate: "fast-ship-always", expectSoakAtLeast: 0, expectCoverageBlocking: false },
      { mode: "BETA", expectGate: "fast-ship", expectSoakAtLeast: 0, expectCoverageBlocking: false },
      {
        mode: "PROD",
        configOverrides: {
          git: {
            integration_branch: "develop",
            branch_prefix: "develop/",
            pr_strategy: "pr-to-develop",
            protect_main: true,
          },
        },
        expectGate: "careful",
        expectSoakAtLeast: 24,
        expectCoverageBlocking: true,
      },
      { mode: "LOCKDOWN", expectGate: "manual-only", expectSoakAtLeast: 24, expectCoverageBlocking: true },
    ];
    for (const fix of fixtures) {
      const repo = mkRepo("devx-ini502-mode-");
      try {
        const yaml = renderInitConfig({
          config: fakeConfig({ mode: fix.mode, ...fix.configOverrides }),
          state: fakeState(repo),
          transcript: [],
          now: NOW(),
        });
        const parsed = yamlParse(yaml) as {
          mode: string;
          promotion: { gate: string; soak_hours: number };
          coverage: { blocking: boolean };
          git: { protect_main: boolean; integration_branch: string | null };
        };
        const ok = validate(parsed);
        if (!ok) {
          throw new Error(
            `mode ${fix.mode} failed schema: ${JSON.stringify(validate.errors, null, 2)}`,
          );
        }
        expect(parsed.mode).toBe(fix.mode);
        expect(parsed.promotion.gate).toBe(fix.expectGate);
        expect(parsed.promotion.soak_hours).toBeGreaterThanOrEqual(fix.expectSoakAtLeast);
        expect(parsed.coverage.blocking).toBe(fix.expectCoverageBlocking);
        // Develop/main split → main must be protected; single-branch → no
        // claim about main protection (this project explicitly disables it).
        if (parsed.git.integration_branch !== null) {
          expect(parsed.git.protect_main).toBe(true);
        }
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    }
  });

  it("round-trips init_partial: true through writeInitFiles → re-load (gate-bypass regression)", () => {
    const repo = mkRepo("devx-ini502-partial-flag-");
    try {
      writeInitFiles(baseOpts(repo, { config: fakeConfig({ init_partial: true }) }));
      const parsed = yamlParse(readFileSync(join(repo, "devx.config.yaml"), "utf8")) as {
        init_partial?: boolean;
      };
      expect(parsed.init_partial).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("places devx_version as the first key in the document", () => {
    const repo = mkRepo("devx-ini502-version-");
    try {
      const yaml = renderInitConfig({
        config: fakeConfig(),
        state: fakeState(repo),
        transcript: [],
        now: NOW(),
      });
      // After the leading comment block, the first non-comment key should be
      // devx_version.
      const firstKey = yaml
        .split("\n")
        .find((line) => line.length > 0 && !line.startsWith("#"));
      expect(firstKey).toMatch(/^devx_version:/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("integrates with detectInitState on a real tmp dir", () => {
    const repo = mkRepo("devx-ini502-real-state-");
    try {
      const state = detectInitState({
        repoRoot: repo,
        // Real git not available in tests; stub.
        git: () => ({ exitCode: 1, stdout: "", stderr: "no-git" }),
        env: () => undefined,
        userConfigPath: join(repo, "no-user-config"),
        ghProbe: () => false,
      });
      const yaml = renderInitConfig({
        config: fakeConfig(),
        state,
        transcript: [],
        now: NOW(),
      });
      expect(yaml).toContain("default_branch: main");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
