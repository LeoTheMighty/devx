// Unit tests for the shared nullish-scalar rule (debug-7b3e2a) plus the audit
// evidence AC 5 asks for: the readers that used to disagree with YAML about
// `null` now all route through one predicate, and the reader that never had
// the bug (readEngineState, which parses with eemeli/yaml) is pinned so a
// future "let's hand-roll this for speed" rewrite trips a test.
//
// Spec: debug/debug-7b3e2a-2026-08-07T12:40-merge-gate-reads-yaml-null-branch-as-string.md

import { describe, expect, it } from "vitest";

import { NULLISH_SCALARS, isNullishScalar } from "../src/lib/frontmatter-scalar.js";
import { readEngineState } from "../src/lib/engine/frontmatter.js";

describe("isNullishScalar", () => {
  it("accepts every YAML null spelling", () => {
    for (const spelling of ["null", "Null", "NULL", "~", ""]) {
      expect(isNullishScalar(spelling)).toBe(true);
    }
  });

  it("trims before testing, so a padded value still reads as null", () => {
    expect(isNullishScalar("  null  ")).toBe(true);
    expect(isNullishScalar("   ")).toBe(true);
  });

  it("rejects quoted forms — YAML says a quoted scalar is a string", () => {
    expect(isNullishScalar('"null"')).toBe(false);
    expect(isNullishScalar("'null'")).toBe(false);
    expect(isNullishScalar("'~'")).toBe(false);
  });

  it("rejects real values that merely contain a null spelling", () => {
    for (const v of ["nullable", "feat/dev-null", "NULLIFY", "~/tmp"]) {
      expect(isNullishScalar(v)).toBe(false);
    }
  });

  it("does not accept YAML 1.1-only spellings devx never emits", () => {
    // `n`/`no`/`off` are YAML 1.1 booleans, not nulls; treating them as null
    // would silently eat a branch legitimately named `no`.
    for (const v of ["n", "no", "off", "none", "nil"]) {
      expect(NULLISH_SCALARS.has(v)).toBe(false);
    }
  });
});

describe("readEngineState — the YAML-backed reader was never affected", () => {
  it("reads `status: null` as null, not the string 'null'", () => {
    const state = readEngineState(
      ["---", "hash: aa0005", "type: dev", "status: null", "---", "", "body", ""].join("\n"),
    );
    expect(state.status).toBeNull();
    expect(state.status).not.toBe("null");
  });

  it("reads `status: ~` as null", () => {
    const state = readEngineState(
      ["---", "hash: aa0006", "status: ~", "---", "", "body", ""].join("\n"),
    );
    expect(state.status).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// debug-1dfbdd AC 4 — the set must NOT grow
// ---------------------------------------------------------------------------

describe("NULLISH_SCALARS is YAML's null rule, not a sentinel registry (debug-1dfbdd)", () => {
  // READ THIS BEFORE "FIXING" A SENTINEL BUG BY EDITING THE SET BELOW.
  //
  // debug-1dfbdd: palateful's `lgort1` carried `branch: unassigned`, and
  // merge-gate queried `gh pr list --head unassigned`, got [], and reported
  // "no PR yet" with a green PR open. The tempting one-line fix is to add
  // "unassigned" here. It is the WRONG FIX, twice over:
  //
  //   1. It is factually wrong about YAML. `unassigned` is an ordinary
  //      string; this set is the 1.2 core schema's null spellings plus the
  //      empty value, and nothing else belongs in it. Adding to it makes
  //      devx disagree with every real YAML parser, including the one
  //      engine/frontmatter.ts already uses.
  //   2. It does not even solve the problem. The next authoring path emits
  //      `tbd`, or `TODO`, or `none`, and the gate breaks again — devx
  //      cannot enumerate sentinels it has never been told about.
  //
  // The fix is in the READER: validate that a branch value names a branch
  // that EXISTS, rather than asking whether it is null. See
  // merge-gate.ts explainEmptyPrList.
  const NOT_NULL_IN_YAML = [
    "unassigned",
    "tbd",
    "TODO",
    "none",
    "None",
    "nil",
    "undefined",
    "-",
    "n/a",
  ];

  for (const v of NOT_NULL_IN_YAML) {
    it(`treats ${JSON.stringify(v)} as a STRING, not a null`, () => {
      expect(isNullishScalar(v)).toBe(false);
      expect(NULLISH_SCALARS.has(v)).toBe(false);
    });
  }

  it("contains exactly YAML's five null spellings and nothing more", () => {
    expect([...NULLISH_SCALARS].sort()).toEqual(
      ["", "NULL", "Null", "null", "~"].sort(),
    );
    expect(NULLISH_SCALARS.size).toBe(5);
  });
});
