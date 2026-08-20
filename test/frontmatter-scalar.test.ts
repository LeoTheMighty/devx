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
