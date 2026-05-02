// `devx pr-body --spec <path>` — render the canonical /devx PR body for a spec.
//
// Reads the on-disk PR template (`.github/pull_request_template.md`) or falls
// back to the built-in canonical template (when the repo predates prt101 or
// hasn't run `/devx-init` upgrade since). Substitutes the active mode (from
// `devx.config.yaml`), the spec path, and the AC checklist (from the spec's
// `## Acceptance criteria` section). Optional `--summary` / `--test-plan` /
// `--notes` flags fill the corresponding free-text placeholders; omitted
// ones leave the placeholder visible per locked decision #5.
//
// I/O contract — load-bearing for /devx Phase 7:
//   stdout: the rendered body (suitable for `gh pr create --body-file -` or
//           --body "$(devx pr-body ...)"). Always trailing-newline-terminated.
//   stderr: one `unresolved-placeholder: <name>` line per unresolved
//           placeholder. /devx Phase 7 captures this and appends a status-log
//           line per name (locked decision #5).
//   exit:   0 on render success (regardless of unresolved placeholders).
//           64 on usage error (missing/malformed flags).
//           65 on I/O failure (config not found, spec not found, template
//           override path absent). Distinct from 0 so /devx can detect "I
//           couldn't even render" vs "I rendered with gaps".
//
// Spec: dev/dev-prt102-2026-04-28T19:30-pr-template-substitution.md
// Epic: _bmad-output/planning-artifacts/epic-pr-template.md

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep as pathSep } from "node:path";
import type { Command } from "commander";

import { findProjectConfig, loadMerged } from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";
import {
  extractAcChecklist,
  loadTemplate,
  renderPrBody,
} from "../lib/pr-body.js";

interface ConfigShape {
  mode?: string;
}

export interface RunPrBodyOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route stderr off process.stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project config path (skip findProjectConfig walk). */
  projectPath?: string;
}

export interface PrBodyFlags {
  spec: string;
  summary?: string;
  testPlan?: string;
  notes?: string;
  templatePath?: string;
}

export function runPrBody(flags: PrBodyFlags, opts: RunPrBodyOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  const projectConfigPath = opts.projectPath ?? findProjectConfig();
  if (!projectConfigPath) {
    err("devx pr-body: devx.config.yaml not found (walked up from cwd)\n");
    return 65;
  }
  const projectDir = dirname(projectConfigPath);

  // Resolve spec path. Accept absolute or repo-relative (relative to projectDir
  // — same convention as `devx merge-gate`'s spec lookup).
  const specPathAbs = isAbsolute(flags.spec)
    ? flags.spec
    : resolve(projectDir, flags.spec);
  if (!existsSync(specPathAbs)) {
    err(`devx pr-body: spec file not found: ${flags.spec}\n`);
    return 65;
  }
  const specBody = readFileSync(specPathAbs, "utf8");

  // The PR body's `**Spec:**` line carries the repo-relative path: reviewers
  // and the mobile companion app's PR card both anchor on a stable repo-rooted
  // reference, never an absolute filesystem path (which would leak the
  // worktree path of whichever agent opened the PR).
  let specPathRel: string;
  if (isAbsolute(flags.spec)) {
    const rel = relativeToProject(flags.spec, projectDir);
    if (rel === null) {
      err(
        `devx pr-body: spec path is outside the project (${flags.spec}); ` +
          `pass a repo-relative path so the **Spec:** line stays anchored to the repo root\n`,
      );
      return 65;
    }
    specPathRel = rel;
  } else {
    specPathRel = flags.spec;
  }

  // Load mode from config.
  let mode: string;
  try {
    const raw = loadMerged({ projectPath: projectConfigPath });
    const cfg = (raw && typeof raw === "object" ? raw : {}) as ConfigShape;
    mode = String(cfg.mode ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`devx pr-body: config load failed: ${msg}\n`);
    return 65;
  }
  if (!mode) {
    err("devx pr-body: devx.config.yaml has no `mode` key\n");
    return 65;
  }

  // Load the PR template — explicit override OR the project's
  // .github/pull_request_template.md OR the built-in canonical fallback.
  let template: string;
  if (flags.templatePath) {
    const tplAbs = isAbsolute(flags.templatePath)
      ? flags.templatePath
      : resolve(projectDir, flags.templatePath);
    if (!existsSync(tplAbs)) {
      err(`devx pr-body: --template-path file not found: ${flags.templatePath}\n`);
      return 65;
    }
    template = readFileSync(tplAbs, "utf8")
      .replace(/^﻿/, "")
      .replace(/\r\n/g, "\n");
  } else {
    template = loadTemplate(projectDir);
  }

  // Empty / whitespace-only template after load is a config bug, not a
  // graceful-degradation case. Returning a body of just `**Spec:**` (or worse,
  // an empty body) on stdout would silently slip through to `gh pr create`
  // and produce an empty-bodied PR. Exit 65 with an explanatory message so
  // /devx Phase 7's caller can fix the on-disk template (or fall back to no
  // --template-path override).
  if (template.trim() === "") {
    err(
      "devx pr-body: template is empty; check `.github/pull_request_template.md` " +
        "(or the --template-path override) — the built-in fallback should never produce this\n",
    );
    return 65;
  }

  const acChecklist = extractAcChecklist(specBody);

  const result = renderPrBody({
    template,
    mode,
    specPath: specPathRel,
    acChecklist,
    summary: flags.summary,
    testPlan: flags.testPlan,
    notes: flags.notes,
  });

  out(result.body);
  if (!result.body.endsWith("\n")) out("\n");

  for (const name of result.unresolvedPlaceholders) {
    err(`unresolved-placeholder: ${name}\n`);
  }

  return 0;
}

/** Returns the repo-relative form of `absPath` under `projectDir`, or `null`
 *  when the target lives outside the project (symlink, sibling worktree,
 *  shared spec store). Caller treats null as a hard error — silently
 *  emitting an absolute path would leak the worktree path into the PR
 *  body's `**Spec:**` line, which is the one stable reference reviewers
 *  + the mobile companion app's PR card anchor on. Uses `path.sep` (not a
 *  hard-coded `/`) so the prefix check holds on Windows where the separator
 *  is `\`. */
function relativeToProject(absPath: string, projectDir: string): string | null {
  const projAbs = resolve(projectDir);
  const target = resolve(absPath);
  if (target === projAbs) return "";
  if (target.startsWith(projAbs + pathSep)) {
    return target.slice(projAbs.length + 1);
  }
  return null;
}

export function register(program: Command): void {
  const sub = program
    .command("pr-body")
    .description(
      "Render the canonical /devx PR body for a spec. Substitutes mode + spec path + AC checklist (Phase 1).",
    )
    .requiredOption("--spec <path>", "spec file path (repo-relative or absolute)")
    .option(
      "--summary <text>",
      "fill the `<1–3 bullets on what changed>` placeholder",
    )
    .option(
      "--test-plan <text>",
      "fill the `<bulleted list of what local CI gates covered + any manual steps>` placeholder",
    )
    .option(
      "--notes <text>",
      "fill the `<surprises, deviations, follow-ups>` placeholder",
    )
    .option(
      "--template-path <path>",
      "override the PR template path (defaults to .github/pull_request_template.md)",
    )
    .action(
      (opts: {
        spec: string;
        summary?: string;
        testPlan?: string;
        notes?: string;
        templatePath?: string;
      }) => {
        const code = runPrBody({
          spec: opts.spec,
          summary: opts.summary,
          testPlan: opts.testPlan,
          notes: opts.notes,
          templatePath: opts.templatePath,
        });
        if (code !== 0) process.exit(code);
      },
    );
  attachPhase(sub, 1);
}
