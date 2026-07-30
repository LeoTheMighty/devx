// E-6 (P0): the wire-protocol pin — hook pattern ⊂ nudge-canonical marker prose.
// RED until Phase 1 (nudge.ts) merges. Runnable standalone: `npx tsx <this file>`.
// Asserts NUDGE_PATTERN (the real exported constant) is a whitespace-collapsed
// substring of the prose following the `nudge-canonical` marker in
// .claude/commands/devx-learn.md, and that the comparison actually has teeth:
// two in-memory mutations of the marker prose (reworded verb, deleted clause)
// must break the containment. Permanent suite: test/learn-nudge-pin.test.ts.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const failures: string[] = [];

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

const body = readFileSync(join(repoRoot, ".claude", "commands", "devx-learn.md"), "utf8");
const afterMarker = body.split("<!-- nudge-canonical -->")[1] ?? "";
const prose = collapse(afterMarker.trim().split(/\n\n/)[0]);
if (prose === "") {
  failures.push("nudge-canonical marker missing or empty in .claude/commands/devx-learn.md");
}

try {
  const nudge = await import("../../../../src/lib/learn/nudge.js").catch(() => null);
  if (!nudge) {
    failures.push("src/lib/learn/nudge.ts missing — feature not implemented (T1.1)");
  } else {
    const pattern = collapse(String(nudge.NUDGE_PATTERN ?? ""));
    if (pattern.length < 20) {
      failures.push(`NUDGE_PATTERN suspiciously short (${pattern.length} chars) — not a real substring pin`);
    }
    // (a) containment against the live marker.
    if (!prose.includes(pattern)) {
      failures.push(
        `NUDGE_PATTERN is not a whitespace-collapsed substring of the marker prose —\n    pattern: ${pattern}\n    marker:  ${prose}`,
      );
    }
    // (b) mutation 1: reworded verb — containment must break.
    const reworded = prose.replace("run", "execute");
    if (reworded !== prose && reworded.includes(pattern)) {
      failures.push("reworded marker still contains the pattern — the pin has no teeth (pattern too generic)");
    }
    // (c) mutation 2: deleted clause — containment must break.
    const midpoint = Math.floor(prose.length / 2);
    const deleted = prose.slice(0, midpoint - 20) + prose.slice(midpoint + 20);
    if (deleted.includes(pattern)) {
      failures.push("clause-deleted marker still contains the pattern — the pin has no teeth");
    }
    // (d) containsNudge collapses whitespace (hard-wrapped copies detect).
    if (typeof nudge.containsNudge === "function") {
      const hardWrapped = prose.replace(/ /g, (m, i) => (i % 30 === 0 ? "\n   " : m));
      if (!nudge.containsNudge(hardWrapped)) {
        failures.push("containsNudge misses a hard-wrapped copy — wording equality, not byte equality");
      }
    } else {
      failures.push("nudge.ts exports no containsNudge — matcher missing (T1.1)");
    }
  }
} catch (e) {
  failures.push(`unexpected error: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
}

if (failures.length > 0) {
  console.error(`E-6 FAIL (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("E-6 PASS — wire-protocol pin holds");
