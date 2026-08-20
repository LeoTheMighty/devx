// c808b1 — the run report an unattended /devx-learn leaves behind.
//
// The AC is "every unattended run leaves a report, whether or not it changed
// anything, findable without knowing the session id". Three properties carry
// that, and each is a way the feature has already failed in prose form:
//
//   1. **Totality.** Found-nothing, budget-bound-partial and unreadable-payload
//      runs all write a file. A run with no trace is indistinguishable from a
//      tab that hung, which is exactly the failure this spec exists to end.
//   2. **Findability.** The path is `<learn-home>/reports/<stamp>-<slug>.md`
//      and every report appends one line to `reports/index.md` — no session id
//      needed to find last night's decisions, and two retros finishing at once
//      cannot truncate each other.
//   3. **Untrusted input.** Row text is mined session content: a `|` or a
//      newline in a learning must not forge table structure, and a hostile
//      session id must not become a path component.
//
// Spec: dev/dev-c808b1-2026-08-05T11:25-devx-learn-unattended-apply.md

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { coerceLearnReport, runLearnReport } from "../src/commands/learn-helper.js";
import {
  type LearnReport,
  learnReportPath,
  renderIndexLine,
  renderLearnReport,
  reportStamp,
  reportsIndexPath,
  writeLearnReport,
} from "../src/lib/learn/report.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "devx-learn-report-"));
});

const ROW = {
  learning: "The watcher never reaps a wedged tab",
  evidence: "iteration 2 spent 40m on a hung skill edit",
  bucket: "1 framework fix",
  question: "would another repo running devx hit this?",
  disposition: "applied" as const,
  reason: "in-repo path with no harness gate",
  paths: ["src/lib/learn/watch.ts"],
};

describe("reportStamp", () => {
  it("renders minute precision with colons removed", () => {
    expect(reportStamp("2026-08-20T18:31:02.500Z")).toBe("2026-08-20T18-31");
  });

  it("degrades unparseable input rather than throwing", () => {
    // A report at a wrong-looking path is recoverable; one never written is not.
    expect(reportStamp("not a time")).toBe("unknown-time");
    expect(reportStamp(undefined)).toBe("unknown-time");
  });
});

describe("learnReportPath", () => {
  it("sanitizes the slug — mined text never lands raw in a path", () => {
    const path = learnReportPath(home, "2026-08-20T18-31", "watcher; rm -rf / wedge");
    expect(path).toBe(join(home, "reports", "2026-08-20T18-31-watcher-rm-rf-wedge.md"));
  });

  it("falls back when the slug source reduces to nothing", () => {
    expect(learnReportPath(home, "unknown-time", "///")).toBe(
      join(home, "reports", "unknown-time-session-retro.md"),
    );
  });
});

describe("renderLearnReport", () => {
  it("names the mode, the counts and the PR", () => {
    const md = renderLearnReport({
      sessionId: "sess-123",
      repo: "/repo/devx",
      finishedAt: "2026-08-20T18:31:02.500Z",
      rows: [ROW, { ...ROW, disposition: "proposed" }, { ...ROW, disposition: "dropped" }],
      prUrl: "https://github.com/LeoTheMighty/devx/pull/9",
    });
    expect(md).toContain("- mode: **unattended**");
    expect(md).toContain("- session: `sess-123`");
    expect(md).toContain("- rows: 3 (applied 1, proposed 1, dropped 1)");
    expect(md).toContain("https://github.com/LeoTheMighty/devx/pull/9");
  });

  it("states the found-nothing result in a sentence, not an empty table", () => {
    const md = renderLearnReport({ finishedAt: "2026-08-20T18:31:02.500Z", rows: [] });
    expect(md).toContain("- rows: 0 (applied 0, proposed 0, dropped 0)");
    expect(md).toContain("Nothing was mined");
    expect(md).not.toContain("| learning |");
  });

  it("marks a budget-bound run partial", () => {
    const md = renderLearnReport({ finishedAt: "2026-08-20T18:31:02.500Z", rows: [], partial: true });
    expect(md).toContain("**partial**");
  });

  it("carries the predicate's reason and the artifact per row", () => {
    const md = renderLearnReport({
      finishedAt: "2026-08-20T18:31:02.500Z",
      rows: [
        {
          ...ROW,
          disposition: "proposed",
          reason: "skills/** is the packaged mirror",
          artifact: "docs/updates/2026-08-20-mirror.md",
        },
      ],
    });
    expect(md).toContain("skills/** is the packaged mirror"); // the reason survives verbatim
    expect(md).toContain("docs/updates/2026-08-20-mirror.md");
    expect(md).toContain("| proposed |");
  });

  it("escapes pipes and flattens newlines — mined text cannot forge a row", () => {
    const md = renderLearnReport({
      finishedAt: "2026-08-20T18:31:02.500Z",
      rows: [
        {
          learning: "a | b\n| forged | row | here | now | x |",
          disposition: "dropped",
        },
      ],
    });
    const tableRows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| learning"));
    // header separator + exactly one data row; a forged row would make it more.
    expect(tableRows.filter((l) => !l.startsWith("|---")).length).toBe(1);
    expect(md).toContain("a \\| b");
  });

  it("drops an unsafe session id instead of echoing it", () => {
    const md = renderLearnReport({
      sessionId: "../../etc/passwd",
      finishedAt: "2026-08-20T18:31:02.500Z",
      rows: [],
    });
    expect(md).not.toContain("passwd");
  });

  it("renders sparse rows without holes", () => {
    const md = renderLearnReport({
      finishedAt: "2026-08-20T18:31:02.500Z",
      rows: [{ learning: "only a learning", disposition: "dropped" }],
    });
    expect(md).toContain("| only a learning | — | — | — | dropped | — | — |");
  });
});

describe("renderIndexLine", () => {
  it("is one greppable line carrying the counts, session and path", () => {
    const line = renderIndexLine(
      {
        sessionId: "sess-123",
        repo: "/repo/devx",
        finishedAt: "2026-08-20T18:31:02.500Z",
        rows: [ROW],
        prUrl: "https://example.test/pr/1",
      },
      "/home/reports/x.md",
    );
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toContain("rows 1 (a1/p0/d0)");
    expect(line).toContain("sess-123");
    expect(line).toContain("[report](/home/reports/x.md)");
  });

  it("stays one line even when a row's text has newlines in it", () => {
    const line = renderIndexLine(
      { finishedAt: "2026-08-20T18:31:02.500Z", note: "a\nb", rows: [] },
      "/home/reports/x.md",
    );
    expect(line.split("\n")).toHaveLength(1);
  });

  it("names an unknown session rather than omitting the field", () => {
    expect(renderIndexLine({ finishedAt: "t", rows: [] }, "/p.md")).toContain("unknown-session");
  });
});

describe("writeLearnReport", () => {
  const base: LearnReport = {
    sessionId: "sess-abc",
    finishedAt: "2026-08-20T18:31:02.500Z",
    rows: [ROW],
  };

  it("writes the report under <home>/reports and returns its path", () => {
    const { path } = writeLearnReport(base, { home, slug: "watcher wedge" });
    expect(path).toBe(join(home, "reports", "2026-08-20T18-31-watcher-wedge.md"));
    expect(readFileSync(path, "utf8")).toContain("- mode: **unattended**");
  });

  it("appends one index line per run rather than overwriting", () => {
    writeLearnReport(base, { home, slug: "first" });
    writeLearnReport({ ...base, finishedAt: "2026-08-20T19:05:00.000Z" }, { home, slug: "second" });
    const index = readFileSync(reportsIndexPath(home), "utf8").trim().split("\n");
    expect(index).toHaveLength(2);
    expect(index[0]).toContain("first");
    expect(index[1]).toContain("second");
  });

  it("writes on the found-nothing path too", () => {
    const { path } = writeLearnReport(
      { finishedAt: "2026-08-20T18:31:02.500Z", rows: [], note: "nothing to mine" },
      { home },
    );
    expect(readFileSync(path, "utf8")).toContain("Nothing was mined");
    expect(path).toContain("nothing-to-mine");
  });

  it("disambiguates a same-minute, same-slug collision instead of erasing it", () => {
    // Two drained sessions that both mined nothing slug identically; the second
    // must not silently overwrite the first's report.
    const nothing: LearnReport = { finishedAt: "2026-08-20T18:31:02.500Z", rows: [], note: "nothing to mine" };
    const first = writeLearnReport({ ...nothing, sessionId: "sess-one" }, { home });
    const second = writeLearnReport({ ...nothing, sessionId: "sess-two" }, { home });
    expect(second.path).not.toBe(first.path);
    expect(second.path).toContain("nothing-to-mine-2.md");
    expect(readFileSync(first.path, "utf8")).toContain("sess-one");
    expect(readFileSync(second.path, "utf8")).toContain("sess-two");
    const index = readFileSync(reportsIndexPath(home), "utf8").trim().split("\n");
    expect(index).toHaveLength(2);
    expect(index[1]).toContain(second.path);
  });

  it("is findable without the session id — one dir, sorted by stamp", () => {
    writeLearnReport({ ...base, finishedAt: "2026-08-20T19:05:00.000Z" }, { home, slug: "b" });
    writeLearnReport(base, { home, slug: "a" });
    const names = readdirSync(join(home, "reports")).filter((n) => n !== "index.md").sort();
    expect(names).toEqual(["2026-08-20T18-31-a.md", "2026-08-20T19-05-b.md"]);
  });
});

describe("coerceLearnReport", () => {
  it("keeps well-formed rows and their fields", () => {
    const report = coerceLearnReport({ rows: [ROW], prUrl: "https://x.test/1" });
    expect(report.rows).toHaveLength(1);
    expect(report.rows?.[0].disposition).toBe("applied");
    expect(report.prUrl).toBe("https://x.test/1");
  });

  it("defaults an unknown disposition to dropped — never to applied", () => {
    // A skill body that fumbles the field must not have a row counted as landed.
    expect(coerceLearnReport({ rows: [{ learning: "x", disposition: "APPLIED" }] }).rows?.[0].disposition).toBe(
      "dropped",
    );
    expect(coerceLearnReport({ rows: [{ learning: "x" }] }).rows?.[0].disposition).toBe("dropped");
  });

  it("survives a payload that is not an object", () => {
    for (const junk of [null, 42, "text", [1, 2]]) {
      expect(coerceLearnReport(junk).rows).toEqual([]);
    }
  });

  it("drops wrong-typed fields instead of rejecting the row", () => {
    const row = coerceLearnReport({ rows: [{ learning: 5, evidence: {}, paths: ["ok", 7] }] }).rows?.[0];
    expect(row?.learning).toBe("");
    expect(row?.evidence).toBeUndefined();
    expect(row?.paths).toEqual(["ok"]);
  });
});

describe("devx learn-helper report", () => {
  const payload = JSON.stringify({
    sessionId: "sess-cli",
    finishedAt: "2026-08-20T18:31:02.500Z",
    note: "cli path",
    rows: [ROW],
  });

  it("writes the report and prints the path", () => {
    let out = "";
    const code = runLearnReport(undefined, { home, readInput: () => payload, out: (s) => (out += s) });
    expect(code).toBe(0);
    const path = out.trim();
    expect(path).toBe(join(home, "reports", "2026-08-20T18-31-cli-path.md"));
    expect(readFileSync(path, "utf8")).toContain("sess-cli");
  });

  it("still writes a degraded report when the payload is unreadable", () => {
    let out = "";
    let err = "";
    const code = runLearnReport(undefined, {
      home,
      readInput: () => "{not json",
      out: (s) => (out += s),
      err: (s) => (err += s),
      now: () => "2026-08-20T18:31:02.500Z",
    });
    expect(code).toBe(0);
    expect(err).toContain("unreadable");
    expect(out.trim()).toContain("unreadable-payload.md"); // not a sentence-long filename
    const body = readFileSync(out.trim(), "utf8");
    expect(body).toContain("report payload was unreadable");
    expect(body).toContain("Nothing was mined");
  });

  it("stamps finishedAt from the clock when the payload omits it", () => {
    let out = "";
    runLearnReport(undefined, {
      home,
      readInput: () => JSON.stringify({ rows: [] }),
      out: (s) => (out += s),
      now: () => "2026-08-20T20:00:00.000Z",
    });
    expect(out.trim()).toContain("2026-08-20T20-00");
  });

  it("--print renders without writing anything", () => {
    let out = "";
    runLearnReport(undefined, { home, readInput: () => payload, print: true, out: (s) => (out += s) });
    expect(out).toContain("- mode: **unattended**");
    expect(() => readdirSync(join(home, "reports"))).toThrow();
  });

  it("reads the payload from a file argument", () => {
    let out = "";
    const file = join(home, "payload.json");
    writeLearnReport({ finishedAt: "2026-08-20T18:31:02.500Z", rows: [] }, { home, slug: "seed" });
    writeFileSync(file, payload, "utf8");
    runLearnReport(file, { home, out: (s) => (out += s) });
    expect(readFileSync(out.trim(), "utf8")).toContain("sess-cli");
  });

  it("resolves the home from DEVX_LEARN_HOME when none is passed", () => {
    let out = "";
    runLearnReport(undefined, {
      env: { DEVX_LEARN_HOME: home },
      readInput: () => payload,
      out: (s) => (out += s),
    });
    expect(out.trim().startsWith(home)).toBe(true);
  });

  it("defaults the mode to unattended — the attended path does not report", () => {
    let out = "";
    runLearnReport(undefined, {
      home,
      readInput: () => JSON.stringify({ finishedAt: "2026-08-20T18:31:02.500Z", rows: [] }),
      out: (s) => (out += s),
    });
    expect(readFileSync(out.trim(), "utf8")).toContain("- mode: **unattended**");
  });
});
