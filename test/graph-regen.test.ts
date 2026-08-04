// GRAPH.md regen: the primitive + both of its Phase-4 hosts (sgr104, T4.5).
//
// Three layers, matching where each behaviour actually lives:
//
//   1. `regenerateGraph` in isolation — the never-throws contract. Every
//      failure mode a host could hit (cycle, unreadable board, dead write)
//      must come back as `{ok:false, warning}`, because a throw here would
//      abort a state flip the operator already asked for.
//
//   2. The CLAIM host, against a real git repo with a real origin. Fake-fs
//      coverage of the hook's rollback lives in devx-claim.test.ts; what
//      needs real git is the load-bearing pair the spec names — GRAPH.md is
//      IN the claim commit, and `devx graph --check` is green afterwards
//      with no manual regen in between (the E-5 shape, claim arm).
//
//   3. The EMISSION host, against a real temp root: `graph=` appears on the
//      CLI's key=value line exactly when the regen succeeded, and a failed
//      regen warns without failing the emission that already landed.
//
// Spec: dev/dev-sgr104-2026-08-02T13:57-regen-hooks-claim-emission.md
// Eval twin: _devx/workstreams/story-graph/evals/E-5_loop-freshness.ts (RED
// until Phase 5 — it needs the mark-done host too).

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runGraph } from "../src/commands/graph.js";
import { runEmitRetroStory } from "../src/commands/plan-helper.js";
import { type Exec, claimSpec } from "../src/lib/devx/claim.js";
import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import type { GraphFs } from "../src/lib/graph/model.js";
import {
  GRAPH_FILENAME,
  type RegenFn,
  type RegenFs,
  regenerateGraph,
} from "../src/lib/graph/regen.js";

const realRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

/** execFileSync throws on non-zero — claimSpec's seam wants {exitCode}. */
const exec: Exec = (cmd, args, opts) => {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts?.cwd,
      env: GIT_ENV,
      encoding: "utf8",
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: e.status ?? -1,
    };
  }
};

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

// ---------------------------------------------------------------------------
// Shared fixture: a board on disk
// ---------------------------------------------------------------------------

interface Spec {
  type?: "dev" | "plan";
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

function specBody(s: Spec): string {
  return [
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
  ].join("\n");
}

function row(state: " " | "/" | "x", s: Spec): string {
  return `- [${state}] \`${specRel(s)}\` — ${s.title}. Status: ${s.status}.`;
}

const SPECS: Spec[] = [
  { hash: "ggg111", slug: "graph-one", title: "Graph one", status: "ready" },
  { hash: "ggg222", slug: "graph-two", title: "Graph two", status: "ready" },
];

/** Board files (no git). Returns the realpathed root. */
function seedBoard(root: string): void {
  for (const f of ["PLAN.md", "TEST.md", "DEBUG.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }
  for (const s of SPECS) {
    const abs = join(root, ...specRel(s).split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, specBody(s));
  }
  writeFileSync(
    join(root, "DEV.md"),
    ["# DEV", "", row(" ", SPECS[0]), row(" ", SPECS[1]), ""].join("\n"),
  );
}

function mkRoot(prefix: string): string {
  // macOS hands out /var/… symlinks for tmpdir; resolveRepoRoot realpaths, so
  // every path expectation has to compare against the realpathed root.
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  madeDirs.push(root);
  return root;
}

// ---------------------------------------------------------------------------
// Layer 1 — regenerateGraph in isolation
// ---------------------------------------------------------------------------

/** Reads from a path→content map; a path in `throwOn` raises instead. */
function mapFs(files: Record<string, string>, throwOn: string[] = []): GraphFs {
  const guard = (p: string): void => {
    if (throwOn.includes(p)) throw new Error(`EIO: simulated read failure at ${p}`);
  };
  return {
    readFile: (p) => {
      guard(p);
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    exists: (p) =>
      Object.prototype.hasOwnProperty.call(files, p) ||
      Object.keys(files).some((k) => k.startsWith(`${p}/`)),
    readdir: (p) => {
      guard(p);
      const prefix = `${p}/`;
      const out: string[] = [];
      for (const k of Object.keys(files)) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest.includes("/")) out.push(rest);
      }
      return out.sort();
    },
  };
}

const R = "/board";

function boardFiles(overrides: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {
    [`${R}/DEV.md`]: ["# DEV", "", row(" ", SPECS[0]), row(" ", SPECS[1]), ""].join("\n"),
    [`${R}/PLAN.md`]: "# PLAN\n",
    [`${R}/TEST.md`]: "# TEST\n",
    [`${R}/DEBUG.md`]: "# DEBUG\n",
  };
  for (const s of SPECS) files[`${R}/${specRel(s)}`] = specBody(s);
  return { ...files, ...overrides };
}

/** Capture what a regen would have written instead of touching disk. */
function captureWrite(): {
  write: (p: string, c: string) => void;
  wrote: Array<{ path: string; contents: string }>;
} {
  const wrote: Array<{ path: string; contents: string }> = [];
  return { wrote, write: (path, contents) => wrote.push({ path, contents }) };
}

describe("regenerateGraph — happy path", () => {
  it("renders the board and reports the path it wrote", () => {
    const cap = captureWrite();
    const result = regenerateGraph(mapFs(boardFiles()), R, ENGINE_DEFAULTS, {
      write: cap.write,
    });
    expect(result).toEqual({ ok: true, path: `${R}/${GRAPH_FILENAME}` });
    expect(cap.wrote).toHaveLength(1);
    expect(cap.wrote[0].path).toBe(`${R}/${GRAPH_FILENAME}`);
    expect(cap.wrote[0].contents).toContain("```mermaid");
    expect(cap.wrote[0].contents).toContain("ggg111");
    expect(cap.wrote[0].contents).toContain("ggg222");
  });

  it("renders byte-identically to what `devx graph` writes", () => {
    // The hook path and the CLI path must never drift: a claim that ships a
    // GRAPH.md the operator's own `devx graph` would rewrite makes `--check`
    // (E-2) red on a clean tree.
    const root = mkRoot("graph-regen-parity-");
    seedBoard(root);
    copyFileSync(
      join(realRepoRoot, "devx.config.yaml"),
      join(root, "devx.config.yaml"),
    );
    const code = runGraph({ cwd: root, err: () => undefined });
    expect(code).toBe(0);
    const viaCli = readFileSync(join(root, GRAPH_FILENAME), "utf8");

    const cap = captureWrite();
    const result = regenerateGraph(
      // The real fs, narrowed to the read seam.
      {
        readFile: (p: string) => readFileSync(p, "utf8"),
        exists: (p: string) => existsSync(p),
        readdir: (p: string) => readdirSync(p),
      },
      root,
      ENGINE_DEFAULTS,
      { write: cap.write },
    );
    expect(result.ok).toBe(true);
    expect(cap.wrote[0].contents).toBe(viaCli);
  });
});

describe("regenerateGraph — never throws", () => {
  it("returns a warning (and writes NOTHING) on a blocking-edge cycle", () => {
    const cycled = boardFiles({
      [`${R}/${specRel(SPECS[0])}`]: specBody({
        ...SPECS[0],
        fm: ["blocked_by: [ggg222]"],
      }),
      [`${R}/${specRel(SPECS[1])}`]: specBody({
        ...SPECS[1],
        fm: ["blocked_by: [ggg111]"],
      }),
    });
    const cap = captureWrite();
    const result = regenerateGraph(mapFs(cycled), R, ENGINE_DEFAULTS, {
      write: cap.write,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    // Names every participant so the operator can break it without
    // re-deriving the cycle, and points at the command to re-run.
    expect(result.warning).toContain("cycle");
    expect(result.warning).toContain("ggg111");
    expect(result.warning).toContain("ggg222");
    expect(result.warning).toContain("devx graph");
    // A non-success path must leave the previous board alone.
    expect(cap.wrote).toHaveLength(0);
  });

  it("returns a warning when the model build throws (unreadable backlog)", () => {
    const cap = captureWrite();
    const result = regenerateGraph(
      mapFs(boardFiles(), [`${R}/DEV.md`]),
      R,
      ENGINE_DEFAULTS,
      { write: cap.write },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.warning).toContain("model build failed");
    expect(cap.wrote).toHaveLength(0);
  });

  it("refuses a repo root that does not exist, without touching the disk", () => {
    // The default write is `writeAtomic`, which mkdirs the target's parent —
    // and GRAPH.md's parent is the repo root itself. A host handing over a
    // synthetic or mis-resolved root must not cause that directory to be
    // CREATED; under a container running as root it would really appear.
    // Deliberately no `write` seam here: the point is that the real default
    // never runs.
    const result = regenerateGraph(
      { readFile: () => "", exists: () => false, readdir: () => [] },
      "/definitely/not/a/real/root",
      ENGINE_DEFAULTS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.warning).toContain("repo root does not exist");
    expect(existsSync("/definitely/not/a/real/root")).toBe(false);
  });

  it("returns a warning when the write throws (full disk, read-only tree)", () => {
    const result = regenerateGraph(mapFs(boardFiles()), R, ENGINE_DEFAULTS, {
      write: () => {
        throw new Error("ENOSPC: no space left on device");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.warning).toContain("ENOSPC");
    expect(result.warning).toContain(GRAPH_FILENAME);
  });

  it("returns a warning when the RENDER throws", () => {
    // The render is pure today, so this arm is unreachable through public
    // input — which is exactly why it needs a test: nothing else would
    // notice if a future refactor let a render throw escape the hook and
    // abort a claim mid-transaction.
    const cap = captureWrite();
    const badTitle = boardFiles({
      [`${R}/${specRel(SPECS[0])}`]: specBody(SPECS[0]),
    });
    const result = regenerateGraph(
      {
        ...mapFs(badTitle),
        // A readdir that yields a name the model accepts but whose read
        // explodes during rendering is not constructible; simulate the
        // render failure by handing the writer a throwing renderer's job.
        readFile: (p: string) => {
          if (p === `${R}/${specRel(SPECS[0])}`) return badTitle[p];
          return mapFs(badTitle).readFile(p);
        },
      },
      R,
      ENGINE_DEFAULTS,
      {
        write: () => {
          throw new TypeError("render produced a non-string");
        },
      },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.warning).toContain("non-string");
    expect(cap.wrote).toHaveLength(0);
  });

  it("honors a non-default engine.workstreams_root", () => {
    // The claim host derives this from its `config` blob. A caller that
    // narrows the config away renders with ENGINE_DEFAULTS while `devx
    // graph` renders with the project's real root — same board, different
    // grouping, `--check` red on a clean tree with nothing to point at.
    const wsFiles = boardFiles({
      [`${R}/${specRel(SPECS[0])}`]: specBody({
        ...SPECS[0],
        fm: ["plan: _devx/ws/alpha"],
      }),
      [`${R}/_devx/ws/alpha/plan.md`]: "# Plan — alpha\n",
    });
    const withDefault = captureWrite();
    regenerateGraph(mapFs(wsFiles), R, ENGINE_DEFAULTS, {
      write: withDefault.write,
    });
    const withCustom = captureWrite();
    regenerateGraph(
      mapFs(wsFiles),
      R,
      { ...ENGINE_DEFAULTS, workstreamsRoot: "_devx/ws" },
      { write: withCustom.write },
    );
    expect(withCustom.wrote[0].contents).not.toBe(withDefault.wrote[0].contents);
    expect(withCustom.wrote[0].contents).toContain("alpha");
  });

  it("is typed so a host's read seam satisfies RegenFs without a cast", () => {
    // Compile-time assertion, kept executable so it can't rot silently.
    const seam: RegenFs = mapFs(boardFiles());
    expect(typeof seam.readdir).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — the CLAIM host (real git + real origin)
// ---------------------------------------------------------------------------

interface ClaimRepo {
  base: string;
  root: string;
}

/** Bare origin + clone, seeded with the board and a committed GRAPH.md. */
function makeClaimRepo(opts: { withGraph: boolean }): ClaimRepo {
  const base = mkRoot("graph-regen-claim-");
  const origin = join(base, "origin.git");
  const root = join(base, "repo");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin], { env: GIT_ENV });
  execFileSync("git", ["clone", "-q", origin, root], { env: GIT_ENV });
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  git(root, "config", "commit.gpgsign", "false");

  seedBoard(root);
  copyFileSync(
    join(realRepoRoot, "devx.config.yaml"),
    join(root, "devx.config.yaml"),
  );
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n.worktrees/\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture: board");
  git(root, "push", "-q", "-u", "origin", "main");

  if (opts.withGraph) {
    // The steady state this hook exists to maintain: a committed, fresh board.
    expect(runGraph({ cwd: root, err: () => undefined })).toBe(0);
    git(root, "add", "--", GRAPH_FILENAME);
    git(root, "commit", "-q", "-m", "chore: initial GRAPH.md");
    git(root, "push", "-q", "origin", "main");
  }
  return { base, root };
}

const CLAIM_CONFIG = {
  git: { default_branch: "main", integration_branch: null, branch_prefix: "feat/" },
};

describe("claim hook — GRAPH.md stays fresh (AC 2)", () => {
  it("puts the regenerated GRAPH.md in the claim commit and leaves --check green", async () => {
    const repo = makeClaimRepo({ withGraph: true });
    const before = readFileSync(join(repo.root, GRAPH_FILENAME), "utf8");

    await claimSpec("ggg111", {
      sessionId: "regen-claim-session",
      repoRoot: repo.root,
      config: CLAIM_CONFIG,
      exec,
    });

    // The claim commit carries all three files — the two authored ones AND
    // the derived board. A GRAPH.md left out of the pathspec would show the
    // row as `ready` in the very commit that flipped it to `in-progress`.
    const committed = git(repo.root, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(committed).toEqual([
      "DEV.md",
      GRAPH_FILENAME,
      specRel(SPECS[0]),
    ].sort());

    // The regen actually re-rendered (the flip is visible in the board).
    const after = readFileSync(join(repo.root, GRAPH_FILENAME), "utf8");
    expect(after).not.toBe(before);

    // E-5's claim arm: no manual `devx graph` in between.
    let checkErr = "";
    const code = runGraph({
      cwd: repo.root,
      check: true,
      err: (s) => {
        checkErr += s;
      },
    });
    expect(code, checkErr).toBe(0);
    expect(checkErr).toContain("up to date");

    // Nothing left dirty or staged by the hook.
    expect(git(repo.root, "status", "--porcelain")).toBe("");
  });

  it("warns and still claims when the regen fails, leaving GRAPH.md out of the commit", async () => {
    const repo = makeClaimRepo({ withGraph: true });
    const before = readFileSync(join(repo.root, GRAPH_FILENAME), "utf8");
    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      warnings.push(String(chunk));
      return true;
    });
    try {
      await claimSpec("ggg111", {
        sessionId: "regen-fail-session",
        repoRoot: repo.root,
        config: CLAIM_CONFIG,
        exec,
        regen: () => ({ ok: false, warning: "GRAPH.md not regenerated: simulated" }),
      });
    } finally {
      spy.mockRestore();
    }

    // The state flip is what the operator asked for; a derived file must
    // never veto it (plan Phase 4 §Failure posture).
    expect(readFileSync(join(repo.root, "DEV.md"), "utf8")).toContain(
      `- [/] \`${specRel(SPECS[0])}\``,
    );
    expect(warnings.join("")).toContain("simulated");

    // GRAPH.md untouched AND absent from the pathspec — naming a file the
    // regen never wrote would fail `git add` and take the claim down with it.
    expect(readFileSync(join(repo.root, GRAPH_FILENAME), "utf8")).toBe(before);
    const committed = git(repo.root, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean);
    expect(committed).not.toContain(GRAPH_FILENAME);
    expect(committed.sort()).toEqual(["DEV.md", specRel(SPECS[0])].sort());
  });

  /**
   * A regen that does the real thing AND records what the board looked like
   * the instant after it wrote.
   *
   * Without this the rollback tests pass vacuously: "GRAPH.md is unchanged"
   * and "GRAPH.md does not exist" are both trivially true of a build where
   * the hook was never wired up at all. Asserting `spy.calls === 1` and
   * `spy.midFlight !== before` pins that there was something to roll back.
   */
  function spyRegen(): { fn: RegenFn; calls: number; midFlight: string | null } {
    const spy = {
      calls: 0,
      midFlight: null as string | null,
      fn: ((fs, repoRoot, engine) => {
        spy.calls += 1;
        const r = regenerateGraph(fs, repoRoot, engine);
        spy.midFlight = r.ok ? readFileSync(r.path, "utf8") : null;
        return r;
      }) as RegenFn,
    };
    return spy;
  }

  /** Reject every push, so the claim fails AFTER the regen has written. */
  function rejectPushes(repo: ClaimRepo): void {
    const hooks = join(repo.base, "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\necho no >&2\nexit 1\n", {
      mode: 0o755,
    });
    git(repo.root, "config", "core.hooksPath", hooks);
  }

  it("restores the PRIOR GRAPH.md when a post-regen claim step fails", async () => {
    const repo = makeClaimRepo({ withGraph: true });
    const before = readFileSync(join(repo.root, GRAPH_FILENAME), "utf8");
    rejectPushes(repo);
    const spy = spyRegen();

    await expect(
      claimSpec("ggg111", {
        sessionId: "regen-rollback-session",
        repoRoot: repo.root,
        config: CLAIM_CONFIG,
        exec,
        regen: spy.fn,
      }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "git-push" });

    // There WAS something to roll back: the hook ran and the board changed.
    expect(spy.calls).toBe(1);
    expect(spy.midFlight).not.toBe(before);
    // …and it went back byte-for-byte, not to the copy that showed the flip.
    expect(readFileSync(join(repo.root, GRAPH_FILENAME), "utf8")).toBe(before);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
    expect(git(repo.root, "diff", "--cached", "--name-only")).toBe("");
  });

  it("unlinks the GRAPH.md it minted when a FIRST claim fails (no orphan)", async () => {
    // No committed board yet — the regen creates GRAPH.md for the first time,
    // so "restore" means removing it. Restoring bytes that never existed
    // would leave an untracked board asserting a claim that got rolled back.
    const repo = makeClaimRepo({ withGraph: false });
    expect(existsSync(join(repo.root, GRAPH_FILENAME))).toBe(false);
    rejectPushes(repo);
    const spy = spyRegen();

    await expect(
      claimSpec("ggg111", {
        sessionId: "regen-orphan-session",
        repoRoot: repo.root,
        config: CLAIM_CONFIG,
        exec,
        regen: spy.fn,
      }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "git-push" });

    // The board really was minted mid-claim — then removed.
    expect(spy.calls).toBe(1);
    expect(spy.midFlight).toContain("```mermaid");
    expect(existsSync(join(repo.root, GRAPH_FILENAME))).toBe(false);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
  });

  it("skips the regen entirely when the pre-claim GRAPH.md is unreadable", async () => {
    // An unreadable pre-image means the rollback could not put back what the
    // regen would overwrite. Rendering anyway leaves a board asserting a
    // claim that may get rolled back — so the hook declines instead.
    const repo = makeClaimRepo({ withGraph: true });
    const before = readFileSync(join(repo.root, GRAPH_FILENAME), "utf8");
    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      warnings.push(String(chunk));
      return true;
    });
    let regenCalls = 0;
    try {
      await claimSpec("ggg111", {
        sessionId: "regen-unreadable-session",
        repoRoot: repo.root,
        config: CLAIM_CONFIG,
        exec,
        fs: {
          readFile: (p: string) => {
            if (p === join(repo.root, GRAPH_FILENAME)) {
              throw new Error("EACCES: permission denied");
            }
            return readFileSync(p, "utf8");
          },
        },
        regen: (...a) => {
          regenCalls += 1;
          return regenerateGraph(...a);
        },
      });
    } finally {
      spy.mockRestore();
    }

    expect(regenCalls).toBe(0);
    expect(warnings.join("")).toContain("unreadable");
    // The claim itself still landed, and the board is untouched.
    expect(readFileSync(join(repo.root, GRAPH_FILENAME), "utf8")).toBe(before);
    const committed = git(repo.root, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean);
    expect(committed).not.toContain(GRAPH_FILENAME);
  });

  it("survives a repo that gitignores its generated board", async () => {
    // `git add` exits 1 on an ignored path. Bundling GRAPH.md into the
    // authored artifacts' pathspec would make EVERY claim in such a repo
    // fail permanently over a file the claim does not need.
    const repo = makeClaimRepo({ withGraph: false });
    writeFileSync(
      join(repo.root, ".gitignore"),
      ".devx-cache/\n.worktrees/\nGRAPH.md\n",
    );
    git(repo.root, "add", "--", ".gitignore");
    git(repo.root, "commit", "-q", "-m", "chore: ignore the generated board");
    git(repo.root, "push", "-q", "origin", "main");

    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      warnings.push(String(chunk));
      return true;
    });
    try {
      const result = await claimSpec("ggg111", {
        sessionId: "regen-gitignored-session",
        repoRoot: repo.root,
        config: CLAIM_CONFIG,
        exec,
      });
      expect(result.branch).toBe("feat/dev-ggg111");
    } finally {
      spy.mockRestore();
    }

    // Claim landed with the two authored artifacts; the board was warned
    // about, not fatal.
    const committed = git(repo.root, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean)
      .sort();
    expect(committed).toEqual(["DEV.md", specRel(SPECS[0])].sort());
    expect(warnings.join("")).toContain(GRAPH_FILENAME);
    expect(git(repo.root, "status", "--porcelain")).toBe("");
  });

  it("drops the board from the commit on a contended push so the rebase-retry survives", async () => {
    // GRAPH.md carries a repo-wide summary banner that every status
    // transition rewrites, so our claim commit and any peer commit that also
    // flipped something touch the same line from the same ancestor. Keeping
    // it in the commit makes `pull --rebase` conflict, which classifies
    // contended at ZERO retries used — silently disabling mlc104's retry.
    const repo = makeClaimRepo({ withGraph: true });

    // A peer advances origin/main with its OWN status flip + regenerated
    // board, behind our back. That rewrites the summary banner — the line
    // our regen is about to rewrite too, from the same ancestor.
    const peer = join(repo.base, "peer");
    execFileSync("git", ["clone", "-q", join(repo.base, "origin.git"), peer], {
      env: GIT_ENV,
    });
    git(peer, "config", "user.email", "peer@example.com");
    git(peer, "config", "user.name", "peer");
    git(peer, "config", "commit.gpgsign", "false");
    // Deliberately the SPEC only, not the DEV.md row: an adjacent-row DEV.md
    // conflict is a pre-existing mlc104 limitation, and folding it in here
    // would mask the thing under test. Spec frontmatter is the effective
    // status the model reads, so this still moves the counts banner.
    const peerSpec = join(peer, ...specRel(SPECS[1]).split("/"));
    writeFileSync(
      peerSpec,
      readFileSync(peerSpec, "utf8").replace("status: ready", "status: done"),
    );
    expect(runGraph({ cwd: peer, err: () => undefined })).toBe(0);
    const peerBoard = readFileSync(join(peer, GRAPH_FILENAME), "utf8");
    git(peer, "commit", "-q", "-am", "peer: mark ggg222 done + regen");
    git(peer, "push", "-q", "origin", "main");

    const result = await claimSpec("ggg111", {
      sessionId: "regen-contended-session",
      repoRoot: repo.root,
      config: CLAIM_CONFIG,
      exec,
    });
    expect(result.branch).toBe("feat/dev-ggg111");

    // The claim landed on top of the peer's commit…
    const head = git(repo.root, "show", "--name-only", "--format=", "HEAD")
      .split("\n")
      .filter(Boolean)
      .sort();
    // …carrying ONLY the authored artifacts — the board stepped aside.
    expect(head).toEqual(["DEV.md", specRel(SPECS[0])].sort());
    // The peer's board survived byte-for-byte; we neither clobbered it nor
    // hand-merged it (the plan's rule for this file: re-render, never merge).
    expect(readFileSync(join(repo.root, GRAPH_FILENAME), "utf8")).toBe(peerBoard);
    // Clean tree — no conflict debris, nothing left staged.
    expect(git(repo.root, "status", "--porcelain")).toBe("");
    // And the flip really is on origin (the retry pushed, it didn't bail).
    expect(git(repo.root, "rev-parse", "HEAD")).toBe(
      git(repo.root, "rev-parse", "origin/main"),
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — the EMISSION host
// ---------------------------------------------------------------------------

interface EmitRepo {
  root: string;
  configPath: string;
}

function makeEmitRepo(): EmitRepo {
  const root = mkRoot("graph-regen-emit-");
  seedBoard(root);
  const configPath = join(root, "devx.config.yaml");
  copyFileSync(join(realRepoRoot, "devx.config.yaml"), configPath);
  // The retro co-emission splices its row into the parent's epic section.
  writeFileSync(
    join(root, "DEV.md"),
    [
      "# DEV",
      "",
      "### Epic — graph things",
      row(" ", SPECS[0]),
      row(" ", SPECS[1]),
      "",
    ].join("\n"),
  );
  return { root, configPath };
}

function runEmit(
  fx: EmitRepo,
  extra: Parameters<typeof runEmitRetroStory>[1] = {},
): { code: number; stdout: string; stderr: string } {
  let stdout = "";
  let stderr = "";
  const code = runEmitRetroStory(
    [
      "--epic-slug",
      "graph-things",
      "--parents",
      "ggg111,ggg222",
      "--plan",
      "plan/plan-ppp111-2026-08-01T08:00-graph-things.md",
    ],
    {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
      projectPath: fx.configPath,
      repoRoot: fx.root,
      now: () => new Date(2026, 7, 1, 9, 0, 0),
      ...extra,
    },
  );
  return { code, stdout, stderr };
}

/** `spec=… dev_md=… [graph=…]` → a lookup table. */
function keyValues(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of line.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq > 0) out[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return out;
}

describe("emission hook — GRAPH.md stays fresh (AC 3)", () => {
  it("regenerates after the rename batch and prints graph= on success", () => {
    const fx = makeEmitRepo();
    const r = runEmit(fx);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe("");

    const kv = keyValues(r.stdout);
    expect(kv.graph).toBe(GRAPH_FILENAME);
    // Repo-relative, like every other key on the line.
    expect(kv.graph.startsWith("/")).toBe(false);

    // The board renders the emitted retro spec — proof the regen ran AFTER
    // the renames landed, not before (a pre-rename regen would miss it).
    const board = readFileSync(join(fx.root, GRAPH_FILENAME), "utf8");
    expect(board).toContain("gggret");

    // And it agrees byte-for-byte with what the operator's own CLI produces.
    let checkErr = "";
    const code = runGraph({
      cwd: fx.root,
      check: true,
      err: (s) => {
        checkErr += s;
      },
    });
    expect(code, checkErr).toBe(0);
  });

  it("warns and still emits when the regen fails — no graph= key", () => {
    const fx = makeEmitRepo();
    // The CLI forwards its opts into writeRetroAtomically; inject the
    // failing regen through the same door the real one comes in.
    const r = runEmit(fx, {
      regen: () => ({ ok: false, warning: "GRAPH.md not regenerated: simulated" }),
    });

    // Emission is exit 0 — the two authored artifacts landed.
    expect(r.code).toBe(0);
    const kv = keyValues(r.stdout);
    expect(kv.spec).toMatch(/^dev\/dev-gggret-/);
    expect(kv.dev_md).toBe("DEV.md");
    expect(kv.graph).toBeUndefined();
    expect(existsSync(join(fx.root, kv.spec))).toBe(true);

    // The failure is never silent.
    expect(r.stderr).toContain("simulated");
    // …and no board was written behind the warning's back.
    expect(existsSync(join(fx.root, GRAPH_FILENAME))).toBe(false);
  });
});
