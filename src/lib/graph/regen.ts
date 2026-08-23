// Regenerate GRAPH.md from disk — the one primitive every state-flipping
// flow calls so the board is never stale (sgr104 / plan Phase 4, T4.1).
//
// `devx graph` (src/commands/graph.ts) is the OPERATOR's entry point: it
// resolves a repo root from the cwd, honours --stdout/--check/--format/scope,
// and reports counts. This module is the HOST's entry point: the caller
// already knows its repo root and engine config, wants no stdout, and — the
// load-bearing difference — must never be aborted by a bad render.
//
// FAILURE POSTURE (design §Failure posture; plan Phase 4 Context): regen
// inside a hook is warn-and-continue. A claim that flipped DEV.md and a retro
// emission that wrote a spec are state transitions the operator asked for; a
// cycle in the board, an unreadable spec dir, or a full disk must not undo
// them. The miss is caught downstream by `devx graph --check` (E-2), which is
// exactly why that gate exists. So: this function NEVER throws. Every failure
// mode — model build, cycle, render, write — comes back as
// `{ok:false, warning}` for the host to log and move past.
//
// Spec: dev/dev-sgr104-2026-08-02T13:57-regen-hooks-claim-emission.md
// Design: _devx/workstreams/story-graph/design/agent.md §Architecture 4

import { join } from "node:path";

import { type EngineConfig } from "../engine/config.js";
import { writeAtomic } from "../supervisor-internal.js";
import { type GraphFs, buildGraphModel } from "./model.js";
import { REGEN_COMMAND, renderStoryGraph } from "./render.js";

/** Basename of the generated board, at the canonical repo root. Single
 *  definition; `src/commands/graph.ts` re-exports it. */
export const GRAPH_FILENAME = "GRAPH.md";

/** Read seam. The regen only ever READS through the host's fs (specs +
 *  backlogs); the write goes through `RegenOpts.write` so a host whose own
 *  fs seam is non-atomic still gets a tmp+rename GRAPH.md. */
export type RegenFs = GraphFs;

export type RegenResult =
  | { ok: true; path: string }
  | { ok: false; warning: string };

/** The shape hosts inject to force a failure in tests (default:
 *  `regenerateGraph`). Deliberately narrower than the real function's
 *  signature — hosts never pass `opts`. */
export type RegenFn = (
  fs: RegenFs,
  repoRoot: string,
  engine: EngineConfig,
) => RegenResult;

export interface RegenOpts {
  /** Test seam for the GRAPH.md write. Defaults to `writeAtomic` — the
   *  "own tmp+rename" the hosts' shared rename batches deliberately do not
   *  cover, since GRAPH.md is derived and rolls back differently from the
   *  authored artifacts those batches move. */
  write?: (path: string, contents: string) => void;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Uniform prefix so a host only has to prepend its own name. */
function warn(reason: string): { ok: false; warning: string } {
  return {
    ok: false,
    warning: `${GRAPH_FILENAME} not regenerated: ${reason} (run \`${REGEN_COMMAND}\` once the cause is fixed)`,
  };
}

/**
 * Render the board from disk and write `<repoRoot>/GRAPH.md`.
 *
 * Returns the written path on success; a warning string on every failure.
 * Never throws — see the FAILURE POSTURE note above.
 */
export function regenerateGraph(
  fs: RegenFs,
  repoRoot: string,
  engine: EngineConfig,
  opts: RegenOpts = {},
): RegenResult {
  const write = opts.write ?? ((p: string, c: string) => writeAtomic(p, c));
  const path = join(repoRoot, GRAPH_FILENAME);

  // The default write is `writeAtomic`, which mkdirs the target's parent —
  // and GRAPH.md's parent IS the repo root. Minting a missing repo root is
  // never the right answer: a root that doesn't exist means the caller was
  // handed a bad path, not that a directory needs creating. Without this
  // guard a host passing a synthetic root (a fake-fs test, a mis-resolved
  // cwd) makes the regen create that directory for real on the host — under
  // a container running as root, `/repo/GRAPH.md` would actually appear.
  if (!fs.exists(repoRoot)) {
    return warn(`repo root does not exist: ${repoRoot}`);
  }

  let built;
  try {
    built = buildGraphModel(fs, repoRoot, engine);
  } catch (e) {
    return warn(`model build failed: ${message(e)}`);
  }
  if (!built.ok) {
    // Same diagnosis `devx graph` gives, minus the exit code: name every
    // participant so the operator can break the cycle without re-deriving it.
    return warn(
      `blocking-edge cycle among ${built.cycle.length} spec(s): ${built.cycle.join(", ")} — remove one \`Blocked-by:\`/\`blocked_by:\` edge`,
    );
  }

  let document: string;
  try {
    document = renderStoryGraph(built.model);
  } catch (e) {
    return warn(`render failed: ${message(e)}`);
  }

  try {
    write(path, document);
  } catch (e) {
    return warn(`write to ${path} failed: ${message(e)}`);
  }
  return { ok: true, path };
}
