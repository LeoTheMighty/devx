// Workstream scaffolder + hash→workstream resolver (v2e101).
//
// `devx workstream new <slug> [--hash <hash>]` scaffolds the sibling
// directory a plan spec's engine artifacts live in (v2/02-engine.md §3):
//
//   _devx/workstreams/<slug>/
//   ├── prd.md              ← from _devx/templates/engine/prd.md
//   ├── expectations.md     ← from _devx/templates/engine/expectations.md
//   ├── decisions/          ← empty (dated verify/critique/revision reports)
//   ├── checkpoints/        ← empty (per-phase verification reports)
//   └── evals/              ← empty (RED-gate artifacts + RED-report.md)
//
// and creates-or-extends the plan spec (`plan/plan-<hash>-<ts>-<slug>.md`)
// with the engine frontmatter: `stage: prd`, `entered_at: prd`,
// `gate_status:` all false, `outcome: {status: null, measure_by: null}`,
// plus a `workstream:` pointer so every gate can resolve hash → dir without
// re-deriving the slug from the filename.
//
// Idempotency contract (spec AC): re-running with the same slug/hash is a
// clean no-op — existing artifacts are NEVER overwritten, live gate flags
// are never reset (ensureEngineFrontmatter adds only missing keys). A slug
// whose directory is claimed by a DIFFERENT spec's workstream pointer, or a
// hash whose spec points at a different directory, is a refusal.
//
// Spec: dev/dev-v2e101-2026-07-05T13:01-engine-cli-primitives.md
// Design: v2/02-engine.md §3, §8

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import {
  type EngineState,
  HASH_RE,
  ensureEngineFrontmatter,
  readEngineState,
} from "./frontmatter.js";
import { type EngineConfig } from "./config.js";

// ---------------------------------------------------------------------------
// fs seam — same shape as devx/claim.ts's ClaimFs (subset).
// ---------------------------------------------------------------------------

export interface EngineFs {
  readFile(path: string): string;
  writeFile(path: string, contents: string): void;
  exists(path: string): boolean;
  mkdirRecursive(path: string): void;
  readdir(path: string): string[];
}

export const realEngineFs: EngineFs = {
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, c) => writeFileSync(p, c, "utf8"),
  exists: (p) => existsSync(p),
  mkdirRecursive: (p) => mkdirSync(p, { recursive: true }),
  readdir: (p) => readdirSync(p),
};

/** Kebab-case, ≤50 chars — the spec-filename slug convention (CLAUDE.md). */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const TEMPLATES_DIR = join("_devx", "templates", "engine");
const PLAN_DIR = "plan";

/** Refusal (exit 1): valid request, engine says no. Message is the report. */
export class WorkstreamRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamRefusal";
  }
}

/** Hard error (exit 2): missing templates, unreadable spec, bad input. */
export class WorkstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkstreamError";
  }
}

export interface CreateWorkstreamOpts {
  repoRoot: string;
  slug: string;
  /** Extend this existing plan spec instead of creating a fresh one. */
  hash?: string;
  engine: EngineConfig;
  now?: () => Date;
  fs?: Partial<EngineFs>;
}

export interface CreateWorkstreamResult {
  hash: string;
  slug: string;
  /** Repo-relative plan-spec path. */
  specPath: string;
  /** Repo-relative workstream dir. */
  workstreamDir: string;
  /** What this invocation actually wrote (all false ⇒ full no-op). */
  created: {
    dir: boolean;
    spec: boolean;
    prd: boolean;
    expectations: boolean;
    specFrontmatterExtended: boolean;
  };
  noop: boolean;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Minute-precision local ISO — the spec-filename timestamp shape. */
function formatMinuteIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Second-precision local ISO with offset — the `created:` frontmatter shape. */
function formatFullIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

function generateHash(fs: EngineFs, repoRoot: string): string {
  // 6 hex chars per the spec convention. Regenerate on the (unlikely)
  // collision with an existing plan/dev spec.
  for (let attempt = 0; attempt < 32; attempt++) {
    const hash = randomBytes(3).toString("hex");
    const planDir = join(repoRoot, PLAN_DIR);
    const collision =
      fs.exists(planDir) &&
      fs.readdir(planDir).some((n) => n.startsWith(`plan-${hash}-`));
    if (!collision) return hash;
  }
  throw new WorkstreamError("could not generate a collision-free hash");
}

/**
 * Scaffold (or idempotently complete) a workstream. See file header for
 * the full contract. Throws WorkstreamRefusal (exit 1) / WorkstreamError
 * (exit 2).
 */
export function createWorkstream(
  opts: CreateWorkstreamOpts,
): CreateWorkstreamResult {
  const fs: EngineFs = { ...realEngineFs, ...(opts.fs ?? {}) };
  const now = (opts.now ?? (() => new Date()))();
  const { repoRoot, slug } = opts;

  if (!SLUG_RE.test(slug) || slug.length > 50) {
    throw new WorkstreamError(
      `invalid slug '${slug}' (expected kebab-case, ≤50 chars)`,
    );
  }
  if (opts.hash !== undefined && !HASH_RE.test(opts.hash)) {
    throw new WorkstreamError(
      `invalid hash '${opts.hash}' (expected hex/alnum 3-12 chars)`,
    );
  }

  const wsRel = `${opts.engine.workstreamsRoot}/${slug}`;
  const wsAbs = join(repoRoot, opts.engine.workstreamsRoot, slug);

  // ---- Resolve the plan spec: --hash wins; otherwise look for a spec that
  //      already claims this workstream dir; otherwise create fresh. ------
  let specAbs: string | null = null;
  let specState: EngineState | null = null;
  if (opts.hash !== undefined) {
    specAbs = findSpecForHashInFs(fs, repoRoot, PLAN_DIR, opts.hash);
    if (specAbs !== null) {
      specState = readEngineState(fs.readFile(specAbs));
      if (specState.workstream !== null && specState.workstream !== wsRel) {
        throw new WorkstreamRefusal(
          `spec for hash '${opts.hash}' already belongs to workstream '${specState.workstream}' — refusing to rebind it to '${wsRel}'`,
        );
      }
    }
  } else {
    // No hash: adopt the spec that already points at this dir, if any.
    const planDir = join(repoRoot, PLAN_DIR);
    if (fs.exists(planDir)) {
      for (const name of [...fs.readdir(planDir)].sort()) {
        if (!name.endsWith(".md")) continue;
        const st = readEngineState(fs.readFile(join(planDir, name)));
        if (st.workstream === wsRel) {
          specAbs = join(planDir, name);
          specState = st;
          break;
        }
      }
    }
    if (specAbs === null && fs.exists(wsAbs)) {
      throw new WorkstreamRefusal(
        `workstream dir '${wsRel}' exists but no plan spec points at it — re-run with --hash <hash> to bind an existing spec`,
      );
    }
  }

  const created = {
    dir: false,
    spec: false,
    prd: false,
    expectations: false,
    specFrontmatterExtended: false,
  };

  // ---- Create the spec if it doesn't exist yet. -------------------------
  let hash: string;
  if (specAbs === null) {
    hash = opts.hash ?? generateHash(fs, repoRoot);
    const specName = `plan-${hash}-${formatMinuteIso(now)}-${slug}.md`;
    specAbs = join(repoRoot, PLAN_DIR, specName);
    if (fs.exists(specAbs)) {
      throw new WorkstreamError(`spec path collision at plan/${specName}`);
    }
    fs.mkdirRecursive(join(repoRoot, PLAN_DIR));
    fs.writeFile(specAbs, freshSpecContent(hash, slug, wsRel, now));
    created.spec = true;
  } else {
    hash = specState?.hash ?? opts.hash ?? "";
    if (hash === "") {
      throw new WorkstreamError(
        `spec at ${basename(specAbs)} has no readable hash frontmatter`,
      );
    }
    // Extend: add missing engine keys only; never reset live state.
    const before = fs.readFile(specAbs);
    const { content: after, changed } = ensureEngineFrontmatter(before, {
      stage: "prd",
      enteredAt: "prd",
      workstream: wsRel,
    });
    if (changed) {
      fs.writeFile(specAbs, after);
      created.specFrontmatterExtended = true;
    }
  }

  // ---- Scaffold the dir tree (write-if-missing everywhere). -------------
  if (!fs.exists(wsAbs)) {
    fs.mkdirRecursive(wsAbs);
    created.dir = true;
  }
  for (const sub of ["decisions", "checkpoints", "evals"]) {
    const subAbs = join(wsAbs, sub);
    if (!fs.exists(subAbs)) fs.mkdirRecursive(subAbs);
  }

  const title = titleFromSlug(slug);
  for (const t of [
    { name: "prd.md", key: "prd" as const },
    { name: "expectations.md", key: "expectations" as const },
  ]) {
    const dest = join(wsAbs, t.name);
    if (fs.exists(dest)) continue;
    const templateAbs = join(repoRoot, TEMPLATES_DIR, t.name);
    if (!fs.exists(templateAbs)) {
      throw new WorkstreamError(
        `engine template missing at ${TEMPLATES_DIR}/${t.name} — run \`devx init\` (v2 scaffold) first`,
      );
    }
    const body = fs
      .readFile(templateAbs)
      .replace(/<workstream title>/g, title);
    fs.writeFile(dest, body);
    created[t.key] = true;
  }

  const specRel = `${PLAN_DIR}/${basename(specAbs)}`;
  const noop =
    !created.dir &&
    !created.spec &&
    !created.prd &&
    !created.expectations &&
    !created.specFrontmatterExtended;

  return { hash, slug, specPath: specRel, workstreamDir: wsRel, created, noop };
}

function freshSpecContent(
  hash: string,
  slug: string,
  wsRel: string,
  now: Date,
): string {
  const title = titleFromSlug(slug);
  return [
    "---",
    `hash: ${hash}`,
    "type: plan",
    `created: ${formatFullIso(now)}`,
    `title: ${title}`,
    "status: in-progress",
    "stage: prd",
    "entered_at: prd",
    "gate_status:",
    "  prd_validated: false",
    "  design_verified: false",
    "  plan_verified: false",
    "  evals_red: false",
    "outcome:",
    "  status: null",
    "  measure_by: null",
    `workstream: ${wsRel}`,
    "---",
    "",
    "## Goal",
    "",
    `Workstream '${title}' — PRD stage next. Artifacts live in \`${wsRel}/\`.`,
    "",
    "## Status log",
    "",
    `- ${formatMinuteIso(now)} — workstream scaffolded by \`devx workstream new ${slug}\`.`,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// hash → workstream resolution (shared by every gate + revise + next)
// ---------------------------------------------------------------------------

export interface ResolvedWorkstream {
  hash: string;
  /** Absolute plan-spec path. */
  specAbs: string;
  /** Repo-relative plan-spec path. */
  specRel: string;
  /** Spec file content at resolve time. */
  content: string;
  state: EngineState;
  /** Repo-relative workstream dir. */
  workstreamRel: string;
  /** Absolute workstream dir. */
  workstreamAbs: string;
}

/**
 * Resolve a workstream by spec hash: plan spec → `workstream:` frontmatter
 * pointer (fallback: filename-slug derivation for hand-authored specs) →
 * directory. Throws WorkstreamError when the spec or the directory can't
 * be found — every consumer maps that to exit 2.
 */
export function resolveWorkstream(
  repoRoot: string,
  hash: string,
  engine: EngineConfig,
  fsOverride: Partial<EngineFs> = {},
): ResolvedWorkstream {
  const fs: EngineFs = { ...realEngineFs, ...fsOverride };
  if (!HASH_RE.test(hash)) {
    throw new WorkstreamError(
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  const specAbs = findSpecForHashInFs(fs, repoRoot, PLAN_DIR, hash);
  if (!specAbs) {
    throw new WorkstreamError(
      `no plan spec for hash '${hash}' under ${PLAN_DIR}/`,
    );
  }
  const content = fs.readFile(specAbs);
  const state = readEngineState(content);

  let workstreamRel = state.workstream;
  if (workstreamRel === null) {
    // Fallback: derive the slug from the filename tail. Filename shape:
    // plan-<hash>-<YYYY-MM-DDTHH:MM>-<slug>.md (CLAUDE.md convention).
    const m = /^plan-[a-z0-9]{3,12}-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}-(.+)\.md$/i.exec(
      basename(specAbs),
    );
    if (m) workstreamRel = `${engine.workstreamsRoot}/${m[1]}`;
  }
  if (workstreamRel === null) {
    throw new WorkstreamError(
      `spec for '${hash}' has no \`workstream:\` frontmatter and its filename slug can't be derived — run \`devx workstream new <slug> --hash ${hash}\``,
    );
  }
  const workstreamAbs = join(repoRoot, ...workstreamRel.split("/"));
  if (!fs.exists(workstreamAbs)) {
    throw new WorkstreamError(
      `workstream dir '${workstreamRel}' not found — run \`devx workstream new ${workstreamRel.split("/").pop()} --hash ${hash}\``,
    );
  }
  return {
    hash,
    specAbs,
    specRel: `${PLAN_DIR}/${basename(specAbs)}`,
    content,
    state,
    workstreamRel,
    workstreamAbs,
  };
}

/** findSpecForHashIn but routed through the fs seam (for tests). */
function findSpecForHashInFs(
  fs: EngineFs,
  repoRoot: string,
  specDir: string,
  hash: string,
): string | null {
  const dir = join(repoRoot, specDir);
  if (!fs.exists(dir)) return null;
  for (const name of [...fs.readdir(dir)].sort()) {
    if (name.startsWith(`${specDir}-${hash}-`) && name.endsWith(".md")) {
      return join(dir, name);
    }
  }
  return null;
}
