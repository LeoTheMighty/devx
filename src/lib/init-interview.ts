// INTERVIEW.md seeding for `/devx-init` (ini504).
//
// Public surface:
//   - seedInterview(opts) — given a detected stack, append 3 stack-templated
//     questions to INTERVIEW.md if (and only if) the file is in its
//     empty-state shape (i.e. ini502's INTERVIEW.md.header with no items
//     below the empty-state markers). Re-runs are safe: once the user (or
//     any agent) has filed a question, this seeder skips.
//   - mapStackToTemplate(stack) — pure: maps init-state's DetectedStack
//     ("typescript" | "flutter" | "rust" | "go" | "python" | "empty" |
//     "mixed") to a template basename. Exported for tests.
//
// Spec: dev/dev-ini504-2026-04-26T19:35-init-personas-and-interview.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DetectedStack } from "./init-state.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InterviewSeedTemplate =
  | "ts"
  | "python"
  | "rust"
  | "go"
  | "flutter"
  | "empty";

export type InterviewSeedOutcome =
  | "seeded"
  | "skipped-already-has-content"
  | "skipped-missing-target"
  | "skipped-missing-template";

export interface SeedInterviewResult {
  outcome: InterviewSeedOutcome;
  /** Which template basename the seeder matched against the stack. */
  template: InterviewSeedTemplate;
  /** Absolute path of the target INTERVIEW.md (always set; the seeder may
   *  not have touched it). */
  targetPath: string;
}

export interface SeedInterviewOpts {
  repoRoot: string;
  /** init-state's detected stack. "mixed" falls back to "empty". */
  stack: DetectedStack;
  /** Override the templates dir. Defaults to the package's
   *  _devx/templates/init/. */
  templatesRoot?: string;
}

// ---------------------------------------------------------------------------
// Public entrypoints
// ---------------------------------------------------------------------------

export function seedInterview(opts: SeedInterviewOpts): SeedInterviewResult {
  const templatesRoot = opts.templatesRoot ?? defaultTemplatesRoot();
  const template = mapStackToTemplate(opts.stack);
  const targetPath = join(opts.repoRoot, "INTERVIEW.md");

  if (!existsSync(targetPath)) {
    // ini502 should have created INTERVIEW.md before this runs. If it didn't,
    // we don't want to silently create one — the orchestrator's call order
    // is broken and the surrounding /devx-init flow needs to surface that,
    // not paper over it.
    return { outcome: "skipped-missing-target", template, targetPath };
  }

  const templatePath = join(templatesRoot, `interview-seed-${template}.md`);
  if (!existsSync(templatePath)) {
    return { outcome: "skipped-missing-template", template, targetPath };
  }

  const existing = readFileSync(targetPath, "utf8").replace(/\r\n/g, "\n");
  if (!isEmptyState(existing)) {
    return { outcome: "skipped-already-has-content", template, targetPath };
  }

  const seedBody = readFileSync(templatePath, "utf8").replace(/\r\n/g, "\n");
  const next = appendSeed(existing, seedBody);
  writeAtomic(targetPath, next);
  return { outcome: "seeded", template, targetPath };
}

export function mapStackToTemplate(stack: DetectedStack): InterviewSeedTemplate {
  switch (stack) {
    case "typescript":
      return "ts";
    case "flutter":
      return "flutter";
    case "rust":
      return "rust";
    case "go":
      return "go";
    case "python":
      return "python";
    case "empty":
    case "mixed":
      // mixed → empty: we have multiple stack files but no signal which is
      // primary, so seed the same generic 3 questions an empty repo gets.
      return "empty";
  }
}

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

const EMPTY_START = "<!-- devx-empty-state-start -->";
const EMPTY_END = "<!-- devx-empty-state-end -->";

/** True iff `body` is the ini502 INTERVIEW.md.header verbatim — i.e. it has
 *  the empty-state block AND nothing meaningful follows the end marker.
 *
 *  We deliberately only consider whitespace and ZERO checkbox items past the
 *  end marker as "still empty." Any prose, any checkbox, any new heading
 *  past the marker means a human or agent has filed something — leave it
 *  alone. (Idempotency invariant.) */
function isEmptyState(body: string): boolean {
  const startIdx = body.indexOf(EMPTY_START);
  const endIdx = body.indexOf(EMPTY_END);
  if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) return false;
  const tail = body.slice(endIdx + EMPTY_END.length);
  // Anything other than whitespace past the end marker disqualifies.
  return tail.trim().length === 0;
}

/** Append the seed body after the empty-state block, leaving the empty-state
 *  block in place. Once seedBody's questions land, the empty-state block
 *  auto-vanishes (per the ini502 header copy: "auto-deletes once this file
 *  holds three or more items") on the next render — but actually triggering
 *  that auto-delete is the Layer-2 reconciler's job, not /devx-init's. */
function appendSeed(existing: string, seedBody: string): string {
  const sep = existing.endsWith("\n") ? "" : "\n";
  const seedTrimmed = seedBody.endsWith("\n") ? seedBody : seedBody + "\n";
  return existing + sep + "\n" + seedTrimmed;
}

function defaultTemplatesRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // src/lib/init-interview.ts → ../../_devx/templates/init
  // dist/lib/init-interview.js → ../../_devx/templates/init
  return resolve(here, "..", "..", "..", "_devx", "templates", "init");
}
