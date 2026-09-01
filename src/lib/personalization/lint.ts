// Preference-bank drift lint (§29 port, upstream mycase/8am-harness #58).
//
// The bank only works if the registry and the skills agree. Two drifts are
// possible, both SILENT at runtime, which is why they are build failures
// rather than review items:
//
//   - a banked key no skill declares  → never asked, never read. The user
//     answers a question that changes nothing.
//   - a skill dropping a declaration  → devx stops honoring a preference
//     someone already answered, and says nothing.
//
// Plus the preflight-wording check. The canonical paragraph lives in
// PERSONALIZATION.md §5 and every carrier quotes it verbatim; the lint
// compares each carrier against THE REGISTRY, never against the other
// carriers. A lint whose canonical source is one of the copies it checks can
// be edited into agreeing with anything, and that failure is invisible.
//
// Pure: no I/O. The test feeds it the real files.

/** A key as the registry defines it. */
export interface BankKey {
  key: string;
  /** Default column, verbatim. Empty is a lint failure. */
  defaultValue: string;
  /** Skill names from the Owning skill(s) column, normalized. `all` is kept
   *  as the literal token. */
  owners: string[];
  core: boolean;
}

export interface Registry {
  bankVersion: number | null;
  keys: BankKey[];
  /** The canonical preflight paragraph, from §5's fenced block. */
  canonicalPreflight: string | null;
}

/** What one skill body declares. */
export interface SkillDeclaration {
  skill: string;
  keys: Array<{ key: string; core: boolean }>;
  /** The skill's own preflight paragraph, or null when it carries none. */
  preflight: string | null;
}

export interface LintProblem {
  kind:
    | "key-without-default"
    | "key-without-owner"
    | "banked-key-undeclared"
    | "declared-key-unbanked"
    | "owner-mismatch"
    | "core-mismatch"
    | "preflight-drift"
    | "no-bank-version";
  message: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Split a markdown table row, treating `\|` as content. Markdown escapes
 *  literal pipes inside enum cells (`` `a` \| `b` ``); splitting on a bare
 *  `|` shreds them and shifts every later column, which silently makes the
 *  Default and Owner checks read the Type cell instead. That exact bug
 *  shipped green upstream. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (line[i] === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += line[i];
  }
  cells.push(cur.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

const isDelimiter = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/** Strip markdown emphasis/code fencing from a cell to get the bare token. */
const bare = (s: string): string => s.replace(/[`*]/g, "").trim();

/** Normalize the Owning skill(s) cell into skill names. Parenthetical
 *  qualifiers ("devx (address arm)") are dropped — they say WHERE in the
 *  skill the key is read, which is prose, not identity. */
export function parseOwners(cell: string): string[] {
  const text = bare(cell).toLowerCase();
  if (/\ball\b/.test(text)) return ["all"];
  const out = new Set<string>();
  for (const m of text.matchAll(/devx(?:-[a-z]+)*/g)) out.add(m[0]);
  return [...out].sort();
}

/** Parse docs/PERSONALIZATION.md. Core keys come from the §4 table (which
 *  carries a leading `#` column); JIT keys from §6 (which does not). */
export function parseRegistry(md: string): Registry {
  const lines = md.split(/\r?\n/);
  const versionMatch = /bank_version:\s*(\d+)/.exec(md);
  const keys: BankKey[] = [];

  let section: "core" | "jit" | null = null;
  let header: string[] | null = null;

  for (const line of lines) {
    // A `###` subsection ENDS the bank table — §4 carries subsections (§4.1)
    // whose own content would otherwise inherit §4's header and be parsed as
    // bank rows. That is exactly how the phantom `workstream` key appeared,
    // back when §4.1 held the layout table.
    const sub = /^###\s+/.test(line);
    if (sub) {
      section = null;
      header = null;
      continue;
    }
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      const t = h[1].toLowerCase();
      section = t.includes("the core bank")
        ? "core"
        : t.includes("just-in-time")
          ? "jit"
          : null;
      header = null;
      continue;
    }
    if (!section || !line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    if (isDelimiter(cells)) continue;
    if (!header) {
      header = cells.map((c) => bare(c).toLowerCase());
      continue;
    }
    const idx = (name: string): number =>
      header!.findIndex((c) => c.startsWith(name));
    const keyCell = cells[idx("key")] ?? "";
    const key = bare(keyCell);
    if (key === "" || key.startsWith("<")) continue;
    keys.push({
      key,
      defaultValue: bare(cells[idx("default")] ?? ""),
      owners: parseOwners(cells[idx("owning skill")] ?? ""),
      core: section === "core",
    });
  }

  // §5's canonical preflight lives in the fenced ```text block.
  let canonicalPreflight: string | null = null;
  const fence = /```text\r?\n([\s\S]*?)```/.exec(md);
  if (fence) canonicalPreflight = fence[1].trim();

  return {
    bankVersion: versionMatch ? Number(versionMatch[1]) : null,
    keys,
    canonicalPreflight,
  };
}

/** Parse one skill body's `**Preference keys**` table + preflight paragraph.
 *
 *  The table is located by its heading anchor, never by a bare search for the
 *  marker: the phrase `**Preference keys**` also appears mid-sentence inside
 *  the preflight paragraph itself, and an unanchored match scans whatever
 *  table happens to sit above (31 phantom failures upstream). */
export function parseSkill(skill: string, md: string): SkillDeclaration {
  const lines = md.split(/\r?\n/);
  const keys: Array<{ key: string; core: boolean }> = [];

  // Anchor: the declaration line that INTRODUCES the table.
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\*\*Preference keys\*\*\s*\(/.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start !== -1) {
    let header: string[] | null = null;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (/^#{1,3}\s+/.test(line) && i > start) break;
      if (!line.trim().startsWith("|")) continue;
      const cells = splitRow(line);
      if (isDelimiter(cells)) continue;
      if (!header) {
        header = cells;
        continue;
      }
      const core = (cells[1] ?? "").includes("●");
      // A cell may declare several keys joined by ` · `.
      for (const part of bare(cells[0] ?? "").split("·")) {
        const key = part.trim();
        if (key !== "") keys.push({ key, core });
      }
    }
  }

  const pf = /\*\*Profile preflight \(docs\/PERSONALIZATION\.md\)\.\*\*[\s\S]*?(?=\n\n)/.exec(md);
  return { skill, keys, preflight: pf ? pf[0].trim() : null };
}

// ---------------------------------------------------------------------------
// Linting
// ---------------------------------------------------------------------------

/** Collapse whitespace so a reflowed paragraph compares equal — the wording
 *  is what is pinned, not the line breaks. */
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The two sanctioned `<slot>` fillings, from §5. */
const SLOTS = [
  "stop and print the docs/PERSONALIZATION.md §5 refusal — do none of this skill's work",
  "print the docs/PERSONALIZATION.md §5 nudge and continue — this skill never blocks",
];

export function lintPersonalization(
  registry: Registry,
  skills: SkillDeclaration[],
): LintProblem[] {
  const problems: LintProblem[] = [];

  if (registry.bankVersion === null) {
    problems.push({
      kind: "no-bank-version",
      message: "docs/PERSONALIZATION.md declares no bank_version",
    });
  }

  const banked = new Map(registry.keys.map((k) => [k.key, k]));

  for (const k of registry.keys) {
    if (k.defaultValue === "") {
      problems.push({
        kind: "key-without-default",
        message: `bank key \`${k.key}\` has no Default — an upgrade cannot fall through without one`,
      });
    }
    if (k.owners.length === 0) {
      problems.push({
        kind: "key-without-owner",
        message: `bank key \`${k.key}\` names no owning skill`,
      });
    }
  }

  // Declared → banked.
  const declaredBy = new Map<string, Set<string>>();
  for (const s of skills) {
    for (const d of s.keys) {
      if (!banked.has(d.key)) {
        problems.push({
          kind: "declared-key-unbanked",
          message: `${s.skill} declares \`${d.key}\`, which is not in the bank`,
        });
        continue;
      }
      const set = declaredBy.get(d.key) ?? new Set<string>();
      set.add(s.skill);
      declaredBy.set(d.key, set);
      const bank = banked.get(d.key)!;
      if (d.core !== bank.core) {
        problems.push({
          kind: "core-mismatch",
          message: `${s.skill} marks \`${d.key}\` ${
            d.core ? "core" : "non-core"
          }; the registry banks it as ${bank.core ? "core" : "non-core"}`,
        });
      }
    }
  }

  // Banked → declared, and the owner column must match exactly.
  for (const k of registry.keys) {
    const actual = [...(declaredBy.get(k.key) ?? [])].sort();
    if (actual.length === 0) {
      problems.push({
        kind: "banked-key-undeclared",
        message: `bank key \`${k.key}\` is declared by no skill — it is never asked and never read`,
      });
      continue;
    }
    // `all` means every carrier; it is satisfied by any declaration and is
    // deliberately not pinned to an exact set.
    if (k.owners.includes("all")) continue;
    const expected = [...k.owners].sort();
    if (expected.join(",") !== actual.join(",")) {
      problems.push({
        kind: "owner-mismatch",
        message: `bank key \`${k.key}\`: registry names [${expected.join(", ")}], skills declaring it are [${actual.join(", ")}]`,
      });
    }
  }

  // Preflight wording, compared against the REGISTRY.
  if (registry.canonicalPreflight) {
    const canon = flat(registry.canonicalPreflight);
    for (const s of skills) {
      if (s.preflight === null) continue; // carries none, by contract
      const got = flat(s.preflight);
      const matches = SLOTS.some((slot) => canon.replace("<slot>", slot) === got);
      if (!matches) {
        problems.push({
          kind: "preflight-drift",
          message: `${s.skill}'s preflight paragraph does not match PERSONALIZATION.md §5 with either sanctioned slot`,
        });
      }
    }
  }

  return problems;
}
