// Tests for scripts/swap-dist.mjs (b931a1).
//
// This is the one piece of the finalize tail with real blast radius: it
// `rm -rf`s a directory and renames the live `dist/` that every `devx`
// invocation on the box loads from. It shipped untested in the first cut,
// and the adversarial review found two ways two concurrent swaps could
// destroy each other — including one that leaves the repo with no `dist/`
// at all and therefore no CLI left to report it.
//
// Spec: dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { swapDist } from "../scripts/swap-dist.mjs";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function repo(opts: { next?: string; live?: string | null; prev?: boolean } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "swap-dist-"));
  roots.push(root);
  if (opts.next !== undefined) {
    mkdirSync(join(root, "dist.next"), { recursive: true });
    writeFileSync(join(root, "dist.next", "cli.js"), opts.next);
  }
  if (opts.live !== null && opts.live !== undefined) {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "cli.js"), opts.live);
  }
  if (opts.prev) {
    mkdirSync(join(root, "dist.prev"), { recursive: true });
    writeFileSync(join(root, "dist.prev", "junk"), "from a swap that died");
  }
  return root;
}

function run(root: string, io: Record<string, unknown> = {}): { code: number; out: string } {
  let out = "";
  const code = swapDist(root, {
    log: (s: string) => {
      out += s;
    },
    warn: (s: string) => {
      out += s;
    },
    ...io,
  }) as number;
  return { code, out };
}

describe("swapDist — the happy path", () => {
  it("installs dist.next as dist and leaves no staging dirs behind", () => {
    const root = repo({ next: "NEW", live: "OLD" });
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("NEW");
    expect(existsSync(join(root, "dist.next"))).toBe(false);
    expect(existsSync(join(root, "dist.prev"))).toBe(false);
    expect(existsSync(join(root, "dist.swap.lock"))).toBe(false);
    expect(out).toContain("dist.next -> dist");
  });

  it("works on a first-ever build with no live dist to displace", () => {
    const root = repo({ next: "FIRST", live: null });
    expect(run(root).code).toBe(0);
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("FIRST");
  });

  it("clears a dist.prev left by a swap that died mid-dance", () => {
    const root = repo({ next: "NEW", live: "OLD", prev: true });
    expect(run(root).code).toBe(0);
    expect(existsSync(join(root, "dist.prev"))).toBe(false);
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("NEW");
  });

  it("refuses without emitting anything when the compile produced no dist.next", () => {
    const root = repo({ live: "OLD" });
    const { code, out } = run(root);
    expect(code).toBe(1);
    // The live build is the good resting state; it must survive.
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("OLD");
    expect(out).toContain("leaving dist/ untouched");
  });
});

describe("swapDist — concurrency (the case the module exists for)", () => {
  it("defers to a live peer's lock instead of racing it", () => {
    // Without the lock, a peer's entry-point `rm -rf dist.prev` deletes the
    // other run's ONLY rollback copy; if that run's second rename then fails,
    // the repo is left with no dist/ at all — no CLI left to report it.
    const root = repo({ next: "MINE", live: "OLD" });
    writeFileSync(
      join(root, "dist.swap.lock"),
      JSON.stringify({ at: Date.now(), pid: 999999 }),
    );
    const { code, out } = run(root);
    expect(code).toBe(0); // a peer installing the same merged HEAD is not a failure
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("OLD");
    expect(existsSync(join(root, "dist.next"))).toBe(true); // untouched, not consumed
    expect(out).toMatch(/another build:swap holds/);
  });

  it("reaps a lock whose holder died and completes the swap", () => {
    const root = repo({ next: "NEW", live: "OLD" });
    writeFileSync(
      join(root, "dist.swap.lock"),
      JSON.stringify({ at: Date.now() - 60 * 60 * 1000, pid: 999999 }),
    );
    const { code } = run(root);
    expect(code).toBe(0);
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("NEW");
    expect(existsSync(join(root, "dist.swap.lock"))).toBe(false);
  });

  it("reaps an unparseable lock body rather than wedging every future swap", () => {
    const root = repo({ next: "NEW", live: "OLD" });
    writeFileSync(join(root, "dist.swap.lock"), "");
    expect(run(root).code).toBe(0);
    expect(readFileSync(join(root, "dist", "cli.js"), "utf8")).toBe("NEW");
  });

  it("releases the lock even when the swap fails", () => {
    const root = repo({ live: "OLD" }); // no dist.next → early refusal
    run(root);
    expect(existsSync(join(root, "dist.swap.lock"))).toBe(false);
  });
});
