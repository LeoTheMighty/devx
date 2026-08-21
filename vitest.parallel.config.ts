// Pass 1 of `npm test` — everything EXCEPT the sync-blocking files, at full
// parallelism. These are the async-sensitive tests whose timers were being
// starved by concurrent spawnSync blockers (debug-7c1e93); with the blockers
// held back to pass 2, they get a machine that can actually schedule them.
//
// Spec: debug/debug-7c1e93-2026-08-04T10:45-loop-concurrency-suite-load-timeout.md

import { defineConfig } from "vitest/config";

import { SYNC_BLOCKING_TESTS, baseTest, resultsPath } from "./vitest.shared.js";

export default defineConfig({
  test: {
    ...baseTest,
    // Human reporter AND a durable json one (b7f2c1). The `default` entry
    // keeps the terminal output identical; the json file is what survives a
    // truncated capture of a 50-minute run.
    reporters: ["default", ["json", { outputFile: resultsPath("parallel") }]],
    exclude: [...baseTest.exclude, ...SYNC_BLOCKING_TESTS],
  },
});
