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
  foldRunsAtSha,
  hasWorkflowFiles,
  isPrConflicting,
  parseGhRunList,
  parsePrView,
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

interface RawRun {
  databaseId?: number;
  status?: string;
  conclusion?: string | null;
  url?: string;
  headSha?: string;
  workflowName?: string;
}

/**
 * Multi-run `gh run list` payload (arci1). gh returns runs newest-first
 * across the whole branch, so a fixture may legitimately mix shas.
 */
function makeRuns(runs: RawRun[]): string {
  return JSON.stringify(
    runs.map((r, i) => ({
      databaseId: r.databaseId ?? 1000 + i,
      status: r.status ?? "completed",
      conclusion: r.conclusion === undefined ? "success" : r.conclusion,
      url:
        r.url ??
        `https://github.com/owner/repo/actions/runs/${r.databaseId ?? 1000 + i}`,
      headSha: r.headSha ?? HEAD_SHA,
      workflowName: r.workflowName ?? `wf-${i}`,
    })),
  );
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
        [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
        [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
        [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
          [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
        [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
          [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
          [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
          [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
          [`gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`]:
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
// foldRunsAtSha — sibling-workflow aggregation (arci1)
// ---------------------------------------------------------------------------

describe("foldRunsAtSha", () => {
  const run = (o: Partial<import("../src/lib/devx/await-remote-ci.js").RunSummary>) => ({
    runId: o.runId ?? 1,
    workflowName: o.workflowName ?? "wf",
    status: o.status ?? "completed",
    conclusion: o.conclusion === undefined ? "success" : o.conclusion,
    url: o.url ?? "https://example/1",
  });

  it("throws on an empty run set", () => {
    expect(() => foldRunsAtSha([])).toThrow(/non-empty/);
  });

  it("arci1 AC #1/#2: one green + one red folds to the red conclusion and names it", () => {
    const result = foldRunsAtSha([
      run({ runId: 30296754787, workflowName: "CI & Deploy", conclusion: "success" }),
      run({
        runId: 30296754128,
        workflowName: "devx-ci",
        conclusion: "failure",
        url: "https://github.com/owner/repo/actions/runs/30296754128",
      }),
    ]);
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "failure",
      runId: 30296754128,
      workflowName: "devx-ci",
      url: "https://github.com/owner/repo/actions/runs/30296754128",
    });
    expect(result.runs).toHaveLength(2);
  });

  it("order-independent: the red run wins even when it is listed first", () => {
    const result = foldRunsAtSha([
      run({ runId: 2, workflowName: "devx-ci", conclusion: "failure" }),
      run({ runId: 1, workflowName: "CI & Deploy", conclusion: "success" }),
    ]);
    expect(result).toMatchObject({ conclusion: "failure", workflowName: "devx-ci" });
  });

  it("all-success folds to success, represented by the newest run", () => {
    const result = foldRunsAtSha([
      run({ runId: 2, workflowName: "devx-ci", conclusion: "success" }),
      run({ runId: 1, workflowName: "CI & Deploy", conclusion: "success" }),
    ]);
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "success",
      runId: 2,
    });
  });

  it("arci1 AC #4: a still-running sibling keeps the state in-progress (green sibling)", () => {
    const result = foldRunsAtSha([
      run({ runId: 2, workflowName: "CI & Deploy", conclusion: "success" }),
      run({ runId: 1, workflowName: "devx-ci", status: "in_progress", conclusion: null }),
    ]);
    expect(result).toMatchObject({
      state: "in-progress",
      runId: 1,
      status: "in_progress",
      workflowName: "devx-ci",
    });
  });

  it("arci1 AC #4: in-progress dominates even a already-failed sibling", () => {
    // Resolving to `failure` here would be defensible, but the AC is
    // explicit that a partial view never resolves — one extra 120s poll is
    // cheaper than a terminal state computed from half the workflows.
    const result = foldRunsAtSha([
      run({ runId: 2, workflowName: "devx-ci", conclusion: "failure" }),
      run({ runId: 1, workflowName: "CI & Deploy", status: "queued", conclusion: null }),
    ]);
    expect(result.state).toBe("in-progress");
  });

  it("a completed run with a null conclusion folds to non-success", () => {
    const result = foldRunsAtSha([
      run({ runId: 2, workflowName: "CI & Deploy", conclusion: "success" }),
      run({ runId: 1, workflowName: "devx-ci", conclusion: null }),
    ]);
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "",
      workflowName: "devx-ci",
    });
  });

  it("non-failure non-success conclusions (skipped/neutral) also block success", () => {
    for (const conclusion of ["skipped", "neutral", "action_required", "cancelled", "timed_out"]) {
      const result = foldRunsAtSha([
        run({ runId: 2, workflowName: "CI & Deploy", conclusion: "success" }),
        run({ runId: 1, workflowName: "devx-ci", conclusion }),
      ]);
      expect(result).toMatchObject({ conclusion, workflowName: "devx-ci" });
    }
  });

  it("single-run sets keep their pre-arci1 shape", () => {
    expect(
      foldRunsAtSha([run({ runId: 7, workflowName: "ci", conclusion: "success" })]),
    ).toMatchObject({ state: "completed", conclusion: "success", runId: 7 });
  });
});

// ---------------------------------------------------------------------------
// probeRemoteCi — sibling-workflow cases (arci1)
// ---------------------------------------------------------------------------

describe("probeRemoteCi — sibling workflows (arci1)", () => {
  const root = "/repo";
  const branch = "feat/dev-rsh101";
  const workflowFs = () =>
    fakeFs(root, {
      exists: new Set([".github/workflows"]),
      dirs: { ".github/workflows": ["ci.yml", "devx-ci.yml"] },
    });
  const ghKey = (limit = 30) =>
    `gh run list --branch ${branch} --limit ${limit} --json databaseId,status,conclusion,url,headSha,workflowName`;

  it("AC #3: one green + one red workflow at the same headSha reports the red one", async () => {
    // The exact commit-408aeaf shape from the spec: `CI & Deploy` passed,
    // `devx-ci` failed, and the newest-run-only probe reported success.
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey()]: okExit(
          makeRuns([
            {
              databaseId: 30296754787,
              workflowName: "CI & Deploy",
              conclusion: "success",
            },
            {
              databaseId: 30296754128,
              workflowName: "devx-ci",
              conclusion: "failure",
            },
          ]),
        ),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "failure",
      runId: 30296754128,
      workflowName: "devx-ci",
    });
  });

  it("AC #2: the probe JSON carries every workflow at the sha", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey()]: okExit(
          makeRuns([
            { databaseId: 2, workflowName: "CI & Deploy", conclusion: "success" },
            { databaseId: 1, workflowName: "devx-ci", conclusion: "failure" },
          ]),
        ),
      }),
      headSha: HEAD_SHA,
    });
    if (result.state !== "completed") throw new Error("expected completed");
    expect(result.runs.map((r) => [r.workflowName, r.conclusion])).toEqual([
      ["CI & Deploy", "success"],
      ["devx-ci", "failure"],
    ]);
  });

  it("AC #4: a completed sibling does not resolve while another is running", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey()]: okExit(
          makeRuns([
            { databaseId: 2, workflowName: "CI & Deploy", conclusion: "success" },
            {
              databaseId: 1,
              workflowName: "devx-ci",
              status: "in_progress",
              conclusion: null,
            },
          ]),
        ),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "in-progress",
      runId: 1,
      workflowName: "devx-ci",
    });
  });

  it("ignores runs from earlier commits on the same branch", async () => {
    const olderSha = "0".repeat(40);
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey()]: okExit(
          makeRuns([
            { databaseId: 4, workflowName: "CI & Deploy", conclusion: "success" },
            { databaseId: 3, workflowName: "devx-ci", conclusion: "success" },
            {
              databaseId: 2,
              workflowName: "devx-ci",
              conclusion: "failure",
              headSha: olderSha,
            },
          ]),
        ),
      }),
      headSha: HEAD_SHA,
    });
    if (result.state !== "completed") throw new Error("expected completed");
    // The older commit's red run must not poison this commit's verdict.
    expect(result.conclusion).toBe("success");
    expect(result.runs).toHaveLength(2);
  });

  it("returns sha-mismatch (citing the newest run) when no run matches", async () => {
    const otherSha = "1".repeat(40);
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey()]: okExit(
          makeRuns([
            { databaseId: 2, headSha: otherSha, conclusion: "success" },
            { databaseId: 1, headSha: "2".repeat(40), conclusion: "failure" },
          ]),
        ),
      }),
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({
      state: "sha-mismatch",
      runHeadSha: otherSha,
      headSha: HEAD_SHA,
    });
  });

  it("requests more than one run so siblings are visible at all", async () => {
    const recorded: ExecCall[] = [];
    await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec(
        { [ghKey()]: okExit(makeRuns([{ conclusion: "success" }])) },
        recorded,
      ),
      headSha: HEAD_SHA,
    });
    const gh = recorded.find((c) => c.cmd === "gh");
    const limit = Number(gh?.args[gh.args.indexOf("--limit") + 1]);
    expect(limit).toBeGreaterThan(1);
  });

  it("honours an explicit runLimit and rejects a non-positive one", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({ [ghKey(5)]: okExit(makeRuns([{ conclusion: "success" }])) }),
      headSha: HEAD_SHA,
      runLimit: 5,
    });
    expect(result.state).toBe("completed");
    for (const bad of [0, -1, 2.5]) {
      await expect(
        probeRemoteCi(branch, {
          repoRoot: root,
          fs: workflowFs(),
          headSha: HEAD_SHA,
          runLimit: bad,
        }),
      ).rejects.toThrow(/runLimit must be a positive integer/);
    }
  });
});

// ---------------------------------------------------------------------------
// awaitRemoteCi — multi-probe driver (3 terminal states from AC #1)
// ---------------------------------------------------------------------------

describe("awaitRemoteCi", () => {
  const root = "/repo";
  const branch = "feat/dev-dvx105";
  const ghKey = `gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`;
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

// ---------------------------------------------------------------------------
// awaitRemoteCi — sibling-workflow aggregation end-to-end (arci1)
// ---------------------------------------------------------------------------

describe("awaitRemoteCi — sibling workflows (arci1)", () => {
  const root = "/repo";
  const branch = "feat/dev-rsh101";
  const ghKey = `gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`;
  const noopSleep = async () => {};
  const workflowFs = () =>
    fakeFs(root, {
      exists: new Set([".github/workflows"]),
      dirs: { ".github/workflows": ["ci.yml", "devx-ci.yml"] },
    });

  const green = {
    databaseId: 30296754787,
    workflowName: "CI & Deploy",
    conclusion: "success",
  };
  const red = {
    databaseId: 30296754128,
    workflowName: "devx-ci",
    conclusion: "failure",
  };
  const running = {
    databaseId: 30296754128,
    workflowName: "devx-ci",
    status: "in_progress",
    conclusion: null,
  };

  it("keeps polling past a green sibling and terminates on the red one", async () => {
    // Probe 1: `CI & Deploy` green, `devx-ci` still running → keep waiting
    // (a newest-run-only probe would have terminated `success` here).
    // Probe 2: both terminal → report the failure by name.
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: [
          okExit(makeRuns([green, running])),
          okExit(makeRuns([green, red])),
        ],
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
      maxPolls: 5,
    });
    expect(result).toMatchObject({
      state: "completed",
      conclusion: "failure",
      runId: 30296754128,
      workflowName: "devx-ci",
    });
  });

  it("terminal AwaitState carries the full run list for the status-log line", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({ [ghKey]: okExit(makeRuns([green, red])) }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    if (result.state !== "completed") throw new Error("expected completed");
    expect(result.runs.map((r) => r.workflowName)).toEqual([
      "CI & Deploy",
      "devx-ci",
    ]);
  });

  it("all-green across both workflows still reports success", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: okExit(
          makeRuns([green, { ...red, conclusion: "success" }]),
        ),
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({ state: "completed", conclusion: "success" });
  });
});

// ---------------------------------------------------------------------------
// pr-conflicting (debug-c94f14)
//
// The repro this file exists to encode: PR #118 (2026-08-05) got ZERO
// workflow runs while the probe answered `{"state":"empty"}` on 41
// consecutive probes over ~50 minutes. `gh pr view 118 --json
// mergeable,mergeStateStatus` said CONFLICTING/DIRTY the whole time —
// GitHub can't build a merge ref for a conflicted PR, so `pull_request`
// workflows never start. Empty run list + conflicted PR must NOT read the
// same as empty run list + healthy PR.
// ---------------------------------------------------------------------------

describe("parsePrView", () => {
  it("parses the happy shape", () => {
    expect(
      parsePrView(
        JSON.stringify({
          number: 118,
          mergeable: "CONFLICTING",
          mergeStateStatus: "DIRTY",
        }),
      ),
    ).toEqual({
      prNumber: 118,
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
    });
  });

  it("tolerates a trailing newline", () => {
    expect(
      parsePrView('{"number":7,"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN"}\n'),
    ).toMatchObject({ prNumber: 7 });
  });

  it("returns null (never throws) on malformed input", () => {
    for (const bad of [
      "",
      "   ",
      "not json",
      "null",
      "[]",
      '"a string"',
      "42",
      JSON.stringify({ mergeable: "CONFLICTING" }), // no number
      JSON.stringify({ number: 0, mergeable: "CONFLICTING" }), // non-positive
      JSON.stringify({ number: 1.5, mergeable: "CONFLICTING" }), // non-integer
      JSON.stringify({ number: "118", mergeable: "CONFLICTING" }), // string number
      JSON.stringify({ number: 118 }), // neither field present
      JSON.stringify({ number: 118, mergeable: 3, mergeStateStatus: null }),
    ]) {
      expect(parsePrView(bad)).toBeNull();
    }
  });

  it("keeps a PR with only one of the two fields populated", () => {
    expect(parsePrView(JSON.stringify({ number: 9, mergeStateStatus: "DIRTY" })))
      .toEqual({ prNumber: 9, mergeable: "", mergeStateStatus: "DIRTY" });
  });
});

describe("isPrConflicting", () => {
  it("is true on CONFLICTING or DIRTY", () => {
    expect(
      isPrConflicting({
        prNumber: 1,
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
      }),
    ).toBe(true);
    expect(
      isPrConflicting({ prNumber: 1, mergeable: "CONFLICTING", mergeStateStatus: "" }),
    ).toBe(true);
    expect(
      isPrConflicting({ prNumber: 1, mergeable: "", mergeStateStatus: "DIRTY" }),
    ).toBe(true);
  });

  it("is false for every non-conflict state", () => {
    for (const [mergeable, mergeStateStatus] of [
      ["MERGEABLE", "CLEAN"],
      ["MERGEABLE", "BLOCKED"],
      ["MERGEABLE", "BEHIND"],
      ["MERGEABLE", "UNSTABLE"],
      ["UNKNOWN", "UNKNOWN"],
      ["", ""],
    ]) {
      expect(isPrConflicting({ prNumber: 1, mergeable, mergeStateStatus })).toBe(
        false,
      );
    }
  });
});

describe("probeRemoteCi — pr-conflicting (c94f14)", () => {
  const root = "/repo";
  const branch = "feat/dev-sgr105";
  const ghKey = `gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`;
  const prKey = `gh pr view ${branch} --json number,mergeable,mergeStateStatus`;
  const noopSleep = async () => {};

  const workflowFs = () =>
    fakeFs(root, {
      exists: new Set([".github/workflows"]),
      dirs: { ".github/workflows": ["devx-ci.yml"] },
    });

  const prView = (
    mergeable: string,
    mergeStateStatus: string,
    number = 118,
  ): ExecResult =>
    okExit(JSON.stringify({ number, mergeable, mergeStateStatus }));

  it("REPRO: empty run list + CONFLICTING PR → pr-conflicting, not empty", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: okExit("[]"),
        [prKey]: prView("CONFLICTING", "DIRTY"),
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "pr-conflicting",
      prNumber: 118,
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
    });
  });

  it("empty run list + healthy PR → still plain empty", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: okExit("[]"),
        [prKey]: prView("MERGEABLE", "CLEAN"),
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "empty" });
  });

  it("the mergeability read happens ONLY on the empty path", async () => {
    const calls: ExecCall[] = [];
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec(
        { [ghKey]: okExit(makeRun({ status: "completed", conclusion: "success" })) },
        calls,
      ),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({ state: "completed" });
    expect(calls.some((c) => c.args.includes("view"))).toBe(false);
  });

  it("UNKNOWN mergeability is re-polled a bounded number of times, then falls back to empty", async () => {
    const sleeps: number[] = [];
    const calls: ExecCall[] = [];
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec(
        {
          [ghKey]: okExit("[]"),
          [prKey]: [
            prView("UNKNOWN", "UNKNOWN"),
            prView("UNKNOWN", "UNKNOWN"),
            prView("UNKNOWN", "UNKNOWN"),
          ],
        },
        calls,
      ),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "empty" });
    expect(calls.filter((c) => c.args.includes("view")).length).toBe(3);
    expect(sleeps).toEqual([2_000, 2_000]);
  });

  it("UNKNOWN that resolves to CONFLICTING on the second read is caught", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: okExit("[]"),
        [prKey]: [prView("UNKNOWN", "UNKNOWN"), prView("CONFLICTING", "DIRTY", 42)],
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "pr-conflicting",
      prNumber: 42,
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
    });
  });

  it("a resolved (non-UNKNOWN) first read is not re-polled", async () => {
    const calls: ExecCall[] = [];
    await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec(
        { [ghKey]: okExit("[]"), [prKey]: prView("MERGEABLE", "CLEAN") },
        calls,
      ),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(calls.filter((c) => c.args.includes("view")).length).toBe(1);
  });

  it("no PR for the branch (gh exits non-zero) degrades to empty, not a probe failure", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: okExit("[]"),
        [prKey]: failExit("no pull requests found for branch"),
      }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "empty" });
  });

  it("an exec seam that throws on gh pr view degrades to empty", async () => {
    // fakeExec throws for unconfigured commands — i.e. every pre-c94f14
    // fixture in this file exercises this fallback and must keep passing.
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({ [ghKey]: okExit("[]") }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "empty" });
  });

  it("unparseable gh pr view output degrades to empty", async () => {
    const result = await probeRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({ [ghKey]: okExit("[]"), [prKey]: okExit("<html>502</html>") }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({ state: "empty" });
  });

  it("rejects an invalid mergeableAttempts / mergeableRetryMs", async () => {
    const base = {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({ [ghKey]: okExit("[]"), [prKey]: prView("MERGEABLE", "CLEAN") }),
      sleep: noopSleep,
      headSha: HEAD_SHA,
    };
    await expect(
      probeRemoteCi(branch, { ...base, mergeableAttempts: 0 }),
    ).rejects.toThrow(/mergeableAttempts must be a positive integer/);
    await expect(
      probeRemoteCi(branch, { ...base, mergeableRetryMs: -1 }),
    ).rejects.toThrow(/mergeableRetryMs must be a non-negative finite number/);
  });
});

describe("awaitRemoteCi — pr-conflicting (c94f14)", () => {
  const root = "/repo";
  const branch = "feat/dev-sgr105";
  const ghKey = `gh run list --branch ${branch} --limit 30 --json databaseId,status,conclusion,url,headSha,workflowName`;
  const prKey = `gh pr view ${branch} --json number,mergeable,mergeStateStatus`;

  const workflowFs = () =>
    fakeFs(root, {
      exists: new Set([".github/workflows"]),
      dirs: { ".github/workflows": ["devx-ci.yml"] },
    });

  const conflicting = okExit(
    JSON.stringify({ number: 118, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
  );

  it("returns pr-conflicting terminally WITHOUT burning the 60s empty retry", async () => {
    const sleeps: number[] = [];
    const calls: ExecCall[] = [];
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({ [ghKey]: okExit("[]"), [prKey]: conflicting }, calls),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      emptyRetryMs: 60_000,
      headSha: HEAD_SHA,
    });
    expect(result).toEqual({
      state: "pr-conflicting",
      prNumber: 118,
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
    });
    // No 60s empty-retry sleep, and exactly one run-list probe: waiting can't
    // make GitHub build a merge ref that doesn't exist.
    expect(sleeps).toEqual([]);
    expect(calls.filter((c) => c.args.includes("list")).length).toBe(1);
  });

  it("empty first, conflict discovered on the retry probe → pr-conflicting", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: [okExit("[]"), okExit("[]")],
        // First probe: gh hasn't computed mergeability yet and stays UNKNOWN
        // through the bounded re-poll. Second probe: CONFLICTING.
        [prKey]: [
          okExit(JSON.stringify({ number: 118, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })),
          okExit(JSON.stringify({ number: 118, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })),
          okExit(JSON.stringify({ number: 118, mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" })),
          conflicting,
        ],
      }),
      sleep: async () => {},
      emptyRetryMs: 60_000,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({ state: "pr-conflicting", prNumber: 118 });
  });

  it("mid-poll: in-progress run vanishes and the PR turns out conflicted", async () => {
    const result = await awaitRemoteCi(branch, {
      repoRoot: root,
      fs: workflowFs(),
      exec: fakeExec({
        [ghKey]: [okExit(makeRun({ status: "in_progress" })), okExit("[]")],
        [prKey]: conflicting,
      }),
      sleep: async () => {},
      pollMs: 120_000,
      maxPolls: 3,
      headSha: HEAD_SHA,
    });
    expect(result).toMatchObject({ state: "pr-conflicting", prNumber: 118 });
  });
});
