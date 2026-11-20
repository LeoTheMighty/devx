// Workstream position + gate-evidence reconciliation — the mechanical half of
// the holistic review pass (`/devx-review`; 8am-harness CONVENTIONS §25).
//
// The four gates are each excellent at their own artifact and structurally
// blind to the whole: nothing in devx asks whether a workstream's frontmatter
// is still telling the truth. `gate_status.design_verified: true` is a
// boolean, and a boolean cannot tell you that the report behind it was never
// written, or that the design has been rewritten since. That gap is the
// premature-closure class — a process ran, the success flag flipped, and the
// end state was never re-verified — and it is exactly what a
// frontmatter-as-state engine has to have audited.
//
// Two properties make this safe to trust:
//
//   1. **Pure.** Every disk fact arrives as a probe the caller filled in, so
//      the findings are table-testable and this module cannot write the state
//      it audits (pinned by `test/review-never-writes-gates.test.ts`).
//   2. **Receipted.** Each finding carries a `receipt` naming the frontmatter
//      key and the path that disagree with it. §25's rule is that a finding
//      without a file, a command or a grep behind it is dropped, so a finding
//      shape with no room for one would quietly re-admit narration as
//      evidence.
//
// Advisory by construction: nothing here returns a `Verdict` (the D-9 gate
// vocabulary) and nothing here is a gate input. The review's own vocabulary
// is CLEAN | CONCERNS | BLOCKING. It borrows no word that DECIDES — no PASS,
// no FAIL, no WAIVED — though `CONCERNS` is shared on purpose, because it
// means the same thing on both sides. The firewall that actually holds is the
// KEY: a review carries `review:`, never `gate:`, so `parseVerdictBlock`
// returns null for one and no consumer of a gate report can read a review as
// a gate's answer.
//
// Staleness is measured in COMMIT time, not mtime: mtimes are rewritten by
// every fresh clone and by CI's own checkout, so an mtime check fires on
// every CI run and never locally. Specifically it is the time of the last
// commit that CREATED or CHANGED the path's content, following renames
// (`git log --follow --diff-filter=AM`). The `AM` filter is the whole
// editorial/substantive distinction (§12) done mechanically: the
// folder-per-artifact migration moved every workstream's `design.md` to
// `design/agent.md` long after their gates passed, and a plain
// last-commit-touching-this-path probe reports every one of them as a
// rewritten artifact. A relocation is not a rewrite.
//
// The cost of commit time is that an edit sitting uncommitted in the working
// tree is invisible to the comparison — so a dirty gated subject is reported
// on its own (`uncommitted-subject`) rather than silently passing.
//
// WHAT THIS CANNOT SEE, stated so nothing over-trusts it. Every check below
// looks for state claiming MORE than the evidence supports: a flag over a
// missing record, a stage ahead of its gates. The mirror-image defect — a
// gate whose own predicate is WRONGER than its contract, so it withholds
// relief it should grant — is structurally invisible here, because it shows
// up as a visible CONCERNS or FAIL rather than a false green. A real example
// landed the same week this shipped: `shippedPhases()` matched a dev spec's
// `plan:` pointer against the workstream directory while most specs spell it
// as the parent plan spec's path, so Gate 4's shipped-phase relief never
// fired. Reconciliation audits the recorded state, not the gates' internals.
// What it does do is put the symptom on the page — an unexplained CONCERNS on
// a gate that should have had relief — which is why `/devx-review`'s L1 lens
// is told to read the report behind every persisted CONCERNS. The class is
// otherwise caught by the mutation benchmark (`test/gate-mutations.test.ts`)
// and by running against a real repo rather than a fixture.
//
// Row A16/B13/C13 of docs/updates/8am-harness-gap-analysis.md.

import type { GateGap } from "./gate-prd.js";
import {
  GATE_FLAGS,
  FLAG_TO_GATE_KEY,
  type EngineState,
  type GateFlag,
  type GateKey,
  type Stage,
} from "./frontmatter.js";

// ---------------------------------------------------------------------------
// Finding shape
// ---------------------------------------------------------------------------

/** Two levels, not three. `blocking` is what a human must resolve before the
 *  workstream's recorded state can be believed; `advisory` is everything
 *  else. A middle tier would invite the "warning" bucket that nobody reads,
 *  and the verdict rule below only ever needs the split. */
export type PositionSeverity = "blocking" | "advisory";

export interface PositionFinding {
  /** Stable, grep-able identifier — same contract as `GateGap.check`, so a
   *  finding can be referenced in a decision record or a queue entry without
   *  quoting its prose. */
  check: string;
  severity: PositionSeverity;
  /** What disagrees with what, in `claimed vs observed` shape. */
  message: string;
  /** The receipt: the frontmatter key plus the path or command that proves
   *  it. Never an inference (§25). */
  receipt: string;
}

/** The review's own verdict vocabulary — see the file header on why it shares
 *  `CONCERNS` with D-9 and nothing that decides. */
export const REVIEW_VERDICTS = ["CLEAN", "CONCERNS", "BLOCKING"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export interface FindingTally {
  blocking: number;
  advisory: number;
}

/**
 * Report rank per check. Lower leads.
 *
 * The premature-closure family goes first because it is the class a
 * frontmatter-as-state engine most needs told: a gate flag standing over a
 * record that is missing, stale, or over an artifact that is gone. Everything
 * downstream believes that boolean, so a reader must meet it before a
 * verdict-persistence note about a migration.
 *
 * Ranking rather than sorting by severity alone: `blocking` is a two-value
 * field and half a dozen checks share it, so severity cannot say which
 * blocking finding a reader should see first. Unlisted checks rank last, in
 * the order the reconciler produced them.
 */
const CHECK_RANK: Record<string, number> = {
  "premature-closure": 0,
  "subject-missing": 1,
  "stale-evidence": 2,
  "gate-1-regression": 3,
  "verdict-disagrees": 4,
  "illegal-transition": 5,
  "stage-ahead-of-gates": 6,
  "blocked-while-validated": 7,
};

/** Stable sort by rank — gate order is preserved inside each rank, so two
 *  runs over the same inputs still produce byte-identical output. */
function byReportRank(findings: PositionFinding[]): PositionFinding[] {
  return findings
    .map((f, i) => ({ f, i, rank: CHECK_RANK[f.check] ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.f);
}

export function tallyFindings(findings: readonly PositionFinding[]): FindingTally {
  return {
    blocking: findings.filter((f) => f.severity === "blocking").length,
    advisory: findings.filter((f) => f.severity === "advisory").length,
  };
}

/**
 * The deterministic review verdict: any blocking finding ⇒ BLOCKING, else any
 * advisory ⇒ CONCERNS, else CLEAN.
 *
 * It takes the WHOLE finding list, mechanical and judgment alike, because
 * `/devx-review` adds its own (RTM gaps, unmapped work, diff cleanliness) to
 * the ones computed here and both halves answer to the same rule. A verdict
 * computed over only the half a CLI can see would read as authoritative and
 * be wrong exactly when the review found something.
 */
export function reviewVerdictFor(
  findings: readonly PositionFinding[],
): ReviewVerdict {
  const tally = tallyFindings(findings);
  if (tally.blocking > 0) return "BLOCKING";
  return tally.advisory > 0 ? "CONCERNS" : "CLEAN";
}

// ---------------------------------------------------------------------------
// Evidence probes
// ---------------------------------------------------------------------------

/** One path as the reconciler needs to see it. Filled by the caller (the CLI
 *  owns the fs + git seams), so every check below is a comparison over data. */
export interface PathProbe {
  /** Repo-relative display path — what a receipt prints. */
  rel: string;
  exists: boolean;
  /** Epoch seconds of the last commit that created or changed this path's
   *  content, following renames; null when git knows of no such commit
   *  (untracked, or no history at all), in which case the staleness
   *  comparison is skipped rather than guessed. */
  changedAt: number | null;
  /** Uncommitted changes present for this path. */
  dirty: boolean;
}

export interface GateEvidence {
  /** The artifacts this gate gates. A list, not one path, because Gate 1
   *  gates two (the PRD and expectations.md) and Gate 4's subject is the
   *  whole evals directory — flattening either to a single path would hide a
   *  rewritten expectations.md behind an untouched PRD. */
  subjects: readonly PathProbe[];
  /** The record the gate leaves behind, or null for a gate that writes none.
   *  Gate 1 is the one: `devx gate prd` flips flags and writes no report, so
   *  it is reconciled through the flags and the critique record instead — and
   *  the reconciler says so rather than inventing a missing artifact. */
  evidence: PathProbe | null;
  /** The sanctioned way to REOPEN this gate, from `reviseCommand` — the
   *  receipt a reader acts on.
   *
   *  Not "the command that re-runs this gate", which is what this field held
   *  for one release. Every finding that cites it fires only when the gate's
   *  flag is TRUE, and since #187/#190 all three gate CLIs refuse a closed
   *  re-run and write nothing — so `re-run \`devx gate evals <hash>\`` sent a
   *  reader straight into an exit 1. A receipt naming a command that cannot
   *  do what the receipt claims is this lens's own failure mode turned on
   *  itself: state asserting more than its evidence supports. */
  reopen: string;
}

export type GateEvidenceMap = Record<GateKey, GateEvidence>;

export interface ReconcileInputs {
  state: EngineState;
  gates: GateEvidenceMap;
  /**
   * Gate 1 re-evaluated over the artifacts as they stand NOW, or null when
   * its inputs could not be read.
   *
   * Gate 1 is the only gate a review can re-run for free: `evaluateGatePrd`
   * is pure, so asking it again writes nothing, and the answer is the
   * strongest form of "do the artifacts still adhere to their requirements"
   * devx can give mechanically. The other three cannot be re-run here —
   * gates 2 and 3 need the judgment table a subagent produces, and Gate 4
   * needs to execute the evals — which is exactly why `/devx-review` does
   * those halves and this does not pretend to.
   *
   * It arrives as data rather than being computed here so this module stays
   * pure over inputs and does not grow a second opinion about what Gate 1
   * requires. The caller passes `evaluateGatePrd`'s own result.
   */
  prdRecheck: {
    /** Gate 1 is tri-state. `CONCERNS` is NOT a regression: the gate's
     *  criteria still hold and it still advances — the measurability floor
     *  just has something advisory to say, which the spec's
     *  `gate_verdicts.prd` already records. Only `FAIL` means the criteria
     *  stopped holding, so only `FAIL` reaches check 7. */
    verdict: "PASS" | "CONCERNS" | "FAIL";
    gaps: readonly GateGap[];
  } | null;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Stages at or past which every gate must be green. `executing` is the stage
 *  Gate 4 itself sets, so reaching it with an open gate means the flags were
 *  hand-edited (or a cascade half-applied).
 *
 *  `retired` is deliberately NOT here. Retiring is abandonment, and a
 *  workstream abandoned at the design stage legitimately leaves two gates
 *  open forever — demanding all four would make every retirement a BLOCKING
 *  finding, which is the opposite of what retiring something means. */
const POST_GATE_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "executing",
  "done",
]);

/** Stages a workstream can legitimately sit at with gates still open. */
const PRE_GATE_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  "intake",
  "prd",
  "design",
  "plan",
  "red",
]);

/**
 * The receipt tail for a finding whose fix is reopening a closed gate.
 *
 * On a `done` workstream the EVALS gate has a second, narrower door: the
 * outcome loop's `tune` reopens verification only — it clears `evals_red` and
 * rolls the stage back to red — where `devx revise --touched plan` would also
 * drop `plan_verified` and reopen the plan. Naming the wider one first on a
 * closed workstream would have a reader re-open more than the finding asks
 * for, so both are named with which is which.
 */
function reopenTail(
  gate: GateEvidence,
  state: EngineState,
  key: GateKey,
  /** The eval artifact this finding is about, when it is about one — its
   *  basename carries the E-id `--reopen` needs. */
  subjectRel?: string,
): string {
  if (key === "evals" && state.stage === "done" && state.hash !== null) {
    // `--reopen` is REQUIRED for tune ("verdict 'tune' requires --reopen with
    // at least one E-id"), so naming the bare verdict would leave a reader on
    // an arg-shape error — the same defect as naming a command that refuses,
    // which is what this helper exists to stop. The E-id is in the eval's own
    // filename, so the receipt can carry the real one rather than a
    // placeholder.
    const eid = subjectRel === undefined ? null : eIdFromEvalPath(subjectRel);
    return (
      `reopen with \`devx outcome score ${state.hash} --verdict tune --reopen ${eid ?? "<E-ids>"}\` ` +
      `(verification-scoped) or ${gate.reopen} (reopens the plan too)`
    );
  }
  return `reopen with ${gate.reopen}`;
}

/** `evals/E-7_skill-todo-discipline.ts` → `E-7`; null when the name carries
 *  no E-id (a fixture, a helper, a hand-named artifact). */
function eIdFromEvalPath(rel: string): string | null {
  const base = rel.split("/").pop() ?? "";
  return /^(E-\d+)[_.]/.exec(base)?.[1] ?? null;
}

const isTrue = (state: EngineState, flag: GateFlag): boolean =>
  state.gateStatus[flag] === true;

/**
 * Every place the spec's recorded state disagrees with the evidence on disk.
 *
 * Order is the gate order (prd → design → plan → evals) and then the
 * whole-state checks, so two runs over the same inputs produce the same list
 * in the same sequence — a report reconciled in place must not reshuffle its
 * own rows between runs.
 */
export function reconcileGates(inputs: ReconcileInputs): PositionFinding[] {
  const { state, gates, prdRecheck } = inputs;
  const out: PositionFinding[] = [];
  /** Green-by-flag gates with no persisted verdict (see check 6). */
  const unpersisted: GateKey[] = [];

  for (const flag of GATE_FLAGS) {
    const key = FLAG_TO_GATE_KEY[flag];
    const gate = gates[key];
    const verdict = state.gateVerdicts[key];

    // A FAIL on an open gate is the gate working. The one thing worth saying
    // about an open gate is nothing.
    if (!isTrue(state, flag)) continue;

    // 1 — premature closure: the flag claims a gate passed and the record it
    // would have written is not there. The highest-severity class there is:
    // every downstream reader believes the boolean.
    if (gate.evidence !== null && !gate.evidence.exists) {
      out.push({
        check: "premature-closure",
        severity: "blocking",
        message: `gate_status.${flag} is true but its evidence record is missing — claimed passed vs no record on disk`,
        receipt: `${gate.evidence.rel} does not exist; ${reopenTail(gate, state, key)}`,
      });
    }

    for (const subject of gate.subjects) {
      // 2 — stale evidence: the subject moved after the record was written,
      // so the gate passed a version that no longer exists (§12).
      if (
        gate.evidence !== null &&
        gate.evidence.exists &&
        gate.evidence.changedAt !== null &&
        subject.changedAt !== null &&
        subject.changedAt > gate.evidence.changedAt
      ) {
        out.push({
          check: "stale-evidence",
          severity: "blocking",
          message: `gate_status.${flag} is true but ${subject.rel} changed after ${gate.evidence.rel} was written — the gate passed a version that no longer exists`,
          receipt: `git log --follow -1 --format=%ct --diff-filter=AM -- ${subject.rel} (${subject.changedAt}) > ${gate.evidence.rel} (${gate.evidence.changedAt}); ${reopenTail(gate, state, key, subject.rel)}`,
        });
      }

      // 3 — a dirty subject under a green gate. Not the same finding as
      // staleness and deliberately softer: an uncommitted edit may well be
      // the change that is about to reopen the gate.
      if (subject.dirty) {
        out.push({
          check: "uncommitted-subject",
          severity: "advisory",
          message: `gate_status.${flag} is true but ${subject.rel} has uncommitted changes — the gate passed the committed version, not the one on disk`,
          receipt: `git status --porcelain -- ${subject.rel}`,
        });
      }

      // 4 — a green gate over an absent subject. Mechanically impossible to
      // reach by a legal path (every gate refuses a missing subject), so it
      // means the artifact was deleted or moved out from under the flag.
      if (!subject.exists) {
        out.push({
          check: "subject-missing",
          severity: "blocking",
          message: `gate_status.${flag} is true but ${subject.rel} does not exist — the gate cannot have passed an artifact that is not there`,
          receipt: `${subject.rel} does not exist; ${reopenTail(gate, state, key, subject.rel)}`,
        });
      }
    }

    // 5 — the flag and the persisted verdict contradict each other.
    if (verdict === "FAIL") {
      out.push({
        check: "verdict-disagrees",
        severity: "blocking",
        message: `gate_status.${flag} is true but gate_verdicts.${key} is FAIL — the flag and the last evaluation disagree`,
        receipt: `spec frontmatter: gate_status.${flag}: true, gate_verdicts.${key}: FAIL`,
      });
    }

    // 6 — a pre-hfi102 pass. The flag is the only record, so "passed" here is
    // inferred from a boolean. Collected and reported ONCE below: a
    // pre-verdict workstream has all four unpersisted, and four rows saying
    // the same thing about the same migration is how a reader learns to skim
    // past the report.
    if (verdict === null) unpersisted.push(key);
  }

  if (unpersisted.length > 0) {
    out.push({
      check: "verdict-not-persisted",
      severity: "advisory",
      message: `${unpersisted.join(", ")} ${unpersisted.length === 1 ? "is" : "are"} green by flag with no gate_verdicts entry — a pre-verdict run, so PASS is inferred from the boolean rather than computed`,
      receipt: `spec frontmatter: gate_verdicts missing ${unpersisted.join(", ")}`,
    });
  }

  // 7 — Gate 1 re-run over today's artifacts says FAIL. This is the one gate
  // whose criteria a review can re-apply itself, and it catches the whole
  // family at once: expectations gutted below the floor, a `Covers:` that no
  // longer resolves, a goal left orphaned, EARS prose softened into a wish.
  // `devx gate prd` would refuse to re-run on a closed gate, so without this
  // nothing ever re-asks the question after Gate 1 passes.
  if (
    isTrue(state, "prd_validated") &&
    prdRecheck !== null &&
    prdRecheck.verdict === "FAIL"
  ) {
    const checks = [...new Set(prdRecheck.gaps.map((g) => g.check))];
    const first = prdRecheck.gaps[0];
    out.push({
      check: "gate-1-regression",
      severity: "blocking",
      message: `prd_validated is true but Gate 1's own criteria no longer hold: ${checks.join(", ")} (${prdRecheck.gaps.length} gap${prdRecheck.gaps.length === 1 ? "" : "s"})`,
      receipt:
        first !== undefined && first.location !== undefined
          ? `${first.location}: ${first.message}`
          : `${first?.message ?? "see the gap report"}`,
    });
  }

  // 8 — illegal transition: the gate DAG is linear, so a green gate behind an
  // open one cannot have been reached by any legal path.
  for (let i = 1; i < GATE_FLAGS.length; i++) {
    const flag = GATE_FLAGS[i] as GateFlag;
    if (!isTrue(state, flag)) continue;
    const open = GATE_FLAGS.slice(0, i).filter((f) => !isTrue(state, f as GateFlag));
    if (open.length === 0) continue;
    out.push({
      check: "illegal-transition",
      severity: "blocking",
      message: `gate_status.${flag} is true while ${open.join(", ")} ${open.length === 1 ? "is" : "are"} false — unreachable on the gate DAG`,
      receipt: "spec frontmatter: gate_status",
    });
  }

  const allGreen = GATE_FLAGS.every((f) => isTrue(state, f as GateFlag));
  const stage = state.stage;

  // 9 — the stage claims execution with a gate still open. Only Gate 4 sets
  // `executing`, so this is a hand-edit or a half-applied cascade.
  if (stage !== null && POST_GATE_STAGES.has(stage) && !allGreen) {
    const open = GATE_FLAGS.filter((f) => !isTrue(state, f as GateFlag));
    out.push({
      check: "stage-ahead-of-gates",
      severity: "blocking",
      message: `stage is '${stage}' but ${open.join(", ")} ${open.length === 1 ? "is" : "are"} false — only Gate 4 advances past red`,
      receipt: `spec frontmatter: stage: ${stage}, gate_status`,
    });
  }

  // 10 — the mirror image, advisory because it blocks nothing: the gates
  // advance the stage themselves, so all-green at a planning stage means a
  // rollback left the flags standing.
  if (stage !== null && PRE_GATE_STAGES.has(stage) && allGreen) {
    out.push({
      check: "stage-behind-gates",
      severity: "advisory",
      message: `stage is '${stage}' but all four gate flags are true — a rollback that left the flags standing (devx revise clears both)`,
      receipt: `spec frontmatter: stage: ${stage}, gate_status`,
    });
  }

  // 11 — Gate 1 refuses a non-empty `blocked_by`, so a blocker under a green
  // Gate 1 arrived after the gate ran. §23: surface loudly.
  if (isTrue(state, "prd_validated") && state.blockedBy.length > 0) {
    out.push({
      check: "blocked-while-validated",
      severity: "blocking",
      message: `prd_validated is true but blocked_by carries ${state.blockedBy.join(", ")} — Gate 1 refuses a non-empty blocked_by, so this arrived afterwards`,
      receipt: `spec frontmatter: blocked_by: [${state.blockedBy.join(", ")}]`,
    });
  }

  // 12 — Gate 4 passed before the eval lock existed. `--verify` has no shas
  // to compare, so "fix the code, not the eval" is unenforced here.
  if (isTrue(state, "evals_red") && !state.evalsLocked) {
    out.push({
      check: "evals-unstamped",
      severity: "advisory",
      message:
        "evals_red is true but evals_locked is not set — Gate 4 stamped no step bodies, so a softened eval is undetectable",
      receipt: `spec frontmatter: gate_status.evals_locked absent; \`devx gate evals ${state.hash ?? "<hash>"} --verify\` — the one re-run a closed Gate 4 still allows — has nothing to compare`,
    });
  }

  // 13 — a closed workstream owes its outcome. `devx next` row 2 says this as
  // a command; the review says it as a finding, so it lands in the tally a
  // human reads at close.
  if (stage === "done" && state.outcome.status === null) {
    out.push({
      check: "outcome-unarmed",
      severity: "advisory",
      message:
        "stage is 'done' but the outcome was never armed — nothing will ever score whether the PRD's goals were met",
      receipt: `spec frontmatter: outcome.status: null; arm it with \`devx outcome arm ${state.hash ?? "<hash>"}\``,
    });
  }

  return byReportRank(out);
}
