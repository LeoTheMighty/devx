// E-1 (P0): nudge detection + durable enqueue.
// RED until Phase 1 (listener) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts handleHookPayload's Stop arm: verbatim + hard-wrapped nudge → exactly
// one queue entry {session_id, transcript_path, cwd, ts}; reworded → none;
// duplicate session_id → still one; malformed payload → no throw, no write.
// Permanent suite: test/learn-listener.test.ts.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// The canonical sentence, read from the marker — independent of nudge.ts so a
// drifted pattern can't make this eval agree with itself.
function markerProse(): string {
  const body = readFileSync(join(repoRoot, ".claude", "commands", "devx-learn.md"), "utf8");
  const after = body.split("<!-- nudge-canonical -->")[1] ?? "";
  return after.trim().split(/\n\n/)[0].replace(/\s+/g, " ").trim();
}

function stopPayload(sid: string, message: string, home: string): Record<string, unknown> {
  return {
    hook_event_name: "Stop",
    session_id: sid,
    transcript_path: join(home, `${sid}.jsonl`),
    cwd: repoRoot,
    last_assistant_message: message,
  };
}

const home = mkdtempSync(join(tmpdir(), "e1-learn-"));
try {
  const listener = await import("../../../../src/lib/learn/listener.js").catch(() => null);
  const queue = await import("../../../../src/lib/learn/queue.js").catch(() => null);
  if (!listener || !queue) {
    failures.push("src/lib/learn/listener.ts / queue.ts missing — feature not implemented (T1.2/T1.3)");
  } else {
    const env = { DEVX_LEARN_HOME: home };
    const sentence = markerProse();
    const prose = `Wrap-up.\n\n${sentence}\n`;

    // (a) verbatim → exactly one entry with all four fields.
    await listener.handleHookPayload(stopPayload("aaaa-1111", prose, home), env);
    let entries = queue.readQueue(home) as Array<Record<string, unknown>>;
    if (entries.length !== 1) {
      failures.push(`verbatim nudge: expected 1 queue entry, got ${entries.length}`);
    } else {
      for (const field of ["session_id", "transcript_path", "cwd", "ts"]) {
        if (typeof entries[0][field] !== "string" || entries[0][field] === "") {
          failures.push(`verbatim nudge: entry field '${field}' missing/empty`);
        }
      }
    }

    // (b) duplicate session_id → still one.
    await listener.handleHookPayload(stopPayload("aaaa-1111", prose, home), env);
    entries = queue.readQueue(home) as Array<Record<string, unknown>>;
    if (entries.length !== 1) {
      failures.push(`duplicate session_id: expected 1 entry after re-nudge, got ${entries.length}`);
    }

    // (c) hard-wrapped copy (whitespace runs collapse) → detected.
    const wrapped = sentence.replace(/ /g, (m, i) => (i % 40 === 0 ? "\n  " : m));
    await listener.handleHookPayload(stopPayload("bbbb-2222", `x\n${wrapped}`, home), env);
    entries = queue.readQueue(home) as Array<Record<string, unknown>>;
    if (entries.length !== 2) {
      failures.push(`hard-wrapped nudge: expected 2 entries, got ${entries.length}`);
    }

    // (d) reworded → not detected.
    const reworded = sentence.replace("friction", "difficulty");
    await listener.handleHookPayload(stopPayload("cccc-3333", reworded, home), env);
    entries = queue.readQueue(home) as Array<Record<string, unknown>>;
    if (entries.length !== 2) {
      failures.push(`reworded nudge: expected no new entry (2 total), got ${entries.length}`);
    }

    // (e) malformed payload → no throw, queue unchanged.
    try {
      await listener.handleHookPayload({ nonsense: true }, env);
      await listener.handleHookPayload(null, env);
    } catch (e) {
      failures.push(`malformed payload threw: ${e instanceof Error ? e.message : String(e)}`);
    }
    entries = queue.readQueue(home) as Array<Record<string, unknown>>;
    if (entries.length !== 2) {
      failures.push(`malformed payload wrote to the queue (${entries.length} entries)`);
    }

    // (f) no-nudge Stop opens no queue file when none exists yet.
    const home2 = mkdtempSync(join(tmpdir(), "e1-learn-empty-"));
    await listener.handleHookPayload(stopPayload("dddd-4444", "plain wrap-up", home2), {
      DEVX_LEARN_HOME: home2,
    });
    if (existsSync(join(home2, "learn-queue.jsonl"))) {
      failures.push("non-matching Stop created a queue file — the miss path must write nothing");
    }
    rmSync(home2, { recursive: true, force: true });
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-1 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-1 PASS — listener enqueue contract holds");
