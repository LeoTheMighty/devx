// Postinstall lib tests (cli305).
//
// Drives scripts/postinstall-lib.mjs directly with synthetic platform/env
// inputs — no subprocess spawn — so we can simulate WSL on a macOS CI
// runner without lying to the OS. The end-to-end spawn tests in
// postinstall.test.ts (cli304) still cover the wrapper behavior on the host.
//
// Spec: dev/dev-cli305-2026-04-26T19:35-cli-cross-platform-install.md

import { describe, expect, it } from "vitest";
import {
  adviceFor,
  detectedPlatform,
  isWindows,
  isWSL,
  isWslPrefixOnWindowsHost,
  npmGlobalPrefix,
  runPostinstall,
  wslHostCrossoverAdvice,
  type SpawnFn,
  type SpawnResult,
} from "../scripts/postinstall-lib.mjs";

const fakeSpawn = (
  impl: (cmd: string, args: string[]) => SpawnResult
): SpawnFn => {
  return (cmd, args) => impl(cmd, args);
};

describe("cli305 — platform detection", () => {
  it("isWindows true only on win32", () => {
    expect(isWindows("win32")).toBe(true);
    expect(isWindows("darwin")).toBe(false);
    expect(isWindows("linux")).toBe(false);
  });

  it("isWSL short-circuits on non-Linux without reading the filesystem", () => {
    let readCount = 0;
    const reader = () => {
      readCount += 1;
      return "Microsoft";
    };
    expect(isWSL("darwin", reader)).toBe(false);
    expect(isWSL("win32", reader)).toBe(false);
    expect(readCount).toBe(0); // AC#4: zero overhead off-Linux
  });

  it("isWSL true when osrelease contains 'microsoft' (case-insensitive)", () => {
    expect(isWSL("linux", () => "5.15.146.1-microsoft-standard-WSL2\n")).toBe(true);
    expect(isWSL("linux", () => "5.15.0-microsoft\n")).toBe(true);
    expect(isWSL("linux", () => "WSL2\n")).toBe(true);
  });

  it("isWSL false on regular Linux kernel strings", () => {
    expect(isWSL("linux", () => "6.5.0-1014-aws\n")).toBe(false);
    expect(isWSL("linux", () => "5.15.0-105-generic\n")).toBe(false);
  });

  it("isWSL false when osrelease cannot be read", () => {
    expect(isWSL("linux", () => null)).toBe(false);
  });

  it("detectedPlatform routes correctly", () => {
    expect(detectedPlatform("win32")).toBe("win32");
    expect(detectedPlatform("darwin")).toBe("darwin");
    expect(detectedPlatform("linux", () => "Microsoft")).toBe("wsl");
    expect(detectedPlatform("linux", () => "generic")).toBe("linux");
  });
});

describe("cli305 — WSL host-crossover prefix detection", () => {
  it("matches /mnt/c/ paths (case-insensitive on the drive letter)", () => {
    expect(isWslPrefixOnWindowsHost("/mnt/c/Users/leo/AppData/Roaming/npm")).toBe(true);
    expect(isWslPrefixOnWindowsHost("/mnt/d/dev/npm")).toBe(true);
    expect(isWslPrefixOnWindowsHost("/mnt/C/Users/leo")).toBe(true);
  });

  it("does not match Linux-side prefixes", () => {
    expect(isWslPrefixOnWindowsHost("/home/leo/.npm-global")).toBe(false);
    expect(isWslPrefixOnWindowsHost("/usr/local")).toBe(false);
    expect(isWslPrefixOnWindowsHost("/mnt/wsl/something")).toBe(false); // not a single-letter mount
  });

  it("handles non-string and empty inputs without throwing", () => {
    expect(isWslPrefixOnWindowsHost(null)).toBe(false);
    expect(isWslPrefixOnWindowsHost(undefined)).toBe(false);
    expect(isWslPrefixOnWindowsHost("")).toBe(false);
    expect(isWslPrefixOnWindowsHost(42)).toBe(false);
  });

  it("wslHostCrossoverAdvice includes the recommended npm config command", () => {
    const msg = wslHostCrossoverAdvice("/mnt/c/Users/leo/AppData/Roaming/npm");
    expect(msg).toContain("npm config set prefix ~/.npm-global");
    expect(msg).toContain('export PATH="$HOME/.npm-global/bin:$PATH"');
    expect(msg).toContain("/mnt/c/Users/leo/AppData/Roaming/npm");
  });
});

describe("cli305 — npmGlobalPrefix", () => {
  it("returns trimmed stdout on success", () => {
    const spawn = fakeSpawn(() => ({ status: 0, stdout: "/home/leo/.npm-global\n" }));
    expect(npmGlobalPrefix(spawn)).toBe("/home/leo/.npm-global");
  });

  it("returns null on non-zero exit", () => {
    const spawn = fakeSpawn(() => ({ status: 1, stdout: "" }));
    expect(npmGlobalPrefix(spawn)).toBe(null);
  });

  it("returns null when spawn fails entirely (npm not on PATH)", () => {
    const spawn = fakeSpawn(() => ({ status: null, error: new Error("ENOENT") }));
    expect(npmGlobalPrefix(spawn)).toBe(null);
  });

  it("returns null on empty stdout", () => {
    const spawn = fakeSpawn(() => ({ status: 0, stdout: "\n" }));
    expect(npmGlobalPrefix(spawn)).toBe(null);
  });
});

describe("cli305 — runPostinstall (warn dispatch)", () => {
  it("does nothing when not a global install", () => {
    const warns: string[] = [];
    runPostinstall({
      global: false,
      platform: "linux",
      readOsRelease: () => "Microsoft",
      spawn: fakeSpawn(() => ({ status: 0, stdout: "/mnt/c/foo\n" })),
      warn: (m: string) => warns.push(m),
    });
    expect(warns).toEqual([]);
  });

  it("WSL + prefix on /mnt/c → warns even if devx is on PATH", () => {
    const warns: string[] = [];
    runPostinstall({
      global: true,
      platform: "linux",
      readOsRelease: () => "5.15-microsoft",
      spawn: fakeSpawn((cmd, args) => {
        if (cmd === "npm" && args[0] === "config") {
          return { status: 0, stdout: "/mnt/c/Users/leo/AppData/Roaming/npm\n" };
        }
        // sh -c 'command -v devx' → success (devx IS on PATH).
        return { status: 0 };
      }),
      warn: (m: string) => warns.push(m),
    });
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("npm global prefix is on the Windows host");
    expect(warns[0]).toContain("npm config set prefix ~/.npm-global");
  });

  it("WSL + prefix on /mnt/c + devx NOT on PATH → both warnings fire", () => {
    const warns: string[] = [];
    runPostinstall({
      global: true,
      platform: "linux",
      readOsRelease: () => "5.15-microsoft",
      spawn: fakeSpawn((cmd, args) => {
        if (cmd === "npm" && args[0] === "config") {
          return { status: 0, stdout: "/mnt/c/foo\n" };
        }
        return { status: 1 }; // command -v devx → not found
      }),
      warn: (m: string) => warns.push(m),
    });
    expect(warns.length).toBe(2);
    expect(warns[0]).toContain("Windows host");
    expect(warns[1]).toContain("`devx` is not on PATH");
  });

  it("WSL + Linux-side prefix → no host-crossover warning", () => {
    const warns: string[] = [];
    runPostinstall({
      global: true,
      platform: "linux",
      readOsRelease: () => "5.15-microsoft",
      spawn: fakeSpawn((cmd, args) => {
        if (cmd === "npm" && args[0] === "config") {
          return { status: 0, stdout: "/home/leo/.npm-global\n" };
        }
        return { status: 0 }; // devx on PATH
      }),
      warn: (m: string) => warns.push(m),
    });
    expect(warns).toEqual([]);
  });

  it("WSL + npm-not-found (prefix probe fails) → no host-crossover warning, falls through to PATH check", () => {
    const warns: string[] = [];
    runPostinstall({
      global: true,
      platform: "linux",
      readOsRelease: () => "5.15-microsoft",
      spawn: fakeSpawn((cmd) => {
        if (cmd === "npm") {
          // Simulate npm being unreachable on PATH.
          return { status: null, error: new Error("ENOENT") };
        }
        return { status: 1 }; // devx not on PATH either
      }),
      warn: (m: string) => warns.push(m),
    });
    // Only the PATH-not-found advice fires; host-crossover is skipped because
    // we couldn't determine the prefix.
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("`devx` is not on PATH");
  });

  it("non-WSL Linux → never reads npm prefix", () => {
    let npmCalls = 0;
    const warns: string[] = [];
    runPostinstall({
      global: true,
      platform: "linux",
      readOsRelease: () => "6.5.0-generic",
      spawn: fakeSpawn((cmd) => {
        if (cmd === "npm") npmCalls += 1;
        return { status: 0 };
      }),
      warn: (m: string) => warns.push(m),
    });
    expect(npmCalls).toBe(0);
    expect(warns).toEqual([]);
  });

  it("macOS + devx not on PATH → darwin advice", () => {
    const warns: string[] = [];
    runPostinstall({
      global: true,
      platform: "darwin",
      spawn: fakeSpawn(() => ({ status: 1 })),
      warn: (m: string) => warns.push(m),
    });
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("zshrc");
  });
});

describe("cli305 — adviceFor still exposes pre-cli305 messages", () => {
  it("darwin advice unchanged in shape", () => {
    expect(adviceFor("darwin")).toContain("zshrc");
  });
  it("linux advice unchanged in shape", () => {
    expect(adviceFor("linux")).toContain("bashrc");
  });
  it("wsl advice unchanged in shape", () => {
    expect(adviceFor("wsl")).toContain("Windows host");
  });
  it("win32 advice unchanged in shape", () => {
    expect(adviceFor("win32")).toContain("Environment Variables");
  });
});
