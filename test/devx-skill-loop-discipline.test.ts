// v2l101 discipline pins: the Stage: Loop section of /devx.
//
// Since the D-14 arm split the Loop and Outcome bodies are their own files;
// devx.md keeps each `## Stage:` heading as a pointer, and the content pins
// read the body the dispatcher points at.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(join(process.cwd(), ".claude", "commands", name), "utf8");
const dispatcher = read("devx.md");
const body = read("devx-loop.md");
const outcomeBody = read("devx-outcome.md");

describe("/devx loop discipline (v2l101)", () => {
  it("has the Stage: Loop section", () => {
    expect(body).toContain("## Stage: Loop (`/devx loop`");
  });

  it("the dispatcher's Stage: Loop heading points at the body", () => {
    expect(dispatcher).toContain("## Stage: Loop (`/devx loop`");
    expect(dispatcher).toContain("Body: `.claude/commands/devx-loop.md`.");
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
    expect(outcomeBody).toContain("## Stage: Outcome (`/devx outcome <hash>`");
    expect(outcomeBody).toContain("devx outcome arm <hash>");
    expect(outcomeBody).toMatch(/--verdict keep\|tune\|restart\|retire/);
  });

  it("the dispatcher's Stage: Outcome heading points at the body", () => {
    expect(dispatcher).toContain("## Stage: Outcome (`/devx outcome <hash>`");
    expect(dispatcher).toContain("Body: `.claude/commands/devx-outcome.md`.");
  });

  it("pins sources-not-vibes and the unattended-judgment rule", () => {
    expect(outcomeBody).toMatch(/never vibes/);
    expect(outcomeBody).toMatch(/file the\s+recommendation in INTERVIEW\.md instead of deciding silently/);
  });
});
