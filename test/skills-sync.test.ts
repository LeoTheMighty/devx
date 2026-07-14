// pin101 — E-2: repo commands cannot silently diverge from packaged skills.
//
// Part of the default vitest suite, so any byte of drift between
// .claude/commands/*.md (canonical) and skills/*.md (shipped mirror) fails
// `npm test`, naming the divergent file. Also drives the sync script's
// diffMirror/syncMirror against tmp fixtures: missing / divergent / orphaned
// files are each named, sync repairs all three, and the canonical dir is
// never written.
//
// Spec: dev/dev-pin101-2026-07-14T12:00-packaged-skills-mirror.md

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { diffMirror, syncMirror } from "../scripts/sync-skills.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDir = join(repoRoot, ".claude", "commands");
const mirrorDir = join(repoRoot, "skills");

const EXPECTED_SKILLS = ["devx.md", "devx-plan.md", "devx-interview.md"];

const canonicalNames = readdirSync(canonicalDir)
  .filter((n) => n.endsWith(".md"))
  .sort();

describe("pin101 — skills/ mirror is byte-identical to .claude/commands/ (drift guard)", () => {
  it("canonical side carries the 3 expected skill bodies", () => {
    for (const name of EXPECTED_SKILLS) {
      expect(canonicalNames, `.claude/commands/${name} missing`).toContain(name);
    }
  });

  it.each(canonicalNames)("skills/%s matches .claude/commands/%s byte-for-byte", (name) => {
    const shipped = join(mirrorDir, name);
    expect(
      existsSync(shipped),
      `skills/${name} missing — run \`npm run sync:skills\` and commit`,
    ).toBe(true);
    const same = readFileSync(join(canonicalDir, name)).equals(readFileSync(shipped));
    expect(
      same,
      `skills/${name} diverges from .claude/commands/${name} — run \`npm run sync:skills\` and commit`,
    ).toBe(true);
  });

  it("mirror has no orphaned files", () => {
    const orphans = readdirSync(mirrorDir)
      .filter((n) => n.endsWith(".md"))
      .filter((n) => !canonicalNames.includes(n));
    expect(orphans, `orphaned mirror files: ${orphans.join(", ")}`).toEqual([]);
  });

  it("`node scripts/sync-skills.mjs --check` exits 0 on the committed tree", () => {
    const out = execFileSync(process.execPath, ["scripts/sync-skills.mjs", "--check"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(out).toContain("in sync");
  });

  it("unknown args exit 2 instead of silently falling into write mode", () => {
    const r = spawnSync(process.execPath, ["scripts/sync-skills.mjs", "--chek"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown argument");
  });
});

describe("pin101 — diffMirror / syncMirror (tmp fixtures)", () => {
  let tmp: string;

  function fixture() {
    tmp = mkdtempSync(join(tmpdir(), "devx-skills-sync-"));
    const canonical = join(tmp, "commands");
    const mirror = join(tmp, "skills");
    mkdirSync(canonical, { recursive: true });
    mkdirSync(mirror, { recursive: true });
    writeFileSync(join(canonical, "devx.md"), "# devx body\n");
    writeFileSync(join(canonical, "devx-plan.md"), "# plan body\n");
    writeFileSync(join(mirror, "devx.md"), "# devx body\n");
    writeFileSync(join(mirror, "devx-plan.md"), "# plan body\n");
    return { canonical, mirror };
  }

  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("returns [] when in sync", () => {
    const { canonical, mirror } = fixture();
    expect(diffMirror(canonical, mirror)).toEqual([]);
  });

  it("names a divergent file", () => {
    const { canonical, mirror } = fixture();
    writeFileSync(join(mirror, "devx.md"), "# stale body\n");
    const problems = diffMirror(canonical, mirror);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("skills/devx.md");
    expect(problems[0]).toContain("diverges");
  });

  it("names a missing mirror file", () => {
    const { canonical, mirror } = fixture();
    rmSync(join(mirror, "devx-plan.md"));
    const problems = diffMirror(canonical, mirror);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("skills/devx-plan.md");
    expect(problems[0]).toContain("missing");
  });

  it("names an orphaned mirror file", () => {
    const { canonical, mirror } = fixture();
    writeFileSync(join(mirror, "retired.md"), "# gone from canonical\n");
    const problems = diffMirror(canonical, mirror);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("skills/retired.md");
    expect(problems[0]).toContain("orphaned");
  });

  it("flags an empty/absent canonical dir instead of reporting clean", () => {
    const { mirror } = fixture();
    const empty = join(tmp, "empty-commands");
    mkdirSync(empty);
    expect(diffMirror(empty, mirror).length).toBeGreaterThan(0);
    expect(diffMirror(join(tmp, "nope"), mirror).length).toBeGreaterThan(0);
  });

  it("syncMirror repairs divergent + missing + orphaned in one pass, one-way only", () => {
    const { canonical, mirror } = fixture();
    writeFileSync(join(mirror, "devx.md"), "# stale body\n");
    rmSync(join(mirror, "devx-plan.md"));
    writeFileSync(join(mirror, "retired.md"), "# orphan\n");
    const canonicalBefore = statSync(join(canonical, "devx.md")).mtimeMs;

    const synced = syncMirror(canonical, mirror);

    expect(synced.sort()).toEqual(["devx-plan.md", "devx.md"]);
    expect(diffMirror(canonical, mirror)).toEqual([]);
    expect(existsSync(join(mirror, "retired.md"))).toBe(false);
    // canonical side untouched (one-way contract)
    expect(readFileSync(join(canonical, "devx.md"), "utf8")).toBe("# devx body\n");
    expect(statSync(join(canonical, "devx.md")).mtimeMs).toBe(canonicalBefore);
  });

  it("syncMirror creates the mirror dir when absent", () => {
    const { canonical } = fixture();
    const fresh = join(tmp, "fresh-skills");
    syncMirror(canonical, fresh);
    expect(diffMirror(canonical, fresh)).toEqual([]);
  });

  it("syncMirror refuses to run against an empty canonical dir", () => {
    const { mirror } = fixture();
    const empty = join(tmp, "empty-commands");
    mkdirSync(empty);
    expect(() => syncMirror(empty, mirror)).toThrow(/no \.md files/);
    // mirror untouched by the refused run
    expect(existsSync(join(mirror, "devx.md"))).toBe(true);
  });
});
