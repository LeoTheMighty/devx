// Round-trip + edge-case tests for cfg202 (src/lib/config-io.ts).
//
// Style mirrors test/schema-smoke.mjs (cfg201): plain Node script with a
// manual fail-counter and explicit PASS/FAIL log lines. Vitest takes over in
// cfg204 once @devx/cli lands.
//
// Spec: dev/dev-cfg202-2026-04-26T19:35-config-yaml-roundtrip-lib.md

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  findProjectConfig,
  loadMerged,
  loadProject,
  loadUser,
  setLeaf,
  userConfigPath,
} from "../src/lib/config-io.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const FIXTURE = join(repoRoot, "test/fixtures/valid-yaml-with-comments.yaml");

let failures = 0;

function fail(name: string, msg: string): void {
  failures++;
  console.error(`FAIL  ${name}: ${msg}`);
}

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    pass(name);
  } catch (e: unknown) {
    fail(name, e instanceof Error ? e.message : String(e));
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function withTmpDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "cfg202-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// -- loadProject ----------------------------------------------------------

test("loadProject(path) parses a fixture into a Document", () => {
  const doc = loadProject({ path: FIXTURE });
  assert(doc, "expected Document");
  assertEq(doc.get("alpha"), "alpha-value", "alpha leaf reads back");
});

test("loadProject() walks up to find devx.config.yaml from a nested cwd", () => {
  const found = findProjectConfig(__dirname);
  assert(found, "findProjectConfig returned null");
  assert(
    found!.endsWith("devx.config.yaml"),
    `expected path ending in devx.config.yaml, got ${found}`,
  );
});

test("loadProject throws a clear error when devx.config.yaml is missing", () => {
  withTmpDir((dir) => {
    let threw = false;
    try {
      loadProject({ path: join(dir, "missing.yaml") });
    } catch (e) {
      threw = true;
      assert(
        e instanceof Error && e.message.includes("not found"),
        `expected 'not found' in error, got ${(e as Error).message}`,
      );
    }
    assert(threw, "expected loadProject to throw");
  });
});

// -- loadUser -------------------------------------------------------------

test("loadUser returns null when the user file does not exist", () => {
  withTmpDir((dir) => {
    const path = join(dir, "user.yaml");
    const doc = loadUser({ path });
    assertEq(doc, null, "missing user file should return null");
  });
});

test("loadUser parses a real user file when present", () => {
  withTmpDir((dir) => {
    const path = join(dir, "user.yaml");
    writeFileSync(path, "key: from-user\n");
    const doc = loadUser({ path });
    assert(doc, "expected Document");
    assertEq(doc!.get("key"), "from-user", "user leaf reads back");
  });
});

// -- userConfigPath -------------------------------------------------------

test("userConfigPath returns a platform-appropriate path", () => {
  const path = userConfigPath();
  assert(path.endsWith("config.yaml"), `expected ends with config.yaml: ${path}`);
  if (process.platform === "darwin") {
    assert(
      path.includes(".devx"),
      `macOS path should include .devx, got ${path}`,
    );
  } else if (process.platform === "linux") {
    assert(
      path.includes("devx"),
      `linux path should include devx, got ${path}`,
    );
  }
});

// -- loadMerged -----------------------------------------------------------

test("loadMerged: project overrides user, user-only keys survive, returns plain JS", () => {
  withTmpDir((dir) => {
    const userFile = join(dir, "user.yaml");
    writeFileSync(
      userFile,
      "alpha: user-alpha\nbeta: only-in-user\nzeta:\n  inner: user-inner\n",
    );
    const merged = loadMerged({ projectPath: FIXTURE, userPath: userFile }) as {
      alpha: string;
      beta: string;
      zeta: { inner: string; ratio: number };
    };
    assertEq(merged.alpha, "alpha-value", "project alpha overrides user alpha");
    assertEq(merged.beta, "only-in-user", "user-only key beta survives");
    assertEq(
      merged.zeta.inner,
      "original-value",
      "project zeta.inner overrides user zeta.inner",
    );
    assertEq(merged.zeta.ratio, 0.42, "project zeta.ratio surfaces");
  });
});

test("loadMerged works when no user file exists", () => {
  withTmpDir((dir) => {
    const merged = loadMerged({
      projectPath: FIXTURE,
      userPath: join(dir, "absent.yaml"),
    }) as { alpha: string };
    assertEq(merged.alpha, "alpha-value", "project still loads without user");
  });
});

// -- setLeaf round-trip (the headline AC) ---------------------------------

test("setLeaf: round-trip preserves comments, key order, anchors, structure", () => {
  withTmpDir((dir) => {
    const projectFile = join(dir, "devx.config.yaml");
    const original = readFileSync(FIXTURE, "utf8");
    writeFileSync(projectFile, original);

    setLeaf(["zeta", "inner"], "new-value", "project", {
      projectPath: projectFile,
    });

    const updated = readFileSync(projectFile, "utf8");
    const origLines = original.split("\n");
    const newLines = updated.split("\n");

    assertEq(
      newLines.length,
      origLines.length,
      `line count diverged: ${origLines.length} → ${newLines.length}`,
    );

    const diffs: number[] = [];
    for (let i = 0; i < origLines.length; i++) {
      if (origLines[i] !== newLines[i]) diffs.push(i);
    }
    assertEq(
      diffs.length,
      1,
      `expected exactly 1 line change; got ${diffs.length} (${diffs.join(",")})`,
    );

    const changed = newLines[diffs[0]];
    assert(
      changed.includes("new-value"),
      `changed line missing new-value: '${changed}'`,
    );
    assert(
      changed.includes("# inline comment on the leaf we modify"),
      `inline comment lost on changed line: '${changed}'`,
    );
    assert(
      !updated.includes("original-value"),
      "old value should not survive anywhere in the document",
    );

    // Anchors + aliases must still resolve structurally on re-parse.
    // `merge: true` resolves YAML 1.1 merge keys (<<: *anchor); off by default
    // in eemeli/yaml v2 (which targets YAML 1.2).
    const reparsed = parseYaml(updated, { merge: true }) as {
      services: {
        api: { retries: number; timeout: number; name: string };
        worker: { retries: number; timeout: number; name: string };
      };
      defaults: { retries: number; timeout: number };
      list_section: string[];
    };
    assertEq(reparsed.defaults.retries, 3, "defaults.retries preserved");
    assertEq(
      reparsed.services.api.retries,
      3,
      "alias resolves: services.api.retries === 3",
    );
    assertEq(
      reparsed.services.worker.timeout,
      30,
      "alias resolves: services.worker.timeout === 30",
    );
    assertEq(
      reparsed.list_section.length,
      3,
      "list_section length preserved",
    );

    // Top-level key order: zeta must still come before alpha.
    const zetaIdx = updated.indexOf("\nzeta:");
    const alphaIdx = updated.indexOf("\nalpha:");
    assert(zetaIdx >= 0, "zeta key missing");
    assert(alphaIdx >= 0, "alpha key missing");
    assert(
      zetaIdx < alphaIdx,
      "custom key order (zeta before alpha) was rewritten",
    );
  });
});

test("setLeaf: numeric leaf round-trips and writes a number, not a quoted string", () => {
  withTmpDir((dir) => {
    const projectFile = join(dir, "devx.config.yaml");
    writeFileSync(projectFile, readFileSync(FIXTURE, "utf8"));
    setLeaf(["zeta", "ratio"], 0.99, "project", { projectPath: projectFile });
    const reparsed = parseYaml(readFileSync(projectFile, "utf8")) as {
      zeta: { ratio: number };
    };
    assertEq(reparsed.zeta.ratio, 0.99, "ratio updated to 0.99");
  });
});

// -- Phase-0 leaf-only enforcement ---------------------------------------

test("setLeaf rejects a sub-tree path (existing value is a Map)", () => {
  withTmpDir((dir) => {
    const projectFile = join(dir, "devx.config.yaml");
    writeFileSync(projectFile, readFileSync(FIXTURE, "utf8"));
    let threw = false;
    try {
      setLeaf(["services", "api"], "lol", "project", {
        projectPath: projectFile,
      });
    } catch (e) {
      threw = true;
      assert(
        e instanceof Error &&
          e.message.includes("Phase 0 supports leaf scalar writes only"),
        `wrong error: ${(e as Error).message}`,
      );
    }
    assert(threw, "setLeaf should throw on sub-tree path");
  });
});

test("setLeaf rejects a non-scalar value", () => {
  withTmpDir((dir) => {
    const projectFile = join(dir, "devx.config.yaml");
    writeFileSync(projectFile, readFileSync(FIXTURE, "utf8"));
    let threw = false;
    try {
      // Cast through unknown to violate the type contract on purpose — the
      // runtime guard is what we're testing.
      setLeaf(
        ["zeta", "inner"],
        { nested: "obj" } as unknown as string,
        "project",
        { projectPath: projectFile },
      );
    } catch (e) {
      threw = true;
      assert(
        e instanceof Error &&
          e.message.includes("Phase 0 supports leaf scalar writes only"),
        `wrong error: ${(e as Error).message}`,
      );
    }
    assert(threw, "setLeaf should throw on object value");
  });
});

test("setLeaf rejects an empty path", () => {
  withTmpDir((dir) => {
    const projectFile = join(dir, "devx.config.yaml");
    writeFileSync(projectFile, readFileSync(FIXTURE, "utf8"));
    let threw = false;
    try {
      setLeaf([], "v", "project", { projectPath: projectFile });
    } catch (e) {
      threw = true;
      assert(
        e instanceof Error &&
          e.message.includes("Phase 0 supports leaf scalar writes only"),
        `wrong error: ${(e as Error).message}`,
      );
    }
    assert(threw, "setLeaf should throw on empty path");
  });
});

// -- Atomicity ------------------------------------------------------------

test("setLeaf is atomic: no .tmp.* files linger after a successful write", () => {
  withTmpDir((dir) => {
    const projectFile = join(dir, "devx.config.yaml");
    writeFileSync(projectFile, readFileSync(FIXTURE, "utf8"));
    setLeaf(["zeta", "ratio"], 0.55, "project", { projectPath: projectFile });
    const stragglers = readdirSync(dir).filter((n) => n.includes(".tmp."));
    assertEq(stragglers.length, 0, `tmp file leaked: ${stragglers.join(",")}`);
    assert(existsSync(projectFile), "target file missing after rename");
  });
});

test("setLeaf creates a new user file when it doesn't exist yet", () => {
  withTmpDir((dir) => {
    const userFile = join(dir, "subdir/config.yaml");
    setLeaf(["mode"], "BETA", "user", { userPath: userFile });
    assert(existsSync(userFile), "user file should be created");
    const reparsed = parseYaml(readFileSync(userFile, "utf8")) as {
      mode: string;
    };
    assertEq(reparsed.mode, "BETA", "mode written");
  });
});

// -- Summary --------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} cfg202 test(s) failed`);
  process.exit(1);
}
console.log("\nAll cfg202 round-trip tests passed.");
