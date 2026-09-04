// E-4 (P0): serial watcher — singleton, outcome mapping, malformed entries,
// manual arm, requeue. RED until Phases 3+4 merge. Runnable standalone:
// `npx tsx <this file>`. Permanent suite: test/learn-watch.test.ts.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const failures: string[] = [];
const home = mkdtempSync(join(tmpdir(), "e4-learn-"));

try {
  const watch = await import("../../../../src/lib/learn/watch.js").catch(() => null);
  const queue = await import("../../../../src/lib/learn/queue.js").catch(() => null);
  const spawn = await import("../../../../src/lib/learn/spawn.js").catch(() => null);
  if (!watch || !queue) {
    failures.push("src/lib/learn/watch.ts / queue.ts missing — feature not implemented (T3.x)");
  } else {
    // (a) outcome mapping — the done log is the phase-2 evidence dataset;
    //     an outcome that can't tell "retro ran" from "fork exploded" poisons it.
    const cases: Array<[string | null, string]> = [
      ["0", "completed"],
      ["129", "completed-interrupted"],
      ["error-cd", "error-cd"],
      ["3", "error-fork:3"],
      [null, "timeout"],
    ];
    for (const [marker, want] of cases) {
      const got = watch.mapMarkerToOutcome(marker);
      if (got !== want) {
        failures.push(`mapMarkerToOutcome(${JSON.stringify(marker)}): got '${got}', want '${want}'`);
      }
    }

    // (b) malformed entries classify as error-malformed before prompt/spawn.
    for (const entry of [{ cwd: "/tmp" }, { session_id: "aaaa-1111" }, { session_id: "aaaa-1111", cwd: "" }]) {
      const cls = watch.classifyEntry(entry);
      if (cls !== "error-malformed") {
        failures.push(`classifyEntry(${JSON.stringify(entry)}): got '${cls}', want 'error-malformed'`);
      }
    }
    const ok = watch.classifyEntry({ session_id: "aaaa-1111", cwd: "/tmp" });
    if (ok === "error-malformed") {
      failures.push("classifyEntry rejects a well-formed entry");
    }

    // (c) singleton: second claim while held must refuse.
    const first = watch.claimWatcherSingleton(home);
    let refused = false;
    try {
      const second = watch.claimWatcherSingleton(home);
      if (second && typeof second.release === "function") second.release();
    } catch {
      refused = true;
    }
    if (!refused) {
      failures.push("second claimWatcherSingleton did not throw — two drainers could take one head entry");
    }
    if (first && typeof first.release === "function") first.release();

    // (d) requeue restores the done-log entry keeping its ORIGINAL ts (a
    //     requeued session must be instantly ready, not serve a fresh idle window).
    queue.appendDone(home, {
      session_id: "cccc-3333",
      cwd: "/tmp",
      transcript_path: null,
      ts: "2026-07-29T01:00:00.000Z",
      processed_ts: "2026-07-29T02:00:00.000Z",
      outcome: "completed-interrupted",
    });
    watch.requeueFromDone(home, "cccc-3333");
    const pending = queue.readQueue(home) as Array<Record<string, unknown>>;
    const re = pending.find((e) => e.session_id === "cccc-3333");
    if (!re) {
      failures.push("requeueFromDone put nothing back on the queue");
    } else {
      if (re.ts !== "2026-07-29T01:00:00.000Z") {
        failures.push(`requeue changed ts (got '${String(re.ts)}') — must keep the original`);
      }
      if ("outcome" in re || "processed_ts" in re) {
        failures.push("requeue leaked processed_ts/outcome into the pending entry");
      }
    }

    // (e) manual arm: no tmux + not darwin → selectSpawnArm says manual (the
    //     drain files it immediately and never awaits a marker only a human
    //     could write — upstream's 6h-per-entry queue-hold bug).
    if (!spawn) {
      failures.push("src/lib/learn/spawn.ts missing — feature not implemented (T4.1/T4.2)");
    } else {
      const arm = spawn.selectSpawnArm({}, "linux");
      if (arm !== "manual") {
        failures.push(`selectSpawnArm({}, "linux"): got '${arm}', want 'manual'`);
      }
      if (spawn.selectSpawnArm({ TMUX: "/tmp/tmux-1" }, "linux") !== "tmux") {
        failures.push("selectSpawnArm ignores $TMUX");
      }
      if (spawn.selectSpawnArm({}, "darwin") !== "terminal") {
        failures.push("selectSpawnArm on darwin without tmux should pick terminal");
      }
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-4 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-4 PASS — serial watcher contract holds");
