// Tests for pln105 — Phase 6.5 mode gate is structurally explicit.
//
// pln105 is a skill-body contract story: the mode gate is a binary predicate
// the LLM evaluates at runtime, not a runtime helper. So the testable surface
// is the skill body's text — assert the predicate is verbatim, the YOLO branch
// documents skip + canonical no-op literal, the BETA/PROD/LOCKDOWN branches
// document their differential behavior structurally, and the Phase 8 final
// summary renders the YOLO canonical literal verbatim.
//
// Pattern matches plan-precedence-enforcement.test.ts (pln104): doc-check the
// skill body sections to guard against silent drift between the spec contract
// and the prose that drives /devx-plan.
//
// Spec: dev/dev-pln105-2026-04-28T19:30-plan-mode-gate.md
// Closes LEARN.md cross-epic pattern: `[low] [skill] Phase 6.5 mode-gate prose
// ambiguity` — the original draft's `**Skipped in YOLO mode.**` left
// BETA/PROD/LOCKDOWN behavior to inference.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Skill body slicing — the doc-checks all run against the Phase 6.5 section
// (and one against Phase 8 item 8). Slice once at module load.
//
// Heading anchors use line-anchored regex (`/^### Phase N\b/m`) so a future
// edit that changes the trailing punctuation (`### Phase 7 — Readiness Check`
// vs `### Phase 7: Readiness Check`) doesn't invalidate the slice silently
// (Edge Case Hunter F1).
// ---------------------------------------------------------------------------

const skillPath = join(process.cwd(), ".claude/commands/devx-plan.md");
const body = readFileSync(skillPath, "utf-8");

function findHeadingOffset(re: RegExp, label: string): number {
  const match = re.exec(body);
  if (match === null) {
    throw new Error(`could not locate ${label} heading in devx-plan.md`);
  }
  return match.index;
}

const phase65Start = findHeadingOffset(/^### Phase 6\.5\b/m, "Phase 6.5");
const phase7Start = findHeadingOffset(/^### Phase 7\b/m, "Phase 7");
const phase8Start = findHeadingOffset(/^### Phase 8\b/m, "Phase 8");

const phase65 = body.slice(phase65Start, phase7Start);

// Phase 8 ends before the next top-level "## " heading (or end-of-file). The
// `\n## ` anchor avoids matching `### ` sub-headings inside Phase 8 itself.
const phase8End = body.indexOf("\n## ", phase8Start);
const phase8 = body.slice(
  phase8Start,
  phase8End === -1 ? body.length : phase8End,
);

// Sub-slicing — branch sections live inside phase65, but assertions about a
// specific branch should only run against that branch's text. Without sub-
// slicing, a regex like `/advisory/i` on the full phase65 slice false-passes
// when the word migrates to a shared section (Edge Case Hunter F4 / Blind
// Hunter LOW-6).
function branchSlice(branchMarker: string): string {
  const start = phase65.indexOf(branchMarker);
  if (start === -1) {
    throw new Error(`branch marker not found in Phase 6.5: ${branchMarker}`);
  }
  // The next branch starts at `**Branch — \`mode == "..."\`**` or, for
  // LOCKDOWN (the last branch), at the LEARN.md anchor footer.
  const remainder = phase65.slice(start + branchMarker.length);
  const nextBranch = remainder.search(
    /\*\*Branch — `mode == "[A-Z]+"`\*\*|\*\*LEARN\.md cross-epic anchor/,
  );
  return nextBranch === -1
    ? remainder
    : remainder.slice(0, nextBranch);
}

const yoloSlice = branchSlice('**Branch — `mode == "YOLO"`**');
const betaSlice = branchSlice('**Branch — `mode == "BETA"`**');
const prodSlice = branchSlice('**Branch — `mode == "PROD"`**');
const lockdownSlice = branchSlice('**Branch — `mode == "LOCKDOWN"`**');

// Phase 8 item 8 — the YOLO literal must be inside the focus-group bullet,
// not somewhere else in Phase 8 (Edge Case Hunter F6).
const item8Start = phase8.indexOf("8. **Epics refined via focus-group");
if (item8Start === -1) {
  throw new Error("could not locate Phase 8 item 8 in devx-plan.md");
}
const item8AfterStart = phase8.slice(item8Start);
// Next list item (single-digit-prefix) at line start.
const nextItemMatch = item8AfterStart.slice(1).search(/\n\d+\. \*\*/);
const phase8Item8 =
  nextItemMatch === -1
    ? item8AfterStart
    : item8AfterStart.slice(0, nextItemMatch + 1);

// ---------------------------------------------------------------------------
// 1) Predicate is verbatim and structurally explicit at the open of Phase 6.5.
// ---------------------------------------------------------------------------

describe("/devx-plan Phase 6.5 mode predicate (pln105 AC#1)", () => {
  it("opens with the verbatim mode predicate per spec AC", () => {
    // Spec AC: `IF mode == "YOLO" THEN skip-with-one-line-summary ELSE
    // run-focus-group-per-epic`. Double quotes per spec ACs (source-of-truth
    // precedence: spec ACs > epic locked decisions).
    expect(phase65).toContain(
      'IF mode == "YOLO" THEN skip-with-one-line-summary ELSE run-focus-group-per-epic',
    );
  });

  it("the predicate appears inside a fenced code block (structural marker, not prose)", () => {
    // Find the predicate's offset and assert there's a fence opener before it
    // within the same Phase 6.5 slice. Guards against the predicate being
    // demoted into a sentence in a future edit.
    const predicateOffset = phase65.indexOf(
      'IF mode == "YOLO" THEN skip-with-one-line-summary ELSE run-focus-group-per-epic',
    );
    expect(predicateOffset).toBeGreaterThan(0);
    const before = phase65.slice(0, predicateOffset);
    // Last fence opener before the predicate must not be balanced by a closer
    // after it on the same prefix — i.e., the predicate is between an
    // unclosed ``` and its closer.
    const fences = before.match(/```/g) ?? [];
    expect(fences.length % 2).toBe(1);
  });

  it("references devx.config.yaml → mode as the predicate input source", () => {
    expect(phase65).toMatch(/devx\.config\.yaml.*mode/);
  });

  it("declares no fall-through / no mid-phase mode flips (binary predicate discipline)", () => {
    expect(phase65).toMatch(/no fall-through|no\s*-\s*fall-through/i);
  });
});

// ---------------------------------------------------------------------------
// 2) YOLO branch — documents skip + canonical literal + no session files.
//    Spec AC#2: "YOLO branch: final summary contains
//    `Phase 6.5 (Focus-group): skipped — mode is YOLO per devx.config.yaml.`
//    No session files written."
// ---------------------------------------------------------------------------

const YOLO_LITERAL =
  "Phase 6.5 (Focus-group): skipped — mode is YOLO per devx.config.yaml. Rerun /devx-plan after bumping mode to BETA+ to consult personas.";

describe('/devx-plan Phase 6.5 — YOLO branch (mode == "YOLO") (pln105 AC#2)', () => {
  it("documents the YOLO branch with an explicit `mode == \"YOLO\"` heading or marker", () => {
    expect(phase65).toMatch(/mode\s*==\s*"YOLO"/);
  });

  it("renders the canonical YOLO literal verbatim in Phase 6.5", () => {
    // Spec AC requires the prefix substring; we ship the epic's expanded
    // form (which contains the spec's substring + the rerun hint). "Contains"
    // semantic so additional trailing prose is allowed.
    expect(phase65).toContain(
      "Phase 6.5 (Focus-group): skipped — mode is YOLO per devx.config.yaml.",
    );
    expect(phase65).toContain(YOLO_LITERAL);
  });

  it("YOLO branch silences every artifact surface: session, cross-ref, INTERVIEW, MANUAL", () => {
    // Blind Hunter MED-3 + Edge Case Hunter F8: each silenced artifact must
    // be named explicitly. A future edit could remove any one of these and
    // the test must catch it. Tight regexes (no greedy alternation).
    expect(yoloSlice).toMatch(/no\s+session/i);
    expect(yoloSlice).toMatch(/focus-group\/sessions\//);
    expect(yoloSlice).toMatch(/no\s+cross-references|no\s+cross-ref/i);
    expect(yoloSlice).toMatch(/no\s+INTERVIEW(\.md)?\s+filings?/i);
    expect(yoloSlice).toMatch(/no\s+MANUAL(\.md)?\s+filings?/i);
  });

  it("clarifies that skipping focus-group does NOT skip Phase 7 (readiness)", () => {
    // Spec technical note: "Skipped focus-group does NOT mean Phase 7
    // (readiness) is skipped." Load-bearing — without this, a reader could
    // infer the YOLO branch shortcuts past readiness.
    expect(phase65).toMatch(
      /does\s*NOT\s*skip\s*Phase\s*7|Phase\s*7.*runs\s*unconditionally/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 3) BETA branch — focus-group consulted per epic; session file written;
//    cross-reference from epic file. Spec AC#3.
// ---------------------------------------------------------------------------

describe('/devx-plan Phase 6.5 — BETA branch (mode == "BETA") (pln105 AC#3)', () => {
  it("documents the BETA branch with explicit `mode == \"BETA\"` marker", () => {
    expect(phase65).toMatch(/mode\s*==\s*"BETA"/);
  });

  it("references focus-group/prompts/new-feature-reaction.md as the prompt source", () => {
    expect(betaSlice).toMatch(/focus-group\/prompts\/new-feature-reaction\.md/);
  });

  it("documents writing session files at focus-group/sessions/session-<...>-<epic-slug>-reaction.md", () => {
    // Edge Case Hunter F3: spec AC#3 uses `<date>` as the placeholder; skill
    // body uses the more concrete `<YYYY-MM-DD>`. Either form satisfies the
    // spec — the placeholder name is illustrative, not load-bearing. Test
    // tolerates both so a future spec/skill alignment in either direction
    // doesn't false-fail.
    expect(betaSlice).toMatch(
      /focus-group\/sessions\/session-<(?:date|YYYY-MM-DD)>-<epic-slug>-reaction\.md/,
    );
  });

  it("documents cross-reference back into the epic file under `## Focus-group reactions` heading", () => {
    // Blind Hunter LOW-7: assert heading-level (`##`) so a demotion to
    // inline mention doesn't pass.
    expect(betaSlice).toMatch(/##\s*Focus-group reactions/);
  });

  it("BETA is advisory — does not gate Phase 7 on user acknowledgment", () => {
    // Differential against PROD/LOCKDOWN: BETA logs but does not block. The
    // assertion runs against the BETA-only sub-slice (Blind Hunter LOW-6 /
    // Edge Case Hunter F4) so a future edit that moves "advisory" out of
    // BETA gets caught. Tolerates markdown emphasis (**not**) around "not".
    expect(betaSlice).toMatch(/advisory/i);
    expect(betaSlice).toMatch(/do\s*\*{0,4}not\*{0,4}\s*gate/i);
  });
});

// ---------------------------------------------------------------------------
// 4) PROD branch — BETA + binding-check via INTERVIEW filing in canonical
//    Q-shape. Spec AC#4 + Murat's lock: test asserts INTERVIEW.md gets a new
//    entry with the canonical Q-shape; user response is fixture-mockable.
// ---------------------------------------------------------------------------

describe('/devx-plan Phase 6.5 — PROD branch (mode == "PROD") (pln105 AC#4)', () => {
  it("documents the PROD branch with explicit `mode == \"PROD\"` marker", () => {
    expect(phase65).toMatch(/mode\s*==\s*"PROD"/);
  });

  it("PROD = BETA branch + binding-check (additive, not replacement)", () => {
    // Blind Hunter MED-4: tighten — require BOTH "run BETA branch" AND
    // "binding-check" in the same prose, not either-or. Without this, a
    // future edit could keep "run BETA branch" and silently drop the
    // binding-check obligation. `[\s\S]` to match across newlines.
    expect(prodSlice).toMatch(
      /run\s*BETA\s*branch[\s\S]*?(?:plus|and)[\s\S]*?binding-check/i,
    );
  });

  it("documents the binding-check trigger: critical shared concern across ≥2 personas", () => {
    // Edge Case Hunter F2: tolerate punctuation/markdown between the words
    // "critical" / "shared" / "concern" so a copyedit like
    // "critical, shared concern" or "critical **shared** concern" doesn't
    // false-fail. Tight bound on intervening characters (≤20) to avoid
    // matching unrelated cross-paragraph text.
    expect(prodSlice).toMatch(
      /critical[\s\S]{0,20}?shared[\s\S]{0,20}?concern/i,
    );
    expect(prodSlice).toMatch(/≥\s*2\s*personas|2\+?\s*personas|two\s*personas/i);
  });

  it("documents INTERVIEW.md filing before Phase 7 runs", () => {
    expect(prodSlice).toMatch(/INTERVIEW\.md/);
    expect(prodSlice).toMatch(/before\s*Phase\s*7/i);
  });

  it("INTERVIEW.md entry follows the canonical Q-shape: heading, options, recommendation", () => {
    // The canonical Q-shape is documented in the skill body so /devx-plan
    // emits a uniform shape every PROD invocation. Murat's lock requires
    // the test asserts the structural shape; user response is fixture-
    // mocked, not real-time.
    //
    // Edge Case Hunter F7: accept either em-dash (U+2014) or ASCII hyphen
    // for the `### Q —` heading separator — autocorrect-off scenarios may
    // produce hyphens.
    expect(prodSlice).toMatch(/###\s*Q\s*[—-]\s*focus-group binding concern/);
    expect(prodSlice).toMatch(/Options:/);
    // The three canonical option labels: acknowledge / reshape / defer.
    expect(prodSlice).toMatch(/\(a\)\s*acknowledge/);
    expect(prodSlice).toMatch(/\(b\)\s*reshape/);
    expect(prodSlice).toMatch(/\(c\)\s*defer/);
    expect(prodSlice).toMatch(/Recommendation:/);
  });

  it("documents that fixture tests pre-populate INTERVIEW.md with `→ Answer: (a) acknowledge` (Murat's lock)", () => {
    // Anchor for future test authors so the fixture-mock pattern doesn't
    // get rediscovered. Real user acknowledgment is out-of-scope for unit
    // tests; the doc-check guards against drift on this discipline.
    expect(prodSlice).toMatch(
      /→\s*Answer:\s*\(a\)\s*acknowledge|fixture.*mock/i,
    );
  });
});

// ---------------------------------------------------------------------------
// 5) LOCKDOWN branch — PROD + mandatory + override knob. Spec AC#5.
// ---------------------------------------------------------------------------

describe('/devx-plan Phase 6.5 — LOCKDOWN branch (mode == "LOCKDOWN") (pln105 AC#5)', () => {
  it("documents the LOCKDOWN branch with explicit `mode == \"LOCKDOWN\"` marker", () => {
    expect(phase65).toMatch(/mode\s*==\s*"LOCKDOWN"/);
  });

  it("LOCKDOWN inherits from PROD (BETA + binding-check) — additive, not replacement", () => {
    // Blind Hunter MED-5: same shape as PROD's MED-4 — require BOTH "run
    // PROD branch" AND a mandatory/additionally qualifier, not either-or.
    expect(lockdownSlice).toMatch(
      /run\s*PROD\s*branch[\s\S]*?(?:and\s*additionally|plus|mandatory)/i,
    );
  });

  it("LOCKDOWN treats focus-group as mandatory for non-trivial-scope epics", () => {
    expect(lockdownSlice).toMatch(/mandatory.*non-trivial|non-trivial.*mandatory/i);
  });

  it("documents the override knob: `devx.config.yaml → focus_group.binding: false`", () => {
    // Edge Case Hunter F5: accept dotted-path inline form OR YAML block
    // form so a future schema rewrite doesn't false-fail.
    expect(lockdownSlice).toMatch(
      /focus_group\.binding:\s*false|focus_group:\s*\n\s*binding:\s*false/,
    );
  });

  it("override usage requires a MANUAL.md audit entry recording the reason", () => {
    expect(lockdownSlice).toMatch(/MANUAL\.md/);
  });
});

// ---------------------------------------------------------------------------
// 6) Phase 8 final summary — renders the YOLO canonical literal verbatim
//    when the predicate evaluated to YOLO. Asserted against the item-8
//    sub-slice (Edge Case Hunter F6) so the literal can't drift to another
//    item silently.
// ---------------------------------------------------------------------------

describe("/devx-plan Phase 8 final summary — YOLO literal rendering (pln105 AC#2)", () => {
  it("Phase 8 item 8 references pln105 (LearnAgent anchor for the mode-gate decision)", () => {
    expect(phase8Item8).toMatch(/pln105/);
  });

  it("Phase 8 item 8 contains the canonical YOLO literal verbatim", () => {
    // The literal MUST be reproducible byte-for-byte from the skill body, or
    // the final summary will paraphrase and break downstream consumers (e.g.,
    // mobile app PR cards that grep for this exact line).
    expect(phase8Item8).toContain(YOLO_LITERAL);
  });

  it("Phase 8 item 8 instructs not to paraphrase the YOLO literal", () => {
    // Defense against future edits that might shorten the literal "for
    // brevity" — the literal is the contract.
    expect(phase8Item8).toMatch(/do not paraphrase|verbatim/i);
  });
});

// ---------------------------------------------------------------------------
// 7) LEARN.md cross-epic pattern anchor — pln105 closes a documented pattern.
// ---------------------------------------------------------------------------

describe("/devx-plan Phase 6.5 closes the LEARN.md mode-gate-ambiguity pattern (pln105)", () => {
  it("Phase 6.5 anchors pln105 by name (LearnAgent-readable closure marker)", () => {
    expect(phase65).toMatch(/pln105/);
  });

  it("Phase 6.5 names test/plan-mode-gate.test.ts as the contract-test anchor", () => {
    expect(phase65).toMatch(/test\/plan-mode-gate\.test\.ts/);
  });
});
