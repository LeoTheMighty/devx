// Tests for src/lib/backlog/parse.ts (mgr103) — pure DEV.md / INTERVIEW.md /
// MANUAL.md parsers. Adversarial fixtures cover formatting drift the manager
// loop will see in production: mixed checkbox states, struck rows, bare-hash
// "Blocked-by:", blockless INTERVIEW Qs, struck MANUAL items, etc.

import { describe, expect, it } from "vitest";

import {
  parseBacklogSnapshot,
  parseDevMd,
  parseInterviewMd,
  parseManualMd,
  splitHashes,
} from "../src/lib/backlog/parse.js";

// ─── DEV.md ─────────────────────────────────────────────────────────────

describe("parseDevMd", () => {
  it("returns [] for an empty file", () => {
    expect(parseDevMd("")).toEqual([]);
  });

  it("ignores headings + prose, only emits rows", () => {
    const md = `# DEV
## Phase 0
- not a row, missing path
some text
- [ ] \`dev/dev-aud101-2026-04-26T19:35-modules-inventory.md\` — Inventory. Status: done. PR: https://example/1.
`;
    const rows = parseDevMd(md);
    expect(rows).toHaveLength(1);
    expect(rows[0].hash).toBe("aud101");
    expect(rows[0].type).toBe("dev");
    expect(rows[0].status).toBe("done");
  });

  it("parses each checkbox state into the matching status when no Status: text", () => {
    const md = [
      "- [ ] `dev/dev-row001-2026-04-26T19:35-r1.md` — R1.",
      "- [/] `dev/dev-row002-2026-04-26T19:35-r2.md` — R2.",
      "- [-] `dev/dev-row003-2026-04-26T19:35-r3.md` — R3.",
      "- [x] `dev/dev-row004-2026-04-26T19:35-r4.md` — R4.",
    ].join("\n");
    const rows = parseDevMd(md);
    expect(rows.map((r) => r.status)).toEqual([
      "ready",
      "in-progress",
      "blocked",
      "done",
    ]);
  });

  it("Status: text overrides checkbox state when both present", () => {
    const md =
      "- [ ] `dev/dev-x1y2z-2026-04-26T19:35-x.md` — X. Status: blocked.";
    const rows = parseDevMd(md);
    expect(rows[0].status).toBe("blocked");
  });

  it("recognizes struck rows as deleted (or superseded if labeled)", () => {
    const md = [
      "- [x] ~~`dev/dev-old001-2026-04-26T19:35-old.md` — Old. Status: deleted.~~",
      "- [x] ~~`dev/dev-old002-2026-04-26T19:35-old.md` — Old (superseded by new001).~~",
    ].join("\n");
    const rows = parseDevMd(md);
    expect(rows[0].struck).toBe(true);
    expect(rows[0].status).toBe("deleted");
    expect(rows[1].struck).toBe(true);
    expect(rows[1].status).toBe("superseded");
  });

  it("parses Blocked-by: into hash list (multi-format tolerant)", () => {
    const md = [
      "- [ ] `dev/dev-a01-2026-04-26T19:35-a.md` — A. Status: ready. Blocked-by: mrg101, prt102, dvx101.",
      "- [ ] `dev/dev-a02-2026-04-26T19:35-a2.md` — A. Status: ready. Blocked-by: dev-mrg101.",
      "- [ ] `dev/dev-a03-2026-04-26T19:35-a3.md` — A. Status: ready. Blocked-by: `dev/dev-mrg101-2026-04-28T19:30-foo.md`.",
      "- [ ] `dev/dev-a04-2026-04-26T19:35-a4.md` — A. Status: ready.",
    ].join("\n");
    const rows = parseDevMd(md);
    expect(rows[0].blocked_by).toEqual(["mrg101", "prt102", "dvx101"]);
    expect(rows[1].blocked_by).toEqual(["mrg101"]);
    expect(rows[2].blocked_by).toEqual(["mrg101"]);
    expect(rows[3].blocked_by).toEqual([]);
  });

  it("preserves lineIndex for downstream tooling", () => {
    const md = "header\n\n\n- [ ] `dev/dev-row01-2026-04-26T19:35-x.md` — X. Status: ready.";
    const rows = parseDevMd(md);
    expect(rows[0].lineIndex).toBe(3);
  });

  it("supports non-dev spec types (plan/test/debug/focus/learn/qa)", () => {
    const md = [
      "- [ ] `plan/plan-pln01-2026-04-28T19:30-x.md` — Plan.",
      "- [ ] `test/test-tst01-2026-04-28T19:30-x.md` — Test.",
      "- [ ] `debug/debug-dbg01-2026-04-28T19:30-x.md` — Debug.",
    ].join("\n");
    const rows = parseDevMd(md);
    expect(rows.map((r) => r.type)).toEqual(["plan", "test", "debug"]);
  });

  it("ignores bullet rows whose path doesn't match a spec", () => {
    const md = [
      "- [ ] not a spec",
      "- [ ] `random/file.md` — meh.",
      "- [ ] `dev/dev-good01-2026-04-26T19:35-x.md` — Real.",
    ].join("\n");
    const rows = parseDevMd(md);
    expect(rows).toHaveLength(1);
    expect(rows[0].hash).toBe("good01");
  });

  it("tolerates CRLF line endings (Edge Case Hunter EC#1)", () => {
    const md =
      "- [ ] `dev/dev-crlf01-2026-04-26T19:35-x.md` — X. Status: ready. Blocked-by: mrg101.\r\n" +
      "- [ ] `dev/dev-crlf02-2026-04-26T19:35-y.md` — Y. Status: ready.\r\n";
    const rows = parseDevMd(md);
    expect(rows).toHaveLength(2);
    expect(rows[0].blocked_by).toEqual(["mrg101"]);
    expect(rows[0].status).toBe("ready");
  });

  it("tolerates en-dash and double-hyphen title separators (Blind Hunter BH#5)", () => {
    const md = [
      "- [ ] `dev/dev-end001-2026-04-26T19:35-x.md` – En-dash title. Status: ready.",
      "- [ ] `dev/dev-end002-2026-04-26T19:35-x.md` -- Double-hyphen title. Status: ready.",
    ].join("\n");
    const rows = parseDevMd(md);
    expect(rows[0].title).toBe("En-dash title");
    expect(rows[1].title).toBe("Double-hyphen title");
  });

  it("title stops at Status:/Blocked-by:/Blocks: when no trailing period (Edge Case Hunter EC#5)", () => {
    const md =
      "- [ ] `dev/dev-tit001-2026-04-26T19:35-x.md` — Title without trailing period Status: ready. Blocked-by: mrg101.";
    const rows = parseDevMd(md);
    expect(rows[0].title).toBe("Title without trailing period");
    expect(rows[0].status).toBe("ready");
    expect(rows[0].blocked_by).toEqual(["mrg101"]);
  });

  it("rejects pure-digit Blocked-by tokens as phantom blockers (Edge Case Hunter EC#6)", () => {
    const md =
      "- [ ] `dev/dev-phant1-2026-04-26T19:35-x.md` — X. Status: ready. Blocked-by: 12345, mrg101.";
    const rows = parseDevMd(md);
    // 12345 is dropped (no letter); mrg101 retained.
    expect(rows[0].blocked_by).toEqual(["mrg101"]);
  });

  it("normalizes mixed-case dash-prefixed tokens (Blind Hunter BH#9)", () => {
    const md =
      "- [ ] `dev/dev-mxc001-2026-04-26T19:35-x.md` — X. Status: ready. Blocked-by: dev-MGR101.";
    const rows = parseDevMd(md);
    expect(rows[0].blocked_by).toEqual(["mgr101"]);
  });
});

// ─── splitHashes hardening (sgr101 / T1.1, AC 1) ────────────────────────
//
// Every fixture below is a shape lifted from a REAL backlog — this repo's
// DEV.md or the friend-finder-mesh / palateful audit
// (_devx/workstreams/story-graph/research/2026-08-02-external-repos-audit.md).
// Before sgr101 the markup-wrapped ones silently produced zero edges while
// the prose ones produced phantoms.

describe("splitHashes — markup + punctuation hardening (AC 1)", () => {
  it("recovers a hash wrapped in strike-through markup", () => {
    expect(splitHashes("~~rsh101~~")).toEqual(["rsh101"]);
  });

  it("recovers a prefixed hash wrapped in bold with a trailing colon", () => {
    // palateful: `Blocked-by: ~~rsh101~~ (superseded), **now debug-rshrd1**: rerun.`
    // `now` + `rerun` are prose that happens to be hash-SHAPED. splitHashes
    // is a tokenizer, not a validator — dropping them needs the known-hash
    // set, which is buildGraphModel's job (sgr102). What matters here is
    // that BOTH real hashes are recovered, which they were not before.
    expect(splitHashes("~~rsh101~~ (superseded), **now debug-rshrd1**: rerun")).toEqual([
      "rsh101",
      "now",
      "rshrd1",
      "rerun",
    ]);
  });

  it("strips trailing sentence punctuation before matching", () => {
    expect(splitHashes("mgr101, mgr102; mgr103.")).toEqual([
      "mgr101",
      "mgr102",
      "mgr103",
    ]);
  });

  it("resolves a spec-path blocker, including cross-type", () => {
    expect(
      splitHashes("`debug/debug-e2edwds-2026-07-27T19:00-dwds-attach.md`."),
    ).toEqual(["e2edwds"]);
  });

  it("does not split a spec path on its own directory slash", () => {
    // The `/`-splitting branch below must never fire on a real path — a
    // naive split would yield the bare type word `dev` as a phantom.
    expect(splitHashes("dev/dev-mgr101-2026-04-28T19:30-scaffold.md")).toEqual([
      "mgr101",
    ]);
  });

  it("splits a slash-separated hash list (the dominant Parallel-safe shape)", () => {
    expect(splitHashes("bqa101/bqa102")).toEqual(["bqa101", "bqa102"]);
    expect(splitHashes("sgr104/sgr105/sgr107")).toEqual([
      "sgr104",
      "sgr105",
      "sgr107",
    ]);
  });

  it("drops a leading spec-type word when splitting a non-path slash token", () => {
    expect(splitHashes("dev/abc123")).toEqual(["abc123"]);
  });

  it("treats an en/em dash as a separator, yielding range ENDPOINTS only", () => {
    // `rtl101–rtl105` means "through", but enumerating rtl102..rtl104 would
    // invent edges the text never wrote. Under-report, never fabricate.
    expect(splitHashes("rtl101–rtl105")).toEqual(["rtl101", "rtl105"]);
    expect(splitHashes("—")).toEqual([]);
  });

  it("ignores parenthetical rationale — it is never part of the hash list", () => {
    expect(splitHashes("hfi101, hfi102 (both done)")).toEqual([
      "hfi101",
      "hfi102",
    ]);
    expect(
      splitHashes("dc7514 (shared abandon-path predicate; both touch loop driver)"),
    ).toEqual(["dc7514"]);
    expect(splitHashes("aam24 (+ 7-day soak)")).toEqual(["aam24"]);
  });

  it("drops an UNBALANCED trailing parenthetical to end-of-fragment", () => {
    // The capture regex truncates at the first sentence period, which can
    // cut a parenthetical in half and leave a dangling `(`.
    expect(splitHashes("ifh3, ifh4 (consumes their records")).toEqual([
      "ifh3",
      "ifh4",
    ]);
  });

  it("keeps interior punctuation, so prose is not mistaken for a hash", () => {
    // Only the EDGES of a token are stripped, never the interior — so
    // `attempt_count` stays whole and fails every hash shape.
    // `abandon-path` additionally proves the prefixed form is spec-type
    // gated: before sgr101 it matched `^[a-z]+-(…)$` and yielded `path`.
    expect(splitHashes("abandon-path attempt_count")).toEqual([]);
  });

  it("only accepts a real spec type as the `<type>-<hash>` prefix", () => {
    expect(splitHashes("dev-mgr101 debug-rshrd1 plan-62bcd1")).toEqual([
      "mgr101",
      "rshrd1",
      "62bcd1",
    ]);
    expect(splitHashes("byte-preserved sync-in-async")).toEqual([]);
  });

  it("still rejects pure-digit tokens after trimming", () => {
    expect(splitHashes("(12345), mgr101.")).toEqual(["mgr101"]);
  });

  it("deduplicates repeated hashes across shape variants", () => {
    expect(splitHashes("mgr101, dev-mgr101, `mgr101`.")).toEqual(["mgr101"]);
  });
});

// ─── Parallel-safe annotation (sgr101 / T1.2, AC 2) ─────────────────────

describe("parseDevMd — parallel_with (AC 2)", () => {
  const rowWith = (hash: string, rest: string): string =>
    `- [ ] \`dev/dev-${hash}-2026-07-28T08:00-x.md\` — Item ${hash}. Status: ready.${rest}`;

  it("parses `Parallel-safe with` into parallel_with", () => {
    const rows = parseDevMd(rowWith("par001", " Parallel-safe with mss103."));
    expect(rows[0].parallel_with).toEqual(["mss103"]);
  });

  it("parses the slash-separated list form", () => {
    const rows = parseDevMd(
      rowWith("par002", " Parallel-safe with hfi101/hfi102/hfi103 (no shared files)."),
    );
    expect(rows[0].parallel_with).toEqual(["hfi101", "hfi102", "hfi103"]);
  });

  it("parses the `Parallel-with:` colon spelling", () => {
    const rows = parseDevMd(rowWith("par003", " Parallel-with: rtl103, rtl104."));
    expect(rows[0].parallel_with).toEqual(["rtl103", "rtl104"]);
  });

  it("yields range endpoints and drops the trailing rationale", () => {
    const rows = parseDevMd(
      rowWith(
        "par004",
        " Parallel-safe with rtl101–rtl105 (prose + tests only; marker byte-preserved).",
      ),
    );
    expect(rows[0].parallel_with).toEqual(["rtl101", "rtl105"]);
  });

  it("is [] when the row carries no annotation", () => {
    const rows = parseDevMd(rowWith("par005", ""));
    expect(rows[0].parallel_with).toEqual([]);
  });

  it("coexists with Blocked-by: on the same row without cross-contamination", () => {
    const rows = parseDevMd(
      rowWith("par006", " Blocked-by: sgr103. Parallel-safe with sgr104/sgr105."),
    );
    expect(rows[0].blocked_by).toEqual(["sgr103"]);
    expect(rows[0].parallel_with).toEqual(["sgr104", "sgr105"]);
  });

  it("stops at the sentence period, so a following PR link never leaks in", () => {
    const rows = parseDevMd(
      rowWith(
        "par007",
        " Parallel-safe with bqa101/bqa102. PR: https://github.com/o/r/pull/3 (merged 46336bd)",
      ),
    );
    expect(rows[0].parallel_with).toEqual(["bqa101", "bqa102"]);
  });
});

// ─── INTERVIEW.md ───────────────────────────────────────────────────────

describe("parseInterviewMd", () => {
  it("returns [] for empty content", () => {
    expect(parseInterviewMd("")).toEqual([]);
  });

  it("checked checkbox marks question answered (canonical bold form)", () => {
    const md = `- [x] **Q#1 — Title.**
  - Context: foo
  - Blocks: dev-a01.
  → Answer: yes.

- [ ] **Q#2 — Title.**
  - Blocks: dev-a02.`;
    const qs = parseInterviewMd(md);
    expect(qs).toHaveLength(2);
    expect(qs[0]).toMatchObject({ qNum: "1", answered: true, blocks: ["a01"] });
    expect(qs[1]).toMatchObject({ qNum: "2", answered: false, blocks: ["a02"] });
  });

  it("'→ Answer:' marker in body counts as answered even if checkbox unchecked", () => {
    const md = `- [ ] **Q#7 — late mark.**
  - Blocks: dev-z99.
  → Answer: (a).`;
    const qs = parseInterviewMd(md);
    expect(qs[0].answered).toBe(true);
  });

  it("handles questions with no Blocks: line (returns empty array)", () => {
    const md = `- [x] Q#42 — No bullet form.
  - Context: blocks nothing.`;
    const qs = parseInterviewMd(md);
    expect(qs[0].blocks).toEqual([]);
  });

  it("free-form context bullets between header and sub-bullets do not truncate body (Edge Case Hunter EC#2)", () => {
    const md = `- [ ] **Q#5 — Free-form context.**
  - Context: foo
- This is a free-form bullet, not a sub-bullet.
  - Blocks: dev-z01.`;
    const qs = parseInterviewMd(md);
    // Without the fix, the column-0 free-form bullet ended the body,
    // dropping the trailing "Blocks:" sub-bullet.
    expect(qs[0].blocks).toEqual(["z01"]);
  });

  it("does not match question headers inside fenced example blocks (real INTERVIEW.md footer)", () => {
    const md = `- [x] **Q#1 — Real one.**
  - Blocks: dev-real01.
  → Answer: yes.

Example:

\`\`\`markdown
- [x] Q#7 (from DevAgent on dev-fake01)
  - Blocks: dev-fake01.
  → Answer: example
\`\`\`
`;
    const qs = parseInterviewMd(md);
    expect(qs).toHaveLength(1);
    expect(qs[0].qNum).toBe("1");
  });

  it("ignores '→ Answer:' inside fenced code blocks (Edge Case Hunter EC#3)", () => {
    const md =
      "- [ ] **Q#9 — With template.**\n" +
      "  - Context: foo.\n" +
      "  - Blocks: dev-q09.\n" +
      "  - Example template:\n" +
      "    ```\n" +
      "    → Answer: <fill in>\n" +
      "    ```\n";
    const qs = parseInterviewMd(md);
    expect(qs[0].answered).toBe(false);
  });

  it("skips section headings between questions", () => {
    const md = `## Bootstrap

- [x] **Q#1 — Foo.**
  - Blocks: dev-a01.

## Other

- [ ] **Q#2 — Bar.**
  - Blocks: dev-a02.`;
    const qs = parseInterviewMd(md);
    expect(qs.map((q) => q.qNum)).toEqual(["1", "2"]);
  });
});

// ─── MANUAL.md ──────────────────────────────────────────────────────────

describe("parseManualMd", () => {
  it("returns [] for empty content", () => {
    expect(parseManualMd("")).toEqual([]);
  });

  it("parses a checked + unchecked entry with canonical M id formats", () => {
    const md = `- [ ] **M1.2 — Register iPhone UDID.**
  - Why: foo.
  - Blocks: dev-a10004.

- [x] **M3.1 — Enable branch protection.**
  - Why: nope.
  - Blocks: dev-everything.`;
    const items = parseManualMd(md);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "M1.2", checked: false, blocks: ["a10004"] });
    expect(items[1]).toMatchObject({ id: "M3.1", checked: true });
  });

  it("supports M-prefix variants (MS.1, MP0.2, M4.4)", () => {
    const md = [
      "- [ ] **MS.1 — Supervisor proof.**",
      "- [x] **MP0.2 — Plan retro auto-emit.**",
      "- [ ] **M4.4 — GitHub webhook.**",
    ].join("\n");
    const items = parseManualMd(md);
    expect(items.map((i) => i.id)).toEqual(["MS.1", "MP0.2", "M4.4"]);
  });

  it("recognizes struck-out (N/A) entries as checked when checkbox is [x]", () => {
    const md =
      "- [x] ~~**M3.1 — Old.**~~ N/A — superseded by Q#7. Blocks: nothing.";
    const items = parseManualMd(md);
    expect(items[0]).toMatchObject({ id: "M3.1", checked: true });
  });
});

// ─── Combined snapshot ──────────────────────────────────────────────────

describe("parseBacklogSnapshot", () => {
  it("combines all three parsers; missing files default to []", () => {
    const dev = "- [ ] `dev/dev-aaa01-2026-04-26T19:35-x.md` — A. Status: ready.";
    const snap = parseBacklogSnapshot({ devMd: dev });
    expect(snap.dev).toHaveLength(1);
    expect(snap.interview).toEqual([]);
    expect(snap.manual).toEqual([]);
  });

  it("parses all three when all are present", () => {
    const snap = parseBacklogSnapshot({
      devMd: "- [ ] `dev/dev-aaa01-2026-04-26T19:35-x.md` — A. Status: ready.",
      interviewMd: "- [x] **Q#1 — Foo.**\n  - Blocks: dev-aaa01.\n  → Answer: yes.",
      manualMd: "- [ ] **M1.1 — Foo.**\n  - Blocks: dev-aaa01.",
    });
    expect(snap.dev).toHaveLength(1);
    expect(snap.interview).toHaveLength(1);
    expect(snap.manual).toHaveLength(1);
  });
});

describe("Parallel annotation requires the hyphen (sgr101 self-review F1)", () => {
  it("does not match ordinary prose that says 'in parallel with'", () => {
    const md =
      "- [ ] `dev/dev-prs001-2026-07-28T08:00-x.md` — Runs in parallel with the loop driver. Status: ready.";
    expect(parseDevMd(md)[0].parallel_with).toEqual([]);
  });

  it("still matches both hyphenated spellings", () => {
    const safe =
      "- [ ] `dev/dev-prs002-2026-07-28T08:00-x.md` — X. Status: ready. Parallel-safe with mss103.";
    const colon =
      "- [ ] `dev/dev-prs003-2026-07-28T08:00-x.md` — X. Status: ready. Parallel-with: mss103.";
    expect(parseDevMd(safe)[0].parallel_with).toEqual(["mss103"]);
    expect(parseDevMd(colon)[0].parallel_with).toEqual(["mss103"]);
  });
});
