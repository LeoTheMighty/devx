// `devx outline` — the outline subsystem's CLI (folder-per-artifact layout).
//
//   guard   PreToolUse hook endpoint: reads the hook JSON on stdin, denies
//           agent writes to outline files (L1). Allow = silence + exit 0.
//   check   Mechanical diff scan: an AUTHORED outline never rides in a PR
//           (L2). A pristine scaffold does — it holds nothing a human typed.
//           Exit 0 clean / 1 outline-in-diff / 2 signal trouble.
//   init    Bootstrap an EMPTY outline — the one outline write an agent may
//           make. Never overwrites, in any layout, ever.
//   commit  Human-side commit of ONLY outline paths (L3). Refuses in agent
//           sessions — an outline reaches the repo because a human sent it.
//
// init resolves `engine.docs_layout` (docs/CONFIG.md §15), so the same
// command scaffolds `<ws>/<stage>/outline.md` under the workstream layout and
// `<stage>-outline.md` at the repo root under project-level.
//
// Exit codes follow the gate convention (0 ok / 1 refusal-or-dirty / 2 error).
//
// Design: v2/02-engine.md §3; src/lib/engine/outline.ts holds the pure logic.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { type Exec, realExec } from "../lib/exec.js";
import { loadEngineContext } from "../lib/engine/context.js";
import {
  type EngineFs,
  WorkstreamError,
  WorkstreamRefusal,
  realEngineFs,
  resolveWorkstream,
} from "../lib/engine/workstream.js";
import {
  DOCS_LAYOUTS,
  type DocsLayout,
  OUTLINE_BASENAME,
  STAGE_DIRS,
  type StageDir,
  docsLayoutFrom,
  projectOutlineRel,
} from "../lib/engine/artifacts.js";
import {
  type OutlineKind,
  PROJECT_OUTLINE_REL,
  agentSessionRefusal,
  baseBranchFrom,
  classifyDiffNames,
  dequoteGitPath,
  guardDecision,
  isAgentSessionEnv,
  isProtectedOutlinePath,
  outlineKindOf,
  renderDenyJson,
} from "../lib/engine/outline.js";
import {
  BOOTSTRAP_STAGES,
  gitShowReader,
  partitionOutlinePaths,
  scaffoldBody,
} from "../lib/engine/outline-scaffold.js";

export interface RunOutlineOpts {
  out?: (s: string) => void;
  err?: (s: string) => void;
  projectPath?: string;
  fs?: Partial<EngineFs>;
  exec?: Exec;
  env?: Record<string, string | undefined>;
  /** Test seam for `guard`'s stdin. */
  stdin?: () => string;
}

interface Io {
  out: (s: string) => void;
  err: (s: string) => void;
  fs: EngineFs;
  exec: Exec;
  env: Record<string, string | undefined>;
}

function ioOf(opts: RunOutlineOpts): Io {
  return {
    out: opts.out ?? ((s) => process.stdout.write(s)),
    err: opts.err ?? ((s) => process.stderr.write(s)),
    fs: { ...realEngineFs, ...opts.fs },
    exec: opts.exec ?? realExec,
    env: opts.env ?? process.env,
  };
}

// ---------------------------------------------------------------------------
// guard
// ---------------------------------------------------------------------------

export function runOutlineGuard(opts: RunOutlineOpts = {}): number {
  const io = ioOf(opts);
  let raw = "";
  try {
    raw = (opts.stdin ?? (() => readFileSync(0, "utf8")))();
  } catch {
    // No stdin (e.g. invoked by hand) — nothing to judge, allow.
    return 0;
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed hook payload: allow. The guard must never brick unrelated
    // tool use; L2's diff check still backstops an actual outline write.
    return 0;
  }
  const decision = guardDecision(payload);
  if (!decision.deny) return 0;
  io.out(`${renderDenyJson(decision.reason ?? "outline files are human-only")}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

/** Display form of the default range; the live base branch comes from
 *  git.integration_branch / git.default_branch (falls back to main). */
export const DEFAULT_CHECK_RANGE = "origin/<base>...HEAD";

/** `EngineFs.readFile` narrowed to the null-on-missing shape the scaffold
 *  comparison wants (a missing template is a fact, not an error). */
function readFileOrNull(fs: EngineFs): (abs: string) => string | null {
  return (abs) => {
    try {
      return fs.exists(abs) ? fs.readFile(abs) : null;
    } catch {
      return null;
    }
  };
}

/** Where the right-hand side of a diff range's content lives.
 *
 *  `A...B` / `A..B` → the commit B: that content is what would merge, and
 *  reading the working tree instead would let an uncommitted edit flip the
 *  verdict either way. A BARE rev (`devx outline check --diff HEAD~1`) is
 *  git's two-arg form, whose right-hand side IS the working tree — reading
 *  the named rev there would compare against the wrong side entirely. */
export function contentSourceForRange(
  range: string,
): { at: "rev"; rev: string } | { at: "worktree" } {
  const dots = range.includes("...") ? "..." : range.includes("..") ? ".." : null;
  if (dots === null) return { at: "worktree" };
  const rhs = range.slice(range.indexOf(dots) + dots.length).trim();
  return { at: "rev", rev: rhs === "" ? "HEAD" : rhs };
}

export function runOutlineCheck(
  flags: { diff?: string },
  opts: RunOutlineOpts = {},
): number {
  const io = ioOf(opts);
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`devx outline check: ${ctx.error}\n`);
    return 2;
  }
  const range =
    flags.diff ?? `origin/${baseBranchFrom(ctx.ctx.merged)}...HEAD`;
  // quotePath=false: git's default C-escaping of non-ASCII paths would slip
  // past the basename classifier (review HIGH — L2 bypass for accented
  // workstream slugs); dequoteGitPath in the classifier is the fallback.
  const r = io.exec(
    "git",
    ["-c", "core.quotePath=false", "diff", "--name-only", range],
    { cwd: ctx.ctx.repoRoot },
  );
  if (r.exitCode !== 0) {
    io.err(
      `devx outline check: git diff failed for range '${range}' (missing merge base or unknown ref?): ${r.stderr.trim()}\n`,
    );
    return 2;
  }
  // Name-based classification first (L2's original scan), then the scaffold
  // exemption: a file still byte-identical to what `devx outline init` wrote
  // carries nothing a human typed, so blocking it would only punish
  // bootstrapping. Everything else — including a DELETED outline — blocks.
  const outlines = classifyDiffNames(r.stdout.split("\n"));
  const readFile = readFileOrNull(io.fs);
  const source = contentSourceForRange(range);
  const { authored, scaffolds } = partitionOutlinePaths(
    outlines,
    {
      repoRoot: ctx.ctx.repoRoot,
      readFile,
      readAtRev:
        source.at === "rev"
          ? gitShowReader(io.exec, ctx.ctx.repoRoot, source.rev)
          : (rel) => readFile(join(ctx.ctx.repoRoot, ...rel.split("/"))),
    },
    outlineKindOf,
  );
  io.out(
    `${JSON.stringify({ clean: authored.length === 0, touched: authored, scaffolds, range })}\n`,
  );
  return authored.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** Stage folders an outline can live in. */
export const OUTLINE_STAGES = STAGE_DIRS;

/** The nudge every scaffold carries into the caller's terminal: creating the
 *  file is mechanical, filling it in is not. Printed on stderr so JSON stdout
 *  stays machine-clean. */
const TYPE_IT_YOURSELF =
  "outlines are human-only — this created an EMPTY scaffold. Type the bullets " +
  "yourself (that is the point), then land them with `devx outline commit`.";

/** Where a scaffold lands, given the resolved layout. */
interface OutlineTarget {
  kind: OutlineKind;
  /** Repo-relative POSIX path (display + JSON form). */
  rel: string;
  abs: string;
}

function targetFor(
  kind: OutlineKind,
  layout: DocsLayout,
  repoRoot: string,
  wsAbs: string | null,
): OutlineTarget {
  if (kind.kind === "project") {
    return {
      kind,
      rel: PROJECT_OUTLINE_REL,
      abs: join(repoRoot, PROJECT_OUTLINE_REL),
    };
  }
  if (layout === "project-level") {
    const rel = projectOutlineRel(kind.stage);
    return { kind, rel, abs: join(repoRoot, rel) };
  }
  // Workstream layout — wsAbs is resolved before this is called.
  const abs = join(wsAbs as string, kind.stage, OUTLINE_BASENAME);
  return { kind, rel: relative(repoRoot, abs).split("\\").join("/"), abs };
}

export function runOutlineInit(
  args: string[],
  flags: { project?: boolean; all?: boolean; layout?: string },
  opts: RunOutlineOpts = {},
): number {
  const io = ioOf(opts);
  // No agent-session refusal here (unlike `commit`): init only ever CREATES
  // the empty scaffold — the never-overwrite rule below means it cannot
  // touch a byte a human typed, so bootstrapping the file is safe for anyone
  // to run. See src/lib/engine/outline.ts, L3 note.
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`devx outline init: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine, merged } = ctx.ctx;

  if (flags.layout !== undefined && !(DOCS_LAYOUTS as readonly string[]).includes(flags.layout)) {
    io.err(
      `devx outline init: unknown layout '${flags.layout}' — expected one of ${DOCS_LAYOUTS.join(", ")}\n`,
    );
    return 2;
  }
  const layout: DocsLayout = (flags.layout as DocsLayout | undefined) ?? docsLayoutFrom(merged);

  if (flags.project === true && flags.all === true) {
    io.err(
      "devx outline init: --project and --all are different scaffolds — run them separately\n",
    );
    return 2;
  }

  // ── Which outlines does this invocation cover? ─────────────────────────
  let kinds: OutlineKind[];
  let hash: string | undefined;
  if (flags.project === true) {
    if (args.length > 0) {
      // A mistyped stage invocation must not silently mint the ROOT outline
      // (which init then skips forever after — a sticky mistake).
      io.err(
        "devx outline init: --project takes no hash/stage arguments — drop them or drop the flag\n",
      );
      return 2;
    }
    kinds = [{ kind: "project" }];
  } else if (layout === "project-level") {
    // Flat repo-root shape: no workstream, so the only argument is a stage.
    if (args.length > 1) {
      io.err(
        `devx outline init: engine.docs_layout is project-level — there is no workstream hash here; run 'devx outline init ${args[1]}'\n`,
      );
      return 2;
    }
    const stage = args[0];
    if (flags.all === true) {
      if (stage !== undefined) {
        io.err("devx outline init: --all takes no stage argument\n");
        return 2;
      }
      kinds = BOOTSTRAP_STAGES.map((s) => ({ kind: "stage", stage: s }) as const);
    } else {
      if (stage === undefined) {
        io.err(
          "usage: devx outline init <stage>  |  devx outline init --all  |  devx outline init --project   (engine.docs_layout: project-level)\n",
        );
        return 2;
      }
      if (!(OUTLINE_STAGES as readonly string[]).includes(stage)) {
        io.err(
          `devx outline init: unknown stage '${stage}' — expected one of ${OUTLINE_STAGES.join(", ")}\n`,
        );
        return 2;
      }
      kinds = [{ kind: "stage", stage: stage as StageDir }];
    }
  } else {
    const [hashArg, stage] = args;
    if (!hashArg || (!stage && flags.all !== true)) {
      io.err(
        "usage: devx outline init <hash> <stage>  |  devx outline init <hash> --all  |  devx outline init --project\n",
      );
      return 2;
    }
    hash = hashArg;
    if (flags.all === true) {
      if (stage !== undefined) {
        io.err("devx outline init: --all takes no stage argument\n");
        return 2;
      }
      kinds = BOOTSTRAP_STAGES.map((s) => ({ kind: "stage", stage: s }) as const);
    } else {
      if (!(OUTLINE_STAGES as readonly string[]).includes(stage as string)) {
        io.err(
          `devx outline init: unknown stage '${stage}' — expected one of ${OUTLINE_STAGES.join(", ")}\n`,
        );
        return 2;
      }
      kinds = [{ kind: "stage", stage: stage as StageDir }];
    }
  }

  // ── Resolve the workstream once (workstream layout, stage targets) ─────
  //
  // Resolved under `layout`, not under the config's own — `--layout` overrides
  // the layout for this whole invocation, and since dlr103 the resolver reads
  // it too. Threading the config value here instead would run one command
  // under two layouts: a `--layout workstream` override on a `project-level`
  // repo would spell the target `<ws>/prd/outline.md` while resolving the base
  // to the repo root, and scaffold `prd/outline.md` at the root.
  const resolveEngine = { ...engine, docsLayout: layout };
  let wsAbs: string | null = null;
  if (hash !== undefined) {
    try {
      wsAbs = resolveWorkstream(repoRoot, hash, resolveEngine, io.fs).workstreamAbs;
    } catch (e) {
      if (e instanceof WorkstreamRefusal) {
        io.err(`devx outline init: ${e.message}\n`);
        return 1;
      }
      if (e instanceof WorkstreamError) {
        io.err(`devx outline init: ${e.message}\n`);
        return 2;
      }
      throw e;
    }
  }

  // ── Write, never overwrite ─────────────────────────────────────────────
  const scaffoldIo = { repoRoot, readFile: readFileOrNull(io.fs) };
  const created: string[] = [];
  const skipped: string[] = [];
  for (const kind of kinds) {
    const target = targetFor(kind, layout, repoRoot, wsAbs);
    if (io.fs.exists(target.abs)) {
      // THE rule: an existing outline is the human's, whatever it contains.
      skipped.push(target.rel);
      continue;
    }
    io.fs.mkdirRecursive(join(target.abs, ".."));
    io.fs.writeFile(target.abs, scaffoldBody(kind, scaffoldIo));
    created.push(target.rel);
  }

  io.out(`${JSON.stringify({ layout, created, skipped })}\n`);
  if (skipped.length > 0) {
    io.err(
      `devx outline init: left ${skipped.join(", ")} untouched — outlines are never overwritten\n`,
    );
  }
  if (created.length > 0) io.err(`devx outline init: ${TYPE_IT_YOURSELF}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

export function runOutlineCommit(
  flags: { message?: string },
  opts: RunOutlineOpts = {},
): number {
  const io = ioOf(opts);
  if (isAgentSessionEnv(io.env)) {
    io.err(`${agentSessionRefusal("commit")}\n`);
    return 1;
  }
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`devx outline commit: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, merged } = ctx.ctx;

  // Outlines live on the base branch only — committed here, they'd ride a
  // feature branch's PR straight into the diff scan that blocks it, with no
  // sanctioned way back (review MED). Refuse anywhere else.
  const base = baseBranchFrom(merged);
  const head = io.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
  });
  if (head.exitCode !== 0) {
    io.err(`devx outline commit: git rev-parse failed: ${head.stderr.trim()}\n`);
    return 2;
  }
  const branch = head.stdout.trim();
  if (branch !== base) {
    io.err(
      `devx outline commit: refusing on branch '${branch}' — outlines reach the repo only on '${base}' (a feature-branch outline commit would block that PR's merge). Switch to '${base}' and re-run.\n`,
    );
    return 1;
  }

  // -uall: plain --porcelain collapses untracked dirs to `?? dir/`, which
  // would hide a brand-new workstream's nested outline.md entirely.
  // quotePath=false + dequote: non-ASCII paths arrive usable.
  const st = io.exec(
    "git",
    ["-c", "core.quotePath=false", "status", "--porcelain", "-uall"],
    { cwd: repoRoot },
  );
  if (st.exitCode !== 0) {
    io.err(`devx outline commit: git status failed: ${st.stderr.trim()}\n`);
    return 2;
  }
  // Porcelain v1: `XY <path>` or `XY <old> -> <new>` for renames. BOTH
  // rename sides go in the candidate set — a pathspec commit that names
  // only the new side would leave the old path alive in HEAD with a
  // dangling staged deletion (review MED).
  const changed: string[] = [];
  for (const l of st.stdout.split("\n")) {
    if (l.trim() === "") continue;
    const path = l.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow >= 0) {
      changed.push(dequoteGitPath(path.slice(0, arrow)));
      changed.push(dequoteGitPath(path.slice(arrow + 4)));
    } else {
      changed.push(dequoteGitPath(path));
    }
  }
  const outlines = changed.filter((p) => p !== "" && isProtectedOutlinePath(p));
  if (outlines.length === 0) {
    io.err("devx outline commit: no outline changes in the working tree — nothing to commit\n");
    return 1;
  }

  // Stage only paths still present in the worktree — a rename's old side
  // is already staged-deleted and matches no pathspec (`git add` would
  // fatal). The commit pathspec below still names EVERY outline path, so
  // the staged deletion rides along and the rename lands whole.
  const toStage = outlines.filter((p) =>
    io.fs.exists(join(repoRoot, ...p.split("/"))),
  );
  if (toStage.length > 0) {
    const add = io.exec("git", ["add", "--", ...toStage], { cwd: repoRoot });
    if (add.exitCode !== 0) {
      io.err(`devx outline commit: git add failed: ${add.stderr.trim()}\n`);
      return 2;
    }
  }
  const message = flags.message ?? `outline: ${outlines.join(", ")}`;
  const commit = io.exec(
    "git",
    ["commit", "-m", message, "--", ...outlines],
    { cwd: repoRoot },
  );
  if (commit.exitCode !== 0) {
    io.err(`devx outline commit: git commit failed: ${commit.stderr.trim()}\n`);
    return 2;
  }
  io.out(`${JSON.stringify({ committed: outlines, message })}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// registration
// ---------------------------------------------------------------------------

export function register(program: Command): void {
  const sub = program
    .command("outline")
    .description(
      "Human-only outline files (outline.md / OUTLINE.md). guard = PreToolUse hook endpoint; check = PR-diff scan; init/commit = human-side helpers that refuse inside agent sessions.",
    );

  sub
    .command("guard")
    .description(
      "PreToolUse hook endpoint: reads hook JSON on stdin; denies agent writes to outline files. Allow = silent exit 0.",
    )
    .action(() => {
      const code = runOutlineGuard();
      if (code !== 0) process.exit(code);
    });

  sub
    .command("check")
    .description(
      "Fail (exit 1) when the diff range touches an outline file — outline changes never ride in a PR. Exit 2 = signal trouble (fail closed).",
    )
    .option("--diff <range>", `git diff range (default ${DEFAULT_CHECK_RANGE})`)
    .action((cmdOpts: { diff?: string }) => {
      const code = runOutlineCheck({ diff: cmdOpts.diff });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("init")
    .description(
      "Bootstrap an EMPTY outline scaffold — for a workstream stage, or (engine.docs_layout: project-level) a repo-root <stage>-outline.md, or --project for OUTLINE.md. NEVER overwrites, so anyone (agent included) may run it; the human types the bullets.",
    )
    .argument("[hash]", "workstream (plan spec) hash — omitted under engine.docs_layout: project-level")
    .argument("[stage]", `stage folder: ${OUTLINE_STAGES.join(" | ")}`)
    .option("--project", "scaffold the repo-root OUTLINE.md instead")
    .option("--all", "scaffold every stage outline that is still missing")
    .option(
      "--layout <layout>",
      `override the resolved engine.docs_layout: ${DOCS_LAYOUTS.join(" | ")}`,
    )
    .action(
      (
        hash: string | undefined,
        stage: string | undefined,
        cmdOpts: { project?: boolean; all?: boolean; layout?: string },
      ) => {
        const code = runOutlineInit(
          [hash ?? "", stage ?? ""].filter((a) => a !== ""),
          { project: cmdOpts.project, all: cmdOpts.all, layout: cmdOpts.layout },
        );
        if (code !== 0) process.exit(code);
      },
    );

  sub
    .command("commit")
    .description(
      "Stage and commit ONLY outline paths from the working tree. Human-only: refuses inside agent sessions.",
    )
    .option("-m, --message <msg>", "commit message (default: outline: <files>)")
    .action((cmdOpts: { message?: string }) => {
      const code = runOutlineCommit({ message: cmdOpts.message });
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
