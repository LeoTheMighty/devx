// Shared fixture builder for the story-graph RED evals.
// Not a Verified-by target — imported by E-*.ts scripts.
//
// Follows the multi-loop-concurrency `_fixture.ts` precedent: tsx resolved
// via Node's module walk (worktree-safe), git identity pinned, fixtures in
// mkdtemp dirs cleaned by each eval's finally block.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
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
const tsxCliEntry = createRequire(import.meta.url).resolve("tsx/cli");
export const nodeBin = process.execPath;
export const tsxArgs = [tsxCliEntry];
export const cliPath = join(repoRoot, "src", "cli.ts");
export const distCliPath = join(repoRoot, "dist", "cli.js");

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

function runNode(
  entryArgs: string[],
  cwd: string,
  env: Record<string, string> = {},
): CliResult {
  try {
    const stdout = execFileSync(nodeBin, entryArgs, {
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

/** Run the source CLI (tsx src/cli.ts) — the default for fixture legs. */
export function runCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): CliResult {
  return runNode([...tsxArgs, cliPath, ...args], cwd, env);
}

/**
 * Run the built CLI (dist/cli.js) — the live-repo/downstream legs (E-1,
 * E-7). Builds dist when missing so a fresh checkout REDs for the feature
 * reason, not "run `npm run build` first" (the stale-dist false-red class).
 * A stale-but-present dist is the operator's to refresh before gating.
 */
export function runBuiltCli(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): CliResult {
  if (!existsSync(distCliPath)) {
    execFileSync("npm", ["run", "build"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return runNode([distCliPath, ...args], cwd, env);
}

export const TS = "2026-08-01T08:00";

export interface SpecOpts {
  type: "dev" | "debug" | "plan" | "test";
  hash: string;
  slug: string;
  title: string;
  status: string;
  /** Extra raw frontmatter lines, verbatim (e.g. "blocked_by: [aaa111]",
   *  the hyphenated "blocked-by: [x]" drift shape, "spawned: [y]",
   *  "phase: 2", "plan: _devx/workstreams/<slug>"). */
  fm?: string[];
  body?: string;
}

export interface Fixture {
  root: string;
  originDir: string | null;
  /** Write a spec file; returns its repo-relative path. */
  writeSpec(opts: SpecOpts): string;
  /** Write any repo-relative file (parent dirs created). */
  write(rel: string, content: string): void;
  read(rel: string): string;
  exists(rel: string): boolean;
  commitAll(msg: string): void;
}

export function specRel(type: string, hash: string, slug: string): string {
  return `${type}/${type}-${hash}-${TS}-${slug}.md`;
}

/** A canonical backlog row. `annotations` renders between title and Status
 *  (e.g. "Blocked-by: aaa222.", "Parallel-safe with aaa222."). */
export function row(
  state: " " | "/" | "-" | "x",
  type: string,
  hash: string,
  slug: string,
  title: string,
  status: string,
  annotations: string[] = [],
): string {
  const ann = annotations.length > 0 ? ` ${annotations.join(" ")}` : "";
  return `- [${state}] \`${specRel(type, hash, slug)}\` — ${title}.${ann} Status: ${status}.`;
}

export interface FxOpts {
  prefix: string;
  /** create a local bare origin and push main (claim needs one) */
  withOrigin?: boolean;
}

export function mkFx(opts: FxOpts): Fixture {
  const root = mkdtempSync(join(tmpdir(), `${opts.prefix}-`));
  git(root, "init", "-b", "main");
  copyFileSync(
    join(repoRoot, "devx.config.yaml"),
    join(root, "devx.config.yaml"),
  );
  for (const f of ["DEV.md", "PLAN.md", "TEST.md", "DEBUG.md"]) {
    writeFileSync(join(root, f), `# ${f.replace(".md", "")}\n`);
  }
  writeFileSync(join(root, "INTERVIEW.md"), "# INTERVIEW\n");
  writeFileSync(join(root, "MANUAL.md"), "# MANUAL\n");
  writeFileSync(join(root, ".gitignore"), ".devx-cache/\n.worktrees/\n");
  mkdirSync(join(root, "dev"), { recursive: true });

  const fx: Fixture = {
    root,
    originDir: null,
    writeSpec(o: SpecOpts): string {
      const rel = specRel(o.type, o.hash, o.slug);
      fx.write(rel, [
        "---",
        `hash: ${o.hash}`,
        `type: ${o.type}`,
        `created: ${TS}:00-06:00`,
        `title: "${o.title}"`,
        `status: ${o.status}`,
        ...(o.fm ?? []),
        "---",
        "",
        "## Goal",
        "",
        `Fixture goal for ${o.hash}.`,
        "",
        "## Acceptance criteria",
        "",
        "- [ ] AC 1: exists.",
        "",
        "## Status log",
        "",
        `- ${TS} — filed (fixture).`,
        o.body ?? "",
      ].join("\n"));
      return rel;
    },
    write(rel: string, content: string): void {
      const abs = join(root, ...rel.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    read(rel: string): string {
      return execFileSync("cat", [join(root, ...rel.split("/"))], {
        encoding: "utf8",
      });
    },
    exists(rel: string): boolean {
      return existsSync(join(root, ...rel.split("/")));
    },
    commitAll(msg: string): void {
      git(root, "add", "-A");
      git(root, "commit", "-m", msg, "--no-gpg-sign");
    },
  };

  fx.commitAll("fixture: init");

  if (opts.withOrigin) {
    const originDir = mkdtempSync(join(tmpdir(), `${opts.prefix}-origin-`));
    git(originDir, "init", "--bare", "-b", "main");
    git(root, "remote", "add", "origin", originDir);
    git(root, "push", "origin", "main");
    fx.originDir = originDir;
  }

  return fx;
}

/** Mermaid-block extraction: the single fenced ```mermaid block of a
 *  rendered GRAPH.md, or null when absent/ambiguous. */
export function mermaidBlock(graphMd: string): string | null {
  const matches = [...graphMd.matchAll(/```mermaid\n([\s\S]*?)```/g)];
  if (matches.length !== 1) return null;
  return matches[0][1];
}

/** Lines of a mermaid block mentioning BOTH tokens (edge-line lookup). */
export function linesWithBoth(
  block: string,
  a: string,
  b: string,
): string[] {
  return block
    .split("\n")
    .filter((l) => l.includes(a) && l.includes(b));
}
