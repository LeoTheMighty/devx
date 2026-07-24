// E-7 (P2): lifecycle skill bodies carry the todo write steps.
// RED until Phase 5 (skill wiring + nudge single-sourcing) merges. Runnable
// standalone: `npx tsx <this file>`.
// Asserts (a) each of the 4 /devx-plan stage sections and the /devx execute
// arm carries a `devx todo sync` step (5/5), (b) the friction-only learn
// nudge is defined in exactly one place (`<!-- nudge-canonical -->` in
// devx-learn.md) and referenced — not restated — by both lifecycle bodies,
// (c) the gated skill set stays under engine.prose_budget_kb, and (d) the
// permanent suite test/skill-todo-discipline.test.ts exists.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const planPath = join(repoRoot, ".claude", "commands", "devx-plan.md");
const devxPath = join(repoRoot, ".claude", "commands", "devx.md");
const learnPath = join(repoRoot, ".claude", "commands", "devx-learn.md");

const planBody = existsSync(planPath) ? readFileSync(planPath, "utf8") : "";
const devxBody = existsSync(devxPath) ? readFileSync(devxPath, "utf8") : "";
const learnBody = existsSync(learnPath) ? readFileSync(learnPath, "utf8") : "";

// (a) 5/5 sections carry the todo step.
const STAGES = ["## Stage: PRD", "## Stage: Design", "## Stage: Plan", "## Stage: RED"];
function sectionOf(body: string, header: string): string {
  const start = body.indexOf(header);
  if (start === -1) return "";
  const rest = body.slice(start + header.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}
for (const header of STAGES) {
  const section = sectionOf(planBody, header);
  if (section === "") {
    failures.push(`devx-plan.md section '${header}' not found`);
  } else if (!section.includes("devx todo sync")) {
    failures.push(`devx-plan.md '${header}' carries no todo step (devx todo sync) — feature missing (T5.1)`);
  }
}
// Execute arm: the Execution Loop portion of devx.md (Phase 1 → Phase 9).
const executeArm = devxBody.slice(devxBody.indexOf("## Execution Loop"));
if (!devxBody.includes("## Execution Loop")) {
  failures.push("devx.md '## Execution Loop' section not found");
} else if (!executeArm.includes("devx todo sync")) {
  failures.push("devx.md execute arm carries no todo step (devx todo sync) — feature missing (T5.2)");
}

// (b) nudge canonical exactly once, referenced (not restated) elsewhere.
const marker = "<!-- nudge-canonical -->";
const countIn = (body: string) => body.split(marker).length - 1;
const markerTotal = countIn(planBody) + countIn(devxBody) + countIn(learnBody);
if (countIn(learnBody) !== 1) {
  failures.push(
    `devx-learn.md must define the nudge canonical exactly once (found ${countIn(learnBody)}) — feature missing (T4.3/T5.3)`,
  );
}
if (markerTotal !== 1) {
  failures.push(`nudge canonical marker appears ${markerTotal} time(s) across skill bodies, wanted exactly 1`);
}
for (const [name, body] of [["devx-plan.md", planBody], ["devx.md", devxBody]] as const) {
  if (body !== "" && !/nudge/i.test(body)) {
    failures.push(`${name} carries no friction-observed nudge reference (T5.3)`);
  }
}

// (c) prose-budget canary — mirror the S-1 gated set exactly
// (test/engine-prose-budget.test.ts: _devx/templates/engine/*.md +
// .claude/commands/devx-plan.md ≤ engine.prose_budget_kb; devx.md sits
// under the separate 2× drift tripwire per INTERVIEW Q#9).
const templatesDir = join(repoRoot, "_devx", "templates", "engine");
let totalBytes = 0;
if (existsSync(templatesDir)) {
  for (const name of readdirSync(templatesDir).sort()) {
    if (name.endsWith(".md")) totalBytes += statSync(join(templatesDir, name)).size;
  }
}
if (existsSync(planPath)) totalBytes += statSync(planPath).size;
if (totalBytes > 60 * 1024) {
  failures.push(
    `S-1 gated set (engine templates + devx-plan.md) is ${(totalBytes / 1024).toFixed(1)}KB — breaches engine.prose_budget_kb (60KB)`,
  );
}

// (d) permanent suite.
if (!existsSync(join(repoRoot, "test", "skill-todo-discipline.test.ts"))) {
  failures.push(
    "test/skill-todo-discipline.test.ts missing — 5/5 + nudge single-source + canary not pinned (feature missing, T5.5)",
  );
}

if (failures.length > 0) {
  console.error("E-7 RED — lifecycle skill wiring not landed yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-7 GREEN — todo steps in 5/5 sections, nudge single-sourced, budget honored, suite pinned.");
