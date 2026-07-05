// v2d101 discipline pins: the /devx dispatcher routing section + debug
// stage. The 12-row table itself lives in the CLI (devx next) — the skill
// body must RENDER its output, never re-enumerate the rows (the dvx106
// lesson: prose tables are the regression vector).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const body = readFileSync(
  join(process.cwd(), ".claude", "commands", "devx.md"),
  "utf8",
);

describe("/devx dispatcher discipline (v2d101)", () => {
  it("routes no-args through devx next (CLI is the single source of truth)", () => {
    expect(body).toMatch(/run `devx next`/);
    expect(body).toMatch(/CLI is the single source of truth/);
  });

  it("does not re-enumerate the decision table rows in prose", () => {
    // The skill may NAME the table ("12-row") but must not carry per-row
    // conditions — spot-check two row conditions that must only live in
    // the CLI.
    expect(body).not.toMatch(/heartbeat fresh.*→/);
    expect(body).not.toMatch(/CI red.*→.*fix-forward on that branch/);
  });

  it("pins the morning-review reconstruct-from-disk rule", () => {
    expect(body).toMatch(/never summarize an overnight run from memory/);
    expect(body).toMatch(/claims as claims/);
  });

  it("pins intent classification with the say-it-out-loud rule", () => {
    expect(body).toMatch(/say your routing call out loud/);
    expect(body).toMatch(/Bug-shaped/);
    expect(body).toMatch(/entered_at: execute/);
  });

  it("pins the debug stage's repro-first discipline", () => {
    expect(body).toMatch(/## Stage: Debug \(repro-first\)/);
    expect(body).toMatch(/Reproduce before touching code/);
    expect(body).toMatch(/No repro → no fix/);
  });

  it("pins drift-is-reported-never-silently-fixed", () => {
    expect(body).toMatch(/surfaced to\s+the user as a defect, never silently fixed/);
  });

  it("keeps every stage word routable", () => {
    expect(body).toMatch(
      /prd\|design\|plan\|red\|execute\|verify\|revise\|\s*address\|retro\|outcome\|review\|loop/,
    );
  });
});
