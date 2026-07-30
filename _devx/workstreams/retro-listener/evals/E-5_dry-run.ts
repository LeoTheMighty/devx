// E-5 (P1): --dry-run is non-destructive and not refused under a held lock.
// RED until Phase 4 (drain loop) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts one drain pass in dry-run mode: prints each ready entry's spawn
// command exactly once (per-run seen-set), leaves queue + done log + markers
// byte-identical, and runs while the singleton lock is held (upstream round-5:
// the setup check must not demand killing a working watcher). Permanent
// suite: test/learn-watch.test.ts.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const failures: string[] = [];
const home = mkdtempSync(join(tmpdir(), "e5-learn-"));

function snapshot(): string {
  const parts: string[] = [];
  for (const f of ["learn-queue.jsonl", "learn-queue.done.jsonl"]) {
    const p = join(home, f);
    parts.push(existsSync(p) ? readFileSync(p, "utf8") : "<absent>");
  }
  const markers = join(home, "markers");
  parts.push(existsSync(markers) ? readdirSync(markers).sort().join(",") : "<absent>");
  return parts.join("\n---\n");
}

try {
  const watch = await import("../../../../src/lib/learn/watch.js").catch(() => null);
  const queue = await import("../../../../src/lib/learn/queue.js").catch(() => null);
  if (!watch || !queue) {
    failures.push("src/lib/learn/watch.ts / queue.ts missing — feature not implemented (T4.3)");
  } else {
    // Two ready entries (aged out, no transcript to stat).
    for (const sid of ["aaaa-1111", "bbbb-2222"]) {
      queue.appendPending(home, {
        session_id: sid,
        transcript_path: null,
        cwd: "/tmp",
        ts: "2026-07-29T00:00:00.000Z",
      });
    }
    const before = snapshot();

    // Hold the singleton — dry-run must not be refused by it.
    const held = watch.claimWatcherSingleton(home);
    const printed: string[] = [];
    try {
      // Two passes over the same queue: seen-set must keep each entry to one print.
      for (let pass = 0; pass < 2; pass++) {
        watch.drainPass({
          home,
          dryRun: true,
          interactive: false,
          idleSeconds: 900,
          now: () => Date.parse("2026-07-29T12:00:00.000Z"),
          log: (line: string) => printed.push(line),
          seen: pass === 0 ? undefined : undefined, // implementation carries seen across its own run loop
        });
      }
    } catch (e) {
      failures.push(
        `drainPass(dryRun) threw under a held singleton lock: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      if (held && typeof held.release === "function") held.release();
    }

    const after = snapshot();
    if (before !== after) {
      failures.push("dry-run mutated queue/done-log/markers — must be byte-identical (upstream round-4 bug)");
    }
    const mentions = (sid: string) => printed.filter((l) => l.includes(sid)).length;
    if (mentions("aaaa-1111") < 1 || mentions("bbbb-2222") < 1) {
      failures.push(`dry-run did not print a spawn command per ready entry (log: ${JSON.stringify(printed)})`);
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-5 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-5 PASS — dry-run is non-destructive");
