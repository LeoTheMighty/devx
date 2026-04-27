// Load-time validator tests for cfg203 (src/lib/config-validate.ts).
//
// Style matches test/config-io.test.ts (cfg202): plain Node script via tsx
// with a manual fail-counter and PASS/FAIL log lines. Vitest takes over in
// cfg204 once @devx/cli lands.
//
// Covers the full AC matrix:
//   - happy path (real project devx.config.yaml + sample-config-full.yaml)
//   - unknown-key warning (non-fatal, console.warn captured)
//   - missing-required (corrupt-missing-mode.yaml fixture)
//   - out-of-enum (invalid-mode.yaml fixture, reused from cfg201)
//   - no-file (cwd with no devx.config.yaml in any parent)
//   - corrupt-YAML (malformed file)
//   - cache (subsequent loads return same object until clearConfigCache)
//   - schema-loaded-from-disk wiring (default schemaPath resolution)
//
// Spec: dev/dev-cfg203-2026-04-26T19:35-config-validation-on-load.md

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  ConfigError,
  clearConfigCache,
  loadValidatedConfig,
  validate,
} from "../src/lib/config-validate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const SCHEMA_PATH = join(repoRoot, "_devx/config-schema.json");
const SAMPLE_FULL = join(repoRoot, "test/fixtures/sample-config-full.yaml");
const INVALID_MODE = join(repoRoot, "test/fixtures/invalid-mode.yaml");
const CORRUPT_MISSING_MODE = join(
  repoRoot,
  "test/fixtures/corrupt-missing-mode.yaml",
);
const PROJECT_CONFIG = join(repoRoot, "devx.config.yaml");

let failures = 0;

function fail(name: string, msg: string): void {
  failures++;
  console.error(`FAIL  ${name}: ${msg}`);
}

function pass(name: string): void {
  console.log(`PASS  ${name}`);
}

function test(name: string, fn: () => void): void {
  clearConfigCache();
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
  const dir = mkdtempSync(join(tmpdir(), "cfg203-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Capture console.warn output during fn() and return both. */
function captureWarn<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  try {
    const result = fn();
    return { result, warnings };
  } finally {
    console.warn = original;
  }
}

/** Build a minimal real-shaped project layout (devx.config.yaml + _devx/config-schema.json)
 *  inside `dir` from the given config text. Returns the project path. */
function setupProject(dir: string, configText: string): string {
  const projectPath = join(dir, "devx.config.yaml");
  writeFileSync(projectPath, configText);
  mkdirSync(join(dir, "_devx"), { recursive: true });
  copyFileSync(SCHEMA_PATH, join(dir, "_devx/config-schema.json"));
  return projectPath;
}

// -- happy path -----------------------------------------------------------

test("validate accepts the real project devx.config.yaml", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = parseYaml(readFileSync(PROJECT_CONFIG, "utf8"));
  // No throw, no warnings on the real file.
  const { warnings } = captureWarn(() => validate(config, { schema }));
  assertEq(warnings.length, 0, `unexpected warnings on real config: ${warnings.join(" | ")}`);
});

test("validate accepts sample-config-full.yaml (every section)", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = parseYaml(readFileSync(SAMPLE_FULL, "utf8"));
  const { warnings } = captureWarn(() => validate(config, { schema }));
  assertEq(warnings.length, 0, `unexpected warnings on sample-full: ${warnings.join(" | ")}`);
});

test("loadValidatedConfig returns the merged plain JS object", () => {
  withTmpDir((dir) => {
    const projectPath = setupProject(
      dir,
      "mode: YOLO\nproject:\n  shape: empty-dream\n",
    );
    const userPath = join(dir, "user.yaml");
    writeFileSync(userPath, "thoroughness: balanced\n");
    const merged = loadValidatedConfig({
      projectPath,
      userPath,
      reload: true,
    }) as { mode: string; project: { shape: string }; thoroughness: string };
    assertEq(merged.mode, "YOLO", "project mode survives");
    assertEq(merged.project.shape, "empty-dream", "project.shape survives");
    assertEq(merged.thoroughness, "balanced", "user thoroughness merged in");
  });
});

// -- unknown-key warning --------------------------------------------------

test("unknown top-level key triggers a non-fatal warning, not an error", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = {
    mode: "YOLO",
    project: { shape: "empty-dream" },
    futuristic_unknown_section: { ratio: 0.7 },
  };
  const { warnings } = captureWarn(() => validate(config, { schema }));
  assert(warnings.length >= 1, "expected at least one warning");
  const w = warnings[0];
  assert(
    w.includes("futuristic_unknown_section"),
    `warning should reference the unknown key, got: ${w}`,
  );
  assert(
    w.includes("your devx may be older than this config"),
    `warning should explain forward-compat, got: ${w}`,
  );
});

test("unknown nested key triggers a warning with the full dotted path", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = {
    mode: "YOLO",
    project: { shape: "empty-dream" },
    capacity: { unknown_knob: 5 },
  };
  const { warnings } = captureWarn(() => validate(config, { schema }));
  assert(
    warnings.some((w) => w.includes("capacity.unknown_knob")),
    `expected nested-path warning; got: ${warnings.join(" | ")}`,
  );
});

test("explicit additionalProperties means open-ended keys are NOT warned about", () => {
  // notifications.events declares additionalProperties: { enum: [...] } — open
  // by design so devx upgrades that introduce new event names don't warn.
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = {
    mode: "YOLO",
    project: { shape: "empty-dream" },
    notifications: {
      events: {
        brand_new_event_devx_will_add_someday: "digest",
      },
    },
  };
  const { warnings } = captureWarn(() => validate(config, { schema }));
  assertEq(
    warnings.length,
    0,
    `events should not warn (open-ended by schema); got: ${warnings.join(" | ")}`,
  );
});

// -- missing-required -----------------------------------------------------

test("corrupt-missing-mode.yaml: missing top-level 'mode' throws ConfigError", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = parseYaml(readFileSync(CORRUPT_MISSING_MODE, "utf8"));
  let threw = false;
  try {
    validate(config, { schema });
  } catch (e) {
    threw = true;
    assert(e instanceof ConfigError, `expected ConfigError, got ${e}`);
    assert(
      (e as ConfigError).message.includes("missing required key: mode"),
      `message should name the missing key, got: ${(e as ConfigError).message}`,
    );
    assert(
      (e as ConfigError).message.includes("/devx-init"),
      `message should point at /devx-init, got: ${(e as ConfigError).message}`,
    );
  }
  assert(threw, "validate should throw on missing mode");
});

test("missing nested required key (project.shape) throws ConfigError with dotted path", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = { mode: "YOLO", project: {} };
  let threw = false;
  try {
    validate(config, { schema });
  } catch (e) {
    threw = true;
    assert(e instanceof ConfigError, `expected ConfigError, got ${e}`);
    assert(
      (e as ConfigError).message.includes("missing required key: project.shape"),
      `message should be 'project.shape', got: ${(e as ConfigError).message}`,
    );
  }
  assert(threw, "validate should throw on missing project.shape");
});

// -- out-of-enum ----------------------------------------------------------

test("invalid-mode.yaml: out-of-enum mode throws ConfigError listing allowed values", () => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const config = parseYaml(readFileSync(INVALID_MODE, "utf8"));
  let threw = false;
  try {
    validate(config, { schema });
  } catch (e) {
    threw = true;
    assert(e instanceof ConfigError, `expected ConfigError, got ${e}`);
    const msg = (e as ConfigError).message;
    assert(msg.includes("/mode"), `message should point at /mode, got: ${msg}`);
    for (const allowed of ["YOLO", "BETA", "PROD", "LOCKDOWN"]) {
      assert(msg.includes(allowed), `allowed values should list ${allowed}, got: ${msg}`);
    }
  }
  assert(threw, "validate should throw on out-of-enum");
});

// -- no-file --------------------------------------------------------------

test("loadValidatedConfig: no devx.config.yaml in cwd or parents throws ConfigError", () => {
  withTmpDir((dir) => {
    let threw = false;
    try {
      loadValidatedConfig({
        projectPath: join(dir, "does-not-exist.yaml"),
        reload: true,
      });
    } catch (e) {
      threw = true;
      assert(e instanceof ConfigError, `expected ConfigError, got ${e}`);
      assert(
        (e as ConfigError).message.includes("no devx.config.yaml"),
        `message should be 'no devx.config.yaml', got: ${(e as ConfigError).message}`,
      );
      assert(
        (e as ConfigError).message.includes("/devx-init"),
        `message should point at /devx-init, got: ${(e as ConfigError).message}`,
      );
    }
    assert(threw, "loadValidatedConfig should throw on missing file");
  });
});

// -- corrupt-YAML ---------------------------------------------------------

test("loadValidatedConfig: corrupt YAML in devx.config.yaml throws ConfigError", () => {
  withTmpDir((dir) => {
    // Unclosed flow mapping → eemeli/yaml parseDocument records an error.
    const projectPath = setupProject(dir, "mode: YOLO\nproject: { shape: empty-dream\n");
    let threw = false;
    try {
      loadValidatedConfig({ projectPath, reload: true });
    } catch (e) {
      threw = true;
      assert(e instanceof ConfigError, `expected ConfigError, got ${e}`);
      assert(
        (e as ConfigError).message.includes("could not be parsed"),
        `message should say 'could not be parsed', got: ${(e as ConfigError).message}`,
      );
    }
    assert(threw, "loadValidatedConfig should throw on corrupt YAML");
  });
});

// -- cache ----------------------------------------------------------------

test("loadValidatedConfig caches by projectPath; clearConfigCache resets", () => {
  withTmpDir((dir) => {
    const projectPath = setupProject(
      dir,
      "mode: YOLO\nproject:\n  shape: empty-dream\n",
    );
    const userPath = join(dir, "absent-user.yaml");
    const a = loadValidatedConfig({ projectPath, userPath, reload: true });
    const b = loadValidatedConfig({ projectPath, userPath });
    assertEq(a, b, "second call should return cached object");
    clearConfigCache();
    const c = loadValidatedConfig({ projectPath, userPath });
    assert(c !== a, "after clearConfigCache, fresh load returns a new object");
  });
});

test("loadValidatedConfig cache key includes userPath: switching user file invalidates cache", () => {
  withTmpDir((dir) => {
    const projectPath = setupProject(
      dir,
      "mode: YOLO\nproject:\n  shape: empty-dream\n",
    );
    const userA = join(dir, "userA.yaml");
    const userB = join(dir, "userB.yaml");
    writeFileSync(userA, "thoroughness: send-it\n");
    writeFileSync(userB, "thoroughness: thorough\n");
    const a = loadValidatedConfig({ projectPath, userPath: userA, reload: true }) as {
      thoroughness: string;
    };
    const b = loadValidatedConfig({ projectPath, userPath: userB }) as {
      thoroughness: string;
    };
    assertEq(a.thoroughness, "send-it", "userA contributes send-it");
    assertEq(b.thoroughness, "thorough", "userB contributes thorough — cache must miss");
  });
});

// -- end-to-end through the file system ----------------------------------

test("loadValidatedConfig: end-to-end happy path with a real project on disk", () => {
  withTmpDir((dir) => {
    const projectPath = setupProject(
      dir,
      "mode: BETA\nproject:\n  shape: bootstrapped-rewriting\nthoroughness: balanced\n",
    );
    const userPath = join(dir, "no-user.yaml");
    const cfg = loadValidatedConfig({ projectPath, userPath, reload: true }) as {
      mode: string;
      project: { shape: string };
      thoroughness: string;
    };
    assertEq(cfg.mode, "BETA", "mode round-trips through validation");
    assertEq(
      cfg.project.shape,
      "bootstrapped-rewriting",
      "project.shape round-trips through validation",
    );
    assertEq(cfg.thoroughness, "balanced", "thoroughness round-trips");
  });
});

// -- summary --------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} cfg203 test(s) failed`);
  process.exit(1);
}
console.log("\nAll cfg203 validator tests passed.");
