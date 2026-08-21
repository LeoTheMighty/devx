// Integration: the manage tick writes state in the CANONICAL universe when
// launched from a subdirectory of a main checkout (eac611).
//
// mlc101 fixed the split-brain — the canonical `cacheDir` and `cwd` now flow
// into `runManagerOnce`, not just into `acquireManagerLock` — but the plumb
// was only compile-checked. No test entered through `runManageCommand`, the
// CLI arm mlc101 actually changed, so nothing would have caught a regression
// that reverted the fix while leaving the types intact.
//
// The bug this pins was real and silent: from a main-checkout subdir the
// lock guarded universe A while manager state, the heartbeat and the DEV.md
// read all used the cwd-relative universe B. Two managers could then hold
// "the" lock simultaneously, each reading a different backlog.
//
// Lives in the blocking (serial) vitest pass: it `process.chdir()`s, which
// is process-global, and it spawns a real child.
//
// Spec: test/test-eac611-2026-07-28T10:12-manage-tick-canonical-state-integration.md

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runManageCommand } from "../src/commands/manage.js";

const tmps: string[] = [];
const originalCwd = process.cwd();
afterEach(() => {
  // Restore FIRST: a chdir left in place would poison every later test in
  // this file's worker (and is the shape of `project_worktree_cwd_drift`).
  process.chdir(originalCwd);
  while (tmps.length > 0) rmSync(tmps.pop() as string, { recursive: true, force: true });
});

const READY_HASH = "eac611";

/**
 * A real git checkout with a devx config at its root, a ready DEV.md row,
 * and a nested `subdir/` to launch from.
 *
 * Real git, not a fixture: `runManageCommand` decides the canonical root via
 * `resolveRepoRoot()`, so a directory that is not a git repo would take the
 * "non-git cwd keeps the legacy default" branch and test nothing.
 */
function fixture(): { root: string; subdir: string; stub: string } {
  const base = mkdtempSync(join(tmpdir(), "devx-eac611-"));
  tmps.push(base);
  // realpath: macOS /var → /private/var, and the canonical-root comparison
  // is a string compare against a realpath'd value.
  const root = realpathSync(base);

  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "test@devx.local");
  git("config", "user.name", "devx test");

  writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
  mkdirSync(join(root, "dev"), { recursive: true });
  writeFileSync(
    join(root, "DEV.md"),
    `### Epic\n- [ ] \`dev/dev-${READY_HASH}-2026-07-28T10:12-fixture.md\` — Fixture. Status: ready.\n`,
  );
  writeFileSync(
    join(root, "dev", `dev-${READY_HASH}-2026-07-28T10:12-fixture.md`),
    `---\nhash: ${READY_HASH}\ntype: dev\nstatus: ready\n---\n\n## Status log\n\n- seeded.\n`,
  );

  const subdir = join(root, "subdir");
  mkdirSync(subdir, { recursive: true });

  // A harmless stand-in for `claude`, so the tick's spawn arm runs for real
  // instead of being switched off. `runManageCommand` does not forward
  // `disableSpawn`, and routing around the spawn would leave the arm this
  // test is about untested.
  const stub = join(root, "stub-claude.sh");
  writeFileSync(stub, "#!/bin/sh\nexit 0\n", "utf8");
  chmodSync(stub, 0o755);

  return { root, subdir, stub };
}

function stateFile(root: string, name: string): string {
  return join(root, ".devx-cache", "state", name);
}

describe("eac611 — manage --once from a subdirectory writes to the canonical universe", () => {
  it("AC 1: manager.json + heartbeat.json land at the ROOT, never under the subdir", async () => {
    const { root, subdir, stub } = fixture();
    const prevBin = process.env.DEVX_CLAUDE_BIN;
    process.env.DEVX_CLAUDE_BIN = stub;
    process.chdir(subdir);
    try {
      const code = await runManageCommand({ once: true });
      expect(code).toBe(0);
    } finally {
      process.chdir(originalCwd);
      if (prevBin === undefined) delete process.env.DEVX_CLAUDE_BIN;
      else process.env.DEVX_CLAUDE_BIN = prevBin;
    }

    expect(existsSync(stateFile(root, "manager.json"))).toBe(true);
    expect(existsSync(stateFile(root, "heartbeat.json"))).toBe(true);

    // The whole point: NOTHING in the forked universe. A cwd-relative
    // `.devx-cache` would have put all of the above here instead, under a
    // lock taken somewhere else.
    expect(existsSync(join(subdir, ".devx-cache"))).toBe(false);
  });

  it("AC 2: reconcile read the ROOT's DEV.md, not the subdir's absence of one", async () => {
    const { root, subdir, stub } = fixture();
    const prevBin = process.env.DEVX_CLAUDE_BIN;
    process.env.DEVX_CLAUDE_BIN = stub;
    process.chdir(subdir);
    try {
      expect(await runManageCommand({ once: true })).toBe(0);
    } finally {
      process.chdir(originalCwd);
      if (prevBin === undefined) delete process.env.DEVX_CLAUDE_BIN;
      else process.env.DEVX_CLAUDE_BIN = prevBin;
    }

    const state = JSON.parse(readFileSync(stateFile(root, "manager.json"), "utf8")) as {
      generation: number;
      ticks?: Array<Record<string, unknown>>;
      roster?: Array<{ spec_hash?: string }>;
    };
    expect(state.generation).toBe(1);

    // The ready row was OBSERVED. A cwd-relative read from `subdir/` finds
    // no DEV.md at all, so reconcile would have seen an empty backlog and
    // the tick would record nothing — the silent half of the split-brain.
    const evidence = JSON.stringify(state);
    expect(evidence).toContain(READY_HASH);
  });

  it("a second tick reuses the same canonical state rather than starting a new universe", async () => {
    const { root, subdir, stub } = fixture();
    const prevBin = process.env.DEVX_CLAUDE_BIN;
    process.env.DEVX_CLAUDE_BIN = stub;
    process.chdir(subdir);
    try {
      expect(await runManageCommand({ once: true })).toBe(0);
      expect(await runManageCommand({ once: true })).toBe(0);
    } finally {
      process.chdir(originalCwd);
      if (prevBin === undefined) delete process.env.DEVX_CLAUDE_BIN;
      else process.env.DEVX_CLAUDE_BIN = prevBin;
    }
    const state = JSON.parse(readFileSync(stateFile(root, "manager.json"), "utf8")) as {
      generation: number;
    };
    // generation advanced, which it can only do by reading the state the
    // FIRST tick wrote — i.e. both ticks agreed on where state lives.
    expect(state.generation).toBe(2);
    expect(existsSync(join(subdir, ".devx-cache"))).toBe(false);
  });

  it("still refuses to start from a linked worktree (the mlc101 guard, unregressed)", async () => {
    const { root } = fixture();
    const git = (cwd: string, ...args: string[]) =>
      spawnSync("git", args, { cwd, encoding: "utf8" });
    git(root, "add", "-A");
    git(root, "-c", "commit.gpgsign=false", "commit", "-m", "seed");
    const wt = join(root, "wt");
    git(root, "worktree", "add", wt, "-b", "side");

    process.chdir(wt);
    try {
      // 1, not 0: a manage inside a linked worktree would take a private
      // lock in a forked universe (R1), which is exactly what the canonical
      // root exists to prevent.
      expect(await runManageCommand({ once: true })).toBe(1);
    } finally {
      process.chdir(originalCwd);
    }
    expect(existsSync(join(wt, ".devx-cache"))).toBe(false);
  });
});
