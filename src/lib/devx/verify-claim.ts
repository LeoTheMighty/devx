// Claim-ownership verification for the `/devx` Phase 1 resume-detection
// branch (roc101). Sister primitive to `claimSpec` (dvx101): `claim` handles
// the fresh-claim case; `verifyClaim` handles the resume-an-existing-claim
// case. Same seam pattern (ClaimFs), same lock-file location, same session
// token shape — the token recorded by claimSpec (lock file first line, spec
// frontmatter `owner: /devx-<sessionId>`) is what we compare against.
//
// Surface:
//
//   verifyClaim(hash, opts)
//     Reads `.devx-cache/locks/spec-<hash>.lock` + the spec's frontmatter
//     `owner:` / `status:` fields; compares the recorded session token
//     against opts.sessionToken. Returns a discriminated VerifyClaimResult:
//       • { status: "owned", ... }                    → CLI exit 0
//       • { status: "owned-by-other-session", ... }   → CLI exit 3
//       • { status: "in-progress-without-lock", ... } → CLI exit 4
//     Throws VerifyClaimError (stage-tagged) for everything else → CLI exit 2.
//
//   normalizeSessionToken / parseLockOwner / parseSpecClaimFields
//     Pure helpers, exported so the unit tests can hammer them directly.
//
// Token comparison contract: both sides are normalized (trim + strip a
// leading `/devx-` prefix) before comparing. The lock file records the raw
// sessionId (`2026-07-05T0953-22822`); the spec frontmatter records the
// prefixed owner (`owner: /devx-2026-07-05T0953-22822`); callers may pass
// either shape. Comparison is case-sensitive after normalization.
//
// Spec: dev/dev-roc101-2026-05-07T08:50-devx-resume-owner-check.md
// From: dev/dev-dvxret-2026-04-28T19:30-retro-devx-skill.md (LEARN.md §
//       epic-devx-skill E13 — resume-collision incident 2026-05-07)

import { join } from "node:path";

import { type ClaimFs, findSpecForHash, realFs } from "./claim.js";

const HASH_RE = /^[a-z0-9]{3,12}$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyClaimOpts {
  /**
   * The current session's token. Either the raw sessionId shape claimSpec
   * received (`2026-07-05T0953-22822`) or the prefixed owner shape recorded
   * in spec frontmatter (`/devx-2026-07-05T0953-22822`) — both normalize to
   * the same comparison key.
   */
  sessionToken: string;
  /** Project repo root — where `.devx-cache/` and `dev/` live. */
  repoRoot: string;
  /** Spec type (default "dev"). v2d101: debug specs resolve under
   *  `debug/` — same lock path, same ownership semantics. */
  type?: string;
  /** Test seam — partial fs override (real fs for unspecified keys). */
  fs?: Partial<ClaimFs>;
}

export type VerifyClaimResult =
  | {
      status: "owned";
      hash: string;
      /** Normalized current-session token (raw sessionId shape). */
      sessionToken: string;
      /** Raw first line of the lock file (trimmed). */
      lockOwner: string;
      /** Raw `owner:` frontmatter value, or null when the field is absent. */
      specOwner: string | null;
      /**
       * True when the spec's `owner:` frontmatter is present but does NOT
       * normalize to the same token as the lock file — the lock is
       * authoritative (it's the O_EXCL sentinel claimSpec created), but the
       * drift is worth surfacing to the operator.
       */
      specOwnerDrift: boolean;
      /**
       * True when the spec's frontmatter `status:` is not `in-progress`
       * even though the lock is held — status drift, surfaced but not
       * ownership-blocking (the lock holder owns the claim either way).
       */
      specStatusDrift: boolean;
    }
  | {
      status: "owned-by-other-session";
      hash: string;
      /** Raw first line of the lock file (trimmed). */
      lockOwner: string;
      /** Normalized current-session token (raw sessionId shape). */
      currentSession: string;
    }
  | {
      status: "in-progress-without-lock";
      hash: string;
      /** Raw `owner:` frontmatter value, or null when the field is absent. */
      specOwner: string | null;
    };

/**
 * Thrown for every non-enumerated failure — bad inputs, unresolvable spec,
 * unreadable lock/spec, unparseable content, or a spec that isn't in a
 * resume-shaped state at all. Caller (CLI passthrough) maps this to exit 2
 * with JSON `{"error":"<stage>","hash":"..."}` per the dvx-helper convention.
 *
 * stage ∈ { "validate", "resolve", "read-spec", "spec-parse", "read-lock",
 *           "lock-unparseable", "spec-not-in-progress" }
 */
export class VerifyClaimError extends Error {
  readonly stage: string;
  constructor(stage: string, message: string) {
    super(`verify-claim failed at stage '${stage}': ${message}`);
    this.name = "VerifyClaimError";
    this.stage = stage;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a session token for comparison: trim whitespace, then strip a
 * single leading `/devx-` prefix. `owner: /devx-<sid>` (frontmatter shape)
 * and `<sid>` (lock-file / claimSpec-opts shape) normalize identically.
 */
export function normalizeSessionToken(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("/devx-")
    ? trimmed.slice("/devx-".length)
    : trimmed;
}

/**
 * Extract the recorded owner token from a lock-file body. claimSpec writes
 * `${sessionId}\npid=...\nclaimed_at=...` — the owner is the first
 * non-empty line. Returns null when no such line exists (empty/whitespace
 * file — a partial write claimSpec's openExclusive normally forecloses,
 * but a hand-touched lock can still present it).
 */
export function parseLockOwner(lockBody: string): string | null {
  for (const line of lockBody.split("\n")) {
    const t = line.trim();
    if (t !== "") return t;
  }
  return null;
}

export interface SpecClaimFields {
  /** Raw `owner:` value (e.g. `/devx-2026-07-05T0953-22822`), or null. */
  owner: string | null;
  /** Raw `status:` value (e.g. `in-progress`), or null when absent. */
  status: string | null;
}

/**
 * Parse the `owner:` + `status:` fields out of a spec file's frontmatter
 * block. Throws VerifyClaimError("spec-parse") when the frontmatter block
 * itself is missing — a spec without frontmatter is out-of-convention and
 * verify-claim can't reason about it.
 */
export function parseSpecClaimFields(content: string): SpecClaimFields {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) {
    throw new VerifyClaimError("spec-parse", "spec missing frontmatter block");
  }
  let owner: string | null = null;
  let status: string | null = null;
  for (const line of fmMatch[1].split("\n")) {
    const ownerMatch = /^owner:\s*(.*)$/.exec(line);
    if (ownerMatch) {
      const v = ownerMatch[1].trim();
      owner = v === "" ? null : v;
      continue;
    }
    const statusMatch = /^status:\s*(.*)$/.exec(line);
    if (statusMatch) {
      const v = statusMatch[1].trim();
      status = v === "" ? null : v;
    }
  }
  return { owner, status };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

/**
 * Verify claim ownership for `<hash>`. Decision table (cartesian the spec
 * ACs call for — lock-exists × token-matches × spec-status):
 *
 *   lock exists, token matches            → "owned" (spec status/owner
 *                                           drift flagged, not blocking)
 *   lock exists, token mismatch           → "owned-by-other-session"
 *   lock missing, spec in-progress        → "in-progress-without-lock"
 *   lock missing, spec NOT in-progress    → throw ("spec-not-in-progress")
 *   spec unresolvable / unreadable / bad  → throw (stage-tagged)
 */
export function verifyClaim(
  hash: string,
  opts: VerifyClaimOpts,
): VerifyClaimResult {
  if (!HASH_RE.test(hash)) {
    throw new VerifyClaimError(
      "validate",
      `invalid hash '${hash}' (expected hex/alnum 3-12 chars)`,
    );
  }
  const sessionToken = normalizeSessionToken(opts.sessionToken ?? "");
  if (sessionToken === "") {
    throw new VerifyClaimError(
      "validate",
      "sessionToken must be non-empty after normalization",
    );
  }
  if (!opts.repoRoot) {
    throw new VerifyClaimError("validate", "repoRoot is required");
  }

  const fs: ClaimFs = { ...realFs, ...(opts.fs ?? {}) };

  const type = opts.type ?? "dev";
  if (!/^[a-z]+$/.test(type)) {
    throw new VerifyClaimError(
      "validate",
      `invalid spec type '${type}' (expected lowercase letters)`,
    );
  }

  // ---- Resolve + parse the spec first: exit-4 vs exit-2 both depend on
  //      the spec's status, and a garbage hash should be "resolve" (exit 2)
  //      regardless of any stray lock file.
  const specPath = findSpecForHash(fs, opts.repoRoot, hash, type);
  if (!specPath) {
    throw new VerifyClaimError(
      "resolve",
      `no spec file found at ${join(opts.repoRoot, type)}/${type}-${hash}-*.md`,
    );
  }
  let specContent: string;
  try {
    specContent = fs.readFile(specPath);
  } catch (e) {
    throw new VerifyClaimError("read-spec", errMessage(e));
  }
  const specFields = parseSpecClaimFields(specContent);

  // ---- Lock probe. `fs.exists` returning false covers BOTH a missing
  //      lock file and a missing `.devx-cache/locks/` directory — a fresh
  //      clone that has never run a claim has neither, and both mean the
  //      same thing here: nobody holds the lock.
  const lockPath = join(
    opts.repoRoot,
    ".devx-cache",
    "locks",
    `spec-${hash}.lock`,
  );
  if (!fs.exists(lockPath)) {
    if (specFields.status === "in-progress") {
      return {
        status: "in-progress-without-lock",
        hash,
        specOwner: specFields.owner,
      };
    }
    throw new VerifyClaimError(
      "spec-not-in-progress",
      `no lock at ${lockPath} and spec status is '${specFields.status ?? "<absent>"}' (not in-progress) — nothing to resume`,
    );
  }

  let lockBody: string;
  try {
    lockBody = fs.readFile(lockPath);
  } catch (e) {
    // exists() raced a release, or permissions. Either way we can't
    // determine ownership — surface rather than guess.
    throw new VerifyClaimError("read-lock", errMessage(e));
  }
  const lockOwner = parseLockOwner(lockBody);
  if (lockOwner === null) {
    throw new VerifyClaimError(
      "lock-unparseable",
      `lock file ${lockPath} has no owner line (empty/whitespace-only)`,
    );
  }

  if (normalizeSessionToken(lockOwner) !== sessionToken) {
    return {
      status: "owned-by-other-session",
      hash,
      lockOwner,
      currentSession: sessionToken,
    };
  }

  const specOwnerDrift =
    specFields.owner !== null &&
    normalizeSessionToken(specFields.owner) !==
      normalizeSessionToken(lockOwner);
  const specStatusDrift = specFields.status !== "in-progress";
  return {
    status: "owned",
    hash,
    sessionToken,
    lockOwner,
    specOwner: specFields.owner,
    specOwnerDrift,
    specStatusDrift,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
