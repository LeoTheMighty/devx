// Claim contention (mlc104 — src/lib/devx/claim.ts rebase-retry).
//
// The R2 race from the multi-loop-concurrency design: a peer pushes to
// origin/main between our last fetch and our claim push, so the push is
// rejected non-fast-forward. Pre-mlc104 that was a hard
// ClaimError('git-push') + full rollback; now it rebase-retries (≤2 rounds)
// inside the locked claim section and only a still-lost race raises
// ClaimContendedError — a class deliberately distinct from ClaimError so
// the loop driver can route it off the systemic-failure budget.
//
// Real git fixtures (bare origin + clone + peer clone) — the race is
// staged by having the peer advance origin behind the fixture's back.
//
// Spec: dev/dev-mlc104-2026-07-28T09:02-claim-contention-harness.md
// Eval twin: _devx/workstreams/multi-loop-concurrency/evals/E-4_claim-contention.ts

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CLAIM_PUSH_MAX_RETRIES,
  ClaimContendedError,
  ClaimError,
  type Exec,
  claimSpec,
  isRejectedPush,
} from "../src/lib/devx/claim.js";
import { runClaim } from "../src/commands/devx-helper.js";
import { GIT } from "./helpers/git-bin.js";

// ---------------------------------------------------------------------------
// Fixture: bare origin + main clone + peer clone
// ---------------------------------------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function g(cwd: string, ...args: string[]): string {
  return execFileSync(GIT, args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

const realExec: Exec = (cmd, args, opts) => {
  const r = execFileSync(cmd, args, {
    cwd: opts?.cwd,
    env: GIT_ENV,
    encoding: "utf8" as const,
  });
  return { stdout: r, stderr: "", exitCode: 0 };
};

// execFileSync throws on non-zero — wrap so claimSpec sees {exitCode, stderr}.
const exec: Exec = (cmd, args, opts) => {
  try {
    return realExec(cmd, args, opts);
  } catch (err) {
    const e = err as { status?: number; stdout?: unknown; stderr?: unknown };
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      exitCode: e.status ?? -1,
    };
  }
};

const HASH = "cc11ee";
const SPEC_REL = `dev/dev-${HASH}-2026-07-28T08:00-contend-item.md`;

interface Fixture {
  base: string;
  root: string;
  origin: string;
  peer: string;
}

function makeFixture(): Fixture {
  const base = mkdtempSync(join(tmpdir(), "devx-claim-contention-"));
  const origin = join(base, "origin.git");
  const root = join(base, "repo");
  execFileSync(GIT, ["init", "--bare", "-q", "-b", "main", origin], { env: GIT_ENV });
  execFileSync(GIT, ["clone", "-q", origin, root], { env: GIT_ENV });
  g(root, "config", "user.email", "t@example.com");
  g(root, "config", "user.name", "t");
  g(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "dev"), { recursive: true });
  writeFileSync(
    join(root, "DEV.md"),
    `# DEV\n\n- [ ] \`${SPEC_REL}\` — Contend item. Status: ready.\n`,
  );
  writeFileSync(
    join(root, SPEC_REL),
    [
      "---",
      `hash: ${HASH}`,
      "type: dev",
      "created: 2026-07-28T08:00:00-06:00",
      'title: "Contend item"',
      "status: ready",
      "branch: null",
      "---",
      "",
      "## Goal",
      "",
      "Fixture.",
      "",
      "## Status log",
      "",
      "- 2026-07-28T08:00 — filed.",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n.worktrees/\n");
  g(root, "add", "-A");
  g(root, "commit", "-q", "-m", "fixture: init");
  g(root, "push", "-q", "-u", "origin", "main");

  const peer = join(base, "peer");
  execFileSync(GIT, ["clone", "-q", origin, peer], { env: GIT_ENV });
  g(peer, "config", "user.email", "peer@example.com");
  g(peer, "config", "user.name", "peer");
  g(peer, "config", "commit.gpgsign", "false");
  return { base, root, origin, peer };
}

function peerPush(fx: Fixture, msg: string): string {
  g(fx.peer, "commit", "--allow-empty", "-m", msg, "--no-gpg-sign");
  g(fx.peer, "push", "-q", "origin", "main");
  return g(fx.peer, "rev-parse", "HEAD");
}

const CONFIG = {
  git: { default_branch: "main", integration_branch: null, branch_prefix: "feat/" },
};

function claimOpts(fx: Fixture, extra: Record<string, unknown> = {}) {
  return {
    sessionId: "contention-test-session",
    repoRoot: fx.root,
    config: CONFIG,
    exec,
    ...extra,
  };
}

let fx: Fixture | null = null;
afterEach(() => {
  if (fx) rmSync(fx.base, { recursive: true, force: true });
  fx = null;
});

// ---------------------------------------------------------------------------
// isRejectedPush classification
// ---------------------------------------------------------------------------

describe("isRejectedPush", () => {
  it("matches the race-shaped rejections", () => {
    for (const s of [
      " ! [rejected]        main -> main (fetch first)",
      "hint: Updates were rejected because the remote contains work that you do not\nhint: have locally... non-fast-forward",
    ]) {
      expect(isRejectedPush(s), s).toBe(true);
    }
  });
  it("does NOT match broken-push failures (those keep the ClaimError path)", () => {
    for (const s of [
      "fatal: '/nope/origin.git' does not appear to be a git repository",
      "fatal: Could not read from remote repository.",
      "fatal: Authentication failed for 'https://github.com/x/y'",
      // The generic refused-push trailer alone: printed on hook/policy
      // rejections too (pre-push hook, "[remote rejected]") — not a race.
      "no\nerror: failed to push some refs to '/origin.git'",
      " ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs to '/origin.git'",
      // A stale remote ref-lock is persistent debris, not a race (EC-3).
      "error: cannot lock ref 'refs/heads/main'",
      "",
    ]) {
      expect(isRejectedPush(s), s).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Rebase-retry lands a raced claim (AC 1 / E-4 shape)
// ---------------------------------------------------------------------------

describe("claimSpec under a lost push race", () => {
  it("rebases + re-pushes and lands the claim at origin's tip, peer commit preserved", async () => {
    fx = makeFixture();
    const peerSha = peerPush(fx, "peer: race winner");

    const result = await claimSpec(HASH, claimOpts(fx));
    expect(result.branch).toBe(`feat/dev-${HASH}`);

    // The claim commit is at origin/main's tip…
    const localHead = g(fx.root, "rev-parse", "main");
    expect(g(fx.root, "ls-remote", "origin", "refs/heads/main")).toContain(localHead);
    // …ON TOP of the peer's commit (rebase, never a force-push).
    expect(
      execFileSync(GIT, ["merge-base", "--is-ancestor", peerSha, "main"], {
        cwd: fx.root,
        env: GIT_ENV,
      }),
    ).toBeDefined();
    expect(g(fx.root, "log", "-1", "--format=%s")).toBe(`chore: claim ${HASH} for /devx`);
    // DEV.md row flipped and committed.
    expect(readFileSync(join(fx.root, "DEV.md"), "utf8")).toContain(`- [/] \`${SPEC_REL}\``);
  });

  it("still-lost after the bounded retries throws ClaimContendedError with a clean rollback", async () => {
    fx = makeFixture();
    let pushes = 0;
    // Inject a fresh peer push before EVERY push attempt so the race is
    // lost on the initial push and on both rebase-retries.
    const racingExec: Exec = (cmd, args, o) => {
      if (cmd === "git" && args[0] === "push" && fx) {
        pushes++;
        peerPush(fx, `peer: race winner ${pushes}`);
      }
      return exec(cmd, args, o);
    };

    let thrown: unknown = null;
    try {
      await claimSpec(HASH, claimOpts(fx, { exec: racingExec }));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaimContendedError);
    expect(thrown).not.toBeInstanceOf(ClaimError);
    expect((thrown as ClaimContendedError).hash).toBe(HASH);
    expect((thrown as ClaimContendedError).retries).toBe(CLAIM_PUSH_MAX_RETRIES);
    // Initial push + exactly CLAIM_PUSH_MAX_RETRIES re-pushes.
    expect(pushes).toBe(1 + CLAIM_PUSH_MAX_RETRIES);

    // Rollback: no claim commit on local main, working tree matches the
    // post-pull HEAD (peer commits retained — NOT rewound), row unflipped,
    // lock released, no worktree.
    expect(g(fx.root, "log", "--format=%s")).not.toContain("chore: claim");
    expect(g(fx.root, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(fx.root, "DEV.md"), "utf8")).toContain(`- [ ] \`${SPEC_REL}\``);
    expect(existsSync(join(fx.root, ".devx-cache", "locks", `spec-${HASH}.lock`))).toBe(false);
    expect(existsSync(join(fx.root, ".worktrees", `dev-${HASH}`))).toBe(false);
  });

  it("keeps peer commits from the pull when rolling back (working tree not rewound to pre-peer state)", async () => {
    fx = makeFixture();
    // Peer flips a DIFFERENT part of the repo (a second file) so we can
    // detect a stale-restore: the rollback must leave the peer's content.
    writeFileSync(join(fx.peer, "PEER.md"), "peer content\n");
    g(fx.peer, "add", "PEER.md");
    let pushes = 0;
    const racingExec: Exec = (cmd, args, o) => {
      if (cmd === "git" && args[0] === "push" && fx) {
        pushes++;
        peerPush(fx, `peer: winner ${pushes}`);
      }
      return exec(cmd, args, o);
    };
    await expect(claimSpec(HASH, claimOpts(fx, { exec: racingExec }))).rejects.toThrow(
      ClaimContendedError,
    );
    // The pull --rebase landed the peer's commits locally; rollback must not
    // have reverted DEV.md to a pre-peer copy (peer never touched DEV.md, so
    // HEAD's DEV.md === the unflipped row) and PEER.md must exist.
    expect(existsSync(join(fx.root, "PEER.md"))).toBe(true);
    expect(g(fx.root, "status", "--porcelain")).toBe("");
  });

  it("conflicted rebase (peer edited the same DEV.md region) aborts, rolls back, and reports retries=0", async () => {
    fx = makeFixture();
    // The peer claims THE SAME row — its DEV.md edit conflicts with ours,
    // so the pull --rebase fails mid-rebase and the abort path runs
    // (review EC-15: the cross-machine same-row race branch).
    const peerDevMd = readFileSync(join(fx.peer, "DEV.md"), "utf8").replace(
      `- [ ] \`${SPEC_REL}\``,
      `- [/] \`${SPEC_REL}\``,
    );
    writeFileSync(join(fx.peer, "DEV.md"), peerDevMd);
    g(fx.peer, "add", "DEV.md");
    peerPush(fx, "peer: claims the same row");

    let thrown: unknown = null;
    try {
      await claimSpec(HASH, claimOpts(fx));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaimContendedError);
    // Zero re-pushes ran — the retry count must say so, not the constant.
    expect((thrown as ClaimContendedError).retries).toBe(0);
    // Abort + rollback: no mid-rebase state, no claim commit, pre-claim
    // content restored, lock released.
    expect(existsSync(join(fx.root, ".git", "rebase-merge"))).toBe(false);
    expect(g(fx.root, "log", "--format=%s")).not.toContain("chore: claim");
    expect(g(fx.root, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(fx.root, "DEV.md"), "utf8")).toContain(`- [ ] \`${SPEC_REL}\``);
    expect(existsSync(join(fx.root, ".devx-cache", "locks", `spec-${HASH}.lock`))).toBe(false);
  });

  it("a NON-race failure on the re-push classifies ClaimError, even after a real race in round 1 (BH-2)", async () => {
    fx = makeFixture();
    let pushes = 0;
    const racingThenBrokenExec: Exec = (cmd, args, o) => {
      if (cmd === "git" && args[0] === "push") {
        pushes++;
        if (pushes === 1 && fx) {
          peerPush(fx, "peer: round-1 winner");
          return exec(cmd, args, o); // real rejection
        }
        // Round 2+: the network died mid-retry — not a race.
        return {
          stdout: "",
          stderr: "fatal: Could not read from remote repository.",
          exitCode: 128,
        };
      }
      return exec(cmd, args, o);
    };
    let thrown: unknown = null;
    try {
      await claimSpec(HASH, claimOpts(fx, { exec: racingThenBrokenExec }));
    } catch (e) {
      thrown = e;
    }
    // Classification is by the FINAL failure: a broken push must reach the
    // driver's systemic budget even though round 1 genuinely raced.
    expect(thrown).toBeInstanceOf(ClaimError);
    expect(thrown).not.toBeInstanceOf(ClaimContendedError);
    expect((thrown as ClaimError).stage).toBe("git-push");
    expect(existsSync(join(fx.root, ".devx-cache", "locks", `spec-${HASH}.lock`))).toBe(false);
  });

  it("non-race push failures keep the ClaimError('git-push') path", async () => {
    fx = makeFixture();
    // Point origin at a nonexistent path — push fails, but NOT as a
    // rejection; must stay ClaimError so the driver's systemic budget
    // still counts genuinely broken claims.
    g(fx.root, "remote", "set-url", "origin", join(fx.base, "nope.git"));
    let thrown: unknown = null;
    try {
      await claimSpec(HASH, claimOpts(fx));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ClaimError);
    expect(thrown).not.toBeInstanceOf(ClaimContendedError);
    expect((thrown as ClaimError).stage).toBe("git-push");
    // Standard rollback applied.
    expect(readFileSync(join(fx.root, "DEV.md"), "utf8")).toContain(`- [ ] \`${SPEC_REL}\``);
    expect(existsSync(join(fx.root, ".devx-cache", "locks", `spec-${HASH}.lock`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI mapping (devx devx-helper claim)
// ---------------------------------------------------------------------------

describe("runClaim CLI mapping", () => {
  it("maps ClaimContendedError to exit 1 with {error: 'claim-contended'}", async () => {
    fx = makeFixture();
    writeFileSync(join(fx.root, "devx.config.yaml"), "mode: YOLO\n");
    let pushes = 0;
    const racingExec: Exec = (cmd, args, o) => {
      if (cmd === "git" && args[0] === "push" && fx) {
        pushes++;
        peerPush(fx, `peer: cli winner ${pushes}`);
      }
      return exec(cmd, args, o);
    };
    const stdout: string[] = [];
    const code = await runClaim([HASH], {
      out: (s) => stdout.push(s),
      err: () => {},
      projectPath: join(fx.root, "devx.config.yaml"),
      repoRoot: fx.root,
      sessionId: "cli-contention-test",
      claimOpts: { exec: racingExec, config: CONFIG },
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout.join(""));
    expect(parsed.error).toBe("claim-contended");
    expect(parsed.hash).toBe(HASH);
    expect(parsed.retries).toBe(CLAIM_PUSH_MAX_RETRIES);
  });
});
