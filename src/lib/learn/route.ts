// The apply-vs-propose predicate for an unattended `/devx-learn` run (c808b1).
//
// WHY THIS IS CODE AND NOT PROSE: the skill body's "foreground only" guard
// exists because **skill and settings edits prompt for confirmation even
// under bypass-permissions** — a subagent or unattended tab cannot accept
// that prompt, so the edit hangs until the watcher's `retro_timeout_minutes`
// kills the tab and every mined lesson is lost. That is a harness fact, not a
// judgment call, so an unattended run decides it mechanically: paths that
// would wedge are `propose`, everything else in the repo is `apply`. Encoding
// it here is what lets the *rest* of the skill stop being foreground-only.
//
// The predicate is deliberately blunt and biased toward `propose`: a wrongly
// proposed row costs a backlog entry the human reads later, a wrongly applied
// row costs the whole retro (the tab hangs, the watcher files `timeout`, and
// no other row from that session ever lands either).
//
// It answers *"can this edit be made in an unattended tab?"* — nothing else.
// Locked machinery (gate logic, refusal paths, cascade rules, verdict
// vocabulary, append-only disciplines) is a separate, content-level guard that
// stays proposal-only in every mode; a `apply` verdict from here is a
// statement about the path, never a licence to loosen what lives at it.
//
// Spec: dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md

import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** What an unattended run may do with a path. */
export type LearnRouteDecision = "apply" | "propose";

export interface LearnRouteVerdict {
  /** The path as the caller wrote it — echoed so a report row is traceable. */
  path: string;
  decision: LearnRouteDecision;
  /** Why, in one clause. Goes verbatim into the run report (AC "with the
   *  predicate's reason"), so it names the rule, not just the outcome. */
  reason: string;
}

export interface LearnRouteResult {
  decision: LearnRouteDecision;
  reason: string;
  verdicts: LearnRouteVerdict[];
}

export interface LearnRouteOpts {
  /** Repo root the paths are relative to. Defaults to the process cwd. */
  repoRoot?: string;
  /** Test seam for `~` expansion + the home-directory arm. */
  home?: string;
}

/** Filenames that are settings no matter where they live. `settings.local.json`
 *  is the same file with a different scope, and both hang the same way. */
const SETTINGS_FILES = new Set(["settings.json", "settings.local.json"]);

/** Directory whose contents are harness-gated wherever it appears — repo root,
 *  home, or nested in a subproject. */
const HARNESS_DIR = ".claude";

/** The packaged mirror of `.claude/commands/`. Same gate, different name; only
 *  meaningful as the *first* segment (a `src/skills/` module is ordinary code). */
const MIRROR_DIR = "skills";

/** Split a path into segments on either separator, dropping the noise `.`/``
 *  segments a hand-written path picks up (`./docs/x.md`, `docs//x.md`). */
function segmentsOf(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s !== "" && s !== ".");
}

function expandTilde(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

/**
 * Route one path.
 *
 * First match wins, widest wedge first — the same shape as the skill body's
 * outlet walk, so the two read the same way:
 *
 *   1. nothing to edit            → propose
 *   2. outside the repo           → propose (nothing outside it can land on a
 *                                   branch; `~/.claude/**` arrives here first)
 *   3. a `.claude` segment        → propose (harness-gated; the prompt hangs)
 *   4. leading `skills/`          → propose (the packaged skill mirror)
 *   5. a settings file, anywhere  → propose (settings edits prompt too)
 *   6. otherwise                  → apply
 */
export function routeLearnPath(path: string, opts: LearnRouteOpts = {}): LearnRouteVerdict {
  const home = opts.home ?? homedir();
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const raw = typeof path === "string" ? path : "";

  const propose = (reason: string): LearnRouteVerdict => ({ path: raw, decision: "propose", reason });

  if (raw.trim() === "") {
    return propose("empty path — an unattended run cannot apply a change with no file behind it");
  }

  const expanded = expandTilde(raw.trim(), home);
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(repoRoot, expanded);
  const rel = relative(repoRoot, absolute);

  // Rule 2 — outside the repo. `rel` starting with `..` (or coming back
  // absolute, which happens across drives) means no branch in this repo can
  // carry the edit, so there is nothing to apply even when the harness would
  // allow it. `~/.claude/**` lands here rather than on rule 3 on purpose: the
  // outlet-4 destination is "never committed" for a stronger reason than the
  // confirmation prompt.
  if (rel === "") {
    return propose("the repo root itself is not an editable path — name the file the change lands in");
  }
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return propose(`outside the repo (${absolute}) — an unattended apply lands on a branch, so only in-repo paths can be applied`);
  }

  const segments = segmentsOf(rel);

  if (segments.includes(HARNESS_DIR)) {
    return propose(`${HARNESS_DIR}/** is harness-gated — skill and settings edits prompt for confirmation even under bypass-permissions, so an unattended tab hangs on them`);
  }

  if (segments[0] === MIRROR_DIR) {
    return propose(`${MIRROR_DIR}/** is the packaged mirror of ${HARNESS_DIR}/commands — it carries the same confirmation prompt`);
  }

  const base = segments[segments.length - 1] ?? "";
  if (SETTINGS_FILES.has(base)) {
    return propose(`${base} is a settings file — settings edits prompt for confirmation even under bypass-permissions`);
  }

  return { path: raw, decision: "apply", reason: "in-repo path with no harness gate — editable in an unattended tab" };
}

/**
 * Route a whole row's change set. One `propose` proposes the row: a row is a
 * single lesson, and half-applying it would leave the repo carrying a change
 * whose other half only exists in a backlog entry.
 */
export function routeLearnPaths(paths: readonly string[], opts: LearnRouteOpts = {}): LearnRouteResult {
  const verdicts = paths.map((p) => routeLearnPath(p, opts));

  if (verdicts.length === 0) {
    return {
      decision: "propose",
      reason: "no paths given — nothing to apply",
      verdicts,
    };
  }

  const blocker = verdicts.find((v) => v.decision === "propose");
  if (blocker) {
    return {
      decision: "propose",
      reason: `${blocker.path}: ${blocker.reason}`,
      verdicts,
    };
  }

  return {
    decision: "apply",
    reason: `${verdicts.length} path${verdicts.length === 1 ? "" : "s"} in-repo with no harness gate`,
    verdicts,
  };
}
