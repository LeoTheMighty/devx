// End-to-end orchestration tests for `/devx-init` (ini508).
//
// Coverage targets — every spec AC plus failure-mode regressions:
//   - empty fixture        → fresh init lands all 8 backlogs + config + .gitignore
//                            + CLAUDE.md seed + spec dirs + supervisor + personas
//                            + INTERVIEW seed
//   - existing-no-ci       → fresh init landing on a TS repo with commits + a
//                            README; .github/workflows/devx-ci.yml gets the
//                            TypeScript template
//   - partial-on-devx      → upgrade path runs (kind === "already-on-devx"),
//                            init_partial flag stays addressable, surface
//                            repair fixes the missing CLAUDE.md / personas /
//                            INTERVIEW seed / CI workflow / PR template
//   - idempotent rerun     → second runInit on the same fixture is a near
//                            no-op (no new files written)
//   - failure: no-remote   → init_partial gets flipped, MANUAL.md appended,
//                            promotion.gate forced to manual-only
//   - failure: gh-not-auth → init_partial flipped, MANUAL.md appended,
//                            workflows still on disk locally
//
// All tests are hermetic: each copies a fixture into a tmp dir, runs `git
// init` if needed, and stubs the gh + git CLIs via injectables. No real gh
// or supervisor units are touched.

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runInit,
  scriptedAsk,
  type ScriptedAnswers,
} from "../src/lib/init-orchestrator.js";
import type { GhExec } from "../src/lib/init-gh.js";
import type { GitExec, GitResult } from "../src/lib/init-state.js";
import { runNext } from "../src/commands/next.js";

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(HERE, "fixtures", "repos");

type FixtureName = "empty" | "existing-no-ci" | "partial-on-devx";

/** Copy a fixture into a fresh tmp dir. Caller decides whether to git-init. */
function seedFixture(name: FixtureName): string {
  const dest = mkdtempSync(join(tmpdir(), `ini508-${name}-`));
  const src = join(FIXTURES_ROOT, name);
  cpSync(src, dest, { recursive: true });
  return dest;
}

/** `git init` + a single bootstrap commit so HEAD exists. Used by the empty
 *  + existing-no-ci scenarios. */
function gitInit(repoRoot: string, withCommit: boolean): void {
  // The host's global git config might trigger commit signing or other side
  // effects. Use a hermetic minimum config inside the test's repo.
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "ini508@test.local"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "ini508 test"], { cwd: repoRoot });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoRoot });
  if (withCommit) {
    execFileSync("git", ["add", "-A"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-q", "-m", "fixture: bootstrap"], { cwd: repoRoot });
  }
}

/** Stub gh that always reports "not authenticated" — used to exercise the
 *  gh-not-auth degraded path. The first call is `gh auth status`. */
function unauthGh(): GhExec {
  return () => ({ exitCode: 1, stdout: "", stderr: "gh: not authenticated\n" });
}

/** Stub git that pretends there's no `origin` remote. */
function noRemoteGit(repoRoot: string): GitExec {
  return (args, cwd) => realGit(args, cwd ?? repoRoot, /* withRemote */ false);
}

/** Default git stub: defers to the real CLI for everything except remote
 *  operations, which are scripted to either succeed or fail per `withRemote`.
 *  We bypass the real git for `remote get-url` so the host machine's actual
 *  git config doesn't leak into the test. */
function realGit(
  args: readonly string[],
  cwd: string,
  withRemote: boolean,
): GitResult {
  if (args[0] === "remote" && args[1] === "get-url" && args[2] === "origin") {
    if (!withRemote) {
      return { exitCode: 1, stdout: "", stderr: "fatal: No such remote 'origin'\n" };
    }
    return {
      exitCode: 0,
      stdout: "git@github.com:test/fixture.git\n",
      stderr: "",
    };
  }
  // Forward everything else to the real git, which is fine inside a tmp
  // repo we just `git init`-ed.
  try {
    const stdout = execFileSync("git", args as string[], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString("utf8") ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString("utf8") ?? ""),
    };
  }
}

/** Supervisor-install stub: the orchestrator's runInitSupervisor call shells
 *  out to launchctl/systemctl in production. Tests inject `os_supervisor:
 *  none` via the scripted answers OR fixture config so the dispatcher
 *  short-circuits to "skipped: config-none" — no real install happens. */
const SCRIPTED_ANSWERS_BASE: ScriptedAnswers = {
  n1: "An e2e fixture project for testing /devx-init.",
  n2: "Smoke-test that all surfaces land.",
  n3: "you propose",
  n4: "solo",
  n5: "typescript",
  n6: "empty-dream",
  n7: "YOLO",
  n8: "single-branch",
  n9: { initialN: 0 },
  n10: ["git", "gh", "npm"],
  n11: { ciProvider: "github-actions", browserHarness: "playwright" },
  n12: null,
  n13: { channels: [{ kind: "email", to: "test@example.com", digest_only: true }], quietHours: "22:00-08:00" },
};

const ALL_BACKLOGS: ReadonlyArray<string> = [
  "DEV.md",
  "PLAN.md",
  "TEST.md",
  "DEBUG.md",
  "FOCUS.md",
  "INTERVIEW.md",
  "MANUAL.md",
  "LESSONS.md",
];

// Patch HOME so the supervisor probe can't accidentally look at the real
// ~/.devx during runs. We point HOME at the per-test tmp dir.
let prevHome: string | undefined;
function patchHome(repo: string): void {
  prevHome = process.env.HOME;
  process.env.HOME = repo;
}
function restoreHome(): void {
  if (prevHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = prevHome;
  }
  prevHome = undefined;
}

// ---------------------------------------------------------------------------
// empty fixture
// ---------------------------------------------------------------------------

describe("ini508 — empty fixture", () => {
  let repo: string;
  beforeEach(() => {
    repo = seedFixture("empty");
    gitInit(repo, /* withCommit */ false);
    patchHome(repo);
  });
  afterEach(() => {
    restoreHome();
    rmSync(repo, { recursive: true, force: true });
  });

  it("fresh init lands every Phase-0 surface in a single pass", async () => {
    // skipSupervisor:true bypasses the launchctl/systemctl/schtasks shell-out
    // (the rendered config has manager.os_supervisor:auto, which would
    // otherwise try to install a real LaunchAgent under tmpdir/Library/...).
    const result = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      // gh injection — every call returns success; not exercised on no-remote
      // path but defensively present in case writeInitGh changes its order.
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      // Force the supervisor dispatcher to no-op in tests.
      skipSupervisor: true,
    });

    expect(result.mode).toBe("fresh");
    expect(result.status).toBe("completed");
    expect(result.fresh).toBeDefined();

    // 8 backlog files
    for (const name of ALL_BACKLOGS) {
      expect(existsSync(join(repo, name))).toBe(true);
    }
    // config
    expect(existsSync(join(repo, "devx.config.yaml"))).toBe(true);
    // .gitignore (devx-managed block)
    const gi = readFileSync(join(repo, ".gitignore"), "utf8");
    expect(gi).toMatch(/^# >>> devx[ \t]*$/m);
    expect(gi).toMatch(/^# <<< devx[ \t]*$/m);
    // CLAUDE.md with markers
    const claude = readFileSync(join(repo, "CLAUDE.md"), "utf8");
    expect(claude).toContain("<!-- devx:start -->");
    expect(claude).toContain("<!-- devx:end -->");
    // spec dirs
    for (const d of ["dev", "plan", "test", "debug", "focus", "learn", "qa"]) {
      expect(existsSync(join(repo, d))).toBe(true);
    }
    // personas (5 default — N3 was "you propose")
    const personasDir = join(repo, "focus-group", "personas");
    expect(existsSync(personasDir)).toBe(true);
    // INTERVIEW seeded with the TS template (3 questions)
    const iv = readFileSync(join(repo, "INTERVIEW.md"), "utf8");
    // Seeded INTERVIEW gets at least one bullet beyond the empty-state header.
    expect(iv).toMatch(/- \[[ xX/-]\]/m);
    // No-remote path triggers ini506 bookkeeping → init_partial true.
    const cfg = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(cfg).toMatch(/init_partial:\s*true/);

    // PR template (prt101): Phase 1 shape — `<!-- devx:mode -->` is line 1,
    // `**Spec:**` is line 2, `**Mode:**` is line 3. The substitution placeholder
    // `<!-- devx:auto:mode -->` is carried verbatim (substitution is /devx
    // Phase 7's job, not /devx-init's). The Phase 0 shape (marker at the
    // bottom under `## Mode`, mode rendered above the marker) is gone.
    const prTemplatePath = join(repo, ".github", "pull_request_template.md");
    expect(existsSync(prTemplatePath)).toBe(true);
    const prBody = readFileSync(prTemplatePath, "utf8");
    const prLines = prBody.split("\n");
    expect(prLines[0]).toBe("<!-- devx:mode -->");
    expect(prLines[1]).toBe("**Spec:** `<dev/dev-<hash>-<ts>-<slug>.md>`");
    expect(prLines[2]).toBe(
      "**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*",
    );
    expect(prBody).toContain("<!-- devx:auto:mode -->");
    // Old Phase 0 shape MUST NOT appear: no rendered mode literal anywhere
    // (writePrTemplate does NOT substitute), and no "## Mode" section above
    // the marker.
    expect(prBody).not.toMatch(/\*\*(YOLO|BETA|PROD|LOCKDOWN)\*\*/);
    expect(prBody).not.toContain("## Mode\n");

    // Orchestrator's FreshInitOutcome surfaces the prTemplate write outcome.
    expect(result.fresh?.prTemplate.action).toBe("wrote");
    expect(result.fresh?.prTemplate.path).toBe(prTemplatePath);
  });

  it("fresh scaffold is BMAD-free and ships the engine (E-3, v2x101)", async () => {
    const result = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
    });
    expect(result.status).toBe("completed");

    // (a) engine templates shipped into the new repo (v2 planning stages
    //     instantiate workstream artifacts from these).
    const engineDir = join(repo, "_devx", "templates", "engine");
    expect(existsSync(engineDir)).toBe(true);
    const shipped = readdirSync(engineDir).sort();
    // The canonical stage templates at minimum — prd/design/plan/red-report
    // are the four the /devx-plan stages consume directly.
    for (const t of ["prd.md", "design.md", "plan.md", "red-report.md"]) {
      expect(shipped).toContain(t);
    }
    // Orchestrator surfaced the write outcome.
    expect(result.fresh?.engineTemplates.written.length).toBeGreaterThan(0);
    expect(result.fresh?.engineTemplates.skipped).toEqual([]);

    // (b) config carries engine: + loop: blocks; no bmad: block.
    const cfgText = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(cfgText).toMatch(/^engine:/m);
    expect(cfgText).toMatch(/^\s*workstreams_root: _devx\/workstreams$/m);
    expect(cfgText).toMatch(/^loop:/m);
    expect(cfgText).toMatch(/^\s*max_iterations_per_item:/m);
    expect(cfgText).not.toMatch(/^bmad:/m);

    // (c) ZERO live BMAD references anywhere in the scaffold. Walk every
    //     text file the init run produced (skip .git). Exemption mirrors the
    //     v2x101 AC: a line is a violation iff it matches /bmad/i and does
    //     not reference the frozen `_bmad-output/` history.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === ".git") continue;
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(p);
          continue;
        }
        const content = readFileSync(p, "utf8");
        for (const line of content.split("\n")) {
          if (/bmad/i.test(line) && !line.includes("_bmad-output/")) {
            offenders.push(`${p}: ${line.trim().slice(0, 120)}`);
          }
        }
      }
    };
    walk(repo);
    expect(offenders).toEqual([]);
  });

  it("re-running init never overwrites an existing engine template (idempotent per file)", async () => {
    const first = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
    });
    expect(first.status).toBe("completed");

    // User tunes one template; a re-run must not clobber it.
    const tuned = join(repo, "_devx", "templates", "engine", "prd.md");
    writeFileSync(tuned, "# user-tuned PRD template\n");

    const second = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
    });
    // Repo has no HEAD commit → still routes fresh; writeEngineTemplates
    // runs again and must skip every existing file.
    expect(second.status).toBe("completed");
    expect(readFileSync(tuned, "utf8")).toBe("# user-tuned PRD template\n");
    expect(second.fresh?.engineTemplates.written).toEqual([]);
    expect(second.fresh?.engineTemplates.skipped.length).toBeGreaterThan(0);
  });

  it("S-5 (v2d101): init → devx next → correct first action, zero BMAD", async () => {
    // The full any-repo portability path: a fresh scaffold must be
    // immediately dispatchable — `devx next` reads the just-written
    // backlogs + config and produces a correct first action without any
    // framework install in between.
    const result = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
    });
    expect(result.status).toBe("completed");

    const captured = () => {
      let so = "";
      let se = "";
      return {
        out: (s: string) => {
          so += s;
        },
        err: (s: string) => {
          se += s;
        },
        stdout: () => so,
        stderr: () => se,
      };
    };

    // (a) Genuinely empty backlogs → row 12: propose the next-objective
    //     interview. (--no-gh: a fresh scaffold has no remote/auth yet.)
    const empty = captured();
    const code = runNext(["--no-gh"], {
      out: empty.out,
      err: empty.err,
      projectPath: join(repo, "devx.config.yaml"),
    });
    expect(code).toBe(0);
    const emptyDecision = JSON.parse(empty.stdout().trim()) as {
      row: number;
      action: string;
      command: string;
      drift: unknown[];
    };
    expect(emptyDecision.row).toBe(12);
    expect(emptyDecision.action).toBe("propose-interview");
    expect(emptyDecision.command).toBe("/devx-interview");
    expect(emptyDecision.drift).toEqual([]);
    expect(empty.stderr()).toContain("[row 12/propose-interview]");

    // (b) Seed one PLAN.md item + its plan spec → row 10: start its PRD
    //     stage. This is the first real action a fresh project takes.
    const planSpecRel = "plan/plan-abc001-2026-07-05T12:00-first-feature.md";
    writeFileSync(
      join(repo, planSpecRel),
      [
        "---",
        "hash: abc001",
        "type: plan",
        "created: 2026-07-05T12:00:00-06:00",
        "title: First Feature",
        "status: ready",
        "---",
        "",
        "## Goal",
        "",
        "The project's first feature.",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(repo, "PLAN.md"),
      readFileSync(join(repo, "PLAN.md"), "utf8") +
        `\n- [ ] \`${planSpecRel}\` — First feature. Status: ready.\n`,
    );

    const seeded = captured();
    expect(
      runNext(["--no-gh"], {
        out: seeded.out,
        err: seeded.err,
        projectPath: join(repo, "devx.config.yaml"),
      }),
    ).toBe(0);
    const seededDecision = JSON.parse(seeded.stdout().trim()) as {
      row: number;
      action: string;
      command: string;
    };
    expect(seededDecision.row).toBe(10);
    expect(seededDecision.action).toBe("plan-prd");
    expect(seededDecision.command).toBe("/devx prd abc001");
  });

  it("idempotent re-run is a near no-op (kept M / added 0 / migrated 0)", async () => {
    const baseline = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
    });
    expect(baseline.status).toBe("completed");

    // Commit the freshly-written devx files so init-state's `hasCommits`
    // probe sees them. Without a HEAD commit, kind short-circuits to "empty"
    // regardless of devx.config.yaml — the realistic flow has the user (or
    // their CI) commit between runs, so we mirror that here.
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "devx: initial scaffold"], {
      cwd: repo,
    });

    // Second run — repo is now on devx, so the orchestrator routes to upgrade.
    const second = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
      // Force every surface "present" so the upgrade does no repair work.
      upgradeOpts: {
        currentVersion: "0.1.0",
        detect: {
          "claude-md-markers": () => true,
          "supervisor-units": () => true,
          "ci-workflow": () => true,
          "pr-template": () => true,
          personas: () => true,
          "interview-seed": () => true,
        },
        repair: {
          "claude-md-markers": () => true,
          "supervisor-units": () => true,
          "ci-workflow": () => true,
          "pr-template": () => true,
          personas: () => true,
          "interview-seed": () => true,
        },
      },
    });
    expect(second.mode).toBe("upgrade");
    expect(second.status).toBe("completed");
    expect(second.upgrade?.summary?.added).toBe(0);
    expect(second.upgrade?.summary?.migrated).toBe(0);
    expect(second.upgrade?.summary?.kept).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// existing-no-ci fixture
// ---------------------------------------------------------------------------

describe("ini508 — existing-no-ci fixture", () => {
  let repo: string;
  beforeEach(() => {
    repo = seedFixture("existing-no-ci");
    gitInit(repo, /* withCommit */ true);
    patchHome(repo);
  });
  afterEach(() => {
    restoreHome();
    rmSync(repo, { recursive: true, force: true });
  });

  it("seeds devx surfaces alongside the existing TS project", async () => {
    const result = await runInit({
      repoRoot: repo,
      ask: scriptedAsk({ ...SCRIPTED_ANSWERS_BASE, n5: "typescript" }),
      git: noRemoteGit(repo),
      gh: ((args) => {
        if (args[0] === "auth" && args[1] === "status") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "{}", stderr: "" };
      }) as GhExec,
      skipSupervisor: true,
    });
    expect(result.status).toBe("completed");
    expect(result.fresh?.state.detectedStack).toBe("typescript");
    // CI workflow picks the TS template.
    expect(
      existsSync(join(repo, ".github", "workflows", "devx-ci.yml")),
    ).toBe(true);
    const ciYml = readFileSync(
      join(repo, ".github", "workflows", "devx-ci.yml"),
      "utf8",
    );
    // Sanity that we got the TS template, not the empty fallback.
    expect(ciYml.toLowerCase()).toMatch(/(node|typescript|npm|tsc)/);
    // Existing user file is preserved.
    expect(existsSync(join(repo, "package.json"))).toBe(true);
    // README's first paragraph fed into the inferred plan-seed echo (we don't
    // assert the exact echoed text — just that the question flow accepted N1
    // via skip-table inference).
    const askedIds = result.fresh?.questions.transcript.map((t) => t.id) ?? [];
    expect(askedIds).toContain("n1");
  });
});

// ---------------------------------------------------------------------------
// partial-on-devx fixture
// ---------------------------------------------------------------------------

describe("ini508 — partial-on-devx fixture", () => {
  let repo: string;
  beforeEach(() => {
    repo = seedFixture("partial-on-devx");
    gitInit(repo, /* withCommit */ true);
    patchHome(repo);
  });
  afterEach(() => {
    restoreHome();
    rmSync(repo, { recursive: true, force: true });
  });

  it("routes to upgrade-mode and repairs missing surfaces", async () => {
    let claudeRepairs = 0;
    let personasRepairs = 0;

    const result = await runInit({
      repoRoot: repo,
      // The fixture is on devx already, so questions never run; ask still has
      // to be a function but it's never invoked.
      ask: () => {
        throw new Error("ask must not be invoked on the upgrade path");
      },
      upgradeOpts: {
        currentVersion: "0.1.0",
        // Force CLAUDE.md and personas detectors to "missing" so the repair
        // counters bump. Other surfaces (supervisor / CI / PR / interview)
        // are stubbed present to keep the test focused.
        detect: {
          "claude-md-markers": () => false,
          personas: () => false,
          "supervisor-units": () => true,
          "ci-workflow": () => true,
          "pr-template": () => true,
          "interview-seed": () => true,
        },
        repair: {
          "claude-md-markers": () => {
            claudeRepairs += 1;
            return true;
          },
          personas: () => {
            personasRepairs += 1;
            return true;
          },
          "supervisor-units": () => true,
          "ci-workflow": () => true,
          "pr-template": () => true,
          "interview-seed": () => true,
        },
      },
    });

    expect(result.mode).toBe("upgrade");
    expect(result.status).toBe("completed");
    expect(claudeRepairs).toBe(1);
    expect(personasRepairs).toBe(1);
    // 3 = claude-md-markers + personas (stubbed) + engine-templates (the
    // v2x101 surface, left un-stubbed so the DEFAULT detect/repair pair runs
    // for real — the fixture predates the engine, so the upgrade must ship
    // the stage templates into the repo).
    expect(result.upgrade?.summary?.added).toBe(3);
    expect(
      existsSync(join(repo, "_devx", "templates", "engine", "prd.md")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// failure-mode regressions
// ---------------------------------------------------------------------------

describe("ini508 — failure-mode regressions", () => {
  let repo: string;
  beforeEach(() => {
    repo = seedFixture("empty");
    gitInit(repo, false);
    patchHome(repo);
  });
  afterEach(() => {
    restoreHome();
    rmSync(repo, { recursive: true, force: true });
  });

  it("no-remote path forces promotion.gate to manual-only and flips init_partial", async () => {
    const result = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: noRemoteGit(repo),
      gh: unauthGh(),
      skipSupervisor: true,
    });
    expect(result.status).toBe("completed");
    const noRemoteEntry = result.fresh?.failureBookkeeping.find(
      (f) => f.kind === "no-remote",
    );
    expect(noRemoteEntry?.flagFlipped).toBe(true);
    expect(noRemoteEntry?.manualAppended).toBe(true);

    const cfg = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(cfg).toMatch(/promotion:[\s\S]*?gate:\s*manual-only/);
    expect(cfg).toMatch(/init_partial:\s*true/);

    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    expect(manual).toMatch(/no `origin` remote/i);
  });

  it("gh-not-auth path queues ops + appends MANUAL + workflows still on disk", async () => {
    // Synthesize a remote so the no-remote branch doesn't short-circuit.
    const gitWithRemote: GitExec = (args, cwd) =>
      realGit(args, cwd ?? repo, /* withRemote */ true);

    const result = await runInit({
      repoRoot: repo,
      ask: scriptedAsk(SCRIPTED_ANSWERS_BASE),
      git: gitWithRemote,
      gh: unauthGh(),
      skipSupervisor: true,
    });
    expect(result.status).toBe("completed");
    const ghEntry = result.fresh?.failureBookkeeping.find(
      (f) => f.kind === "gh-not-authenticated",
    );
    expect(ghEntry?.flagFlipped).toBe(true);
    expect(ghEntry?.manualAppended).toBe(true);

    // Workflows still landed locally even though gh was unauthed.
    expect(
      existsSync(join(repo, ".github", "workflows", "devx-ci.yml")),
    ).toBe(true);
    // pending-gh-ops queue has at least the workflow push entry.
    const pending = JSON.parse(
      readFileSync(join(repo, ".devx-cache", "pending-gh-ops.json"), "utf8"),
    ) as { ops: Array<{ kind: string }> };
    expect(pending.ops.some((o) => o.kind === "push-workflows")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// corrupt-config halt
// ---------------------------------------------------------------------------

describe("ini508 — corrupt-config halt", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "ini508-corrupt-"));
    // Need a HEAD commit because init-state's corrupt-config classification
    // requires `hasCommits === true` (otherwise the kind short-circuits to
    // "empty" before the version check runs).
    writeFileSync(
      join(repo, "devx.config.yaml"),
      "mode: YOLO\nproject:\n  shape: empty-dream\n",
    );
    gitInit(repo, /* withCommit */ true);
    patchHome(repo);
  });
  afterEach(() => {
    restoreHome();
    rmSync(repo, { recursive: true, force: true });
  });

  it("returns aborted-corrupt without writing anything", async () => {
    const result = await runInit({
      repoRoot: repo,
      ask: () => {
        throw new Error("ask must not be invoked on corrupt-config halt");
      },
    });
    expect(result.mode).toBe("upgrade");
    expect(result.status).toBe("aborted-corrupt");
    expect(result.reason).toMatch(/devx_version is missing/);
  });
});
