// Repo-state intake for `/devx-init` (ini501).
//
// Public surface:
//   - detectInitState(opts) — returns InitState describing the repo + every
//     signal the skip-table evaluator needs, plus any halt-and-confirm
//     prompts the orchestrator must surface before questions begin.
//
// Pure on the input side: every shell call goes through an injectable
// GitExec, every env lookup through an injectable env provider, every path
// is rooted at opts.repoRoot. Tests pass stubs; production wires the
// defaultGitExec / process.env / process.cwd().
//
// This module has *no* side effects on the host repo. It only reads.
// All write orchestration lives in ini502 (init-write.ts).
//
// Spec: dev/dev-ini501-2026-04-26T19:35-init-question-flow.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type RepoStateKind =
  | "empty" // no commits at HEAD
  | "existing" // commits present; no devx.config.yaml
  | "already-on-devx" // devx.config.yaml present with `devx_version` set
  | "corrupt-config"; // devx.config.yaml exists but `devx_version` missing

export type DetectedStack =
  | "typescript"
  | "flutter"
  | "rust"
  | "go"
  | "python"
  | "empty"
  | "mixed";

export type ProjectShape =
  | "empty-dream"
  | "bootstrapped-rewriting"
  | "mature-refactor-and-add"
  | "mature-yolo-rewrites"
  | "production-careful";

export type HaltKind =
  | "uncommitted-changes"
  | "non-default-branch"
  | "corrupt-config"
  | "mode-shape-conflict";

export interface HaltOption {
  key: string; // single-char hotkey
  label: string; // human-facing label
}

export interface HaltAndConfirm {
  kind: HaltKind;
  message: string;
  /** Options the user picks between. Empty for fatal halts (no resume). */
  options: ReadonlyArray<HaltOption>;
  /** When true, init must abort — no choice resumes the run. */
  fatal: boolean;
}

export interface InitState {
  repoRoot: string;
  kind: RepoStateKind;

  // Git surface
  hasCommits: boolean;
  hasUncommittedChanges: boolean;
  defaultBranch: string;
  currentBranch: string | null;
  isOnDefaultBranch: boolean;
  hasRemote: boolean;
  remoteUrl: string | null;
  developBranchExists: boolean;
  mainProtected: boolean;
  hasTags: boolean;
  multipleAuthorsLast90d: boolean;

  // devx-on-disk surface
  devxVersion: string | null;
  hasUserConfig: boolean;
  userConfigPath: string;

  // Skip-table inputs
  hasReadme: boolean;
  readmeFirstParagraph: string | null;
  personasPopulated: boolean;
  detectedStack: DetectedStack;
  detectedStackFile: string | null;
  hasProdEnvVars: boolean;
  hasGithubWorkflows: boolean;
  hasTests: boolean;

  // Inferred project shape (used by N6 when skip applies)
  inferredShape: ProjectShape | null;

  // Halts the orchestrator must clear before asking N1.
  halts: HaltAndConfirm[];
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GitExec = (args: readonly string[], cwd: string) => GitResult;

export interface DetectOpts {
  /** Defaults to process.cwd(). */
  repoRoot?: string;
  /** Injectable git CLI for testing. Defaults to a child_process wrapper. */
  git?: GitExec;
  /** Injectable env-var lookup. Defaults to process.env access. */
  env?: (key: string) => string | undefined;
  /** Override the user-config probe path (defaults per platform). */
  userConfigPath?: string;
  /** Override the gh CLI probe (defaults to a child_process wrapper). */
  ghProbe?: (defaultBranch: string, cwd: string) => boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Run `git ...` synchronously, swallowing non-zero exits into GitResult. */
export const defaultGitExec: GitExec = (args, cwd) => {
  try {
    const stdout = execFileSync("git", args as string[], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString("utf8") ?? ""),
      stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString("utf8") ?? ""),
    };
  }
};

/** ~/.devx/config.yaml on macOS; XDG-aware on Linux; %APPDATA% on Windows. */
export function defaultUserConfigPath(
  env: (k: string) => string | undefined = (k) => process.env[k],
): string {
  const home = homedir();
  const plat = platform();
  if (plat === "darwin") return join(home, ".devx", "config.yaml");
  if (plat === "win32") {
    const appdata = env("APPDATA");
    if (appdata) return join(appdata, "devx", "config.yaml");
    return join(home, ".devx", "config.yaml");
  }
  const xdg = env("XDG_CONFIG_HOME");
  if (xdg) return join(xdg, "devx", "config.yaml");
  return join(home, ".config", "devx", "config.yaml");
}

/** Probe gh for branch protection. Returns false on any failure (not authoritative). */
const defaultGhProbe = (defaultBranch: string, cwd: string): boolean => {
  try {
    execFileSync(
      "gh",
      ["api", `repos/{owner}/{repo}/branches/${defaultBranch}/protection`, "--silent"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

interface StackProbe {
  stack: Exclude<DetectedStack, "empty" | "mixed">;
  filename: string;
}

const STACK_PROBES: readonly StackProbe[] = [
  { stack: "typescript", filename: "package.json" },
  { stack: "flutter", filename: "pubspec.yaml" },
  { stack: "rust", filename: "Cargo.toml" },
  { stack: "go", filename: "go.mod" },
  { stack: "python", filename: "pyproject.toml" },
];

/** Common production-environment env-var signals. */
const PROD_ENV_KEYS: readonly string[] = [
  "DATABASE_URL",
  "SENTRY_DSN",
  "DD_API_KEY",
  "NEW_RELIC_LICENSE_KEY",
];

function readFirstParagraph(path: string): string | null {
  try {
    const raw = readFileSync(path, "utf8");
    const stripped = raw
      .split(/\r?\n/)
      .filter((line) => !line.startsWith("#") && !line.startsWith("<!--"))
      .join("\n")
      .trim();
    if (!stripped) return null;
    const firstBlank = stripped.indexOf("\n\n");
    return (firstBlank === -1 ? stripped : stripped.slice(0, firstBlank)).trim();
  } catch {
    return null;
  }
}

function dirHasEntries(path: string, predicate?: (name: string) => boolean): boolean {
  try {
    const names = readdirSync(path);
    const filtered = predicate ? names.filter(predicate) : names;
    return filtered.length > 0;
  } catch {
    return false;
  }
}

function dirIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function detectStack(repoRoot: string): { stack: DetectedStack; file: string | null } {
  const hits = STACK_PROBES.filter((probe) =>
    existsSync(join(repoRoot, probe.filename)),
  );
  if (hits.length === 0) return { stack: "empty", file: null };
  if (hits.length === 1) {
    const hit = hits[0];
    if (!hit) return { stack: "empty", file: null };
    return { stack: hit.stack, file: hit.filename };
  }
  return { stack: "mixed", file: hits.map((h) => h.filename).join(",") };
}

/** Look for any test directory or test-runner config. Conservative: false-negatives are OK. */
function detectTests(repoRoot: string): boolean {
  const candidates = [
    "test",
    "tests",
    "spec",
    "__tests__",
    "vitest.config.ts",
    "jest.config.js",
    "jest.config.ts",
    "pytest.ini",
    "tox.ini",
    "go.sum", // proxy for go test infra
  ];
  return candidates.some((c) => existsSync(join(repoRoot, c)));
}

/** Read `devx_version` (string scalar) from devx.config.yaml without a YAML parser. */
function readDevxVersion(configPath: string): { present: boolean; version: string | null } {
  if (!existsSync(configPath)) return { present: false, version: null };
  try {
    const raw = readFileSync(configPath, "utf8");
    // Match top-level `devx_version: <semver>`. Allow optional quoting.
    // Top-level = no leading whitespace.
    const match = raw.match(/^devx_version:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/m);
    if (match && match[1]) return { present: true, version: match[1] };
    return { present: true, version: null };
  } catch {
    return { present: true, version: null };
  }
}

// ---------------------------------------------------------------------------
// Halt-and-confirm constructors
// ---------------------------------------------------------------------------

function uncommittedHalt(): HaltAndConfirm {
  return {
    kind: "uncommitted-changes",
    message:
      "uncommitted changes detected — choose how to handle them before init proceeds",
    options: [
      { key: "s", label: "stash" },
      { key: "c", label: "commit-wip" },
      { key: "a", label: "abort" },
    ],
    fatal: false,
  };
}

function nonDefaultBranchHalt(current: string, defaultBranch: string): HaltAndConfirm {
  return {
    kind: "non-default-branch",
    message: `HEAD is on '${current}', not '${defaultBranch}' — switch before init proceeds`,
    options: [
      { key: "y", label: "switch" },
      { key: "n", label: "proceed-from-here" },
      { key: "a", label: "abort" },
    ],
    fatal: false,
  };
}

function corruptConfigHalt(): HaltAndConfirm {
  return {
    kind: "corrupt-config",
    message:
      "halt — devx.config.yaml is corrupt; manual review required",
    options: [],
    fatal: true,
  };
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function detectInitState(opts: DetectOpts = {}): InitState {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const git = opts.git ?? defaultGitExec;
  const env = opts.env ?? ((k) => process.env[k]);
  const userConfigPath =
    opts.userConfigPath ?? defaultUserConfigPath(env);

  // --- git surface ---------------------------------------------------------

  const headProbe = git(["rev-parse", "--verify", "HEAD"], repoRoot);
  const hasCommits = headProbe.exitCode === 0;

  const status = git(["status", "--porcelain"], repoRoot);
  // Empty repo: `git status --porcelain` succeeds but returns ""; treat as clean.
  const hasUncommittedChanges =
    status.exitCode === 0 && status.stdout.trim().length > 0;

  // Default branch: prefer origin/HEAD's symbolic-ref; fall back to init.defaultBranch
  // config; fall back to "main".
  let defaultBranch = "main";
  const symRef = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], repoRoot);
  if (symRef.exitCode === 0) {
    const ref = symRef.stdout.trim();
    const slash = ref.indexOf("/");
    defaultBranch = slash === -1 ? ref : ref.slice(slash + 1);
  } else {
    const cfg = git(["config", "--get", "init.defaultBranch"], repoRoot);
    if (cfg.exitCode === 0 && cfg.stdout.trim()) defaultBranch = cfg.stdout.trim();
  }

  const headRef = git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  const currentBranch =
    headRef.exitCode === 0 && headRef.stdout.trim() && headRef.stdout.trim() !== "HEAD"
      ? headRef.stdout.trim()
      : null;
  const isOnDefaultBranch = currentBranch === defaultBranch;

  const remote = git(["remote", "get-url", "origin"], repoRoot);
  const hasRemote = remote.exitCode === 0 && remote.stdout.trim().length > 0;
  const remoteUrl = hasRemote ? remote.stdout.trim() : null;

  const devel = git(["show-ref", "--verify", "--quiet", "refs/heads/develop"], repoRoot);
  const developBranchExists = devel.exitCode === 0;

  const tags = git(["tag", "--list"], repoRoot);
  const hasTags = tags.exitCode === 0 && tags.stdout.trim().length > 0;

  const shortlog = git(
    ["shortlog", "-sn", "--all", "--no-merges", "--since=90.days.ago"],
    repoRoot,
  );
  const distinctAuthors =
    shortlog.exitCode === 0
      ? shortlog.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0).length
      : 0;
  const multipleAuthorsLast90d = distinctAuthors > 1;

  // gh probe is opportunistic — only meaningful when remote + gh both available.
  const ghProbe = opts.ghProbe ?? defaultGhProbe;
  const mainProtected = hasRemote ? ghProbe(defaultBranch, repoRoot) : false;

  // --- devx-on-disk surface -----------------------------------------------

  const configPath = join(repoRoot, "devx.config.yaml");
  const versionRead = readDevxVersion(configPath);

  let kind: RepoStateKind;
  if (!hasCommits) {
    kind = "empty";
  } else if (!versionRead.present) {
    kind = "existing";
  } else if (versionRead.version === null) {
    kind = "corrupt-config";
  } else {
    kind = "already-on-devx";
  }

  const hasUserConfig = existsSync(userConfigPath);

  // --- skip-table signals --------------------------------------------------

  const readmePath = join(repoRoot, "README.md");
  const hasReadme = existsSync(readmePath);
  const readmeFirstParagraph = hasReadme ? readFirstParagraph(readmePath) : null;

  const personasPopulated =
    dirIsDirectory(join(repoRoot, "focus-group", "personas")) &&
    dirHasEntries(
      join(repoRoot, "focus-group", "personas"),
      (n) => n.endsWith(".md"),
    );

  const stack = detectStack(repoRoot);
  const detectedStack = stack.stack;
  const detectedStackFile = stack.file;

  const hasProdEnvVars = PROD_ENV_KEYS.some((k) => Boolean(env(k))) ||
    env("RAILS_ENV") === "production" ||
    env("NODE_ENV") === "production" ||
    env("ENVIRONMENT") === "production";

  const hasGithubWorkflows =
    dirIsDirectory(join(repoRoot, ".github", "workflows")) &&
    dirHasEntries(
      join(repoRoot, ".github", "workflows"),
      (n) => n.endsWith(".yml") || n.endsWith(".yaml"),
    );

  const hasTests = detectTests(repoRoot);

  let inferredShape: ProjectShape | null;
  if (!hasCommits) {
    inferredShape = "empty-dream";
  } else if (hasTests && hasTags) {
    inferredShape = "production-careful";
  } else {
    inferredShape = null; // ambiguous — N6 must ask
  }

  // --- halts ---------------------------------------------------------------

  const halts: HaltAndConfirm[] = [];
  if (kind === "corrupt-config") halts.push(corruptConfigHalt());
  if (hasUncommittedChanges) halts.push(uncommittedHalt());
  if (currentBranch !== null && !isOnDefaultBranch) {
    halts.push(nonDefaultBranchHalt(currentBranch, defaultBranch));
  }

  return {
    repoRoot,
    kind,
    hasCommits,
    hasUncommittedChanges,
    defaultBranch,
    currentBranch,
    isOnDefaultBranch,
    hasRemote,
    remoteUrl,
    developBranchExists,
    mainProtected,
    hasTags,
    multipleAuthorsLast90d,
    devxVersion: versionRead.version,
    hasUserConfig,
    userConfigPath,
    hasReadme,
    readmeFirstParagraph,
    personasPopulated,
    detectedStack,
    detectedStackFile,
    hasProdEnvVars,
    hasGithubWorkflows,
    hasTests,
    inferredShape,
    halts,
  };
}
