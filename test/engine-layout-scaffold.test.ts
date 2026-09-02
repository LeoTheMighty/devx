// dlr104 — `devx workstream new` produces the shape its layout names, across
// all four slug × layout combinations.
//
// Consumer of E-5 (`_devx/workstreams/docs-layout-resolution/evals/E-5_scaffold.ts`),
// pinned in `npm test` so the invariant survives the workstream that created it.
//
// It SPAWNS the real CLI rather than calling `runWorkstreamNew()` in process,
// and that is the point rather than an accident: the no-slug cases are a
// commander-arity question first. With `.argument("<slug>")` commander rejects
// the invocation before a line of devx code runs, so an in-process test would
// pass while `devx workstream new` still exited 1 with `error: missing required
// argument 'slug'` — the exact failure E-5 was RED on. Spawning is also why
// this file is registered in `SYNC_BLOCKING_TESTS` (vitest.shared.ts).
//
// Spec: dev/dev-dlr104-2026-09-02T09:14-consumer-sweep-scaffolding.md
// Design: _devx/workstreams/docs-layout-resolution/design/agent.md §"The slug"

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import type { DocsLayout } from "../src/lib/engine/artifacts.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "src", "cli.ts");
// tsx's CLI entry resolved through Node's module walk from THIS file, never
// via `--import tsx`: that form resolves against the spawn's cwd, which is a
// bare temp repo with no node_modules, so every run dies with
// ERR_MODULE_NOT_FOUND before the CLI is reached. A linked worktree has no
// node_modules of its own either — the main checkout's is found by upward
// resolution — so path construction is out too (mlc101, E-2).
const tsxCliEntry = createRequire(import.meta.url).resolve("tsx/cli");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI from source through tsx — no build step, so this test cannot
 *  silently assert against a stale `dist/`. tsx is resolved through Node's
 *  module walk rather than a constructed `node_modules/.bin` path: a linked
 *  worktree has no `node_modules` of its own, and a spawn failure there
 *  produces empty output that reads exactly like a legitimate refusal. */
function runCli(args: string[], cwd: string): CliResult {
  // spawnSync, not execFileSync: the latter returns only stdout and DROPS
  // stderr on a zero exit, which is exactly where the idempotent-rerun notice
  // ("already scaffolded") is written. A test that cannot see it asserts on an
  // empty string and reads as a missing feature.
  const r = spawnSync(process.execPath, [tsxCliEntry, cliPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status ?? -1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** A spawn that produced nothing on EITHER stream never ran the CLI. That is a
 *  harness fault wearing a refusal's clothes, and asserting an exit code
 *  against it pins nothing (mlc101). */
function assertRan(res: CliResult, what: string): void {
  if (res.stdout.trim() === "" && res.stderr.trim() === "") {
    throw new Error(
      `INFRA — \`${what}\` produced no output on either stream (status ${res.status}); the CLI did not run. Fix the harness before reading any verdict from this test.`,
    );
  }
}

const roots: string[] = [];

/** A bare repo with templates and no workstream: `devx workstream new` is the
 *  thing under test, so the fixture must not pre-create what it should create. */
function bareRepo(layout: DocsLayout): string {
  const root = mkdtempSync(
    join(tmpdir(), `dlr104-${layout === "project-level" ? "flat" : "ws"}-`),
  );
  roots.push(root);
  writeFileSync(
    join(root, "devx.config.yaml"),
    [
      "mode: YOLO",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "engine:",
      "  workstreams_root: _devx/workstreams",
      `  docs_layout: ${layout}`,
      "  expectations_min: 3",
      "",
    ].join("\n"),
  );
  for (const f of ["DEV.md", "PLAN.md", "MANUAL.md", "INTERVIEW.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }
  mkdirSync(join(root, "plan"), { recursive: true });
  cpSync(
    join(repoRoot, "_devx", "templates", "engine"),
    join(root, "_devx", "templates", "engine"),
    { recursive: true },
  );
  return root;
}

function planSpec(root: string): string | null {
  const dir = join(root, "plan");
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((n) => n.startsWith("plan-") && n.endsWith(".md"));
  return f ? join(dir, f) : null;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

describe("dlr104 — layout-aware scaffolding", () => {
  it("[project-level, no slug] writes the complete root doc set (UC-1)", () => {
    const root = bareRepo("project-level");
    const res = runCli(["workstream", "new"], root);
    assertRan(res, "devx workstream new");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);

    // 6 of 6: the three template-instantiated artifacts and the three empty
    // subdirs, all at the repo root under this layout (owner decision,
    // 2026-09-01).
    for (const want of [
      "prd.md",
      "expectations.md",
      "todo.md",
      "decisions",
      "checkpoints",
      "evals",
    ]) {
      expect(existsSync(join(root, want)), `missing ${want}`).toBe(true);
    }

    const spec = planSpec(root);
    expect(spec).not.toBeNull();
    // `.` and not the repo's path: `workstream:` is a repo-relative pointer in
    // every existing spec, so `.` extends that type rather than overloading it.
    expect(readFileSync(spec as string, "utf8")).toMatch(/^workstream:\s*\.\s*$/m);

    // No slug directory anywhere — the whole point of the layout.
    expect(existsSync(join(root, "_devx", "workstreams"))).toBe(false);
  });

  it("[workstream, no slug] refuses with exit 1, naming the layout", () => {
    const root = bareRepo("workstream");
    const res = runCli(["workstream", "new"], root);
    assertRan(res, "devx workstream new");

    // 1, not 2: a missing slug here is a valid request the engine says no to,
    // not a malformed invocation. Reaching this at all requires the commander
    // argument to be `[slug]` (AC 6) — with `<slug>` commander exits first and
    // the refusal below is unreachable.
    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("engine.docs_layout: workstream");
  });

  it("[project-level, with slug] names the plan spec and no directory", () => {
    const root = bareRepo("project-level");
    const res = runCli(["workstream", "new", "scene-engine"], root);
    assertRan(res, "devx workstream new scene-engine");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);

    expect(existsSync(join(root, "prd.md"))).toBe(true);
    expect(existsSync(join(root, "_devx", "workstreams", "scene-engine"))).toBe(false);
    const spec = planSpec(root);
    expect(spec).toContain("scene-engine");
    expect(readFileSync(spec as string, "utf8")).toContain("Scene Engine");
  });

  it("[workstream, with slug] still produces the folder-per-artifact tree", () => {
    // The control. Everything above is new behavior; this is devx's own
    // scaffolding path, which must not move an inch.
    const root = bareRepo("workstream");
    const res = runCli(["workstream", "new", "scene-engine"], root);
    assertRan(res, "devx workstream new scene-engine");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);

    const ws = join(root, "_devx", "workstreams", "scene-engine");
    for (const want of [
      join("prd", "agent.md"),
      "expectations.md",
      "todo.md",
      "decisions",
      "checkpoints",
      "evals",
    ]) {
      expect(existsSync(join(ws, want)), `missing ${want}`).toBe(true);
    }
    expect(existsSync(join(root, "prd.md"))).toBe(false);
  });

  it("[project-level] a second workstream is refused, not silently adopted", () => {
    // `wsRel` is `.` for EVERY workstream under this layout, so the adoption
    // walk matches any spec claiming the root. Adopting it would return the
    // FIRST workstream's hash under the second one's name and report
    // "already scaffolded" for something that never was.
    const root = bareRepo("project-level");
    expect(runCli(["workstream", "new", "first-thing"], root).status).toBe(0);

    const second = runCli(["workstream", "new", "second-thing"], root);
    assertRan(second, "devx workstream new second-thing");
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("first-thing");
    expect(second.stderr).toContain("exactly one doc set");
  });

  it("[project-level] re-running is a no-op, not a refusal", () => {
    // The doc-set probe's real job. The old probe asked "does the directory
    // exist", which under this layout asks about the repo root — always true,
    // so UC-1 threw on every invocation including the first.
    const root = bareRepo("project-level");
    expect(runCli(["workstream", "new"], root).status).toBe(0);

    const second = runCli(["workstream", "new"], root);
    assertRan(second, "devx workstream new (second run)");
    expect(second.status).toBe(0);
    expect(second.stderr).toContain("already scaffolded");
  });
});

// ---------------------------------------------------------------------------
// AC 9 — the consumers, under project-level.
//
// The spec calls `devx next` row selection "the most user-visible breakage in
// the workstream": the probes called `prdAbs(wsAbs)` correctly into a
// layout-BLIND helper, so under this layout every stage probe missed and the
// dispatcher reported "PRD not yet authored" forever on a repo whose PRD sits
// at `prd.md`. That is asserted here rather than only in a comment.
// ---------------------------------------------------------------------------

/** Scaffold a flat repo and return its root + the plan spec's hash. */
function flatRepoWithDocSet(): { root: string; hash: string } {
  const root = bareRepo("project-level");
  const res = runCli(["workstream", "new", "scene-engine"], root);
  assertRan(res, "devx workstream new scene-engine");
  expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);
  const spec = planSpec(root);
  expect(spec).not.toBeNull();
  const m = /plan-([a-z0-9]+)-/.exec(spec as string);
  expect(m).not.toBeNull();
  return { root, hash: (m as RegExpExecArray)[1] };
}

describe("dlr104 — consumers resolve real paths under project-level", () => {
  it("devx next selects a stage row and names the flat spellings", () => {
    const { root, hash } = flatRepoWithDocSet();
    const res = runCli(["next", hash], root);
    assertRan(res, `devx next ${hash}`);
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);

    const out = JSON.parse(res.stdout) as {
      row: number;
      reason: string;
      focus: string | null;
    };
    // Row 5 (Gate 1 open), NOT row 4 ("prd.md / expectations.md not yet
    // authored") — the artifacts the scaffold just wrote are SEEN.
    expect(out.row, out.reason).toBe(5);
    // And named as this layout spells them. `prd/agent.md` here would be a
    // path the repo cannot produce.
    expect(out.reason).toContain("prd.md");
    expect(out.reason).toContain("expectations.md");
    expect(out.reason).not.toContain("prd/agent.md");
    // todo.md was found at the root, so the focus line is non-null.
    expect(out.focus).not.toBeNull();
  });

  it("devx next reports row 8 until plan.md exists, then row 9", () => {
    // The `plan.md` / `PLAN.md` case collision (debug-135dc9) makes a
    // case-blind probe answer TRUE here on macOS, skipping row 8 entirely.
    // bareRepo() writes a PLAN.md backlog, so this pins the exact-name probe.
    const { root, hash } = flatRepoWithDocSet();
    // Exact-name, not existsSync: on a case-INSENSITIVE filesystem (macOS,
    // Windows) `existsSync("plan.md")` answers TRUE for `PLAN.md`, which is
    // the hazard itself — asserting on it would fail here and pass on Linux
    // CI, pinning the platform rather than the behavior.
    const names = () => readdirSync(root);
    expect(names()).toContain("PLAN.md");
    expect(names()).not.toContain("plan.md");

    // Walk the gates open so row selection reaches the plan rows.
    writeFileSync(join(root, "design.md"), "# Design\n");
    const spec = planSpec(root) as string;
    writeFileSync(
      spec,
      readFileSync(spec, "utf8")
        .replace("prd_validated: false", "prd_validated: true")
        .replace("design_verified: false", "design_verified: true"),
    );

    const before = JSON.parse(runCli(["next", hash], root).stdout) as {
      row: number;
      reason: string;
    };
    expect(before.row, before.reason).toBe(8);
    expect(before.reason).toBe("plan.md not yet authored");

    // The "and then row 9" half deliberately does NOT write `plan.md` here.
    // On a case-insensitive filesystem that write lands INSIDE `PLAN.md` —
    // verified: the directory entry stays `PLAN.md` and the backlog's content
    // is replaced. Authoring the plan artifact in a repo that has a `PLAN.md`
    // is itself the unresolved hazard (`debug-135dc9`), not something to
    // exercise in passing. The transition is covered on a clean fixture below.
  });

  it("devx next advances to row 9 once plan.md is authored", () => {
    const { root, hash } = flatRepoWithDocSet();
    // No `PLAN.md` in this fixture, so `plan.md` is writable as itself.
    rmSync(join(root, "PLAN.md"), { force: true });
    writeFileSync(join(root, "design.md"), "# Design\n");
    const spec = planSpec(root) as string;
    writeFileSync(
      spec,
      readFileSync(spec, "utf8")
        .replace("prd_validated: false", "prd_validated: true")
        .replace("design_verified: false", "design_verified: true"),
    );

    const before = JSON.parse(runCli(["next", hash], root).stdout) as {
      row: number;
      reason: string;
    };
    expect(before.row, before.reason).toBe(8);

    writeFileSync(join(root, "plan.md"), "# Plan\n");
    expect(readdirSync(root)).toContain("plan.md");
    const after = JSON.parse(runCli(["next", hash], root).stdout) as {
      row: number;
      reason: string;
    };
    expect(after.row, after.reason).toBe(9);
    expect(after.reason).toContain("plan.md");
  });

  it("devx status renders the slug and resolves the doc set", () => {
    const { root } = flatRepoWithDocSet();
    const res = runCli(["status"], root);
    assertRan(res, "devx status");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);
    // The slug lives in the plan spec's filename under this layout; the tail
    // of `.` is `.`, which would render every workstream as ". (<hash>)".
    expect(res.stdout).toContain("scene-engine");
    expect(res.stdout).not.toMatch(/^\. \(/m);
  });

  it("devx graph derives phase ordering from the root plan.md", () => {
    // The defect was the ENUMERATION, one level above the resolver calls:
    // `readdir(<workstreams_root>)` yields nothing in a flat repo, so every
    // phase edge silently vanished — no error, just a board missing its edges.
    const { root } = flatRepoWithDocSet();
    writeFileSync(
      join(root, "plan.md"),
      "# Plan\n\n- [ ] Phase 1: first (dev spec: aaa111)\n- [ ] Phase 2: second (dev spec: bbb222)\n",
    );
    mkdirSync(join(root, "dev"), { recursive: true });
    for (const [h, n] of [
      ["aaa111", "first"],
      ["bbb222", "second"],
    ]) {
      writeFileSync(
        join(root, "dev", `dev-${h}-2026-09-02T10:00-${n}.md`),
        `---\nhash: ${h}\ntype: dev\ntitle: ${n}\nstatus: ready\n---\n## Goal\n${n}\n`,
      );
    }
    writeFileSync(
      join(root, "DEV.md"),
      "# DEV\n\n- [ ] `dev/dev-aaa111-2026-09-02T10:00-first.md` — first. Status: ready.\n" +
        "- [ ] `dev/dev-bbb222-2026-09-02T10:00-second.md` — second. Status: ready.\n",
    );

    const res = runCli(["graph", "backfill", "--dry-run"], root);
    assertRan(res, "devx graph backfill --dry-run");
    expect(res.status, `${res.stderr}${res.stdout}`).toBe(0);
    // Non-empty, and attributed to the workstream the plan spec names.
    expect(res.stdout).toContain("Derived from durable state: 1 edge(s)");
    expect(res.stdout).toContain("bbb222 → aaa111");
    expect(res.stdout).toContain("workstream scene-engine");
  });

  it("devx outcome resolves real paths rather than failing on a missing dir", () => {
    const { root, hash } = flatRepoWithDocSet();
    const res = runCli(["outcome", "arm", hash], root);
    assertRan(res, `devx outcome arm ${hash}`);
    // Refused on STAGE — the workstream is at `prd`, not `done`. The point is
    // that it got far enough to have an opinion about the stage: a layout-blind
    // resolve fails earlier, on a workstream directory that does not exist.
    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toContain("stage 'done'");
    expect(`${res.stdout}${res.stderr}`).not.toContain("not found");
  });
});
