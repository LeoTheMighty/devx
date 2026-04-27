// Postinstall logic — exported as pure functions for testability.
//
// scripts/postinstall.js is a thin wrapper that calls runPostinstall() and
// swallows all errors (warn-only contract from cli304). All branching logic
// lives here so unit tests can drive it with synthetic platform/env inputs
// instead of spawning a real Node process.
//
// Spec: dev/dev-cli305-2026-04-26T19:35-cli-cross-platform-install.md
// Builds on: cli304's postinstall PATH verification.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function isWindows(platform = process.platform) {
  return platform === "win32";
}

function defaultReadOsRelease() {
  try {
    return readFileSync("/proc/sys/kernel/osrelease", "utf8");
  } catch {
    return null;
  }
}

// AC#4: WSL detection short-circuits cleanly when not Linux — zero overhead.
// process.platform check happens before any filesystem read.
export function isWSL(platform = process.platform, readOsRelease = defaultReadOsRelease) {
  if (platform !== "linux") return false;
  const release = readOsRelease();
  if (release == null) return false;
  return /microsoft|wsl/i.test(release);
}

export function detectedPlatform(platform = process.platform, readOsRelease = defaultReadOsRelease) {
  if (isWindows(platform)) return "win32";
  if (isWSL(platform, readOsRelease)) return "wsl";
  if (platform === "darwin") return "darwin";
  return "linux";
}

export function npmGlobalPrefix(spawn = spawnSync) {
  const result = spawn("npm", ["config", "get", "prefix"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error) return null;
  if (result.status !== 0) return null;
  return (result.stdout ?? "").trim() || null;
}

// AC#2 (second half): "npm config get prefix matching /mnt/c/" — match any
// Windows-mounted volume under /mnt/<letter>/, not just C:. Users with multi-
// drive setups still hit the host-crossover trap from D: or beyond.
export function isWslPrefixOnWindowsHost(prefix) {
  return typeof prefix === "string" && /^\/mnt\/[a-z]\//i.test(prefix);
}

export function devxOnPath(spawn = spawnSync, platform = process.platform) {
  const win = isWindows(platform);
  const cmd = win ? "where" : "sh";
  const args = win ? ["devx"] : ["-c", "command -v devx"];
  const result = spawn(cmd, args, { stdio: "ignore" });
  return result.status === 0;
}

export function adviceFor(platform) {
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

export function wslHostCrossoverAdvice(prefix) {
  return [
    `[devx] npm global prefix is on the Windows host (${prefix}).`,
    "  → `npm i -g` from this shell installs binaries into the Windows PATH,",
    "    not WSL's. Recommended fix:",
    "      npm config set prefix ~/.npm-global",
    '      export PATH="$HOME/.npm-global/bin:$PATH"',
    "    Append the export to ~/.bashrc or ~/.zshrc, then re-run `npm i -g`.",
  ].join("\n");
}

// Main entry — pure inputs, single side-effect (warn callback). The wrapper
// script supplies real process.env, real spawnSync, real fs reads.
export function runPostinstall({
  global = process.env.npm_config_global === "true",
  platform = process.platform,
  readOsRelease = defaultReadOsRelease,
  spawn = spawnSync,
  warn = (msg) => console.warn(msg),
} = {}) {
  if (!global) return;

  const detected = detectedPlatform(platform, readOsRelease);

  // AC#2: WSL host-crossover warning — independent of whether `devx` is on
  // PATH. Even if devx resolves (because user added /mnt/c/.../npm to WSL
  // PATH), the cross-filesystem npm install is a foot-gun: slow, breaks on
  // file-permission boundaries, and silently desyncs from `npm i -g` runs
  // inside Linux-side prefixes.
  if (detected === "wsl") {
    const prefix = npmGlobalPrefix(spawn);
    if (isWslPrefixOnWindowsHost(prefix)) {
      warn(wslHostCrossoverAdvice(prefix));
    }
  }

  if (devxOnPath(spawn, platform)) return;
  warn(adviceFor(detected));
}
