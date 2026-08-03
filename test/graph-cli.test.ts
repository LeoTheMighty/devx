// `devx graph` CLI unit tests (sgr103 / plan Phase 3, T3.7 — CLI half).
//
// These run against REAL temp git repos rather than the in-memory GraphFs the
// model tests use, because the three things this layer owns are all things a
// seam would fake away:
//   - root resolution through git's common dir (the linked-worktree case);
//   - the atomic write actually landing a file at the canonical root;
//   - the `--check` byte-compare against what is on disk.
//
// The named AC-6 cases are each a `it(...)` below: the json contract, exit 2
// outside a repo, scoping, and the worktree-cwd write.
//
// Spec: dev/dev-sgr103-2026-08-02T13:57-graph-render-cli.md

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { GRAPH_FILENAME, runGraph } from "../src/commands/graph.js";
import type { GraphModel } from "../src/lib/graph/model.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const TS = "2026-08-01T08:00";

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

const madeDirs: string[] = [];

afterEach(() => {
  while (madeDirs.length > 0) {
    const d = madeDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

interface Spec {
  type?: "dev" | "debug" | "plan";
  hash: string;
  slug: string;
  title: string;
  status: string;
  fm?: string[];
}

function specRel(s: Spec): string {
  const type = s.type ?? "dev";
  return `${type}/${type}-${s.hash}-${TS}-${s.slug}.md`;
}

function row(state: " " | "/" | "-" | "x", s: Spec, extra = ""): string {
  return `- [${state}] \`${specRel(s)}\` — ${s.title}.${extra ? ` ${extra}` : ""} Status: ${s.status}.`;
}

interface Repo {
  root: string;
  write(rel: string, content: string): void;
  read(rel: string): string;
  exists(rel: string): boolean;
  graphPath: string;
}

/** A temp git repo with devx.config.yaml, the four backlogs, and specs. */
function makeRepo(specs: Spec[], devMd: string[], extra: Record<string, string> = {}): Repo {
  const raw = mkdtempSync(join(tmpdir(), "graph-cli-"));
  madeDirs.push(raw);
  // macOS hands out /var/… symlinks for tmpdir; resolveRepoRoot realpaths, so
  // every expectation here must compare against the realpathed root too.
  const root = realpathSync(raw);
  git(root, "init", "-b", "main");
  copyFileSync(join(repoRoot, "devx.config.yaml"), join(root, "devx.config.yaml"));
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n.worktrees/\n");

  const repo: Repo = {
    root,
    graphPath: join(root, GRAPH_FILENAME),
    write(rel, content) {
      const abs = join(root, ...rel.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    read: (rel) => readFileSync(join(root, ...rel.split("/")), "utf8"),
    exists: (rel) => existsSync(join(root, ...rel.split("/"))),
  };

  for (const f of ["DEV.md", "PLAN.md", "TEST.md", "DEBUG.md"]) {
    repo.write(f, `# ${f.replace(".md", "")}\n`);
  }
  for (const s of specs) {
    repo.write(
      specRel(s),
      [
        "---",
        `hash: ${s.hash}`,
        `type: ${s.type ?? "dev"}`,
        `created: ${TS}:00-06:00`,
        `title: "${s.title}"`,
        `status: ${s.status}`,
        ...(s.fm ?? []),
        "---",
        "",
        "## Goal",
        "",
        `Fixture goal for ${s.hash}.`,
        "",
        "## Status log",
        "",
        `- ${TS} — filed (fixture).`,
        "",
      ].join("\n"),
    );
  }
  repo.write("DEV.md", ["# DEV", "", ...devMd, ""].join("\n"));
  for (const [rel, content] of Object.entries(extra)) repo.write(rel, content);

  git(root, "add", "-A");
  git(root, "commit", "-m", "fixture", "--no-gpg-sign");
  return repo;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cwd: string, opts: Parameters<typeof runGraph>[0] = {}): Run {
  let stdout = "";
  let stderr = "";
  const code = runGraph({
    cwd,
    out: (s) => {
      stdout += s;
    },
    err: (s) => {
      stderr += s;
    },
    ...opts,
  });
  return { code, stdout, stderr };
}

/** Two specs in one workstream + one standalone, with a blocking edge. */
const SPECS: Spec[] = [
  { hash: "aaa111", slug: "alpha-one", title: "Alpha one", status: "ready", fm: ["plan: _devx/workstreams/ws-alpha"] },
  { hash: "aaa222", slug: "alpha-two", title: "Alpha two", status: "blocked", fm: ["plan: _devx/workstreams/ws-alpha", "blocked_by: [aaa111]"] },
  { hash: "sss111", slug: "solo-one", title: "Solo one", status: "ready" },
];

function makeStdRepo(): Repo {
  return makeRepo(
    SPECS,
    [
      row(" ", SPECS[0]),
      row("-", SPECS[1], "Blocked-by: aaa111."),
      row(" ", SPECS[2]),
    ],
    { "_devx/workstreams/ws-alpha/plan.md": "# Plan — ws-alpha\n" },
  );
}

describe("devx graph — default write", () => {
  it("writes GRAPH.md at the repo root and exits 0", () => {
    const repo = makeStdRepo();
    const r = run(repo.root);
    expect(r.code).toBe(0);
    expect(repo.exists(GRAPH_FILENAME)).toBe(true);
    expect(repo.read(GRAPH_FILENAME)).toContain("```mermaid");
    expect(r.stderr).toContain(`wrote ${GRAPH_FILENAME}`);
    // Summary goes to stderr; stdout stays empty so the command composes.
    expect(r.stdout).toBe("");
  });

  it("is byte-identical on a second run over unchanged state", () => {
    const repo = makeStdRepo();
    run(repo.root);
    const first = repo.read(GRAPH_FILENAME);
    run(repo.root);
    expect(repo.read(GRAPH_FILENAME)).toBe(first);
  });
});

describe("devx graph --stdout", () => {
  it("prints the document and writes nothing", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { stdout: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("```mermaid");
    expect(r.stdout).toContain("aaa111");
    expect(repo.exists(GRAPH_FILENAME)).toBe(false);
  });
});

describe("devx graph --format json", () => {
  it("emits pure JSON on stdout matching the pinned GraphModel interface", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { format: "json" });
    expect(r.code).toBe(0);

    // "Pure JSON" is the contract `devx graph --format json | jq` depends on:
    // parsing the WHOLE stdout must succeed, not just a substring of it.
    const model = JSON.parse(r.stdout) as GraphModel;
    for (const key of ["nodes", "edges", "groups", "warnings"]) {
      expect(Array.isArray((model as unknown as Record<string, unknown>)[key])).toBe(true);
    }
    const node = model.nodes.find((n) => n.hash === "aaa111")!;
    expect(Object.keys(node).sort()).toEqual(
      ["badges", "group", "hash", "status", "title", "type"].sort(),
    );
    const edge = model.edges.find((e) => e.from === "aaa222")!;
    expect(Object.keys(edge).sort()).toEqual(["from", "kind", "sources", "to"].sort());
    expect(edge.to).toBe("aaa111");
    expect(edge.kind).toBe("blocks");
    const group = model.groups.find((g) => g.id === "ws-alpha")!;
    expect(Object.keys(group).sort()).toEqual(
      ["collapsed", "id", "kind", "stats", "title"].sort(),
    );
    expect(Object.keys(group.stats).sort()).toEqual(
      ["done", "lastMerged", "total"].sort(),
    );
  });

  it("keeps warnings on stderr only, so stdout still parses", () => {
    const repo = makeRepo(
      [{ hash: "war111", slug: "warn-one", title: "Warn one", status: "ready" }],
      [
        row(
          " ",
          { hash: "war111", slug: "warn-one", title: "Warn one", status: "ready" },
          "Blocked-by: nosuch1.",
        ),
      ],
    );
    const r = run(repo.root, { format: "json" });
    expect(r.code).toBe(0);
    const model = JSON.parse(r.stdout) as GraphModel;
    expect(model.warnings.length).toBeGreaterThan(0);
    expect(r.stderr).toContain("unknown-blocker");
    expect(r.stdout).not.toContain("unknown-blocker:");
  });

  it("writes no GRAPH.md — json is a read", () => {
    const repo = makeStdRepo();
    run(repo.root, { format: "json" });
    expect(repo.exists(GRAPH_FILENAME)).toBe(false);
  });

  it("rejects an unknown --format value", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { format: "yaml" as "json" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--format");
  });
});

describe("devx graph --check", () => {
  it("exits 0 on a freshly rendered file", () => {
    const repo = makeStdRepo();
    run(repo.root);
    const r = run(repo.root, { check: true });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("up to date");
  });

  it("exits 1 naming GRAPH.md and the regen command on drift", () => {
    const repo = makeStdRepo();
    run(repo.root);
    repo.write(GRAPH_FILENAME, "stale\n");
    const r = run(repo.root, { check: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(GRAPH_FILENAME);
    expect(r.stderr).toContain("devx graph");
    // A check must never repair what it reports.
    expect(repo.read(GRAPH_FILENAME)).toBe("stale\n");
  });

  it("exits 1 when GRAPH.md has never been generated", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { check: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("missing");
    expect(repo.exists(GRAPH_FILENAME)).toBe(false);
  });

  it("refuses to combine --check with a scope flag", () => {
    // A scoped check compares a partial render against the full-board file:
    // it can only ever report drift that isn't there.
    const repo = makeStdRepo();
    run(repo.root);
    const r = run(repo.root, { check: true, workstream: ["ws-alpha"] });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("--check");
  });
});

describe("devx graph — scoping", () => {
  it("prints only the scope's nodes", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { stdout: true, workstream: ["ws-alpha"] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("aaa111");
    expect(r.stdout).toContain("aaa222");
    expect(r.stdout).not.toContain("sss111");
  });

  it("drops an edge whose other endpoint is out of scope", () => {
    // A half-dangling edge is worse than none: Mermaid MINTS a bare node for
    // an id it has not seen, which is the phantom class this workstream kills.
    const repo = makeRepo(
      [
        { hash: "aaa111", slug: "alpha-one", title: "Alpha one", status: "ready", fm: ["plan: _devx/workstreams/ws-alpha"] },
        { hash: "bbb111", slug: "beta-one", title: "Beta one", status: "blocked", fm: ["plan: _devx/workstreams/ws-beta", "blocked_by: [aaa111]"] },
      ],
      [
        row(" ", { hash: "aaa111", slug: "alpha-one", title: "Alpha one", status: "ready" }),
        row("-", { hash: "bbb111", slug: "beta-one", title: "Beta one", status: "blocked" }, "Blocked-by: aaa111."),
      ],
      {
        "_devx/workstreams/ws-alpha/plan.md": "# a\n",
        "_devx/workstreams/ws-beta/plan.md": "# b\n",
      },
    );
    const r = run(repo.root, { format: "json", workstream: ["ws-beta"] });
    const model = JSON.parse(r.stdout) as GraphModel;
    expect(model.nodes.map((n) => n.hash)).toEqual(["bbb111"]);
    expect(model.edges).toEqual([]);
  });

  it("still writes the FULL board when a scope flag is passed", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { workstream: ["ws-alpha"] });
    expect(r.code).toBe(0);
    const doc = repo.read(GRAPH_FILENAME);
    expect(doc).toContain("aaa111");
    expect(doc).toContain("sss111");
    expect(r.stderr).toContain("full board");
  });

  it("unions repeated and cross-dimension scope flags", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, {
      stdout: true,
      workstream: ["ws-alpha"],
      epic: ["standalone"],
    });
    expect(r.stdout).toContain("aaa111");
    expect(r.stdout).toContain("sss111");
  });

  it("exits 1 naming the known groups when a scope matches nothing", () => {
    const repo = makeStdRepo();
    const r = run(repo.root, { stdout: true, workstream: ["nope"] });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("matches no group");
    expect(r.stderr).toContain("ws-alpha");
  });
});

describe("devx graph — cycles", () => {
  it("exits 1 enumerating every participant and writes nothing", () => {
    const a = { hash: "cyc111", slug: "cycle-one", title: "Cycle one", status: "ready", fm: ["blocked_by: [cyc222]"] };
    const b = { hash: "cyc222", slug: "cycle-two", title: "Cycle two", status: "ready", fm: ["blocked_by: [cyc111]"] };
    const repo = makeRepo([a, b], [row(" ", a), row(" ", b)]);
    const r = run(repo.root);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cyc111");
    expect(r.stderr).toContain("cyc222");
    expect(repo.exists(GRAPH_FILENAME)).toBe(false);
  });

  it("does not clobber an existing GRAPH.md when a cycle appears", () => {
    const a = { hash: "cyc111", slug: "cycle-one", title: "Cycle one", status: "ready", fm: ["blocked_by: [cyc222]"] };
    const b = { hash: "cyc222", slug: "cycle-two", title: "Cycle two", status: "ready", fm: ["blocked_by: [cyc111]"] };
    const repo = makeRepo([a, b], [row(" ", a), row(" ", b)]);
    repo.write(GRAPH_FILENAME, "prior board\n");
    expect(run(repo.root).code).toBe(1);
    expect(repo.read(GRAPH_FILENAME)).toBe("prior board\n");
  });
});

describe("devx graph — root resolution", () => {
  it("exits 2 when run outside any devx repo", () => {
    const outside = mkdtempSync(join(tmpdir(), "graph-nowhere-"));
    madeDirs.push(outside);
    const r = run(outside);
    // The temp dir is not a git repo AND has no devx.config.yaml above it —
    // in some environments tmpdir sits under a git checkout, so accept either
    // failure phrasing, but never a success and never a write.
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/devx\.config\.yaml|not a git repository/);
    expect(existsSync(join(outside, GRAPH_FILENAME))).toBe(false);
  });

  it("writes the MAIN checkout's GRAPH.md when run from a linked worktree", () => {
    const repo = makeStdRepo();
    const wt = join(repo.root, ".worktrees", "dev-aaa111");
    git(repo.root, "worktree", "add", "-q", "-b", "feat/dev-aaa111", wt, "main");

    const r = run(wt);
    expect(r.code).toBe(0);
    // The load-bearing assertion: the file lands in the main checkout, and
    // the worktree copy is NOT created. A config-walk from the worktree cwd
    // would find the worktree's own devx.config.yaml and fork a copy nobody
    // ever commits.
    expect(existsSync(repo.graphPath)).toBe(true);
    expect(existsSync(join(wt, GRAPH_FILENAME))).toBe(false);
  });

  it("renders the same board from a main-checkout subdirectory", () => {
    const repo = makeStdRepo();
    run(repo.root);
    const fromRoot = repo.read(GRAPH_FILENAME);
    rmSync(repo.graphPath);
    const r = run(join(repo.root, "dev"));
    expect(r.code).toBe(0);
    expect(repo.read(GRAPH_FILENAME)).toBe(fromRoot);
  });
});
