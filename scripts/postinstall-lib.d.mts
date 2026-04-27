// Type declarations for scripts/postinstall-lib.mjs.
// The lib is JS by design (runs from npm postinstall before TS build
// artifacts exist). This file exists only so vitest tests can import it
// under strict TS without `@ts-expect-error`.

export type Platform = "darwin" | "linux" | "win32" | string;

export type SpawnResult = {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

export type SpawnFn = (
  cmd: string,
  args: string[],
  opts?: unknown
) => SpawnResult;

export type ReadOsReleaseFn = () => string | null;

export function isWindows(platform?: Platform): boolean;
export function isWSL(
  platform?: Platform,
  readOsRelease?: ReadOsReleaseFn
): boolean;
export function detectedPlatform(
  platform?: Platform,
  readOsRelease?: ReadOsReleaseFn
): "darwin" | "linux" | "wsl" | "win32";
export function npmGlobalPrefix(spawn?: SpawnFn): string | null;
export function isWslPrefixOnWindowsHost(prefix: unknown): boolean;
export function devxOnPath(spawn?: SpawnFn, platform?: Platform): boolean;
export function adviceFor(
  platform: "darwin" | "linux" | "wsl" | "win32" | string
): string;
export function wslHostCrossoverAdvice(prefix: string): string;

export function runPostinstall(opts?: {
  global?: boolean;
  platform?: Platform;
  readOsRelease?: ReadOsReleaseFn;
  spawn?: SpawnFn;
  warn?: (msg: string) => void;
}): void;
