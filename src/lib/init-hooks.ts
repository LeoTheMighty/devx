// rtl105 — Claude Code hook registration installer (`.claude/settings.json`).
//
// Registers the devx retro listener (`devx learn-helper listen`) on the Stop
// and SessionEnd hook events of a consumer repo, so the closed loop inherits
// detection with zero per-repo setup.
//
// Ownership model (the `installSkills`/`decideSkillInstall` discipline of
// src/lib/init-skills.ts, adapted): hooks are *entries inside a shared file*
// rather than whole files, so the rule is merge-not-overwrite. A devx-owned
// entry is identified solely by its command string (`devx learn-helper
// listen`) — everything else in the file is the user's and is never rewritten,
// reordered, or dropped. When there is nothing semantically to add we do not
// write at all, so a user's formatting survives byte-intact and a re-run is a
// 0-byte diff by construction.
//
// Never call this from a subagent: settings edits are gated by a harness
// confirmation prompt that only a foreground session can answer (memory
// `project_skill_perms_block_subagents.md`). `/devx-init` runs
// user-foreground, which is why the wiring lives in init-orchestrator.
//
// Spec: dev/dev-rtl105-2026-07-30T09:31-init-hook-distribution.md
// Design: _devx/workstreams/retro-listener/design.md §Architecture (Install)

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// The registration (single source; the shipped template fragment and this
// repo's committed .claude/settings.json are both pinned against it by
// test/learn-hook-install.test.ts).
// ---------------------------------------------------------------------------

/** The command string that marks a hook entry devx-owned. Ownership is keyed
 *  on this exact string (whitespace-trimmed) — not on position, not on a
 *  marker comment, because settings.json has nowhere to put one. */
export const HOOK_COMMAND = "devx learn-helper listen";

/** The hook events the listener registers on. Stop carries the nudge check;
 *  SessionEnd closes the session out. */
export const HOOK_EVENTS = ["Stop", "SessionEnd"] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/** The settings fragment devx merges in. Returns a fresh deep copy each call
 *  so callers can mutate the result without corrupting the source of truth. */
export function hookFragment(): { hooks: Record<string, unknown[]> } {
  const entry = () => ({
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  });
  return { hooks: { Stop: [entry()], SessionEnd: [entry()] } };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HookInstallAction = "created" | "merged" | "unchanged";

export interface HookInstallOutcome {
  /** Absolute (or caller-supplied) path of the settings file acted on. */
  path: string;
  action: HookInstallAction;
  /** Events a devx registration was appended to this run. Empty on
   *  `unchanged`; both events on a fresh `created`. */
  added: HookEvent[];
}

export interface InstallHooksOpts {
  /** Repo the settings file belongs to. Used to derive the default path. */
  repoRoot: string;
  /** Override the settings file. Defaults to `<repoRoot>/.claude/settings.json`. */
  settingsPath?: string;
  /** Compute the outcome without touching disk. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

/** Merge the Stop/SessionEnd registrations into the repo's Claude Code
 *  settings, atomically (tmp+rename via `writeAtomic`).
 *
 *  - file absent → `created` with the fragment alone.
 *  - file present, a devx registration already on every event → `unchanged`,
 *    and **no write happens** (the user's byte layout is left alone).
 *  - otherwise → `merged`: our entry is appended *after* the user's existing
 *    entries for that event; every other entry, event and top-level key is
 *    carried across untouched and in its original order.
 *
 *  Throws (never clobbers) when the existing file is not parseable JSON, is
 *  not a JSON object, or holds a `hooks` / `hooks.<event>` value of an
 *  unexpected shape — a file we can't classify is not a file we rewrite. */
export function installHooks(opts: InstallHooksOpts): HookInstallOutcome {
  const path = opts.settingsPath ?? join(opts.repoRoot, ".claude", "settings.json");

  const existingRaw = readExisting(path);
  const fragment = hookFragment();

  if (existingRaw === null) {
    const content = JSON.stringify(fragment, null, 2) + "\n";
    if (!opts.dryRun) writeAtomic(path, content);
    return { path, action: "created", added: [...HOOK_EVENTS] };
  }

  const settings = parseSettings(existingRaw, path);
  const hooks = readHooksSection(settings, path);

  const added: HookEvent[] = [];
  for (const event of HOOK_EVENTS) {
    const entries = readEventEntries(hooks, event, path);
    if (entries.some(hasDevxCommand)) continue;
    // Append, never prepend: the user's entries keep their indices, and the
    // listener observes the session after any hook the user already ran.
    hooks[event] = [...entries, ...fragment.hooks[event]!];
    added.push(event);
  }

  if (added.length === 0) {
    return { path, action: "unchanged", added: [] };
  }

  settings.hooks = hooks;
  const content = render(settings, existingRaw);
  if (!opts.dryRun) writeAtomic(path, content);
  return { path, action: "merged", added };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the settings file, or null when it is absent. A path that exists but
 *  is not a regular file (a directory squatting on settings.json) throws
 *  rather than surfacing a raw EISDIR mid-init. */
function readExisting(path: string): string | null {
  if (!existsSync(path)) return null;
  if (!statSync(path).isFile()) {
    throw new Error(
      `installHooks: ${path} exists but is not a regular file — move it aside and re-run`,
    );
  }
  return readFileSync(path, "utf8");
}

function parseSettings(raw: string, path: string): Record<string, unknown> {
  // An empty (or whitespace-only) file is a common half-written state; treat
  // it as an empty object rather than a parse failure.
  if (raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `installHooks: ${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}) — ` +
        `devx will not rewrite a settings file it cannot parse; fix or move it aside and re-run`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `installHooks: ${path} does not hold a JSON object — devx will not rewrite it`,
    );
  }
  return parsed as Record<string, unknown>;
}

function readHooksSection(
  settings: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const hooks = settings.hooks;
  if (hooks === undefined) return {};
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new Error(
      `installHooks: ${path} has a "hooks" key that is not a JSON object — devx will not rewrite it`,
    );
  }
  return hooks as Record<string, unknown>;
}

function readEventEntries(
  hooks: Record<string, unknown>,
  event: HookEvent,
  path: string,
): unknown[] {
  const entries = hooks[event];
  if (entries === undefined) return [];
  if (!Array.isArray(entries)) {
    throw new Error(
      `installHooks: ${path} has a "hooks.${event}" value that is not an array — devx will not rewrite it`,
    );
  }
  return entries;
}

/** True when a matcher group already carries the devx command — the one
 *  ownership signal. Tolerates a group the user extended with their own hooks
 *  alongside ours: it is still ours-is-present, so we add nothing. */
function hasDevxCommand(entry: unknown): boolean {
  if (entry === null || typeof entry !== "object") return false;
  const inner = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(inner)) return false;
  return inner.some((h) => {
    if (h === null || typeof h !== "object") return false;
    const command = (h as { command?: unknown }).command;
    return typeof command === "string" && command.trim() === HOOK_COMMAND;
  });
}

/** Serialize, matching the original file's indent and trailing-newline habit
 *  so a merge shows up in the user's diff as the added entries and nothing
 *  else. */
function render(settings: Record<string, unknown>, original: string): string {
  const indent = detectIndent(original);
  const body = JSON.stringify(settings, null, indent);
  return original.endsWith("\n") || original.trim() === "" ? body + "\n" : body;
}

/** Infer the indent unit from the first indented line. Falls back to two
 *  spaces (what devx writes on a fresh create). */
function detectIndent(original: string): string | number {
  const m = /^([ \t]+)\S/m.exec(original);
  if (!m) return 2;
  const unit = m[1]!;
  return unit.startsWith("\t") ? "\t" : unit.length;
}
