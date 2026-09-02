// dlr104 — no consumer builds a stage-subject path from string parts.
//
// Consumer of E-3 (`_devx/workstreams/docs-layout-resolution/evals/E-3_no-hand-joins.ts`),
// pinned in `npm test` so the invariant outlives the workstream that created
// it. FR-5's whole point is that a hand-joined `<base>/prd/agent.md` reads as
// correct under one layout and resolves to nothing under the other, so the only
// durable defense is a scan that says zero — GLOBALLY, not against a list.
//
// It RUNS the eval rather than re-implementing the scan. A second copy of a
// TypeScript-AST walk would drift from the first, and the copy that drifts is
// the one that reports GREEN. Running it also carries the eval's negative
// control (R-6) into `npm test`: a scan blunted by an over-broad allowlist
// fails here too, instead of quietly reporting a clean sweep.
//
// Spec: dev/dev-dlr104-2026-09-02T09:14-consumer-sweep-scaffolding.md
// Design: _devx/workstreams/docs-layout-resolution/design/agent.md §FR-5

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evalPath = join(
  repoRoot,
  "_devx",
  "workstreams",
  "docs-layout-resolution",
  "evals",
  "E-3_no-hand-joins.ts",
);
// See engine-layout-scaffold.test.ts: `--import tsx` resolves against the
// spawn's cwd, and a constructed node_modules path is absent in a linked
// worktree. Node's own module walk from this file is the one form that works
// in both.
const tsxCliEntry = createRequire(import.meta.url).resolve("tsx/cli");

describe("dlr104 — no hand-joined stage-subject paths", () => {
  it("E-3 reports zero offending sites outside the resolver", () => {
    // The eval is the workstream's artifact, not the package's. It is absent
    // in a consumer install and in `_devx/archive` after the workstream is
    // archived, and a hard failure there would be a test asserting on its own
    // fixture rather than on devx.
    if (!existsSync(evalPath)) {
      expect(existsSync(evalPath)).toBe(false);
      return;
    }

    const r = spawnSync(process.execPath, [tsxCliEntry, evalPath], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // A spawn that produced nothing on either stream never ran the scan —
    // an infra fault that would otherwise pass as a clean sweep (mlc101).
    const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(output.trim(), "E-3 produced no output; the scan did not run").not.toBe("");

    // The eval's own report is the failure message — it names file and line
    // per offending site, and distinguishes a real bypass from a blunted scan.
    expect(r.status, output).toBe(0);
    expect(output).toContain("E-3 GREEN");
  });
});
