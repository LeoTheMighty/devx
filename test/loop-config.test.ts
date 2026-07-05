// loop: config reads + mode gate (v2l101 — src/lib/loop/config.ts).

import { describe, expect, it } from "vitest";

import {
  LOOP_DEFAULTS,
  MAX_CONSECUTIVE_ABANDONED_ITEMS,
  loopConfigFrom,
  loopModeGate,
} from "../src/lib/loop/config.js";

describe("loopConfigFrom", () => {
  it("returns design defaults on missing/garbage blobs", () => {
    for (const blob of [undefined, null, 42, "x", [], {}]) {
      const cfg = loopConfigFrom(blob);
      expect(cfg).toEqual(LOOP_DEFAULTS);
    }
  });

  it("defaults match v2/04 §3 + devx.config.yaml §15b", () => {
    expect(LOOP_DEFAULTS.maxIterationsPerItem).toBe(8);
    expect(LOOP_DEFAULTS.maxTokensPerItem).toBe(2_000_000);
    expect(LOOP_DEFAULTS.maxConsecutiveFailures).toBe(3);
    expect(LOOP_DEFAULTS.maxItems).toBe(10);
    expect(LOOP_DEFAULTS.maxTotalTokens).toBe(10_000_000);
    expect(LOOP_DEFAULTS.backoffMs).toEqual([60_000, 120_000, 240_000]);
    expect(MAX_CONSECUTIVE_ABANDONED_ITEMS).toBe(3);
  });

  it("reads a fully-populated loop: block", () => {
    const cfg = loopConfigFrom({
      loop: {
        max_iterations_per_item: 5,
        max_tokens_per_item: 100,
        max_consecutive_failures: 2,
        max_items: 3,
        max_total_tokens: 500,
        backoff_ms: [1, 2, 3],
      },
    });
    expect(cfg).toEqual({
      maxIterationsPerItem: 5,
      maxTokensPerItem: 100,
      maxConsecutiveFailures: 2,
      maxItems: 3,
      maxTotalTokens: 500,
      backoffMs: [1, 2, 3],
    });
  });

  it("falls back per-key on malformed values", () => {
    const cfg = loopConfigFrom({
      loop: {
        max_iterations_per_item: 0, // non-positive → default
        max_tokens_per_item: "lots", // wrong type → default
        max_consecutive_failures: -1, // negative → default
        max_items: Number.NaN, // NaN → default
        max_total_tokens: 7.9, // floor → 7
        backoff_ms: ["a", -5, Number.POSITIVE_INFINITY], // filters to empty → default
      },
    });
    expect(cfg.maxIterationsPerItem).toBe(LOOP_DEFAULTS.maxIterationsPerItem);
    expect(cfg.maxTokensPerItem).toBe(LOOP_DEFAULTS.maxTokensPerItem);
    expect(cfg.maxConsecutiveFailures).toBe(LOOP_DEFAULTS.maxConsecutiveFailures);
    expect(cfg.maxItems).toBe(LOOP_DEFAULTS.maxItems);
    expect(cfg.maxTotalTokens).toBe(7);
    expect(cfg.backoffMs).toEqual(LOOP_DEFAULTS.backoffMs);
  });

  it("keeps valid backoff entries, dropping garbage ones", () => {
    const cfg = loopConfigFrom({ loop: { backoff_ms: [1000, "x", 2000] } });
    expect(cfg.backoffMs).toEqual([1000, 2000]);
  });

  it("does not share the default backoff array between calls", () => {
    const a = loopConfigFrom({});
    a.backoffMs.push(999);
    const b = loopConfigFrom({});
    expect(b.backoffMs).toEqual(LOOP_DEFAULTS.backoffMs);
  });
});

describe("loopModeGate (D-6)", () => {
  it("refuses LOCKDOWN entirely", () => {
    const gate = loopModeGate({ mode: "LOCKDOWN" });
    expect(gate.allowed).toBe(false);
    expect(gate.mode).toBe("LOCKDOWN");
    expect(gate.reason).toMatch(/disabled in LOCKDOWN/i);
    expect(gate.reason).toMatch(/D-6/);
  });

  it("refuses lockdown case-insensitively", () => {
    expect(loopModeGate({ mode: "lockdown" }).allowed).toBe(false);
    expect(loopModeGate({ mode: " Lockdown " }).allowed).toBe(false);
  });

  it("allows YOLO / BETA / PROD", () => {
    for (const mode of ["YOLO", "BETA", "PROD", "beta"]) {
      const gate = loopModeGate({ mode });
      expect(gate.allowed).toBe(true);
      expect(gate.mode).toBe(mode.toUpperCase());
    }
  });

  it("FAILS CLOSED on an unreadable config (EC-HIGH-2) — never defaults an unattended run to YOLO", () => {
    for (const blob of [undefined, null, 42, "x", []]) {
      const gate = loopModeGate(blob);
      expect(gate.allowed).toBe(false);
      expect(gate.mode).toBe("UNKNOWN");
      expect(gate.reason).toMatch(/missing or unreadable/);
    }
  });

  it("FAILS CLOSED on a missing/garbage mode key", () => {
    for (const blob of [{}, { mode: "" }, { mode: "   " }, { mode: 42 }, { mode: null }]) {
      const gate = loopModeGate(blob);
      expect(gate.allowed).toBe(false);
      expect(gate.mode).toBe("UNKNOWN");
      expect(gate.reason).toMatch(/no readable `mode:`/);
    }
  });
});

describe("heartbeatIntervalMsFrom (LOW-15 — one knob for writer cadence AND reader window)", () => {
  it("defaults to 60s on missing/garbage config or manager block", async () => {
    const { heartbeatIntervalMsFrom } = await import("../src/lib/loop/config.js");
    for (const blob of [undefined, null, 42, [], {}, { manager: null }, { manager: { heartbeat_interval_s: "x" } }, { manager: { heartbeat_interval_s: 0 } }, { manager: { heartbeat_interval_s: -5 } }]) {
      expect(heartbeatIntervalMsFrom(blob)).toBe(60_000);
    }
  });

  it("reads manager.heartbeat_interval_s — the same knob devx next's freshness window uses", async () => {
    const { heartbeatIntervalMsFrom } = await import("../src/lib/loop/config.js");
    expect(heartbeatIntervalMsFrom({ manager: { heartbeat_interval_s: 10 } })).toBe(10_000);
    expect(heartbeatIntervalMsFrom({ manager: { heartbeat_interval_s: 120 } })).toBe(120_000);
  });

  it("clamps to sensible bounds [5s, 600s]", async () => {
    const { heartbeatIntervalMsFrom, HEARTBEAT_MIN_S, HEARTBEAT_MAX_S } = await import(
      "../src/lib/loop/config.js"
    );
    expect(heartbeatIntervalMsFrom({ manager: { heartbeat_interval_s: 1 } })).toBe(HEARTBEAT_MIN_S * 1000);
    expect(heartbeatIntervalMsFrom({ manager: { heartbeat_interval_s: 10_000 } })).toBe(HEARTBEAT_MAX_S * 1000);
  });
});
