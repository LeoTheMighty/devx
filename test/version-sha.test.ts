// pin104 — version surface with git-SHA build provenance.
//
// resolveVersion() composes `<semver>+<sha>` when dist/build-info.json
// exists and plain semver when it doesn't. The standalone E-5 eval
// (_devx/workstreams/portability-install/evals/E-5_version-sha.ts) covers
// the built-CLI end of the same contract.
//
// Spec: dev/dev-pin104-2026-07-14T12:03-install-global-sha-docs.md

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveVersion } from "../src/lib/version.js";

const tmpDirs: string[] = [];

function makePkgRoot(opts: { version?: string; buildInfo?: unknown }): string {
  const root = mkdtempSync(join(tmpdir(), "pin104-version-"));
  tmpDirs.push(root);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "fixture", version: opts.version ?? "1.2.3" }),
  );
  if (opts.buildInfo !== undefined) {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(
      join(root, "dist", "build-info.json"),
      typeof opts.buildInfo === "string" ? opts.buildInfo : JSON.stringify(opts.buildInfo),
    );
  }
  return root;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("pin104 — resolveVersion", () => {
  it("composes <semver>+<sha> when build-info exists", () => {
    const root = makePkgRoot({ buildInfo: { sha: "9f7cdef", builtAt: "2026-07-15T10:00:00Z" } });
    const v = resolveVersion({ pkgRoot: root });
    expect(v).toBe("1.2.3+9f7cdef");
    expect(v).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{7,}$/m);
  });

  it("reports plain semver without build-info", () => {
    const root = makePkgRoot({});
    expect(resolveVersion({ pkgRoot: root })).toBe("1.2.3");
  });

  it("treats malformed build-info as absent (provenance is best-effort)", () => {
    expect(resolveVersion({ pkgRoot: makePkgRoot({ buildInfo: "{ nope" }) })).toBe("1.2.3");
    expect(resolveVersion({ pkgRoot: makePkgRoot({ buildInfo: { sha: "NOT-HEX" } }) })).toBe(
      "1.2.3",
    );
  });

  it("throws on a missing/invalid package.json semver (broken install fails loud)", () => {
    const root = mkdtempSync(join(tmpdir(), "pin104-version-"));
    tmpDirs.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture" }));
    expect(() => resolveVersion({ pkgRoot: root })).toThrow(/no string "version"/);
  });

  it("the real repo resolves to the package semver shape (with or without provenance)", () => {
    expect(resolveVersion()).toMatch(/^\d+\.\d+\.\d+(\+[0-9a-f]{7,})?$/m);
  });
});
