// Guard: ONE null rule, ONE implementation (debug-1dfbdd AC 5).
//
// debug-7b3e2a fixed merge-gate's hand-rolled nullish test and created
// frontmatter-scalar.ts so every regex reader could share the rule. That fix
// was never fully applied. Seven weeks later, with 7b3e2a closed and reading
// as done, two readers still carried their own narrower copies:
//
//   split.ts:907    `v === "" || v === "null"`        — missed Null, NULL, ~
//   detect.ts:714   `"" | "null" | "~"`               — missed Null, NULL
//
// Both were live defects, not style drift: `branch: NULL` became the branch
// NAME "NULL", and in doctor's case that reached `git branch -D NULL`.
//
// A partially-applied fix that reads as done is worse than an open bug —
// nobody goes looking. This test is what makes the next copy fail loudly at
// the moment it is written, instead of in seven weeks in someone else's
// investigation.
//
// If this test fails: do not add another spelling. Import isNullishScalar.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Comparisons against a YAML null spelling, e.g. `x === "null"`. The shared
 *  rule is a function call, so any literal comparison is a hand-rolled copy.
 *
 *  Deliberately does NOT match a bare `"~"` on its own. In this tree `~` is
 *  far more often a home-directory prefix (`if (p === "~") return homedir()`,
 *  learn/config.ts and learn/route.ts) than a YAML null, and a guard that
 *  cries wolf on path handling is a guard people delete. Every real offender
 *  so far compares against "null", so that is the discriminating token; a
 *  hand-rolled rule that somehow tested ONLY `~` would be missed, and that
 *  is an acceptable trade for a guard that stays credible. */
const HAND_ROLLED = /[=!]==\s*["'](?:null|Null|NULL)["']/g;

describe("YAML's null rule has exactly one implementation (debug-1dfbdd)", () => {
  it("no source file compares a scalar against a null spelling by hand", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // The rule itself is allowed to name its own members.
      if (file.endsWith(join("lib", "frontmatter-scalar.ts"))) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        HAND_ROLLED.lastIndex = 0;
        if (HAND_ROLLED.test(line)) {
          offenders.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `Hand-rolled YAML-null comparison(s) found. Import isNullishScalar from ` +
        `src/lib/frontmatter-scalar.ts instead — a local copy WILL be narrower ` +
        `than YAML's rule, which is exactly how debug-7b3e2a stayed live in two ` +
        `readers for seven weeks after it was closed:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the guard actually matches the shapes it is meant to catch", () => {
    // A guard that cannot fail is worse than no guard — it reports clean
    // forever and nobody checks. Pin the regex against the two real
    // offenders' exact text, verbatim from git history.
    const realOffenders = [
      'return v === "" || v === "null" ? null : v;',
      'if (raw !== undefined && raw !== "" && raw !== "null" && raw !== "~") {',
    ];
    for (const line of realOffenders) {
      HAND_ROLLED.lastIndex = 0;
      expect(HAND_ROLLED.test(line)).toBe(true);
    }
    // And does not fire on the legitimate shared-rule call site.
    HAND_ROLLED.lastIndex = 0;
    expect(HAND_ROLLED.test("if (isNullishScalar(v)) return null;")).toBe(false);
    // Nor on `~` as a home-directory prefix, which is what it means in
    // learn/config.ts and learn/route.ts.
    HAND_ROLLED.lastIndex = 0;
    expect(HAND_ROLLED.test('if (p === "~") return homedir();')).toBe(false);
  });
});
