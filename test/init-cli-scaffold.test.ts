// pin103 — bare `devx init` non-interactive scaffold (E-3 + E-4 as vitest
// scenarios, built on the ini508 fixture-harness pattern).
//
// These drive the CLI entrypoint (runInit from src/commands/init.ts), not the
// orchestrator directly — the wiring under test is detectInitState() →
// defaults AnswerProvider → runInit() (fresh|upgrade) → installSkills(),
// plus the INTERVIEW.md deferred-decision + MANUAL.md supervisor-deferral
// bookkeeping. The standalone evals (_devx/workstreams/portability-install/
// evals/E-3, E-4) spawn the built dist/cli.js for the same contract.
//
// Spec: dev/dev-pin103-2026-07-14T12:02-init-noninteractive-scaffold.md

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInit } from "../src/commands/init.js";
import { appendDeferredDecisions, buildDefaultsAsk } from "../src/lib/init-defaults.js";
import type { InitState } from "../src/lib/init-state.js";
import type { AskContext } from "../src/lib/init-questions.js";

const FIXED_NOW = () => new Date("2026-07-15T09:00:00.000Z");

const BACKLOGS = [
  "DEV.md",
  "PLAN.md",
  "TEST.md",
  "DEBUG.md",
  "FOCUS.md",
  "INTERVIEW.md",
  "MANUAL.md",
  "LESSONS.md",
];
const SKILLS = ["devx.md", "devx-plan.md", "devx-interview.md"];

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "pin103-scaffold-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "pin103@test.local"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "pin103 test"], { cwd: repo });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repo });
  return repo;
}

interface Cap {
  out: string;
  err: string;
  o: (s: string) => void;
  e: (s: string) => void;
}
function capture(): Cap {
  const c: Cap = {
    out: "",
    err: "",
    o: (s) => {
      c.out += s;
    },
    e: (s) => {
      c.err += s;
    },
  };
  return c;
}

describe("pin103 — bare `devx init` scaffold (fresh repo)", () => {
  let repo: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    repo = makeRepo();
    // Hermetic HOME: user-prefs probe + any ~ fallback stay inside the tmp dir.
    prevHome = process.env.HOME;
    process.env.HOME = repo;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(repo, { recursive: true, force: true });
  });

  it("lands the full artifact set incl. header-bearing skills (E-3 shape)", async () => {
    const c = capture();
    await runInit([], { repoRoot: repo, out: c.o, err: c.e, now: FIXED_NOW });

    expect(c.out).toContain("fresh scaffold completed");
    expect(existsSync(join(repo, "devx.config.yaml"))).toBe(true);
    for (const b of BACKLOGS) {
      expect(existsSync(join(repo, b)), `${b} missing`).toBe(true);
    }
    for (const d of ["dev", "plan"]) {
      expect(existsSync(join(repo, d)), `${d}/ missing`).toBe(true);
    }
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8").toLowerCase()).toContain("devx");
    expect(existsSync(join(repo, ".github", "workflows"))).toBe(true);
    for (const s of SKILLS) {
      const p = join(repo, ".claude", "commands", s);
      expect(existsSync(p), `${s} missing`).toBe(true);
      expect(readFileSync(p, "utf8")).toContain("devx-skill v");
    }
  });

  it("files deferred product decisions in INTERVIEW.md and the supervisor deferral in MANUAL.md", async () => {
    const c = capture();
    await runInit([], { repoRoot: repo, out: c.o, err: c.e, now: FIXED_NOW });

    const interview = readFileSync(join(repo, "INTERVIEW.md"), "utf8");
    // n1 (no README), n2 (first slice), n3 (audience) are the product
    // decisions the defaults provider cannot derive on an empty repo.
    for (const id of ["n1", "n2", "n3"]) {
      expect(interview, `INTERVIEW.md missing deferred anchor for ${id}`).toContain(
        `<!-- devx:init-defaults:${id} -->`,
      );
    }
    expect(interview).toContain("(from devx init)");

    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    expect(manual).toContain("devx:init-failure:supervisor-install-deferred");
    expect(c.out).toContain("OS-supervisor install deferred");

    // No remote in the fixture → gh-side ops deferred; stdout must say so
    // (the interactive flow narrates this; here stdout is all the user gets).
    expect(c.out).toContain("--resume-gh");
  });

  it("--skip-skills scaffolds without touching .claude/commands", async () => {
    const c = capture();
    await runInit(["--skip-skills"], { repoRoot: repo, out: c.o, err: c.e, now: FIXED_NOW });

    expect(c.out).toContain("skills install skipped");
    expect(existsSync(join(repo, "devx.config.yaml"))).toBe(true);
    for (const s of SKILLS) {
      expect(existsSync(join(repo, ".claude", "commands", s))).toBe(false);
    }
  });

  it("--global installs skills under <home>/.claude/commands instead of the repo", async () => {
    const home = mkdtempSync(join(tmpdir(), "pin103-home-"));
    try {
      const c = capture();
      await runInit(["--global"], {
        repoRoot: repo,
        out: c.o,
        err: c.e,
        now: FIXED_NOW,
        homeDir: home,
      });
      for (const s of SKILLS) {
        expect(existsSync(join(home, ".claude", "commands", s)), `${s} not in home`).toBe(true);
        expect(existsSync(join(repo, ".claude", "commands", s)), `${s} leaked into repo`).toBe(
          false,
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects --resume-gh combined with scaffold flags", async () => {
    await expect(
      runInit(["--resume-gh", "--global"], { repoRoot: repo, out: () => {}, err: () => {} }),
    ).rejects.toThrow(/does not combine/);
  });
});

describe("pin103 — re-run takes the upgrade path (E-4 shape)", () => {
  let repo: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    repo = makeRepo();
    prevHome = process.env.HOME;
    process.env.HOME = repo;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(repo, { recursive: true, force: true });
  });

  it("preserves a headerless user-owned skill byte-identical, files MANUAL, keeps headers elsewhere", async () => {
    const first = capture();
    await runInit([], { repoRoot: repo, out: first.o, err: first.e, now: FIXED_NOW });
    expect(first.out).toContain("fresh scaffold completed");

    const devxSkill = join(repo, ".claude", "commands", "devx.md");
    const USER_CONTENT = "# my own devx command\n\nhands off\n";
    writeFileSync(devxSkill, USER_CONTENT);

    const second = capture();
    await runInit([], { repoRoot: repo, out: second.o, err: second.e, now: FIXED_NOW });
    expect(second.out).toContain("upgrade scaffold completed");

    // User-owned file untouched, byte-identical.
    expect(readFileSync(devxSkill, "utf8")).toBe(USER_CONTENT);
    // MANUAL.md carries the skip-user-owned entry naming the file.
    expect(readFileSync(join(repo, "MANUAL.md"), "utf8")).toMatch(/devx\.md/);
    // Sibling header-bearing skill kept its version header.
    expect(readFileSync(join(repo, ".claude", "commands", "devx-plan.md"), "utf8")).toContain(
      "devx-skill v",
    );

    // The upgrade arm must NOT run the real supervisor repair (pin103 review
    // finding, empirically confirmed: the unpinned upgrade wrote a real
    // ~/Library/LaunchAgents plist during this story's eval run). HOME is
    // patched to the repo — any launchd install would land here.
    expect(existsSync(join(repo, "Library", "LaunchAgents"))).toBe(false);
  });

  it("re-run upgrades a header-bearing skill with an OLDER version in place", async () => {
    await runInit([], { repoRoot: repo, out: () => {}, err: () => {}, now: FIXED_NOW });

    const planSkill = join(repo, ".claude", "commands", "devx-plan.md");
    const body = readFileSync(planSkill, "utf8");
    const downgraded = body.replace(/^<!-- devx-skill v\S+ -->$/m, "<!-- devx-skill v0.0.1 -->");
    expect(downgraded).not.toBe(body);
    writeFileSync(planSkill, downgraded);

    await runInit([], { repoRoot: repo, out: () => {}, err: () => {}, now: FIXED_NOW });
    const after = readFileSync(planSkill, "utf8");
    expect(after).toContain("devx-skill v");
    expect(after).not.toContain("devx-skill v0.0.1 -->");
  });

  it("re-run does not duplicate INTERVIEW deferred decisions or the MANUAL supervisor entry", async () => {
    await runInit([], { repoRoot: repo, out: () => {}, err: () => {}, now: FIXED_NOW });
    await runInit([], { repoRoot: repo, out: () => {}, err: () => {}, now: FIXED_NOW });

    const interview = readFileSync(join(repo, "INTERVIEW.md"), "utf8");
    const n2Count = interview.split("<!-- devx:init-defaults:n2 -->").length - 1;
    expect(n2Count, "deferred n2 must appear exactly once across re-runs").toBe(1);

    const manual = readFileSync(join(repo, "MANUAL.md"), "utf8");
    const supCount = manual.split("devx:init-failure:supervisor-install-deferred").length - 1;
    expect(supCount, "supervisor deferral must appear exactly once").toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDefaultsAsk consistency (pin103 3-agent review findings)
// ---------------------------------------------------------------------------

function fakeState(partial: Partial<InitState>): InitState {
  return {
    kind: "existing",
    halts: [],
    hasCommits: true,
    currentBranch: "main",
    detectedStack: "typescript",
    detectedStackFile: "package.json",
    hasProdEnvVars: false,
    hasGithubWorkflows: false,
    hasTests: false,
    inferredShape: null,
    hasReadme: false,
    readmeFirstParagraph: null,
    personasPopulated: false,
    userConfigPath: "/nonexistent/.devx/config.yaml",
    ...partial,
  } as InitState;
}

function askFor(id: string) {
  return { question: { id, prompt: `prompt for ${id}` } } as unknown as AskContext;
}

describe("pin103 — buildDefaultsAsk mirrors the skip table's mode inference", () => {
  it("production-careful shape (no prod env vars) derives PROD-consistent n8/n9 and no false q32", () => {
    // The skip table silently answers n7=PROD for production-careful; the
    // provider's asked n8/n9 must be derived from that SAME mode — the
    // review's top finding was a PROD config with single-branch + initial_n=0.
    const { ask, deferred } = buildDefaultsAsk(
      fakeState({ inferredShape: "production-careful", hasTests: true }),
      { warn: () => {} },
    );
    expect(ask(askFor("n8"))).toBe("develop-main-split");
    expect(ask(askFor("n9"))).toEqual({ initialN: 3 });
    expect(deferred.find((d) => d.questionId === "q32")).toBeUndefined();
  });

  it("commits without a stack probe file take the conservative shape, not empty-dream", () => {
    const { ask } = buildDefaultsAsk(
      fakeState({ detectedStack: "empty", detectedStackFile: null, hasCommits: true }),
      { warn: () => {} },
    );
    expect(ask(askFor("n6"))).toBe("mature-refactor-and-add");
  });

  it("records invented n6/n7 answers as deferred decisions", () => {
    const { ask, deferred } = buildDefaultsAsk(fakeState({ inferredShape: null }), {
      warn: () => {},
    });
    ask(askFor("n6"));
    ask(askFor("n7"));
    expect(deferred.map((d) => d.questionId)).toEqual(
      expect.arrayContaining(["n6", "n7"]),
    );
  });

  it("onHalt records the bypassed halt as a deferred decision and proceeds", () => {
    const warned: string[] = [];
    const { onHalt, deferred } = buildDefaultsAsk(fakeState({}), {
      warn: (m) => warned.push(m),
    });
    const proceed = onHalt({
      kind: "uncommitted-changes",
      message: "working tree has uncommitted changes",
      options: [],
      fatal: false,
    });
    expect(proceed).toBe(true);
    expect(warned.some((m) => m.includes("uncommitted-changes"))).toBe(true);
    const d = deferred.find((x) => x.questionId === "halt-uncommitted-changes");
    expect(d?.why).toContain("uncommitted");
  });

  it("records a detached-HEAD notice when commits exist but no branch is checked out", () => {
    const { deferred } = buildDefaultsAsk(
      fakeState({ hasCommits: true, currentBranch: null }),
      { warn: () => {} },
    );
    expect(deferred.find((d) => d.questionId === "detached-head")).toBeDefined();
  });
});

describe("pin103 — appendDeferredDecisions error path", () => {
  it("throws loudly when INTERVIEW.md does not exist (broken call order)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pin103-append-"));
    try {
      expect(() =>
        appendDeferredDecisions({
          repoRoot: dir,
          deferred: [{ questionId: "n2", prompt: "p", chosen: "c", why: "w" }],
        }),
      ).toThrow(/init-write must scaffold INTERVIEW\.md first/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
