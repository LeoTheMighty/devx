// Manager loop driver — mgr101 scaffold + mgr103 reconcile + mgr104 spawn.
//
// Public surface (pinned across mgr101–mgr104):
//   runManagerOnce(opts)      — single tick. Reads state + parses the three
//                                backlog files, runs reconcile() (mgr103),
//                                spawns at most one worker via spawnWorker
//                                (mgr104), writes manager.json +
//                                heartbeat.json, emits one stdout summary
//                                line. Returns TickResult.
//   runManagerLoop(opts)      — calls runManagerOnce at tickIntervalS
//                                cadence; AbortSignal aborts the sleep
//                                mid-tick; current tick drains; resolves
//                                cleanly.
//
// mgr105 adds the on('exit') handler with backoff + max-restarts gate.
// mgr106 hardens lock.ts with stale-PID detection + PID-recycling check.
//
// The summary-line format is locked from party-mode (PM lens, mgr101 AC #7):
// `tick <generation>: no work` | `tick <generation>: spawned <hash>` |
// `tick <generation>: maintained <hash> (pid <pid>)`. mgr101 shipped only
// the "no work" branch; mgr104 fills in spawned + maintained. The exact
// regex shape of all three branches is exported below as `TICK_SUMMARY_RE`
// so future stories must update one centralized regex if they touch the
// format — soft contract drift is the regression vector this guards
// against.
//
// **Backlog cwd separation.** The loop reads DEV.md / INTERVIEW.md /
// MANUAL.md from `opts.cwd` (default: `process.cwd()`). State files live
// under `opts.cacheDir` (default: `.devx-cache`). Tests pass an empty
// tmpdir as cwd to avoid reading the real project's backlog files.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseBacklogSnapshot } from "../backlog/parse.js";
import {
  type DesiredBlocking,
  enforceHardCap,
  reconcile,
} from "./reconcile.js";
import { applyExitToState, type SpawnFn, spawnWorker } from "./spawn.js";
import {
  type Heartbeat,
  type ManagerState,
  type RosterEntry,
  type TickOutcome,
  nextGeneration,
  readManagerState,
  writeHeartbeat,
  writeManagerState,
} from "./state.js";

/**
 * Regex matching every valid per-tick stdout summary line (PM-lens AC #7).
 * Pinned here so future stories can't drift the wording without updating
 * this file. Anchors ^/$ exclude trailing newlines — callers writing via
 * `process.stdout.write(line + "\n")` should test with the line trimmed.
 *
 *   tick 1: no work
 *   tick 12: spawned a1b2c3
 *   tick 99: maintained a1b2c3 (pid 12345)
 */
export const TICK_SUMMARY_RE =
  /^tick (?<gen>\d+): (?:no work|spawned [0-9a-f]+|maintained [0-9a-f]+ \(pid \d+\))$/;

export interface RunManagerOnceOpts {
  /** Override `.devx-cache` root for tests. */
  cacheDir?: string;
  /** Working directory used to resolve DEV.md / INTERVIEW.md / MANUAL.md.
   *  Defaults to `process.cwd()`. Tests pass an empty tmpdir. */
  cwd?: string;
  /** Test seam: now() injection for deterministic timestamps. */
  now?: () => Date;
  /** Test seam: sink for the one-line summary. Defaults to process.stdout. */
  out?: (line: string) => void;
  /** Default worker model when state.model isn't set. Loop driver plumbs
   *  this from `devx.config.yaml → capacity.models.dev`. */
  model?: string;
  /** Override the `claude` executable path passed to spawnWorker. */
  claudeBin?: string;
  /** Override the worker log directory. Tests use a tmpdir. */
  workerLogDir?: string;
  /** Test seam — pass-through to spawnWorker. */
  spawnFn?: SpawnFn;
  /** Test seam — pass-through to spawnWorker (`onSpawn` for child capture). */
  onSpawn?: (child: import("node:child_process").ChildProcess) => void;
  /** Test seam — pass-through to spawnWorker (`detached` override). */
  spawnDetached?: boolean;
  /** Test seam — short-circuit the spawn step. Reconcile still runs. */
  disableSpawn?: boolean;
  /**
   * mgr105 — `manager.max_restarts_per_spec` (default 5). Loop driver plumbs
   * from `devx.config.yaml → manager.max_restarts_per_spec`.
   */
  maxRestarts?: number;
  /**
   * mgr105 — `manager.worker_crash_backoff_s` (default `[10, 30, 90, 300]`).
   * Loop driver plumbs from `devx.config.yaml → manager.worker_crash_backoff_s`.
   */
  backoffSeconds?: number[];
  /**
   * mgr105 — test seam: replace `process.kill(pid, 0)` with a synchronous
   * predicate. Defaults to a real `process.kill` probe. Returns true iff the
   * PID is still alive. Tests use a Set-backed stub to assert the synthetic
   * exit fires when the manager restart sweep observes a dead PID.
   */
  pidAlive?: (pid: number) => boolean;
}

export interface TickResult {
  generation: number;
  outcome: TickOutcome;
  summary: string;
}

const TICKS_LOG_BOUND = 100;

export async function runManagerOnce(opts: RunManagerOnceOpts = {}): Promise<TickResult> {
  const cacheDir = opts.cacheDir ?? ".devx-cache";
  const cwd = opts.cwd ?? process.cwd();
  const nowFn = opts.now ?? (() => new Date());
  const out = opts.out ?? ((line: string) => process.stdout.write(line + "\n"));
  const pidAlive = opts.pidAlive ?? defaultPidAlive;

  // Cache the wall-clock moment once per tick. Test seams (`opts.now`)
  // commonly stage a per-call counter; sourcing every downstream nowFn() at
  // top-of-tick avoids accidental drift when reconcile, the PID-recovery
  // sweep, and the heartbeat write each pull a fresh date.
  const tickAt = nowFn();
  const tickClock = () => tickAt;

  // mgr105 — manager-restart PID-recovery sweep. Every roster entry whose
  // PID is no longer alive gets a synthetic exit event written before
  // reconcile reads state. Recovers the lost-exit case: the manager itself
  // crashed mid-window, so the worker's on-exit handler never wrote its
  // crash bookkeeping. Without this sweep, a maxed-out spec sits forever
  // in a stale "in-progress" roster slot and reconcile never picks the
  // next one.
  const initialState = readManagerState(cacheDir);
  for (const entry of initialState.roster) {
    if (entry.pid === process.pid) continue; // never sweep ourselves
    if (pidAlive(entry.pid)) continue;
    try {
      applyExitToState(
        cacheDir,
        entry.spec_hash,
        "manager-restart-detected",
        null,
        tickClock,
      );
    } catch {
      // best-effort — same posture as the on-exit handler
    }
  }
  const prev = readManagerState(cacheDir);
  const generation = nextGeneration(prev);
  const ts = tickAt.toISOString();

  // mgr103: parse the three backlog files + reconcile against current state.
  // Missing files → empty content; reconcile yields zero desiredSpawns.
  const snapshot = parseBacklogSnapshot({
    devMd: readBacklogFile(cwd, "DEV.md"),
    interviewMd: readBacklogFile(cwd, "INTERVIEW.md"),
    manualMd: readBacklogFile(cwd, "MANUAL.md"),
  });
  const recon = reconcile(prev, snapshot, {
    defaultModel: opts.model,
    maxRestarts: opts.maxRestarts,
    backoffSeconds: opts.backoffSeconds,
    now: tickClock,
  });

  // mgr105 — apply desiredBlocking before any spawn decision. Each blocked
  // spec gets DEV.md flipped [/]→[-], spec status: blocked, status-log
  // line, INTERVIEW.md row, and the crashes record cleared. Order: do this
  // BEFORE the spawn branch so a single tick that observes both
  // "max-restarts exceeded for spec A" + "spec B is ready to spawn" still
  // spawns B normally — A's blocking doesn't compete with the cap.
  for (const block of recon.desiredBlocking) {
    try {
      applyBlocking(cacheDir, cwd, snapshot.dev, block, tickClock);
    } catch {
      // best-effort — a partial application leaves the next tick to
      // re-emit the desiredBlocking (idempotent: status is already
      // blocked or path lookup fails, both no-ops).
    }
  }

  // mgr105 (EC-H11) — orphan-crashes cleanup. A crashes record whose spec
  // is in DEV.md with a TERMINAL status (blocked/done/deleted/superseded)
  // can never be revisited by reconcile (those statuses are filtered out
  // of the spawn + desiredBlocking iteration). Without this sweep, such
  // records would persist forever — and a future user-driven re-claim
  // (status flips back to ready) would inherit a maxed-out crash_count
  // and immediately re-block, denying the user a single fresh attempt.
  // Same posture for crashes records whose spec_hash isn't in DEV.md at
  // all (user deleted the row).
  garbageCollectCrashes(cacheDir, snapshot.dev);

  let outcome: TickOutcome = "no-work";
  let summary = `tick ${generation}: no work`;

  if (recon.desiredSpawns.length > 0 && !opts.disableSpawn) {
    const desired = recon.desiredSpawns[0]!;
    // Belt-and-suspenders cap check (AC #5). reconcile already enforces
    // this in mgr103 — the explicit check here ensures a programmatic
    // bypass throws BEFORE invoking child_process.spawn. Error message
    // is verbatim "Phase 1 hard cap: cannot spawn second worker
    // (running: <hash>)" per reconcile.ts:enforceHardCap.
    enforceHardCap(prev.roster, recon.desiredSpawns);

    await spawnWorker(desired.spec_hash, desired.model, {
      cacheDir,
      logDir: opts.workerLogDir,
      claudeBin: opts.claudeBin,
      now: opts.now,
      spawnFn: opts.spawnFn,
      onSpawn: opts.onSpawn,
      detached: opts.spawnDetached,
    });
    outcome = "spawned";
    summary = `tick ${generation}: spawned ${desired.spec_hash}`;
  } else if (livingRoster(prev.roster).length > 0) {
    // mgr101 shipped only "no work"; mgr104 adds the maintained branch.
    // We surface the FIRST living roster entry — hard cap = 1 keeps this
    // unambiguous. Phase 3 (epic-capacity-management) widens to N entries
    // and the format evolves at that boundary.
    const r = livingRoster(prev.roster)[0]!;
    outcome = "maintained";
    summary = `tick ${generation}: maintained ${r.spec_hash} (pid ${r.pid})`;
  }

  // Re-read state at the latest possible moment so the tick-write picks up
  // any roster mutation made by spawnWorker (registerRosterEntry) AND any
  // subsequent on-exit handler that fired during the await window. The
  // alternative — caching the post-spawn read in `workingState` and writing
  // its `roster` back — has been the regression vector identified in
  // adversarial review (Blind Hunter F1 / Edge Case Hunter F1): a fast
  // exiting child can land its on-exit write between the cache and the
  // tick-write, and the cached roster then resurrects the dead PID.
  // Reading freshly here narrows the race window to microseconds (still
  // present until mgr106's lock; mgr105's PID-existence sweep mops up).
  const fresh = readManagerState(cacheDir);
  const ticks = [...(fresh.ticks ?? []), { generation, ts, outcome }];
  const trimmedTicks = ticks.slice(-TICKS_LOG_BOUND);
  const next: ManagerState = {
    generation,
    started_at: fresh.started_at ?? ts,
    last_tick_at: ts,
    ticks: trimmedTicks,
    roster: fresh.roster ?? [],
    lock: fresh.lock,
  };
  // Preserve model field from fresh state (set by spawnWorker on first
  // spawn) or fall back to opts.model (so a fresh state with a configured
  // model gets persisted). Skip when neither is set — keeps fresh state
  // schema clean.
  if (fresh.model !== undefined) next.model = fresh.model;
  else if (opts.model !== undefined) next.model = opts.model;
  // mgr105 — preserve crashes from the freshly-read state. Otherwise the
  // tick-write silently drops the on-exit handler's crash bookkeeping +
  // the PID-recovery sweep's synthetic exits, breaking backoff +
  // max-restarts entirely. Mirror the model-field treatment: only attach
  // when present so fresh-state stays schema-clean.
  if (fresh.crashes !== undefined && fresh.crashes.length > 0) {
    next.crashes = fresh.crashes;
  }

  writeManagerState(cacheDir, next);

  const heartbeat: Heartbeat = { ts, pid: process.pid, generation };
  writeHeartbeat(cacheDir, heartbeat);

  out(summary);

  return { generation, outcome, summary };
}

export interface RunManagerLoopOpts extends RunManagerOnceOpts {
  /** Tick interval in seconds. */
  tickIntervalS: number;
  /** AbortSignal that triggers a clean drain + return. */
  signal: AbortSignal;
}

export async function runManagerLoop(opts: RunManagerLoopOpts): Promise<void> {
  // Reject obviously-wrong tickIntervalS values that would either spin the
  // CPU (≤ 0, NaN) or silently misinterpret a millisecond value as seconds
  // (`tickIntervalS = 60_000` would sleep 16+ hours). Programmatic callers
  // are the audience here — `readTickIntervalS()` in commands/manage.ts
  // already pre-filters CLI input.
  if (
    typeof opts.tickIntervalS !== "number" ||
    !Number.isFinite(opts.tickIntervalS) ||
    opts.tickIntervalS <= 0
  ) {
    throw new Error(
      `runManagerLoop: tickIntervalS must be a positive finite number (seconds); got ${String(opts.tickIntervalS)}`,
    );
  }
  if (opts.tickIntervalS > 86400) {
    // 24h sanity ceiling — anyone passing a value this large probably meant
    // milliseconds. Better to fail fast than to sleep for a day.
    throw new Error(
      `runManagerLoop: tickIntervalS=${opts.tickIntervalS}s exceeds 24h ceiling — did you mean milliseconds?`,
    );
  }
  while (!opts.signal.aborted) {
    await runManagerOnce({
      cacheDir: opts.cacheDir,
      cwd: opts.cwd,
      now: opts.now,
      out: opts.out,
      model: opts.model,
      claudeBin: opts.claudeBin,
      workerLogDir: opts.workerLogDir,
      spawnFn: opts.spawnFn,
      onSpawn: opts.onSpawn,
      spawnDetached: opts.spawnDetached,
      disableSpawn: opts.disableSpawn,
      maxRestarts: opts.maxRestarts,
      backoffSeconds: opts.backoffSeconds,
      pidAlive: opts.pidAlive,
    });
    if (opts.signal.aborted) return;
    await sleepInterruptible(opts.tickIntervalS * 1000, opts.signal);
  }
}

function sleepInterruptible(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let timer: NodeJS.Timeout | null = null;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort);
  });
}

function readBacklogFile(cwd: string, name: string): string {
  try {
    return readFileSync(join(cwd, name), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOENT (file truly missing) is the canonical degraded-input signal —
    // reconcile sees empty content and yields no work. EACCES (permission
    // denied — common when the user `chmod 000`'s a file to "pause" it) +
    // EISDIR (someone planted a directory at the path) get the same
    // treatment to keep the loop best-effort. Any other error (EIO,
    // unknown) propagates so the manager surfaces a real failure rather
    // than silently degrading. EC-M8 fix.
    if (code === "ENOENT" || code === "EACCES" || code === "EISDIR") return "";
    throw err;
  }
}

// Filter out any roster entry the loop should treat as "not currently
// running" for summary purposes. Phase 1 has no PID-existence check
// (mgr106 adds it), so this currently passes everything through. Kept as
// a named hook so mgr106's sweep wires here without touching the summary
// branching logic.
function livingRoster(roster: RosterEntry[] | undefined): RosterEntry[] {
  return roster ?? [];
}

/**
 * mgr105 — default PID-existence probe. `process.kill(pid, 0)` is the POSIX
 * idiom: signal 0 doesn't deliver anything; it just performs permission and
 * existence checks. Returns true iff the PID is still alive AND the manager
 * has permission to signal it.
 *
 *   ESRCH → no such process; PID is dead → false.
 *   EPERM → process exists but manager lacks permission to signal → true
 *           (we treat "alive but unsignal-able" as alive — signal 0 doesn't
 *           need permission on most kernels, but a UID change after spawn
 *           could trigger this. Conservative: don't synthetically reap).
 *   anything else → swallow + treat as alive (don't false-positive a synthetic
 *                   exit on a non-fatal kernel hiccup).
 *
 * mgr106 hardens this with the lock + acquired_at cross-check to detect
 * PID-recycling. Until then this probe is best-effort.
 */
function defaultPidAlive(pid: number): boolean {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return true;
  }
}

/**
 * mgr105 — apply a single DesiredBlocking decision. Three file edits + a
 * state mutation, all best-effort but each independently idempotent so a
 * partial-failure on tick N can be retried on tick N+1 without
 * double-writing.
 *
 *   1. Spec file frontmatter: `status: in-progress` → `status: blocked`.
 *   2. Spec file status log: append the AC #3 line verbatim
 *      (`manager: max restarts exceeded (5x exit-<lastCode>)`).
 *   3. DEV.md row: `[/]` → `[-]` for this spec_hash.
 *   4. INTERVIEW.md: append a fresh Q-numbered entry citing the crash.
 *   5. Manager state: drop the crashes record for this spec_hash so a
 *      future user-driven re-claim starts fresh.
 *
 * Idempotency:
 *   - Step 1 leaves `status: blocked` alone if already blocked.
 *   - Step 2 dedups by checking the status log already contains the
 *     same `manager: max restarts exceeded (...)` line.
 *   - Step 3 leaves `[-]` rows alone.
 *   - Step 4 *does* re-append on retry. The next tick's reconcile won't
 *     re-emit desiredBlocking (we cleared crashes in step 5), so duplicate
 *     INTERVIEW rows happen only when the crashes-clear write itself fails
 *     on tick N AND the rest succeeded — extremely narrow, accepted as a
 *     diagnosable double-INTERVIEW rather than a load-bearing dedup.
 */
function applyBlocking(
  cacheDir: string,
  cwd: string,
  devRows: ReadonlyArray<{ hash: string; path: string }>,
  block: DesiredBlocking,
  nowFn: () => Date,
): void {
  const row = devRows.find((r) => r.hash === block.spec_hash);
  if (!row) return; // spec not in DEV.md — nothing to do (defensive)

  const specPath = resolveSpecPath(cwd, row.path);
  if (specPath) {
    blockSpecFile(specPath, block, nowFn);
  }

  const devMdPath = join(cwd, "DEV.md");
  flipDevMdCheckbox(devMdPath, block.spec_hash);

  const interviewPath = join(cwd, "INTERVIEW.md");
  appendInterviewRow(interviewPath, block, row.path, nowFn);

  // Clear the crashes record last so retries on partial-failure see
  // desiredBlocking again on the next tick.
  try {
    const cur = readManagerState(cacheDir);
    if (!cur.crashes || cur.crashes.length === 0) return;
    const next: ManagerState = {
      ...cur,
      crashes: cur.crashes.filter((c) => c.spec_hash !== block.spec_hash),
    };
    if (next.crashes!.length === 0) delete next.crashes;
    writeManagerState(cacheDir, next);
  } catch {
    // best-effort
  }
}

function resolveSpecPath(cwd: string, relPath: string): string | null {
  // DevRow.path is the canonical relative path from DEV.md
  // (e.g. `dev/dev-mgr105-2026-04-28T19:30-manage-crash-restart.md`).
  // Try the verbatim path first; fall back to a glob over `dev/` for the
  // hash if the row's path has drifted (rare — the DEV.md row text drives
  // the path verbatim).
  try {
    const direct = join(cwd, relPath);
    readFileSync(direct, "utf8");
    return direct;
  } catch {
    // fall through
  }
  const m = /\/(?<type>[a-z]+)-(?<hash>[a-z0-9]+)-/.exec(relPath);
  if (!m) return null;
  const type = m.groups!.type;
  const hash = m.groups!.hash;
  try {
    const dir = join(cwd, type);
    const candidates = readdirSync(dir).filter((f) =>
      f.startsWith(`${type}-${hash}-`) && f.endsWith(".md"),
    );
    if (candidates.length === 0) return null;
    // Lexicographic max — timestamp suffixes sort consistently. Multiple
    // matches shouldn't happen (claim hash is unique) but we're defensive.
    candidates.sort();
    return join(dir, candidates[candidates.length - 1]);
  } catch {
    return null;
  }
}

function blockSpecFile(
  specPath: string,
  block: DesiredBlocking,
  nowFn: () => Date,
): void {
  let content: string;
  try {
    content = readFileSync(specPath, "utf8");
  } catch (err) {
    // ENOENT is benign (spec file removed); other read errors should
    // surface — silently swallowing EACCES masks real bugs.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    throw err;
  }
  let next = content;
  // EC-H4 fix: scope the `status:` rewrite to the frontmatter block (the
  // first `---\n...\n---` segment). A spec with body content like
  // ```yaml\nstatus: blocked\n``` would otherwise have its body fenced
  // example flipped if the frontmatter didn't have a status: line — even
  // a `replace` (single-match) lands on whichever `status:` line comes
  // first. Anchoring inside the frontmatter is structurally correct.
  next = replaceFrontmatterStatus(next, "blocked");
  // Status log append. EC-H12 / BH-H4 dedup fix: anchor on the
  // load-bearing prefix `manager: max restarts exceeded` (NOT the full
  // summary including count + code), so heterogeneous retries with
  // different counts or codes collapse to one line per spec.
  const dedupPrefix = "manager: max restarts exceeded";
  if (!next.includes(dedupPrefix)) {
    const lastCode = renderExitCode(block.last_exit_code);
    const summary = `${dedupPrefix} (${block.crash_count}x exit-${lastCode})`;
    const stamp = nowFn().toISOString();
    const trimmed = next.endsWith("\n") ? next : next + "\n";
    next = `${trimmed}- ${stamp} — ${summary}\n`;
  }
  if (next === content) return;
  writeFileSync(specPath, next, "utf8");
}

/**
 * Replace the `status:` field inside a YAML frontmatter block (the first
 * `---\n...\n---` segment). Returns content unchanged if no frontmatter or
 * no scalar `status:` field.
 *
 * Scope is intentionally narrow — we only flip the conventional one-line
 * `status: <scalar>` form (the only shape devx specs actually use). Multi-
 * line YAML scalars (`status: |\n  blocked`) are out of scope; logging the
 * miss to stderr would be noisy — the spec author can fix the frontmatter
 * shape if they hit this. EC-H5 acknowledged.
 */
function replaceFrontmatterStatus(content: string, value: string): string {
  // Match leading `---\n...---\n` with `s` flag (dotAll) for multi-line
  // body. The frontmatter must START at the file head — a body `---` that
  // isn't preceded by a frontmatter is correctly NOT matched.
  const fmRe = /^(---\n)([\s\S]*?)(\n---\n)/;
  const m = fmRe.exec(content);
  if (!m) return content;
  const [, head, body, tail] = m;
  // Inside the frontmatter body, replace the FIRST `status: <scalar>` line.
  // `\S+` handles tags / quotes / nested-but-flat values. A multi-line
  // scalar (`status: |`) doesn't match — caller accepts the no-op (above).
  const statusRe = /^(status:\s*)\S+(.*)$/m;
  if (!statusRe.test(body)) return content;
  const newBody = body.replace(statusRe, `$1${value}$2`);
  return head + newBody + tail + content.slice(m[0].length);
}

function flipDevMdCheckbox(devMdPath: string, hash: string): void {
  let content: string;
  try {
    content = readFileSync(devMdPath, "utf8");
  } catch {
    return;
  }
  // Match the row containing `<type>-<hash>-` and flip its leading checkbox
  // to `[-]`. Only flips `[ ]`, `[/]`, or already `[-]` (idempotent) — `[x]`
  // means already-merged and shouldn't get clobbered on a stale state read.
  // Anchor on `\`<type>-<hash>-` to scope to the file-path token.
  const re = new RegExp(
    String.raw`^(\s*-\s*)\[([ /\-])\](\s*` +
      String.raw`\x60[a-z]+/[a-z]+-` +
      escapeRe(hash) +
      String.raw`-)`,
    "m",
  );
  const next = content.replace(re, (_full, lead, _box, tail) => `${lead}[-]${tail}`);
  if (next === content) return;
  writeFileSync(devMdPath, next, "utf8");
}

function appendInterviewRow(
  interviewPath: string,
  block: DesiredBlocking,
  specPath: string,
  nowFn: () => Date,
): void {
  let cur = "";
  try {
    cur = readFileSync(interviewPath, "utf8");
  } catch (err) {
    // ONLY synthesize a fresh preamble on ENOENT (file truly missing). Any
    // other read failure (EACCES on a deployed read-only project, EIO on a
    // failing disk) means the file *exists* and we MUST NOT overwrite it
    // with a fresh preamble — that would silently wipe the user's INTERVIEW
    // history. EC-H10 fix: surface the error so the loop's outer try/catch
    // marks this blocking attempt as best-effort-failed (next tick retries).
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    cur = "# INTERVIEW — Questions for the user\n\n";
  }
  // EC-H2 / BH-H3 fix: dedup on the load-bearing identifier "Worker for
  // <hash> hit max restarts" — if a prior tick already wrote the row (and
  // step 5 crashes-clear failed), do NOT duplicate. Idempotent across
  // partial-failure retries. The dedup is by spec_hash, not by full
  // summary, so heterogeneous retries (different crash_count or
  // last_exit_code) still collapse to one row per max-restart event.
  const dedupAnchor = `Worker for ${block.spec_hash} hit max restarts`;
  if (cur.includes(dedupAnchor)) return;
  const qNum = nextQuestionNumber(cur);
  const stamp = nowFn().toISOString();
  const lastCode = renderExitCode(block.last_exit_code);
  const entry =
    `- [ ] **Q#${qNum} — ${dedupAnchor} (${block.crash_count}x exit-${lastCode}).**\n` +
    `  - Context: filed by ManageAgent on ${stamp}. Spec: \`${specPath}\`.\n` +
    `  - Question: investigate the crash root cause; once fixed, reset DEV.md row to \`[ ]\` and frontmatter \`status: ready\` to re-enter the loop.\n` +
    `  - Blocks: ${block.spec_hash}\n` +
    `  - Options: (a) ack + investigate, (b) abandon (mark spec \`deleted\`).\n` +
    `  - Agent recommendation: (a) — exit-${lastCode} repeated ${block.crash_count}× is unlikely to be transient; rerun under \`devx manage --once\` after fix.\n`;
  // Normalize trailing whitespace so the new entry sits exactly one blank
  // line below prior content. writeFileSync (not appendFileSync) keeps the
  // separator deterministic regardless of the file's prior trailing state.
  const trimmed = cur.replace(/\s*$/, "");
  const sep = trimmed.length > 0 ? "\n\n" : "";
  writeFileSync(interviewPath, trimmed + sep + entry, "utf8");
}

/**
 * mgr105 (EC-H11) — sweep orphaned crashes records once per tick. Records
 * are orphaned when their spec_hash either:
 *   (a) isn't in DEV.md at all (row removed), or
 *   (b) is in DEV.md with a terminal status (blocked / done / deleted /
 *       superseded) — reconcile can no longer reach them via the spawn or
 *       desiredBlocking iterations.
 *
 * Best-effort: read+writeback under the singleton-manager assumption (full
 * atomicity arrives with mgr106's lock). If the read or write throws, the
 * next tick retries.
 */
function garbageCollectCrashes(
  cacheDir: string,
  devRows: ReadonlyArray<{ hash: string; status: string }>,
): void {
  let cur;
  try {
    cur = readManagerState(cacheDir);
  } catch {
    return;
  }
  if (!cur.crashes || cur.crashes.length === 0) return;
  const liveHashes = new Set<string>();
  for (const row of devRows) {
    if (row.status === "ready" || row.status === "in-progress") {
      liveHashes.add(row.hash);
    }
  }
  const filtered = cur.crashes.filter((c) => liveHashes.has(c.spec_hash));
  if (filtered.length === cur.crashes.length) return;
  const next: ManagerState = { ...cur };
  if (filtered.length > 0) next.crashes = filtered;
  else delete next.crashes;
  try {
    writeManagerState(cacheDir, next);
  } catch {
    // best-effort
  }
}

function nextQuestionNumber(content: string): string {
  // Find every "Q#N" anywhere in the file — N is digits (string-stored per
  // InterviewQuestion schema in backlog/parse.ts). The naïve max+1 has a
  // collision case: if `Q#0` exists (or any prose happens to mention a
  // smaller-than-existing number), max+1 could land on a Q row that
  // already exists. EC-H8 fix: increment past any existing match.
  const re = /Q#(\d+)/g;
  const seen = new Set<number>();
  let max = 0;
  for (const m of content.matchAll(re)) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n)) continue;
    seen.add(n);
    if (n > max) max = n;
  }
  let candidate = max + 1;
  while (seen.has(candidate)) candidate += 1;
  return String(candidate);
}

function renderExitCode(code: number | string): string {
  if (typeof code === "number") return String(code);
  return code;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
