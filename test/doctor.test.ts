// Tests for `devx doctor` (db36af).
//
// The load-bearing assertions in this file are the ones about what doctor
// REFUSES to do. Detecting debris is the easy half; the 2026-08-12 dataset
// is the hard half, and it is a boundary argument: two dead-owner claims
// that day had identical detector signatures and needed OPPOSITE actions —
// `ecdcda` (no commits, clean tree; releasing it was pure gain) and
// `c81f04` (132 uncommitted insertions of real work). A `--fix` that treated
// the class as mechanical would have destroyed the second one. So the
// `--fix` boundary tests matter more than the detector tests.
//
// Layers: fixture-backed detectors → the --fix boundary → the runDoctor CLI
// exit-code contract.
//
// Spec: dev/dev-db36af-2026-07-25T08:55-devx-doctor-reconcile.md

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runDoctor } from "../src/commands/doctor.js";
import { runReleaseLock } from "../src/commands/devx-helper.js";
import {
  detectDeadBlockers,
  detectDeadOwners,
  detectMirrorDrift,
  detectStaleLocks,
  detectWorktrees,
} from "../src/lib/doctor/detect.js";
import { applyFixes, rewriteRowStatus } from "../src/lib/doctor/fix.js";
import { composeSpecLockBody } from "../src/lib/devx/spec-lock.js";

const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
const roots: string[] = [];
afterEach(() => {
  stderrSpy.mockClear();
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/** A repo fixture: devx.config.yaml, backlog files, spec files, locks. */
interface FixtureSpec {
  /** hash → { type, status, row?, owner?, blockedBy? } */
  specs?: Record<
    string,
    {
      type?: "dev" | "debug" | "plan";
      status: string;
      /** Checkbox to write on the row; defaults to the status's marker. */
      box?: string;
      /** Status: prose on the row; defaults to `status`. */
      rowStatus?: string;
      owner?: string;
      blockedBy?: string[];
      struck?: boolean;
      locked?: boolean;
      /** Deliberately-broken frontmatter (9f24c7 shape). */
      brokenFrontmatter?: boolean;
    }
  >;
  /** hash → lock body owner, or null for "lock exists with a dead pid". */
  locks?: Record<string, { session: string; pid?: number }>;
  /** worktree dir names, e.g. "dev-abc123". */
  worktrees?: string[];
}

const BOX: Record<string, string> = {
  ready: " ",
  "in-progress": "/",
  blocked: "-",
  done: "x",
};

function fixture(spec: FixtureSpec): string {
  const root = mkdtempSync(join(tmpdir(), "devx-doctor-"));
  roots.push(root);
  writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
  for (const d of ["dev", "debug", "plan"]) mkdirSync(join(root, d), { recursive: true });

  const rowsBy: Record<string, string[]> = { "DEV.md": [], "DEBUG.md": [], "PLAN.md": [] };
  const backlogFor: Record<string, string> = {
    dev: "DEV.md",
    debug: "DEBUG.md",
    plan: "PLAN.md",
  };

  for (const [hash, s] of Object.entries(spec.specs ?? {})) {
    const type = s.type ?? "dev";
    const rel = `${type}/${type}-${hash}-2026-08-21T10:00-fixture.md`;
    const fm = s.brokenFrontmatter
      ? `---\nhash: ${hash}\ntitle: Broken: an unquoted colon\nstatus: ${s.status}\n---\n\n## Status log\n\n- seeded.\n`
      : `---\nhash: ${hash}\ntype: ${type}\nstatus: ${s.status}\n${
          s.owner ? `owner: ${s.owner}\n` : ""
        }---\n\n## Status log\n\n- seeded.\n\n## Links\n\n- none\n`;
    writeFileSync(join(root, rel), fm);
    const box = s.box ?? BOX[s.status] ?? " ";
    const blocked = (s.blockedBy ?? []).length > 0 ? ` Blocked-by: ${(s.blockedBy ?? []).join(", ")}.` : "";
    const body = `\`${rel}\` — Fixture ${hash}. Status: ${s.rowStatus ?? s.status}.${blocked}${
      s.locked ? " [locked]" : ""
    }`;
    rowsBy[backlogFor[type]].push(s.struck ? `- ~~${body}~~` : `- [${box}] ${body}`);
  }

  for (const [file, rows] of Object.entries(rowsBy)) {
    writeFileSync(join(root, file), `# ${file}\n\n${rows.join("\n")}\n`);
  }

  if (spec.locks) {
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    for (const [hash, l] of Object.entries(spec.locks)) {
      writeFileSync(
        join(root, ".devx-cache", "locks", `spec-${hash}.lock`),
        composeSpecLockBody({
          session: l.session,
          claimedAt: "2026-08-21T10:00:00-06:00",
          pid: l.pid ?? 999_999,
          pidStartedAt: null,
        }),
      );
    }
  }
  for (const w of spec.worktrees ?? []) {
    mkdirSync(join(root, ".worktrees", w), { recursive: true });
    // Registered by default (a `.git` POINTER FILE, as a linked worktree
    // has). Tests that want a leftover DIRECTORY delete it.
    writeFileSync(join(root, ".worktrees", w, ".git"), "gitdir: /elsewhere\n");
  }
  return root;
}

/** Everything is dead unless the test says otherwise — the fixture pids are
 *  synthetic, and a live one would make the classification host-dependent. */
const deadPid = () => false;

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

describe("detectStaleLocks", () => {
  it("flags a lock on a done spec — the 14-instance class", () => {
    const root = fixture({
      specs: { aaa111: { status: "done" } },
      locks: { aaa111: { session: "/devx-old" } },
    });
    const found = detectStaleLocks({ repoRoot: root, pidAlive: deadPid });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "stale-lock", hash: "aaa111", fixable: true });
    expect(found[0].detail).toMatch(/done but still holds a lock/);
  });

  it("flags a lock whose spec no longer resolves", () => {
    const root = fixture({ specs: {}, locks: { ghost1: { session: "/devx-old" } } });
    const found = detectStaleLocks({ repoRoot: root, pidAlive: deadPid });
    expect(found).toHaveLength(1);
    expect(found[0].detail).toMatch(/no spec file resolves that hash/);
  });

  it("does NOT flag a lock on an in-progress spec, however dead its pid", () => {
    // An interactive claim runs in a short-lived CLI process, so the pid in a
    // perfectly healthy claim's lock is dead within seconds. Pid liveness is
    // not claim liveness — treating it as stale here would delete live
    // claims' locks on every doctor run.
    const root = fixture({
      specs: { bbb222: { status: "in-progress", owner: "/devx-live" } },
      locks: { bbb222: { session: "/devx-live" } },
    });
    expect(detectStaleLocks({ repoRoot: root, pidAlive: deadPid })).toEqual([]);
  });

  it("is silent on a repo with no locks dir at all", () => {
    const root = fixture({ specs: { ccc333: { status: "ready" } } });
    expect(detectStaleLocks({ repoRoot: root })).toEqual([]);
  });
});

describe("detectMirrorDrift", () => {
  it("flags a checkbox that disagrees with the frontmatter, and names frontmatter as truth", () => {
    const root = fixture({
      specs: { ddd444: { status: "in-progress", box: "x", rowStatus: "done" } },
    });
    const found = detectMirrorDrift({ repoRoot: root });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "mirror-drift", hash: "ddd444", fixable: true });
    expect(found[0].detail).toMatch(/frontmatter is the source of truth, so the ROW is wrong/);
  });

  it("never touches a [locked] row — user-typed lines are sacrosanct", () => {
    const root = fixture({
      specs: { eee555: { status: "in-progress", box: "x", rowStatus: "done", locked: true } },
    });
    expect(detectMirrorDrift({ repoRoot: root })).toEqual([]);
  });

  it("skips struck rows — a hand-abandoned row is EXPECTED to disagree", () => {
    const root = fixture({ specs: { fff666: { status: "in-progress", struck: true } } });
    expect(detectMirrorDrift({ repoRoot: root })).toEqual([]);
  });

  it("stays silent when the frontmatter does not parse (9f24c7 / D-13)", () => {
    // A confident mismatch reported against a value that could not actually
    // be read is worse than silence — that is the whole point of D-13.
    const root = fixture({
      specs: { ggg777: { status: "in-progress", box: "x", rowStatus: "done", brokenFrontmatter: true } },
    });
    expect(detectMirrorDrift({ repoRoot: root })).toEqual([]);
  });

  it("is silent when row and frontmatter agree", () => {
    const root = fixture({ specs: { hhh888: { status: "ready" } } });
    expect(detectMirrorDrift({ repoRoot: root })).toEqual([]);
  });
});

describe("detectDeadBlockers", () => {
  it("flags a blocked row whose blocker is already done", () => {
    const root = fixture({
      specs: {
        par111: { status: "done" },
        kid111: { status: "blocked", blockedBy: ["par111"] },
      },
    });
    const found = detectDeadBlockers({ repoRoot: root });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "dead-blocker", fixable: false });
    expect(found[0].detail).toMatch(/claimable now and nobody noticed/);
  });

  it("flags a blocker that is struck — it can never reach done", () => {
    const root = fixture({
      specs: {
        sup111: { status: "ready", struck: true },
        kid222: { status: "blocked", blockedBy: ["sup111"] },
      },
    });
    const found = detectDeadBlockers({ repoRoot: root });
    expect(found[0].detail).toMatch(/struck/);
  });

  it("flags a blocker that exists nowhere", () => {
    const root = fixture({ specs: { kid333: { status: "blocked", blockedBy: ["nope99"] } } });
    const found = detectDeadBlockers({ repoRoot: root });
    expect(found[0].detail).toMatch(/on no backlog and resolves to no spec file/);
  });

  it("does NOT flag a satisfied blocker on a row that is not blocked", () => {
    // The first real run against this repo produced 20 of these on a healthy
    // backlog. A done blocker on a `ready` row is provenance, not debris —
    // and 20 rows of noise is how an advisory channel gets ignored, which is
    // the failure mode doctor exists to fix.
    const root = fixture({
      specs: {
        par222: { status: "done" },
        kid444: { status: "ready", blockedBy: ["par222"] },
      },
    });
    expect(detectDeadBlockers({ repoRoot: root })).toEqual([]);
  });

  it("is silent on a live blocker", () => {
    const root = fixture({
      specs: {
        par333: { status: "in-progress" },
        kid555: { status: "blocked", blockedBy: ["par333"] },
      },
    });
    expect(detectDeadBlockers({ repoRoot: root })).toEqual([]);
  });
});

describe("detectDeadOwners", () => {
  it("flags an in-progress spec whose lock is gone (orphaned claim) — report-only", () => {
    const root = fixture({
      specs: { iii999: { status: "in-progress", owner: "/devx-gone" } },
    });
    const found = detectDeadOwners({ repoRoot: root, pidAlive: deadPid });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "dead-owner", fixable: false });
    expect(found[0].detail).toMatch(/inspect \.worktrees\/ before re-claiming/);
  });

  it("flags a dead-pid lock on an open spec — and NEVER marks it fixable", () => {
    // The 2026-08-12 boundary case, stated as an assertion: this exact
    // signature covered both a claim that was pure gain to release and one
    // holding 132 uncommitted lines of real work.
    const root = fixture({
      specs: { jjj000: { status: "in-progress", owner: "/devx-dead" } },
      locks: { jjj000: { session: "/devx-dead" } },
    });
    const found = detectDeadOwners({ repoRoot: root, pidAlive: deadPid });
    expect(found).toHaveLength(1);
    expect(found[0].fixable).toBe(false);
    expect(found[0].detail).toMatch(/depends on what the worktree holds, not on owner liveness/);
  });

  it("ignores a spec with no owner, and a spec that is done", () => {
    const root = fixture({
      specs: {
        kkk111: { status: "in-progress" },
        lll222: { status: "done", owner: "/devx-old" },
      },
    });
    expect(detectDeadOwners({ repoRoot: root, pidAlive: deadPid })).toEqual([]);
  });
});

describe("detectWorktrees", () => {
  const okExec = async () => ({ stdout: "", stderr: "", exitCode: 0 });

  it("classifies a bookkeeping-only worktree as FIXABLE", async () => {
    const root = fixture({
      specs: { mmm333: { status: "blocked" } },
      worktrees: ["dev-mmm333"],
    });
    const found = await detectWorktrees({
      repoRoot: root,
      exec: okExec,
      bookkeepingOnly: async () => true,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "bookkeeping-only-abandonment", fixable: true });
  });

  it("classifies a worktree holding real work as REPORT-ONLY", async () => {
    const root = fixture({
      specs: { nnn444: { status: "blocked" } },
      worktrees: ["dev-nnn444"],
    });
    const found = await detectWorktrees({
      repoRoot: root,
      exec: okExec,
      bookkeepingOnly: async () => false,
    });
    expect(found[0]).toMatchObject({ class: "orphan-worktree", fixable: false });
    expect(found[0].detail).toMatch(/worktrees are never auto-deleted/);
  });

  it("treats an unanswerable predicate as REAL WORK — uncertainty never deletes", async () => {
    const root = fixture({
      specs: { ooo555: { status: "blocked" } },
      worktrees: ["dev-ooo555"],
    });
    const found = await detectWorktrees({
      repoRoot: root,
      exec: okExec,
      bookkeepingOnly: async () => {
        throw new Error("git exploded");
      },
    });
    expect(found[0]).toMatchObject({ class: "orphan-worktree", fixable: false });
  });

  it("leaves a live in-progress claim's worktree alone entirely", async () => {
    const root = fixture({
      specs: { ppp666: { status: "in-progress" } },
      worktrees: ["dev-ppp666"],
    });
    expect(
      await detectWorktrees({ repoRoot: root, exec: okExec, bookkeepingOnly: async () => true }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The --fix boundary
// ---------------------------------------------------------------------------

describe("rewriteRowStatus", () => {
  it("rewrites the checkbox AND the Status: prose", () => {
    const content = "- [x] `dev/dev-a-x.md` — Thing. Status: done. Blocked-by: b.\n";
    const { content: next, changed } = rewriteRowStatus(content, "dev/dev-a-x.md", "in-progress");
    expect(changed).toBe(true);
    expect(next).toContain("- [/] `dev/dev-a-x.md` — Thing. Status: in-progress. Blocked-by: b.");
  });

  it("refuses a [locked] row", () => {
    const content = "- [x] `dev/dev-a-x.md` — Thing. Status: done. [locked]\n";
    expect(rewriteRowStatus(content, "dev/dev-a-x.md", "ready").changed).toBe(false);
  });

  it("leaves every other line byte-identical", () => {
    const content =
      "# DEV\n\n### Epic — thing\n\n- [ ] `dev/dev-b-x.md` — Other. Status: ready.\n- [x] `dev/dev-a-x.md` — Thing. Status: done.\n\n<!-- trailing -->\n";
    const { content: next } = rewriteRowStatus(content, "dev/dev-a-x.md", "ready");
    const before = content.split("\n");
    const after = next.split("\n");
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      if (before[i].includes("dev-a-x.md")) continue;
      expect(after[i]).toBe(before[i]);
    }
  });

  it("does not rewrite `Status: in-progress-ish` (anchoring)", () => {
    const content = "- [/] `dev/dev-a-x.md` — Thing. Status: in-progress-ish.\n";
    const { content: next } = rewriteRowStatus(content, "dev/dev-a-x.md", "done");
    expect(next).toContain("Status: in-progress-ish");
  });
});

describe("applyFixes — the boundary is the design's spine", () => {
  it("removes a stale lock and appends an audit line under `## Status log`", async () => {
    const root = fixture({
      specs: { qqq777: { status: "done" } },
      locks: { qqq777: { session: "/devx-old" } },
    });
    const findings = detectStaleLocks({ repoRoot: root, pidAlive: deadPid });
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
    });
    expect(fixed).toHaveLength(1);
    expect(fixed[0].ok).toBe(true);
    expect(existsSync(join(root, ".devx-cache", "locks", "spec-qqq777.lock"))).toBe(false);
    const spec = readFileSync(join(root, "dev", "dev-qqq777-2026-08-21T10:00-fixture.md"), "utf8");
    expect(spec).toMatch(/devx doctor --fix: removed stale spec lock/);
    // Under `## Status log`, NOT at EOF — the dvx103 discipline test bounds
    // its scan to that section, and appending after `## Links` reds main.
    expect(spec.indexOf("devx doctor --fix")).toBeLessThan(spec.indexOf("## Links"));
  });

  it("reconciles a drifted row to the frontmatter", async () => {
    const root = fixture({
      specs: { rrr888: { status: "in-progress", box: "x", rowStatus: "done" } },
    });
    const findings = detectMirrorDrift({ repoRoot: root });
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
    });
    expect(fixed[0].ok).toBe(true);
    const dev = readFileSync(join(root, "DEV.md"), "utf8");
    expect(dev).toMatch(/- \[\/\] `dev\/dev-rrr888/);
    expect(dev).toMatch(/Status: in-progress/);
  });

  it("NEVER mutates the report-only classes, even with --fix", async () => {
    // dead-owner, orphan-worktree and dead-blocker have no applier at all,
    // so this holds even if a future edit flips their `fixable` flag.
    const root = fixture({
      specs: {
        sss999: { status: "in-progress", owner: "/devx-dead" },
        par999: { status: "done" },
        kid999: { status: "blocked", blockedBy: ["par999"] },
      },
      locks: { sss999: { session: "/devx-dead" } },
      worktrees: ["dev-sss999"],
    });
    const before = {
      dev: readFileSync(join(root, "DEV.md"), "utf8"),
      lock: existsSync(join(root, ".devx-cache", "locks", "spec-sss999.lock")),
      worktree: existsSync(join(root, ".worktrees", "dev-sss999")),
    };
    const findings = [
      ...detectDeadOwners({ repoRoot: root, pidAlive: deadPid }),
      ...detectDeadBlockers({ repoRoot: root }),
      ...(await detectWorktrees({
        repoRoot: root,
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        bookkeepingOnly: async () => false,
      })),
    ];
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => !f.fixable)).toBe(true);

    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    expect(fixed).toEqual([]);
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toBe(before.dev);
    expect(existsSync(join(root, ".devx-cache", "locks", "spec-sss999.lock"))).toBe(before.lock);
    expect(existsSync(join(root, ".worktrees", "dev-sss999"))).toBe(before.worktree);
  });

  it("one failing fix does not abandon the others", async () => {
    const root = fixture({
      specs: { ttt111: { status: "done" }, uuu222: { status: "done" } },
      locks: { ttt111: { session: "/devx-a" }, uuu222: { session: "/devx-b" } },
    });
    const findings = detectStaleLocks({ repoRoot: root, pidAlive: deadPid });
    expect(findings).toHaveLength(2);
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      unlink: (p: string) => {
        if (p.includes("ttt111")) throw new Error("EACCES");
        rmSync(p);
      },
    });
    expect(fixed.map((f) => f.ok).sort()).toEqual([false, true]);
    expect(fixed.find((f) => !f.ok)?.error).toMatch(/EACCES/);
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe("runDoctor — exit codes and the read-only guarantee", () => {
  function run(root: string, args: string[] = [], opts: Record<string, unknown> = {}) {
    let stdout = "";
    let stderr = "";
    return runDoctor(args, {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
      projectPath: join(root, "devx.config.yaml"),
      repoRoot: root,
      detectOpts: { pidAlive: deadPid },
      fixOpts: { lock: (<T,>(_l: string, fn: () => T): T => fn()) as never },
      ...opts,
    }).then((code) => ({ code, stdout, stderr }));
  }

  it("exit 0 on a reconciled repo", async () => {
    const root = fixture({ specs: { vvv333: { status: "ready" } } });
    const r = await run(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no findings/);
  });

  it("exit 3 with findings, and writes NOTHING without --fix", async () => {
    const root = fixture({
      specs: { www444: { status: "done" } },
      locks: { www444: { session: "/devx-old" } },
    });
    const before = readFileSync(join(root, "DEV.md"), "utf8");
    const r = await run(root);
    expect(r.code).toBe(3);
    expect(existsSync(join(root, ".devx-cache", "locks", "spec-www444.lock"))).toBe(true);
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toBe(before);
  });

  it("exit 0 after --fix clears everything it can", async () => {
    const root = fixture({
      specs: { xxx555: { status: "done" } },
      locks: { xxx555: { session: "/devx-old" } },
    });
    const r = await run(root, ["--fix"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/fixed 1/);
    expect(existsSync(join(root, ".devx-cache", "locks", "spec-xxx555.lock"))).toBe(false);
  });

  it("exit 3 after --fix when report-only findings remain", async () => {
    const root = fixture({
      specs: {
        yyy666: { status: "done" },
        zzz777: { status: "in-progress", owner: "/devx-dead" },
      },
      locks: { yyy666: { session: "/devx-old" } },
    });
    const r = await run(root, ["--fix"]);
    expect(r.code).toBe(3);
    // The repaired one is gone from the remaining list; the judgment one stays.
    expect(r.stdout).toMatch(/\[fixed\] stale-lock/);
    expect(r.stdout).toMatch(/\[report\].*dead-owner/);
    expect(r.stdout).not.toMatch(/\[fixable\].*stale-lock/);
  });

  it("--json emits one parseable object with both channels", async () => {
    const root = fixture({
      specs: { aab888: { status: "done" } },
      locks: { aab888: { session: "/devx-old" } },
    });
    const r = await run(root, ["--json"]);
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(r.stdout) as { findings: unknown[]; fixed: unknown[] };
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.fixed).toEqual([]);
  });

  it("exit 64 on an unknown flag, 2 with no config", async () => {
    const root = fixture({ specs: {} });
    expect((await run(root, ["--nope"])).code).toBe(64);
    let stderr = "";
    const code = await runDoctor([], {
      out: () => {},
      err: (s) => {
        stderr += s;
      },
      projectPath: "",
    });
    expect(code).toBe(2);
    expect(stderr).toMatch(/devx\.config\.yaml not found/);
  });
});

// ---------------------------------------------------------------------------
// The source fix, and the self-heal wiring
// ---------------------------------------------------------------------------

describe("mark-done releases the lock the claim acquired (the source fix)", () => {
  it("leaves no lock behind on a clean, green, correctly-executed close", async () => {
    // This is not historical debris from a buggier era. On 2026-08-13
    // `debug-ecdcda` shipped through the full attended loop, `mark-done`
    // returned exit 0 — and left `spec-ecdcda.lock` on disk. Lock #15 was
    // created and orphaned inside the very session that documented why
    // #1–14 existed. The leak reproduced on EVERY correct run.
    const root = mkdtempSync(join(tmpdir(), "devx-markdone-lock-"));
    roots.push(root);
    mkdirSync(join(root, "dev"), { recursive: true });
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
    const rel = "dev/dev-src111-2026-08-21T10:00-fixture.md";
    writeFileSync(
      join(root, "DEV.md"),
      `# DEV\n\n- [/] \`${rel}\` — Fixture. Status: in-progress.\n`,
    );
    writeFileSync(
      join(root, rel),
      "---\nhash: src111\ntype: dev\nstatus: in-progress\n---\n\n## Status log\n\n- claimed.\n",
    );
    const lockPath = join(root, ".devx-cache", "locks", "spec-src111.lock");
    // pid of the CLAIM process, which is a short-lived CLI — dead by the
    // time mark-done runs. That is the shape the leak actually took.
    writeFileSync(
      lockPath,
      composeSpecLockBody({
        session: "/devx-claimer",
        claimedAt: "2026-08-21T10:00:00-06:00",
        pid: 999_999,
        pidStartedAt: null,
      }),
    );

    const { markDone } = await import("../src/lib/devx/mark-done.js");
    markDone("src111", {
      repoRoot: root,
      config: {},
      pr: 42,
      mergeSha: "abc1234",
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      regen: () => ({ ok: true, path: join(root, "GRAPH.md") }),
      exec: () => ({ stdout: "", stderr: "", exitCode: 1 }),
    } as never);

    expect(existsSync(lockPath)).toBe(false);
    // And doctor now finds nothing to sweep — the mop is unnecessary because
    // the spill stopped.
    expect(detectStaleLocks({ repoRoot: root, pidAlive: deadPid })).toEqual([]);
  });

  it("LEAVES a live holder's lock alone — the release is gated on liveness, not on the row", async () => {
    // The first cut unlinked unconditionally, arguing a `[x]` row cannot be
    // claimed so any lock present must be ours. Nearly true, and not true
    // enough: if the row were reset to `[ ]` and a peer re-claimed it, our
    // mark-done would flip its `[/]` to `[x]` and delete the PEER's live
    // lock — the R7 TOCTOU, reintroduced by the change meant to clean up
    // after it. `test/devx-finalize.test.ts`'s peer-reclaim case caught it.
    const root = mkdtempSync(join(tmpdir(), "devx-markdone-peer-"));
    roots.push(root);
    mkdirSync(join(root, "dev"), { recursive: true });
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
    const rel = "dev/dev-src222-2026-08-21T10:00-fixture.md";
    writeFileSync(
      join(root, "DEV.md"),
      `# DEV\n\n- [/] \`${rel}\` — Fixture. Status: in-progress.\n`,
    );
    writeFileSync(
      join(root, rel),
      "---\nhash: src222\ntype: dev\nstatus: in-progress\n---\n\n## Status log\n\n- claimed.\n",
    );
    const lockPath = join(root, ".devx-cache", "locks", "spec-src222.lock");
    // A LIVE holder: this process's own pid.
    writeFileSync(
      lockPath,
      composeSpecLockBody({ session: "/devx-PEER", claimedAt: "2026-08-21T10:00:00-06:00" }),
    );

    const { markDone } = await import("../src/lib/devx/mark-done.js");
    markDone("src222", {
      repoRoot: root,
      config: {},
      pr: 43,
      mergeSha: "abc1234",
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      regen: () => ({ ok: true, path: join(root, "GRAPH.md") }),
      exec: () => ({ stdout: "", stderr: "", exitCode: 1 }),
    } as never);

    expect(existsSync(lockPath)).toBe(true);
  });
});

describe("the 2026-07-24 wedge heals itself end-to-end", () => {
  it("clears a blocked spec + stale lock + bookkeeping worktree so the item is claimable", async () => {
    // The shape that wedged the whole backlog on 2026-07-24 (hfi103, run
    // loop-2026-07-24T21-19): a spec parked `blocked` with a dead owner, a
    // preserved worktree holding only the loop's own record commits, and a
    // lock nobody would ever reap. The hand-reset in `5f83f3e` was 100%
    // mechanical — which is the entire argument for doctor existing.
    const root = fixture({
      specs: {
        wed111: { status: "done" }, // its lock leaked when it closed
        wed222: { status: "blocked", box: "x", rowStatus: "done", owner: "/devx-crashed" },
      },
      locks: { wed111: { session: "/devx-old" } },
      worktrees: ["dev-wed222"],
    });

    const findings = [
      ...detectStaleLocks({ repoRoot: root, pidAlive: deadPid }),
      ...detectMirrorDrift({ repoRoot: root }),
      ...(await detectWorktrees({
        repoRoot: root,
        exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
        bookkeepingOnly: async () => true,
      })),
    ];
    expect(findings.map((f) => f.class).sort()).toEqual([
      "bookkeeping-only-abandonment",
      "mirror-drift",
      "stale-lock",
    ]);
    expect(findings.every((f) => f.fixable)).toBe(true);

    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      exec: async (_c, args) => {
        // Stand in for `git worktree remove --force`.
        if (args[0] === "worktree") {
          rmSync(join(root, ".worktrees", "dev-wed222"), { recursive: true, force: true });
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(fixed.every((f) => f.ok)).toBe(true);

    // Post-state: lock gone, worktree gone, and — the point of the whole
    // exercise — the item is CLAIMABLE. The first cut of this test asserted
    // the row ended `[-]` blocked while its own title promised "so the item
    // is claimable"; the auditor caught that the assertion contradicted the
    // title, and the AC ("the loop proceeds to claim the item"). It does now
    // because the repair resets the spec to `ready`, not just because the
    // worktree went away.
    expect(existsSync(join(root, ".devx-cache", "locks", "spec-wed111.lock"))).toBe(false);
    expect(existsSync(join(root, ".worktrees", "dev-wed222"))).toBe(false);
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toMatch(/- \[ \] `dev\/dev-wed222/);
    expect(
      readFileSync(join(root, "dev", "dev-wed222-2026-08-21T10:00-fixture.md"), "utf8"),
    ).toMatch(/^status: ready$/m);

    // And a second pass is clean — the repairs are idempotent, not a loop.
    const second = [
      ...detectStaleLocks({ repoRoot: root, pidAlive: deadPid }),
      ...detectMirrorDrift({ repoRoot: root }),
    ];
    expect(second).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression coverage for the 2026-08-21 3-agent adversarial review
// ---------------------------------------------------------------------------

describe("ambiguity is not absence (HIGH — both hunters, independently)", () => {
  it("never marks a lock fixable when its hash resolves in TWO type dirs", () => {
    // The shape is attested in this repo: `/devx` Phase 5 minting
    // `test/test-<story-hash>-…-qa-walkthrough.md` made a story hash resolve
    // twice (debug-ea4f41, hit live on sgr103/PR #112). The old code caught
    // AmbiguousSpecHashError and flattened it to "no spec resolves that
    // hash" — which was `fixable: true`, so `doctor --fix` and the loop's
    // unattended run-start self-heal would DELETE A LIVE CLAIM'S LOCK.
    const root = fixture({
      specs: { amb111: { type: "dev", status: "in-progress", owner: "/devx-live" } },
      locks: { amb111: { session: "/devx-live" } },
    });
    // Second file, same hash, different type dir.
    writeFileSync(
      join(root, "debug", "debug-amb111-2026-08-21T10:00-fixture.md"),
      "---\nhash: amb111\ntype: debug\nstatus: in-progress\n---\n\n## Status log\n\n- seeded.\n",
    );
    const found = detectStaleLocks({ repoRoot: root, pidAlive: deadPid });
    expect(found).toHaveLength(1);
    expect(found[0].fixable).toBe(false);
    expect(found[0].detail).toMatch(/MORE THAN ONE spec file — ambiguous, not absent/);
    expect(found[0].detail).not.toMatch(/no spec file resolves/);
  });

  it("and `--fix` therefore leaves that lock on disk", async () => {
    const root = fixture({
      specs: { amb222: { type: "dev", status: "in-progress", owner: "/devx-live" } },
      locks: { amb222: { session: "/devx-live" } },
    });
    writeFileSync(
      join(root, "debug", "debug-amb222-2026-08-21T10:00-fixture.md"),
      "---\nhash: amb222\ntype: debug\nstatus: in-progress\n---\n\n## Status log\n\n- seeded.\n",
    );
    const findings = detectStaleLocks({ repoRoot: root, pidAlive: deadPid });
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
    });
    expect(fixed).toEqual([]);
    expect(existsSync(join(root, ".devx-cache", "locks", "spec-amb222.lock"))).toBe(true);
  });
});

describe("rewriteRowStatus anchoring (HIGH — the wrong-row splice)", () => {
  it("does not rewrite a row that merely MENTIONS the target's path", () => {
    // Cross-references like "Follow-up to `dev/dev-x.md`" are an ordinary
    // shape in these backlogs, and the old `.includes()` match took the
    // first line containing the path.
    const content = [
      "- [ ] `dev/dev-oth222-x-other.md` — Follow-up to `dev/dev-tgt111-x-target.md`. Status: ready.",
      "- [ ] `dev/dev-tgt111-x-target.md` — Target. Status: ready.",
    ].join("\n");
    const { content: next, changed } = rewriteRowStatus(content, "dev/dev-tgt111-x-target.md", "done");
    expect(changed).toBe(true);
    const lines = next.split("\n");
    expect(lines[0]).toBe(content.split("\n")[0]); // byte-identical
    expect(lines[1]).toContain("- [x] `dev/dev-tgt111-x-target.md`");
  });

  it("STOPS at a [locked] target instead of falling through to a later row", () => {
    // The refusal used to `continue`, handing the splice to whatever row
    // matched next.
    const content = [
      "- [ ] `dev/dev-tgt333-x.md` — Target. Status: ready. [locked]",
      "- [ ] `dev/dev-other-x.md` — Mentions `dev/dev-tgt333-x.md`. Status: ready.",
    ].join("\n");
    const { content: next, changed } = rewriteRowStatus(content, "dev/dev-tgt333-x.md", "done");
    expect(changed).toBe(false);
    expect(next).toBe(content);
  });

  it("refuses a struck row, agreeing with the detector that skips them", () => {
    const content = "- ~~`dev/dev-s444-x.md` — Abandoned. Status: ready.~~\n";
    expect(rewriteRowStatus(content, "dev/dev-s444-x.md", "done").changed).toBe(false);
  });

  it("refuses a status with no checkbox form", () => {
    const content = "- [ ] `dev/dev-w555-x.md` — Thing. Status: ready.\n";
    expect(rewriteRowStatus(content, "dev/dev-w555-x.md", "superseded").changed).toBe(false);
    expect(rewriteRowStatus(content, "dev/dev-w555-x.md", "deleted").changed).toBe(false);
  });
});

describe("mirror-drift converges (MED — the permanently-failing finding)", () => {
  it("reports an unwritable status as NOT fixable rather than failing forever", () => {
    // `superseded` has no checkbox form, so marking it fixable produced a
    // finding that `applyFixes` could never satisfy: `devx doctor` exits 3
    // permanently and the loop emits `doctor:fixed {ok:false}` every night.
    const root = fixture({
      specs: { sup999: { status: "superseded", box: " ", rowStatus: "ready" } },
    });
    const found = detectMirrorDrift({ repoRoot: root });
    expect(found).toHaveLength(1);
    expect(found[0].fixable).toBe(false);
    expect(found[0].detail).toMatch(/no checkbox form/);
  });

  it("a second --fix pass is a no-op on the writable shape", async () => {
    const root = fixture({
      specs: { cnv111: { status: "in-progress", box: "x", rowStatus: "done" } },
    });
    const lock = (<T,>(_l: string, fn: () => T): T => fn()) as never;
    await applyFixes(detectMirrorDrift({ repoRoot: root }), { repoRoot: root, lock });
    expect(detectMirrorDrift({ repoRoot: root })).toEqual([]);
  });
});

describe("the destructive path re-checks at apply time (MED)", () => {
  it("refuses to force-remove a worktree whose spec was claimed since the scan", async () => {
    // The natural trigger for `doctor --fix` is "a loop looks wedged" —
    // exactly when a peer may claim in the window between the scan and the
    // repair. A /devx resume-claim flips the spec to in-progress and resumes
    // INTO this worktree; a --force remove would destroy a live session.
    const root = fixture({
      specs: { rc111: { status: "blocked" } },
      worktrees: ["dev-rc111"],
    });
    const findings = await detectWorktrees({
      repoRoot: root,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      bookkeepingOnly: async () => true,
    });
    expect(findings[0].fixable).toBe(true);

    // A peer claims between detect and fix.
    const spec = join(root, "dev", "dev-rc111-2026-08-21T10:00-fixture.md");
    writeFileSync(spec, readFileSync(spec, "utf8").replace("status: blocked", "status: in-progress"));

    let removed = false;
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      exec: async (_c, args) => {
        if (args[0] === "worktree") removed = true;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(removed).toBe(false);
    expect(fixed[0].ok).toBe(false);
    expect(fixed[0].error).toMatch(/became in-progress since the scan/);
    expect(existsSync(join(root, ".worktrees", "dev-rc111"))).toBe(true);
  });

  it("completes all three repair steps so the item is actually claimable again", async () => {
    // One step is cosmetic: discarding the worktree while leaving the spec
    // `blocked` and the branch behind means the item the loop was supposed
    // to be unwedged for is STILL unclaimable.
    const root = fixture({
      specs: { thr111: { status: "blocked" } },
      worktrees: ["dev-thr111"],
    });
    const spec = join(root, "dev", "dev-thr111-2026-08-21T10:00-fixture.md");
    writeFileSync(
      spec,
      readFileSync(spec, "utf8").replace("status: blocked", "status: blocked\nbranch: feat/dev-thr111"),
    );
    const findings = await detectWorktrees({
      repoRoot: root,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      bookkeepingOnly: async () => true,
    });
    const calls: string[][] = [];
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      exec: async (_c, args) => {
        calls.push(args);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(fixed[0].ok).toBe(true);
    expect(calls[0]).toEqual(["worktree", "remove", "--force", join(root, ".worktrees", "dev-thr111")]);
    expect(calls[1]).toEqual(["branch", "-D", "feat/dev-thr111"]);
    expect(readFileSync(spec, "utf8")).toMatch(/^status: ready$/m);
    expect(readFileSync(join(root, "DEV.md"), "utf8")).toMatch(/- \[ \] `dev\/dev-thr111/);
    // And it names what it wrote, so an unattended caller can commit it
    // instead of leaving `main` dirty all night.
    expect(fixed[0].paths).toContain("DEV.md");
  });

  it("refuses an unsafe branch name instead of handing it to `git branch -D`", async () => {
    const root = fixture({ specs: { unsafe1: { status: "blocked" } }, worktrees: ["dev-unsafe1"] });
    const spec = join(root, "dev", "dev-unsafe1-2026-08-21T10:00-fixture.md");
    writeFileSync(
      spec,
      readFileSync(spec, "utf8").replace("status: blocked", "status: blocked\nbranch: --force-me"),
    );
    const findings = await detectWorktrees({
      repoRoot: root,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      bookkeepingOnly: async () => true,
    });
    const calls: string[][] = [];
    const fixed = await applyFixes(findings, {
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
      exec: async (_c, args) => {
        calls.push(args);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(calls.some((a) => a[0] === "branch")).toBe(false);
    expect(fixed[0].action).toMatch(/refused to delete branch/);
  });
});

describe("a leftover directory under .worktrees/ is not a worktree", () => {
  it("reports it honestly instead of asking git about the enclosing repo", async () => {
    // Found by the first real scan of this repo: `.worktrees/dev-a10001` is
    // a stale `mobile/.dart_tool` tree with no `.git` at all. Running git
    // with cwd there does not fail — git walks UP and answers about the
    // MAIN checkout, so the bookkeeping probe reported main's dirty state
    // and doctor claimed a pile of build artifacts held work worth keeping.
    const root = fixture({ specs: { leftov: { status: "done" } }, worktrees: ["dev-leftov"] });
    rmSync(join(root, ".worktrees", "dev-leftov", ".git"));
    let probed = false;
    const found = await detectWorktrees({
      repoRoot: root,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      bookkeepingOnly: async () => {
        probed = true;
        return true;
      },
    });
    expect(probed).toBe(false);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "orphan-worktree", fixable: false });
    expect(found[0].detail).toMatch(/NOT a registered git worktree/);
  });

  it("classifies a REGISTERED, done, bookkeeping-only worktree as fixable", async () => {
    // The most common leftover: a post-merge cleanup that did not finish.
    // It used to fall through to orphan-worktree with the text "holds real
    // work or uncommitted changes" — provably false on that path.
    const root = fixture({ specs: { pmc111: { status: "done" } }, worktrees: ["dev-pmc111"] });
    const found = await detectWorktrees({
      repoRoot: root,
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      bookkeepingOnly: async () => true,
    });
    expect(found[0]).toMatchObject({ class: "bookkeeping-only-abandonment", fixable: true });
    expect(found[0].detail).toMatch(/post-merge cleanup that did not finish/);
  });
});

describe("runDoctor survives a held backlog lock (LOW — the exit-code contract)", () => {
  it("reports findings and keeps exit 3 instead of exploding with exit 1", async () => {
    const root = fixture({
      specs: { held111: { status: "done" } },
      locks: { held111: { session: "/devx-old" } },
    });
    let stdout = "";
    let stderr = "";
    const code = await runDoctor(["--fix"], {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
      projectPath: join(root, "devx.config.yaml"),
      repoRoot: root,
      detectOpts: { pidAlive: deadPid },
      fixOpts: {
        lock: (() => {
          throw new Error("backlog lock timeout after 30000ms");
        }) as never,
      },
    });
    expect(code).toBe(3);
    expect(stderr).toMatch(/--fix could not run/);
    expect(stdout).toMatch(/stale-lock/);
  });
});

describe("dead-blocker reads BOTH sources (AC 7 — the frontmatter arm)", () => {
  it("flags a blocker declared only in the spec's frontmatter", async () => {
    // The AC says "a `blocked_by:` / `Blocked-by:`". Reading only the backlog
    // row's prose made a spec whose blocker lives in frontmatter invisible.
    const root = fixture({
      specs: { fmpar1: { status: "done" }, fmkid1: { status: "blocked" } },
    });
    const spec = join(root, "dev", "dev-fmkid1-2026-08-21T10:00-fixture.md");
    writeFileSync(
      spec,
      readFileSync(spec, "utf8").replace("status: blocked", "status: blocked\nblocked_by: [fmpar1]"),
    );
    const found = detectDeadBlockers({ repoRoot: root });
    expect(found).toHaveLength(1);
    expect(found[0].target).toBe("fmkid1 → fmpar1");
  });

  it("does not double-report a blocker named in both places", () => {
    const root = fixture({
      specs: { dbpar1: { status: "done" }, dbkid1: { status: "blocked", blockedBy: ["dbpar1"] } },
    });
    const spec = join(root, "dev", "dev-dbkid1-2026-08-21T10:00-fixture.md");
    writeFileSync(
      spec,
      readFileSync(spec, "utf8").replace("status: blocked", "status: blocked\nblocked_by: [dbpar1]"),
    );
    expect(detectDeadBlockers({ repoRoot: root })).toHaveLength(1);
  });
});

describe("devx devx-helper release-lock (absorbed ee7049)", () => {
  function repo(session: string | null): { root: string; lockPath: string } {
    const root = mkdtempSync(join(tmpdir(), "devx-release-lock-"));
    roots.push(root);
    writeFileSync(join(root, "devx.config.yaml"), "mode: yolo\n");
    mkdirSync(join(root, ".devx-cache", "locks"), { recursive: true });
    const lockPath = join(root, ".devx-cache", "locks", "spec-rel111.lock");
    if (session !== null) {
      writeFileSync(
        lockPath,
        composeSpecLockBody({ session, claimedAt: "2026-08-21T10:00:00-06:00" }),
      );
    }
    return { root, lockPath };
  }
  function run(root: string, args: string[]) {
    let stdout = "";
    let stderr = "";
    const code = runReleaseLock(args, {
      out: (s) => {
        stdout += s;
      },
      err: (s) => {
        stderr += s;
      },
      projectPath: join(root, "devx.config.yaml"),
      repoRoot: root,
      lock: (<T,>(_l: string, fn: () => T): T => fn()) as never,
    });
    return { code, stdout, stderr };
  }

  it("releases a lock this session owns", () => {
    const { root, lockPath } = repo("/devx-mine");
    const r = run(root, ["rel111", "--session-token", "/devx-mine"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).released).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("exit 3 and LEAVES a peer's lock — the whole reason this replaced a raw rm", () => {
    const { root, lockPath } = repo("/devx-PEER");
    const r = run(root, ["rel111", "--session-token", "/devx-mine"]);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout).reason).toBe("not-owner");
    expect(existsSync(lockPath)).toBe(true);
  });

  it("exit 0 when the lock is already gone (idempotent)", () => {
    const { root } = repo(null);
    const r = run(root, ["rel111", "--session-token", "/devx-mine"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).reason).toBe("missing");
  });

  it("refuses to auto-derive or accept an empty token", () => {
    const { root } = repo("/devx-mine");
    expect(run(root, ["rel111"]).code).toBe(64);
    expect(run(root, ["rel111", "--session-token", "  "]).code).toBe(64);
    expect(run(root, ["rel111", "--session-token", "  "]).stderr).toMatch(
      /never one copied from the spec's owner/,
    );
  });
});
