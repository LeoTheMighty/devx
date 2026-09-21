// debug-2d6fc1 — a workstream story's plan/agent.md edit must stay inside its
// own phase. Covers the pure rule, the mechanism reproduced in a real
// two-worktree git repo (AC 1), the historical replay that fixed the rule's
// one exception, and the CLI's exit codes.
//
// Spec: debug/debug-2d6fc1-2026-09-02T11:20-peer-commit-swept-uncommitted-artifact.md

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runScopeCheck } from "../src/commands/workstream.js";
import {
  checkPlanScope,
  checkStoryPlanScope,
  parseDiffHunks,
  planPhaseMap,
  storyFromBranch,
} from "../src/lib/engine/plan-scope.js";
import { realExec } from "../src/lib/exec.js";

const PLAN = [
  "# Plan — Demo", //                     1
  "", //                                  2
  "## Current state", //                  3
  "prose", //                             4
  "", //                                  5
  "## Phase checklist", //                6
  "", //                                  7
  "- [ ] Phase 1: One", //                8
  "- [ ] Phase 2: Two", //                9
  "", //                                  10
  "## Phases", //                         11
  "", //                                  12
  "### 1. Phase: One", //                 13
  "- [ ] T1.1 do one", //                 14
  "", //                                  15
  "### 2. Phase: Two", //                 16
  "- [ ] T2.1 do two", //                 17
  "", //                                  18
].join("\n");

const edit = (text: string, find: string, replace: string) => text.replace(find, replace);
const diffOf = (a: string, b: string): ReturnType<typeof parseDiffHunks> => {
  const d = mkdtempSync(join(tmpdir(), "devx-2d6fc1-diff-"));
  try {
    writeFileSync(join(d, "a"), a);
    writeFileSync(join(d, "b"), b);
    let out = "";
    try {
      execFileSync("git", ["diff", "--no-index", "-U0", "a", "b"], { cwd: d, encoding: "utf8" });
    } catch (e) {
      out = (e as { stdout: string }).stdout; // exit 1 = differences found
    }
    return parseDiffHunks(out);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
};
const check = (ownPhase: number, next: string, done: number[] = []) =>
  checkPlanScope({
    ownPhase,
    oldText: PLAN,
    newText: next,
    hunks: diffOf(PLAN, next),
    phaseIsDone: (n) => done.includes(n),
  });

describe("planPhaseMap", () => {
  it("attributes checklist rows, their indented notes, and phase sections", () => {
    const text = edit(PLAN, "- [ ] Phase 1: One\n", "- [ ] Phase 1: One\n    as-built note\n");
    const map = planPhaseMap(text);
    const at = (s: string) => map[text.split("\n").indexOf(s)];
    expect(at("prose")).toBeNull();
    expect(at("- [ ] Phase 1: One")).toBe(1);
    expect(at("    as-built note")).toBe(1);
    expect(at("- [ ] Phase 2: Two")).toBe(2);
    expect(at("- [ ] T1.1 do one")).toBe(1);
    expect(at("- [ ] T2.1 do two")).toBe(2);
  });
});

describe("checkPlanScope — the rule", () => {
  it("own-phase edits are in scope", () => {
    const next = edit(edit(PLAN, "- [ ] Phase 2: Two", "- [x] Phase 2: Two"), "- [ ] T2.1", "- [x] T2.1");
    expect(check(2, next)).toEqual([]);
  });
  it("another phase's task flip is out of scope", () => {
    const v = check(2, edit(PLAN, "- [ ] T1.1", "- [x] T1.1"));
    expect(v.map((x) => [x.side, x.phase])).toEqual([["removed", 1], ["added", 1]]);
  });
  it("prose added to another phase is out of scope — the dlr102 shape", () => {
    const v = check(2, edit(PLAN, "- [ ] T1.1 do one\n", "- [ ] T1.1 do one\n\n**As-built (other).** text\n"));
    expect(v.every((x) => x.side === "added" && x.phase === 1)).toBe(true);
    expect(v.length).toBeGreaterThan(0);
  });
  it("an edit outside every phase is out of scope", () => {
    expect(check(2, edit(PLAN, "prose", "changed prose")).map((x) => x.phase)).toEqual([null, null]);
  });
  it("the measured exception: checking a DONE phase's checklist row is allowed", () => {
    expect(check(2, edit(PLAN, "- [ ] Phase 1: One", "- [x] Phase 1: One"), [1])).toEqual([]);
  });
  it("…but not when that phase is not done at the base — that is capture, not catch-up", () => {
    expect(check(2, edit(PLAN, "- [ ] Phase 1: One", "- [x] Phase 1: One"), [])).toHaveLength(2);
  });
  it("…and never prose into a done phase's section, only the checkbox", () => {
    const next = edit(PLAN, "- [ ] T1.1 do one\n", "- [ ] T1.1 do one\nextra\n");
    expect(check(2, next, [1])).toHaveLength(1);
  });
  it("…and never UNchecking a done phase's row", () => {
    const start = edit(PLAN, "- [ ] Phase 1: One", "- [x] Phase 1: One");
    const v = checkPlanScope({
      ownPhase: 2,
      oldText: start,
      newText: PLAN,
      hunks: diffOf(start, PLAN),
      phaseIsDone: () => true,
    });
    expect(v).toHaveLength(2);
  });
});

describe("storyFromBranch", () => {
  it("reads the story hash from a story branch and nothing else", () => {
    expect(storyFromBranch("feat/dev-abc123")).toBe("abc123");
    expect(storyFromBranch("feat/debug-2d6fc1")).toBe("2d6fc1");
    expect(storyFromBranch("main")).toBeNull();
    expect(storyFromBranch("feat/something-else")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC 1 — the mechanism, reproduced in a real repo with two worktrees
// ---------------------------------------------------------------------------

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** main + two story specs (phases 1 and 2 of one workstream) + a plan. */
function scaffold(): { root: string; plan: string } {
  const root = mkdtempSync(join(tmpdir(), "devx-2d6fc1-repo-"));
  roots.push(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  const ws = "_devx/workstreams/demo";
  mkdirSync(join(root, ws, "plan"), { recursive: true });
  mkdirSync(join(root, "dev"));
  writeFileSync(join(root, "devx.config.yaml"), "mode: YOLO\n");
  writeFileSync(join(root, ws, "plan", "agent.md"), PLAN);
  for (const [hash, phase] of [["aaa101", 1], ["aaa102", 2]] as const) {
    writeFileSync(
      join(root, "dev", `dev-${hash}-2026-09-02T09:00-x.md`),
      `---\nhash: ${hash}\nstatus: in-progress\nphase: ${phase}\nplan: ${ws}\n---\n\n## Status log\n`,
    );
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return { root, plan: join(ws, "plan", "agent.md") };
}

describe("AC 1 — carrying main's working copy into a branch captures a peer's work", () => {
  it("reproduces the capture, and the check names the peer's phase", () => {
    const { root, plan } = scaffold();
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");

    // Session aaa101 (phase 1) writes its as-built into MAIN's copy and leaves
    // it uncommitted — what dlr103's CWD drift did.
    const mainPlan = join(root, plan);
    writeFileSync(
      mainPlan,
      edit(readFileSync(mainPlan, "utf8"), "- [ ] T1.1 do one\n", "- [x] T1.1 do one\n\n**As-built (aaa101).** peer text\n"),
    );
    // Session aaa102 (phase 2) edits main's copy too (the old Phase-2 rule),
    // then carries the WHOLE file into its branch and commits.
    writeFileSync(mainPlan, edit(readFileSync(mainPlan, "utf8"), "- [ ] T2.1", "- [x] T2.1"));
    copyFileSync(mainPlan, join(wt, plan));
    git(wt, "commit", "-q", "-am", "feat: aaa102");

    const committed = git(wt, "show", `HEAD:${plan}`);
    expect(committed).toContain("As-built (aaa101)"); // the capture happened

    const report = checkStoryPlanScope({ repoRoot: wt, base: "main", head: "HEAD", story: "aaa102", exec: realExec });
    expect(report.skipped).toBeNull();
    expect(report.ownPhase).toBe(2);
    const phases = new Set(report.files.flatMap((f) => f.violations.map((v) => v.phase)));
    expect(phases).toEqual(new Set([1]));
  });

  it("editing only the worktree's copy stays clean", () => {
    const { root, plan } = scaffold();
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");
    const mainPlan = join(root, plan);
    // Peer's uncommitted edit in main's copy — present, but never carried over.
    writeFileSync(mainPlan, edit(readFileSync(mainPlan, "utf8"), "- [ ] T1.1", "- [x] T1.1"));
    const wtPlan = join(wt, plan);
    writeFileSync(wtPlan, edit(edit(readFileSync(wtPlan, "utf8"), "- [ ] T2.1", "- [x] T2.1"), "- [ ] Phase 2", "- [x] Phase 2"));
    git(wt, "commit", "-q", "-am", "feat: aaa102");
    const report = checkStoryPlanScope({ repoRoot: wt, base: "main", head: "HEAD", story: "aaa102", exec: realExec });
    expect(report.files).toEqual([]);
  });

  it("the done-phase exception reads the base, not the head", () => {
    const { root, plan } = scaffold();
    // Phase 1's story is done on main before aaa102 branches.
    const spec1 = join(root, "dev", "dev-aaa101-2026-09-02T09:00-x.md");
    writeFileSync(spec1, readFileSync(spec1, "utf8").replace("status: in-progress", "status: done"));
    git(root, "commit", "-q", "-am", "aaa101 done");
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");
    const wtPlan = join(wt, plan);
    writeFileSync(wtPlan, edit(readFileSync(wtPlan, "utf8"), "- [ ] Phase 1: One", "- [x] Phase 1: One"));
    git(wt, "commit", "-q", "-am", "catch up sibling's box");
    expect(
      checkStoryPlanScope({ repoRoot: wt, base: "main", head: "HEAD", story: "aaa102", exec: realExec }).files,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

describe("devx workstream scope-check", () => {
  const io = () => {
    let o = "";
    let e = "";
    return { out: (s: string) => (o += s), err: (s: string) => (e += s), get: () => ({ o, e }) };
  };

  it("exit 1 on a capture, exit 0 on a clean story, exit 2 on a bare rev", () => {
    const { root, plan } = scaffold();
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");
    const wtPlan = join(wt, plan);
    writeFileSync(wtPlan, edit(readFileSync(wtPlan, "utf8"), "- [ ] T1.1", "- [x] T1.1"));
    git(wt, "commit", "-q", "-am", "x");
    const cfg = join(wt, "devx.config.yaml");

    const a = io();
    expect(runScopeCheck({ diff: "main...HEAD" }, { ...a, projectPath: cfg, env: {} })).toBe(1);
    expect(a.get().e).toMatch(/phase 1/);

    // Same diff, attributed to phase 1's own story via --story: in scope.
    // The verdict depends on WHOSE story the diff is, not on the diff alone.
    const b = io();
    expect(runScopeCheck({ diff: "main...HEAD", story: "aaa101" }, { ...b, projectPath: cfg, env: {} })).toBe(0);

    // GITHUB_HEAD_REF wins over the checked-out branch, as it must in CI.
    const d = io();
    expect(
      runScopeCheck({ diff: "main...HEAD" }, { ...d, projectPath: cfg, env: { GITHUB_HEAD_REF: "feat/dev-aaa101" } }),
    ).toBe(0);

    const c = io();
    expect(runScopeCheck({ diff: "HEAD" }, { ...c, projectPath: cfg, env: {} })).toBe(2);
  });

  it("a non-story branch is skipped with exit 0", () => {
    const { root } = scaffold();
    const out = io();
    expect(
      runScopeCheck({ diff: "main...HEAD" }, { ...out, projectPath: join(root, "devx.config.yaml"), env: {} }),
    ).toBe(0);
    expect(out.get().o).toMatch(/not a story branch/);
  });
});

// ---------------------------------------------------------------------------
// Replay against devx's own history — the evidence the rule's exception rests on
// ---------------------------------------------------------------------------

const REPO = process.cwd();
const has = (rev: string) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`], { cwd: REPO });
    return true;
  } catch {
    return false;
  }
};

describe.runIf(has("3e61e67") && has("6747362"))("replay of real history", () => {
  it("dlr102 (3e61e67) is the capture: only dlr103's phase 3 is flagged", () => {
    const r = checkStoryPlanScope({ repoRoot: REPO, base: "3e61e67^", head: "3e61e67", story: "dlr102", exec: realExec });
    expect(r.ownPhase).toBe(2);
    const phases = new Set(r.files.flatMap((f) => f.violations.map((v) => v.phase)));
    expect(phases).toEqual(new Set([3]));
  });
  it("dlr105 (6747362) flipped dlr104's box after dlr104 was done — allowed", () => {
    const r = checkStoryPlanScope({ repoRoot: REPO, base: "6747362^", head: "6747362", story: "dlr105", exec: realExec });
    expect(r.ownPhase).toBe(5);
    expect(r.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Review round 1 — each finding pinned
// ---------------------------------------------------------------------------

describe("round 1: phase headings in every spelling devx plans use", () => {
  it("the live usage-window-governor plan is fully attributed", () => {
    const path = join(REPO, "_devx/workstreams/usage-window-governor/plan/agent.md");
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return; // workstream archived — nothing to check
    }
    const map = planPhaseMap(text);
    const lines = text.split("\n");
    const headings = lines.map((l, i) => [l, i] as const).filter(([l]) => /^### Phase \d+/.test(l));
    expect(headings.length).toBeGreaterThan(0);
    for (const [l, i] of headings) expect(map[i]).toBe(Number(/Phase (\d+)/.exec(l)![1]));
  });
  it("recognises `### Phase N`, `### N) Phase`, emphasis, and `## Phases (…)`", () => {
    const text = [
      "## Phases (detail)",
      "### Phase 1 — `x`: a",
      "a1",
      "### 2) Phase b",
      "b1",
      "### **3. Phase: c**",
      "c1",
    ].join("\n");
    expect(planPhaseMap(text)).toEqual([null, 1, 1, 2, 2, 3, 3]);
  });
  it("ignores headings inside a fenced block", () => {
    const text = ["## Phases", "### 1. Phase: a", "```md", "## fake", "### 9. Phase: fake", "```", "a2"].join("\n");
    expect(planPhaseMap(text)).toEqual([null, 1, 1, 1, 1, 1, 1]);
  });
});

describe("round 1: the done-phase exception is an in-place pair, nothing else", () => {
  it("a retitle under cover of a flip is refused", () => {
    expect(check(2, edit(PLAN, "- [ ] Phase 1: One", "- [x] Phase 1: One — and T3 shipped"), [1])).toHaveLength(2);
  });
  it("deleting the row is refused", () => {
    expect(check(2, edit(PLAN, "- [ ] Phase 1: One\n", ""), [1])).toHaveLength(1);
  });
  it("adding a second checked row is refused", () => {
    expect(check(2, edit(PLAN, "- [ ] Phase 2: Two", "- [ ] Phase 2: Two\n- [x] Phase 1: extra"), [1])).toHaveLength(1);
  });
  it("a capital [X] flip is accepted", () => {
    expect(check(2, edit(PLAN, "- [ ] Phase 1: One", "- [X] Phase 1: One"), [1])).toEqual([]);
  });
});

describe("round 1: checkStoryPlanScope against a repo", () => {
  function repoWith(extraSpecs: Record<string, string> = {}): { root: string; plan: string } {
    const s = scaffold();
    for (const [name, body] of Object.entries(extraSpecs)) {
      mkdirSync(dirname(join(s.root, name)), { recursive: true });
      writeFileSync(join(s.root, name), body);
    }
    if (Object.keys(extraSpecs).length) {
      git(s.root, "add", "-A");
      git(s.root, "commit", "-q", "-m", "extra specs");
    }
    return s;
  }
  function branchEdit(root: string, story: string, plan: string, from: string, to: string): string {
    const wt = join(root, ".worktrees", `dev-${story}`);
    git(root, "worktree", "add", "-q", "-b", `feat/dev-${story}`, wt, "main");
    const p = join(wt, plan);
    writeFileSync(p, edit(readFileSync(p, "utf8"), from, to));
    git(wt, "commit", "-q", "-am", "x");
    return wt;
  }
  const run = (wt: string, story: string) =>
    checkStoryPlanScope({ repoRoot: wt, base: "main", head: "HEAD", story, exec: realExec });

  it("a split follow-up — one its parent's `spawned:` names — inherits the parent's phase", () => {
    const { root, plan } = repoWith({
      "dev/dev-bbb202-2026-09-02T09:00-f.md":
        "---\nhash: bbb202\nstatus: in-progress\nfrom: dev/dev-aaa102-2026-09-02T09:00-x.md\n---\n",
      "dev/dev-aaa102-2026-09-02T09:00-x.md":
        "---\nhash: aaa102\nstatus: in-progress\nphase: 2\nplan: _devx/workstreams/demo\nspawned: [bbb202]\n---\n\n## Status log\n",
    });
    const wt = branchEdit(root, "bbb202", plan, "- [ ] T1.1", "- [x] T1.1");
    const r = run(wt, "bbb202");
    expect(r.ownPhase).toBe(2);
    expect(r.files).toHaveLength(1);
  });
  it("a spec merely FILED from a phase story does not inherit its phase — the 2d6fc1 case", () => {
    // `from:` records provenance of every kind. #175's own CI run scoped
    // 2d6fc1 (filed from dlr103) to phase 3 before this was fixed.
    const { root, plan } = repoWith({
      "debug/debug-fff606-2026-09-02T09:00-f.md":
        "---\nhash: fff606\nstatus: in-progress\nfrom: dev/dev-aaa101-2026-09-02T09:00-x.md\n---\n",
    });
    const wt = join(root, ".worktrees", "debug-fff606");
    git(root, "worktree", "add", "-q", "-b", "feat/debug-fff606", wt, "main");
    const p = join(wt, plan);
    writeFileSync(p, edit(readFileSync(p, "utf8"), "- [ ] T2.1", "- [x] T2.1"));
    git(wt, "commit", "-q", "-am", "x");
    const r = run(wt, "fff606");
    expect(r.ownPhase).toBeNull();
    expect(r.skipped).toMatch(/not a workstream-phase story/);
    expect(r.unscoped).toEqual([plan]);
  });

  it("a story with no phase and no lineage reports the plan edit instead of passing silently", () => {
    const { root, plan } = repoWith({
      "dev/dev-ccc303-2026-09-02T09:00-f.md": "---\nhash: ccc303\nstatus: in-progress\n---\n",
    });
    const wt = branchEdit(root, "ccc303", plan, "- [ ] T1.1", "- [x] T1.1");
    const r = run(wt, "ccc303");
    expect(r.skipped).toMatch(/not a workstream-phase story/);
    expect(r.unscoped).toEqual([plan]);
  });
  it("done means EVERY spec claiming the phase is done, read from frontmatter", () => {
    // Phase 1 has a done split parent AND an in-progress follow-up.
    const { root, plan } = repoWith({
      "dev/dev-aaa111-2026-09-02T09:00-f.md":
        "---\nhash: aaa111\nstatus: done\nphase: 1\nplan: _devx/workstreams/demo\n---\n",
    });
    const wt = branchEdit(root, "aaa102", plan, "- [ ] Phase 1: One", "- [x] Phase 1: One");
    expect(run(wt, "aaa102").files).toHaveLength(1); // aaa101 still in-progress
  });
  it("a body line reading `phase: N` does not make phase N count as done", () => {
    const { root, plan } = repoWith({
      "dev/dev-ddd404-2026-09-02T09:00-f.md":
        "---\nhash: ddd404\nstatus: done\nphase: 2\nplan: _devx/workstreams/demo\n---\n\n```\nphase: 1\n```\n",
    });
    const wt = branchEdit(root, "aaa102", plan, "- [ ] Phase 1: One", "- [x] Phase 1: One");
    expect(run(wt, "aaa102").files).toHaveLength(1);
  });
  it("an unknown rev fails closed instead of reading as 'nothing changed'", () => {
    const { root, plan } = scaffold();
    const wt = branchEdit(root, "aaa102", plan, "- [ ] T1.1", "- [x] T1.1");
    expect(() =>
      checkStoryPlanScope({ repoRoot: wt, base: "mian", head: "HEAD", story: "aaa102", exec: realExec }),
    ).toThrow(/resolving 'mian'/);
    const o = { out: () => {}, err: () => {} };
    expect(runScopeCheck({ diff: "mian..HEAD" }, { ...o, projectPath: join(wt, "devx.config.yaml"), env: {} })).toBe(2);
  });
  it("user git config (colour, external diff) cannot blind it", () => {
    const { root, plan } = scaffold();
    const wt = branchEdit(root, "aaa102", plan, "- [ ] T1.1", "- [x] T1.1");
    git(wt, "config", "color.ui", "always");
    git(wt, "config", "diff.external", "true");
    expect(run(wt, "aaa102").files).toHaveLength(1);
  });
  it("renaming the plan away does not hide an out-of-phase edit", () => {
    const { root, plan } = scaffold();
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");
    const p = join(wt, plan);
    writeFileSync(p, edit(readFileSync(p, "utf8"), "- [ ] T1.1", "- [x] T1.1"));
    git(wt, "mv", plan, plan.replace("agent.md", "agent-old.md"));
    git(wt, "commit", "-q", "-am", "x");
    expect(run(wt, "aaa102").files.length).toBeGreaterThan(0);
  });
  it("a plan whose phases cannot be recognised fails closed", () => {
    const { root, plan } = scaffold();
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");
    writeFileSync(join(wt, plan), "# Plan\n\nno phases here\n");
    git(wt, "commit", "-q", "-am", "x");
    expect(() => run(wt, "aaa102")).toThrow(/no phase sections recognised/);
  });
  it("shipped templates are never treated as a workstream plan", () => {
    const { root, plan } = scaffold();
    mkdirSync(join(root, "_devx/templates/engine/plan"), { recursive: true });
    writeFileSync(join(root, "_devx/templates/engine/plan/agent.md"), PLAN);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "template");
    const wt = join(root, ".worktrees", "dev-aaa102");
    git(root, "worktree", "add", "-q", "-b", "feat/dev-aaa102", wt, "main");
    const tp = join(wt, "_devx/templates/engine/plan/agent.md");
    writeFileSync(tp, edit(readFileSync(tp, "utf8"), "- [ ] T1.1", "- [x] T1.1"));
    const own = join(wt, plan);
    writeFileSync(own, edit(readFileSync(own, "utf8"), "- [ ] T2.1", "- [x] T2.1"));
    git(wt, "commit", "-q", "-am", "x");
    expect(run(wt, "aaa102").files).toEqual([]);
  });
  it("a `plan:` pointer at a plan SPEC resolves through its `workstream:` key", () => {
    const { root, plan } = repoWith({
      "plan/plan-eee505-2026-09-02T09:00-p.md": "---\nhash: eee505\nworkstream: _devx/workstreams/demo\n---\n",
      "dev/dev-eee506-2026-09-02T09:00-f.md":
        "---\nhash: eee506\nstatus: in-progress\nphase: 2\nplan: plan/plan-eee505-2026-09-02T09:00-p.md\n---\n",
    });
    const wt = branchEdit(root, "eee506", plan, "- [ ] T2.1", "- [x] T2.1");
    const r = run(wt, "eee506");
    expect(r.workstream).toBe("_devx/workstreams/demo");
    expect(r.files).toEqual([]);
  });
  it("the flat `<ws>/plan.md` layout is checked too", () => {
    const { root } = scaffold();
    const flat = "_devx/workstreams/demo/plan.md";
    writeFileSync(join(root, flat), PLAN);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "flat plan");
    const wt = branchEdit(root, "aaa102", flat, "- [ ] T1.1", "- [x] T1.1");
    expect(run(wt, "aaa102").files.map((f) => f.path)).toContain(flat);
  });
});
