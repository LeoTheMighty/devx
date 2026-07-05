// Unit tests for src/lib/devx/claim.ts (dvx101).
//
// Three layers covered:
//
//   1. Pure splicers — flipDevMdRow, updateSpecForClaim, findSpecForHash.
//      Hammered directly without standing up a fake repo.
//
//   2. claimSpec driver — every step's happy path + every step's
//      rollback path. The exec mock asserts call order so the
//      load-bearing "push before worktree-create / before any gh"
//      contract is regression-tested (closes
//      memory/feedback_devx_push_claim_before_pr.md).
//
//   3. Concurrency — synthetic two-claim race per the locked decision in
//      epic-devx-skill.md ("two claimSpec() invocations against the same
//      hash; assert exactly one returns success and the other returns
//      'lock held'; both are clean — no DEV.md inconsistency").
//
// Spec: dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md
// Epic: _bmad-output/planning-artifacts/epic-devx-skill.md

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ClaimError,
  type ClaimFs,
  type ClaimSpecOpts,
  type ExecResult,
  LockHeldError,
  claimSpec,
  findSpecForHash,
  flipDevMdRow,
  updateSpecForClaim,
} from "../src/lib/devx/claim.js";

// ---------------------------------------------------------------------------
// Layer 1 — pure splicers
// ---------------------------------------------------------------------------

const SAMPLE_DEV_MD = `# DEV

### Epic 4 — /devx skill
- [ ] \`dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md\` — Atomic claim. Status: ready. From: epic-devx-skill. Blocked-by: mrg102, prt102.
- [ ] \`dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md\` — Conditional. Status: ready. Blocked-by: dvx101.
- [/] \`dev/dev-dvx103-2026-04-28T19:30-devx-self-review-discipline.md\` — Self-review. Status: in-progress. Blocked-by: dvx102.
`;

describe("flipDevMdRow", () => {
  it("flips [ ] → [/] and Status: ready → Status: in-progress for the matching row", () => {
    const out = flipDevMdRow(SAMPLE_DEV_MD, "dvx101");
    expect(out).toContain(
      "- [/] `dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md` — Atomic claim. Status: in-progress.",
    );
    // Non-matching rows untouched.
    expect(out).toContain(
      "- [ ] `dev/dev-dvx102-2026-04-28T19:30-devx-conditional-create-story.md` — Conditional. Status: ready.",
    );
    expect(out).toContain(
      "- [/] `dev/dev-dvx103-2026-04-28T19:30-devx-self-review-discipline.md` — Self-review. Status: in-progress.",
    );
  });

  it("throws when the row exists but is already in-progress (already claimed)", () => {
    expect(() => flipDevMdRow(SAMPLE_DEV_MD, "dvx103")).toThrow(
      /already claimed/,
    );
  });

  it("throws when no row matches the hash", () => {
    expect(() => flipDevMdRow(SAMPLE_DEV_MD, "zzz999")).toThrow(
      /no DEV.md row found/,
    );
  });

  it("rejects path-traversal-shaped hashes", () => {
    expect(() => flipDevMdRow(SAMPLE_DEV_MD, "../bad")).toThrow(
      /invalid hash/,
    );
  });

  it("does not match a hash that is a prefix of another hash's row", () => {
    // A hash 'dvx10' would naively match 'dev-dvx101-' if anchored loosely.
    // Verify the hash-component anchor (`-` after hash) prevents that.
    expect(() => flipDevMdRow(SAMPLE_DEV_MD, "dvx10")).toThrow(/no DEV.md row/);
  });

  it("does NOT rewrite Status: ready-for-dev (regression — \\b is not enough)", () => {
    // Adversarial-review finding: `\b` after `ready` matches `-` because
    // `-` is a word-boundary char, so a future `Status: ready-for-dev`
    // shape would silently become `Status: in-progress-for-dev`. The
    // lookahead `(?=[.\s]|$)` pins to the canonical `ready.` shape.
    const withFutureState = SAMPLE_DEV_MD.replace(
      "Status: ready. From: epic-devx-skill",
      "Status: ready-for-dev. From: epic-devx-skill",
    );
    // The row is no longer in `[ ]`-with-`Status: ready.` shape, so
    // flipDevMdRow's primary regex (`^- \[ \] \`dev/dev-${hash}-`) still
    // matches, but the Status replacement should NOT touch
    // `ready-for-dev`. The output should keep the row's status text
    // intact except for the checkbox flip.
    const out = flipDevMdRow(withFutureState, "dvx101");
    expect(out).toContain("Status: ready-for-dev. From: epic-devx-skill");
    expect(out).not.toContain("Status: in-progress-for-dev");
    // Checkbox still flipped.
    expect(out).toContain("- [/] `dev/dev-dvx101");
  });
});

const SAMPLE_SPEC = `---
hash: dvx101
type: dev
created: 2026-04-28T19:30:00-07:00
title: Atomic claim
status: ready
blocked_by: [mrg102, prt102]
branch: feat/dev-dvx101
---

## Goal

Ship claimSpec.

## Status log

- 2026-04-28T19:30 — created by /devx-plan
`;

describe("updateSpecForClaim", () => {
  it("flips status to in-progress and inserts owner line", () => {
    const out = updateSpecForClaim(
      SAMPLE_SPEC,
      "session-abc",
      "2026-05-05T18:30:00-07:00",
    );
    expect(out).toContain("status: in-progress");
    expect(out).not.toMatch(/^status: ready$/m);
    expect(out).toContain("owner: /devx-session-abc");
  });

  it("appends a status-log line with the iso timestamp + session id", () => {
    const out = updateSpecForClaim(
      SAMPLE_SPEC,
      "s1",
      "2026-05-05T18:30:00-07:00",
    );
    expect(out).toContain(
      "- 2026-05-05T18:30:00-07:00 — claimed by /devx in session /devx-s1",
    );
    // Original log line preserved (append-only).
    expect(out).toContain("- 2026-04-28T19:30 — created by /devx-plan");
  });

  it("replaces an existing owner line rather than duplicating it", () => {
    const withOwner = SAMPLE_SPEC.replace(
      "status: ready\n",
      "status: ready\nowner: /devx-prior\n",
    );
    const out = updateSpecForClaim(
      withOwner,
      "new-sid",
      "2026-05-05T18:30:00-07:00",
    );
    expect(out).toContain("owner: /devx-new-sid");
    expect(out).not.toContain("owner: /devx-prior");
  });

  it("throws when frontmatter is missing", () => {
    expect(() =>
      updateSpecForClaim("no frontmatter here", "s1", "iso"),
    ).toThrow(/missing frontmatter/);
  });

  it("throws when frontmatter has no status: line", () => {
    const noStatus = SAMPLE_SPEC.replace(/^status: ready$/m, "owner: someone");
    expect(() => updateSpecForClaim(noStatus, "s1", "iso")).toThrow(
      /missing `status:`/,
    );
  });

  it("creates a Status log section if absent", () => {
    const noLog = SAMPLE_SPEC.replace(
      /## Status log[\s\S]*$/m,
      "",
    ).replace(/\s+$/, "\n");
    const out = updateSpecForClaim(noLog, "s1", "2026-05-05T18:30:00-07:00");
    expect(out).toContain("## Status log");
    expect(out).toContain(
      "- 2026-05-05T18:30:00-07:00 — claimed by /devx in session /devx-s1",
    );
  });

  it("appends inside the Status log section even when it is not the last section", () => {
    const trailingSection = `${SAMPLE_SPEC}\n## Links\n\n- spec\n`;
    const out = updateSpecForClaim(
      trailingSection,
      "s1",
      "2026-05-05T18:30:00-07:00",
    );
    const lines = out.split("\n");
    const linksIdx = lines.indexOf("## Links");
    const claimedIdx = lines.findIndex((l) =>
      l.includes("claimed by /devx in session /devx-s1"),
    );
    expect(claimedIdx).toBeGreaterThanOrEqual(0);
    expect(claimedIdx).toBeLessThan(linksIdx);
  });
});

describe("findSpecForHash", () => {
  function fsWith(files: Record<string, string[]>): ClaimFs {
    return {
      ...nullFs(),
      exists: (p) => Object.keys(files).some((k) => p === k),
      readdir: (p) => files[p] ?? [],
    };
  }

  it("finds the matching dev-<hash>-*.md file", () => {
    const fs = fsWith({
      "/repo/dev": [
        "dev-aud101-2026-04-26T19:35-modules-inventory.md",
        "dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md",
      ],
    });
    expect(findSpecForHash(fs, "/repo", "dvx101")).toBe(
      "/repo/dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md",
    );
  });

  it("returns null when dev/ doesn't exist", () => {
    const fs = fsWith({});
    expect(findSpecForHash(fs, "/repo", "dvx101")).toBeNull();
  });

  it("returns null when no matching file", () => {
    const fs = fsWith({
      "/repo/dev": ["dev-aud101-2026-04-26T19:35-modules-inventory.md"],
    });
    expect(findSpecForHash(fs, "/repo", "dvx101")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — claimSpec driver
// ---------------------------------------------------------------------------

interface ExecCall {
  cmd: string;
  args: string[];
}

interface FakeFsState {
  files: Map<string, string>;
  dirs: Set<string>;
  // Tracks which paths have been opened-exclusively (i.e. lock held).
  openExcl: Set<string>;
}

function makeFakeFs(initial: Record<string, string>): {
  fs: ClaimFs;
  state: FakeFsState;
} {
  const state: FakeFsState = {
    files: new Map(Object.entries(initial)),
    dirs: new Set(),
    openExcl: new Set(),
  };
  for (const path of Object.keys(initial)) {
    let parent = parentPath(path);
    while (parent) {
      state.dirs.add(parent);
      const next = parentPath(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  const fs: ClaimFs = {
    openExclusive: (p, contents) => {
      if (state.files.has(p) || state.openExcl.has(p)) {
        const e = new Error("EEXIST: file already exists");
        (e as { code?: string }).code = "EEXIST";
        throw e;
      }
      state.openExcl.add(p);
      state.files.set(p, contents);
    },
    readFile: (p) => {
      if (!state.files.has(p)) {
        throw new Error(`ENOENT: ${p}`);
      }
      return state.files.get(p) as string;
    },
    writeFile: (p, contents) => {
      state.files.set(p, contents);
    },
    rename: (a, b) => {
      if (!state.files.has(a)) throw new Error(`ENOENT: ${a}`);
      state.files.set(b, state.files.get(a) as string);
      state.files.delete(a);
    },
    exists: (p) => state.files.has(p) || state.dirs.has(p),
    mkdirRecursive: (p) => {
      let cur = p;
      while (cur && cur !== "/") {
        state.dirs.add(cur);
        const next = parentPath(cur);
        if (next === cur) break;
        cur = next;
      }
    },
    unlink: (p) => {
      state.files.delete(p);
      state.openExcl.delete(p);
    },
    readdir: (p) => {
      const out: string[] = [];
      const prefix = `${p}/`;
      for (const f of state.files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          if (!rest.includes("/")) out.push(rest);
        }
      }
      return out;
    },
  };
  return { fs, state };
}

function parentPath(p: string): string {
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "";
  return p.slice(0, idx);
}

function makeFakeExec(opts: { failOn?: string; failExitCode?: number } = {}): {
  exec: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
  ) => ExecResult;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  return {
    calls,
    exec: (cmd, args) => {
      calls.push({ cmd, args });
      const joined = `${cmd} ${args.join(" ")}`;
      if (opts.failOn && joined.includes(opts.failOn)) {
        return {
          stdout: "",
          stderr: `mock fail: ${joined}`,
          exitCode: opts.failExitCode ?? 1,
        };
      }
      // git rev-parse HEAD → fake sha
      if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD") {
        return { stdout: "abc123def456\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

const REPO = "/repo";
const STD_CONFIG = {
  git: { default_branch: "main", branch_prefix: "feat/", integration_branch: null },
};

function makeFixture(): {
  fs: ClaimFs;
  state: FakeFsState;
  baseOpts: Pick<ClaimSpecOpts, "sessionId" | "repoRoot" | "config" | "now">;
} {
  const initial: Record<string, string> = {
    [`${REPO}/DEV.md`]: SAMPLE_DEV_MD,
    [`${REPO}/dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`]:
      SAMPLE_SPEC,
  };
  const { fs, state } = makeFakeFs(initial);
  const baseOpts = {
    sessionId: "test-sid",
    repoRoot: REPO,
    config: STD_CONFIG,
    now: () => new Date(2026, 4, 5, 18, 30, 0),
  };
  return { fs, state, baseOpts };
}

function nullFs(): ClaimFs {
  return {
    openExclusive: () => {},
    readFile: () => "",
    writeFile: () => {},
    rename: () => {},
    exists: () => false,
    mkdirRecursive: () => {},
    unlink: () => {},
    readdir: () => [],
  };
}

describe("claimSpec — happy path", () => {
  it("returns {branch, lockPath, claimSha} and runs every step", async () => {
    const { fs, state, baseOpts } = makeFixture();
    const { exec, calls } = makeFakeExec();
    const result = await claimSpec("dvx101", { ...baseOpts, fs, exec });
    expect(result.branch).toBe("feat/dev-dvx101");
    expect(result.lockPath).toBe(
      "/repo/.devx-cache/locks/spec-dvx101.lock",
    );
    expect(result.claimSha).toBe("abc123def456");

    // DEV.md flipped on disk.
    const devMdAfter = state.files.get(`${REPO}/DEV.md`) as string;
    expect(devMdAfter).toContain(
      "- [/] `dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`",
    );
    expect(devMdAfter).toContain(
      "- [/] `dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md` — Atomic claim. Status: in-progress.",
    );

    // Spec frontmatter flipped + status log appended.
    const specAfter = state.files.get(
      `${REPO}/dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`,
    ) as string;
    expect(specAfter).toContain("status: in-progress");
    expect(specAfter).toContain("owner: /devx-test-sid");
    expect(specAfter).toContain("claimed by /devx in session /devx-test-sid");

    // Lock file present.
    expect(state.files.has(result.lockPath)).toBe(true);

    // Order assertion (the load-bearing dvx101 invariant): git push BEFORE
    // git worktree add. (If a future PR opener or any gh call were inlined
    // into claimSpec, that call would also need to be asserted post-push;
    // claimSpec doesn't do gh calls so the proxy assertion is push-before-
    // worktree.)
    const pushIdx = calls.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "push",
    );
    const wtIdx = calls.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(wtIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeLessThan(wtIdx);

    // Commit message matches the spec.
    const commitCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "commit",
    );
    expect(commitCall?.args).toContain("chore: claim dvx101 for /devx");

    // Worktree add uses the derived branch + base.
    const wtCall = calls[wtIdx];
    expect(wtCall.args).toEqual([
      "worktree",
      "add",
      "/repo/.worktrees/dev-dvx101",
      "-b",
      "feat/dev-dvx101",
      "main",
    ]);
  });

  it("regression: claim push happens before any subsequent gh call", async () => {
    // Simulate /devx Phase 7 by appending a fake `gh pr create` call AFTER
    // claimSpec returns. The whole point of dvx101 is that any such gh
    // call lands strictly after the push. We verify by recording the
    // unified call log.
    const { fs, baseOpts } = makeFixture();
    const calls: ExecCall[] = [];
    const exec = (cmd: string, args: string[]): ExecResult => {
      calls.push({ cmd, args });
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "deadbeef\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    await claimSpec("dvx101", { ...baseOpts, fs, exec });
    // Fake the Phase 7 gh call.
    exec("gh", ["pr", "create", "--base", "main"]);

    const pushIdx = calls.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "push",
    );
    const ghIdx = calls.findIndex((c) => c.cmd === "gh");
    expect(pushIdx).toBeGreaterThanOrEqual(0);
    expect(ghIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeLessThan(ghIdx);
  });
});

describe("claimSpec — lock semantics", () => {
  it("throws LockHeldError when the lock file already exists (synthetic race, claim #2)", async () => {
    const { fs, state, baseOpts } = makeFixture();
    // Simulate claim #1 by pre-creating the lock file. claim #2 must fail
    // immediately with LockHeldError; DEV.md and the spec must be untouched.
    const lockPath = `${REPO}/.devx-cache/locks/spec-dvx101.lock`;
    state.dirs.add(`${REPO}/.devx-cache/locks`);
    state.files.set(lockPath, "session-prior\n");

    const exec = () => ({ stdout: "", stderr: "", exitCode: 0 });
    await expect(
      claimSpec("dvx101", { ...baseOpts, fs, exec }),
    ).rejects.toBeInstanceOf(LockHeldError);

    // DEV.md still has the original [ ] checkbox.
    expect(state.files.get(`${REPO}/DEV.md`)).toBe(SAMPLE_DEV_MD);
    expect(
      state.files.get(
        `${REPO}/dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`,
      ),
    ).toBe(SAMPLE_SPEC);
  });

  it("two-claim race: first succeeds, second hits LockHeldError, both clean", async () => {
    // Per epic-devx-skill.md party-mode locked decision: synthetic race —
    // two claimSpec() calls; assert exactly one returns success and the
    // other returns 'lock held'; both clean (no DEV.md inconsistency).
    //
    // Equivalence note: this test runs claim #1 to completion before
    // claim #2 starts, but the equivalence to the locked decision's
    // "sleep-spinning fixture" holds because the lock is acquired in
    // step 1 and stays held after claimSpec returns (released by /devx
    // Phase 8 cleanup, not by claimSpec). So claim #2 sees the lock
    // from any time in claim #1's lifecycle including post-return —
    // the in-flight-pause variant below makes this explicit.
    const { fs, state, baseOpts } = makeFixture();
    const calls1: ExecCall[] = [];
    const exec1 = (cmd: string, args: string[]): ExecResult => {
      calls1.push({ cmd, args });
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "sha1\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    const result1 = await claimSpec("dvx101", {
      ...baseOpts,
      sessionId: "first",
      fs,
      exec: exec1,
    });
    expect(result1.claimSha).toBe("sha1");

    // The lock file is still held (claimSpec leaves it for /devx Phase 8
    // cleanup). Second invocation must hit LockHeldError.
    const exec2 = () => ({ stdout: "", stderr: "", exitCode: 0 });
    await expect(
      claimSpec("dvx101", {
        ...baseOpts,
        sessionId: "second",
        fs,
        exec: exec2,
      }),
    ).rejects.toBeInstanceOf(LockHeldError);

    // DEV.md is still in the post-first-claim state (not double-flipped,
    // not reverted).
    const devMdAfter = state.files.get(`${REPO}/DEV.md`) as string;
    expect(devMdAfter).toContain(
      "- [/] `dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`",
    );
  });

  it("interleaved race: claim #2 attempted mid-flight in claim #1 → still LockHeldError", async () => {
    // Tighter version of the locked-decision "sleep-spinning fixture"
    // shape: pause claim #1 between push and worktree-create (via the
    // exec seam) and synchronously launch claim #2 from inside the
    // pause. Since openExclusive is atomic, claim #2 must hit
    // LockHeldError regardless of where in claim #1's lifecycle the
    // race lands.
    const { fs, state, baseOpts } = makeFixture();
    let claim2Result: Error | null = null;
    const exec1 = (cmd: string, args: string[]): ExecResult => {
      if (cmd === "git" && args[0] === "rev-parse") {
        // Simulate "claim #2 starts mid-flight" by attempting it right
        // after push completes but before worktree-add. The lock is
        // already held by claim #1 at this point, so #2 must reject
        // synchronously with LockHeldError.
        const exec2 = () => ({ stdout: "", stderr: "", exitCode: 0 });
        claimSpec("dvx101", {
          ...baseOpts,
          sessionId: "interloper",
          fs,
          exec: exec2,
        }).catch((e) => {
          claim2Result = e as Error;
        });
        return { stdout: "sha1\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    await claimSpec("dvx101", {
      ...baseOpts,
      sessionId: "first",
      fs,
      exec: exec1,
    });
    // Microtask flush — the inner claimSpec's Promise rejects
    // synchronously up to the lock check.
    await Promise.resolve();
    expect(claim2Result).toBeInstanceOf(LockHeldError);
    // DEV.md state coherent — first claim's flip held; not double-flipped.
    const devMdAfter = state.files.get(`${REPO}/DEV.md`) as string;
    expect(devMdAfter).toContain("- [/] `dev/dev-dvx101");
    expect(devMdAfter.match(/dev-dvx101/g)?.length).toBe(1);
  });
});

describe("claimSpec — rollback paths", () => {
  it("compose failure (DEV.md row already in [/]) → release lock + ClaimError", async () => {
    const { fs, state, baseOpts } = makeFixture();
    // Pre-flip the row to in-progress so flipDevMdRow throws "already claimed".
    state.files.set(
      `${REPO}/DEV.md`,
      SAMPLE_DEV_MD.replace(
        "- [ ] `dev/dev-dvx101",
        "- [/] `dev/dev-dvx101",
      ),
    );
    const exec = () => ({ stdout: "", stderr: "", exitCode: 0 });
    await expect(
      claimSpec("dvx101", { ...baseOpts, fs, exec }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "compose" });
    // Lock released.
    expect(
      state.files.has(`${REPO}/.devx-cache/locks/spec-dvx101.lock`),
    ).toBe(false);
  });

  it("git commit failure → revert working tree + release lock", async () => {
    const { fs, state, baseOpts } = makeFixture();
    const { exec } = makeFakeExec({ failOn: "commit", failExitCode: 1 });
    await expect(
      claimSpec("dvx101", { ...baseOpts, fs, exec }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "git-commit" });
    // DEV.md restored to pre-claim.
    expect(state.files.get(`${REPO}/DEV.md`)).toBe(SAMPLE_DEV_MD);
    expect(
      state.files.get(
        `${REPO}/dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`,
      ),
    ).toBe(SAMPLE_SPEC);
    // Lock released.
    expect(
      state.files.has(`${REPO}/.devx-cache/locks/spec-dvx101.lock`),
    ).toBe(false);
  });

  it("git push failure → reset --SOFT HEAD~1 + scoped two-file restore + release lock (v2l101 HIGH)", async () => {
    const { fs, state, baseOpts } = makeFixture();
    const calls: ExecCall[] = [];
    const exec = (cmd: string, args: string[]): ExecResult => {
      calls.push({ cmd, args });
      if (cmd === "git" && args[0] === "push") {
        return { stdout: "", stderr: "non-fast-forward", exitCode: 1 };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "abc\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    await expect(
      claimSpec("dvx101", { ...baseOpts, fs, exec }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "git-push" });
    // NEVER `reset --hard` — that would wipe unrelated user WIP repo-wide.
    const resetCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "reset",
    );
    expect(resetCall?.args).toEqual(["reset", "--soft", "HEAD~1"]);
    expect(
      calls.some((c) => c.cmd === "git" && c.args.includes("--hard")),
    ).toBe(false);
    // The two claim files were un-staged (pathspec-scoped restore).
    const restoreCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "restore" && c.args[1] === "--staged",
    );
    expect(restoreCall?.args).toContain("DEV.md");
    expect(
      restoreCall?.args.some((a) => a.startsWith("dev/dev-dvx101")),
    ).toBe(true);
    // Working-tree content restored to pre-claim for BOTH files.
    expect(state.files.get(`${REPO}/DEV.md`)).toBe(SAMPLE_DEV_MD);
    expect(
      state.files.get(
        `${REPO}/dev/dev-dvx101-2026-04-28T19:30-devx-claim-atomic.md`,
      ),
    ).toBe(SAMPLE_SPEC);
    // Lock released.
    expect(
      state.files.has(`${REPO}/.devx-cache/locks/spec-dvx101.lock`),
    ).toBe(false);
  });

  it("REAL git: push failure rolls back the claim WITHOUT touching unrelated dirty WIP (v2l101 HIGH)", async () => {
    // Real repo + origin; a pre-push hook rejects everything, and the main
    // worktree is seeded with the user's uncommitted WIP. The old
    // `reset --hard HEAD~1` rollback destroyed that WIP repo-wide.
    const base = mkdtempSync(join(tmpdir(), "devx-claim-rollback-"));
    try {
      const origin = join(base, "origin.git");
      const repoRoot = join(base, "repo");
      execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);
      execFileSync("git", ["clone", "-q", origin, repoRoot]);
      const g = (...args: string[]): string =>
        execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
      g("config", "user.email", "t@t");
      g("config", "user.name", "t");
      g("config", "commit.gpgsign", "false");
      mkdirSync(join(repoRoot, "dev"), { recursive: true });
      const specRel = "dev/dev-abc123-2026-07-05T13:00-thing.md";
      const specOriginal =
        "---\nhash: abc123\ntype: dev\ncreated: 2026-07-05T13:00:00-06:00\ntitle: Thing\nstatus: ready\n---\n\n## Goal\n\nx\n\n## Status log\n\n- created.\n";
      const devMdOriginal = `# DEV\n\n- [ ] \`${specRel}\` — Thing. Status: ready.\n`;
      writeFileSync(join(repoRoot, specRel), specOriginal, "utf8");
      writeFileSync(join(repoRoot, "DEV.md"), devMdOriginal, "utf8");
      writeFileSync(join(repoRoot, "notes.txt"), "committed content\n", "utf8");
      writeFileSync(join(repoRoot, ".gitignore"), ".devx-cache/\n.worktrees/\n", "utf8");
      g("add", "-A");
      g("commit", "-q", "-m", "base");
      g("push", "-q", "-u", "origin", "main");
      const preClaimHead = g("rev-parse", "HEAD");

      // The user's WIP: a dirty tracked file + an untracked file.
      writeFileSync(join(repoRoot, "notes.txt"), "PRECIOUS user WIP\n", "utf8");
      writeFileSync(join(repoRoot, "scratch.txt"), "untracked scratch\n", "utf8");

      // Reject every push.
      const hooksDir = join(base, "hooks");
      mkdirSync(hooksDir, { recursive: true });
      writeFileSync(join(hooksDir, "pre-push"), "#!/bin/sh\necho no >&2\nexit 1\n", {
        mode: 0o755,
      });
      g("config", "core.hooksPath", hooksDir);

      await expect(
        claimSpec("abc123", {
          sessionId: "rollback-test",
          repoRoot,
          config: {
            git: { default_branch: "main", branch_prefix: "feat/", integration_branch: null },
          },
        }),
      ).rejects.toMatchObject({ name: "ClaimError", stage: "git-push" });

      // Claim fully rolled back: HEAD, DEV.md, spec.
      expect(g("rev-parse", "HEAD")).toBe(preClaimHead);
      expect(readFileSync(join(repoRoot, "DEV.md"), "utf8")).toBe(devMdOriginal);
      expect(readFileSync(join(repoRoot, specRel), "utf8")).toBe(specOriginal);
      // The user's WIP survived — the load-bearing assertion.
      expect(readFileSync(join(repoRoot, "notes.txt"), "utf8")).toBe("PRECIOUS user WIP\n");
      expect(readFileSync(join(repoRoot, "scratch.txt"), "utf8")).toBe("untracked scratch\n");
      // Nothing left staged from the claim.
      expect(g("diff", "--cached", "--name-only")).toBe("");
      // Lock released.
      expect(
        existsSync(join(repoRoot, ".devx-cache", "locks", "spec-abc123.lock")),
      ).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("worktree-create failure post-push → claim is durable, lock released, no silent revert", async () => {
    const { fs, state, baseOpts } = makeFixture();
    const calls: ExecCall[] = [];
    const exec = (cmd: string, args: string[]): ExecResult => {
      calls.push({ cmd, args });
      if (cmd === "git" && args[0] === "worktree") {
        return { stdout: "", stderr: "branch already exists", exitCode: 1 };
      }
      if (cmd === "git" && args[0] === "rev-parse") {
        return { stdout: "abc\n", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };
    await expect(
      claimSpec("dvx101", { ...baseOpts, fs, exec }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "worktree" });
    // Claim NOT reverted — DEV.md flipped, spec flipped, push happened.
    expect(state.files.get(`${REPO}/DEV.md`)).toContain("- [/] `dev/dev-dvx101");
    const pushCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "push",
    );
    expect(pushCall).toBeDefined();
    // No `git reset --hard HEAD~1` was issued (claim is durable post-push).
    const resetCall = calls.find(
      (c) =>
        c.cmd === "git" &&
        c.args[0] === "reset" &&
        c.args.includes("HEAD~1"),
    );
    expect(resetCall).toBeUndefined();
    // Lock released so the operator can retry the worktree.
    expect(
      state.files.has(`${REPO}/.devx-cache/locks/spec-dvx101.lock`),
    ).toBe(false);
  });
});

describe("claimSpec — derive-branch integration", () => {
  it("single-branch config produces feat/dev-<hash>", async () => {
    const { fs, baseOpts } = makeFixture();
    const { exec } = makeFakeExec();
    const result = await claimSpec("dvx101", { ...baseOpts, fs, exec });
    expect(result.branch).toBe("feat/dev-dvx101");
  });

  it("split-branch config produces <integration>/<prefix><type>-<hash>", async () => {
    const { fs, baseOpts } = makeFixture();
    const { exec } = makeFakeExec();
    const result = await claimSpec("dvx101", {
      ...baseOpts,
      fs,
      exec,
      config: {
        git: {
          default_branch: "main",
          integration_branch: "develop",
          branch_prefix: "feat/",
        },
      },
    });
    expect(result.branch).toBe("develop/feat/dev-dvx101");
  });

  it("split-branch: claim push goes to default_branch BUT worktree forks off integration_branch", async () => {
    // Adversarial-review finding (E17): conflating pushTarget +
    // worktreeBase silently broke split-branch projects. DEV.md lives
    // on default_branch (CLAUDE.md "Backlog files live on main"), so
    // the claim commit pushes there; but the feature branch must fork
    // off integration_branch (where the PR will eventually land).
    const { fs, baseOpts } = makeFixture();
    const { exec, calls } = makeFakeExec();
    await claimSpec("dvx101", {
      ...baseOpts,
      fs,
      exec,
      config: {
        git: {
          default_branch: "main",
          integration_branch: "develop",
          branch_prefix: "feat/",
        },
      },
    });
    const pushCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "push",
    );
    expect(pushCall?.args).toEqual(["push", "origin", "main"]);
    const wtCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    // -b <branch> <base> — base is "develop", not "main".
    expect(wtCall?.args).toEqual([
      "worktree",
      "add",
      "/repo/.worktrees/dev-dvx101",
      "-b",
      "develop/feat/dev-dvx101",
      "develop",
    ]);
  });
});

describe("claimSpec — input validation", () => {
  it("rejects bad hash shape", async () => {
    const { fs, baseOpts } = makeFixture();
    const { exec } = makeFakeExec();
    await expect(
      claimSpec("../bad", { ...baseOpts, fs, exec }),
    ).rejects.toBeInstanceOf(ClaimError);
  });

  it("rejects empty sessionId", async () => {
    const { fs, baseOpts } = makeFixture();
    const { exec } = makeFakeExec();
    await expect(
      claimSpec("dvx101", { ...baseOpts, sessionId: "", fs, exec }),
    ).rejects.toThrow(/sessionId must be non-empty/);
  });

  it("rejects when spec file not found", async () => {
    const { fs, baseOpts } = makeFixture();
    const { exec } = makeFakeExec();
    await expect(
      claimSpec("zzz999", { ...baseOpts, fs, exec }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "resolve" });
  });
});

// ---------------------------------------------------------------------------
// Layer 4 — debug-type claims (v2d101 debug loop)
// ---------------------------------------------------------------------------

const SAMPLE_DEBUG_MD = `# DEBUG

- [ ] \`debug/debug-bug001-2026-07-05T12:00-broken-thing.md\` — Broken thing. Status: ready.
- [/] \`debug/debug-bug002-2026-07-05T12:00-other-thing.md\` — Other thing. Status: in-progress.
`;

const SAMPLE_DEBUG_SPEC = `---
hash: bug001
type: debug
created: 2026-07-05T12:00:00-06:00
title: Broken thing
status: ready
branch: feat/debug-bug001
---

## Goal

Expected behavior restored; repro exists; root cause documented.

## Status log

- 2026-07-05T12:00 — filed.
`;

describe("flipDevMdRow — debug type (v2d101)", () => {
  it("flips a DEBUG.md row when type is 'debug'", () => {
    const out = flipDevMdRow(SAMPLE_DEBUG_MD, "bug001", "debug");
    expect(out).toContain(
      "- [/] `debug/debug-bug001-2026-07-05T12:00-broken-thing.md` — Broken thing. Status: in-progress.",
    );
  });

  it("does not match dev rows when flipping debug (and vice versa)", () => {
    expect(() => flipDevMdRow(SAMPLE_DEV_MD, "dvx101", "debug")).toThrow(
      /no DEBUG.md row found/,
    );
    expect(() => flipDevMdRow(SAMPLE_DEBUG_MD, "bug001")).toThrow(
      /no DEV.md row found/,
    );
  });

  it("already-claimed debug rows throw the same 'already claimed' signal", () => {
    expect(() => flipDevMdRow(SAMPLE_DEBUG_MD, "bug002", "debug")).toThrow(
      /already claimed/,
    );
  });
});

describe("findSpecForHash — type parameter (v2d101)", () => {
  it("resolves debug specs under debug/", () => {
    const files: Record<string, string[]> = {
      "/repo/debug": ["debug-bug001-2026-07-05T12:00-broken-thing.md"],
    };
    const fs: ClaimFs = {
      ...nullFs(),
      exists: (p) => Object.keys(files).some((k) => p === k),
      readdir: (p) => files[p] ?? [],
    };
    expect(findSpecForHash(fs, "/repo", "bug001", "debug")).toBe(
      "/repo/debug/debug-bug001-2026-07-05T12:00-broken-thing.md",
    );
    // Default type stays dev — no cross-dir match.
    expect(findSpecForHash(fs, "/repo", "bug001")).toBeNull();
  });
});

describe("claimSpec — debug type (v2d101)", () => {
  function makeDebugFixture(): {
    fs: ClaimFs;
    state: FakeFsState;
    baseOpts: Pick<ClaimSpecOpts, "sessionId" | "repoRoot" | "config" | "now">;
  } {
    const initial: Record<string, string> = {
      [`${REPO}/DEBUG.md`]: SAMPLE_DEBUG_MD,
      [`${REPO}/debug/debug-bug001-2026-07-05T12:00-broken-thing.md`]:
        SAMPLE_DEBUG_SPEC,
    };
    const { fs, state } = makeFakeFs(initial);
    return {
      fs,
      state,
      baseOpts: {
        sessionId: "test-sid",
        repoRoot: REPO,
        config: STD_CONFIG,
        now: () => new Date(2026, 6, 5, 12, 0, 0),
      },
    };
  }

  it("claims a DEBUG.md item: DEBUG.md row flip + debug worktree stem + derived branch", async () => {
    const { fs, state, baseOpts } = makeDebugFixture();
    const { exec, calls } = makeFakeExec();
    const result = await claimSpec("bug001", {
      ...baseOpts,
      fs,
      exec,
      type: "debug",
    });
    expect(result.branch).toBe("feat/debug-bug001");
    expect(result.lockPath).toBe("/repo/.devx-cache/locks/spec-bug001.lock");

    // DEBUG.md row flipped; DEV.md never touched (it doesn't even exist).
    const debugMdAfter = state.files.get(`${REPO}/DEBUG.md`) as string;
    expect(debugMdAfter).toContain(
      "- [/] `debug/debug-bug001-2026-07-05T12:00-broken-thing.md` — Broken thing. Status: in-progress.",
    );

    // Spec frontmatter + status log updated identically to dev claims.
    const specAfter = state.files.get(
      `${REPO}/debug/debug-bug001-2026-07-05T12:00-broken-thing.md`,
    ) as string;
    expect(specAfter).toContain("status: in-progress");
    expect(specAfter).toContain("owner: /devx-test-sid");

    // Worktree stem is .worktrees/debug-<hash> per the CLAUDE.md convention.
    const wtCall = calls.find(
      (c) => c.cmd === "git" && c.args[0] === "worktree" && c.args[1] === "add",
    );
    expect(wtCall?.args).toEqual([
      "worktree",
      "add",
      "/repo/.worktrees/debug-bug001",
      "-b",
      "feat/debug-bug001",
      "main",
    ]);

    // Push-before-worktree invariant holds for debug claims too.
    const pushIdx = calls.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "push",
    );
    const wtIdx = calls.findIndex(
      (c) => c.cmd === "git" && c.args[0] === "worktree",
    );
    expect(pushIdx).toBeLessThan(wtIdx);

    // git add staged DEBUG.md + the debug spec (not DEV.md).
    const addCall = calls.find((c) => c.cmd === "git" && c.args[0] === "add");
    expect(addCall?.args).toContain("DEBUG.md");
    expect(
      addCall?.args.some((a) => a.startsWith("debug/debug-bug001-")),
    ).toBe(true);
  });

  it("rejects unclaimable spec types with ClaimError('validate')", async () => {
    const { fs, baseOpts } = makeDebugFixture();
    const { exec } = makeFakeExec();
    await expect(
      claimSpec("bug001", { ...baseOpts, fs, exec, type: "plan" }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "validate" });
    await expect(
      claimSpec("bug001", { ...baseOpts, fs, exec, type: "qa" }),
    ).rejects.toMatchObject({ name: "ClaimError", stage: "validate" });
  });

  it("resolve failure names the debug path when the debug spec is missing", async () => {
    const { fs, baseOpts } = makeDebugFixture();
    const { exec } = makeFakeExec();
    await expect(
      claimSpec("zzz999", { ...baseOpts, fs, exec, type: "debug" }),
    ).rejects.toThrow(/debug\/debug-zzz999-\*\.md/);
  });
});
