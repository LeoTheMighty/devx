// PID start-time probe — mgr106.
//
// Returns the absolute Date a given PID's process started, used by the
// manager-lock acquire path to detect PID-recycling: if the lock file holds
// pid=42 with acquired_at=T0 and pid 42's current process started at T1 > T0,
// the PID was reused between T0 and now, the original holder is gone, and
// the lock is stale. Without this cross-check, a sufficiently long-running
// project (or a quickly-restarting OS) can accumulate "phantom" lock files
// whose PID happens to be alive on a different program.
//
// Platform dispatch (per spec AC #7 — Infra-lens locked decision):
//   macOS (launchd):       `ps -o etime= -p <pid>`  — elapsed time since start
//   Linux (systemd):       `/proc/<pid>/stat` field 22 — starttime in clock
//                          ticks since boot, combined with `/proc/uptime`
//   WSL (task-scheduler):  `ps -o lstart= -p <pid>`  — absolute start date
//
// Native Windows (no WSL, no `ps`) lands in the task-scheduler branch too,
// but `ps` isn't on PATH; the probe returns null and the caller treats
// "can't determine" as conservative-skip (alive PID is alive; no recycle
// check). This mirrors the spec — WSL is the only Windows-family target
// listed.
//
// All probes return `Date | null`. `null` means we couldn't determine the
// start time; the caller MUST treat it as "skip the recycling cross-check"
// (do NOT clobber the lock).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { defaultDetectOs, type SupervisorPlatform } from "../supervisor.js";

export interface PidStartedAtOpts {
  /** Test seam — override OS dispatch. */
  platform?: SupervisorPlatform;
  /** Test seam — override `now()` for relative→absolute conversion (etime). */
  now?: () => Date;
  /** Test seam — replace child_process.spawnSync. */
  exec?: (cmd: string, args: string[]) => { stdout: string; status: number | null };
  /** Test seam — replace fs.readFileSync for /proc reads. */
  readFile?: (path: string) => string;
}

/**
 * Probe the absolute start time of `pid`. Returns `null` when:
 *   - pid is invalid (≤ 0, non-finite),
 *   - the platform probe fails (process gone, `ps` not on PATH, /proc absent),
 *   - the probe output is unparseable.
 *
 * The function is sync — child_process.spawnSync + readFileSync are both
 * blocking. The acquire path runs at most once per `devx manage` boot, so
 * the latency cost (one fork+exec on macOS, two file reads on Linux) is
 * trivial. Async would needlessly complicate the lock surface.
 */
export function probePidStartedAt(pid: number, opts: PidStartedAtOpts = {}): Date | null {
  if (typeof pid !== "number" || !Number.isFinite(pid) || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const platform = opts.platform ?? defaultDetectOs();
  const exec = opts.exec ?? defaultExec;
  const readFile = opts.readFile ?? defaultReadFile;
  const now = opts.now ?? (() => new Date());

  switch (platform) {
    case "launchd":
      return probeViaPsEtime(pid, exec, now);
    case "systemd":
      return probeViaProcStat(pid, readFile, now);
    case "task-scheduler":
      return probeViaPsLstart(pid, exec);
    default:
      return null;
  }
}

// ─── macOS (launchd) — `ps -o etime= -p <pid>` ──────────────────────────

function probeViaPsEtime(
  pid: number,
  exec: NonNullable<PidStartedAtOpts["exec"]>,
  now: () => Date,
): Date | null {
  // `etime=` (with the trailing `=`) suppresses the header. POSIX-portable
  // on both BSD ps (macOS) and GNU ps (Linux fallback); we only call it
  // here for macOS but the parser is intentionally permissive.
  const r = exec("ps", ["-o", "etime=", "-p", String(pid)]);
  if (r.status !== 0) return null;
  const elapsedSec = parseEtimeToSeconds(r.stdout.trim());
  if (elapsedSec === null) return null;
  return new Date(now().getTime() - elapsedSec * 1000);
}

/**
 * Parse the `etime` format `[[DD-]HH:]MM:SS` into seconds.
 * Examples:
 *   "12:34"           → 12*60 + 34            = 754
 *   "01:02:03"        → 1*3600 + 2*60 + 3     = 3723
 *   "5-12:34:56"      → 5*86400 + 12*3600 + … = 477296
 *   "" / "?" / "-"    → null (process gone between fork and parse)
 *
 * Each component is validated with a strict `^\d+$` regex BEFORE parsing —
 * `Number.parseInt` is lax (accepts "5e2" as 5, "12abc" as 12, leading
 * whitespace), and a permissive parse on garbage `ps` output would yield
 * silently-wrong elapsed values. BH-H5 fix.
 */
export function parseEtimeToSeconds(s: string): number | null {
  if (!s || s === "?" || s === "-") return null;
  const DIGITS_RE = /^\d+$/;
  const dayMatch = /^(\d+)-(.+)$/.exec(s);
  let days = 0;
  let rest = s;
  if (dayMatch) {
    if (!DIGITS_RE.test(dayMatch[1])) return null;
    days = Number.parseInt(dayMatch[1], 10);
    rest = dayMatch[2];
  }
  const rawParts = rest.split(":");
  if (rawParts.length < 2 || rawParts.length > 3) return null;
  for (const p of rawParts) {
    if (!DIGITS_RE.test(p)) return null;
  }
  const parts = rawParts.map((p) => Number.parseInt(p, 10));
  let hours = 0,
    minutes = 0,
    seconds = 0;
  if (parts.length === 2) {
    [minutes, seconds] = parts;
  } else {
    [hours, minutes, seconds] = parts;
  }
  if (!Number.isFinite(days) || days < 0) return null;
  if (hours < 0 || minutes < 0 || seconds < 0) return null;
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

// ─── Linux (systemd) — `/proc/<pid>/stat` + `/proc/uptime` ──────────────

function probeViaProcStat(
  pid: number,
  readFile: NonNullable<PidStartedAtOpts["readFile"]>,
  now: () => Date,
): Date | null {
  let statContent: string;
  let uptimeContent: string;
  try {
    statContent = readFile(`/proc/${pid}/stat`);
  } catch {
    return null;
  }
  try {
    uptimeContent = readFile("/proc/uptime");
  } catch {
    return null;
  }

  const starttimeTicks = parseProcStatStarttime(statContent);
  if (starttimeTicks === null) return null;
  const uptimeSec = parseProcUptime(uptimeContent);
  if (uptimeSec === null) return null;

  // CLK_TCK is virtually always 100 on Linux (USER_HZ=100 across x86,
  // x86_64, arm64, riscv default kernels). Hardcoding avoids shelling out
  // to `getconf CLK_TCK` on every probe. If a custom kernel sets a
  // different value, the recycling cross-check skews by ≤ 1% (a 100ms
  // clock-tick instead of 10ms maps to a process appearing 10× younger);
  // false-positives stay benign because the cross-check only triggers on
  // PIDs whose start-time post-dates acquired_at by SECONDS, not ticks.
  const CLK_TCK = 100;
  const elapsedSinceStartSec = uptimeSec - starttimeTicks / CLK_TCK;
  if (!Number.isFinite(elapsedSinceStartSec) || elapsedSinceStartSec < 0) {
    return null;
  }
  return new Date(now().getTime() - elapsedSinceStartSec * 1000);
}

/**
 * Parse field 22 (starttime, in clock ticks since boot) from the contents
 * of `/proc/<pid>/stat`. The format is:
 *
 *   <pid> (<comm>) <state> <ppid> <pgrp> ... <starttime> ...
 *
 * `comm` can contain spaces and parentheses, so the canonical parse is:
 * find the LAST `)` and split the remainder on whitespace. After the comm,
 * field positions are: state=1, ppid=2, ..., starttime=20.
 */
export function parseProcStatStarttime(content: string): number | null {
  const lastParen = content.lastIndexOf(")");
  if (lastParen < 0) return null;
  const after = content.slice(lastParen + 1).trim();
  const fields = after.split(/\s+/);
  // post-comm field 20 = starttime (1-indexed). Array index = 19.
  if (fields.length < 20) return null;
  const ticks = Number.parseInt(fields[19], 10);
  if (!Number.isFinite(ticks) || ticks < 0) return null;
  return ticks;
}

/** Parse `/proc/uptime` — first column is system uptime in seconds. */
export function parseProcUptime(content: string): number | null {
  const first = content.trim().split(/\s+/)[0];
  if (!first) return null;
  const sec = Number.parseFloat(first);
  if (!Number.isFinite(sec) || sec < 0) return null;
  return sec;
}

// ─── WSL / native-Windows (task-scheduler) — `ps -o lstart= -p <pid>` ──

function probeViaPsLstart(
  pid: number,
  exec: NonNullable<PidStartedAtOpts["exec"]>,
): Date | null {
  const r = exec("ps", ["-o", "lstart=", "-p", String(pid)]);
  if (r.status !== 0) return null;
  const out = r.stdout.trim();
  if (!out || out === "?") return null;
  // lstart format example: "Wed May  7 12:34:56 2026"
  const d = new Date(out);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// ─── Defaults ───────────────────────────────────────────────────────────

function defaultExec(cmd: string, args: string[]): { stdout: string; status: number | null } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  // spawnSync returns null status on signal; treat as failure.
  return { stdout: r.stdout ?? "", status: r.status ?? null };
}

function defaultReadFile(path: string): string {
  return readFileSync(path, "utf8");
}
