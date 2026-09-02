// Shared fixture builder for the docs-layout-resolution RED evals.
// Not a Verified-by target — imported by E-*.ts scripts.
//
// Builds a throwaway git repo carrying ONE engine workstream, in either
// `engine.docs_layout` shape, with byte-identical artifact CONTENT across the
// two. That equality is the whole point: E-1 asserts the gates return the
// same verdict for the same bytes regardless of where those bytes live, so
// the fixture must differ only in path, never in content.

import { execFileSync } from "node:child_process";
import ts from "typescript";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

// tsx resolved via Node's module walk, not path construction: a linked
// worktree has no node_modules of its own (the main checkout's is found by
// upward resolution), so `<repoRoot>/node_modules/.bin/tsx` silently doesn't
// exist there and every runCli would spawn-fail with EMPTY OUTPUT — which
// reads exactly like a legitimate RED and is not one (mlc101, E-2).
const tsxCliEntry = createRequire(import.meta.url).resolve("tsx/cli");
export const nodeBin = process.execPath;
export const tsxArgs = [tsxCliEntry];
export const cliPath = join(repoRoot, "src", "cli.ts");

export type Layout = "workstream" | "project-level";
export const LAYOUTS: readonly Layout[] = ["workstream", "project-level"];

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "eval",
  GIT_AUTHOR_EMAIL: "eval@example.com",
  GIT_COMMITTER_NAME: "eval",
  GIT_COMMITTER_EMAIL: "eval@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

/** git that returns its exit code instead of throwing (for `git status`
 *  byte-identity probes around a refusal). */
export function gitSafe(cwd: string, ...args: string[]): CliResult {
  try {
    return {
      status: 0,
      stdout: execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }),
      stderr: "",
    };
  } catch (err) {
    const e = err as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      status: e.status ?? -1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

export function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): CliResult {
  try {
    const stdout = execFileSync(nodeBin, [...tsxArgs, cliPath, ...args], {
      cwd,
      env: { ...GIT_ENV, ...env },
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      status: e.status ?? -1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

/** A spawn that produced nothing on either stream did not run the CLI at
 *  all — a harness fault wearing a RED's clothes. Every eval routes its
 *  CLI reads through this so an infra break is reported as an infra break. */
export function assertRan(res: CliResult, what: string): string | null {
  if (res.stdout.trim() === "" && res.stderr.trim() === "") {
    return `INFRA — \`${what}\` produced no output on either stream (status ${res.status}); the CLI never spawned. Fix the harness before reading this as RED.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Workstream fixture.
// ---------------------------------------------------------------------------

const TS = "2026-09-02T09:00";

/** Where each artifact lands, per layout. The fixture spells this out by
 *  hand ON PURPOSE: routing it through the resolver under test would make
 *  every eval tautological. This table is the §15 contract, transcribed. */
export function artifactRel(layout: Layout, slugRel: string, kind: string): string {
  const flat = layout === "project-level";
  const under = (p: string) => (flat ? p : `${slugRel}/${p}`);
  switch (kind) {
    case "prd":
      return under(flat ? "prd.md" : "prd/agent.md");
    case "prd-human":
      return under(flat ? "prd-human.md" : "prd/human.md");
    case "design":
      return under(flat ? "design.md" : "design/agent.md");
    case "design-human":
      return under(flat ? "design-human.md" : "design/human.md");
    case "plan":
      return under(flat ? "plan.md" : "plan/agent.md");
    case "expectations":
      return under("expectations.md");
    case "todo":
      return under("todo.md");
    case "evals":
      return under("evals");
    case "red-report":
      return under("evals/RED-report.md");
    case "decisions":
      return under("decisions");
    case "checkpoints":
      return under("checkpoints");
    case "results":
      return under("RESULTS.md");
    default:
      throw new Error(`_fixture: unknown artifact kind '${kind}'`);
  }
}

export interface WsFixtureOpts {
  prefix: string;
  layout: Layout;
  hash?: string;
  slug?: string;
  /** Frontmatter `workstream:` value. `undefined` → the key is omitted. */
  workstreamValue?: string | undefined;
  stage?: string;
  gateStatus?: Record<string, boolean>;
  gateVerdicts?: Record<string, string>;
  /** Write the PRD + expectations doc set. Off for scaffolding evals. */
  withDocs?: boolean;
  /** Also write the design artifact. */
  withDesign?: boolean;
  /** Also write plan/agent.md, carrying this Expectation-coverage table body
   *  (rows only; the header is supplied). */
  withPlan?: boolean;
  /** evals/ artifacts to write: basename → file body. */
  evalArtifacts?: Record<string, string>;
  /** Deliberately break the PRD so a gate FAILs (E-1's non-mutual-failure leg). */
  brokenPrd?: boolean;
  /** Leave the tree dirty after the initial commit. */
  dirty?: boolean;
  /** Extra committed files, repo-relative → content. */
  extraFiles?: Record<string, string>;
}

export interface WsFixture {
  root: string;
  layout: Layout;
  hash: string;
  slug: string;
  /** Workstream dir relative to the repo root ("." under project-level). */
  slugRel: string;
  specRel: string;
  rel(kind: string): string;
  abs(kind: string): string;
  cleanup(): void;
}

/** A PRD that passes `devx gate prd`, and its expectations. Content is
 *  IDENTICAL in both layouts — only the path moves. */
function prdBody(title: string, broken: boolean): string {
  // Section names are REQUIRED_PRD_SECTIONS verbatim (gate-prd.ts:63) and IDs
  // use the `**G-1**` bold form extractDefinedIds() matches (:158). The
  // "broken" variant breaks CONTENT, never structure — a structurally invalid
  // PRD would fail identically in both layouts for a reason that has nothing
  // to do with subject resolution.
  return [
    `# PRD — ${title}`,
    "",
    "## Problem",
    "",
    "The artifact tree has two shapes and one of them is unimplemented.",
    "",
    "## Goals",
    "",
    "- **G-1**: cut layout-path defects to 0 by 2026-12-31.",
    "",
    "## Non-goals",
    "",
    "- A third layout.",
    "",
    "## Users",
    "",
    "- A solo author running the engine on one repo.",
    "",
    "## Use cases",
    "",
    "- **UC-1**: An author runs a gate on a flat-layout repo.",
    "",
    "## Capabilities",
    "",
    "- **CAP-1**: Layout-aware subject resolution.",
    "",
    "## Feature requirements",
    "",
    "- **FR-1**: A gate resolves its subject through the layout.",
    "",
    "## Evals seed",
    "",
    broken ? "See expectations.md." : "See expectations.md.",
    "",
  ].join("\n");
}

function expectationsBody(broken: boolean): string {
  // The broken variant drops the EARS sentence — a real Gate-1 gap that is
  // purely about CONTENT, so both layouts must reach it and both must FAIL.
  const block = (n: number, prio: string) =>
    [
      `## E-${n}: Layout-independent verdict ${n}`,
      "",
      `- **Priority:** ${prio}`,
      "- **Covers:** `G-1, UC-1, CAP-1, FR-1`",
      `- **Trigger:** \`devx gate prd\` under each layout, run ${n}.`,
      broken
        ? "- **Expectation (EARS):** it should probably work."
        : "- **Expectation (EARS):** When a gate runs under either layout, the system SHALL return the identical verdict for identical content.",
      "- **Threshold:** 0 verdict differences across both layouts.",
      // Deliberately NOT the on-disk artifact. gate-evals prefers the plan's
      // coverage-table row and falls back to this only when it cannot read
      // the plan — so this divergence is what makes the plan-subject read
      // observable through the evals gate instead of silently uniform.
      `- **Verified by:** \`evals/E-${n}_deferred.ts\``,
      "",
    ].join("\n");
  return [
    "# Expectations — fixture",
    "",
    block(1, "P0"),
    block(2, "P1"),
    block(3, "P1"),
  ].join("\n");
}

function designBody(title: string): string {
  return [
    `# Design — ${title}`,
    "",
    "## Overview",
    "",
    "One resolver owns the layout decision. Covers G-1, G-2, UC-1, CAP-1, FR-1.",
    "",
    "## Constraints",
    "",
    "- Layout is never a gate input.",
    "",
    "## Design",
    "",
    "### The resolver",
    "",
    "`stageSubject(layout, base, kind)`.",
    "",
    "## Migration plan",
    "",
    "One command.",
    "",
  ].join("\n");
}

/** A plan whose Expectation-coverage table names the fixture's eval
 *  artifacts — the table `gate evals` reads its targets out of. */
function planBody(title: string): string {
  return [
    `# Plan — ${title}`,
    "",
    "## Current state",
    "",
    "Layout-blind.",
    "",
    "## Desired state",
    "",
    "Layout-aware.",
    "",
    "## Expectation coverage",
    "",
    "| E-id | Priority | Verified in phase | Validation type | Eval artifact | Coverage |",
    "|---|---|---|---|---|---|",
    "| E-1 | P0 | 1 | tests-first | `evals/E-1_fixture.ts` | full |",
    "| E-2 | P1 | 1 | tests-first | `evals/E-2_fixture.ts` | full |",
    "| E-3 | P1 | 1 | tests-first | `evals/E-3_fixture.ts` | full |",
    "",
    "## Phase checklist",
    "",
    "- [ ] Phase 1: Do the thing",
    "",
    "## Phases",
    "",
    "### 1. Phase: Do the thing",
    "",
    "**Overview**: The whole thing.",
    "",
    "**Verification plan**:",
    "- Type: tests-first",
    "- Success criteria: it works.",
    "",
    "**Tasks**:",
    "- [ ] T1.1 Do it — files: `src/x.ts`",
    "",
  ].join("\n");
}

export function mkWorkstreamFixture(opts: WsFixtureOpts): WsFixture {
  const layout = opts.layout;
  const hash = opts.hash ?? "b7e38f";
  const slug = opts.slug ?? "scene-engine";
  const root = mkdtempSync(join(tmpdir(), `${opts.prefix}-`));
  const slugRel = layout === "project-level" ? "." : `_devx/workstreams/${slug}`;

  git(root, "init", "-b", "main");

  // Config: the fixture's ONLY layout difference outside path spelling.
  writeFileSync(
    join(root, "devx.config.yaml"),
    [
      "mode: YOLO",
      "project:",
      "  shape: empty-dream",
      "thoroughness: send-it",
      "git:",
      "  default_branch: main",
      "  integration_branch: null",
      "engine:",
      "  workstreams_root: _devx/workstreams",
      `  docs_layout: ${layout}`,
      "  expectations_min: 3",
      "  prose_budget_kb: 60",
      // BOTH runners are `npx tsx` on purpose. devx's real config gives the
      // `.` project `npm test`, so under project-level (where evals/ sits at
      // the repo root) `resolveRunner` would pick it and E-1 would be
      // measuring runner selection instead of subject resolution. That is a
      // real defect, but it belongs to whoever owns the runner table — not
      // to an eval whose threshold is "0 verdict differences".
      "projects:",
      "  - name: cli",
      "    path: .",
      "    test: npx tsx",
      "  - name: workstream-evals",
      "    path: _devx/workstreams",
      "    test: npx tsx",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n.worktrees/\n");
  for (const f of ["DEV.md", "PLAN.md", "DEBUG.md", "TEST.md", "INTERVIEW.md", "MANUAL.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }

  // Shipped engine templates — `devx workstream new` and `devx todo sync`
  // read these from the repo under test, not from devx's own checkout.
  cpSync(
    join(repoRoot, "_devx", "templates", "engine"),
    join(root, "_devx", "templates", "engine"),
    { recursive: true },
  );

  // Plan spec.
  const gateStatus = opts.gateStatus ?? {
    prd_validated: false,
    design_verified: false,
    plan_verified: false,
    evals_red: false,
  };
  const wsLine =
    "workstreamValue" in opts
      ? opts.workstreamValue === undefined
        ? null
        : `workstream: ${opts.workstreamValue}`
      : `workstream: ${slugRel}`;
  const verdicts = opts.gateVerdicts ?? {};
  mkdirSync(join(root, "plan"), { recursive: true });
  const specName = `plan-${hash}-${TS}-${slug}.md`;
  writeFileSync(
    join(root, "plan", specName),
    [
      "---",
      `hash: ${hash}`,
      "type: plan",
      `created: ${TS}:00-06:00`,
      `title: Fixture ${slug}`,
      "status: in-progress",
      `stage: ${opts.stage ?? "prd"}`,
      "entered_at: prd",
      "gate_status:",
      ...Object.entries(gateStatus).map(([k, v]) => `  ${k}: ${v}`),
      "outcome:",
      "  status: null",
      "  measure_by: null",
      ...(wsLine === null ? [] : [wsLine]),
      ...(Object.keys(verdicts).length > 0
        ? ["gate_verdicts:", ...Object.entries(verdicts).map(([k, v]) => `  ${k}: ${v}`)]
        : []),
      "---",
      "",
      "## Goal",
      "",
      `Fixture workstream ${slug}.`,
      "",
      "## Status log",
      "",
      `- ${TS} — scaffolded (fixture).`,
      "",
    ].join("\n"),
  );

  const rel = (kind: string) => artifactRel(layout, slugRel, kind);
  const abs = (kind: string) => join(root, ...rel(kind).split("/").filter((s) => s !== "."));

  if (opts.withDocs !== false) {
    const write = (kind: string, body: string) => {
      const target = abs(kind);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    };
    write("prd", prdBody(slug, opts.brokenPrd === true));
    write("expectations", expectationsBody(opts.brokenPrd === true));
    write("prd-human", `# PRD (human) — ${slug}\n\nDigest.\n`);
    write("todo", readFileSync(join(repoRoot, "_devx", "templates", "engine", "todo.md"), "utf8"));
    for (const d of ["decisions", "checkpoints", "evals"]) {
      mkdirSync(abs(d), { recursive: true });
      writeFileSync(join(abs(d), ".gitkeep"), "");
    }
    if (opts.withDesign === true) {
      write("design", designBody(slug));
      write("design-human", `# Design (human) — ${slug}\n\nDigest.\n`);
    }
    if (opts.withPlan === true) write("plan", planBody(slug));
    for (const [name, body] of Object.entries(opts.evalArtifacts ?? {})) {
      writeFileSync(join(abs("evals"), name), body);
    }
  }

  for (const [p, content] of Object.entries(opts.extraFiles ?? {})) {
    const target = join(root, ...p.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  git(root, "add", "-A");
  git(root, "commit", "-m", "fixture: init", "--no-gpg-sign");

  if (opts.dirty === true) {
    writeFileSync(join(root, "DEV.md"), "# DEV\n\nuncommitted edit\n");
  }

  return {
    root,
    layout,
    hash,
    slug,
    slugRel,
    specRel: `plan/${specName}`,
    rel,
    abs,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// Source-scanning helpers (E-2 / E-3 / E-8 read devx's own src/).
// ---------------------------------------------------------------------------

/** Every `.ts` file under `src/`, repo-relative POSIX, sorted. */
export function srcFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "src/**/*.ts", "src/*.ts"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return out.split("\n").filter((l) => l.endsWith(".ts")).sort();
}

export function readSrc(rel: string): string {
  return readFileSync(join(repoRoot, ...rel.split("/")), "utf8");
}

/** Thrown when a source file cannot be parsed. Every scan eval treats this as
 *  INFRA, never as a finding: a scanner that silently produces garbage blanks
 *  real code and then reports 0 findings and GREEN. */
export class ScanDesync extends Error {}

/**
 * Blank out comments and the CONTENT of string, template and regex literals,
 * leaving code. Line count and column offsets are preserved (non-newline
 * characters become spaces) so a hit's reported line still points at source.
 *
 * Parsed with TypeScript's own parser rather than a hand-rolled walk. Two
 * hand-rolled versions were tried first and both silently mangled devx's own
 * sources — a regex sweep let a `/*` inside a string swallow 40 lines of
 * `init-write.ts` (including the `docs_layout` read E-2 exists to count), and
 * a stateful walk desynced on nested template literals in `outcome.ts`. Both
 * failed the same way: they blanked real code and the scan reported GREEN.
 * A scan whose correctness is the whole basis of a P0 verdict does not get to
 * approximate its own lexer.
 *
 * Comments are stripped in a second pass, by regex — safe there and only
 * there, because every string literal has already been emptied, so no `//`
 * or `/*` can be hiding inside one.
 */
export function codeOnly(src: string): string {
  const sf = ts.createSourceFile(
    "scan.ts",
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
  if ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length) {
    const d = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics[0];
    throw new ScanDesync(
      `parse error at position ${d.start ?? 0}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`,
    );
  }

  const buf = src.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < buf.length; i++) {
      if (buf[i] !== "\n") buf[i] = " ";
    }
  };

  // Blank literal CONTENT, keep every delimiter (`"`, `` ` ``, `${`, `}`, `/`)
  // so the surviving text still tokenizes the way the source did.
  const walk = (n: ts.Node): void => {
    switch (n.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.RegularExpressionLiteral:
        blank(n.getStart(sf) + 1, n.end - 1);
        return;
      case ts.SyntaxKind.TemplateHead:      // `…${   → keep 1 leading, 2 trailing
      case ts.SyntaxKind.TemplateMiddle:    // }…${   → keep 1 leading, 2 trailing
        blank(n.getStart(sf) + 1, n.end - 2);
        return;
      case ts.SyntaxKind.TemplateTail:      // }…`    → keep 1 leading, 1 trailing
        blank(n.getStart(sf) + 1, n.end - 1);
        return;
      default:
        // Interpolated expressions inside a template are ordinary code and
        // forEachChild walks into them — which is the whole reason this is a
        // parser and not a state machine.
        ts.forEachChild(n, walk);
    }
  };
  ts.forEachChild(sf, walk);

  // Second pass: comments. Every string body is empty by now, so nothing can
  // be hiding a comment opener.
  return buf
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}
