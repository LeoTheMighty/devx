// Shared fixture builder for the multi-loop-concurrency RED evals.
// Not a Verified-by target — imported by E-*.ts scripts.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
export const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
export const cliPath = join(repoRoot, "src", "cli.ts");

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "eval",
  GIT_AUTHOR_EMAIL: "eval@example.com",
  GIT_COMMITTER_NAME: "eval",
  GIT_COMMITTER_EMAIL: "eval@example.com",
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
}

export function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): CliResult {
  try {
    const stdout = execFileSync(tsxBin, [cliPath, ...args], {
      cwd,
      env: { ...GIT_ENV, ...env },
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      status: e.status ?? -1,
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
    };
  }
}

export interface FixtureOpts {
  prefix: string;
  /** ready dev items: [hash, slug][] */
  items?: Array<[string, string]>;
  /** create a local bare origin and push main */
  withOrigin?: boolean;
  /** add a linked worktree at .worktrees/dev-wt0001 */
  withLinkedWorktree?: boolean;
}

export interface Fixture {
  root: string;
  originDir: string | null;
  worktreeDir: string | null;
  specPathFor(hash: string): string;
}

const TS = "2026-07-28T08:00";

export function mkRepoFixture(opts: FixtureOpts): Fixture {
  const root = mkdtempSync(join(tmpdir(), `${opts.prefix}-`));
  git(root, "init", "-b", "main");
  copyFileSync(
    join(repoRoot, "devx.config.yaml"),
    join(root, "devx.config.yaml"),
  );
  mkdirSync(join(root, "dev"), { recursive: true });
  const items = opts.items ?? [];
  const rows = items
    .map(
      ([hash, slug]) =>
        `- [ ] \`dev/dev-${hash}-${TS}-${slug}.md\` — Fixture item ${hash}. Status: ready.`,
    )
    .join("\n");
  writeFileSync(join(root, "DEV.md"), `# DEV\n\n${rows}\n`);
  writeFileSync(join(root, "DEBUG.md"), "# DEBUG\n");
  writeFileSync(join(root, "INTERVIEW.md"), "# INTERVIEW\n");
  writeFileSync(join(root, "MANUAL.md"), "# MANUAL\n");
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n.worktrees/\n");
  for (const [hash, slug] of items) {
    writeFileSync(
      join(root, "dev", `dev-${hash}-${TS}-${slug}.md`),
      [
        "---",
        `hash: ${hash}`,
        "type: dev",
        `created: ${TS}:00-06:00`,
        `title: "Fixture item ${hash}"`,
        "status: ready",
        "branch: null",
        "---",
        "",
        "## Goal",
        "",
        `Fixture goal for ${hash}.`,
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1: exists.",
        "",
        "## Status log",
        "",
        `- ${TS} — filed (fixture).`,
        "",
      ].join("\n"),
    );
  }
  git(root, "add", "-A");
  git(root, "commit", "-m", "fixture: init", "--no-gpg-sign");

  let originDir: string | null = null;
  if (opts.withOrigin) {
    originDir = mkdtempSync(join(tmpdir(), `${opts.prefix}-origin-`));
    git(originDir, "init", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", originDir);
    git(root, "push", "origin", "main");
  }

  let worktreeDir: string | null = null;
  if (opts.withLinkedWorktree) {
    worktreeDir = join(root, ".worktrees", "dev-wt0001");
    mkdirSync(join(root, ".worktrees"), { recursive: true });
    git(root, "worktree", "add", worktreeDir, "-b", "feat/dev-wt0001", "main");
  }

  return {
    root,
    originDir,
    worktreeDir,
    specPathFor: (hash: string) => {
      const item = items.find(([h]) => h === hash);
      return join(root, "dev", `dev-${hash}-${TS}-${item?.[1] ?? "x"}.md`);
    },
  };
}
