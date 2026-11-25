// Gate 4's reason check (D-19). The RED gate's claim is that each P0 "fails
// for the right reason" before anything is built. Until D-19 the gate checked
// only that the eval's exit code was nonzero, so an import error, a missing
// fixture, a DB that was not running, an empty selection, or a runner that
// exits 1 unconditionally all read exactly like a missing feature. Palateful's
// api runner had the last shape (exit 1 on a green file), and the gate PASSed
// a vacuous suite on it.
//
// What this module can tell apart, and what it cannot:
//
//   CAN   — "the eval ran and a test in it failed" versus "the eval did not
//           get that far": the shell could not start the command, the process
//           was killed, the file failed to load or collect, a setup step
//           errored, nothing was selected, everything was skipped, or every
//           test passed and the nonzero exit came from somewhere else.
//   CANNOT — that the failing test is failing on the expectation's missing
//           behaviour rather than on, say, a typo inside the test body.
//           Semantic equivalence of two failure reasons is out of reach; the
//           failure quote in RED-report.md stays the author's to judge.
//
// It can only tell even that much from what the runner declares, in
// `projects[].red` (docs/CONFIG.md):
//
//   report: junit | jest-json  — the runner writes a structured result to a
//       path the gate owns; the GATE counts the test cases. Strongest.
//   failed_exit: [codes]       — the runner PROMISES these exit codes mean
//       "at least one test ran and failed". The gate checks the exit code
//       against the promise; it counts nothing. As good as the runner.
//   neither                    — the gate sees a nonzero exit and nothing
//       else. It says so ("reason unchecked"); for a P0 that blocks.
//
// Pure: no IO. The caller runs the command and hands over the report text.

/** A runner's Gate 4 contract, from `projects[].red`. */
export interface RedContract {
  /** Replaces the runner's `test` command for Gate 4 runs only. */
  command: string | null;
  /** Structured result format the runner writes, or null. */
  report: RedReportFormat | null;
  /** Appended after the artifact. `{report}` → the gate-owned result path. */
  args: string | null;
  /** Exit codes the runner promises mean "≥1 test ran and failed". */
  failedExit: number[] | null;
}

export type RedReportFormat = "junit" | "jest-json";

export const RED_REPORT_PLACEHOLDER = "{report}";
/** Also exported to the eval's environment, for runners that read it. */
export const RED_REPORT_ENV = "DEVX_RED_REPORT";

/**
 * Narrow a raw `projects[].red` value. Returns `contract: null` when the key
 * is absent. A malformed value is NOT silently dropped to "undeclared": its
 * problems are returned so the gate can name them, and a contract with a
 * problem is treated as undeclared — the strict direction, since nothing it
 * would have promised can be trusted.
 */
export function redContractFrom(raw: unknown): {
  contract: RedContract | null;
  problems: string[];
} {
  if (raw === undefined || raw === null) return { contract: null, problems: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { contract: null, problems: ["`red:` must be a mapping"] };
  }
  const r = raw as Record<string, unknown>;
  const problems: string[] = [];
  const str = (key: string): string | null => {
    const v = r[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string") {
      problems.push(`\`red.${key}\` must be a string`);
      return null;
    }
    return v.trim() === "" ? null : v;
  };
  const command = str("command");
  const args = str("args");
  let report: RedReportFormat | null = null;
  if (r.report !== undefined && r.report !== null) {
    if (r.report === "junit" || r.report === "jest-json") report = r.report;
    else problems.push("`red.report` must be `junit` or `jest-json`");
  }
  let failedExit: number[] | null = null;
  if (r.failed_exit !== undefined && r.failed_exit !== null) {
    const v = r.failed_exit;
    if (
      !Array.isArray(v) ||
      v.length === 0 ||
      !v.every((n) => Number.isInteger(n) && n > 0 && n < 126)
    ) {
      problems.push(
        "`red.failed_exit` must be a non-empty list of exit codes between 1 and 125",
      );
    } else {
      failedExit = [...new Set(v as number[])].sort((a, b) => a - b);
    }
  }
  if (report === null && failedExit === null && problems.length === 0) {
    problems.push(
      "`red:` declares neither `report` nor `failed_exit`, so it gives the gate nothing to check",
    );
  }
  if (args !== null && report === null) {
    problems.push("`red.args` is only meaningful with `red.report`");
  }
  if (problems.length > 0) return { contract: null, problems };
  return { contract: { command, report, args, failedExit }, problems: [] };
}

/** One line for reports and dry runs: what the gate will be able to see. */
export function describeContract(c: RedContract | null): string {
  if (c === null) return "none";
  const parts: string[] = [];
  if (c.report !== null) parts.push(`${c.report} report`);
  if (c.failedExit !== null) parts.push(`failed_exit [${c.failedExit.join(", ")}]`);
  return parts.join(" + ");
}

// ---------------------------------------------------------------------------
// Structured results
// ---------------------------------------------------------------------------

export interface CaseResult {
  /** `classname > name` (JUnit) or the full name (jest-json). */
  id: string;
  status: "passed" | "failed" | "errored" | "skipped";
  /** Failure/error message, first line, when there is one. */
  message: string | null;
}

export interface CaseTally {
  cases: CaseResult[];
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

function tally(cases: CaseResult[]): CaseTally {
  const n = (s: CaseResult["status"]): number => cases.filter((c) => c.status === s).length;
  return { cases, passed: n("passed"), failed: n("failed"), errored: n("errored"), skipped: n("skipped") };
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attrs);
  if (!m) return null;
  return decodeXml(m[2] ?? m[3] ?? "");
}

function firstLine(s: string | null): string | null {
  if (s === null) return null;
  const line = s.split("\n").map((l) => l.trim()).find((l) => l !== "");
  return line === undefined ? null : line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

/**
 * A failed JUnit case that is really a FILE that failed to load (D-19).
 * vitest's JUnit reporter encodes a module-load failure, and a file with no
 * tests, as a `<failure>` on a synthetic case whose `name` and `classname`
 * are both the file path (observed on vitest 3: "Failed to load url …",
 * "No test suite found in file …"). Counting it as a test that failed would
 * read an import error as RED. The guard is narrow — both names identical,
 * no whitespace, ending in a file extension — so a real case it could
 * misread is one whose title is its own file name. Misreading in that
 * direction costs a FAIL, never a PASS. vitest's `jest-json` report has no
 * such ambiguity, which is why the docs point vitest at it.
 */
function isFileLevelCase(name: string | null, classname: string | null): boolean {
  if (name === null || classname === null || name !== classname) return false;
  return !/\s/.test(name) && /\.[A-Za-z0-9]{1,5}$/.test(name);
}

/**
 * Parse a JUnit XML report into per-case results, or null when the text is
 * not a JUnit report at all (no `<testsuite`/`<testsuites` root). A report
 * with zero cases parses to an empty tally — "nothing ran" is a result.
 *
 * Status per `<testcase>`: `<failure>` → failed; `<error>` without a failure
 * → errored (pytest: collection and setup errors; a DB a fixture could not
 * reach lands here); `<skipped>` → skipped; none → passed. A suite-level
 * `<error>` outside any case also counts as one errored case.
 */
export function parseJunit(xml: string): CaseTally | null {
  const body = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  if (!/<testsuites?\b/.test(body)) return null;
  const cases: CaseResult[] = [];
  // Attribute values may legally hold an unescaped `>` ("assert 2 > 1"), so
  // the attribute run is quote-aware rather than `[^>]*`.
  const tag = /<(\/?)(testcase|failure|error|skipped)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let open: {
    id: string;
    name: string | null;
    classname: string | null;
    failure: string | null | undefined;
    error: string | null | undefined;
    skipped: boolean;
  } | null = null;
  const close = (c: NonNullable<typeof open>): void => {
    let status: CaseResult["status"];
    let message: string | null = null;
    if (c.failure !== undefined) {
      status = isFileLevelCase(c.name, c.classname) ? "errored" : "failed";
      message = c.failure;
    } else if (c.error !== undefined) {
      status = "errored";
      message = c.error;
    } else if (c.skipped) {
      status = "skipped";
    } else {
      status = "passed";
    }
    cases.push({ id: c.id, status, message: firstLine(message) });
  };
  for (let m = tag.exec(body); m !== null; m = tag.exec(body)) {
    const [, slash, name, attrs, selfClose] = m;
    if (name === "testcase") {
      if (slash === "/") {
        if (open) close(open);
        open = null;
        continue;
      }
      if (open) close(open); // unterminated previous case
      const n = attr(attrs, "name");
      const cn = attr(attrs, "classname");
      const id = cn && cn !== "" && cn !== n ? `${cn} > ${n ?? "(unnamed)"}` : n ?? cn ?? "(unnamed)";
      open = { id, name: n, classname: cn, failure: undefined, error: undefined, skipped: false };
      if (selfClose === "/") {
        close(open);
        open = null;
      }
      continue;
    }
    if (slash === "/") continue;
    const message = attr(attrs, "message") ?? attr(attrs, "type");
    if (open === null) {
      // A suite-level <error> (or <failure>) with no case: the suite itself
      // did not run. Never a test that failed.
      if (name === "error" || name === "failure") {
        cases.push({ id: "(suite)", status: "errored", message: firstLine(message) });
      }
      continue;
    }
    if (name === "failure") open.failure = open.failure ?? message;
    else if (name === "error") open.error = open.error ?? message;
    else if (name === "skipped") open.skipped = true;
  }
  if (open) close(open);
  return tally(cases);
}

/**
 * Parse a jest-compatible JSON report (`vitest --reporter=json`, `jest
 * --json`), or null when it is not one. Each `assertionResults` entry is a
 * case. A file whose `assertionResults` is empty but which carries a
 * `message` or `status: failed` is a file that failed to load — one errored
 * case, never a failed test (that is the shape vitest gives an import error,
 * and jest a suite that failed to run).
 */
export function parseJestJson(text: string): CaseTally | null {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || !Array.isArray((j as { testResults?: unknown }).testResults)) {
    return null;
  }
  const cases: CaseResult[] = [];
  for (const raw of (j as { testResults: unknown[] }).testResults) {
    if (!raw || typeof raw !== "object") continue;
    const file = raw as {
      name?: unknown;
      status?: unknown;
      message?: unknown;
      assertionResults?: unknown;
    };
    const fileName = typeof file.name === "string" ? file.name : "(file)";
    const results = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    const fileMessage = typeof file.message === "string" && file.message.trim() !== "" ? file.message : null;
    if (results.length === 0) {
      if (fileMessage !== null || file.status === "failed") {
        cases.push({ id: fileName, status: "errored", message: firstLine(fileMessage ?? "file failed") });
      }
      continue;
    }
    for (const a of results) {
      if (!a || typeof a !== "object") continue;
      const r = a as { status?: unknown; fullName?: unknown; title?: unknown; failureMessages?: unknown };
      const id =
        typeof r.fullName === "string" && r.fullName !== ""
          ? r.fullName
          : typeof r.title === "string"
            ? r.title
            : "(unnamed)";
      const msgs = Array.isArray(r.failureMessages) ? r.failureMessages.filter((m) => typeof m === "string") : [];
      const status: CaseResult["status"] =
        r.status === "passed"
          ? "passed"
          : r.status === "failed"
            ? "failed"
            : "skipped"; // pending, skipped, todo, disabled
      cases.push({ id, status, message: firstLine((msgs[0] as string | undefined) ?? null) });
    }
    // A file-level `message` beside real results is NOT read as an error:
    // jest folds its assertion-failure text into that field, so counting it
    // would call every jest failure "could not run". The cases themselves
    // say whether a test ran and failed.
  }
  return tally(cases);
}

// ---------------------------------------------------------------------------
// The classification
// ---------------------------------------------------------------------------

export type WrongReason =
  | "could not run"
  | "nothing ran"
  | "no result"
  | "passed"
  | "undeclared exit";

export type RedReason =
  | { kind: "asserted"; basis: "report" | "exit-contract"; detail: string; failing: CaseResult[] }
  | { kind: "unchecked"; detail: string }
  | { kind: "wrong"; wrong: WrongReason; detail: string; failing: CaseResult[] };

/**
 * Exit codes no test runner uses to say "a test failed": the shell's own
 * 126 (found, not executable) and 127 (not found — also what the gate's
 * exec seam returns when the spawn itself failed), and 128+n (killed by
 * signal n — an OOM kill is 137). Checked for every runner, declared or not.
 */
export function shellFailure(exitCode: number): string | null {
  if (exitCode === 126) return "exit 126: the shell found the command but could not execute it";
  if (exitCode === 127) return "exit 127: the command was not found, or the gate could not spawn it";
  if (exitCode >= 128) {
    return `exit ${exitCode}: the process was killed (signal ${exitCode - 128}) before it reported a result`;
  }
  return null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Classify a NONZERO exit (exit 0 is "not red" and never reaches here).
 *
 * Order matters and only ever tightens: the universal shell rule first; then
 * every check the contract declares must hold (a declared report AND a
 * declared exit set are both necessary); only then is the run "asserted".
 */
export function classifyRed(args: {
  exitCode: number;
  contract: RedContract | null;
  /** Report text when the contract declares one; null when absent/unreadable. */
  reportText?: string | null;
  /** Names the runner in messages. */
  runnerName: string;
  /** Problems with a malformed `red:` block, when there are any. */
  contractProblems?: readonly string[];
}): RedReason {
  const shell = shellFailure(args.exitCode);
  if (shell !== null) return { kind: "wrong", wrong: "could not run", detail: shell, failing: [] };

  const c = args.contract;
  if (c === null) {
    const why =
      args.contractProblems && args.contractProblems.length > 0
        ? `its \`red:\` contract is malformed (${args.contractProblems.join("; ")}), so it is treated as undeclared`
        : "it declares no `red:` contract (`report` or `failed_exit`, docs/CONFIG.md)";
    return {
      kind: "unchecked",
      detail: `exit ${args.exitCode}, and runner '${args.runnerName}' cannot say why: ${why}`,
    };
  }

  let failing: CaseResult[] = [];
  let reportDetail: string | null = null;
  if (c.report !== null) {
    const text = args.reportText ?? null;
    if (text === null) {
      return {
        kind: "wrong",
        wrong: "no result",
        detail: `runner '${args.runnerName}' declares a ${c.report} report but wrote none — it stopped before reporting, or ignores \`{report}\`/$${RED_REPORT_ENV}`,
        failing: [],
      };
    }
    const t = c.report === "junit" ? parseJunit(text) : parseJestJson(text);
    if (t === null) {
      return {
        kind: "wrong",
        wrong: "no result",
        detail: `runner '${args.runnerName}' wrote a report the gate cannot read as ${c.report}`,
        failing: [],
      };
    }
    failing = t.cases.filter((x) => x.status === "failed");
    const errored = t.cases.filter((x) => x.status === "errored");
    const counts = `${plural(t.failed, "failed case")}, ${t.errored} errored, ${t.skipped} skipped, ${t.passed} passed`;
    if (errored.length > 0) {
      const first = errored[0];
      return {
        kind: "wrong",
        wrong: "could not run",
        detail: `${counts} — ${plural(errored.length, "case")} errored before a test body ran (load, collection or setup), e.g. ${first.id}${first.message ? `: ${first.message}` : ""}`,
        failing,
      };
    }
    if (t.failed + t.passed === 0) {
      return {
        kind: "wrong",
        wrong: "nothing ran",
        detail:
          t.skipped > 0
            ? `${counts} — every selected test was skipped`
            : "the report holds no test cases — the selection was empty",
        failing,
      };
    }
    if (t.failed === 0) {
      return {
        kind: "wrong",
        wrong: "passed",
        detail: `${counts} — every test passed, so exit ${args.exitCode} came from something other than a failing test`,
        failing,
      };
    }
    reportDetail = `${c.report} report: ${counts}`;
  }

  if (c.failedExit !== null && !c.failedExit.includes(args.exitCode)) {
    return {
      kind: "wrong",
      wrong: "undeclared exit",
      detail: `exit ${args.exitCode} is not one of runner '${args.runnerName}''s declared failure codes [${c.failedExit.join(", ")}] — by its own contract the eval did not run to a failing test`,
      failing,
    };
  }

  if (reportDetail !== null) {
    return { kind: "asserted", basis: "report", detail: reportDetail, failing };
  }
  return {
    kind: "asserted",
    basis: "exit-contract",
    detail: `exit ${args.exitCode} is a declared failure code of runner '${args.runnerName}' [${c.failedExit!.join(", ")}] — the runner's word; the gate counted no test cases`,
    failing: [],
  };
}
