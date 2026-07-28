// E-1 (P0): overlapping two-loop harness — safety without partitioning
// (G-1, UC-4, CAP-2/3/7, FR-2/3). RED until Phase 4 merges (multi-instance
// admission lands in Phase 5; this eval's admission clause goes green there).
// Runnable standalone: `npx tsx <this file>`.
//
// Asserts, over one fixture repo with fully overlapping (absent) scope:
// (a) a second concurrent `devx loop` is NOT refused by a singleton lock
//     (today: exit 1 "a manager or another loop is already running" — the
//     R6/R1 singleton posture this workstream removes),
// (b) both runs register per-run instance files under
//     `.devx-cache/loop/instances/` (today: the dir does not exist),
// (c) concurrent claim contention never aborts a run as a systemic claim
//     failure (today's MAX_CONSECUTIVE_CLAIM_FAILURES misclassification —
//     race R2).
// The merged-union == serial-baseline and DEV.md byte-equality thresholds
// are enforced by the permanent suite this phase lands
// (test/loop-concurrency.test.ts — seeded in-process runLoop pairs); this
// standalone eval pins the process-level contract the suite cannot:
// two real CLI loop processes coexisting on one repo.

import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { cliPath, mkRepoFixture, tsxBin } from "./_fixture.js";

const failures: string[] = [];

// No origin remote: claims fail fast at push, so runs terminate in seconds
// without spawning workers; the assertions here are about coexistence, not
// item completion.
const fx = mkRepoFixture({
  prefix: "e1-overlap",
  items: [
    ["aa1101", "fixture-one"],
    ["bb2202", "fixture-two"],
  ],
  withOrigin: false,
});

interface RunResult {
  status: number;
  out: string;
}

function runLoopProcess(): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [cliPath, "loop", "--max-items", "1"], {
      cwd: fx.root,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        DEVX_CLAUDE_BIN: "/usr/bin/true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? -1, out });
    });
  });
}

try {
  const [a, b] = await Promise.all([
    runLoopProcess(),
    new Promise<RunResult>((r) =>
      setTimeout(() => runLoopProcess().then(r), 300),
    ),
  ]);

  // (a) no singleton refusal.
  const refused = [a, b].filter((r) =>
    /already running|ManagerLockHeld/i.test(r.out),
  );
  if (refused.length > 0) {
    failures.push(
      "second concurrent loop was refused by the singleton manager lock ('already running') — multi-instance loops not implemented (FR-5/T5.2)",
    );
  }

  // (b) per-run instance files.
  const instancesDir = join(fx.root, ".devx-cache", "loop", "instances");
  if (!existsSync(instancesDir)) {
    failures.push(
      ".devx-cache/loop/instances/ was never created — instance registry not implemented (FR-5/T5.1)",
    );
  } else if (readdirSync(instancesDir).length < 2) {
    failures.push(
      `expected 2 instance files, found ${readdirSync(instancesDir).length}`,
    );
  }

  // (c) contention must not be classified as a systemic claim failure.
  const systemic = [a, b].filter((r) =>
    /systemic claim problem|consecutive claim failures/i.test(r.out),
  );
  if (systemic.length > 0) {
    failures.push(
      "a run aborted with the consecutive-claim-failures systemic classification under pure contention — claim-contended classification not implemented (FR-3/T4.2)",
    );
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-1 RED — overlapping loops are not safe/coexistent yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-1 GREEN — two overlapping loop processes coexist: no singleton refusal, both instances registered, contention never systemic.",
);
