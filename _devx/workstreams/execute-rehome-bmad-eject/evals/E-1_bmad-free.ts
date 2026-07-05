// E-1 (P0): the execution surface is BMAD-free. RED until v2x101 merges.
// Runnable standalone: `npx tsx <this file>` — exit 0 = expectation met.
// Scope mirrors the v2x101 AC exemption list: frozen _bmad-output/ history,
// v2/ capture docs, dev/ + plan/ specs, docs/, and LEARN.md may keep
// historical mentions; the LIVE surfaces may not.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

// (a) No BMAD skill directories survive.
const skillsDir = join(repoRoot, ".claude", "skills");
if (existsSync(skillsDir)) {
  const bmadSkills = readdirSync(skillsDir).filter((d) => d.startsWith("bmad-"));
  if (bmadSkills.length > 0) {
    failures.push(`.claude/skills/ still has ${bmadSkills.length} bmad-* dirs (e.g. ${bmadSkills[0]})`);
  }
}

// (b) No _bmad/ manifest tree.
if (existsSync(join(repoRoot, "_bmad"))) failures.push("_bmad/ still exists");

// (c) No LIVE references in src/ and .claude/commands/. Exemption (per the
// v2x101 AC): lines whose only bmad mention is an archival pointer into the
// frozen `_bmad-output/` history (module headers cite their epic files by
// path — provenance, not dependency). A line is a violation iff it matches
// /bmad/i and does not reference `_bmad-output/`.
for (const dir of ["src", join(".claude", "commands")]) {
  let out = "";
  try {
    out = execFileSync("grep", ["-rina", "bmad", join(repoRoot, dir)], {
      encoding: "utf8",
    });
  } catch {
    out = ""; // grep exit 1 = no matches = good
  }
  // Second exemption: the config deprecation shim (FR-3) exists precisely
  // to detect and name the retired `bmad:` key — its own strings are the
  // warning, not a live dependency.
  // config-validate.ts is exempt wholesale: it hosts warnDeprecatedBmadKey,
  // the FR-3 shim whose entire purpose is naming the retired `bmad:` key.
  // The detector cannot be a violation of the thing it detects.
  const liveHits = out
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.includes("_bmad-output/"))
    .filter((line) => !line.includes("src/lib/config-validate.ts"));
  if (liveHits.length > 0) {
    failures.push(`${dir} has ${liveHits.length} live bmad reference(s): ${liveHits.slice(0, 3).join(" | ").slice(0, 300)}`);
  }
}

// (d) No bmad: config section.
const config = readFileSync(join(repoRoot, "devx.config.yaml"), "utf8");
if (/^bmad:/m.test(config)) failures.push("devx.config.yaml still has a top-level bmad: block");

// (e) Legacy commands gone.
for (const legacy of ["dev.md", "dev-plan.md"]) {
  if (existsSync(join(repoRoot, ".claude", "commands", legacy))) {
    failures.push(`.claude/commands/${legacy} still exists`);
  }
}

if (failures.length > 0) {
  console.error(`E-1 RED — execution surface is not BMAD-free:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-1 GREEN — execution surface is BMAD-free.");
