// E-4 (P1): claim contention is not failure (FR-3, CAP-3). RED until Phase 4
// merges. Runnable standalone: `npx tsx <this file>`.
// Simulates the lost-push race: the fixture's origin/main is advanced by a
// "peer" clone after the local checkout last fetched, so the claim commit's
// push is rejected non-fast-forward. Asserts the claim rebases + retries and
// lands (today: ClaimError('git-push'), rollback, no retry — race R2).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, mkRepoFixture, runCli } from "./_fixture.js";

const failures: string[] = [];

const fx = mkRepoFixture({
  prefix: "e4-contend",
  items: [["cd56ef", "fixture-one"]],
  withOrigin: true,
});
let peer: string | null = null;

try {
  // Peer pushes an unrelated commit to origin/main behind the fixture's back.
  peer = mkdtempSync(join(tmpdir(), "e4-peer-"));
  git(peer, "clone", fx.originDir!, "checkout");
  const peerRepo = join(peer, "checkout");
  git(peerRepo, "commit", "--allow-empty", "-m", "peer: race winner", "--no-gpg-sign");
  git(peerRepo, "push", "origin", "main");

  // Now the fixture's claim push is non-fast-forward.
  const res = runCli(["devx-helper", "claim", "cd56ef"], fx.root);
  if (res.status !== 0) {
    failures.push(
      `claim under a lost push race exited ${res.status} instead of rebase-retrying to success — contention retry not implemented (T4.1): ${(res.stderr || res.stdout).slice(0, 250)}`,
    );
  } else {
    // The claim commit must actually be on origin/main after the retry.
    const originLog = git(fx.root, "ls-remote", "origin", "refs/heads/main");
    const localHead = git(fx.root, "rev-parse", "main").trim();
    if (!originLog.includes(localHead)) {
      failures.push(
        "claim reported success but the claim commit is not at origin/main tip — retry landed nothing",
      );
    }
  }
} finally {
  rmSync(fx.root, { recursive: true, force: true });
  if (fx.originDir) rmSync(fx.originDir, { recursive: true, force: true });
  if (peer) rmSync(peer, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-4 RED — lost claim races are still hard failures:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-4 GREEN — a raced claim rebases, retries, and lands on origin/main.",
);
