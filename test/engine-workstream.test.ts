// Tests for `devx workstream new` (v2e101 AC #1): scaffold shape,
// create-or-extend spec frontmatter, idempotent re-run, refusal on
// conflicting bindings, hash→workstream resolution.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runWorkstreamNew } from "../src/commands/workstream.js";
import { ENGINE_DEFAULTS } from "../src/lib/engine/config.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";
import {
  WorkstreamError,
  createWorkstream,
  resolveWorkstream,
} from "../src/lib/engine/workstream.js";
import {
  type EngineRepo,
  REAL_REPO_ROOT,
  captureIo,
  makeEngineRepo,
} from "./fixtures/engine-repo.js";

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

const FIXED_NOW = () => new Date(2026, 6, 5, 13, 1, 0);

function newWs(slug: string, hash?: string) {
  const io = captureIo();
  const code = runWorkstreamNew([slug], { hash }, {
    ...io,
    projectPath: repo.configPath,
    now: FIXED_NOW,
  });
  return { code, io };
}

describe("devx workstream new — scaffold", () => {
  it("creates the full directory tree + spec (AC #1)", () => {
    const { code, io } = newWs("demo-feature", "abc123");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.hash).toBe("abc123");
    expect(j.workstreamDir).toBe("_devx/workstreams/demo-feature");
    expect(j.noop).toBe(false);

    expect(repo.exists("_devx/workstreams/demo-feature/prd.md")).toBe(true);
    expect(repo.exists("_devx/workstreams/demo-feature/expectations.md")).toBe(true);
    expect(repo.exists("_devx/workstreams/demo-feature/decisions")).toBe(true);
    expect(repo.exists("_devx/workstreams/demo-feature/checkpoints")).toBe(true);
    expect(repo.exists("_devx/workstreams/demo-feature/evals")).toBe(true);
    // design.md / plan.md are NOT pre-created — drafted by their stages.
    expect(repo.exists("_devx/workstreams/demo-feature/design.md")).toBe(false);

    const specRel = j.specPath as string;
    expect(specRel).toMatch(/^plan\/plan-abc123-2026-07-05T13:01-demo-feature\.md$/);
    const state = readEngineState(repo.read(specRel));
    expect(state.stage).toBe("prd");
    expect(state.enteredAt).toBe("prd");
    expect(state.gateStatus).toEqual({
      prd_validated: false,
      design_verified: false,
      plan_verified: false,
      evals_red: false,
    });
    expect(state.outcome).toEqual({ status: null, measure_by: null });
    expect(state.workstream).toBe("_devx/workstreams/demo-feature");
  });

  it("substitutes the workstream title into the copied templates", () => {
    newWs("demo-feature", "abc123");
    const prd = repo.read("_devx/workstreams/demo-feature/prd.md");
    expect(prd).toContain("# PRD — Demo Feature");
    expect(prd).not.toContain("<workstream title>");
  });

  it("generates a 6-hex hash when --hash is omitted", () => {
    const { code, io } = newWs("auto-hash");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.hash).toMatch(/^[0-9a-f]{6}$/);
  });

  it("extends an existing v1 plan spec instead of creating a new one", () => {
    repo.write(
      "plan/plan-cafe01-2026-07-01T09:00-legacy.md",
      "---\nhash: cafe01\ntype: plan\nstatus: ready\ncustom: keep\n---\n\n## Status log\n\n- created.\n",
    );
    const { code, io } = newWs("legacy-work", "cafe01");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect((j.created as Record<string, boolean>).spec).toBe(false);
    expect((j.created as Record<string, boolean>).specFrontmatterExtended).toBe(true);
    const content = repo.read("plan/plan-cafe01-2026-07-01T09:00-legacy.md");
    const state = readEngineState(content);
    expect(state.stage).toBe("prd");
    expect(state.workstream).toBe("_devx/workstreams/legacy-work");
    expect(content).toContain("custom: keep");
    expect(content).toContain("- created.");
  });
});

describe("devx workstream new — idempotency + refusals (seeded defects)", () => {
  it("double-run is a clean no-op (exit 0, nothing rewritten)", () => {
    newWs("demo-feature", "abc123");
    // Author real content; the re-run must not clobber it.
    repo.write("_devx/workstreams/demo-feature/prd.md", "# my real prd\n");
    const { code, io } = newWs("demo-feature", "abc123");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.noop).toBe(true);
    expect(repo.read("_devx/workstreams/demo-feature/prd.md")).toBe("# my real prd\n");
    expect(io.stderr()).toContain("already scaffolded");
  });

  it("re-run never resets live gate flags", () => {
    newWs("demo-feature", "abc123");
    const specRel = "plan/plan-abc123-2026-07-05T13:01-demo-feature.md";
    repo.write(
      specRel,
      repo
        .read(specRel)
        .replace("prd_validated: false", "prd_validated: true")
        .replace("stage: prd", "stage: design"),
    );
    const { code } = newWs("demo-feature", "abc123");
    expect(code).toBe(0);
    const state = readEngineState(repo.read(specRel));
    expect(state.gateStatus.prd_validated).toBe(true);
    expect(state.stage).toBe("design");
  });

  it("refuses to rebind a spec already bound to a different workstream", () => {
    newWs("demo-feature", "abc123");
    const { code, io } = newWs("other-name", "abc123");
    expect(code).toBe(1);
    expect(io.stderr()).toContain("already belongs to workstream");
    expect(repo.exists("_devx/workstreams/other-name")).toBe(false);
  });

  it("refuses a dir that exists with no spec pointing at it and no --hash", () => {
    repo.mkdir("_devx/workstreams/orphan-dir");
    const { code, io } = newWs("orphan-dir");
    expect(code).toBe(1);
    expect(io.stderr()).toContain("no plan spec points at it");
  });

  it("adopts the existing spec when re-run without --hash", () => {
    newWs("demo-feature", "abc123");
    const { code, io } = newWs("demo-feature");
    expect(code).toBe(0);
    const j = io.json() as Record<string, unknown>;
    expect(j.hash).toBe("abc123");
    expect(j.noop).toBe(true);
  });

  it("rejects a non-kebab-case slug (exit 2)", () => {
    for (const bad of ["Bad_Slug", "UPPER", "spaces here", "-lead", "trail-", "a".repeat(51)]) {
      const { code, io } = newWs(bad);
      expect(code, `slug '${bad}' should be rejected`).toBe(2);
      expect(io.stderr()).toContain("invalid slug");
    }
  });

  it("rejects a malformed --hash (exit 2)", () => {
    const { code, io } = newWs("fine-slug", "not/a/hash");
    expect(code).toBe(2);
    expect(io.stderr()).toContain("invalid hash");
  });

  it("errors when the engine templates are missing (exit 2)", () => {
    const bare = makeEngineRepo();
    try {
      // Remove the copied templates to simulate a pre-v2s101 repo.
      const io = captureIo();
      const code = runWorkstreamNew(
        ["demo"],
        { hash: "abc123" },
        {
          ...io,
          projectPath: bare.configPath,
          fs: {
            exists: (p: string) =>
              p.includes(join("_devx", "templates", "engine"))
                ? false
                : existsSync(p),
          },
          now: FIXED_NOW,
        },
      );
      expect(code).toBe(2);
      expect(io.stderr()).toContain("engine template missing");
    } finally {
      bare.cleanup();
    }
  });
});

describe("resolveWorkstream", () => {
  it("resolves via the workstream: frontmatter pointer", () => {
    newWs("demo-feature", "abc123");
    const ws = resolveWorkstream(repo.root, "abc123", ENGINE_DEFAULTS);
    expect(ws.workstreamRel).toBe("_devx/workstreams/demo-feature");
    expect(ws.state.stage).toBe("prd");
    expect(ws.specRel).toContain("plan/plan-abc123-");
  });

  it("falls back to filename-slug derivation without a workstream: field", () => {
    repo.write(
      "plan/plan-dd45f1-2026-07-05T13:01-hand-authored.md",
      "---\nhash: dd45f1\ntype: plan\nstatus: ready\n---\nbody\n",
    );
    repo.mkdir("_devx/workstreams/hand-authored");
    const ws = resolveWorkstream(repo.root, "dd45f1", ENGINE_DEFAULTS);
    expect(ws.workstreamRel).toBe("_devx/workstreams/hand-authored");
  });

  it("throws WorkstreamError for an unknown hash", () => {
    expect(() => resolveWorkstream(repo.root, "zz9999", ENGINE_DEFAULTS)).toThrow(
      WorkstreamError,
    );
  });

  it("throws WorkstreamError when the dir is missing", () => {
    repo.write(
      "plan/plan-ee45f1-2026-07-05T13:01-no-dir.md",
      "---\nhash: ee45f1\nworkstream: _devx/workstreams/no-dir\n---\nbody\n",
    );
    expect(() => resolveWorkstream(repo.root, "ee45f1", ENGINE_DEFAULTS)).toThrow(
      /not found/,
    );
  });

  it("throws WorkstreamError on an invalid hash shape", () => {
    expect(() => resolveWorkstream(repo.root, "..", ENGINE_DEFAULTS)).toThrow(
      /invalid hash/,
    );
  });
});

describe("createWorkstream — engine.workstreams_root override", () => {
  it("scaffolds under a configured root", () => {
    const result = createWorkstream({
      repoRoot: repo.root,
      slug: "custom-root",
      hash: "ab12cd",
      engine: { ...ENGINE_DEFAULTS, workstreamsRoot: "streams" },
      now: FIXED_NOW,
    });
    expect(result.workstreamDir).toBe("streams/custom-root");
    expect(repo.exists("streams/custom-root/prd.md")).toBe(true);
  });
});

describe("devx workstream new — commander wiring (subprocess)", () => {
  const distEntry = resolve(REAL_REPO_ROOT, "dist", "cli.js");

  it.skipIf(!existsSync(distEntry))("dist CLI scaffolds end-to-end", () => {
    const stdout = execFileSync(
      "node",
      [distEntry, "workstream", "new", "cli-smoke", "--hash", "beef01"],
      { cwd: repo.root, encoding: "utf8" },
    );
    const j = JSON.parse(stdout.trim()) as Record<string, unknown>;
    expect(j.hash).toBe("beef01");
    expect(repo.exists("_devx/workstreams/cli-smoke/expectations.md")).toBe(true);
  });
});
