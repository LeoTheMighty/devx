// Packaged-skills mirror sync — pin101 (workstream portability-install, Phase 1).
//
// Copies .claude/commands/*.md → skills/*.md so the skill bodies ship in the
// npm tarball (`package.json → files` includes `skills`). Copies flow ONE WAY:
// `.claude/commands/` is canonical and is NEVER written by this script
// (design.md § Resolved questions — copies-not-symlinks: npm pack drops
// symlinks, and a symlink would let a packaged edit bypass the drift gate).
//
// Modes:
//   node scripts/sync-skills.mjs           refresh skills/ from .claude/commands/
//   node scripts/sync-skills.mjs --check   exit 1 naming any missing/divergent/
//                                          orphaned file; writes nothing
//
// Spec: dev/dev-pin101-2026-07-14T12:00-packaged-skills-mirror.md

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalDir = join(repoRoot, ".claude", "commands");
const mirrorDir = join(repoRoot, "skills");

function listMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort();
}

/**
 * Compare canonical vs mirror. Returns a list of human-readable problems,
 * each naming the offending file (empty list = in sync).
 */
export function diffMirror(canonical = canonicalDir, mirror = mirrorDir) {
  const problems = [];
  const canonicalNames = listMd(canonical);
  if (canonicalNames.length === 0) {
    problems.push(`${canonical} contains no .md files (canonical side missing?)`);
    return problems;
  }
  for (const name of canonicalNames) {
    const shipped = join(mirror, name);
    if (!existsSync(shipped)) {
      problems.push(`skills/${name} missing (run: npm run sync:skills)`);
      continue;
    }
    if (!readFileSync(join(canonical, name)).equals(readFileSync(shipped))) {
      problems.push(`skills/${name} diverges from .claude/commands/${name} (run: npm run sync:skills)`);
    }
  }
  for (const name of listMd(mirror)) {
    if (!canonicalNames.includes(name)) {
      problems.push(`skills/${name} is orphaned — no .claude/commands/${name} (run: npm run sync:skills)`);
    }
  }
  return problems;
}

/** Refresh the mirror in place. Writes only under skills/. */
export function syncMirror(canonical = canonicalDir, mirror = mirrorDir) {
  const canonicalNames = listMd(canonical);
  if (canonicalNames.length === 0) {
    throw new Error(`${canonical} contains no .md files — refusing to empty the mirror`);
  }
  mkdirSync(mirror, { recursive: true });
  for (const name of canonicalNames) {
    writeFileSync(join(mirror, name), readFileSync(join(canonical, name)));
  }
  for (const name of listMd(mirror)) {
    if (!canonicalNames.includes(name)) rmSync(join(mirror, name));
  }
  return canonicalNames;
}

const invokedDirectly =
  process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    console.error(`unknown argument(s): ${unknown.join(", ")} — usage: sync-skills.mjs [--check]`);
    process.exit(2);
  }
  if (args.includes("--check")) {
    const problems = diffMirror();
    if (problems.length > 0) {
      console.error("skills mirror drift detected:");
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log("skills/ in sync with .claude/commands/.");
  } else {
    const names = syncMirror();
    console.log(`synced ${names.length} skill file(s) → skills/: ${names.join(", ")}`);
  }
}
