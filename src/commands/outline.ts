// `devx outline` — the outline subsystem's CLI (folder-per-artifact layout).
//
//   guard   PreToolUse hook endpoint: reads the hook JSON on stdin, denies
//           agent writes to outline files (L1). Allow = silence + exit 0.
//   check   Mechanical diff scan: outline changes never ride in a PR (L2).
//           Exit 0 clean / 1 outline-in-diff / 2 signal trouble.
//   init    Human-side scaffold for an outline (L3). Refuses in agent
//           sessions — outlines exist ⟺ a human typed them.
//   commit  Human-side commit of ONLY outline paths (L3). Same refusal.
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
  OUTLINE_BASENAME,
  PROJECT_OUTLINE_REL,
  agentSessionRefusal,
  baseBranchFrom,
  classifyDiffNames,
  dequoteGitPath,
  guardDecision,
  isAgentSessionEnv,
  isProtectedOutlinePath,
  renderDenyJson,
} from "../lib/engine/outline.js";

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
  const touched = classifyDiffNames(r.stdout.split("\n"));
  io.out(`${JSON.stringify({ clean: touched.length === 0, touched, range })}\n`);
  return touched.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/** Stage folders an outline can live in. */
export const OUTLINE_STAGES = ["prd", "design", "plan", "evals"] as const;

const BUILTIN_SKELETON = `<!-- outline.md — HUMAN-ONLY. Agents never edit this file (hook + CI enforced).
     Type the structure and the load-bearing facts yourself — the typing is
     the point. Agents read it, critique it in outline-critique.md, and use
     it as the spine of human.md. Commit with: devx outline commit -->

# Outline

-
`;

export function runOutlineInit(
  args: string[],
  flags: { project?: boolean },
  opts: RunOutlineOpts = {},
): number {
  const io = ioOf(opts);
  if (isAgentSessionEnv(io.env)) {
    io.err(`${agentSessionRefusal("init")}\n`);
    return 1;
  }
  const ctx = loadEngineContext(opts.projectPath);
  if (!ctx.ok) {
    io.err(`devx outline init: ${ctx.error}\n`);
    return 2;
  }
  const { repoRoot, engine } = ctx.ctx;

  let destAbs: string;
  let templateRel: string;
  if (flags.project === true) {
    if (args.length > 0) {
      // A mistyped stage invocation must not silently mint the ROOT outline
      // (which init then refuses to overwrite — a sticky mistake).
      io.err(
        "devx outline init: --project takes no hash/stage arguments — drop them or drop the flag\n",
      );
      return 2;
    }
    destAbs = join(repoRoot, PROJECT_OUTLINE_REL);
    templateRel = `_devx/templates/engine/${PROJECT_OUTLINE_REL}`;
  } else {
    const [hash, stage] = args;
    if (!hash || !stage) {
      io.err("usage: devx outline init <hash> <stage>  |  devx outline init --project\n");
      return 2;
    }
    if (!(OUTLINE_STAGES as readonly string[]).includes(stage)) {
      io.err(
        `devx outline init: unknown stage '${stage}' — expected one of ${OUTLINE_STAGES.join(", ")}\n`,
      );
      return 2;
    }
    let wsAbs: string;
    try {
      wsAbs = resolveWorkstream(repoRoot, hash, engine, io.fs).workstreamAbs;
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
    destAbs = join(wsAbs, stage, OUTLINE_BASENAME);
    templateRel = `_devx/templates/engine/${stage}/${OUTLINE_BASENAME}`;
  }

  if (io.fs.exists(destAbs)) {
    io.err(
      `devx outline init: ${relative(repoRoot, destAbs)} already exists — outlines are never overwritten\n`,
    );
    return 1;
  }
  const templateAbs = join(repoRoot, ...templateRel.split("/"));
  const body = io.fs.exists(templateAbs)
    ? io.fs.readFile(templateAbs)
    : BUILTIN_SKELETON;
  io.fs.mkdirRecursive(join(destAbs, ".."));
  io.fs.writeFile(destAbs, body);
  const rel = relative(repoRoot, destAbs).split("\\").join("/");
  io.out(`${JSON.stringify({ created: rel })}\n`);
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
      "Scaffold an outline for a workstream stage (or --project for the repo-root OUTLINE.md). Human-only: refuses inside agent sessions.",
    )
    .argument("[hash]", "workstream (plan spec) hash")
    .argument("[stage]", `stage folder: ${OUTLINE_STAGES.join(" | ")}`)
    .option("--project", "scaffold the repo-root OUTLINE.md instead")
    .action((hash: string | undefined, stage: string | undefined, cmdOpts: { project?: boolean }) => {
      const code = runOutlineInit(
        [hash ?? "", stage ?? ""].filter((a) => a !== ""),
        { project: cmdOpts.project },
      );
      if (code !== 0) process.exit(code);
    });

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
