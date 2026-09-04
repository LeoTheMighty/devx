// E-1 (P0): todo.md scaffold honors the parse contract.
// RED until Phase 1 (todo core) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts (a) the engine template `_devx/templates/engine/todo.md` exists and
// carries the 11-line lifecycle skeleton in template order, (b) a fresh
// `createWorkstream` scaffold (temp repo root) writes todo.md, and (c)
// `parseTodo` extracts all lifecycle items from the fresh scaffold with 0
// unparsed top-level lines. Permanent suite: test/workstream-todo-scaffold.test.ts.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// The fixed skeleton from design §"todo.md parse contract" — template order.
const SKELETON = [
  "- [ ] Stage: PRD",
  "- [ ] Gate: prd",
  "- [ ] Stage: Design",
  "- [ ] Gate: coverage(design)",
  "- [ ] Stage: Plan",
  "- [ ] Gate: coverage(plan)",
  "- [ ] Stage: RED",
  "- [ ] Gate: evals",
  "- [ ] Stage: Execute",
  "- [ ] Stage: Retro",
  "- [ ] Stage: Outcome",
];
const DERIVED_RE = /^- \[( |x)\] (Stage|Gate|Phase \d+): .+$/;

function assertSkeleton(content: string, label: string): void {
  const topLevel = content
    .split("\n")
    .filter((l) => l.startsWith("- ["));
  let cursor = 0;
  for (const want of SKELETON) {
    const idx = topLevel.indexOf(want, cursor);
    if (idx === -1) {
      failures.push(`${label}: skeleton line '${want}' missing or out of template order`);
      return;
    }
    cursor = idx + 1;
  }
  for (const line of topLevel) {
    if (!DERIVED_RE.test(line)) {
      failures.push(`${label}: top-level line '${line}' violates the parse contract regex`);
    }
  }
}

// (a) shipped template exists + honors the contract.
const templateAbs = join(repoRoot, "_devx", "templates", "engine", "todo.md");
if (!existsSync(templateAbs)) {
  failures.push("_devx/templates/engine/todo.md missing — feature not implemented (T1.1)");
} else {
  assertSkeleton(readFileSync(templateAbs, "utf8"), "template");
}

// (b) + (c) fresh scaffold writes todo.md and parseTodo reads it clean.
try {
  const { createWorkstream } = await import("../../../../src/lib/engine/workstream.js");
  const { ENGINE_DEFAULTS } = await import("../../../../src/lib/engine/config.js");
  const tmp = mkdtempSync(join(tmpdir(), "e1-todo-scaffold-"));
  try {
    cpSync(join(repoRoot, "_devx", "templates"), join(tmp, "_devx", "templates"), {
      recursive: true,
    });
    createWorkstream({ repoRoot: tmp, slug: "e1-fixture", engine: ENGINE_DEFAULTS });
    const scaffolded = join(tmp, "_devx", "workstreams", "e1-fixture", "todo.md");
    if (!existsSync(scaffolded)) {
      failures.push(
        "fresh `createWorkstream` scaffold did not write todo.md — feature not implemented (T1.2)",
      );
    } else {
      const content = readFileSync(scaffolded, "utf8");
      assertSkeleton(content, "fresh scaffold");
      try {
        const todoMod = await import("../../../../src/lib/engine/todo.js");
        if (typeof todoMod.parseTodo !== "function") {
          failures.push("src/lib/engine/todo.ts exists but exports no parseTodo (T1.3)");
        } else {
          const doc = todoMod.parseTodo(content);
          if (doc.unparsedTopLevel.length !== 0) {
            failures.push(
              `parseTodo left ${doc.unparsedTopLevel.length} unparsed top-level line(s) on a fresh scaffold (lines ${doc.unparsedTopLevel.join(", ")})`,
            );
          }
          const lifecycle = (doc.items ?? []).filter(
            (i: { kind: string }) => i.kind === "stage" || i.kind === "gate",
          );
          if (lifecycle.length !== SKELETON.length) {
            failures.push(
              `parseTodo extracted ${lifecycle.length}/${SKELETON.length} lifecycle items from a fresh scaffold`,
            );
          }
        }
      } catch {
        failures.push(
          "src/lib/engine/todo.ts missing — parseTodo not implemented (feature missing, T1.3)",
        );
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
} catch (err) {
  failures.push(
    `could not drive createWorkstream scaffold probe: ${err instanceof Error ? err.message : String(err)}`,
  );
}

if (failures.length > 0) {
  console.error("E-1 RED — todo.md scaffold does not honor the parse contract yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-1 GREEN — scaffold writes a contract-clean todo.md; parseTodo reads it whole.");
