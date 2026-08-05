// Unit tests for src/lib/devx/mark-done.ts + the `mark-done` CLI (sgr105).
//
// Three layers, mirroring devx-claim.test.ts:
//
//   1. Pure splicers — flipBacklogRowDone, updateSpecForDone, mergeSuffix.
//      The state-mismatch throws are the load-bearing assertions: mark-done
//      closing an item that was never claimed (or is already done) would
//      write a `[x]` row over state a live peer owns.
//
//   2. markDone driver — happy path (pathspec order), state mismatch writes
//      NOTHING, backlog-lock contention propagates, workstream-less items
//      skip the todo sync, and a failing regen warns without undoing the
//      flips.
//
//   3. runMarkDone CLI — exit-code contract (0 / 1 / 2 / 64) and the
//      exactly-one-JSON-object-on-stdout rule.
//
// Spec: dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BacklogLockTimeoutError } from "../src/lib/backlog/mutate.js";
import type { ClaimFs, ExecResult } from "../src/lib/devx/claim.js";
import {
  MarkDoneError,
  type MarkDoneOpts,
  flipBacklogRowDone,
  markDone,
  mergeSuffix,
  updateSpecForDone,
} from "../src/lib/devx/mark-done.js";
import { runMarkDone } from "../src/commands/devx-helper.js";
import { GRAPH_FILENAME, type RegenFn } from "../src/lib/graph/regen.js";

// Every test in this file injects its own regen/todoSync; the WARN channel
// is process.stderr, which vitest would otherwise print for the deliberate
// failure cases.
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
afterEach(() => stderrSpy.mockClear());

// ---------------------------------------------------------------------------
// Layer 1 — pure splicers
// ---------------------------------------------------------------------------

const SAMPLE_DEV_MD = `# DEV

### Epic — story-graph
- [ ] \`dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md\` — Backfill. Status: ready. Blocked-by: sgr103.
- [/] \`dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md\` — mark-done helper. Status: in-progress. Blocked-by: sgr104.
- [x] \`dev/dev-sgr104-2026-08-02T13:57-regen-hooks-claim-emission.md\` — Regen hooks. Status: done. PR: https://github.com/o/r/pull/114 (merged 6527aea)
- [/] \`dev/dev-sgr10-2026-08-02T13:57-prefix-decoy.md\` — Decoy. Status: in-progress.
`;

const SUFFIX = "PR: https://github.com/o/r/pull/117 (merged abc1234)";

describe("flipBacklogRowDone", () => {
  it("flips [/] → [x], Status: in-progress → done, and appends the merge suffix", () => {
    const out = flipBacklogRowDone(SAMPLE_DEV_MD, "sgr105", "dev", SUFFIX);
    expect(out).toContain(
      `- [x] \`dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md\` — mark-done helper. Status: done. Blocked-by: sgr104. ${SUFFIX}`,
    );
  });

  it("leaves every other row byte-identical — including the hash-prefix decoy", () => {
    const out = flipBacklogRowDone(SAMPLE_DEV_MD, "sgr105", "dev", SUFFIX);
    // `sgr10` is a prefix of `sgr105`; the path-component anchor is what
    // keeps the decoy row out of the match.
    expect(out).toContain(
      "- [/] `dev/dev-sgr10-2026-08-02T13:57-prefix-decoy.md` — Decoy. Status: in-progress.",
    );
    expect(out).toContain(
      "- [ ] `dev/dev-sgr106-2026-08-02T13:57-graph-backfill.md` — Backfill. Status: ready.",
    );
    expect(out.split("\n").length).toBe(SAMPLE_DEV_MD.split("\n").length);
  });

  it("throws a `state` error when the row is still [ ] (never claimed)", () => {
    try {
      flipBacklogRowDone(SAMPLE_DEV_MD, "sgr106", "dev", SUFFIX);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(MarkDoneError);
      expect((e as MarkDoneError).stage).toBe("state");
      expect((e as MarkDoneError).message).toMatch(/is in \[ \] state, not \[\/\]/);
    }
  });

  it("throws a `state` error when the row is already [x] (double mark-done)", () => {
    try {
      flipBacklogRowDone(SAMPLE_DEV_MD, "sgr104", "dev", SUFFIX);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("state");
      expect((e as MarkDoneError).message).toMatch(/already done/);
    }
  });

  it("throws a `state` error when no row matches the hash", () => {
    expect(() => flipBacklogRowDone(SAMPLE_DEV_MD, "zzz999", "dev", SUFFIX)).toThrow(
      /no DEV\.md row found/,
    );
  });

  it("routes debug specs at DEBUG.md's rows", () => {
    const debugMd =
      "- [/] `debug/debug-c81f04-2026-08-04T15:19-attach.md` — Attach. Status: in-progress.\n";
    const out = flipBacklogRowDone(debugMd, "c81f04", "debug", SUFFIX);
    expect(out).toContain("- [x] `debug/debug-c81f04");
    expect(out).toContain(`Status: done. ${SUFFIX}`);
    // A dev-typed call against the same content finds nothing — the type
    // picks the row namespace, it isn't cosmetic.
    expect(() => flipBacklogRowDone(debugMd, "c81f04", "dev", SUFFIX)).toThrow(
      /no DEV\.md row found/,
    );
  });

  it("still appends when the row's TITLE merely contains the string `PR:`", () => {
    // Review fix: the idempotence guard used to probe for the bare string
    // `PR: `, so a story about PR bodies silently lost its merge link.
    const row =
      "- [/] `dev/dev-aaa111-2026-01-01T00:00-x.md` — Fix PR: body rendering. Status: in-progress.\n";
    const out = flipBacklogRowDone(row, "aaa111", "dev", SUFFIX);
    expect(out).toContain(SUFFIX);
    expect(out).toContain("Fix PR: body rendering");
  });

  it("does not append a second `PR:` note to a row that already carries one", () => {
    const row =
      "- [/] `dev/dev-aaa111-2026-01-01T00:00-x.md` — X. Status: in-progress. PR: https://github.com/o/r/pull/9 (merged 1111111)\n";
    const out = flipBacklogRowDone(row, "aaa111", "dev", SUFFIX);
    expect(out).toContain("pull/9");
    expect(out).not.toContain("pull/117");
    expect(out.match(/PR: /g)).toHaveLength(1);
  });

  it("does not rewrite a `Status: in-progress-ish`-style suffix", () => {
    const row =
      "- [/] `dev/dev-aaa111-2026-01-01T00:00-x.md` — X. Status: in-progress-ish\n";
    const out = flipBacklogRowDone(row, "aaa111", "dev", SUFFIX);
    expect(out).toContain("Status: in-progress-ish");
  });

  it("rejects an invalid hash before touching the content", () => {
    expect(() => flipBacklogRowDone(SAMPLE_DEV_MD, "no", "dev", SUFFIX)).toThrow(
      /invalid hash/,
    );
  });
});

const SAMPLE_SPEC = `---
hash: sgr105
type: dev
status: in-progress
owner: /devx-sess1
branch: feat/dev-sgr105
---

## Goal

Do the thing.

## Status log

- 2026-08-02T13:57 — emitted by /devx-plan RED stage.
- 2026-08-05T09:00 — claimed by /devx in session /devx-sess1.

## Links

- none
`;

describe("updateSpecForDone", () => {
  it("flips status: in-progress → done and appends the status-log line", () => {
    const out = updateSpecForDone(
      SAMPLE_SPEC,
      "2026-08-05T12:00:00-06:00",
      "merged via PR #117 (squash → abc1234)",
    );
    expect(out).toContain("status: done");
    expect(out).not.toContain("status: in-progress");
    expect(out).toContain(
      "- 2026-08-05T12:00:00-06:00 — merged via PR #117 (squash → abc1234)",
    );
  });

  it("appends INSIDE the status-log section, preserving what follows", () => {
    const out = updateSpecForDone(SAMPLE_SPEC, "2026-08-05T12:00:00-06:00", "merged");
    const logIdx = out.indexOf("— merged");
    const linksIdx = out.indexOf("## Links");
    expect(logIdx).toBeGreaterThan(0);
    expect(logIdx).toBeLessThan(linksIdx);
    // Prior lines survive verbatim — the log is append-only.
    expect(out).toContain("- 2026-08-02T13:57 — emitted by /devx-plan RED stage.");
    expect(out).toContain("## Links\n\n- none\n");
  });

  it("leaves owner: in place — the audit trail outlives the claim", () => {
    const out = updateSpecForDone(SAMPLE_SPEC, "2026-08-05T12:00:00-06:00", "merged");
    expect(out).toContain("owner: /devx-sess1");
  });

  it("throws a `state` error when the spec is not in-progress", () => {
    const ready = SAMPLE_SPEC.replace("status: in-progress", "status: ready");
    try {
      updateSpecForDone(ready, "2026-08-05T12:00:00-06:00", "merged");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("state");
      expect((e as MarkDoneError).message).toMatch(/status: ready/);
    }
  });

  it("throws a `compose` error when frontmatter is missing entirely", () => {
    try {
      updateSpecForDone("# no frontmatter\n", "2026-08-05T12:00:00-06:00", "m");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("compose");
    }
  });

  it("mints a status-log section when the spec has none", () => {
    const bare = "---\nhash: x\nstatus: in-progress\n---\n\n## Goal\n\nx\n";
    const out = updateSpecForDone(bare, "2026-08-05T12:00:00-06:00", "merged");
    expect(out).toContain("## Status log\n\n- 2026-08-05T12:00:00-06:00 — merged");
  });
});

describe("mergeSuffix", () => {
  it("builds a full PR URL from a GitHub slug", () => {
    expect(mergeSuffix("LeoTheMighty/devx", 117, "abc1234")).toBe(
      "PR: https://github.com/LeoTheMighty/devx/pull/117 (merged abc1234)",
    );
  });

  it("degrades to `#<n>` rather than fabricating a github.com link", () => {
    expect(mergeSuffix(null, 117, "abc1234")).toBe("PR: #117 (merged abc1234)");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — markDone driver (fake fs, identity lock)
// ---------------------------------------------------------------------------

interface FakeFsState {
  files: Map<string, string>;
  dirs: Set<string>;
}

function parentPath(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "";
  return p.slice(0, idx);
}

function makeFakeFs(initial: Record<string, string>): {
  fs: ClaimFs;
  state: FakeFsState;
} {
  const state: FakeFsState = {
    files: new Map(Object.entries(initial)),
    dirs: new Set(),
  };
  for (const path of Object.keys(initial)) {
    let parent = parentPath(path);
    while (parent) {
      state.dirs.add(parent);
      const next = parentPath(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  const fs: ClaimFs = {
    openExclusive: () => {
      throw new Error("mark-done must not take a spec lock");
    },
    readFile: (p) => {
      if (!state.files.has(p)) throw new Error(`ENOENT: ${p}`);
      return state.files.get(p) as string;
    },
    writeFile: (p, c) => {
      state.files.set(p, c);
    },
    rename: (a, b) => {
      if (!state.files.has(a)) throw new Error(`ENOENT: ${a}`);
      state.files.set(b, state.files.get(a) as string);
      state.files.delete(a);
    },
    exists: (p) => state.files.has(p) || state.dirs.has(p),
    mkdirRecursive: (p) => {
      let cur = p;
      while (cur && cur !== "/") {
        state.dirs.add(cur);
        const next = parentPath(cur);
        if (next === cur) break;
        cur = next;
      }
    },
    unlink: (p) => {
      state.files.delete(p);
    },
    readdir: (p) => {
      const out: string[] = [];
      const prefix = `${p}/`;
      for (const f of state.files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          if (!rest.includes("/")) out.push(rest);
        }
      }
      return out;
    },
  };
  return { fs, state };
}

const SPEC_ABS = "/repo/dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md";
const PLAN_ABS = "/repo/plan/plan-62bcd1-2026-08-02T09:00-story-graph.md";
const TODO_ABS = "/repo/_devx/workstreams/story-graph/todo.md";

const WORKSTREAM_SPEC = `---
hash: sgr105
type: dev
status: in-progress
from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md
plan: _devx/workstreams/story-graph
---

## Status log

- 2026-08-05T09:00 — claimed.
`;

const PLAN_SPEC = `---
hash: 62bcd1
type: plan
status: in-progress
stage: execute
workstream: _devx/workstreams/story-graph
---

## Goal

Story graph.
`;

function baseFiles(spec: string = WORKSTREAM_SPEC): Record<string, string> {
  return {
    "/repo/DEV.md": SAMPLE_DEV_MD,
    [SPEC_ABS]: spec,
    [PLAN_ABS]: PLAN_SPEC,
    [TODO_ABS]: "# todo — Story Graph\n",
  };
}

const okRegen: RegenFn = () => ({ ok: true, path: `/repo/${GRAPH_FILENAME}` });
const identityLock = <T,>(_label: string, fn: () => T): T => fn();
// The exec seam serves THREE git commands whose exit-0 means different
// things: `remote get-url` (0 = a remote exists), `check-ignore -q` (0 = the
// path IS ignored), and the two `rev-parse` probes whose STDOUT equality
// decides linked-worktree-ness. A stub that blanket-returns one result
// silently tells mark-done the board is gitignored — dispatch per command,
// as the real exec does.
function gitStub(
  remote: ExecResult,
  ignored: boolean,
  { linkedWorktree = false }: { linkedWorktree?: boolean } = {},
) {
  return (_cmd: string, args: string[]): ExecResult => {
    if (args[0] === "check-ignore") {
      return { stdout: "", stderr: "", exitCode: ignored ? 0 : 1 };
    }
    if (args[0] === "rev-parse") {
      // mlc101's three-line probe: git-dir, common-dir, toplevel. git-dir
      // differs from common-dir exactly in a linked worktree.
      const gitDir = linkedWorktree
        ? "/repo/.git/worktrees/dev-sgr105"
        : "/repo/.git";
      return {
        stdout: `${gitDir}\n/repo/.git\n/repo\n`,
        stderr: "",
        exitCode: 0,
      };
    }
    return remote;
  };
}
const GH_REMOTE: ExecResult = {
  stdout: "git@github.com:LeoTheMighty/devx.git\n",
  stderr: "",
  exitCode: 0,
};
const NO_REMOTE: ExecResult = { stdout: "", stderr: "", exitCode: 1 };
const ghRemote = gitStub(GH_REMOTE, false);
const noRemote = gitStub(NO_REMOTE, false);

function driverOpts(
  fs: ClaimFs,
  over: Partial<MarkDoneOpts> = {},
): MarkDoneOpts {
  return {
    repoRoot: "/repo",
    config: {},
    pr: 117,
    mergeSha: "abc1234def",
    fs,
    exec: ghRemote,
    lock: identityLock,
    regen: okRegen,
    todoSync: () => true,
    now: () => new Date("2026-08-05T12:00:00Z"),
    ...over,
  };
}

describe("markDone — happy path", () => {
  it("writes both flips and returns the pathspecs in backlog, spec, todo, graph order", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const result = markDone("sgr105", driverOpts(fs));

    expect(result.hash).toBe("sgr105");
    expect(result.todoSynced).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.paths).toEqual([
      "DEV.md",
      "dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md",
      "_devx/workstreams/story-graph/todo.md",
      GRAPH_FILENAME,
    ]);

    const devMd = state.files.get("/repo/DEV.md") as string;
    expect(devMd).toContain(
      "- [x] `dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md` — mark-done helper. Status: done. Blocked-by: sgr104. PR: https://github.com/LeoTheMighty/devx/pull/117 (merged abc1234)",
    );
    const spec = state.files.get(SPEC_ABS) as string;
    expect(spec).toContain("status: done");
    expect(spec).toContain("merged via PR #117 (squash → abc1234)");
  });

  it("leaves no .tmp debris behind", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    markDone("sgr105", driverOpts(fs));
    const tmps = [...state.files.keys()].filter((k) => k.includes(".tmp."));
    expect(tmps).toEqual([]);
  });

  it("resolves the workstream plan hash off `from:` and hands it to the sync", () => {
    const { fs } = makeFakeFs(baseFiles());
    const seen: string[] = [];
    markDone(
      "sgr105",
      driverOpts(fs, {
        todoSync: (planHash) => {
          seen.push(planHash);
          return true;
        },
      }),
    );
    expect(seen).toEqual(["62bcd1"]);
  });

  it("recovers the plan hash from the claiming plan spec when only `plan:` names the workstream", () => {
    // No `from:` at all — membership resolves via the workstream PATH, which
    // carries no hash, so the plan dir has to be walked for the claimant.
    const pathOnly = WORKSTREAM_SPEC.replace(
      "from: plan/plan-62bcd1-2026-08-02T09:00-story-graph.md\n",
      "",
    );
    const { fs } = makeFakeFs(baseFiles(pathOnly));
    const seen: string[] = [];
    markDone(
      "sgr105",
      driverOpts(fs, {
        todoSync: (planHash) => {
          seen.push(planHash);
          return true;
        },
      }),
    );
    expect(seen).toEqual(["62bcd1"]);
  });

  it("omits a gitignored GRAPH.md from the pathspecs and warns instead", () => {
    // Review fix: `git add` refuses an ignored path for the WHOLE pathspec
    // list, so returning a gitignored board would break the caller's
    // cleanup commit over a file it does not need.
    const { fs } = makeFakeFs(baseFiles());
    const result = markDone(
      "sgr105",
      driverOpts(fs, { exec: gitStub(GH_REMOTE, true) }),
    );
    expect(result.paths).not.toContain(GRAPH_FILENAME);
    expect(result.warnings[0]).toMatch(/gitignored/);
  });

  it("keeps GRAPH.md in the pathspecs when the ignore probe itself fails", () => {
    // Uncertainty must not silently drop the board — the caller's `git add`
    // is the backstop and a WARN there beats a missing artifact here.
    const { fs } = makeFakeFs(baseFiles());
    const result = markDone(
      "sgr105",
      driverOpts(fs, {
        exec: (_cmd, args) => {
          if (args[0] === "check-ignore") throw new Error("no git");
          return GH_REMOTE;
        },
      }),
    );
    expect(result.paths).toContain(GRAPH_FILENAME);
  });

  it("degrades the row to `PR: #<n>` when origin is not a GitHub remote", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    markDone("sgr105", driverOpts(fs, { exec: noRemote }));
    expect(state.files.get("/repo/DEV.md")).toContain("PR: #117 (merged abc1234)");
  });

  it("closes a debug spec through DEBUG.md", () => {
    const debugSpec =
      "---\nhash: c81f04\ntype: debug\nstatus: in-progress\n---\n\n## Status log\n\n- claimed.\n";
    const { fs, state } = makeFakeFs({
      "/repo/DEBUG.md":
        "- [/] `debug/debug-c81f04-2026-08-04T15:19-attach.md` — Attach. Status: in-progress.\n",
      "/repo/debug/debug-c81f04-2026-08-04T15:19-attach.md": debugSpec,
    });
    const result = markDone("c81f04", driverOpts(fs, { type: "debug" }));
    expect(result.paths[0]).toBe("DEBUG.md");
    expect(result.todoSynced).toBe(false);
    expect(state.files.get("/repo/DEBUG.md")).toContain("- [x] `debug/debug-c81f04");
  });
});

describe("markDone — state mismatch writes nothing (exit-1 family)", () => {
  it("refuses a row that is still [ ] and leaves both files untouched", () => {
    const { fs, state } = makeFakeFs({
      ...baseFiles(),
      "/repo/DEV.md": SAMPLE_DEV_MD.replace("- [/] `dev/dev-sgr105", "- [ ] `dev/dev-sgr105"),
    });
    const before = {
      dev: state.files.get("/repo/DEV.md"),
      spec: state.files.get(SPEC_ABS),
    };
    try {
      markDone("sgr105", driverOpts(fs));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("state");
    }
    expect(state.files.get("/repo/DEV.md")).toBe(before.dev);
    expect(state.files.get(SPEC_ABS)).toBe(before.spec);
  });

  it("refuses when the backlog row says [/] but the spec frontmatter does not", () => {
    // The dangerous shape: the row alone would flip cleanly. The spec is the
    // source of truth per CLAUDE.md, so disagreement must stop the write —
    // and crucially the backlog must NOT be left flipped.
    const { fs, state } = makeFakeFs(
      baseFiles(WORKSTREAM_SPEC.replace("status: in-progress", "status: ready")),
    );
    const before = state.files.get("/repo/DEV.md");
    expect(() => markDone("sgr105", driverOpts(fs))).toThrow(MarkDoneError);
    expect(state.files.get("/repo/DEV.md")).toBe(before);
  });

  it("does not run the todo sync or the regen when the state check fails", () => {
    const { fs } = makeFakeFs({
      ...baseFiles(),
      "/repo/DEV.md": SAMPLE_DEV_MD.replace("- [/] `dev/dev-sgr105", "- [ ] `dev/dev-sgr105"),
    });
    let syncs = 0;
    let regens = 0;
    expect(() =>
      markDone(
        "sgr105",
        driverOpts(fs, {
          todoSync: () => {
            syncs++;
            return true;
          },
          regen: () => {
            regens++;
            return { ok: true, path: "/repo/GRAPH.md" };
          },
        }),
      ),
    ).toThrow();
    expect(syncs).toBe(0);
    expect(regens).toBe(0);
  });

  it("refuses to run from a linked worktree — the writes would land on a doomed branch", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const before = state.files.get("/repo/DEV.md");
    try {
      markDone(
        "sgr105",
        driverOpts(fs, { exec: gitStub(GH_REMOTE, false, { linkedWorktree: true }) }),
      );
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("resolve");
      expect((e as MarkDoneError).message).toMatch(/is a linked worktree/);
    }
    expect(state.files.get("/repo/DEV.md")).toBe(before);
  });

  it("runs normally when the worktree probe cannot answer (no git, spawn failure)", () => {
    // A probe that can't tell must not block a legitimate merge cleanup.
    const { fs } = makeFakeFs(baseFiles());
    const result = markDone(
      "sgr105",
      driverOpts(fs, {
        exec: (_cmd, args) => {
          if (args[0] === "rev-parse") throw new Error("not a git repository");
          if (args[0] === "check-ignore") {
            return { stdout: "", stderr: "", exitCode: 1 };
          }
          return NO_REMOTE;
        },
      }),
    );
    expect(result.paths).toContain("DEV.md");
  });

  it("reports `resolve` (not `state`) when the spec file does not exist", () => {
    const { fs } = makeFakeFs({ "/repo/DEV.md": SAMPLE_DEV_MD });
    try {
      markDone("sgr105", driverOpts(fs));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("resolve");
    }
  });

  it("rejects a non-hex merge sha before any read", () => {
    const { fs } = makeFakeFs(baseFiles());
    try {
      markDone("sgr105", driverOpts(fs, { mergeSha: "feat/dev-sgr105" }));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as MarkDoneError).stage).toBe("validate");
    }
  });
});

describe("markDone — backlog-lock contention", () => {
  it("propagates BacklogLockTimeoutError without mutating anything", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const before = state.files.get("/repo/DEV.md");
    const contended = (): never => {
      throw new BacklogLockTimeoutError("/repo/.devx-cache/locks/backlog.lock", "mark-done-sgr105", 4242);
    };
    expect(() => markDone("sgr105", driverOpts(fs, { lock: contended }))).toThrow(
      BacklogLockTimeoutError,
    );
    expect(state.files.get("/repo/DEV.md")).toBe(before);
  });

  it("labels its critical section by hash", () => {
    const { fs } = makeFakeFs(baseFiles());
    const labels: string[] = [];
    markDone(
      "sgr105",
      driverOpts(fs, {
        lock: (label, fn) => {
          labels.push(label);
          return fn();
        },
      }),
    );
    expect(labels).toEqual(["mark-done-sgr105"]);
  });
});

describe("markDone — workstream-less items", () => {
  it("skips the todo sync entirely and omits todo.md from the pathspecs", () => {
    const standalone =
      "---\nhash: sgr105\ntype: dev\nstatus: in-progress\nfrom: v2/06-phases.md\n---\n\n## Status log\n\n- claimed.\n";
    const { fs } = makeFakeFs({
      "/repo/DEV.md": SAMPLE_DEV_MD,
      [SPEC_ABS]: standalone,
    });
    let syncs = 0;
    const result = markDone(
      "sgr105",
      driverOpts(fs, {
        todoSync: () => {
          syncs++;
          return true;
        },
      }),
    );
    expect(syncs).toBe(0);
    expect(result.todoSynced).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.paths).toEqual([
      "DEV.md",
      "dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md",
      GRAPH_FILENAME,
    ]);
  });

  it("omits todo.md from the pathspecs when the workstream has none on disk yet", () => {
    const files = baseFiles();
    delete files[TODO_ABS];
    const { fs } = makeFakeFs(files);
    const result = markDone("sgr105", driverOpts(fs));
    expect(result.paths).not.toContain("_devx/workstreams/story-graph/todo.md");
  });
});

describe("markDone — derived-artifact failures warn and continue", () => {
  it("keeps the flips when the regen fails, and omits GRAPH.md from the pathspecs", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const result = markDone(
      "sgr105",
      driverOpts(fs, {
        regen: () => ({ ok: false, warning: "GRAPH.md not regenerated: blocking-edge cycle" }),
      }),
    );
    expect(state.files.get("/repo/DEV.md")).toContain("- [x] `dev/dev-sgr105");
    expect(state.files.get(SPEC_ABS)).toContain("status: done");
    expect(result.paths).not.toContain(GRAPH_FILENAME);
    expect(result.warnings).toEqual(["GRAPH.md not regenerated: blocking-edge cycle"]);
  });

  it("contains a regen hook that THROWS — the seam is public, the guarantee is not", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const result = markDone(
      "sgr105",
      driverOpts(fs, {
        regen: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(state.files.get("/repo/DEV.md")).toContain("- [x] `dev/dev-sgr105");
    expect(result.paths).not.toContain(GRAPH_FILENAME);
    expect(result.warnings[0]).toMatch(/the regen hook threw \(boom\)/);
  });

  it("keeps the flips when the todo sync reports failure", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const result = markDone("sgr105", driverOpts(fs, { todoSync: () => false }));
    expect(state.files.get(SPEC_ABS)).toContain("status: done");
    expect(result.todoSynced).toBe(false);
    expect(result.warnings[0]).toMatch(/todo\.md not synced.*devx todo sync 62bcd1/s);
    // Still staged: the sync may have partially written before failing, and
    // an unstaged rewrite on `main` is what the next session trips over.
    expect(result.paths).toContain("_devx/workstreams/story-graph/todo.md");
  });

  it("keeps the flips when the todo sync throws", () => {
    const { fs, state } = makeFakeFs(baseFiles());
    const result = markDone(
      "sgr105",
      driverOpts(fs, {
        todoSync: () => {
          throw new Error("template missing");
        },
      }),
    );
    expect(state.files.get(SPEC_ABS)).toContain("status: done");
    expect(result.todoSynced).toBe(false);
    expect(result.warnings[0]).toMatch(/todo\.md sync threw.*template missing/s);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — runMarkDone CLI
// ---------------------------------------------------------------------------

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    rmSync(tmpRoots.pop() as string, { recursive: true, force: true });
  }
});

function makeTmpRepo(devMd: string, spec: string): string {
  const root = mkdtempSync(join(tmpdir(), "sgr105-cli-"));
  tmpRoots.push(root);
  mkdirSync(join(root, "dev"), { recursive: true });
  writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n", "utf8");
  writeFileSync(join(root, "DEV.md"), devMd, "utf8");
  writeFileSync(
    join(root, "dev", "dev-sgr105-2026-08-02T13:57-mark-done-phase8.md"),
    spec,
    "utf8",
  );
  return root;
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(root: string, args: string[], over: Partial<MarkDoneOpts> = {}): CliRun {
  let stdout = "";
  let stderr = "";
  const code = runMarkDone(args, {
    out: (s) => {
      stdout += s;
    },
    err: (s) => {
      stderr += s;
    },
    projectPath: join(root, "devx.config.yaml"),
    repoRoot: root,
    markDoneOpts: { exec: ghRemote, lock: identityLock, regen: okRegen, ...over },
  });
  return { code, stdout, stderr };
}

const STANDALONE_SPEC =
  "---\nhash: sgr105\ntype: dev\nstatus: in-progress\nfrom: v2/06-phases.md\n---\n\n## Status log\n\n- claimed.\n";

describe("runMarkDone — exit codes", () => {
  it("exit 0 with {hash, paths, todoSynced} on stdout", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, ["sgr105", "--pr", "117", "--merge-sha", "abc1234def"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual({
      hash: "sgr105",
      paths: [
        "DEV.md",
        "dev/dev-sgr105-2026-08-02T13:57-mark-done-phase8.md",
        GRAPH_FILENAME,
      ],
      todoSynced: false,
    });
    // Exactly one JSON object — the shell-side `JSON.parse` contract.
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toContain(
      "- [x] `dev/dev-sgr105",
    );
  });

  it("exit 1 with stage `state` when the row was never claimed", () => {
    const root = makeTmpRepo(
      SAMPLE_DEV_MD.replace("- [/] `dev/dev-sgr105", "- [ ] `dev/dev-sgr105"),
      STANDALONE_SPEC.replace("status: in-progress", "status: ready"),
    );
    const r = runCli(root, ["sgr105", "--pr", "117", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      error: "mark-done-failed",
      stage: "state",
    });
  });

  it("exit 1 with the retryable backlog-lock shape on contention", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, ["sgr105", "--pr", "117", "--merge-sha", "abc1234"], {
      lock: () => {
        throw new BacklogLockTimeoutError(
          join(root, ".devx-cache/locks/backlog.lock"),
          "mark-done-sgr105",
          4242,
        );
      },
    });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error).toBe("backlog lock held");
    expect(JSON.parse(r.stdout).holderPid).toBe(4242);
  });

  it("exit 2 with stage `resolve` when the spec is missing", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    rmSync(join(root, "dev"), { recursive: true, force: true });
    const r = runCli(root, ["sgr105", "--pr", "117", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({
      error: "mark-done-failed",
      stage: "resolve",
    });
  });

  it("exit 64 on a missing required flag, with nothing on stdout", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, ["sgr105", "--pr", "117"]);
    expect(r.code).toBe(64);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/usage: devx devx-helper mark-done/);
  });

  it("exit 64 rather than swallowing the next flag when a value is omitted", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, ["sgr105", "--pr", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/--pr requires a value/);
  });

  it("exit 64 on a malformed --merge-sha, not the exit-2 investigate tier", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, [
      "sgr105",
      "--pr",
      "117",
      "--merge-sha",
      "feat/dev-sgr105",
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/invalid --merge-sha/);
    expect(r.stdout).toBe("");
  });

  it("exit 64 on a non-numeric --pr", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, ["sgr105", "--pr", "117x", "--merge-sha", "abc1234"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/invalid --pr/);
  });

  it("exit 64 on an unknown flag", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, [
      "sgr105",
      "--pr",
      "117",
      "--merge-sha",
      "abc1234",
      "--force",
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/unknown flag '--force'/);
  });

  it("exit 64 on an invalid --type", () => {
    const root = makeTmpRepo(SAMPLE_DEV_MD, STANDALONE_SPEC);
    const r = runCli(root, [
      "sgr105",
      "--pr",
      "117",
      "--merge-sha",
      "abc1234",
      "--type",
      "plan",
    ]);
    expect(r.code).toBe(64);
    expect(r.stderr).toMatch(/invalid --type 'plan'/);
  });
});
