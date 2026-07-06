// v2l101 discipline pins: the Stage: Loop section of /devx.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const body = readFileSync(
  join(process.cwd(), ".claude", "commands", "devx.md"),
  "utf8",
);

describe("/devx loop discipline (v2l101)", () => {
  it("has the Stage: Loop section", () => {
    expect(body).toContain("## Stage: Loop (`/devx loop`");
  });

  it("pins D-6: trust is transactional git + ladder + gate, not permission bypass; LOCKDOWN refuses", () => {
    expect(body).toMatch(/NOT permission bypass \(D-6; LOCKDOWN refuses the loop\s+entirely\)/);
  });

  it("pins D-11: loop completion is not acceptance", () => {
    expect(body).toMatch(/\*\*Loop completion is not acceptance \(D-11\)\.\*\*/);
    expect(body).toMatch(/nothing reaches main any\s+other way/);
  });

  it("pins the CLI-owns-the-loop split (skill starts it, doesn't re-implement it)", () => {
    expect(body).toMatch(/The skill's job is to start it, not to be it/);
  });

  it("pins the worker-side iteration contract essentials", () => {
    expect(body).toMatch(/never commit, never edit the status\s+log \(the loop\s+owns both\)/);
    expect(body).toMatch(/report failure instead of pivoting forever/);
  });

  it("pins the morning-review handoff to the dispatcher", () => {
    expect(body).toMatch(/read the report's\s+claims as claims/);
  });
});

describe("/devx outcome discipline (v2o101)", () => {
  it("has the Stage: Outcome section with CLI delegation", () => {
    expect(body).toContain("## Stage: Outcome (`/devx outcome <hash>`");
    expect(body).toContain("devx outcome arm <hash>");
    expect(body).toMatch(/--verdict keep\|tune\|restart\|retire/);
  });

  it("pins sources-not-vibes and the unattended-judgment rule", () => {
    expect(body).toMatch(/never vibes/);
    expect(body).toMatch(/file the\s+recommendation in INTERVIEW\.md instead of deciding silently/);
  });
});
