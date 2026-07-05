// `devx tour <subcommand>` — CLI passthrough for the static review tour
// (v2t101). Same trio pattern as pr-body/merge-gate: the skill body does the
// judgment (narration), these subcommands do the deterministic work.
//
// Surface:
//   devx tour gather <hash>                     → gather JSON on stdout (the
//                                                 narrating agent's input)
//   devx tour validate --tour-json <path>       → schema check only; typed
//                                                 errors JSON on stdout
//   devx tour build <hash> --tour-json <path>   → validate + render the
//                                                 single-file tour.html to
//                                                 .devx-cache/tours/<hash>/
//   devx tour publish <hash>                    → commit to the orphan
//                                                 devx-tours branch (race-
//                                                 safe) + print the two URLs
//   devx tour prune [--keep <n>]                → drop merged-PR tours
//                                                 beyond retention
//
// Exit codes (shell-consumed by the /devx skill body; tour failures are
// FAIL-SOFT there — the PR opens regardless):
//   • 0  → success. JSON on stdout.
//   • 3  → tour.json failed validation. JSON `{errors: [{path, message}]}`
//          on stdout — the narrating agent fixes + retries on these.
//   • 2  → git/gh/render trouble. JSON `{error, stage}` on stdout; stderr
//          has detail.
//   • 65 → I/O failure (no config, no spec, no tour.json file).
//   • 64 → usage error. stderr only.
//
// Spec: dev/dev-v2t101-2026-07-05T13:04-review-tour.md
// Design: v2/03-review-tour.md

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import {
  GatherError,
  type GatherConfig,
  gatherTour,
} from "../lib/tour/gather.js";
import { TourRenderError, buildTourHtml } from "../lib/tour/render.js";
import {
  DEFAULT_PRUNE_KEEP,
  TourPublishError,
  pruneTours,
  publishTour,
} from "../lib/tour/publish.js";
import { validateTour } from "../lib/tour/schema.js";
import type { Exec } from "../lib/tour/exec.js";

const HASH_RE = /^[a-z0-9]{3,12}$/i;

export interface RunTourOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: explicit repo root (defaults to dirname of resolved config). */
  repoRoot?: string;
  /** Test seam: shell-out replacement. */
  exec?: Exec;
  /** Test seam: forwarded to publish/prune. */
  maxAttempts?: number;
}

interface ResolvedProject {
  repoRoot: string;
  config: GatherConfig;
}

function resolveProject(
  cmdName: string,
  opts: RunTourOpts,
  err: (s: string) => void,
): ResolvedProject | number {
  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath && !opts.repoRoot) {
    err(`devx tour ${cmdName}: devx.config.yaml not found (walked up from cwd)\n`);
    return 65;
  }
  const repoRoot =
    opts.repoRoot ?? dirname(projectConfigPath as string);
  let config: GatherConfig = {};
  if (projectConfigPath) {
    try {
      const raw = loadMerged({ projectPath: projectConfigPath });
      config = (raw && typeof raw === "object" ? raw : {}) as GatherConfig;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      err(`devx tour ${cmdName}: config load failed: ${msg}\n`);
      return 65;
    }
  }
  return { repoRoot, config };
}

function validateHash(
  cmdName: string,
  hash: string,
  err: (s: string) => void,
): boolean {
  if (!HASH_RE.test(hash)) {
    err(
      `devx tour ${cmdName}: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// gather
// ---------------------------------------------------------------------------

export function runTourGather(hash: string, opts: RunTourOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  if (!validateHash("gather", hash, err)) return 64;

  const proj = resolveProject("gather", opts, err);
  if (typeof proj === "number") return proj;

  try {
    const gathered = gatherTour(hash, {
      repoRoot: proj.repoRoot,
      config: proj.config,
      exec: opts.exec,
    });
    out(`${JSON.stringify(gathered)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof GatherError) {
      if (e.stage === "no-spec") {
        err(`devx tour gather: ${e.message}\n`);
        return 65;
      }
      out(`${JSON.stringify({ error: "gather-failed", stage: e.stage })}\n`);
      err(`devx tour gather: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "gather-failed", stage: "unknown" })}\n`);
    err(`devx tour gather: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// validate / build
// ---------------------------------------------------------------------------

function readTourJson(
  cmdName: string,
  tourJsonPath: string,
  out: (s: string) => void,
  err: (s: string) => void,
): { json: unknown } | number {
  // Relative paths resolve against CWD (not the repo root): tour.json is a
  // scratch file the narrating agent just wrote wherever it's standing —
  // `cd sub/ && devx tour build ... --tour-json ./tour.json` must read
  // sub/tour.json, not silently pick up a stale same-named file at the
  // repo root (self-review finding, Edge Case Hunter #12).
  const abs = isAbsolute(tourJsonPath) ? tourJsonPath : resolve(tourJsonPath);
  if (!existsSync(abs)) {
    err(`devx tour ${cmdName}: tour.json not found: ${tourJsonPath}\n`);
    return 65;
  }
  try {
    return { json: JSON.parse(readFileSync(abs, "utf8")) as unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Malformed JSON is a validation-class failure (the agent emitted it) —
    // exit 3 with a typed error so the retry protocol covers it too.
    out(
      `${JSON.stringify({ errors: [{ path: "", message: `tour.json is not valid JSON: ${msg}` }] })}\n`,
    );
    err(`devx tour ${cmdName}: tour.json parse failed: ${msg}\n`);
    return 3;
  }
}

export function runTourValidate(
  tourJsonPath: string,
  opts: RunTourOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // Validation is pure over the tour.json contents — no project config /
  // repo needed, so none is required (usable in scratch dirs + CI shards).
  const read = readTourJson("validate", tourJsonPath, out, err);
  if (typeof read === "number") return read;

  const errors = validateTour(read.json);
  if (errors.length > 0) {
    out(`${JSON.stringify({ errors })}\n`);
    err(
      `devx tour validate: ${errors.length} schema error(s) — fix tour.json and retry\n`,
    );
    return 3;
  }
  out(`${JSON.stringify({ valid: true })}\n`);
  return 0;
}

export function runTourBuild(
  hash: string,
  tourJsonPath: string,
  opts: RunTourOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  if (!validateHash("build", hash, err)) return 64;

  const proj = resolveProject("build", opts, err);
  if (typeof proj === "number") return proj;

  const read = readTourJson("build", tourJsonPath, out, err);
  if (typeof read === "number") return read;

  try {
    const result = buildTourHtml(hash, read.json, proj.repoRoot);
    out(`${JSON.stringify({ outPath: result.outPath })}\n`);
    return 0;
  } catch (e) {
    if (e instanceof TourRenderError) {
      if (e.stage === "validate") {
        out(
          `${JSON.stringify({ errors: e.validationErrors ?? [{ path: "", message: e.message }] })}\n`,
        );
        err(`devx tour build: ${e.message} — fix tour.json and retry\n`);
        return 3;
      }
      out(`${JSON.stringify({ error: "render-failed", stage: e.stage })}\n`);
      err(`devx tour build: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "render-failed", stage: "unknown" })}\n`);
    err(`devx tour build: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// publish / prune
// ---------------------------------------------------------------------------

export function runTourPublish(hash: string, opts: RunTourOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  if (!validateHash("publish", hash, err)) return 64;

  const proj = resolveProject("publish", opts, err);
  if (typeof proj === "number") return proj;

  try {
    const result = publishTour(hash, {
      repoRoot: proj.repoRoot,
      exec: opts.exec,
      maxAttempts: opts.maxAttempts,
    });
    out(`${JSON.stringify(result)}\n`);
    // Human-scannable echo of the two links (stderr — stdout stays JSON).
    err(`tour published:\n  ${result.htmlpreviewUrl}\n  ${result.rawUrl}\n`);
    return 0;
  } catch (e) {
    if (e instanceof TourPublishError) {
      if (e.stage === "no-tour-file") {
        err(`devx tour publish: ${e.message}\n`);
        return 65;
      }
      out(`${JSON.stringify({ error: "publish-failed", stage: e.stage })}\n`);
      err(`devx tour publish: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "publish-failed", stage: "unknown" })}\n`);
    err(`devx tour publish: unexpected error: ${msg}\n`);
    return 2;
  }
}

export function runTourPrune(
  keepRaw: string | undefined,
  opts: RunTourOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  let keep = DEFAULT_PRUNE_KEEP;
  if (keepRaw !== undefined) {
    const n = Number.parseInt(keepRaw, 10);
    if (!Number.isInteger(n) || n < 0 || String(n) !== keepRaw.trim()) {
      err(
        `devx tour prune: --keep expects a non-negative integer, got '${keepRaw}'\n`,
      );
      return 64;
    }
    keep = n;
  }

  const proj = resolveProject("prune", opts, err);
  if (typeof proj === "number") return proj;

  // Feature-branch prefix mirrors the claim/derive-branch convention so the
  // merged-PR lookup targets the branches /devx actually opened.
  const prefix = `${proj.config.git?.branch_prefix ?? "feat/"}dev-`;

  try {
    const result = pruneTours({
      repoRoot: proj.repoRoot,
      exec: opts.exec,
      keep,
      featureBranchPrefix: prefix,
      maxAttempts: opts.maxAttempts,
    });
    out(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (e) {
    if (e instanceof TourPublishError) {
      out(`${JSON.stringify({ error: "prune-failed", stage: e.stage })}\n`);
      err(`devx tour prune: ${e.message}\n`);
      return 2;
    }
    const msg = e instanceof Error ? e.message : String(e);
    out(`${JSON.stringify({ error: "prune-failed", stage: "unknown" })}\n`);
    err(`devx tour prune: unexpected error: ${msg}\n`);
    return 2;
  }
}

// ---------------------------------------------------------------------------
// commander wiring
// ---------------------------------------------------------------------------

export function register(program: Command): void {
  const sub = program
    .command("tour")
    .description(
      "Static HTML review tour for a spec's PR (v2t101). gather → (agent narrates) → build → publish; prune for retention. See v2/03-review-tour.md.",
    );

  sub
    .command("gather")
    .description(
      "Emit the deterministic tour inputs as JSON: spec Goal/ACs/frontmatter, git diff <base>...<branch>, numstat, commits, changed files. The narrating agent consumes this to write tour.json.",
    )
    .argument("<hash>", "spec hash (e.g. 'v2t101')")
    .action((hash: string) => {
      const code = runTourGather(hash);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("validate")
    .description(
      "Validate an agent-emitted tour.json against the tour schema. Exit 3 + typed errors JSON on mismatch (the agent retry protocol); exit 0 when valid.",
    )
    .requiredOption("--tour-json <path>", "path to the tour.json to validate")
    .action((options: { tourJson: string }) => {
      const code = runTourValidate(options.tourJson);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("build")
    .description(
      "Validate tour.json + render the single self-contained tour.html to .devx-cache/tours/<hash>/. Inlines diff2html + marked from node_modules; zero network requests.",
    )
    .argument("<hash>", "spec hash (e.g. 'v2t101')")
    .requiredOption("--tour-json <path>", "path to the narrated tour.json")
    .action((hash: string, options: { tourJson: string }) => {
      const code = runTourBuild(hash, options.tourJson);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("publish")
    .description(
      "Commit .devx-cache/tours/<hash>/tour.html to the orphan devx-tours branch (fetch + retry on non-fast-forward — race-safe for parallel agents) and print the htmlpreview + raw URLs. Never touches the current worktree/branch.",
    )
    .argument("<hash>", "spec hash (e.g. 'v2t101')")
    .action((hash: string) => {
      const code = runTourPublish(hash);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("prune")
    .description(
      `Remove tours for MERGED PRs beyond retention from the devx-tours branch (unmerged tours always survive). Default --keep ${DEFAULT_PRUNE_KEEP}.`,
    )
    .option("--keep <n>", "how many merged-PR tours to retain")
    .action((options: { keep?: string }) => {
      const code = runTourPrune(options.keep);
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
