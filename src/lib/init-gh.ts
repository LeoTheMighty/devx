// GitHub-side scaffolding for `/devx-init` (ini503).
//
// Public surface:
//   - writeInitGh(opts) — orchestrates the GitHub-side phases:
//       1. Workflow files (devx-ci, devx-promotion, devx-deploy) — stack-conditional CI
//       2. develop branch creation (gated by config.git.integration_branch)
//       3. Default-branch flip to develop (gated; only when develop is integration_branch)
//       4. Branch protection on main (gated by config.git.protect_main)
//       5. Free-tier private fallback: pre-push git hook + MANUAL.md entry
//       6. No-remote / gh-unauth fallback: queue ops to .devx-cache/pending-gh-ops.json
//
// PR template note: the .github/pull_request_template.md write site moved to
// init-write.ts (writePrTemplate) per prt101 + docs/DESIGN.md §185 source-
// of-truth-precedence rule. init-orchestrator.ts now calls writePrTemplate
// after writeInitFiles and before writeInitGh — this module no longer owns
// the PR template.
//
// Idempotency: existing workflow files are diff-and-skipped (identical → no-op,
// different → kept-as-is to preserve user customizations). Existing develop
// branch is kept. Branch protection unions with existing rules — we never
// weaken what's already there.
//
// Failure modes (each leaves the local-write state usable; init.partial=true
// is set by ini506's caller):
//   - no-remote      → all gh ops queued, 1 MANUAL entry
//   - gh-not-authed  → all gh ops queued, 1 MANUAL entry
//   - gh-missing-scope (403 on protection probe) → protection queued, 1 MANUAL entry
//   - private-free-tier → branch protection skipped, pre-push hook installed, 1 MANUAL entry
//
// All gh + git invocations go through injectable execs; tests pass scripted
// stubs and writes are observed by reading the tmp repo root.
//
// Spec: dev/dev-ini503-2026-04-26T19:35-init-github-scaffolding.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PartialConfig } from "./init-questions.js";
import type { DetectedStack, GitExec, GitResult, InitState } from "./init-state.js";
import { defaultGitExec } from "./init-state.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GhResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GhExec = (
  args: readonly string[],
  opts?: { input?: string },
) => GhResult;

export type WorkflowFileOutcome =
  | "wrote"
  | "skipped-identical"
  | "kept-existing-different";

export interface WorkflowResult {
  path: string;
  outcome: WorkflowFileOutcome;
}

export type DevelopOutcomeKind =
  | "skipped-single-branch"
  | "skipped-already-exists"
  | "skipped-no-remote"
  | "skipped-gh-unauth"
  | "created"
  | "failed";

export interface DevelopOutcome {
  kind: DevelopOutcomeKind;
  /** Set when kind === "created"; the SHA pointed at by the new ref. */
  sha?: string;
  /** Set when kind === "failed"; the gh stderr (truncated) for diagnostics. */
  error?: string;
}

export type DefaultBranchOutcomeKind =
  | "skipped-single-branch"
  | "skipped-already-correct"
  | "skipped-no-remote"
  | "skipped-gh-unauth"
  | "skipped-non-main-default"
  | "changed"
  | "failed";

export interface DefaultBranchOutcome {
  kind: DefaultBranchOutcomeKind;
  /** When kind === "skipped-non-main-default", the existing default-branch name. */
  existing?: string;
  from?: string;
  to?: string;
  /** Set when kind === "failed"; gh stderr (truncated) for diagnostics. */
  error?: string;
}

export type ProtectionOutcomeKind =
  | "skipped-config-opted-out"
  | "skipped-no-remote"
  | "skipped-gh-unauth"
  | "skipped-private-free-tier"
  | "skipped-missing-scopes"
  | "applied"
  | "failed";

export interface ProtectionOutcome {
  kind: ProtectionOutcomeKind;
  /** True when an existing protection ruleset was unioned with ours
   *  (kind must be "applied"). */
  merged?: boolean;
  /** True when kind === "skipped-private-free-tier" and the local pre-push
   *  hook was installed as the substitute gate. */
  prePushHookInstalled?: boolean;
  /** Set when kind === "failed"; gh stderr (truncated) for diagnostics. */
  error?: string;
}

export type ManualEntryKind =
  | "no-remote"
  | "gh-not-authenticated"
  | "gh-missing-scopes"
  | "private-free-tier";

export interface ManualEntry {
  kind: ManualEntryKind;
  body: string;
}

export type PendingGhOpKind =
  | "create-develop-branch"
  | "set-default-branch"
  | "apply-branch-protection"
  | "push-workflows";

export interface PendingGhOp {
  kind: PendingGhOpKind;
  payload: Record<string, unknown>;
}

export interface PendingGhOpsFile {
  version: 1;
  created: string;
  ops: PendingGhOp[];
}

export interface InitGhResult {
  workflows: WorkflowResult[];
  develop: DevelopOutcome;
  defaultBranch: DefaultBranchOutcome;
  protection: ProtectionOutcome;
  manualEntries: ManualEntry[];
  pendingGhOps: PendingGhOp[];
  pendingGhOpsPath: string;
  /** Slug `<owner>/<repo>` parsed from the git remote, or null when no remote. */
  repoSlug: string | null;
  ghAuthOk: boolean;
}

export interface InitGhOpts {
  repoRoot: string;
  config: PartialConfig;
  state: InitState;
  /** Override templates root. Defaults to the package's _devx/templates/init/. */
  templatesRoot?: string;
  /** Injectable gh CLI for testing. */
  gh?: GhExec;
  /** Injectable git CLI for testing. */
  git?: GitExec;
  /** Override .devx-cache dir (defaults to <repoRoot>/.devx-cache). */
  cacheDir?: string;
  /** Override .git/hooks dir (defaults to <repoRoot>/.git/hooks). */
  hooksDir?: string;
  /** Override the timestamp on the pending-gh-ops file header. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUIRED_GH_SCOPES = ["repo", "workflow"] as const;
const PROTECTION_REQUIRED_CONTEXTS = ["lint", "test", "coverage"] as const;

const STACK_TEMPLATE: Record<DetectedStack, string> = {
  typescript: "devx-ci-typescript.yml",
  python: "devx-ci-python.yml",
  rust: "devx-ci-rust.yml",
  go: "devx-ci-go.yml",
  flutter: "devx-ci-flutter.yml",
  empty: "devx-ci-empty.yml",
  // For mixed stacks we ship the TS template by default — most polyglot devx
  // repos right now have a JS/TS surface. Once `init-questions.ts` learns to
  // ask for the primary lane on `mixed`, this default is replaced by the
  // user's pick. The fallback is still safer than the empty no-op gate.
  mixed: "devx-ci-typescript.yml",
};

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function writeInitGh(opts: InitGhOpts): InitGhResult {
  const repoRoot = opts.repoRoot;
  const config = opts.config;
  const state = opts.state;
  const templatesRoot = opts.templatesRoot ?? defaultTemplatesRoot();
  const cacheDir = opts.cacheDir ?? join(repoRoot, ".devx-cache");
  const hooksDir = opts.hooksDir ?? join(repoRoot, ".git", "hooks");
  const gh = opts.gh ?? defaultGhExec(repoRoot);
  const git = opts.git ?? defaultGitExec;
  const now = opts.now ?? (() => new Date());

  const pendingGhOpsPath = join(cacheDir, "pending-gh-ops.json");
  const pendingOps: PendingGhOp[] = [];
  const manualEntries: ManualEntry[] = [];

  // ---- 1. Workflow files ------------------------------------------------

  const stack = state.detectedStack;
  const ciTemplate = STACK_TEMPLATE[stack];
  const workflows: WorkflowResult[] = [
    writeWorkflowFile(
      join(templatesRoot, "github-workflows", ciTemplate),
      join(repoRoot, ".github", "workflows", "devx-ci.yml"),
    ),
    writeWorkflowFile(
      join(templatesRoot, "github-workflows", "devx-promotion.yml"),
      join(repoRoot, ".github", "workflows", "devx-promotion.yml"),
    ),
    writeWorkflowFile(
      join(templatesRoot, "github-workflows", "devx-deploy.yml"),
      join(repoRoot, ".github", "workflows", "devx-deploy.yml"),
    ),
  ];

  // ---- 2. Failure-mode probes -------------------------------------------

  const wantsSplit = (config.git?.integration_branch ?? null) === "develop";
  const wantsProtection = config.git?.protect_main !== false;

  // No remote: skip every gh op; queue only those the user's config wants;
  // 1 MANUAL entry. (Workflows are always queued for push since they were
  // written locally regardless of branch/protection prefs.)
  if (!state.hasRemote) {
    const baseSha = readHeadSha(git, repoRoot);
    if (wantsSplit) {
      pendingOps.push(
        makeOp("create-develop-branch", { from_sha: baseSha, branch: "develop" }),
        makeOp("set-default-branch", { to: "develop" }),
      );
    }
    pendingOps.push(
      makeOp("push-workflows", {
        paths: workflows.map((w) => relative(repoRoot, w.path)),
      }),
    );
    if (wantsProtection) {
      pendingOps.push(
        makeOp("apply-branch-protection", {
          branch: state.defaultBranch,
          protection: buildProtectionPayload(),
        }),
      );
    }
    manualEntries.push(noRemoteManual());
    writePendingOps(pendingGhOpsPath, pendingOps, now());
    return {
      workflows,
      develop: { kind: wantsSplit ? "skipped-no-remote" : "skipped-single-branch" },
      defaultBranch: {
        kind: wantsSplit ? "skipped-no-remote" : "skipped-single-branch",
      },
      protection: {
        kind: wantsProtection ? "skipped-no-remote" : "skipped-config-opted-out",
      },
      manualEntries,
      pendingGhOps: pendingOps,
      pendingGhOpsPath,
      repoSlug: null,
      ghAuthOk: false,
    };
  }

  const ghAuthOk = checkGhAuth(gh);
  const repoSlug = resolveRepoSlug(git, repoRoot);

  // gh not authenticated: queue only the gh ops the user's config wants;
  // 1 MANUAL entry.
  if (!ghAuthOk) {
    const baseSha = readHeadSha(git, repoRoot);
    if (wantsSplit) {
      pendingOps.push(
        makeOp("create-develop-branch", {
          from_sha: baseSha,
          branch: "develop",
          repo: repoSlug,
        }),
        makeOp("set-default-branch", { to: "develop", repo: repoSlug }),
      );
    }
    pendingOps.push(
      makeOp("push-workflows", {
        paths: workflows.map((w) => relative(repoRoot, w.path)),
      }),
    );
    if (wantsProtection) {
      pendingOps.push(
        makeOp("apply-branch-protection", {
          branch: state.defaultBranch,
          protection: buildProtectionPayload(),
          repo: repoSlug,
        }),
      );
    }
    manualEntries.push(ghUnauthenticatedManual());
    writePendingOps(pendingGhOpsPath, pendingOps, now());
    return {
      workflows,
      develop: { kind: wantsSplit ? "skipped-gh-unauth" : "skipped-single-branch" },
      defaultBranch: {
        kind: wantsSplit ? "skipped-gh-unauth" : "skipped-single-branch",
      },
      protection: {
        kind: wantsProtection ? "skipped-gh-unauth" : "skipped-config-opted-out",
      },
      manualEntries,
      pendingGhOps: pendingOps,
      pendingGhOpsPath,
      repoSlug,
      ghAuthOk,
    };
  }

  // ---- 3. develop branch + default-branch flip --------------------------

  let develop: DevelopOutcome;
  let defaultBranch: DefaultBranchOutcome;

  if (!wantsSplit) {
    develop = { kind: "skipped-single-branch" };
    defaultBranch = { kind: "skipped-single-branch" };
  } else if (state.developBranchExists) {
    // The branch already exists — never replace.
    develop = { kind: "skipped-already-exists" };
    defaultBranch = flipDefaultBranchToDevelop(gh, repoSlug, state);
  } else {
    develop = createDevelopBranch(gh, repoSlug, git, repoRoot);
    defaultBranch =
      develop.kind === "created"
        ? flipDefaultBranchToDevelop(gh, repoSlug, state)
        : { kind: "skipped-non-main-default", existing: state.defaultBranch };
  }

  // ---- 4. Branch protection on main -------------------------------------

  let protection: ProtectionOutcome;

  if (!wantsProtection) {
    protection = { kind: "skipped-config-opted-out" };
  } else {
    const probe = probeProtectionScopes(gh, repoSlug, state.defaultBranch);
    if (probe === "missing-scopes") {
      pendingOps.push(
        makeOp("apply-branch-protection", {
          branch: state.defaultBranch,
          protection: buildProtectionPayload(),
          repo: repoSlug,
        }),
      );
      manualEntries.push(ghMissingScopesManual());
      protection = { kind: "skipped-missing-scopes" };
    } else {
      const repoMeta = readRepoMeta(gh, repoSlug);
      if (repoMeta.private && repoMeta.planName === "free") {
        const hookResult = installPrePushHook(hooksDir);
        manualEntries.push(privateFreeTierManual(hookResult));
        protection = {
          kind: "skipped-private-free-tier",
          prePushHookInstalled: hookResult.installed,
        };
      } else {
        protection = applyBranchProtection(
          gh,
          repoSlug,
          state.defaultBranch,
          probe === "exists",
        );
      }
    }
  }

  // ---- 5. Persist queue if anything got deferred ------------------------

  if (pendingOps.length > 0) {
    writePendingOps(pendingGhOpsPath, pendingOps, now());
  }

  return {
    workflows,
    develop,
    defaultBranch,
    protection,
    manualEntries,
    pendingGhOps: pendingOps,
    pendingGhOpsPath,
    repoSlug,
    ghAuthOk,
  };
}

// ---------------------------------------------------------------------------
// Workflow file writes
// ---------------------------------------------------------------------------

function writeWorkflowFile(srcPath: string, destPath: string): WorkflowResult {
  const content = readTemplate(srcPath);
  if (!existsSync(destPath)) {
    writeAtomic(destPath, content);
    return { path: destPath, outcome: "wrote" };
  }
  const existing = readFileSync(destPath, "utf8").replace(/\r\n/g, "\n");
  if (existing === content) {
    return { path: destPath, outcome: "skipped-identical" };
  }
  return { path: destPath, outcome: "kept-existing-different" };
}

// ---------------------------------------------------------------------------
// gh + git probes
// ---------------------------------------------------------------------------

function checkGhAuth(gh: GhExec): boolean {
  const r = gh(["auth", "status"]);
  return r.exitCode === 0;
}

/** Resolve `<owner>/<repo>` from `git remote get-url origin`. Returns null
 *  when the remote is missing or unparseable. Public so the failure-mode
 *  paths can include the slug in queued payloads even when gh is unavailable. */
export function resolveRepoSlug(git: GitExec, cwd: string): string | null {
  const r = git(["remote", "get-url", "origin"], cwd);
  if (r.exitCode !== 0) return null;
  return parseRepoSlug(r.stdout.trim());
}

/** Parse owner/repo from any github remote URL form. Returns null on miss.
 *  Anchored to URL start to reject look-alikes like
 *  `https://malicious.com/github.com/x/y` which would otherwise match. */
export function parseRepoSlug(url: string): string | null {
  if (!url) return null;
  // git@github.com:owner/repo(.git)?
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  // https://github.com/owner/repo(.git)? — anchored to start so we don't
  // mis-parse `https://other.com/github.com/foo/bar`. Also accepts
  // `ssh://git@github.com/owner/repo` and `git+https://github.com/owner/repo`.
  const httpsMatch = url.match(
    /^(?:git\+)?(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/,
  );
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }
  return null;
}

function readHeadSha(git: GitExec, cwd: string): string | null {
  const r = git(["rev-parse", "HEAD"], cwd);
  if (r.exitCode !== 0) return null;
  const sha = r.stdout.trim();
  return sha.length > 0 ? sha : null;
}

interface RepoMeta {
  private: boolean;
  planName: string;
}

function readRepoMeta(gh: GhExec, repoSlug: string | null): RepoMeta {
  if (repoSlug === null) return { private: false, planName: "unknown" };
  const r = gh([
    "api",
    `repos/${repoSlug}`,
    "--jq",
    '{private: .private, plan: (.plan.name // "unknown")}',
  ]);
  if (r.exitCode !== 0) return { private: false, planName: "unknown" };
  try {
    const parsed = JSON.parse(r.stdout) as { private?: boolean; plan?: string };
    return {
      private: Boolean(parsed.private),
      planName: typeof parsed.plan === "string" ? parsed.plan : "unknown",
    };
  } catch {
    return { private: false, planName: "unknown" };
  }
}

type ProtectionProbe = "exists" | "absent" | "missing-scopes" | "other-error";

/** Up-front HEAD probe of the protection endpoint. Distinguishes 200 (exists),
 *  404 (no protection set yet), 403 (missing scopes) vs other failures. */
function probeProtectionScopes(
  gh: GhExec,
  repoSlug: string | null,
  branch: string,
): ProtectionProbe {
  if (repoSlug === null) return "other-error";
  const r = gh(["api", `repos/${repoSlug}/branches/${branch}/protection`]);
  if (r.exitCode === 0) return "exists";
  // \b boundaries so we don't match `4031` etc.
  if (/\bHTTP 404\b/.test(r.stderr)) return "absent";
  if (/\bHTTP 403\b/.test(r.stderr)) return "missing-scopes";
  return "other-error";
}

// ---------------------------------------------------------------------------
// develop branch + default-branch flip
// ---------------------------------------------------------------------------

function createDevelopBranch(
  gh: GhExec,
  repoSlug: string | null,
  git: GitExec,
  cwd: string,
): DevelopOutcome {
  const sha = readHeadSha(git, cwd);
  if (sha === null || repoSlug === null) {
    return { kind: "skipped-no-remote" };
  }
  const r = gh([
    "api",
    "-X",
    "POST",
    `repos/${repoSlug}/git/refs`,
    "-f",
    "ref=refs/heads/develop",
    "-f",
    `sha=${sha}`,
  ]);
  if (r.exitCode === 0) return { kind: "created", sha };
  // The ref already exists on remote even if local doesn't see it yet
  // (clone before push). Treat 422 ("Reference already exists") as success.
  if (/\bHTTP 422\b/.test(r.stderr) || /Reference already exists/i.test(r.stderr)) {
    return { kind: "skipped-already-exists" };
  }
  // Real error — surface honestly. The orchestrator gets to decide whether
  // to file a MANUAL entry or retry; we don't pretend it succeeded.
  return { kind: "failed", error: truncateError(r.stderr) };
}

function flipDefaultBranchToDevelop(
  gh: GhExec,
  repoSlug: string | null,
  state: InitState,
): DefaultBranchOutcome {
  if (repoSlug === null) return { kind: "skipped-no-remote" };
  // Only flip when the existing default is `main`. If the user has a
  // non-main default already (e.g. `master`, or already `develop`), keep
  // their setting — never silently change it. Matches AC #10.
  if (state.defaultBranch === "develop") {
    return { kind: "skipped-already-correct" };
  }
  if (state.defaultBranch !== "main") {
    return { kind: "skipped-non-main-default", existing: state.defaultBranch };
  }
  const r = gh([
    "api",
    "-X",
    "PATCH",
    `repos/${repoSlug}`,
    "-f",
    "default_branch=develop",
  ]);
  if (r.exitCode === 0) {
    return { kind: "changed", from: state.defaultBranch, to: "develop" };
  }
  return { kind: "failed", error: truncateError(r.stderr) };
}

// ---------------------------------------------------------------------------
// Branch protection
// ---------------------------------------------------------------------------

/** Restrictions in the PUT shape: arrays of slugs, OR null (no restriction).
 *  GitHub returns the GET shape with full objects — translateGithubRestrictions
 *  flattens to slugs. */
export interface ProtectionRestrictions {
  users: string[];
  teams: string[];
  apps: string[];
}

export interface ProtectionPutPayload {
  required_status_checks: {
    strict: boolean;
    contexts: string[];
  };
  enforce_admins: boolean;
  required_pull_request_reviews: {
    required_approving_review_count: number;
    dismiss_stale_reviews: boolean;
    require_code_owner_reviews: boolean;
  };
  /** null = anyone with push access (no extra restriction). */
  restrictions: ProtectionRestrictions | null;
  required_linear_history: boolean;
  allow_force_pushes: boolean;
  allow_deletions: boolean;
}

function buildProtectionPayload(): ProtectionPutPayload {
  return {
    required_status_checks: {
      strict: true,
      contexts: [...PROTECTION_REQUIRED_CONTEXTS],
    },
    enforce_admins: true,
    required_pull_request_reviews: {
      required_approving_review_count: 0,
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
    },
    // null = no extra restriction beyond the existing repo-level write
    // permission. Union with existing preserves any pre-set restrictions.
    restrictions: null,
    required_linear_history: true,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

function applyBranchProtection(
  gh: GhExec,
  repoSlug: string | null,
  branch: string,
  protectionExists: boolean,
): ProtectionOutcome {
  if (repoSlug === null) return { kind: "skipped-no-remote" };

  let payload: ProtectionPutPayload = buildProtectionPayload();
  let merged = false;

  if (protectionExists) {
    const existing = fetchExistingProtection(gh, repoSlug, branch);
    if (existing !== null) {
      payload = unionProtection(existing, payload);
      merged = true;
    }
  }

  const r = gh(
    [
      "api",
      "-X",
      "PUT",
      `repos/${repoSlug}/branches/${branch}/protection`,
      "--input",
      "-",
    ],
    { input: JSON.stringify(payload) },
  );
  if (r.exitCode !== 0) {
    // 403 here means the up-front probe lied (perhaps GH revoked the scope
    // mid-call) — surface as missing-scopes so the resume flow handles it.
    if (/\bHTTP 403\b/.test(r.stderr)) return { kind: "skipped-missing-scopes" };
    return { kind: "failed", error: truncateError(r.stderr) };
  }
  return { kind: "applied", merged };
}

/** Read existing protection from the API for the union step. Returns null
 *  on any error — caller treats null as "no existing", which is fine because
 *  buildProtectionPayload() is already strictly tightening defaults. */
function fetchExistingProtection(
  gh: GhExec,
  repoSlug: string,
  branch: string,
): Partial<ProtectionPutPayload> | null {
  const r = gh(["api", `repos/${repoSlug}/branches/${branch}/protection`]);
  if (r.exitCode !== 0) return null;
  try {
    return parseGithubProtection(JSON.parse(r.stdout));
  } catch {
    return null;
  }
}

/** Translate GitHub's GET-protection response shape (nested `enabled`/`enforce_admins.enabled`)
 *  into the flatter PUT shape we use for our payloads. */
function parseGithubProtection(api: unknown): Partial<ProtectionPutPayload> {
  if (typeof api !== "object" || api === null) return {};
  const obj = api as Record<string, unknown>;
  const out: Partial<ProtectionPutPayload> = {};

  const rsc = obj["required_status_checks"];
  if (typeof rsc === "object" && rsc !== null) {
    const r = rsc as Record<string, unknown>;
    out.required_status_checks = {
      strict: Boolean(r["strict"]),
      contexts: Array.isArray(r["contexts"])
        ? (r["contexts"] as unknown[]).filter((c): c is string => typeof c === "string")
        : [],
    };
  }

  const ea = obj["enforce_admins"];
  if (typeof ea === "object" && ea !== null) {
    out.enforce_admins = Boolean((ea as Record<string, unknown>)["enabled"]);
  } else if (typeof ea === "boolean") {
    out.enforce_admins = ea;
  }

  const rprr = obj["required_pull_request_reviews"];
  if (typeof rprr === "object" && rprr !== null) {
    const r = rprr as Record<string, unknown>;
    out.required_pull_request_reviews = {
      required_approving_review_count:
        typeof r["required_approving_review_count"] === "number"
          ? (r["required_approving_review_count"] as number)
          : 0,
      dismiss_stale_reviews: Boolean(r["dismiss_stale_reviews"]),
      require_code_owner_reviews: Boolean(r["require_code_owner_reviews"]),
    };
  }

  // restrictions: GitHub returns `{users: [{login}], teams: [{slug}], apps: [{slug}]}`
  // OR `null`. Translate to slug arrays for the PUT shape.
  const restr = obj["restrictions"];
  if (restr === null) {
    out.restrictions = null;
  } else if (typeof restr === "object") {
    const r = restr as Record<string, unknown>;
    out.restrictions = {
      users: extractSlugs(r["users"], ["login", "slug"]),
      teams: extractSlugs(r["teams"], ["slug"]),
      apps: extractSlugs(r["apps"], ["slug"]),
    };
  }

  const rlh = obj["required_linear_history"];
  if (typeof rlh === "object" && rlh !== null) {
    out.required_linear_history = Boolean((rlh as Record<string, unknown>)["enabled"]);
  } else if (typeof rlh === "boolean") {
    out.required_linear_history = rlh;
  }

  const afp = obj["allow_force_pushes"];
  if (typeof afp === "object" && afp !== null) {
    out.allow_force_pushes = Boolean((afp as Record<string, unknown>)["enabled"]);
  } else if (typeof afp === "boolean") {
    out.allow_force_pushes = afp;
  }

  const ad = obj["allow_deletions"];
  if (typeof ad === "object" && ad !== null) {
    out.allow_deletions = Boolean((ad as Record<string, unknown>)["enabled"]);
  } else if (typeof ad === "boolean") {
    out.allow_deletions = ad;
  }

  return out;
}

function extractSlugs(value: unknown, keys: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    for (const key of keys) {
      const v = obj[key];
      if (typeof v === "string") {
        out.push(v);
        break;
      }
    }
  }
  return out;
}

/** Combine existing + ours so we never weaken: arrays union, booleans tighten,
 *  numbers max, restrictions preserved. Spec: "branch protection union (never replace)". */
export function unionProtection(
  existing: Partial<ProtectionPutPayload>,
  ours: ProtectionPutPayload,
): ProtectionPutPayload {
  const existingContexts = existing.required_status_checks?.contexts ?? [];
  const oursContexts = ours.required_status_checks.contexts;
  const mergedContexts = Array.from(new Set([...existingContexts, ...oursContexts]));

  // Restrictions union: if either side specifies a restriction, the union
  // keeps everyone in either list (broader allow-list = the less restrictive
  // direction). If neither side restricts (both null), result is null.
  let restrictions: ProtectionRestrictions | null = null;
  const haveExisting = "restrictions" in existing && existing.restrictions !== null;
  const haveOurs = ours.restrictions !== null;
  if (haveExisting || haveOurs) {
    const a = existing.restrictions ?? { users: [], teams: [], apps: [] };
    const b = ours.restrictions ?? { users: [], teams: [], apps: [] };
    restrictions = {
      users: Array.from(new Set([...a.users, ...b.users])),
      teams: Array.from(new Set([...a.teams, ...b.teams])),
      apps: Array.from(new Set([...a.apps, ...b.apps])),
    };
  }

  return {
    required_status_checks: {
      strict: ours.required_status_checks.strict ||
        Boolean(existing.required_status_checks?.strict),
      contexts: mergedContexts,
    },
    // Boolean toggles: TRUE wins (we never relax to false silently).
    enforce_admins: ours.enforce_admins || Boolean(existing.enforce_admins),
    required_pull_request_reviews: {
      required_approving_review_count: Math.max(
        ours.required_pull_request_reviews.required_approving_review_count,
        existing.required_pull_request_reviews?.required_approving_review_count ?? 0,
      ),
      // Tighten on dismiss/code-owner toggles too.
      dismiss_stale_reviews:
        ours.required_pull_request_reviews.dismiss_stale_reviews ||
        Boolean(existing.required_pull_request_reviews?.dismiss_stale_reviews),
      require_code_owner_reviews:
        ours.required_pull_request_reviews.require_code_owner_reviews ||
        Boolean(existing.required_pull_request_reviews?.require_code_owner_reviews),
    },
    restrictions,
    required_linear_history:
      ours.required_linear_history || Boolean(existing.required_linear_history),
    // For "allow"-shaped flags we want FALSE when either says false (i.e.
    // never re-enable a thing the user disabled).
    allow_force_pushes:
      ours.allow_force_pushes && (existing.allow_force_pushes ?? true),
    allow_deletions:
      ours.allow_deletions && (existing.allow_deletions ?? true),
  };
}

// ---------------------------------------------------------------------------
// Pre-push hook (free-tier private fallback)
// ---------------------------------------------------------------------------

const PRE_PUSH_HOOK_BODY = `#!/usr/bin/env sh
# devx-managed pre-push hook (installed by /devx-init).
#
# GitHub's free tier doesn't support branch protection on private repos, so
# this hook substitutes the gate locally: a push to main/master must pass
# the project's lint + test before hitting the remote.
#
# Re-running /devx-init refreshes this hook. If you need to bypass once,
# use \`git push --no-verify\` (and file a debug/*.md if the gate is wrong).

set -e

current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
case "$current_branch" in
  main|master)
    echo "[devx pre-push] enforcing checks before push to $current_branch"
    ;;
  *)
    exit 0
    ;;
esac

if [ -f package.json ]; then
  npm test --silent
elif [ -f pyproject.toml ] || [ -f setup.py ]; then
  pytest -q
elif [ -f Cargo.toml ]; then
  cargo test --quiet
elif [ -f go.mod ]; then
  go test ./...
elif [ -f pubspec.yaml ]; then
  flutter test
else
  echo "[devx pre-push] no recognized stack — nothing to gate"
fi
`;

interface InstallHookResult {
  installed: boolean;
  /** When installed=false, the underlying error message (for the MANUAL entry). */
  error?: string;
}

function installPrePushHook(hooksDir: string): InstallHookResult {
  const hookPath = join(hooksDir, "pre-push");
  try {
    writeAtomic(hookPath, PRE_PUSH_HOOK_BODY, 0o755);
    return { installed: true };
  } catch (err) {
    return {
      installed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Truncate gh stderr to a manageable length. Errors are fed into result
 *  shapes that may end up rendered into MANUAL entries — keep them short. */
function truncateError(stderr: string, max = 500): string {
  const cleaned = stderr.trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max) + "… (truncated)";
}

// ---------------------------------------------------------------------------
// Pending gh ops queue
// ---------------------------------------------------------------------------

function makeOp(kind: PendingGhOpKind, payload: Record<string, unknown>): PendingGhOp {
  return { kind, payload };
}

function writePendingOps(path: string, ops: PendingGhOp[], now: Date): void {
  let existing: PendingGhOpsFile | null = null;
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8")) as PendingGhOpsFile;
    } catch {
      existing = null;
    }
  }
  // Merge: never duplicate by `kind` — last-write-wins on payload.
  const byKind = new Map<PendingGhOpKind, PendingGhOp>();
  if (existing && Array.isArray(existing.ops)) {
    for (const op of existing.ops) {
      if (isPendingGhOp(op)) byKind.set(op.kind, op);
    }
  }
  for (const op of ops) byKind.set(op.kind, op);

  const file: PendingGhOpsFile = {
    version: 1,
    created: existing?.created ?? now.toISOString(),
    ops: Array.from(byKind.values()),
  };
  writeAtomic(path, JSON.stringify(file, null, 2) + "\n");
}

function isPendingGhOp(op: unknown): op is PendingGhOp {
  if (typeof op !== "object" || op === null) return false;
  const o = op as { kind?: unknown; payload?: unknown };
  return typeof o.kind === "string" && typeof o.payload === "object" && o.payload !== null;
}

// ---------------------------------------------------------------------------
// MANUAL.md entry bodies
// ---------------------------------------------------------------------------

function noRemoteManual(): ManualEntry {
  return {
    kind: "no-remote",
    body: [
      "GitHub-side scaffolding deferred — repo has no `origin` remote.",
      "",
      "Once you `git remote add origin <url>` and `git push -u origin main`,",
      "run `devx init --resume-gh` to replay the queued ops:",
      "  - create `develop` branch",
      "  - set `develop` as default branch",
      "  - push `.github/workflows/*` to remote (already on disk)",
      "  - apply branch protection on `main`",
      "",
      "Local setup is complete and devx works without the GitHub side.",
    ].join("\n"),
  };
}

function ghUnauthenticatedManual(): ManualEntry {
  return {
    kind: "gh-not-authenticated",
    body: [
      "GitHub-side scaffolding deferred — `gh auth status` reports no auth.",
      "",
      "  1. Run `gh auth login` (choose `repo` and `workflow` scopes).",
      "  2. Run `devx init --resume-gh` to replay the queued ops.",
      "",
      "Local setup is complete and devx works without the GitHub side.",
    ].join("\n"),
  };
}

function ghMissingScopesManual(): ManualEntry {
  return {
    kind: "gh-missing-scopes",
    body: [
      "Branch protection deferred — `gh` token is missing required scopes.",
      "",
      `Required: ${REQUIRED_GH_SCOPES.join(", ")}.`,
      "",
      "  1. Run `gh auth refresh -h github.com -s repo,workflow`.",
      "  2. Run `devx init --resume-gh` to replay the queued protection PUT.",
    ].join("\n"),
  };
}

function privateFreeTierManual(hook: InstallHookResult): ManualEntry {
  const hookLine = hook.installed
    ? "A `pre-push` git hook was installed at `.git/hooks/pre-push` to substitute the gate locally."
    : `Could not write \`.git/hooks/pre-push\` (${hook.error ?? "unknown error"}). Install the hook manually or upgrade your GitHub plan.`;
  return {
    kind: "private-free-tier",
    body: [
      "Branch protection skipped — GitHub free tier doesn't support",
      "branch protection on private repositories.",
      "",
      hookLine,
      "",
      "Options:",
      "  - Make the repo public, then run `devx init --resume-gh`.",
      "  - Upgrade to GitHub Team / Enterprise, then run `devx init --resume-gh`.",
      "  - Keep the local pre-push hook as the gate (current setup).",
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default gh CLI runner. Captures stdout + stderr, allows feeding stdin. */
export function defaultGhExec(cwd: string): GhExec {
  return (args, opts) => {
    if (opts?.input !== undefined) {
      const r = spawnSync("gh", args as string[], {
        cwd,
        input: opts.input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return {
        exitCode: r.status ?? 1,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
      };
    }
    try {
      const stdout = execFileSync("gh", args as string[], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      return {
        exitCode: typeof e.status === "number" ? e.status : 1,
        stdout: typeof e.stdout === "string" ? e.stdout : (e.stdout?.toString("utf8") ?? ""),
        stderr: typeof e.stderr === "string" ? e.stderr : (e.stderr?.toString("utf8") ?? ""),
      };
    }
  };
}

function readTemplate(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function defaultTemplatesRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(here, "..", "..", "..", "_devx", "templates", "init");
}

// ---------------------------------------------------------------------------
// Re-exports for testing
// ---------------------------------------------------------------------------

export type { GitExec, GitResult } from "./init-state.js";
