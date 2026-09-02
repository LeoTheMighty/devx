// `devx workstream new <slug> [--hash <hash>]` — CLI passthrough for the
// workstream scaffolder (v2e101). Mirrors the merge-gate/plan-helper
// pattern: thin driver, JSON on stdout, diagnostics on stderr.
//
// Exit codes:
//   0 — scaffolded (or clean no-op re-run; `noop: true` in the JSON).
//   1 — refusal: slug/hash conflict with existing state (dir claimed by a
//       different spec, spec bound to a different dir, dir with no spec
//       and no --hash). Nothing written.
//   2 — error: invalid slug/hash, missing engine templates, config load
//       failure.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §3, §8

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { EXPECTATIONS_REL, PRD_REL } from "../lib/engine/artifacts.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  type EngineFs,
  WorkstreamError,
  WorkstreamRefusal,
  createWorkstream,
} from "../lib/engine/workstream.js";

export interface RunWorkstreamNewOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
  now?: () => Date;
}

export function runWorkstreamNew(
  args: string[],
  flags: { hash?: string },
  opts: RunWorkstreamNewOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // The arity check does NOT live here any more (dlr104). A missing slug is a
  // refusal under `workstream` and perfectly legal under `project-level`, and
  // only `createWorkstream` knows which — so the decision goes where the
  // layout is, and the message can name `engine.docs_layout` as the reason.
  if (args.length > 1) {
    err("usage: devx workstream new [slug] [--hash <hash>]\n");
    return 2;
  }
  // An explicitly EMPTY slug is absent, not a slug. Without this,
  // `devx workstream new ""` gives commander `args.length === 1`, so the
  // project-level default never runs and it exits 2 with `invalid slug ''` —
  // under the one layout where the slug is optional (review EC#8).
  const slug = args.length === 1 && args[0].trim() !== "" ? args[0] : undefined;

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx workstream new: ${ctx.error}\n`);
    return 2;
  }

  try {
    const result = createWorkstream({
      repoRoot: ctx.ctx.repoRoot,
      slug,
      hash: flags.hash,
      engine: ctx.ctx.engine,
      now: opts.now,
      fs: opts.fs,
    });
    out(`${JSON.stringify(result)}\n`);
    if (result.noop) {
      err(
        `devx workstream new: '${result.slug}' already scaffolded — nothing to do\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof WorkstreamRefusal) {
      err(`devx workstream new: ${e.message}\n`);
      // A missing slug is the one refusal E-5 pins at exit 1 — it is the
      // engine saying no to a valid request, and the flat layout accepts the
      // same invocation. Every other refusal keeps 1 as it always did.
      return 1;
    }
    if (e instanceof WorkstreamError) {
      err(`devx workstream new: ${e.message}\n`);
      return 2;
    }
    err(
      `devx workstream new: unexpected failure: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }
}

export function register(program: Command): void {
  const sub = program
    .command("workstream")
    .description(
      "Workstream operations (v2 engine). `new <slug>` scaffolds _devx/workstreams/<slug>/ + the plan spec's engine frontmatter.",
    );

  sub
    .command("new")
    .description(
      `Scaffold a workstream: ${PRD_REL} + ${EXPECTATIONS_REL} from templates, empty decisions/checkpoints/evals, plan-spec engine frontmatter. Idempotent.`,
    )
    .argument(
      "[slug]",
      "workstream slug (kebab-case, ≤50 chars) — optional under `engine.docs_layout: project-level`",
    )
    .option("--hash <hash>", "bind an existing plan spec instead of creating one")
    .action((slug: string | undefined, cmdOpts: { hash?: string }) => {
      const code = runWorkstreamNew(slug === undefined ? [] : [slug], {
        hash: cmdOpts.hash,
      });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
