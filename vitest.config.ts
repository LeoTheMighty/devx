// Vitest config for @devx/cli (cli301).
//
// This is the DEFAULT config — it includes every test file, so ad-hoc runs
// (`npx vitest run test/foo.test.ts`) keep working unchanged.
//
// `npm test` does NOT use this one. It runs two passes instead
// (vitest.parallel.config.ts then vitest.blocking.config.ts) so that
// sync-blocking files cannot CPU-starve the async-sensitive majority — see
// vitest.shared.ts for the measurements behind that split (debug-7c1e93).
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

import { baseTest } from "./vitest.shared.js";

export default defineConfig({ test: { ...baseTest } });
