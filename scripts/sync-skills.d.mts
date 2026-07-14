// Type declarations for scripts/sync-skills.mjs.
// The script is JS by design (runs via `npm run sync:skills` without a build
// step). This file exists only so vitest tests can import it under strict TS.

/**
 * Compare canonical vs mirror. Returns human-readable problems, each naming
 * the offending file (empty = in sync).
 */
export function diffMirror(canonical?: string, mirror?: string): string[];

/**
 * Refresh the mirror in place (writes only under the mirror dir; removes
 * orphans). Returns the canonical file names synced. Throws if the canonical
 * dir has no .md files.
 */
export function syncMirror(canonical?: string, mirror?: string): string[];
