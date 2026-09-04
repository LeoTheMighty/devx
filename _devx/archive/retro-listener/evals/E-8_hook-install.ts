// E-8 (P1): hook installation is idempotent and ownership-respecting.
// RED until Phase 5 (init-hooks) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts installHooks(): creates .claude/settings.json when absent; a second
// run is a 0-byte diff; merging into a settings file with pre-existing
// user-authored hooks preserves those entries byte-intact AND in their
// original order. Permanent suite: test/learn-hook-install.test.ts.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const failures: string[] = [];
const repoA = mkdtempSync(join(tmpdir(), "e8-fresh-"));
const repoB = mkdtempSync(join(tmpdir(), "e8-merge-"));

try {
  const hooks = await import("../../../../src/lib/init-hooks.js").catch(() => null);
  if (!hooks) {
    failures.push("src/lib/init-hooks.ts missing — feature not implemented (T5.1)");
  } else {
    // (a) fresh repo: created, then unchanged, 0-byte diff.
    const settingsA = join(repoA, ".claude", "settings.json");
    const r1 = hooks.installHooks({ repoRoot: repoA });
    const bytes1 = readFileSync(settingsA, "utf8");
    const r2 = hooks.installHooks({ repoRoot: repoA });
    const bytes2 = readFileSync(settingsA, "utf8");
    if (bytes1 !== bytes2) {
      failures.push("second installHooks run changed the settings file — not idempotent");
    }
    const action2 = Array.isArray(r2) ? r2[0]?.action : (r2 as { action?: string })?.action;
    if (action2 !== "unchanged") {
      failures.push(`second run reported action '${String(action2)}', want 'unchanged'`);
    }
    void r1;
    const parsed = JSON.parse(bytes1) as { hooks?: Record<string, unknown> };
    for (const event of ["Stop", "SessionEnd"]) {
      if (!JSON.stringify(parsed.hooks?.[event] ?? "").includes("devx learn-helper listen")) {
        failures.push(`created settings carry no ${event} registration invoking 'devx learn-helper listen'`);
      }
    }

    // (b) pre-existing user hooks survive byte-intact and in order.
    mkdirSync(join(repoB, ".claude"), { recursive: true });
    const userHooks = {
      hooks: {
        Stop: [
          { hooks: [{ type: "command", command: "echo user-hook-one" }] },
          { hooks: [{ type: "command", command: "echo user-hook-two" }] },
        ],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo user-pre" }] }],
      },
      permissions: { allow: ["Bash(ls:*)"] },
    };
    const settingsB = join(repoB, ".claude", "settings.json");
    writeFileSync(settingsB, JSON.stringify(userHooks, null, 2) + "\n");
    hooks.installHooks({ repoRoot: repoB });
    const merged = JSON.parse(readFileSync(settingsB, "utf8")) as {
      hooks?: { Stop?: unknown[]; PreToolUse?: unknown[] };
      permissions?: unknown;
    };
    const stop = merged.hooks?.Stop ?? [];
    const userEntries = stop.filter((e) => JSON.stringify(e).includes("user-hook"));
    if (userEntries.length !== 2) {
      failures.push(`merge removed user Stop entries (${userEntries.length}/2 survive)`);
    } else {
      const [a, b] = userEntries.map((e) => JSON.stringify(e));
      if (!a.includes("user-hook-one") || !b.includes("user-hook-two")) {
        failures.push("merge reordered user Stop entries — original order must be preserved");
      }
    }
    if (!JSON.stringify(stop).includes("devx learn-helper listen")) {
      failures.push("merge did not add the devx Stop registration");
    }
    if (JSON.stringify(merged.hooks?.PreToolUse ?? "") !== JSON.stringify(userHooks.hooks.PreToolUse)) {
      failures.push("merge disturbed an unrelated hook event (PreToolUse)");
    }
    if (JSON.stringify(merged.permissions) !== JSON.stringify(userHooks.permissions)) {
      failures.push("merge disturbed unknown top-level keys (permissions)");
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
} finally {
  rmSync(repoA, { recursive: true, force: true });
  rmSync(repoB, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`E-8 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-8 PASS — hook install is idempotent and ownership-respecting");
