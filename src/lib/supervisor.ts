// Supervisor installer — Phase 0 (sup401).
//
// Ships the placeholder stub script (`_devx/templates/supervisor-stub.sh`)
// to `~/.devx/bin/devx-supervisor-stub.sh` and tracks installation state at
// `~/.devx/state/supervisor.installed.json`. Idempotent: re-installs detect
// matching content via SHA-256 hash and short-circuit.
//
// Phase 0 is the stub-only piece. sup402–sup405 add the platform-specific
// unit-file generators (launchd / systemd / Task Scheduler) on top of this
// state file. Phase 10's `devx eject` will call `uninstallStub`.
//
// Spec: dev/dev-sup401-2026-04-26T19:35-supervisor-stub-script.md
// Epic: _bmad-output/planning-artifacts/epic-os-supervisor-scaffold.md

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

export type InstallResult = "fresh" | "kept" | "rewritten";
export type UninstallResult = "removed" | "absent";

export interface InstallStubOpts {
  /** Override `~/.devx/`. Defaults to `os.homedir() + "/.devx"`. Tests pass a tmpdir. */
  devxHome?: string;
  /** Override the source template directory. Defaults to the package's `_devx/templates/`. */
  templateDir?: string;
}

interface StubStateRecord {
  hash: string;
  version: string;
  installed_at: string;
}

interface SupervisorStateFile {
  stub?: StubStateRecord;
  // sup402+: per-role unit-file records (manager, concierge, ...) live here.
  [k: string]: unknown;
}

const STUB_FILENAME = "devx-supervisor-stub.sh";
const STATE_FILENAME = "supervisor.installed.json";
const TEMPLATE_FILENAME = "supervisor-stub.sh";

function defaultDevxHome(): string {
  return join(homedir(), ".devx");
}

function defaultTemplateDir(): string {
  // src/lib/supervisor.ts → ../../_devx/templates (works from src under
  // tsx/vitest AND from dist/lib/supervisor.js after build, since the package
  // ships `_devx/templates/` and `dist/` side-by-side).
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "_devx", "templates");
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function readStateFile(stateFile: string): SupervisorStateFile {
  if (!existsSync(stateFile)) return {};
  try {
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as SupervisorStateFile;
    return {};
  } catch {
    // Corrupt state file: treat as fresh install rather than throwing. The
    // hash-rewrite will re-establish a valid record. Logging this would be
    // ideal but we don't have a logger plumbed yet (Phase 0).
    return {};
  }
}

function writeAtomic(targetPath: string, contents: Buffer | string, mode?: number): void {
  mkdirSync(dirname(targetPath), { recursive: true });
  // .tmp.<pid>.<rand> avoids collisions when two processes race. Same FS as
  // target so renameSync is atomic on POSIX.
  const tmp = `${targetPath}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
  try {
    writeFileSync(tmp, contents);
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, targetPath);
  } catch (err) {
    // Best-effort cleanup of the tmp file if rename failed.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

function readPackageVersion(): string {
  // package.json sits at the repo root, two levels above this file in src/
  // (and two levels above dist/lib/ after build). Same resolution logic as
  // defaultTemplateDir.
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

/** Install the supervisor stub script and update the state file. Idempotent. */
export function installStub(opts: InstallStubOpts = {}): InstallResult {
  const devxHome = opts.devxHome ?? defaultDevxHome();
  const templateDir = opts.templateDir ?? defaultTemplateDir();

  const templatePath = join(templateDir, TEMPLATE_FILENAME);
  const targetPath = join(devxHome, "bin", STUB_FILENAME);
  const stateFile = join(devxHome, "state", STATE_FILENAME);

  const templateBytes = readFileSync(templatePath);
  const newHash = sha256(templateBytes);

  const state = readStateFile(stateFile);
  const prior = state.stub;

  // Same hash AND target file present → no-op. The state record alone isn't
  // enough; the binary may have been deleted out from under us.
  if (prior && prior.hash === newHash && existsSync(targetPath)) {
    return "kept";
  }

  // Atomic write of the script with executable mode.
  writeAtomic(targetPath, templateBytes, 0o755);

  const next: SupervisorStateFile = {
    ...state,
    stub: {
      hash: newHash,
      version: readPackageVersion(),
      installed_at: new Date().toISOString(),
    },
  };
  writeAtomic(stateFile, JSON.stringify(next, null, 2) + "\n");

  if (!prior) return "fresh";
  if (prior.hash !== newHash) return "rewritten";
  // prior.hash === newHash but target was missing — counts as rewrite of the
  // binary even though state was preserved.
  return "rewritten";
}

/** Remove the supervisor stub script and clear its state record. Phase 10 eject path. */
export function uninstallStub(opts: InstallStubOpts = {}): UninstallResult {
  const devxHome = opts.devxHome ?? defaultDevxHome();
  const targetPath = join(devxHome, "bin", STUB_FILENAME);
  const stateFile = join(devxHome, "state", STATE_FILENAME);

  const state = readStateFile(stateFile);
  const targetExists = existsSync(targetPath);
  const stubKnown = state.stub !== undefined;

  if (!targetExists && !stubKnown) return "absent";

  if (targetExists) {
    try {
      rmSync(targetPath, { force: true });
    } catch {
      // Same warn-only philosophy as the postinstall script: missing
      // permissions on uninstall shouldn't crash. The state-file rewrite
      // below still proceeds.
    }
  }

  if (stubKnown) {
    const next = { ...state };
    delete next.stub;
    if (Object.keys(next).length === 0) {
      // No other supervisor records → drop the state file entirely so
      // `~/.devx/` looks pristine post-eject.
      try {
        rmSync(stateFile, { force: true });
      } catch {
        // ignore
      }
    } else {
      writeAtomic(stateFile, JSON.stringify(next, null, 2) + "\n");
    }
  }

  return "removed";
}
