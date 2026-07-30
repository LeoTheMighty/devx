// E-9 (P0): the spawn wrapper exports the retro guard.
// RED until Phase 4 (spawn.ts) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts buildWrapperCommand() places `DEVX_RETRO=1` ahead of the `claude`
// invocation (the other half of E-2's mechanical self-trigger bound — the
// variable is inherited by every hook the forked retro runs), for the wrapper
// used by all three arms, plus the trap-shape invariants the outcome dataset
// depends on. Permanent suite: test/learn-watch.test.ts.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const failures: string[] = [];

try {
  const spawn = await import("../../../../src/lib/learn/spawn.js").catch(() => null);
  if (!spawn) {
    failures.push("src/lib/learn/spawn.ts missing — feature not implemented (T4.1)");
  } else {
    const sid = "12345678-abcd-4ef0-9876-0123456789ab";
    const cmd = String(spawn.buildWrapperCommand(sid, "/tmp/some repo", "/tmp/markers/x.done"));

    // (a) the guard export precedes the claude invocation.
    const guardIdx = cmd.indexOf("DEVX_RETRO=1");
    const claudeIdx = cmd.indexOf("claude");
    if (guardIdx === -1) {
      failures.push("wrapper carries no DEVX_RETRO=1 — a retro quoting the nudge would queue itself");
    } else if (claudeIdx !== -1 && guardIdx > claudeIdx) {
      failures.push("DEVX_RETRO=1 appears after the claude invocation — the fork won't inherit it");
    }

    // (b) resume-fork shape.
    if (!cmd.includes(`--resume`) || !cmd.includes("--fork-session") || !cmd.includes("/devx-learn")) {
      failures.push("wrapper does not run `claude --resume … --fork-session \"/devx-learn\"`");
    }

    // (c) trap shape: HUP INT TERM trapped, NO EXIT trap (bash defers traps —
    //     both firing would make the recorded outcome ordering-dependent), and
    //     the trap READS $? rather than asserting an outcome (absorbed Ctrl-C
    //     exits 0 and must not be filed as interrupted).
    if (!/trap '[^']*'\s+HUP INT TERM/.test(cmd)) {
      failures.push("wrapper traps no HUP INT TERM — a closed tab (SIGHUP) wedges the queue forever");
    }
    if (/trap '[^']*'[^\n]*EXIT/.test(cmd)) {
      failures.push("wrapper installs an EXIT trap — races the signal trap (upstream design note)");
    }
    if (!cmd.includes("rc=$?")) {
      failures.push("wrapper trap does not read $? — an absorbed Ctrl-C would be mislabelled");
    }

    // (d) marker written via tmp+rename (never read torn) and the cd guard.
    if (!/\.tmp/.test(cmd) || !/mv /.test(cmd)) {
      failures.push("marker write is not tmp+rename — the watcher can read a partial marker");
    }
    if (!cmd.includes("error-cd")) {
      failures.push("wrapper has no cd guard writing error-cd — a moved project dir files as success");
    }

    // (e) session-id validation before argv construction.
    let threw = false;
    try {
      spawn.buildWrapperCommand("$(rm -rf /)", "/tmp", "/tmp/m.done");
    } catch {
      threw = true;
    }
    if (!threw) {
      failures.push("buildWrapperCommand accepts a shell-metacharacter session id — injection guard missing");
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
}

if (failures.length > 0) {
  console.error(`E-9 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-9 PASS — wrapper guard + trap shape hold");
