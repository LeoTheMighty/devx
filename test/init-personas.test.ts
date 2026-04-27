// init-personas.ts tests (ini504).
//
// Coverage target — the four AC scenarios:
//   1. archetypes-given path: writes one skeleton per archetype + anti.
//   2. archetypes-default path ("you propose"): writes 4 real + Morgan-shaped anti.
//   3. persona-already-present: existing files never overwritten.
//   4. 6+ archetypes: invokes resolveOverflow; throws if no resolver.
//
// Templates root points at the real package _devx/templates/init/personas/
// so the shipped skeleton template is exercised too.

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PERSONAS,
  PersonaOverflowError,
  parseArchetypes,
  seedPersonas,
} from "../src/lib/init-personas.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = resolve(HERE, "..", "_devx", "templates", "init");
const NOW = () => new Date("2026-04-27T13:00:00.000Z");

function mkRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  // The personas dir must exist before the seeder writes into it. ini502
  // creates this; tests stand in for that contract.
  mkdirSync(join(dir, "focus-group", "personas"), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// parseArchetypes — pure
// ---------------------------------------------------------------------------

describe("ini504 — parseArchetypes", () => {
  it("splits on commas and semicolons", () => {
    expect(parseArchetypes("founders, devs, designers")).toEqual([
      "founders",
      "devs",
      "designers",
    ]);
    expect(parseArchetypes("Solo founders; small-team CTOs")).toEqual([
      "Solo founders",
      "small-team CTOs",
    ]);
  });

  it("splits on ' and ' and ' & '", () => {
    expect(parseArchetypes("indie hackers and tinkerers")).toEqual([
      "indie hackers",
      "tinkerers",
    ]);
    expect(parseArchetypes("designers & engineers")).toEqual([
      "designers",
      "engineers",
    ]);
  });

  it("dedupes case-insensitively, preserving first occurrence's casing", () => {
    expect(parseArchetypes("Founders, founders, FOUNDERS")).toEqual([
      "Founders",
    ]);
  });

  it("strips a leading 'you propose:' prefix", () => {
    expect(parseArchetypes("you propose: founders, devs")).toEqual([
      "founders",
      "devs",
    ]);
  });

  it("returns [] for empty / whitespace / non-string input", () => {
    expect(parseArchetypes("")).toEqual([]);
    expect(parseArchetypes("   ")).toEqual([]);
    expect(parseArchetypes(", ; , ")).toEqual([]);
    // @ts-expect-error — guard against runtime non-string
    expect(parseArchetypes(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// seedPersonas — archetypes-default path
// ---------------------------------------------------------------------------

describe("ini504 — seedPersonas — defaults (you propose)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-default-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("writes 5 personas (4 real + 1 anti) when whoFor is 'you propose'", async () => {
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "you propose",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.source).toBe("default");
    expect(r.created).toHaveLength(5);
    expect(r.skipped).toEqual([]);
    expect(r.overflowResolved).toBe(false);

    // Each of the default panel members landed.
    for (const seed of DEFAULT_PERSONAS) {
      const path = join(repo, "focus-group", "personas", `persona-${seed.slug}.md`);
      expect(existsSync(path)).toBe(true);
    }

    // Anti-persona file has `kind: anti-persona` in frontmatter.
    const anti = readFileSync(
      join(repo, "focus-group", "personas", "persona-anti-persona.md"),
      "utf8",
    );
    expect(anti).toMatch(/kind:\s*anti-persona/);

    // Real personas don't have `kind:`.
    const primary = readFileSync(
      join(repo, "focus-group", "personas", "persona-primary-user.md"),
      "utf8",
    );
    expect(primary).not.toMatch(/kind:/);

    // Frontmatter has a numeric weight.
    expect(primary).toMatch(/weight:\s*0\.\d{2}/);
    // Date is YYYY-MM-DD only.
    expect(primary).toMatch(/created:\s*2026-04-27/);
    expect(primary).not.toMatch(/created:\s*2026-04-27T/);
  });

  it("treats empty whoFor as the default path", async () => {
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.source).toBe("default");
    expect(r.created).toHaveLength(5);
  });

  it("treats 'You Propose' (mixed case) as the default path", async () => {
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "You Propose",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.source).toBe("default");
  });

  it("falls back to defaults when archetypes parse to zero", async () => {
    // Comma-only input parses to []; spec says we should still seed something
    // sensible rather than leave the panel empty.
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: ",, , ;",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.source).toBe("default");
    expect(r.created).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// seedPersonas — archetypes-given path
// ---------------------------------------------------------------------------

describe("ini504 — seedPersonas — archetypes given", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-archetypes-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("writes one skeleton per archetype + anti-persona (5 files for 4 archetypes)", async () => {
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "founders, devs, designers, PMs",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.source).toBe("archetypes-given");
    expect(r.created.sort()).toEqual([
      "persona-anti-persona.md",
      "persona-designers.md",
      "persona-devs.md",
      "persona-founders.md",
      "persona-pms.md",
    ]);

    // Anti is mandatory — it must be in the created or skipped list.
    expect(r.panel.some((p) => p.isAnti)).toBe(true);

    // Body uses the archetype string verbatim.
    const founders = readFileSync(
      join(repo, "focus-group", "personas", "persona-founders.md"),
      "utf8",
    );
    expect(founders).toContain("archetype: founders");
    // Title-cased name in frontmatter.
    expect(founders).toContain("name: Founders");
  });

  it("anti-persona file has kind: anti-persona", async () => {
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "founders, devs",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.created).toContain("persona-anti-persona.md");
    const anti = readFileSync(
      join(repo, "focus-group", "personas", "persona-anti-persona.md"),
      "utf8",
    );
    expect(anti).toMatch(/kind:\s*anti-persona/);
  });

  it("disambiguates duplicate slugs (e.g. two archetypes that slugify the same)", async () => {
    // Two archetypes that slugify to the same kebab; second gets `-2`.
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "Solo founders, solo-founders!",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.created).toContain("persona-solo-founders.md");
    expect(r.created).toContain("persona-solo-founders-2.md");
  });

  it("disambiguates a user-supplied 'anti-persona' archetype against the appended anti", async () => {
    // The user happens to name an archetype "anti persona" — slug collides
    // with the appended anti-persona. Real persona keeps the slug; anti
    // gets a -2.
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "anti persona, founders",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    // Both files are created.
    expect(r.created).toContain("persona-anti-persona.md"); // user's archetype
    expect(r.created).toContain("persona-anti-persona-2.md"); // appended anti
    // Only the *appended* one carries kind: anti-persona.
    const userOwned = readFileSync(
      join(repo, "focus-group", "personas", "persona-anti-persona.md"),
      "utf8",
    );
    const appended = readFileSync(
      join(repo, "focus-group", "personas", "persona-anti-persona-2.md"),
      "utf8",
    );
    expect(userOwned).not.toMatch(/kind:\s*anti-persona/);
    expect(appended).toMatch(/kind:\s*anti-persona/);
  });

  it("weights distribute across real personas + 0.05 for anti", async () => {
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "founders, devs",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    const realWeights = r.panel
      .filter((p) => !p.isAnti)
      .map((p) => p.weight);
    expect(realWeights).toHaveLength(2);
    const antiWeight = r.panel.find((p) => p.isAnti)?.weight;
    expect(antiWeight).toBeCloseTo(0.05);
    const sum = r.panel.reduce((acc, p) => acc + p.weight, 0);
    // Sum must round to exactly 1.0 (no drift on re-runs).
    expect(Math.round(sum * 100) / 100).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// AC: persona-already-present (idempotency)
// ---------------------------------------------------------------------------

describe("ini504 — seedPersonas — directory creation", () => {
  it("creates focus-group/personas/ if it does not exist", async () => {
    // Skip the helper that pre-creates the dir — exercise the standalone case.
    const repo = mkdtempSync(join(tmpdir(), "devx-ini504-mkdir-"));
    try {
      expect(existsSync(join(repo, "focus-group", "personas"))).toBe(false);
      const r = await seedPersonas({
        repoRoot: repo,
        whoFor: "you propose",
        templatesRoot: TEMPLATES_ROOT,
        now: NOW,
      });
      expect(r.created).toHaveLength(5);
      expect(existsSync(join(repo, "focus-group", "personas"))).toBe(true);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("ini504 — seedPersonas — idempotent re-run", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-rerun-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("never overwrites an existing persona file", async () => {
    // Pre-populate persona-anti-persona.md with hand-written content.
    const handPath = join(repo, "focus-group", "personas", "persona-anti-persona.md");
    const handBody = "---\nname: Hand\n---\nuser-written\n";
    writeFileSync(handPath, handBody);

    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "founders, devs",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r.skipped).toContain("persona-anti-persona.md");
    expect(r.created).not.toContain("persona-anti-persona.md");
    // File must be byte-identical.
    expect(readFileSync(handPath, "utf8")).toBe(handBody);
  });

  it("a second invocation creates nothing new", async () => {
    await seedPersonas({
      repoRoot: repo,
      whoFor: "you propose",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    const r2 = await seedPersonas({
      repoRoot: repo,
      whoFor: "you propose",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
    });
    expect(r2.created).toEqual([]);
    expect(r2.skipped).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// AC: 6+ archetypes prompt
// ---------------------------------------------------------------------------

describe("ini504 — seedPersonas — 6+ archetypes overflow", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkRepo("devx-ini504-overflow-");
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("invokes resolveOverflow when input has >=6 real archetypes (cap is 5 reals + 1 anti = 6 total)", async () => {
    let received: string[] | null = null;
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "a, b, c, d, e, f",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
      resolveOverflow: (archs) => {
        received = [...archs];
        return ["a", "b", "c", "d", "e"]; // user picked 5
      },
    });
    expect(received).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(r.overflowResolved).toBe(true);
    expect(r.source).toBe("archetypes-given");
    // 5 real + 1 anti = 6 files.
    expect(r.created).toHaveLength(6);
  });

  it("throws PersonaOverflowError when 6+ archetypes given without a resolver", async () => {
    await expect(
      seedPersonas({
        repoRoot: repo,
        whoFor: "a, b, c, d, e, f",
        templatesRoot: TEMPLATES_ROOT,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(PersonaOverflowError);
  });

  it("throws PersonaOverflowError when resolver returns >5 reals", async () => {
    await expect(
      seedPersonas({
        repoRoot: repo,
        whoFor: "a, b, c, d, e, f, g",
        templatesRoot: TEMPLATES_ROOT,
        now: NOW,
        resolveOverflow: (archs) => archs, // user said "no, keep all"
      }),
    ).rejects.toBeInstanceOf(PersonaOverflowError);
  });

  it("does not invoke resolveOverflow at exactly 5 archetypes (5 real + 1 anti = 6 total, at the cap)", async () => {
    let called = false;
    const r = await seedPersonas({
      repoRoot: repo,
      whoFor: "a, b, c, d, e",
      templatesRoot: TEMPLATES_ROOT,
      now: NOW,
      resolveOverflow: () => {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
    expect(r.overflowResolved).toBe(false);
    expect(r.created).toHaveLength(6);
  });
});
