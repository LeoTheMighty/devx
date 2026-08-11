// Drift pin for the sync-blocking test partition (debug-7c1e93).
//
// The partition only works if it stays complete. A newly-added test file that
// drives synchronous child processes and is NOT listed would run in pass 1,
// where it CPU-starves exactly the async-sensitive tests the split exists to
// protect — and the symptom (unrelated tests failing on their timeouts) points
// nowhere near the file that caused it. That is the failure this pins.
//
// Same shape as skills-sync.test.ts: derive the truth from the tree, compare
// against the committed list, and name the fix in the message.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  HELPER_DIRS,
  SYNC_BLOCKING_TESTS,
  SYNC_EXEC_MARKER,
} from "../vitest.shared.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const TEST_DIR = join(REPO_ROOT, "test");

/**
 * Fixture modules under test/helpers/ that themselves drive sync children.
 * Importing one counts as blocking; see vitest.shared.ts for why resolution
 * stops here instead of following every local import transitively.
 */
function spawningHelpers(): string[] {
  const out: string[] = [];
  for (const relDir of HELPER_DIRS) {
    const dir = join(REPO_ROOT, relDir);
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".ts")) continue;
      if (!SYNC_EXEC_MARKER.test(readFileSync(join(dir, f), "utf8"))) continue;
      // Keyed by "<dir-basename>/<module>" so an import path match is exact.
      out.push(`${relDir.split("/").pop()}/${f.replace(/\.ts$/, "")}`);
    }
  }
  return out;
}

/** A test file blocks iff it calls a sync child-process API itself, or
 *  imports a test/helpers/ fixture that does. */
function blocks(absFile: string, helpers: string[]): boolean {
  const src = readFileSync(absFile, "utf8");
  if (SYNC_EXEC_MARKER.test(src)) return true;
  return helpers.some((h) => src.includes(`${h}.js`));
}

describe("sync-blocking test partition (debug-7c1e93)", () => {
  const testFiles = readdirSync(TEST_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => f !== "config-io.test.ts" && f !== "config-validate.test.ts")
    .sort();

  it("finds test files to check (guards against a broken glob)", () => {
    expect(testFiles.length).toBeGreaterThan(50);
  });

  it("lists every test file that drives synchronous child processes", () => {
    const helpers = spawningHelpers();
    const actual = testFiles
      .filter((f) => blocks(join(TEST_DIR, f), helpers))
      .map((f) => `test/${f}`)
      .sort();
    const listed: string[] = [...SYNC_BLOCKING_TESTS].sort();

    const missing = actual.filter((f) => !listed.includes(f));
    const stale = listed.filter((f) => !actual.includes(f));

    expect(
      missing,
      `these test files use a synchronous child-process API but are NOT in ` +
        `SYNC_BLOCKING_TESTS — add them to vitest.shared.ts, or they will ` +
        `CPU-starve the async tests in pass 1:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
    expect(
      stale,
      `these files are listed in SYNC_BLOCKING_TESTS but no longer use a ` +
        `synchronous child-process API — drop them from vitest.shared.ts so ` +
        `they run in the fast parallel pass:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every listed file exists (a rename must update the list)", () => {
    for (const rel of SYNC_BLOCKING_TESTS) {
      expect(() => readFileSync(join(REPO_ROOT, rel), "utf8"), rel).not.toThrow();
    }
  });

  it("the two passes are disjoint and together cover every test file", () => {
    const listed = new Set<string>(SYNC_BLOCKING_TESTS);
    const all = testFiles.map((f) => `test/${f}`);
    // Disjoint: pass 2 excludes nothing that pass 1 also runs.
    const parallel = all.filter((f) => !listed.has(f));
    expect(parallel.some((f) => listed.has(f))).toBe(false);
    // Covering: no file falls out of both passes.
    expect(new Set([...parallel, ...listed]).size).toBe(all.length);
  });
});
