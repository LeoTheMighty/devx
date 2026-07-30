// rtl101 — the listener suite: queue store (T1.2) + detection arms (T1.3).
//
// Acceptance: _devx/workstreams/retro-listener/evals/E-1_listener-enqueue.ts
// (detection + durable enqueue), E-2_retro-guard.ts (DEVX_RETRO inertness),
// E-10_sessionend-denylist.ts (SessionEnd reason gating).
//
// This file grows with the phase: the store contracts land first because both
// listener arms are thin wrappers over them, and the store's failure modes
// (torn lines, stale identities, unsafe session ids) are the ones a listener
// test would otherwise only reach by accident.
//
// Every case runs against a tmpdir learn home via `DEVX_LEARN_HOME`, so
// nothing here can touch the real `~/.claude/devx`.
//
// Spec: dev/dev-rtl101-2026-07-30T09:31-listener-nudge-pin.md (T1.5)

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LEARN_HOME_ENV,
  PathLockHeldError,
  appendDone,
  appendPending,
  donePath,
  doneMarkerPath,
  endedMarkerPath,
  isSafeSessionId,
  learnHome,
  markersDir,
  pendingSessionIds,
  queueLockPath,
  queuePath,
  readDone,
  readQueue,
  removeFromQueue,
  touchEndedMarker,
  withQueueLock,
} from "../src/lib/learn/queue.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "rtl101-learn-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const entry = (sid: string, over: Record<string, unknown> = {}) => ({
  session_id: sid,
  transcript_path: `/tmp/${sid}.jsonl`,
  cwd: "/repo",
  ts: "2026-07-29T00:00:00.000Z",
  ...over,
});

describe("rtl101 — learn home resolution is config-free (G-3)", () => {
  it("prefers DEVX_LEARN_HOME when set", () => {
    expect(learnHome({ [LEARN_HOME_ENV]: "/tmp/elsewhere" })).toBe("/tmp/elsewhere");
  });

  it("falls back to ~/.claude/devx when the env var is absent", () => {
    expect(learnHome({})).toBe(join(homedir(), ".claude", "devx"));
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
  ])("falls back when the env var is %s", (_note, value) => {
    // A hook environment that exports the var but leaves it blank must not
    // resolve the home to the process cwd.
    expect(learnHome({ [LEARN_HOME_ENV]: value })).toBe(join(homedir(), ".claude", "devx"));
  });
});

describe("rtl101 — readQueue / readDone tolerate a damaged log", () => {
  it("returns [] when the queue file does not exist", () => {
    expect(readQueue(home)).toEqual([]);
    expect(readDone(home)).toEqual([]);
  });

  it("skips torn, blank, and non-object lines but keeps the good ones", () => {
    writeFileSync(
      queuePath(home),
      [
        JSON.stringify(entry("good-1")),
        '{"session_id":"torn-1","cwd":', // half-written append
        "",
        "   ",
        "[1,2,3]", // valid JSON, wrong shape
        '"a string"',
        "null",
        JSON.stringify(entry("good-2")),
      ].join("\n") + "\n",
      "utf8",
    );
    expect(readQueue(home).map((e) => e.session_id)).toEqual(["good-1", "good-2"]);
  });

  it("tolerates a file whose final line has no trailing newline", () => {
    writeFileSync(queuePath(home), JSON.stringify(entry("no-newline")), "utf8");
    expect(readQueue(home)).toHaveLength(1);
  });

  it("keeps entries that carry no session_id (the watcher retires them later)", () => {
    writeFileSync(queuePath(home), JSON.stringify({ cwd: "/repo", ts: "x" }) + "\n", "utf8");
    expect(readQueue(home)).toHaveLength(1);
  });
});

describe("rtl101 — appendPending", () => {
  it("writes one line per call and round-trips the four fields", () => {
    appendPending(home, entry("aaaa-1111"));
    const got = readQueue(home);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      session_id: "aaaa-1111",
      transcript_path: "/tmp/aaaa-1111.jsonl",
      cwd: "/repo",
      ts: "2026-07-29T00:00:00.000Z",
    });
  });

  it("stamps ts as a millisecond ISO-8601 string when the caller omits it", () => {
    appendPending(home, { session_id: "bbbb-2222", cwd: "/repo" }, () =>
      new Date("2026-07-30T09:31:00.123Z"),
    );
    expect(readQueue(home)[0]?.ts).toBe("2026-07-30T09:31:00.123Z");
    // The strict shape the watcher's readiness regex will require — a
    // date-only string must never be produced here.
    expect(String(readQueue(home)[0]?.ts)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it("creates the home directory if it is missing", () => {
    const nested = join(home, "deep", "nested");
    appendPending(nested, entry("cccc-3333"));
    expect(readQueue(nested)).toHaveLength(1);
  });

  it("does not attach the identity tag to the written JSON", () => {
    appendPending(home, entry("dddd-4444"));
    const written = JSON.parse(readFileSync(queuePath(home), "utf8").trim());
    expect(Object.keys(written).sort()).toEqual(["cwd", "session_id", "transcript_path", "ts"]);
  });
});

describe("rtl101 — appendDone stamps the evidence row", () => {
  it("records processed_ts + outcome alongside the original entry", () => {
    appendDone(home, entry("eeee-5555"), "completed", () => new Date("2026-07-30T10:00:00.000Z"));
    const [row] = readDone(home);
    expect(row).toMatchObject({
      session_id: "eeee-5555",
      ts: "2026-07-29T00:00:00.000Z",
      processed_ts: "2026-07-30T10:00:00.000Z",
      outcome: "completed",
    });
  });

  it("stamps its own outcome rather than trusting one on the entry", () => {
    appendDone(home, entry("ffff-6666", { outcome: "completed", processed_ts: "spoofed" }), "timeout");
    expect(readDone(home)[0]?.outcome).toBe("timeout");
    expect(readDone(home)[0]?.processed_ts).not.toBe("spoofed");
  });

  it("appends without touching the pending queue", () => {
    appendPending(home, entry("gggg-7777"));
    appendDone(home, entry("gggg-7777"), "completed");
    expect(readQueue(home)).toHaveLength(1);
    expect(existsSync(donePath(home))).toBe(true);
  });
});

describe("rtl101 — removeFromQueue cuts by identity, not by session id", () => {
  it("removes the entry readQueue handed back", () => {
    appendPending(home, entry("a"));
    appendPending(home, entry("b"));
    appendPending(home, entry("c"));
    const target = readQueue(home)[1]!;
    expect(removeFromQueue(home, target)).toBe(true);
    expect(readQueue(home).map((e) => e.session_id)).toEqual(["a", "c"]);
  });

  it("removes an entry that has no session_id (the sid-keyed API could not)", () => {
    writeFileSync(
      queuePath(home),
      [JSON.stringify({ cwd: "/repo", ts: "2026-07-29T00:00:00.000Z" }), JSON.stringify(entry("b"))].join(
        "\n",
      ) + "\n",
      "utf8",
    );
    expect(removeFromQueue(home, readQueue(home)[0]!)).toBe(true);
    expect(readQueue(home).map((e) => e.session_id)).toEqual(["b"]);
  });

  it("preserves an unparseable line it was not asked to cut", () => {
    writeFileSync(
      queuePath(home),
      [JSON.stringify(entry("a")), "{torn", JSON.stringify(entry("c"))].join("\n") + "\n",
      "utf8",
    );
    expect(removeFromQueue(home, readQueue(home)[0]!)).toBe(true);
    expect(readFileSync(queuePath(home), "utf8")).toContain("{torn");
  });

  it("re-finds its line when the index went stale", () => {
    appendPending(home, entry("a"));
    appendPending(home, entry("b"));
    const target = readQueue(home)[1]!;
    // Simulate a mutation between read and remove: the head row disappears,
    // so `target`'s recorded index now points at the wrong line.
    removeFromQueue(home, readQueue(home)[0]!);
    expect(removeFromQueue(home, target)).toBe(true);
    expect(readQueue(home)).toEqual([]);
  });

  it("cuts nothing when the entry is already gone", () => {
    appendPending(home, entry("a"));
    const target = readQueue(home)[0]!;
    expect(removeFromQueue(home, target)).toBe(true);
    expect(removeFromQueue(home, target)).toBe(false);
  });

  it("returns false when the queue file does not exist", () => {
    expect(removeFromQueue(home, 0)).toBe(false);
  });

  it.each([
    ["a negative index", -1],
    ["an index past the end", 99],
  ])("returns false for %s", (_note, index) => {
    appendPending(home, entry("a"));
    expect(removeFromQueue(home, index as number)).toBe(false);
    expect(readQueue(home)).toHaveLength(1);
  });

  it("leaves an empty file rather than a stray blank line when the last entry goes", () => {
    appendPending(home, entry("only"));
    removeFromQueue(home, readQueue(home)[0]!);
    expect(readFileSync(queuePath(home), "utf8")).toBe("");
    expect(readQueue(home)).toEqual([]);
  });
});

describe("rtl101 — pendingSessionIds", () => {
  it("collects the ids the queue is waiting on and ignores sid-less rows", () => {
    appendPending(home, entry("a"));
    appendPending(home, entry("b"));
    appendPending(home, { cwd: "/repo", ts: "2026-07-29T00:00:00.000Z" });
    expect([...pendingSessionIds(home)].sort()).toEqual(["a", "b"]);
  });

  it("is empty when nothing is queued", () => {
    expect(pendingSessionIds(home).size).toBe(0);
  });
});

describe("rtl101 — marker paths refuse an unsafe session id", () => {
  it.each([
    ["path traversal", "../../etc/passwd"],
    ["a slash", "a/b"],
    ["a leading dot", ".hidden"],
    ["empty", ""],
    ["a space", "a b"],
    ["a NUL byte", "a\\u0000b"],
    ["a backslash", "a\\\\b"],
  ])("rejects %s", (_note, sid) => {
    expect(isSafeSessionId(sid)).toBe(false);
    expect(() => endedMarkerPath(home, sid)).toThrow(/unsafe session id/);
    expect(() => doneMarkerPath(home, sid)).toThrow(/unsafe session id/);
  });

  it("accepts a UUID-shaped id", () => {
    const sid = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    expect(isSafeSessionId(sid)).toBe(true);
    expect(endedMarkerPath(home, sid)).toBe(join(markersDir(home), `${sid}.ended`));
    expect(doneMarkerPath(home, sid)).toBe(join(markersDir(home), `${sid}.done`));
  });
});

describe("rtl101 — touchEndedMarker", () => {
  it("creates the marker and its directory", () => {
    touchEndedMarker(home, "aaaa-1111");
    expect(existsSync(endedMarkerPath(home, "aaaa-1111"))).toBe(true);
  });

  it("is idempotent and never clobbers an existing marker", () => {
    touchEndedMarker(home, "aaaa-1111");
    writeFileSync(endedMarkerPath(home, "aaaa-1111"), "prior", "utf8");
    touchEndedMarker(home, "aaaa-1111");
    expect(readFileSync(endedMarkerPath(home, "aaaa-1111"), "utf8")).toBe("prior");
  });
});

describe("rtl101 — withQueueLock", () => {
  it("returns the callback's value and releases the lock", () => {
    expect(withQueueLock(home, () => 42)).toBe(42);
    expect(existsSync(queueLockPath(home))).toBe(false);
  });

  it("releases the lock when the callback throws", () => {
    expect(() =>
      withQueueLock(home, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(existsSync(queueLockPath(home))).toBe(false);
  });

  it("serializes a dedupe-then-append critical section", () => {
    // The listener's shape: read the pending set and append under one hold.
    withQueueLock(home, () => {
      if (!pendingSessionIds(home).has("aaaa-1111")) appendPending(home, entry("aaaa-1111"));
    });
    withQueueLock(home, () => {
      if (!pendingSessionIds(home).has("aaaa-1111")) appendPending(home, entry("aaaa-1111"));
    });
    expect(readQueue(home)).toHaveLength(1);
  });

  it("throws PathLockHeldError when a live holder outlasts the deadline", () => {
    // A live-PID lock body — the stale-PID reaper must classify it as held,
    // not reap it, so the deadline is what ends the wait.
    withQueueLock(home, () => {
      expect(() =>
        withQueueLock(home, () => "never", { timeoutMs: 30, pollMs: 5 }),
      ).toThrow(PathLockHeldError);
    });
  });

  it("names the lock path on the held error (the listener's drop signal)", () => {
    withQueueLock(home, () => {
      try {
        withQueueLock(home, () => "never", { timeoutMs: 30, pollMs: 5 });
        expect.unreachable("expected the nested acquire to fail");
      } catch (err) {
        expect(err).toBeInstanceOf(PathLockHeldError);
        expect((err as PathLockHeldError).path).toBe(queueLockPath(home));
      }
    });
  });
});
