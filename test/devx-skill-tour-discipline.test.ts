// v2t101 discipline pins (dvx103/dvx107 pattern): Phase 7.5 (review tour),
// the D-5 hold check in the Phase 8 merge tail, and the Address stage.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const body = readFileSync(
  join(process.cwd(), ".claude", "commands", "devx.md"),
  "utf8",
);

describe("/devx tour + address discipline (v2t101)", () => {
  it("Phase 7.5 exists between PR-open and the merge tail", () => {
    const p75 = body.indexOf("### Phase 7.5: Review Tour");
    const p8 = body.indexOf("### Phase 8:");
    expect(p75).toBeGreaterThan(-1);
    expect(p8).toBeGreaterThan(p75);
  });

  it.each([
    ["gather", "devx tour gather <hash>"],
    ["build", "devx tour build <hash> --tour-json <path>"],
    ["publish", "devx tour publish <hash>"],
    ["pr-body flags", "--tour-url <url> --tour-orientation <path>"],
    ["hold check", "check-hold <pr-number>"],
  ])("delegates tour %s to the CLI verbatim", (_label, invocation) => {
    expect(body).toContain(invocation);
  });

  it("pins the fail-soft rule: a broken tour never blocks the PR", () => {
    expect(body).toMatch(/any tour step failing must NOT block the PR/);
  });

  it("pins the no-severities rule (the tour presents and points)", () => {
    expect(body).toMatch(/no\s+severity verdicts/);
  });

  it("pins grep-verified trails", () => {
    expect(body).toMatch(
      /grep-verified at the call site or flagged 🕳 — never\s+narrated from plausibility/,
    );
  });

  it("pins D-5 semantics: hold blocks, silence merges", () => {
    expect(body).toMatch(/Exit 0 → silence merges/);
    expect(body).toMatch(/do NOT merge/);
  });

  it("Address stage: every comment gets a response, never silent resolution", () => {
    const addr = body.indexOf("## Stage: Address");
    expect(addr).toBeGreaterThan(-1);
    expect(body).toMatch(/a reply, a commit, or a filed spec — never silent resolution/);
    expect(body).toMatch(/address: <n> comments — <f> fixed, <s> filed,\s+<q> answered/);
  });
});
