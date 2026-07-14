// pin102 — Skills installer library (src/lib/init-skills.ts).
//
// Truth table for the pure decision fn plus fs tests for the impure applier.
// Applier tests run in mkdtemp sandboxes; the packaged-skills-root default is
// exercised once against the real `skills/` dir (resolution technique mirrors
// init-write's templatesRoot).

import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  decideSkillInstall,
  installSkills,
  parseSkillHeader,
  skillHeaderLine,
} from "../src/lib/init-skills.js";
import { writeAtomic } from "../src/lib/supervisor-internal.js";

const V = "0.1.0";
const HEADER_V = `<!-- devx-skill v${V} -->`;

function headered(version: string, body: string): string {
  return `<!-- devx-skill v${version} -->\n${body}`;
}

// ---------------------------------------------------------------------------
// parseSkillHeader
// ---------------------------------------------------------------------------

describe("pin102 — parseSkillHeader", () => {
  it("extracts the version from a line-1 header", () => {
    expect(parseSkillHeader(headered("0.1.0", "# body\n"))).toBe("0.1.0");
  });

  it("accepts semver+sha build metadata (pin104 forward-compat)", () => {
    expect(parseSkillHeader(headered("0.1.0+abc1234", "# body\n"))).toBe("0.1.0+abc1234");
  });

  it("returns null for headerless content", () => {
    expect(parseSkillHeader("# my own command\n")).toBeNull();
  });

  it("returns null when the header is not on line 1", () => {
    expect(parseSkillHeader(`# title\n${HEADER_V}\n`)).toBeNull();
  });

  it("tolerates CRLF line endings (git autocrlf must not flip ownership)", () => {
    expect(parseSkillHeader(`${HEADER_V}\r\n# body\r\n`)).toBe(V);
  });

  it("tolerates trailing whitespace on the header line", () => {
    expect(parseSkillHeader(`${HEADER_V}  \n# body\n`)).toBe(V);
  });

  it("tolerates a leading BOM", () => {
    expect(parseSkillHeader(`﻿${HEADER_V}\n# body\n`)).toBe(V);
  });

  it("parses a header-only file with no trailing newline", () => {
    expect(parseSkillHeader(HEADER_V)).toBe(V);
  });
});

// ---------------------------------------------------------------------------
// decideSkillInstall — the truth table
// ---------------------------------------------------------------------------

describe("pin102 — decideSkillInstall truth table", () => {
  it("absent → write", () => {
    expect(decideSkillInstall({ existing: null, incomingVersion: V })).toBe("write");
  });

  it("header + older version → overwrite", () => {
    expect(
      decideSkillInstall({ existing: headered("0.0.9", "old\n"), incomingVersion: V }),
    ).toBe("overwrite");
  });

  it("header + same version → skip-same-version (no-op)", () => {
    expect(
      decideSkillInstall({ existing: headered(V, "same\n"), incomingVersion: V }),
    ).toBe("skip-same-version");
  });

  it("header + newer version → overwrite (converge to the installed package)", () => {
    // Documented convergence rule: a devx-skill header marks the file
    // machine-owned; any version mismatch (older OR newer/different sha)
    // converges the file to the installing package's payload. The header is
    // an ownership marker, not a precedence record.
    expect(
      decideSkillInstall({ existing: headered("9.9.9", "future\n"), incomingVersion: V }),
    ).toBe("overwrite");
  });

  it("header + same semver, different sha → overwrite (rebuild wins)", () => {
    expect(
      decideSkillInstall({
        existing: headered("0.1.0+aaaaaaa", "old build\n"),
        incomingVersion: "0.1.0+bbbbbbb",
      }),
    ).toBe("overwrite");
  });

  it("headerless existing file → skip-user-owned", () => {
    expect(
      decideSkillInstall({ existing: "# hand-rolled command\n", incomingVersion: V }),
    ).toBe("skip-user-owned");
  });

  it("empty existing file → skip-user-owned (conservative: unclassifiable ≠ ours)", () => {
    expect(decideSkillInstall({ existing: "", incomingVersion: V })).toBe("skip-user-owned");
  });

  it("force overrides skip-user-owned → overwrite", () => {
    expect(
      decideSkillInstall({ existing: "# hand-rolled\n", incomingVersion: V, force: true }),
    ).toBe("overwrite");
  });

  it("force overrides skip-same-version → overwrite", () => {
    expect(
      decideSkillInstall({ existing: headered(V, "same\n"), incomingVersion: V, force: true }),
    ).toBe("overwrite");
  });

  it("force on absent file is still a plain write", () => {
    expect(decideSkillInstall({ existing: null, incomingVersion: V, force: true })).toBe("write");
  });
});

// ---------------------------------------------------------------------------
// installSkills — the applier
// ---------------------------------------------------------------------------

describe("pin102 — installSkills applier", () => {
  let sandbox: string;
  let skillsRoot: string;
  let targetDir: string;
  let manualPath: string;
  const NOW = new Date("2026-07-14T12:00:00.000Z");

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "pin102-"));
    skillsRoot = join(sandbox, "skills");
    targetDir = join(sandbox, "target", ".claude", "commands");
    manualPath = join(sandbox, "MANUAL.md");
    mkdirSync(skillsRoot, { recursive: true });
    writeFileSync(join(skillsRoot, "devx.md"), "# /devx body\n");
    writeFileSync(join(skillsRoot, "devx-plan.md"), "# /devx-plan body\n");
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function run(opts: { force?: boolean; version?: string } = {}) {
    return installSkills({
      targetDir,
      version: opts.version ?? V,
      force: opts.force,
      skillsRoot,
      manualPath,
      now: () => NOW,
    });
  }

  it("fresh target: writes every packaged skill with the header as line 1", () => {
    const outcomes = run();
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.action === "write")).toBe(true);

    const installed = readFileSync(join(targetDir, "devx.md"), "utf8");
    expect(installed.split("\n")[0]).toBe(HEADER_V);
    expect(installed).toBe(`${HEADER_V}\n# /devx body\n`);
  });

  it("re-run at the same version is a no-op (idempotent)", () => {
    run();
    const before = readFileSync(join(targetDir, "devx.md"), "utf8");
    const outcomes = run();
    expect(outcomes.every((o) => o.action === "skip-same-version")).toBe(true);
    expect(readFileSync(join(targetDir, "devx.md"), "utf8")).toBe(before);
  });

  it("upgrade: header-bearing files at an older version are overwritten", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "devx.md"), headered("0.0.9", "stale body\n"));
    const outcomes = run();
    const devx = outcomes.find((o) => o.file === "devx.md");
    expect(devx?.action).toBe("overwrite");
    expect(readFileSync(join(targetDir, "devx.md"), "utf8")).toBe(`${HEADER_V}\n# /devx body\n`);
  });

  it("headerless user file: preserved byte-identical + one MANUAL.md entry", () => {
    mkdirSync(targetDir, { recursive: true });
    const userBody = "# my own devx command — hands off\n";
    writeFileSync(join(targetDir, "devx.md"), userBody);

    const outcomes = run();
    const devx = outcomes.find((o) => o.file === "devx.md");
    expect(devx?.action).toBe("skip-user-owned");
    expect(devx?.manualAppended).toBe(true);
    expect(readFileSync(join(targetDir, "devx.md"), "utf8")).toBe(userBody);

    const manual = readFileSync(manualPath, "utf8");
    expect(manual).toContain("devx.md");
    expect(manual).toContain("user-owned");

    // Other packaged skills still installed — skip never aborts the run.
    expect(readFileSync(join(targetDir, "devx-plan.md"), "utf8")).toContain("# /devx-plan body");
  });

  it("skip-user-owned MANUAL entry is idempotent across re-runs", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "devx.md"), "# user file\n");
    run();
    const outcomes = run();
    const devx = outcomes.find((o) => o.file === "devx.md");
    expect(devx?.action).toBe("skip-user-owned");
    expect(devx?.manualAppended).toBe(false);

    const manual = readFileSync(manualPath, "utf8");
    const hits = manual.split("devx.md").length - 1;
    // The anchor comment + the bullet title mention the file; a re-run must
    // not add a second bullet.
    expect(manual.match(/- \[ \]/g)?.length).toBe(1);
    expect(hits).toBeGreaterThan(0);
  });

  it("force: user-owned file is overwritten and no MANUAL entry is filed", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "devx.md"), "# user file\n");
    const outcomes = run({ force: true });
    const devx = outcomes.find((o) => o.file === "devx.md");
    expect(devx?.action).toBe("overwrite");
    expect(devx?.manualAppended).toBeUndefined();
    expect(readFileSync(join(targetDir, "devx.md"), "utf8")).toBe(`${HEADER_V}\n# /devx body\n`);
  });

  it("directory squatting on a skill path → skip-user-owned, not a crash; other files install", () => {
    mkdirSync(join(targetDir, "devx.md"), { recursive: true });
    const outcomes = run();
    const devx = outcomes.find((o) => o.file === "devx.md");
    expect(devx?.action).toBe("skip-user-owned");
    expect(devx?.manualAppended).toBe(true);
    expect(readFileSync(join(targetDir, "devx-plan.md"), "utf8")).toContain("# /devx-plan body");
  });

  it("injected write failure (read-only targetDir): throws and leaves no tmp droppings", () => {
    mkdirSync(targetDir, { recursive: true });
    chmodSync(targetDir, 0o555);
    try {
      expect(() => run()).toThrow();
      const droppings = readdirSync(targetDir).filter((f) => f.includes(".tmp."));
      expect(droppings).toEqual([]);
    } finally {
      chmodSync(targetDir, 0o755);
    }
  });

  it("injected rename failure inside writeAtomic: tmp is cleaned up", () => {
    // Directly pin writeAtomic's unlink-on-failure leg: renaming a file over
    // an existing directory throws after the tmp was written.
    const dir = join(sandbox, "rename-fail");
    mkdirSync(join(dir, "victim"), { recursive: true });
    expect(() => writeAtomic(join(dir, "victim"), "contents")).toThrow();
    const droppings = readdirSync(dir).filter((f) => f.includes(".tmp."));
    expect(droppings).toEqual([]);
  });

  it("MANUAL entries are keyed per target path — repo + global installs both report", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "devx.md"), "# user file\n");
    run();
    const globalTarget = join(sandbox, "home", ".claude", "commands");
    mkdirSync(globalTarget, { recursive: true });
    writeFileSync(join(globalTarget, "devx.md"), "# другой user file\n");
    const outcomes = installSkills({
      targetDir: globalTarget,
      version: V,
      skillsRoot,
      manualPath,
      now: () => NOW,
    });
    expect(outcomes.find((o) => o.file === "devx.md")?.manualAppended).toBe(true);
    const manual = readFileSync(manualPath, "utf8");
    expect(manual.match(/- \[ \]/g)?.length).toBe(2);
  });

  it("outcome targetPath is absolute even for a relative targetDir", () => {
    const prevCwd = process.cwd();
    process.chdir(sandbox);
    try {
      const outcomes = installSkills({
        targetDir: "rel-target",
        version: V,
        skillsRoot,
        manualPath,
        now: () => NOW,
      });
      expect(outcomes.every((o) => isAbsolute(o.targetPath))).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it("subdirectory named *.md inside skillsRoot is ignored, not read", () => {
    mkdirSync(join(skillsRoot, "not-a-skill.md"), { recursive: true });
    const outcomes = run();
    expect(outcomes.map((o) => o.file)).not.toContain("not-a-skill.md");
    expect(outcomes).toHaveLength(2);
  });

  it("missing skillsRoot → contextual error, not a raw ENOENT", () => {
    expect(() =>
      installSkills({
        targetDir,
        version: V,
        skillsRoot: join(sandbox, "no-such-dir"),
        manualPath,
        now: () => NOW,
      }),
    ).toThrow(/packaged skills dir not found/);
  });

  it("whitespace-bearing or empty version is refused up front", () => {
    expect(() => run({ version: "0.1.0 beta" })).toThrow(/no whitespace/);
    expect(() => run({ version: "" })).toThrow(/no whitespace/);
  });

  it("CRLF-converted machine-owned file still upgrades", () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "devx.md"), `<!-- devx-skill v0.0.9 -->\r\nstale\r\n`);
    const outcomes = run();
    expect(outcomes.find((o) => o.file === "devx.md")?.action).toBe("overwrite");
  });

  it("default skillsRoot resolves the packaged skills/ dir relative to the module", () => {
    const realTarget = join(sandbox, "real-target");
    const outcomes = installSkills({
      targetDir: realTarget,
      version: V,
      manualPath,
      now: () => NOW,
    });
    // The repo's packaged skills/ dir ships devx.md, devx-plan.md,
    // devx-interview.md (pin101).
    const files = outcomes.map((o) => o.file).sort();
    expect(files).toContain("devx.md");
    expect(files).toContain("devx-plan.md");
    expect(files).toContain("devx-interview.md");
    const installed = readFileSync(join(realTarget, "devx.md"), "utf8");
    expect(parseSkillHeader(installed)).toBe(V);
  });
});

// ---------------------------------------------------------------------------
// skillHeaderLine
// ---------------------------------------------------------------------------

describe("pin102 — skillHeaderLine", () => {
  it("renders the canonical marker", () => {
    expect(skillHeaderLine("0.1.0")).toBe("<!-- devx-skill v0.1.0 -->");
    expect(skillHeaderLine("0.1.0+abc1234")).toBe("<!-- devx-skill v0.1.0+abc1234 -->");
  });
});
