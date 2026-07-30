// E-2 (P0): the listener is inert inside a spawned retro (DEVX_RETRO=1).
// RED until Phase 1 merges. Runnable standalone: `npx tsx <this file>`.
// Asserts 0 queue writes and 0 marker writes under the guard across a
// nudge-bearing Stop, a SessionEnd, and garbage — the mechanical bound on
// the retro-of-retro loop (each fork gets a fresh session id, so dedupe
// alone can never cap the depth). Permanent suite: test/learn-listener.test.ts.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

function markerProse(): string {
  const body = readFileSync(join(repoRoot, ".claude", "commands", "devx-learn.md"), "utf8");
  const after = body.split("<!-- nudge-canonical -->")[1] ?? "";
  return after.trim().split(/\n\n/)[0].replace(/\s+/g, " ").trim();
}

const home = mkdtempSync(join(tmpdir(), "e2-learn-"));
try {
  const listener = await import("../../../../src/lib/learn/listener.js").catch(() => null);
  if (!listener) {
    failures.push("src/lib/learn/listener.ts missing — feature not implemented (T1.3)");
  } else {
    const env = { DEVX_LEARN_HOME: home, DEVX_RETRO: "1" };
    const payloads: Array<unknown> = [
      {
        hook_event_name: "Stop",
        session_id: "ffff-9999",
        transcript_path: join(home, "t.jsonl"),
        cwd: repoRoot,
        last_assistant_message: `retro quoting the sentence: ${markerProse()}`,
      },
      { hook_event_name: "SessionEnd", session_id: "ffff-9999", reason: "exit" },
      { garbage: true },
    ];
    for (const p of payloads) {
      try {
        await listener.handleHookPayload(p, env);
      } catch (e) {
        failures.push(`guarded call threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (existsSync(join(home, "learn-queue.jsonl"))) {
      failures.push("DEVX_RETRO=1 Stop wrote a queue entry — the guard is not mechanical");
    }
    const markers = join(home, "markers");
    if (existsSync(markers) && readdirSync(markers).length > 0) {
      failures.push("DEVX_RETRO=1 SessionEnd wrote a marker — the guard must return before any write");
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-2 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-2 PASS — retro guard is mechanical");
