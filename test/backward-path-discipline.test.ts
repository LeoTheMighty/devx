// Backward-path discipline: /devx-revise and /devx-address (8am-harness
// gap-analysis rows A14 + A13).
//
// Two new skill bodies, and the dispatcher pointer that reaches them. Both
// bodies are programs — an agent executes the prose — so the invariants that
// make them safe are structural locks, exactly as dvx101 (push-before-PR),
// dvx106 (Phase 8 dispatch), roc101 (resume ownership) and mss104 (split
// routing) are. Prose with nothing pinning it drifts, and these two arms
// drift toward the failures they exist to prevent: patching around a gate
// instead of reopening it, and fixing comment 1 before reading comment 7.
//
// What is pinned, and why each one:
//
//   • The dispatcher reaches both bodies BY PATH. A stage word that routes
//     nowhere is what `revise` was before this work: listed in Routing 3,
//     with no body anywhere.
//   • Revise never writes gate state by hand. `devx revise` is the only
//     writer; a hand-set flag is the stale-flag failure the cascade exists
//     to prevent, and nothing at runtime would notice.
//   • Revise disposes every emitted-spec disposition the CLI can report,
//     and HALTS on a live claim. The disposition set is read from the real
//     exported constant, never re-typed here: a sixth disposition added to
//     the CLI must fail this test, not be silently unhandled by the skill.
//   • Address triages before acting, and its approval gate is unconditional.
//     `auto-safe` removes item-level re-confirmation, never the plan gate —
//     the one reading of `autonomy.action_mode` that would turn a preference
//     into a gate skip (docs/PERSONALIZATION.md §2: such a value is void).
//   • Address routes gated-artifact amendments to /devx-revise.
//   • The reply marker is wire protocol between runs. A reply does not
//     resolve a thread, so the marker is the only thing that stops the next
//     run re-answering every thread this one answered. Both halves — the
//     marker the skill emits and the instruction to read it back — are
//     pinned, in the canonical body and in the shipped mirror.
//
// Rows: A13 (address arm), A14 (revise arm), B14 (decision taxonomy),
//       C27 (when a PR comment becomes a decision record).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { EMITTED_DISPOSITIONS } from "../src/lib/engine/revise.js";

const REPO_ROOT = resolve(__dirname, "..");

const read = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), "utf8");

/** Whitespace-collapsed body, so a phrase assertion pins the WORDING and not
 *  where markdown happened to hard-wrap it. Same technique as
 *  `collapseWhitespace` in the nudge pin (rtl101 E-6): a reflow is editorial,
 *  a reworded rule is not. Blockquote markers go too — `> ` is formatting
 *  that lands mid-sentence on every wrapped line of a `>` block, which would
 *  otherwise make a rule unassertable purely for sitting in a callout. */
const flat = (rel: string): string =>
  read(rel)
    .split("\n")
    .map((l) => l.replace(/^\s*>\s?/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

const REVISE = ".claude/commands/devx-revise.md";
const ADDRESS = ".claude/commands/devx-address.md";
const DISPATCHER = ".claude/commands/devx.md";

/** The reply marker, read from the skill body that owns it rather than
 *  declared here. A copy in the test would agree with itself while the
 *  shipped marker drifted — the `nudge-canonical` lesson (rtl101 E-6). */
const MARKER_ANCHOR = "<!-- address-marker-canonical -->";

function markerFrom(rel: string): string {
  const body = read(rel);
  const after = body.split(MARKER_ANCHOR)[1] ?? "";
  const m = /`(<!--\s*[a-z-]+\s*-->)`/.exec(after);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// The dispatcher reaches both bodies
// ---------------------------------------------------------------------------

describe("dispatcher → the backward-path bodies", () => {
  const body = read(DISPATCHER);

  it("Routing 3 names both skill files by path", () => {
    expect(body).toContain(".claude/commands/devx-address.md");
    expect(body).toContain(".claude/commands/devx-revise.md");
  });

  it("keeps `revise` and `address` routable stage words", () => {
    expect(body).toMatch(
      /prd\|design\|plan\|red\|execute\|verify\|revise\|\s*address\|retro\|outcome\|loop/,
    );
  });

  it("tells the reader to load the named file rather than improvise", () => {
    // The whole point of moving the bodies out is that the summary is NOT
    // the contract. A dispatcher that leaves this implicit invites an agent
    // to act on the four-line précis.
    expect(body).toMatch(/Load the named file; follow it\./);
    expect(body).toMatch(/never improvise either from this summary/i);
  });

  it("no longer carries the old inline Address steps", () => {
    // The 5-step body moved to its own skill; a copy left behind is a
    // second, weaker contract that an agent may read first.
    expect(body).not.toMatch(/Triage each comment: \*\*in-scope\*\*/);
  });

  it("routes a re-scoping as-built departure to the skill, not the bare CLI", () => {
    expect(flat(DISPATCHER)).toContain(
      "re-scopes another phase or contradicts the design** is not bookkeeping — route it through `/devx-revise`",
    );
  });
});

// ---------------------------------------------------------------------------
// /devx-revise
// ---------------------------------------------------------------------------

describe("/devx-revise — the amend-record-reopen conversation", () => {
  const body = read(REVISE);

  it("asks what changed before anything else", () => {
    expect(body).toMatch(/## Step 1 — Ask what changed/);
    expect(body).toMatch(/what\*\* changed and \*\*why/);
  });

  it("names the lowest artifact, with every cascade-table subject present", () => {
    expect(body).toMatch(/## Step 2 — Name the lowest artifact/);
    for (const artifact of [
      "`prd/agent.md`",
      "`expectations.md`",
      "`design/agent.md`",
      "`plan/agent.md`",
    ]) {
      expect(body, `Step 2 must name ${artifact}`).toContain(artifact);
    }
    expect(body).toMatch(/lowest\*\* \(earliest\) artifact/);
  });

  it("amends in place, present tense, and reconciles the siblings", () => {
    expect(body).toMatch(/in place, present tense/i);
    expect(body).toMatch(/No "changed from"/);
    expect(body).toMatch(/Reconcile the siblings/);
  });

  it("writes a dated revision record from the shipped template", () => {
    expect(body).toContain("decisions/<YYYY-MM-DD>-revision-<slug>.md");
    expect(body).toContain("_devx/templates/engine/decision.md");
    // A locked-expectation move is the one case that needs a differently
    // named record, and writing two is the other failure.
    expect(body).toContain("<date>-expectation-change-<slug>.md");
  });

  it("runs the CLI verbatim and never hand-edits gate state", () => {
    expect(body).toContain("devx revise <hash> --touched <artifact>");
    expect(flat(REVISE)).toContain(
      "Do not hand-edit `gate_status`, `gate_verdicts`, or `stage`",
    );
    expect(flat(REVISE)).toContain(
      "Hand-editing `gate_status`, `gate_verdicts`, `stage`, or any eval stamp",
    );
  });

  it("handles every disposition the CLI can report", () => {
    // Read from the real export: a disposition added to revise.ts with no
    // row here would otherwise leave the skill silently unprepared for a
    // spec it is told about.
    for (const d of EMITTED_DISPOSITIONS) {
      expect(body, `Step 6 has no row for \`${d}\``).toContain(`| \`${d}\` |`);
    }
  });

  it("HALTS on a live claim instead of resetting a peer's spec", () => {
    // CLAUDE.md §"Verify claim ownership before resuming" — the 2026-05-07
    // dvxret collision. This is the one row that must never become an edit.
    expect(body).toContain(".devx-cache/locks/spec-<hash>.lock");
    expect(body).toMatch(/if the session token is not yours, do not touch the spec/);
    expect(body).toMatch(/A peer mid-phase is not yours to reset/);
  });

  it("reconciles todo.md and prints the replay path", () => {
    expect(body).toContain("devx todo sync <hash>");
    expect(body).toMatch(/Print the replay path, leading with the next command/);
  });

  it("says the eval stamp is re-stamped by the replay's gate, never by hand", () => {
    expect(body).toContain("devx gate evals <hash> --verify");
    expect(body).toMatch(/the stamp is never cleared by hand/);
  });

  it("refuses to reset deeper than the change demands, and never un-retires", () => {
    expect(body).toMatch(/Resetting deeper than the change demands/);
    expect(body).toMatch(/Never un-retire by hand/);
  });

  it("never writes an outline, in any layout", () => {
    expect(body).toMatch(/It is human-only in every layout/);
    expect(body).toMatch(/\*\*Writing an `outline\.md`\*\*, in any layout/);
  });

  it("claims no external-tracker surface (D-10)", () => {
    expect(body).not.toMatch(/jira|confluence|atlassian/i);
    expect(body).toMatch(/devx has no external-tracker surface \(D-10\)/);
  });
});

// ---------------------------------------------------------------------------
// /devx-address
// ---------------------------------------------------------------------------

describe("/devx-address — triage first, act on approval", () => {
  const body = read(ADDRESS);

  it("declares Phases 1–4 read-only and acts on nothing first", () => {
    expect(body).toMatch(/triage and research everything; act on nothing until/i);
    expect(body).toMatch(/read-only by contract/);
    expect(body).toMatch(/No edit, no reply, no thread resolution on first contact/);
  });

  it("triages EVERY comment before proposing anything", () => {
    expect(body).toMatch(/## Phase 2 — Triage every comment/);
    expect(body).toMatch(/Classify \*\*all\*\* of them before proposing or doing anything/);
    // The named failure mode, kept in the body so the rule has a reason.
    expect(flat(ADDRESS)).toContain("answers comment 1 before reading comment 7");
  });

  it("carries all six triage buckets", () => {
    for (const bucket of [
      "Formatting / clarity",
      "Substantial",
      "Out of scope",
      "Declined",
      "Unclear",
      "Already addressed",
    ]) {
      expect(body, `missing triage bucket: ${bucket}`).toContain(`**${bucket}**`);
    }
  });

  it("researches the substantial ones against code, with receipts", () => {
    expect(body).toMatch(/## Phase 3 — Research the substantial ones/);
    expect(body).toMatch(/ground the answer in the repo/);
    expect(body).toMatch(/grep-verified, cited `file:line`/);
    expect(body).toMatch(/a finding with no receipt is dropped/);
  });

  it("presents ONE batched plan and gates on its approval", () => {
    expect(body).toMatch(/## Phase 4 — Present one batched plan \(the approval gate\)/);
    expect(body).toContain("EnterPlanMode");
    expect(body).toContain("ExitPlanMode");
    expect(flat(ADDRESS)).toContain("Nothing has been touched at this point");
  });

  it("makes autonomy.action_mode govern the batch, and only the batch", () => {
    // The row's whole point: the key now changes real behavior, and the
    // thing it cannot change is spelled out. A preference that skipped the
    // plan gate would be void at runtime (docs/PERSONALIZATION.md §2).
    expect(body).toContain("`autonomy.action_mode`");
    expect(body).toContain("| `propose-only` (default) |");
    expect(body).toContain("| `auto-safe` |");
    expect(body).toMatch(/removing \*?\*?item-level\*?\*? re-confirmation/);
    expect(body).toMatch(/Rails no value can loosen/);
    expect(body).toMatch(/neither mode ever acts before the Phase 4 approval returns/i);
    expect(body).toMatch(/never buys a gate/);
  });

  it("names the three rails no action_mode can loosen", () => {
    expect(body).toMatch(/post-gate artifact/);
    expect(body).toMatch(/locked expectation/);
    expect(body).toMatch(/\*\*Deleting or overwriting\*\*/);
  });

  it("routes a gated-artifact amendment through /devx-revise", () => {
    expect(body).toMatch(/Route a gated-artifact amendment through `\/devx-revise`/);
    expect(flat(ADDRESS)).toContain("do not patch around the gate it should reopen");
    expect(body).toContain("/devx-revise <hash>");
  });

  it("promotes a comment to a decision record on the four stated triggers only", () => {
    // C27: the one judgment call that was nowhere written down.
    expect(body).toContain("decisions/<date>-pr-resolution-<slug>.md");
    expect(flat(ADDRESS)).toContain("moves a locked expectation, sets a precedent");
    expect(flat(ADDRESS)).toContain("**Never for a nit**");
  });

  it("never resolves silently and never merges", () => {
    expect(flat(ADDRESS)).toContain("Never resolve a thread you did not reply to");
    expect(body).toMatch(/\*\*Merging\.\*\* This skill addresses review feedback/);
    expect(body).toMatch(/devx devx-helper check-hold <pr>/);
    expect(body).toMatch(/never lifts a hold itself/);
  });

  it("reads outdated anchors from the diff hunk rather than dropping them", () => {
    expect(body).toMatch(/`position: null` means \*outdated\*, not resolved/);
    expect(flat(ADDRESS)).toContain("research it from the comment body plus its `diff_hunk`");
  });
});

// ---------------------------------------------------------------------------
// The reply marker — wire protocol between runs
// ---------------------------------------------------------------------------

describe("/devx-address reply marker (cross-run recognition)", () => {
  it("the canonical body defines a marker at its anchor", () => {
    const marker = markerFrom(ADDRESS);
    expect(marker, `no marker found after ${MARKER_ANCHOR}`).not.toBe("");
    expect(marker).toMatch(/^<!--\s*devx-address\s*-->$/);
  });

  it("the shipped mirror defines the SAME marker", () => {
    // The mirror is what the npm package installs. A desynced marker makes
    // consumer repos emit a sentinel their own next run cannot detect.
    expect(markerFrom("skills/devx-address.md")).toBe(markerFrom(ADDRESS));
  });

  it("both halves of the protocol are present: emit, and read back", () => {
    const body = read(ADDRESS);
    const marker = markerFrom(ADDRESS);
    // Emit side (Phase 5 reply) and detect side (Phase 1 triage) both name
    // it. One without the other is a marker nobody acts on.
    expect(flat(ADDRESS)).toContain(
      "end every reply with `<!-- devx-address -->` on its own line",
    );
    expect(body).toMatch(/triage it \*\*already addressed\*\*/);
    // Two sites, and both must be real: the Phase-1 definition that the
    // detect instruction sits on, and the Phase-5 emit instruction.
    expect(body.split(marker).length - 1).toBeGreaterThanOrEqual(2);
    expect(body.indexOf(marker)).toBeLessThan(body.indexOf("## Phase 5"));
    expect(body.lastIndexOf(marker)).toBeGreaterThan(body.indexOf("## Phase 5"));
  });

  it("says why the marker is load-bearing, not merely tidy", () => {
    expect(flat(ADDRESS)).toContain("because a reply does not resolve a thread");
  });
});

// ---------------------------------------------------------------------------
// The decision template's taxonomy (B14 + C27)
// ---------------------------------------------------------------------------

describe("decision template — record-type taxonomy", () => {
  const body = read("_devx/templates/engine/decision.md");

  it("lists every record type the engine writes", () => {
    for (const type of [
      "<mode>-verify",
      "prd-critique",
      "revision",
      "expectation-change",
      "pr-resolution",
      "design-question",
      "spike",
      "arch-review",
    ]) {
      expect(body, `taxonomy missing \`${type}\``).toContain(type);
    }
  });

  it("keys the type on the FILENAME, with no competing frontmatter field", () => {
    // A `type:` key beside a filename convention is two sources of truth for
    // one fact, and nothing reads the key today — the gate renderers write
    // their own frontmatter (verdict.ts), so a templated field would ship
    // absent from every report the gates produce.
    expect(body).toMatch(/FILENAME carries the record's type/);
    expect(flat("_devx/templates/engine/decision.md")).toContain(
      "there is no `type:` field to drift from it",
    );
    expect(body).not.toMatch(/^type:/m);
  });

  it("carries the promotion rule for a PR comment (C27)", () => {
    const t = flat("_devx/templates/engine/decision.md");
    expect(t).toContain("earns a pr-resolution record when it moves a locked");
    expect(t).toContain("Never for a nit");
  });

  it("still opens with the deterministic verdict block (D-9)", () => {
    // engine-templates.test.ts asserts this across all verdict-bearing
    // templates; repeated here because this PR rewrote the file.
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toMatch(/gate: <PASS \| CONCERNS \| FAIL/);
    expect(body).toContain("status_reason:");
    expect(body).toContain("reviewer:");
  });

  it("names the two new skills as reviewers of record", () => {
    expect(body).toContain("/devx-revise");
    expect(body).toContain("/devx-address");
  });
});
