// Atomically swap a freshly built `dist.next` into place as `dist` (b931a1).
//
// `devx devx-helper finalize` rebuilds the main worktree's gitignored
// `dist/` after every merge, so the next `/devx` claim runs post-merge code
// (LEARN.md § multi-loop-concurrency E2). That rebuild happens on the one
// tree every concurrent session shares — a peer invoking `devx` while tsc is
// emitting over `dist/` in place would load a half-written module graph and
// fail in a way that looks nothing like its cause.
//
// So `npm run build:swap` compiles into `dist.next` and this script performs
// the handover. POSIX rename() cannot replace a non-empty DIRECTORY, so a
// true one-syscall swap is not available; two renames are, and they shrink
// the window in which `dist/` does not exist from a whole tsc run to a
// syscall.
//
// TWO concurrent swaps are the case that matters, because multi-loop
// concurrency is the whole premise of the story that added this. `dist.next`
// and `dist.prev` are fixed paths, so without serialisation two finalize
// runs interleave catastrophically: B's entry-point cleanup of `dist.prev`
// deletes A's only rollback copy, and if A's second rename then fails the
// repo is left with no `dist/` at all — the exact state this file promises
// to avoid. An O_EXCL lock makes the whole dance mutually exclusive; a
// second swap that cannot take it exits 0 having done nothing, because the
// peer holding it is building the same merged HEAD we would have.
//
// Failure leaves the previous `dist/` in place wherever it can: the caller
// treats a failed rebuild as warn-and-continue, and "the old build" is a far
// better resting state than "no build".
//
// Spec: dev/dev-b931a1-2026-07-29T10:15-finalize-merge-tail-primitive.md

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Stale-lock threshold. A tsc run plus two renames is seconds; ten minutes
 *  means the holder died. Long enough that a slow-but-live build is never
 *  stolen from, short enough that a crash doesn't wedge every future swap. */
const LOCK_STALE_MS = 10 * 60 * 1000;

export function swapDist(repoRoot, io = {}) {
  const log = io.log ?? ((s) => process.stdout.write(s));
  const warn = io.warn ?? ((s) => process.stderr.write(s));
  const now = io.now ?? (() => Date.now());

  const next = join(repoRoot, "dist.next");
  const live = join(repoRoot, "dist");
  const prev = join(repoRoot, "dist.prev");
  const lock = join(repoRoot, "dist.swap.lock");

  if (!existsSync(next)) {
    warn(
      "swap-dist: dist.next does not exist — the compile step did not emit; leaving dist/ untouched\n",
    );
    return 1;
  }

  // ---- acquire ------------------------------------------------------------
  let held = false;
  for (let attempt = 0; attempt < 2 && !held; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      try {
        // The body is what makes the stale check work at all: an empty file
        // parses to NaN, reads as stale, and gets reaped on first contact —
        // which would make the lock decorative.
        writeFileSync(fd, JSON.stringify({ at: now(), pid: process.pid }) + "\n");
      } finally {
        closeSync(fd);
      }
      held = true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Reap a lock whose holder died mid-swap; otherwise defer to the peer.
      let stamp = NaN;
      try {
        stamp = Number(JSON.parse(readFileSync(lock, "utf8")).at);
      } catch {
        stamp = NaN;
      }
      const stale = !Number.isFinite(stamp) || now() - stamp > LOCK_STALE_MS;
      if (stale && attempt === 0) {
        try {
          unlinkSync(lock);
        } catch {
          // raced with the holder's own release — retry the open
        }
        continue;
      }
      warn(
        "swap-dist: another build:swap holds dist.swap.lock — skipping this swap; the peer is installing the same merged HEAD\n",
      );
      return 0;
    }
  }

  try {
    // Safe now that we hold the lock: a leftover dist.prev can only be from a
    // swap that died, and dist/ is gitignored build output with no state
    // worth recovering.
    rmSync(prev, { recursive: true, force: true });

    const hadLive = existsSync(live);
    if (hadLive) {
      try {
        renameSync(live, prev);
      } catch (e) {
        // Inside the try (it used to be outside): a failure here means dist/
        // is untouched, which is the good resting state — say so rather than
        // dying with an uncaught stack.
        warn(`swap-dist: could not move the live dist/ aside: ${e.message}; dist/ left as-is\n`);
        return 1;
      }
    }
    try {
      renameSync(next, live);
    } catch (e) {
      if (hadLive) {
        try {
          renameSync(prev, live);
        } catch {
          warn(
            `swap-dist: FAILED to install dist.next AND failed to restore the previous dist/ — run \`npm run build\` in ${repoRoot} before invoking devx again\n`,
          );
        }
      }
      warn(`swap-dist: rename failed: ${e.message}\n`);
      return 1;
    }
    rmSync(prev, { recursive: true, force: true });
    log("swap-dist: dist.next -> dist\n");
    return 0;
  } finally {
    try {
      unlinkSync(lock);
    } catch {
      // Already gone (a stale-reaper took it). Nothing to do.
    }
  }
}

// Only act when run as the npm script, so the function above is importable
// by tests against a fixture root.
if (process.argv[1] && process.argv[1].endsWith("swap-dist.mjs")) {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  process.exit(swapDist(repoRoot));
}
