// E-3 (P0): bare `devx init` scaffolds a working repo including skills.
// RED until ini602 merges. Runnable standalone: `npx tsx <this file>`.
// Spawns the built CLI in a throwaway git repo and asserts the full
// artifact set. Requires `dist/` to exist (npm run build).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const cli = join(repoRoot, "dist", "cli.js");
const failures: string[] = [];

const BACKLOGS = [
  "DEV.md", "PLAN.md", "TEST.md", "DEBUG.md",
  "FOCUS.md", "INTERVIEW.md", "MANUAL.md", "LESSONS.md",
];
const SKILLS = ["devx.md", "devx-plan.md", "devx-interview.md"];

const dir = mkdtempSync(join(tmpdir(), "devx-e3-"));
try {
  const git = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (git.status !== 0) {
    console.error(`E-3 setup failed: git init exited ${git.status}`);
    process.exit(2);
  }

  const r = spawnSync("node", [cli, "init"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
  if (r.status !== 0) {
    failures.push(
      `devx init exited ${r.status}: ${(r.stderr || r.stdout).slice(0, 300)}`,
    );
  }

  if (!existsSync(join(dir, "devx.config.yaml"))) failures.push("devx.config.yaml missing");
  for (const b of BACKLOGS) {
    if (!existsSync(join(dir, b))) failures.push(`${b} missing`);
  }
  for (const d of ["dev", "plan"]) {
    if (!existsSync(join(dir, d))) failures.push(`${d}/ spec dir missing`);
  }
  const claudeMd = join(dir, "CLAUDE.md");
  if (!existsSync(claudeMd)) {
    failures.push("CLAUDE.md missing");
  } else if (!readFileSync(claudeMd, "utf8").toLowerCase().includes("devx")) {
    failures.push("CLAUDE.md has no devx block");
  }
  if (!existsSync(join(dir, ".github", "workflows"))) {
    failures.push(".github/workflows/ missing (CI workflow not scaffolded)");
  }
  for (const s of SKILLS) {
    const p = join(dir, ".claude", "commands", s);
    if (!existsSync(p)) {
      failures.push(`.claude/commands/${s} missing`);
    } else if (!readFileSync(p, "utf8").includes("devx-skill v")) {
      failures.push(`.claude/commands/${s} lacks the devx-skill version header`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-3 RED — bare `devx init` does not scaffold a working repo:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-3 GREEN — full scaffold incl. header-bearing skills, exit 0.");
