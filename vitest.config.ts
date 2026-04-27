// Vitest config for @devx/cli (cli301).
//
// Coverage threshold is sourced from devx.config.yaml → coverage.threshold via
// the existing cfg203 validator (loadValidatedConfig), so this file stays a
// thin reflection of the canonical config. Coverage is informational at YOLO
// (devx.config.yaml → coverage.blocking: false), so vitest is wired with the
// threshold but `thresholds.autoUpdate` and per-line gates do NOT block runs.
// When the project bumps to BETA/PROD, coverage.blocking flips and this same
// threshold becomes the merge gate — no vitest config edit needed.
//
// Spec: dev/dev-cli301-2026-04-26T19:35-cli-package-scaffold.md

import { defineConfig } from "vitest/config";
import { loadValidatedConfig } from "./src/lib/config-validate.js";

const config = loadValidatedConfig() as {
  coverage?: { threshold?: number; enabled?: boolean };
};
const thresholdFraction = config.coverage?.threshold ?? 0;
const thresholdPct = Math.round(thresholdFraction * 100);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // cfg202/cfg203 ship their own zero-dep tsx-runner test files; vitest
    // would discover them but find no `describe`/`it` and fail. Skip them
    // here — they're invoked directly by the `test:config-*` npm scripts.
    // Future tests written against vitest live under test/ with `.test.ts`.
    exclude: [
      "**/node_modules/**",
      "test/config-io.test.ts",
      "test/config-validate.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: thresholdPct,
        functions: thresholdPct,
        branches: thresholdPct,
        statements: thresholdPct,
      },
    },
  },
});
