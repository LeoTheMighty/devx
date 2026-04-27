#!/usr/bin/env node
// Postinstall — verify `devx` resolves on PATH after `npm i -g @devx/cli`.
//
// Warn-only by contract: this script must NEVER throw and must always exit 0.
// A missing PATH entry is recoverable user advice, not an install failure.
// Local (non-global) installs are skipped because `devx` is not expected to
// be on PATH then — the check would print spurious advice on every dev
// `npm install`.
//
// Spec: dev/dev-cli304-2026-04-26T19:35-cli-version-postinstall.md
// Epic: _bmad-output/planning-artifacts/epic-cli-skeleton.md

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function isGlobalInstall() {
  // npm sets npm_config_global="true" for `-g`. Anything else (undefined,
  // empty string, "false") = local install. Tests override via env.
  return process.env.npm_config_global === "true";
}

function isWindows() {
  return process.platform === "win32";
}

function isWSL() {
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/sys/kernel/osrelease", "utf8");
    return /microsoft|wsl/i.test(release);
  } catch {
    return false;
  }
}

function detectedPlatform() {
  if (isWindows()) return "win32";
  if (isWSL()) return "wsl";
  if (process.platform === "darwin") return "darwin";
  return "linux";
}

function devxOnPath() {
  // POSIX: `command` is a shell builtin, so route through `sh -c`.
  // Windows: `where` is the equivalent — searches PATH and PATHEXT.
  const cmd = isWindows() ? "where" : "sh";
  const args = isWindows() ? ["devx"] : ["-c", "command -v devx"];
  const result = spawnSync(cmd, args, { stdio: "ignore" });
  return result.status === 0;
}

function adviceFor(platform) {
  switch (platform) {
    case "win32":
      return [
        "[devx] `devx` is not on PATH.",
        "  → Find npm's global bin dir:",
        "      npm config get prefix",
        "    Then add that directory to your user PATH via",
        "    System Properties → Environment Variables.",
      ].join("\n");
    case "wsl":
      return [
        "[devx] `devx` is not on PATH.",
        "  → If you ran `npm i -g` from PowerShell on the Windows host, the",
        "    binary landed in the Windows PATH, not WSL's. Re-run inside WSL:",
        "      npm i -g @devx/cli",
        '  → Otherwise, ensure `$(npm config get prefix)/bin` is on PATH',
        "    via ~/.bashrc or ~/.zshrc.",
      ].join("\n");
    case "darwin":
      return [
        "[devx] `devx` is not on PATH.",
        "  → Add npm's global bin to PATH:",
        '      export PATH="$(npm config get prefix)/bin:$PATH"',
        "    Append to ~/.zshrc (default shell on macOS) or ~/.bash_profile.",
      ].join("\n");
    default:
      return [
        "[devx] `devx` is not on PATH.",
        "  → Add npm's global bin to PATH:",
        '      export PATH="$(npm config get prefix)/bin:$PATH"',
        "    Append to ~/.bashrc or ~/.profile.",
      ].join("\n");
  }
}

function main() {
  if (!isGlobalInstall()) return;
  if (devxOnPath()) return;
  console.warn(adviceFor(detectedPlatform()));
}

try {
  main();
} catch {
  // Swallow. Postinstall is warn-only; failing `npm i -g` over a PATH probe
  // bug would be worse than a silent miss. The exit-0 below is reached
  // unconditionally.
}

process.exit(0);
