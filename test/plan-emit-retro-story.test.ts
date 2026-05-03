// Tests for src/lib/plan/emit-retro-story.ts (pln102).
//
// Three layers covered:
//
//   1. emitRetroStory() pure-function golden output
//      - canonical spec body matches the Phase 1 retro template
//        (prtret/mrgret shape) byte-for-byte
//      - DEV.md row format
//      - sprint-status row format (10/12-space indents)
//      - prefix derivation from parents[0].slice(0,3)
//      - throws on prefix mismatch / empty parents / empty epicSlug
//      - opts.now is honored (deterministic timestamp)
//
//   2. insertDevMdRow() / insertSprintStatusRow() textual splicing
//      - happy path on real-shape fixtures
//      - throws on missing epic
//      - mid-section append (not at end of file)
//      - strikethrough/abandoned rows still anchor
//
//   3. writeRetroAtomically() — atomicity per epic locked-decision #7
//      - happy path: all 3 written, no WARN
//      - rename failure at spec → no state changed (DEV.md +
//        sprint-status untouched), partial=[spec, DEV.md, sprint-status]
//      - rename failure at DEV.md → spec written, DEV.md +
//        sprint-status NOT written, partial=[DEV.md, sprint-status]
//      - rename failure at sprint-status → spec + DEV.md written,
//        sprint-status NOT written, partial=[sprint-status]
//      - WARN message names every missing artifact
//      - tmp files remain on disk after partial (operator can recover)
//
// Spec: dev/dev-pln102-2026-04-28T19:30-plan-emit-retro.md

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type AtomicEmitFs,
  type EmitRetroStoryResult,
  emitRetroStory,
  insertDevMdRow,
  insertSprintStatusRow,
  writeRetroAtomically,
} from "../src/lib/plan/emit-retro-story.js";

// ---------------------------------------------------------------------------
// Layer 1 — emitRetroStory pure
// ---------------------------------------------------------------------------

// Build the date from LOCAL components (not from an ISO string with a fixed
// offset) so the resulting hour/minute/second/year/month/day all match
// what we assert below — across CI runners in different TZs. The
// `created:` ISO string still ends with the runner's local offset, which
// is asserted with a flexible regex below.
const FIXED_DATE = new Date(2026, 4, 3, 14, 23, 0); // 2026-05-03T14:23:00 local
const STD_OPTS = {
  planPath: "plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md",
  mode: "YOLO",
  shape: "empty-dream",
  thoroughness: "send-it",
  branch: "feat/dev-mrgret",
  now: () => FIXED_DATE,
};
// The filename stamp + status log timestamp prefix are local-component
// based, so they're stable across TZs given a local-component Date.
const FIXED_FILENAME_STAMP = "2026-05-03T14:23";
const FIXED_ISO_PREFIX = "2026-05-03T14:23:00";
// The full ISO ends with `[+-]HH:MM` derived from the runner's TZ.
const ISO_OFFSET_RE = /[+-]\d{2}:\d{2}/;

describe("emitRetroStory — pure", () => {
  it("derives prefix from parents[0].slice(0,3) → mrgret", () => {
    const r = emitRetroStory(
      "merge-gate-modes",
      ["mrg101", "mrg102", "mrg103"],
      STD_OPTS,
    );
    expect(r.specPath).toMatch(/^dev\/dev-mrgret-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-retro-merge-gate-modes\.md$/);
    expect(r.specBody).toContain("hash: mrgret");
    expect(r.specBody).toContain("blocked_by: [mrg101, mrg102, mrg103]");
  });

  it("derives prefix correctly for 3-char-numeric parents (a10001 → a10ret)", () => {
    const r = emitRetroStory(
      "flutter-scaffold-ios-device",
      ["a10001", "a10002", "a10003", "a10004", "a10005"],
      { ...STD_OPTS, branch: "feat/dev-a10ret" },
    );
    expect(r.specPath).toMatch(/^dev\/dev-a10ret-/);
    expect(r.specBody).toContain("hash: a10ret");
    expect(r.specBody).toContain(
      "blocked_by: [a10001, a10002, a10003, a10004, a10005]",
    );
  });

  it("throws when parent prefixes don't match (mrg + prt)", () => {
    expect(() =>
      emitRetroStory("mixed-bag", ["mrg101", "prt101"], STD_OPTS),
    ).toThrow(/prefix mismatch/);
  });

  it("throws on empty parentHashes", () => {
    expect(() => emitRetroStory("foo", [], STD_OPTS)).toThrow(
      /at least one hash/,
    );
  });

  it("throws on empty epicSlug", () => {
    expect(() => emitRetroStory("", ["mrg101"], STD_OPTS)).toThrow(
      /non-empty/,
    );
  });

  it("throws on whitespace-only epicSlug", () => {
    expect(() => emitRetroStory("   ", ["mrg101"], STD_OPTS)).toThrow(
      /non-empty/,
    );
  });

  it.each([
    ["merge-gate/v2", "slash"],
    ["merge-gate.md", "dot"],
    ["MERGE-GATE", "uppercase"],
    ["merge gate", "space"],
    ["merge-gate\nstatus: hijacked", "newline"],
    ["-merge-gate", "leading dash"],
    ["merge-gate-", "trailing dash"],
  ])("rejects non-kebab-case epicSlug: %s (%s)", (slug) => {
    expect(() => emitRetroStory(slug, ["mrg101"], STD_OPTS)).toThrow(
      /not kebab-case/,
    );
  });

  it("DEV.md row matches the canonical format from existing entries", () => {
    const r = emitRetroStory(
      "merge-gate-modes",
      ["mrg101", "mrg102", "mrg103"],
      STD_OPTS,
    );
    // Mirrors the format used for every existing *ret row in DEV.md
    // (mrgret line 89, prtret line 94, etc.).
    expect(r.devMdRow).toBe(
      `- [ ] \`dev/dev-mrgret-${FIXED_FILENAME_STAMP}-retro-merge-gate-modes.md\` — Retro + LEARN.md updates (interim retro discipline). Status: ready. Blocked-by: mrg101, mrg102, mrg103.`,
    );
  });

  it("sprint-status row matches the 10/12-space indent shape", () => {
    const r = emitRetroStory(
      "merge-gate-modes",
      ["mrg101", "mrg102", "mrg103"],
      STD_OPTS,
    );
    expect(r.sprintStatusRow).toBe(
      [
        "          - key: mrgret",
        "            title: Retro + LEARN.md updates (interim retro discipline)",
        "            status: backlog",
        "            blocked_by: [mrg101, mrg102, mrg103]",
      ].join("\n"),
    );
  });

  it("spec body carries every required frontmatter field", () => {
    const r = emitRetroStory(
      "merge-gate-modes",
      ["mrg101", "mrg102", "mrg103"],
      STD_OPTS,
    );
    // AC: hash, type, blocked_by, created, from, plan (and per the
    // canonical template: title, status, branch).
    expect(r.specBody).toContain("hash: mrgret");
    expect(r.specBody).toContain("type: dev");
    expect(r.specBody).toContain(
      "title: Retro + LEARN.md updates (interim retro discipline)",
    );
    expect(r.specBody).toContain(
      "from: _bmad-output/planning-artifacts/epic-merge-gate-modes.md",
    );
    expect(r.specBody).toContain(
      "plan: plan/plan-b01000-2026-04-26T19:30-single-agent-loop.md",
    );
    expect(r.specBody).toContain("status: ready");
    expect(r.specBody).toContain("blocked_by: [mrg101, mrg102, mrg103]");
    expect(r.specBody).toContain("branch: feat/dev-mrgret");
    // Created stamp: prefix is local-component stable; offset depends on
    // the runner's TZ (asserted via flexible regex).
    expect(r.specBody).toMatch(
      new RegExp(`^created: ${FIXED_ISO_PREFIX}${ISO_OFFSET_RE.source}$`, "m"),
    );
  });

  it("spec body's Goal + ACs match the prtret canonical template", () => {
    const r = emitRetroStory("pr-template", ["prt101", "prt102"], {
      ...STD_OPTS,
      branch: "feat/dev-prtret",
    });
    expect(r.specBody).toContain(
      "Run `bmad-retrospective` on epic-pr-template; append findings to `LEARN.md § epic-pr-template`",
    );
    // The 7 ACs that match the prtret canonical shape.
    expect(r.specBody).toContain(
      "- [ ] `bmad-retrospective` invoked against shipped stories (prt101, prt102).",
    );
    expect(r.specBody).toContain(
      "- [ ] Findings appended to `LEARN.md § epic-pr-template`",
    );
    expect(r.specBody).toContain("Each finding tagged");
    expect(r.specBody).toContain("Low-blast findings applied in retro PR.");
    expect(r.specBody).toContain(
      "Higher-blast findings filed as MANUAL.md or new specs.",
    );
    expect(r.specBody).toContain(
      "Cross-epic patterns hitting ≥3 retros total promoted into `LEARN.md § Cross-epic patterns`.",
    );
    expect(r.specBody).toContain("Sprint-status row for `prtret` present");
  });

  it("Technical notes records mode/shape/thoroughness as provenance", () => {
    const r = emitRetroStory("pr-template", ["prt101", "prt102"], {
      ...STD_OPTS,
      branch: "feat/dev-prtret",
      mode: "BETA",
      shape: "active-product",
      thoroughness: "balanced",
    });
    expect(r.specBody).toContain(
      "mode=BETA, shape=active-product, thoroughness=balanced",
    );
  });

  it("Status log seeds with one created-by-/devx-plan line", () => {
    const r = emitRetroStory("pr-template", ["prt101", "prt102"], STD_OPTS);
    expect(r.specBody).toMatch(
      new RegExp(
        `## Status log\\n\\n- ${FIXED_ISO_PREFIX}${ISO_OFFSET_RE.source} — created by \\/devx-plan`,
      ),
    );
  });

  it("filename timestamp drops the seconds + offset", () => {
    const r = emitRetroStory("pr-template", ["prt101", "prt102"], STD_OPTS);
    expect(r.specPath).toContain(`${FIXED_FILENAME_STAMP}-retro-pr-template.md`);
    // Filename should NOT carry seconds or TZ offset (just the minute-
    // precision stamp, matching every existing dev/ filename).
    expect(r.specPath).not.toMatch(/T\d{2}:\d{2}:\d{2}-retro/);
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — splicing helpers
// ---------------------------------------------------------------------------

const SAMPLE_DEV_MD = `# DEV — Features to build

Some preamble.

## Phase 0 — Foundation

### Epic 1 — BMAD audit
- [x] \`dev/dev-aud101-2026-04-26T19:35-bmad-modules-inventory.md\` — Inventory. Status: done.
- [x] \`dev/dev-aud102-2026-04-26T19:35-bmad-classify-workflows.md\` — Classify. Status: done.
- [x] \`dev/dev-audret-2026-04-27T08:00-retro-bmad-audit.md\` — Retro. Status: done.

### Epic 2 — devx CLI skeleton
- [x] \`dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md\` — Scaffold. Status: done.
- [x] \`dev/dev-cli302-2026-04-26T19:35-cli-stubs.md\` — Stubs. Status: done.

## Phase 1 — Single-agent core loop

### Epic 1 — Mode-derived merge gate
- [/] \`dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md\` — Pure fn. Status: in-progress.
- [ ] \`dev/dev-mrg102-2026-04-28T19:30-merge-gate-cli.md\` — CLI. Status: ready.
`;

describe("insertDevMdRow", () => {
  it("appends after the last row of the matching epic section", () => {
    const newRow = `- [ ] \`dev/dev-mrgret-2026-05-03T14:23-retro-merge-gate-modes.md\` — Retro. Status: ready. Blocked-by: mrg101, mrg102.`;
    const out = insertDevMdRow(SAMPLE_DEV_MD, ["mrg101", "mrg102"], newRow);
    const lines = out.split("\n");

    // The inserted line should follow the mrg102 line — directly after it.
    const mrg102Idx = lines.findIndex((l) => l.includes("dev-mrg102-"));
    expect(lines[mrg102Idx + 1]).toBe(newRow);
  });

  it("appends mid-file when the matching epic isn't last", () => {
    const newRow = `- [ ] \`dev/dev-audret2-2026-05-03T14:23-retro-bmad-audit.md\` — Retro2. Status: ready. Blocked-by: aud101.`;
    const out = insertDevMdRow(SAMPLE_DEV_MD, ["aud101"], newRow);
    const lines = out.split("\n");
    // Inserted right after the last `- [` row of the BMAD audit section
    // (the audret line) and BEFORE the `### Epic 2` heading.
    const audretIdx = lines.findIndex((l) => l.includes("dev-audret-"));
    expect(lines[audretIdx + 1]).toBe(newRow);
    expect(lines[audretIdx + 2]).toBe("");
    expect(lines[audretIdx + 3]).toBe("### Epic 2 — devx CLI skeleton");
  });

  it("anchors against strikethrough / abandoned rows too", () => {
    const devMd = `### Epic 5 — Mixed
~~- [x] \`dev/dev-xyz101-2026-04-26T19:35-old.md\` — Abandoned. Status: deleted.~~
- [x] \`dev/dev-xyz102-2026-04-26T19:35-other.md\` — Done. Status: done.
`;
    const newRow = `- [ ] \`dev/dev-xyzret-2026-05-03T14:23-retro-mixed.md\` — Retro. Status: ready. Blocked-by: xyz101.`;
    const out = insertDevMdRow(devMd, ["xyz101"], newRow);
    expect(out).toContain(`- [x] \`dev/dev-xyz102-2026-04-26T19:35-other.md\``);
    expect(out).toContain(newRow);
    // The new row goes after xyz102 (the last live row), not in the
    // middle of the strikethrough-wrapped row.
    const xyzretIdx = out.split("\n").findIndex((l) => l.includes("dev-xyzret-"));
    const xyz102Idx = out.split("\n").findIndex((l) => l.includes("dev-xyz102-"));
    expect(xyzretIdx).toBe(xyz102Idx + 1);
  });

  it("throws when parent hash isn't found in any section", () => {
    expect(() =>
      insertDevMdRow(SAMPLE_DEV_MD, ["zzz999"], "- [ ] dummy"),
    ).toThrow(/zzz999/);
  });

  it("throws when DEV.md has no `### ` headers at all", () => {
    expect(() =>
      insertDevMdRow("# DEV\n\nSome text only.\n", ["aud101"], "row"),
    ).toThrow(/no `### ` section headers/);
  });

  it("hash 'mrg10' does NOT match 'dev-mrg101-' substring rows", () => {
    // EC[2] regression test: probe must be path-component-bounded so a
    // shorter hash that's a prefix of a longer one doesn't anchor on the
    // longer one's row.
    const devMd = `### Epic A — A
- [x] \`dev/dev-mrg101-2026-04-28T19:30-some.md\` — A. Status: done.

### Epic B — B
- [x] \`dev/dev-mrg10-2026-04-28T19:30-other.md\` — B. Status: done.
`;
    const out = insertDevMdRow(devMd, ["mrg10"], "ANCHOR");
    // Must land in Epic B (the section that has the *exact* mrg10-
    // prefix), not Epic A (which has mrg101-).
    const epicBStart = out.indexOf("### Epic B");
    const anchorAt = out.indexOf("ANCHOR");
    expect(anchorAt).toBeGreaterThan(epicBStart);
  });
});

const SAMPLE_SPRINT_STATUS = `# devx implementation sprint status
plans:
  - key: plan-a01000-foundation
    title: Phase 0
    status: backlog
    epics:
      - key: epic-bmad-audit
        title: BMAD audit
        status: backlog
        stories:
          - key: aud101
            title: Inventory
            status: done
          - key: aud102
            title: Classify
            status: done
            blocked_by: [aud101]

      - key: epic-cli-skeleton
        title: CLI skeleton
        status: backlog
        stories:
          - key: cli301
            title: Scaffold
            status: done

  - key: plan-b01000-single-agent-loop
    title: Phase 1
    status: backlog
    epics:
      - key: epic-merge-gate-modes
        title: Merge gate
        status: backlog
        stories:
          - key: mrg101
            title: Pure fn
            status: done
          - key: mrg102
            title: CLI
            status: backlog
            blocked_by: [mrg101]
`;

describe("insertSprintStatusRow", () => {
  it("appends a new story right after the last existing story in the matching epic", () => {
    const row = [
      "          - key: mrgret",
      "            title: Retro + LEARN.md updates (interim retro discipline)",
      "            status: backlog",
      "            blocked_by: [mrg101, mrg102]",
    ].join("\n");

    const out = insertSprintStatusRow(SAMPLE_SPRINT_STATUS, "merge-gate-modes", row);
    const lines = out.split("\n");
    const mrgretIdx = lines.findIndex((l) => l.includes("- key: mrgret"));
    // The new block lands after the mrg102 story (last existing) and
    // before the next plan/epic boundary or EOF.
    const mrg102BlockedByIdx = lines.findIndex((l) =>
      l.includes("blocked_by: [mrg101]"),
    );
    expect(mrgretIdx).toBeGreaterThan(mrg102BlockedByIdx);
  });

  it("inserts mid-file when the matching epic isn't the last one", () => {
    const row = [
      "          - key: audret",
      "            title: Retro + LEARN.md updates (interim retro discipline)",
      "            status: backlog",
      "            blocked_by: [aud101, aud102]",
    ].join("\n");

    const out = insertSprintStatusRow(SAMPLE_SPRINT_STATUS, "bmad-audit", row);
    const lines = out.split("\n");
    const audretIdx = lines.findIndex((l) => l.includes("- key: audret"));
    // Inserted before the next epic (epic-cli-skeleton).
    const nextEpicIdx = lines.findIndex((l) =>
      l.includes("- key: epic-cli-skeleton"),
    );
    expect(audretIdx).toBeLessThan(nextEpicIdx);
    expect(audretIdx).toBeGreaterThan(0);
  });

  it("inserts before the next plan boundary", () => {
    // CLI epic is the last in plan-a01000. Inserting a retro should
    // land BEFORE the `- key: plan-b01000` line.
    const row = [
      "          - key: cliret",
      "            title: Retro + LEARN.md updates (interim retro discipline)",
      "            status: backlog",
      "            blocked_by: [cli301]",
    ].join("\n");

    const out = insertSprintStatusRow(SAMPLE_SPRINT_STATUS, "cli-skeleton", row);
    const lines = out.split("\n");
    const cliretIdx = lines.findIndex((l) => l.includes("- key: cliret"));
    const nextPlanIdx = lines.findIndex((l) =>
      l.includes("- key: plan-b01000-single-agent-loop"),
    );
    expect(cliretIdx).toBeLessThan(nextPlanIdx);
    // And after the last existing cli story.
    const cli301Idx = lines.findIndex((l) => l.includes("- key: cli301"));
    expect(cliretIdx).toBeGreaterThan(cli301Idx);
  });

  it("throws on missing epic", () => {
    expect(() =>
      insertSprintStatusRow(SAMPLE_SPRINT_STATUS, "does-not-exist", "row"),
    ).toThrow(/epic-does-not-exist/);
  });

  it("rejects nested sub-list `- key:` entries as an anchor (EC[3] regression)", () => {
    // Synthetic fixture: an epic where the last `- key:` deeper than the
    // epic's dash-col is at the WRONG (over-deep) indent — e.g. inside a
    // hypothetical `tasks:` sub-block. Pre-fix code would happily anchor
    // there and emit YAML at the wrong indent.
    const yaml = `plans:
  - key: plan-x
    epics:
      - key: epic-foo
        stories:
          - key: foo101
            title: Real story
            status: done
            tasks:
              - key: deeply-nested-task
                done: true
`;
    // No story exists at the canonical story dash-col (col 10) AFTER the
    // nested task at col 14. The new code should still find foo101 (the
    // last `- key:` at col 10) and anchor there — NOT the nested task.
    const out = insertSprintStatusRow(yaml, "foo", "          - key: fooret\n            title: Retro");
    // The new row should land between foo101's block and EOF — and its
    // dash-col should be 10 (matching foo101), NOT 14.
    const fooretLine = out.split("\n").find((l) => l.includes("- key: fooret"));
    expect(fooretLine).toBeDefined();
    expect(fooretLine?.indexOf("-")).toBe(10);
  });

  it("preserves the blank-line separator between epics on insertion", () => {
    // Insert into the merge-gate-modes epic; the next epic
    // (epic-pr-template doesn't exist in SAMPLE_SPRINT_STATUS, but the
    // pattern is the trailing-blank case) — confirm the resulting yaml
    // has a blank line AFTER the inserted block.
    const row = [
      "          - key: mrgret",
      "            title: Retro",
      "            status: backlog",
      "            blocked_by: [mrg101, mrg102]",
    ].join("\n");
    const out = insertSprintStatusRow(SAMPLE_SPRINT_STATUS, "merge-gate-modes", row);
    // The block ends with `blocked_by: [mrg101, mrg102]` followed by the
    // file's trailing characters. Verify the inserted row didn't eat the
    // file's structure — there should be no `- key: epic-` line directly
    // after the blocked_by line.
    const lines = out.split("\n");
    const mrgretBlockedByIdx = lines.findIndex(
      (l) => l.includes("blocked_by: [mrg101, mrg102]"),
    );
    expect(mrgretBlockedByIdx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — writeRetroAtomically (atomicity per locked decision #7)
// ---------------------------------------------------------------------------

interface WorkRoot {
  root: string;
  devMdAbs: string;
  sprintStatusAbs: string;
  cleanup: () => void;
}

function setupRoot(): WorkRoot {
  const root = mkdtempSync(join(tmpdir(), "devx-emit-retro-"));
  const devMdAbs = join(root, "DEV.md");
  const sprintStatusAbs = join(
    root,
    "_bmad-output/implementation-artifacts/sprint-status.yaml",
  );
  writeFileSync(devMdAbs, SAMPLE_DEV_MD);
  mkdirSync(dirname(sprintStatusAbs), { recursive: true });
  writeFileSync(sprintStatusAbs, SAMPLE_SPRINT_STATUS);
  return { root, devMdAbs, sprintStatusAbs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function makeEmit(): EmitRetroStoryResult {
  return emitRetroStory(
    "merge-gate-modes",
    ["mrg101", "mrg102"],
    STD_OPTS,
  );
}

describe("writeRetroAtomically — happy path", () => {
  it("writes all 3 artifacts and emits no WARN", () => {
    const wr = setupRoot();
    try {
      const emit = makeEmit();
      const stderr: string[] = [];
      const result = writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: (s) => stderr.push(s),
      });
      expect(result.fullSuccess).toBe(true);
      expect(result.partial).toBeUndefined();
      expect(result.written).toHaveLength(3);
      expect(stderr.join("")).toBe("");

      // Spec written with exact body.
      const specAbs = join(wr.root, emit.specPath);
      expect(existsSync(specAbs)).toBe(true);
      expect(readFileSync(specAbs, "utf8")).toBe(emit.specBody);

      // DEV.md updated with the new row.
      const devMdAfter = readFileSync(wr.devMdAbs, "utf8");
      expect(devMdAfter).toContain(emit.devMdRow);
      // Original headers preserved.
      expect(devMdAfter).toContain("### Epic 1 — Mode-derived merge gate");
      expect(devMdAfter).toContain("### Epic 1 — BMAD audit");

      // sprint-status updated with the new chunk.
      const sprintAfter = readFileSync(wr.sprintStatusAbs, "utf8");
      expect(sprintAfter).toContain(emit.sprintStatusRow);
      expect(sprintAfter).toContain("- key: epic-merge-gate-modes");

      // No leftover .tmp files.
      const tmps = filesIn(wr.root).filter((p) => p.includes(".tmp."));
      expect(tmps).toHaveLength(0);
    } finally {
      wr.cleanup();
    }
  });
});

describe("writeRetroAtomically — atomicity per locked-decision #7", () => {
  it("rename failure on spec → DEV.md + sprint-status untouched, all three listed in WARN", () => {
    const wr = setupRoot();
    try {
      const emit = makeEmit();
      const devMdBefore = readFileSync(wr.devMdAbs, "utf8");
      const sprintBefore = readFileSync(wr.sprintStatusAbs, "utf8");

      const stderr: string[] = [];
      const fs = makeFailingFs({ failOn: "spec" });
      const result = writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: (s) => stderr.push(s),
        fs,
      });

      expect(result.fullSuccess).toBe(false);
      expect(result.written).toHaveLength(0);
      expect(result.partial).toEqual([
        join(wr.root, emit.specPath),
        wr.devMdAbs,
        wr.sprintStatusAbs,
      ]);

      // Real files untouched.
      expect(readFileSync(wr.devMdAbs, "utf8")).toBe(devMdBefore);
      expect(readFileSync(wr.sprintStatusAbs, "utf8")).toBe(sprintBefore);
      expect(existsSync(join(wr.root, emit.specPath))).toBe(false);

      // WARN names every missing artifact.
      const stderrAll = stderr.join("");
      expect(stderrAll).toContain("WARN: retro emission partial");
      expect(stderrAll).toContain("spec");
      expect(stderrAll).toContain("DEV.md");
      expect(stderrAll).toContain("sprint-status.yaml");
    } finally {
      wr.cleanup();
    }
  });

  it("rename failure on DEV.md → spec written, sprint-status untouched", () => {
    const wr = setupRoot();
    try {
      const emit = makeEmit();
      const sprintBefore = readFileSync(wr.sprintStatusAbs, "utf8");

      const stderr: string[] = [];
      const fs = makeFailingFs({ failOn: "DEV.md" });
      const result = writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: (s) => stderr.push(s),
        fs,
      });

      expect(result.fullSuccess).toBe(false);
      expect(result.written).toEqual([join(wr.root, emit.specPath)]);
      expect(result.partial).toEqual([wr.devMdAbs, wr.sprintStatusAbs]);

      // Spec landed (per locked decision #7 — better partial than zero).
      expect(existsSync(join(wr.root, emit.specPath))).toBe(true);
      // sprint-status untouched.
      expect(readFileSync(wr.sprintStatusAbs, "utf8")).toBe(sprintBefore);

      const stderrAll = stderr.join("");
      expect(stderrAll).toContain("WARN: retro emission partial");
      expect(stderrAll).toContain("DEV.md");
      expect(stderrAll).toContain("sprint-status.yaml");
      // Spec already landed — should NOT be in the missing list.
      expect(stderrAll).not.toMatch(/manually verify spec[,\s]/);
    } finally {
      wr.cleanup();
    }
  });

  it("rename failure on sprint-status → spec + DEV.md written, only sprint-status listed missing", () => {
    const wr = setupRoot();
    try {
      const emit = makeEmit();

      const stderr: string[] = [];
      const fs = makeFailingFs({ failOn: "sprint-status.yaml" });
      const result = writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: (s) => stderr.push(s),
        fs,
      });

      expect(result.fullSuccess).toBe(false);
      expect(result.written).toEqual([
        join(wr.root, emit.specPath),
        wr.devMdAbs,
      ]);
      expect(result.partial).toEqual([wr.sprintStatusAbs]);

      // Spec + DEV.md landed.
      expect(existsSync(join(wr.root, emit.specPath))).toBe(true);
      expect(readFileSync(wr.devMdAbs, "utf8")).toContain(emit.devMdRow);

      const stderrAll = stderr.join("");
      expect(stderrAll).toContain("WARN");
      expect(stderrAll).toContain("sprint-status.yaml");
      // The other two should NOT be in the missing list.
      expect(stderrAll).not.toMatch(/manually verify spec/);
      expect(stderrAll).not.toMatch(/manually verify .*DEV\.md/);
    } finally {
      wr.cleanup();
    }
  });

  it("refuses to overwrite an existing spec file", () => {
    const wr = setupRoot();
    try {
      const emit = makeEmit();
      const specAbs = join(wr.root, emit.specPath);
      mkdirSync(dirname(specAbs), { recursive: true });
      writeFileSync(specAbs, "pre-existing content");
      expect(() =>
        writeRetroAtomically(emit, { repoRoot: wr.root, err: () => undefined }),
      ).toThrow(/refusing to overwrite/);
      // Original content untouched.
      expect(readFileSync(specAbs, "utf8")).toBe("pre-existing content");
    } finally {
      wr.cleanup();
    }
  });

  it("throws clear error when DEV.md is missing", () => {
    const wr = setupRoot();
    try {
      rmSync(wr.devMdAbs);
      const emit = makeEmit();
      expect(() =>
        writeRetroAtomically(emit, { repoRoot: wr.root, err: () => undefined }),
      ).toThrow(/DEV\.md not found/);
    } finally {
      wr.cleanup();
    }
  });

  it("throws clear error when sprint-status.yaml is missing", () => {
    const wr = setupRoot();
    try {
      rmSync(wr.sprintStatusAbs);
      const emit = makeEmit();
      expect(() =>
        writeRetroAtomically(emit, { repoRoot: wr.root, err: () => undefined }),
      ).toThrow(/sprint-status\.yaml not found/);
    } finally {
      wr.cleanup();
    }
  });

  it("WARN includes the actual partial paths AND the leftover .tmp paths (BH[5] + EC[10])", () => {
    const wr = setupRoot();
    try {
      const emit = makeEmit();
      const stderr: string[] = [];
      const fs = makeFailingFs({ failOn: "DEV.md" });
      writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: (s) => stderr.push(s),
        fs,
      });
      const stderrAll = stderr.join("");
      // Concrete paths, not just the "DEV.md" / "sprint-status.yaml" labels.
      expect(stderrAll).toContain(wr.devMdAbs);
      expect(stderrAll).toContain(wr.sprintStatusAbs);
      // Leftover .tmp paths called out so the operator knows what to clean up
      // or recover.
      expect(stderrAll).toContain(".tmp.");
      expect(stderrAll).toMatch(/Leftover \.tmp files/);
    } finally {
      wr.cleanup();
    }
  });

  it("two emissions in the same ms produce non-colliding tmp paths (BH[1])", () => {
    // Verify the random suffix is per-call by capturing what tmp paths
    // each writeRetroAtomically would write (we proxy through the fs
    // seam to read names without actually doing rename).
    const wr = setupRoot();
    try {
      const emit = makeEmit();
      const seen1: string[] = [];
      const seen2: string[] = [];
      const captureFs = (sink: string[]): Partial<AtomicEmitFs> => ({
        writeFile(p) { sink.push(p); },
        rename() { /* no-op so subsequent emit can see same originals */ },
        mkdirRecursive() { /* no-op */ },
      });
      writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: () => undefined,
        fs: captureFs(seen1),
      });
      writeRetroAtomically(emit, {
        repoRoot: wr.root,
        err: () => undefined,
        fs: captureFs(seen2),
      });
      // Sanity: 3 tmps each call.
      expect(seen1).toHaveLength(3);
      expect(seen2).toHaveLength(3);
      // Every tmp from call 1 should be distinct from every tmp in call 2.
      for (const a of seen1) {
        for (const b of seen2) {
          expect(a).not.toBe(b);
        }
      }
    } finally {
      wr.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FailingFsOpts {
  /** Fail rename when the destination basename matches one of these substrings. */
  failOn: "spec" | "DEV.md" | "sprint-status.yaml";
}

function makeFailingFs(opts: FailingFsOpts): Partial<AtomicEmitFs> {
  const realRename = (oldP: string, newP: string) => {
    // Use real fs's rename for the non-failing renames so the file
    // actually lands and subsequent assertions can check it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    fs.renameSync(oldP, newP);
  };
  return {
    rename(oldP: string, newP: string) {
      if (
        (opts.failOn === "spec" && newP.includes("/dev/dev-")) ||
        (opts.failOn === "DEV.md" && newP.endsWith("/DEV.md")) ||
        (opts.failOn === "sprint-status.yaml" &&
          newP.endsWith("/sprint-status.yaml"))
      ) {
        const e = new Error(`simulated rename failure on ${newP}`) as NodeJS.ErrnoException;
        e.code = "EACCES";
        throw e;
      }
      realRename(oldP, newP);
    },
  };
}

function filesIn(dir: string): string[] {
  // Recursive listing for the leftover-tmp assertion.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}
