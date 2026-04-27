#!/usr/bin/env node
// Postinstall — verify `devx` resolves on PATH after `npm i -g @devx/cli`,
// and warn on WSL when the npm prefix sits on the Windows host filesystem.
//
// Warn-only by contract: this script must NEVER throw and must always exit 0.
// A missing PATH entry (or a host-crossover prefix) is recoverable user
// advice, not an install failure. Local (non-global) installs are skipped
// because `devx` is not expected to be on PATH then.
//
// Logic lives in scripts/postinstall-lib.mjs so it's unit-testable without
// spawning Node. This file is the warn-only wrapper.
//
// Spec: dev/dev-cli304-2026-04-26T19:35-cli-version-postinstall.md (PATH check)
//       dev/dev-cli305-2026-04-26T19:35-cli-cross-platform-install.md (WSL host-crossover)

import { runPostinstall } from "./postinstall-lib.mjs";

try {
  runPostinstall();
} catch {
  // Swallow. Postinstall is warn-only; failing `npm i -g` over a probe bug
  // would be worse than a silent miss.
}

process.exit(0);
