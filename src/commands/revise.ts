// `devx revise <hash> --touched <path>` — cascade-reset applier (v2e101).
//
// Applies the v2/02-engine.md §4.9 cascade table to the workstream's spec
// frontmatter and prints the replay path (the ordered gate commands now
// open). Refuses unknown artifacts — a typo'd --touched must never clear
// gate flags. Never edits the touched artifact itself.
//
// Exit codes:
//   0 — cascade applied; JSON on stdout carries resets + stage + replay.
//   1 — refusal: unknown artifact, or a path pointing outside this
//       workstream. Nothing written.
//   2 — error: unresolvable hash/workstream, config load failure.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §4.9

import { resolve as resolvePath, sep } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { loadEngineContext } from "../lib/engine/context.js";
import { applyEnginePatch } from "../lib/engine/frontmatter.js";
import {
  KNOWN_ARTIFACTS,
  cascadeFor,
  computeRevise,
} from "../lib/engine/revise.js";
import {
  type EngineFs,
  WorkstreamError,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";

export interface RunReviseOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
  fs?: Partial<EngineFs>;
}

export function runRevise(
  args: string[],
  flags: { touched?: string },
  opts: RunReviseOpts = {},
): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };

  if (args.length !== 1) {
    err("usage: devx revise <hash> --touched <path>\n");
    return 2;
  }
  if (!flags.touched || flags.touched.trim() === "") {
    err("devx revise: --touched <path> is required\n");
    return 2;
  }
  const touched = flags.touched.trim();

  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    err(`devx revise: ${ctx.error}\n`);
    return 2;
  }

  let ws;
  try {
    ws = resolveWorkstream(ctx.ctx.repoRoot, args[0], ctx.ctx.engine, opts.fs ?? {});
  } catch (e) {
    if (e instanceof WorkstreamError) {
      err(`devx revise: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const entry = cascadeFor(touched);
  if (!entry) {
    err(
      `devx revise: unknown artifact '${touched}' — the cascade table covers: ${KNOWN_ARTIFACTS.join(", ")}. Refusing (a typo here must not reset gate flags).\n`,
    );
    return 1;
  }

  // A slashed path must point INTO this workstream. `--touched prd.md`
  // (bare basename) is trusted; `--touched _devx/workstreams/other/prd.md`
  // against this hash is a cross-workstream mistake and refused.
  if (touched.includes("/") || touched.includes(sep)) {
    const expectedAbs = resolvePath(ws.workstreamAbs, entry.artifact);
    const touchedAbs = resolvePath(ctx.ctx.repoRoot, touched);
    if (touchedAbs !== expectedAbs) {
      err(
        `devx revise: '${touched}' is not an artifact of workstream '${ws.workstreamRel}' (expected ${ws.workstreamRel}/${entry.artifact} or the bare basename)\n`,
      );
      return 1;
    }
  }

  const computation = computeRevise(ws.state, entry, ws.hash);

  // Apply: clear the cascade's flags (write false for the full reset set —
  // idempotent for already-false flags) + roll the stage back.
  const gatePatch: Record<string, boolean> = {};
  for (const flag of computation.resets) gatePatch[flag] = false;
  try {
    const updated = applyEnginePatch(ws.content, {
      gateStatus: gatePatch,
      stage: computation.stage,
    });
    fs.writeFile(ws.specAbs, updated);
  } catch (e) {
    err(
      `devx revise: frontmatter write failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return 2;
  }

  out(
    `${JSON.stringify({
      hash: ws.hash,
      touched: entry.artifact,
      resets: computation.resets,
      flags_cleared: computation.flagsCleared,
      stage: computation.stage,
      replay: computation.replay,
      spec: ws.specRel,
    })}\n`,
  );
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("revise")
    .description(
      "Apply the v2 cascade-reset table for a touched workstream artifact (prd/expectations → 4 flags; design → 3; plan → 2) and print the replay path.",
    )
    .argument("<hash>", "workstream (plan spec) hash")
    .requiredOption(
      "--touched <path>",
      "the artifact being revised: prd.md | expectations.md | design.md | plan.md (basename or workstream-relative path)",
    )
    .action((hash: string, cmdOpts: { touched: string }) => {
      const code = runRevise([hash], { touched: cmdOpts.touched });
      if (code !== 0) process.exit(code);
    });
  attachPhase(sub, 1);
}
