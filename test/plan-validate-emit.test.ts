// Tests for the pln103 cross-reference checker.
//
// Two layers:
//   1. Pure-fn tests for `validateEmit()` — drive a synthetic-epic fixture
//      via the readFile/exists/readdir seam to assert each of the six
//      checks fires (and doesn't false-positive on a clean fixture).
//   2. CLI passthrough tests for `runValidateEmit()` — exercise the
//      stdout/stderr/exit-code contract that the /devx-plan skill body
//      consumes.
//
// Spec: dev/dev-pln103-2026-04-28T19:30-plan-validate-emit.md

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runValidateEmit } from "../src/commands/plan-helper.js";
import {
  type ValidateEmitFs,
  type ValidationIssue,
  parseEpicDevMdRows,
  parseEpicSprintStatusStories,
  parseFrontmatterValue,
  parseLockedDecisions,
  parseStoryHashes,
  validateEmit,
} from "../src/lib/plan/validate-emit.js";

// ---------------------------------------------------------------------------
// Pure-fn fixture: an in-memory tree built per test, fed into validateEmit
// via the fs seam. Each test composes the tree it wants and asserts the
// resulting issue list. No temp-dir overhead.
// ---------------------------------------------------------------------------

// Factory rather than `class` because validateEmit spreads its fsOverride
// (`{...realFs, ...fsOverride}`) — class methods live on the prototype and
// don't survive object-spread. Factory functions return plain objects with
// the methods as own enumerable properties, which DO survive the spread.
interface MemoryFs extends ValidateEmitFs {
  put(absPath: string, content: string): void;
}

function newMemoryFs(): MemoryFs {
  const files = new Map<string, string>();
  const dirs = new Map<string, Set<string>>();
  return {
    put(absPath: string, content: string): void {
      files.set(absPath, content);
      const parts = absPath.split("/").filter((s) => s.length > 0);
      // Register every ancestor dir → its child entry. The walk treats the
      // empty-string head as the root "/" so `/synth/dev/x` registers
      // "/" → "synth", "/synth" → "dev", "/synth/dev" → "x".
      for (let i = 0; i < parts.length; i++) {
        const dirAbs = i === 0 ? "/" : "/" + parts.slice(0, i).join("/");
        const child = parts[i];
        if (!dirs.has(dirAbs)) dirs.set(dirAbs, new Set());
        dirs.get(dirAbs)!.add(child);
      }
    },
    readFile(p: string): string {
      const v = files.get(p);
      if (v === undefined) throw new Error(`MemoryFs: ENOENT: ${p}`);
      return v;
    },
    exists(p: string): boolean {
      return files.has(p) || dirs.has(p);
    },
    readdir(p: string): string[] {
      return [...(dirs.get(p) ?? [])];
    },
  };
}

// Synthetic-epic fixture builder. Yields a clean (validation-passing) tree;
// individual tests mutate it before invoking validateEmit.
interface Tree {
  fs: MemoryFs;
  repoRoot: string;
}

const REPO_ROOT = "/synth";

function cleanFixture(): Tree {
  const fs = newMemoryFs();
  const epicSlug = "fixture-epic";
  const epicPath = `${REPO_ROOT}/_bmad-output/planning-artifacts/epic-${epicSlug}.md`;
  fs.put(
    epicPath,
    `# Epic — fixture-epic

## Story list with ACs

### fix101 — first story
- [ ] AC 1.

### fix102 — second story
- [ ] AC 1.

### fixret — Retro: bmad-retrospective on epic-fixture-epic
- [ ] Run bmad-retrospective.

## Party-mode refined (2026-04-28)

### Findings + decisions

**Dev (backend framing).** Concern: x. **Locked decision:** fix101 AC bumped — atomicity uses \`*.tmp\` files first.

### Cross-epic locked decisions added to global list
1. **Sample.**
`,
  );
  fs.put(
    `${REPO_ROOT}/dev/dev-fix101-2026-04-28T19:30-first.md`,
    `---
hash: fix101
type: dev
created: 2026-04-28T19:30:00-07:00
title: first story
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
branch: feat/dev-fix101
---

## Goal
First.

## Acceptance criteria
- [ ] Atomicity uses \`*.tmp\` files first.
`,
  );
  fs.put(
    `${REPO_ROOT}/dev/dev-fix102-2026-04-28T19:30-second.md`,
    `---
hash: fix102
type: dev
created: 2026-04-28T19:30:00-07:00
title: second story
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
branch: feat/dev-fix102
---

## Goal
Second.

## Acceptance criteria
- [ ] AC 1.
`,
  );
  fs.put(
    `${REPO_ROOT}/dev/dev-fixret-2026-04-28T19:30-retro-fixture-epic.md`,
    `---
hash: fixret
type: dev
created: 2026-04-28T19:30:00-07:00
title: Retro
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
blocked_by: [fix101, fix102]
branch: feat/dev-fixret
---

## Goal
Retro.
`,
  );
  fs.put(
    `${REPO_ROOT}/DEV.md`,
    `# DEV

### Epic — fixture-epic
- [ ] \`dev/dev-fix101-2026-04-28T19:30-first.md\` — first story. Status: ready.
- [ ] \`dev/dev-fix102-2026-04-28T19:30-second.md\` — second story. Status: ready.
- [ ] \`dev/dev-fixret-2026-04-28T19:30-retro-fixture-epic.md\` — Retro. Status: ready. Blocked-by: fix101, fix102.
`,
  );
  fs.put(
    `${REPO_ROOT}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
    `plans:
  - key: plan-fixture
    title: Fixture
    status: backlog
    epics:
      - key: epic-fixture-epic
        title: Fixture
        status: backlog
        stories:
          - key: fix101
            title: first
            status: backlog
          - key: fix102
            title: second
            status: backlog
          - key: fixret
            title: Retro
            status: backlog
            blocked_by: [fix101, fix102]
`,
  );
  return { fs, repoRoot: REPO_ROOT };
}

const SINGLE_BRANCH_CONFIG = {
  git: { integration_branch: null, branch_prefix: "feat/" },
};

function findIssue(
  issues: ValidationIssue[],
  check: string,
): ValidationIssue | undefined {
  return issues.find((i) => i.check === check);
}

function findIssues(issues: ValidationIssue[], check: string): ValidationIssue[] {
  return issues.filter((i) => i.check === check);
}

// ---------------------------------------------------------------------------
// Layer 1 — pure validateEmit() against the fixture
// ---------------------------------------------------------------------------

describe("validateEmit — clean fixture", () => {
  it("returns epicFound:true and zero error-severity issues", () => {
    const { fs, repoRoot } = cleanFixture();
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(r.epicFound).toBe(true);
    const errs = r.issues.filter((i) => i.severity === "error");
    expect(errs).toEqual([]);
  });
});

describe("validateEmit — epic not found", () => {
  it("returns epicFound:false and exits cleanly (caller maps to exit 2)", () => {
    const fs = newMemoryFs();
    fs.put(`${REPO_ROOT}/DEV.md`, "");
    const r = validateEmit(
      { repoRoot: REPO_ROOT, epicSlug: "ghost", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(r.epicFound).toBe(false);
    expect(r.epicPath).toBe(
      `${REPO_ROOT}/_bmad-output/planning-artifacts/epic-ghost.md`,
    );
    expect(r.issues).toEqual([]);
  });
});

describe("validateEmit — check 1: epic story → spec exists", () => {
  it("flags a story listed in the epic with no matching dev spec", () => {
    const { fs, repoRoot } = cleanFixture();
    // Add a third story heading to the epic but no matching spec.
    const epicPath = `${repoRoot}/_bmad-output/planning-artifacts/epic-fixture-epic.md`;
    fs.put(
      epicPath,
      fs.readFile(epicPath).replace(
        "### fixret — Retro",
        "### fix103 — third story\n- [ ] AC.\n\n### fixret — Retro",
      ),
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "spec-missing");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("fix103");
    expect(issue!.location).toMatch(/epic-fixture-epic\.md:\d+/);
  });

  it("does not false-positive on party-mode subheadings (### Findings + decisions)", () => {
    const { fs, repoRoot } = cleanFixture();
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    // Findings + decisions is `### ` but doesn't match the hash regex —
    // making sure we don't emit a `spec-missing` for it.
    expect(
      r.issues.find(
        (i) =>
          i.check === "spec-missing" &&
          (i.message.includes("Findings") || i.message.includes("Cross-epic")),
      ),
    ).toBeUndefined();
  });
});

describe("validateEmit — check 2: DEV.md row → spec exists", () => {
  it("flags a DEV.md row pointing at a missing spec file", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/DEV.md`,
      `# DEV

### Epic — fixture-epic
- [ ] \`dev/dev-fix101-2026-04-28T19:30-first.md\` — first.
- [ ] \`dev/dev-fix102-2026-04-28T19:30-second.md\` — second.
- [ ] \`dev/dev-ghost9-2026-04-28T19:30-ghost.md\` — phantom row pointing at missing spec.
- [ ] \`dev/dev-fixret-2026-04-28T19:30-retro-fixture-epic.md\` — Retro. Blocked-by: fix101, fix102.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "devmd-row-points-at-missing-spec");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("dev-ghost9");
    expect(issue!.location).toMatch(/DEV\.md:\d+/);
  });

  it("does not false-positive when DEV.md rows reference real specs", () => {
    const { fs, repoRoot } = cleanFixture();
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(findIssues(r.issues, "devmd-row-points-at-missing-spec")).toEqual([]);
  });

  it("flags rows with [/], [-], [x] checkbox states (any state, not just [ ])", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/DEV.md`,
      `# DEV

### Epic — fixture-epic
- [/] \`dev/dev-fix101-2026-04-28T19:30-first.md\` — in progress.
- [x] \`dev/dev-ghost1-2026-04-28T19:30-done.md\` — done; spec missing.
- [-] \`dev/dev-ghost2-2026-04-28T19:30-blocked.md\` — blocked; spec missing.
- [ ] \`dev/dev-fixret-2026-04-28T19:30-retro-fixture-epic.md\` — Retro. Blocked-by: fix101, fix102.
- [ ] \`dev/dev-fix102-2026-04-28T19:30-second.md\` — second.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issues = findIssues(r.issues, "devmd-row-points-at-missing-spec");
    expect(issues.length).toBe(2);
    expect(issues.map((i) => i.message).join(" ")).toContain("ghost1");
    expect(issues.map((i) => i.message).join(" ")).toContain("ghost2");
  });
});

describe("validateEmit — check 3: sprint-status story → spec exists", () => {
  it("flags a sprint-status story with no matching dev spec", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
      `plans:
  - key: plan-fixture
    title: Fixture
    epics:
      - key: epic-fixture-epic
        stories:
          - key: fix101
            title: first
          - key: fix102
            title: second
          - key: ghost9
            title: phantom story not in dev/
          - key: fixret
            title: Retro
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "sprint-status-points-at-missing-spec");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("ghost9");
    expect(issue!.location).toMatch(/sprint-status\.yaml:\d+/);
  });
});

describe("validateEmit — check 4: retro trifecta", () => {
  it("flags retro spec missing from dev/", () => {
    // Build the fixture WITHOUT the retro spec — easier than copying-and-
    // dropping after the fact, since the factory's internal Maps are
    // closure-private (intentionally — keeps the seam single-direction).
    const fs = newMemoryFs();
    const repoRoot = REPO_ROOT;
    const epicPath = `${repoRoot}/_bmad-output/planning-artifacts/epic-fixture-epic.md`;
    fs.put(
      epicPath,
      `# Epic — fixture-epic

## Story list with ACs

### fix101 — first story
- [ ] AC.

### fix102 — second story
- [ ] AC.

### fixret — Retro
- [ ] Run.
`,
    );
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `---
hash: fix101
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
branch: feat/dev-fix101
---
.
`,
    );
    fs.put(
      `${repoRoot}/dev/dev-fix102-2026-04-28T19:30-second.md`,
      `---
hash: fix102
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
branch: feat/dev-fix102
---
.
`,
    );
    fs.put(
      `${repoRoot}/DEV.md`,
      `# DEV

### Epic — fixture-epic
- [ ] \`dev/dev-fix101-2026-04-28T19:30-first.md\` — first.
- [ ] \`dev/dev-fix102-2026-04-28T19:30-second.md\` — second.
`,
    );
    fs.put(
      `${repoRoot}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
      `plans:
  - key: plan-fixture
    epics:
      - key: epic-fixture-epic
        stories:
          - key: fix101
            title: x
          - key: fix102
            title: y
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(findIssue(r.issues, "retro-trifecta-missing-spec")).toBeDefined();
    expect(findIssue(r.issues, "retro-trifecta-missing-devmd-row")).toBeDefined();
    expect(findIssue(r.issues, "retro-trifecta-missing-sprint-status")).toBeDefined();
  });

  it("flags retro DEV.md row missing while spec + sprint-status are present", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/DEV.md`,
      `# DEV

### Epic — fixture-epic
- [ ] \`dev/dev-fix101-2026-04-28T19:30-first.md\` — first.
- [ ] \`dev/dev-fix102-2026-04-28T19:30-second.md\` — second.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(findIssue(r.issues, "retro-trifecta-missing-devmd-row")).toBeDefined();
    expect(findIssue(r.issues, "retro-trifecta-missing-spec")).toBeUndefined();
    expect(findIssue(r.issues, "retro-trifecta-missing-sprint-status")).toBeUndefined();
  });

  it("flags retro sprint-status row missing while spec + DEV.md are present", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
      `plans:
  - key: plan-fixture
    epics:
      - key: epic-fixture-epic
        stories:
          - key: fix101
            title: first
          - key: fix102
            title: second
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(findIssue(r.issues, "retro-trifecta-missing-sprint-status")).toBeDefined();
    expect(findIssue(r.issues, "retro-trifecta-missing-spec")).toBeUndefined();
    expect(findIssue(r.issues, "retro-trifecta-missing-devmd-row")).toBeUndefined();
  });
});

describe("validateEmit — check 5: branch frontmatter matches deriveBranch", () => {
  it("flags a spec whose branch frontmatter is hardcoded to develop/ under single-branch config", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `---
hash: fix101
type: dev
title: first
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
branch: develop/dev-fix101
---

## Goal
First.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "branch-mismatch");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("develop/dev-fix101");
    expect(issue!.message).toContain("feat/dev-fix101");
    expect(issue!.location).toBe("dev/dev-fix101-2026-04-28T19:30-first.md");
  });

  it("flags a spec missing `branch:` frontmatter entirely", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `---
hash: fix101
type: dev
title: first
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
---

## Goal
No branch frontmatter.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(findIssue(r.issues, "spec-missing-branch-frontmatter")).toBeDefined();
  });

  it("does not false-positive when config is develop/main split", () => {
    const { fs, repoRoot } = cleanFixture();
    // Make every spec's branch develop/dev-<hash> to match split config.
    for (const fixHash of ["fix101", "fix102", "fixret"]) {
      const path = (() => {
        if (fixHash === "fix101")
          return `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`;
        if (fixHash === "fix102")
          return `${repoRoot}/dev/dev-fix102-2026-04-28T19:30-second.md`;
        return `${repoRoot}/dev/dev-fixret-2026-04-28T19:30-retro-fixture-epic.md`;
      })();
      fs.put(
        path,
        `---
hash: ${fixHash}
type: dev
title: ${fixHash}
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
branch: develop/dev-${fixHash}
---

## Goal
.
`,
      );
    }
    const r = validateEmit(
      {
        repoRoot,
        epicSlug: "fixture-epic",
        config: { git: { integration_branch: "develop", branch_prefix: "develop/" } },
      },
      fs,
    );
    expect(findIssues(r.issues, "branch-mismatch")).toEqual([]);
  });
});

describe("validateEmit — check 6: locked decision token vs spec body (heuristic)", () => {
  it("emits warn when a backticked phrase from a Locked decision is missing from the referenced spec", () => {
    const { fs, repoRoot } = cleanFixture();
    // Strip the spec body so it no longer mentions `*.tmp` (the token in
    // the locked decision in the fixture epic).
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `---
hash: fix101
type: dev
title: first
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
branch: feat/dev-fix101
---

## Goal
This spec does NOT mention the canonical token any more.

## Acceptance criteria
- [ ] Just an ordinary AC.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "locked-decision-token-missing-from-spec");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(issue!.message).toContain("*.tmp");
    expect(issue!.location).toMatch(/epic-fixture-epic\.md:\d+ → dev\/dev-fix101/);
  });

  it("does not warn when the token is present in the spec body", () => {
    const { fs, repoRoot } = cleanFixture();
    // Default fixture has fix101 spec mentioning `*.tmp` — assert no warn.
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(
      findIssues(r.issues, "locked-decision-token-missing-from-spec"),
    ).toEqual([]);
  });

  it("filters out multi-word backticked phrases (example strings, not anchors)", () => {
    const { fs, repoRoot } = cleanFixture();
    // Epic has a Locked decision referencing a multi-word phrase as fixture
    // input; that phrase should NOT be required in the spec body.
    const epicPath = `${repoRoot}/_bmad-output/planning-artifacts/epic-fixture-epic.md`;
    fs.put(
      epicPath,
      fs.readFile(epicPath).replace(
        "**Locked decision:** fix101 AC bumped — atomicity uses `*.tmp` files first.",
        "**Locked decision:** fix101 AC bumped — pre-populate fixture with `→ Answer: (a) acknowledge` as the response.",
      ),
    );
    // Strip the spec's `*.tmp` mention to be sure the multi-word phrase is
    // the only candidate trigger.
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `---
hash: fix101
type: dev
title: first
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
status: ready
branch: feat/dev-fix101
---

## Goal
ordinary content.
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    // The multi-word phrase contains `→` and spaces — must be filtered out.
    expect(
      findIssues(r.issues, "locked-decision-token-missing-from-spec"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — CLI passthrough exit-code contract
// ---------------------------------------------------------------------------

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

interface RealFixture {
  root: string;
  configPath: string;
  cleanup: () => void;
}

function makeRealRepo(): RealFixture {
  const root = mkdtempSync(join(tmpdir(), "devx-validate-emit-"));
  const configPath = join(root, "devx.config.yaml");
  writeFileSync(
    configPath,
    [
      "mode: YOLO",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "  branch_prefix: feat/",
      "",
    ].join("\n"),
  );
  const epicDir = join(root, "_bmad-output/planning-artifacts");
  mkdirSync(epicDir, { recursive: true });
  writeFileSync(
    join(epicDir, "epic-clean.md"),
    `# Epic — clean

## Story list with ACs

### cln101 — story
- [ ] AC.

### clnret — Retro
- [ ] Run.
`,
  );
  const devDir = join(root, "dev");
  mkdirSync(devDir, { recursive: true });
  writeFileSync(
    join(devDir, "dev-cln101-2026-04-28T19:30-story.md"),
    `---
hash: cln101
type: dev
title: story
from: _bmad-output/planning-artifacts/epic-clean.md
status: ready
branch: feat/dev-cln101
---

## Goal
.
`,
  );
  writeFileSync(
    join(devDir, "dev-clnret-2026-04-28T19:30-retro-clean.md"),
    `---
hash: clnret
type: dev
title: Retro
from: _bmad-output/planning-artifacts/epic-clean.md
status: ready
branch: feat/dev-clnret
---

## Goal
.
`,
  );
  writeFileSync(
    join(root, "DEV.md"),
    `# DEV

### Epic — clean
- [ ] \`dev/dev-cln101-2026-04-28T19:30-story.md\` — story.
- [ ] \`dev/dev-clnret-2026-04-28T19:30-retro-clean.md\` — Retro. Blocked-by: cln101.
`,
  );
  const sprintDir = join(root, "_bmad-output/implementation-artifacts");
  mkdirSync(sprintDir, { recursive: true });
  writeFileSync(
    join(sprintDir, "sprint-status.yaml"),
    `plans:
  - key: plan-clean
    epics:
      - key: epic-clean
        stories:
          - key: cln101
            title: story
          - key: clnret
            title: Retro
`,
  );
  return {
    root,
    configPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("runValidateEmit — CLI exit codes", () => {
  let fx: RealFixture;
  afterEach(() => fx.cleanup());

  it("clean fixture → exit 0 + 'validate-emit ok' on stdout", () => {
    fx = makeRealRepo();
    const cap = capture();
    const code = runValidateEmit(["clean"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    expect(code).toBe(0);
    expect(cap.io.stderr).toBe("");
    expect(cap.io.stdout).toMatch(/^validate-emit ok: epic-clean\n$/);
  });

  it("accepts `epic-clean` as well as `clean` (strips the prefix)", () => {
    fx = makeRealRepo();
    const cap = capture();
    const code = runValidateEmit(["epic-clean"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    expect(code).toBe(0);
  });

  it("epic file not found → exit 2 + diagnostic on stderr", () => {
    fx = makeRealRepo();
    const cap = capture();
    const code = runValidateEmit(["does-not-exist"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    expect(code).toBe(2);
    expect(cap.io.stdout).toBe("");
    expect(cap.io.stderr).toContain("epic file not found");
    expect(cap.io.stderr).toContain("epic-does-not-exist.md");
  });

  it("≥1 error issue → exit 1 + per-issue lines + summary on stderr", () => {
    fx = makeRealRepo();
    // Break the fixture: rewrite cln101 spec with a wrong branch frontmatter.
    writeFileSync(
      join(fx.root, "dev/dev-cln101-2026-04-28T19:30-story.md"),
      `---
hash: cln101
type: dev
title: story
from: _bmad-output/planning-artifacts/epic-clean.md
status: ready
branch: develop/dev-cln101
---

## Goal
.
`,
    );
    const cap = capture();
    const code = runValidateEmit(["clean"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    expect(code).toBe(1);
    expect(cap.io.stdout).toBe("");
    expect(cap.io.stderr).toContain("[error] [branch-mismatch]");
    expect(cap.io.stderr).toContain("epic-clean: 1 error");
  });

  it("missing devx.config.yaml → exit 1 (operator error, not exit 2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "devx-validate-emit-no-config-"));
    try {
      const cap = capture();
      const code = runValidateEmit(["clean"], {
        out: cap.out,
        err: cap.err,
        projectPath: join(dir, "devx.config.yaml"),
        repoRoot: dir,
      });
      expect(code).toBe(1);
      expect(cap.io.stderr.toLowerCase()).toMatch(/not found|no such file|enoent/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("malformed slug → exit 2 (operator typo, skill body keeps planning)", () => {
    fx = makeRealRepo();
    const cap = capture();
    const code = runValidateEmit(["Bad/Slug"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    // Exit 2 distinguishes "operator typed the wrong slug" from "the
    // emitted artifacts are broken" (exit 1). The skill body's Phase 6
    // step 6 contract relies on this split: exit 1 aborts the planning
    // run; exit 2 surfaces back to the user without aborting.
    expect(code).toBe(2);
    expect(cap.io.stderr).toContain("invalid epic slug");
  });

  it("doubled `epic-epic-foo` prefix → exit 2 + diagnostic naming both candidate slugs", () => {
    fx = makeRealRepo();
    const cap = capture();
    const code = runValidateEmit(["epic-epic-clean"], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    expect(code).toBe(2);
    expect(cap.io.stderr).toContain("doubled 'epic-' prefix");
  });

  it("wrong arg count → exit 1 + usage", () => {
    fx = makeRealRepo();
    const cap = capture();
    const code = runValidateEmit([], {
      out: cap.out,
      err: cap.err,
      projectPath: fx.configPath,
      repoRoot: fx.root,
    });
    expect(code).toBe(1);
    expect(cap.io.stderr).toContain("usage:");
    expect(cap.io.stderr).toContain("validate-emit");
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — exported parser unit tests (fast, no fs)
// ---------------------------------------------------------------------------

describe("parseStoryHashes", () => {
  it("scans only inside `## Story list` when the anchor is present", () => {
    const body = `## Overview
text
## Story list with ACs

### abc123 — first

### Findings + decisions

`;
    const hits = parseStoryHashes(body);
    expect(hits.map((h) => h.hash)).toEqual(["abc123"]);
  });

  it("falls back to all `### <hash> — ` headings when no anchor present", () => {
    const body = `# Some old epic

### old123 — story
text

### old456 — another
text
`;
    const hits = parseStoryHashes(body);
    expect(hits.map((h) => h.hash)).toEqual(["old123", "old456"]);
  });

  it("rejects non-hash `###` headings (Findings + decisions, etc.)", () => {
    const body = `## Story list with ACs

### plan103 — story

## Party-mode

### Findings + decisions
### Cross-epic locked decisions added to global list
`;
    const hits = parseStoryHashes(body);
    expect(hits.map((h) => h.hash)).toEqual(["plan103"]);
  });
});

describe("parseEpicDevMdRows", () => {
  it("returns rows from the section that mentions the first epic hash", () => {
    const dev = `# DEV

### Epic — A
- [ ] \`dev/dev-aaa101-2026-04-28T19:30-x.md\` — A.

### Epic — B
- [ ] \`dev/dev-bbb101-2026-04-28T19:30-y.md\` — B.
`;
    const rows = parseEpicDevMdRows(dev, ["bbb101"]);
    expect(rows).toEqual([
      { specPath: "dev/dev-bbb101-2026-04-28T19:30-y.md", line: 7 },
    ]);
  });

  it("returns empty when the epic has no matching section", () => {
    const dev = `# DEV

### Epic — A
- [ ] \`dev/dev-aaa101-2026-04-28T19:30-x.md\` — A.
`;
    expect(parseEpicDevMdRows(dev, ["zzz999"])).toEqual([]);
  });
});

describe("parseEpicSprintStatusStories", () => {
  it("captures stories under the named epic block, ignores other epics", () => {
    const yml = `plans:
  - key: plan-1
    epics:
      - key: epic-foo
        stories:
          - key: foo101
            title: x
          - key: foo102
            title: y
      - key: epic-bar
        stories:
          - key: bar101
            title: z
`;
    const hits = parseEpicSprintStatusStories(yml, "foo");
    expect(hits.map((h) => h.hash)).toEqual(["foo101", "foo102"]);
  });

  it("returns empty when the epic isn't found", () => {
    const yml = `plans:
  - key: plan-1
    epics:
      - key: epic-foo
        stories:
          - key: foo101
            title: x
`;
    expect(parseEpicSprintStatusStories(yml, "ghost")).toEqual([]);
  });
});

describe("parseFrontmatterValue", () => {
  it("extracts a top-level scalar from frontmatter", () => {
    const body = `---
hash: abc123
branch: feat/dev-abc123
---
body
`;
    expect(parseFrontmatterValue(body, "branch")).toBe("feat/dev-abc123");
    expect(parseFrontmatterValue(body, "hash")).toBe("abc123");
    expect(parseFrontmatterValue(body, "missing")).toBe(null);
  });

  it("returns null when no frontmatter block exists", () => {
    expect(parseFrontmatterValue("# no frontmatter", "branch")).toBe(null);
  });
});

describe("parseLockedDecisions", () => {
  it("anchors on `<hash> AC bumped` and collects backticked tokens", () => {
    const epic = `**Locked decision:** abc123 AC bumped — atomicity uses \`*.tmp\` files first; renames in fixed order: \`spec\` → \`DEV.md\` → \`sprint-status.yaml\`.`;
    const lds = parseLockedDecisions(epic);
    expect(lds).toHaveLength(1);
    expect(lds[0].anchorHash).toBe("abc123");
    expect(lds[0].backtickedTokens).toEqual(
      expect.arrayContaining(["*.tmp", "spec", "DEV.md", "sprint-status.yaml"]),
    );
  });

  it("returns empty when no Locked decision markers present", () => {
    expect(parseLockedDecisions("# no markers here")).toEqual([]);
  });

  it("does NOT anchor on hashes mentioned in passing (no `AC bumped` shape)", () => {
    // Adversarial-review hardening: the earlier fallback ("first hash-shaped
    // token in the bullet") produced false-positive anchors when a Locked
    // decision named multiple hashes in passing. anchorHash should be null
    // here, suppressing the heuristic warn entirely.
    const epic = `**Locked decision:** Following pln103 design, plnret will run \`bmad-retrospective\`.`;
    const lds = parseLockedDecisions(epic);
    expect(lds).toHaveLength(1);
    expect(lds[0].anchorHash).toBe(null);
  });

  it("two markers on the same line yield two refs (no token cross-contamination)", () => {
    const epic = `**Locked decision:** abc123 AC bumped — \`tokA\`. **Locked decision:** def456 AC bumped — \`tokB\`.`;
    const lds = parseLockedDecisions(epic);
    expect(lds).toHaveLength(2);
    expect(lds[0].anchorHash).toBe("abc123");
    expect(lds[0].backtickedTokens).toEqual(["tokA"]);
    expect(lds[1].anchorHash).toBe("def456");
    expect(lds[1].backtickedTokens).toEqual(["tokB"]);
  });

  it("continuation walk stops on blank line, top-level bullet, and another marker", () => {
    const epic = `**Locked decision:** abc123 AC bumped — \`tokA\`.
prose continuation \`tokB\`.
**Locked decision:** def456 AC bumped — \`tokC\`.`;
    const lds = parseLockedDecisions(epic);
    // Two markers; abc123 picks up the prose-continuation token (tokB) but
    // NOT def456's tokC because the walk stops at the next marker line.
    expect(lds).toHaveLength(2);
    expect(lds[0].anchorHash).toBe("abc123");
    expect(lds[0].backtickedTokens).toEqual(["tokA", "tokB"]);
    expect(lds[1].anchorHash).toBe("def456");
    expect(lds[1].backtickedTokens).toEqual(["tokC"]);
  });
});

describe("parseFrontmatterValue — quote/comment/CRLF tolerance", () => {
  it("strips surrounding double quotes", () => {
    expect(parseFrontmatterValue(`---\nbranch: "feat/dev-foo"\n---\n`, "branch")).toBe(
      "feat/dev-foo",
    );
  });

  it("strips surrounding single quotes", () => {
    expect(parseFrontmatterValue(`---\nbranch: 'feat/dev-foo'\n---\n`, "branch")).toBe(
      "feat/dev-foo",
    );
  });

  it("strips inline `# ...` comments before the value", () => {
    expect(
      parseFrontmatterValue(`---\nbranch: feat/dev-foo  # auto-derived\n---\n`, "branch"),
    ).toBe("feat/dev-foo");
  });

  it("tolerates the empty-frontmatter shape `---\\n---`", () => {
    expect(parseFrontmatterValue(`---\n---\nbody`, "branch")).toBe(null);
  });

  it("tolerates CRLF line endings", () => {
    const body = `---\r\nbranch: feat/dev-foo\r\n---\r\nbody\r\n`;
    expect(parseFrontmatterValue(body, "branch")).toBe("feat/dev-foo");
  });
});

describe("parseEpicDevMdRows — code-fence handling", () => {
  it("skips rows inside fenced code blocks", () => {
    const dev = `# DEV

### Epic — fixture
Example syntax for a row:
\`\`\`
- [ ] \`dev/dev-zzz999-2026-04-28T19:30-example.md\` — example only.
\`\`\`
- [ ] \`dev/dev-fix101-2026-04-28T19:30-real.md\` — real.
`;
    const rows = parseEpicDevMdRows(dev, ["fix101"]);
    expect(rows.map((r) => r.specPath)).toEqual([
      "dev/dev-fix101-2026-04-28T19:30-real.md",
    ]);
  });
});

describe("validateEmit — duplicate spec for hash", () => {
  it("emits an error when two specs share the same hash", () => {
    const fs = newMemoryFs();
    const repoRoot = REPO_ROOT;
    fs.put(
      `${repoRoot}/_bmad-output/planning-artifacts/epic-fixture-epic.md`,
      `## Story list with ACs\n\n### fix101 — first\n- [ ] AC.\n`,
    );
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `---\nbranch: feat/dev-fix101\n---\nbody`,
    );
    fs.put(
      `${repoRoot}/dev/dev-fix101-2026-04-29T08:00-renamed.md`,
      `---\nbranch: feat/dev-fix101\n---\nbody`,
    );
    fs.put(`${repoRoot}/DEV.md`, "");
    fs.put(
      `${repoRoot}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
      "",
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "duplicate-spec-for-hash");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("fix101");
    expect(issue!.message).toContain("first.md");
    expect(issue!.message).toContain("renamed.md");
  });
});

describe("validateEmit — orphan spec claiming epic", () => {
  it("flags a dev spec whose `from:` references the epic but isn't in the story list", () => {
    const { fs, repoRoot } = cleanFixture();
    // Add an orphan spec — exists in dev/, claims to be from this epic
    // via `from:` frontmatter, but no `### orphan9 — ...` heading exists.
    fs.put(
      `${repoRoot}/dev/dev-orphn9-2026-04-28T19:30-orphan.md`,
      `---
hash: orphn9
from: _bmad-output/planning-artifacts/epic-fixture-epic.md
branch: feat/dev-orphn9
---
body
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "orphan-spec-claims-epic");
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("orphn9");
    expect(issue!.location).toBe("dev/dev-orphn9-2026-04-28T19:30-orphan.md");
  });

  it("does not flag specs that legitimately reference a different epic", () => {
    const { fs, repoRoot } = cleanFixture();
    fs.put(
      `${repoRoot}/dev/dev-other1-2026-04-28T19:30-other.md`,
      `---
hash: other1
from: _bmad-output/planning-artifacts/epic-different-epic.md
branch: feat/dev-other1
---
body
`,
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    expect(findIssues(r.issues, "orphan-spec-claims-epic")).toEqual([]);
  });
});

describe("validateEmit — locked decision references unknown hash", () => {
  it("emits an error when an `<hash> AC bumped` locked decision points at a hash not in the story list", () => {
    const { fs, repoRoot } = cleanFixture();
    const epicPath = `${repoRoot}/_bmad-output/planning-artifacts/epic-fixture-epic.md`;
    fs.put(
      epicPath,
      fs.readFile(epicPath).replace(
        "**Locked decision:** fix101 AC bumped",
        "**Locked decision:** xyz999 AC bumped",
      ),
    );
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const issue = findIssue(r.issues, "locked-decision-references-unknown-hash");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("error");
    expect(issue!.message).toContain("xyz999");
  });
});

describe("validateEmit — CRLF normalization end-to-end", () => {
  it("handles CRLF-saved sprint-status.yaml + DEV.md + epic without false errors", () => {
    const { fs, repoRoot } = cleanFixture();
    // Re-save every artifact with CRLF line endings to simulate Windows
    // hand-edits / autocrlf=true.
    const crlf = (s: string) => s.replace(/\n/g, "\r\n");
    const paths = [
      `${repoRoot}/_bmad-output/planning-artifacts/epic-fixture-epic.md`,
      `${repoRoot}/dev/dev-fix101-2026-04-28T19:30-first.md`,
      `${repoRoot}/dev/dev-fix102-2026-04-28T19:30-second.md`,
      `${repoRoot}/dev/dev-fixret-2026-04-28T19:30-retro-fixture-epic.md`,
      `${repoRoot}/DEV.md`,
      `${repoRoot}/_bmad-output/implementation-artifacts/sprint-status.yaml`,
    ];
    for (const p of paths) {
      fs.put(p, crlf(fs.readFile(p)));
    }
    const r = validateEmit(
      { repoRoot, epicSlug: "fixture-epic", config: SINGLE_BRANCH_CONFIG },
      fs,
    );
    const errs = r.issues.filter((i) => i.severity === "error");
    expect(errs).toEqual([]);
  });
});
