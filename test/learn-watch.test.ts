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
  appendDone,
  appendPending,
  doneMarkerPath,
  donePath,
  endedMarkerPath,
  markersDir,
  queueLockPath,
  readDone,
  readQueue,
  reposPath,
  watchLockPath,
  withQueueLock,
} from "../src/lib/learn/queue.js";
import {
  type RunFn,
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
import {
  DEFAULT_IDLE_SECONDS,
  canPrompt,
  claimWatcherSingleton,
  classifyEntry,
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
    expect(skipKey(first as TaggedEntry)).toBe("#line:0");
    expect(pick({ skip: new Set([skipKey(first as TaggedEntry)]) }).entry).toBeNull();
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
