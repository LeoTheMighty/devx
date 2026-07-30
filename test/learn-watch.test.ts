// rtl103 — the watcher-core suite: readiness (T3.1) + repo allowlist and
// prompt-ability (T3.2).
//
// Acceptance: _devx/workstreams/retro-listener/evals/E-3_readiness-failsafe.ts
// (the four readiness cases + the strict-ISO pin) and the allowlist/keying half
// of E-4_watch-serial-outcomes.ts. Case names below name the trap they pin, so
// a failure reads as the failure mode rather than as "expected true, got false".
//
// Every case runs against a tmpdir learn home and injected seams — no real
// clock, no real git, no real terminal — so nothing here can touch
// `~/.claude/devx`, fork a subprocess, or take a real SIGTTIN.
//
// Spec: dev/dev-rtl103-2026-07-30T09:31-watcher-core.md (T3.5)

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { endedMarkerPath, markersDir, reposPath } from "../src/lib/learn/queue.js";
import {
  DEFAULT_IDLE_SECONDS,
  canPrompt,
  queuedAt,
  readRepos,
  recordRepoDecision,
  repoKey,
  repoLookup,
  resetRepoKeyCache,
  sessionOver,
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
