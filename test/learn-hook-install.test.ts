// rtl105 — hook registration installer (src/lib/init-hooks.ts).
//
// Permanent home of eval E-8 (_devx/workstreams/retro-listener/evals/
// E-8_hook-install.ts): the install step is idempotent (run-twice 0-byte
// diff) and ownership-respecting (user entries survive byte-intact AND in
// their original order — 0 removed, 0 reordered). Plus the three-way
// agreement between the shipped template fragment, the library's fragment,
// and this repo's committed .claude/settings.json.
//
// Applier tests run in mkdtemp sandboxes; the packaging assertions read the
// real repo files.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOOK_COMMAND,
  HOOK_EVENTS,
  hookFragment,
  installHooks,
} from "../src/lib/init-hooks.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "rtl105-hooks-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function settingsPathOf(root: string): string {
  return join(root, ".claude", "settings.json");
}

function writeSettings(root: string, content: string): string {
  const path = settingsPathOf(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}

/** The user's fixture: two Stop entries in a deliberate order, an unrelated
 *  hook event, and an unknown top-level key. Mirrors E-8's fixture. */
const USER_SETTINGS = {
  hooks: {
    Stop: [
      { hooks: [{ type: "command", command: "echo user-hook-one" }] },
      { hooks: [{ type: "command", command: "echo user-hook-two" }] },
    ],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo user-pre" }] }],
  },
  permissions: { allow: ["Bash(ls:*)"] },
};

// ---------------------------------------------------------------------------
// created
// ---------------------------------------------------------------------------

describe("rtl105 — installHooks: fresh repo", () => {
  it("creates .claude/settings.json with both registrations", () => {
    const result = installHooks({ repoRoot: sandbox });

    expect(result.action).toBe("created");
    expect(result.path).toBe(settingsPathOf(sandbox));
    expect([...result.added].sort()).toEqual([...HOOK_EVENTS].sort());

    const parsed = JSON.parse(readFileSync(result.path, "utf8")) as {
      hooks: Record<string, unknown>;
    };
    for (const event of HOOK_EVENTS) {
      expect(JSON.stringify(parsed.hooks[event])).toContain(HOOK_COMMAND);
    }
  });

  it("honors an explicit settingsPath override", () => {
    const custom = join(sandbox, "nested", "settings.json");
    const result = installHooks({ repoRoot: sandbox, settingsPath: custom });

    expect(result.path).toBe(custom);
    expect(existsSync(custom)).toBe(true);
    expect(existsSync(settingsPathOf(sandbox))).toBe(false);
  });

  it("dryRun reports the action without touching disk", () => {
    const result = installHooks({ repoRoot: sandbox, dryRun: true });

    expect(result.action).toBe("created");
    expect(existsSync(settingsPathOf(sandbox))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// idempotence — the E-8 0-byte-diff threshold
// ---------------------------------------------------------------------------

describe("rtl105 — installHooks: idempotence", () => {
  it("a second run is a 0-byte diff and reports unchanged", () => {
    const first = installHooks({ repoRoot: sandbox });
    const bytes1 = readFileSync(first.path, "utf8");

    const second = installHooks({ repoRoot: sandbox });
    const bytes2 = readFileSync(second.path, "utf8");

    expect(second.action).toBe("unchanged");
    expect(second.added).toEqual([]);
    expect(bytes2).toBe(bytes1);
  });

  it("a third run after a merge is also a 0-byte diff", () => {
    writeSettings(sandbox, JSON.stringify(USER_SETTINGS, null, 2) + "\n");

    expect(installHooks({ repoRoot: sandbox }).action).toBe("merged");
    const merged = readFileSync(settingsPathOf(sandbox), "utf8");
    expect(installHooks({ repoRoot: sandbox }).action).toBe("unchanged");
    expect(readFileSync(settingsPathOf(sandbox), "utf8")).toBe(merged);
  });

  it("leaves an already-registered file byte-intact, formatting included", () => {
    // Four-space indent, no trailing newline: nothing semantic to add, so
    // nothing at all is written — we do not reformat a file we don't need
    // to touch.
    const raw = JSON.stringify(hookFragment(), null, 4);
    const path = writeSettings(sandbox, raw);

    const result = installHooks({ repoRoot: sandbox });

    expect(result.action).toBe("unchanged");
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("treats a user-extended devx group as already present", () => {
    // The user added their own command alongside ours inside one group.
    const path = writeSettings(
      sandbox,
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  { type: "command", command: HOOK_COMMAND },
                  { type: "command", command: "echo mine" },
                ],
              },
            ],
            SessionEnd: [{ hooks: [{ type: "command", command: `  ${HOOK_COMMAND}  ` }] }],
          },
        },
        null,
        2,
      ) + "\n",
    );
    const before = readFileSync(path, "utf8");

    expect(installHooks({ repoRoot: sandbox }).action).toBe("unchanged");
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// merge — ownership
// ---------------------------------------------------------------------------

describe("rtl105 — installHooks: merge preserves user ownership", () => {
  it("keeps user Stop entries byte-intact and in their original order", () => {
    const path = writeSettings(sandbox, JSON.stringify(USER_SETTINGS, null, 2) + "\n");

    const result = installHooks({ repoRoot: sandbox });
    expect(result.action).toBe("merged");
    expect([...result.added].sort()).toEqual([...HOOK_EVENTS].sort());

    const merged = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { Stop: unknown[]; PreToolUse: unknown[] };
      permissions: unknown;
    };

    // 0 removed, 0 reordered: the user's entries are still entries 0 and 1,
    // serialized exactly as they were.
    const before = USER_SETTINGS.hooks.Stop.map((e) => JSON.stringify(e));
    const after = merged.hooks.Stop.slice(0, before.length).map((e) => JSON.stringify(e));
    expect(after).toEqual(before);

    // ...and ours is appended after them, not before.
    expect(merged.hooks.Stop).toHaveLength(before.length + 1);
    expect(JSON.stringify(merged.hooks.Stop[before.length])).toContain(HOOK_COMMAND);
  });

  it("leaves unrelated hook events and unknown top-level keys untouched", () => {
    const path = writeSettings(sandbox, JSON.stringify(USER_SETTINGS, null, 2) + "\n");

    installHooks({ repoRoot: sandbox });
    const merged = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { PreToolUse: unknown };
      permissions: unknown;
    };

    expect(merged.hooks.PreToolUse).toEqual(USER_SETTINGS.hooks.PreToolUse);
    expect(merged.permissions).toEqual(USER_SETTINGS.permissions);
  });

  it("adds only the missing event when one registration already exists", () => {
    const path = writeSettings(
      sandbox,
      JSON.stringify({ hooks: { Stop: hookFragment().hooks.Stop } }, null, 2) + "\n",
    );

    const result = installHooks({ repoRoot: sandbox });

    expect(result.action).toBe("merged");
    expect(result.added).toEqual(["SessionEnd"]);
    const merged = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: { Stop: unknown[]; SessionEnd: unknown[] };
    };
    expect(merged.hooks.Stop).toHaveLength(1);
    expect(merged.hooks.SessionEnd).toHaveLength(1);
  });

  it("merges into a settings file with no hooks section at all", () => {
    const path = writeSettings(sandbox, JSON.stringify({ permissions: { allow: [] } }, null, 2) + "\n");

    expect(installHooks({ repoRoot: sandbox }).action).toBe("merged");
    const merged = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: Record<string, unknown>;
      permissions: unknown;
    };
    expect(Object.keys(merged.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(merged.permissions).toEqual({ allow: [] });
  });

  it("preserves the user's indent unit on merge", () => {
    writeSettings(sandbox, JSON.stringify(USER_SETTINGS, null, 4) + "\n");

    installHooks({ repoRoot: sandbox });
    const lines = readFileSync(settingsPathOf(sandbox), "utf8").split("\n");

    expect(lines[1]).toMatch(/^ {4}"hooks"/);
  });

  it("treats an empty settings file as an empty object", () => {
    const path = writeSettings(sandbox, "");

    expect(installHooks({ repoRoot: sandbox }).action).toBe("merged");
    const merged = JSON.parse(readFileSync(path, "utf8")) as { hooks: Record<string, unknown> };
    expect(Object.keys(merged.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  });

  it("dryRun on an existing file reports merged without writing", () => {
    const raw = JSON.stringify(USER_SETTINGS, null, 2) + "\n";
    const path = writeSettings(sandbox, raw);

    expect(installHooks({ repoRoot: sandbox, dryRun: true }).action).toBe("merged");
    expect(readFileSync(path, "utf8")).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// refusals — never clobber what we can't classify
// ---------------------------------------------------------------------------

describe("rtl105 — installHooks: refuses unclassifiable settings", () => {
  it("throws on unparseable JSON and leaves the file alone", () => {
    const raw = "{ not json";
    const path = writeSettings(sandbox, raw);

    expect(() => installHooks({ repoRoot: sandbox })).toThrow(/not valid JSON/);
    expect(readFileSync(path, "utf8")).toBe(raw);
  });

  it("throws when the settings root is not a JSON object", () => {
    writeSettings(sandbox, "[1, 2, 3]\n");
    expect(() => installHooks({ repoRoot: sandbox })).toThrow(/JSON object/);
  });

  it("throws when hooks is not an object", () => {
    writeSettings(sandbox, JSON.stringify({ hooks: "all of them" }) + "\n");
    expect(() => installHooks({ repoRoot: sandbox })).toThrow(/"hooks" key/);
  });

  it("throws when a hook event is not an array", () => {
    writeSettings(sandbox, JSON.stringify({ hooks: { Stop: { nope: true } } }) + "\n");
    expect(() => installHooks({ repoRoot: sandbox })).toThrow(/hooks\.Stop/);
  });

  it("throws when settings.json is a directory", () => {
    mkdirSync(settingsPathOf(sandbox), { recursive: true });
    expect(() => installHooks({ repoRoot: sandbox })).toThrow(/not a regular file/);
  });
});

// ---------------------------------------------------------------------------
// packaging — the fragment, the library, and this repo agree
// ---------------------------------------------------------------------------

describe("rtl105 — shipped fragment agreement", () => {
  const fragmentPath = join(repoRoot, "_devx", "templates", "init", "claude-settings-hooks.json");

  it("the shipped template fragment matches the library's fragment", () => {
    const shipped = JSON.parse(readFileSync(fragmentPath, "utf8")) as unknown;
    expect(shipped).toEqual(hookFragment());
  });

  it("this repo's committed .claude/settings.json carries the same registrations", () => {
    const committed = JSON.parse(
      readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"),
    ) as { hooks?: Record<string, unknown> };
    const fragment = hookFragment();

    for (const event of HOOK_EVENTS) {
      expect(committed.hooks?.[event]).toEqual(fragment.hooks[event]);
    }
  });

  it("installing into a copy of this repo's settings is a no-op", () => {
    const raw = readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8");
    const path = writeSettings(sandbox, raw);

    expect(installHooks({ repoRoot: sandbox }).action).toBe("unchanged");
    expect(readFileSync(path, "utf8")).toBe(raw);
  });
});
