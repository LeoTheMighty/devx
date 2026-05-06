// Library tests for src/lib/devx/await-remote-ci.ts (dvx105). Mocks
// fs + exec + sleep so all 3 terminal states from spec AC #1 are
// exercisable without disk or network round-trips.
//
// Spec: dev/dev-dvx105-2026-04-28T19:30-devx-await-remote-ci.md

import { describe, expect, it } from "vitest";

import {
  type AwaitRemoteCiFs,
  type Exec,
  type ExecResult,
  GhProbeError,
  awaitRemoteCi,
  hasWorkflowFiles,
  parseGhRunList,
  probeRemoteCi,
} from "../src/lib/devx/await-remote-ci.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeFsOpts {
  /** Map of `relative path under repoRoot → entries returned by readdir`. */
  dirs?: Record<string, string[]>;
  /** Set of paths that exist (relative under repoRoot). */
  exists?: Set<string>;
  /** Throw on readdir for these paths (permission errors). */
  readdirThrows?: Set<string>;
}

function fakeFs(repoRoot: string, opts: FakeFsOpts = {}): AwaitRemoteCiFs {
  return {
    exists: (p) => {
      if (!p.startsWith(repoRoot)) return false;
      const rel = p.slice(repoRoot.length).replace(/^\//, "");
      return (opts.exists ?? new Set()).has(rel);
    },
    readdir: (p) => {
      const rel = p.startsWith(repoRoot)
        ? p.slice(repoRoot.length).replace(/^\//, "")
        : p;
      if (opts.readdirThrows?.has(rel)) {
        const e: NodeJS.ErrnoException = new Error(`EACCES: ${rel}`);
        e.code = "EACCES";
        throw e;
      }
      return opts.dirs?.[rel] ?? [];
    },
  };
}

interface ExecCall {
  cmd: string;
  args: string[];
  cwd?: string;
}

function fakeExec(
  responses: Record<string, ExecResult | Array<ExecResult>>,
  recorded: ExecCall[] = [],
): Exec {
  // Track index for sequential responses keyed by command signature.
  const idx: Record<string, number> = {};
  return (cmd, args, opts) => {
    recorded.push({ cmd, args: [...args], cwd: opts?.cwd });
    const key = `${cmd} ${args.join(" ")}`;
    const r = responses[key];
    if (Array.isArray(r)) {
      const i = idx[key] ?? 0;
      idx[key] = i + 1;
      if (!r[i]) {
        throw new Error(
          `fakeExec: ran out of sequential responses for '${key}' at index ${i}`,
        );
      }
      return r[i];
    }
    if (r) return r;
    throw new Error(
      `fakeExec: no response configured for '${key}' (recorded: ${
        recorded.length
      })`,
    );
  };
}

const okExit = (stdout: string): ExecResult => ({
  stdout,
  stderr: "",
  exitCode: 0,
});

const failExit = (stderr: string, exitCode = 1): ExecResult => ({
  stdout: "",
  stderr,
  exitCode,
});

const HEAD_SHA = "abcdef1234567890abcdef1234567890abcdef12";

function makeRun(
  overrides: Partial<{
    databaseId: number;
    status: string;
    conclusion: string | null;
    url: string;
    headSha: string;
    workflowName: string;
  }> = {},
): string {
  return JSON.stringify([
    {
      databaseId: overrides.databaseId ?? 12345,
      status: overrides.status ?? "in_progress",
      conclusion: overrides.conclusion ?? null,
      url: overrides.url ?? "https://github.com/owner/repo/actions/runs/12345",
      headSha: overrides.headSha ?? HEAD_SHA,
      workflowName: overrides.workflowName ?? "devx-ci",
    },
  ]);
}

// ---------------------------------------------------------------------------
// hasWorkflowFiles
// ---------------------------------------------------------------------------

describe("hasWorkflowFiles", () => {
  const root = "/repo";

  it("returns false when .github/workflows doesn't exist", () => {
    expect(hasWorkflowFiles(fakeFs(root), root)).toBe(false);
  });

  it("returns false when directory exists but is empty", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": [] },
        }),
        root,
      ),
    ).toBe(false);
  });

  it("returns false when directory has only non-yml files", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["README.md", ".gitkeep"] },
        }),
        root,
      ),
    ).toBe(false);
  });

  it("matches .yml", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        root,
      ),
    ).toBe(true);
  });

  it("matches .yaml", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yaml"] },
        }),
        root,
      ),
    ).toBe(true);
  });

  it("matches case-insensitive .YML/.Yaml", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.YML"] },
        }),
        root,
      ),
    ).toBe(true);
  });

  it("ignores dotfiles like editor swp", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": [".devx-ci.yml.swp"] },
        }),
        root,
      ),
    ).toBe(false);
  });

  it("returns false on readdir throw (permission error)", () => {
    expect(
      hasWorkflowFiles(
        fakeFs(root, {
          exists: new Set([".github/workflows"]),
          readdirThrows: new Set([".github/workflows"]),
        }),
        root,
      ),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseGhRunList
// ---------------------------------------------------------------------------

describe("parseGhRunList", () => {
  it("returns empty array on empty stdout", () => {
    expect(parseGhRunList("")).toEqual([]);
  });

  it("returns empty array on '[]'", () => {
    expect(parseGhRunList("[]")).toEqual([]);
  });

  it("parses a single run", () => {
    const stdout = makeRun({
      databaseId: 999,
      status: "completed",
      conclusion: "success",
    });
    const runs = parseGhRunList(stdout);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      databaseId: 999,
      status: "completed",
      conclusion: "success",
    });
  });

  it("preserves null conclusion (in_progress runs)", () => {
    const stdout = makeRun({ status: "in_progress", conclusion: null });
    const runs = parseGhRunList(stdout);
    expect(runs[0].conclusion).toBeNull();
  });

  it("throws GhProbeError on malformed JSON", () => {
    expect(() => parseGhRunList("not json")).toThrow(GhProbeError);
  });

  it("throws GhProbeError on non-array JSON", () => {
    expect(() => parseGhRunList('{"foo":"bar"}')).toThrow(GhProbeError);
  });

  it("throws GhProbeError when run is missing required fields", () => {
    expect(() =>
      parseGhRunList(JSON.stringify([{ databaseId: 1 /* no status */ }])),
    ).toThrow(GhProbeError);
  });

  it("throws on databaseId = 0 / negative / float", () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        parseGhRunList(
          JSON.stringify([
            {
              databaseId: id,
              status: "completed",
              conclusion: "success",
              url: "https://example",
              headSha: "a".repeat(40),
              workflowName: "x",
            },
          ]),
        ),
      ).toThrow(GhProbeError);
    }
  });

  it("throws on missing/empty headSha or non-40-hex headSha", () => {
    for (const sha of ["", "ABC", "z".repeat(40), "0".repeat(39)]) {
      expect(() =>
        parseGhRunList(
          JSON.stringify([
            {
              databaseId: 1,
              status: "in_progress",
              conclusion: null,
              url: "https://example",
              headSha: sha,
              workflowName: "x",
            },
          ]),
        ),
      ).toThrow(GhProbeError);
    }
  });

  it("throws on non-string non-null conclusion (number/bool)", () => {
    for (const conclusion of [0, false, 1, true]) {
      expect(() =>
        parseGhRunList(
          JSON.stringify([
            {
              databaseId: 1,
              status: "completed",
              conclusion,
              url: "https://example",
              headSha: "a".repeat(40),
              workflowName: "x",
            },
          ]),
        ),
      ).toThrow(GhProbeError);
    }
  });

  it("treats whitespace-only stdout as empty array", () => {
    expect(parseGhRunList("  \n  ")).toEqual([]);
  });

  it("throws on missing/empty status", () => {
    expect(() =>
      parseGhRunList(
        JSON.stringify([
          {
            databaseId: 1,
            status: "",
            conclusion: null,
            url: "https://example",
            headSha: "a".repeat(40),
            workflowName: "x",
          },
        ]),
      ),
    ).toThrow(GhProbeError);
  });
});

// ---------------------------------------------------------------------------
// probeRemoteCi — single-shot states
// ---------------------------------------------------------------------------

describe("probeRemoteCi", () => {
  const root = "/repo";
  const branch = "feat/dev-dvx105";

  it("returns no-workflow when .github/workflows is missing", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root),
      exec: fakeExec({}),
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "no-workflow" });
  });

  it("returns empty when gh returns []", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
          okExit("[]"),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "empty" });
  });

  it("returns sha-mismatch when run.headSha != local HEAD", async () => {
    const otherSha = "0000000000000000000000000000000000000000";
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
          okExit(makeRun({ headSha: otherSha })),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "sha-mismatch",
      runHeadSha: otherSha,
      headSha: HEAD_SHA,
    });
  });

  it("returns in-progress when status != completed", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
          okExit(makeRun({ status: "in_progress" })),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "in-progress",
      status: "in_progress",
      runId: 12345,
      url: "https://github.com/owner/repo/actions/runs/12345",
      workflowName: "devx-ci",
    });
  });

  it("treats unknown transient statuses (queued/waiting) as in-progress", async () => {
    for (const status of ["queued", "waiting", "requested", "pending"]) {
      const result = await probeRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
            okExit(makeRun({ status })),
        }),
        headSha: HEAD_SHA,
      });
      expect(result.state).toBe("in-progress");
    }
  });

  it("returns completed with conclusion when status == completed", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
          okExit(makeRun({ status: "completed", conclusion: "success" })),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "success",
      runId: 12345,
    });
  });

  it("preserves non-success conclusions (failure/cancelled/timed_out)", async () => {
    for (const conclusion of [
      "failure",
      "cancelled",
      "timed_out",
      "skipped",
      "neutral",
      "action_required",
    ]) {
      const result = await probeRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
            okExit(makeRun({ status: "completed", conclusion })),
        }),
        headSha: HEAD_SHA,
      });
      expect(result).toMatchObject({ state: "completed", conclusion });
    }
  });

  it("throws GhProbeError when gh exits non-zero", async () => {
    await expect(
      probeRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
            failExit("gh: not authenticated", 4),
        }),
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(GhProbeError);
  });

  it("throws GhProbeError on git rev-parse failure when headSha not provided", async () => {
    await expect(
      probeRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
            okExit(makeRun()),
          [`git rev-parse ${branch}`]: failExit("fatal: not a git repository", 128),
        }),
      }),
    ).rejects.toThrow(GhProbeError);
  });

  it("computes headSha via git when not provided", async () => {
    const recorded: ExecCall[] = [];
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec(
        {
          [`gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`]:
            okExit(makeRun({ status: "completed", conclusion: "success" })),
          [`git rev-parse ${branch}`]: okExit(`${HEAD_SHA}\n`),
        },
        recorded,
      ),
    });
    expect(result.state).toBe("completed");
    expect(recorded.map((c) => `${c.cmd} ${c.args[0]}`)).toContain(
      "git rev-parse",
    );
  });

  it("rejects empty branch", async () => {
    await expect(
      probeRemoteCi("", { repoRoot: root, headSha: HEAD_SHA }),
    ).rejects.toThrow(/branch must be non-empty/);
  });

  it("rejects missing repoRoot", async () => {
    await expect(
      probeRemoteCi(branch, { repoRoot: "", headSha: HEAD_SHA }),
    ).rejects.toThrow(/repoRoot is required/);
  });

  it("rejects caller-supplied non-40-hex headSha (uppercase / short / non-hex)", async () => {
    for (const bad of ["ABC", "ABCDEF", "z".repeat(40), HEAD_SHA.toUpperCase()]) {
      await expect(
        probeRemoteCi(branch, { repoRoot: root, headSha: bad }),
      ).rejects.toThrow(/40-char lowercase hex/);
    }
  });
});

// ---------------------------------------------------------------------------
// awaitRemoteCi — multi-probe driver (3 terminal states from AC #1)
// ---------------------------------------------------------------------------

describe("awaitRemoteCi", () => {
  const root = "/repo";
  const branch = "feat/dev-dvx105";
  const ghKey = `gh run list --branch ${branch} --limit 1 --json databaseId,status,conclusion,url,headSha,workflowName`;
  const noopSleep = async () => {};

  it("AC #1 state 1: returns no-workflow when .github/workflows is missing", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root),
      exec: fakeExec({}),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "no-workflow" });
  });

  it("AC #1 state 2: returns workflow-no-run when gh returns empty twice (with retry)", async () => {
    const sleepCalls: number[] = [];
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [okExit("[]"), okExit("[]")],
      }),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      emptyRetryMs: 60_000,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "workflow-no-run",
      reason: "no-runs",
    });
    expect(sleepCalls).toEqual([60_000]);
  });

  it("AC #3: returns workflow-no-run with reason sha-mismatch on first probe", async () => {
    const otherSha = "1111111111111111111111111111111111111111";
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: okExit(makeRun({ headSha: otherSha })),
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "workflow-no-run",
      reason: "sha-mismatch",
    });
  });

  it("AC #1 state 3: returns completed when first probe sees completed", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: okExit(
          makeRun({ status: "completed", conclusion: "success" }),
        ),
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "success",
    });
  });

  it("AC #1 state 3: polls in-progress until completed, sleeping pollMs each iter", async () => {
    const sleepCalls: number[] = [];
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [
          okExit(makeRun({ status: "in_progress" })),
          okExit(makeRun({ status: "in_progress" })),
          okExit(makeRun({ status: "queued" })),
          okExit(
            makeRun({ status: "completed", conclusion: "success" }),
          ),
        ],
      }),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      pollMs: 120_000,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "success",
    });
    // 3 polls between 4 probes: each at the configured pollMs (AC #2).
    expect(sleepCalls).toEqual([120_000, 120_000, 120_000]);
  });

  it("AC #2: defaults to 120_000ms pollMs and 60_000ms emptyRetryMs", async () => {
    const sleepCalls: number[] = [];
    await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [
          okExit("[]"),
          okExit(makeRun({ status: "in_progress" })),
          okExit(makeRun({ status: "completed", conclusion: "success" })),
        ],
      }),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      headSha: HEAD_SHA,
    });
    expect(sleepCalls).toEqual([60_000, 120_000]);
  });

  it("retry path → completed: empty first, then completed on second probe", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [
          okExit("[]"),
          okExit(makeRun({ status: "completed", conclusion: "success" })),
        ],
      }),
      sleep: noopSleep,
      emptyRetryMs: 60_000,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "success",
    });
  });

  it("retry path → in-progress polling: empty first, then in-progress, then completed", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [
          okExit("[]"),
          okExit(makeRun({ status: "in_progress" })),
          okExit(makeRun({ status: "completed", conclusion: "failure" })),
        ],
      }),
      sleep: noopSleep,
      emptyRetryMs: 60_000,
      pollMs: 120_000,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "failure",
    });
  });

  it("retry path → sha-mismatch: empty first, then sha-mismatch on retry", async () => {
    const otherSha = "deadbeef00000000000000000000000000000000";
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [okExit("[]"), okExit(makeRun({ headSha: otherSha }))],
      }),
      sleep: noopSleep,
      emptyRetryMs: 60_000,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "workflow-no-run",
      reason: "sha-mismatch",
    });
  });

  it("workflow added between probes: empty + no-workflow → returns no-workflow", async () => {
    // Adversarial-edge: operator pushed .github/workflows/ci.yml between
    // the two probes. The fs view changes; we honour it.
    let calls = 0;
    const fs: AwaitRemoteCiFs = {
      exists: () => true,
      readdir: () => {
        calls += 1;
        // First probe sees workflows; second probe sees the dir suddenly
        // empty (operator removed the .yml). The driver should report
        // no-workflow.
        return calls === 1 ? ["devx-ci.yml"] : [];
      },
    };
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs,
      exec: fakeExec({
        [ghKey]: [okExit("[]")],
      }),
      sleep: noopSleep,
      emptyRetryMs: 60_000,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "no-workflow" });
  });

  it("mid-poll the run disappears: in-progress then empty → workflow-no-run", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [
          okExit(makeRun({ status: "in_progress" })),
          okExit("[]"),
        ],
      }),
      sleep: noopSleep,
      pollMs: 120_000,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "workflow-no-run",
      reason: "no-runs",
    });
  });

  it("mid-poll a sha-mismatch (run replaced for newer commit): → workflow-no-run with sha-mismatch", async () => {
    const otherSha = "feedface00000000000000000000000000000000";
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        [ghKey]: [
          okExit(makeRun({ status: "in_progress" })),
          okExit(makeRun({ status: "in_progress", headSha: otherSha })),
        ],
      }),
      sleep: noopSleep,
      pollMs: 120_000,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "workflow-no-run",
      reason: "sha-mismatch",
    });
  });

  it("respects maxPolls cap (test safety net)", async () => {
    // Run never completes — we bound to 2 polls and expect a thrown error.
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [ghKey]: [
            okExit(makeRun({ status: "in_progress" })),
            okExit(makeRun({ status: "in_progress" })),
            okExit(makeRun({ status: "in_progress" })),
          ],
        }),
        sleep: noopSleep,
        pollMs: 1,
        maxPolls: 2,
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(/maxPolls \(2\) exceeded/);
  });

  it("pins headSha at start: fix-forward push during polling does NOT trigger sha-mismatch", async () => {
    // Adversarial: operator pushes during the in-progress poll. probe 1
    // returns in-progress for HEAD_SHA. probe 2 (after sleep) sees
    // local HEAD has moved (the test models this by responding to git
    // rev-parse with a *new* sha) — but the driver pinned HEAD_SHA at
    // start, so the polling probe's headSha argument is HEAD_SHA, not
    // the new one. The run completes for HEAD_SHA → returns completed.
    const newSha = "fffffffffffffffffffffffffffffffffffffff0";
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec({
        // The driver calls git rev-parse <branch> once at start.
        [`git rev-parse ${branch}`]: [
          okExit(`${HEAD_SHA}\n`),
          // If the driver re-fetched (it shouldn't), this'd return newSha.
          okExit(`${newSha}\n`),
        ],
        [ghKey]: [
          okExit(makeRun({ status: "in_progress", headSha: HEAD_SHA })),
          okExit(
            makeRun({
              status: "completed",
              conclusion: "success",
              headSha: HEAD_SHA,
            }),
          ),
        ],
      }),
      sleep: noopSleep,
      pollMs: 120_000,
      // headSha NOT supplied — driver computes once via git rev-parse.
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "success",
    });
  });

  it("driver: git rev-parse failure propagates as GhProbeError before any probe", async () => {
    const recorded: ExecCall[] = [];
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec(
          {
            [`git rev-parse ${branch}`]: failExit("fatal", 128),
          },
          recorded,
        ),
        sleep: noopSleep,
        // headSha NOT supplied — driver invokes git first.
      }),
    ).rejects.toThrow(GhProbeError);
    // gh was never invoked — pinning happens before the first probe.
    expect(recorded.find((c) => c.cmd === "gh")).toBeUndefined();
  });

  it("driver: rejects non-sha output from git rev-parse", async () => {
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [`git rev-parse ${branch}`]: okExit("refs/heads/main\n"),
        }),
        sleep: noopSleep,
      }),
    ).rejects.toThrow(/non-sha output/);
  });

  it("driver: validates maxPolls >= 1", async () => {
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root),
        exec: fakeExec({}),
        sleep: noopSleep,
        maxPolls: 0,
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(/maxPolls must be a positive integer/);
  });

  it("driver: validates pollMs non-negative", async () => {
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root),
        exec: fakeExec({}),
        sleep: noopSleep,
        pollMs: -1,
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(/pollMs must be a non-negative finite number/);
  });

  it("driver: rejects pollMs < 1000ms in production mode (no sleep seam)", async () => {
    // Production safety: a misconfigured caller setting pollMs:50 with no
    // sleep seam would hammer gh. Tests with noopSleep are exempt.
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root),
        exec: fakeExec({}),
        // sleep deliberately NOT supplied — real setTimeout would run
        pollMs: 50,
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(/pollMs must be >= 1000 in production mode/);
  });

  it("driver: rejects emptyRetryMs < 1000ms in production mode", async () => {
    // Same rate-limit-burn rationale as pollMs.
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root),
        exec: fakeExec({}),
        emptyRetryMs: 50,
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(/emptyRetryMs must be >= 1000 in production mode/);
  });

  it("driver: rejects caller-supplied non-40-hex headSha", async () => {
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root),
        exec: fakeExec({}),
        sleep: noopSleep,
        headSha: "NOT-A-SHA",
      }),
    ).rejects.toThrow(/40-char lowercase hex/);
  });

  it("driver: git rev-parse runs in repoRoot (cwd-independence)", async () => {
    // Regression guard: if a refactor drops the cwd argument to exec,
    // git rev-parse would resolve against the process cwd instead of
    // repoRoot — silent breakage. Assert cwd is recorded.
    const recorded: ExecCall[] = [];
    await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: fakeFs(root, {
        exists: new Set([".github/workflows"]),
        dirs: { ".github/workflows": ["devx-ci.yml"] },
      }),
      exec: fakeExec(
        {
          [`git rev-parse ${branch}`]: okExit(`${HEAD_SHA}\n`),
          [ghKey]: okExit(makeRun({ status: "completed", conclusion: "success" })),
        },
        recorded,
      ),
      sleep: noopSleep,
    });
    const gitCall = recorded.find((c) => c.cmd === "git");
    expect(gitCall).toBeDefined();
    expect(gitCall?.cwd).toBe(root);
  });

  it("propagates GhProbeError unchanged (gh failure is operator-actionable)", async () => {
    await expect(
      awaitRemoteCi(branch, {
        repoRoot: root,
        fs: fakeFs(root, {
          exists: new Set([".github/workflows"]),
          dirs: { ".github/workflows": ["devx-ci.yml"] },
        }),
        exec: fakeExec({
          [ghKey]: failExit("auth required", 4),
        }),
        sleep: noopSleep,
        headSha: HEAD_SHA,
      }),
    ).rejects.toThrow(GhProbeError);
  });
});
