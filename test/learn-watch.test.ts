// rtl103 — the watcher-core suite: readiness (T3.1), repo allowlist and
// prompt-ability (T3.2), pickReady + malformed classification (T3.3), outcome
// mapping + finish + requeue + singleton (T3.4).
//
// rtl104 extends it with the spawn half (T4.1, T4.2): session-id validation,
// the wrapper command's trap shape, arm selection, and the osascript/tmux
// argv builders.
//
// Acceptance: _devx/workstreams/retro-listener/evals/E-3_readiness-failsafe.ts
// (the four readiness cases + the strict-ISO pin), E-4_watch-serial-outcomes.ts
// and E-9_wrapper-guard.ts. Case names below name the trap they pin, so a
// failure reads as the failure mode rather than as "expected true, got false".
//
// Every case runs against a tmpdir learn home and injected seams — no real
// clock, no real git, no real terminal — so nothing here can touch
// `~/.claude/devx`, open a window, or take a real SIGTTIN. The single
// exception is the wrapper-execution pair, which runs the built command under
// `sh` with a stub `claude` on PATH: the trap/quoting/marker semantics are the
// whole point of the file, and asserting them on the *string* alone is how
// upstream shipped three of the bugs these cases pin.
//
// Spec: dev/dev-rtl103-2026-07-30T09:31-watcher-core.md (T3.5),
//       dev/dev-rtl104-2026-07-30T09:31-watcher-cli-spawn.md (T4.5)

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type QueueEntry,
  type TaggedEntry,
  PathLockHeldError,
  appendDone,
  appendPending,
  doneMarkerPath,
  donePath,
  endedMarkerPath,
  markersDir,
  queueLockPath,
  queuePath,
  readDone,
  readQueue,
  removeFromQueue,
  reposPath,
  watchLockPath,
  withQueueLock,
} from "../src/lib/learn/queue.js";
import {
  type RunFn,
  type SpawnResult,
  TMUX_WINDOW_NAME,
  buildWrapperCommand,
  escapeAppleScript,
  isSpawnableSessionId,
  selectSpawnArm,
  shellQuote,
  spawnRetro,
  terminalArgv,
  tmuxArgv,
} from "../src/lib/learn/spawn.js";
import { buildProgram } from "../src/cli.js";
import {
  resolveLearnEnv,
  runLearnWatch,
  runLearnWatchList,
  runLearnWatchRequeue,
} from "../src/commands/learn-watch.js";
import {
  DEFAULT_IDLE_SECONDS,
  type DrainSummary,
  type SpawnFn,
  awaitMarker,
  canPrompt,
  claimWatcherSingleton,
  classifyEntry,
  drainPass,
  finish,
  mapMarkerToOutcome,
  pickReady,
  queuedAt,
  readRepos,
  recordRepoDecision,
  repoDecision,
  repoKey,
  repoLookup,
  requeueFromDone,
  resetRepoKeyCache,
  runWatch,
  sessionOver,
  skipKey,
} from "../src/lib/learn/watch.js";

const IDLE_SECONDS = 15 * 60;
const NOW = Date.parse("2026-07-29T12:00:00.000Z");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rtl103-learn-"));
  resetRepoKeyCache();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  resetRepoKeyCache();
});

/** Readiness options with the clock pinned; `mtimeMs` stays the real stat. */
function opts(extra: Record<string, unknown> = {}) {
  return { home, idleSeconds: IDLE_SECONDS, now: () => NOW, ...extra };
}

/** A transcript file whose mtime is `agoMs` before the pinned NOW. */
function transcriptAged(name: string, agoMs: number): string {
  const path = join(home, name);
  writeFileSync(path, "{}\n");
  const when = new Date(NOW - agoMs);
  utimesSync(path, when, when);
  return path;
}

const isoAgo = (ms: number): string => new Date(NOW - ms).toISOString();

// ---------------------------------------------------------------------------
// queuedAt — the strict-ISO pin (E-3 case e)
// ---------------------------------------------------------------------------

describe("queuedAt", () => {
  it("parses the millisecond ISO stamp the listener actually writes", () => {
    expect(queuedAt({ ts: "2026-07-29T10:00:00.000Z" })).toBe(
      Date.parse("2026-07-29T10:00:00.000Z"),
    );
  });

  it("accepts second precision and explicit offsets", () => {
    expect(queuedAt({ ts: "2026-07-29T10:00:00Z" })).toBe(Date.parse("2026-07-29T10:00:00Z"));
    expect(queuedAt({ ts: "2026-07-29T04:00:00.000-06:00" })).toBe(
      Date.parse("2026-07-29T10:00:00.000Z"),
    );
  });

  it("rejects a hand-edited date-only string (strict regex, not Date.parse)", () => {
    // Date.parse("2026-07-28") succeeds — that leniency is the bug being pinned.
    expect(Number.isNaN(Date.parse("2026-07-28"))).toBe(false);
    expect(queuedAt({ ts: "2026-07-28" })).toBeNull();
  });

  it("rejects other undatable shapes rather than guessing an instant", () => {
    for (const ts of [
      undefined,
      null,
      "",
      "   ",
      42,
      "yesterday",
      "2026-07-29 10:00:00Z", // space instead of T
      "2026-07-29T10:00:00", // no zone
      "2026-02-31T10:00:00Z", // shape-valid, cannot exist
      "2026-13-01T10:00:00Z",
      "2026-07-32T10:00:00Z",
      "2026-07-29T25:00:00Z",
      "2026-07-29T10:60:00Z",
    ]) {
      expect(queuedAt({ ts })).toBeNull();
    }
  });

  it("range-checks the calendar rather than trusting Date.parse's rollover", () => {
    // Date.parse rolls 2026-02-31 forward to March 3rd instead of rejecting it —
    // a *wrong* age holds an entry back for days, worse than no age at all.
    expect(Number.isNaN(Date.parse("2026-02-31T10:00:00Z"))).toBe(false);
    expect(queuedAt({ ts: "2026-02-31T10:00:00Z" })).toBeNull();
    expect(queuedAt({ ts: "2028-02-29T10:00:00Z" })).toBe(Date.parse("2028-02-29T10:00:00Z"));
    expect(queuedAt({ ts: "2026-02-29T10:00:00Z" })).toBeNull(); // 2026 isn't a leap year
  });

  it("keys off the ORIGINAL ts, ignoring requeued_ts (a requeue is instantly ready)", () => {
    const entry = { ts: "2026-07-29T01:00:00.000Z", requeued_ts: isoAgo(0) };
    expect(queuedAt(entry)).toBe(Date.parse("2026-07-29T01:00:00.000Z"));
    expect(sessionOver({ ...entry, session_id: "req-1", transcript_path: null }, opts())).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// sessionOver — the E-3 readiness matrix
// ---------------------------------------------------------------------------

describe("sessionOver", () => {
  it("(a) fresh transcript → not over (would otherwise spawn mid-session)", () => {
    const tp = transcriptAged("fresh.jsonl", 60_000);
    expect(sessionOver({ session_id: "s-fresh", transcript_path: tp, ts: isoAgo(2 * 3600_000) }, opts())).toBe(
      false,
    );
  });

  it("(b) idle transcript → over (the fallback trigger, not the fast path)", () => {
    const tp = transcriptAged("idle.jsonl", 30 * 60_000);
    expect(sessionOver({ session_id: "s-idle", transcript_path: tp, ts: isoAgo(2 * 3600_000) }, opts())).toBe(
      true,
    );
  });

  it("(c) missing transcript + young entry → NOT ready (fail-open readiness bug)", () => {
    expect(
      sessionOver({ session_id: "s-young", transcript_path: null, ts: isoAgo(60_000) }, opts()),
    ).toBe(false);
  });

  it("(c') a transcript_path that no longer exists ages like a missing one", () => {
    const gone = join(home, "vanished.jsonl");
    expect(
      sessionOver({ session_id: "s-gone", transcript_path: gone, ts: isoAgo(60_000) }, opts()),
    ).toBe(false);
    expect(
      sessionOver({ session_id: "s-gone", transcript_path: gone, ts: isoAgo(30 * 60_000) }, opts()),
    ).toBe(true);
  });

  it("(d) missing transcript + aged-out entry → ready (entries can't wait forever)", () => {
    expect(
      sessionOver({ session_id: "s-old", transcript_path: null, ts: isoAgo(30 * 60_000) }, opts()),
    ).toBe(true);
  });

  it("(d') the missing-transcript arm stays not-ready for the whole idle window", () => {
    for (const minutes of [0, 1, 7, 14.9, 15]) {
      expect(
        sessionOver(
          { session_id: "s-window", transcript_path: null, ts: isoAgo(minutes * 60_000) },
          opts(),
        ),
      ).toBe(false);
    }
    expect(
      sessionOver(
        { session_id: "s-window", transcript_path: null, ts: isoAgo(15.1 * 60_000) },
        opts(),
      ),
    ).toBe(true);
  });

  it("(e) undatable hand-edited ts serves rather than wedging the serial queue", () => {
    expect(
      sessionOver({ session_id: "s-undatable", transcript_path: null, ts: "2026-07-28" }, opts()),
    ).toBe(true);
  });

  it("the .ended marker is the fast path — it beats a still-fresh transcript", () => {
    const tp = transcriptAged("marked.jsonl", 60_000);
    const entry = { session_id: "s-marked", transcript_path: tp, ts: isoAgo(60_000) };
    expect(sessionOver(entry, opts())).toBe(false);
    mkdirSync(markersDir(home), { recursive: true });
    writeFileSync(endedMarkerPath(home, "s-marked"), "", { flag: "w" });
    expect(sessionOver(entry, opts())).toBe(true);
  });

  it("an unsafe session id falls through to the age arm instead of throwing", () => {
    expect(() =>
      sessionOver({ session_id: "../escape", transcript_path: null, ts: isoAgo(60_000) }, opts()),
    ).not.toThrow();
    expect(
      sessionOver({ session_id: "../escape", transcript_path: null, ts: isoAgo(60_000) }, opts()),
    ).toBe(false);
  });

  it("honours the injected idle window and defaults to 15 minutes", () => {
    expect(DEFAULT_IDLE_SECONDS).toBe(15 * 60);
    const entry = { session_id: "s-cfg", transcript_path: null, ts: isoAgo(3 * 60_000) };
    expect(sessionOver(entry, opts({ idleSeconds: 60 }))).toBe(true);
    expect(sessionOver(entry, opts({ idleSeconds: 3600 }))).toBe(false);
    expect(sessionOver(entry, { home, now: () => NOW })).toBe(false); // default 15m
  });

  it("takes mtime through the injectable stat seam", () => {
    const entry = { session_id: "s-seam", transcript_path: "/nowhere/real.jsonl", ts: isoAgo(0) };
    expect(sessionOver(entry, opts({ mtimeMs: () => NOW - 60_000 }))).toBe(false);
    expect(sessionOver(entry, opts({ mtimeMs: () => NOW - 30 * 60_000 }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// repoKey / repoLookup / recordRepoDecision — allowlist keying
// ---------------------------------------------------------------------------

describe("repoKey", () => {
  it("keys a subdirectory by its repo root, so one checkout is one decision", () => {
    const gitExec = (cwd: string) => (cwd.startsWith("/repo") ? "/repo" : null);
    expect(repoKey("/repo/sub/dir", { gitExec })).toBe("/repo");
    expect(repoKey("/repo", { gitExec })).toBe("/repo");
  });

  it("falls back to the path itself when git says nothing (non-repo or no git)", () => {
    expect(repoKey("/tmp/loose", { gitExec: () => null })).toBe("/tmp/loose");
  });

  it("memoizes per cwd — a poll loop must not fork git every pass", () => {
    let calls = 0;
    const gitExec = (): string => {
      calls++;
      return "/repo";
    };
    for (let i = 0; i < 5; i++) repoKey("/repo/sub", { gitExec });
    expect(calls).toBe(1);
    repoKey("/other", { gitExec });
    expect(calls).toBe(2);
    resetRepoKeyCache();
    repoKey("/repo/sub", { gitExec });
    expect(calls).toBe(3);
  });

  it("returns '' for an absent/blank cwd without consulting git", () => {
    const gitExec = (): string => {
      throw new Error("git must not be consulted for a keyless cwd");
    };
    for (const cwd of [undefined, null, "", "   ", 42]) {
      expect(repoKey(cwd, { gitExec })).toBe("");
    }
  });
});

describe("repoLookup / recordRepoDecision", () => {
  const gitExec = (cwd: string): string | null => (cwd.startsWith("/repo") ? "/repo" : null);

  it("returns null for a repo that was never reviewed", () => {
    expect(repoLookup(home, "/repo/sub", { gitExec })).toBeNull();
  });

  it("finds a decision recorded from a sibling subdirectory (repo-root keyed)", () => {
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(readRepos(home)).toEqual({ "/repo": "allow" });
    expect(repoLookup(home, "/repo/b/deeper", { gitExec })).toBe("allow");
  });

  it("still honours a legacy cwd-keyed row written before repo-root keying", () => {
    writeFileSync(reposPath(home), JSON.stringify({ "/repo/legacy": "deny" }));
    expect(repoLookup(home, "/repo/legacy", { gitExec })).toBe("deny");
  });

  it("a hand-written {\"\": \"allow\"} row is unreachable — no allowlist poisoning", () => {
    writeFileSync(reposPath(home), JSON.stringify({ "": "allow" }));
    expect(readRepos(home)).toEqual({});
    for (const cwd of [undefined, null, "", "   "]) {
      expect(repoLookup(home, cwd, { gitExec })).toBeNull();
    }
  });

  it("refuses to record a decision for a keyless cwd rather than writing \"\"", () => {
    for (const cwd of [undefined, null, "", "  "]) {
      expect(() => recordRepoDecision(home, cwd, "allow", { gitExec })).toThrow(/without a cwd/);
    }
    expect(readRepos(home)).toEqual({});
  });

  it("overwrites an earlier decision for the same repo, keeping the others", () => {
    recordRepoDecision(home, "/repo/a", "deny", { gitExec });
    recordRepoDecision(home, "/elsewhere", "allow", { gitExec });
    recordRepoDecision(home, "/repo/b", "allow", { gitExec });
    expect(readRepos(home)).toEqual({ "/repo": "allow", "/elsewhere": "allow" });
    expect(readFileSync(reposPath(home), "utf8").endsWith("\n")).toBe(true);
  });

  it("degrades a garbage or unknown-verdict repos.json to 'never reviewed'", () => {
    for (const body of ["", "{", "[]", '"nope"', "7", 'null']) {
      writeFileSync(reposPath(home), body);
      expect(readRepos(home)).toEqual({});
      expect(repoLookup(home, "/repo/sub", { gitExec })).toBeNull();
    }
    writeFileSync(reposPath(home), JSON.stringify({ "/repo": "maybe", "/other": 1 }));
    expect(readRepos(home)).toEqual({});
    expect(repoLookup(home, "/repo/sub", { gitExec })).toBeNull();
  });

  it("treats an absent repos.json as empty, not as an error", () => {
    expect(readRepos(join(home, "nope"))).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// canPrompt — the foreground-process-group test
// ---------------------------------------------------------------------------

describe("canPrompt", () => {
  it("is true only for a tty whose STAT reports the foreground '+'", () => {
    expect(canPrompt({ stdinIsTty: () => true, processStat: () => "Ss+" })).toBe(true);
    expect(canPrompt({ stdinIsTty: () => true, processStat: () => "S+" })).toBe(true);
  });

  it("is false for a backgrounded watcher whose stdin is still a tty (BSD nohup)", () => {
    // isatty() alone would say yes here; reading would take SIGTTIN and stop us.
    expect(canPrompt({ stdinIsTty: () => true, processStat: () => "S" })).toBe(false);
    expect(canPrompt({ stdinIsTty: () => true, processStat: () => "Ss" })).toBe(false);
  });

  it("is false when stdin isn't a tty at all (nohup < /dev/null)", () => {
    let asked = false;
    const stat = (): string => {
      asked = true;
      return "S+";
    };
    expect(canPrompt({ stdinIsTty: () => false, processStat: stat })).toBe(false);
    expect(asked).toBe(false);
  });

  it("fails closed when ps is unavailable or unparseable", () => {
    expect(canPrompt({ stdinIsTty: () => true, processStat: () => null })).toBe(false);
    expect(canPrompt({ stdinIsTty: () => true, processStat: () => "   " })).toBe(false);
  });

  it("fails closed when the tty probe itself throws", () => {
    expect(
      canPrompt({
        stdinIsTty: () => {
          throw new Error("EBADF");
        },
        processStat: () => "S+",
      }),
    ).toBe(false);
  });

  it("runs against the real seams without throwing (whatever the answer is)", () => {
    expect(typeof canPrompt()).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// repoDecision — the only prompting consumer (canPrompt re-checked at ask time)
// ---------------------------------------------------------------------------

const gitExec = (cwd: string): string | null => (cwd.startsWith("/repo") ? "/repo" : null);

/** An `ask` seam that records its calls and answers `answer`. */
function asker(answer: string | null) {
  const calls: string[] = [];
  return {
    calls,
    ask: (key: string): string | null => {
      calls.push(key);
      return answer;
    },
  };
}

describe("repoDecision", () => {
  it("short-circuits on a recorded verdict without asking anyone", () => {
    recordRepoDecision(home, "/repo/a", "deny", { gitExec });
    const { ask, calls } = asker("y");
    expect(
      repoDecision(home, "/repo/b", { interactive: true, ask, gitExec, promptable: () => true }),
    ).toBe("deny");
    expect(calls).toEqual([]);
  });

  it("returns 'unknown' for an unreviewed repo when the run isn't interactive", () => {
    const { ask, calls } = asker("y");
    expect(
      repoDecision(home, "/repo/a", { interactive: false, ask, gitExec, promptable: () => true }),
    ).toBe("unknown");
    expect(calls).toEqual([]);
    expect(readRepos(home)).toEqual({});
  });

  it("defers when prompt-ability was lost between the scan and the prompt (bg'd watcher)", () => {
    // The run started interactive; the watcher was Ctrl-Z'd and bg'd since.
    // Reading here would take SIGTTIN and *stop* the process, so we never ask.
    const { ask, calls } = asker("y");
    expect(
      repoDecision(home, "/repo/a", { interactive: true, ask, gitExec, promptable: () => false }),
    ).toBe("unknown");
    expect(calls).toEqual([]);
    expect(readRepos(home)).toEqual({});
  });

  it("re-checks through the real canPrompt seams rather than a cached flag", () => {
    const { ask, calls } = asker("y");
    const opts = {
      interactive: true,
      ask,
      gitExec,
      stdinIsTty: () => true,
      processStat: () => "Ss", // background: no trailing '+'
    };
    expect(repoDecision(home, "/repo/a", opts)).toBe("unknown");
    expect(calls).toEqual([]);
    expect(repoDecision(home, "/repo/a", { ...opts, processStat: () => "Ss+" })).toBe("allow");
    expect(calls).toEqual(["/repo"]);
  });

  it("records the answer under the repo-root key, y/yes → allow and anything else → deny", () => {
    for (const yes of ["y", "Y", "yes", " YES "]) {
      rmSync(reposPath(home), { force: true });
      const { ask } = asker(yes);
      expect(
        repoDecision(home, "/repo/sub", { interactive: true, ask, gitExec, promptable: () => true }),
      ).toBe("allow");
      expect(readRepos(home)).toEqual({ "/repo": "allow" });
    }
    for (const no of ["", "n", "no", "  ", "later", "yep"]) {
      rmSync(reposPath(home), { force: true });
      const { ask } = asker(no);
      expect(
        repoDecision(home, "/repo/sub", { interactive: true, ask, gitExec, promptable: () => true }),
      ).toBe("deny");
      expect(readRepos(home)).toEqual({ "/repo": "deny" });
    }
  });

  it("treats a vanished stdin as 'unknown' rather than looping on an unanswerable prompt", () => {
    const { ask } = asker(null);
    expect(
      repoDecision(home, "/repo/a", { interactive: true, ask, gitExec, promptable: () => true }),
    ).toBe("unknown");
    expect(readRepos(home)).toEqual({});
  });

  it("defers a keyless cwd instead of prompting its way to a poisoned '' key", () => {
    const { ask, calls } = asker("y");
    expect(
      repoDecision(home, "", { interactive: true, ask, gitExec, promptable: () => true }),
    ).toBe("unknown");
    expect(calls).toEqual([]);
    expect(existsSync(reposPath(home))).toBe(false);
  });

  // --- auto_allow (28b267) -------------------------------------------------
  //
  // The evaluation ORDER is the contract: recorded verdict > autoAllow >
  // prompt. Each case below pins one edge of it.

  it("autoAllow serves an unreviewed repo with no terminal and no prompt", () => {
    const { ask, calls } = asker("y");
    expect(
      repoDecision(home, "/repo/a", {
        interactive: false,
        autoAllow: true,
        ask,
        gitExec,
        promptable: () => false,
      }),
    ).toBe("allow");
    expect(calls).toEqual([]);
  });

  it("a recorded deny BEATS autoAllow — the policy never un-denies a human's refusal", () => {
    recordRepoDecision(home, "/repo/a", "deny", { gitExec });
    const { ask, calls } = asker("y");
    expect(
      repoDecision(home, "/repo/sub", {
        interactive: false,
        autoAllow: true,
        ask,
        gitExec,
        promptable: () => true,
      }),
    ).toBe("deny");
    expect(calls).toEqual([]);
  });

  it("a recorded allow still short-circuits under autoAllow (same answer, same path)", () => {
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    const before = readFileSync(reposPath(home), "utf8");
    const { ask, calls } = asker("n");
    expect(
      repoDecision(home, "/repo/sub", {
        interactive: false,
        autoAllow: true,
        ask,
        gitExec,
        promptable: () => true,
      }),
    ).toBe("allow");
    expect(calls).toEqual([]);
    expect(readFileSync(reposPath(home), "utf8")).toBe(before);
  });

  it("autoAllow does NOT write repos.json — a policy is not a decision", () => {
    // The load-bearing property. If the policy recorded, flipping the knob
    // back off would leave every repo the watcher ever touched permanently
    // allowed, and there would be no way back short of hand-editing the file.
    expect(existsSync(reposPath(home))).toBe(false);
    for (const cwd of ["/repo/a", "/repo/b", "/elsewhere"]) {
      expect(
        repoDecision(home, cwd, {
          interactive: false,
          autoAllow: true,
          ask: () => null,
          gitExec,
        }),
      ).toBe("allow");
    }
    // Absent before, absent after: not merely "no new keys" — no file at all.
    expect(existsSync(reposPath(home))).toBe(false);
    expect(readRepos(home)).toEqual({});
  });

  it("autoAllow leaves an EXISTING repos.json byte-identical", () => {
    recordRepoDecision(home, "/repo/a", "deny", { gitExec });
    const before = readFileSync(reposPath(home), "utf8");
    repoDecision(home, "/elsewhere", {
      interactive: false,
      autoAllow: true,
      ask: () => null,
      gitExec,
    });
    expect(readFileSync(reposPath(home), "utf8")).toBe(before);
  });

  it("autoAllow: false / undefined leaves the prompt path exactly as it was", () => {
    for (const autoAllow of [false, undefined]) {
      const { ask, calls } = asker("y");
      expect(
        repoDecision(home, "/repo/a", {
          interactive: false,
          autoAllow,
          ask,
          gitExec,
          promptable: () => true,
        }),
      ).toBe("unknown");
      expect(calls).toEqual([]);
    }
  });

  it("autoAllow outranks the prompt: an interactive run never asks either", () => {
    // Not just a non-interactive shortcut — the policy means "don't ask",
    // full stop, so a foreground watcher with the knob on stops prompting too.
    const { ask, calls } = asker("n");
    expect(
      repoDecision(home, "/repo/a", {
        interactive: true,
        autoAllow: true,
        ask,
        gitExec,
        promptable: () => true,
      }),
    ).toBe("allow");
    expect(calls).toEqual([]);
    expect(existsSync(reposPath(home))).toBe(false);
  });

  it("a keyless cwd still defers UNDER autoAllow — the policy answers 'is this repo allowed'", () => {
    // A cwd-less entry is retired as error-malformed upstream of here, but if
    // it ever reached this path the policy must not become the thing that
    // says "yes, spawn a retro" for an entry whose working directory nobody
    // could name. The keyless guard sits above every arm, not just the prompt.
    for (const cwd of ["", "   ", null, undefined, 42]) {
      expect(
        repoDecision(home, cwd, { interactive: false, autoAllow: true, ask: () => null, gitExec }),
      ).toBe("unknown");
    }
    expect(existsSync(reposPath(home))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyEntry — malformed shapes retired before prompt or spawn (E-4 b)
// ---------------------------------------------------------------------------

describe("classifyEntry", () => {
  it("retires a line with no session_id — there is nothing to resume", () => {
    expect(classifyEntry({ cwd: "/tmp" })).toBe("error-malformed");
    expect(classifyEntry({ session_id: "", cwd: "/tmp" })).toBe("error-malformed");
    expect(classifyEntry({ session_id: 42, cwd: "/tmp" })).toBe("error-malformed");
  });

  it("retires a line with no cwd — the hook can write a null one on the normal path", () => {
    expect(classifyEntry({ session_id: "aaaa-1111" })).toBe("error-malformed");
    expect(classifyEntry({ session_id: "aaaa-1111", cwd: "" })).toBe("error-malformed");
    expect(classifyEntry({ session_id: "aaaa-1111", cwd: "   " })).toBe("error-malformed");
    expect(classifyEntry({ session_id: "aaaa-1111", cwd: null })).toBe("error-malformed");
  });

  it("retires an unsafe session id — its completion marker could never be found", () => {
    for (const sid of ["../escape", "a/b", "with space", " nul"]) {
      expect(classifyEntry({ session_id: sid, cwd: "/tmp" })).toBe("error-malformed");
    }
  });

  it("passes a well-formed entry", () => {
    expect(classifyEntry({ session_id: "aaaa-1111", cwd: "/tmp" })).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// pickReady — skip-don't-starve
// ---------------------------------------------------------------------------

/** Append a pending entry whose `ts` is `agoMs` before the pinned NOW. */
function queued(entry: QueueEntry, agoMs = 30 * 60_000): void {
  appendPending(home, { transcript_path: null, ...entry, ts: isoAgo(agoMs) });
}

function pick(extra: Record<string, unknown> = {}) {
  return pickReady(home, {
    idleSeconds: IDLE_SECONDS,
    now: () => NOW,
    gitExec,
    interactive: false,
    ...extra,
  });
}

const sids = (entries: TaggedEntry[]): unknown[] => entries.map((e) => e.session_id);

describe("pickReady", () => {
  it("returns nothing when the queue is empty", () => {
    expect(pick()).toEqual({ entry: null, unservable: [] });
  });

  it("passes over entries whose session isn't over yet", () => {
    queued({ session_id: "live", cwd: "/repo/a" }, 60_000);
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(pick().entry).toBeNull();
  });

  it("skip-don't-starve: an unreviewed head entry never blocks a later servable one", () => {
    queued({ session_id: "unreviewed", cwd: "/elsewhere" });
    queued({ session_id: "servable", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    const got = pick({ interactive: false });
    expect(got.entry?.session_id).toBe("servable");
    expect(sids(got.unservable)).toEqual(["unreviewed"]);
  });

  it("reports only the unservable entries walked past, not the whole queue", () => {
    queued({ session_id: "u1", cwd: "/elsewhere" });
    queued({ session_id: "servable", cwd: "/repo/a" });
    queued({ session_id: "u2", cwd: "/nowhere" });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(sids(pick().unservable)).toEqual(["u1"]);
  });

  it("serves an unreviewed repo when the run CAN prompt (the decision comes later)", () => {
    queued({ session_id: "unreviewed", cwd: "/elsewhere" });
    const got = pick({ interactive: true });
    expect(got.entry?.session_id).toBe("unreviewed");
    expect(got.unservable).toEqual([]);
  });

  it("serves a denied repo — the drain retires it, it is not 'unservable'", () => {
    queued({ session_id: "denied", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "deny", { gitExec });
    expect(pick().entry?.session_id).toBe("denied");
  });

  it("returns a malformed entry as the pick, ahead of the allowlist arm", () => {
    // Upstream keys a cwd-less entry as "", looks it up as 'never reviewed',
    // and a non-interactive run then reports it as an unreviewed repo forever
    // instead of retiring it. It must come back as the pick so it can be filed.
    queued({ session_id: "no-cwd", cwd: null });
    queued({ session_id: "servable", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    const got = pick({ interactive: false });
    expect(got.entry?.session_id).toBe("no-cwd");
    expect(got.unservable).toEqual([]);
  });

  it("honours the skip set so a dry run doesn't re-pick the same head entry", () => {
    queued({ session_id: "first", cwd: "/repo/a" });
    queued({ session_id: "second", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(pick().entry?.session_id).toBe("first");
    expect(pick({ skip: new Set(["first"]) }).entry?.session_id).toBe("second");
    expect(pick({ skip: new Set(["first", "second"]) }).entry).toBeNull();
  });

  it("skips an id-less malformed line by its line key (dry run can't re-print it)", () => {
    queued({ cwd: null });
    const first = pick().entry;
    expect(first).not.toBeNull();
    expect(skipKey(first as TaggedEntry)).toMatch(/^#line:/);
    expect(pick({ skip: new Set([skipKey(first as TaggedEntry)]) }).entry).toBeNull();
  });

  it("keys an id-less line by its content, so a queue rewrite can't alias two of them", () => {
    // `finish` cuts lines while the run's skip-set lives on: an index-keyed
    // entry would let the survivor inherit the retired line's key.
    queued({ cwd: "/repo/a" });
    queued({ cwd: "/repo/b" });
    const [one, two] = readQueue(home) as TaggedEntry[];
    expect(skipKey(one as TaggedEntry)).not.toBe(skipKey(two as TaggedEntry));
    // The second line's key must not change when it slides up to index 0.
    const keyBefore = skipKey(two as TaggedEntry);
    removeFromQueue(home, one as TaggedEntry);
    const [shifted] = readQueue(home) as TaggedEntry[];
    expect(shifted?.lineIndex).toBe(0);
    expect(skipKey(shifted as TaggedEntry)).toBe(keyBefore);
  });

  it("routes readiness at the same home it read the queue from (.ended fast path)", () => {
    const tp = transcriptAged("live.jsonl", 60_000);
    appendPending(home, { session_id: "marked", cwd: "/repo/a", transcript_path: tp, ts: isoAgo(60_000) });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(pick().entry).toBeNull();
    mkdirSync(markersDir(home), { recursive: true });
    writeFileSync(endedMarkerPath(home, "marked"), "");
    expect(pick().entry?.session_id).toBe("marked");
  });

  it("hands back the line identity removeFromQueue needs", () => {
    queued({ session_id: "one", cwd: "/repo/a" }, 60_000);
    queued({ session_id: "two", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(pick().entry?.lineIndex).toBe(1);
  });

  // --- auto_allow (28b267) -------------------------------------------------

  it("autoAllow makes an unreviewed repo servable to a NON-interactive run", () => {
    // THE regression this story exists to prevent. Without autoAllow reaching
    // pickReady the entry is filtered into `unservable` here and never gets as
    // far as repoDecision — so a version that only taught repoDecision the
    // policy would drain exactly as many entries as before, silently.
    queued({ session_id: "unreviewed", cwd: "/elsewhere" });
    const got = pick({ interactive: false, autoAllow: true });
    expect(got.entry?.session_id).toBe("unreviewed");
    expect(got.unservable).toEqual([]);
  });

  it("autoAllow keeps queue ORDER — the head entry is served, not leapfrogged", () => {
    queued({ session_id: "unreviewed", cwd: "/elsewhere" });
    queued({ session_id: "recorded", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "allow", { gitExec });
    expect(pick({ interactive: false, autoAllow: true }).entry?.session_id).toBe("unreviewed");
  });

  it("autoAllow still yields a denied repo as the pick, so the drain can retire it", () => {
    queued({ session_id: "denied", cwd: "/repo/a" });
    recordRepoDecision(home, "/repo/a", "deny", { gitExec });
    // Unchanged from the non-policy path: `deny` is not "unservable", it is a
    // decision the drain files as `skipped-denied-repo`.
    expect(pick({ interactive: false, autoAllow: true }).entry?.session_id).toBe("denied");
  });

  it("autoAllow does not promote a malformed entry past the classification arm", () => {
    queued({ session_id: "no-cwd", cwd: null });
    queued({ session_id: "servable", cwd: "/elsewhere" });
    const got = pick({ interactive: false, autoAllow: true });
    expect(got.entry?.session_id).toBe("no-cwd");
    expect(got.unservable).toEqual([]);
  });

  it("autoAllow does not override readiness — a live session still waits", () => {
    queued({ session_id: "live", cwd: "/elsewhere" }, 60_000);
    expect(pick({ interactive: false, autoAllow: true }).entry).toBeNull();
  });

  it("autoAllow: false leaves the unservable arm exactly as it was", () => {
    queued({ session_id: "unreviewed", cwd: "/elsewhere" });
    const got = pick({ interactive: false, autoAllow: false });
    expect(got.entry).toBeNull();
    expect(sids(got.unservable)).toEqual(["unreviewed"]);
  });
});

// ---------------------------------------------------------------------------
// mapMarkerToOutcome — all 5 mappings (E-4 a)
// ---------------------------------------------------------------------------

describe("mapMarkerToOutcome", () => {
  it("maps the five documented statuses", () => {
    expect(mapMarkerToOutcome("0")).toBe("completed");
    expect(mapMarkerToOutcome("129")).toBe("completed-interrupted");
    expect(mapMarkerToOutcome("error-cd")).toBe("error-cd");
    expect(mapMarkerToOutcome("3")).toBe("error-fork:3");
    expect(mapMarkerToOutcome(null)).toBe("timeout");
  });

  it("treats an absent marker — and only an absent marker — as a timeout", () => {
    expect(mapMarkerToOutcome(undefined)).toBe("timeout");
    // An empty marker still means the wrapper reached its write.
    expect(mapMarkerToOutcome("")).toBe("completed");
    expect(mapMarkerToOutcome("  \n")).toBe("completed");
  });

  it("reads 128+N as the human closing the tab, not as a fork failure", () => {
    expect(mapMarkerToOutcome("128")).toBe("completed-interrupted");
    expect(mapMarkerToOutcome("130")).toBe("completed-interrupted");
    expect(mapMarkerToOutcome("127")).toBe("error-fork:127");
    expect(mapMarkerToOutcome("1")).toBe("error-fork:1");
  });

  it("still understands a 'signal' marker from a pre-rc=$? wrapper in flight", () => {
    expect(mapMarkerToOutcome("signal")).toBe("completed-interrupted");
  });

  it("tolerates the trailing newline a shell redirect writes", () => {
    expect(mapMarkerToOutcome("0\n")).toBe("completed");
    expect(mapMarkerToOutcome(" 129 \n")).toBe("completed-interrupted");
    expect(mapMarkerToOutcome("error-cd\n")).toBe("error-cd");
  });

  it("bounds the status echoed into the done log (it is a dataset, not a spool)", () => {
    expect(mapMarkerToOutcome("boom\nstack trace line\nmore")).toBe("error-fork:boom");
    expect(mapMarkerToOutcome("x".repeat(500))).toBe(`error-fork:${"x".repeat(64)}`);
  });
});

// ---------------------------------------------------------------------------
// finish — done-log append + queue removal + marker cleanup
// ---------------------------------------------------------------------------

const NOW_DATE = (): Date => new Date(NOW);

describe("finish", () => {
  it("files the entry with its outcome and cuts it from the queue", () => {
    queued({ session_id: "aaaa-1111", cwd: "/repo/a" });
    const entry = readQueue(home)[0] as TaggedEntry;
    expect(finish(home, entry, "completed", { now: NOW_DATE })).toBe(true);
    expect(readQueue(home)).toEqual([]);
    expect(readDone(home)).toEqual([
      {
        session_id: "aaaa-1111",
        cwd: "/repo/a",
        transcript_path: null,
        ts: isoAgo(30 * 60_000),
        processed_ts: new Date(NOW).toISOString(),
        outcome: "completed",
      },
    ]);
  });

  it("never leaks the line-identity tags into the done log", () => {
    queued({ session_id: "aaaa-1111", cwd: "/repo/a" });
    finish(home, readQueue(home)[0] as TaggedEntry, "completed", { now: NOW_DATE });
    const raw = readFileSync(donePath(home), "utf8");
    expect(raw).not.toContain("lineIndex");
    expect(raw).not.toContain("rawLine");
  });

  it("retires an id-less line by identity — a sid-keyed API could not", () => {
    queued({ cwd: "/repo/a" });
    queued({ session_id: "keeper", cwd: "/repo/a" });
    expect(finish(home, readQueue(home)[0] as TaggedEntry, "error-malformed")).toBe(true);
    expect(sids(readQueue(home))).toEqual(["keeper"]);
    expect(readDone(home)[0]?.outcome).toBe("error-malformed");
  });

  it("cuts exactly the entry it was handed, leaving its neighbours alone", () => {
    queued({ session_id: "a", cwd: "/repo/a" });
    queued({ session_id: "b", cwd: "/repo/a" });
    queued({ session_id: "c", cwd: "/repo/a" });
    finish(home, readQueue(home)[1] as TaggedEntry, "completed");
    expect(sids(readQueue(home))).toEqual(["a", "c"]);
  });

  it("drops both markers so a requeue can't be served by a stale one", () => {
    queued({ session_id: "aaaa-1111", cwd: "/repo/a" });
    mkdirSync(markersDir(home), { recursive: true });
    writeFileSync(endedMarkerPath(home, "aaaa-1111"), "");
    writeFileSync(doneMarkerPath(home, "aaaa-1111"), "0\n");
    finish(home, readQueue(home)[0] as TaggedEntry, "completed");
    expect(existsSync(endedMarkerPath(home, "aaaa-1111"))).toBe(false);
    expect(existsSync(doneMarkerPath(home, "aaaa-1111"))).toBe(false);
  });

  it("still files the entry when there is no queue row left to cut", () => {
    queued({ session_id: "aaaa-1111", cwd: "/repo/a" });
    const entry = readQueue(home)[0] as TaggedEntry;
    finish(home, entry, "completed");
    expect(finish(home, entry, "completed")).toBe(false);
    expect(readDone(home)).toHaveLength(2); // evidence first: visible, de-dupable
  });

  it("files an unsafe-id entry without trying to derive its marker paths", () => {
    queued({ session_id: "../escape", cwd: "/repo/a" });
    expect(() => finish(home, readQueue(home)[0] as TaggedEntry, "error-malformed")).not.toThrow();
    expect(readQueue(home)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// requeueFromDone — keeps the ORIGINAL ts (E-4 d)
// ---------------------------------------------------------------------------

describe("requeueFromDone", () => {
  const ORIGINAL_TS = "2026-07-29T01:00:00.000Z";

  function processed(sid: string, outcome = "completed-interrupted", ts = ORIGINAL_TS): void {
    appendDone(
      home,
      { session_id: sid, cwd: "/repo/a", transcript_path: null, ts },
      outcome,
      () => new Date(Date.parse("2026-07-29T02:00:00.000Z")),
    );
  }

  it("keeps the original ts, so a requeued session is instantly ready", () => {
    processed("cccc-3333");
    requeueFromDone(home, "cccc-3333", { now: NOW_DATE });
    const re = readQueue(home)[0];
    expect(re?.ts).toBe(ORIGINAL_TS);
    expect(re?.requeued_ts).toBe(new Date(NOW).toISOString());
    expect(sessionOver(re as QueueEntry, opts())).toBe(true);
  });

  it("strips processed_ts and outcome so the entry reads as pending again", () => {
    processed("cccc-3333");
    requeueFromDone(home, "cccc-3333", { now: NOW_DATE });
    const re = readQueue(home)[0] as Record<string, unknown>;
    expect("outcome" in re).toBe(false);
    expect("processed_ts" in re).toBe(false);
    expect(re.cwd).toBe("/repo/a");
  });

  it("revives the most recent run of a session that was processed twice", () => {
    processed("cccc-3333", "timeout", "2026-07-01T01:00:00.000Z");
    processed("cccc-3333", "error-fork:3", ORIGINAL_TS);
    requeueFromDone(home, "cccc-3333", { now: NOW_DATE });
    expect(readQueue(home)[0]?.ts).toBe(ORIGINAL_TS);
  });

  it("leaves the done log alone — it is append-only evidence", () => {
    processed("cccc-3333");
    requeueFromDone(home, "cccc-3333", { now: NOW_DATE });
    expect(readDone(home)).toHaveLength(1);
    expect(readDone(home)[0]?.outcome).toBe("completed-interrupted");
  });

  it("refuses a session that was never processed", () => {
    expect(() => requeueFromDone(home, "nope", { now: NOW_DATE })).toThrow(/no processed entry/);
    expect(readQueue(home)).toEqual([]);
  });

  it("refuses a session that is already pending — two retros for one session", () => {
    processed("cccc-3333");
    queued({ session_id: "cccc-3333", cwd: "/repo/a" });
    expect(() => requeueFromDone(home, "cccc-3333", { now: NOW_DATE })).toThrow(/already pending/);
    expect(readQueue(home)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// claimWatcherSingleton — serialism is the invariant (E-4 c)
// ---------------------------------------------------------------------------

describe("claimWatcherSingleton", () => {
  it("refuses a second claim — two drainers would both take the head entry", () => {
    const first = claimWatcherSingleton(home);
    try {
      expect(() => claimWatcherSingleton(home)).toThrow(/serial by design/);
    } finally {
      first.release();
    }
  });

  it("lets the next watcher in once the first releases", () => {
    claimWatcherSingleton(home).release();
    const second = claimWatcherSingleton(home);
    second.release();
    expect(existsSync(watchLockPath(home))).toBe(false);
  });

  it("uses a separate inode from the queue lock, so it can't block the hook", () => {
    const held = claimWatcherSingleton(home);
    try {
      // A long-held watcher must not stall the Stop hook's locked append.
      expect(watchLockPath(home)).not.toBe(queueLockPath(home));
      expect(() =>
        withQueueLock(home, () => appendPending(home, { session_id: "x", cwd: "/repo/a" }), {
          timeoutMs: 200,
        }),
      ).not.toThrow();
      expect(sids(readQueue(home))).toEqual(["x"]);
    } finally {
      held.release();
    }
  });
});

// ---------------------------------------------------------------------------
// Session-id validation — before argv/command construction (E-9 e, T4.1)
// ---------------------------------------------------------------------------

const REAL_SID = "0f3a1c9e-2b7d-4a10-9c55-6e8b1d2f3a44";

describe("isSpawnableSessionId", () => {
  it("accepts the UUID Claude Code actually writes into the hook payload", () => {
    expect(isSpawnableSessionId(REAL_SID)).toBe(true);
  });

  it("rejects every shell metacharacter that could reach a command string", () => {
    for (const sid of [
      "$(rm -rf /)",
      "`id`",
      "a; rm -rf /",
      "a b",
      "a\nb",
      "a'b",
      'a"b',
      "a|b",
      "../../etc/passwd",
      "a$b",
    ]) {
      expect(isSpawnableSessionId(sid), sid).toBe(false);
    }
  });

  it("rejects non-strings, the empty string, and an over-long id", () => {
    for (const sid of [null, undefined, 42, {}, "", "abc", "a".repeat(65)]) {
      expect(isSpawnableSessionId(sid)).toBe(false);
    }
  });

  it("is narrower than the queue's filename guard — this id reaches a shell", () => {
    // `abc_def.log` is a legal marker filename but not a legal spawn id: the
    // spawn guard refuses rather than sanitizes, so there is no "quoted it,
    // probably fine" path to reason about.
    expect(isSpawnableSessionId("abc_def.log")).toBe(false);
  });

  it("refuses to build a command for an unsafe id", () => {
    expect(() => buildWrapperCommand("$(rm -rf /)", "/tmp", "/tmp/m.done")).toThrow(
      /unsafe session id/,
    );
  });

  it("refuses to spawn for an unsafe id — before the run seam is reached", () => {
    let calls = 0;
    const run: RunFn = () => {
      calls += 1;
      return 0;
    };
    expect(() =>
      spawnRetro(home, { session_id: "a; rm -rf /", cwd: "/tmp" }, { arm: "tmux", run }),
    ).toThrow(/unsafe session id/);
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// shellQuote — the cwd/marker embedding (T4.1)
// ---------------------------------------------------------------------------

describe("shellQuote", () => {
  it("leaves an ordinary path bare, like shlex.quote", () => {
    expect(shellQuote("/Users/x/code/devx")).toBe("/Users/x/code/devx");
  });

  it("quotes a path with a space", () => {
    expect(shellQuote("/tmp/some repo")).toBe("'/tmp/some repo'");
  });

  it("quotes a path containing a single quote by close-escape-reopen", () => {
    expect(shellQuote("/tmp/leo's repo")).toBe(`'/tmp/leo'\\''s repo'`);
  });

  it("quotes the empty string to '' — a bare empty word would make `cd` a no-op", () => {
    expect(shellQuote("")).toBe("''");
  });
});

// ---------------------------------------------------------------------------
// buildWrapperCommand — the trap inventory (E-9 a–d, T4.1)
// ---------------------------------------------------------------------------

describe("buildWrapperCommand", () => {
  const MARKER = "/tmp/devx-markers/x.done";
  const cmd = (cwd = "/repo/a") => buildWrapperCommand(REAL_SID, cwd, MARKER);

  it("exports DEVX_RETRO=1 ahead of claude — the fork must inherit the guard", () => {
    const c = cmd();
    expect(c).toContain("DEVX_RETRO=1");
    // Anchored on `claude --resume`, not on the substring "claude": the default
    // learn home is `~/.claude/devx`, so the marker path earlier in the command
    // contains "claude" on every real machine.
    expect(c.indexOf("DEVX_RETRO=1")).toBeLessThan(c.indexOf("claude --resume"));
  });

  it("keeps the guard ahead of the fork even when the home path contains 'claude'", () => {
    const c = buildWrapperCommand(REAL_SID, "/repo/a", "/Users/x/.claude/devx/markers/x.done");
    expect(c.indexOf("DEVX_RETRO=1")).toBeLessThan(c.indexOf("claude --resume"));
  });

  it("resumes the session as a fork running /devx-learn", () => {
    expect(cmd()).toContain(`claude --resume ${REAL_SID} --fork-session "/devx-learn"`);
  });

  it("traps HUP INT TERM — a closed tab (SIGHUP) would otherwise wedge the queue", () => {
    expect(cmd()).toMatch(/trap '[^']*'\s+HUP INT TERM/);
  });

  it("installs NO EXIT trap — bash defers traps, so both firing would race", () => {
    expect(cmd()).not.toMatch(/trap '[^']*'[^\n]*EXIT/);
  });

  it("reads $? in the trap instead of asserting an outcome (absorbed Ctrl-C exits 0)", () => {
    expect(cmd()).toContain("rc=$?");
    expect(cmd()).not.toContain("w signal");
  });

  it("writes the marker via tmp+rename so a poller never reads a torn status", () => {
    expect(cmd()).toContain('> "$M.tmp" && mv "$M.tmp" "$M"');
  });

  it("guards the cd and files error-cd — a moved project dir must not read as success", () => {
    expect(cmd()).toContain("|| { w error-cd; exit 1; }");
  });

  it("quotes a cwd with a space and one with a quote in it", () => {
    expect(cmd("/tmp/some repo")).toContain("cd '/tmp/some repo' ||");
    expect(cmd("/tmp/leo's repo")).toContain(`cd '/tmp/leo'\\''s repo' ||`);
  });

  it("keeps the trap body free of single quotes — it lives inside a quoted word", () => {
    const body = /trap '([^']*)'/.exec(cmd())?.[1] ?? "";
    expect(body).not.toBe("");
    expect(body).not.toContain("'");
  });

  it("is syntactically valid sh even with a hostile-looking cwd", () => {
    for (const cwd of ["/repo/a", "/tmp/some repo", "/tmp/leo's repo", `/tmp/a"b`, "/tmp/a\\b"]) {
      const check = spawnSync("sh", ["-n"], { input: cmd(cwd), encoding: "utf8" });
      expect(check.status, `sh -n rejected cwd ${cwd}: ${check.stderr}`).toBe(0);
    }
  });

  it("rejects a missing marker path rather than writing to a bare $M", () => {
    expect(() => buildWrapperCommand(REAL_SID, "/tmp", "")).toThrow(/markerPath/);
  });
});

// ---------------------------------------------------------------------------
// The wrapper, actually run (T4.1) — string assertions can't catch a quoting
// bug that only shows up when `sh` reads it.
// ---------------------------------------------------------------------------

describe("the wrapper under sh", () => {
  /** A `claude` on PATH that exits with `code`, so the marker records a status
   *  we chose rather than whatever the real CLI would do. */
  function stubClaude(code: number): string {
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    const path = join(bin, "claude");
    writeFileSync(path, `#!/bin/sh\nexit ${code}\n`);
    chmodSync(path, 0o755);
    return bin;
  }

  function runWrapper(cwd: string, code: number): { status: number | null; marker: string | null } {
    const bin = stubClaude(code);
    const marker = join(home, "markers", "x.done");
    mkdirSync(join(home, "markers"), { recursive: true });
    const result = spawnSync("sh", ["-c", buildWrapperCommand(REAL_SID, cwd, marker)], {
      encoding: "utf8",
      // Stub dir first so it shadows a real `claude`; the rest of PATH stays
      // because the wrapper's marker write needs `mv`.
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    return {
      status: result.status,
      marker: existsSync(marker) ? readFileSync(marker, "utf8") : null,
    };
  }

  it("records claude's exit status in the marker — a failed fork is not a success", () => {
    const workdir = join(home, "work with space");
    mkdirSync(workdir, { recursive: true });
    expect(runWrapper(workdir, 3).marker).toBe("3");
    expect(runWrapper(workdir, 0).marker).toBe("0");
  });

  it("files error-cd and exits nonzero when the project dir is gone", () => {
    const gone = join(home, "moved-away");
    const { status, marker } = runWrapper(gone, 0);
    expect(marker).toBe("error-cd");
    expect(status).toBe(1);
  });

  it("leaves no .tmp file behind — the rename is a move, not a copy", () => {
    const workdir = join(home, "work");
    mkdirSync(workdir, { recursive: true });
    runWrapper(workdir, 0);
    expect(existsSync(join(home, "markers", "x.done.tmp"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Arm selection (E-4 e, T4.2)
// ---------------------------------------------------------------------------

describe("selectSpawnArm", () => {
  it("prefers tmux when $TMUX is set — it works over ssh, where Terminal.app doesn't", () => {
    expect(selectSpawnArm({ TMUX: "/tmp/tmux-501/default,123,0" }, "darwin")).toBe("tmux");
    expect(selectSpawnArm({ TMUX: "/tmp/tmux-501/default,123,0" }, "linux")).toBe("tmux");
  });

  it("falls back to Terminal.app on darwin", () => {
    expect(selectSpawnArm({}, "darwin")).toBe("terminal");
  });

  it("reports manual on every other platform — nothing here can open a window", () => {
    expect(selectSpawnArm({}, "linux")).toBe("manual");
    expect(selectSpawnArm({}, "win32")).toBe("manual");
  });

  it("treats an empty $TMUX as absent — a cleared var is not a tmux session", () => {
    expect(selectSpawnArm({ TMUX: "" }, "linux")).toBe("manual");
    expect(selectSpawnArm({ TMUX: undefined }, "linux")).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// argv builders + AppleScript escaping (T4.2)
// ---------------------------------------------------------------------------

/** Undo an AppleScript string-literal escape, one character at a time — the
 *  only honest way to assert the escape round-trips. */
function unescapeAppleScript(literal: string): string {
  let out = "";
  for (let i = 0; i < literal.length; i += 1) {
    if (literal[i] === "\\" && i + 1 < literal.length) {
      out += literal[i + 1];
      i += 1;
    } else {
      out += literal[i];
    }
  }
  return out;
}

describe("tmuxArgv", () => {
  it("passes the whole wrapper as one argv element, so tmux never re-splits it", () => {
    const cmd = buildWrapperCommand(REAL_SID, "/tmp/some repo", "/tmp/x.done");
    const [bin, args] = tmuxArgv(cmd);
    expect(bin).toBe("tmux");
    expect(args).toEqual(["new-window", "-n", TMUX_WINDOW_NAME, cmd]);
    expect(args.filter((a) => a === cmd)).toHaveLength(1);
  });
});

describe("terminalArgv / escapeAppleScript", () => {
  it("round-trips a wrapper carrying both quotes and backslashes", () => {
    // The real wrapper always contains `"` (printf "%s", "$rc"); a cwd with a
    // backslash in it is the other half. Escaping in the wrong order —
    // quotes before backslashes — double-escapes and breaks the command.
    const cmd = buildWrapperCommand(REAL_SID, `/tmp/a"b\\c`, "/tmp/x.done");
    expect(cmd).toContain('"');
    expect(cmd).toContain("\\");
    expect(unescapeAppleScript(escapeAppleScript(cmd))).toBe(cmd);
  });

  it("emits the do-script and activate pair around the escaped literal", () => {
    const cmd = buildWrapperCommand(REAL_SID, "/repo/a", "/tmp/x.done");
    const [bin, args] = terminalArgv(cmd);
    expect(bin).toBe("osascript");
    expect(args[0]).toBe("-e");
    expect(args[1]).toBe(`tell application "Terminal" to do script "${escapeAppleScript(cmd)}"`);
    expect(args[2]).toBe("-e");
    expect(args[3]).toBe('tell application "Terminal" to activate');
  });

  // Every other assertion here checks the escape against `unescapeAppleScript`
  // above — a *model* of the parser, written by the same hand as the escaper,
  // so the two agree on any mistake they share. This one hands the literal to
  // the real `osascript` and compares what comes back. It binds the string
  // instead of running `do script`, so it exercises the identical parse without
  // opening a Terminal window (the half of AC 6 that needs a human) or asking
  // for automation permission. Darwin-only: this arm only exists there.
  it.skipIf(process.platform !== "darwin")(
    "survives the real AppleScript parser byte-for-byte, quotes and backslashes included",
    () => {
      for (const cwd of ["/repo/a", `/tmp/we"ird\\path/it's here`]) {
        const cmd = buildWrapperCommand(REAL_SID, cwd, "/tmp/x.done");
        const [, args] = terminalArgv(cmd);
        const literal = String(args[1]).slice(
          String(args[1]).indexOf("do script ") + "do script ".length,
        );
        const r = spawnSync("osascript", ["-e", `set c to ${literal}`, "-e", "return c"], {
          encoding: "utf8",
        });
        expect(r.status, `osascript rejected the literal for ${cwd}: ${r.stderr}`).toBe(0);
        expect(String(r.stdout).replace(/\n$/, "")).toBe(cmd);
      }
    },
  );

  it("leaves no unescaped double quote to terminate the literal early", () => {
    const cmd = buildWrapperCommand(REAL_SID, "/repo/a", "/tmp/x.done");
    const body = escapeAppleScript(cmd);
    // Every `"` in the escaped body must be preceded by an odd-length backslash run.
    for (let i = 0; i < body.length; i += 1) {
      if (body[i] !== '"') continue;
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && body[j] === "\\"; j -= 1) backslashes += 1;
      expect(backslashes % 2, `unescaped quote at ${i}`).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// spawnRetro — dry-run, manual, and the run seam (E-4 e, E-5, T4.2)
// ---------------------------------------------------------------------------

describe("spawnRetro", () => {
  const entry = { session_id: REAL_SID, cwd: "/repo/a" };

  /** A run seam that records what it was asked to do and never runs it. */
  function recorder(status: number | null = 0) {
    const calls: Array<[string, readonly string[]]> = [];
    const run: RunFn = (bin, args) => {
      calls.push([bin, args]);
      return status;
    };
    return { calls, run };
  }

  it("dry-run prints the command and touches nothing at all", () => {
    const printed: string[] = [];
    const { calls, run } = recorder();
    expect(spawnRetro(home, entry, { dryRun: true, run, log: (l) => printed.push(l) })).toBe(
      "dry-run",
    );
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain("[dry-run] would spawn:");
    expect(printed[0]).toContain(REAL_SID);
    expect(calls).toEqual([]);
    // Not even the markers directory: --dry-run is byte-identical by
    // construction, not by a later cleanup.
    expect(existsSync(markersDir(home))).toBe(false);
  });

  it("dry-run wins over the arm — a tmux session must not open a window", () => {
    const { calls, run } = recorder();
    expect(
      spawnRetro(home, entry, { dryRun: true, arm: "tmux", run, log: () => {} }),
    ).toBe("dry-run");
    expect(calls).toEqual([]);
  });

  it("dry-run leaves a stale marker in place rather than unlinking it", () => {
    mkdirSync(markersDir(home), { recursive: true });
    writeFileSync(doneMarkerPath(home, REAL_SID), "0");
    spawnRetro(home, entry, { dryRun: true, log: () => {} });
    expect(readFileSync(doneMarkerPath(home, REAL_SID), "utf8")).toBe("0");
  });

  it("the manual arm prints the command and opens nothing — never awaited", () => {
    const printed: string[] = [];
    const { calls, run } = recorder();
    expect(
      spawnRetro(home, entry, { env: {}, platform: "linux", run, log: (l) => printed.push(l) }),
    ).toBe("manual");
    expect(printed.join("\n")).toContain("run this yourself in another terminal");
    expect(printed.join("\n")).toContain("DEVX_RETRO=1 claude --resume");
    expect(calls).toEqual([]);
  });

  it("opens a tmux window when $TMUX is set and reports spawned on exit 0", () => {
    const { calls, run } = recorder(0);
    expect(
      spawnRetro(home, entry, { env: { TMUX: "/tmp/tmux-1" }, platform: "linux", run }),
    ).toBe("spawned");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("tmux");
    expect(calls[0]?.[1]?.slice(0, 3)).toEqual(["new-window", "-n", TMUX_WINDOW_NAME]);
  });

  it("uses osascript on darwin without tmux", () => {
    const { calls, run } = recorder(0);
    expect(spawnRetro(home, entry, { env: {}, platform: "darwin", run })).toBe("spawned");
    expect(calls[0]?.[0]).toBe("osascript");
  });

  it("reports error-spawn on a nonzero status and on a seam that couldn't start", () => {
    const log = () => {};
    expect(spawnRetro(home, entry, { arm: "tmux", run: () => 1, log })).toBe("error-spawn");
    expect(spawnRetro(home, entry, { arm: "tmux", run: () => null, log })).toBe("error-spawn");
  });

  it("prints the command on a failed spawn — error-spawn is otherwise a dead end", () => {
    const printed: string[] = [];
    spawnRetro(home, entry, { arm: "terminal", run: () => 1, log: (l) => printed.push(l) });
    expect(printed.join("\n")).toContain("spawn failed (terminal arm, status 1)");
    expect(printed.join("\n")).toContain("DEVX_RETRO=1 claude --resume");
  });

  it("names a seam that never started as not-started rather than as status null", () => {
    const printed: string[] = [];
    spawnRetro(home, entry, { arm: "tmux", run: () => null, log: (l) => printed.push(l) });
    expect(printed.join("\n")).toContain("status not-started");
  });

  it("clears a stale .done marker before spawning — it would insta-complete", () => {
    mkdirSync(markersDir(home), { recursive: true });
    writeFileSync(doneMarkerPath(home, REAL_SID), "0");
    const { run } = recorder(0);
    expect(spawnRetro(home, entry, { arm: "tmux", run })).toBe("spawned");
    expect(existsSync(doneMarkerPath(home, REAL_SID))).toBe(false);
  });

  it("points the wrapper at this home's marker for this session", () => {
    const { calls, run } = recorder(0);
    spawnRetro(home, entry, { arm: "tmux", run });
    expect(calls[0]?.[1]?.[3]).toContain(shellQuote(doneMarkerPath(home, REAL_SID)));
  });

  it("throws for a cwd-less entry — the drain retires those as error-malformed first", () => {
    const { calls, run } = recorder(0);
    expect(() => spawnRetro(home, { session_id: REAL_SID, cwd: "" }, { arm: "tmux", run })).toThrow(
      /no cwd/,
    );
    expect(calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// awaitMarker — the only completion signal there is (T4.3)
// ---------------------------------------------------------------------------

describe("awaitMarker", () => {
  /** A clock the injected sleep advances, so nothing here waits wall-clock. */
  function fakeClock(start = NOW) {
    let t = start;
    return { now: () => t, sleep: (ms: number) => void (t += ms) };
  }

  it("returns the marker's contents as soon as the wrapper writes it", () => {
    const clock = fakeClock();
    let polls = 0;
    const marker = awaitMarker(home, REAL_SID, {
      ...clock,
      pollMs: 2_000,
      timeoutMs: 60_000,
      readMarker: () => (++polls >= 3 ? "129\n" : null),
    });
    expect(marker).toBe("129\n");
    expect(polls).toBe(3);
  });

  it("reads the real marker file through the default seam", () => {
    mkdirSync(markersDir(home), { recursive: true });
    writeFileSync(doneMarkerPath(home, REAL_SID), "0");
    expect(awaitMarker(home, REAL_SID, { timeoutMs: 1, pollMs: 1 })).toBe("0");
  });

  it("gives up at the bound and reports null — the SIGKILL case maps to timeout", () => {
    const clock = fakeClock();
    const marker = awaitMarker(home, REAL_SID, {
      ...clock,
      pollMs: 2_000,
      timeoutMs: 10_000,
      readMarker: () => null,
    });
    expect(marker).toBeNull();
    expect(mapMarkerToOutcome(marker)).toBe("timeout");
  });

  it("never overshoots the deadline — the last sleep is trimmed to what is left", () => {
    const clock = fakeClock();
    const slept: number[] = [];
    awaitMarker(home, REAL_SID, {
      now: clock.now,
      sleep: (ms) => {
        slept.push(ms);
        clock.sleep(ms);
      },
      pollMs: 3_000,
      timeoutMs: 7_000,
      readMarker: () => null,
    });
    expect(slept).toEqual([3_000, 3_000, 1_000]);
  });

  it("abandons the wait on SIGINT rather than holding the queue to the bound", () => {
    let stop = false;
    let polls = 0;
    const marker = awaitMarker(home, REAL_SID, {
      now: () => NOW,
      sleep: () => {},
      pollMs: 1,
      timeoutMs: 60_000,
      readMarker: () => {
        polls += 1;
        stop = true;
        return null;
      },
      shouldStop: () => stop,
    });
    expect(marker).toBeNull();
    expect(polls).toBe(1);
  });

  it("degrades to a timeout on a clock that never advances, instead of spinning", () => {
    // A pinned clock (or a suspended VM's) would make the deadline unreachable;
    // the poll-count backstop is what keeps that a timeout rather than a hang.
    let polls = 0;
    const marker = awaitMarker(home, REAL_SID, {
      now: () => NOW,
      sleep: () => {},
      pollMs: 1_000,
      timeoutMs: 10_000,
      readMarker: () => {
        polls += 1;
        return null;
      },
    });
    expect(marker).toBeNull();
    expect(polls).toBeLessThanOrEqual(30);
  });
});

// ---------------------------------------------------------------------------
// drainPass — serial serve, outcomes, and the dry-run promise (E-4, E-5, T4.3)
// ---------------------------------------------------------------------------

describe("drainPass", () => {
  const SID_A = REAL_SID;
  const SID_B = "1b2c3d4e-5f60-4712-8394-a5b6c7d8e9f0";
  const REPO = "/repo/a";
  /** git is never forked in these tests: the cwd is its own allowlist key. */
  const gitExec = () => null;

  let printed: string[];

  beforeEach(() => {
    printed = [];
  });

  /** Queue an entry old enough to be ready by age (no transcript to stat). */
  function queueReady(sid: string | undefined, cwd: unknown = REPO): void {
    const entry: QueueEntry = { transcript_path: null, cwd, ts: isoAgo(2 * IDLE_SECONDS * 1000) };
    if (sid !== undefined) entry.session_id = sid;
    appendPending(home, entry);
  }

  function drainOpts(extra: Record<string, unknown> = {}) {
    return {
      home,
      interactive: false,
      idleSeconds: IDLE_SECONDS,
      now: () => NOW,
      gitExec,
      log: (line: string) => printed.push(line),
      ...extra,
    };
  }

  /** A spawn seam that records who it was asked to open and opens nothing. */
  function fakeSpawn(result: SpawnResult = "spawned") {
    const calls: string[] = [];
    const spawn: SpawnFn = (_home, entry) => {
      calls.push(String(entry.session_id));
      return result;
    };
    return { calls, spawn };
  }

  /** Queue + done log + marker listing, as one comparable blob (E-5's check). */
  function snapshot(): string {
    const parts: string[] = [];
    for (const path of [queuePath(home), donePath(home), reposPath(home)]) {
      parts.push(existsSync(path) ? readFileSync(path, "utf8") : "<absent>");
    }
    parts.push(existsSync(markersDir(home)) ? readdirSync(markersDir(home)).sort().join(",") : "<absent>");
    return parts.join("\n---\n");
  }

  const outcomes = () => readDone(home).map((e) => `${String(e.session_id)}:${String(e.outcome)}`);

  // --- dry-run (E-5) ------------------------------------------------------

  it("dry-run prints one spawn command per ready entry and changes nothing", () => {
    queueReady(SID_A);
    queueReady(SID_B);
    const before = snapshot();

    const summary = drainPass(drainOpts({ dryRun: true }));

    expect(summary.printed).toBe(2);
    expect(summary.retired).toBe(0);
    expect(printed.filter((l) => l.includes("[dry-run] would spawn")).length).toBe(2);
    expect(printed.join("\n")).toContain(SID_A);
    expect(printed.join("\n")).toContain(SID_B);
    expect(snapshot()).toBe(before);
  });

  it("dry-run drains the whole queue in one pass — a setup check must not show only the head", () => {
    queueReady(SID_A);
    queueReady(SID_B);
    drainPass(drainOpts({ dryRun: true }));
    expect(printed.filter((l) => l.includes(SID_B)).length).toBeGreaterThan(0);
  });

  it("dry-run runs under a held singleton — a read-only check must not demand a kill", () => {
    queueReady(SID_A);
    const held = claimWatcherSingleton(home);
    try {
      expect(() => drainPass(drainOpts({ dryRun: true }))).not.toThrow();
      expect(printed.join("\n")).toContain("[dry-run] would spawn");
    } finally {
      held.release();
    }
  });

  it("the per-run seen-set keeps a second pass from reprinting the same entry", () => {
    queueReady(SID_A);
    const seen = new Set<string>();
    drainPass(drainOpts({ dryRun: true, seen }));
    drainPass(drainOpts({ dryRun: true, seen }));
    expect(printed.filter((l) => l.includes("[dry-run] would spawn")).length).toBe(1);
  });

  it("dry-run shows an unreviewed repo rather than hiding it behind the prompt gate", () => {
    // The first run is exactly when no repo has been reviewed; a dry-run that
    // reported an empty queue there would be useless as a setup check.
    queueReady(SID_A);
    drainPass(drainOpts({ dryRun: true }));
    expect(printed.join("\n")).toContain("repo not reviewed yet");
    expect(printed.join("\n")).toContain("[dry-run] would spawn");
  });

  it("dry-run honors a recorded deny without writing repos.json", () => {
    recordRepoDecision(home, REPO, "deny", { gitExec });
    queueReady(SID_A);
    const before = snapshot();
    const summary = drainPass(drainOpts({ dryRun: true }));
    expect(summary.printed).toBe(0);
    expect(printed.join("\n")).toContain("would skip");
    expect(snapshot()).toBe(before);
  });

  it("dry-run never files a malformed entry — nothing at all is written", () => {
    queueReady(undefined);
    const before = snapshot();
    const summary = drainPass(drainOpts({ dryRun: true }));
    expect(summary.handled).toBe(1);
    expect(summary.retired).toBe(0);
    expect(snapshot()).toBe(before);
  });

  // --- serving (E-4) ------------------------------------------------------

  it("serves an allowed repo end to end: spawn, marker, done row, queue cut", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("spawned");

    const summary = drainPass(drainOpts({ spawn, awaitMarkerFn: () => "0\n" }));

    expect(calls).toEqual([SID_A]);
    expect(summary.retired).toBe(1);
    expect(outcomes()).toEqual([`${SID_A}:completed`]);
    expect(readQueue(home)).toEqual([]);
  });

  it("serves entries one at a time, in queue order", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    queueReady(SID_B);
    const order: string[] = [];
    const spawn: SpawnFn = (_h, entry) => {
      order.push(`spawn:${String(entry.session_id)}`);
      return "spawned";
    };
    drainPass(
      drainOpts({
        spawn,
        awaitMarkerFn: (sid: string) => {
          order.push(`await:${sid}`);
          return "0";
        },
      }),
    );
    expect(order).toEqual([`spawn:${SID_A}`, `await:${SID_A}`, `spawn:${SID_B}`, `await:${SID_B}`]);
  });

  it("maps a missing marker to timeout rather than to a fabricated status", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    const { spawn } = fakeSpawn("spawned");
    drainPass(drainOpts({ spawn, awaitMarkerFn: () => null }));
    expect(outcomes()).toEqual([`${SID_A}:timeout`]);
  });

  it("maps a nonzero wrapper status to error-fork:<status>", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    const { spawn } = fakeSpawn("spawned");
    drainPass(drainOpts({ spawn, awaitMarkerFn: () => "3" }));
    expect(outcomes()).toEqual([`${SID_A}:error-fork:3`]);
  });

  it("files the manual arm immediately and never awaits a marker only a human could write", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("manual");
    let awaited = 0;
    drainPass(
      drainOpts({
        spawn,
        awaitMarkerFn: () => {
          awaited += 1;
          return "0";
        },
      }),
    );
    expect(calls).toEqual([SID_A]);
    expect(awaited).toBe(0); // upstream held the serial queue 6h per entry here
    expect(outcomes()).toEqual([`${SID_A}:manual`]);
    expect(readQueue(home)).toEqual([]);
  });

  it("files a failed spawn as error-spawn without awaiting a marker", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    const { spawn } = fakeSpawn("error-spawn");
    let awaited = 0;
    drainPass(
      drainOpts({
        spawn,
        awaitMarkerFn: () => {
          awaited += 1;
          return "0";
        },
      }),
    );
    expect(awaited).toBe(0);
    expect(outcomes()).toEqual([`${SID_A}:error-spawn`]);
  });

  it("retires a denied repo as skipped-denied-repo without spawning", () => {
    recordRepoDecision(home, REPO, "deny", { gitExec });
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn();
    drainPass(drainOpts({ spawn }));
    expect(calls).toEqual([]);
    expect(outcomes()).toEqual([`${SID_A}:skipped-denied-repo`]);
  });

  it("records an allow answer once and serves the entry in the same pass", () => {
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("spawned");
    const asked: string[] = [];
    drainPass(
      drainOpts({
        interactive: true,
        promptable: () => true,
        ask: (key: string) => {
          asked.push(key);
          return "y";
        },
        spawn,
        awaitMarkerFn: () => "0",
      }),
    );
    expect(asked).toEqual([REPO]);
    expect(calls).toEqual([SID_A]);
    expect(readRepos(home)).toEqual({ [REPO]: "allow" });
  });

  // --- malformed entries (E-4 b) ------------------------------------------

  it("retires an id-less line as error-malformed before any spawn", () => {
    queueReady(undefined);
    const { calls, spawn } = fakeSpawn();
    drainPass(drainOpts({ spawn }));
    expect(calls).toEqual([]);
    expect(readDone(home).map((e) => e.outcome)).toEqual(["error-malformed"]);
    expect(readQueue(home)).toEqual([]);
  });

  it("retires BOTH id-less lines in one pass — retiring the first reindexes the second", () => {
    // Regression: the skip-set outlives the queue rewrite `finish` performs, so
    // an index-keyed id-less entry inherits the key of the line just cut from
    // under it. The survivor then reads as "already handled" for the whole run
    // and sits in the queue as a permanently ready row nothing ever serves.
    queueReady(undefined, "/repo/a");
    queueReady(undefined, "/repo/b");
    const { calls, spawn } = fakeSpawn();

    const summary = drainPass(drainOpts({ spawn }));

    expect(calls).toEqual([]);
    expect(summary.retired).toBe(2);
    expect(readDone(home).map((e) => e.outcome)).toEqual(["error-malformed", "error-malformed"]);
    expect(readQueue(home)).toEqual([]);
  });

  it("retires a cwd-less entry as error-malformed rather than keying the allowlist on ''", () => {
    appendPending(home, {
      session_id: SID_A,
      transcript_path: null,
      cwd: null,
      ts: isoAgo(2 * IDLE_SECONDS * 1000),
    });
    const { calls, spawn } = fakeSpawn();
    drainPass(drainOpts({ spawn }));
    expect(calls).toEqual([]);
    expect(outcomes()).toEqual([`${SID_A}:error-malformed`]);
  });

  it("retires a filename-safe but unspawnable id — the guard spawnRetro would throw on", () => {
    // `abc_def` passes queue.ts's *filename* charset (classifyEntry says ok)
    // and fails spawn.ts's UUID-shaped one. Without this second screen the
    // drain throws on the head entry and re-throws after every restart.
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady("abc_def");
    expect(classifyEntry({ session_id: "abc_def", cwd: REPO })).toBe("ok");
    const { calls, spawn } = fakeSpawn();
    expect(() => drainPass(drainOpts({ spawn }))).not.toThrow();
    expect(calls).toEqual([]);
    expect(outcomes()).toEqual(["abc_def:error-malformed"]);
  });

  // --- skip-don't-starve ---------------------------------------------------

  it("walks past an unreviewed repo a non-interactive run can't ask about", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_B, "/repo/unreviewed");
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("spawned");

    const summary = drainPass(drainOpts({ spawn, awaitMarkerFn: () => "0" }));

    expect(calls).toEqual([SID_A]); // the one behind it is not starved
    expect(summary.skipped).toBe(1);
    expect(printed.join("\n")).toContain("repo not reviewed");
    // Skipped, not retired: the human can still decide later.
    expect(readQueue(home).map((e) => e.session_id)).toEqual([SID_B]);
  });

  it("drops to non-interactive when the prompt can't be answered, leaving the entry pending", () => {
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn();
    const summary = drainPass(
      drainOpts({ interactive: true, promptable: () => true, ask: () => null, spawn }),
    );
    expect(calls).toEqual([]);
    expect(summary.interactive).toBe(false);
    expect(readQueue(home).map((e) => e.session_id)).toEqual([SID_A]);
    expect(readRepos(home)).toEqual({});
  });

  it("leaves an entry pending when SIGINT lands mid-wait — that retro is still open", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    const { spawn } = fakeSpawn("spawned");
    let stop = false;
    const summary = drainPass(
      drainOpts({
        spawn,
        awaitMarkerFn: () => {
          stop = true; // Ctrl-C arrived while the window was open
          return null;
        },
        shouldStop: () => stop,
      }),
    );
    // A `timeout` row here would be a fabricated outcome for a retro the human
    // is probably still writing.
    expect(summary.retired).toBe(0);
    expect(readDone(home)).toEqual([]);
    expect(readQueue(home).map((e) => e.session_id)).toEqual([SID_A]);
    expect(printed.join("\n")).toContain("left pending");
  });

  it("stops between entries on SIGINT, leaving the rest of the queue pending", () => {
    recordRepoDecision(home, REPO, "allow", { gitExec });
    queueReady(SID_A);
    queueReady(SID_B);
    let served = 0;
    const spawn: SpawnFn = () => {
      served += 1;
      return "spawned";
    };
    drainPass(drainOpts({ spawn, awaitMarkerFn: () => "0", shouldStop: () => served >= 1 }));
    expect(served).toBe(1);
    expect(readQueue(home).map((e) => e.session_id)).toEqual([SID_B]);
  });

  // --- auto_allow (28b267) -------------------------------------------------
  //
  // Asserted at the DRAIN level on purpose: the knob has to survive two gates
  // (pickReady's unservable filter, then repoDecision's verdict) and a unit
  // test of either one alone passes while the watcher still drains nothing.

  it("autoAllow drains an unreviewed repo end to end with no terminal", () => {
    // The 2026-08-05 shape exactly: nobody at a prompt, nothing in repos.json.
    // Before the knob this pass served 0 entries and noted a skip forever.
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("spawned");

    const summary = drainPass(
      drainOpts({ autoAllow: true, spawn, awaitMarkerFn: () => "0\n" }),
    );

    expect(calls).toEqual([SID_A]);
    expect(summary.retired).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(outcomes()).toEqual([`${SID_A}:completed`]);
    expect(readQueue(home)).toEqual([]);
  });

  it("without autoAllow the same pass serves nothing and notes the skip (the bug)", () => {
    // The control. A "policy works" assertion is worth little without proof
    // the same inputs failed before it.
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("spawned");
    const summary = drainPass(drainOpts({ spawn, awaitMarkerFn: () => "0\n" }));
    expect(calls).toEqual([]);
    expect(summary.retired).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(readQueue(home).map((e) => e.session_id)).toEqual([SID_A]);
    // …and the skip line names the escape hatch, so a human reading an
    // unattended log can discover the policy without reading source.
    expect(printed.join("\n")).toContain("auto_allow");
  });

  it("an auto-allowed spawn leaves repos.json ABSENT when it was absent", () => {
    queueReady(SID_A);
    expect(existsSync(reposPath(home))).toBe(false);
    drainPass(drainOpts({ autoAllow: true, spawn: fakeSpawn().spawn, awaitMarkerFn: () => "0" }));
    expect(existsSync(reposPath(home))).toBe(false);
  });

  it("an auto-allowed spawn leaves an existing repos.json byte-identical", () => {
    recordRepoDecision(home, "/other/repo", "allow", { gitExec });
    const before = readFileSync(reposPath(home), "utf8");
    queueReady(SID_A);
    drainPass(drainOpts({ autoAllow: true, spawn: fakeSpawn().spawn, awaitMarkerFn: () => "0" }));
    expect(readFileSync(reposPath(home), "utf8")).toBe(before);
  });

  it("a recorded deny still retires under autoAllow", () => {
    recordRepoDecision(home, REPO, "deny", { gitExec });
    queueReady(SID_A);
    const { calls, spawn } = fakeSpawn("spawned");
    const summary = drainPass(drainOpts({ autoAllow: true, spawn }));
    expect(calls).toEqual([]);
    expect(summary.retired).toBe(1);
    expect(outcomes()).toEqual([`${SID_A}:skipped-denied-repo`]);
  });

  it("autoAllow never drops the run to non-interactive, and never asks", () => {
    // `unknown` is what downgraded the 2026-08-05 run to non-interactive and
    // then walked past everything behind it. Under the policy repoDecision
    // cannot return it, so an interactive run stays interactive — and the
    // prompt seam is never reached at all.
    queueReady(SID_A);
    queueReady(SID_B);
    const summary = drainPass(
      drainOpts({
        interactive: true,
        autoAllow: true,
        promptable: () => true,
        ask: () => {
          throw new Error("autoAllow must not reach the prompt");
        },
        spawn: fakeSpawn().spawn,
        awaitMarkerFn: () => "0",
      }),
    );
    expect(summary.interactive).toBe(true);
    expect(summary.retired).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(printed.join("\n")).not.toContain("could not be answered");
  });

  it("autoAllow drains a MULTI-repo backlog in one pass, unattended", () => {
    queueReady(SID_A, "/repo/one");
    queueReady(SID_B, "/repo/two");
    const { calls, spawn } = fakeSpawn("spawned");
    const summary = drainPass(drainOpts({ autoAllow: true, spawn, awaitMarkerFn: () => "0" }));
    expect(calls).toEqual([SID_A, SID_B]);
    expect(summary.skipped).toBe(0);
    expect(readQueue(home)).toEqual([]);
  });

  it("dry-run says 'would auto-allow', not 'a real run would ask first'", () => {
    // Under the policy that sentence is a lie, and it would send a human to a
    // foreground terminal they don't need.
    queueReady(SID_A);
    drainPass(drainOpts({ dryRun: true, autoAllow: true }));
    const text = printed.join("\n");
    expect(text).toContain("learn.auto_allow is on");
    expect(text).toContain("auto-allow");
    expect(text).not.toContain("a real run would ask first");
    expect(text).toContain("[dry-run] would spawn");
  });

  it("dry-run keeps the ask-first wording when the policy is off", () => {
    queueReady(SID_A);
    drainPass(drainOpts({ dryRun: true }));
    const text = printed.join("\n");
    expect(text).toContain("a real run would ask first");
    expect(text).not.toContain("learn.auto_allow");
  });

  it("dry-run + autoAllow still writes nothing at all", () => {
    queueReady(SID_A);
    const before = snapshot();
    const summary = drainPass(drainOpts({ dryRun: true, autoAllow: true }));
    expect(summary.retired).toBe(0);
    expect(snapshot()).toBe(before);
  });

  it("dry-run + autoAllow still reports a recorded deny as a skip", () => {
    recordRepoDecision(home, REPO, "deny", { gitExec });
    queueReady(SID_A);
    const summary = drainPass(drainOpts({ dryRun: true, autoAllow: true }));
    expect(summary.printed).toBe(0);
    expect(printed.join("\n")).toContain("would skip");
  });
});

// ---------------------------------------------------------------------------
// runWatch — the singleton + the per-run sets (E-4 c, E-5, T4.3)
// ---------------------------------------------------------------------------

describe("runWatch", () => {
  const REPO = "/repo/a";
  const gitExec = () => null;
  let printed: string[];

  beforeEach(() => {
    printed = [];
  });

  function watchOpts(extra: Record<string, unknown> = {}) {
    return {
      home,
      interactive: false,
      idleSeconds: IDLE_SECONDS,
      now: () => NOW,
      gitExec,
      log: (line: string) => printed.push(line),
      sleep: () => {},
      maxPasses: 3,
      ...extra,
    };
  }

  function queueReady(sid: string, cwd: unknown = REPO): void {
    appendPending(home, {
      session_id: sid,
      transcript_path: null,
      cwd,
      ts: isoAgo(2 * IDLE_SECONDS * 1000),
    });
  }

  it("holds the watcher singleton for the run and releases it at the end", () => {
    let heldDuringRun = false;
    runWatch(
      watchOpts({
        maxPasses: 1,
        shouldStop: () => {
          try {
            claimWatcherSingleton(home).release();
          } catch {
            heldDuringRun = true;
          }
          return false;
        },
      }),
    );
    expect(heldDuringRun).toBe(true);
    // Released on the way out, so the next watcher starts without a --force.
    expect(() => claimWatcherSingleton(home).release()).not.toThrow();
  });

  it("refuses to start while another watcher holds the lock, naming the lock path", () => {
    const held = claimWatcherSingleton(home);
    try {
      expect(() => runWatch(watchOpts())).toThrow(PathLockHeldError);
      expect(() => runWatch(watchOpts())).toThrow(watchLockPath(home));
    } finally {
      held.release();
    }
  });

  it("releases the singleton even when a pass throws", () => {
    queueReady(REAL_SID);
    recordRepoDecision(home, REPO, "allow", { gitExec });
    const boom: SpawnFn = () => {
      throw new Error("seam exploded");
    };
    expect(() => runWatch(watchOpts({ spawn: boom }))).toThrow(/seam exploded/);
    expect(() => claimWatcherSingleton(home).release()).not.toThrow();
  });

  it("dry-run takes no lock at all — it runs alongside a working watcher", () => {
    queueReady(REAL_SID);
    const held = claimWatcherSingleton(home);
    try {
      const summary = runWatch(watchOpts({ dryRun: true, maxPasses: 1 }));
      expect(summary.printed).toBe(1);
    } finally {
      held.release();
    }
  });

  it("carries the seen-set across passes so a dry-run doesn't reprint every scan", () => {
    queueReady(REAL_SID);
    const summary = runWatch(watchOpts({ dryRun: true, maxPasses: 3 }));
    expect(summary.printed).toBe(1);
    expect(printed.filter((l) => l.includes("[dry-run] would spawn")).length).toBe(1);
  });

  it("notes an unservable entry once per run, not once per scan", () => {
    queueReady(REAL_SID, "/repo/unreviewed");
    const summary = runWatch(watchOpts({ maxPasses: 3 }));
    expect(printed.filter((l) => l.includes("repo not reviewed")).length).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it("sleeps between passes but not after the last one", () => {
    const slept: number[] = [];
    runWatch(watchOpts({ maxPasses: 3, scanPollMs: 5_000, sleep: (ms: number) => slept.push(ms) }));
    expect(slept).toEqual([5_000, 5_000]);
  });

  it("stops immediately when SIGINT arrives before the first pass", () => {
    queueReady(REAL_SID);
    recordRepoDecision(home, REPO, "allow", { gitExec });
    const { calls, spawn } = (() => {
      const calls: string[] = [];
      const spawn: SpawnFn = (_h, entry) => {
        calls.push(String(entry.session_id));
        return "spawned";
      };
      return { calls, spawn };
    })();
    const summary = runWatch(watchOpts({ spawn, shouldStop: () => true }));
    expect(calls).toEqual([]);
    expect(summary.handled).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// devx learn-watch — the CLI surface (T4.4): flags, exit codes, list, requeue
//
// The command's own job is wiring, so these cases mostly assert what it hands
// the lib and what it does with what comes back: the drain itself is stubbed
// (`drainPassFn`) wherever the case isn't about draining, which is also what
// keeps the CLI suite from opening a window or waiting 5 real seconds.
// ---------------------------------------------------------------------------

/** A no-op pass result — the shape `drainPass` returns, nothing handled. */
function drainSummaryStub(extra: Partial<DrainSummary> = {}): DrainSummary {
  return {
    handled: 0,
    retired: 0,
    printed: 0,
    skipped: 0,
    outcomes: [],
    interactive: true,
    ...extra,
  };
}

describe("resolveLearnEnv", () => {
  it("derives the readiness window and the retro bound from learn: minutes", () => {
    const env = resolveLearnEnv({ merged: { learn: { idle_minutes: 2, retro_timeout_minutes: 90 } } });
    expect(env.idleSeconds).toBe(120);
    expect(env.retroTimeoutMs).toBe(90 * 60_000);
  });

  it("falls back to the design defaults for a config with no learn: block", () => {
    const env = resolveLearnEnv({ merged: {} });
    expect(env.idleSeconds).toBe(DEFAULT_IDLE_SECONDS);
    expect(env.retroTimeoutMs).toBe(360 * 60_000);
  });

  it("prefers DEVX_LEARN_HOME over learn.home — the listener has no config to read", () => {
    const env = resolveLearnEnv({
      merged: { learn: { home: "/from/config" } },
      env: { DEVX_LEARN_HOME: "/from/env" },
    });
    expect(env.home).toBe("/from/env");
  });

  // --- auto_allow precedence: flag > config > default (28b267) --------------

  it("reads auto_allow from the merged config", () => {
    expect(resolveLearnEnv({ merged: { learn: { auto_allow: true } } }).autoAllow).toBe(true);
    expect(resolveLearnEnv({ merged: { learn: { auto_allow: false } } }).autoAllow).toBe(false);
  });

  it("defaults auto_allow to false with no learn: block", () => {
    expect(resolveLearnEnv({ merged: {} }).autoAllow).toBe(false);
  });

  it("--auto-allow overrides a config that says false", () => {
    expect(
      resolveLearnEnv({ merged: { learn: { auto_allow: false } }, autoAllow: true }).autoAllow,
    ).toBe(true);
  });

  it("an absent flag defers to config rather than forcing the policy off", () => {
    // `--auto-allow` is a boolean switch: commander gives `false` for both
    // "not passed" and "passed --no-auto-allow", so absence MUST mean "defer".
    // Turning the policy off for one run is a config edit — the safe direction
    // to make harder.
    for (const flag of [false, undefined]) {
      expect(
        resolveLearnEnv({ merged: { learn: { auto_allow: true } }, autoAllow: flag }).autoAllow,
      ).toBe(true);
    }
  });

  it("a malformed auto_allow still resolves to the default, not a crash", () => {
    expect(resolveLearnEnv({ merged: { learn: { auto_allow: "yes" } } }).autoAllow).toBe(false);
  });
});

describe("runLearnWatch", () => {
  const REPO = "/repo/a";
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
  });

  function cliOpts(extra: Record<string, unknown> = {}) {
    return {
      home,
      merged: {},
      installSignals: false,
      maxPasses: 1,
      delay: async () => {},
      canPromptFn: () => false,
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      ...extra,
    };
  }

  function queueReady(sid: string, cwd: unknown = REPO): void {
    appendPending(home, {
      session_id: sid,
      transcript_path: null,
      cwd,
      ts: isoAgo(2 * IDLE_SECONDS * 1000),
    });
  }

  /** Queue + done log + repos + markers, as one comparable blob. */
  function snapshot(): string {
    const parts: string[] = [];
    for (const path of [queuePath(home), donePath(home), reposPath(home)]) {
      parts.push(existsSync(path) ? readFileSync(path, "utf8") : "<absent>");
    }
    parts.push(
      existsSync(markersDir(home)) ? readdirSync(markersDir(home)).sort().join(",") : "<absent>",
    );
    return parts.join("\n---\n");
  }

  const text = () => out.join("");

  it("prints the pending count, the queue path, and the serial hint", async () => {
    queueReady(REAL_SID);
    const code = await runLearnWatch(cliOpts({ drainPassFn: () => drainSummaryStub() }));
    expect(code).toBe(0);
    expect(text()).toContain("devx learn-watch: 1 pending");
    expect(text()).toContain(queuePath(home));
    expect(text()).toContain("retros spawn one at a time");
  });

  it("hands the drain the home and the two learn: knobs, not its own defaults", async () => {
    let passOpts: Record<string, unknown> = {};
    await runLearnWatch(
      cliOpts({
        merged: { learn: { idle_minutes: 3, retro_timeout_minutes: 45 } },
        dryRun: true,
        drainPassFn: (o: Record<string, unknown>) => {
          passOpts = o;
          return drainSummaryStub();
        },
      }),
    );
    expect(passOpts.home).toBe(home);
    expect(passOpts.idleSeconds).toBe(180);
    expect(passOpts.retroTimeoutMs).toBe(45 * 60_000);
    expect(passOpts.dryRun).toBe(true);
    // Per-run state, created once and handed to every pass.
    expect(passOpts.seen).toBeInstanceOf(Set);
    expect(passOpts.noted).toBeInstanceOf(Set);
  });

  // --- auto_allow wiring (28b267) -----------------------------------------

  it("forwards the resolved auto_allow policy into every drain pass", async () => {
    let passOpts: Record<string, unknown> = {};
    await runLearnWatch(
      cliOpts({
        merged: { learn: { auto_allow: true } },
        drainPassFn: (o: Record<string, unknown>) => {
          passOpts = o;
          return drainSummaryStub();
        },
      }),
    );
    expect(passOpts.autoAllow).toBe(true);
  });

  it("--auto-allow reaches the drain even when config says false", async () => {
    let passOpts: Record<string, unknown> = {};
    await runLearnWatch(
      cliOpts({
        merged: { learn: { auto_allow: false } },
        autoAllow: true,
        drainPassFn: (o: Record<string, unknown>) => {
          passOpts = o;
          return drainSummaryStub();
        },
      }),
    );
    expect(passOpts.autoAllow).toBe(true);
  });

  it("hands the drain autoAllow: false when nothing turned it on", async () => {
    let passOpts: Record<string, unknown> = {};
    await runLearnWatch(
      cliOpts({
        drainPassFn: (o: Record<string, unknown>) => {
          passOpts = o;
          return drainSummaryStub();
        },
      }),
    );
    expect(passOpts.autoAllow).toBe(false);
  });

  it("names the policy at startup so an unattended log says why it never prompted", async () => {
    queueReady(REAL_SID);
    await runLearnWatch(
      cliOpts({ merged: { learn: { auto_allow: true } }, drainPassFn: () => drainSummaryStub() }),
    );
    expect(text()).toContain("learn.auto_allow");
    expect(text()).toContain("a recorded `deny` still wins");
    expect(text()).toContain("repos.json is never written");
  });

  it("says nothing about the policy when it is off", async () => {
    queueReady(REAL_SID);
    await runLearnWatch(cliOpts({ drainPassFn: () => drainSummaryStub() }));
    expect(text()).not.toContain("auto_allow");
  });

  it("every line it writes carries its own newline — the log is readable while it runs", async () => {
    queueReady(REAL_SID);
    await runLearnWatch(cliOpts({ drainPassFn: () => drainSummaryStub() }));
    for (const chunk of out) expect(chunk.endsWith("\n")).toBe(true);
  });

  it("exits 1 naming the lock path when another watcher holds the singleton", async () => {
    const held = claimWatcherSingleton(home);
    try {
      let drained = false;
      const code = await runLearnWatch(
        cliOpts({
          drainPassFn: () => {
            drained = true;
            return drainSummaryStub();
          },
        }),
      );
      expect(code).toBe(1);
      expect(err.join("")).toContain(watchLockPath(home));
      // Refused BEFORE the header, so a refusal never reads like a start.
      expect(drained).toBe(false);
      expect(text()).toBe("");
    } finally {
      held.release();
    }
  });

  it("holds the singleton for the run and releases it on the way out", async () => {
    let heldDuringRun = false;
    await runLearnWatch(
      cliOpts({
        drainPassFn: () => {
          try {
            claimWatcherSingleton(home).release();
          } catch {
            heldDuringRun = true;
          }
          return drainSummaryStub();
        },
      }),
    );
    expect(heldDuringRun).toBe(true);
    expect(() => claimWatcherSingleton(home).release()).not.toThrow();
  });

  it("releases the singleton even when a pass throws", async () => {
    await expect(
      runLearnWatch(
        cliOpts({
          drainPassFn: () => {
            throw new Error("seam exploded");
          },
        }),
      ),
    ).rejects.toThrow(/seam exploded/);
    expect(() => claimWatcherSingleton(home).release()).not.toThrow();
  });

  it("--dry-run takes no lock and changes nothing, alongside a working watcher", async () => {
    queueReady(REAL_SID);
    const before = snapshot();
    const held = claimWatcherSingleton(home);
    try {
      const code = await runLearnWatch(cliOpts({ dryRun: true }));
      expect(code).toBe(0);
      expect(text()).toContain("--dry-run: printing spawn commands only");
      expect(text()).toContain("[dry-run] would spawn");
      expect(text()).toContain(REAL_SID);
    } finally {
      held.release();
    }
    expect(snapshot()).toBe(before);
  });

  it("carries the seen-set across passes so --dry-run doesn't reprint every scan", async () => {
    queueReady(REAL_SID);
    await runLearnWatch(cliOpts({ dryRun: true, maxPasses: 3 }));
    expect(text().split("[dry-run] would spawn").length - 1).toBe(1);
  });

  it("waits between passes but not after the last one", async () => {
    const waited: number[] = [];
    await runLearnWatch(
      cliOpts({
        maxPasses: 3,
        scanPollMs: 4_000,
        delay: async (ms: number) => {
          waited.push(ms);
        },
        drainPassFn: () => drainSummaryStub(),
      }),
    );
    expect(waited).toEqual([4_000, 4_000]);
  });

  it("a pass that loses stdin downgrades every later pass to non-interactive", async () => {
    const seenInteractive: boolean[] = [];
    await runLearnWatch(
      cliOpts({
        canPromptFn: () => true,
        maxPasses: 3,
        drainPassFn: (passOpts: { interactive: boolean }) => {
          seenInteractive.push(passOpts.interactive);
          return drainSummaryStub({ interactive: false });
        },
      }),
    );
    expect(seenInteractive).toEqual([true, false, false]);
  });

  it("asks the human through the terminal seam and hands the raw answer back", async () => {
    let answer: string | null = "nothing asked";
    await runLearnWatch(
      cliOpts({
        readLine: () => "y",
        drainPassFn: (passOpts: { ask: (key: string) => string | null }) => {
          answer = passOpts.ask("/repo/a");
          return drainSummaryStub();
        },
      }),
    );
    expect(answer).toBe("y");
    expect(text()).toContain("allow retros for /repo/a? [y/N]");
  });

  it("installs SIGINT/SIGTERM handlers for the run and removes them after", async () => {
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
    let during = { int: 0, term: 0 };
    await runLearnWatch(
      cliOpts({
        installSignals: true,
        drainPassFn: () => {
          during = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
          return drainSummaryStub();
        },
      }),
    );
    expect(during.int).toBe(before.int + 1);
    expect(during.term).toBe(before.term + 1);
    expect(process.listenerCount("SIGINT")).toBe(before.int);
    expect(process.listenerCount("SIGTERM")).toBe(before.term);
  });

  it("stops after the current pass when its SIGINT handler fires, and exits 0 clean", async () => {
    const baseline = process.listeners("SIGINT");
    let passes = 0;
    const code = await runLearnWatch(
      cliOpts({
        installSignals: true,
        maxPasses: 5,
        drainPassFn: () => {
          passes += 1;
          // Call the handler this run just installed — a real `process.emit`
          // would also fire vitest's own SIGINT teardown.
          for (const l of process.listeners("SIGINT")) {
            if (!baseline.includes(l)) (l as () => void)();
          }
          return drainSummaryStub();
        },
      }),
    );
    expect(code).toBe(0);
    expect(passes).toBe(1);
    expect(text()).toContain("stopped — queue is durable; restart me anytime");
  });

  it("says nothing about stopping when it simply ran out of passes", async () => {
    await runLearnWatch(cliOpts({ drainPassFn: () => drainSummaryStub() }));
    expect(text()).not.toContain("stopped —");
  });
});

describe("runLearnWatchList", () => {
  let out: string[];

  beforeEach(() => {
    out = [];
  });

  const text = () => out.join("");

  function listOpts(extra: Record<string, unknown> = {}) {
    return { home, merged: {}, now: () => NOW, out: (s: string) => out.push(s), ...extra };
  }

  it("marks an aged-out entry ready and a fresh one still active", async () => {
    appendPending(home, {
      session_id: REAL_SID,
      transcript_path: null,
      cwd: "/repo/a",
      ts: isoAgo(2 * IDLE_SECONDS * 1000),
    });
    appendPending(home, {
      session_id: "1b2c3d4e-5f60-4712-8394-a5b6c7d8e9f0",
      transcript_path: null,
      cwd: "/repo/b",
      ts: isoAgo(1_000),
    });
    expect(runLearnWatchList(listOpts())).toBe(0);
    const lines = text().trimEnd().split("\n");
    expect(lines[0]).toContain("pending (2)");
    expect(lines[0]).toContain(queuePath(home));
    expect(lines[1]).toContain(REAL_SID);
    expect(lines[1]).toContain("/repo/a");
    expect(lines[1]).toContain("[ready]");
    expect(lines[2]).toContain("[session still active]");
  });

  it("shows the tail of the done log with its outcomes, newest last", () => {
    for (let i = 0; i < 7; i++) {
      appendDone(
        home,
        { session_id: `sid-${i}`, transcript_path: null, cwd: "/repo/a", ts: isoAgo(0) },
        i === 6 ? "timeout" : "completed",
      );
    }
    runLearnWatchList(listOpts());
    expect(text()).toContain("processed (last 5 of 7)");
    expect(text()).toContain(donePath(home));
    expect(text()).not.toContain("sid-1"); // trimmed off the front
    expect(text()).toContain("sid-6");
    expect(text()).toContain("timeout");
  });

  it("renders a hand-edited line's missing fields as ? rather than undefined", () => {
    appendPending(home, { cwd: "/repo/a", transcript_path: null, ts: isoAgo(0) });
    runLearnWatchList(listOpts());
    expect(text()).toContain("  ?  ");
    expect(text()).not.toContain("undefined");
  });

  it("is read-only — an empty home stays empty", () => {
    runLearnWatchList(listOpts());
    expect(text()).toContain("pending (0)");
    expect(existsSync(queuePath(home))).toBe(false);
    expect(existsSync(donePath(home))).toBe(false);
  });
});

describe("runLearnWatchRequeue", () => {
  let out: string[];
  let err: string[];

  beforeEach(() => {
    out = [];
    err = [];
  });

  function reqOpts(extra: Record<string, unknown> = {}) {
    return {
      home,
      merged: {},
      out: (s: string) => out.push(s),
      err: (s: string) => err.push(s),
      ...extra,
    };
  }

  it("puts a processed session back on the queue and says so", () => {
    appendDone(
      home,
      { session_id: REAL_SID, transcript_path: null, cwd: "/repo/a", ts: isoAgo(0) },
      "timeout",
    );
    expect(runLearnWatchRequeue(REAL_SID, reqOpts())).toBe(0);
    expect(readQueue(home).map((e) => e.session_id)).toEqual([REAL_SID]);
    expect(out.join("")).toContain("requeued");
  });

  it("exits 1 when no processed entry matches — a typo must not look like a success", () => {
    expect(runLearnWatchRequeue(REAL_SID, reqOpts())).toBe(1);
    expect(err.join("")).toContain("no processed entry");
    expect(readQueue(home)).toEqual([]);
  });

  it("exits 1 rather than queueing a duplicate for an already-pending session", () => {
    appendDone(
      home,
      { session_id: REAL_SID, transcript_path: null, cwd: "/repo/a", ts: isoAgo(0) },
      "timeout",
    );
    runLearnWatchRequeue(REAL_SID, reqOpts());
    expect(runLearnWatchRequeue(REAL_SID, reqOpts())).toBe(1);
    expect(err.join("")).toContain("already pending");
    expect(readQueue(home).length).toBe(1);
  });

  it("exits 2 with a usage line for a missing session id", () => {
    expect(runLearnWatchRequeue(undefined, reqOpts())).toBe(2);
    expect(runLearnWatchRequeue("   ", reqOpts())).toBe(2);
    expect(err.join("")).toContain("usage: devx learn-watch requeue <session-id>");
  });
});

describe("learn-watch registration", () => {
  it("is registered on the program with its list + requeue subcommands", () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === "learn-watch");
    expect(cmd, "devx learn-watch must be wired into src/cli.ts").toBeDefined();
    expect(cmd?.commands.map((c) => c.name()).sort()).toEqual(["list", "requeue"]);
    expect(cmd?.options.some((o) => o.long === "--dry-run")).toBe(true);
  });

  it("exposes --auto-allow, defaulting to off (28b267)", () => {
    const program = buildProgram();
    const cmd = program.commands.find((c) => c.name() === "learn-watch");
    const flag = cmd?.options.find((o) => o.long === "--auto-allow");
    expect(flag, "devx learn-watch --auto-allow must be registered").toBeDefined();
    expect(flag?.defaultValue).toBe(false);
    // The per-run skip-set caveat belongs somewhere a human will read it.
    expect(flag?.description).toContain("restart");
  });
});
