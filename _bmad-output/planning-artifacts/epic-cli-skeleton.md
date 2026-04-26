<!-- refined: party-mode 2026-04-26 -->

# Epic — devx CLI skeleton (11 commands)

**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Slug:** `epic-cli-skeleton`
**Order:** 3 of 5 (Phase 0 — Foundation)
**User sees:** "Every `devx <subcmd>` either works (`devx config`) or tells me which phase + epic ships it (everyone else). `devx --help` surfaces the whole shape."

## Overview

Ship the npm package `@devx/cli` with the `devx` binary on PATH, all 11 commands from `docs/ROADMAP.md § Phase 0 epic-cli-skeleton` registered. Ten of them are stubs that print to stderr and exit 0 with format `not yet wired — ships in Phase <N> (<epic-slug>)`. The eleventh — `devx config` — is real (delivered by epic-config-schema). `devx --help` lists all 11 with phase + epic annotations so the user sees the shape of the whole system from day 1.

## Goal

Establish the binary surface the OS supervisor units (epic-os-supervisor-scaffold) reference, the `/devx-init` (epic-init-skill) verifies post-install, and every later phase fills in. Surface area first, behavior second.

## End-user flow

1. After `/devx-init` runs (or after manual `npm i -g @devx/cli`), Leonid runs `devx --help`. He sees all 11 commands listed in phase order with `(coming in Phase N)` annotations next to stubs.
2. He runs `devx ui`. Stderr: `not yet wired — ships in Phase 4 (epic-devx-ui-tui)`. Exit code 0. Stdout empty.
3. He runs `devx config mode`. Stdout: `BETA`. Exit code 0. (Real behavior; this command is delivered via epic-config-schema.)
4. He runs `devx eject`. Stderr: `not yet wired — ships in Phase 10 (epic-eject-cli)`. Exit code 0. **Critical: nothing destructive happens.**
5. He runs `devx --version`. Stdout: `0.1.0` (or current package version).
6. launchd / systemd / Task-Scheduler unit files reference `devx` directly; `command -v devx` succeeds.

## Frontend changes (CLI)

- New npm package `@devx/cli`. `package.json` has `bin: { devx: "./dist/cli.js" }`. TypeScript source compiled to `dist/`. `commander` for command dispatch. `vitest` for tests.
- New file `src/cli.ts` — entry point that imports + registers each command from `src/commands/<name>.ts`.
- New helper `src/lib/stub.ts` — `makeStub(phase: number, epic: string)` returns a command handler that prints `not yet wired — ships in Phase ${phase} (${epic})` to stderr and exits 0.
- New stub command files: `src/commands/{ui,serve,tail,kill,restart,status,pause,resume,ask,eject}.ts`.
- `--help` output annotates each stub with `(coming in Phase N — epic-<slug>)`. Sorted by phase, ascending.
- `--version` flag wired to `package.json` version.
- Postinstall script verifies `command -v devx` resolves (warns if not, suggests fix per platform).

## Backend changes

None.

## Infrastructure changes

- Package distribution via npm. `npm publish` flow documented in `mobile/SHIP_IOS.md`-style file `package/SHIP_NPM.md` (or in package README).
- Cross-platform install paths handled via npm's standard `bin` directory: macOS/Linux `~/.npm-global/bin/` or `/usr/local/bin/`; Windows host `%APPDATA%/npm/`; WSL behaves like Linux.
- WSL-specific risk: `npm i -g` from PowerShell lands binaries in the Windows host PATH, not WSL PATH. Detect this in `/devx-init` and warn (covered by epic-init-skill).

## Design principles (from research)

- **Surface area first.** ROADMAP § Phase 0 calls this out: "ship the surface area early so users see the shape." The whole point is that `devx --help` becomes the canonical roadmap users see.
- **Stubs print to stderr, exit 0.** Stdout reserved for real data when wired. Exit 0 lets cron / launchd / pipelines compose `devx` without breaking during phased rollout.
- **Phase + epic in stub message.** Reduces bug noise; surfaces the roadmap inline.
- **`devx eject` is dangerous → its stub does nothing.** Triple-check the eject stub. Leonid's signature red flag #1 is anything destructive surprising him.
- **One file per command.** Cleanest dispatch shape; isolated tests per command. Explicit registration array in `src/cli.ts` (no glob magic).
- **No new runtime.** Node ≥ 20 already required by BMAD.

## File structure

```
@devx/cli/                                ← npm package
├── package.json                          ← bin: { devx: "./dist/cli.js" }
├── tsconfig.json
├── src/
│   ├── cli.ts                            ← entrypoint + command registry
│   ├── lib/
│   │   ├── stub.ts                       ← makeStub helper
│   │   ├── config-io.ts                  ← (from epic-config-schema)
│   │   └── config-validate.ts            ← (from epic-config-schema)
│   └── commands/
│       ├── config.ts                     ← real (epic-config-schema)
│       ├── ui.ts                         ← stub Phase 4
│       ├── serve.ts                      ← stub Phase 4
│       ├── tail.ts                       ← stub Phase 4
│       ├── kill.ts                       ← stub Phase 2
│       ├── restart.ts                    ← stub Phase 2
│       ├── status.ts                     ← stub Phase 2
│       ├── pause.ts                      ← stub Phase 2
│       ├── resume.ts                     ← stub Phase 2
│       ├── ask.ts                        ← stub Phase 2
│       └── eject.ts                      ← stub Phase 10
├── test/
│   ├── stub.test.ts                      ← stub format + exit code tests
│   └── help.test.ts                      ← --help listing tests
└── _devx/
    └── config-schema.json                ← (from epic-config-schema)
```

## Story list with ACs

### cli301 — npm package scaffold + commander dispatch
- [ ] `package.json` with `bin: { devx: "./dist/cli.js" }`, `engines.node: ">=20"`
- [ ] `tsconfig.json` with strict mode
- [ ] `vitest.config.ts` with coverage threshold matching `coverage.threshold` from `devx.config.yaml`
- [ ] `src/cli.ts` registers commands from a static array; `npx devx <subcmd>` dispatches correctly
- [ ] CI green on a smoke test (`devx --help` exits 0)

### cli302 — Stub helper + 10 stub commands registered
- [ ] `src/lib/stub.ts` exports `makeStub(phase, epic)` that prints `not yet wired — ships in Phase ${phase} (${epic})` to stderr and exits 0
- [ ] All 10 stub commands present at `src/commands/<name>.ts`, each calling `makeStub` with correct phase + epic
- [ ] `devx ui` stderr matches `not yet wired — ships in Phase 4 (epic-devx-ui-tui)` exactly; exit 0
- [ ] **`devx eject` is verified to do NOTHING destructive**: dedicated test that runs `devx eject` against a fixture repo and asserts no files modified, no `.devx-cache` removed, no commands run

### cli303 — `devx --help` listing with phase + epic annotations
- [ ] `--help` output lists all 11 commands sorted by phase ascending
- [ ] Each stub annotated `(coming in Phase N — epic-<slug>)`
- [ ] `devx config` listed without "coming" annotation (it works)
- [ ] `--help` snapshot test catches accidental wording drift

### cli304 — `devx --version` + postinstall PATH verification
- [ ] `devx --version` prints package version from `package.json`, exits 0
- [ ] Postinstall script: `node scripts/postinstall.js` runs `command -v devx` (or platform equivalent); on failure prints the exact PATH-fix command for macOS/Linux/WSL
- [ ] Postinstall is non-fatal (warn-only) so `npm i -g` itself doesn't fail

### cli305 — Cross-platform install + WSL PATH detection
- [ ] Manual smoke-test matrix documented in `package/INSTALL.md`: macOS / Ubuntu / WSL2-Ubuntu
- [ ] WSL detection: if `uname -r` contains `microsoft` AND `npm config get prefix` is on `/mnt/c/`, postinstall warns "npm global is on Windows host; recommend `npm config set prefix ~/.npm-global` and add to WSL PATH"
- [ ] Vitest cross-platform CI matrix on macos-latest + ubuntu-latest GitHub Actions runners

## Dependencies

- **Blocks-on:** `epic-config-schema` (provides `src/lib/config-io.ts`, `src/lib/config-validate.ts`, and `src/commands/config.ts`).
- **External:** Node ≥ 20, npm. `commander`, `vitest`. (No new runtimes.)

## Open questions

1. **npm package name.** `@devx/cli`? `devx-cli`? Reserve a scope on npm before publishing? **Lean: `@devx/cli` (scoped); reserve org/scope as part of cli301.**
2. **Where does `dist/` live in the user-installed package?** Standard: published as `dist/` inside the package tarball. User never sees it.
3. **Stub message epic-slug accuracy.** Each stub references its target epic from `docs/ROADMAP.md`. Locked at draft time; refreshed if ROADMAP renames epics. **Lean: lock the names in cli302; if ROADMAP renames, follow up via `LEARN.md`.**

## Party-mode critique (team lenses)

- **PM**: Surface-area-first is the right call per ROADMAP. Approve. One refinement: stub messages are barren — they say "not yet wired" but don't tell the user *what* the command will do when wired. Add a one-line preview after the wiring message: `not yet wired — ships in Phase 4 (epic-devx-ui-tui)\n  preview: launches the local TUI dashboard at .devx-cache/ source`. Reduces "what is this command for?" Q's.
- **UX**: `devx --help` annotation `(coming in Phase N — epic-<slug>)` is good. Worry: 11 commands is a lot to scan. Group by phase in the listing (already in cli303 ACs); add a one-line section header per phase ("Phase 2 — control plane:", "Phase 4 — observability:"). Tested via the snapshot.
- **Frontend (CLI)**: `commander` has known dispatch issues on Windows — `commander` v10+ improved this but verify in cli305. Add: each subcommand's snapshot test for stderr stub format, in addition to the help-text snapshot.
- **Backend**: N/A this epic.
- **Infrastructure**: N/A this epic.
- **QA**: cli302's "eject does nothing destructive" test is the single most important test in Phase 0 — Leonid's #1 red flag is destructive surprise. Make this test load-bearing in CI: it must FAIL CI if any file in the fixture repo changes during `devx eject`. Documented as a hard gate in cli302's ACs.
- **Locked decisions fed forward**:
  - Node TypeScript via `npm i -g @devx/cli` is the locked CLI tech for all of devx.
  - `commander` for dispatch (NOT `cac`); static registration array (NOT glob discovery).
  - Stub message format extended: "not yet wired — ships in Phase N (epic-X)\n  preview: <one-line>"
  - Stubs print to stderr, exit 0.
  - `devx eject` is verified-destructive-zero in Phase 0 and forever — load-bearing CI gate.
  - Help text grouped by phase with section headers.
  - Per-command stderr snapshot tests as a regression net.
  - `devx init` is registered as a 12th non-stubbed command (delivered in epic-init-skill ini506) — counts toward "11 commands plus init".

## Focus-group reactions

Skipped — YOLO mode.
