// dlr103 — workstream resolution under `engine.docs_layout` (plan phase 3).
//
// The invariant: under `project-level` a hash resolves to the REPO ROOT, for
// every frontmatter state a real repo produces — the key written as `.`, the
// key ABSENT, and a stale `<workstreams_root>/<slug>` left behind by a
// half-finished migration. The absent case is the dangerous one:
// `planFilenameWorkstreamRel()` derives a FOLDER path from the spec filename,
// so without the branch a flat repo gets pointed at a directory that a repo
// with no directories cannot have.
//
// Companion to `_devx/workstreams/docs-layout-resolution/evals/E-4_resolve-workstream.ts`
// (the RED artifact). The eval proves the resolver; this file pins the same
// invariant inside `npm test`, plus the two flat-era guards and the new
// `layout-tree-mismatch` doctor finding that the eval does not reach.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ENGINE_DEFAULTS, type EngineConfig } from "../src/lib/engine/config.js";
import {
  WorkstreamRefusal,
  createWorkstream,
  planFilenameSlug,
  planFilenameWorkstreamRel,
  planSpecWorkstreamRel,
  resolveSpecWorkstream,
  resolveWorkstream,
  workstreamSlugFor,
} from "../src/lib/engine/workstream.js";
import {
  detectFlatWorkstreams,
  detectLayoutTreeMismatch,
  realDoctorFs,
} from "../src/lib/doctor/detect.js";
import { type EngineRepo, makeEngineRepo } from "./fixtures/engine-repo.js";

const HASH = "b7e38f";
const SLUG = "scene-engine";
const SPEC_NAME = `plan-${HASH}-2026-09-02T09:00-${SLUG}.md`;

const flatEngine: EngineConfig = { ...ENGINE_DEFAULTS, docsLayout: "project-level" };
const wsEngine: EngineConfig = { ...ENGINE_DEFAULTS, docsLayout: "workstream" };

/** A plan spec carrying the engine frontmatter, with `workstream:` in one of
 *  the three states a real repo produces. `undefined` omits the key. */
function planSpec(workstreamValue: string | undefined): string {
  return [
    "---",
    `hash: ${HASH}`,
    "type: plan",
    "created: 2026-09-02T09:00:00-06:00",
    "title: Fixture",
    "status: in-progress",
    "stage: prd",
    "entered_at: prd",
    "gate_status:",
    "  prd_validated: false",
    "  design_verified: false",
    "  plan_verified: false",
    "  evals_red: false",
    "outcome:",
    "  status: null",
    "  measure_by: null",
    ...(workstreamValue === undefined ? [] : [`workstream: ${workstreamValue}`]),
    "---",
    "",
    "## Goal",
    "",
    "Fixture.",
    "",
  ].join("\n");
}

let repo: EngineRepo;
beforeEach(() => {
  repo = makeEngineRepo();
});
afterEach(() => repo.cleanup());

// ---------------------------------------------------------------------------
// AC 1 + AC 2 — resolveWorkstream
// ---------------------------------------------------------------------------

describe("resolveWorkstream under project-level", () => {
  const STATES: Array<[string, string | undefined]> = [
    ["workstream: .", "."],
    ["workstream: absent", undefined],
    ["workstream: stale folder path", `_devx/workstreams/${SLUG}`],
  ];

  for (const [name, value] of STATES) {
    it(`resolves ${name} to the repo root`, () => {
      repo.write(`plan/${SPEC_NAME}`, planSpec(value));
      const r = resolveWorkstream(repo.root, HASH, flatEngine);
      expect(r.workstreamRel).toBe(".");
      expect(r.workstreamAbs).toBe(repo.root);
      // The failure this branch exists to close: a `<root>/<slug>` string is
      // a folder path in a repo that has no folders.
      expect(r.workstreamRel).not.toContain("/");
    });
  }

  it("does not require the stale directory to exist", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    expect(() => resolveWorkstream(repo.root, HASH, flatEngine)).not.toThrow();
  });
});

describe("resolveWorkstream under workstream layout (control)", () => {
  it("honors the frontmatter pointer", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    repo.mkdir(`_devx/workstreams/${SLUG}`);
    const r = resolveWorkstream(repo.root, HASH, wsEngine);
    expect(r.workstreamRel).toBe(`_devx/workstreams/${SLUG}`);
    expect(r.workstreamAbs).toBe(join(repo.root, "_devx", "workstreams", SLUG));
  });

  it("falls back to the filename-derived slug when the key is absent", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(undefined));
    repo.mkdir(`_devx/workstreams/${SLUG}`);
    expect(resolveWorkstream(repo.root, HASH, wsEngine).workstreamRel).toBe(
      `_devx/workstreams/${SLUG}`,
    );
  });

  it("still throws when the directory is missing", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(undefined));
    expect(() => resolveWorkstream(repo.root, HASH, wsEngine)).toThrow(
      /workstream dir .* not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// AC 2 — planFilenameWorkstreamRel's signature
// ---------------------------------------------------------------------------

describe("planFilenameWorkstreamRel", () => {
  it("returns '.' under project-level — the filename derivation never runs", () => {
    expect(planFilenameWorkstreamRel(SPEC_NAME, flatEngine)).toBe(".");
  });

  it("returns '.' under project-level even for a name it cannot parse", () => {
    // The layout answers the question, so an unparseable name is not a
    // reason to report "no workstream" in a repo that plainly has one.
    expect(planFilenameWorkstreamRel("hand-authored.md", flatEngine)).toBe(".");
  });

  it("derives the folder path under workstream layout", () => {
    expect(planFilenameWorkstreamRel(SPEC_NAME, wsEngine)).toBe(
      `_devx/workstreams/${SLUG}`,
    );
  });

  it("honors a custom workstreams_root", () => {
    expect(
      planFilenameWorkstreamRel(SPEC_NAME, { ...wsEngine, workstreamsRoot: "docs/ws" }),
    ).toBe(`docs/ws/${SLUG}`);
  });

  it("returns null on an unparseable name under workstream layout", () => {
    expect(planFilenameWorkstreamRel("hand-authored.md", wsEngine)).toBeNull();
  });

  it("planFilenameSlug reads the slug tail, layout-independently", () => {
    expect(planFilenameSlug(SPEC_NAME)).toBe(SLUG);
    expect(planFilenameSlug("hand-authored.md")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC 2 — resolveSpecWorkstream
// ---------------------------------------------------------------------------

describe("resolveSpecWorkstream under project-level", () => {
  const fmScalar = (content: string, key: string): string | null => {
    const m = new RegExp(`^${key}:[ \\t]*(.+)$`, "m").exec(content);
    return m ? m[1].trim() : null;
  };

  const devSpec = (lines: string[]): string =>
    ["---", "hash: aa11bb", "type: dev", ...lines, "---", "", "## Goal", "", "x", ""].join("\n");

  const resolve = (content: string, engine: EngineConfig) =>
    resolveSpecWorkstream(realDoctorFs, repo.root, engine, content, fmScalar);

  it("maps a `workstream: .` pointer to the repo root", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec("."));
    const m = resolve(devSpec(["workstream: ."]), flatEngine);
    expect(m.workstreamRel).toBe(".");
    expect(m.via).toBe("workstream-frontmatter");
    expect(m.unclaimed).toBe(false);
    // The slug lives in the plan spec's FILENAME under this layout — it names
    // no directory, so the tail of `.` would be nothing anyone typed.
    expect(m.slug).toBe(SLUG);
  });

  it("maps a stale `<root>/<slug>` pointer to the repo root", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec("."));
    const m = resolve(devSpec([`workstream: _devx/workstreams/${SLUG}`]), flatEngine);
    expect(m.workstreamRel).toBe(".");
    expect(m.unclaimed).toBe(false);
  });

  it("resolves through the plan-hash arm", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec("."));
    const m = resolve(devSpec([`from: plan/${SPEC_NAME}`]), flatEngine);
    expect(m.via).toBe("plan-hash");
    expect(m.workstreamRel).toBe(".");
    expect(m.slug).toBe(SLUG);
  });

  it("resolves through the plan-hash arm when the plan spec omits the key", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(undefined));
    const m = resolve(devSpec([`from: plan/${SPEC_NAME}`]), flatEngine);
    expect(m.workstreamRel).toBe(".");
  });

  it("still reports no membership for a spec with no signal at all", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec("."));
    const m = resolve(devSpec(["title: standalone"]), flatEngine);
    expect(m.workstreamRel).toBeNull();
    expect(m.via).toBe("none");
  });

  it("control: the workstream layout still yields the folder path", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    const m = resolve(devSpec([`workstream: _devx/workstreams/${SLUG}`]), wsEngine);
    expect(m.workstreamRel).toBe(`_devx/workstreams/${SLUG}`);
    expect(m.slug).toBe(SLUG);
  });
});

describe("workstreamSlugFor", () => {
  it("reads the plan spec's filename under project-level", () => {
    expect(workstreamSlugFor(SPEC_NAME, ".", flatEngine)).toBe(SLUG);
  });

  it("reads the dir tail under workstream layout", () => {
    expect(workstreamSlugFor(SPEC_NAME, `_devx/workstreams/${SLUG}`, wsEngine)).toBe(SLUG);
  });

  it("never returns '.' — the tail of the flat dir is nothing anyone typed", () => {
    // `devx status` renders `<slug> (<hash>)` and `devx todo sync` titles the
    // scaffolded todo.md from this; both read ". (b7e38f)" without the branch.
    expect(workstreamSlugFor(SPEC_NAME, ".", flatEngine)).not.toBe(".");
  });

  it("tolerates a trailing-slash hand-edit under workstream layout", () => {
    expect(workstreamSlugFor(SPEC_NAME, `_devx/workstreams/${SLUG}/`, wsEngine)).toBe(SLUG);
  });

  it("answers null with nothing to read a slug from", () => {
    expect(workstreamSlugFor(null, ".", flatEngine)).toBeNull();
    expect(workstreamSlugFor(SPEC_NAME, null, wsEngine)).toBeNull();
  });
});

describe("planSpecWorkstreamRel", () => {
  it("ignores a stale pointer under project-level", () => {
    // The `??` fallback used to live at each call site, so a spec that HAS a
    // pointer never reached the layout-aware helper — and `devx status` then
    // dropped the workstream on its directory-existence check.
    expect(
      planSpecWorkstreamRel(SPEC_NAME, `_devx/workstreams/${SLUG}`, flatEngine),
    ).toBe(".");
    expect(planSpecWorkstreamRel(SPEC_NAME, null, flatEngine)).toBe(".");
  });

  it("prefers the pointer, then the filename, under workstream layout", () => {
    expect(planSpecWorkstreamRel(SPEC_NAME, "docs/ws/other", wsEngine)).toBe("docs/ws/other");
    expect(planSpecWorkstreamRel(SPEC_NAME, null, wsEngine)).toBe(
      `_devx/workstreams/${SLUG}`,
    );
    expect(planSpecWorkstreamRel("hand-authored.md", null, wsEngine)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC 3 — createWorkstream's flat-era refusal
// ---------------------------------------------------------------------------

describe("createWorkstream flat-era refusal", () => {
  it("still refuses a workstream-layout workstream carrying a flat <stage>.md", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    repo.write(`_devx/workstreams/${SLUG}/prd.md`, "# flat-era PRD\n");
    expect(() =>
      createWorkstream({ repoRoot: repo.root, slug: SLUG, hash: HASH, engine: wsEngine }),
    ).toThrow(WorkstreamRefusal);
  });

  it("does not refuse under project-level — a <stage>.md is the CURRENT layout", () => {
    // An interrupted migration, and the shape that reaches the guard TODAY:
    // the config already says project-level while both the folder tree and
    // the spec's pointer are still on the old spelling. Pre-discrimination
    // this refused; the layout says a `<stage>.md` is authoritative now.
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    repo.write(`_devx/workstreams/${SLUG}/prd.md`, "# flat-era PRD\n");
    expect(() =>
      createWorkstream({ repoRoot: repo.root, slug: SLUG, hash: HASH, engine: flatEngine }),
    ).not.toThrow(WorkstreamRefusal);
  });

  it("does not refuse a `workstream: .` spec for a FLAT-ERA reason", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec("."));
    repo.write(`_devx/workstreams/${SLUG}/prd.md`, "# flat-era PRD\n");
    // Scoped to the flat-era message on purpose. This call still refuses, on
    // the `--hash` rebind guard: `createWorkstream` resolves its base to
    // `<workstreams_root>/<slug>` regardless of layout, so a spec already
    // pointing at `.` reads as a rebind. Moving that base to the repo root is
    // phase 4's job (design §"Layout-aware scaffolding"), and it dissolves
    // this refusal structurally — both sides become `.`. Phase 3 owns only
    // the flat-era guard, so that is all this asserts.
    expect(() =>
      createWorkstream({ repoRoot: repo.root, slug: SLUG, hash: HASH, engine: flatEngine }),
    ).not.toThrow(/flat-era/);
  });

  it("derives its stage list rather than hardcoding it — design.md refuses too", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    repo.write(`_devx/workstreams/${SLUG}/design.md`, "# flat-era design\n");
    expect(() =>
      createWorkstream({ repoRoot: repo.root, slug: SLUG, hash: HASH, engine: wsEngine }),
    ).toThrow(/flat-era design\.md/);
  });

  it("does not invent an `evals.md` check — evals was always a directory", () => {
    repo.write(`plan/${SPEC_NAME}`, planSpec(`_devx/workstreams/${SLUG}`));
    repo.write(`_devx/workstreams/${SLUG}/evals.md`, "# not an artifact\n");
    expect(() =>
      createWorkstream({ repoRoot: repo.root, slug: SLUG, hash: HASH, engine: wsEngine }),
    ).not.toThrow(WorkstreamRefusal);
  });
});

// ---------------------------------------------------------------------------
// AC 4 — detectFlatWorkstreams
// ---------------------------------------------------------------------------

/** Minimal engine-managed plan spec — what `hasEngineWorkstream` looks for. */
const ENGINE_PLAN_SPEC = planSpec(".");

const fakeFs = (files: Record<string, string>) => ({
  exists: (p: string) =>
    p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)),
  readFile: (p: string) => files[p] ?? "",
  readdir: (p: string) => [
    ...new Set(
      Object.keys(files)
        .filter((f) => f.startsWith(`${p}/`))
        .map((f) => f.slice(p.length + 1).split("/")[0]),
    ),
  ],
  isDirectory: (p: string) =>
    Object.keys(files).some((f) => f.startsWith(`${p}/`)),
});

describe("detectFlatWorkstreams", () => {
  it("honors a non-default engine.workstreams_root", () => {
    const fs = fakeFs({ "/r/docs/ws/old/prd.md": "x" });
    const findings = detectFlatWorkstreams({
      repoRoot: "/r",
      fs,
      engine: { ...wsEngine, workstreamsRoot: "docs/ws" },
    } as never);
    expect(findings.map((f) => f.target)).toEqual(["docs/ws/old/prd.md"]);
    expect(findings[0].detail).toContain("docs/ws/old/prd/agent.md");
  });

  it("early-returns under project-level — a <stage>.md is not debris there", () => {
    const fs = fakeFs({ "/r/_devx/workstreams/old/prd.md": "x" });
    expect(
      detectFlatWorkstreams({ repoRoot: "/r", fs, engine: flatEngine } as never),
    ).toEqual([]);
  });

  it("defaults to today's behavior when no engine config is threaded", () => {
    const fs = fakeFs({ "/r/_devx/workstreams/old/prd.md": "x" });
    const findings = detectFlatWorkstreams({ repoRoot: "/r", fs } as never);
    expect(findings.map((f) => f.target)).toEqual(["_devx/workstreams/old/prd.md"]);
  });
});

// ---------------------------------------------------------------------------
// AC 5 — layout-tree-mismatch
// ---------------------------------------------------------------------------

describe("detectLayoutTreeMismatch", () => {
  it("reports a project-level config still carrying a workstream tree", () => {
    const fs = fakeFs({
      "/r/_devx/workstreams/scene/prd/agent.md": "x",
      "/r/prd.md": "x",
    });
    const findings = detectLayoutTreeMismatch({
      repoRoot: "/r",
      fs,
      engine: flatEngine,
    } as never);
    expect(findings).toHaveLength(1);
    expect(findings[0].class).toBe("layout-tree-mismatch");
    expect(findings[0].fixable).toBe(false);
    expect(findings[0].target).toBe("_devx/workstreams/scene");
    expect(findings[0].detail).toContain("devx layout migrate");
  });

  it("reports a workstream config carrying root-level stage artifacts", () => {
    const fs = fakeFs({
      "/r/plan.md": "x",
      "/r/design.md": "x",
      [`/r/plan/${SPEC_NAME}`]: ENGINE_PLAN_SPEC,
      "/r/_devx/workstreams/scene/prd/agent.md": "x",
    });
    const findings = detectLayoutTreeMismatch({
      repoRoot: "/r",
      fs,
      engine: wsEngine,
    } as never);
    expect(findings.map((f) => f.target).sort()).toEqual(["design.md", "plan.md"]);
    expect(findings.every((f) => f.fixable === false)).toBe(true);
  });

  it("is silent on a repo that runs no engine workstream at all", () => {
    // `plan.md` is an ordinary filename. A repo that has never scaffolded a
    // workstream has no artifact tree to be mismatched against, and advising
    // `devx layout migrate` there is pure noise.
    expect(
      detectLayoutTreeMismatch({
        repoRoot: "/r",
        fs: fakeFs({ "/r/plan.md": "x", "/r/design.md": "x" }),
        engine: wsEngine,
      } as never),
    ).toEqual([]);
  });

  it("is silent when only LEGACY (pre-engine) plan specs exist", () => {
    expect(
      detectLayoutTreeMismatch({
        repoRoot: "/r",
        fs: fakeFs({
          "/r/plan.md": "x",
          "/r/plan/plan-cc22dd-2026-01-01T09:00-legacy.md":
            "---\nhash: cc22dd\ntype: plan\nstatus: ready\n---\n\n## Goal\n\nx\n",
        }),
        engine: wsEngine,
      } as never),
    ).toEqual([]);
  });

  it("is silent when config and tree agree", () => {
    expect(
      detectLayoutTreeMismatch({
        repoRoot: "/r",
        fs: fakeFs({
          [`/r/plan/${SPEC_NAME}`]: ENGINE_PLAN_SPEC,
          "/r/_devx/workstreams/scene/prd/agent.md": "x",
        }),
        engine: wsEngine,
      } as never),
    ).toEqual([]);
    expect(
      detectLayoutTreeMismatch({
        repoRoot: "/r",
        fs: fakeFs({ "/r/prd.md": "x", "/r/expectations.md": "x" }),
        engine: flatEngine,
      } as never),
    ).toEqual([]);
  });

  it("also flags a flat-era <stage>.md inside a workstream dir under project-level", () => {
    const findings = detectLayoutTreeMismatch({
      repoRoot: "/r",
      fs: fakeFs({ "/r/_devx/workstreams/scene/prd.md": "x" }),
      engine: flatEngine,
    } as never);
    expect(findings.map((f) => f.target)).toEqual(["_devx/workstreams/scene"]);
  });

  it("ignores a workstream dir holding no stage artifact", () => {
    expect(
      detectLayoutTreeMismatch({
        repoRoot: "/r",
        fs: fakeFs({ "/r/_devx/workstreams/scene/notes.md": "x" }),
        engine: flatEngine,
      } as never),
    ).toEqual([]);
  });

  it("AC 5: `--fix` never offers to repair it — the move touches authored work", async () => {
    const { applyFixes } = await import("../src/lib/doctor/fix.js");
    const findings = detectLayoutTreeMismatch({
      repoRoot: "/r",
      fs: fakeFs({ "/r/_devx/workstreams/scene/prd/agent.md": "x" }),
      engine: flatEngine,
    } as never);
    expect(findings).toHaveLength(1);
    const results = await applyFixes(findings, {
      repoRoot: "/r",
      lock: (<T,>(_label: string, fn: () => T): T => fn()) as never,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    // Not "no applier matched" — the class never reaches fix.ts at all,
    // because applyFixes filters on `fixable` before dispatching.
    expect(results).toEqual([]);
  });

  // The macOS trap, and the reason the root probe reads a DIRECTORY LISTING
  // instead of asking `exists()`: every devx repo root carries `PLAN.md`, and
  // on a case-insensitive filesystem `existsSync("<root>/plan.md")` is TRUE.
  // A finding here would fire on devx's own repo, on every `devx doctor` run.
  it("does not mistake an uppercase backlog file for a root stage artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "dlr103-case-"));
    try {
      for (const f of ["DEV.md", "PLAN.md", "TEST.md"]) {
        writeFileSync(join(root, f), `# ${f}\n`, "utf8");
      }
      mkdirSync(join(root, "_devx", "workstreams", "scene", "prd"), { recursive: true });
      writeFileSync(join(root, "_devx", "workstreams", "scene", "prd", "agent.md"), "x", "utf8");
      expect(
        detectLayoutTreeMismatch({ repoRoot: root, fs: realDoctorFs, engine: wsEngine } as never),
      ).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
