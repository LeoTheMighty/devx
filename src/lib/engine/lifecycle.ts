// Workstream lifecycle — `devx workstream split` and `devx workstream combine`
// (D-18). PURE: every input is a fact the command layer gathered, every
// output is a refusal list or the exact text to write. Nothing here reads a
// file, mints a hash, reads a clock, or runs a subprocess; `src/commands/
// workstream.ts` owns all of that, and executes only a plan with no refusals.
//
// The rule both operations follow (D-18): a gate verdict is a claim about ONE
// artifact body. Splitting or combining changes the expectation set, and
// §4.9's cascade says an expectations change resets all four gates — so no
// verdict, flag, or RED lock ever crosses either operation. The retiring side
// keeps its own verdicts as history; the new scope re-earns every gate.
//
// What the CLI cannot decide is refused, not guessed:
//   - which child an expectation belongs to (the partition is INPUT; with
//     none, the refusal hands back a template to fill);
//   - which child a live phase, a dependent, or a parked question belongs to;
//   - whether a RED lock still means anything once its eval set has moved.
//
// Spec: v2/07-decisions.md D-18

import {
  type EngineState,
  type EnginePatch,
  type GateFlag,
  type GateKey,
} from "./frontmatter.js";
import {
  type EBlock,
  E_HEADING_RE,
  parseCoversIds,
  parseExpectations,
} from "./expectations.js";
import { type EmittedSpec, cascadeFor, computeRevise } from "./revise.js";
import { QuestionsError, isOpen, parseQuestions } from "./questions.js";
import { extractDefinedIds } from "./gate-prd.js";
import { parsePlanCoverageTable } from "./gate-evals.js";
import { EVALS_DIR_REL, type DocsLayout } from "./artifacts.js";
import { SLUG_RE, titleFromSlug } from "./workstream.js";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Statuses that need no more attention. The SAME three `next/gather.ts`
 *  treats as a settled blocker and `graph/model.ts` collapses on
 *  (`SETTLED_STATUSES`); `test/workstream-lifecycle.test.ts` pins that the
 *  copies agree. Spelled here because engine/ imports neither layer. */
export const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "deleted",
  "superseded",
]);

const isSettled = (status: string | null): boolean =>
  SETTLED_STATUSES.has((status ?? "").trim().toLowerCase());

export type LifecycleRefusalCode =
  | "layout-project-level"
  | "frontmatter-unreadable"
  | "workstream-closed"
  | "red-closed"
  | "outcome-in-flight"
  | "emitted-specs-live"
  | "dependents-unsettled"
  | "dependents-unverifiable"
  | "questions-parked"
  | "questions-unreadable"
  | "expectations-missing"
  | "expectations-empty"
  | "expectations-duplicate-id"
  | "expectations-heading-drift"
  | "partition-required"
  | "partition-invalid"
  | "partition-unknown-expectation"
  | "partition-unassigned"
  | "partition-unknown-child"
  | "partition-empty-child"
  | "split-needs-two"
  | "child-slug-taken"
  | "record-exists"
  | "eval-path-collision"
  | "same-workstream"
  | "carry-unverifiable";

export interface LifecycleRefusal {
  code: LifecycleRefusalCode;
  message: string;
  /** Repo-relative paths / hashes the refusal is about, when it is about some. */
  paths?: string[];
}

/** One workstream, as the command layer read it. Every field is a fact on
 *  disk at plan time; the planner trusts nothing it was not handed. */
export interface WorkstreamFacts {
  hash: string;
  slug: string;
  /** Repo-relative plan spec path. */
  specRel: string;
  /** Repo-relative workstream dir. */
  workstreamRel: string;
  layout: DocsLayout;
  state: EngineState;
  /** D-13: first YAML error in the spec's frontmatter, or null. */
  frontmatterError: string | null;
  /** `blocked_by` under both spellings (`readBlockedByAllSpellings`). */
  blockedBy: string[];
  /** File contents; null = the file does not exist. */
  expectations: string | null;
  prd: string | null;
  plan: string | null;
  questions: string | null;
  /** Dev specs whose `plan:` names this workstream (`emittedSpecsFor`). */
  emitted: EmittedSpec[];
  /** Specs whose `blocked_by` names this plan spec (from the story graph). */
  dependents: Array<{ hash: string; status: string | null }>;
  /** Non-null when the dependents could not be computed (e.g. a cycle). */
  dependentsError: string | null;
}

// ---------------------------------------------------------------------------
// Verbatim E-block slicing
// ---------------------------------------------------------------------------

export interface SlicedBlock {
  id: string;
  name: string;
  /** 1-based heading line. */
  line: number;
  /** The block's exact source text, heading through the line before the
   *  next `## ` heading, trailing blank lines trimmed. */
  text: string;
}

export interface ExpectationSlice {
  /** Everything before the first `## ` heading, trailing blanks trimmed. */
  preamble: string;
  blocks: SlicedBlock[];
  /** Non-E `## ` headings with any non-blank body — prose no block owns. */
  otherSections: string[];
  /** E-ids whose heading appears more than once. */
  duplicateIds: string[];
  /** 1-based lines that LOOK like an E heading but the parser will not read
   *  as one (`## E-4 name`, `##E-4:`, `## e-4:`). Their blocks are invisible
   *  to every gate, so carrying "every block" would silently drop them. */
  headingDrift: number[];
}

const E_LIKE_RE = /^##\s*E-\d+/i;

/** Slice expectations.md into verbatim blocks, agreeing with
 *  `parseExpectations` about where every block starts and ends: a block
 *  opens at `E_HEADING_RE` and closes at the next line the parser treats as
 *  a heading (`E_HEADING_RE`, or any line starting `## `). */
export function sliceExpectations(content: string): ExpectationSlice {
  const lines = content.split("\n");
  const isBoundary = (l: string): boolean => E_HEADING_RE.test(l) || l.startsWith("## ");
  const trimTail = (ls: string[]): string => {
    const out = [...ls];
    while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
    return out.join("\n");
  };

  const firstBoundary = lines.findIndex(isBoundary);
  const preamble = trimTail(firstBoundary === -1 ? lines : lines.slice(0, firstBoundary));

  const blocks: SlicedBlock[] = [];
  const otherSections: string[] = [];
  const headingDrift: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = E_HEADING_RE.exec(lines[i]);
    if (!h && E_LIKE_RE.test(lines[i])) headingDrift.push(i + 1);
    if (!isBoundary(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !isBoundary(lines[end])) end++;
    if (h) {
      blocks.push({ id: h[1], name: h[2].trim(), line: i + 1, text: trimTail(lines.slice(i, end)) });
    } else if (lines.slice(i + 1, end).some((l) => l.trim() !== "")) {
      otherSections.push(lines[i].replace(/^##\s+/, "").trim());
    }
  }
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const b of blocks) {
    if (seen.has(b.id)) dup.add(b.id);
    seen.add(b.id);
  }
  return { preamble, blocks, otherSections, duplicateIds: [...dup], headingDrift };
}

/** Field-for-field projection of a parsed block, minus its position. */
const fieldsOf = (b: EBlock): string =>
  JSON.stringify([b.name, b.priority, b.covers, b.trigger, b.expectation, b.threshold, b.verifiedBy, b.measure]);

// ---------------------------------------------------------------------------
// State refusals — shared by both operations
// ---------------------------------------------------------------------------

/** True when ANY part of a RED lock is present — the flag, the marker, or a
 *  stamp. A stamp left behind a cleared flag is still evidence of a lock. */
export function redStageClosed(state: EngineState): boolean {
  return (
    state.gateStatus.evals_red ||
    state.evalsLocked ||
    Object.keys(state.redEvalShas).length > 0 ||
    Object.keys(state.redEvalIds).length > 0
  );
}

function stateRefusals(
  f: WorkstreamFacts,
  role: "split parent" | "survivor" | "absorbed",
): LifecycleRefusal[] {
  const out: LifecycleRefusal[] = [];
  const who = `${role} '${f.slug}' (${f.hash})`;
  if (f.frontmatterError !== null) {
    out.push({
      code: "frontmatter-unreadable",
      message:
        `${who}: frontmatter does not parse (${f.frontmatterError}). Its gate state is unreadable, so ` +
        "there is no telling what this would carry or reset (D-13). Fix the YAML first.",
      paths: [f.specRel],
    });
  }
  const stage = f.state.stage;
  if (stage === "done" || stage === "retired") {
    out.push({
      code: "workstream-closed",
      message: `${who} is at stage '${stage}'. A closed workstream is history; it is not divided or absorbed.`,
      paths: [f.specRel],
    });
  }
  if (redStageClosed(f.state)) {
    out.push({
      code: "red-closed",
      message:
        `${who} has a closed RED stage. Its lock proves THESE P0s failed before THIS work was built: ` +
        "divided, it would vouch for evals a workstream does not own; re-earned, a built P0 can never be " +
        `observed RED. Only \`devx revise ${f.hash} --touched plan\` clears a RED lock; run it first.`,
      paths: [f.specRel],
    });
  }
  if (f.state.outcome.status !== null) {
    out.push({
      code: "outcome-in-flight",
      message: `${who} has an outcome in flight (status: ${f.state.outcome.status}). Score or clear it first; it would have no workstream to land on.`,
      paths: [f.specRel],
    });
  }
  const live = f.emitted.filter((s) => !isSettled(s.status));
  if (live.length > 0) {
    out.push({
      code: "emitted-specs-live",
      message:
        `${who} has ${live.length} emitted dev spec(s) not yet done or deleted. A live phase has one home ` +
        "(D-12) and an in-progress one has a claim, a worktree and a PR citing this plan; which workstream " +
        "should own it is not the CLI's call. Ship each, or mark it deleted, first. Shipped specs are fine: " +
        "they stay where they are and are never re-pointed.",
      paths: live.map((s) => `${s.spec} (status: ${s.status ?? "none"})`),
    });
  }
  return out;
}

/** Refusals only a RETIRING workstream earns (split parent, absorbed side). */
function retiringRefusals(f: WorkstreamFacts): LifecycleRefusal[] {
  const out: LifecycleRefusal[] = [];
  if (f.dependentsError !== null) {
    out.push({
      code: "dependents-unverifiable",
      message: `cannot tell which specs are blocked by '${f.slug}' (${f.dependentsError}). Retiring it settles every such blocker, so this fails closed.`,
      paths: [f.specRel],
    });
  } else {
    const unsettled = f.dependents.filter((d) => !isSettled(d.status));
    if (unsettled.length > 0) {
      out.push({
        code: "dependents-unsettled",
        message:
          `${unsettled.length} spec(s) are blocked by '${f.slug}' (${f.hash}). Retiring it marks it superseded, ` +
          "which every dispatcher reads as a settled blocker — they would become runnable for work that has " +
          "not shipped. Re-point each one's blocked_by at the workstream it really waits on, then re-run.",
        paths: unsettled.map((d) => `${d.hash} (status: ${d.status ?? "none"})`),
      });
    }
  }
  if (f.questions !== null) {
    try {
      const doc = parseQuestions(f.questions);
      if (doc.headingDrift.length > 0) {
        out.push({
          code: "questions-unreadable",
          message: `${f.workstreamRel}/questions.md has headings the parser cannot read (lines ${doc.headingDrift.join(", ")}); an entry under one is invisible. Fix them first.`,
          paths: [`${f.workstreamRel}/questions.md`],
        });
      } else {
        const parked = doc.entries.filter((q) => isOpen(q) && q.kind !== "gate-concern");
        if (parked.length > 0) {
          out.push({
            code: "questions-parked",
            message:
              `${f.workstreamRel}/questions.md has ${parked.length} unresolved human entr${parked.length === 1 ? "y" : "ies"}. ` +
              "A retired workstream leaves the health queue, so they would go dark, and which workstream owns " +
              "each is judgment. Resolve them (`/devx-walk`), or close them with a Resolution naming where they went.",
            paths: parked.map((q) => `${q.id}: ${q.title}`),
          });
        }
      }
    } catch (e) {
      if (!(e instanceof QuestionsError)) throw e;
      out.push({
        code: "questions-unreadable",
        message: `${f.workstreamRel}/questions.md does not parse (${e.message}); open entries cannot be told apart from resolved ones.`,
        paths: [`${f.workstreamRel}/questions.md`],
      });
    }
  }
  return out;
}

function expectationRefusals(f: WorkstreamFacts, slice: ExpectationSlice | null): LifecycleRefusal[] {
  const rel = `${f.workstreamRel}/expectations.md`;
  if (slice === null) {
    return [{ code: "expectations-missing", message: `${rel} does not exist; there is nothing to carry.`, paths: [rel] }];
  }
  const out: LifecycleRefusal[] = [];
  if (slice.blocks.length === 0) {
    out.push({ code: "expectations-empty", message: `${rel} has no E-blocks; there is nothing to carry.`, paths: [rel] });
  }
  if (slice.duplicateIds.length > 0) {
    out.push({
      code: "expectations-duplicate-id",
      message: `${rel} defines ${slice.duplicateIds.join(", ")} more than once; an assignment by E-id would be ambiguous. Renumber one first.`,
      paths: [rel],
    });
  }
  if (slice.headingDrift.length > 0) {
    out.push({
      code: "expectations-heading-drift",
      message:
        `${rel} has E headings the parser does not read (lines ${slice.headingDrift.join(", ")}). Those blocks are ` +
        "invisible to every gate and would be silently dropped. Fix them to `## E-<n>: <name>` first.",
      paths: [rel],
    });
  }
  return out;
}

function layoutRefusal(f: WorkstreamFacts, op: string): LifecycleRefusal | null {
  if (f.layout !== "project-level") return null;
  return {
    code: "layout-project-level",
    message: `\`engine.docs_layout: project-level\` holds exactly one doc set, so a ${op} has nowhere to put the result. Switch to \`engine.docs_layout: workstream\` (\`devx layout migrate\`) first.`,
  };
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

export interface PartitionTemplate {
  expectations: Record<string, string[]>;
  catalog: Array<{ id: string; name: string; priority: string | null; covers: string[]; verified_by: string | null }>;
}

export interface SplitInput {
  parent: WorkstreamFacts;
  /** Child slugs, as given — validated by the caller (`SLUG_RE`, distinct). */
  into: string[];
  /** Child hashes, minted by the caller, aligned with `into`. */
  childHashes: string[];
  /** Parsed `--partition` JSON, or null when none was given. */
  partition: unknown;
  /** Non-null reason when a child slug is unavailable. */
  childTaken: (slug: string) => string | null;
  /** True when a repo-relative path already exists. */
  exists: (rel: string) => boolean;
  /** The shipped expectations.md template (preamble source for children). */
  expectationsTemplate: string;
  expectationsMin: number;
  workstreamsRoot: string;
  archiveRoot: string;
  /** `YYYY-MM-DD` and minute-ISO stamps, from the caller's clock. */
  today: string;
  stamp: string;
}

export interface SplitChildPlan {
  slug: string;
  hash: string;
  workstreamRel: string;
  expectationIds: string[];
  /** E-ids also assigned to another child. */
  sharedIds: string[];
  /** PRD IDs the carried Covers name — the child's PRD must define them. */
  coversToDefine: string[];
  /** Carried eval targets that will not simply resolve here. */
  evalTargets: EvalTarget[];
  /** Carried E-ids whose parent phase already shipped. */
  shippedInParent: Array<{ id: string; phase: number; specs: string[] }>;
  /** Full content of the child's expectations.md. */
  expectations: string;
  recordRel: string;
  record: string;
  patch: EnginePatch;
  logLine: string;
}

export interface SplitPlan {
  refusals: LifecycleRefusal[];
  /** Set when no partition was given: what someone must fill in. */
  template: PartitionTemplate | null;
  warnings: string[];
  children: SplitChildPlan[];
  parent: { recordRel: string; record: string; patch: EnginePatch; logLine: string } | null;
}

function templateFor(blocks: EBlock[]): PartitionTemplate {
  return {
    expectations: Object.fromEntries(blocks.map((b) => [b.id, [] as string[]])),
    catalog: blocks.map((b) => ({
      id: b.id,
      name: b.name,
      priority: b.priority,
      covers: parseCoversIds(b.covers ?? ""),
      verified_by: b.verifiedBy,
    })),
  };
}

/** Child expectations.md: the shipped template's preamble (its title and its
 *  Gate-1 guidance comment), a provenance comment, then the carried blocks
 *  verbatim. The comment is HTML and contains no `## ` line, so neither the
 *  parser nor the slicer can mistake it for a block. */
function childExpectations(
  template: string,
  slug: string,
  provenance: string,
  blocks: SlicedBlock[],
): string {
  const preamble = sliceExpectations(template.replace(/<workstream title>/g, titleFromSlug(slug))).preamble;
  return `${preamble}\n\n<!-- ${provenance} -->\n\n${blocks.map((b) => b.text).join("\n\n")}\n`;
}

function relOf(f: WorkstreamFacts, file: string): string {
  return `${f.workstreamRel}/${file}`;
}

/** E-id → the phases/specs of the workstream that already shipped it. */
function shippedById(f: WorkstreamFacts): Map<string, { phase: number; specs: string[] }> {
  const out = new Map<string, { phase: number; specs: string[] }>();
  if (f.plan === null) return out;
  const done = new Map<number, string[]>();
  for (const s of f.emitted) {
    if (s.phase === null || (s.status ?? "").trim().toLowerCase() !== "done") continue;
    done.set(s.phase, [...(done.get(s.phase) ?? []), s.hash]);
  }
  for (const row of parsePlanCoverageTable(f.plan)) {
    if (row.phase === null) continue;
    const specs = done.get(row.phase);
    if (specs) out.set(row.eId.toUpperCase(), { phase: row.phase, specs });
  }
  return out;
}

const localEvalTarget = (verifiedBy: string | null): string | null => {
  const t = (verifiedBy ?? "").replace(/`/g, "").trim();
  return t.startsWith(`${EVALS_DIR_REL}/`) ? t : null;
};

/** A carried expectation's eval target, when it will not simply work where
 *  it lands. `local` (`evals/<f>`) resolves against whichever workstream
 *  reads it, so at the destination it names a file that does not exist yet:
 *  re-author it from `source`, the origin's copy. `foreign` is a repo path
 *  into some workstream's directory: it keeps resolving to THAT file, which
 *  the destination does not own — and archiving the owner breaks it. Found
 *  by running split against this repo, whose story-graph expectations all
 *  name `_devx/workstreams/story-graph/evals/…` rather than `evals/…`. */
export interface EvalTarget {
  id: string;
  target: string;
  kind: "local" | "foreign";
  source: string;
}

export function classifyEvalTarget(
  block: EBlock,
  origin: WorkstreamFacts,
  docRoots: readonly string[],
  destRel: string,
): EvalTarget | null {
  const local = localEvalTarget(block.verifiedBy);
  if (local !== null) return { id: block.id, target: local, kind: "local", source: relOf(origin, local) };
  const t = (block.verifiedBy ?? "").replace(/`/g, "").trim().replace(/^\.\//, "");
  const inDocRoot = docRoots.some((r) => t.startsWith(`${r}/`));
  if (!inDocRoot || t.startsWith(`${destRel}/`)) return null;
  return { id: block.id, target: t, kind: "foreign", source: t };
}

const renderEvalTarget = (t: EvalTarget): string =>
  t.kind === "local"
    ? `- ${t.id}: \`${t.target}\` is not copied. The origin's copy is \`${t.source}\`; re-author it here at RED.`
    : `- ${t.id}: \`${t.target}\` resolves into another workstream's directory, to a file this one does not own. ` +
      "Copy it into `evals/` and re-point Verified by before RED; archiving its owner would break it.";

const ID_ORDER = ["G", "UC", "CAP", "FR"];
/** PRD IDs in reading order: by prefix as the PRD lists them, then number. */
const sortIds = (ids: string[]): string[] =>
  [...ids].sort((a, b) => {
    const [pa, na] = a.split("-");
    const [pb, nb] = b.split("-");
    return ID_ORDER.indexOf(pa) - ID_ORDER.indexOf(pb) || Number(na) - Number(nb);
  });

export function planSplit(input: SplitInput): SplitPlan {
  const { parent: p } = input;
  const refusals: LifecycleRefusal[] = [];
  const warnings: string[] = [];
  const empty = (template: PartitionTemplate | null = null): SplitPlan => ({
    refusals,
    template,
    warnings,
    children: [],
    parent: null,
  });

  const layout = layoutRefusal(p, "split");
  if (layout) refusals.push(layout);
  refusals.push(...stateRefusals(p, "split parent"), ...retiringRefusals(p));

  const slice = p.expectations === null ? null : sliceExpectations(p.expectations);
  refusals.push(...expectationRefusals(p, slice));
  const parsed = p.expectations === null ? [] : parseExpectations(p.expectations);

  // ---- children -----------------------------------------------------------
  const into = input.into;
  if (into.length < 2) {
    refusals.push({
      code: "split-needs-two",
      message: `a split needs at least two children (got ${into.length}: ${into.join(", ") || "none"}); one child is a rename.`,
    });
  }
  const recordRelFor = (slug: string): string =>
    `${input.workstreamsRoot}/${slug}/decisions/${input.today}-split-from-${p.slug}.md`;
  for (const slug of into) {
    const taken = slug === p.slug ? "it is the parent's own slug" : input.childTaken(slug);
    if (taken !== null) {
      refusals.push({
        code: "child-slug-taken",
        message: `child slug '${slug}' is not available: ${taken}.`,
        paths: [`${input.workstreamsRoot}/${slug}`],
      });
    }
  }
  const parentRecordRel = relOf(p, `decisions/${input.today}-split.md`);
  if (input.exists(parentRecordRel)) {
    refusals.push({
      code: "record-exists",
      message: `${parentRecordRel} already exists; a decision record is never overwritten.`,
      paths: [parentRecordRel],
    });
  }

  // ---- partition ----------------------------------------------------------
  if (input.partition === null || input.partition === undefined) {
    refusals.push({
      code: "partition-required",
      message:
        "which child each expectation belongs to is judgment, and the CLI does not make it. Fill in the " +
        "`template` (every E-id → one or more child slugs from --into) and re-run with --partition <file>.",
    });
    return empty(slice !== null ? templateFor(parsed) : null);
  }
  const assignment = readPartition(input.partition);
  if (typeof assignment === "string") {
    refusals.push({ code: "partition-invalid", message: assignment });
    return empty();
  }
  if (slice === null || slice.blocks.length === 0) return empty();

  const known = new Set(slice.blocks.map((b) => b.id));
  const intoSet = new Set(into);
  const unknownIds = [...assignment.keys()].filter((id) => !known.has(id));
  if (unknownIds.length > 0) {
    refusals.push({
      code: "partition-unknown-expectation",
      message: `the partition names E-ids the parent does not define: ${unknownIds.join(", ")}.`,
      paths: unknownIds,
    });
  }
  const unassigned = slice.blocks.map((b) => b.id).filter((id) => (assignment.get(id) ?? []).length === 0);
  if (unassigned.length > 0) {
    refusals.push({
      code: "partition-unassigned",
      message:
        `the partition leaves ${unassigned.join(", ")} with no child. A split never drops an expectation; ` +
        `assign it, or delete it from the parent's expectations.md first and record that with \`devx revise ${p.hash} --touched expectations.md\`.`,
      paths: unassigned,
    });
  }
  const unknownChildren = [
    ...new Set([...assignment.values()].flat().filter((c) => !intoSet.has(c))),
  ];
  if (unknownChildren.length > 0) {
    refusals.push({
      code: "partition-unknown-child",
      message: `the partition assigns to children not named in --into: ${unknownChildren.join(", ")}.`,
      paths: unknownChildren,
    });
  }
  const byChild = new Map<string, SlicedBlock[]>(into.map((c) => [c, []]));
  for (const b of slice.blocks) {
    for (const c of new Set(assignment.get(b.id) ?? [])) byChild.get(c)?.push(b);
  }
  const emptyChildren = into.filter((c) => (byChild.get(c) ?? []).length === 0);
  if (emptyChildren.length > 0) {
    refusals.push({
      code: "partition-empty-child",
      message: `the partition gives ${emptyChildren.join(", ")} no expectations; a workstream with none has nothing to gate.`,
      paths: emptyChildren,
    });
  }
  if (refusals.length > 0) return empty();

  // ---- compose ------------------------------------------------------------
  const parsedById = new Map(parsed.map((b) => [b.id, b]));
  const prdDefs = new Map(
    (p.prd === null ? [] : extractDefinedIds(p.prd)).map((d) => [d.id, d.line]),
  );
  const prdLines = (p.prd ?? "").split("\n");
  const shipped = shippedById(p);
  const parentPrdRel = relOf(p, "prd/agent.md");

  const children: SplitChildPlan[] = [];
  for (const [i, slug] of into.entries()) {
    const blocks = byChild.get(slug) ?? [];
    const ids = blocks.map((b) => b.id);
    const hash = input.childHashes[i];
    const workstreamRel = `${input.workstreamsRoot}/${slug}`;
    const recordRel = recordRelFor(slug);
    const provenance =
      `Split from ${p.slug} (plan-${p.hash}) by \`devx workstream split\` on ${input.today} (D-18). ` +
      `These E-blocks are byte-identical to the parent's; no gate verdict came with them. ` +
      `Record: decisions/${input.today}-split-from-${p.slug}.md`;
    const expectations = childExpectations(input.expectationsTemplate, slug, provenance, blocks);

    // Self-check: the child must parse to exactly the blocks it was assigned,
    // field for field. A mismatch means the slice and the parser disagree,
    // and writing would hand a gate something other than what was assigned.
    const reparsed = parseExpectations(expectations);
    const ok =
      reparsed.length === blocks.length &&
      reparsed.every((b, k) => b.id === ids[k] && fieldsOf(b) === fieldsOf(parsedById.get(ids[k]) as EBlock));
    if (!ok) {
      refusals.push({
        code: "carry-unverifiable",
        message: `child '${slug}' expectations would not parse back to the ${ids.length} block(s) assigned to it; refusing to write a carry that cannot be verified.`,
        paths: [relOf(p, "expectations.md")],
      });
      continue;
    }

    const coversToDefine = sortIds([
      ...new Set(ids.flatMap((id) => parseCoversIds(parsedById.get(id)?.covers ?? ""))),
    ]);
    const sharedIds = ids.filter((id) => (assignment.get(id) ?? []).length > 1);
    const evalTargets = ids.flatMap((id) => {
      const t = classifyEvalTarget(parsedById.get(id) as EBlock, p, [input.workstreamsRoot, input.archiveRoot], workstreamRel);
      return t === null ? [] : [t];
    });
    const shippedInParent = ids.flatMap((id) => {
      const s = shipped.get(id);
      return s ? [{ id, phase: s.phase, specs: s.specs }] : [];
    });
    if (blocks.length < input.expectationsMin) {
      warnings.push(
        `child '${slug}' carries ${blocks.length} E-block(s); Gate 1 requires ${input.expectationsMin} (engine.expectations_min) and will FAIL until more are authored.`,
      );
    }
    const record = renderChildRecord({
      parent: p,
      slug,
      hash,
      today: input.today,
      blocks: ids.map((id) => parsedById.get(id) as EBlock),
      assignment,
      coversToDefine,
      prdDefs,
      prdLines,
      parentPrdRel,
      evalTargets,
      shippedInParent,
      expectationsMin: input.expectationsMin,
    });
    const patch: EnginePatch = { from: p.specRel };
    if (p.blockedBy.length > 0) patch.blocked_by = [...p.blockedBy];
    children.push({
      slug,
      hash,
      workstreamRel,
      expectationIds: ids,
      sharedIds,
      coversToDefine,
      evalTargets,
      shippedInParent,
      expectations,
      recordRel,
      record,
      patch,
      logLine:
        `- ${input.stamp} — split from \`${p.slug}\` (plan-${p.hash}) by \`devx workstream split\`: carries ${ids.join(", ")}; ` +
        `every gate open, nothing inherited (D-18). Record: \`${recordRel}\`.`,
    });
  }
  if (refusals.length > 0) return empty();

  const parentRecord = renderParentRecord({
    parent: p,
    today: input.today,
    children,
    otherSections: slice.otherSections,
  });
  return {
    refusals,
    template: null,
    warnings,
    children,
    parent: {
      recordRel: parentRecordRel,
      record: parentRecord,
      patch: { stage: "retired", status: "superseded", spawnedAppend: children.map((c) => c.hash) },
      logLine:
        `- ${input.stamp} — split by \`devx workstream split\` into ${children.map((c) => `\`${c.slug}\` (${c.hash})`).join(", ")}; ` +
        `retired here as history, verdicts unchanged and not inherited (D-18). Record: \`${parentRecordRel}\`.`,
    },
  };
}

/** `{ "expectations": { "E-1": ["a"], ... } }` → Map, or an error string. */
function readPartition(raw: unknown): Map<string, string[]> | string {
  const shape = 'expected { "expectations": { "E-<n>": ["<child-slug>", ...], ... } }';
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `partition is not an object; ${shape}`;
  const exp = (raw as Record<string, unknown>).expectations;
  if (!exp || typeof exp !== "object" || Array.isArray(exp)) return `partition has no "expectations" map; ${shape}`;
  const out = new Map<string, string[]>();
  for (const [id, v] of Object.entries(exp as Record<string, unknown>)) {
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
      return `partition entry '${id}' is not a list of child slugs; ${shape}`;
    }
    out.set(id.trim(), (v as string[]).map((s) => s.trim()));
  }
  return out;
}

function renderChildRecord(a: {
  parent: WorkstreamFacts;
  slug: string;
  hash: string;
  today: string;
  blocks: EBlock[];
  assignment: Map<string, string[]>;
  coversToDefine: string[];
  prdDefs: Map<string, number>;
  prdLines: string[];
  parentPrdRel: string;
  evalTargets: SplitChildPlan["evalTargets"];
  shippedInParent: SplitChildPlan["shippedInParent"];
  expectationsMin: number;
}): string {
  const p = a.parent;
  const L: string[] = [
    `# Split from ${p.slug} — ${a.today}`,
    "",
    "<!-- Written by `devx workstream split` (D-18). A record: never a gate input. -->",
    "",
    `This workstream (\`${a.slug}\`, plan-${a.hash}) was split out of \`${p.slug}\` (plan-${p.hash}, \`${p.specRel}\`). ` +
      "It starts at stage `prd` with every gate open. No flag, verdict or RED lock came across: each was a claim " +
      "about the parent's artifacts, and these are different ones.",
    "",
    "## Carried, byte-identical",
    "",
    "| E-id | Name | Priority | Also in |",
    "|---|---|---|---|",
    ...a.blocks.map((b) => {
      const others = (a.assignment.get(b.id) ?? []).filter((c) => c !== a.slug);
      return `| ${b.id} | ${b.name.replace(/\|/g, "\\|")} | ${b.priority ?? "—"} | ${others.join(", ") || "—"} |`;
    }),
    "",
    "## Before Gate 1",
    "",
    `- \`prd/agent.md\` is the template. Define the IDs the carried Covers name: ${a.coversToDefine.join(", ") || "none"}. ` +
      "Its goals must be exactly the G- IDs among them; any other goal fails `goal-uncovered`.",
    `  The parent's definitions are in \`${a.parentPrdRel}\`:`,
    ...a.coversToDefine.map((id) => {
      const line = a.prdDefs.get(id);
      return line === undefined
        ? `  - ${id}: not defined in the parent's PRD`
        : `  - ${id} (line ${line}): \`${(a.prdLines[line - 1] ?? "").trim().replace(/`/g, "'")}\``;
    }),
  ];
  if (a.blocks.length < a.expectationsMin) {
    L.push(`- Gate 1 needs ${a.expectationsMin} E-blocks (\`engine.expectations_min\`); this carries ${a.blocks.length}.`);
  }
  L.push("", "## Evals", "");
  if (a.evalTargets.length === 0) {
    L.push("- Every carried Verified by resolves here as written.");
  } else {
    L.push(...a.evalTargets.map(renderEvalTarget));
  }
  if (a.shippedInParent.length > 0) {
    L.push(
      "",
      "## Already shipped in the parent",
      "",
      "Gate 4 here will demand RED for these, and a built P0 cannot be observed failing. Expect to waive them, " +
        "naming the parent's RED report as the reason. The parent's dev specs are never re-pointed: Gate 4's " +
        "shipped-green deferral keys on phase number, so re-pointing would defer whichever phase here shares it.",
      "",
      ...a.shippedInParent.map((s) => `- ${s.id}: parent phase ${s.phase}, shipped by ${s.specs.join(", ")}`),
    );
  }
  L.push(
    "",
    "## Left with the parent",
    "",
    `\`${p.workstreamRel}/\` keeps its design, plan, evals, checkpoints, decisions, outlines, digests and questions.md. ` +
      "Read them there; this workstream re-authors what it needs.",
    "",
  );
  return L.join("\n");
}

function renderParentRecord(a: {
  parent: WorkstreamFacts;
  today: string;
  children: SplitChildPlan[];
  otherSections: string[];
}): string {
  const p = a.parent;
  const shippedSpecs = p.emitted.filter((s) => (s.status ?? "").trim().toLowerCase() === "done");
  const L: string[] = [
    `# Split — ${a.today}`,
    "",
    "<!-- Written by `devx workstream split` (D-18). A record: never a gate input. -->",
    "",
    `\`${p.slug}\` (plan-${p.hash}) was retired into ${a.children.length} workstreams. Its artifacts and gate verdicts ` +
      "stay here unchanged, as history. None of them transferred; every child re-earns every gate.",
    "",
    "| Child | Plan hash | E-ids |",
    "|---|---|---|",
    ...a.children.map((c) => `| \`${c.slug}\` | ${c.hash} | ${c.expectationIds.join(", ")} |`),
    "",
  ];
  const shared = [...new Set(a.children.flatMap((c) => c.sharedIds))];
  if (shared.length > 0) L.push(`Shared (copied into every child named): ${shared.join(", ")}.`, "");
  if (a.otherSections.length > 0) {
    L.push(`Not carried — prose in expectations.md outside any E-block: ${a.otherSections.map((s) => `\`## ${s}\``).join(", ")}.`, "");
  }
  if (shippedSpecs.length > 0) {
    L.push(
      `Shipped dev specs stay pointing here, and are never re-pointed: ${shippedSpecs.map((s) => `${s.hash}${s.phase === null ? "" : ` (phase ${s.phase})`}`).join(", ")}.`,
      "",
    );
  }
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// Combine
// ---------------------------------------------------------------------------

export interface CombineInput {
  survivor: WorkstreamFacts;
  absorbed: WorkstreamFacts;
  /** Every `.md` text in the survivor's doc set — the ID space a fresh ID
   *  must avoid. A mention anywhere counts, so nothing a record or a plan
   *  once called `E-7` is ever handed to an absorbed block. */
  survivorTexts: string[];
  /** True when `<survivor>/<rel>` exists (`evals/<f>` collision probe). */
  survivorHas: (wsRel: string) => boolean;
  workstreamsRoot: string;
  archiveRoot: string;
  exists: (rel: string) => boolean;
  today: string;
  stamp: string;
}

export interface CombinePlan {
  refusals: LifecycleRefusal[];
  warnings: string[];
  /** Absorbed E-id → survivor E-id. */
  eMap: Record<string, string>;
  /** Absorbed PRD ID → survivor PRD ID (only IDs a carried Covers names). */
  idMap: Record<string, string>;
  /** Absorbed PRD IDs no carried expectation covers — not carried. */
  notCarried: string[];
  /** [absorbed E-id, survivor E-id] pairs whose EARS text is identical. */
  likelyDuplicates: Array<[string, string]>;
  /** Survivor shipped phases — reported, see D-18's adjacent exposure. */
  survivorShipped: Array<{ hash: string; phase: number | null }>;
  /** Absorbed eval targets that will not simply resolve in the survivor. */
  evalTargets: EvalTarget[];
  survivor: {
    expectations: string;
    patch: EnginePatch;
    recordRel: string;
    record: string;
    logLine: string;
    resets: GateFlag[];
    stage: string;
  } | null;
  absorbed: { patch: EnginePatch; recordRel: string; record: string; logLine: string } | null;
}

const ID_RE = /\b(E|G|UC|CAP|FR)-(\d+)\b/gi;
const COVERS_LINE_RE = /^[-*]\s+\*\*Covers:\*\*/;

/** Highest number per ID prefix mentioned anywhere in `texts`. */
function maxIds(texts: string[]): Map<string, number> {
  const max = new Map<string, number>();
  for (const t of texts) {
    for (const m of t.matchAll(ID_RE)) {
      const k = m[1].toUpperCase();
      max.set(k, Math.max(max.get(k) ?? 0, Number(m[2])));
    }
  }
  return max;
}

/** Re-key one verbatim block: its heading's E-id and the PRD IDs on its
 *  first Covers field (the one the parser reads) and that field's indented
 *  continuation lines. Nothing else in the block is touched. */
function rekeyBlock(text: string, newId: string, idMap: Map<string, string>): string {
  const lines = text.split("\n");
  lines[0] = lines[0].replace(/^(##\s+)E-\d+(\s*:)/, `$1${newId}$2`);
  const start = lines.findIndex((l) => COVERS_LINE_RE.test(l));
  if (start === -1) return lines.join("\n");
  const rewrite = (l: string): string =>
    l.replace(ID_RE, (tok, prefix: string, n: string) => {
      const key = `${prefix.toUpperCase()}-${n}`;
      return prefix.toUpperCase() === "E" ? tok : (idMap.get(key) ?? tok);
    });
  const [label, ...rest] = lines[start].split("**Covers:**");
  lines[start] = `${label}**Covers:**${rewrite(rest.join("**Covers:**"))}`;
  for (let i = start + 1; i < lines.length && /^\s{2,}\S/.test(lines[i]); i++) {
    lines[i] = rewrite(lines[i]);
  }
  return lines.join("\n");
}

const normEars = (s: string | null): string => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function planCombine(input: CombineInput): CombinePlan {
  const { survivor: s, absorbed: a } = input;
  const refusals: LifecycleRefusal[] = [];
  const warnings: string[] = [];
  const base: CombinePlan = {
    refusals,
    warnings,
    eMap: {},
    idMap: {},
    notCarried: [],
    likelyDuplicates: [],
    survivorShipped: [],
    evalTargets: [],
    survivor: null,
    absorbed: null,
  };

  if (s.hash === a.hash || s.workstreamRel === a.workstreamRel) {
    refusals.push({
      code: "same-workstream",
      message:
        s.hash === a.hash
          ? `a workstream cannot absorb itself ('${s.slug}', ${s.hash}).`
          : `${s.hash} and ${a.hash} both claim '${s.workstreamRel}'; absorbing one into the other would append that directory's expectations to themselves. Fix the duplicate claim first.`,
      paths: [s.specRel, a.specRel],
    });
    return base;
  }
  const layout = layoutRefusal(s, "combine");
  if (layout) refusals.push(layout);
  refusals.push(...stateRefusals(s, "survivor"), ...stateRefusals(a, "absorbed"), ...retiringRefusals(a));

  const sSlice = s.expectations === null ? null : sliceExpectations(s.expectations);
  const aSlice = a.expectations === null ? null : sliceExpectations(a.expectations);
  // The survivor may hold no E-blocks yet (a fresh scaffold); it must hold a
  // readable file, without duplicate or drifted headings, to be appended to.
  refusals.push(
    ...expectationRefusals(s, sSlice).filter((r) => r.code !== "expectations-empty"),
    ...expectationRefusals(a, aSlice),
  );

  const sRecordRel = relOf(s, `decisions/${input.today}-combine-${a.slug}.md`);
  const aRecordRel = relOf(a, `decisions/${input.today}-combined-into-${s.slug}.md`);
  for (const rel of [sRecordRel, aRecordRel]) {
    if (input.exists(rel)) {
      refusals.push({ code: "record-exists", message: `${rel} already exists; a decision record is never overwritten.`, paths: [rel] });
    }
  }
  if (aSlice === null || sSlice === null || refusals.length > 0) return base;

  const aParsed = parseExpectations(a.expectations as string);
  const sParsed = parseExpectations(s.expectations as string);

  // ---- eval-path collisions -------------------------------------------------
  const collisions = aParsed.flatMap((b) => {
    const t = localEvalTarget(b.verifiedBy);
    return t !== null && input.survivorHas(t) ? [`${b.id}: ${t}`] : [];
  });
  if (collisions.length > 0) {
    refusals.push({
      code: "eval-path-collision",
      message:
        `absorbed expectations name workstream-local evals that already exist in '${s.slug}'. \`evals/\` resolves ` +
        "against the workstream it is read from, so the survivor's gate would run ITS file for the absorbed " +
        "expectation. Rename the absorbed eval (and its Verified by) first.",
      paths: collisions.map((c) => `${s.workstreamRel}/${c.split(": ")[1]}`),
    });
    return base;
  }

  // ---- re-key ---------------------------------------------------------------
  const max = maxIds(input.survivorTexts);
  const next = (prefix: string): string => {
    const n = (max.get(prefix) ?? 0) + 1;
    max.set(prefix, n);
    return `${prefix}-${n}`;
  };
  const eMap = new Map<string, string>();
  for (const b of aSlice.blocks) eMap.set(b.id, next("E"));
  const idMap = new Map<string, string>();
  for (const b of aParsed) {
    for (const id of parseCoversIds(b.covers ?? "")) {
      if (!idMap.has(id)) idMap.set(id, next(id.split("-")[0]));
    }
  }
  const rekeyed = aSlice.blocks.map((b) => rekeyBlock(b.text, eMap.get(b.id) as string, idMap));

  const provenance =
    `Absorbed from ${a.slug} (plan-${a.hash}) by \`devx workstream combine\` on ${input.today} (D-18): ` +
    `${[...eMap].map(([o, n]) => `${o}→${n}`).join(", ")}; Covers re-keyed ` +
    `${[...idMap].map(([o, n]) => `${o}→${n}`).join(", ") || "(none)"}. ` +
    `Define the new IDs in the PRD before Gate 1. Record: decisions/${input.today}-combine-${a.slug}.md`;
  const expectations =
    `${(s.expectations as string).replace(/\s+$/, "")}\n\n<!-- ${provenance} -->\n\n${rekeyed.join("\n\n")}\n`;

  // Self-check: the survivor's own blocks are untouched, and every absorbed
  // block reads back under its new id with its Covers mapped and every other
  // field byte-equal.
  const reparsed = parseExpectations(expectations);
  const mapped = (b: EBlock): string[] => parseCoversIds(b.covers ?? "").map((id) => idMap.get(id) ?? id);
  const fieldsSansCovers = (b: EBlock): string =>
    JSON.stringify([b.name, b.priority, b.trigger, b.expectation, b.threshold, b.verifiedBy, b.measure]);
  const ok =
    reparsed.length === sParsed.length + aParsed.length &&
    sParsed.every((b, k) => reparsed[k].id === b.id && fieldsOf(reparsed[k]) === fieldsOf(b)) &&
    aParsed.every((b, k) => {
      const r = reparsed[sParsed.length + k];
      return (
        r.id === eMap.get(b.id) &&
        fieldsSansCovers(r) === fieldsSansCovers(b) &&
        JSON.stringify(parseCoversIds(r.covers ?? "")) === JSON.stringify(mapped(b))
      );
    });
  if (!ok) {
    refusals.push({
      code: "carry-unverifiable",
      message: "the re-keyed expectations would not parse back to the absorbed blocks; refusing to write a carry that cannot be verified.",
      paths: [relOf(a, "expectations.md")],
    });
    return base;
  }

  const evalTargets = aParsed.flatMap((b) => {
    const t = classifyEvalTarget(b, a, [input.workstreamsRoot, input.archiveRoot], s.workstreamRel);
    return t === null ? [] : [t];
  });
  const aDefs = a.prd === null ? [] : extractDefinedIds(a.prd);
  const notCarried = aDefs.map((d) => d.id).filter((id) => !idMap.has(id));
  const likelyDuplicates: Array<[string, string]> = [];
  for (const b of aParsed) {
    const twin = sParsed.find((x) => normEars(x.expectation) !== "" && normEars(x.expectation) === normEars(b.expectation));
    if (twin) likelyDuplicates.push([b.id, twin.id]);
  }
  const survivorShipped = s.emitted
    .filter((e) => (e.status ?? "").trim().toLowerCase() === "done")
    .map((e) => ({ hash: e.hash, phase: e.phase }));
  if (survivorShipped.length > 0) {
    warnings.push(
      `'${s.slug}' has shipped phases (${survivorShipped.map((e) => e.hash).join(", ")}). Combine reopens its plan exactly as ` +
        "`devx revise --touched expectations.md` would; keep those phase numbers when the plan is re-authored, because Gate 4's " +
        "shipped-green deferral keys on them.",
    );
  }

  const entry = cascadeFor("expectations.md");
  if (entry === null) throw new Error("cascade table has no expectations.md row");
  const cascade = computeRevise(s.state, entry, s.hash);
  const gateStatus: Partial<Record<GateFlag, boolean>> = {};
  for (const f of cascade.resets) gateStatus[f] = false;
  const gateVerdicts: Partial<Record<GateKey, null>> = {};
  for (const k of cascade.verdictsCleared) gateVerdicts[k] = null;
  const sPatch: EnginePatch = { gateStatus, gateVerdicts, stage: cascade.stage };
  const blockers = [...s.blockedBy];
  for (const b of a.blockedBy) if (!blockers.includes(b)) blockers.push(b);
  if (blockers.length > s.blockedBy.length) sPatch.blocked_by = blockers;

  const aPrdLines = (a.prd ?? "").split("\n");
  const aDefLine = new Map(aDefs.map((d) => [d.id, d.line]));
  const mapRows = [
    ...[...eMap].map(([o, n]) => `| ${o} | ${n} | ${(aParsed.find((b) => b.id === o)?.name ?? "").replace(/\|/g, "\\|")} |`),
    ...[...idMap].map(([o, n]) => {
      const line = aDefLine.get(o);
      const text = line === undefined ? "not defined in the absorbed PRD" : `\`${(aPrdLines[line - 1] ?? "").trim().replace(/`/g, "'").replace(/\|/g, "\\|")}\``;
      return `| ${o} | ${n} | ${text} |`;
    }),
  ];
  const sRecord = [
    `# Combine — absorbed ${a.slug} — ${input.today}`,
    "",
    "<!-- Written by `devx workstream combine` (D-18). A record: never a gate input. -->",
    "",
    `\`${a.slug}\` (plan-${a.hash}) was absorbed into this workstream. Its E-blocks are appended to expectations.md, ` +
      "re-keyed past every ID this workstream already uses; only each heading and Covers line changed. Every gate here " +
      `was reopened by the expectations.md cascade (cleared: ${cascade.resets.join(", ")}; stage → ${cascade.stage}). ` +
      `The absorbed side keeps its own verdicts as history in \`${a.workstreamRel}/\`.`,
    "",
    "## ID map",
    "",
    "| Absorbed | Here | Absorbed text |",
    "|---|---|---|",
    ...mapRows,
    "",
    "## Before Gate 1",
    "",
    `- Define ${sortIds([...idMap.values()]).join(", ") || "nothing new"} in \`prd/agent.md\`. Until then Gate 1 FAILs on \`covers-id-dangling\`, which is the point: a fresh ID cannot be mistaken for one of this PRD's own.`,
    ...(likelyDuplicates.length > 0
      ? [`- Identical EARS text, never merged automatically: ${likelyDuplicates.map(([o, n]) => `${eMap.get(o)} (was ${o}) ≡ ${n}`).join("; ")}.`]
      : []),
    ...(notCarried.length > 0
      ? [`- Not carried, no absorbed expectation covers them: ${notCarried.join(", ")} (see \`${relOf(a, "prd/agent.md")}\`).`]
      : []),
    ...(blockers.length > s.blockedBy.length
      ? [`- blocked_by gained the absorbed side's blockers: ${a.blockedBy.join(", ")}.`]
      : []),
    "",
    "## Evals",
    "",
    ...(evalTargets.length > 0 ? evalTargets.map(renderEvalTarget) : ["- Every carried Verified by resolves here as written."]),
    "",
  ].join("\n");
  const aRecord = [
    `# Combined into ${s.slug} — ${input.today}`,
    "",
    "<!-- Written by `devx workstream combine` (D-18). A record: never a gate input. -->",
    "",
    `This workstream was absorbed into \`${s.slug}\` (plan-${s.hash}) and retired. Its artifacts and verdicts stay here, ` +
      `unchanged, as history; none transferred. Its E-blocks continue there as ${[...eMap.values()].join(", ")}. ` +
      `Record there: \`${sRecordRel}\`.`,
    "",
  ].join("\n");

  return {
    refusals,
    warnings,
    eMap: Object.fromEntries(eMap),
    idMap: Object.fromEntries(idMap),
    notCarried,
    likelyDuplicates,
    survivorShipped,
    evalTargets,
    survivor: {
      expectations,
      patch: sPatch,
      recordRel: sRecordRel,
      record: sRecord,
      logLine:
        `- ${input.stamp} — absorbed \`${a.slug}\` (plan-${a.hash}) by \`devx workstream combine\`: ` +
        `${[...eMap.values()].join(", ")} appended; gates reopened (${cascade.resets.join(", ")}), stage → ${cascade.stage} (D-18). Record: \`${sRecordRel}\`.`,
      resets: cascade.resets,
      stage: cascade.stage,
    },
    absorbed: {
      patch: { stage: "retired", status: "superseded", supersededBy: s.hash },
      recordRel: aRecordRel,
      record: aRecord,
      logLine:
        `- ${input.stamp} — absorbed into \`${s.slug}\` (${s.hash}) by \`devx workstream combine\`; retired here as history, ` +
        `verdicts unchanged and not inherited (D-18). Record: \`${aRecordRel}\`.`,
    },
  };
}

/** Validate a child slug list. Returns an error string (exit 2) or null. */
export function intoError(into: string[]): string | null {
  for (const s of into) {
    if (!SLUG_RE.test(s) || s.length > 50) return `invalid child slug '${s}' (expected kebab-case, ≤50 chars)`;
  }
  const dup = into.find((s, i) => into.indexOf(s) !== i);
  return dup === undefined ? null : `child slug '${dup}' is listed twice in --into`;
}
