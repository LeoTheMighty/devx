<!-- refined: party-mode 2026-04-26 -->

# Epic — devx.config.yaml schema + `devx config` CLI

**Plan:** `plan/plan-a01000-2026-04-26T19:30-foundation.md`
**Slug:** `epic-config-schema`
**Order:** 2 of 5 (Phase 0 — Foundation)
**User sees:** "I can read and write any of the 15 sections of `devx.config.yaml` from the terminal — including hand-edited values — without losing comments or ordering."

## Overview

Ship the canonical JSON schema for `devx.config.yaml` covering all 15 sections from [`docs/CONFIG.md`](../../docs/CONFIG.md), plus a real-functional `devx config` get/set CLI with comment-preserving YAML round-trip. This is the single source of truth that every later epic + every devx command reads and writes.

## Goal

Lock the configuration surface so `/devx-init` (epic 5) has a known target to write into, every other devx command has a known shape to read from, and the user can hand-edit `devx.config.yaml` without fear of losing structure to an automated write.

## End-user flow

1. Leonid runs `devx config mode` — gets back `BETA` (his current project mode), read from the merged project + user config.
2. He runs `devx config capacity.daily_spend_cap_usd 50` — `devx.config.yaml` is rewritten with that one leaf value updated; every comment, blank line, and key order around it is preserved exactly.
3. He runs `devx config notifications.events.ci_failed --user push` — the leaf is written to `~/.devx/config.yaml` instead.
4. He hand-edits a different section of `devx.config.yaml` to change a comment and reorder some keys; reruns `devx config mode YOLO`. His edits are intact; only the `mode:` line changed.
5. He removes a required field by hand. Next devx command run aborts with: `devx.config.yaml missing required key: project.shape — run /devx-init to repair.`

## Frontend changes (CLI)

- New TypeScript module `src/lib/config-io.ts` with: `loadProject()`, `loadUser()`, `loadMerged()`, `setLeaf(path: string[], value: string|number|bool, target: 'project'|'user')`. All built on `eemeli/yaml`'s `parseDocument` mode for comment preservation.
- New TypeScript module `src/lib/config-validate.ts` that validates a parsed config against the embedded JSON schema; reports unknown-key warnings (non-fatal) and missing-required-key errors (fatal) with suggestion `run /devx-init to repair`.
- New CLI command `src/commands/config.ts` registering `devx config get <key>`, `devx config set <key> <value>`, and the shorthand `devx config <key>` (get) and `devx config <key> <value>` (set), all honoring `--user` to write the user-level file. Dotted paths supported (`capacity.daily_spend_cap_usd`).

## Backend changes

None.

## Infrastructure changes

- Embedded JSON schema file `_devx/config-schema.json` (path inside the npm package — NOT under user repo's `_bmad/`). Contains schema for all 15 sections per CONFIG.md. Treated as part of the package; bumps with package version.
- Note: `docs/CONFIG.md § Schema validation` has the schema path as `_bmad/devx/config-schema.json` — that's stale documentation. epic-config-schema corrects it as part of aud103's "recommendations" output (or in its own follow-up MANUAL entry).

## Design principles (from research)

- **Comment preservation is non-negotiable.** Users hand-edit YAML. The instant `devx config set` clobbers their comments, trust evaporates. `eemeli/yaml`'s `parseDocument` is the only Node lib that preserves comments + ordering + anchors round-trip.
- **Leaf-scalar writes only in Phase 0.** Replacing whole sub-trees safely is harder; defer to Phase 1.
- **Project file is canonical for shared settings; user file is canonical for personal settings.** Project overrides user on merge. CLI flags override both. `--user` flag is the explicit opt-in for user-file writes.
- **Schema validation is mandatory at load time, not just at set time.** Every devx command opens the config; every open validates. Cheap; catches drift early.
- **Unknown keys are warnings, not errors.** Devx upgrades may add keys; old configs shouldn't break.
- **Missing required keys (`mode`, `project.shape`) abort.** With a one-line pointer to `/devx-init` for repair. Never silently default what the user must own.

## File structure

```
@devx/cli/                                ← npm package (this epic adds:)
├── _devx/
│   └── config-schema.json                ← JSON schema for all 15 sections
├── src/
│   ├── lib/
│   │   ├── config-io.ts                  ← loadProject / loadUser / loadMerged / setLeaf
│   │   └── config-validate.ts            ← validate against schema
│   └── commands/
│       └── config.ts                     ← `devx config` command
└── test/
    ├── config-io.test.ts                 ← round-trip preservation tests
    ├── config-validate.test.ts           ← unknown-key, missing-required tests
    └── fixtures/
        ├── valid-yaml-with-comments.yaml ← preservation regression fixture
        └── corrupt-missing-mode.yaml     ← validation fixture
```

## Story list with ACs

### cfg201 — JSON schema for all 15 sections of devx.config.yaml
- [ ] `_devx/config-schema.json` validates all 15 sections from `docs/CONFIG.md`
- [ ] Required keys explicit (`mode`, `project.shape` mandatory; everything else optional with defaults)
- [ ] Enums correct: `mode`, `project.shape`, `thoroughness`, `promotion.gate`, `coverage.target`, `qa.layer_2_cadence`, `notifications.events.*` levels, `manager.os_supervisor`
- [ ] Schema validates a complete sample `devx.config.yaml` that includes every section
- [ ] Schema rejects an invalid `mode` value with a useful error message

### cfg202 — YAML round-trip lib using eemeli/yaml
- [ ] `loadProject()` and `loadUser()` parse with `parseDocument` mode
- [ ] `loadMerged()` deep-merges (project overrides user) for reads
- [ ] `setLeaf(path, value, target)` writes via `doc.setIn(path, value)` and serializes with `doc.toString()`
- [ ] Round-trip test: load a YAML with comments + custom key order + anchors, set a leaf value, write back; diff is exactly the one-line scalar change
- [ ] Refuses sub-tree writes in Phase 0; throws with "Phase 0 supports leaf scalar writes only — see Phase 1"

### cfg203 — Config validation on load (errors, warnings, repair pointer)
- [ ] Unknown keys → warning logged to stderr; load succeeds
- [ ] Missing required key (e.g., `mode`) → load aborts with `devx.config.yaml missing required key: <key> — run /devx-init to repair`
- [ ] Out-of-enum value → load aborts with allowed values listed
- [ ] No `devx.config.yaml` at all → load aborts with `no devx.config.yaml — run /devx-init`
- [ ] Validation result wrapped in a typed `Result<Config, ConfigError>` for callers

### cfg204 — `devx config <key>` get/set CLI
- [ ] `devx config get <key>` and `devx config <key>` print merged value to stdout (newline-terminated)
- [ ] `devx config set <key> <value>` and `devx config <key> <value>` write to project file
- [ ] `--user` flag writes to `~/.devx/config.yaml` instead
- [ ] Dotted paths supported (`capacity.daily_spend_cap_usd`, `notifications.events.ci_failed`)
- [ ] Setting an out-of-enum value aborts before write with the same error as cfg203
- [ ] Vitest covers: round-trip with hand-edited YAML, dotted-path get + set, --user flag, enum rejection

## Dependencies

- **External:** Node ≥ 20 (BMAD prereq), npm packages: `commander`, `yaml` (eemeli), `ajv` (or equivalent JSON-schema validator), `vitest`.
- **Repo prerequisites:** None. This epic stands alone; epic-cli-skeleton consumes its outputs.

## Open questions

1. **Where does `~/.devx/config.yaml` live cross-platform?** Linux: `$XDG_CONFIG_HOME/devx/config.yaml` then fall back to `~/.config/devx/config.yaml`; macOS: `~/.devx/config.yaml`; Windows/WSL: `%APPDATA%/devx/config.yaml` or WSL-side `~/.devx/config.yaml`. **Lean: prefer XDG conventions where available; fall back to `~/.devx/`. Decide in story.**
2. **Schema file CONFIG.md path correction.** CONFIG.md says `_bmad/devx/config-schema.json`; correct path is package-embedded. Update CONFIG.md as part of cfg201. (Captured.)

## Party-mode critique (team lenses)

- **PM**: Deliverable is the right shape — schema + working CLI command. Nothing else in Phase 0 ships real behavior, so this carries the working-day weight. Approve. One miss: nothing in cfg204 covers `devx config --list` (printing all keys/values). Add — without it, a user can't quickly inspect the merged config.
- **UX**: Several edge-case friendlies needed — `devx config nonsense.path` should print "no key 'nonsense.path' in schema" + suggest the closest fuzzy-match (`Did you mean: capacity.daily_spend_cap_usd?`); `devx config mode` when `devx.config.yaml` is missing should match cfg203's missing-file error verbatim ("no devx.config.yaml — run /devx-init"); enum-rejection error must list allowed values inline.
- **Frontend (CLI)**: Dotted-path parsing has one footgun: keys with literal dots in the name (e.g., `notifications.events.ci_failed` looks like 3 levels but it's actually two-key + one-bool — schema disambiguates, but writing one with `set` could surprise). Lock: schema rejects keys with literal dots in names (no escape syntax in Phase 0).
- **Backend**: N/A this epic.
- **Infrastructure**: N/A this epic.
- **QA**: cfg202's round-trip fixture is good but should also include a YAML with **anchors + aliases** to verify that preservation. Add to cfg202 ACs.
- **Locked decisions fed forward**:
  - `eemeli/yaml` `parseDocument` mode (NOT `js-yaml`) is the canonical YAML library across all devx Node code.
  - Leaf-scalar writes only in Phase 0; sub-tree writes are a Phase 1 follow-up. Documented in cfg202.
  - User-config path: XDG-on-Linux (`$XDG_CONFIG_HOME/devx/config.yaml` → fall back to `~/.config/devx/config.yaml`) and `~/.devx/config.yaml` on macOS+WSL. (Updated by cfgret 2026-04-27 — earlier draft said `~/.devx/` cross-platform; cfg202 implemented XDG-on-Linux per its spec AC. Fixing the loser per `docs/DESIGN.md § Source-of-truth precedence`.)
  - Required keys: `mode`, `project.shape` (everything else has defaults).
  - Schema ships embedded in npm package at `_devx/config-schema.json` (NOT under `_bmad/` per CONFIG.md's stale path).
  - `devx config --list` added to cfg204 ACs.
  - Friendly error UX (fuzzy-match, listed enum values) added to cfg203 + cfg204.
  - Anchor/alias preservation regression added to cfg202.

## Focus-group reactions

Skipped — YOLO mode.
