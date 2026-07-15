// Child-process worker for test/init-failure-append-race.test.ts (debug-9c4e21).
//
// Spawned as `node --import tsx test/fixtures/append-manual-worker.ts
// <manualPath> <goFile> <kind1,kind2,...>`. Spin-waits until <goFile> exists
// (the parent's start barrier — maximizes cross-process overlap), then calls
// the REAL appendManualEntry once per kind against the shared MANUAL.md.
// Emits a JSON summary on stdout so the parent can count appended:true per
// kind across all workers.

import { existsSync } from "node:fs";

import { appendManualEntry } from "../../src/lib/init-failure.js";

const [manualPath, goFile, kindsCsv] = process.argv.slice(2);
if (!manualPath || !goFile || !kindsCsv) {
  process.stderr.write("usage: append-manual-worker <manualPath> <goFile> <kinds>\n");
  process.exit(64);
}

const kinds = kindsCsv.split(",").filter((k) => k.length > 0);

const barrier = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(goFile)) {
  Atomics.wait(barrier, 0, 0, 2);
}

const results: Array<{ kind: string; appended: boolean }> = [];
for (const kind of kinds) {
  const { appended } = appendManualEntry({
    manualPath,
    kind,
    title: `race repro entry for ${kind}`,
    body: `body line one for ${kind}\nbody line two`,
    now: new Date(),
  });
  results.push({ kind, appended });
}

process.stdout.write(JSON.stringify({ results }) + "\n");
