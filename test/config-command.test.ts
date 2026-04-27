// Vitest suite for `devx config` (cfg204).
//
// Covers every AC from dev/dev-cfg204-2026-04-26T19:35-config-cli-get-set.md:
//   - get: dotted-path read against merged (project ⊕ user) config
//   - shorthand: `devx config <key>` == `devx config get <key>`
//   - set: project-file write through cfg202's setLeaf (round-trip preserves comments)
//   - --user flag: writes to the user file instead
//   - dotted-path set into both schema-known and schema-unknown paths
//   - enum rejection: refuses to write before touching disk
//   - non-leaf rejection: surfaces the cfg202 leaf-only message
//   - unknown-key set: writes the value, emits a warning
//   - type coercion: string CLI input → integer/number/boolean per schema
//   - no-args: prints usage to stderr, no throw
//
// We exercise runConfig() directly with `out`/`err` capture seams instead of
// going through commander.parseAsync — that keeps each test scoped to the
// behavior under test without dragging the full --help machinery into the
// assertions. A separate test does spin up commander to confirm the wiring.
//
// Spec: dev/dev-cfg204-2026-04-26T19:35-config-cli-get-set.md

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { runConfig } from "../src/commands/config.js";
import { buildProgram } from "../src/cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const SCHEMA_PATH = join(repoRoot, "_devx/config-schema.json");
const FIXTURE_WITH_COMMENTS = join(
  repoRoot,
  "test/fixtures/valid-yaml-with-comments.yaml",
);

interface Captured {
  out: string;
  err: string;
}

function capture(): { c: Captured; out: (s: string) => void; err: (s: string) => void } {
  const c: Captured = { out: "", err: "" };
  return {
    c,
    out: (s) => {
      c.out += s;
    },
    err: (s) => {
      c.err += s;
    },
  };
}

describe("cfg204 — devx config (no args)", () => {
  it("prints usage to stderr and does not throw", () => {
    const { c, out, err } = capture();
    expect(() => runConfig([], false, { out, err })).not.toThrow();
    expect(c.out).toBe("");
    expect(c.err).toContain("Usage: devx config");
  });
});

describe("cfg204 — devx config get", () => {
  let tmp: string;
  let projectPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cfg204-get-"));
    projectPath = join(tmp, "devx.config.yaml");
    writeFileSync(
      projectPath,
      [
        "mode: YOLO",
        "project:",
        "  shape: empty-dream",
        "thoroughness: send-it",
        "capacity:",
        "  usage_cap_pct: 95",
        "  models:",
        "    dev: claude-sonnet-4-6",
        "permissions:",
        "  bash:",
        "    allow:",
        "      - git",
        "      - gh",
        "",
      ].join("\n"),
    );
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("get scalar (top-level enum)", () => {
    const { c, out, err } = capture();
    runConfig(["get", "mode"], false, { out, err, projectPath });
    expect(c.out).toBe("YOLO\n");
    expect(c.err).toBe("");
  });

  it("shorthand: `devx config <key>` reads the same value as `get`", () => {
    const { c, out, err } = capture();
    runConfig(["mode"], false, { out, err, projectPath });
    expect(c.out).toBe("YOLO\n");
  });

  it("dotted-path get into nested object", () => {
    const { c, out, err } = capture();
    runConfig(["get", "capacity.usage_cap_pct"], false, { out, err, projectPath });
    expect(c.out).toBe("95\n");
  });

  it("dotted-path get into deeply nested object", () => {
    const { c, out, err } = capture();
    runConfig(["get", "capacity.models.dev"], false, { out, err, projectPath });
    expect(c.out).toBe("claude-sonnet-4-6\n");
  });

  it("get array → JSON-formatted multi-line", () => {
    const { c, out, err } = capture();
    runConfig(["get", "permissions.bash.allow"], false, { out, err, projectPath });
    const parsed = JSON.parse(c.out);
    expect(parsed).toEqual(["git", "gh"]);
  });

  it("merges user file overlay: project beats user; user-only keys survive", () => {
    // Project's `thoroughness: send-it` should beat user's override; a key only
    // in user (notifications.quiet_hours) must still surface in the merged read.
    const userPath = join(tmp, "user.yaml");
    writeFileSync(
      userPath,
      "mode: BETA\nthoroughness: balanced\nnotifications:\n  quiet_hours: 22:00-08:00\n",
    );
    const { c: c1, out: out1, err: err1 } = capture();
    runConfig(["get", "mode"], false, {
      out: out1,
      err: err1,
      projectPath,
      userPath,
    });
    expect(c1.out).toBe("YOLO\n"); // project wins on overlap

    const { c: c2, out: out2, err: err2 } = capture();
    runConfig(["get", "thoroughness"], false, {
      out: out2,
      err: err2,
      projectPath,
      userPath,
    });
    expect(c2.out).toBe("send-it\n"); // project wins on overlap

    const { c: c3, out: out3, err: err3 } = capture();
    runConfig(["get", "notifications.quiet_hours"], false, {
      out: out3,
      err: err3,
      projectPath,
      userPath,
    });
    expect(c3.out).toBe("22:00-08:00\n"); // user-only key survives
  });

  it("missing key throws", () => {
    const { out, err } = capture();
    expect(() =>
      runConfig(["get", "no.such.key"], false, { out, err, projectPath }),
    ).toThrow(/no such key 'no.such.key'/);
  });

  it("rejects empty path segments", () => {
    const { out, err } = capture();
    expect(() => runConfig(["get", "foo..bar"], false, { out, err, projectPath })).toThrow(
      /empty segment/,
    );
  });

  it("`config get` with no key throws usage", () => {
    const { out, err } = capture();
    expect(() => runConfig(["get"], false, { out, err, projectPath })).toThrow(
      /usage: devx config get/,
    );
  });
});

describe("cfg204 — devx config set", () => {
  let tmp: string;
  let projectPath: string;
  let schemaPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cfg204-set-"));
    projectPath = join(tmp, "devx.config.yaml");
    // Use the round-trip fixture as the project file; it ships the comment +
    // anchor structure cfg202's regression test relies on, so we get the same
    // round-trip guarantee for free under cfg204's set path.
    copyFileSync(FIXTURE_WITH_COMMENTS, projectPath);
    // Append a real schema-shaped slab so schema-walk has something to match.
    const original = readFileSync(projectPath, "utf8");
    writeFileSync(
      projectPath,
      [
        original.trimEnd(),
        "",
        "# devx-shaped keys appended for cfg204 schema-walk tests.",
        "mode: YOLO",
        "project:",
        "  shape: empty-dream",
        "capacity:",
        "  usage_cap_pct: 95",
        "  daily_spend_cap_usd: 25.5",
        "git:",
        "  protect_main: false",
        "  delete_branch_on_merge: true",
        "notifications:",
        "  events:",
        "    ci_failed: digest",
        "",
      ].join("\n"),
    );
    mkdirSync(join(tmp, "_devx"), { recursive: true });
    schemaPath = join(tmp, "_devx/config-schema.json");
    copyFileSync(SCHEMA_PATH, schemaPath);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("set scalar enum (mode)", () => {
    const { out, err } = capture();
    runConfig(["set", "mode", "BETA"], false, { out, err, projectPath, schemaPath });
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as { mode: string };
    expect(reparsed.mode).toBe("BETA");
  });

  it("shorthand: `devx config <key> <value>` writes the same as `set`", () => {
    const { out, err } = capture();
    runConfig(["mode", "BETA"], false, { out, err, projectPath, schemaPath });
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as { mode: string };
    expect(reparsed.mode).toBe("BETA");
  });

  it("dotted-path set into existing nested map", () => {
    const { out, err } = capture();
    runConfig(["set", "capacity.usage_cap_pct", "80"], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as {
      capacity: { usage_cap_pct: number };
    };
    expect(reparsed.capacity.usage_cap_pct).toBe(80);
    // Crucially: integer, not string. AC explicitly calls this out.
    expect(typeof reparsed.capacity.usage_cap_pct).toBe("number");
  });

  it("dotted-path set into open-ended additionalProperties (notifications.events.ci_failed)", () => {
    const { out, err } = capture();
    runConfig(["set", "notifications.events.ci_failed", "push"], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as {
      notifications: { events: { ci_failed: string } };
    };
    expect(reparsed.notifications.events.ci_failed).toBe("push");
  });

  it("type coercion: number → boolean schema", () => {
    const { out, err } = capture();
    runConfig(["set", "git.protect_main", "true"], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as {
      git: { protect_main: boolean };
    };
    expect(reparsed.git.protect_main).toBe(true);
    expect(typeof reparsed.git.protect_main).toBe("boolean");
  });

  it("type coercion: number-with-decimal lands as JS number, not string", () => {
    const { out, err } = capture();
    runConfig(["set", "capacity.daily_spend_cap_usd", "12.75"], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as {
      capacity: { daily_spend_cap_usd: number };
    };
    expect(reparsed.capacity.daily_spend_cap_usd).toBe(12.75);
  });

  it("integer schema rejects non-integer string", () => {
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "capacity.usage_cap_pct", "ninety"], false, {
        out,
        err,
        projectPath,
        schemaPath,
      }),
    ).toThrow(/expects integer/);
    // AC#5: must abort BEFORE write — re-read and confirm value untouched.
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as {
      capacity: { usage_cap_pct: number };
    };
    expect(reparsed.capacity.usage_cap_pct).toBe(95);
  });

  it("boolean schema rejects non-boolean string", () => {
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "git.protect_main", "kinda"], false, {
        out,
        err,
        projectPath,
        schemaPath,
      }),
    ).toThrow(/expects boolean/);
  });

  it("AC#5: out-of-enum value aborts before write (file unchanged)", () => {
    const before = readFileSync(projectPath, "utf8");
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "mode", "CHILL"], false, {
        out,
        err,
        projectPath,
        schemaPath,
      }),
    ).toThrow(/allowed: YOLO, BETA, PROD, LOCKDOWN/);
    expect(readFileSync(projectPath, "utf8")).toBe(before);
  });

  it("AC#6: non-leaf path aborts with the cfg202 leaf-only message", () => {
    const before = readFileSync(projectPath, "utf8");
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "capacity", "lol"], false, {
        out,
        err,
        projectPath,
        schemaPath,
      }),
    ).toThrow(/Phase 0 supports leaf scalar writes only/);
    expect(readFileSync(projectPath, "utf8")).toBe(before);
  });

  it("AC#6: non-leaf path also rejected via cfg202 setLeaf when schema is absent", () => {
    // Same scenario but without a schema next to the project file — the YAML
    // structure is what tells us `services` is a Map. cfg202 still fires.
    const noSchemaPath = join(tmp, "no-schema.yaml");
    copyFileSync(FIXTURE_WITH_COMMENTS, noSchemaPath);
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "services", "lol"], false, {
        out,
        err,
        projectPath: noSchemaPath,
        schemaPath: join(tmp, "absent-schema.json"),
      }),
    ).toThrow(/Phase 0 supports leaf scalar writes only/);
  });

  it("AC#7 (round-trip): set preserves comments, key order, anchors, structure", () => {
    // Use a fresh fixture-only project (no appended slab) to make the assertion
    // about exact line-count + diffs tight.
    const fixtureOnly = join(tmp, "fixture-only.yaml");
    copyFileSync(FIXTURE_WITH_COMMENTS, fixtureOnly);
    const original = readFileSync(fixtureOnly, "utf8");
    const { out, err } = capture();
    runConfig(["set", "zeta.inner", "new-value"], false, {
      out,
      err,
      projectPath: fixtureOnly,
      // No schema → walk-down returns null → write as raw string.
      schemaPath: join(tmp, "absent-schema.json"),
    });
    const updated = readFileSync(fixtureOnly, "utf8");
    const origLines = original.split("\n");
    const newLines = updated.split("\n");
    expect(newLines.length).toBe(origLines.length);
    const diffs: number[] = [];
    for (let i = 0; i < origLines.length; i++) {
      if (origLines[i] !== newLines[i]) diffs.push(i);
    }
    expect(diffs.length).toBe(1);
    expect(newLines[diffs[0]]).toContain("new-value");
    expect(newLines[diffs[0]]).toContain("# inline comment on the leaf we modify");
    expect(updated).not.toContain("original-value");
  });

  it("AC#7 (unknown-key write): unrecognized path is allowed, logs a warning", () => {
    const { c, out, err } = capture();
    runConfig(["set", "futuristic.unknown.knob", "42"], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    // Warning surfaces on the err stream so shells can pipe stdout cleanly.
    expect(c.err).toMatch(/unknown key 'futuristic.unknown.knob'/);
    const reparsed = parseYaml(readFileSync(projectPath, "utf8")) as {
      futuristic: { unknown: { knob: string } };
    };
    // Unknown → string. Caller can re-set with a coerced value once schema lands.
    expect(reparsed.futuristic.unknown.knob).toBe("42");
  });

  it("`config set` with too few args throws usage", () => {
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "mode"], false, { out, err, projectPath, schemaPath }),
    ).toThrow(/usage: devx config set/);
  });

  it("`config <too many args>` throws", () => {
    const { out, err } = capture();
    expect(() =>
      runConfig(["a", "b", "c"], false, { out, err, projectPath, schemaPath }),
    ).toThrow(/too many arguments/);
  });

  it("rejects array-element writes (numeric segment into existing Seq) up front", () => {
    // The fixture ships `list_section: [first, second, third]`. setLeaf with
    // the path ["list_section","0"] would silently corrupt the doc by writing
    // a stringly-keyed phantom field into the Seq. Reject before any disk read.
    const before = readFileSync(projectPath, "utf8");
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "list_section.0", "FIRST"], false, {
        out,
        err,
        projectPath,
        schemaPath,
      }),
    ).toThrow(/Phase 0 supports leaf scalar writes only/);
    expect(readFileSync(projectPath, "utf8")).toBe(before);
  });

  it("number coercion accepts shell-common decimal forms (.5 and 5.)", () => {
    const { out, err } = capture();
    runConfig(["set", "capacity.daily_spend_cap_usd", ".5"], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    expect(
      (parseYaml(readFileSync(projectPath, "utf8")) as {
        capacity: { daily_spend_cap_usd: number };
      }).capacity.daily_spend_cap_usd,
    ).toBe(0.5);

    runConfig(["set", "capacity.daily_spend_cap_usd", "5."], false, {
      out,
      err,
      projectPath,
      schemaPath,
    });
    expect(
      (parseYaml(readFileSync(projectPath, "utf8")) as {
        capacity: { daily_spend_cap_usd: number };
      }).capacity.daily_spend_cap_usd,
    ).toBe(5);
  });

  it("set without a schema file emits no unknown-key warning (avoids spurious noise)", () => {
    const noSchemaProj = join(tmp, "no-schema-project.yaml");
    writeFileSync(noSchemaProj, "mode: YOLO\nproject:\n  shape: empty-dream\n");
    const { c, out, err } = capture();
    runConfig(["set", "mode", "BETA"], false, {
      out,
      err,
      projectPath: noSchemaProj,
      // Force loadSchemaFor to return null by pointing at a non-existent file.
      schemaPath: join(tmp, "absent-schema.json"),
    });
    expect(c.err).toBe("");
    const reparsed = parseYaml(readFileSync(noSchemaProj, "utf8")) as { mode: string };
    expect(reparsed.mode).toBe("BETA");
  });

  it("corrupt schema JSON surfaces a friendly error, not a SyntaxError stack", () => {
    const corruptSchema = join(tmp, "_devx/corrupt-schema.json");
    writeFileSync(corruptSchema, "{ this is not valid json");
    const { out, err } = capture();
    expect(() =>
      runConfig(["set", "mode", "BETA"], false, {
        out,
        err,
        projectPath,
        schemaPath: corruptSchema,
      }),
    ).toThrow(/schema file at .* is not valid JSON/);
  });
});

describe("cfg204 — --user flag", () => {
  let tmp: string;
  let projectPath: string;
  let userPath: string;
  let schemaPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cfg204-user-"));
    projectPath = join(tmp, "devx.config.yaml");
    writeFileSync(projectPath, "mode: YOLO\nproject:\n  shape: empty-dream\n");
    userPath = join(tmp, "user.yaml");
    mkdirSync(join(tmp, "_devx"), { recursive: true });
    schemaPath = join(tmp, "_devx/config-schema.json");
    copyFileSync(SCHEMA_PATH, schemaPath);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("--user set writes to userPath and leaves project file alone", () => {
    const projectBefore = readFileSync(projectPath, "utf8");
    const { out, err } = capture();
    // userFlag = true → target 'user'
    runConfig(["set", "thoroughness", "balanced"], true, {
      out,
      err,
      projectPath,
      userPath,
      schemaPath,
    });
    expect(existsSync(userPath)).toBe(true);
    const userParsed = parseYaml(readFileSync(userPath, "utf8")) as {
      thoroughness: string;
    };
    expect(userParsed.thoroughness).toBe("balanced");
    expect(readFileSync(projectPath, "utf8")).toBe(projectBefore);
  });

  it("--user set then get reflects merged value (user → project read path)", () => {
    const { c, out, err } = capture();
    runConfig(["set", "thoroughness", "balanced"], true, {
      out,
      err,
      projectPath,
      userPath,
      schemaPath,
    });
    runConfig(["get", "thoroughness"], false, {
      out,
      err,
      projectPath,
      userPath,
      schemaPath,
    });
    expect(c.out).toBe("balanced\n");
  });

  it("--user shorthand (`devx config --user <key> <value>`) writes the user file", () => {
    const projectBefore = readFileSync(projectPath, "utf8");
    const { out, err } = capture();
    runConfig(["thoroughness", "thorough"], true, {
      out,
      err,
      projectPath,
      userPath,
      schemaPath,
    });
    const userParsed = parseYaml(readFileSync(userPath, "utf8")) as {
      thoroughness: string;
    };
    expect(userParsed.thoroughness).toBe("thorough");
    expect(readFileSync(projectPath, "utf8")).toBe(projectBefore);
  });

  it("--user on a get warns that --user is ignored on reads", () => {
    const { c, out, err } = capture();
    runConfig(["get", "mode"], true, {
      out,
      err,
      projectPath,
      userPath,
      schemaPath,
    });
    expect(c.out).toBe("YOLO\n");
    expect(c.err).toMatch(/--user is ignored on read/);
  });
});

describe("cfg204 — commander wiring", () => {
  it("buildProgram registers a `config` subcommand", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("config");
  });

  it("`devx config --help` triggers commander's helpDisplayed (not a hard exit)", async () => {
    const program = buildProgram();
    // exitOverride only applies to the Command it's called on — sub-commands
    // need their own. Walk the tree so `config --help` short-circuits via the
    // helpDisplayed exception instead of process.exit.
    program.exitOverride();
    for (const sub of program.commands) sub.exitOverride();
    let stdout = "";
    program.configureOutput({
      writeOut: (s) => {
        stdout += s;
      },
      writeErr: () => {},
    });
    let helpDisplayed = false;
    try {
      await program.parseAsync(["node", "devx", "config", "--help"]);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "commander.helpDisplayed" || code === "commander.help") {
        helpDisplayed = true;
      } else {
        throw e;
      }
    }
    expect(helpDisplayed).toBe(true);
    expect(stdout).toContain("config");
  });
});
