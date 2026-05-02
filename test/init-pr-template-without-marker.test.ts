// prt101 — file-present-without-marker branch.
//
// When .github/pull_request_template.md exists but lacks the
// `<!-- devx:mode -->` idempotency marker (the user authored their own PR
// template before /devx-init ran), writePrTemplate must APPEND a `## devx`
// section carrying the canonical block. The user's pre-existing content above
// is sacrosanct (LEARN.md cross-epic "MANUAL.md as designed signal" pattern:
// never overwrite hand-edited).
//
// Spec: dev/dev-prt101-2026-04-28T19:30-pr-template-init-write.md

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { writePrTemplate } from "../src/lib/init-write.js";

const HERE = dirname(fileURLToPath(import.meta.url));
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

function seedTemplate(repoRoot: string, body: string): string {
  const dest = join(repoRoot, DEST_REL);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  return dest;
}

describe("writePrTemplate — existing file without marker", () => {
  it("appends a `## devx` section under a fresh marker; user content above is preserved", () => {
    const root = mkRepo("prt101-no-marker-");
    const userBody = [
      "# Project PR Template",
      "",
      "## What changed?",
      "",
      "## Why?",
      "",
    ].join("\n");
    const dest = seedTemplate(root, userBody);

    const result = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });

    expect(result.action).toBe("appended");

    const next = readFileSync(dest, "utf8");
    // User's prior content survives intact at the top of the file.
    expect(next.startsWith(userBody)).toBe(true);
    // Appended section: `## devx` heading, marker, canonical fields.
    expect(next).toContain("## devx");
    expect(next).toContain("<!-- devx:mode -->");
    expect(next).toContain(
      "**Spec:** `<dev/dev-<hash>-<ts>-<slug>.md>`",
    );
    expect(next).toContain(
      "**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*",
    );
  });

  it("idempotent after append: re-running once the marker is present reports skipped", () => {
    const root = mkRepo("prt101-no-marker-idem-");
    const userBody = "# user-authored\n\nsome content\n";
    seedTemplate(root, userBody);

    const first = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });
    const after1 = readFileSync(first.path, "utf8");

    // Second call must observe the marker (now in the appended section) and
    // skip — no double-append.
    const second = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });
    const after2 = readFileSync(second.path, "utf8");

    expect(first.action).toBe("appended");
    expect(second.action).toBe("skipped");
    expect(after2).toBe(after1);
  });

  it("handles a file without trailing newline: separator is added before the appended section", () => {
    const root = mkRepo("prt101-no-marker-no-nl-");
    const userBody = "# user content"; // no trailing newline
    seedTemplate(root, userBody);

    const result = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });
    const next = readFileSync(result.path, "utf8");

    expect(result.action).toBe("appended");
    // The user's leading line is preserved followed by a blank-line separator
    // and then the `## devx` section.
    expect(next.startsWith("# user content\n")).toBe(true);
    expect(next).toContain("\n\n## devx\n");
  });

  it("dryRun on existing-without-marker reports appended without touching disk", () => {
    const root = mkRepo("prt101-no-marker-dryrun-");
    const userBody = "# untouched\n";
    seedTemplate(root, userBody);

    const result = writePrTemplate(root, {
      templatesRoot: TEMPLATES_ROOT,
      dryRun: true,
    });

    expect(result.action).toBe("appended");
    expect(readFileSync(join(root, DEST_REL), "utf8")).toBe(userBody);
  });
});
