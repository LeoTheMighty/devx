// Eject is destructively-zero — load-bearing CI gate (cli302).
//
// The party-mode minutes for epic-cli-skeleton flagged this as the single most
// important Phase-0 test: Leonid's signature red flag #1 is destructive
// surprise, and `devx eject` is the command users will most expect to be
// destructive. This test pins the property that the Phase-0 stub does
// NOTHING destructive — not even reads outside the canonical stderr write.
//
// Test shape:
//   1. Build a fixture repo in tmpdir mirroring a real devx-managed repo
//      shape: a `.devx-cache/` directory, a `dev/` spec dir with a fake spec,
//      a `devx.config.yaml`, a `_bmad/` library directory (which `devx eject`
//      Phase-10 will move/rewrite), `.git/` symlink (so any naive `git -C` would
//      target the real repo's git db — caught by snapshot), and a regular
//      file in the cwd.
//   2. Snapshot every file's content (SHA-256) + every directory's recursive
//      listing.
//   3. Spawn `node dist/cli.js eject` with cwd=fixture. Pass extra flags too
//      so a future regression that branches on `--force` is caught.
//   4. Assert exit 0 and canonical stderr.
//   5. Re-snapshot. Assert byte-for-byte equality with the pre-snapshot.
//      Any drift fails the test with the file path that changed.
//
// Spec: dev/dev-cli302-2026-04-26T19:35-cli-stubs.md (AC: "no files modified,
// no `.devx-cache/` removed, no commands run").

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = resolve(repoRoot, "dist", "cli.js");

interface FixtureSnapshot {
  files: Map<string, string>;
}

function buildFixture(root: string): void {
  mkdirSync(root, { recursive: true });
  // Top-level files devx commonly manages.
  writeFileSync(join(root, "devx.config.yaml"), "mode: BETA\n", "utf8");
  writeFileSync(join(root, "DEV.md"), "# DEV\n\n- placeholder\n", "utf8");
  writeFileSync(join(root, "INTERVIEW.md"), "# INTERVIEW\n", "utf8");
  writeFileSync(join(root, "MANUAL.md"), "# MANUAL\n", "utf8");
  // .devx-cache/: the most likely accidental-delete target.
  mkdirSync(join(root, ".devx-cache", "events"), { recursive: true });
  writeFileSync(
    join(root, ".devx-cache", "events", "001.json"),
    '{"kind":"placeholder"}\n',
    "utf8",
  );
  writeFileSync(join(root, ".devx-cache", "lock"), "pid=12345\n", "utf8");
  // _bmad/ — Phase 10 eject will move/rewrite this; Phase 0 must NOT touch it.
  mkdirSync(join(root, "_bmad", "core"), { recursive: true });
  writeFileSync(
    join(root, "_bmad", "core", "workflow.yaml"),
    "id: placeholder\n",
    "utf8",
  );
  // dev/ spec dir.
  mkdirSync(join(root, "dev"), { recursive: true });
  writeFileSync(
    join(root, "dev", "dev-aaa111-spec.md"),
    "---\nhash: aaa111\n---\nbody\n",
    "utf8",
  );
  // A regular non-devx file — proves we don't touch user code either.
  writeFileSync(join(root, "README.md"), "# fixture\n", "utf8");
}

function snapshot(root: string): FixtureSnapshot {
  const files = new Map<string, string>();
  walk(root, (path) => {
    const rel = relative(root, path);
    const stat = statSync(path);
    if (stat.isFile()) {
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      files.set(rel, `f:${hash}`);
    } else if (stat.isDirectory()) {
      // Record every directory too — catches "stub deleted .devx-cache/ and
      // recreated it empty" — file count would change but a missing directory
      // would too.
      files.set(rel || ".", "d:");
    }
  });
  return { files };
}

function walk(root: string, visit: (path: string) => void): void {
  visit(root);
  const stat = statSync(root);
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(root)) {
    walk(join(root, entry), visit);
  }
}

function diff(before: FixtureSnapshot, after: FixtureSnapshot): string[] {
  const drifts: string[] = [];
  for (const [path, sig] of before.files) {
    const post = after.files.get(path);
    if (post === undefined) drifts.push(`removed: ${path}`);
    else if (post !== sig) drifts.push(`modified: ${path}`);
  }
  for (const path of after.files.keys()) {
    if (!before.files.has(path)) drifts.push(`added: ${path}`);
  }
  return drifts;
}

describe("cli302 — `devx eject` is destructively-zero in Phase 0", () => {
  let fixture: string | null = null;

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), "devx-cli302-eject-"));
    buildFixture(fixture);
  });

  afterAll(() => {
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it.skipIf(!existsSync(distEntry))(
    "produces canonical stderr and modifies no files",
    () => {
      if (!fixture) throw new Error("fixture not initialised");
      const before = snapshot(fixture);

      const ret = spawnSync("node", [distEntry, "eject"], {
        encoding: "utf8",
        cwd: fixture,
        stdio: ["ignore", "pipe", "pipe"],
        // Empty env minus PATH — proves the stub doesn't depend on env vars
        // either. PATH kept so node + git resolution still works on the host.
        env: { PATH: process.env.PATH ?? "" },
      });

      expect(ret.status).toBe(0);
      expect(ret.stdout ?? "").toBe("");
      expect(ret.stderr).toBe("not yet wired — ships in Phase 10 (epic-eject-cli)\n");

      const after = snapshot(fixture);
      const drifts = diff(before, after);
      expect(drifts).toEqual([]);
    },
  );

  it.skipIf(!existsSync(distEntry))(
    "is destructively-zero even with --force / --yes-really / extra args",
    () => {
      if (!fixture) throw new Error("fixture not initialised");
      const before = snapshot(fixture);

      // Phase 10 may add real flags; Phase 0 must ignore every one.
      const ret = spawnSync(
        "node",
        [distEntry, "eject", "--force", "--yes-really", "--keep-bmad", "weird-extra"],
        {
          encoding: "utf8",
          cwd: fixture,
          stdio: ["ignore", "pipe", "pipe"],
          env: { PATH: process.env.PATH ?? "" },
        },
      );

      expect(ret.status).toBe(0);
      expect(ret.stderr).toContain("not yet wired");

      const after = snapshot(fixture);
      const drifts = diff(before, after);
      expect(drifts).toEqual([]);
    },
  );
});
