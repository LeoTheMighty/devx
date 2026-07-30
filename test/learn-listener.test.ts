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

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLearnListen } from "../src/commands/learn-helper.js";
import { type ListenerResult, handleHookPayload } from "../src/lib/learn/listener.js";
import { collapseWhitespace } from "../src/lib/learn/nudge.js";
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

// ---------------------------------------------------------------------------
// The detection arms (T1.3) — E-1, E-2, E-10.
// ---------------------------------------------------------------------------

const MARKER = "<!-- nudge-canonical -->";

/**
 * The canonical sentence as shipped, read from the marker rather than restated
 * — same extraction the evals use. A literal copy here would keep agreeing with
 * itself while the shipped prose (and therefore every real wrap-up) drifted.
 */
function markerProse(): string {
  const body = readFileSync(resolve(__dirname, "..", ".claude/commands/devx-learn.md"), "utf8");
  return collapseWhitespace((body.split(MARKER)[1] ?? "").trim().split(/\n\n/)[0] ?? "");
}

const NUDGE = markerProse();

const stop = (sid: string, message: string, over: Record<string, unknown> = {}) => ({
  hook_event_name: "Stop",
  session_id: sid,
  transcript_path: `/tmp/${sid}.jsonl`,
  cwd: "/repo",
  last_assistant_message: message,
  ...over,
});

const sessionEnd = (sid: string, over: Record<string, unknown> = {}) => ({
  hook_event_name: "SessionEnd",
  session_id: sid,
  ...over,
});

const envFor = (h: string, over: Record<string, string> = {}) => ({
  [LEARN_HOME_ENV]: h,
  ...over,
});

describe("rtl101 E-1 — Stop arm: nudge detection + durable enqueue", () => {
  it("appends exactly one entry carrying session_id, transcript_path, cwd, ts", () => {
    const res = handleHookPayload(stop("aaaa-1111", `Wrap-up.\n\n${NUDGE}\n`), envFor(home));
    expect(res.action).toBe("queued");
    const got = readQueue(home);
    expect(got).toHaveLength(1);
    for (const field of ["session_id", "transcript_path", "cwd", "ts"] as const) {
      expect(typeof got[0]?.[field]).toBe("string");
      expect(got[0]?.[field]).not.toBe("");
    }
  });

  it("detects a hard-wrapped copy of the sentence (wording, not bytes)", () => {
    // What the transcript actually holds: the terminal wrapped the sentence
    // across lines with continuation indents.
    const wrapped = NUDGE.replace(/ /g, (m, i: number) => (i % 40 === 0 ? "\n  " : m));
    expect(handleHookPayload(stop("bbbb-2222", `x\n${wrapped}`), envFor(home)).action).toBe(
      "queued",
    );
    expect(readQueue(home)).toHaveLength(1);
  });

  it("does not enqueue a reworded sentence (emit and detect have drifted)", () => {
    const reworded = NUDGE.replace("friction", "difficulty");
    expect(handleHookPayload(stop("cccc-3333", reworded), envFor(home)).action).toBe("no-nudge");
    expect(readQueue(home)).toEqual([]);
  });

  it("keeps one pending entry per session however many skills nudged", () => {
    handleHookPayload(stop("aaaa-1111", NUDGE), envFor(home));
    const second = handleHookPayload(stop("aaaa-1111", NUDGE), envFor(home));
    expect(second.action).toBe("duplicate");
    expect(readQueue(home)).toHaveLength(1);
  });

  it("re-queues a session whose earlier entry was already drained", () => {
    handleHookPayload(stop("aaaa-1111", NUDGE), envFor(home));
    removeFromQueue(home, readQueue(home)[0]!);
    expect(handleHookPayload(stop("aaaa-1111", NUDGE), envFor(home)).action).toBe("queued");
  });

  it.each([
    ["an unrecognized object", { nonsense: true }],
    ["null", null],
    ["undefined", undefined],
    ["an array", [1, 2, 3]],
    ["a bare string", "Stop"],
    ["a payload with no session_id", { hook_event_name: "Stop", last_assistant_message: NUDGE }],
    ["a non-string session_id", { hook_event_name: "Stop", session_id: 42 }],
    ["an unknown event name", stop("aaaa-1111", NUDGE, { hook_event_name: "PreToolUse" })],
    ["an absent event name", { session_id: "aaaa-1111", last_assistant_message: NUDGE }],
  ])("ignores %s without throwing or writing", (_note, payload) => {
    expect(() => handleHookPayload(payload, envFor(home))).not.toThrow();
    expect(handleHookPayload(payload, envFor(home)).action).toBe("ignored");
    expect(existsSync(queuePath(home))).toBe(false);
  });

  it.each([
    ["a nullish message", undefined],
    ["a non-string message", 42],
    ["an empty message", ""],
  ])("treats %s as a miss", (_note, message) => {
    expect(
      handleHookPayload(stop("aaaa-1111", "", { last_assistant_message: message }), envFor(home))
        .action,
    ).toBe("no-nudge");
  });

  it("writes nothing at all on the miss path — not even an empty queue file", () => {
    // The path taken at ~every turn end in every hooked repo (G-3): a Stop that
    // creates files would leave a `~/.claude/devx` behind on machines that
    // never retro at all.
    const fresh = join(home, "untouched");
    expect(handleHookPayload(stop("dddd-4444", "plain wrap-up"), envFor(fresh)).action).toBe(
      "no-nudge",
    );
    expect(existsSync(fresh)).toBe(false);
  });

  it("refuses a session id that could not be a marker filename", () => {
    // Refused at the queue's entrance rather than tripping the watcher later.
    expect(handleHookPayload(stop("../../etc/passwd", NUDGE), envFor(home)).action).toBe("ignored");
    expect(existsSync(queuePath(home))).toBe(false);
  });

  it("stamps ts from the injected clock", () => {
    handleHookPayload(stop("aaaa-1111", NUDGE), envFor(home), {
      now: () => new Date("2026-07-30T09:31:00.123Z"),
    });
    expect(readQueue(home)[0]?.ts).toBe("2026-07-30T09:31:00.123Z");
  });

  it("carries a null transcript_path through rather than inventing one", () => {
    handleHookPayload(stop("aaaa-1111", NUDGE, { transcript_path: undefined }), envFor(home));
    expect(readQueue(home)[0]).toMatchObject({ transcript_path: null });
  });

  it("drops the detection when the queue lock is held past the deadline", () => {
    // A wedged holder must cost one nudge, never a delayed turn.
    withQueueLock(home, () => {
      const res = handleHookPayload(stop("aaaa-1111", NUDGE), envFor(home), {
        lockOpts: { timeoutMs: 30, pollMs: 5 },
      });
      expect(res.action).toBe("lock-contended");
    });
    expect(readQueue(home)).toEqual([]);
  });
});

describe("rtl101 E-2 — DEVX_RETRO makes the listener inert", () => {
  const guarded = () => envFor(home, { DEVX_RETRO: "1" });

  it.each([
    ["a nudge-bearing Stop", () => stop("ffff-9999", `retro quoting the sentence: ${NUDGE}`)],
    ["a SessionEnd", () => sessionEnd("ffff-9999", { reason: "exit" })],
    ["garbage", () => ({ garbage: true })],
  ])("returns before touching anything for %s", (_note, build) => {
    expect(handleHookPayload(build(), guarded()).action).toBe("retro-guard");
  });

  it("writes no queue entry and no marker across all three payload shapes", () => {
    // The mechanical half of the retro-of-retro bound: each fork gets a fresh
    // session id, so dedupe alone could never cap the depth.
    appendPending(home, entry("ffff-9999"));
    for (const payload of [
      stop("ffff-9999", NUDGE),
      stop("gggg-8888", NUDGE),
      sessionEnd("ffff-9999", { reason: "exit" }),
      { garbage: true },
    ]) {
      handleHookPayload(payload, guarded());
    }
    expect(readQueue(home)).toHaveLength(1);
    expect(existsSync(markersDir(home))).toBe(false);
  });

  it("stays inert for any non-empty value, not just '1'", () => {
    // A guard that fails closed is the safe direction for a loop bound.
    for (const value of ["1", "0", "true", "no"]) {
      expect(handleHookPayload(stop("ffff-9999", NUDGE), envFor(home, { DEVX_RETRO: value })).action).toBe(
        "retro-guard",
      );
    }
    expect(existsSync(queuePath(home))).toBe(false);
  });

  it("is not guarded by an empty DEVX_RETRO", () => {
    expect(handleHookPayload(stop("ffff-9999", NUDGE), envFor(home, { DEVX_RETRO: "" })).action).toBe(
      "queued",
    );
  });
});

describe("rtl101 E-10 — SessionEnd reason denylist gates the fast path", () => {
  const sid = "aaaa-1111-bbbb-2222";

  beforeEach(() => {
    appendPending(home, entry(sid));
  });

  it.each([
    ["clear (the user keeps working in that terminal)", "clear"],
    ["resume", "resume"],
    ["bypass_permissions_disabled", "bypass_permissions_disabled"],
    ["logout (a spawn against an unauthenticated CLI can only fail)", "logout"],
  ])("writes no .ended marker for %s", (_note, reason) => {
    expect(handleHookPayload(sessionEnd(sid, { reason }), envFor(home)).action).toBe(
      "reason-denied",
    );
    expect(existsSync(endedMarkerPath(home, sid))).toBe(false);
  });

  it.each([
    ["an unknown reason (denylist, not allowlist)", { reason: "some_future_reason" }],
    ["an absent reason", {}],
    ["a non-string reason", { reason: 7 }],
    ["the ordinary exit reason", { reason: "exit" }],
  ])("writes the .ended marker for %s", (_note, over) => {
    expect(handleHookPayload(sessionEnd(sid, over), envFor(home)).action).toBe("marked");
    expect(existsSync(endedMarkerPath(home, sid))).toBe(true);
  });

  it("is idempotent across repeated SessionEnds", () => {
    handleHookPayload(sessionEnd(sid, { reason: "exit" }), envFor(home));
    writeFileSync(endedMarkerPath(home, sid), "prior", "utf8");
    handleHookPayload(sessionEnd(sid, { reason: "exit" }), envFor(home));
    expect(readFileSync(endedMarkerPath(home, sid), "utf8")).toBe("prior");
  });

  it("writes no marker for a session the queue is not waiting on", () => {
    // The marker exists to let the watcher skip the idle window; one for an
    // unqueued session is litter nothing ever collects.
    expect(handleHookPayload(sessionEnd("not-queued-9999", { reason: "exit" }), envFor(home)).action).toBe(
      "not-pending",
    );
    expect(existsSync(markersDir(home))).toBe(false);
  });

  it("writes no marker once the entry has been drained", () => {
    removeFromQueue(home, readQueue(home)[0]!);
    handleHookPayload(sessionEnd(sid, { reason: "exit" }), envFor(home));
    expect(existsSync(markersDir(home))).toBe(false);
  });

  it("marks only the session the payload names", () => {
    appendPending(home, entry("other-3333"));
    handleHookPayload(sessionEnd(sid, { reason: "exit" }), envFor(home));
    expect(readdirSync(markersDir(home))).toEqual([`${sid}.ended`]);
  });
});

describe("rtl101 — `devx learn-helper listen` exits 0 on every path (T1.4)", () => {
  const run = (input: string | (() => string), envOver: Record<string, string> = {}) => {
    const results: ListenerResult[] = [];
    const code = runLearnListen({
      env: envFor(home, envOver),
      readInput: typeof input === "string" ? () => input : input,
      onResult: (r) => results.push(r),
    });
    return { code, results };
  };

  it("queues the session for a nudge-bearing Stop payload", () => {
    const { code, results } = run(JSON.stringify(stop("aaaa-1111", NUDGE)));
    expect(code).toBe(0);
    expect(results[0]?.action).toBe("queued");
    expect(readQueue(home)).toHaveLength(1);
  });

  it.each([
    ["not JSON at all", "this is not json"],
    ["empty stdin", ""],
    ["whitespace only", "   \n"],
    ["a truncated object", '{"hook_event_name":"Stop"'],
    ["JSON null", "null"],
    ["a JSON array", "[1,2,3]"],
    ["a JSON scalar", '"Stop"'],
    ["a JSON object of the wrong shape", '{"nonsense":true}'],
  ])("exits 0 and writes nothing for %s", (_note, input) => {
    expect(run(input).code).toBe(0);
    expect(existsSync(queuePath(home))).toBe(false);
  });

  it("exits 0 when stdin cannot be read at all (a TTY with nothing to give)", () => {
    // `readFileSync(0)` raises EAGAIN when the hook is invoked by hand from a
    // terminal; that must look exactly like a miss.
    const { code } = run(() => {
      throw Object.assign(new Error("EAGAIN: resource temporarily unavailable, read"), {
        code: "EAGAIN",
      });
    });
    expect(code).toBe(0);
    expect(existsSync(queuePath(home))).toBe(false);
  });

  it("never reads stdin under DEVX_RETRO (E-2's 'without reading the payload')", () => {
    let reads = 0;
    const code = runLearnListen({
      env: envFor(home, { DEVX_RETRO: "1" }),
      readInput: () => {
        reads += 1;
        return JSON.stringify(stop("ffff-9999", NUDGE));
      },
    });
    expect(code).toBe(0);
    expect(reads).toBe(0);
    expect(existsSync(queuePath(home))).toBe(false);
  });

  it("writes the .ended marker for a pending session's SessionEnd", () => {
    appendPending(home, entry("aaaa-1111"));
    const { code, results } = run(JSON.stringify(sessionEnd("aaaa-1111", { reason: "exit" })));
    expect(code).toBe(0);
    expect(results[0]?.action).toBe("marked");
    expect(existsSync(endedMarkerPath(home, "aaaa-1111"))).toBe(true);
  });

  it("exits 0 even when the learn home cannot be written", () => {
    // An unwritable home (a file where the directory should be) is the one
    // failure the core can actually hit; it must still be a silent no-op.
    const blocked = join(home, "blocked");
    writeFileSync(blocked, "not a directory", "utf8");
    const seen: ListenerResult[] = [];
    const code = runLearnListen({
      env: { [LEARN_HOME_ENV]: blocked },
      readInput: () => JSON.stringify(stop("aaaa-1111", NUDGE)),
      // Collected, not asserted in the callback: a failing expect() inside the
      // callback would be swallowed by the command's own catch and the test
      // would pass for the wrong reason.
      onResult: (r) => seen.push(r),
    });
    expect(code).toBe(0);
    expect(seen.map((r) => r.action)).toEqual(["error"]);
  });
});
