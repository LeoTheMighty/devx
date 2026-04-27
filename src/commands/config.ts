// `devx config` get/set command (cfg204).
//
// Surface:
//   devx config get <key>          → print merged value (newline-terminated), exit 0
//   devx config <key>              → shorthand for get
//   devx config set <key> <value>  → write project devx.config.yaml
//   devx config <key> <value>      → shorthand for set
//   devx config --user set <key> <value>  → write ~/.devx/config.yaml (or platform equivalent)
//   devx config                    → print usage to stderr, exit 0 (per spec — Phase 0
//                                    stub policy: usage on no-args is exit 0, not 64)
//
// Reads go through cfg202's loadMerged() so the user file overlays the project
// file the same way every other devx subsystem sees the config. Writes go
// through cfg202's setLeaf() so comments, key order, anchors, and quote style
// are preserved.
//
// Schema-aware coercion + validation runs BEFORE any disk write (cfg204 AC#5):
//   1. Walk _devx/config-schema.json down the dotted path.
//   2. If the schema declares a leaf type (integer/number/boolean/enum), coerce
//      the stringified CLI input into that type and reject early on mismatch.
//   3. If the schema declares the path as an object/array (non-leaf), reject
//      with the cfg202 leaf-only message — same wording the runtime check in
//      setLeaf() uses, so the user sees one consistent error regardless of
//      whether the path was caught at schema-walk or at YAML-walk time.
//   4. If the path isn't in the schema at all (but the schema *was* loaded),
//      write the value as a string and emit a stderr warning — keeps
//      forward-compat with future schema additions (matches cfg203's unknown-
//      key policy). When no schema file is on disk, every key would look
//      "unknown", so we suppress the warning in that case to avoid noise.
//
// Spec: dev/dev-cfg204-2026-04-26T19:35-config-cli-get-set.md
// Reuses: src/lib/config-io.ts (cfg202), src/lib/config-validate.ts (cfg203)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command } from "commander";

import {
  findProjectConfig,
  loadMerged,
  setLeaf,
  type LeafValue,
  type Target,
} from "../lib/config-io.js";
import { attachPhase } from "../lib/help.js";

const LEAF_ONLY_MSG =
  "Phase 0 supports leaf scalar writes only — see Phase 1";

const USAGE = [
  "Usage: devx config <key>                  get a value",
  "       devx config get <key>              get a value",
  "       devx config <key> <value>          set a value (project)",
  "       devx config set <key> <value>      set a value (project)",
  "       devx config --user set <key> <v>   set a value (user file)",
].join("\n");

interface SchemaShape {
  type?: string | string[];
  properties?: Record<string, SchemaShape>;
  additionalProperties?: boolean | SchemaShape;
  items?: SchemaShape;
  enum?: unknown[];
}

export interface RunConfigOpts {
  /** Test seam: route output to a captured stream instead of process.stdout. */
  out?: (s: string) => void;
  /** Test seam: route warnings/usage to a captured stream instead of stderr. */
  err?: (s: string) => void;
  /** Test seam: explicit project path (skip findProjectConfig walk). */
  projectPath?: string;
  /** Test seam: explicit user-config path (skip platform default). */
  userPath?: string;
  /** Test seam: explicit schema path (skip _devx/config-schema.json next to project). */
  schemaPath?: string;
}

/**
 * Pure entry point — exported for tests + the commander wiring. Returns void on
 * success; throws on any error (commander's exitOverride / the top-level CLI
 * catch translate that into a non-zero exit). Usage-on-no-args is NOT an
 * error — the spec calls for exit 0 even when the user gives nothing.
 */
export function runConfig(args: string[], userFlag: boolean, opts: RunConfigOpts = {}): void {
  const out = opts.out ?? ((s) => process.stdout.write(s));
  const err = opts.err ?? ((s) => process.stderr.write(s));

  // No args → usage, exit 0. Phase 0 stub policy applies even though config is real.
  if (args.length === 0) {
    err(`${USAGE}\n`);
    return;
  }

  const [first, ...rest] = args;

  // Read paths: --user is meaningless on a get because reads always merge both
  // files (project ⊕ user). Surface this so users don't silently get a wrong
  // mental model — they'd otherwise expect --user to scope the read.
  const isReadPath =
    first === "get" || (first !== "set" && (args.length === 1));
  if (userFlag && isReadPath) {
    err(
      "devx config: --user is ignored on read; `get` always returns the merged (project ⊕ user) value\n",
    );
  }

  if (first === "get") {
    if (rest.length !== 1) {
      throw new Error(`usage: devx config get <key>\n${USAGE}`);
    }
    runGet(rest[0], opts, out);
    return;
  }

  if (first === "set") {
    if (rest.length !== 2) {
      throw new Error(`usage: devx config set <key> <value>\n${USAGE}`);
    }
    runSet(rest[0], rest[1], userFlag ? "user" : "project", opts, err);
    return;
  }

  // Shorthand: `devx config <key>` or `devx config <key> <value>`.
  if (args.length === 1) {
    runGet(args[0], opts, out);
    return;
  }
  if (args.length === 2) {
    runSet(args[0], args[1], userFlag ? "user" : "project", opts, err);
    return;
  }

  throw new Error(`too many arguments\n${USAGE}`);
}

function runGet(key: string, opts: RunConfigOpts, out: (s: string) => void): void {
  const path = parseDottedPath(key);
  const merged = loadMerged({
    projectPath: opts.projectPath,
    userPath: opts.userPath,
  });
  const value = walkValue(merged, path);
  if (value === undefined) {
    throw new Error(`no such key '${key}' in merged devx config`);
  }
  out(`${formatValue(value)}\n`);
}

function runSet(
  key: string,
  rawValue: string,
  target: Target,
  opts: RunConfigOpts,
  err: (s: string) => void,
): void {
  const path = parseDottedPath(key);

  // Reject array-element writes before any disk read — eemeli/yaml's setIn
  // treats a numeric string segment as a map key on a Seq, which silently
  // creates a stringly-keyed phantom field. Catching this here means the user
  // gets the same "leaf scalar writes only" message as for non-leaf paths.
  const merged = loadMerged({
    projectPath: opts.projectPath,
    userPath: opts.userPath,
  });
  if (pathTargetsArrayElement(merged, path)) {
    throw new Error(LEAF_ONLY_MSG);
  }

  const schema = loadSchemaFor(opts);
  const leafSchema = schema ? lookupSchemaForPath(schema, path) : null;

  if (leafSchema && schemaIsNonLeaf(leafSchema)) {
    // The schema says this is a sub-tree — refuse before we even open the YAML.
    // Mirrors the cfg202 message so users get one consistent string regardless
    // of which check fires first.
    throw new Error(LEAF_ONLY_MSG);
  }

  let coerced: LeafValue;
  if (leafSchema) {
    coerced = coerceForSchema(rawValue, leafSchema, key);
  } else {
    // Unknown-key path: write as string. Only warn if the schema *was* loaded
    // and didn't declare this key — that's the actionable signal (typo / older
    // devx vs. newer config). When no schema is on disk at all, every key is
    // "unknown" by definition, so warning would be noise — stay quiet and let
    // setLeaf do the write.
    if (schema) {
      err(
        `devx config: unknown key '${key}' — writing as string. Your devx may be older than this config, or this is a typo.\n`,
      );
    }
    coerced = rawValue;
  }

  setLeaf(path, coerced, target, {
    projectPath: opts.projectPath,
    userPath: opts.userPath,
  });
}

function parseDottedPath(key: string): string[] {
  if (!key || key.length === 0) {
    throw new Error("config key must be a non-empty dotted path (e.g. 'mode' or 'capacity.usage_cap_pct')");
  }
  const segs = key.split(".");
  if (segs.some((s) => s.length === 0)) {
    throw new Error(`config key has an empty segment: '${key}'`);
  }
  return segs;
}

/**
 * Detect a path that targets an array element via numeric segment. eemeli/yaml's
 * setIn would treat a string segment "0" as a map key on a Seq (silently
 * corrupting the document), so reject these up front. Phase 0 supports leaf
 * scalars only — array element rewrites are Phase 1+.
 */
function pathTargetsArrayElement(merged: unknown, segs: string[]): boolean {
  let cur: unknown = merged;
  for (let i = 0; i < segs.length - 1; i++) {
    if (cur === null || cur === undefined || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[segs[i]];
  }
  return Array.isArray(cur) && /^-?\d+$/.test(segs[segs.length - 1]);
}

function walkValue(obj: unknown, segs: string[]): unknown {
  let cur: unknown = obj;
  for (const seg of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    if (Array.isArray(cur)) {
      // Numeric index into an array (e.g. `permissions.bash.allow.0`); silently
      // permits out-of-range as undefined → caller throws "no such key".
      const idx = Number.parseInt(seg, 10);
      if (Number.isNaN(idx) || String(idx) !== seg) return undefined;
      cur = cur[idx];
    } else {
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Arrays + nested objects → JSON. Pretty-printed so multi-line YAML structures
  // are still scannable by eye; if a caller wants single-line, they can pipe
  // through `jq -c .`.
  return JSON.stringify(v, null, 2);
}

function loadSchemaFor(opts: RunConfigOpts): SchemaShape | null {
  const schemaPath = opts.schemaPath ?? defaultSchemaPath(opts.projectPath);
  if (!schemaPath || !existsSync(schemaPath)) return null;
  const raw = readFileSync(schemaPath, "utf8");
  try {
    return JSON.parse(raw) as SchemaShape;
  } catch (e) {
    // A hand-edited schema file shouldn't crash the CLI with a SyntaxError
    // stack — translate to a config-shaped failure mode users can act on.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `devx config: schema file at ${schemaPath} is not valid JSON: ${msg}`,
    );
  }
}

function defaultSchemaPath(projectPath?: string): string | null {
  const project = projectPath ?? findProjectConfig();
  if (!project) return null;
  return join(dirname(project), "_devx", "config-schema.json");
}

/**
 * Walk `schema.properties` (or descend into `additionalProperties` when it's an
 * object schema) along `segs`. Returns the leaf sub-schema, or null if the path
 * isn't declared.
 */
function lookupSchemaForPath(
  schema: SchemaShape,
  segs: string[],
): SchemaShape | null {
  let cur: SchemaShape = schema;
  for (const seg of segs) {
    if (cur.properties && seg in cur.properties) {
      cur = cur.properties[seg];
      continue;
    }
    if (
      cur.additionalProperties &&
      typeof cur.additionalProperties === "object"
    ) {
      cur = cur.additionalProperties;
      continue;
    }
    return null;
  }
  return cur;
}

function schemaIsNonLeaf(leaf: SchemaShape): boolean {
  // `enum` is always a leaf check (the schema author has spelled out the
  // allowed scalar values), even when the surrounding schema also lists
  // type:object. Check enum first so we don't false-positive on enum-of-strings.
  if (leaf.enum) return false;
  const types = Array.isArray(leaf.type) ? leaf.type : leaf.type ? [leaf.type] : [];
  if (types.includes("object") || types.includes("array")) return true;
  // Defensive: a sub-schema with `properties` but no explicit type is still an
  // object in JSON-schema convention. Catches schemas that omit `type:object`.
  if (leaf.properties || leaf.items) return true;
  return false;
}

function coerceForSchema(
  raw: string,
  leaf: SchemaShape,
  key: string,
): LeafValue {
  if (leaf.enum) {
    for (const allowed of leaf.enum) {
      if (raw === String(allowed)) {
        if (
          typeof allowed === "string" ||
          typeof allowed === "number" ||
          typeof allowed === "boolean"
        ) {
          return allowed;
        }
      }
    }
    throw new Error(
      `devx config: invalid value '${raw}' at ${key} — allowed: ${leaf.enum.map(String).join(", ")}`,
    );
  }

  const types = Array.isArray(leaf.type) ? leaf.type : leaf.type ? [leaf.type] : [];

  if (types.includes("integer")) {
    if (!/^-?\d+$/.test(raw)) {
      throw new Error(`devx config: ${key} expects integer, got '${raw}'`);
    }
    return Number.parseInt(raw, 10);
  }
  if (types.includes("number")) {
    // Accept the common decimal forms shells produce (`.5`, `5.`, `5`, `1e10`)
    // but reject `3abc`-style garbage that Number.parseFloat would silently
    // truncate. The middle alternative `\d+\.?\d*` covers `5`, `5.`, and `5.5`
    // in one branch; `\.\d+` covers the leading-dot form.
    if (!/^-?(?:\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) {
      throw new Error(`devx config: ${key} expects number, got '${raw}'`);
    }
    return Number.parseFloat(raw);
  }
  if (types.includes("boolean")) {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(
      `devx config: ${key} expects boolean ('true' or 'false'), got '${raw}'`,
    );
  }
  // type:string, type:["string", "null"], or untyped → write as-is. (We refuse
  // to write the literal string "null" as a JSON null today; if a future spec
  // calls for that, special-case it here.)
  return raw;
}

export function register(program: Command): void {
  const sub = program
    .command("config")
    .description("Get or set values in devx.config.yaml (project) or ~/.devx/config.yaml (user)")
    .option("--user", "Target the user-level config file instead of the project file")
    .argument(
      "[args...]",
      "subcommand + key + value, or shorthand: `<key>` to get / `<key> <value>` to set",
    )
    .action((args: string[], opts: { user?: boolean }) => {
      runConfig(args ?? [], opts.user === true);
    });
  // cli303: config shipped in Phase 0 (cfg204) — phase 0 places it first in
  // `devx --help` listing, before the Phase 2/4/10 stubs.
  attachPhase(sub, 0);
}
