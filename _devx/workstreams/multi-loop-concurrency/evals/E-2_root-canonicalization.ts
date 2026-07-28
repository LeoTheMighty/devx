// E-2 (P0): worktree launch refusal — one state universe per repo (FR-1, CAP-1).
// RED until Phase 1 (canonical repo root) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts (a) `devx loop --dry-run` started with cwd inside a linked worktree
// refuses with exit != 0 and an error naming the main checkout path (today it
// happily resolves the worktree as repoRoot — race R1), and (b) the canonical
// resolver module `src/lib/repo-root.ts` exists and reports the main root's
// .devx-cache from a main-checkout subdirectory.
// Permanent suite: test/repo-root.test.ts.

import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkRepoFixture, runCli } from "./_fixture.js";

const failures: string[] = [];
const fx = mkRepoFixture({
  prefix: "e2-root",
  items: [["ab12cd", "fixture-one"]],
  withLinkedWorktree: true,
});

try {
  // (a) refusal from inside the linked worktree.
  const res = runCli(["loop", "--dry-run"], fx.worktreeDir!);
  if (res.status === 0) {
    failures.push(
      "devx loop --dry-run ran from inside .worktrees/dev-wt0001 without refusing (exit 0) — worktree-launch refusal not implemented (T1.2)",
    );
  } else {
    const out = res.stdout + res.stderr;
    const mainReal = realpathSync(fx.root);
    if (!out.includes(fx.root) && !out.includes(mainReal)) {
      failures.push(
        `worktree refusal message does not name the main checkout path (${fx.root}): got: ${out.slice(0, 300)}`,
      );
    }
  }

  // (b) canonical resolver module + subdirectory resolution.
  try {
    const mod = await import("../../../../src/lib/repo-root.js");
    const resolveRepoRoot = (mod as Record<string, unknown>)
      .resolveRepoRoot as
      | ((cwd: string) => { root: string; cacheDir: string; isLinkedWorktree: boolean })
      | undefined;
    if (typeof resolveRepoRoot !== "function") {
      failures.push(
        "src/lib/repo-root.ts exists but exports no resolveRepoRoot(cwd) — feature incomplete (T1.1)",
      );
    } else {
      const sub = join(fx.root, "dev");
      mkdirSync(sub, { recursive: true });
      const fromSub = resolveRepoRoot(sub);
      const mainReal = realpathSync(fx.root);
      if (
        realpathSync(fromSub.cacheDir).replace(/\/.devx-cache$/, "") !==
          mainReal &&
        fromSub.cacheDir !== join(fx.root, ".devx-cache") &&
        fromSub.cacheDir !== join(mainReal, ".devx-cache")
      ) {
        failures.push(
          `resolveRepoRoot(main subdir) cacheDir '${fromSub.cacheDir}' != '<mainRoot>/.devx-cache'`,
        );
      }
      const fromWt = resolveRepoRoot(fx.worktreeDir!);
      if (!fromWt.isLinkedWorktree) {
        failures.push(
          "resolveRepoRoot(linked worktree) did not report isLinkedWorktree",
        );
      }
    }
  } catch {
    failures.push(
      "src/lib/repo-root.ts missing — canonical root resolver not implemented (T1.1)",
    );
  }
} finally {
  try {
    rmSync(fx.root, { recursive: true, force: true });
  } catch {
    /* fixture cleanup is best-effort */
  }
}

if (failures.length > 0) {
  console.error("E-2 RED — repo root is not canonical yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "E-2 GREEN — worktree launches refuse with the main root named; resolver canonicalizes from subdirs.",
);
