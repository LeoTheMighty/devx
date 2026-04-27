// init-interview.ts tests (ini504).
//
// Coverage target — the AC scenarios that apply to interview seeding:
//   - INTERVIEW.md empty-state → 3 stack-templated questions written
//   - INTERVIEW.md already has content → never overwritten
//   - Stack mapping: typescript→ts, mixed→empty, every other stack passthrough

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  mapStackToTemplate,
  seedInterview,
} from "../src/lib/init-interview.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = resolve(HERE, "..", "_devx", "templates", "init");
const HEADER_PATH = resolve(
  HERE,
  "..",
  "_devx",
  "templates",
  "init",
  "backlog-headers",
  "INTERVIEW.md.header",
);

function mkRepo(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function readHeaderTemplate(): string {
  return readFileSync(HEADER_PATH, "utf8");
}

// ---------------------------------------------------------------------------
// mapStackToTemplate
// ---------------------------------------------------------------------------

describe("ini504 — mapStackToTemplate", () => {
  it("maps typescript → ts and passes others through", () => {
    expect(mapStackToTemplate("typescript")).toBe("ts");
    expect(mapStackToTemplate("python")).toBe("python");
    expect(mapStackToTemplate("rust")).toBe("rust");
    expect(mapStackToTemplate("go")).toBe("go");
    expect(mapStackToTemplate("flutter")).toBe("flutter");
    expect(mapStackToTemplate("empty")).toBe("empty");
  });

  it("maps 'mixed' to 'empty' (no signal which stack is primary)", () => {
    expect(mapStackToTemplate("mixed")).toBe("empty");
  });
});

// ---------------------------------------------------------------------------
// seedInterview — happy path
// ---------------------------------------------------------------------------

describe("ini504 — seedInterview — empty-state seeds questions", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-iv-fresh-");
    writeFileSync(join(repo, "INTERVIEW.md"), readHeaderTemplate());
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("seeds the typescript template when the stack is typescript", () => {
    const r = seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: TEMPLATES_ROOT,
    });
    expect(r.outcome).toBe("seeded");
    expect(r.template).toBe("ts");
    const body = readFileSync(join(repo, "INTERVIEW.md"), "utf8");
    // Empty-state header still present (auto-delete is a separate concern).
    expect(body).toContain("<!-- devx-empty-state-start -->");
    expect(body).toContain("<!-- devx-empty-state-end -->");
    // Three (from /devx-init) questions present.
    const matches = body.match(/\(from \/devx-init\)/g) ?? [];
    expect(matches.length).toBe(3);
    // TS-specific content.
    expect(body).toContain("Test runner — vitest");
  });

  it("seeds three questions for every supported stack template", () => {
    for (const stack of [
      "typescript",
      "python",
      "rust",
      "go",
      "flutter",
      "empty",
      "mixed",
    ] as const) {
      // Reset the file to empty-state for each iteration.
      writeFileSync(join(repo, "INTERVIEW.md"), readHeaderTemplate());
      const r = seedInterview({
        repoRoot: repo,
        stack,
        templatesRoot: TEMPLATES_ROOT,
      });
      expect(r.outcome).toBe("seeded");
      const body = readFileSync(join(repo, "INTERVIEW.md"), "utf8");
      const matches = body.match(/\(from \/devx-init\)/g) ?? [];
      expect(matches.length).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// seedInterview — idempotent / non-empty target
// ---------------------------------------------------------------------------

describe("ini504 — seedInterview — never overwrites existing questions", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-iv-rerun-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("skips when INTERVIEW.md already has a checkbox item past the empty-state block", () => {
    const body =
      readHeaderTemplate() +
      "\n## A user-filed question\n\n- [ ] Decide on the foo.\n";
    writeFileSync(join(repo, "INTERVIEW.md"), body);

    const r = seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: TEMPLATES_ROOT,
    });
    expect(r.outcome).toBe("skipped-already-has-content");
    // Body must be byte-identical.
    expect(readFileSync(join(repo, "INTERVIEW.md"), "utf8")).toBe(body);
  });

  it("re-running on an already-seeded INTERVIEW.md doesn't double-seed", () => {
    writeFileSync(join(repo, "INTERVIEW.md"), readHeaderTemplate());
    seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: TEMPLATES_ROOT,
    });
    const after1 = readFileSync(join(repo, "INTERVIEW.md"), "utf8");
    const r2 = seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: TEMPLATES_ROOT,
    });
    expect(r2.outcome).toBe("skipped-already-has-content");
    expect(readFileSync(join(repo, "INTERVIEW.md"), "utf8")).toBe(after1);
  });

  it("treats prose past the empty-state block as content (non-empty state)", () => {
    const body =
      readHeaderTemplate() + "\nLeonid wrote a free-form note here.\n";
    writeFileSync(join(repo, "INTERVIEW.md"), body);
    const r = seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: TEMPLATES_ROOT,
    });
    expect(r.outcome).toBe("skipped-already-has-content");
  });
});

// ---------------------------------------------------------------------------
// seedInterview — defensive failure modes
// ---------------------------------------------------------------------------

describe("ini504 — seedInterview — defensive paths", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-iv-defensive-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("does not silently create INTERVIEW.md if it's missing", () => {
    // Don't write INTERVIEW.md — simulate ini502 ordering bug.
    const r = seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: TEMPLATES_ROOT,
    });
    expect(r.outcome).toBe("skipped-missing-target");
    expect(existsSync(join(repo, "INTERVIEW.md"))).toBe(false);
  });

  it("reports skipped-missing-template if the template file is absent", () => {
    writeFileSync(join(repo, "INTERVIEW.md"), readHeaderTemplate());
    // Point templatesRoot at the repo (which has no interview-seed-*.md).
    const r = seedInterview({
      repoRoot: repo,
      stack: "typescript",
      templatesRoot: repo,
    });
    expect(r.outcome).toBe("skipped-missing-template");
  });
});
