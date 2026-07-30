// E-10 (P1): the SessionEnd reason denylist gates the fast path.
// RED until Phase 1 (listener) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts all 6 reason cases for a PENDING session: the 4 denylisted reasons
// (`clear`, `resume`, `bypass_permissions_disabled`, `logout`) write no
// `.ended` marker (the human isn't done, or the spawn could only fail), while
// an unknown reason and an absent reason DO write one — denylist, not
// allowlist, so an upstream rename degrades to the idle fallback, never to
// silence. Permanent suite: test/learn-listener.test.ts.

import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];
const home = mkdtempSync(join(tmpdir(), "e10-learn-"));

try {
  const listener = await import("../../../../src/lib/learn/listener.js").catch(() => null);
  const queue = await import("../../../../src/lib/learn/queue.js").catch(() => null);
  if (!listener || !queue) {
    failures.push("src/lib/learn/listener.ts / queue.ts missing — feature not implemented (T1.3)");
  } else {
    const env = { DEVX_LEARN_HOME: home };
    const sid = "aaaa-1111-bbbb-2222";
    queue.appendPending(home, {
      session_id: sid,
      transcript_path: null,
      cwd: repoRoot,
      ts: "2026-07-29T00:00:00.000Z",
    });
    const marker = join(home, "markers", `${sid}.ended`);

    const cases: Array<[Record<string, unknown>, boolean, string]> = [
      [{ reason: "clear" }, false, "clear (user keeps working in the terminal)"],
      [{ reason: "resume" }, false, "resume"],
      [{ reason: "bypass_permissions_disabled" }, false, "bypass_permissions_disabled"],
      [{ reason: "logout" }, false, "logout (spawn against unauthenticated CLI can only fail)"],
      [{ reason: "some_future_reason" }, true, "unknown reason (denylist, not allowlist)"],
      [{}, true, "absent reason"],
    ];
    for (const [extra, wantMarker, label] of cases) {
      if (existsSync(marker)) unlinkSync(marker);
      await listener.handleHookPayload(
        { hook_event_name: "SessionEnd", session_id: sid, ...extra },
        env,
      );
      const got = existsSync(marker);
      if (got !== wantMarker) {
        failures.push(`${label}: marker ${got ? "written" : "not written"}, want ${wantMarker ? "written" : "not written"}`);
      }
    }

    // Non-pending session: no marker even for a marker-worthy reason (the fast
    // path only serves sessions the queue is waiting on).
    if (existsSync(marker)) unlinkSync(marker);
    await listener.handleHookPayload(
      { hook_event_name: "SessionEnd", session_id: "not-queued-9999", reason: "exit" },
      env,
    );
    if (existsSync(join(home, "markers", "not-queued-9999.ended"))) {
      failures.push("marker written for a session the queue is not waiting on");
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-10 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-10 PASS — SessionEnd denylist gates the fast path");
