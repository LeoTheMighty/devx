// `devx learn-helper slug <raw…>` — CLI passthrough for the /devx-learn
// skill body. Mirrors the plan-helper pattern: the skill body invokes a
// small Bash helper, the helper does the deterministic work, the skill body
// uses the result.
//
// The only mechanical piece of /devx-learn (design §Discarded rejects a
// transcript-mining CLI arm — judgment stays prose). Session content is
// untrusted, so branch/file slugs are minted here and only here; the skill
// body never passes raw session text to git/gh (E-6 guard).
//
// Exit codes:
//   0 — always for `slug`; sanitized slug printed on stdout. The sanitizer
//       total-functions every input (empty/hostile → 'session-retro' or a
//       safe reduction), so there is no failure path.
//   2 — commander usage error (unknown subcommand; handled by commander).
//
// Spec: dev/dev-hfi104-2026-07-24T10:41-devx-learn-skill.md (T4.2)
// Design: _devx/workstreams/harness-fold-in/design.md §Interfaces

import process from "node:process";

import type { Command } from "commander";

import { attachPhase } from "../lib/help.js";
import { sanitizeLearnSlug } from "../lib/learn/slug.js";

export interface RunLearnSlugOpts {
  /** Test seam: route stdout off process.stdout. */
  out?: (s: string) => void;
}

/**
 * Sanitize the raw args into one slug. Multiple words arrive as separate
 * argv entries (the skill body passes unquoted prose); joining with a space
 * lets the sanitizer turn the gaps into dash separators. Zero args → the
 * 'session-retro' fallback, same as an empty string.
 */
export function runLearnSlug(args: string[], opts: RunLearnSlugOpts = {}): number {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  out(`${sanitizeLearnSlug(args.join(" "))}\n`);
  return 0;
}

export function register(program: Command): void {
  const sub = program
    .command("learn-helper")
    .description(
      "Helpers invoked by the /devx-learn skill body. Subcommand-driven; mirrors `devx plan-helper`'s passthrough pattern.",
    );

  sub
    .command("slug")
    .description(
      "Sanitize free text into a safe slug for learn branches/files (lowercase, [a-z0-9-], ≤40 chars; empty → 'session-retro'). The only sanctioned path from session text to git/gh names.",
    )
    .argument("[raw...]", "raw text to sanitize (session-mined learning title)")
    .action((raw: string[]) => {
      const code = runLearnSlug(raw ?? []);
      if (code !== 0) process.exit(code);
    });

  attachPhase(sub, 1);
}
