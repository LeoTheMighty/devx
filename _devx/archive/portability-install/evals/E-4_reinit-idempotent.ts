// E-4 (P1): re-init is idempotent and never clobbers user-owned files.
// RED until ini602 merges. Runnable standalone: `npx tsx <this file>`.
// First init a throwaway repo, replace one skill with a headerless
// user-owned file, re-init, and assert preservation + MANUAL entry +
// header-bearing files upgraded in place.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const cli = join(repoRoot, "dist", "cli.js");
const failures: string[] = [];

const USER_CONTENT = "# my own devx command\n\nhands off\n";

const dir = mkdtempSync(join(tmpdir(), "devx-e4-"));
try {
  spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });

  const first = spawnSync("node", [cli, "init"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    timeout: 120_000,
  });
  const devxSkill = join(dir, ".claude", "commands", "devx.md");
  if (first.status !== 0 || !existsSync(devxSkill)) {
    failures.push(
      `first devx init did not produce .claude/commands/devx.md (exit ${first.status})`,
    );
  } else {
    writeFileSync(devxSkill, USER_CONTENT);

    const second = spawnSync("node", [cli, "init"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      timeout: 120_000,
    });
    if (second.status !== 0) {
      failures.push(`re-run devx init exited ${second.status}`);
    }
    if (readFileSync(devxSkill, "utf8") !== USER_CONTENT) {
      failures.push("user-owned .claude/commands/devx.md was modified by re-init");
    }
    const manual = join(dir, "MANUAL.md");
    if (!existsSync(manual) || !/devx\.md/.test(readFileSync(manual, "utf8"))) {
      failures.push("MANUAL.md has no entry about the skipped user-owned skill file");
    }
    const other = join(dir, ".claude", "commands", "devx-plan.md");
    if (!existsSync(other) || !readFileSync(other, "utf8").includes("devx-skill v")) {
      failures.push("header-bearing devx-plan.md missing or lost its version header after re-init");
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("E-4 RED — re-init clobbers or ignores ownership rules:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-4 GREEN — user-owned file preserved, MANUAL filed, headers upgraded.");
