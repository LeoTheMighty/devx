// Preference-bank drift lint (§29 port). Enforcement lives here rather than
// in a CLI, matching this repo's existing idiom for cross-file invariants
// (see test/skills-sync.test.ts for the packaged-skills mirror).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  lintPersonalization,
  parseOwners,
  parseRegistry,
  parseSkill,
  splitRow,
} from "../src/lib/personalization/lint.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryMd = readFileSync(join(repoRoot, "docs/PERSONALIZATION.md"), "utf8");
const commandsDir = join(repoRoot, ".claude/commands");

const CARRIERS = [
  "devx",
  "devx-plan",
  "devx-learn",
  "devx-test",
  "devx-interview",
  "devx-walk",
];

describe("splitRow", () => {
  it("treats an escaped pipe as content, not a separator", () => {
    expect(splitRow("| `a` \\| `b` | second |")).toEqual(["`a` | `b`", "second"]);
  });
});

describe("parseOwners", () => {
  it("drops parenthetical qualifiers", () => {
    expect(parseOwners("devx (address arm), devx-learn")).toEqual([
      "devx",
      "devx-learn",
    ]);
  });

  it("keeps `all` as a literal token", () => {
    expect(parseOwners("all")).toEqual(["all"]);
  });
});

describe("parseRegistry", () => {
  const reg = parseRegistry(registryMd);

  it("reads the bank version", () => {
    expect(reg.bankVersion).toBe(1);
  });

  it("parses both banks", () => {
    expect(reg.keys.filter((k) => k.core).length).toBeGreaterThanOrEqual(9);
    expect(reg.keys.filter((k) => !k.core).length).toBeGreaterThanOrEqual(15);
  });

  it("carries role as a core key with a default and owners", () => {
    const k = reg.keys.find((x) => x.key === "role");
    expect(k?.core).toBe(true);
    expect(k?.defaultValue).toBe("both");
    expect(k?.owners).toContain("devx-plan");
  });

  it("does NOT bank the doc layout — it is engine.docs_layout in config", () => {
    // Routed out 2026-09-01 (PERSONALIZATION.md §3): it names where files the
    // whole repo shares get written, so it is repo policy, not a preference.
    // A regression here means a skill can declare it again and the bank would
    // silently accept an inert key.
    expect(reg.keys.map((k) => k.key)).not.toContain("docs.layout");
  });

  it("extracts the canonical preflight paragraph", () => {
    expect(reg.canonicalPreflight).toContain("<slot>");
    expect(reg.canonicalPreflight).toContain("void");
  });
});

describe("parseSkill", () => {
  it("anchors the table on the declaration line, not the marker phrase", () => {
    // `**Preference keys**` also appears mid-sentence inside the preflight
    // paragraph; an unanchored match scans the wrong table.
    const md = `## Something else

| Config key | Value |
| --- | --- |
| foo | bar |

## Step 0

**Preference keys** (resolved per \`docs/PERSONALIZATION.md\` §2):

| Key | Core | What it changes here |
| --- | :-: | --- |
| \`role\` | ● | altitude |
`;
    const d = parseSkill("x", md);
    expect(d.keys).toEqual([{ key: "role", core: true }]);
  });

  it("splits a cell declaring several keys", () => {
    const md = `**Preference keys** (x):

| Key | Core | What |
| --- | :-: | --- |
| \`notify.channel\` · \`notify.threshold\` | ● | pings |
`;
    expect(parseSkill("x", md).keys.map((k) => k.key)).toEqual([
      "notify.channel",
      "notify.threshold",
    ]);
  });
});

describe("lintPersonalization — synthetic drift is caught", () => {
  const reg = parseRegistry(registryMd);

  it("flags a banked key no skill declares", () => {
    const p = lintPersonalization(reg, []);
    expect(p.some((x) => x.kind === "banked-key-undeclared")).toBe(true);
  });

  it("flags a skill declaring a key that is not banked", () => {
    const p = lintPersonalization(reg, [
      { skill: "devx", keys: [{ key: "made.up", core: false }], preflight: null },
    ]);
    expect(p.some((x) => x.kind === "declared-key-unbanked")).toBe(true);
  });

  it("flags a core/non-core disagreement", () => {
    const p = lintPersonalization(reg, [
      { skill: "devx", keys: [{ key: "role", core: false }], preflight: null },
    ]);
    expect(p.some((x) => x.kind === "core-mismatch")).toBe(true);
  });

  it("flags a reworded preflight paragraph", () => {
    const p = lintPersonalization(reg, [
      {
        skill: "devx",
        keys: [],
        preflight:
          "**Profile preflight (docs/PERSONALIZATION.md).** Do whatever seems reasonable.",
      },
    ]);
    expect(p.some((x) => x.kind === "preflight-drift")).toBe(true);
  });
});

describe("the SHIPPED registry and skills agree", () => {
  it("has no drift in either direction", () => {
    const reg = parseRegistry(registryMd);
    const skills = CARRIERS.map((name) =>
      parseSkill(name, readFileSync(join(commandsDir, `${name}.md`), "utf8")),
    );
    const problems = lintPersonalization(reg, skills);
    expect(
      problems.map((p) => `${p.kind}: ${p.message}`),
      "preference-bank drift — fix docs/PERSONALIZATION.md or the skill's Preference keys table",
    ).toEqual([]);
  });

  it("every carrier's preflight is byte-equal to the registry's canonical wording", () => {
    const reg = parseRegistry(registryMd);
    // /devx-learn deliberately carries no preflight — a meta-skill that only
    // runs once everything else is unblocked is useless precisely when a
    // blocked session is worth retro-ing.
    for (const name of CARRIERS.filter((n) => n !== "devx-learn")) {
      const d = parseSkill(name, readFileSync(join(commandsDir, `${name}.md`), "utf8"));
      expect(d.preflight, `${name} carries no preflight paragraph`).not.toBeNull();
    }
    expect(parseSkill(
      "devx-learn",
      readFileSync(join(commandsDir, "devx-learn.md"), "utf8"),
    ).preflight).toBeNull();
  });
});
