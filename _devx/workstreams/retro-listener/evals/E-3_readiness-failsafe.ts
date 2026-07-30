// E-3 (P1): session-over readiness fails safe.
// RED until Phase 3 (watcher core) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts sessionOver()'s four readiness cases: fresh transcript → not over;
// idle transcript → over; missing transcript_path → aged against the entry's
// own queue ts (never instantly ready — upstream round-3's fail-open bug);
// undatable hand-edited ts → serves rather than wedging the serial queue.
// Permanent suite: test/learn-watch.test.ts.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const failures: string[] = [];
const home = mkdtempSync(join(tmpdir(), "e3-learn-"));
const IDLE_SECONDS = 15 * 60;
const NOW = Date.parse("2026-07-29T12:00:00.000Z");

try {
  const watch = await import("../../../../src/lib/learn/watch.js").catch(() => null);
  if (!watch) {
    failures.push("src/lib/learn/watch.ts missing — feature not implemented (T3.1)");
  } else {
    const opts = { home, idleSeconds: IDLE_SECONDS, now: () => NOW };

    // (a) fresh transcript (mtime 1 min ago) → session still active.
    const fresh = join(home, "fresh.jsonl");
    writeFileSync(fresh, "{}\n");
    utimesSync(fresh, new Date(NOW - 60_000), new Date(NOW - 60_000));
    if (
      watch.sessionOver(
        { session_id: "s-fresh", transcript_path: fresh, ts: "2026-07-29T10:00:00.000Z" },
        opts,
      ) !== false
    ) {
      failures.push("fresh transcript reported as over — would spawn mid-session");
    }

    // (b) idle transcript (mtime 30 min ago) → over.
    const idle = join(home, "idle.jsonl");
    writeFileSync(idle, "{}\n");
    utimesSync(idle, new Date(NOW - 30 * 60_000), new Date(NOW - 30 * 60_000));
    if (
      watch.sessionOver(
        { session_id: "s-idle", transcript_path: idle, ts: "2026-07-29T10:00:00.000Z" },
        opts,
      ) !== true
    ) {
      failures.push("idle transcript not reported as over — the fallback trigger is dead");
    }

    // (c) missing transcript_path, young entry (queued 1 min ago) → NOT ready.
    if (
      watch.sessionOver(
        { session_id: "s-young", transcript_path: null, ts: new Date(NOW - 60_000).toISOString() },
        opts,
      ) !== false
    ) {
      failures.push(
        "missing transcript + young entry reported ready — fail-open readiness (upstream round-3 bug)",
      );
    }

    // (d) missing transcript_path, old entry (queued 30 min ago) → ready.
    if (
      watch.sessionOver(
        { session_id: "s-old", transcript_path: null, ts: new Date(NOW - 30 * 60_000).toISOString() },
        opts,
      ) !== true
    ) {
      failures.push("missing transcript + aged-out entry not ready — entries would wait forever");
    }

    // (e) undatable hand-edited ts (strict parse must reject a date-only
    //     string even though lenient Date.parse accepts it) → serves.
    if (
      watch.sessionOver({ session_id: "s-undatable", transcript_path: null, ts: "2026-07-28" }, opts) !==
      true
    ) {
      failures.push("undatable hand-edited entry does not serve — wedges the serial queue");
    }
    if (typeof watch.queuedAt === "function" && watch.queuedAt({ ts: "2026-07-28" }) !== null) {
      failures.push("queuedAt parses a date-only string — strict ISO regex required, not Date.parse");
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-3 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-3 PASS — readiness fails safe");
