// pin101 — E-1: skill bodies ship in the npm tarball.
//
// Subprocess smoke against the REAL `npm pack --dry-run --json` manifest —
// not an in-process approximation of the `files` globbing (LEARN cli301 E6:
// npm's include/exclude rules are subtle enough that only the real packer's
// answer counts).
//
// Spec: dev/dev-pin101-2026-07-14T12:00-packaged-skills-mirror.md

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_SKILLS = ["skills/devx.md", "skills/devx-plan.md", "skills/devx-interview.md"];

let manifestPaths: Set<string>;

beforeAll(() => {
  const r = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  expect(r.status, `npm pack --dry-run --json failed: ${r.stderr?.slice(0, 300)}`).toBe(0);
  // npm may prepend notices to stdout; the JSON array starts at the first '['.
  const start = r.stdout.indexOf("[");
  expect(start, "npm pack --dry-run --json produced no JSON array").toBeGreaterThanOrEqual(0);
  const manifest = JSON.parse(r.stdout.slice(start)) as Array<{
    files?: Array<{ path?: string }>;
  }>;
  manifestPaths = new Set(
    (manifest[0]?.files ?? []).map((f) => (f.path ?? "").replace(/\\/g, "/")),
  );
}, 120_000);

describe("pin101 — npm pack manifest carries the packaged skills", () => {
  it.each(EXPECTED_SKILLS)("tarball contains %s", (path) => {
    expect(
      manifestPaths.has(path),
      `${path} missing from pack manifest — check package.json → files`,
    ).toBe(true);
  });

  it("sanity: manifest is non-trivial (dist + templates still packed)", () => {
    expect(manifestPaths.size).toBeGreaterThan(3);
    expect(manifestPaths.has("package.json")).toBe(true);
  });
});
