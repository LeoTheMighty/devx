// Persona seeding for `/devx-init` (ini504).
//
// Public surface:
//   - seedPersonas(opts) — given an N3 (who-for) answer, writes one
//       focus-group/personas/persona-<slug>.md skeleton per archetype, plus
//       the mandatory anti-persona. Returns a {created, skipped, source,
//       overflowResolved} summary so the orchestrator can echo it back to
//       the user.
//   - parseArchetypes(raw) — pure: splits a freeform answer into a list of
//       archetype strings. Exported for tests + for /devx-init's preview
//       echo (so the user sees what the parser saw before files land).
//   - DEFAULT_PERSONAS — the 4 real + 1 anti default panel used when the
//       user said "you propose."
//
// Behavior:
//   - "you propose" (case-insensitive) OR an empty answer → write the
//     5-template default panel (4 real + 1 anti).
//   - Any other answer → parse into archetypes, slugify each, write one
//     skeleton per archetype, then ALWAYS append the anti-persona (anti is
//     mandatory in either path, per ini504 AC).
//   - Files that already exist on disk are NEVER overwritten — re-runs are
//     safe. The orchestrator can call seedPersonas() on every /devx-init
//     invocation without churn.
//   - Panel size is capped at 6 (DESIGN.md §focus-group). If the user
//     provided 6+ real archetypes, seedPersonas calls the injected
//     `resolveOverflow` to let them merge or drop. Without a resolver we
//     throw PersonaOverflowError so the caller can file an INTERVIEW entry
//     instead of silently truncating.
//
// No interactive I/O in this module — every prompt the user sees comes
// through the injected resolver. Tests pass scripted resolvers.
//
// Spec: dev/dev-ini504-2026-04-26T19:35-init-personas-and-interview.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PersonaSeed {
  /** Slug used in the filename (`persona-<slug>.md`). Must be kebab-case. */
  slug: string;
  /** Display name in YAML frontmatter `name:`. */
  name: string;
  /** Single-line archetype description in `archetype:`. */
  archetype: string;
  /** Weight in the panel — sums to ~1.0 across the panel. */
  weight: number;
  /** True for the anti-persona. Adds `kind: anti-persona` to frontmatter. */
  isAnti?: boolean;
}

export type PersonaSource = "default" | "archetypes-given";

export interface SeedPersonasResult {
  /** Filenames (relative to focus-group/personas/) actually written. */
  created: string[];
  /** Filenames already on disk; left untouched. */
  skipped: string[];
  /** Which path the seeder took. */
  source: PersonaSource;
  /** True iff the user provided 6+ archetypes and the overflow resolver
   *  trimmed the list. */
  overflowResolved: boolean;
  /** The final panel that landed (created OR skipped — i.e. the union of
   *  what the user's `focus-group/personas/` should contain after this
   *  call). Useful for the /devx-init narrative summary. */
  panel: ReadonlyArray<PersonaSeed>;
}

export type ResolveOverflow = (
  archetypes: string[],
) => string[] | Promise<string[]>;

export class PersonaOverflowError extends Error {
  constructor(public readonly archetypes: string[]) {
    super(
      `Got ${archetypes.length} archetypes; cap is 6. Inject \`resolveOverflow\` to let the user merge or drop one.`,
    );
    this.name = "PersonaOverflowError";
  }
}

export interface SeedPersonasOpts {
  repoRoot: string;
  /** N3 (who-for) answer verbatim. "you propose" or empty → default panel. */
  whoFor: string;
  /** Override the templates dir. Defaults to the package's
   *  _devx/templates/init/personas/. */
  templatesRoot?: string;
  /** Override the timestamp embedded in the persona frontmatter (created /
   *  revised). Tests pin this. */
  now?: () => Date;
  /** Resolver for the 6+ archetype case. Receives the parsed list, returns
   *  a (typically trimmed) list of ≤6. If the resolver returns >6, we
   *  throw — the resolver is responsible for the cap. */
  resolveOverflow?: ResolveOverflow;
}

// ---------------------------------------------------------------------------
// Constants — the 4 real + 1 anti default panel.
// ---------------------------------------------------------------------------

/** The 5-template default. Names are intentionally generic (the user can
 *  rename or rewrite later) but the *roles* are deliberately chosen to span
 *  the design space focus-group sessions stress: a primary user, a power
 *  user pushing the edges, a skeptic that resists adoption, a newcomer who
 *  needs hand-holding, and one anti-persona who is NOT the audience. */
export const DEFAULT_PERSONAS: ReadonlyArray<PersonaSeed> = Object.freeze([
  {
    slug: "primary-user",
    name: "Primary",
    archetype:
      "Primary user — the person whose problem this product directly solves",
    weight: 0.4,
  },
  {
    slug: "power-user",
    name: "Power",
    archetype:
      "Power user — pushes the limits, finds edges, asks for escape hatches",
    weight: 0.2,
  },
  {
    slug: "skeptical-adopter",
    name: "Skeptic",
    archetype:
      "Skeptical adopter — wants proof and legibility before they commit",
    weight: 0.2,
  },
  {
    slug: "newcomer",
    name: "Newcomer",
    archetype:
      "Newcomer — first encounter with the space; needs the first-run experience to be obvious",
    weight: 0.15,
  },
  {
    slug: "anti-persona",
    name: "Anti",
    archetype: "Anti-persona — who this product is NOT for",
    weight: 0.05,
    isAnti: true,
  },
]);

const PANEL_CAP = 6;
const ANTI_DEFAULT: PersonaSeed = DEFAULT_PERSONAS[DEFAULT_PERSONAS.length - 1]!;

const SKELETON_PLACEHOLDERS = {
  name: "<!-- devx:persona-name -->",
  archetype: "<!-- devx:persona-archetype -->",
  weight: "<!-- devx:persona-weight -->",
  created: "<!-- devx:persona-created -->",
  kindLine: "<!-- devx:persona-kind-line -->",
} as const;

// ---------------------------------------------------------------------------
// Public entrypoints
// ---------------------------------------------------------------------------

export async function seedPersonas(
  opts: SeedPersonasOpts,
): Promise<SeedPersonasResult> {
  const { repoRoot, whoFor } = opts;
  const templatesRoot = opts.templatesRoot ?? defaultTemplatesRoot();
  const now = opts.now ?? (() => new Date());
  const skeleton = readSkeleton(templatesRoot);
  const personasDir = join(repoRoot, "focus-group", "personas");

  const trimmed = whoFor.trim();
  const isPropose =
    trimmed.length === 0 || /^you\s+propose\b/i.test(trimmed);

  let panel: PersonaSeed[];
  let source: PersonaSource;
  let overflowResolved = false;

  if (isPropose) {
    panel = [...DEFAULT_PERSONAS];
    source = "default";
  } else {
    const parsed = parseArchetypes(trimmed);
    source = "archetypes-given";

    // Anti-persona is always appended; the cap applies to the full panel
    // including anti, so the user's real-archetype budget is PANEL_CAP - 1.
    const realCap = PANEL_CAP - 1;
    let real = parsed;

    if (real.length > realCap) {
      if (!opts.resolveOverflow) {
        throw new PersonaOverflowError(real);
      }
      const resolved = await opts.resolveOverflow(real);
      if (!Array.isArray(resolved)) {
        throw new TypeError(
          "resolveOverflow must return string[] (or Promise<string[]>)",
        );
      }
      if (resolved.length > realCap) {
        // The resolver kept too many — surface it rather than silently
        // truncating, so the orchestrator can re-prompt. Truncating here
        // would override an explicit user choice.
        throw new PersonaOverflowError(resolved);
      }
      real = resolved.map((s) => s.trim()).filter((s) => s.length > 0);
      overflowResolved = true;
    }

    if (real.length === 0) {
      // Parser found nothing usable in a non-"you propose" answer — fall back
      // to defaults rather than dropping the whole panel. This covers the
      // "comma-only" or "all-blank" inputs that the parser strips to zero.
      panel = [...DEFAULT_PERSONAS];
      source = "default";
    } else {
      panel = buildPanelFromArchetypes(real);
    }
  }

  // Anti-persona is mandatory. buildPanelFromArchetypes already appends it;
  // for the default path it's already DEFAULT_PERSONAS[4]. Defense in depth:
  // if a future caller passes a custom default that omits anti, we add it.
  if (!panel.some((p) => p.isAnti)) {
    panel.push(ANTI_DEFAULT);
  }

  // Ensure the personas dir exists. ini502's writeInitFiles also creates it,
  // but seedPersonas is a public entrypoint and shouldn't crash if a caller
  // (now or future) invokes it before — or instead of — that scaffold step.
  mkdirSync(personasDir, { recursive: true });

  const result: SeedPersonasResult = {
    created: [],
    skipped: [],
    source,
    overflowResolved,
    panel,
  };

  for (const persona of panel) {
    const filename = `persona-${persona.slug}.md`;
    const path = join(personasDir, filename);
    if (existsSync(path)) {
      result.skipped.push(filename);
      continue;
    }
    const body = renderSkeleton(skeleton, persona, now());
    writeAtomic(path, body);
    result.created.push(filename);
  }

  return result;
}

/** Parse a freeform N3 answer into a list of archetype names.
 *
 *  Splits on commas, semicolons, and " and "/" & ". Drops empties and
 *  duplicates (case-insensitive). Returns the original casing of the first
 *  occurrence of each archetype.
 *
 *  Examples:
 *    "founders, devs, designers"        → ["founders","devs","designers"]
 *    "Solo founders; small-team CTOs"   → ["Solo founders","small-team CTOs"]
 *    "indie hackers and tinkerers"      → ["indie hackers","tinkerers"]
 */
export function parseArchetypes(raw: string): string[] {
  if (typeof raw !== "string") return [];
  // Strip leading "you propose" prefixes — sometimes the user writes
  // "you propose: founders, devs" — we still want those archetypes parsed.
  const stripped = raw.replace(/^\s*you\s+propose\s*[:,-]?\s*/i, "");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of stripped.split(/,|;|\sand\s|\s&\s|\n/)) {
    const t = piece.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers — pure
// ---------------------------------------------------------------------------

function buildPanelFromArchetypes(archetypes: string[]): PersonaSeed[] {
  // Even-distribute weights across the real personas, leaving 0.05 for the
  // anti. Round to 2 decimals; pin the last real entry to whatever's left
  // so the panel sums to 1.00 exactly. (Off-by-rounding here would make
  // re-runs of /devx-init produce different YAML — keep it deterministic.)
  const realWeightTotal = 0.95;
  const each = realWeightTotal / archetypes.length;
  const rounded = archetypes.map(() => Math.round(each * 100) / 100);
  const sum = rounded.reduce((a, b) => a + b, 0);
  const drift = Math.round((realWeightTotal - sum) * 100) / 100;
  if (rounded.length > 0) rounded[rounded.length - 1] = Math.round((rounded[rounded.length - 1]! + drift) * 100) / 100;

  const usedSlugs = new Set<string>();
  const seeds: PersonaSeed[] = archetypes.map((archetype, i) => {
    const baseSlug = slugify(archetype) || `persona-${i + 1}`;
    let slug = baseSlug;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    return {
      slug,
      name: titleCase(archetype),
      archetype,
      weight: rounded[i] ?? 0,
    };
  });

  // Append anti, with a guarded slug in case "anti-persona" is also a
  // user-supplied archetype.
  let antiSlug = ANTI_DEFAULT.slug;
  let antiSuffix = 2;
  while (usedSlugs.has(antiSlug)) {
    antiSlug = `${ANTI_DEFAULT.slug}-${antiSuffix}`;
    antiSuffix += 1;
  }
  seeds.push({ ...ANTI_DEFAULT, slug: antiSlug });
  return seeds;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    // Strip combining diacritics (U+0300..U+036F). Explicit escape so the
    // source file stays ASCII and the regex is unambiguous to readers.
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    // Re-trim trailing hyphens in case the 50-char cut landed on one.
    .replace(/-+$/g, "");
}

function titleCase(s: string): string {
  // Conservative title-case: capitalize each whitespace-separated word's
  // first letter; preserve the rest. Avoids butchering archetypes like
  // "two-person CTO" → "Two-Person Cto" (the -Cto would be wrong).
  return s.replace(/(^|\s)([a-z])/g, (_, lead, ch) => `${lead}${ch.toUpperCase()}`);
}

function renderSkeleton(template: string, persona: PersonaSeed, now: Date): string {
  // YYYY-MM-DD only — minute precision in personas adds churn on every
  // re-run without buying anything. Persona files are coarse-grained; the
  // status log is the high-resolution audit surface.
  const date = now.toISOString().slice(0, 10);
  const kindLine = persona.isAnti ? "\nkind: anti-persona" : "";
  let body = template
    .replaceAll(SKELETON_PLACEHOLDERS.name, persona.name)
    .replaceAll(SKELETON_PLACEHOLDERS.archetype, persona.archetype)
    .replaceAll(SKELETON_PLACEHOLDERS.weight, persona.weight.toFixed(2))
    .replaceAll(SKELETON_PLACEHOLDERS.created, date)
    .replaceAll(SKELETON_PLACEHOLDERS.kindLine, kindLine);
  if (!body.endsWith("\n")) body += "\n";
  return body;
}

function readSkeleton(templatesRoot: string): string {
  const path = join(templatesRoot, "personas", "skeleton.md");
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function defaultTemplatesRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // src/lib/init-personas.ts → ../../_devx/templates/init
  // dist/lib/init-personas.js → ../../_devx/templates/init
  return resolve(here, "..", "..", "..", "_devx", "templates", "init");
}
