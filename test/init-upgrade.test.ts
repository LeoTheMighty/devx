// init-upgrade.ts tests (ini507).
//
// Coverage targets — every spec AC + a few regression guards:
//   - same-version + no repairs needed → kept N / added 0 / migrated 0
//   - version-bump-with-new-key → one prompt, key written, added += 1
//   - missing-supervisor → detector returns missing, repair runs, added += 1
//   - missing-CI workflow → detector returns missing, repair runs, added += 1
//   - corrupt-config (missing devx_version) → halted-corrupt, no writes
//   - missing-config-file → halted-corrupt
//   - migrations: only those whose from >= installed version run; ordering by from
//   - new-keys idempotency: a key already on disk is not re-prompted
//   - default new-key value used when ask is absent or returns undefined
//   - safeRepair / safeDetect: a throwing detector is treated as missing; a
//     throwing repair is reported as repaired:false (does not crash the run)
//   - compareSemver basics (and sort stability)
//
// Hermetic: every test uses a fresh tmp dir as repoRoot and injects scripted
// detectors / repairers / migration loaders. No real fs writes outside repo.

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  compareSemver,
  runInitUpgrade,
  type MigrationModule,
  type NewKey,
  type RepairSurface,
  type SurfaceContext,
} from "../src/lib/init-upgrade.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mkRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const ALL_SURFACES: ReadonlyArray<RepairSurface> = [
  "claude-md-markers",
  "supervisor-units",
  "ci-workflow",
  "pr-template",
  "personas",
  "interview-seed",
];

/** Assert every surface appears as PRESENT (no repair attempted). Used by
 *  the "happy path" tests to make sure default detectors aren't being
 *  invoked accidentally and inflating the `added` counter. */
function presentForAll(): Partial<Record<RepairSurface, () => boolean>> {
  return Object.fromEntries(ALL_SURFACES.map((s) => [s, () => true]));
}

function noopRepairs(): Partial<Record<RepairSurface, () => boolean>> {
  return Object.fromEntries(ALL_SURFACES.map((s) => [s, () => true]));
}

function writeConfig(repo: string, body: string): string {
  const path = join(repo, "devx.config.yaml");
  writeFileSync(path, body);
  return path;
}

const MINIMAL_CONFIG = [
  "devx_version: 0.1.0",
  "mode: YOLO",
  "project:",
  "  shape: empty-dream",
  "thoroughness: send-it",
  "bmad:",
  "  modules: [core, bmm, tea]",
  "  output_root: _bmad-output",
  "",
].join("\n");

// ---------------------------------------------------------------------------
// compareSemver
// ---------------------------------------------------------------------------

describe("ini507 — compareSemver", () => {
  it("returns 0 for equal", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
  it("returns negative when a < b on each component", () => {
    expect(compareSemver("0.9.9", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.9", "1.1.0")).toBeLessThan(0);
    expect(compareSemver("1.1.0", "1.1.1")).toBeLessThan(0);
  });
  it("returns positive when a > b", () => {
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });
  it("strips pre-release / build suffixes for ordering", () => {
    expect(compareSemver("1.2.3-rc.1", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3+build.7", "1.2.3-rc.1")).toBe(0);
  });
  it("treats malformed components as 0", () => {
    expect(compareSemver("garbage", "0.0.0")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// halted-corrupt paths
// ---------------------------------------------------------------------------

describe("ini507 — halted-corrupt", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini507-corrupt-");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("halts when devx.config.yaml does not exist", async () => {
    const result = await runInitUpgrade({ repoRoot: repo });
    expect(result.status).toBe("halted-corrupt");
    expect(result.reason).toMatch(/does not exist/);
    expect(result.summary).toBeUndefined();
  });

  it("halts when devx_version is missing from the config", async () => {
    writeConfig(
      repo,
      ["mode: YOLO", "project:", "  shape: empty-dream"].join("\n"),
    );
    const result = await runInitUpgrade({ repoRoot: repo });
    expect(result.status).toBe("halted-corrupt");
    expect(result.reason).toMatch(/devx_version is missing/);
  });

  it("halts when devx_version is empty string", async () => {
    writeConfig(
      repo,
      ['devx_version: ""', "mode: YOLO"].join("\n"),
    );
    const result = await runInitUpgrade({ repoRoot: repo });
    expect(result.status).toBe("halted-corrupt");
    expect(result.reason).toMatch(/devx_version is missing/);
  });

  it("halts on unparseable YAML", async () => {
    writeConfig(repo, "this: : : not: valid:\n  -");
    const result = await runInitUpgrade({ repoRoot: repo });
    expect(result.status).toBe("halted-corrupt");
    expect(result.reason).toMatch(/unparseable YAML/);
  });
});

// ---------------------------------------------------------------------------
// same-version no-op (with no surface drift)
// ---------------------------------------------------------------------------

describe("ini507 — same-version no-op", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini507-noop-");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("returns completed with kept>0 / added=0 / migrated=0 when nothing drifted", async () => {
    writeConfig(repo, MINIMAL_CONFIG);

    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: presentForAll(),
      // Repairs should never be invoked; provide ones that throw to assert that.
      repair: Object.fromEntries(
        ALL_SURFACES.map((s) => [
          s,
          () => {
            throw new Error("repair must not be invoked when surface is present");
          },
        ]),
      ),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toBeDefined();
    expect(result.summary?.added).toBe(0);
    expect(result.summary?.migrated).toBe(0);
    expect(result.summary?.kept).toBeGreaterThan(0);
    expect(result.summaryLine).toBe(
      `kept ${result.summary?.kept} / added 0 / migrated 0`,
    );
    expect(result.summary?.repairs.every((r) => r.detected === "present")).toBe(
      true,
    );
  });

  it("does not rewrite the config when no migrations and no new keys", async () => {
    writeConfig(repo, MINIMAL_CONFIG);
    const before = readFileSync(join(repo, "devx.config.yaml"), "utf8");

    await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: presentForAll(),
      repair: noopRepairs(),
    });

    const after = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// version-bump-with-new-key
// ---------------------------------------------------------------------------

describe("ini507 — version-bump with new key", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini507-newkey-");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("prompts only for the new key, writes the answer, bumps devx_version", async () => {
    writeConfig(repo, MINIMAL_CONFIG);

    const newKeys: NewKey[] = [
      {
        path: ["concierge", "new_knob"],
        description: "What value for the new knob?",
        proposedDefault: "default-val",
      },
    ];
    const asked: NewKey[] = [];

    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      detect: presentForAll(),
      repair: noopRepairs(),
      newKeysRegistry: () => newKeys,
      ask: async (key) => {
        asked.push(key);
        return "user-supplied";
      },
    });

    expect(result.status).toBe("completed");
    expect(asked).toHaveLength(1);
    expect(asked[0]?.path).toEqual(["concierge", "new_knob"]);
    expect(result.summary?.added).toBe(1);
    expect(result.summary?.newKeysWritten).toHaveLength(1);

    // Disk state: new key + bumped version.
    const parsed = parseYaml(readFileSync(join(repo, "devx.config.yaml"), "utf8"));
    expect((parsed as { devx_version: string }).devx_version).toBe("0.2.0");
    expect(
      (parsed as { concierge: { new_knob: unknown } }).concierge.new_knob,
    ).toBe("user-supplied");
  });

  it("uses the proposedDefault when ask is absent", async () => {
    writeConfig(repo, MINIMAL_CONFIG);
    const newKeys: NewKey[] = [
      {
        path: ["a_new_section"],
        description: "Pick the default",
        proposedDefault: 42,
      },
    ];

    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      detect: presentForAll(),
      repair: noopRepairs(),
      newKeysRegistry: () => newKeys,
    });

    expect(result.summary?.added).toBe(1);
    const parsed = parseYaml(
      readFileSync(join(repo, "devx.config.yaml"), "utf8"),
    ) as { a_new_section: number };
    expect(parsed.a_new_section).toBe(42);
  });

  it("falls back to the proposedDefault when ask returns undefined", async () => {
    writeConfig(repo, MINIMAL_CONFIG);
    const newKeys: NewKey[] = [
      {
        path: ["maybe_new"],
        description: "Maybe?",
        proposedDefault: "fallback",
      },
    ];

    await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      detect: presentForAll(),
      repair: noopRepairs(),
      newKeysRegistry: () => newKeys,
      ask: () => undefined,
    });

    const parsed = parseYaml(
      readFileSync(join(repo, "devx.config.yaml"), "utf8"),
    ) as { maybe_new: string };
    expect(parsed.maybe_new).toBe("fallback");
  });

  it("never re-prompts a key already present on disk (idempotent re-run)", async () => {
    writeConfig(
      repo,
      [MINIMAL_CONFIG, "concierge:", "  already_present: yes", ""].join("\n"),
    );

    let askCalls = 0;
    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      detect: presentForAll(),
      repair: noopRepairs(),
      newKeysRegistry: () => [
        {
          path: ["concierge", "already_present"],
          description: "should not be asked",
          proposedDefault: "no",
        },
      ],
      ask: () => {
        askCalls += 1;
        return "should-not-be-written";
      },
    });

    expect(askCalls).toBe(0);
    expect(result.summary?.added).toBe(0);
    expect(result.summary?.newKeysWritten).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// surface drift — missing-supervisor + missing-CI etc.
// ---------------------------------------------------------------------------

describe("ini507 — surface drift detection + repair", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini507-surface-");
    writeConfig(repo, MINIMAL_CONFIG);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("missing-supervisor → repair runs, added += 1, repair recorded", async () => {
    let repairCalls = 0;
    const presentExceptSupervisor: Partial<
      Record<RepairSurface, () => boolean>
    > = {
      ...presentForAll(),
      "supervisor-units": () => false,
    };

    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: presentExceptSupervisor,
      repair: {
        ...noopRepairs(),
        "supervisor-units": () => {
          repairCalls += 1;
          return true;
        },
      },
    });

    expect(repairCalls).toBe(1);
    expect(result.summary?.added).toBe(1);
    const supRepair = result.summary?.repairs.find(
      (r) => r.surface === "supervisor-units",
    );
    expect(supRepair?.detected).toBe("missing");
    expect(supRepair?.repaired).toBe(true);
  });

  it("missing-CI workflow → repair runs and is reported", async () => {
    let repairCalls = 0;
    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: { ...presentForAll(), "ci-workflow": () => false },
      repair: {
        ...noopRepairs(),
        "ci-workflow": () => {
          repairCalls += 1;
          return true;
        },
      },
    });

    expect(repairCalls).toBe(1);
    expect(result.summary?.added).toBe(1);
    const ciRepair = result.summary?.repairs.find(
      (r) => r.surface === "ci-workflow",
    );
    expect(ciRepair?.repaired).toBe(true);
  });

  it("multiple missing surfaces → added counts each repair", async () => {
    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: {
        ...presentForAll(),
        "ci-workflow": () => false,
        "pr-template": () => false,
        personas: () => false,
      },
      repair: noopRepairs(),
    });

    expect(result.summary?.added).toBe(3);
  });

  it("a throwing detector is treated as missing (safe bias toward repair)", async () => {
    let repairCalls = 0;
    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: {
        ...presentForAll(),
        "claude-md-markers": () => {
          throw new Error("boom");
        },
      },
      repair: {
        ...noopRepairs(),
        "claude-md-markers": () => {
          repairCalls += 1;
          return true;
        },
      },
    });

    expect(repairCalls).toBe(1);
    expect(result.summary?.added).toBe(1);
  });

  it("a throwing repair reports repaired:false but does not crash the run", async () => {
    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.1.0",
      detect: { ...presentForAll(), "interview-seed": () => false },
      repair: {
        ...noopRepairs(),
        "interview-seed": () => {
          throw new Error("repair-boom");
        },
      },
    });

    expect(result.status).toBe("completed");
    const r = result.summary?.repairs.find(
      (x) => x.surface === "interview-seed",
    );
    expect(r?.detected).toBe("missing");
    expect(r?.repaired).toBe(false);
    // A failed repair does NOT count toward `added`.
    expect(result.summary?.added).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// migrations
// ---------------------------------------------------------------------------

describe("ini507 — migrations", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("ini507-mig-");
    writeConfig(repo, MINIMAL_CONFIG);
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("skips migrations whose from-version < installed devx_version", async () => {
    const ranOrder: string[] = [];
    const migrations: MigrationModule[] = [
      {
        fromVersion: "0.0.5",
        toVersion: "0.1.0",
        apply: () => {
          ranOrder.push("0.0.5-0.1.0");
          return [];
        },
      },
      {
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        apply: (doc) => {
          ranOrder.push("0.1.0-0.2.0");
          doc.setIn(["mode"], "YOLO");
          return [["mode"]];
        },
      },
    ];

    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      loadMigrations: async () => migrations,
      detect: presentForAll(),
      repair: noopRepairs(),
    });

    expect(ranOrder).toEqual(["0.1.0-0.2.0"]);
    expect(result.summary?.migrated).toBe(1);
    expect(result.summary?.migrationsRan).toHaveLength(1);
    // After migration the version is bumped on disk.
    const parsed = parseYaml(
      readFileSync(join(repo, "devx.config.yaml"), "utf8"),
    ) as { devx_version: string };
    expect(parsed.devx_version).toBe("0.2.0");
  });

  it("runs chained migrations in ascending from-version order", async () => {
    const ranOrder: string[] = [];
    // Pass migrations out of order to assert the loader sorts.
    const migrations: MigrationModule[] = [
      {
        fromVersion: "0.2.0",
        toVersion: "0.3.0",
        apply: () => {
          ranOrder.push("0.2.0-0.3.0");
          return [["bmad", "modules"]];
        },
      },
      {
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        apply: () => {
          ranOrder.push("0.1.0-0.2.0");
          return [["mode"]];
        },
      },
    ];

    const result = await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.3.0",
      loadMigrations: async () => migrations,
      detect: presentForAll(),
      repair: noopRepairs(),
    });

    expect(ranOrder).toEqual(["0.1.0-0.2.0", "0.2.0-0.3.0"]);
    // Distinct keys touched across both migrations: mode + bmad.modules.
    expect(result.summary?.migrated).toBe(2);
  });

  it("preserves inline comment on devx_version when bumping (cfg202 idiom)", async () => {
    writeConfig(
      repo,
      [
        "devx_version: 0.1.0  # set by /devx-init at 2026-04-26T19:35",
        "mode: YOLO",
        "project:",
        "  shape: empty-dream",
        "",
      ].join("\n"),
    );

    await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      detect: presentForAll(),
      repair: noopRepairs(),
    });

    const after = readFileSync(join(repo, "devx.config.yaml"), "utf8");
    expect(after).toMatch(/devx_version: 0\.2\.0\s+# set by \/devx-init at 2026-04-26T19:35/);
  });

  it("bumps devx_version on disk even with no migrations and no new keys", async () => {
    // This is the "no-key release" path — the version bumped but the schema
    // didn't change. We still need the on-disk version to advance so a future
    // re-run doesn't reapply migrations whose `from` matches the old version.
    await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.5.0",
      detect: presentForAll(),
      repair: noopRepairs(),
    });
    const parsed = parseYaml(
      readFileSync(join(repo, "devx.config.yaml"), "utf8"),
    ) as { devx_version: string };
    expect(parsed.devx_version).toBe("0.5.0");
  });

  it("does not run migrations whose to-version > current package version", async () => {
    const ranOrder: string[] = [];
    const migrations: MigrationModule[] = [
      {
        fromVersion: "0.1.0",
        toVersion: "0.2.0",
        apply: () => {
          ranOrder.push("0.1.0-0.2.0");
          return [["mode"]];
        },
      },
      {
        fromVersion: "0.2.0",
        toVersion: "0.99.0",
        apply: () => {
          ranOrder.push("0.2.0-0.99.0");
          return [];
        },
      },
    ];

    await runInitUpgrade({
      repoRoot: repo,
      currentVersion: "0.2.0",
      loadMigrations: async () => migrations,
      detect: presentForAll(),
      repair: noopRepairs(),
    });

    // Only the one whose toVersion <= current ran.
    expect(ranOrder).toEqual(["0.1.0-0.2.0"]);
  });
});
