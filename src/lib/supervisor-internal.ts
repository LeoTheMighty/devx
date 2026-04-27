// Internal helpers shared by supervisor.ts (sup401) and the platform-specific
// installers (sup402 launchd, sup403 systemd, sup404 task-scheduler).
//
// Not part of the public CLI surface — tests may import for setup/assertion
// but consumers should use src/lib/supervisor.ts.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export const STATE_FILENAME = "supervisor.installed.json";

/** State record keyed by `stub` (sup401) or by role name (`manager`, `concierge`) for sup402+. */
export interface StateRecord {
  /** "launchd" | "systemd" | "task-scheduler" for role records; absent for `stub`. */
  platform?: string;
  hash: string;
  version: string;
  installed_at: string;
}

export interface SupervisorStateFile {
  stub?: StateRecord;
  manager?: StateRecord;
  concierge?: StateRecord;
  [k: string]: unknown;
}

export function defaultDevxHome(): string {
  return join(homedir(), ".devx");
}

export function defaultTemplateDir(): string {
  // src/lib/supervisor-internal.ts → ../../_devx/templates
  // Same path mapping after build (dist/lib/ → ../../_devx/templates).
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "_devx", "templates");
}

export function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(here, "..", "..", "package.json");
  try {
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function readStateFile(stateFile: string): SupervisorStateFile {
  if (!existsSync(stateFile)) return {};
  try {
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as SupervisorStateFile;
    return {};
  } catch {
    // Corrupt state file → treat as fresh. Hash-rewrite re-establishes a
    // valid record (matches sup401's recovery semantics).
    return {};
  }
}

export function writeStateFile(stateFile: string, state: SupervisorStateFile): void {
  writeAtomic(stateFile, JSON.stringify(state, null, 2) + "\n");
}

/** Atomic file write: tmp + rename. Optional mode applies to the resulting file. */
export function writeAtomic(targetPath: string, contents: Buffer | string, mode?: number): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  try {
    writeFileSync(tmp, contents);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, targetPath);
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
