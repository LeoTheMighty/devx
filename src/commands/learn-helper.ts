// `devx learn-helper …` — CLI passthrough for the /devx-learn skill body and
// its hooks. Mirrors the plan-helper pattern: the skill body (or, for `listen`,
// Claude Code itself) invokes a small helper, the helper does the deterministic
// work, the caller uses the result.
//
//   slug   — the only mechanical piece of /devx-learn (design §Discarded
//            rejects a transcript-mining CLI arm — judgment stays prose).
//            Session content is untrusted, so branch/file slugs are minted here
//            and only here; the skill body never passes raw session text to
//            git/gh (E-6 guard).
//   listen — the Stop + SessionEnd hook entry point (rtl101). Registered in
//            `.claude/settings.json`, so it runs at every turn end in every
//            hooked repo.
//   report — the durable trace an unattended run leaves (c808b1). Mechanical
//            because the *location* is the point: an unattended tab's stdout
//            is not a delivery channel, so the run's decisions go to a fixed
//            path under the learn home plus an index line.
//   propose — the durable artifact a `propose` row leaves (c808b1).
//            Mechanical because the *destination* is the point, same as
//            `report`: a wedge-path or locked-machinery row that only got
//            printed dies with the tab, so it is written to
//            `docs/updates/` + a `dev/` spec + a `DEV.md` row (repo), or to
//            `<learn-home>/proposals/` (outlet 4, never committed).
//   route  — the apply-vs-propose predicate for an unattended run (c808b1).
//            Mechanical because it answers a harness fact — which paths hang
//            on a confirmation prompt an unattended tab cannot accept — not a
//            judgment call. See src/lib/learn/route.ts.
//
// Exit codes:
//   0 — always for `slug`; sanitized slug printed on stdout. The sanitizer
//       total-functions every input (empty/hostile → 'session-retro' or a
//       safe reduction), so there is no failure path.
//   0 — always for `listen`, on every path including garbage stdin and an
//       unwritable queue. A hook that can fail a turn is worse than a missed
//       detection (design.md §Constraints); the listener core is already total,
//       and the try/catch here is the second belt.
//   0 — always for `route`; the verdict is on stdout as JSON, not in the exit
//       status. A `propose` is a normal, expected answer, and an exit code a
//       shell reads as failure would make the skill body's `||` arms fire on
//       the routine path.
//   0 — always for `report`, including an unreadable payload: a run that
//       cannot report is indistinguishable from a run that hung, so a bad
//       payload still writes a degraded report (and says so on stderr)
//       rather than leaving nothing behind.
//   0 — for `propose` when the artifact landed; the printed paths are the
//       result. 1 when the write failed, because unlike `report` there is no
//       degraded form worth keeping: a proposal that half-landed would leave
//       a DEV.md row pointing at nothing, and the caller must know to retry
//       or fall back to the report row.
//   2 — commander usage error (unknown subcommand; handled by commander).
//
// Spec: dev/dev-hfi104-2026-07-24T10:41-devx-learn-skill.md (T4.2),
//       dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.4),
//       dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md (route, report, propose)
// Design: _devx/workstreams/harness-fold-in/design.md §Interfaces,
//         _devx/workstreams/retro-listener/design.md §Interfaces

import { readFileSync } from "node:fs";
import process from "node:process";

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import {
  type ListenerDeps,
  type ListenerResult,
  handleHookPayload,
  isRetroGuarded,
} from "../lib/learn/listener.js";
import { type LearnEnv, learnHome } from "../lib/learn/queue.js";
import {
  type LearnProposal,
  writePersonalProposal,
  writeRepoProposal,
} from "../lib/learn/propose.js";
import {
  type LearnReport,
  renderLearnReport,
  writeLearnReport,
} from "../lib/learn/report.js";
import { type LearnRouteOpts, routeLearnPaths } from "../lib/learn/route.js";
import { sanitizeLearnSlug } from "../lib/learn/slug.js";

export interface RunLearnSlugOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
}

/**
 * Sanitize the raw args into one slug. Multiple words arrive as separate
 * argv entries (the skill body passes unquoted prose); joining with a space
 * lets the sanitizer turn the gaps into dash separators. Zero args → the
 * 'session-retro' fallback, same as an empty string.
 */
export function runLearnSlug(args: string[], opts: RunLearnSlugOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  out(`${sanitizeLearnSlug(args.join(" "))}\n`);
  return 0;
}

export interface RunLearnRouteOpts extends LearnRouteOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Print only the decision word (`apply`/`propose`) instead of the JSON. */
  quiet?: boolean;
}

/**
 * `devx learn-helper route <path…>` — print the apply-vs-propose verdict for a
 * row's change set as JSON (`{decision, reason, verdicts}`), one verdict per
 * path so a report can name the rule that decided each one.
 *
 * Zero paths is not a usage error: a row whose "proposed change" never named a
 * file is exactly the row an unattended run must not apply, so it routes to
 * `propose` like any other unappliable row.
 *
 * `--locked` is the skill body's own guard walk speaking: the row would loosen
 * gate logic, a refusal path, a cascade rule, verdict vocabulary, or an
 * append-only discipline. It forces `propose` over every path rule, so a
 * locked row whose files are all ordinary `src/` code still cannot be applied.
 */
export function runLearnRoute(paths: string[], opts: RunLearnRouteOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const result = routeLearnPaths(paths, {
    repoRoot: opts.repoRoot,
    home: opts.home,
    // Threaded rather than defaulted: `--locked` is the caller's content-level
    // verdict, and omitting it must mean "not locked", not "unknown".
    locked: opts.locked,
  });
  out(opts.quiet ? `${result.decision}\n` : `${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

export interface RunLearnReportOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route warnings off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: stdin reader. Defaults to a blocking read of fd 0. */
  readInput?: () => string;
  /** Test seam / override: the learn home. Defaults to `learnHome(env)`. */
  home?: string;
  /** Test seam: env consulted for `DEVX_LEARN_HOME`. */
  env?: LearnEnv;
  /** Render to stdout without writing anything. */
  print?: boolean;
  /** Fallback `finishedAt` when the payload omits it (test seam: the clock). */
  now?: () => string;
}

/**
 * Coerce whatever arrived into a `LearnReport`. Deliberately permissive: the
 * caller is a skill body assembling JSON by hand at the end of a long run, and
 * every field it gets wrong is better absorbed here than turned into a missing
 * report. A payload that is not an object at all becomes an empty report whose
 * note says the payload was unreadable — still a report.
 */
export function coerceLearnReport(payload: unknown, note?: string): LearnReport {
  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(base.rows) ? base.rows : [];
  const report: LearnReport = {
    ...(base as LearnReport),
    rows: rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map((r) => ({
      learning: typeof r.learning === "string" ? r.learning : "",
      evidence: typeof r.evidence === "string" ? r.evidence : undefined,
      bucket: typeof r.bucket === "string" ? r.bucket : undefined,
      question: typeof r.question === "string" ? r.question : undefined,
      disposition:
        r.disposition === "applied" || r.disposition === "proposed" ? r.disposition : "dropped",
      reason: typeof r.reason === "string" ? r.reason : undefined,
      paths: Array.isArray(r.paths) ? r.paths.filter((p): p is string => typeof p === "string") : undefined,
      artifact: typeof r.artifact === "string" ? r.artifact : undefined,
    })),
  };
  if (note) report.note = note;
  return report;
}

/**
 * `devx learn-helper report [file]` — write the run report for a `/devx-learn`
 * pass and print the path it landed at.
 *
 * The payload is JSON on stdin (or in `file`). Nothing about it is trusted:
 * unknown fields pass through, wrong-typed ones are dropped, and an
 * unparseable payload still produces a report — the AC is that *every*
 * unattended run leaves one, and the run that fumbled its own JSON is
 * precisely the one worth a trace.
 */
export function runLearnReport(file: string | undefined, opts: RunLearnReportOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  let raw: string;
  try {
    raw = file && file !== "-" ? readFileSync(file, "utf8") : (opts.readInput ?? readStdin)();
  } catch {
    raw = "";
  }

  let parsed: unknown;
  let note: string | undefined;
  // Slug override for the degraded path: the note is a sentence, and a
  // filename built from it is unreadable exactly where legibility matters.
  let slug: string | undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
    note = "report payload was unreadable — writing a degraded report so the run still leaves a trace";
    slug = "unreadable-payload";
    err(`devx learn-helper report: ${note}\n`);
  }

  const report = coerceLearnReport(parsed, note);
  if (!report.finishedAt) report.finishedAt = (opts.now ?? (() => new Date().toISOString()))();
  if (!report.mode) report.mode = "unattended";

  if (opts.print) {
    out(renderLearnReport(report));
    return 0;
  }

  const home = opts.home ?? learnHome(opts.env ?? process.env);
  try {
    const written = writeLearnReport(report, { home, slug });
    out(`${written.path}\n`);
  } catch (writeErr) {
    err(`devx learn-helper report: could not write the report (${String(writeErr)})\n`);
    out(renderLearnReport(report));
  }
  return 0;
}

export interface RunLearnProposeOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route errors off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: stdin reader. Defaults to a blocking read of fd 0. */
  readInput?: () => string;
  /** `personal` writes outlet-4's snippet under the learn home; `repo`
   *  (default) files the doc + spec + backlog row. */
  target?: "repo" | "personal";
  /** Repo root for the `repo` target. Defaults to the process cwd. */
  repoRoot?: string;
  /** Learn home for the `personal` target. */
  home?: string;
  /** Test seam: env consulted for `DEVX_LEARN_HOME`. */
  env?: LearnEnv;
  /** Test seam: the clock. */
  now?: () => Date;
}

/**
 * Coerce whatever arrived into a `LearnProposal`. Permissive for the same
 * reason `coerceLearnReport` is: the caller is a skill body assembling JSON at
 * the end of a long run, and a fumbled field must not be the reason a row the
 * run refused to apply also fails to get written down.
 *
 * A missing title is the one field with a real consequence (it is the slug
 * source), so it degrades to a named fallback rather than an empty string.
 */
export function coerceLearnProposal(payload: unknown): LearnProposal {
  const base =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    title: str(base.title) ?? "unnamed learn proposal",
    evidence: str(base.evidence),
    bucket: str(base.bucket),
    question: str(base.question),
    reason: str(base.reason),
    change: str(base.change),
    sessionId: str(base.sessionId),
    locked: base.locked === true,
    paths: Array.isArray(base.paths)
      ? base.paths.filter((p): p is string => typeof p === "string")
      : undefined,
  };
}

/**
 * `devx learn-helper propose [file]` — write the durable artifact for one row
 * an unattended run may not apply, and print where it landed.
 *
 * Prints one path per line (`repo` prints the doc, the spec and the backlog
 * file) so the caller can paste them straight into the run report's `artifact`
 * column without re-deriving any of them — a rendered artifact is never
 * scraped to rebuild its own inputs.
 */
export function runLearnPropose(file: string | undefined, opts: RunLearnProposeOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  let raw: string;
  try {
    raw = file && file !== "-" ? readFileSync(file, "utf8") : (opts.readInput ?? readStdin)();
  } catch {
    raw = "";
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    err("devx learn-helper propose: payload was not readable JSON — nothing written\n");
    return 1;
  }

  const proposal = coerceLearnProposal(parsed);
  const finishedAt = (opts.now ?? (() => new Date()))().toISOString();

  try {
    if (opts.target === "personal") {
      const path = writePersonalProposal(proposal, {
        home: opts.home ?? learnHome(opts.env ?? process.env),
        finishedAt,
      });
      out(`${path}\n`);
      return 0;
    }
    const written = writeRepoProposal(proposal, {
      repoRoot: opts.repoRoot ?? process.cwd(),
      finishedAt,
      now: opts.now,
    });
    out(`${written.docPath}\n${written.specPath}\n${written.devMdPath}\n`);
    return 0;
  } catch (writeErr) {
    err(`devx learn-helper propose: could not write the proposal (${String(writeErr)})\n`);
    return 1;
  }
}

export interface RunLearnListenOpts {
  /** Test seam: the hook environment (`DEVX_RETRO`, `DEVX_LEARN_HOME`). */
  env?: LearnEnv;
  /** Test seam: stdin reader. Defaults to a blocking read of fd 0. */
  readInput?: () => string;
  /** Test seam: forwarded to the listener core (clock, lock options). */
  deps?: ListenerDeps;
  /** Test seam: observe what the listener decided (nothing is printed). */
  onResult?: (result: ListenerResult) => void;
}

/**
 * Read the whole of stdin as one string.
 *
 * `readFileSync(0)` rather than the stream API on purpose: the hook payload is
 * small and already buffered by the time Claude Code spawns us, and a
 * synchronous read keeps the process from paying an event-loop turn per
 * invocation — the G-3 latency bound (p95 < 500ms end to end, E-7) is spent
 * almost entirely on node startup, so nothing else here may add to it.
 *
 * Throws when stdin is a TTY with nothing to give (EAGAIN); the caller treats
 * that like any other failure — exit 0, do nothing.
 */
function readStdin(): string {
  return readFileSync(0, "utf8");
}

/**
 * `devx learn-helper listen` — one hook payload from stdin, at most one queue
 * append or marker touch, exit 0 unconditionally.
 *
 * The order matters: the `DEVX_RETRO` guard is answered *before* stdin is
 * touched (E-2), and a payload that isn't JSON is a no-op rather than an error
 * — Claude Code owns that pipe, and speculating about a malformed payload is
 * strictly worse than ignoring it.
 */
export function runLearnListen(opts: RunLearnListenOpts = {}): number {
  try {
    const env = opts.env ?? process.env;
    if (isRetroGuarded(env)) return 0;

    let payload: unknown;
    try {
      payload = JSON.parse((opts.readInput ?? readStdin)());
    } catch {
      return 0; // unreadable stdin or non-JSON payload — nothing to detect
    }

    const result = handleHookPayload(payload, env, opts.deps);
    opts.onResult?.(result);
  } catch {
    // Unreachable in principle (the core is total) and swallowed in practice:
    // no error this command could report is worth failing a turn over.
  }
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("learn-helper")
    .description(
      "Helpers invoked by the /devx-learn skill body. Subcommand-driven; mirrors `devx plan-helper`'s passthrough pattern.",
    );

  sub
    .command("slug")
    .description(
      "Sanitize free text into a safe slug for learn branches/files (lowercase, [a-z0-9-], ≤40 chars; empty → 'session-retro'). The only sanctioned path from session text to git/gh names.",
    )
    .argument("[raw...]", "raw text to sanitize (session-mined learning title)")
    .action((raw: string[]) => {
      const code = runLearnSlug(raw ?? []);
      if (code !== 0) process.exit(code);
    });

  sub
    .command("route")
    .description(
      "Apply-vs-propose predicate for an unattended /devx-learn run: prints {decision, reason, verdicts} JSON for the given paths. `propose` for anything an unattended tab cannot edit (.claude/**, skills/**, settings.json, outside the repo) and for --locked rows; `apply` otherwise. Exit 0 either way.",
    )
    .argument("[paths...]", "paths the row would change (repo-relative or absolute)")
    .option("-q, --quiet", "print only the decision word")
    .option("--repo-root <dir>", "repo root the paths are relative to (default: cwd)")
    .option(
      "--locked",
      "the row would loosen locked machinery (gate logic, refusal paths, cascade rules, verdict vocabulary, append-only disciplines) — forces `propose` regardless of the paths",
    )
    .action((paths: string[], options: { quiet?: boolean; repoRoot?: string; locked?: boolean }) => {
      const code = runLearnRoute(paths ?? [], {
        quiet: options.quiet,
        repoRoot: options.repoRoot,
        locked: options.locked,
      });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("report")
    .description(
      "Write the run report for a /devx-learn pass (JSON payload on stdin or in <file>) to <learn-home>/reports/ plus a line in reports/index.md, and print the path. Written on every path including the found-nothing one; exit 0 always.",
    )
    .argument("[file]", "JSON payload file ('-' or omitted reads stdin)")
    .option("--home <dir>", "learn home to write under (default: $DEVX_LEARN_HOME or ~/.claude/devx)")
    .option("--print", "render the report to stdout instead of writing it")
    .action((file: string | undefined, options: { home?: string; print?: boolean }) => {
      runLearnReport(file, { home: options.home, print: options.print });
    });

  sub
    .command("propose")
    .description(
      "Write the durable artifact for a /devx-learn row that may not be applied (JSON payload on stdin or in <file>): docs/updates/<date>-<slug>.md + a dev/ spec + a DEV.md row, or --target personal for an outlet-4 snippet under the learn home. Prints the paths written.",
    )
    .argument("[file]", "JSON payload file ('-' or omitted reads stdin)")
    .option("--target <kind>", "'repo' (doc + spec + backlog row) or 'personal' (outlet 4)", "repo")
    .option("--repo-root <dir>", "repo root to write under (default: cwd)")
    .option("--home <dir>", "learn home for --target personal (default: $DEVX_LEARN_HOME or ~/.claude/devx)")
    .action((file: string | undefined, options: { target?: string; repoRoot?: string; home?: string }) => {
      const code = runLearnPropose(file, {
        target: options.target === "personal" ? "personal" : "repo",
        repoRoot: options.repoRoot,
        home: options.home,
      });
      if (code !== 0) process.exit(code);
    });

  sub
    .command("listen")
    .description(
      "Claude Code Stop/SessionEnd hook entry point: reads one hook payload on stdin and queues the session for a /devx-learn retro when the wrap-up carried the canonical nudge. Silent, non-blocking, exits 0 on every path.",
    )
    .action(() => {
      runLearnListen();
    });

  attachPhase(sub, 1);
}
