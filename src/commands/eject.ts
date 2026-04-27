// `devx eject` — Phase 10 stub (epic-eject-cli).
//
// LOAD-BEARING: this stub MUST be a pure stderr write. No filesystem reads, no
// child processes, no env mutation, no `.devx-cache/` cleanup — nothing.
// Leonid's signature red flag #1 is destructive surprise; the eject Phase-0
// stub doing real work would be exactly that. test/eject-noop.test.ts pins the
// "no side effects" property by snapshotting a fixture repo before/after and
// failing CI on any drift. If you find yourself wanting to add behavior here,
// you are working on epic-eject-cli (Phase 10), not cli302 — open a new spec.
//
// Phase + epic mapping locked by dev/dev-cli302-2026-04-26T19:35-cli-stubs.md.

import { defineStubCommand } from "../lib/stub.js";

export const { register, handler, name, phase, epic } = defineStubCommand(
  "eject",
  10,
  "epic-eject-cli",
);
