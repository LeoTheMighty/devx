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
// Protected set: any path whose basename is exactly `outline.md` (case-
// sensitive), plus the repo-root `OUTLINE.md`. Deliberately basename-broad
// rather than layout-aware: a future stage dir gains protection for free,
// and the guard can never fall out of sync with the artifact layout.
// `outline-critique.md` (workstream or root) is NOT protected — the critique
// is the agent's product.
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

/** Repo-root project outline critique — agent-writable, listed here only so
 *  callers can name it without re-spelling. */
export const PROJECT_OUTLINE_CRITIQUE_REL = "OUTLINE-CRITIQUE.md";

/** Shipped outline TEMPLATES are the one exception: they are agent-authored
 *  scaffolds (`devx outline init` instantiates from them), not human
 *  outlines — without this carve-out every template change would fail the
 *  PR-diff scan and the hook would block devx's own packaging. */
const TEMPLATE_PATH_RE = /(^|\/)_devx\/templates\//;

/** True when a path (absolute or repo-relative, / or \ separated) names a
 *  protected outline file. */
export function isProtectedOutlinePath(path: string): boolean {
  const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (TEMPLATE_PATH_RE.test(norm)) return false;
  const base = norm.split("/").pop() ?? norm;
  if (base === OUTLINE_BASENAME) return true;
  // Repo-root OUTLINE.md: exact basename match. A bare basename is how the
  // diff scan sees it (git prints repo-relative paths), and an absolute
  // editor path ends in /OUTLINE.md either way. OUTLINE-CRITIQUE.md is the
  // agent's product and deliberately does not match.
  return base === PROJECT_OUTLINE_REL;
}

/** Filter a `git diff --name-only` listing down to protected outline paths. */
export function classifyDiffNames(names: readonly string[]): string[] {
  return names.map((n) => n.trim()).filter((n) => n !== "" && isProtectedOutlinePath(n));
}

// ---------------------------------------------------------------------------
// PreToolUse guard decision
// ---------------------------------------------------------------------------

/** Tools whose file target the guard inspects (hook matcher counterpart). */
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/** Bash commands allowed to *mention* outline paths: the mechanical checks
 *  themselves. Everything else that references an outline in a Bash command
 *  is denied — reads go through the Read tool, writes are the human's. */
const BASH_ALLOW_PREFIX_RE = /^\s*devx\s+outline\s+(check|guard)\b/;

/** Path-ish tokens mentioning an outline file inside a shell command —
 *  catches redirects, cp/mv/sed targets, heredocs, anything that names the
 *  file. Each token is then classified with isProtectedOutlinePath, so
 *  template-path mentions (agent-legitimate) pass while real outline
 *  references deny. */
const BASH_OUTLINE_TOKEN_RE = /[^\s"'`=(),;]*(?:outline\.md|OUTLINE\.md)/g;

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
    if (command === "" || BASH_ALLOW_PREFIX_RE.test(command)) {
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
