// pin102 — Skills installer library.
//
// Installs the packaged `skills/*.md` files into a target `.claude/commands/`
// (per-repo) or `~/.claude/commands/` (--global) with ownership rules keyed on
// the `<!-- devx-skill v<version> -->` header. Pure decision fn + impure
// applier (pure-fn + CLI-passthrough cross-epic pattern, library variant —
// the CLI consumer lands in pin103).
//
// Ownership model: a devx-skill header on line 1 marks the file
// machine-owned — any version mismatch (older OR newer/different build sha)
// converges the file to the installing package's payload. The header is an
// ownership marker, not a precedence record. A headerless existing file is
// user-owned: never touched (absent `force`), and a MANUAL.md entry is filed
// through the existing init-failure append path (MANUAL-as-designed-signal —
// skip never aborts the run).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { appendManualEntry } from "./init-failure.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillInstallAction =
  | "write"
  | "overwrite"
  | "skip-same-version"
  | "skip-user-owned";

export interface SkillDecisionInput {
  /** Full content of the existing target file, or null when absent. */
  existing: string | null;
  /** The version being installed (plain semver now; `<semver>+<sha>` after pin104). */
  incomingVersion: string;
  /** Override: install over user-owned and same-version files alike. */
  force?: boolean;
}

export interface SkillInstallOutcome {
  /** Basename of the skill file, e.g. `devx.md`. */
  file: string;
  /** Absolute path the decision applied to. */
  targetPath: string;
  action: SkillInstallAction;
  /** Set only for skip-user-owned: whether a NEW MANUAL.md bullet was filed
   *  (false when the entry for this file already existed — idempotent). */
  manualAppended?: boolean;
}

export interface InstallSkillsOpts {
  /** Directory the skills land in (e.g. `<repo>/.claude/commands` or
   *  `~/.claude/commands`). Created if absent. */
  targetDir: string;
  /** Version stamped into the header of every written file. */
  version: string;
  force?: boolean;
  /** Override the packaged skills dir. Defaults to the module-relative
   *  `skills/` (same technique as init-write's templatesRoot). */
  skillsRoot?: string;
  /** Where skip-user-owned entries are filed. Defaults to MANUAL.md in cwd —
   *  the pin103 consumer always passes the repo's path explicitly. */
  manualPath?: string;
  /** Override the timestamp on MANUAL entries. Tests pin this. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

// Line-1 marker the ownership rules key on (design § Data). The version tail
// is free-form so pin104's `<semver>+<sha>` composes without a change here.
const HEADER_RE = /^<!-- devx-skill v(\S+) -->$/;

export function skillHeaderLine(version: string): string {
  return `<!-- devx-skill v${version} -->`;
}

/** Extract the devx-skill header version from file content. Returns null when
 *  the first line is not a header — which means the file is user-owned.
 *  Tolerates a leading BOM and trailing whitespace/CR on line 1: a CRLF
 *  conversion (git autocrlf, Windows editors) must not silently flip a
 *  machine-owned file to user-owned and wedge it un-upgradable. */
export function parseSkillHeader(content: string): string | null {
  const firstLine = (content.split("\n", 1)[0] ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\s+$/, "");
  const m = HEADER_RE.exec(firstLine);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Pure decision fn
// ---------------------------------------------------------------------------

/** (existing-file state × header presence × version) → action. Truth table:
 *  absent → write; header+different-version → overwrite (converge to the
 *  installed package, downgrades included); header+same → skip-same-version;
 *  headerless → skip-user-owned. `force: true` turns both skips into
 *  overwrite; an absent file stays a plain write. An empty existing file is
 *  headerless, i.e. skip-user-owned — conservative on purpose: never treat
 *  content we can't classify as ours. */
export function decideSkillInstall(input: SkillDecisionInput): SkillInstallAction {
  if (input.existing === null) return "write";
  if (input.force) return "overwrite";
  const headerVersion = parseSkillHeader(input.existing);
  if (headerVersion === null) return "skip-user-owned";
  if (headerVersion === input.incomingVersion) return "skip-same-version";
  return "overwrite";
}

// ---------------------------------------------------------------------------
// Impure applier
// ---------------------------------------------------------------------------

/** Install every packaged skill into `targetDir`, returning per-file
 *  outcomes. Writes are atomic (tmp+rename via writeAtomic); a write failure
 *  propagates after writeAtomic's own tmp cleanup — callers see the error,
 *  the target dir sees no droppings (outcomes for files already written are
 *  lost with the throw; the pin103 consumer surfaces the error and exits
 *  nonzero, and a re-run converges — every action is idempotent). A target
 *  path that exists but is not a regular file is treated as user-owned
 *  (skip + MANUAL entry), never a crash. */
export function installSkills(opts: InstallSkillsOpts): SkillInstallOutcome[] {
  if (!/^\S+$/.test(opts.version)) {
    // A whitespace-bearing or empty version would render a header that
    // parseSkillHeader can never re-parse — the file devx itself wrote would
    // look user-owned to every future run. Refuse up front.
    throw new Error(
      `installSkills: version ${JSON.stringify(opts.version)} must be non-empty with no whitespace`,
    );
  }
  const skillsRoot = opts.skillsRoot ?? defaultSkillsRoot();
  const manualPath = opts.manualPath ?? join(process.cwd(), "MANUAL.md");
  const now = opts.now ?? (() => new Date());

  if (!existsSync(skillsRoot)) {
    throw new Error(
      `installSkills: packaged skills dir not found at ${skillsRoot} — broken or partial devx install; reinstall the package`,
    );
  }
  const files = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name)
    .sort();

  const outcomes: SkillInstallOutcome[] = [];
  for (const file of files) {
    const targetPath = resolve(opts.targetDir, file);
    let existing: string | null = null;
    let nonFileTarget = false;
    if (existsSync(targetPath)) {
      if (statSync(targetPath).isFile()) {
        existing = readFileSync(targetPath, "utf8");
      } else {
        // A directory (or other non-file) squatting on the skill path — not
        // ours to touch, and readFileSync would EISDIR. User-owned by fiat.
        nonFileTarget = true;
      }
    }
    const action: SkillInstallAction = nonFileTarget
      ? "skip-user-owned"
      : decideSkillInstall({
          existing,
          incomingVersion: opts.version,
          force: opts.force,
        });

    const outcome: SkillInstallOutcome = { file, targetPath, action };

    if (action === "write" || action === "overwrite") {
      const body = readFileSync(join(skillsRoot, file), "utf8");
      writeAtomic(targetPath, `${skillHeaderLine(opts.version)}\n${body}`);
    } else if (action === "skip-user-owned") {
      const appended = appendManualEntry({
        manualPath,
        // Keyed on the resolved path, not the basename: a repo install and a
        // --global install sharing one MANUAL.md must each get their entry.
        kind: `skill-user-owned-${targetPath}`,
        title: `Skill file \`${file}\` is user-owned — devx left it untouched`,
        body: [
          `\`${targetPath}\` exists without a devx-skill header, so devx`,
          `treats it as yours. To adopt the packaged version, remove the file`,
          `(or re-run the install with \`force\`) — the packaged copy ships in`,
          `the devx package's skills/ dir.`,
        ].join("\n"),
        now: now(),
      });
      outcome.manualAppended = appended.appended;
    }

    outcomes.push(outcome);
  }

  return outcomes;
}

// ---------------------------------------------------------------------------
// Packaged-dir resolution
// ---------------------------------------------------------------------------

function defaultSkillsRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // src/lib/init-skills.ts → ../../skills
  // dist/lib/init-skills.js → ../../skills
  return resolve(here, "..", "..", "..", "skills");
}
