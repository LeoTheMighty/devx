// Durable failure evidence for long gate runs (b7f2c1 AC 3 + AC 4).
//
// On 2026-07-29 a ~53-minute gate reported `1 failed | 2664 passed (2665)`
// and the failing test could not be identified: vitest's default reporter
// prints failure DETAIL above the summary, so the capture that retained a
// tail kept the four summary lines and dropped the diagnosis. Disproving it
// cost a 52-minute re-run, and the name was ultimately recovered from CI —
// not from the local capture at all.
//
// Both vitest passes now run a json reporter alongside the human one,
// writing under `.devx-cache/test-results/` (gitignored). This file is the
// check that the arrangement actually holds — a config that silently stopped
// writing the file would otherwise be discovered the next time a 50-minute
// run went red, which is the worst possible moment.
//
// AC 4 is verified by running THIS REPO'S OWN parallel config against a
// deliberately-failing temp test file and reading what it leaves on disk.
// Asserting on a green run's results file would only prove that something
// gets written; the whole point is what survives a RED one — and running a
// hand-written config in a scratch project would prove that some config
// works, not the one `npm test` actually uses.
//
// Spec: test/test-b7f2c1-2026-07-29T11:46-unidentified-suite-flake.md

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resultsPath } from "../vitest.shared.js";

const REPO_ROOT = resolve(__dirname, "..");

/** The probe file AC 4 writes into `test/`. Named `zz-` so it sorts last and
 *  is unmistakable, and removed by BOTH the test's own `finally` and this
 *  hook — a leftover would be a permanently-failing test file in the suite
 *  directory, which is a worse bug than the one this file guards. */
const PROBE = join(REPO_ROOT, "test", "zz-b7f2c1-probe.test.ts");
afterEach(() => rmSync(PROBE, { force: true }));

describe("AC 3 — both passes are configured to write a durable result file", () => {
  it("names a distinct file per pass, under the gitignored cache dir", () => {
    expect(resultsPath("parallel")).toBe(".devx-cache/test-results/parallel.json");
    expect(resultsPath("blocking")).toBe(".devx-cache/test-results/blocking.json");
    // Under `.devx-cache/` specifically: gitignored, and already where every
    // other durable run artifact lives.
    expect(resultsPath("parallel").startsWith(".devx-cache/")).toBe(true);
  });

  it("both configs register the json reporter ALONGSIDE the human one", () => {
    // Read the configs as text rather than importing them: the point is that
    // a future edit cannot drop the reporter without this failing, and an
    // import would resolve defaults that hide the omission.
    for (const cfg of ["vitest.parallel.config.ts", "vitest.blocking.config.ts"]) {
      const src = readFileSync(join(REPO_ROOT, cfg), "utf8");
      expect(src, `${cfg} must keep the human reporter`).toMatch(/"default"/);
      expect(src, `${cfg} must write a json result file`).toMatch(
        /\["json",\s*\{\s*outputFile:\s*resultsPath\(/,
      );
    }
  });

  it("`.devx-cache/` is gitignored, so the results never reach a commit", () => {
    const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\.devx-cache\/$/m);
  });
});

describe("AC 4 — the file NAMES the failing test after a red run", () => {
  it("captures the diagnosis a tail-truncated stdout would have lost", () => {
    // Runs THIS REPO'S OWN parallel config against a deliberately-failing
    // temp test file. Spawning a separate vitest in a scratch project would
    // only prove that some hand-written config works; the thing that has to
    // keep working is the configuration `npm test` actually uses.
    const out = join(REPO_ROOT, resultsPath("parallel"));
    const preserved = existsSync(out) ? readFileSync(out, "utf8") : null;
    writeFileSync(
      PROBE,
      [
        'import { describe, expect, it } from "vitest";',
        'describe("b7f2c1 probe", () => {',
        '  it("passes", () => { expect(1).toBe(1); });',
        '  it("the needle we could not find", () => { expect(1).toBe(2); });',
        "});",
        "",
      ].join("\n"),
    );
    try {
      const r = spawnSync(
        "npx",
        ["vitest", "run", "test/zz-b7f2c1-probe.test.ts", "--config", "vitest.parallel.config.ts"],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      // The run really was red — otherwise this proves nothing.
      expect(r.status).not.toBe(0);

      // Simulate the 2026-07-29 capture: keep only the tail. The diagnosis
      // is NOT in it — that is the whole problem.
      const tail = (r.stdout ?? "").trimEnd().split("\n").slice(-4).join("\n");
      expect(tail).not.toContain("the needle we could not find");

      // ...but it IS on disk, independent of how stdout was captured.
      expect(existsSync(out)).toBe(true);
      const report = JSON.parse(readFileSync(out, "utf8")) as {
        numFailedTests: number;
        testResults: Array<{ assertionResults: Array<{ title: string; status: string }> }>;
      };
      expect(report.numFailedTests).toBe(1);
      const failed = report.testResults
        .flatMap((f) => f.assertionResults)
        .filter((a) => a.status === "failed")
        .map((a) => a.title);
      expect(failed).toEqual(["the needle we could not find"]);
    } finally {
      rmSync(PROBE, { force: true });
      // Put back whatever the real run left, so this test does not leave a
      // one-file report where the suite's own results belong.
      if (preserved !== null) writeFileSync(out, preserved);
      else rmSync(out, { force: true });
    }
  }, 180_000);
});
