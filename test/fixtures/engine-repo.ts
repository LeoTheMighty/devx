// Shared temp-repo fixture for the v2e101 engine tests. Builds a minimal
// devx project (devx.config.yaml + plan/ + the real engine templates) in a
// mkdtemp dir so every engine command can run in-process against real
// files. NOT a .test.ts — vitest's include pattern skips it.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REAL_REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export interface EngineRepo {
  root: string;
  configPath: string;
  write(rel: string, content: string): void;
  read(rel: string): string;
  exists(rel: string): boolean;
  mkdir(rel: string): void;
  cleanup(): void;
}

const DEFAULT_CONFIG = [
  "mode: YOLO",
  "projects:",
  "  - name: cli",
  "    path: .",
  '    test: "node --eval \\"process.exit(1)\\" --"',
  "",
].join("\n");

export function makeEngineRepo(opts: { config?: string } = {}): EngineRepo {
  const root = mkdtempSync(join(tmpdir(), "devx-engine-"));
  const configPath = join(root, "devx.config.yaml");
  writeFileSync(configPath, opts.config ?? DEFAULT_CONFIG, "utf8");
  mkdirSync(join(root, "plan"), { recursive: true });
  // Real templates: the scaffolder + prose-budget canary read the shipped
  // files, and the gate tests exercise real template furniture.
  cpSync(
    join(REAL_REPO_ROOT, "_devx", "templates", "engine"),
    join(root, "_devx", "templates", "engine"),
    { recursive: true },
  );
  return {
    root,
    configPath,
    write(rel: string, content: string): void {
      const abs = join(root, ...rel.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    },
    read(rel: string): string {
      return readFileSync(join(root, ...rel.split("/")), "utf8");
    },
    exists(rel: string): boolean {
      return existsSync(join(root, ...rel.split("/")));
    },
    mkdir(rel: string): void {
      mkdirSync(join(root, ...rel.split("/")), { recursive: true });
    },
    cleanup(): void {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/** Capture-buffer pair for the run* opts {out, err} seams. */
export function captureIo(): {
  out: (s: string) => void;
  err: (s: string) => void;
  stdout: () => string;
  stderr: () => string;
  json: () => unknown;
} {
  let so = "";
  let se = "";
  return {
    out: (s) => {
      so += s;
    },
    err: (s) => {
      se += s;
    },
    stdout: () => so,
    stderr: () => se,
    json: () => JSON.parse(so.trim().split("\n").pop() ?? "null"),
  };
}

// ---------------------------------------------------------------------------
// Canned valid Gate-1 inputs (3 E-blocks, 2 goals, all covered).
// ---------------------------------------------------------------------------

export function validPrd(): string {
  return [
    "# PRD — Demo Feature",
    "",
    "## Problem",
    "",
    "Reviews take too long and scope creep goes unnoticed.",
    "",
    "## Goals",
    "",
    "- **G-1**: review time per PR under 10 min by 2026-08-01",
    "- **G-2**: zero silent scope-creep incidents per month",
    "",
    "## Non-goals",
    "",
    "- Rewriting the CI system.",
    "",
    "## Users",
    "",
    "- **Primary**: solo maintainer",
    "",
    "## Use cases",
    "",
    "- **UC-1**: maintainer reviews a PR via the tour",
    "",
    "## Capabilities",
    "",
    "- **CAP-1**: tour generation from diffs",
    "",
    "## Feature requirements",
    "",
    "### FR-1: tour builder",
    "",
    "Builds a review tour from a PR diff.",
    "",
  ].join("\n");
}

export function validExpectations(): string {
  return [
    "# Expectations — Demo Feature",
    "",
    "## E-1: tour renders",
    "",
    "- **Priority:** P0",
    "- **Covers:** `G-1, UC-1, FR-1`",
    "- **Trigger:** a merged diff",
    "- **Expectation (EARS):** When a PR is opened, the system SHALL attach a tour.",
    "- **Threshold:** tour present on 100% of PRs",
    "- **Verified by:** test/demo.test.mjs",
    "",
    "## E-2: scope fence",
    "",
    "- **Priority:** P1",
    "- **Covers:** G-2, CAP-1",
    "- **Trigger:** a diff with extras",
    "- **Expectation (EARS):** When extras appear, the system SHALL flag them.",
    "- **Threshold:** at least 1 extras row per undeclared surface",
    "- **Verified by:** test/demo.test.mjs",
    "",
    "## E-3: perf",
    "",
    "- **Priority:** P2",
    "- **Covers:** G-1",
    "- **Trigger:** tour build on a large diff",
    "- **Expectation (EARS):** When the diff exceeds limits, the system SHALL build in under 8s.",
    "- **Threshold:** p95 under 8s",
    "- **Verified by:** test/perf.test.mjs",
    "",
  ].join("\n");
}

export function validPlan(): string {
  return [
    "# Plan — Demo Feature",
    "",
    "## Expectation coverage",
    "",
    "| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |",
    "|---|---|---|---|---|---|",
    "| E-1 | P0 | 1 | tests-first | test/demo.test.mjs | full |",
    "| E-2 | P1 | 2 | tests-after | test/demo.test.mjs | full |",
    "| E-3 | P2 | 2 | human | evals/E-3_perf.md | partial |",
    "",
  ].join("\n");
}

/** design-mode judgment table covering every ID in validPrd(). */
export function designTable(
  overrides: Partial<Record<string, string>> = {},
): string {
  const rows = ["G-1", "G-2", "UC-1", "CAP-1", "FR-1"].map((id) => ({
    id,
    status: overrides[id] ?? "covered",
    where: "Design §1",
  }));
  return JSON.stringify({ rows });
}

/** plan-mode judgment table covering every E-id in validExpectations(). */
export function planTable(
  overrides: Partial<Record<string, Partial<{ status: string; artifact: string | null }>>> = {},
): string {
  const rows = [
    { id: "E-1", status: "covered", where: "phase 1", artifact: "test/demo.test.mjs" as string | null },
    { id: "E-2", status: "covered", where: "phase 2", artifact: "test/demo.test.mjs" as string | null },
    { id: "E-3", status: "covered", where: "phase 2", artifact: "evals/E-3_perf.md" as string | null },
  ].map((row) => {
    const o = overrides[row.id];
    return o === undefined
      ? row
      : {
          ...row,
          ...(o.status !== undefined ? { status: o.status } : {}),
          ...(o.artifact !== undefined ? { artifact: o.artifact } : {}),
        };
  });
  return JSON.stringify({
    rows: rows.map((r) => (r.artifact === null ? { ...r, artifact: undefined } : r)),
  });
}
