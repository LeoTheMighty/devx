// Outline protection — pure decision logic (no I/O).
//
// Outlines are the human's artifact: `outline.md` inside a workstream stage
// folder (prd/, design/, plan/, evals/) and the repo-root `OUTLINE.md`. The
// agent NEVER writes them — it reads them (Read tool), critiques them into
// `outline-critique.md` (agent-writable), and structures `human.md` after
// them. Enforcement is layered and never relies on git authorship (agents
// make nearly every commit in a devx repo):
//
//   L1 (write-time)  PreToolUse hook → `devx outline guard` → guardDecision()
//   L2 (merge-time)  `devx outline check` diff scan → classifyDiffNames();
//                    also surfaced as merge-gate's `outlineClean` signal
//   L3 (human-side)  `devx outline init|commit` refuse under agent-session
//                    env markers → isAgentSessionEnv()
//
// Protected set (adversarial-review hardened): a basename of `outline.md` /
// `OUTLINE.md` in ANY case, but only at the repo root or under a
// `workstreams` path segment — a docs site's own outline.md is not devx's
// to police, and over-broad protection bricked legitimate diagnostics in
// review. Paths are normalized first (backslashes, `.`/`..` segments), so
// `_devx/templates/../workstreams/…` cannot dodge classification. Shipped
// templates under `_devx/templates/` are the one exemption: agent-authored
// scaffolds `devx outline init` instantiates from. `outline-critique.md`
// (workstream or root) is NOT protected — the critique is the agent's
// product.
//
// Design: v2/02-engine.md §3 (folder-per-artifact layout)

import { OUTLINE_BASENAME } from "./artifacts.js";

// ---------------------------------------------------------------------------
// Protected-path classification
// ---------------------------------------------------------------------------

/** Basename of every human-only outline inside a workstream (re-exported
 *  from the layout source of truth). */
export { OUTLINE_BASENAME };

/** Repo-root project outline (repo-relative path). */
export const PROJECT_OUTLINE_REL = "OUTLINE.md";

/** Repo-root project outline critique — agent-writable (the critique is the
 *  agent's product); named here so consumers and tests share the spelling. */
export const PROJECT_OUTLINE_CRITIQUE_REL = "OUTLINE-CRITIQUE.md";

/** Normalize a path for classification: / separators, `.`/`..` segments
 *  collapsed (so traversal can't dodge the template carve-out or sneak into
 *  a workstream), trailing slashes dropped. Leading `..` that escape the
 *  root are preserved as-is — they can only make a path LESS matchable. */
function normalizeSegments(path: string): string[] {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === ".." && out.length > 0 && out[out.length - 1] !== "..") {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

/** Strip git's quotePath rendering (`"a/caf\303\251/x.md"`): surrounding
 *  quotes plus C-style octal/character escapes. Callers should ALSO run git
 *  with `-c core.quotePath=false`; this is the belt to that suspender. */
export function dequoteGitPath(line: string): string {
  const trimmed = line.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") {
      const oct = inner.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) {
        bytes.push(parseInt(oct, 8));
        i += 3;
        continue;
      }
      i += 1; // \" \\ \t etc — take the escaped char literally
      bytes.push(inner.charCodeAt(i));
      continue;
    }
    bytes.push(inner.charCodeAt(i));
  }
  return Buffer.from(bytes).toString("utf8");
}

const OUTLINE_BASENAME_LC = OUTLINE_BASENAME.toLowerCase();

/** True when a path (absolute or repo-relative, / or \ separated, any case
 *  on the basename — macOS/Windows resolve case-insensitively) names a
 *  protected outline file. */
export function isProtectedOutlinePath(path: string): boolean {
  const segs = normalizeSegments(dequoteGitPath(path));
  if (segs.length === 0) return false;
  const base = segs[segs.length - 1].toLowerCase();
  if (base !== OUTLINE_BASENAME_LC) return false;
  // Shipped templates are agent scaffolds — exempt. Segment-anchored on the
  // normalized path, so `..` tricks were already collapsed away.
  for (let i = 0; i + 1 < segs.length; i++) {
    if (segs[i] === "_devx" && segs[i + 1] === "templates") return false;
  }
  // Scope: a single-segment path (the repo-root file, or a bare token in a
  // Bash command — protect when we can't tell), anything under a
  // `workstreams` segment, or the exact-uppercase project-outline name at
  // any depth (Edit/Write hand the guard ABSOLUTE paths, from which the
  // repo root is unknowable in a pure function). A docs site's own
  // lowercase outline.md elsewhere in the tree is none of devx's business;
  // an APFS lowercase-alias write to the root file is the one residual
  // dodge, and L2's diff scan catches it at PR time by its tracked name.
  if (segs.length === 1) return true;
  if (segs[segs.length - 1] === PROJECT_OUTLINE_REL) return true;
  return segs.some((s) => s === "workstreams");
}

/** Filter a `git diff --name-only` listing down to protected outline paths.
 *  Returns the dequoted repo-relative paths. */
export function classifyDiffNames(names: readonly string[]): string[] {
  return names
    .map((n) => dequoteGitPath(n))
    .filter((n) => n !== "" && isProtectedOutlinePath(n));
}

// ---------------------------------------------------------------------------
// Base-branch resolution (shared by check / merge-gate / loop tail)
// ---------------------------------------------------------------------------

/** The branch outline diffs are computed against: git.integration_branch
 *  when the repo runs a split model, else git.default_branch, else "main".
 *  Read defensively from the merged config blob. */
export function baseBranchFrom(merged: unknown): string {
  const git =
    typeof merged === "object" && merged !== null
      ? ((merged as Record<string, unknown>).git as
          | Record<string, unknown>
          | undefined)
      : undefined;
  for (const key of ["integration_branch", "default_branch"] as const) {
    const v = git?.[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "main";
}

// ---------------------------------------------------------------------------
// PreToolUse guard decision
// ---------------------------------------------------------------------------

/** Tools whose file target the guard inspects (hook matcher counterpart). */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Shell metacharacters that can chain/substitute a second command. A
 *  command carrying ANY of these never qualifies for the allow-list —
 *  `devx outline check && cat > …/outline.md` must not ride the carve-out
 *  (adversarial-review HIGH-1). */
const SHELL_OPERATOR_RE = /[;&|`$(){}<>\n]/;

/** Whole-command allow-list (only consulted when the command has no shell
 *  operators): the mechanical outline commands themselves, plus read-only
 *  diagnostics and index-only git verbs — review agents were locked out of
 *  `grep`/`git log` over outline paths, and an accidentally staged outline
 *  was un-unstageable without these. */
const ALLOW_COMMAND_RE =
  /^\s*(devx\s+outline\s+(check|guard)|grep|rg|ls|wc|head|tail|cat|git\s+(log|show|diff|status)|git\s+restore\s+--staged|git\s+rm\s+--cached|git\s+reset)\b/;

/** Path-ish tokens mentioning an outline file inside a shell command —
 *  catches redirects, cp/mv/sed targets, heredocs, anything that names the
 *  file. Each token is then classified with isProtectedOutlinePath, so
 *  template-path mentions (agent-legitimate) pass while real outline
 *  references deny. Case-insensitive: the filesystem is. */
const BASH_OUTLINE_TOKEN_RE = /[^\s"'`=(),;]*outline\.md/gi;

export interface GuardDecision {
  deny: boolean;
  reason?: string;
}

const DENY_COMMON =
  "outline files are human-only (typed by the user; the whole point is that " +
  "a human authored them). Read outlines with the Read tool; critique them " +
  "in outline-critique.md; ask the user to edit via `devx outline init` / " +
  "`devx outline commit` from their own terminal.";

/** Decide a PreToolUse hook payload. Unknown/malformed input allows —
 *  the guard must never brick unrelated tool use. */
export function guardDecision(payload: unknown): GuardDecision {
  if (typeof payload !== "object" || payload === null) return { deny: false };
  const p = payload as { tool_name?: unknown; tool_input?: unknown };
  const tool = typeof p.tool_name === "string" ? p.tool_name : "";
  const input =
    typeof p.tool_input === "object" && p.tool_input !== null
      ? (p.tool_input as Record<string, unknown>)
      : {};

  if (EDIT_TOOLS.has(tool)) {
    const target =
      (typeof input.file_path === "string" && input.file_path) ||
      (typeof input.notebook_path === "string" && input.notebook_path) ||
      "";
    if (target !== "" && isProtectedOutlinePath(target)) {
      return {
        deny: true,
        reason: `${tool} on '${target}' denied: ${DENY_COMMON}`,
      };
    }
    return { deny: false };
  }

  if (tool === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    if (command === "") return { deny: false };
    if (ALLOW_COMMAND_RE.test(command) && !SHELL_OPERATOR_RE.test(command)) {
      return { deny: false };
    }
    const tokens = command.match(BASH_OUTLINE_TOKEN_RE) ?? [];
    if (tokens.some((t) => isProtectedOutlinePath(t))) {
      return {
        deny: true,
        reason: `Bash command references an outline file — denied: ${DENY_COMMON}`,
      };
    }
  }

  return { deny: false };
}

/** Render the PreToolUse deny payload (Claude Code hooks JSON contract). */
export function renderDenyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

// ---------------------------------------------------------------------------
// Agent-session detection (L3)
// ---------------------------------------------------------------------------

/** Env markers that identify an agent-driven shell. CLAUDECODE is set by
 *  Claude Code's Bash tool; CHIRP_SESSION_ID by the Xirp session harness. */
export const AGENT_ENV_MARKERS = ["CLAUDECODE", "CHIRP_SESSION_ID"] as const;

/** True when the environment says an agent (not a plain human terminal) is
 *  running this process. */
export function isAgentSessionEnv(
  env: Record<string, string | undefined>,
): boolean {
  return AGENT_ENV_MARKERS.some((k) => {
    const v = env[k];
    return v !== undefined && v !== "";
  });
}

/** Refusal text for `devx outline init|commit` under an agent session. */
export function agentSessionRefusal(subcommand: string): string {
  return (
    `devx outline ${subcommand}: refusing to run inside an agent session ` +
    `(${AGENT_ENV_MARKERS.join("/")} set). Outlines are typed by a human — ` +
    `run this from your own terminal (outside Claude Code / Xirp).`
  );
}
