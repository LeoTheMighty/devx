// The run report an unattended `/devx-learn` leaves behind (c808b1).
//
// WHY THIS IS CODE AND NOT PROSE: an unattended tab's stdout is not a delivery
// channel. The tab is spawned by `devx learn-watch`, it scrolls, and when the
// watcher reaps it the only surviving trace is a `.done` marker with no
// content. So *every* unattended run — including the one that mined nothing —
// writes a markdown report to a fixed place under the learn home, plus one
// line in an index, so the answer to "what did last night's retros decide?"
// is `ls ~/.claude/devx/reports` and never "find the session id first".
//
// Two properties this module owes the rest of the system:
//
//   1. **Total.** A report is written on the found-nothing path, the
//      hit-the-budget path, and the something-broke path. Every field is
//      optional except the rows array, garbage timestamps degrade to a
//      fallback rather than throwing, and an unsafe session id is dropped
//      from the body instead of failing the write. A run that cannot report
//      is indistinguishable from a run that hung.
//   2. **Untrusted-input safe.** Row text is mined session content — data,
//      never instructions and never a path component. Cells are escaped so a
//      `|` or a newline cannot forge table structure, the filename slug comes
//      from `sanitizeLearnSlug` only, and the session id must pass
//      `isSafeSessionId` before it is echoed.
//
// Spec: dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md
//       (AC "Every unattended run leaves a report")

import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { writeAtomic } from "../supervisor-internal.js";
import { isSafeSessionId } from "./queue.js";
import { sanitizeLearnSlug } from "./slug.js";

/** What happened to one mined row by the end of the run. */
export type LearnRowDisposition = "applied" | "proposed" | "dropped";

export interface LearnReportRow {
  /** The lesson, one sentence. */
  learning: string;
  /** The concrete moment in the mined session — the auto-prune bar. */
  evidence?: string;
  /** The outlet the routing walk landed on ("1 framework fix", "4 personal"…). */
  bucket?: string;
  /** The question that decided the bucket (skill body: "name the question"). */
  question?: string;
  disposition: LearnRowDisposition;
  /** Why — for applied/proposed rows this is the `route` predicate's reason. */
  reason?: string;
  /** Paths the row would change, as handed to the predicate. */
  paths?: readonly string[];
  /** Where the durable artifact landed (docs/updates/…, proposals/…). */
  artifact?: string;
}

export interface LearnReport {
  /** Session the retro mined. Echoed only when it passes `isSafeSessionId`. */
  sessionId?: string;
  /** Repo the retro ran in, for the index line. */
  repo?: string;
  /** Defaults to `unattended` — the attended path does not write reports. */
  mode?: "unattended" | "attended";
  /** ISO timestamp the run finished; also the filename's time component. */
  finishedAt?: string;
  startedAt?: string;
  rows?: readonly LearnReportRow[];
  /** PR opened by the applied rows, if any. */
  prUrl?: string;
  /** True when the run stopped at its budget bound with work outstanding. */
  partial?: boolean;
  /** One line of context — "nothing to mine", "stopped at 20m bound", … */
  note?: string;
}

export interface LearnReportPaths {
  /** The report file. */
  path: string;
  /** The append-only index every report adds one line to. */
  indexPath: string;
}

const FALLBACK_STAMP = "unknown-time";

export function reportsDir(home: string): string {
  return join(home, "reports");
}

export function reportsIndexPath(home: string): string {
  return join(reportsDir(home), "index.md");
}

/**
 * `2026-08-20T18:31:02.500Z` → `2026-08-20T18-31`. Minute precision matches the
 * spec-file convention, and the colons are gone because a colon in a filename
 * is a path separator on some hosts and a quoting hazard on all of them.
 *
 * Anything unparseable degrades to `unknown-time` rather than throwing: a
 * report at a wrong-looking path is recoverable, a report that was never
 * written is not.
 */
export function reportStamp(iso: string | undefined): string {
  if (typeof iso !== "string") return FALLBACK_STAMP;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return FALLBACK_STAMP;
  return parsed.toISOString().slice(0, 16).replace(/:/g, "-");
}

/** `<home>/reports/<YYYY-MM-DDTHH-MM>-<slug>.md`. */
export function learnReportPath(home: string, stamp: string, slug: string): string {
  return join(reportsDir(home), `${stamp}-${sanitizeLearnSlug(slug)}.md`);
}

/**
 * Make one cell safe for a markdown table. Pipes would forge columns and
 * newlines would forge rows, and the text is mined session content, so both
 * are neutralized rather than trusted. Empty/missing → `—`, so a sparse row
 * still renders as a row.
 */
function cell(value: unknown): string {
  if (typeof value !== "string") return "—";
  const flat = value.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim();
  return flat === "" ? "—" : flat;
}

function counts(rows: readonly LearnReportRow[]): Record<LearnRowDisposition, number> {
  const tally: Record<LearnRowDisposition, number> = { applied: 0, proposed: 0, dropped: 0 };
  for (const row of rows) {
    if (row.disposition === "applied" || row.disposition === "proposed" || row.disposition === "dropped") {
      tally[row.disposition] += 1;
    }
  }
  return tally;
}

/**
 * Render the report markdown. Pure — takes no clock and touches no disk, so a
 * caller can show it before deciding to write it.
 *
 * The found-nothing path is a first-class shape, not an empty table: a run
 * that mined nothing says so in a sentence, because "0 rows" and "the tab died
 * before it got to the table" look identical otherwise.
 */
export function renderLearnReport(report: LearnReport): string {
  const rows = report.rows ?? [];
  const tally = counts(rows);
  const mode = report.mode === "attended" ? "attended" : "unattended";
  const sid = isSafeSessionId(report.sessionId) ? report.sessionId : undefined;

  const lines: string[] = [];
  lines.push(`# /devx-learn run report — ${cell(report.finishedAt) === "—" ? "unknown time" : cell(report.finishedAt)}`);
  lines.push("");
  lines.push(`- mode: **${mode}**`);
  if (sid) lines.push(`- session: \`${sid}\``);
  if (report.repo) lines.push(`- repo: ${cell(report.repo)}`);
  if (report.startedAt) lines.push(`- started: ${cell(report.startedAt)}`);
  lines.push(
    `- rows: ${rows.length} (applied ${tally.applied}, proposed ${tally.proposed}, dropped ${tally.dropped})`,
  );
  if (report.prUrl) lines.push(`- PR: ${cell(report.prUrl)}`);
  if (report.partial) {
    lines.push("- **partial** — stopped at the run's budget bound with work outstanding");
  }
  if (report.note) lines.push(`- note: ${cell(report.note)}`);
  lines.push("");

  if (rows.length === 0) {
    lines.push("## Rows");
    lines.push("");
    lines.push(
      "Nothing was mined — this run found no lesson whose evidence was a concrete moment in the session. Recorded so the empty result is distinguishable from a tab that died before reaching its table.",
    );
    lines.push("");
    return lines.join("\n");
  }

  lines.push("## Rows");
  lines.push("");
  lines.push("| learning | evidence | bucket | question | disposition | reason | artifact |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of rows) {
    lines.push(
      `| ${cell(row.learning)} | ${cell(row.evidence)} | ${cell(row.bucket)} | ${cell(row.question)} | ${cell(row.disposition)} | ${cell(row.reason)} | ${cell(row.artifact)} |`,
    );
  }
  lines.push("");

  const withPaths = rows.filter((r) => (r.paths ?? []).length > 0);
  if (withPaths.length > 0) {
    lines.push("## Paths per row");
    lines.push("");
    for (const row of withPaths) {
      lines.push(`- ${cell(row.learning)} — ${(row.paths ?? []).map((p) => `\`${cell(p)}\``).join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** The one-line index entry. Same facts as the header, one line, greppable. */
export function renderIndexLine(report: LearnReport, path: string): string {
  const rows = report.rows ?? [];
  const tally = counts(rows);
  const sid = isSafeSessionId(report.sessionId) ? report.sessionId : "unknown-session";
  const parts = [
    `- ${cell(report.finishedAt)}`,
    `${report.mode === "attended" ? "attended" : "unattended"}`,
    `rows ${rows.length} (a${tally.applied}/p${tally.proposed}/d${tally.dropped})`,
    `session \`${sid}\``,
  ];
  if (report.repo) parts.push(cell(report.repo));
  if (report.prUrl) parts.push(cell(report.prUrl));
  if (report.partial) parts.push("**partial**");
  parts.push(`[report](${path})`);
  return parts.join(" — ");
}

/**
 * Reserve a free report path, disambiguating a collision with a `-2`, `-3`, …
 * suffix. Two retros the watcher drained in the same minute — the found-nothing
 * path is the likely pair, since both slug to the same note — would otherwise
 * write the same filename and the second would silently erase the first, with
 * the index left pointing two lines at one file.
 *
 * `wx` rather than an existence check: the reservation has to be atomic, since
 * the colliding writers are concurrent by construction. After ~50 collisions in
 * one minute we stop suffixing and let the last writer win — a pathological
 * case where the loop matters less than terminating.
 */
function reserveReportPath(base: string): string {
  const stem = base.replace(/\.md$/, "");
  for (let n = 1; n <= 50; n += 1) {
    const candidate = n === 1 ? base : `${stem}-${n}.md`;
    try {
      closeSync(openSync(candidate, "wx"));
      return candidate;
    } catch {
      // taken — try the next suffix
    }
  }
  return base;
}

export interface WriteLearnReportOpts {
  /** Learn home (`learnHome(env)`); the reports dir hangs off it. */
  home: string;
  /** Filename slug source. Defaults to the note, else `session-retro`. */
  slug?: string;
}

/**
 * Write the report and append its index line. Atomic for the report (tmp +
 * rename, the repo-wide pattern) and an append for the index, so two retros
 * finishing at once cannot truncate each other's history.
 */
export function writeLearnReport(report: LearnReport, opts: WriteLearnReportOpts): LearnReportPaths {
  const stamp = reportStamp(report.finishedAt);
  const slug = opts.slug ?? report.note ?? "session-retro";
  const indexPath = reportsIndexPath(opts.home);

  mkdirSync(reportsDir(opts.home), { recursive: true });
  const path = reserveReportPath(learnReportPath(opts.home, stamp, slug));

  writeAtomic(path, renderLearnReport(report));
  appendFileSync(indexPath, `${renderIndexLine(report, path)}\n`, "utf8");

  return { path, indexPath };
}
