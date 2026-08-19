// Iteration contract pins (v2l101 — src/lib/loop/iteration.ts).
//
// The prompt-pin block below is LOAD-BEARING: these sentences are what keep
// unattended iterations honest (v2/04 §2.2). Changing the prompt requires
// changing these pins in the same PR — that's the point.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildCommitRepairPrompt,
  buildIterationPrompt,
  buildReportRetryPrompt,
  extractReportJson,
  hasFinalReport,
  validateIterationReport,
} from "../src/lib/loop/iteration.js";
import { runLoop } from "../src/lib/loop/driver.js";
import { readEvents } from "../src/lib/loop/state.js";
import {
  MERGED,
  makeFixture,
  mergedTail,
  scriptedWorker,
  type Fixture,
} from "./helpers/loop-git-fixture.js";

const params = {
  hash: "abc123",
  specRelPath: "dev/dev-abc123-2026-07-05T13:06-thing.md",
  iteration: 3,
  maxIterations: 8,
};

describe("buildIterationPrompt — load-bearing sentence pins (§2.2)", () => {
  const prompt = buildIterationPrompt(params);

  it("identifies the iteration + spec", () => {
    expect(prompt).toContain("This is iteration 3 of at most 8 on spec `abc123`");
  });

  it("sends the worker to the Status log first", () => {
    expect(prompt).toContain("read the spec's Status log first");
    expect(prompt).toContain(params.specRelPath);
  });

  it("pins smallest-verifiable-slice", () => {
    expect(prompt).toContain(
      "Pick the next smallest logical unit of work that is individually verifiable. Do not attempt the whole spec.",
    );
  });

  it("pins report-don't-pivot", () => {
    expect(prompt).toContain(
      "record learnings and report failure rather than continuously pivoting",
    );
  });

  it("pins run-gates-before-claiming-success", () => {
    expect(prompt).toContain("Run the relevant build/tests/linters before reporting success");
  });

  it("pins verification-is-a-valid-slice (cf65aa — no iteration ends with verification outstanding)", () => {
    expect(prompt).toContain(
      "that verification IS this iteration's unit of work: run it to completion inside this iteration and set acs_met from the result",
    );
    expect(prompt).toContain("Never end an iteration with verification outstanding");
  });

  it("pins no-commits / no-status-log-edits (the loop owns both)", () => {
    expect(prompt).toContain("Do NOT commit; do NOT edit the Status log — the loop owns both.");
  });

  it("pins stop-background-processes", () => {
    expect(prompt).toContain("Stop any background processes you started");
  });

  it("pins the no-op rule and the acs_met claim semantics", () => {
    expect(prompt).toMatch(/no-op iteration.*is not a success/s);
    expect(prompt).toMatch(/acs_met: set to true ONLY when every acceptance criterion/);
    expect(prompt).toMatch(/it is a claim, not acceptance/);
  });

  it("asks for a single fenced json block with the five schema fields", () => {
    expect(prompt).toContain("```json");
    for (const field of ["success", "summary", "key_changes_made", "key_learnings", "acs_met"]) {
      expect(prompt).toContain(`- ${field}:`);
    }
  });

  it("includes prior attempts when given (newest last, [FAIL]-tagged)", () => {
    const withPrior = buildIterationPrompt({
      ...params,
      priorAttempts: [
        { iteration: 1, success: true, summary: "did a thing" },
        { iteration: 2, success: false, summary: "broke a thing" },
      ],
    });
    expect(withPrior).toContain("## Prior attempts this run");
    expect(withPrior).toContain("- iteration 1: ok — did a thing");
    expect(withPrior).toContain("- iteration 2: [FAIL] — broke a thing");
    expect(prompt).not.toContain("## Prior attempts this run");
  });
});

describe("buildCommitRepairPrompt", () => {
  it("appends a repair-only section carrying the git output", () => {
    const base = buildIterationPrompt(params);
    const repair = buildCommitRepairPrompt(base, "hook rejected: trailing whitespace");
    expect(repair.startsWith(base)).toBe(true);
    expect(repair).toContain("REPAIR-ONLY ITERATION");
    expect(repair).toContain("Do not start unrelated work.");
    expect(repair).toContain("fix the existing uncommitted changes so the commit can pass");
    expect(repair).toContain("hook rejected: trailing whitespace");
  });
});

describe("buildReportRetryPrompt", () => {
  it("forbids new work and carries the typed errors + output tail", () => {
    const retry = buildReportRetryPrompt("prose prose prose", [
      { code: "missing-field", field: "acs_met", message: "acs_met is required" },
    ]);
    expect(retry).toContain("Do NOT do any new work");
    expect(retry).toContain("acs_met is required (missing-field)");
    expect(retry).toContain("prose prose prose");
  });

  it("bounds the carried output to a tail", () => {
    const retry = buildReportRetryPrompt("x".repeat(10_000), [
      { code: "no-json-found", message: "no JSON object found" },
    ]);
    // Tail cap is 4000 chars; the rest is the shared schema block +
    // boilerplate. Bound raised 6000 → 6500 when the review field joined
    // OUTPUT_FIELD_LINES (debug-3b9e07) — the pin is that a 10k output
    // never rides wholesale, not the exact overhead size.
    expect(retry.length).toBeLessThan(6_500);
  });
});

// ---------------------------------------------------------------------------
// Report schema validation
// ---------------------------------------------------------------------------

const VALID = {
  success: true,
  summary: "did the thing",
  key_changes_made: ["added x"],
  key_learnings: [],
  acs_met: false,
};

describe("validateIterationReport", () => {
  it("accepts the canonical shape", () => {
    const r = validateIterationReport(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.summary).toBe("did the thing");
  });

  it("ignores extra keys (models decorate; retries are expensive)", () => {
    const r = validateIterationReport({ ...VALID, vibe: "immaculate" });
    expect(r.ok).toBe(true);
  });

  it("rejects non-objects with not-an-object", () => {
    for (const v of [null, 42, "x", [VALID]]) {
      const r = validateIterationReport(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0].code).toBe("not-an-object");
    }
  });

  it("reports every missing field with a typed error", () => {
    const r = validateIterationReport({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(5);
      expect(new Set(r.errors.map((e) => e.code))).toEqual(new Set(["missing-field"]));
      expect(new Set(r.errors.map((e) => e.field))).toEqual(
        new Set(["success", "summary", "key_changes_made", "key_learnings", "acs_met"]),
      );
    }
  });

  it("rejects wrong types without coercion", () => {
    const cases: Array<[string, unknown]> = [
      ["success", "true"],
      ["summary", 42],
      ["summary", "   "],
      ["key_changes_made", "not an array"],
      ["key_changes_made", [1, 2]],
      ["key_learnings", null],
      ["acs_met", 1],
    ];
    for (const [field, bad] of cases) {
      const r = validateIterationReport({ ...VALID, [field]: bad });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors).toHaveLength(1);
        expect(r.errors[0].code).toBe("wrong-type");
        expect(r.errors[0].field).toBe(field);
      }
    }
  });

  it("trims the summary on the way out", () => {
    const r = validateIterationReport({ ...VALID, summary: "  padded  " });
    expect(r.ok && r.report.summary).toBe("padded");
  });
});

// ---------------------------------------------------------------------------
// JSON recovery (gnhf json-extract idea)
// ---------------------------------------------------------------------------

describe("extractReportJson", () => {
  it("finds a clean fenced json block", () => {
    const text = `did work\n\n\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\n`;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("finds a bare-fenced block", () => {
    const text = `\`\`\`\n${JSON.stringify(VALID)}\n\`\`\``;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("prefers the LAST parseable fenced block", () => {
    const first = { ...VALID, summary: "first" };
    const last = { ...VALID, summary: "last" };
    const text = `\`\`\`json\n${JSON.stringify(first)}\n\`\`\`\nmore prose\n\`\`\`json\n${JSON.stringify(last)}\n\`\`\``;
    expect((extractReportJson(text) as { summary: string }).summary).toBe("last");
  });

  it("recovers a prose-wrapped bare object", () => {
    const text = `Here's my final report: ${JSON.stringify(VALID)} — hope that helps!`;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("survives braces inside JSON strings", () => {
    const tricky = { ...VALID, summary: 'fixed the "{weird}" case } {' };
    const text = `report: ${JSON.stringify(tricky)}`;
    expect(extractReportJson(text)).toEqual(tricky);
  });

  it("ignores irrelevant JSON blobs without a success key", () => {
    const text = `test output: {"passed": 12, "failed": 0}\nno report emitted`;
    expect(extractReportJson(text)).toBeNull();
  });

  it("returns null on empty / json-free text", () => {
    expect(extractReportJson("")).toBeNull();
    expect(extractReportJson("all prose, no json")).toBeNull();
  });

  it("recovered-but-invalid shapes still fail validation downstream (retry protocol)", () => {
    const bad = { success: "yes", summary: "x" };
    const parsed = extractReportJson(`\`\`\`json\n${JSON.stringify(bad)}\n\`\`\``);
    expect(parsed).not.toBeNull();
    const v = validateIterationReport(parsed);
    expect(v.ok).toBe(false);
  });
});

describe("extractReportJson — validate-first preference (EC-MED-7)", () => {
  it("an earlier VALID report beats a later decorative fence that merely parses", () => {
    const decorative = { name: "pkg", version: "1.0.0", success: "not-a-report" };
    const text = `\`\`\`json\n${JSON.stringify(VALID)}\n\`\`\`\nquoting my package.json:\n\`\`\`json\n${JSON.stringify(decorative)}\n\`\`\``;
    expect(extractReportJson(text)).toEqual(VALID);
  });

  it("falls back to the last parseable object when nothing validates", () => {
    const a = { success: "nope", summary: "a" };
    const b = { success: "nope", summary: "b" };
    const text = `\`\`\`json\n${JSON.stringify(a)}\n\`\`\`\n\`\`\`json\n${JSON.stringify(b)}\n\`\`\``;
    expect((extractReportJson(text) as { summary: string }).summary).toBe("b");
  });

  it("prose-wrapped valid report beats a later prose-wrapped invalid one", () => {
    const invalid = { success: "yes" };
    const text = `report ${JSON.stringify(VALID)} and quoting ${JSON.stringify(invalid)}`;
    expect(extractReportJson(text)).toEqual(VALID);
  });
});

describe("hasFinalReport (LOW-12 — the grace-kill's positional seam invariant)", () => {
  const fenced = (obj: unknown): string => `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;

  it("true when a valid report is the final fenced block (trailing whitespace ok)", () => {
    expect(hasFinalReport(`work log...\n${fenced(VALID)}\n\n  `)).toBe(true);
  });

  it("true when a valid BARE object is the final content", () => {
    expect(hasFinalReport(`done. ${JSON.stringify(VALID)}`)).toBe(true);
  });

  it("false when a valid report is followed by more content (early echoed example)", () => {
    expect(hasFinalReport(`${fenced(VALID)}\n...still working on cleanup...`)).toBe(false);
    expect(hasFinalReport(`${JSON.stringify(VALID)} and now running the tests`)).toBe(false);
  });

  it("false when the trailing block is decorative (parses but does not validate)", () => {
    const decorative = { name: "pkg", version: "1.0.0" };
    expect(hasFinalReport(`${fenced(VALID)}\nquoting package.json:\n${fenced(decorative)}`)).toBe(false);
  });

  it("false for empty / report-less output", () => {
    expect(hasFinalReport("")).toBe(false);
    expect(hasFinalReport("no json here")).toBe(false);
    expect(hasFinalReport("unbalanced { brace")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E-4: worker-requested split (mid-story-split phase 3 — mss103)
//
// review evidence (debug-3b9e07): the optional audit channel the merge
// tail's mandatory `phase 4:` status-log line is composed from. Rides the
// same own-error-path posture as split_request — malformed evidence is
// stripped + surfaced, never failing an otherwise-honest report.
// ---------------------------------------------------------------------------

describe("review evidence (debug-3b9e07)", () => {
  it("copies well-formed review evidence through (trimmed), with no reviewErrors", () => {
    const r = validateIterationReport({
      ...VALID,
      review: {
        findings: 3,
        fixed: 3,
        shape: "  sequential multi-lens  ",
        summary: "  fixed an aliasing bug in the skip set  ",
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.review).toEqual({
        findings: 3,
        fixed: 3,
        shape: "sequential multi-lens",
        summary: "fixed an aliasing bug in the skip set",
      });
      expect(r.reviewErrors).toBeUndefined();
    }
  });

  it("accepts counts-only evidence (shape/summary optional)", () => {
    const r = validateIterationReport({ ...VALID, review: { findings: 0, fixed: 0 } });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.review).toEqual({ findings: 0, fixed: 0 });
      expect(r.reviewErrors).toBeUndefined();
    }
  });

  it("malformed evidence never fails the report: stripped + typed errors surfaced", () => {
    for (const [bad, field] of [
      [{ findings: -1, fixed: 0 }, "review.findings"],
      [{ findings: 1.5, fixed: 0 }, "review.findings"],
      [{ findings: 2 }, "review.fixed"],
      [{ findings: 2, fixed: "2" }, "review.fixed"],
      [{ findings: 2, fixed: 2, shape: "multi\nline" }, "review.shape"],
      [{ findings: 2, fixed: 2, summary: "   " }, "review.summary"],
      ["not an object", "review"],
      [["array"], "review"],
    ] as const) {
      const r = validateIterationReport({ ...VALID, review: bad });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.report.review).toBeUndefined();
        expect(r.reviewErrors!.length).toBeGreaterThanOrEqual(1);
        expect(r.reviewErrors!.map((e) => e.field)).toContain(field);
      }
    }
  });

  it("absent or falsy review → no evidence, no errors (a negative answer is not a WARN)", () => {
    for (const value of [VALID, { ...VALID, review: null }, { ...VALID, review: false }]) {
      const r = validateIterationReport(value);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.report.review).toBeUndefined();
        expect(r.reviewErrors).toBeUndefined();
      }
    }
  });

  it("prompt contract names review with the never-invent instruction", () => {
    const prompt = buildIterationPrompt(params);
    expect(prompt).toContain("- review (optional):");
    expect(prompt).toContain("ran an adversarial self-review pass");
    expect(prompt).toContain("`phase 4:` status-log line");
    expect(prompt).toContain("never invent a review that did not run");
  });
});

// ---------------------------------------------------------------------------
// split_request rides its OWN error path: a malformed request is stripped +
// surfaced (never failing the report, never wedging the item); a
// well-formed one is explicitly copied through validateIterationReport's
// fresh-object return (the silent-drop hazard) and produces exactly ONE
// driver-side merge-first split through the normal merge tail.
// ---------------------------------------------------------------------------

const WELL_FORMED_REQUEST = {
  title: "Finish the remaining ACs",
  remaining_acs: ["the follow-up half of the thing works"],
  learnings: ["  seam was cleaner than expected  "],
};

describe("E-4: worker-requested split (mss103)", () => {
  describe("validateIterationReport split_request path", () => {
    it("copies a well-formed split_request through (trimmed), with no splitRequestErrors", () => {
      const r = validateIterationReport({ ...VALID, split_request: WELL_FORMED_REQUEST });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.report.split_request).toEqual({
          title: "Finish the remaining ACs",
          remaining_acs: ["the follow-up half of the thing works"],
          learnings: ["seam was cleaner than expected"],
        });
        expect(r.splitRequestErrors).toBeUndefined();
      }
    });

    it("a malformed split_request never fails the report: stripped + exactly 1 typed error surfaced", () => {
      const r = validateIterationReport({
        ...VALID,
        split_request: { title: "fine title", remaining_acs: [] },
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.report.split_request).toBeUndefined();
        expect(r.splitRequestErrors).toHaveLength(1);
        expect(r.splitRequestErrors![0].field).toBe("split_request.remaining_acs");
      }
    });

    it("rejects a ';'/multi-line title and a non-object request on the same own-error path", () => {
      for (const bad of [
        { title: "multi\nline;bad", remaining_acs: [] },
        "not an object",
        ["array"],
      ]) {
        const r = validateIterationReport({ ...VALID, split_request: bad });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.report.split_request).toBeUndefined();
          expect(r.splitRequestErrors!.length).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it("absent or null split_request → no request, no errors", () => {
      for (const value of [VALID, { ...VALID, split_request: null }]) {
        const r = validateIterationReport(value);
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.report.split_request).toBeUndefined();
          expect(r.splitRequestErrors).toBeUndefined();
        }
      }
    });
  });

  it("prompt contract names split_request with the clean-seam instruction", () => {
    const prompt = buildIterationPrompt(params);
    expect(prompt).toContain("- split_request (optional):");
    expect(prompt).toContain("ONLY at a clean seam");
    expect(prompt).toContain("committed, coherent, and green on the done portion");
    expect(prompt).toContain("the loop (never you) files the follow-up spec");
  });

  // ── Driver scenarios (real git fixture — shared harness) ────────────────

  let fixture: Fixture | null = null;
  afterEach(() => {
    if (fixture) rmSync(fixture.base, {
      recursive: true,
      force: true,
      // Belt-and-braces against the ENOTEMPTY teardown race; makeFixture
      // disables the auto-gc that caused it, this survives anything else
      // that writes into the fixture as it is being torn down.
      maxRetries: 10,
      retryDelay: 50,
    });
    fixture = null;
  });

  it("well-formed request on a good acs_met=false report → exactly 1 driver-side merge-first split through the normal tail", async () => {
    fixture = makeFixture([{ hash: "par111", title: "Splittable thing" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "done-half.txt": "done\n" },
        report: {
          summary: "shipped the done half",
          key_changes_made: ["done-half.txt"],
          acs_met: false,
          split_request: WELL_FORMED_REQUEST,
        },
      },
    ]);
    // maxItems 1: the follow-up row is an ORDINARY ready row (by design —
    // v2/05 dispatcher), so without the cap the loop would claim it next
    // and the scripted worker would split it again, chaining follow-ups.
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail: mergedTail().tail,
      flags: { maxItems: 1 },
    });

    // The committed portion shipped as complete-at-reduced-scope.
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect(item.iterationsGood).toBe(1);
    expect(item.followUpSpecPath).toMatch(/^dev\/dev-[a-z0-9]+-.+\.md$/);
    const followUpPath = item.followUpSpecPath!;
    const followUpHash = /^dev\/dev-([a-z0-9]+)-/.exec(followUpPath)![1];

    // Exactly ONE driver-side split: one new spec beside the parent, one
    // item:split event.
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(2);
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events.filter((e) => e === "item:split")).toHaveLength(1);
    expect(events).not.toContain("iteration:split-request-invalid");

    // Merge-first shape: follow-up blocked on the (now-merged) parent and
    // on a freshly DERIVED branch, not the parent's WIP branch.
    const followUp = readFileSync(join(fixture.repoRoot, followUpPath), "utf8");
    expect(followUp).toContain("blocked_by: [par111]");
    expect(followUp).toContain(`branch: feat/dev-${followUpHash}`);
    expect(followUp).toContain("title: \"Finish the remaining ACs\"");
    expect(followUp).toContain("the follow-up half of the thing works");
    expect(followUp).toContain("seam was cleaner than expected");

    // Parent reconciled done + spawned wired; DEV.md carries both rows.
    const parent = readFileSync(
      join(fixture.repoRoot, fixture.specRel({ hash: "par111" })),
      "utf8",
    );
    expect(parent).toContain("status: done");
    expect(parent).toContain(`spawned: [${followUpHash}]`);
    const dev = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(dev).toMatch(/- \[x\] `dev\/dev-par111/);
    expect(dev).toContain("Blocked-by: par111.");

    // The done-flip commit carried the follow-up (extraPaths) and pushed.
    expect(
      execFileSync(
        "git",
        ["--git-dir", fixture.origin, "ls-tree", "-r", "--name-only", "main"],
        { encoding: "utf8" },
      ),
    ).toContain(followUpPath);
  });

  it("malformed request → 1 validation error event + 0 spec/backlog writes; iteration counter advances and the item is not terminated", async () => {
    fixture = makeFixture([{ hash: "par222", title: "Robust thing" }]);
    const { worker } = scriptedWorker([
      {
        kind: "report",
        files: { "w1.txt": "w1" },
        report: {
          summary: "tried to split badly",
          key_changes_made: ["w1.txt"],
          acs_met: false,
          split_request: { title: "fine title", remaining_acs: [] },
        },
      },
      {
        kind: "report",
        files: { "w2.txt": "w2" },
        report: { summary: "finished instead", key_changes_made: ["w2.txt"], acs_met: true },
      },
    ]);
    const r = await runLoop({
      repoRoot: fixture.repoRoot,
      merged: MERGED,
      out: () => {},
      heartbeatIntervalMs: 3_600_000,
      worker,
      tail: mergedTail().tail,
    });

    // Exactly 1 validation error surfaced; the request was ignored — no
    // split, no follow-up spec, no extra backlog row.
    const events = readEvents(fixture.cacheDir, r.summary!.runId).map((e) => e.event);
    expect(events.filter((e) => e === "iteration:split-request-invalid")).toHaveLength(1);
    expect(events).not.toContain("item:split");
    expect(events).not.toContain("item:split-fallback");
    expect(readdirSync(join(fixture.repoRoot, "dev"))).toHaveLength(1);

    // The iteration counter advanced past the malformed request and the
    // item ran to normal completion.
    const item = r.summary!.items[0];
    expect(item.outcome).toBe("merged");
    expect(item.iterationsGood).toBe(2);
    expect(item.followUpSpecPath).toBeUndefined();
    const dev = readFileSync(join(fixture.repoRoot, "DEV.md"), "utf8");
    expect(dev).toMatch(/- \[x\] `dev\/dev-par222/);
    expect((dev.match(/^- \[/gm) ?? [])).toHaveLength(1);
    expect(existsSync(join(fixture.repoRoot, ".worktrees", "dev-par222"))).toBe(false);
  });
});
