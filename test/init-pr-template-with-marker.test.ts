// prt101 — file-present-with-marker branch.
//
// When .github/pull_request_template.md already exists AND contains the
// `<!-- devx:mode -->` idempotency marker (e.g. a prior /devx-init run),
// writePrTemplate must skip without diff. Critical for re-runs: the user's
// hand-edits below the marker survive, and we never overwrite our own prior
// canonical block.
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

describe("writePrTemplate — existing file with marker", () => {
  it("skips when the file already contains the canonical marker", () => {
    const root = mkRepo("prt101-marker-");
    const seeded = [
      "<!-- devx:mode -->",
      "**Spec:** `<dev/dev-foo-bar.md>`",
      "**Mode:** <!-- devx:auto:mode --> *(stamped at PR-open by /devx)*",
      "",
      "## hand-edited section",
      "user added this — must survive",
      "",
    ].join("\n");
    const dest = seedTemplate(root, seeded);

    const result = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });

    expect(result.action).toBe("skipped");
    expect(result.path).toBe(dest);
    // No diff: the hand-edited section must remain untouched.
    expect(readFileSync(dest, "utf8")).toBe(seeded);
  });

  it("skips when the marker is buried mid-file (e.g. user wrapped it in a custom section)", () => {
    const root = mkRepo("prt101-marker-buried-");
    const seeded = [
      "# Custom user template",
      "",
      "Some preamble the user wrote.",
      "",
      "## devx",
      "<!-- devx:mode -->",
      "**Spec:** `<dev/dev-foo-bar.md>`",
      "",
      "## More user content below",
      "",
    ].join("\n");
    seedTemplate(root, seeded);

    const result = writePrTemplate(root, { templatesRoot: TEMPLATES_ROOT });

    expect(result.action).toBe("skipped");
    expect(readFileSync(join(root, DEST_REL), "utf8")).toBe(seeded);
  });

  it("dryRun on existing-with-marker also reports skipped without touching disk", () => {
    const root = mkRepo("prt101-marker-dryrun-");
    const seeded = "<!-- devx:mode -->\nbody\n";
    seedTemplate(root, seeded);

    const result = writePrTemplate(root, {
      templatesRoot: TEMPLATES_ROOT,
      dryRun: true,
    });

    expect(result.action).toBe("skipped");
    expect(readFileSync(join(root, DEST_REL), "utf8")).toBe(seeded);
  });
});
