// prt101 — fresh-repo branch.
//
// Asserts writePrTemplate(repoRoot) on a repo with no existing
// .github/pull_request_template.md writes the canonical Phase 1 template
// (snapshot-anchored: marker line 1, **Spec:** line 2, **Mode:** line 3) and
// is idempotent on re-run (second call returns {action:"skipped"}; no diff).
//
// Spec: dev/dev-prt101-2026-04-28T19:30-pr-template-init-write.md

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { writePrTemplate } from "../src/lib/init-write.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Phase 1 template lives at _devx/templates/pull_request_template.md (not in
// the init/ subdir). Tests use the real shipped file so a regression in the
// canonical content surfaces here.
const TEMPLATES_ROOT = resolve(HERE, "..", "_devx", "templates");
const DEST_REL = ".github/pull_request_template.md";

const repos: string[] = [];
function mkRepo(prefix: string): string {
  const r = mkdtempSync(join(tmpdir(), prefix));
  repos.push(r);
  return r;
}

afterEach(() => {
  while (repos.length > 0) {
    const r = repos.pop();
    if (r) rmSync(r, { recursive: true, force: true });
  }
});

describe("writePrTemplate — fresh repo", () => {
  it("writes the canonical Phase 1 template; line 1 = marker, line 2 = **Spec:**, line 3 = **Mode:**", () => {
    const root = mkRepo("prt101-fresh-");

    const result = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });

    expect(result.action).toBe("wrote");
    expect(result.path).toBe(join(root, DEST_REL));
    expect(existsSync(result.path)).toBe(true);

    const body = readFileSync(result.path, "utf8");
    const lines = body.split("\n");
    expect(lines[0]).toBe("<!-- devx:mode -->");
    expect(lines[1]).toBe("**Spec:** `<dev/dev-<hash>-<ts>-<slug>.md>`");
    expect(lines[2]).toBe(
      "**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*",
    );

    // Carries the substitution placeholder verbatim — substitution is
    // /devx Phase 7's job (prt102), NOT /devx-init's. No `**YOLO**` /
    // `**BETA**` literal should appear: the writer must not stamp a mode.
    expect(body).toContain("<!-- devx:auto:mode -->");
    expect(body).not.toMatch(/\*\*(YOLO|BETA|PROD|LOCKDOWN)\*\*/);

    // Standard sections survive the canonical render.
    expect(body).toContain("## Summary");
    expect(body).toContain("## Acceptance criteria");
    expect(body).toContain("## Test plan");
    expect(body).toContain("## Notes for reviewers");
  });

  it("idempotent: second call returns {action:'skipped'} and produces no diff", () => {
    const root = mkRepo("prt101-fresh-idem-");

    const first = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });
    const before = readFileSync(first.path, "utf8");

    const second = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });
    const after = readFileSync(second.path, "utf8");

    expect(first.action).toBe("wrote");
    expect(second.action).toBe("skipped");
    expect(after).toBe(before);
  });

  it("dryRun does not touch disk on a fresh repo (action computed; file absent)", () => {
    const root = mkRepo("prt101-fresh-dryrun-");

    const result = writePrTemplate(root, {
      templatesRoot: TEMPLATES_ROOT,
      dryRun: true,
    });

    expect(result.action).toBe("wrote");
    expect(existsSync(join(root, DEST_REL))).toBe(false);
  });
});
