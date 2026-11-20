// The review pass is read-mostly: it READS gate state and never writes it.
//
// This is the invariant that makes `/devx-review` safe to run on anything,
// at any time, including unattended in CI. Upstream states it as CONVENTIONS
// §19/§25 and enforces it with a sentence in a skill body. Here it is pinned
// four ways, because a sentence is not an enforcement:
//
//   (a) Static — `position.ts` is pure: zero references to any write
//       surface, and zero to `node:fs`. The firewall is total, not
//       "touches it but means well".
//   (b) Behavioural — `devx workstream position` leaves every byte of the
//       repo as it found it, across a clean state, a premature-closure state
//       and an illegal-transition state, and exits 0 in all three (advisory
//       means findings never change the exit code).
//   (c) Vocabulary — the shipped `review.md` template does NOT parse as a
//       gate verdict block, because it carries `review:` and not `gate:`.
//       That is what stops a consumer reading a review as a gate's answer.
//   (d) Prose — the skill body states the refusal, so the half of the pass
//       that is judgment is held to the same rule as the half that is code.
//
// Modeled on `test/gate-todo-isolation.test.ts`, which pins the mirror-image
// firewall (gates never read todo.md) in the same static + byte-identity
// shape.
//
// Row A16/B13/C13 of docs/updates/8am-harness-gap-analysis.md.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { parseVerdictBlock } from "../src/lib/engine/verdict.js";
import { runPosition } from "../src/commands/workstream.js";
import {
  type EngineRepo,
  REAL_REPO_ROOT,
  captureIo,
  makeEngineRepo,
  validExpectations,
  validPlan,
  validPrd,
} from "./fixtures/engine-repo.js";

// ---------------------------------------------------------------------------
// (a) Static scan — the pure module is pure
// ---------------------------------------------------------------------------

/** Anything that could mutate engine state, plus the fs module itself. The
 *  reconciler takes probes; if it can reach a disk, it can reach a write. */
const WRITE_SURFACE_RE =
  /applyEnginePatch|ensureEngineFrontmatter|stampEvalShas|writeFile|writeAtomic|mkdirSync|node:fs|setSpecStatus|markBacklogRowDone|withBacklogLock/;

describe("review isolation — the reconciler is pure (static)", () => {
  const rel = "src/lib/engine/position.ts";
  const text = readFileSync(join(REAL_REPO_ROOT, ...rel.split("/")), "utf8");

  it("has zero references to any write surface or to the filesystem", () => {
    const breaches = text
      .split("\n")
      .map((line, i) => (WRITE_SURFACE_RE.test(line) ? `${rel}:${i + 1}: ${line.trim()}` : null))
      .filter((b): b is string => b !== null);
    expect(breaches).toEqual([]);
  });

  it("the scan is honest — it would catch a write if one appeared", () => {
    // Negative control. Without this, a regex that stopped matching reports
    // zero breaches, therefore a pass, forever.
    expect(WRITE_SURFACE_RE.test("  fs.writeFile(p, c);")).toBe(true);
    expect(WRITE_SURFACE_RE.test("  applyEnginePatch(content, patch);")).toBe(true);
    expect(WRITE_SURFACE_RE.test("  const x = state.gateStatus.prd_validated;")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) Behavioural — the command writes nothing, ever
// ---------------------------------------------------------------------------

const SPEC_REL = "plan/plan-abc123-2026-11-20T09:00-demo-feature.md";
const WS = "_devx/workstreams/demo-feature";

/** `exec` seam: git answers deterministically and the test never spawns a
 *  process. The two probes the command makes are `log` and `status`; a
 *  `changedAt` of 1 for everything means no subject is newer than its
 *  evidence, so staleness never fires by accident. */
const fakeGit = (over: Record<string, string> = {}) =>
  (_cmd: string, args: string[]) => {
    const path = args[args.length - 1] ?? "";
    if (args[0] === "log") {
      return { stdout: over[path] ?? "1", stderr: "", exitCode: 0 };
    }
    return { stdout: "", stderr: "", exitCode: 0 };
  };

function seedRepo(flags: {
  stage: string;
  gates: [boolean, boolean, boolean, boolean];
  withReports: boolean;
}): EngineRepo {
  const repo = makeEngineRepo();
  const [prd, design, plan, evals] = flags.gates;
  repo.write(
    SPEC_REL,
    [
      "---",
      "hash: abc123",
      "type: plan",
      "status: in-progress",
      `stage: ${flags.stage}`,
      "gate_status:",
      `  prd_validated: ${prd}`,
      `  design_verified: ${design}`,
      `  plan_verified: ${plan}`,
      `  evals_red: ${evals}`,
      `workstream: ${WS}`,
      "---",
      "",
      "## Status log",
      "",
      "- seeded",
      "",
    ].join("\n"),
  );
  repo.mkdir(WS);
  repo.write(`${WS}/prd/agent.md`, validPrd());
  repo.write(`${WS}/expectations.md`, validExpectations());
  repo.write(`${WS}/design/agent.md`, "## Design\n\nreal.\n");
  repo.write(`${WS}/plan/agent.md`, validPlan());
  repo.write(`${WS}/evals/E-1_demo.ts`, "process.exit(1);\n");
  if (flags.withReports) {
    repo.write(
      `${WS}/decisions/2026-11-01-design-verify.md`,
      "---\ngate: PASS\n---\n",
    );
    repo.write(`${WS}/decisions/2026-11-01-plan-verify.md`, "---\ngate: PASS\n---\n");
    repo.write(`${WS}/evals/RED-report.md`, "---\ngate: PASS\n---\n");
  }
  return repo;
}

/** Every file in the repo, path → bytes, so "wrote nothing" is a claim about
 *  the whole tree and not just the spec. */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.set(relative(root, abs), `${statSync(abs).size}:${readFileSync(abs, "utf8")}`);
    }
  };
  walk(root);
  return out;
}

const CASES: Array<{ name: string; gates: [boolean, boolean, boolean, boolean]; stage: string; withReports: boolean; expect: string }> = [
  {
    name: "clean (gates green, every record present)",
    stage: "executing",
    gates: [true, true, true, true],
    withReports: true,
    expect: "CONCERNS", // the pre-verdict + unstamped advisories
  },
  {
    name: "premature closure (green gates, no records)",
    stage: "executing",
    gates: [true, true, true, true],
    withReports: false,
    expect: "BLOCKING",
  },
  {
    name: "illegal transition (plan green behind an open design)",
    stage: "plan",
    gates: [true, false, true, false],
    withReports: false,
    expect: "BLOCKING",
  },
];

describe.each(CASES)("devx workstream position — $name", (c) => {
  it("reports the expected verdict and writes nothing at all", () => {
    const repo = seedRepo({ stage: c.stage, gates: c.gates, withReports: c.withReports });
    try {
      const before = snapshot(repo.root);
      const io = captureIo();
      const code = runPosition([], { json: true }, {
        ...io,
        projectPath: repo.configPath,
        exec: fakeGit(),
      });

      // Advisory: a finding never changes the exit code. If this ever
      // returns 1 on a BLOCKING review, the CI job starts failing builds on
      // an advisory pass and the pass gets turned off.
      expect(code).toBe(0);
      const report = io.json() as { review: string };
      expect(report.review).toBe(c.expect);

      const after = snapshot(repo.root);
      expect([...after.keys()].sort(), "position created or removed a file").toEqual(
        [...before.keys()].sort(),
      );
      for (const [path, bytes] of before) {
        expect(after.get(path), `position modified ${path}`).toBe(bytes);
      }
    } finally {
      repo.cleanup();
    }
  });
});

describe("devx workstream position — the snapshot comparison is honest", () => {
  it("detects a modification when one really happens", () => {
    // Negative control for (b): a byte-identity check that cannot fail is a
    // check that proves nothing.
    const repo = seedRepo({ stage: "executing", gates: [true, true, true, true], withReports: true });
    try {
      const before = snapshot(repo.root);
      repo.write(`${WS}/design/agent.md`, "## Design\n\ntampered.\n");
      const after = snapshot(repo.root);
      expect(after.get(`${WS}/design/agent.md`)).not.toBe(
        before.get(`${WS}/design/agent.md`),
      );
    } finally {
      repo.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// (c) Vocabulary — review.md is not a verdict artifact
// ---------------------------------------------------------------------------

describe("review.md carries `review:`, never `gate:`", () => {
  const template = readFileSync(
    join(REAL_REPO_ROOT, "_devx", "templates", "engine", "review.md"),
    "utf8",
  );

  it("the shipped template does not parse as a gate verdict block", () => {
    // `parseVerdictBlock` keys on `gate:`. A review that parsed would be
    // readable as a gate's answer by every consumer of a gate report —
    // which is exactly the authority an advisory pass must not have.
    expect(parseVerdictBlock(template)).toBeNull();
  });

  it("a FILLED review still does not parse as one", () => {
    // The template's placeholders are not what makes it unparseable; the key
    // is. Substituting them must not change the answer.
    const filled = template
      .replace("<CLEAN | CONCERNS | BLOCKING>", "BLOCKING")
      .replace("<1–2 sentences>", "two gates have no record behind them")
      .replace("<YYYY-MM-DD>", "2026-11-20")
      .replace("{ blocking: <n>, advisory: <n>, coverage_pct: <n> }", "{ blocking: 2, advisory: 5, coverage_pct: 92 }");
    expect(parseVerdictBlock(filled)).toBeNull();
    expect(filled).toContain("review: BLOCKING");
  });

  it("the scan is honest — a real verdict block DOES parse", () => {
    expect(
      parseVerdictBlock("---\ngate: PASS\nstatus_reason: 'x'\nreviewer: 'y'\nupdated: 2026-11-20\n---\n"),
    ).not.toBeNull();
  });

  it("names no gate_status field it could be mistaken for writing", () => {
    for (const flag of ["prd_validated", "design_verified", "plan_verified", "evals_red"]) {
      expect(template, `the template names ${flag}`).not.toContain(flag);
    }
  });
});

// ---------------------------------------------------------------------------
// (d) Prose — the skill body states the refusal
// ---------------------------------------------------------------------------

describe("the /devx-review skill body carries its refusals", () => {
  const bodies = [".claude/commands/devx-review.md", "skills/devx-review.md"];

  it.each(bodies)("%s refuses to write gate state, outlines and todo.md", (rel) => {
    const body = readFileSync(join(REAL_REPO_ROOT, ...rel.split("/")), "utf8");
    // The three write surfaces a review could plausibly reach for, and the
    // one escape hatch that is correct (recommend `devx revise`).
    expect(body).toContain("Never writes `gate_status`");
    expect(body).toContain("Never writes an outline file");
    expect(body).toContain("Never edits `todo.md`");
    expect(body).toContain("devx revise");
    // No finding without a receipt — §25's rule, stated where the judgment
    // half of the pass will read it.
    expect(body).toContain("No finding without a receipt");
  });

  it.each(bodies)("%s computes the verdict rather than choosing it", (rel) => {
    const body = readFileSync(join(REAL_REPO_ROOT, ...rel.split("/")), "utf8");
    for (const word of ["BLOCKING", "CONCERNS", "CLEAN"]) {
      expect(body).toContain(word);
    }
    // Reconciled in place, never appended — the property that makes the file
    // a worklist rather than a changelog (the same rule outline critiques
    // live under). Case-insensitive: it is a sentence, not a marker.
    expect(body).toMatch(/reconcile it in place/i);
    expect(body).toMatch(/never append/i);
  });
});
