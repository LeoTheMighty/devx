// Local file-write orchestration for `/devx-init` (ini502).
//
// Public surface:
//   - writeInitFiles(opts) — orchestrates the five write phases in order:
//       1. devx.config.yaml  (15 sections + devx_version + provenance comments)
//       2. 8 backlog files   (DEV/PLAN/TEST/DEBUG/FOCUS/INTERVIEW/MANUAL/LESSONS)
//       3. spec subdirectories (dev/, plan/, test/, debug/, focus/, learn/, qa/,
//                               focus-group/personas/)
//       4. CLAUDE.md         (create / append / update-inside-markers; surface
//                             a conflict report when non-devx content sits
//                             inside the managed markers)
//       5. .gitignore        (managed devx block; idempotent)
//   - renderInitConfig(...) — exposed for unit testing the YAML payload.
//
// Idempotency: existing backlog files are NEVER overwritten. CLAUDE.md merge
// is in-place inside the markers. .gitignore is managed-block-aware. Re-runs
// are safe.
//
// Conflicts: when CLAUDE.md has user-typed content inside the devx markers,
// writeInitFiles() does NOT auto-resolve — it leaves the file alone, marks
// CLAUDE.md status as "conflict", and surfaces a ConflictReport so the
// orchestrator can file an INTERVIEW.md entry (per ini502 AC + epic
// open-question #3).
//
// Atomic: every write goes through writeAtomic() (tmp + rename). A crash
// mid-write leaves the previous file untouched.
//
// Spec: dev/dev-ini502-2026-04-26T19:35-init-local-writes.md
// Epic: _bmad-output/planning-artifacts/epic-init-skill.md

import {
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Document } from "yaml";

import type {
  PartialConfig,
  QuestionId,
  TranscriptEntry,
} from "./init-questions.js";
import type { InitState } from "./init-state.js";
import { writeAtomic } from "./supervisor-internal.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ClaudeMdOutcome = "created" | "appended" | "updated" | "conflict" | "skipped";
export type GitignoreOutcome = "created" | "appended" | "already-managed";

export interface ConflictReport {
  kind: "claude-md-marker-conflict";
  path: string;
  message: string;
}

export interface WriteInitResult {
  configWritten: boolean;
  configPath: string;
  backlogsCreated: string[];
  backlogsSkipped: string[];
  specDirsCreated: string[];
  specDirsSkipped: string[];
  claudeMd: ClaudeMdOutcome;
  gitignore: GitignoreOutcome;
  conflicts: ConflictReport[];
}

export interface WriteInitOpts {
  /** Repo root where files land. */
  repoRoot: string;
  /** Output of ini501's runInitQuestions. _meta is read but never serialized. */
  config: PartialConfig;
  /** Detected state — used for the "asked vs inferred" comments-on-fields. */
  state: InitState;
  /** Per-question source (asked / confirmed / inferred-silently / rejected-default). */
  transcript?: ReadonlyArray<TranscriptEntry>;
  /** Override the templates dir. Defaults to the package's _devx/templates/init/. */
  templatesRoot?: string;
  /** Override the timestamp embedded in the config header. Tests pin this. */
  now?: () => Date;
  /** When true and the config file already exists, skip the write (idempotent
   *  re-run path used by upgrade mode in ini507). Defaults to false. */
  skipExistingConfig?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKLOG_FILES: ReadonlyArray<string> = [
  "DEV.md",
  "PLAN.md",
  "TEST.md",
  "DEBUG.md",
  "FOCUS.md",
  "INTERVIEW.md",
  "MANUAL.md",
  "LESSONS.md",
];

const SPEC_DIRS: ReadonlyArray<string> = [
  "dev",
  "plan",
  "test",
  "debug",
  "focus",
  "learn",
  "qa",
  "focus-group/personas",
];

const CLAUDE_MARKER_START = "<!-- devx:start -->";
const CLAUDE_MARKER_END = "<!-- devx:end -->";

// ---------------------------------------------------------------------------
// Public entrypoints
// ---------------------------------------------------------------------------

export function writeInitFiles(opts: WriteInitOpts): WriteInitResult {
  const { repoRoot, config, state } = opts;
  const templatesRoot = opts.templatesRoot ?? defaultTemplatesRoot();
  const now = opts.now ?? (() => new Date());
  const transcript = opts.transcript ?? [];

  // 1. devx.config.yaml
  const configPath = join(repoRoot, "devx.config.yaml");
  let configWritten = false;
  if (!opts.skipExistingConfig || !existsSync(configPath)) {
    const yaml = renderInitConfig({ config, state, transcript, now: now() });
    writeAtomic(configPath, yaml);
    configWritten = true;
  }

  // 2. backlog files
  const backlogsCreated: string[] = [];
  const backlogsSkipped: string[] = [];
  for (const name of BACKLOG_FILES) {
    const path = join(repoRoot, name);
    if (existsSync(path)) {
      backlogsSkipped.push(name);
      continue;
    }
    const headerPath = join(templatesRoot, "backlog-headers", `${name}.header`);
    const header = readTemplate(headerPath);
    writeAtomic(path, header);
    backlogsCreated.push(name);
  }

  // 3. spec subdirectories
  const specDirsCreated: string[] = [];
  const specDirsSkipped: string[] = [];
  for (const dir of SPEC_DIRS) {
    const path = join(repoRoot, dir);
    if (existsSync(path)) {
      specDirsSkipped.push(dir);
      continue;
    }
    mkdirSync(path, { recursive: true });
    specDirsCreated.push(dir);
  }

  // 4. CLAUDE.md
  const claudeResult = writeClaudeMd({
    repoRoot,
    templatesRoot,
    config,
  });

  // 5. .gitignore
  const gitignoreResult = writeGitignoreBlock({
    repoRoot,
    templatesRoot,
  });

  return {
    configWritten,
    configPath,
    backlogsCreated,
    backlogsSkipped,
    specDirsCreated,
    specDirsSkipped,
    claudeMd: claudeResult.outcome,
    gitignore: gitignoreResult,
    conflicts: claudeResult.conflicts,
  };
}

// ---------------------------------------------------------------------------
// Config rendering
// ---------------------------------------------------------------------------

interface ProvenanceSource {
  kind: TranscriptEntry["kind"];
  reason?: string;
}

type Provenance = Partial<Record<QuestionId, ProvenanceSource>>;

function buildProvenance(
  transcript: ReadonlyArray<TranscriptEntry>,
): Provenance {
  const out: Provenance = {};
  for (const entry of transcript) {
    out[entry.id] = { kind: entry.kind, reason: entry.reason };
  }
  return out;
}

function provenanceComment(p: ProvenanceSource | undefined, qid: QuestionId): string | null {
  if (!p) return null;
  const label = qid.toUpperCase();
  switch (p.kind) {
    case "asked":
      return ` asked: ${label}`;
    case "rejected-default":
      return ` asked: ${label} (overrode inferred default${p.reason ? ` — ${p.reason}` : ""})`;
    case "confirmed":
      return ` inferred: ${p.reason ?? `${label} confirmed default`}`;
    case "inferred-silently":
      return ` inferred: ${p.reason ?? `${label} default applied silently`}`;
  }
}

interface RenderOpts {
  config: PartialConfig;
  state: InitState;
  transcript: ReadonlyArray<TranscriptEntry>;
  now: Date;
}

export function renderInitConfig(opts: RenderOpts): string {
  const { config, state, transcript, now } = opts;
  const prov = buildProvenance(transcript);

  // ---- Build the in-memory dict in the canonical 15-section order ---------
  const dailyCap = config.capacity?.daily_spend_cap_usd ?? null;
  const bashAllow = config.permissions?.bash?.allow ?? [];
  const integrationBranch = config.git?.integration_branch ?? null;
  const branchPrefix = config.git?.branch_prefix ?? (integrationBranch ? "develop/" : "feat/");
  const prStrategy = config.git?.pr_strategy ?? (integrationBranch ? "pr-to-develop" : "pr-to-main");
  const protectMain = config.git?.protect_main ?? Boolean(integrationBranch);
  const initialN = config.promotion?.autonomy?.initial_n ?? (config.mode === "YOLO" ? 0 : 5);
  const rollbackPenalty = config.promotion?.autonomy?.rollback_penalty ?? 0.5;
  const ciProvider = config.ci?.provider ?? "github-actions";
  const browserHarness = config.qa?.browser_harness ?? "playwright";
  // Schema requires channel.to to be a string when present. Drop the field
  // entirely when ini501 didn't capture an email — the orchestrator (or a
  // later /devx-init-style upgrade) fills it in via INTERVIEW.md.
  const notificationChannels = (config.notifications?.channels ?? [
    { kind: "email", digest_only: true },
  ]).map((ch) => stripNullTo(ch));
  const quietHours = config.notifications?.quiet_hours ?? "22:00-08:00";
  const thoroughness = config.thoroughness ?? deriveThoroughness(config.mode);

  // YOLO defaults per MODES.md §2. Every value below has to live inside the
  // schema's enum constraints (see _devx/config-schema.json). Mode → gate /
  // cadence / blast-radius mapping picks the closest enum member.
  const promotionGate = config.mode === "YOLO" ? "fast-ship-always"
    : config.mode === "BETA" ? "fast-ship"
    : config.mode === "PROD" ? "careful"
    : "manual-only";
  // PROD ships through CI + a 24h soak; LOCKDOWN is gated on a human and
  // shouldn't auto-ship at all, but a non-zero soak makes the intent
  // explicit and stops a future "promote when stable" automation from
  // racing past the gate. YOLO/BETA = no soak.
  const soakHours = config.mode === "PROD" ? 24
    : config.mode === "LOCKDOWN" ? 168
    : 0;
  const coverageBlocking = config.mode === "PROD" || config.mode === "LOCKDOWN";
  const coverageThreshold = config.mode === "BETA" ? 0.8 : 1.0;
  const maxConcurrent = config.mode === "YOLO" ? 5 : config.mode === "BETA" ? 3 : 2;
  const layer2Cadence = config.mode === "YOLO" ? "on-demand"
    : config.mode === "BETA" ? "nightly"
    : config.mode === "PROD" ? "per-pr"
    : "off";
  const focusGroupConsultAt: string[] = config.mode === "YOLO" ? []
    : config.mode === "BETA" ? ["plan"]
    : config.mode === "PROD" ? ["plan", "pre-promotion"]
    : ["plan", "pre-promotion"];
  const blastRadiusMax = config.mode === "YOLO" ? "medium"
    : config.mode === "BETA" ? "low"
    : config.mode === "PROD" ? "low"
    : "low";

  const obj: Record<string, unknown> = {
    devx_version: config.devx_version,
    // ini506 sets init_partial:true when failure-mode handlers leave deferred
    // work behind. Modes ≥ BETA refuse-to-spawn while it's true, so it must
    // round-trip through every write or the gate is silently bypassed.
    ...(config.init_partial !== undefined ? { init_partial: config.init_partial } : {}),

    mode: config.mode,
    project: { shape: config.project.shape },
    thoroughness,

    capacity: {
      max_concurrent: maxConcurrent,
      usage_cap_pct: 95,
      usage_hard_stop_pct: 100,
      token_budget_per_spec: 500000,
      model_strategy: "balanced",
      ...(dailyCap !== null ? { daily_spend_cap_usd: dailyCap } : {}),
    },

    permissions: {
      bash: {
        allow: bashAllow,
        ask: ["terraform", "kubectl", "docker", "aws", "gcloud", "az", "ssh", "rsync"],
        deny: ["rm -rf /", "curl https://*", "sudo *"],
      },
      file_writes: {
        allow: ["**/*"],
        deny: [".env", ".env.*", "secrets/**", "id_rsa*", "**/.aws/credentials", "**/.ssh/**"],
      },
    },

    git: {
      default_branch: state.defaultBranch,
      integration_branch: integrationBranch,
      branch_prefix: branchPrefix,
      pr_strategy: prStrategy,
      merge_method: "squash",
      protect_main: protectMain,
      require_linear_history: true,
      allow_force_push_main: false,
      allow_force_push_develop: integrationBranch !== null,
      delete_branch_on_merge: true,
    },

    promotion: {
      gate: promotionGate,
      soak_hours: soakHours,
      required_checks: ["ci"],
      block_on_new_debug_items: config.mode === "PROD" || config.mode === "LOCKDOWN",
      autonomy: {
        initial_n: initialN,
        count: initialN,
        rollback_penalty: rollbackPenalty,
        hotfix_zeroes: true,
        veto_window_hours: 24,
      },
      agent: "PromotionAgent",
    },

    coverage: {
      enabled: true,
      target: "touched-lines",
      threshold: coverageThreshold,
      blocking: coverageBlocking,
      opt_out_marker: "devx:no-coverage",
      flaky_window_hours: 24,
      flaky_action: "file-test-md-entry",
    },

    ci: {
      provider: ciProvider,
      ...(ciProvider === "github-actions"
        ? { workflow_path: ".github/workflows/devx-ci.yml" }
        : {}),
      required_checks: ["lint", "test"],
      retry_on_flake: true,
      max_retries: 2,
      poll_interval_s: 30,
      poll_timeout_min: 45,
    },

    qa: {
      browser_harness: browserHarness,
      layer_2_cadence: layer2Cadence,
      layer_2_personas: 4,
      ...(browserHarness !== "none" ? { scripted_test_runner: browserHarness } : {}),
    },

    focus_group: {
      panel_size: 5,
      consult_at: focusGroupConsultAt,
      auto_evolve: true,
      binding: false,
    },

    self_healing: {
      enabled: true,
      retro_concordance_threshold: thoroughness === "send-it" ? 5 : 3,
      auto_apply: {
        confidence_min: 0.85,
        blast_radius_max: blastRadiusMax,
      },
      canary_runs: 3,
      user_review_required_for: ["skills", "prompts", "agents"],
      user_review_optional_for: ["memory", "claude-md", "config"],
      over_tuning_detector: true,
      weekly_window_days: 7,
    },

    notifications: {
      channels: notificationChannels,
      events: {
        context_rot_detected: "silent",
        manual_filed: "push",
        interview_filed: "push",
        ci_failed: "digest",
        pr_opened: "silent",
        pr_merged: "digest",
        promotion_ready: config.mode === "YOLO" ? "silent" : "push",
        heartbeat_stale: "push",
        usage_cap_hit: "push",
        agent_crashed_repeatedly: "push",
      },
      quiet_hours: quietHours,
      quiet_hours_override: ["usage_cap_hit"],
      digest_schedule: "daily-09:00",
    },

    ui: {
      tui: { enabled: true, layout: "three-pane", theme: "dark", keybinds: "vim" },
      web: { enabled: true, port: 7321, bind: "127.0.0.1", theme: "dark" },
      mobile: { enabled: true, activity_feed_depth: 50, swipe_to_kill: true },
    },

    manager: {
      heartbeat_interval_s: 60,
      restart_on_token_pct: 0.85,
      max_worker_age_min: 90,
      worker_crash_backoff_s: [10, 30, 90, 300],
      max_restarts_per_spec: 5,
      cloud_watchdog: true,
      os_supervisor: "auto",
    },

    concierge: {
      always_on: true,
      context_window_target: 0.40,
      digest_interval_min: 60,
      intent_routing: {
        feature_request: "DEV.md",
        bug_report: "DEBUG.md",
        question: "INTERVIEW.md",
        feedback: "FOCUS.md",
      },
    },

    storage: {
      worktree_root: ".worktrees",
      cache_dir: ".devx-cache",
      log_retention_days: 14,
      spec_archive_after_days: 90,
      archive_path: "archive/",
      gitignore_managed: true,
    },

    observability: {
      log_level: "info",
      redact: ["api_keys", "emails", "tokens", "aws_access_keys"],
      telemetry: { enabled: false, endpoint: null, anonymized: true },
    },

    bmad: {
      modules: ["core", "bmm", "tea"],
      output_root: "_bmad-output",
      preserve_on_eject: true,
      workflows_path: "_bmad/",
    },
  };

  // ---- Build the YAML doc and attach provenance comments -----------------

  const doc = new Document(obj);
  doc.commentBefore = renderHeaderComment(config, now);

  attachProvenanceComments(doc, prov, dailyCap !== null);

  return doc.toString();
}

function renderHeaderComment(config: PartialConfig, now: Date): string {
  const ts = now.toISOString();
  const axes = `mode=${config.mode}, project.shape=${config.project.shape}, thoroughness=${config.thoroughness ?? deriveThoroughness(config.mode)}`;
  return [
    ` devx.config.yaml — generated by /devx-init at ${ts}`,
    ` Strategic axes: ${axes}`,
    "",
    ` Reference: docs/CONFIG.md (canonical knob list), docs/MODES.md`,
    ` (mode → subsystem behavior matrix), docs/DESIGN.md §Project shapes.`,
    "",
    ` Re-run \`/devx-init\` to upgrade in place. Hand-edits are preserved`,
    ` outside the strategic axes; the axes themselves are diff'd against the`,
    ` running mode and surfaced as a halt-and-confirm in upgrade mode.`,
  ].join("\n");
}

function attachProvenanceComments(doc: Document, prov: Provenance, hasDailyCap: boolean): void {
  // Map QuestionId → a leaf scalar in the rendered YAML. Inline comments
  // ONLY work cleanly on Scalar nodes; eemeli/yaml renders comments on Map
  // or Seq nodes after the entire collection, which mis-places provenance
  // on a sibling key. So every entry below points at a scalar.
  //
  // _meta entries (n1..n5) don't serialize → no node to annotate.
  const pathFor: Partial<Record<QuestionId, string[]>> = {
    n6: ["project", "shape"],
    n7: ["mode"],
    // n8 spans 4 git fields; integration_branch is the user-decided one.
    n8: ["git", "integration_branch"],
    n9: ["promotion", "autonomy", "initial_n"],
    // n10 sets permissions.bash.allow (a Seq) — point at the bash key's
    // sibling `ask` is wrong, point at the array itself wraps after the
    // last item. Skip provenance for n10 entirely; the array's own values
    // already document what was chosen.
    n11: ["ci", "provider"],
    // n12 only annotates when daily_spend_cap_usd was actually emitted —
    // otherwise there's no scalar leaf to attach to.
    ...(hasDailyCap ? { n12: ["capacity", "daily_spend_cap_usd"] } : {}),
    // n13 sets notifications.channels (a Seq) and quiet_hours (scalar).
    // Quiet-hours is the answer-shaped scalar we can annotate cleanly.
    n13: ["notifications", "quiet_hours"],
  };

  for (const [qid, p] of Object.entries(prov) as [QuestionId, ProvenanceSource][]) {
    const path = pathFor[qid];
    if (!path) continue;
    const comment = provenanceComment(p, qid);
    if (!comment) continue;
    const node = doc.getIn(path, true) as { comment?: string } | undefined;
    if (!node) continue;
    node.comment = comment;
  }
}

function deriveThoroughness(
  mode: PartialConfig["mode"],
): NonNullable<PartialConfig["thoroughness"]> {
  if (mode === "YOLO") return "send-it";
  if (mode === "PROD") return "thorough";
  return "balanced";
}

function stripNullTo(channel: unknown): unknown {
  if (
    typeof channel !== "object" ||
    channel === null ||
    !("to" in channel) ||
    (channel as { to: unknown }).to !== null
  ) {
    return channel;
  }
  const { to: _drop, ...rest } = channel as Record<string, unknown>;
  return rest;
}

// ---------------------------------------------------------------------------
// CLAUDE.md handling
// ---------------------------------------------------------------------------

interface ClaudeWriteOpts {
  repoRoot: string;
  templatesRoot: string;
  config: PartialConfig;
}

interface ClaudeWriteResult {
  outcome: ClaudeMdOutcome;
  conflicts: ConflictReport[];
}

function writeClaudeMd(opts: ClaudeWriteOpts): ClaudeWriteResult {
  const path = join(opts.repoRoot, "CLAUDE.md");
  const rawTemplate = readTemplate(join(opts.templatesRoot, "claude-md.template"));
  const filled = fillClaudeTemplate(rawTemplate, opts.config);

  if (!existsSync(path)) {
    writeAtomic(path, ensureTrailingNewline(filled));
    return { outcome: "created", conflicts: [] };
  }

  const existing = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const conflictReport: ConflictReport = {
    kind: "claude-md-marker-conflict",
    path,
    message:
      "CLAUDE.md has hand-edited content inside the <!-- devx:start --> / <!-- devx:end --> markers. /devx-init will not auto-resolve. File an INTERVIEW.md entry to ask the user how to proceed (replace / preserve / merge).",
  };

  const startIdx = existing.indexOf(CLAUDE_MARKER_START);
  // Pair with the FIRST end that comes after the first start; otherwise a
  // user-quoted instance of `<!-- devx:end -->` above the real block (or an
  // unmatched start with end-only-elsewhere) leaves us splicing across user
  // content. Treat misalignment as a conflict, not an append.
  const startSecondIdx =
    startIdx === -1
      ? -1
      : existing.indexOf(CLAUDE_MARKER_START, startIdx + CLAUDE_MARKER_START.length);
  const endIdx =
    startIdx === -1
      ? existing.indexOf(CLAUDE_MARKER_END)
      : existing.indexOf(CLAUDE_MARKER_END, startIdx + CLAUDE_MARKER_START.length);
  const strayEndIdx = existing.indexOf(CLAUDE_MARKER_END);
  const hasStrayEndBeforeStart =
    startIdx !== -1 && strayEndIdx !== -1 && strayEndIdx < startIdx;
  const hasStrayStartWithoutEnd = startIdx !== -1 && endIdx === -1;
  const hasStrayEndWithoutStart = startIdx === -1 && strayEndIdx !== -1;
  const hasDuplicateStart = startSecondIdx !== -1;

  if (
    hasStrayEndBeforeStart ||
    hasStrayStartWithoutEnd ||
    hasStrayEndWithoutStart ||
    hasDuplicateStart
  ) {
    return { outcome: "conflict", conflicts: [conflictReport] };
  }

  if (startIdx === -1) {
    // No managed block yet — append, leaving any user content above intact.
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    const next = existing + separator + ensureTrailingNewline(filled);
    writeAtomic(path, next);
    return { outcome: "appended", conflicts: [] };
  }

  // Managed block present — check for hand-edits inside.
  const innerStart = startIdx + CLAUDE_MARKER_START.length;
  const innerEnd = endIdx;
  const currentBlock = existing.slice(innerStart, innerEnd);
  const rawInner = innerOf(rawTemplate);

  if (!isExpectedManagedContent(currentBlock, rawInner)) {
    return { outcome: "conflict", conflicts: [conflictReport] };
  }

  // Splice the freshly-rendered managed block into place. Strip any trailing
  // newline off `filled` so we don't accumulate a blank line every re-run
  // when `after` already begins at a newline.
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + CLAUDE_MARKER_END.length);
  const trimmedFilled = filled.replace(/\n+$/, "");
  const next = before + trimmedFilled + after;
  if (next === existing) {
    return { outcome: "skipped", conflicts: [] };
  }
  writeAtomic(path, next);
  return { outcome: "updated", conflicts: [] };
}

/** Substitute the template placeholders with the active strategic axes. */
function fillClaudeTemplate(template: string, config: PartialConfig): string {
  const planSeed = config._meta.plan_seed.trim() || "_(seeded by /devx-plan)_";
  return template
    .replaceAll("<!-- devx:plan-seed -->", planSeed)
    .replaceAll("<!-- devx:mode -->", `**${config.mode}**`)
    .replaceAll("<!-- devx:shape -->", `**${config.project.shape}**`)
    .replaceAll(
      "<!-- devx:thoroughness -->",
      `**${config.thoroughness ?? deriveThoroughness(config.mode)}**`,
    );
}

/** Pull just the content between the markers from a freshly-rendered block. */
function innerOf(rendered: string): string {
  const s = rendered.indexOf(CLAUDE_MARKER_START);
  const e = rendered.indexOf(CLAUDE_MARKER_END);
  if (s === -1 || e === -1) return rendered;
  return rendered.slice(s + CLAUDE_MARKER_START.length, e);
}

/** Decide whether the on-disk block is a previous /devx-init write (so we can
 *  splice in a fresh one) vs hand-edited content (so we must surface a
 *  conflict). Strategy: build a regex from the *raw* template — escape every
 *  literal byte, then loosen each placeholder marker to a permissive match.
 *  Plan-seed expands to a freeform paragraph (multi-line allowed); the three
 *  axis placeholders (mode/shape/thoroughness) expand to single-token bold
 *  tokens. Anything that fits this regex is considered managed; anything
 *  else surfaces as a conflict. */
function isExpectedManagedContent(actual: string, rawTemplateInner: string): boolean {
  // Tighten the loosened sub-regexes so user edits inside the strategic-axes
  // table (or the plan-seed paragraph) still surface as conflicts. Each axis
  // expands to a bold-wrapped single token; plan-seed expands to free prose
  // (multi-line allowed) but only between blank lines, so the surrounding
  // template structure must remain intact.
  const escaped = escapeRegex(rawTemplateInner.trim());
  // We match enum members rather than `[A-Za-z\\-]+` so a typo (e.g.
  // `**YOLOO**`) is caught as a conflict, not silently overwritten.
  const modeAlt = "(?:YOLO|BETA|PROD|LOCKDOWN)";
  const shapeAlt = "(?:empty-dream|bootstrapped-rewriting|mature-refactor-and-add|mature-yolo-rewrites|production-careful)";
  const thoroughnessAlt = "(?:send-it|balanced|thorough)";
  const planSeedAlt = "(?:_\\(seeded by /devx-plan\\)_|[^\\n][\\s\\S]*?)";
  let pattern = escaped;
  pattern = pattern.replace(escapeRegex("<!-- devx:plan-seed -->"), planSeedAlt);
  pattern = pattern.replace(escapeRegex("<!-- devx:mode -->"), `\\*\\*${modeAlt}\\*\\*`);
  pattern = pattern.replace(escapeRegex("<!-- devx:shape -->"), `\\*\\*${shapeAlt}\\*\\*`);
  pattern = pattern.replace(
    escapeRegex("<!-- devx:thoroughness -->"),
    `\\*\\*${thoroughnessAlt}\\*\\*`,
  );
  return new RegExp(`^\\s*${pattern}\\s*$`).test(actual);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// .gitignore handling
// ---------------------------------------------------------------------------

interface GitignoreOpts {
  repoRoot: string;
  templatesRoot: string;
}

// Match the markers as standalone lines; substring matching mis-detects
// neighbors like `# >>> devx-build/` and orphaned half-blocks. Anchored
// regex with /m so they match at any line boundary.
const GITIGNORE_START_RE = /^# >>> devx[ \t]*$/m;
const GITIGNORE_END_RE = /^# <<< devx[ \t]*$/m;

function writeGitignoreBlock(opts: GitignoreOpts): GitignoreOutcome {
  const path = join(opts.repoRoot, ".gitignore");
  const block = readTemplate(join(opts.templatesRoot, "gitignore.devx-block"));

  if (!existsSync(path)) {
    writeAtomic(path, ensureTrailingNewline(block));
    return "created";
  }

  const existing = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const startMatch = existing.match(GITIGNORE_START_RE);
  const endMatch = existing.match(GITIGNORE_END_RE);
  if (
    startMatch &&
    endMatch &&
    typeof startMatch.index === "number" &&
    typeof endMatch.index === "number" &&
    startMatch.index < endMatch.index
  ) {
    return "already-managed";
  }

  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  writeAtomic(path, existing + separator + ensureTrailingNewline(block));
  return "appended";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a template, normalizing CRLF → LF so downstream regex / index work
 *  is line-ending-agnostic (matters when the package was checked out on
 *  Windows or under `core.autocrlf=true`). */
function readTemplate(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : s + "\n";
}

// ---------------------------------------------------------------------------
// Default templates root resolution. The package ships templates under
// `_devx/templates/init/` (sibling of `dist/`); when running from source we
// resolve relative to this file.
// ---------------------------------------------------------------------------

function defaultTemplatesRoot(): string {
  const here = fileURLToPath(import.meta.url);
  // src/lib/init-write.ts → ../../_devx/templates/init
  // dist/lib/init-write.js → ../../_devx/templates/init
  return resolve(here, "..", "..", "..", "_devx", "templates", "init");
}
