// E-3 (P0): spec-lock lifecycle — dead owners reaped, live owners respected
// (FR-4, FR-8, CAP-4, G-3). RED until Phase 3 merges. Runnable standalone:
// `npx tsx <this file>`.
// Asserts (a) a claim against a spec lock whose recorded PID is dead reaps
// the lock and completes in that same attempt (today: LockHeldError forever
// — race R12, live example spec-494590.lock), (b) a legacy-format lock body
// with a LIVE pid is conservatively held (today's behavior — must not
// regress), and (c) the classifier module exists for doctor/db36af to
// consume. The pick-time masking clause is exercised by the permanent suite
// (test/spec-lock.test.ts) and the E-1 harness once Phase 3 lands.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkRepoFixture, runCli } from "./_fixture.js";

const failures: string[] = [];

function writeLegacyLock(root: string, hash: string, pid: number): void {
  const locks = join(root, ".devx-cache", "locks");
  mkdirSync(locks, { recursive: true });
  writeFileSync(
    join(locks, `spec-${hash}.lock`),
    `2026-07-28T0800-${pid}\npid=${pid}\nclaimed_at=2026-07-28T08:00:00-06:00\n`,
  );
}

/** A PID that provably belonged to an already-exited process. */
function deadPid(): number {
  const child = spawnSync("true");
  return child.pid ?? 999999;
}

// (a) dead-owner lock must be reaped and the claim must succeed.
const fxA = mkRepoFixture({
  prefix: "e3-dead",
  items: [["ab12cd", "fixture-one"]],
  withOrigin: true,
});
try {
  writeLegacyLock(fxA.root, "ab12cd", deadPid());
  const res = runCli(["devx-helper", "claim", "ab12cd"], fxA.root);
  if (res.status !== 0) {
    failures.push(
      `claim against a dead-owner spec lock failed (exit ${res.status}) instead of reaping it in the same attempt — lock lifecycle not implemented (T3.2/T3.3): ${(res.stderr || res.stdout).slice(0, 200)}`,
    );
  }
} finally {
  rmSync(fxA.root, { recursive: true, force: true });
  if (fxA.originDir) rmSync(fxA.originDir, { recursive: true, force: true });
}

// (b) live-owner legacy lock stays held — conservative posture must not regress.
const fxB = mkRepoFixture({
  prefix: "e3-live",
  items: [["ef34ab", "fixture-two"]],
  withOrigin: true,
});
try {
  writeLegacyLock(fxB.root, "ef34ab", process.pid);
  const res = runCli(["devx-helper", "claim", "ef34ab"], fxB.root);
  if (res.status === 0) {
    failures.push(
      "claim against a LIVE-owner legacy lock succeeded — live locks were mis-reaped (over-eager reaping)",
    );
  }
} finally {
  rmSync(fxB.root, { recursive: true, force: true });
  if (fxB.originDir) rmSync(fxB.originDir, { recursive: true, force: true });
}

// (c) shared classifier exposed for spec locks (doctor/db36af consumer).
try {
  const mod = await import("../../../../src/lib/devx/spec-lock.js");
  if (typeof (mod as Record<string, unknown>).classifySpecLock !== "function") {
    failures.push(
      "src/lib/devx/spec-lock.ts exists but exports no classifySpecLock — feature incomplete (T3.2)",
    );
  }
} catch {
  failures.push(
    "src/lib/devx/spec-lock.ts missing — spec-lock lifecycle module not implemented (T3.2)",
  );
}

if (failures.length > 0) {
  console.error("E-3 RED — spec-lock lifecycle not implemented yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-3 GREEN — dead owners reaped in one attempt, live legacy owners respected, classifier exported.",
);
