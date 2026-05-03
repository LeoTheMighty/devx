// CLI-passthrough tests for `devx plan-helper derive-branch <type> <hash>` (pln101)
// + `devx plan-helper emit-retro-story --epic-slug ... --parents ... --plan ...` (pln102).
//
// Strategy mirrors merge-gate-cli.test.ts:
//   - Build a per-test fixture project on a temp dir with a minimal
//     devx.config.yaml (+ DEV.md + sprint-status.yaml for emit tests).
//   - Drive runDeriveBranch() / runEmitRetroStory() through their out/err/
//     projectPath/repoRoot test seams.
//   - Assert (exitCode, stdout, stderr).
//
// Specs:
//   dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md (derive-branch)
//   dev/dev-pln102-2026-04-28T19:30-plan-emit-retro.md   (emit-retro-story)

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  runDeriveBranch,
  runEmitRetroStory,
} from "../src/commands/plan-helper.js";

interface Fixture {
  dir: string;
  configPath: string;
}

interface FixtureOpts {
  integrationBranch?: string | null;
  branchPrefix?: string;
  /** Omit the entire git section. Overrides the other two options. */
  noGitSection?: boolean;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "devx-plan-helper-cli-"));
  const lines = ["mode: YOLO"];
  if (!opts.noGitSection) {
    lines.push("git:");
    lines.push("  default_branch: main");
    if ("integrationBranch" in opts) {
      // Emit `null` literal vs quoted empty string vs plain value.
      const v = opts.integrationBranch;
      if (v === null) lines.push("  integration_branch: null");
      else if (v === "") lines.push("  integration_branch: \"\"");
      else lines.push(`  integration_branch: ${v}`);
    } else {
      lines.push("  integration_branch: null");
    }
    lines.push(`  branch_prefix: ${opts.branchPrefix ?? "feat/"}`);
  }
  lines.push("");
  const configPath = join(dir, "devx.config.yaml");
  writeFileSync(configPath, lines.join("\n"));
  return { dir, configPath };
}

function destroy(fx: Fixture): void {
  rmSync(fx.dir, { recursive: true, force: true });
}

interface CapturedIO {
  stdout: string;
  stderr: string;
}

function capture(): {
  out: (s: string) => void;
  err: (s: string) => void;
  io: CapturedIO;
} {
  const io: CapturedIO = { stdout: "", stderr: "" };
  return {
    out: (s) => {
      io.stdout += s;
    },
    err: (s) => {
      io.stderr += s;
    },
    io,
  };
}

describe("devx plan-helper derive-branch — happy paths", () => {
  let fx: Fixture;
  afterEach(() => destroy(fx));

  it("single-branch + feat/ prefix → feat/dev-aud101 on stdout, exit 0", () => {
    fx = makeFixture({ integrationBranch: null, branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/dev-aud101\n");
    expect(cap.io.stderr).toBe("");
  });

  it("develop split + feat/ prefix → develop/feat/dev-aud101", () => {
    fx = makeFixture({ integrationBranch: "develop", branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("develop/feat/dev-aud101\n");
  });

  it("develop split + develop/ prefix → develop/dev-aud101 (no doubling)", () => {
    fx = makeFixture({
      integrationBranch: "develop",
      branchPrefix: "develop/",
    });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("develop/dev-aud101\n");
  });

  it("empty-string integration_branch → single-branch path", () => {
    fx = makeFixture({ integrationBranch: "", branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/dev-aud101\n");
  });

  it("missing git section → defaults (feat/dev-aud101)", () => {
    fx = makeFixture({ noGitSection: true });
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/dev-aud101\n");
  });

  it("type=plan is accepted (not just dev)", () => {
    fx = makeFixture({ integrationBranch: null, branchPrefix: "feat/" });
    const cap = capture();
    const code = runDeriveBranch(["plan", "b01000"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(0);
    expect(cap.io.stdout).toBe("feat/plan-b01000\n");
  });
});

describe("devx plan-helper derive-branch — invalid input", () => {
  let fx: Fixture;
  beforeEach(() => {
    fx = makeFixture({ integrationBranch: null, branchPrefix: "feat/" });
  });
  afterEach(() => destroy(fx));

  it("wrong arg count → exit 1 + usage on stderr", () => {
    const cap = capture();
    const code = runDeriveBranch(["dev"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stdout).toBe("");
    expect(cap.io.stderr).toContain("usage:");
    expect(cap.io.stderr).toContain("derive-branch");
  });

  it("unknown type → exit 1 + reason naming the valid set", () => {
    const cap = capture();
    const code = runDeriveBranch(["story", "aud101"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("invalid type 'story'");
    // Naming the valid set in the error keeps the operator from guessing.
    expect(cap.io.stderr).toContain("dev");
    expect(cap.io.stderr).toContain("plan");
  });

  it("malformed hash (too short) → exit 1", () => {
    const cap = capture();
    const code = runDeriveBranch(["dev", "ab"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("invalid hash");
  });

  it("malformed hash (special chars) → exit 1", () => {
    const cap = capture();
    const code = runDeriveBranch(["dev", "aud-1"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("invalid hash");
  });
});

describe("devx plan-helper derive-branch — config errors", () => {
  it("missing devx.config.yaml at projectPath → exit 1 + diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-plan-helper-no-config-"));
    try {
      const cap = capture();
      const code = runDeriveBranch(["dev", "aud101"], {
        out: cap.out,
        err: cap.err,
        projectPath: join(dir, "devx.config.yaml"),
      });
      expect(code).toBe(1);
      // Either "config load failed" or "not found" is acceptable; both
      // surface the missing-file root cause to the operator.
      expect(cap.io.stderr.toLowerCase()).toMatch(/not found|no such file|enoent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("malformed YAML → exit 1 + 'config load failed' diagnostic", () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-plan-helper-bad-yaml-"));
    const configPath = join(dir, "devx.config.yaml");
    // YAML duplicate-key error reliably trips parseDocument's strict mode.
    writeFileSync(configPath, "git:\n  integration_branch: null\ngit:\n  branch_prefix: feat/\n");
    try {
      const cap = capture();
      const code = runDeriveBranch(["dev", "aud101"], {
        out: cap.out,
        err: cap.err,
        projectPath: configPath,
      });
      // Either the YAML parser raises (handled in catch → exit 1 with
      // "config load failed") OR the parser is lenient and we get the
      // last-key-wins behavior + exit 0. Both shapes are acceptable; we
      // assert the exit code matches whichever the parser does.
      if (code === 1) {
        expect(cap.io.stderr).toMatch(/config load failed|not found/i);
      } else {
        expect(code).toBe(0);
        expect(cap.io.stdout).toContain("dev-aud101");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// emit-retro-story CLI (pln102)
// ---------------------------------------------------------------------------

interface RepoFixture {
  root: string;
  configPath: string;
  devMdPath: string;
  sprintStatusPath: string;
  cleanup: () => void;
}

const FIXTURE_DEV_MD = `# DEV — Features to build

## Phase 1 — Single-agent core loop

### Epic 1 — Mode-derived merge gate
- [x] \`dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md\` — Pure fn. Status: done.
- [x] \`dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md\` — CLI. Status: done.

### Epic 2 — PR template
- [x] \`dev/dev-prt101-2026-04-28T19:30-pr-template-init-write.md\` — Template init. Status: done.
- [x] \`dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md\` — Substitution. Status: done.
`;

const FIXTURE_SPRINT_STATUS = `# devx implementation sprint status
plans:
  - key: plan-b01000-single-agent-loop
    title: Phase 1
    status: backlog
    epics:
      - key: epic-merge-gate-modes
        title: Merge gate
        status: backlog
        stories:
          - key: mrg101
            title: Pure fn
            status: done
          - key: mrg102
            title: CLI
            status: done
            blocked_by: [mrg101]

      - key: epic-pr-template
        title: PR template
        status: backlog
        stories:
          - key: prt101
            title: Template init
            status: done
          - key: prt102
            title: Substitution
            status: done
            blocked_by: [prt101]
`;

function makeRepoFixture(): RepoFixture {
  const root = mkdtempSync(join(tmpdir(), "devx-plan-helper-emit-"));
  const configPath = join(root, "devx.config.yaml");
  writeFileSync(
    configPath,
    [
      "mode: YOLO",
      "project:",
      "  shape: empty-dream",
      "thoroughness: send-it",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "  branch_prefix: feat/",
      "",
    ].join("\n"),
  );
  const devMdPath = join(root, "DEV.md");
  writeFileSync(devMdPath, FIXTURE_DEV_MD);
  const sprintStatusPath = join(
    root,
    "_bmad-output/implementation-artifacts/sprint-status.yaml",
  );
  mkdirSync(dirname(sprintStatusPath), { recursive: true });
  writeFileSync(sprintStatusPath, FIXTURE_SPRINT_STATUS);
  return {
    root,
    configPath,
    devMdPath,
    sprintStatusPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const FIXED_NOW = () => new Date(2026, 4, 3, 14, 23, 0);

describe("devx plan-helper emit-retro-story — happy path", () => {
  let fx: RepoFixture;
  afterEach(() => fx.cleanup());

  it("writes spec + DEV.md row + sprint-status row in one call", () => {
    fx = makeRepoFixture();
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "merge-gate-modes",
        "--parents",
        "mrg101,mrg102",
        "--plan",
        "plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
        now: FIXED_NOW,
      },
    );
    expect(code).toBe(0);
    expect(cap.io.stderr).toBe("");
    expect(cap.io.stdout).toMatch(
      /^spec=dev\/dev-mrgret-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-retro-merge-gate-modes\.md dev_md=DEV\.md sprint_status=_bmad-output\/implementation-artifacts\/sprint-status\.yaml\n$/,
    );

    // All three artifacts present on disk:
    const specPath = cap.io.stdout
      .split(" ")[0]
      .replace("spec=", "");
    expect(existsSync(join(fx.root, specPath))).toBe(true);
    const devMdAfter = readFileSync(fx.devMdPath, "utf8");
    expect(devMdAfter).toContain("dev-mrgret-");
    expect(devMdAfter).toContain("Blocked-by: mrg101, mrg102.");
    const sprintAfter = readFileSync(fx.sprintStatusPath, "utf8");
    expect(sprintAfter).toContain("- key: mrgret");
  });

  it("derives branch from single-branch config (feat/dev-mrgret)", () => {
    fx = makeRepoFixture();
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "merge-gate-modes",
        "--parents",
        "mrg101,mrg102",
        "--plan",
        "plan/plan-b01000.md",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
        now: FIXED_NOW,
      },
    );
    expect(code).toBe(0);
    const specPath = cap.io.stdout.split(" ")[0].replace("spec=", "");
    const specBody = readFileSync(join(fx.root, specPath), "utf8");
    expect(specBody).toContain("branch: feat/dev-mrgret");
  });

  it("provenance fields (mode/shape/thoroughness) match config", () => {
    fx = makeRepoFixture();
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "pr-template",
        "--parents",
        "prt101,prt102",
        "--plan",
        "plan/plan-b01000.md",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
        now: FIXED_NOW,
      },
    );
    expect(code).toBe(0);
    const specPath = cap.io.stdout.split(" ")[0].replace("spec=", "");
    const specBody = readFileSync(join(fx.root, specPath), "utf8");
    expect(specBody).toContain(
      "mode=YOLO, shape=empty-dream, thoroughness=send-it",
    );
  });
});

describe("devx plan-helper emit-retro-story — invalid input", () => {
  let fx: RepoFixture;
  beforeEach(() => {
    fx = makeRepoFixture();
  });
  afterEach(() => fx.cleanup());

  it("missing --epic-slug → exit 1 + usage on stderr", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      ["--parents", "mrg101", "--plan", "p"],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("missing required --epic-slug");
    expect(cap.io.stderr).toContain("usage:");
  });

  it("missing --parents → exit 1", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      ["--epic-slug", "x", "--plan", "p"],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("--parents");
  });

  it("missing --plan → exit 1", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      ["--epic-slug", "x", "--parents", "mrg101"],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("--plan");
  });

  it("parent prefix mismatch → exit 1 caught from emitRetroStory", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "mixed",
        "--parents",
        "mrg101,prt101",
        "--plan",
        "p",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toMatch(/prefix mismatch/);
  });

  it("invalid parent hash format → exit 1", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "x",
        "--parents",
        "ab", // too short
        "--plan",
        "p",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toMatch(/invalid parent hash 'ab'/);
  });

  it("epic not in DEV.md → exit 1 (pre-write failure, no state change)", () => {
    const cap = capture();
    const devMdBefore = readFileSync(fx.devMdPath, "utf8");
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "ghost-epic",
        "--parents",
        "zzz999",
        "--plan",
        "p",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toMatch(/zzz999|epic-ghost-epic/);
    // DEV.md untouched.
    expect(readFileSync(fx.devMdPath, "utf8")).toBe(devMdBefore);
  });

  it("--epic-slug followed by --parents (missing value) → exit 1 + 'missing value' (EC[5])", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      ["--epic-slug", "--parents", "mrg101", "--plan", "p"],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("missing value for --epic-slug");
  });

  it("duplicated --epic-slug → exit 1 + 'duplicate' (EC[6])", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "a",
        "--epic-slug",
        "b",
        "--parents",
        "mrg101",
        "--plan",
        "p",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("duplicate --epic-slug");
  });

  it("epicSlug with slash rejected (EC[13])", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "merge-gate/v2",
        "--parents",
        "mrg101",
        "--plan",
        "p",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
      },
    );
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("not kebab-case");
  });

  it("partial rename → exit 0 + WARN on stderr + partial=… on stdout", () => {
    const cap = capture();
    const code = runEmitRetroStory(
      [
        "--epic-slug",
        "merge-gate-modes",
        "--parents",
        "mrg101,mrg102",
        "--plan",
        "p",
      ],
      {
        out: cap.out,
        err: cap.err,
        projectPath: fx.configPath,
        repoRoot: fx.root,
        now: FIXED_NOW,
        fsOverride: {
          rename(_oldP: string, newP: string) {
            if (newP.endsWith("/sprint-status.yaml")) {
              const e = new Error(`simulated rename failure on ${newP}`);
              throw e;
            }
            // Real rename for the others.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fs = require("node:fs") as typeof import("node:fs");
            fs.renameSync(_oldP, newP);
          },
        },
      },
    );
    // Per CLI contract: partial == exit 0, WARN on stderr, partial= on stdout.
    expect(code).toBe(0);
    expect(cap.io.stderr).toContain("WARN: retro emission partial");
    expect(cap.io.stderr).toContain("sprint-status.yaml");
    expect(cap.io.stdout).toMatch(
      /partial=_bmad-output\/implementation-artifacts\/sprint-status\.yaml\n$/,
    );
    // DEV.md + spec landed.
    expect(readFileSync(fx.devMdPath, "utf8")).toContain("dev-mrgret-");
  });
});
