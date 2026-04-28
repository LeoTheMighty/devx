// Verify mergeGateFor is I/O-free (mrg101).
//
// AC: "No I/O inside the function — verified by test that imports the file
// with `fs` and `child_process` shadowed to throw on use."
//
// Strategy: vi.mock factories for fs / node:fs / child_process / node:child_process
// return throwing modules. If src/lib/merge-gate.ts imports either (now or in
// the future), the dynamic import in this test fails — flagging the
// regression. Defense-in-depth: any property access on the mocked module also
// throws, so even a transitive `fs.readFileSync` at runtime would fail.
//
// Spec: dev/dev-mrg101-2026-04-28T19:30-merge-gate-pure-fn.md

import { describe, expect, it, vi } from "vitest";

function throwingModule(name: string): Record<string, unknown> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      throw new Error(
        `merge-gate must not touch ${name}.${String(prop)} — pure function only`,
      );
    },
  };
  const trap = new Proxy<Record<string, unknown>>({}, handler);
  // Return a module-shaped object: `default` plus a Proxy that throws on any
  // named-export access. vitest treats the returned object as the ESM module.
  return new Proxy<Record<string, unknown>>(
    { default: trap },
    {
      get(target, prop) {
        if (prop === "default") return target.default;
        // Allow vitest internals (Symbol.toStringTag, then(...) for promise
        // detection) — only throw for "real" property access.
        if (typeof prop === "symbol") return undefined;
        if (prop === "then" || prop === "__esModule") return undefined;
        throw new Error(
          `merge-gate must not import { ${String(prop)} } from '${name}'`,
        );
      },
    },
  );
}

vi.mock("fs", () => throwingModule("fs"));
vi.mock("node:fs", () => throwingModule("node:fs"));
vi.mock("fs/promises", () => throwingModule("fs/promises"));
vi.mock("node:fs/promises", () => throwingModule("node:fs/promises"));
vi.mock("child_process", () => throwingModule("child_process"));
vi.mock("node:child_process", () => throwingModule("node:child_process"));

describe("mergeGateFor is I/O-free", () => {
  it("imports without touching fs or child_process", async () => {
    const mod = await import("../src/lib/merge-gate.js");
    expect(typeof mod.mergeGateFor).toBe("function");
  });

  it("runs without touching fs or child_process for every mode", async () => {
    const { mergeGateFor } = await import("../src/lib/merge-gate.js");
    const baseSignals = {
      ciConclusion: "success" as const,
      lockdownActive: false,
      blockingReviewComments: 0,
      coveragePctTouched: 1.0,
      count: 0,
      initialN: 0,
    };
    for (const mode of ["YOLO", "BETA", "PROD", "LOCKDOWN", "STAGING"]) {
      expect(() => mergeGateFor(mode, baseSignals)).not.toThrow();
    }
  });
});
