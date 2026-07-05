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

  if (args.length !== 1) {
    err("usage: devx workstream new <slug> [--hash <hash>]\n");
    return 2;
  }
  const [slug] = args;

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
        `devx workstream new: '${slug}' already scaffolded — nothing to do\n`,
      );
    }
    return 0;
  } catch (e) {
    if (e instanceof WorkstreamRefusal) {
      err(`devx workstream new: ${e.message}\n`);
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
      "Scaffold a workstream: prd.md + expectations.md from templates, empty decisions/checkpoints/evals, plan-spec engine frontmatter. Idempotent.",
    )
    .argument("<slug>", "workstream slug (kebab-case, ≤50 chars)")
    .option("--hash <hash>", "bind an existing plan spec instead of creating one")
    .action((slug: string, cmdOpts: { hash?: string }) => {
      const code = runWorkstreamNew([slug], { hash: cmdOpts.hash });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
