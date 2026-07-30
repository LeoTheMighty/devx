// `learn:` config reads (rtl102 — src/lib/learn/config.ts).
//
// Shape mirrors test/loop-config.test.ts: defaults, per-key fallback on a
// half-typed config, and the one thing this section has that `loop:` doesn't —
// a three-level home precedence (DEVX_LEARN_HOME env > config `home` >
// default) that must agree byte-for-byte with the listener's config-free
// `learnHome()` when neither override is set. The listener never loads config
// (G-3 latency); if these two resolvers ever disagree, the watcher drains a
// queue the listener isn't writing to.
//
// Spec: dev/dev-rtl102-2026-07-30T09:31-learn-config-section.md
// Plan: _devx/workstreams/retro-listener/plan.md §Phase 2

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LEARN_DEFAULTS,
  learnConfigFrom,
  resolveLearnHome,
} from "../src/lib/learn/config.js";
import { LEARN_HOME_ENV, learnHome } from "../src/lib/learn/queue.js";

describe("learnConfigFrom", () => {
  it("returns design defaults on missing/garbage blobs", () => {
    for (const blob of [
      undefined,
      null,
      42,
      "x",
      [],
      {},
      { learn: null },
      { learn: [] },
      { learn: "nope" },
      { learn: 7 },
    ]) {
      expect(learnConfigFrom(blob)).toEqual(LEARN_DEFAULTS);
    }
  });

  it("defaults match design.md §Interfaces + devx.config.yaml §15c", () => {
    expect(LEARN_DEFAULTS.idleMinutes).toBe(15);
    expect(LEARN_DEFAULTS.retroTimeoutMinutes).toBe(360);
    expect(LEARN_DEFAULTS.home).toBe("~/.claude/devx");
  });

  it("reads a fully-populated learn: block", () => {
    const cfg = learnConfigFrom({
      learn: {
        idle_minutes: 3,
        retro_timeout_minutes: 45,
        home: "/tmp/learn-home",
      },
    });
    expect(cfg).toEqual({
      idleMinutes: 3,
      retroTimeoutMinutes: 45,
      home: "/tmp/learn-home",
    });
  });

  it("accepts fractional minutes (sub-minute windows are legitimate)", () => {
    const cfg = learnConfigFrom({ learn: { idle_minutes: 0.5 } });
    expect(cfg.idleMinutes).toBe(0.5);
  });

  it("falls back per-key on malformed values", () => {
    const cfg = learnConfigFrom({
      learn: {
        idle_minutes: 0, // non-positive → default
        retro_timeout_minutes: "360", // wrong type → default
        home: "   ", // blank → default
      },
    });
    expect(cfg).toEqual(LEARN_DEFAULTS);
  });

  it("rejects every non-finite / non-positive number shape", () => {
    for (const bad of [
      0,
      -1,
      -0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      null,
      "5",
      true,
      [],
      {},
    ]) {
      const cfg = learnConfigFrom({
        learn: { idle_minutes: bad, retro_timeout_minutes: bad },
      });
      expect(cfg.idleMinutes).toBe(LEARN_DEFAULTS.idleMinutes);
      expect(cfg.retroTimeoutMinutes).toBe(LEARN_DEFAULTS.retroTimeoutMinutes);
    }
  });

  it("rejects non-string / blank homes but keeps a padded one trimmed", () => {
    for (const bad of [null, 7, [], {}, "", "  \t "]) {
      expect(learnConfigFrom({ learn: { home: bad } }).home).toBe(
        LEARN_DEFAULTS.home,
      );
    }
    expect(learnConfigFrom({ learn: { home: "  /tmp/h  " } }).home).toBe(
      "/tmp/h",
    );
  });

  it("does not mutate LEARN_DEFAULTS across calls", () => {
    const cfg = learnConfigFrom({ learn: { idle_minutes: 99 } });
    cfg.home = "/scratch";
    expect(LEARN_DEFAULTS.home).toBe("~/.claude/devx");
    expect(LEARN_DEFAULTS.idleMinutes).toBe(15);
  });
});

describe("resolveLearnHome precedence (env > config > default)", () => {
  const configured = { learn: { home: "/tmp/from-config" } };

  it("prefers DEVX_LEARN_HOME over config and default", () => {
    expect(
      resolveLearnHome(configured, { [LEARN_HOME_ENV]: "/tmp/from-env" }),
    ).toBe("/tmp/from-env");
  });

  it("uses config home when the env var is unset or blank", () => {
    expect(resolveLearnHome(configured, {})).toBe("/tmp/from-config");
    expect(resolveLearnHome(configured, { [LEARN_HOME_ENV]: "   " })).toBe(
      "/tmp/from-config",
    );
  });

  it("expands a leading ~ in the configured home", () => {
    expect(resolveLearnHome({ learn: { home: "~/retros" } }, {})).toBe(
      join(homedir(), "retros"),
    );
    expect(resolveLearnHome({ learn: { home: "~" } }, {})).toBe(homedir());
    // Only a leading `~` segment expands — `~foo` is a real relative path.
    expect(resolveLearnHome({ learn: { home: "~foo" } }, {})).toBe("~foo");
  });

  it("falls back to the default home on a garbage config", () => {
    expect(resolveLearnHome({ learn: { home: 42 } }, {})).toBe(
      join(homedir(), ".claude", "devx"),
    );
    expect(resolveLearnHome(undefined, {})).toBe(
      join(homedir(), ".claude", "devx"),
    );
  });

  it("agrees with the listener's config-free learnHome() on both no-config paths", () => {
    // G-3: the listener resolves the home WITHOUT loading config. The watcher
    // resolves it WITH config. With nothing configured they must land on the
    // same directory, and an env override must win identically on both sides.
    expect(resolveLearnHome({}, {})).toBe(learnHome({}));
    const env = { [LEARN_HOME_ENV]: "/tmp/shared-home" };
    expect(resolveLearnHome(configured, env)).toBe(learnHome(env));
  });
});

describe("listener path stays config-free (G-3)", () => {
  const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

  // The hook runs at EVERY turn end in every hooked repo under a <500ms p95
  // budget. Reading devx.config.yaml there means a YAML parse + ajv validate
  // + parent-directory walk per turn. This is a structural guard, not a
  // timing one: a future edit that imports the config reader (directly or
  // through this module) into the hook path fails here, in the PR that does
  // it, rather than as a latency regression nobody measures.
  const listenerPath = [
    "lib/learn/listener.ts",
    "lib/learn/queue.ts",
    "lib/learn/nudge.ts",
  ];
  // Static `from "…"` and dynamic `import("…")` both count. `config-io` is on
  // the list because it is the YAML loader itself — the cheapest-looking and
  // therefore likeliest accidental import on this path, and the one that would
  // actually blow the latency budget.
  const banned =
    /(?:from|import\()\s*"[^"]*(config-io|config-validate|learn\/config|\.\/config)\.js"/;

  for (const rel of listenerPath) {
    it(`${rel} imports no config reader`, () => {
      const src = readFileSync(join(srcRoot, rel), "utf8");
      expect(src).not.toMatch(banned);
    });
  }

  // Positive control. A "must not match" guard passes vacuously if the pattern
  // can't match anything, and that failure is invisible: the suite stays green
  // while the guard protects nothing. Pin what it catches AND what it lets by.
  it("the ban pattern matches every config import it claims to catch", () => {
    for (const line of [
      'import { loadMerged } from "../config-io.js";',
      'import { loadValidatedConfig } from "../config-validate.js";',
      'import { learnConfigFrom } from "./config.js";',
      'import { learnConfigFrom } from "../learn/config.js";',
      'const { loadMerged } = await import("../config-io.js");',
    ]) {
      expect(line).toMatch(banned);
    }
    for (const line of [
      'import { containsNudge } from "./nudge.js";',
      'import { writeAtomic } from "../supervisor-internal.js";',
    ]) {
      expect(line).not.toMatch(banned);
    }
  });
});
