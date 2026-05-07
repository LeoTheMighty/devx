// Manager singleton lock — mgr101 minimal scaffold.
//
// O_EXCL create on `.devx-cache/locks/manager.lock` writing `{pid,
// acquired_at}` JSON. release() deletes the file. NO stale-PID detection
// (mgr106 adds it), NO uptime cross-check for PID-recycling (mgr106 too).
// Keeping the primitive small + exhaustively testable; mgr106 hardens
// against crash-recovery edge cases once the broader scaffolding is in
// place.
//
// The on-disk format ({pid, acquired_at}) is pinned: mgr106 needs
// acquired_at for the PID-recycling cross-check (party-mode locked
// decision: lock file content includes acquired_at timestamp).

import { closeSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LockHandle {
  release(): void;
}

export class ManagerLockHeldError extends Error {
  public readonly path: string;
  constructor(path: string) {
    super(`manager lock already held: ${path}`);
    this.name = "ManagerLockHeldError";
    this.path = path;
  }
}

export function managerLockPath(cacheDir: string = ".devx-cache"): string {
  return join(cacheDir, "locks", "manager.lock");
}

export function acquireManagerLock(cacheDir: string = ".devx-cache"): LockHandle {
  const path = managerLockPath(cacheDir);
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR" || code === "EEXIST") {
      throw new Error(
        `manager lock dir is not a directory: ${dirname(path)} (${code})`,
      );
    }
    throw err;
  }
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new ManagerLockHeldError(path);
    throw err;
  }
  try {
    const body =
      JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() }) + "\n";
    writeSync(fd, body);
    closeSync(fd);
  } catch (err) {
    // writeSync failure leaves an empty lock file behind — without cleanup,
    // the next acquire sees EEXIST and reports "held" forever. closeSync
    // first (best-effort) so the FD doesn't leak, then unlink the empty file.
    try {
      closeSync(fd);
    } catch {
      // FD may already be invalid after a writeSync failure on some kernels.
    }
    try {
      unlinkSync(path);
    } catch {
      // best-effort
    }
    throw err;
  }
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      try {
        unlinkSync(path);
      } catch (err) {
        // ENOENT = already gone (fine — release is best-effort). Anything
        // else (EACCES, EISDIR) is a real bug worth surfacing instead of
        // silent-swallow. mgr106's stale-PID hardening will reclaim
        // permission-denied cases explicitly.
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    },
  };
}
