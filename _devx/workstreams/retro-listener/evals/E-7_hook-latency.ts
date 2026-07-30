// E-7 (P1, tests-after): hook overhead per Stop event — p95 < 500ms.
// Measured against the BUILT CLI (the hook invokes `devx learn-helper listen`,
// which resolves to dist/), because the per-turn tax the G-3 bound protects is
// the real end-to-end invocation: node startup + dist load + stdin read.
// RED until Phase 1 merges and dist is rebuilt. Runnable standalone:
// `npx tsx <this file>`. Record the measured p95 in the dev spec status log.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];
const home = mkdtempSync(join(tmpdir(), "e7-learn-"));

const cliJs = join(repoRoot, "dist", "cli.js");
if (!existsSync(cliJs)) {
  failures.push("dist/cli.js missing — run `npm run build` first");
} else {
  const payload = JSON.stringify({
    hook_event_name: "Stop",
    session_id: "e7e7-0000",
    transcript_path: null,
    cwd: repoRoot,
    last_assistant_message: "a perfectly ordinary wrap-up with no nudge in it",
  });
  const runs: number[] = [];
  let broken: string | null = null;
  for (let i = 0; i < 20; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [cliJs, "learn-helper", "listen"], {
      input: payload,
      encoding: "utf8",
      env: { ...process.env, DEVX_LEARN_HOME: home },
      timeout: 10_000,
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    runs.push(ms);
    if (r.status !== 0 && broken === null) {
      broken = `exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 200)}`;
    }
  }
  if (broken) {
    failures.push(`\`devx learn-helper listen\` did not exit 0 — subcommand not implemented? (${broken})`);
  } else {
    const sorted = [...runs].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
    console.log(`E-7 measurement: p95 ${p95.toFixed(1)}ms over ${runs.length} runs (min ${sorted[0].toFixed(1)}, max ${sorted[sorted.length - 1].toFixed(1)})`);
    if (p95 >= 500) {
      failures.push(`p95 ${p95.toFixed(1)}ms ≥ 500ms — the hook is too heavy for a per-turn tax (G-3)`);
    }
  }
}

rmSync(home, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`E-7 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-7 PASS — hook latency within the G-3 bound");
