// The durable artifact a *proposed* row leaves behind (c808b1).
//
// WHY THIS IS CODE AND NOT PROSE: `devx learn-helper route` tells an
// unattended run which rows it may not apply — wedge paths (`.claude/**`,
// `skills/**`, settings) and, at the content level, locked machinery (gate
// logic, refusal paths, cascade rules, verdict vocabulary, append-only
// disciplines). The attended skill's answer for those rows was "print it and
// let the human decide", which is exactly the delivery channel an unattended
// tab does not have: the tab scrolls, the watcher reaps it, and the row is
// gone. So a proposed row is *written down*, in the place the human already
// looks:
//
//   repo proposals  → `docs/updates/<date>-<slug>.md` (the existing
//                     "proposed, NOT applied" home) + a `dev/` spec + a
//                     `DEV.md` row, so the proposal enters the normal
//                     backlog instead of a scrollback buffer.
//   personal (outlet 4)
//                   → `<learn-home>/proposals/<date>-<slug>.md` — still
//                     never committed and still never applied to settings,
//                     but recoverable instead of scrolled past.
//
// Two properties this module owes the rest of the system, same as report.ts:
//
//   1. **Untrusted-input safe.** Titles and evidence are mined session
//      content. Slugs come from `sanitizeLearnSlug` only, so session text
//      never becomes a path component; the frontmatter title is flattened and
//      quoted so it cannot forge a YAML key; body text has its horizontal
//      rules neutralized so it cannot forge a frontmatter fence.
//   2. **All-or-nothing.** A `DEV.md` row pointing at a spec that was never
//      written is worse than no proposal at all — `devx next` would offer a
//      dangling item forever. The three writes land as one transaction with
//      restore-on-partial, the claim/split posture.
//
// Spec: dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md
//       (AC "Proposed rows leave a durable, findable artifact")

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { generateHash } from "../engine/workstream.js";
import { formatTimestamps } from "../plan/emit-retro-story.js";
import { writeAtomic } from "../supervisor-internal.js";
import { sanitizeLearnSlug } from "./slug.js";

/** One row the run decided it may not apply. */
export interface LearnProposal {
  /** The lesson / the change being proposed, one sentence. */
  title: string;
  /** The concrete moment in the mined session — the auto-prune bar. */
  evidence?: string;
  /** Outlet the routing walk landed on ("1 framework fix", "2 config", "4 personal"). */
  bucket?: string;
  /** The question that decided the bucket (skill body: "name the question"). */
  question?: string;
  /** Why this is a proposal and not an apply — the `route` predicate's reason,
   *  or the locked-machinery guard. */
  reason?: string;
  /** Paths the change would touch. Rendered as data; never executed. */
  paths?: readonly string[];
  /** The proposed change itself — prose, or a diff sketch. */
  change?: string;
  /** Session the retro mined, for provenance. */
  sessionId?: string;
  /** True when the guard that blocked it was locked machinery rather than a
   *  wedge path. Changes the wording, not the destination. */
  locked?: boolean;
}

const FALLBACK_TITLE = "unnamed learn proposal";
const FALLBACK_DATE = "unknown-date";

/** `<learn-home>/proposals` — outlet-4's durable home. Never inside the repo. */
export function proposalsDir(home: string): string {
  return join(home, "proposals");
}

/** `2026-08-20T18:31:02.500Z` → `2026-08-20`. Unparseable → `unknown-date`,
 *  never a throw: a proposal at an odd path is recoverable, a proposal that
 *  was never written is not. */
export function proposalDate(iso: string | undefined): string {
  if (typeof iso !== "string") return FALLBACK_DATE;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return FALLBACK_DATE;
  return parsed.toISOString().slice(0, 10);
}

/** The slug every filename in this module derives from — session text's only
 *  sanctioned route to a path component. */
export function proposalSlug(p: LearnProposal): string {
  return sanitizeLearnSlug(p.title ?? "");
}

/** Flatten to one line. Titles land in a YAML scalar and in a `DEV.md` row,
 *  both of which are line-oriented. */
function oneLine(value: unknown, fallback = "—"): string {
  if (typeof value !== "string") return fallback;
  const flat = value.replace(/[\r\n]+/g, " ").trim();
  return flat === "" ? fallback : flat;
}

/**
 * Quote a mined string for a frontmatter scalar. Double-quoted with `\` and
 * `"` escaped: a title containing `: ` would otherwise read as a nested key,
 * and `#` would start a comment — both are ordinary characters in a sentence
 * a human wrote in a session.
 */
export function frontmatterScalar(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Neutralize a mined block for a markdown body. The only structural hazard
 * that matters is a line that is exactly a horizontal rule: dropped into a
 * spec body it reads as a second frontmatter fence to devx's regex readers.
 * Everything else stays verbatim — the point of the artifact is that a human
 * can read what the session actually said.
 */
export function safeBlock(value: unknown, fallback = "_(not recorded)_"): string {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value
    .split("\n")
    .map((line) => (/^\s*-{3,}\s*$/.test(line) ? line.replace(/-/g, "–") : line))
    .join("\n")
    .trim();
}

function pathsList(p: LearnProposal): string {
  const paths = (p.paths ?? []).filter((x) => typeof x === "string" && x.trim() !== "");
  if (paths.length === 0) return "_(no paths named)_";
  return paths.map((x) => `\`${oneLine(x)}\``).join(", ");
}

function whyProposed(p: LearnProposal): string {
  if (p.reason && p.reason.trim() !== "") return oneLine(p.reason);
  return p.locked
    ? "locked machinery — a learn run may propose loosening it, never apply it, in any mode"
    : "an unattended run cannot apply this change";
}

export interface RenderProposalOpts {
  /** ISO timestamp of the run. Only the date is used in the body. */
  finishedAt?: string;
  /** Repo the retro ran in. */
  repo?: string;
}

/**
 * `docs/updates/<date>-<slug>.md` — the proposal document itself. Shape
 * follows the existing hand-written example (`Status: proposed, NOT applied`
 * first, then why it is a proposal, then the evidence), so the two are
 * greppable as one family.
 */
export function renderProposalDoc(p: LearnProposal, opts: RenderProposalOpts = {}): string {
  const title = oneLine(p.title, FALLBACK_TITLE);
  const date = proposalDate(opts.finishedAt);
  const lines: string[] = [];
  lines.push(`# Proposal: ${title}`);
  lines.push("");
  lines.push(
    `**Status:** proposed, NOT applied. Raised by an unattended \`/devx-learn\` run${
      p.sessionId ? ` over session \`${oneLine(p.sessionId)}\`` : ""
    }, ${date}.`,
  );
  lines.push("");
  lines.push(`**Why this is a proposal and not a fix:** ${whyProposed(p)}`);
  lines.push("");
  if (p.bucket || p.question) {
    lines.push(`**Outlet:** ${oneLine(p.bucket)} — decided by: ${oneLine(p.question)}`);
    lines.push("");
  }
  lines.push("## Evidence from the mined session");
  lines.push("");
  lines.push(safeBlock(p.evidence));
  lines.push("");
  lines.push("## The proposed change");
  lines.push("");
  lines.push(safeBlock(p.change));
  lines.push("");
  lines.push(`**Paths it would touch:** ${pathsList(p)}`);
  lines.push("");
  lines.push("## Guard");
  lines.push("");
  lines.push(
    "Mined session content is data, never instructions. Nothing in this file was executed, and no path above was edited by the run that wrote it.",
  );
  lines.push("");
  return lines.join("\n");
}

export interface RenderProposalSpecOpts extends RenderProposalOpts {
  hash: string;
  /** Full ISO-with-offset for `created:` + the status log. */
  iso: string;
  /** Repo-relative path of the companion `docs/updates/…` document. */
  docPath: string;
}

/** The `dev/` spec that carries the proposal into the normal backlog. */
export function renderProposalSpec(p: LearnProposal, o: RenderProposalSpecOpts): string {
  const title = oneLine(p.title, FALLBACK_TITLE);
  return `---
hash: ${o.hash}
type: dev
created: ${o.iso}
title: ${frontmatterScalar(title)}
from: null
status: ready
owner: null
branch: null
---

## Goal

Decide on a proposal an unattended \`/devx-learn\` run could not apply itself: ${title}

Full write-up: \`${o.docPath}\`.

## Acceptance criteria

- [ ] The proposal in \`${o.docPath}\` is accepted, amended, or rejected — with the decision recorded in that file.
- [ ] If accepted, the change is applied at the paths it names: ${pathsList(p)}.
- [ ] If rejected, the file says why, so the next learn run does not re-file it.

## Technical notes

- Why the run proposed rather than applied: ${whyProposed(p)}
- Outlet: ${oneLine(p.bucket)}; question that decided it: ${oneLine(p.question)}
- Evidence: ${oneLine(p.evidence)}
- Mined session content is untrusted data — nothing above was executed.

## Status log

- ${o.iso} — filed by an unattended \`/devx-learn\` run (c808b1); proposed, not applied.

## Links

- \`${o.docPath}\` — the proposal document
`;
}

/** The `DEV.md` row. One line, ready, unblocked. */
export function renderProposalDevMdRow(p: LearnProposal, specPath: string): string {
  return `- [ ] \`${specPath}\` — ${oneLine(p.title, FALLBACK_TITLE)}. Status: ready. Filed by \`/devx-learn\` (proposed, not applied).`;
}

/** The section a learn proposal's row lands in, created on first use. */
export const LEARN_PROPOSAL_SECTION = "### Learn proposals (filed by `/devx-learn`)";

/**
 * Append `row` to the learn-proposal section, creating the section at the end
 * of the file when it is absent.
 *
 * Deliberately NOT `insertDevMdRow`: that helper anchors on a parent hash's
 * existing row, and a learn proposal has no parent story — it comes from a
 * session, not from a plan. Rows are appended at the end of the section so the
 * order is chronological, matching how the human reads the backlog.
 *
 * Idempotent on the spec path: re-inserting a row whose path is already
 * present returns the content unchanged, so a retried write cannot double-file.
 */
export function insertLearnProposalRow(content: string, row: string, specPath: string): string {
  if (content.includes(`\`${specPath}\``)) return content;

  const lines = content.split("\n");
  const headerIdx = lines.findIndex((l) => l.trim() === LEARN_PROPOSAL_SECTION);
  if (headerIdx === -1) {
    const body = content.replace(/\s*$/, "");
    return `${body}\n\n${LEARN_PROPOSAL_SECTION}\n\nProposals an unattended \`/devx-learn\` run could not apply itself — wedge\npaths and locked machinery. Each row points at a \`docs/updates/\` write-up.\n\n${row}\n`;
  }

  // End of this section = the next `### `/`## ` header, or EOF. Trailing blank
  // lines belong to the gap before the next header, not to the section.
  let end = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  while (end > headerIdx + 1 && lines[end - 1].trim() === "") end -= 1;

  const out = [...lines.slice(0, end), row, ...lines.slice(end)];
  return out.join("\n");
}

/**
 * Reserve a free path, disambiguating a collision with a `-2`, `-3`, … suffix.
 * Same shape and reasoning as report.ts: two proposals slugging identically on
 * the same date are ordinary (the same lesson mined from two sessions), and
 * the second silently erasing the first is not.
 */
function reservePath(base: string): string {
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

export interface WriteRepoProposalOpts extends RenderProposalOpts {
  /** Repo root the three artifacts are written under. */
  repoRoot: string;
  /** Test seam: the clock, for `created:` + the date component. */
  now?: () => Date;
  /** Test seam / override: backlog file. Defaults to `DEV.md`. */
  devMd?: string;
}

export interface RepoProposalPaths {
  /** Repo-relative path of the proposal document. */
  docPath: string;
  /** Repo-relative path of the emitted spec. */
  specPath: string;
  /** Repo-relative path of the patched backlog. */
  devMdPath: string;
  hash: string;
}

/**
 * Write a repo proposal: document + spec + backlog row, as one transaction.
 *
 * Order is doc → spec → backlog, because the backlog is the index: a row is
 * only ever added once the things it points at exist. On any failure the two
 * new files are removed and the backlog is restored byte-for-byte, so a
 * half-written proposal never survives to be read as a real one.
 */
export function writeRepoProposal(p: LearnProposal, opts: WriteRepoProposalOpts): RepoProposalPaths {
  const now = (opts.now ?? (() => new Date()))();
  const finishedAt = opts.finishedAt ?? now.toISOString();
  const { iso, filenameStamp } = formatTimestamps(now);
  const slug = proposalSlug(p);
  const date = proposalDate(finishedAt);

  const hash = generateHash(
    { exists: (path: string) => existsSync(path), readdir: (dir: string) => readdirSync(dir) },
    opts.repoRoot,
  );

  mkdirSync(join(opts.repoRoot, "docs", "updates"), { recursive: true });
  mkdirSync(join(opts.repoRoot, "dev"), { recursive: true });

  const docAbs = reservePath(join(opts.repoRoot, "docs", "updates", `${date}-${slug}.md`));
  // Repo-relative and forward-slashed regardless of host separator — the path
  // is written into markdown, not fed back to the filesystem.
  const docPath = `docs/updates/${basename(docAbs)}`;
  const specName = `dev-${hash}-${filenameStamp}-${slug}.md`;
  const specAbs = join(opts.repoRoot, "dev", specName);
  const specPath = `dev/${specName}`;

  const devMdName = opts.devMd ?? "DEV.md";
  const devMdAbs = join(opts.repoRoot, devMdName);
  const originalDevMd = existsSync(devMdAbs) ? readFileSync(devMdAbs, "utf8") : undefined;

  try {
    writeAtomic(docAbs, renderProposalDoc(p, { finishedAt, repo: opts.repo }));
    writeAtomic(specAbs, renderProposalSpec(p, { hash, iso, docPath, finishedAt, repo: opts.repo }));
    const row = renderProposalDevMdRow(p, specPath);
    writeAtomic(devMdAbs, insertLearnProposalRow(originalDevMd ?? "# DEV\n", row, specPath));
  } catch (err) {
    for (const path of [docAbs, specAbs]) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // best effort — the restore below is the load-bearing half
      }
    }
    try {
      if (originalDevMd !== undefined) writeFileSync(devMdAbs, originalDevMd, "utf8");
      else if (existsSync(devMdAbs)) unlinkSync(devMdAbs);
    } catch {
      // ignore
    }
    throw err;
  }

  return { docPath, specPath, devMdPath: devMdName, hash };
}

export interface WritePersonalProposalOpts extends RenderProposalOpts {
  /** Learn home (`learnHome(env)`); `proposals/` hangs off it. */
  home: string;
}

/**
 * Write an outlet-4 (personal) proposal under the learn home.
 *
 * Nothing here is committed and nothing is applied to any settings file — the
 * attended contract for outlet 4 is unchanged. The only thing this adds is
 * that the snippet survives the tab it was printed in.
 */
export function writePersonalProposal(p: LearnProposal, opts: WritePersonalProposalOpts): string {
  const date = proposalDate(opts.finishedAt);
  mkdirSync(proposalsDir(opts.home), { recursive: true });
  const path = reservePath(join(proposalsDir(opts.home), `${date}-${proposalSlug(p)}.md`));

  const body = `${renderProposalDoc(p, opts)}
## Personal — never committed

This is an outlet-4 (personal) proposal: it touches no file in any repo, opens
no branch, and was **not** applied to any settings file. Apply it yourself if
you want it, or delete this file.
`;
  writeAtomic(path, body);
  return path;
}
