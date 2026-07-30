// Defensive `learn:` config reads for the retro watcher (rtl102).
//
// Mirrors the loopConfigFrom pattern (src/lib/loop/config.ts): a merged
// config blob in, a fully-defaulted LearnConfig out, per-key fallback so a
// half-typed config edit degrades to the design defaults instead of wedging
// the drain loop.
//
// WHO READS THIS: the watcher (`devx learn-watch`) and the `/devx-init` hook
// install step — nobody else. The LISTENER MUST NOT (design.md §Constraints,
// G-3): it runs at every turn end in every hooked repo under a <500ms p95
// budget, so it resolves its home from `DEVX_LEARN_HOME` + the built-in
// default only (`learnHome`, src/lib/learn/queue.ts). That split is why
// `resolveLearnHome` below delegates the env arm verbatim to `learnHome`
// rather than re-implementing it: the two resolvers point at the same
// directory on every path they share, or the watcher drains a queue the
// listener isn't writing to.
//
// Precedence (design.md §Interfaces): `DEVX_LEARN_HOME` > config `learn.home`
// > `~/.claude/devx`.
//
// Spec: dev/dev-rtl102-2026-07-30T09:31-learn-config-section.md
// Plan: _devx/workstreams/retro-listener/plan.md §Phase 2

import { homedir } from "node:os";
import { join } from "node:path";

import { LEARN_HOME_ENV, type LearnEnv, learnHome } from "./queue.js";

export interface LearnConfig {
  /** Transcript-mtime quiet window that reads as "session over" (minutes). */
  idleMinutes: number;
  /** How long a spawned retro may run before the watcher retires it as
   *  `timeout` (minutes) — the SIGKILL case the wrapper's trap can't cover. */
  retroTimeoutMinutes: number;
  /** Queue home AS WRITTEN in config: may be `~`-relative. Run it through
   *  `resolveLearnHome` before touching the filesystem. */
  home: string;
}

export const LEARN_DEFAULTS: LearnConfig = {
  idleMinutes: 15,
  retroTimeoutMinutes: 360,
  home: "~/.claude/devx",
};

/** Positive finite minutes, fractions allowed (sub-minute windows are useful
 *  in tests and for an impatient human). Zero would make the idle window
 *  "always ready" and the retro timeout "always expired" — both reject. */
function posMinutes(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v > 0 ? v : null;
}

function nonBlankString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Narrow a merged-config blob down to the learn knobs, falling back per-key
 * to LEARN_DEFAULTS. Total: any input shape (missing block, wrong type,
 * array, scalar) yields a complete config.
 */
export function learnConfigFrom(merged: unknown): LearnConfig {
  const out: LearnConfig = { ...LEARN_DEFAULTS };
  if (!merged || typeof merged !== "object" || Array.isArray(merged)) return out;
  const learn = (merged as Record<string, unknown>).learn;
  if (!learn || typeof learn !== "object" || Array.isArray(learn)) return out;
  const l = learn as Record<string, unknown>;

  const idle = posMinutes(l.idle_minutes);
  if (idle !== null) out.idleMinutes = idle;
  const timeout = posMinutes(l.retro_timeout_minutes);
  if (timeout !== null) out.retroTimeoutMinutes = timeout;
  const home = nonBlankString(l.home);
  if (home !== null) out.home = home;

  return out;
}

/** Expand a leading `~` path segment against the current home directory.
 *  `~foo` (a `~user` reference or a literal relative dir) is left alone —
 *  node has no `~user` resolution and guessing would invent a path. */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/**
 * Resolve the queue home the watcher should use: `DEVX_LEARN_HOME` env >
 * config `learn.home` > `~/.claude/devx`, with `~` expanded on the config
 * and default arms.
 *
 * The env arm defers to `learnHome` so an override resolves identically here
 * and in the listener (which has no config to consult) — including the
 * deliberate no-expansion of a raw `~` in the env value, since a shell
 * expands it before the process ever sees it and silently rewriting an
 * explicit override would be worse than honoring it verbatim.
 */
export function resolveLearnHome(
  merged: unknown,
  env: LearnEnv = process.env,
): string {
  const override = env[LEARN_HOME_ENV];
  if (typeof override === "string" && override.trim() !== "") {
    return learnHome(env);
  }
  return expandTilde(learnConfigFrom(merged).home);
}
