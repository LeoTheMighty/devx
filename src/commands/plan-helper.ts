// `devx plan-helper <subcommand>` — CLI passthrough for the `/devx-plan`
// skill body. Mirrors the mrg102 pattern: skill body invokes a small Bash
// helper, helper does the deterministic work, skill body uses the result.
//
// Phase 1 surface:
//   - derive-branch <type> <hash> (pln101)
//   - emit-retro-story --epic-slug <slug> --parents <h1,h2,...> --plan <path>
//     (pln102)
// Phase 1 follow-ups:
//   - pln103 adds `validate-emit <epic-slug>`.
//
// Exit codes — same shape across subcommands:
//   0  — success; derived value printed on stdout. Partial-but-acceptable
//        outcomes (e.g. emit-retro-story's "spec wrote, sprint-status
//        rename failed") are also exit 0 with a `WARN:` on stderr — the
//        skill body greps stderr to detect partials. (Mirrors `devx
//        pr-body`'s unresolved-placeholder pattern from prt102.)
//   1  — invalid input or pre-write failure (missing devx.config.yaml,
//        bad arg shape, epic not found in DEV.md / sprint-status.yaml,
//        spec already exists). Reason on stderr; no fs side-effects.
//   2  — usage error from commander (handled by commander itself).
//
// Specs:
//   dev/dev-pln101-2026-04-28T19:30-plan-derive-branch.md (derive-branch)
//   dev/dev-pln102-2026-04-28T19:30-plan-emit-retro.md   (emit-retro-story)
// Epic: _bmad-output/planning-artifacts/epic-devx-plan-skill.md

import { dirname } from "node:path";
import process from "node:process";

import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import {
  type DeriveBranchConfig,
  deriveBranch,
} from "../lib/plan/derive-branch.js";
import {
  emitRetroStory,
  writeRetroAtomically,
} from "../lib/plan/emit-retro-story.js";

// Spec convention from CLAUDE.md: type ∈ {dev, plan, test, debug, focus, learn, qa}.
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "dev",
  "plan",
  "test",
  "debug",
  "focus",
  "learn",
  "qa",
]);

// Mirrors merge-gate.ts's hash regex — alphanum 3-12 chars covers every
// existing hash (aud101, mrg102, a10001, …) plus a little headroom.
const HASH_RE = /^[a-z0-9]{3,12}$/i;

export interface RunDeriveBranchOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
}

export function runDeriveBranch(
  args: string[],
  opts: RunDeriveBranchOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  if (args.length !== 2) {
    err("usage: devx plan-helper derive-branch <type> <hash>\n");
    return 1;
  }
  const [type, hash] = args;

  if (!KNOWN_TYPES.has(type)) {
    err(
      `devx plan-helper derive-branch: invalid type '${type}' (expected one of: ${[...KNOWN_TYPES].join(", ")})\n`,
    );
    return 1;
  }
  if (!HASH_RE.test(hash)) {
    err(
      `devx plan-helper derive-branch: invalid hash '${hash}' (expected hex/alnum 3-12 chars)\n`,
    );
    return 1;
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err(
      "devx plan-helper derive-branch: devx.config.yaml not found (walked up from cwd)\n",
    );
    return 1;
  }

  let merged: DeriveBranchConfig;
  try {
    const raw = loadMerged({ projectPath: projectConfigPath });
    // Same defensive narrow as merge-gate.ts: treat null/non-object as empty
    // so a config with no `git:` section still produces a default branch.
    merged = (raw && typeof raw === "object" ? raw : {}) as DeriveBranchConfig;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx plan-helper derive-branch: config load failed: ${msg}\n`);
    return 1;
  }

  out(`${deriveBranch(merged, type, hash)}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// emit-retro-story — pln102
// ---------------------------------------------------------------------------

export interface RunEmitRetroStoryOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: project repo root (defaults to dirname of resolved config). */
  repoRoot?: string;
  /** Test seam: stable Date for spec timestamps. */
  now?: () => Date;
  /** Test seam: partial fs override forwarded into writeRetroAtomically. */
  fsOverride?: Parameters<typeof writeRetroAtomically>[1]["fs"];
}

export interface ParsedEmitArgs {
  epicSlug: string;
  parents: string[];
  planPath: string;
}

/** Parse the arg list into the three required fields. Throws on usage error. */
function parseEmitArgs(args: string[]): ParsedEmitArgs {
  let epicSlug: string | null = null;
  let parents: string[] | null = null;
  let planPath: string | null = null;
  // `--flag --next` should report "missing value for --flag" rather than
  // silently treating "--next" as the value. Same for end-of-args.
  const takeValue = (flag: string, i: number): string => {
    const next = args[i];
    if (next === undefined || next.startsWith("--")) {
      throw new Error(
        `missing value for ${flag}` +
          (next === undefined ? " (end of args)" : ` (got '${next}')`),
      );
    }
    return next;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--epic-slug") {
      if (epicSlug !== null) throw new Error("duplicate --epic-slug");
      epicSlug = takeValue("--epic-slug", ++i);
    } else if (a === "--parents") {
      if (parents !== null) throw new Error("duplicate --parents");
      const raw = takeValue("--parents", ++i);
      parents = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (a === "--plan") {
      if (planPath !== null) throw new Error("duplicate --plan");
      planPath = takeValue("--plan", ++i);
    } else {
      throw new Error(`unknown flag '${a}'`);
    }
  }
  if (!epicSlug) throw new Error("missing required --epic-slug");
  if (!parents || parents.length === 0)
    throw new Error("missing or empty required --parents");
  if (!planPath) throw new Error("missing required --plan");
  for (const p of parents) {
    if (!HASH_RE.test(p)) {
      throw new Error(`invalid parent hash '${p}' (expected hex/alnum 3-12 chars)`);
    }
  }
  return { epicSlug, parents, planPath };
}

export function runEmitRetroStory(
  args: string[],
  opts: RunEmitRetroStoryOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  let parsed: ParsedEmitArgs;
  try {
    parsed = parseEmitArgs(args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(
      `devx plan-helper emit-retro-story: ${msg}\n` +
        "usage: devx plan-helper emit-retro-story --epic-slug <slug> --parents <h1,h2,...> --plan <path>\n",
    );
    return 1;
  }

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err(
      "devx plan-helper emit-retro-story: devx.config.yaml not found (walked up from cwd)\n",
    );
    return 1;
  }
  // The repoRoot is the directory containing devx.config.yaml — that's
  // where DEV.md and _bmad-output/ live.
  const repoRoot = opts.repoRoot ?? dirname(projectConfigPath);

  let merged: DeriveBranchConfig & {
    mode?: string;
    project?: { shape?: string };
    thoroughness?: string;
  };
  try {
    const raw = loadMerged({ projectPath: projectConfigPath });
    merged =
      raw && typeof raw === "object"
        ? (raw as typeof merged)
        : ({} as typeof merged);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx plan-helper emit-retro-story: config load failed: ${msg}\n`);
    return 1;
  }

  const prefix = parsed.parents[0].slice(0, 3);
  const retroHash = `${prefix}ret`;

  // Wrap composition + write in a single try/catch — both throw on validation
  // failures (prefix mismatch, missing epic in DEV.md, spec already exists)
  // and we surface every such failure as exit 1 with the message verbatim.
  // Atomic-rename failures are NOT thrown — writeRetroAtomically returns a
  // partial result + emits WARN to stderr (handled below as exit 0).
  let emit: ReturnType<typeof emitRetroStory>;
  let result: ReturnType<typeof writeRetroAtomically>;
  try {
    const branch = deriveBranch(merged, "dev", retroHash);
    emit = emitRetroStory(parsed.epicSlug, parsed.parents, {
      planPath: parsed.planPath,
      mode: typeof merged.mode === "string" ? merged.mode : "unknown",
      shape:
        typeof merged.project?.shape === "string"
          ? merged.project.shape
          : "unknown",
      thoroughness:
        typeof merged.thoroughness === "string"
          ? merged.thoroughness
          : "unknown",
      branch,
      now: opts.now,
    });
    result = writeRetroAtomically(emit, {
      repoRoot,
      err,
      fs: opts.fsOverride,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx plan-helper emit-retro-story: ${msg}\n`);
    return 1;
  }

  // Single-line stdout summary so the skill body can grep it. Format:
  //   spec=<path> dev_md=<path> sprint_status=<path> [partial=<csv>]
  // All paths are repo-relative (the same canonical paths writeRetroAtomically
  // defaulted to). Skill body splits on whitespace + `=` to consume.
  const lineParts = [
    `spec=${emit.specPath}`,
    `dev_md=DEV.md`,
    `sprint_status=_bmad-output/implementation-artifacts/sprint-status.yaml`,
  ];
  if (!result.fullSuccess && result.partial) {
    // Strip the repoRoot prefix so the partial: list mirrors the other
    // fields (repo-relative paths).
    const partialRel = result.partial.map((p) =>
      p.startsWith(repoRoot + "/") ? p.slice(repoRoot.length + 1) : p,
    );
    lineParts.push(`partial=${partialRel.join(",")}`);
  }
  out(`${lineParts.join(" ")}\n`);

  // Per the file header: partial == exit 0 + WARN on stderr. The WARN was
  // already emitted by writeRetroAtomically. Skill body greps stderr.
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("plan-helper")
    .description(
      "Helpers invoked by the /devx-plan skill body (Phase 1). Subcommand-driven; mirrors `devx merge-gate`'s passthrough pattern.",
    );

  sub
    .command("derive-branch")
    .description(
      "Print the branch name a fresh spec should record, derived from devx.config.yaml's git.{integration_branch, branch_prefix}.",
    )
    .argument("<type>", "spec type (dev, plan, test, debug, focus, learn, qa)")
    .argument("<hash>", "spec hash (e.g. 'aud101')")
    .action((type: string, hash: string) => {
      const code = runDeriveBranch([type, hash], {});
      if (code !== 0) {
        process.exit(code);
      }
    });

  sub
    .command("emit-retro-story")
    .description(
      "Emit the per-epic retro story (spec file + DEV.md row + sprint-status.yaml row) atomically. Closes the LEARN.md cross-epic regression where retros were absent from sprint-status.yaml in every Phase 0 PR.",
    )
    .requiredOption("--epic-slug <slug>", "epic slug (the part after 'epic-')")
    .requiredOption(
      "--parents <hashes>",
      "comma-separated parent story hashes that must complete before the retro can run",
    )
    .requiredOption(
      "--plan <path>",
      "path to the parent plan-spec — goes into the spec's `plan:` frontmatter",
    )
    .action(
      (cmdOpts: { epicSlug: string; parents: string; plan: string }) => {
        const code = runEmitRetroStory(
          [
            "--epic-slug",
            cmdOpts.epicSlug,
            "--parents",
            cmdOpts.parents,
            "--plan",
            cmdOpts.plan,
          ],
          {},
        );
        if (code !== 0) {
          process.exit(code);
        }
      },
    );

  attachPhase(sub, 1);
}
