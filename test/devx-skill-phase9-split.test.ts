// Phase 9 early-halt → `devx split` discipline (mss104).
//
// Successor to devx-handoff-snippet.test.ts (dvx107), which pinned the
// conversation-prose Handoff Snippet template. mss104 retires that contract:
// the remainder of a halted item now becomes a first-class follow-up spec via
// `devx split`, claimable cold by any fresh session. This test is the lock
// that keeps Phase 9 routing there.
//
// Pins:
//   • Phase 9 still dispatches every stop_after state (inherited from dvx107 —
//     the halt-early bullet lives in the same list, and a rewrite that drops
//     its neighbours is the same regression).
//   • The `devx split <hash> --payload <file> --session-token <token>`
//     invocation string appears VERBATIM (roc101 pattern — the skill body is
//     the program; a paraphrased invocation is a broken invocation).
//   • Both shape routing sentences are present: merge-first (coherent+green →
//     land through Phases 5–8 first) and branch-handoff (push WIP branch,
//     split, release the spec lock). Losing either half turns a two-shape
//     decision into a coin flip.
//   • Zero `Handoff Snippet` / `parseHandoffSnippet` tokens anywhere in the
//     skill body — the grep-zero invariant E-2 asserts repo-wide, asserted
//     here on the one file that matters most. This file is E-2's single
//     in-scope exemption: the detector cannot be a violation of the thing it
//     detects.
//
// Why a discipline test on a markdown file: same reason as dvx101
// (push-before-PR), mrg102 (merge-gate), prt102 (pr-body), dvx105
// (await-remote-ci), dvx106 (Phase 8 dispatch) and roc101 (resume ownership) —
// without a structural lock the prose drifts, and a drifted Phase 9 silently
// strands mid-story work in a dead conversation.
//
// Spec: dev/dev-mss104-2026-07-28T13:43-handoff-snippet-retirement.md
// Workstream: _devx/workstreams/mid-story-split/ (plan phase 4)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..");
const SKILL_PATH = resolve(REPO_ROOT, ".claude/commands/devx.md");
const MIRROR_PATH = resolve(REPO_ROOT, "skills/devx.md");

function loadSkill(): string {
  return readFileSync(SKILL_PATH, "utf8");
}

/**
 * Extract `### Phase 9: …` body up to the next heading at any level
 * (`### ` or `## `) or EOF. Phase 9 is the LAST `### ` heading in the skill
 * body — bounding only on `^### ` would let the slice spill through
 * Finalization, Key References, etc. and silently weaken the phase-9
 * assertions (a `halt early ... devx split` regex match could straddle two
 * unrelated sections). Moved verbatim from devx-handoff-snippet.test.ts
 * (dvx107); the `^(### |## )` bound is load-bearing.
 */
function phase9Body(skill: string): string {
  const start = skill.match(/^### Phase 9:[^\n]*\n/m);
  if (!start) throw new Error("Phase 9 heading not found in skill body");
  const offset = (start.index ?? 0) + start[0].length;
  const rest = skill.slice(offset);
  const next = rest.match(/^(### |## )/m);
  return next ? rest.slice(0, next.index) : rest;
}

describe("devx skill — Phase 9 dispatches every stop_after state (mss104, inherited dvx107 AC #1)", () => {
  it("Phase 9 enumerates this-item, n-items, until-blocked, and all", () => {
    const body = phase9Body(loadSkill());
    expect(body).toMatch(/stop_after == this-item/);
    expect(body).toMatch(/stop_after == n-items/);
    expect(body).toMatch(/stop_after == until-blocked/);
    expect(body).toMatch(/stop_after == all/);
  });

  it("Phase 9 bridges early halts to the split primitive", () => {
    const body = phase9Body(loadSkill());
    // The early-stop bullet is what bridges the loop to the follow-up spec —
    // if a future maintainer drops it, agents halt with the remainder living
    // only in a conversation that is about to be cleared.
    expect(body).toMatch(/halt early[\s\S]*devx split/);
  });
});

describe("devx skill — Phase 9 pins the `devx split` invocation (mss104 AC #1)", () => {
  it("carries the split invocation string verbatim", () => {
    const body = phase9Body(loadSkill());
    // Verbatim, not paraphrased (roc101 pattern). Flag names and their order
    // are the contract the CLI parses; `--session-token` in particular is
    // never auto-derived for split, so an agent that guesses at it fails.
    expect(body).toContain(
      "devx split <hash> --payload <file> --session-token <token>",
    );
  });

  it("names both split shapes with their routing conditions", () => {
    const body = phase9Body(loadSkill());
    // merge-first: the done portion is coherent + green → land it first.
    expect(body).toMatch(
      /merge-first if your work is coherent\+green — land it through Phases\s+5–8 first/,
    );
    // branch-handoff: mid-stream → push the WIP branch, split, release lock.
    expect(body).toMatch(
      /branch-handoff otherwise — push the WIP branch, split, then\s+release the spec lock/,
    );
  });

  it("keeps the halt-early bullet a single instruction ending in stop", () => {
    const body = phase9Body(loadSkill());
    // dvx107's tail ("say one sentence summarizing why you stopped and stop")
    // survives the retirement — the failure mode it forecloses (agent splits,
    // then keeps working in a spent context) is unchanged by the rehome.
    expect(body).toMatch(/say one sentence on why you stopped, and stop\./);
  });
});

describe("devx skill — Handoff Snippet contract is retired (mss104 AC #1, E-2)", () => {
  const TOKEN_RE = /Handoff Snippet|parseHandoffSnippet/;

  it("the canonical skill body carries zero Handoff Snippet tokens", () => {
    expect(loadSkill()).not.toMatch(TOKEN_RE);
  });

  it("the packaged mirror carries zero Handoff Snippet tokens", () => {
    // skills/devx.md is byte-identical to the canonical file
    // (test/skills-sync.test.ts) — asserted independently so a mirror that
    // drifts back to the retired contract fails here too, naming the file.
    expect(readFileSync(MIRROR_PATH, "utf8")).not.toMatch(TOKEN_RE);
  });

  it("the Phase 1 token-source clause no longer offers a snippet as a source", () => {
    const skill = loadSkill();
    // devx.md's verify-claim clause used to allow "the claim performed
    // earlier in this same session, or a Handoff Snippet that carries it".
    // The snippet half is gone; the claim half must remain — an agent with no
    // token source at all would start copying from the lock file, which is
    // the exact E13 incident shape.
    expect(skill).toContain("the claim performed earlier in this same session.");
    expect(skill).not.toMatch(/or a .*Snippet that carries it/);
  });
});
