// Lock unit tests for src/lib/manage/lock.ts (mgr101).
//
// mgr101 ships the minimal-viable lock — O_EXCL acquire + release. mgr106
// will harden with stale-PID detection + PID-recycling cross-check. These
// tests pin the v0 contract.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ManagerLockHeldError,
  acquireManagerLock,
  managerLockPath,
} from "../src/lib/manage/lock.js";

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "devx-mgr-lock-"));
});
afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("acquireManagerLock", () => {
  it("creates manager.lock with {pid, acquired_at}", () => {
    const handle = acquireManagerLock(cacheDir);
    const path = managerLockPath(cacheDir);
    expect(existsSync(path)).toBe(true);
    const body = JSON.parse(readFileSync(path, "utf8"));
    expect(body.pid).toBe(process.pid);
    expect(typeof body.acquired_at).toBe("string");
    expect(new Date(body.acquired_at).toISOString()).toBe(body.acquired_at);
    handle.release();
    expect(existsSync(path)).toBe(false);
  });

  it("throws ManagerLockHeldError when lock is already held", () => {
    const first = acquireManagerLock(cacheDir);
    expect(() => acquireManagerLock(cacheDir)).toThrow(ManagerLockHeldError);
    first.release();
    // After release, a fresh acquire works.
    const second = acquireManagerLock(cacheDir);
    second.release();
  });

  it("release is idempotent — calling twice does not throw", () => {
    const handle = acquireManagerLock(cacheDir);
    handle.release();
    expect(() => handle.release()).not.toThrow();
  });

  it("throws a clear error when the lock parent dir is a regular file (ENOTDIR)", () => {
    const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
    mkdirSync(cacheDir, { recursive: true });
    // Plant a regular file where the locks dir should be.
    writeFileSync(join(cacheDir, "locks"), "not-a-dir", "utf8");
    expect(() => acquireManagerLock(cacheDir)).toThrow(/not a directory/);
  });

  it("throws ManagerLockHeldError surfacing the lock file path", () => {
    const first = acquireManagerLock(cacheDir);
    try {
      acquireManagerLock(cacheDir);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ManagerLockHeldError);
      expect((err as ManagerLockHeldError).path).toBe(managerLockPath(cacheDir));
      expect((err as Error).message).toContain("manager.lock");
    } finally {
      first.release();
    }
  });
});
